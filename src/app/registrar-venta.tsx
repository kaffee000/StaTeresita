import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { clp } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Cliente { id: string; nombre: string }
interface Producto { id: string; nombre: string; marca: string | null; especificacion: string | null; precio_venta: number; controla_stock: boolean }
interface Ubicacion { id: string; tipo: 'bodega' | 'furgon'; nombre: string; responsable_id?: string | null }
interface StockFila { ubicacion_id: string; producto_id: string; cantidad: number }
interface Solicitud { id: string; producto_id: string; tipo: 'porcentaje' | 'monto'; valor: number; estado: string }
interface Linea { producto: Producto; cantidad: number; tipo: 'porcentaje' | 'monto'; valor: string; solicitudId?: string | null }

const LIMITE_CASERO = 10

const numero = (t: string) => parseInt(t.replace(/\D/g, ''), 10) || 0
const detalle = (p: Producto) => [p.marca, p.especificacion].filter(Boolean).join(' · ')

// Precio final por unidad (misma regla que la función registrar_venta de Supabase)
const precioFinal = (l: Linea) => {
  const lista = Number(l.producto.precio_venta)
  const v = numero(l.valor)
  if (v <= 0) return lista
  if (l.tipo === 'porcentaje') return Math.round(lista * (1 - Math.min(v, 100) / 100))
  return Math.max(lista - v, 0)
}
const porcentajeEquivalente = (l: Linea) => {
  const lista = Number(l.producto.precio_venta)
  return lista > 0 ? ((lista - precioFinal(l)) / lista) * 100 : 0
}
const descuentoInvalido = (l: Linea) =>
  (l.tipo === 'porcentaje' && numero(l.valor) > 100) || (l.tipo === 'monto' && numero(l.valor) > Number(l.producto.precio_venta))

