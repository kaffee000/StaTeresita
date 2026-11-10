import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { clp } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Producto {
  id: string
  nombre: string
  marca: string | null
  especificacion: string | null
  precio_venta: number
  controla_stock: boolean
}
interface Ubicacion { id: string; tipo: 'bodega' | 'furgon'; nombre: string; patente: string | null }
interface StockFila { ubicacion_id: string; producto_id: string; cantidad: number }

const numero = (t: string) => parseInt(t.replace(/\D/g, ''), 10) || 0
const norm = (t: string | null | undefined) => (t ?? '').trim().toLowerCase()
const detalle = (p: Producto) => [p.marca, p.especificacion].filter(Boolean).join(' · ')

// Tablas usadas: productos, ubicaciones_inventario, inventario_stock y la función mover_stock
// (script inventario.sql). Los movimientos de stock siempre pasan por mover_stock.
const GestionInventario = () => {
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [productos, setProductos] = useState<Producto[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [stock, setStock] = useState<StockFila[]>([])
  const [guardando, setGuardando] = useState(false)

  // Modal: ingreso a bodega
  const [modalBodega, setModalBodega] = useState(false)
  const [nombreProd, setNombreProd] = useState('')
  const [marcaProd, setMarcaProd] = useState('')
  const [especProd, setEspecProd] = useState('')
  const [precioProd, setPrecioProd] = useState('')
  const [cantProd, setCantProd] = useState('')
  const [prodElegido, setProdElegido] = useState<string | null>(null)

  // Modal: nuevo furgón
  const [modalFurgon, setModalFurgon] = useState(false)
  const [nombreFurgon, setNombreFurgon] = useState('')
  const [patenteFurgon, setPatenteFurgon] = useState('')

  // Modal: carga de un furgón
  const [furgonCargaId, setFurgonCargaId] = useState<string | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, string>>({})

  const bodega = ubicaciones.find((u) => u.tipo === 'bodega') ?? null
  const furgones = ubicaciones.filter((u) => u.tipo === 'furgon')
  const furgonCarga = furgones.find((f) => f.id === furgonCargaId) ?? null
  const editable = soyGerente

  const stockDe = (ubicacionId: string | undefined, productoId: string) =>
    stock.find((s) => s.ubicacion_id === ubicacionId && s.producto_id === productoId)?.cantidad ?? 0
  const itemsDe = (ubicacionId: string) =>
    stock.filter((s) => s.ubicacion_id === ubicacionId && s.cantidad > 0)
  const totalDe = (ubicacionId: string) => itemsDe(ubicacionId).reduce((n, s) => n + s.cantidad, 0)
  const producto = (id: string) => productos.find((p) => p.id === id)

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      setSoyGerente(esGerente(perfil?.rol))
    }
    const [ps, us, st] = await Promise.all([
      supabase.from('productos').select('id, nombre, marca, especificacion, precio_venta, controla_stock').eq('activo', true).order('nombre', { ascending: true }),
      supabase.from('ubicaciones_inventario').select('id, tipo, nombre, patente').eq('activo', true).order('nombre', { ascending: true }),
      supabase.from('inventario_stock').select('ubicacion_id, producto_id, cantidad'),
    ])
    const error = ps.error || us.error || st.error
    setErrorCarga(error ? error.message : null)
    setProductos((ps.data as Producto[]) || [])
    setUbicaciones((us.data as Ubicacion[]) || [])
    setStock((st.data as StockFila[]) || [])
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const mover = async (productoId: string, origen: string | null, destino: string | null, cantidad: number, tipo: string) => {
    const { error } = await supabase.rpc('mover_stock', {
      p_producto: productoId, p_origen: origen, p_destino: destino, p_cantidad: cantidad, p_tipo: tipo,
    })
    return error
  }

  // ---------- Bodega ----------
  const abrirBodega = () => {
    setNombreProd(''); setMarcaProd(''); setEspecProd(''); setPrecioProd(''); setCantProd(''); setProdElegido(null)
    setModalBodega(true)
  }

  const elegirExistente = (p: Producto) => {
    setProdElegido(p.id)
    setNombreProd(p.nombre); setMarcaProd(p.marca ?? ''); setEspecProd(p.especificacion ?? '')
    setPrecioProd(p.precio_venta ? String(p.precio_venta) : '')
  }

  const guardarBodega = async () => {
    const nombre = nombreProd.trim()
    const cantidad = numero(cantProd)
    if (!nombre) {
      Alert.alert('Error', 'Escribe el nombre del producto')
      return
    }
    if (!bodega) {
      Alert.alert('Error', 'No existe la bodega en la base de datos')
      return
    }
    const existente =
      producto(prodElegido ?? '') ??
      productos.find((p) => norm(p.nombre) === norm(nombre) && norm(p.marca) === norm(marcaProd) && norm(p.especificacion) === norm(especProd))
    setGuardando(true)
    try {
      let id = existente?.id
      if (!id) {
        const { data, error } = await supabase
          .from('productos')
          .insert([{
            nombre,
            marca: marcaProd.trim() || null,
            especificacion: especProd.trim() || null,
            precio_venta: numero(precioProd),
          }])
          .select('id')
          .single()
        if (error) throw error
        id = data.id as string
      }
      if (existente && precioProd && numero(precioProd) !== Number(existente.precio_venta)) {
        const { error } = await supabase.from('productos').update({ precio_venta: numero(precioProd) }).eq('id', id)
        if (error) throw error
      }
      if (cantidad > 0) {
        const error = await mover(id, null, bodega.id, cantidad, 'ingreso')
        if (error) throw error
      }
      setModalBodega(false)
      await cargar()
    } catch (e: any) {
      Alert.alert('Error al guardar', e.message)
    } finally {
      setGuardando(false)
    }
  }

  // ---------- Furgones ----------
  const abrirFurgon = () => {
    setNombreFurgon(''); setPatenteFurgon('')
    setModalFurgon(true)
  }

  const guardarFurgon = async () => {
    const nombre = nombreFurgon.trim()
    if (!nombre) {
      Alert.alert('Error', 'Escribe el nombre del furgón')
      return
    }
    setGuardando(true)
    const { error } = await supabase
      .from('ubicaciones_inventario')
      .insert([{ tipo: 'furgon', nombre, patente: patenteFurgon.trim() || null }])
    setGuardando(false)
    if (error) { Alert.alert('Error al guardar', error.message); return }
    setModalFurgon(false)
    cargar()
  }

  const quitarFurgon = (f: Ubicacion) => {
    if (totalDe(f.id) > 0) {
      Alert.alert('No se puede quitar', 'Primero devuelve a la bodega lo que lleva cargado.')
      return
    }
    Alert.alert('Quitar furgón', `¿Quitar ${f.nombre}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('ubicaciones_inventario').update({ activo: false }).eq('id', f.id)
          if (error) Alert.alert('Error', error.message)
          else cargar()
        },
      },
    ])
  }

  // ---------- Cargar / devolver ----------
  const abrirCarga = (f: Ubicacion) => {
    setCantidades({})
    setFurgonCargaId(f.id)
  }

  const cargarProducto = async (p: Producto) => {
    if (!furgonCarga || !bodega) return
    const cantidad = numero(cantidades[p.id] || '')
    const disponible = stockDe(bodega.id, p.id)
    if (cantidad <= 0) { Alert.alert('Error', 'Escribe una cantidad mayor a 0'); return }
    if (cantidad > disponible) { Alert.alert('Error', `En bodega solo quedan ${disponible}`); return }
    setGuardando(true)
    const error = await mover(p.id, bodega.id, furgonCarga.id, cantidad, 'carga')
    setGuardando(false)
    if (error) { Alert.alert('Error al cargar', error.message); return }
    setCantidades((c) => ({ ...c, [p.id]: '' }))
    cargar()
  }

  const devolverProducto = async (productoId: string) => {
    if (!furgonCarga || !bodega) return
    const error = await mover(productoId, furgonCarga.id, bodega.id, 1, 'devolucion')
    if (error) Alert.alert('Error', error.message)
    else cargar()
  }

  const productosConStockBodega = productos.filter((p) => stockDe(bodega?.id, p.id) > 0)

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Gestionar inventario" />

      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : errorCarga ? (
        <View style={styles.aviso}>
          <Ionicons name="warning-outline" size={22} color={Palette.amber} />
          <Text style={styles.avisoText}>No se pudo cargar el inventario: {errorCarga}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {!soyGerente && <Text style={styles.nota}>Solo el gerente puede modificar el inventario.</Text>}

          {/* Bodega */}
          <View style={styles.seccionHeader}>
            <Text style={styles.seccion}>Bodega</Text>
            {editable && (
              <Pressable style={styles.botonChico} onPress={abrirBodega}>
                <Ionicons name="add" size={16} color={Palette.onNavy} />
                <Text style={styles.botonChicoText}>Agregar</Text>
              </Pressable>
            )}
          </View>

          {productos.length === 0 && <Text style={styles.vacio}>Aún no hay productos. Agrega el primero.</Text>}
          {productos.map((p) => {
            const cant = stockDe(bodega?.id, p.id)
            return (
              <View key={p.id} style={styles.fila}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.filaTitulo}>{p.nombre}</Text>
                  {!!detalle(p) && <Text style={styles.filaSub}>{detalle(p)}</Text>}
                  <Text style={p.precio_venta > 0 ? styles.filaSub : styles.sinPrecio}>{p.precio_venta > 0 ? `Venta: ${clp(Number(p.precio_venta))}` : 'Sin precio de venta'}</Text>
                  {p.controla_stock && cant <= 2 && <Text style={styles.stockBajo}>Stock bajo</Text>}
                </View>
                <Text style={styles.filaValor}>{p.controla_stock ? `${cant} un.` : 'Servicio'}</Text>
                {editable && (
                  <Pressable onPress={() => { abrirBodega(); elegirExistente(p) }} hitSlop={8} style={styles.menos}>
                    <Ionicons name="create-outline" size={16} color={Palette.navy} />
                  </Pressable>
                )}
              </View>
            )
          })}

          {/* Furgones */}
          <View style={[styles.seccionHeader, { marginTop: 10 }]}>
            <Text style={styles.seccion}>Furgones ({furgones.length})</Text>
            {editable && (
              <Pressable style={styles.botonChico} onPress={abrirFurgon}>
                <Ionicons name="add" size={16} color={Palette.onNavy} />
                <Text style={styles.botonChicoText}>Agregar</Text>
              </Pressable>
            )}
          </View>

          {furgones.length === 0 && <Text style={styles.vacio}>Aún no hay furgones registrados.</Text>}
          {furgones.map((f) => (
            <View key={f.id} style={styles.furgonCard}>
              <View style={styles.furgonTop}>
                <View style={styles.furgonIcon}>
                  <Ionicons name="bus-outline" size={22} color={Palette.navy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.filaTitulo}>{f.nombre}</Text>
                  <Text style={styles.filaSub}>{f.patente ? `Patente ${f.patente}` : 'Sin patente'}</Text>
                </View>
                {editable && (
                  <Pressable onPress={() => quitarFurgon(f)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={20} color={Palette.textFaint} />
                  </Pressable>
                )}
              </View>
              <Text style={styles.filaSub}>
                {totalDe(f.id) === 0
                  ? 'Sin carga'
                  : `${totalDe(f.id)} unidades · ${itemsDe(f.id).map((s) => `${s.cantidad} ${producto(s.producto_id)?.nombre ?? ''}`).join(', ')}`}
              </Text>
              <Pressable style={styles.botonCargar} onPress={() => abrirCarga(f)}>
                <Text style={styles.botonCargarText}>{editable ? 'Cargar furgón' : 'Ver carga'}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Modal: ingreso a bodega */}
      <Modal visible={modalBodega} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalBodega(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Agregar a la bodega</Text>
            <Pressable onPress={() => setModalBodega(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            {productos.length > 0 && (
              <>
                <Text style={styles.label}>Producto existente</Text>
                <View style={styles.chips}>
                  {productos.slice(0, 15).map((p) => (
                    <Pressable key={p.id} style={[styles.chip, prodElegido === p.id && styles.chipActivo]} onPress={() => elegirExistente(p)}>
                      <Text style={[styles.chipText, prodElegido === p.id && styles.chipTextActivo]}>
                        {p.nombre}{p.marca ? ` · ${p.marca}` : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <Text style={styles.label}>Nombre del producto</Text>
            <TextInput style={styles.input} value={nombreProd} onChangeText={(t) => { setNombreProd(t); setProdElegido(null) }}
              placeholder="Ej. Sofá 3 cuerpos, Verdulero, Sábanas" placeholderTextColor={Palette.textFaint} />
            <Text style={styles.label}>Marca (opcional)</Text>
            <TextInput style={styles.input} value={marcaProd} onChangeText={(t) => { setMarcaProd(t); setProdElegido(null) }}
              placeholder="Ej. Rosen" placeholderTextColor={Palette.textFaint} />
            <Text style={styles.label}>Especificación (opcional)</Text>
            <TextInput style={styles.input} value={especProd} onChangeText={(t) => { setEspecProd(t); setProdElegido(null) }}
              placeholder="Ej. 2 plazas, tela gris" placeholderTextColor={Palette.textFaint} />
            <Text style={styles.label}>Precio de venta</Text>
            <TextInput style={styles.input} value={precioProd} onChangeText={setPrecioProd} keyboardType="numeric"
              placeholder="0" placeholderTextColor={Palette.textFaint} />
            <Text style={styles.label}>Cantidad que ingresa</Text>
            <TextInput style={styles.input} value={cantProd} onChangeText={setCantProd} keyboardType="numeric"
              placeholder="0" placeholderTextColor={Palette.textFaint} />
            <Pressable style={[styles.boton, guardando && { opacity: 0.6 }]} onPress={guardarBodega} disabled={guardando}>
              <Text style={styles.botonText}>{guardando ? 'Guardando...' : 'Guardar en bodega'}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal: nuevo furgón */}
      <Modal visible={modalFurgon} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalFurgon(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo furgón</Text>
            <Pressable onPress={() => setModalFurgon(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nombre</Text>
            <TextInput style={styles.input} value={nombreFurgon} onChangeText={setNombreFurgon}
              placeholder="Ej. Furgón 1" placeholderTextColor={Palette.textFaint} />
            <Text style={styles.label}>Patente (opcional)</Text>
            <TextInput style={styles.input} value={patenteFurgon} onChangeText={setPatenteFurgon} autoCapitalize="characters"
              placeholder="Ej. AB1234" placeholderTextColor={Palette.textFaint} />
            <Pressable style={[styles.boton, guardando && { opacity: 0.6 }]} onPress={guardarFurgon} disabled={guardando}>
              <Text style={styles.botonText}>{guardando ? 'Guardando...' : 'Agregar furgón'}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal: carga del furgón */}
      <Modal visible={!!furgonCarga} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setFurgonCargaId(null)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{furgonCarga?.nombre ?? 'Furgón'}</Text>
            <Pressable onPress={() => setFurgonCargaId(null)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.seccion}>Lleva cargado</Text>
            {furgonCarga && itemsDe(furgonCarga.id).length === 0 && <Text style={styles.vacio}>Todavía no tiene productos.</Text>}
            {furgonCarga && itemsDe(furgonCarga.id).map((s) => (
              <View key={s.producto_id} style={styles.fila}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.filaTitulo}>{producto(s.producto_id)?.nombre}</Text>
                  {!!producto(s.producto_id) && !!detalle(producto(s.producto_id)!) && (
                    <Text style={styles.filaSub}>{detalle(producto(s.producto_id)!)}</Text>
                  )}
                </View>
                <Text style={styles.filaValor}>{s.cantidad} un.</Text>
                {editable && (
                  <Pressable onPress={() => devolverProducto(s.producto_id)} style={styles.menos} hitSlop={6}>
                    <Ionicons name="remove" size={18} color={Palette.navy} />
                  </Pressable>
                )}
              </View>
            ))}

            {editable && (
              <>
                <Text style={[styles.seccion, { marginTop: 18 }]}>Cargar desde la bodega</Text>
                {productosConStockBodega.length === 0 && <Text style={styles.vacio}>No hay stock en bodega.</Text>}
                {productosConStockBodega.map((p) => (
                  <View key={p.id} style={styles.fila}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.filaTitulo}>{p.nombre}</Text>
                      <Text style={styles.filaSub}>{[detalle(p), `En bodega: ${stockDe(bodega?.id, p.id)}`].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <TextInput style={styles.inputChico} value={cantidades[p.id] ?? ''} keyboardType="numeric"
                      onChangeText={(t) => setCantidades((c) => ({ ...c, [p.id]: t }))}
                      placeholder="0" placeholderTextColor={Palette.textFaint} />
                    <Pressable style={styles.botonChico} onPress={() => cargarProducto(p)} disabled={guardando}>
                      <Text style={styles.botonChicoText}>Cargar</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 20, gap: 10 },
  aviso: { margin: 20, padding: 16, borderRadius: 14, backgroundColor: Palette.amberSoft, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avisoText: { flex: 1, color: Palette.amber, fontSize: 14, lineHeight: 20 },
  nota: { fontSize: 13, color: Palette.textMuted },
  estadoCard: { backgroundColor: Palette.navy, borderRadius: 18, padding: 16 },
  estadoLabel: { fontSize: 12, color: Palette.onNavyMuted },
  estadoValor: { fontSize: 22, fontWeight: '800', color: Palette.onNavy, marginTop: 2 },
  estadoNota: { fontSize: 12, color: Palette.onNavyMuted, marginTop: 6 },
  seccionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seccion: { fontSize: 13, fontWeight: '700', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  vacio: { color: Palette.textMuted, fontSize: 14 },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderRadius: 14,
    borderWidth: 1, borderColor: Palette.border, padding: 14, marginTop: 6,
  },
  filaTitulo: { fontSize: 15, fontWeight: '700', color: Palette.text },
  filaSub: { fontSize: 13, color: Palette.textMuted },
  filaValor: { fontSize: 15, fontWeight: '800', color: Palette.text },
  sinPrecio: { fontSize: 13, fontWeight: '700', color: Palette.orange },
  stockBajo: { fontSize: 12, fontWeight: '700', color: Palette.orange },
  botonChico: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonChicoText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  furgonCard: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 8, marginTop: 6 },
  furgonTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  furgonIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
  botonCargar: { backgroundColor: Palette.navySoft, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  botonCargarText: { color: Palette.navy, fontWeight: '700', fontSize: 14 },
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  label: { fontSize: 14, fontWeight: '600', color: Palette.text, marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 16, color: Palette.text },
  inputChico: { width: 64, height: 40, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 10, textAlign: 'center', fontSize: 15, color: Palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { backgroundColor: Palette.grayPill, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  chipActivo: { backgroundColor: Palette.navy },
  chipText: { fontSize: 13, color: Palette.text, fontWeight: '600' },
  chipTextActivo: { color: Palette.onNavy },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
  menos: { width: 32, height: 32, borderRadius: 16, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
})

export default GestionInventario
