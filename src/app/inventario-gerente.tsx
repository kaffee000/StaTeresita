import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { clp } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { ReactNode, useCallback, useRef, useState } from 'react'
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
interface Ubicacion { id: string; tipo: 'bodega' | 'furgon'; nombre: string; patente: string | null; responsable_id?: string | null }
interface Persona { id: string; nombre: string; rol: string }
interface StockFila { ubicacion_id: string; producto_id: string; cantidad: number }

const numero = (t: string) => parseInt(t.replace(/\D/g, ''), 10) || 0
const norm = (t: string | null | undefined) => (t ?? '').trim().toLowerCase()
const detalle = (p: Producto) => [p.marca, p.especificacion].filter(Boolean).join(' · ')

interface Columna { titulo: string; flex?: number; ancho?: number; align?: 'left' | 'center' | 'right' }
interface FilaTabla { key: string; celdas: ReactNode[]; alerta?: boolean }

// Tabla tipo hoja de cálculo: casillas cuadradas con borde
const Tabla = ({ columnas, filas }: { columnas: Columna[]; filas: FilaTabla[] }) => {
  const estiloCol = (c: Columna) => (c.ancho ? { width: c.ancho } : { flex: c.flex ?? 1 })
  return (
    <View style={tabla.contenedor}>
      <View style={tabla.fila}>
        {columnas.map((c, i) => (
          <View key={c.titulo + i} style={[tabla.celda, tabla.celdaHeader, estiloCol(c), i === columnas.length - 1 && tabla.ultima]}>
            <Text style={[tabla.textoHeader, { textAlign: c.align ?? 'left' }]} numberOfLines={1}>{c.titulo}</Text>
          </View>
        ))}
      </View>
      {filas.map((f, r) => (
        <View key={f.key} style={[tabla.fila, r === filas.length - 1 && tabla.filaFinal]}>
          {f.celdas.map((contenido, i) => (
            <View key={i} style={[tabla.celda, estiloCol(columnas[i]), f.alerta && tabla.celdaAlerta, i === columnas.length - 1 && tabla.ultima]}>
              {typeof contenido === 'string' || typeof contenido === 'number'
                ? <Text style={[tabla.texto, { textAlign: columnas[i].align ?? 'left' }]}>{contenido}</Text>
                : contenido}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

// Tablas usadas: productos, ubicaciones_inventario, inventario_stock y la función mover_stock
// (script inventario.sql). Los movimientos de stock siempre pasan por mover_stock.
const GestionInventario = () => {
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [productos, setProductos] = useState<Producto[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [sinResponsable, setSinResponsable] = useState(false) // falta ejecutar asignar_furgon.sql
  const [asignarId, setAsignarId] = useState<string | null>(null)
  const [stock, setStock] = useState<StockFila[]>([])
  const [guardando, setGuardando] = useState(false)
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const alternar = (k: string) => setAbiertos((a) => ({ ...a, [k]: !a[k] }))

  // Modal: ingreso a bodega
  const [modalBodega, setModalBodega] = useState(false)
  const [nombreProd, setNombreProd] = useState('')
  const [marcaProd, setMarcaProd] = useState('')
  const [especProd, setEspecProd] = useState('')
  const [precioProd, setPrecioProd] = useState('')
  const [cantProd, setCantProd] = useState('')
  const [prodElegido, setProdElegido] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'existente' | 'nuevo'>('existente')
  const [buscaProd, setBuscaProd] = useState('')

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

  // Si todavía no existe la columna responsable_id (script asignar_furgon.sql), carga sin ella
  const traerUbicaciones = async () => {
    const base = () => supabase.from('ubicaciones_inventario')
    const con = await base().select('id, tipo, nombre, patente, responsable_id').eq('activo', true).order('nombre', { ascending: true })
    if (!con.error) return { data: con.data, error: null, sinResponsable: false }
    const sin = await base().select('id, tipo, nombre, patente').eq('activo', true).order('nombre', { ascending: true })
    return { data: sin.data, error: sin.error, sinResponsable: true }
  }

  const nombreResponsable = (id?: string | null) => personas.find((x) => x.id === id)?.nombre ?? null

  const asignarResponsable = async (furgonId: string, personaId: string | null) => {
    const { error } = await supabase.from('ubicaciones_inventario').update({ responsable_id: personaId }).eq('id', furgonId)
    if (error) { Alert.alert('Error al asignar', error.message); return }
    setAsignarId(null)
    cargar()
  }

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      setSoyGerente(esGerente(perfil?.rol))
    }
    const [ps, us, st, pe] = await Promise.all([
      supabase.from('productos').select('id, nombre, marca, especificacion, precio_venta, controla_stock').eq('activo', true).order('nombre', { ascending: true }),
      traerUbicaciones(),
      supabase.from('inventario_stock').select('ubicacion_id, producto_id, cantidad'),
      supabase.from('perfiles').select('id, nombre, rol').in('rol', ['dueno', 'vendedor']).order('nombre', { ascending: true }),
    ])
    const error = ps.error || us.error || st.error
    setErrorCarga(error ? error.message : null)
    setProductos((ps.data as Producto[]) || [])
    setUbicaciones((us.data as Ubicacion[]) || [])
    setSinResponsable(us.sinResponsable)
    setPersonas((pe.data as Persona[]) || [])
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
    setBuscaProd(''); setPestana(productos.length > 0 ? 'existente' : 'nuevo')
    setModalBodega(true)
  }

  const cambiarPestana = (t: 'existente' | 'nuevo') => {
    setPestana(t)
    setProdElegido(null)
    setNombreProd(''); setMarcaProd(''); setEspecProd(''); setPrecioProd(''); setCantProd('')
  }

  const alternarExistente = (p: Producto) => {
    if (prodElegido === p.id) { setProdElegido(null); setCantProd(''); return }
    setCantProd('')
    elegirExistente(p)
  }

  const elegirExistente = (p: Producto) => {
    setProdElegido(p.id)
    setNombreProd(p.nombre); setMarcaProd(p.marca ?? ''); setEspecProd(p.especificacion ?? '')
    setPrecioProd(p.precio_venta ? String(p.precio_venta) : '')
  }

  const guardarBodega = async () => {
    const nombre = nombreProd.trim()
    const cantidad = numero(cantProd)
    if (pestana === 'existente' && !prodElegido) {
      Alert.alert('Error', 'Toca un producto de la lista para elegirlo')
      return
    }
    if (!nombre) {
      Alert.alert('Error', 'Escribe el nombre del producto')
      return
    }
    if (pestana === 'existente' && cantidad <= 0) {
      Alert.alert('Error', 'Indica la cantidad que ingresa')
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

  // Suma o resta 1 unidad en el furgón. La pantalla se actualiza al instante
  // (furgón y bodega) y luego se confirma con la base de datos; si falla, se revierte.
  const pendientes = useRef(0)
  const moverUno = (productoId: string, delta: 1 | -1) => {
    if (!furgonCarga || !bodega) return
    const origen = delta === 1 ? bodega.id : furgonCarga.id
    const destino = delta === 1 ? furgonCarga.id : bodega.id
    if (stockDe(origen, productoId) < 1) return

    const aplicar = (cambio: number) =>
      setStock((st) => {
        const suma = (lista: StockFila[], ubic: string, d: number) => {
          const hay = lista.some((x) => x.ubicacion_id === ubic && x.producto_id === productoId)
          return hay
            ? lista.map((x) => (x.ubicacion_id === ubic && x.producto_id === productoId ? { ...x, cantidad: Math.max(0, x.cantidad + d) } : x))
            : [...lista, { ubicacion_id: ubic, producto_id: productoId, cantidad: Math.max(0, d) }]
        }
        return suma(suma(st, furgonCarga.id, delta * cambio), bodega.id, -delta * cambio)
      })

    aplicar(1)
    pendientes.current += 1
    mover(productoId, origen, destino, 1, delta === 1 ? 'carga' : 'devolucion').then((error) => {
      pendientes.current -= 1
      if (error) { aplicar(-1); Alert.alert('Error', error.message) }
      if (pendientes.current === 0) cargar()
    })
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

          {/* Furgones activos */}
          <View style={styles.seccionHeader}>
            <Text style={styles.seccion}>Furgones activos ({furgones.length})</Text>
            {editable && (
              <Pressable style={styles.botonChico} onPress={abrirFurgon}>
                <Ionicons name="add" size={16} color={Palette.onNavy} />
                <Text style={styles.botonChicoText}>Furgón</Text>
              </Pressable>
            )}
          </View>

          {furgones.length === 0 && <Text style={styles.vacio}>Aún no hay furgones registrados.</Text>}
          {furgones.map((f) => {
            const abierto = !!abiertos[f.id]
            const items = itemsDe(f.id)
            return (
              <View key={f.id} style={styles.acordeon}>
                <Pressable style={styles.acordeonHeader} onPress={() => alternar(f.id)}>
                  <View style={styles.furgonIcon}>
                    <Ionicons name="bus-outline" size={22} color={Palette.navy} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filaTitulo}>{f.nombre}</Text>
                    <Text style={styles.filaSub}>{f.responsable_id ? `${nombreResponsable(f.responsable_id) ?? 'Trabajador'} · ` : ''}{f.patente ? `${f.patente} · ` : ''}{totalDe(f.id)} unidades</Text>
                  </View>
                  <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={22} color={Palette.navy} />
                </Pressable>

                {abierto && (
                  <View style={styles.acordeonCuerpo}>
                    {!sinResponsable && (
                      <View style={styles.responsableFila}>
                        <Ionicons name="person-outline" size={18} color={Palette.navy} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.labelChico}>Trabajador asignado</Text>
                          <Text style={styles.responsableNombre}>{nombreResponsable(f.responsable_id) ?? 'Sin asignar'}</Text>
                        </View>
                        {editable && (
                          <Pressable style={styles.botonChico} onPress={() => setAsignarId(f.id)}>
                            <Text style={styles.botonChicoText}>{f.responsable_id ? 'Cambiar' : 'Asignar'}</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                    {items.length === 0 ? (
                      <Text style={styles.vacio}>Este furgón no lleva carga todavía.</Text>
                    ) : (
                      <Tabla
                        columnas={[
                          { titulo: 'Producto', flex: 1.6 },
                          { titulo: 'Detalle', flex: 1.4 },
                          { titulo: 'Cant.', ancho: 56, align: 'center' },
                        ]}
                        filas={items.map((it) => {
                          const pr = producto(it.producto_id)
                          return { key: it.producto_id, celdas: [pr?.nombre ?? '—', pr ? detalle(pr) || '—' : '—', String(it.cantidad)] }
                        })}
                      />
                    )}
                    <View style={styles.accionesFila}>
                      <Pressable style={[styles.botonCargar, { flex: 1 }]} onPress={() => abrirCarga(f)}>
                        <Text style={styles.botonCargarText}>{editable ? 'Cargar / devolver' : 'Ver carga'}</Text>
                      </Pressable>
                      {editable && (
                        <Pressable style={styles.botonQuitar} onPress={() => quitarFurgon(f)}>
                          <Ionicons name="trash-outline" size={18} color={Palette.textMuted} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )
          })}

          {/* Bodega */}
          <View style={[styles.seccionHeader, { marginTop: 10 }]}>
            <Text style={styles.seccion}>Bodega</Text>
          </View>
          {(() => {
            const abierto = !!abiertos.bodega
            const total = productos.reduce((n, p) => n + (p.controla_stock ? stockDe(bodega?.id, p.id) : 0), 0)
            return (
              <View style={styles.acordeon}>
                <Pressable style={styles.acordeonHeader} onPress={() => alternar('bodega')}>
                  <View style={styles.furgonIcon}>
                    <Ionicons name="cube-outline" size={22} color={Palette.navy} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filaTitulo}>Bodega</Text>
                    <Text style={styles.filaSub}>{productos.length} productos · {total} unidades</Text>
                  </View>
                  <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={22} color={Palette.navy} />
                </Pressable>

                {abierto && (
                  <View style={styles.acordeonCuerpo}>
                    {productos.length === 0 ? (
                      <Text style={styles.vacio}>Aún no hay productos. Agrega el primero.</Text>
                    ) : (
                      <Tabla
                        columnas={[
                          { titulo: 'Producto', flex: 1.5 },
                          { titulo: 'Detalle', flex: 1.2 },
                          { titulo: 'Precio', ancho: 74, align: 'right' },
                          { titulo: 'Stock', ancho: 50, align: 'center' },
                          ...(editable ? [{ titulo: '', ancho: 38, align: 'center' as const }] : []),
                        ]}
                        filas={productos.map((p) => {
                          const cant = stockDe(bodega?.id, p.id)
                          return {
                            key: p.id,
                            alerta: p.controla_stock && cant <= 2,
                            celdas: [
                              p.nombre,
                              detalle(p) || '—',
                              p.precio_venta > 0 ? clp(Number(p.precio_venta)) : '—',
                              p.controla_stock ? String(cant) : 'Serv.',
                              ...(editable ? [
                                <Pressable key="e" onPress={() => { abrirBodega(); elegirExistente(p) }} hitSlop={6} style={styles.celdaBoton}>
                                  <Ionicons name="create-outline" size={16} color={Palette.navy} />
                                </Pressable>,
                              ] : []),
                            ],
                          }
                        })}
                      />
                    )}
                    <Text style={styles.leyenda}>Las casillas amarillas indican stock bajo (2 unidades o menos).</Text>
                    {editable && (
                      <Pressable style={styles.botonCargar} onPress={abrirBodega}>
                        <Text style={styles.botonCargarText}>+ Agregar a la bodega</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            )
          })()}
        </ScrollView>
      )}

      {/* Modal: ingreso a bodega */}
      <Modal visible={modalBodega} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalBodega(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Agregar a la bodega</Text>
            <Pressable onPress={() => setModalBodega(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <View style={styles.pestanas}>
            {([['existente', 'Ya existente'], ['nuevo', 'Producto nuevo']] as const).map(([k, t]) => (
              <Pressable key={k} style={[styles.pestana, pestana === k && styles.pestanaActiva]} onPress={() => cambiarPestana(k)}>
                <Text style={[styles.pestanaText, pestana === k && styles.pestanaTextActiva]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {pestana === 'existente' ? (
              <>
                <View style={styles.buscador}>
                  <Ionicons name="search" size={18} color={Palette.textFaint} />
                  <TextInput style={styles.buscadorInput} value={buscaProd} onChangeText={setBuscaProd}
                    placeholder="Buscar producto" placeholderTextColor={Palette.textFaint} />
                </View>
                {productos
                  .filter((p) => norm(`${p.nombre} ${p.marca ?? ''} ${p.especificacion ?? ''}`).includes(norm(buscaProd)))
                  .map((p) => {
                    const abierto = prodElegido === p.id
                    return (
                      <View key={p.id} style={[styles.prodCard, abierto && styles.prodCardAbierta]}>
                        <Pressable style={styles.prodCabecera} onPress={() => alternarExistente(p)}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.filaTitulo}>{p.nombre}</Text>
                            {!!detalle(p) && <Text style={styles.filaSub}>{detalle(p)}</Text>}
                          </View>
                          <Text style={styles.prodStock}>{stockDe(bodega?.id, p.id)} en bodega</Text>
                          <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={20} color={Palette.navy} />
                        </Pressable>
                        {abierto && (
                          <View style={styles.prodDetalle}>
                            <View style={styles.datosFila}>
                              <View style={styles.dato}>
                                <Text style={styles.datoLabel}>Marca</Text>
                                <Text style={styles.datoValor}>{p.marca || '—'}</Text>
                              </View>
                              <View style={styles.dato}>
                                <Text style={styles.datoLabel}>Especificación</Text>
                                <Text style={styles.datoValor}>{p.especificacion || '—'}</Text>
                              </View>
                              <View style={styles.dato}>
                                <Text style={styles.datoLabel}>Precio venta</Text>
                                <TextInput style={styles.datoInput} value={precioProd} onChangeText={setPrecioProd} keyboardType="numeric"
                                  placeholder="0" placeholderTextColor={Palette.textFaint} />
                              </View>
                            </View>
                            <View style={styles.ingresoFila}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.datoLabel}>Cantidad a ingresar</Text>
                                <TextInput style={styles.datoInput} value={cantProd} onChangeText={setCantProd} keyboardType="numeric"
                                  placeholder="0" placeholderTextColor={Palette.textFaint} />
                              </View>
                              <Pressable style={[styles.botonIngresar, guardando && { opacity: 0.6 }]} onPress={guardarBodega} disabled={guardando}>
                                <Text style={styles.botonText}>{guardando ? 'Guardando...' : 'Ingresar'}</Text>
                              </Pressable>
                            </View>
                          </View>
                        )}
                      </View>
                    )
                  })}
                {productos.length === 0 && <Text style={styles.vacio}>Aún no hay productos. Crea uno en la pestaña «Producto nuevo».</Text>}
              </>
            ) : (
              <>
                <Text style={styles.label}>Nombre del producto</Text>
                <TextInput style={styles.input} value={nombreProd} onChangeText={setNombreProd}
                  placeholder="Ej. Sofá 3 cuerpos, Verdulero, Sábanas" placeholderTextColor={Palette.textFaint} />
                <View style={styles.dosCol}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Marca (opcional)</Text>
                    <TextInput style={styles.input} value={marcaProd} onChangeText={setMarcaProd}
                      placeholder="Ej. Rosen" placeholderTextColor={Palette.textFaint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Especificación</Text>
                    <TextInput style={styles.input} value={especProd} onChangeText={setEspecProd}
                      placeholder="Ej. 2 plazas" placeholderTextColor={Palette.textFaint} />
                  </View>
                </View>
                <View style={styles.dosCol}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Precio de venta</Text>
                    <TextInput style={styles.input} value={precioProd} onChangeText={setPrecioProd} keyboardType="numeric"
                      placeholder="0" placeholderTextColor={Palette.textFaint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Cantidad que ingresa</Text>
                    <TextInput style={styles.input} value={cantProd} onChangeText={setCantProd} keyboardType="numeric"
                      placeholder="0" placeholderTextColor={Palette.textFaint} />
                  </View>
                </View>
                <Pressable style={[styles.boton, guardando && { opacity: 0.6 }]} onPress={guardarBodega} disabled={guardando}>
                  <Text style={styles.botonText}>{guardando ? 'Guardando...' : 'Guardar en bodega'}</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal: asignar trabajador al furgón */}
      <Modal visible={!!asignarId} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAsignarId(null)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Asignar trabajador</Text>
            <Pressable onPress={() => setAsignarId(null)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {personas.length === 0 && <Text style={styles.vacio}>No hay trabajadores en la tabla perfiles.</Text>}
            {personas.map((pe) => {
              const actual = ubicaciones.find((u) => u.id === asignarId)?.responsable_id === pe.id
              return (
                <Pressable key={pe.id} style={[styles.opcionPersona, actual && styles.opcionPersonaActiva]} onPress={() => asignarId && asignarResponsable(asignarId, pe.id)}>
                  <Ionicons name={actual ? 'radio-button-on' : 'radio-button-off'} size={22} color={actual ? Palette.navy : Palette.textFaint} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filaTitulo}>{pe.nombre}</Text>
                    <Text style={styles.filaSub}>{pe.rol === 'dueno' ? 'Gerente (también trabaja en ruta)' : 'Casero'}</Text>
                  </View>
                </Pressable>
              )
            })}
            <Pressable style={styles.botonQuitarAsignacion} onPress={() => asignarId && asignarResponsable(asignarId, null)}>
              <Text style={styles.botonCargarText}>Dejar sin asignar</Text>
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
                {editable ? (
                  <View style={styles.stepper}>
                    <Pressable onPress={() => moverUno(s.producto_id, -1)} style={styles.menos} hitSlop={6}>
                      <Ionicons name="remove" size={18} color={Palette.navy} />
                    </Pressable>
                    <Text style={styles.stepperNum}>{s.cantidad}</Text>
                    <Pressable
                      onPress={() => moverUno(s.producto_id, 1)}
                      style={[styles.menos, stockDe(bodega?.id, s.producto_id) < 1 && { opacity: 0.35 }]}
                      disabled={stockDe(bodega?.id, s.producto_id) < 1}
                      hitSlop={6}
                    >
                      <Ionicons name="add" size={18} color={Palette.navy} />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.filaValor}>{s.cantidad} un.</Text>
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

const tabla = StyleSheet.create({
  contenedor: { borderWidth: 1, borderColor: Palette.textFaint, backgroundColor: Palette.card },
  fila: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Palette.textFaint },
  filaFinal: { borderBottomWidth: 0 },
  celda: { paddingHorizontal: 8, paddingVertical: 10, borderRightWidth: 1, borderRightColor: Palette.textFaint, justifyContent: 'center' },
  ultima: { borderRightWidth: 0 },
  celdaHeader: { backgroundColor: Palette.navySoft },
  celdaAlerta: { backgroundColor: Palette.amberSoft },
  textoHeader: { fontSize: 12, fontWeight: '800', color: Palette.navy },
  texto: { fontSize: 13, color: Palette.text },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 20, gap: 10 },
  aviso: { margin: 20, padding: 16, borderRadius: 14, backgroundColor: Palette.amberSoft, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avisoText: { flex: 1, color: Palette.amber, fontSize: 14, lineHeight: 20 },
  acordeon: { backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, overflow: 'hidden', marginTop: 6 },
  acordeonHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  acordeonCuerpo: { paddingHorizontal: 12, paddingBottom: 12, gap: 10, borderTopWidth: 1, borderTopColor: Palette.border, paddingTop: 12 },
  accionesFila: { flexDirection: 'row', gap: 8 },
  botonQuitar: { width: 44, borderRadius: 10, backgroundColor: Palette.grayPill, alignItems: 'center', justifyContent: 'center' },
  celdaBoton: { alignItems: 'center', justifyContent: 'center' },
  responsableFila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 12, padding: 10 },
  responsableNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  labelChico: { fontSize: 12, color: Palette.textMuted },
  opcionPersona: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 14 },
  opcionPersonaActiva: { borderColor: Palette.navy, backgroundColor: Palette.navySoft },
  botonQuitarAsignacion: { backgroundColor: Palette.grayPill, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  leyenda: { fontSize: 12, color: Palette.textMuted },
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
  pestanas: { flexDirection: 'row', margin: 16, marginBottom: 0, backgroundColor: Palette.grayPill, borderRadius: 12, padding: 4 },
  pestana: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  pestanaActiva: { backgroundColor: Palette.navy },
  pestanaText: { fontSize: 14, fontWeight: '700', color: Palette.textMuted },
  pestanaTextActiva: { color: Palette.onNavy },
  buscador: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 12, height: 46, marginBottom: 12 },
  buscadorInput: { flex: 1, fontSize: 15, color: Palette.text },
  prodCard: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, marginBottom: 10, overflow: 'hidden' },
  prodCardAbierta: { borderColor: Palette.navy },
  prodCabecera: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  prodStock: { fontSize: 12, fontWeight: '700', color: Palette.navy, backgroundColor: Palette.navySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  prodDetalle: { backgroundColor: Palette.cream, borderTopWidth: 1, borderTopColor: Palette.border, padding: 12, gap: 12 },
  datosFila: { flexDirection: 'row', gap: 8 },
  dato: { flex: 1, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 10, padding: 10 },
  datoLabel: { fontSize: 11, fontWeight: '600', color: Palette.textMuted, marginBottom: 4 },
  datoValor: { fontSize: 14, fontWeight: '700', color: Palette.text },
  datoInput: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 10, paddingHorizontal: 10, height: 42, fontSize: 15, fontWeight: '700', color: Palette.text },
  ingresoFila: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  botonIngresar: { backgroundColor: Palette.orange, borderRadius: 12, height: 42, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  dosCol: { flexDirection: 'row', gap: 10 },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperNum: { minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: '800', color: Palette.text },
  menos: { width: 32, height: 32, borderRadius: 16, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
})

export default GestionInventario