const RegistrarVenta = () => {
  const router = useRouter()
  const { clienteId } = useLocalSearchParams<{ clienteId?: string }>() // viene de la ficha del cliente
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [soyGerente, setSoyGerente] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [sinFurgon, setSinFurgon] = useState(false) // casero sin furgón asignado: no puede vender
  const [stock, setStock] = useState<StockFila[]>([])
  const [aprobadas, setAprobadas] = useState<Solicitud[]>([])

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [ubicacionId, setUbicacionId] = useState<string | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [modo, setModo] = useState<'contado' | 'credito'>('contado')
  const [metodo, setMetodo] = useState<'efectivo' | 'transferencia'>('efectivo')
  const [pie, setPie] = useState('')
  const [nota, setNota] = useState('')

  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)

  const stockDe = (productoId: string) =>
    stock.find((s) => s.ubicacion_id === ubicacionId && s.producto_id === productoId)?.cantidad ?? 0

  // Si todavía no existe responsable_id (script asignar_furgon.sql), carga sin esa columna
  const traerUbicaciones = async () => {
    const base = () => supabase.from('ubicaciones_inventario')
    const con = await base().select('id, tipo, nombre, responsable_id').eq('activo', true).order('nombre', { ascending: true })
    if (!con.error) return con
    return await base().select('id, tipo, nombre').eq('activo', true).order('nombre', { ascending: true })
  }

  const cargar = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    let gerente = false
    if (user) {
      setUserId(user.id)
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      gerente = esGerente(perfil?.rol)
      setSoyGerente(gerente)
    }
    const [cs, ps, us, st, sol] = await Promise.all([
      supabase.from('clientes').select('id, nombre').order('nombre', { ascending: true }),
      supabase.from('productos').select('id, nombre, marca, especificacion, precio_venta, controla_stock').eq('activo', true).order('nombre', { ascending: true }),
      traerUbicaciones(),
      supabase.from('inventario_stock').select('ubicacion_id, producto_id, cantidad'),
      user
        ? supabase.from('solicitudes_descuento').select('id, producto_id, tipo, valor, estado').eq('solicitante_id', user.id).eq('estado', 'aprobada')
        : Promise.resolve({ data: [], error: null } as any),
    ])
    const error = cs.error || ps.error || us.error || st.error
    setErrorCarga(error ? error.message : null)
    const listaClientes = (cs.data as Cliente[]) || []
    setClientes(listaClientes)
    if (clienteId) {
      const elegido = listaClientes.find((c) => c.id === clienteId)
      if (elegido) setCliente((actual) => actual ?? elegido)
    }
    setProductos((ps.data as Producto[]) || [])
    const ubic = (us.data as Ubicacion[]) || []
    // Quien tiene un furgón asignado solo puede vender lo que lleva ese furgón
    const propia = user ? ubic.find((u) => u.tipo === 'furgon' && u.responsable_id === user.id) : undefined
    // Un casero sin furgón asignado no puede vender (ni de bodega ni de otros furgones)
    setSinFurgon(!gerente && !propia)
    setUbicaciones(propia ? [propia] : gerente ? ubic : [])
    setStock((st.data as StockFila[]) || [])
    setAprobadas((sol.data as Solicitud[]) || [])
    // Por defecto: el furgón asignado al usuario; si no tiene, la bodega (gerente) o el primer furgón
    const propio = user ? ubic.find((u) => u.tipo === 'furgon' && u.responsable_id === user.id)?.id : undefined
    setUbicacionId((actual) => actual ?? propio ?? (gerente ? (ubic.find((u) => u.tipo === 'bodega')?.id ?? ubic[0]?.id) : undefined) ?? null)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  // ---------- Carrito ----------
  const elegirUbicacion = (id: string) => {
    if (id === ubicacionId) return
    setUbicacionId(id)
    setLineas([]) // el stock depende del origen
  }

  const agregarProducto = (p: Producto) => {
    setModalProducto(false)
    setLineas((ls) => {
      const existe = ls.find((l) => l.producto.id === p.id)
      if (existe) {
        return ls.map((l) => (l.producto.id === p.id ? { ...l, cantidad: Math.min(l.cantidad + 1, p.controla_stock ? stockDe(p.id) : 9999) } : l))
      }
      return [...ls, { producto: p, cantidad: 1, tipo: 'porcentaje', valor: '' }]
    })
  }

  const cambiar = (id: string, cambios: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.producto.id === id ? { ...l, ...cambios } : l)))

  const cambiarCantidad = (l: Linea, delta: number) => {
    const max = l.producto.controla_stock ? stockDe(l.producto.id) : 9999
    const nueva = Math.min(Math.max(l.cantidad + delta, 1), max)
    cambiar(l.producto.id, { cantidad: nueva })
  }

  const quitar = (id: string) => setLineas((ls) => ls.filter((l) => l.producto.id !== id))

  // Solicitud aprobada que cubre el descuento de esta línea (solo importa para caseros)
  const solicitudQueCubre = (l: Linea) => {
    const pct = porcentajeEquivalente(l)
    const lista = Number(l.producto.precio_venta)
    return aprobadas.find((s) => {
      if (s.producto_id !== l.producto.id) return false
      const pctSol = s.tipo === 'porcentaje' ? Number(s.valor) : lista > 0 ? (Number(s.valor) / lista) * 100 : 0
      return pctSol >= pct - 0.0001
    })
  }
  const requiereAprobacion = (l: Linea) => !soyGerente && porcentajeEquivalente(l) > LIMITE_CASERO + 0.0001
  const bloqueada = (l: Linea) => descuentoInvalido(l) || (requiereAprobacion(l) && !solicitudQueCubre(l))

  const solicitarDescuento = async (l: Linea) => {
    if (!userId) return
    const valor = numero(l.valor)
    if (valor <= 0) return
    const { error } = await supabase.from('solicitudes_descuento').insert([{
      solicitante_id: userId,
      producto_id: l.producto.id,
      cliente_id: cliente?.id ?? null,
      tipo: l.tipo,
      valor,
    }])
    if (error) Alert.alert('Error', error.message)
    else Alert.alert('Solicitud enviada', 'El gerente verá tu solicitud. Cuando la apruebe, vuelve a esta pantalla para usarla.')
  }

  // ---------- Totales ----------
  const subtotalLista = lineas.reduce((n, l) => n + Number(l.producto.precio_venta) * l.cantidad, 0)
  const total = lineas.reduce((n, l) => n + precioFinal(l) * l.cantidad, 0)
  const descuentos = subtotalLista - total
  const pieNum = numero(pie)
  const pagadoAhora = modo === 'contado' ? total : Math.min(pieNum, total)
  const saldo = total - pagadoAhora

  const guardarVenta = async () => {
    if (!cliente) { Alert.alert('Error', 'Selecciona un cliente'); return }
    if (!ubicacionId) { Alert.alert('Error', 'Selecciona desde dónde se vende'); return }
    if (lineas.length === 0) { Alert.alert('Error', 'Agrega al menos un producto'); return }
    const mala = lineas.find(bloqueada)
    if (mala) {
      Alert.alert('Descuento no permitido', descuentoInvalido(mala)
        ? `El descuento de ${mala.producto.nombre} es inválido.`
        : `El descuento de ${mala.producto.nombre} supera el ${LIMITE_CASERO}%. Solicítalo al gerente.`)
      return
    }
    if (total <= 0) { Alert.alert('Error', 'El total debe ser mayor a 0'); return }
    if (modo === 'credito' && pieNum > total) { Alert.alert('Error', 'El pie no puede ser mayor al total'); return }

    const items = lineas.map((l) => {
      const v = numero(l.valor)
      const sol = requiereAprobacion(l) ? solicitudQueCubre(l) : null
      return {
        producto_id: l.producto.id,
        cantidad: l.cantidad,
        descuento_tipo: v > 0 ? l.tipo : 'ninguno',
        descuento_valor: v,
        solicitud_id: sol?.id ?? null,
      }
    })

    setGuardando(true)
    const { error } = await supabase.rpc('registrar_venta', {
      p_cliente: cliente.id,
      p_ubicacion: ubicacionId,
      p_items: items,
      p_contado: modo === 'contado',
      p_pie: modo === 'credito' ? pieNum : 0,
      p_metodo: metodo,
      p_nota: nota.trim() || null,
    })
    setGuardando(false)
    if (error) { Alert.alert('Error al registrar la venta', error.message); return }
    Alert.alert('Éxito', 'Venta registrada correctamente')
    router.back()
  }

  const disponibles = productos.filter((p) => !p.controla_stock || stockDe(p.id) > 0)

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Registrar Venta" />

      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : errorCarga ? (
        <View style={styles.aviso}>
          <Ionicons name="warning-outline" size={22} color={Palette.amber} />
          <Text style={styles.avisoText}>No se pudo cargar: {errorCarga}</Text>
        </View>
      ) : sinFurgon ? (
        <View style={styles.aviso}>
          <Ionicons name="lock-closed-outline" size={22} color={Palette.amber} />
          <Text style={styles.avisoText}>Todavía no tienes un furgón asignado, así que no puedes registrar ventas. Pídele al gerente que te asigne uno.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Cliente</Text>
          <Pressable style={styles.selector} onPress={() => setModalCliente(true)}>
            <Text style={[styles.selectorText, !cliente && { color: Palette.textFaint }]}>{cliente ? cliente.nombre : 'Seleccionar cliente...'}</Text>
            <Ionicons name="chevron-down" size={20} color={Palette.textMuted} />
          </Pressable>

          <Text style={styles.label}>Se vende desde</Text>
          <View style={styles.chips}>
            {ubicaciones.map((u) => (
              <Pressable key={u.id} style={[styles.chip, ubicacionId === u.id && styles.chipActivo]} onPress={() => elegirUbicacion(u.id)}>
                <Text style={[styles.chipText, ubicacionId === u.id && styles.chipTextActivo]}>{u.nombre}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.seccionHeader}>
            <Text style={styles.seccion}>Productos</Text>
            <Pressable style={styles.botonChico} onPress={() => setModalProducto(true)}>
              <Ionicons name="add" size={16} color={Palette.onNavy} />
              <Text style={styles.botonChicoText}>Agregar</Text>
            </Pressable>
          </View>
          {lineas.length === 0 && <Text style={styles.vacio}>Aún no agregas productos.</Text>}

          {lineas.map((l) => {
            const final = precioFinal(l)
            const pct = porcentajeEquivalente(l)
            const necesita = requiereAprobacion(l)
            const cubierta = necesita ? solicitudQueCubre(l) : null
            return (
              <View key={l.producto.id} style={styles.linea}>
                <View style={styles.lineaTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineaNombre}>{l.producto.nombre}</Text>
                    {!!detalle(l.producto) && <Text style={styles.sub}>{detalle(l.producto)}</Text>}
                    <Text style={styles.sub}>Precio: {clp(Number(l.producto.precio_venta))}</Text>
                  </View>
                  <Pressable onPress={() => quitar(l.producto.id)} hitSlop={8}>
                    <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
                  </Pressable>
                </View>

                <View style={styles.lineaFila}>
                  <Text style={styles.labelChico}>Cantidad</Text>
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} onPress={() => cambiarCantidad(l, -1)}><Ionicons name="remove" size={18} color={Palette.navy} /></Pressable>
                    <Text style={styles.stepNum}>{l.cantidad}</Text>
                    <Pressable style={styles.stepBtn} onPress={() => cambiarCantidad(l, 1)}><Ionicons name="add" size={18} color={Palette.navy} /></Pressable>
                  </View>
                </View>

                <View style={styles.lineaFila}>
                  <Text style={styles.labelChico}>Descuento</Text>
                  <View style={styles.descuentoBox}>
                    <View style={styles.toggle}>
                      <Pressable style={[styles.toggleOp, l.tipo === 'monto' && styles.toggleActivo]} onPress={() => cambiar(l.producto.id, { tipo: 'monto' })}>
                        <Text style={[styles.toggleText, l.tipo === 'monto' && styles.toggleTextActivo]}>$</Text>
                      </Pressable>
                      <Pressable style={[styles.toggleOp, l.tipo === 'porcentaje' && styles.toggleActivo]} onPress={() => cambiar(l.producto.id, { tipo: 'porcentaje' })}>
                        <Text style={[styles.toggleText, l.tipo === 'porcentaje' && styles.toggleTextActivo]}>%</Text>
                      </Pressable>
                    </View>
                    <TextInput style={styles.inputChico} value={l.valor} keyboardType="numeric"
                      onChangeText={(t) => cambiar(l.producto.id, { valor: t.replace(/\D/g, '') })}
                      placeholder="0" placeholderTextColor={Palette.textFaint} />
                  </View>
                </View>

                {descuentoInvalido(l) && <Text style={styles.error}>El descuento no puede superar el precio.</Text>}
                {necesita && !cubierta && !descuentoInvalido(l) && (
                  <View style={styles.alertaBox}>
                    <Text style={styles.alertaText}>Supera el {LIMITE_CASERO}% ({pct.toFixed(1)}%). Necesita aprobación del gerente.</Text>
                    <Pressable style={styles.botonChico} onPress={() => solicitarDescuento(l)}>
                      <Text style={styles.botonChicoText}>Solicitar</Text>
                    </Pressable>
                  </View>
                )}
                {necesita && !!cubierta && <Text style={styles.okTexto}>Descuento aprobado por el gerente.</Text>}

                <View style={styles.lineaFila}>
                  <Text style={styles.sub}>{clp(final)} c/u</Text>
                  <Text style={styles.subtotal}>{clp(final * l.cantidad)}</Text>
                </View>
              </View>
            )
          })}

          {lineas.length > 0 && (
            <View style={styles.totales}>
              <Fila etiqueta="Subtotal" valor={clp(subtotalLista)} />
              {descuentos > 0 && <Fila etiqueta="Descuentos" valor={`- ${clp(descuentos)}`} />}
              <Fila etiqueta="Total" valor={clp(total)} fuerte />
            </View>
          )}

          <Text style={styles.label}>Forma de pago</Text>
          <View style={styles.toggleGrande}>
            <Pressable style={[styles.toggleGOp, modo === 'contado' && styles.toggleGActivo]} onPress={() => setModo('contado')}>
              <Text style={[styles.toggleGText, modo === 'contado' && styles.toggleGTextActivo]}>Al contado</Text>
            </Pressable>
            <Pressable style={[styles.toggleGOp, modo === 'credito' && styles.toggleGActivo]} onPress={() => setModo('credito')}>
              <Text style={[styles.toggleGText, modo === 'credito' && styles.toggleGTextActivo]}>A crédito</Text>
            </Pressable>
          </View>

          {modo === 'credito' && (
            <>
              <Text style={styles.label}>Pie inicial (opcional)</Text>
              <View style={styles.inputBox}>
                <Text style={styles.currency}>$</Text>
                <TextInput style={styles.input} value={pie} onChangeText={(t) => setPie(t.replace(/\D/g, ''))} keyboardType="numeric"
                  placeholder="0" placeholderTextColor={Palette.textFaint} />
              </View>
            </>
          )}

          {(modo === 'contado' || pieNum > 0) && (
            <>
              <Text style={styles.label}>{modo === 'contado' ? 'Medio de pago' : 'Medio de pago del pie'}</Text>
              <View style={styles.chips}>
                {(['efectivo', 'transferencia'] as const).map((m) => (
                  <Pressable key={m} style={[styles.chip, metodo === m && styles.chipActivo]} onPress={() => setMetodo(m)}>
                    <Text style={[styles.chipText, metodo === m && styles.chipTextActivo]}>{m === 'efectivo' ? 'Efectivo' : 'Transferencia'}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Nota (opcional)</Text>
          <TextInput style={styles.inputLibre} value={nota} onChangeText={setNota} placeholder="Ej. entrega el viernes" placeholderTextColor={Palette.textFaint} />

          {lineas.length > 0 && (
            <View style={styles.totales}>
              <Fila etiqueta="Paga ahora" valor={clp(pagadoAhora)} />
              <Fila etiqueta="Saldo pendiente" valor={clp(saldo)} fuerte />
            </View>
          )}

          <Pressable style={[styles.boton, guardando && { opacity: 0.6 }]} onPress={guardarVenta} disabled={guardando}>
            <Text style={styles.botonText}>{guardando ? 'Guardando...' : 'Registrar venta'}</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* Modal: cliente */}
      <Modal visible={modalCliente} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalCliente(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Seleccionar Cliente</Text>
            <Pressable onPress={() => setModalCliente(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <FlatList
            data={clientes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={styles.vacio}>No hay clientes registrados.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.opcion} onPress={() => { setCliente(item); setModalCliente(false) }}>
                <Text style={styles.opcionTexto}>{item.nombre}</Text>
                <Ionicons name="chevron-forward" size={20} color={Palette.textFaint} />
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>

      {/* Modal: producto */}
      <Modal visible={modalProducto} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalProducto(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Agregar producto</Text>
            <Pressable onPress={() => setModalProducto(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <FlatList
            data={disponibles}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={styles.vacio}>No hay productos con stock en este origen.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.opcion} onPress={() => agregarProducto(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.opcionTexto}>{item.nombre}</Text>
                  <Text style={styles.sub}>{[detalle(item), clp(Number(item.precio_venta)), item.controla_stock ? `Stock: ${stockDe(item.id)}` : 'Servicio'].filter(Boolean).join(' · ')}</Text>
                </View>
                <Ionicons name="add-circle-outline" size={22} color={Palette.navy} />
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const Fila = ({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) => (
  <View style={styles.totalFila}>
    <Text style={[styles.totalEtiqueta, fuerte && styles.totalFuerte]}>{etiqueta}</Text>
    <Text style={[styles.totalValor, fuerte && styles.totalFuerte]}>{valor}</Text>
  </View>
)

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  form: { padding: 20, paddingBottom: 40 },
  aviso: { margin: 20, padding: 16, borderRadius: 14, backgroundColor: Palette.amberSoft, flexDirection: 'row', gap: 10 },
  avisoText: { flex: 1, color: Palette.amber, fontSize: 14, lineHeight: 20 },
  label: { fontSize: 14, color: Palette.text, marginBottom: 6, marginTop: 14, fontWeight: '600' },
  labelChico: { fontSize: 13, color: Palette.textMuted },
  selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 52 },
  selectorText: { fontSize: 16, color: Palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Palette.grayPill, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  chipActivo: { backgroundColor: Palette.navy },
  chipText: { fontSize: 13, color: Palette.text, fontWeight: '600' },
  chipTextActivo: { color: Palette.onNavy },
  seccionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 6 },
  seccion: { fontSize: 13, fontWeight: '700', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  vacio: { color: Palette.textMuted, fontSize: 14, textAlign: 'center', marginTop: 8 },
  botonChico: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonChicoText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  linea: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10, marginTop: 8 },
  lineaTop: { flexDirection: 'row', gap: 10 },
  lineaNombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
  lineaFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sub: { fontSize: 13, color: Palette.textMuted },
  subtotal: { fontSize: 16, fontWeight: '800', color: Palette.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 16, fontWeight: '800', color: Palette.text, minWidth: 24, textAlign: 'center' },
  descuentoBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggle: { flexDirection: 'row', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: Palette.border },
  toggleOp: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Palette.card },
  toggleActivo: { backgroundColor: Palette.navy },
  toggleText: { fontWeight: '800', color: Palette.text },
  toggleTextActivo: { color: Palette.onNavy },
  inputChico: { width: 80, height: 38, backgroundColor: Palette.inputFill, borderRadius: 10, textAlign: 'center', fontSize: 15, color: Palette.text },
  error: { color: Palette.orange, fontSize: 13, fontWeight: '600' },
  alertaBox: { backgroundColor: Palette.amberSoft, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertaText: { flex: 1, color: Palette.amber, fontSize: 12, fontWeight: '600' },
  okTexto: { color: Palette.green, fontSize: 13, fontWeight: '700' },
  totales: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, marginTop: 14, gap: 6 },
  totalFila: { flexDirection: 'row', justifyContent: 'space-between' },
  totalEtiqueta: { fontSize: 14, color: Palette.textMuted },
  totalValor: { fontSize: 14, color: Palette.text, fontWeight: '700' },
  totalFuerte: { fontSize: 17, fontWeight: '800', color: Palette.text },
  toggleGrande: { flexDirection: 'row', backgroundColor: Palette.grayPill, borderRadius: 12, padding: 4 },
  toggleGOp: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 9 },
  toggleGActivo: { backgroundColor: Palette.navy },
  toggleGText: { fontWeight: '700', color: Palette.textMuted },
  toggleGTextActivo: { color: Palette.onNavy },
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 52 },
  currency: { fontSize: 18, color: Palette.textMuted, marginRight: 8 },
  input: { flex: 1, fontSize: 18, color: Palette.text },
  inputLibre: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 16, color: Palette.text },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  opcion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Palette.border },
  opcionTexto: { fontSize: 16, color: Palette.text, fontWeight: '600' },
})

export default RegistrarVenta
