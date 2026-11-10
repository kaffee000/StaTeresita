import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { clp, fechaCorta } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Cliente { id: string; nombre: string; rut: string | null; telefono: string | null; direccion: string | null }
interface Pago { id: string; monto_abonado: number; metodo_pago: string | null; fecha_pago: string | null; creado_en: string | null; cobrador_id: string | null }
interface Venta {
  id: string
  monto_total: number
  saldo_pendiente: number
  estado_pago: string | null
  descripcion: string | null
  fecha_venta: string | null
  pagos: Pago[]
}
interface Linea { venta_pedido_id: string; cantidad: number; productos: { nombre: string } | null }

const fechaPago = (p: Pago) => p.fecha_pago ?? p.creado_en

// Columnas de la tarjeta (como la de papel, más producto y forma de pago)
const COLUMNAS: { t: string; f: number; num?: boolean }[] = [
  { t: 'Fecha', f: 1 },
  { t: 'Abono', f: 1.2, num: true },
  { t: 'Saldo', f: 1.2, num: true },
  { t: 'Pago', f: 1 },
]

// Historial completo de un cliente: qué compró, y los abonos (cuotas) de cada compra.
// Lee clientes, ventas_pedidos (con pagos), venta_items y perfiles (nombre de quien cobró).
// Registra pagos en pagos y ventas_pedidos, igual que la pantalla Registrar pago.
const miles = (t: string) => t.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const HistorialCliente = () => {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [lineas, setLineas] = useState<Linea[]>([])
  const [cobradores, setCobradores] = useState<Record<string, string>>({})

  // Registrar pago desde esta pantalla
  const [modalPago, setModalPago] = useState(false)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<'efectivo' | 'transferencia'>('efectivo')
  const [guardando, setGuardando] = useState(false)
  const [destino, setDestino] = useState<Venta | null>(null) // null = a la compra más antigua (FIFO)

  const cargar = useCallback(async () => {
    {
      const [c, v] = await Promise.all([
        supabase.from('clientes').select('id, nombre, rut, telefono, direccion').eq('id', id).single(),
        supabase.from('ventas_pedidos')
          .select('id, monto_total, saldo_pendiente, estado_pago, descripcion, fecha_venta, pagos ( id, monto_abonado, metodo_pago, fecha_pago, creado_en, cobrador_id )')
          .eq('cliente_id', id)
          .order('fecha_venta', { ascending: false }),
      ])
      setError(c.error?.message ?? v.error?.message ?? null)
      setCliente((c.data as Cliente) ?? null)
      const lista = ((v.data as any[]) || []) as Venta[]
      setVentas(lista)
      // Productos de cada compra (si la tabla aún no existe, simplemente no se muestran)
      if (lista.length > 0) {
        const li = await supabase.from('venta_items').select('venta_pedido_id, cantidad, productos ( nombre )').in('venta_pedido_id', lista.map((x) => x.id))
        if (!li.error) setLineas((li.data as any[]) || [])
      }
      // Nombre de quien cobró cada pago
      const ids = Array.from(new Set(lista.flatMap((x) => (x.pagos || []).map((p) => p.cobrador_id)).filter(Boolean))) as string[]
      if (ids.length > 0) {
        const pe = await supabase.from('perfiles').select('id, nombre').in('id', ids)
        if (!pe.error) setCobradores(Object.fromEntries(((pe.data as any[]) || []).map((x) => [x.id, x.nombre])))
      }
      setCargando(false)
    }
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  const vigentes = ventas.filter((v) => v.estado_pago !== 'anulada')
  const totalComprado = vigentes.reduce((n, v) => n + Number(v.monto_total), 0)
  const deuda = vigentes.reduce((n, v) => n + Number(v.saldo_pendiente), 0)
  const abonado = Math.max(totalComprado - deuda, 0)

  // El abono se aplica primero a la compra más antigua que aún tenga saldo (FIFO)
  const fifo = vigentes.filter((v) => Number(v.saldo_pendiente) > 0)
    .sort((a, b) => String(a.fecha_venta ?? '').localeCompare(String(b.fecha_venta ?? '')))
  // Si se abona a una compra concreta, solo se usa esa; si no, van por orden de antigüedad
  const pendientes = destino ? fifo.filter((v) => v.id === destino.id) : fifo
  const maximo = pendientes.reduce((n, v) => n + Number(v.saldo_pendiente), 0)

  const abrirPago = (v?: Venta) => { setDestino(v ?? null); setMonto(''); setMetodo('efectivo'); setModalPago(true) }

  const guardarPago = async () => {
    const abono = parseInt(monto.replace(/\D/g, ''), 10) || 0
    if (abono <= 0) { Alert.alert('Error', 'Ingresa un monto mayor a 0'); return }
    if (abono > maximo) { Alert.alert('Error', `El abono no puede superar la deuda (${clp(maximo)})`); return }
    setGuardando(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No hay sesión activa')
      let resto = abono
      for (const v of pendientes) {
        if (resto <= 0) break
        const saldo = Number(v.saldo_pendiente)
        const parte = Math.min(resto, saldo)
        const { error: e1 } = await supabase.from('pagos').insert([{
          venta_pedido_id: v.id, cobrador_id: user.id, monto_abonado: parte, metodo_pago: metodo,
        }])
        if (e1) throw e1
        const nuevo = saldo - parte
        const { error: e2 } = await supabase.from('ventas_pedidos')
          .update({ saldo_pendiente: nuevo, estado_pago: nuevo <= 0 ? 'pagada' : 'pendiente' }).eq('id', v.id)
        if (e2) throw e2
        resto -= parte
      }
      setModalPago(false)
      Alert.alert('Éxito', 'Pago registrado')
    } catch (e: any) {
      Alert.alert('Error al procesar pago', e.message)
    } finally {
      setGuardando(false)
      cargar()
    }
  }

  // Todo lo que se muestra de una compra (producto, colores, progreso y abonos)
  const datosDe = (v: Venta) => {
    const total = Number(v.monto_total)
    const anulada = v.estado_pago === 'anulada'
    const pagada = Number(v.saldo_pendiente) <= 0
    const color = anulada ? Palette.textMuted : pagada ? Palette.green : Palette.amber
    const fondo = anulada ? Palette.grayPill : pagada ? Palette.greenSoft : Palette.amberSoft
    const items = lineas.filter((l) => l.venta_pedido_id === v.id)
    const nombre = items.length > 0 ? items.map((l) => `${l.cantidad} × ${l.productos?.nombre ?? 'Producto'}`).join(', ') : v.descripcion || 'Compra'
    const pagos = (v.pagos || []).slice().sort((a, b) => String(fechaPago(a) ?? '').localeCompare(String(fechaPago(b) ?? '')))
    let acumulado = 0
    const filas = pagos.map((p) => {
      acumulado += Number(p.monto_abonado)
      return { fecha: fechaCorta(fechaPago(p)) || '', abono: clp(Number(p.monto_abonado)), saldo: clp(Math.max(total - acumulado, 0)), metodo: p.metodo_pago, quien: p.cobrador_id ? (cobradores[p.cobrador_id] ?? '').split(' ')[0] : '' }
    }).reverse()
    const pagado = Math.max(total - Number(v.saldo_pendiente), 0)
    const pct = total > 0 ? Math.min(pagado / total, 1) : 0
    return { total, anulada, pagada, color, fondo, nombre, filas, pagado, pct }
  }
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})

  const estadoDe = (v: Venta) => {
    if (v.estado_pago === 'anulada') return { texto: 'Anulada', fondo: Palette.grayPill, color: Palette.textMuted }
    const saldo = Number(v.saldo_pendiente)
    if (saldo <= 0) return { texto: 'Pagada', fondo: Palette.greenSoft, color: Palette.green }
    if (saldo < Number(v.monto_total)) return { texto: 'Parcial', fondo: Palette.amberSoft, color: Palette.amber }
    return { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title={cliente?.nombre ?? 'Cliente'} />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : error || !cliente ? (
        <Text style={styles.vacio}>No se pudo cargar el cliente{error ? `: ${error}` : '.'}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Dato icono="id-card-outline" texto={cliente.rut || 'Sin RUT'} />
            <Dato icono="call-outline" texto={cliente.telefono || 'Sin teléfono'} />
            <Dato icono="location-outline" texto={cliente.direccion || 'Sin dirección'} />
          </View>

          <View style={styles.resumenFila}>
            <View style={styles.resumenCaja}>
              <Text style={styles.resumenLabel}>Total comprado</Text>
              <Text style={styles.resumenValor}>{clp(totalComprado)}</Text>
            </View>
            <View style={styles.resumenCaja}>
              <Text style={styles.resumenLabel}>Pagado</Text>
              <Text style={[styles.resumenValor, { color: Palette.green }]}>{clp(abonado)}</Text>
            </View>
            <View style={styles.resumenCaja}>
              <Text style={styles.resumenLabel}>Debe</Text>
              <Text style={[styles.resumenValor, { color: deuda > 0 ? Palette.orange : Palette.green }]}>{clp(deuda)}</Text>
            </View>
          </View>

          <View style={styles.accionesFila}>
            <Pressable
              style={({ pressed }) => [styles.accion, { backgroundColor: Palette.navy }, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({ pathname: '/registrar-venta', params: { clienteId: id } } as any)}
            >
              <Ionicons name="cart-outline" size={20} color={Palette.onNavy} />
              <Text style={styles.accionText}>Agregar venta</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.accion, deuda > 0 ? { backgroundColor: Palette.orange } : styles.accionOff, pressed && deuda > 0 && { opacity: 0.85 }]}
              disabled={deuda <= 0}
              onPress={() => abrirPago()}
            >
              <Ionicons name="cash-outline" size={20} color={deuda > 0 ? Palette.onNavy : Palette.textFaint} />
              <Text style={[styles.accionText, deuda <= 0 && { color: Palette.textFaint }]}>{deuda > 0 ? 'Agregar pago' : 'Sin deuda'}</Text>
            </Pressable>
          </View>

          <Text style={styles.seccion}>Compras ({ventas.length})</Text>
          {ventas.length === 0 && <Text style={styles.vacio}>Este cliente aún no tiene compras.</Text>}

          {ventas.map((v) => {
            const d = datosDe(v)
            const abierta = !!abiertas[v.id]
            return (
              <View key={v.id} style={[styles.itemCard, { borderLeftColor: d.color }]}>
                <Pressable style={styles.item} onPress={() => setAbiertas((a) => ({ ...a, [v.id]: !a[v.id] }))}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={styles.itemNombre} numberOfLines={abierta ? undefined : 2}>{d.nombre}</Text>
                    <View style={styles.barra}>
                      <View style={[styles.barraRelleno, { width: `${d.pct * 100}%`, backgroundColor: d.color }]} />
                    </View>
                    <Text style={styles.sub}>{fechaCorta(v.fecha_venta) || '—'} · {clp(d.total)}</Text>
                  </View>
                  <View style={[styles.estadoPill, { backgroundColor: d.fondo }]}>
                    <Text style={[styles.estadoPillText, { color: d.color }]}>
                      {d.anulada ? 'Anulada' : d.pagada ? 'Pagado ✓' : `Debe ${clp(Number(v.saldo_pendiente))}`}
                    </Text>
                  </View>
                  <Ionicons name={abierta ? 'chevron-up' : 'chevron-down'} size={20} color={Palette.navy} />
                </Pressable>

                {abierta && (
                  <View style={[styles.desplegado, { backgroundColor: d.fondo }]}>
                    <Text style={styles.bannerSub}>Pagado {clp(d.pagado)} de {clp(d.total)} · {Math.round(d.pct * 100)}%</Text>

                    {!d.anulada && !d.pagada && (
                      <Pressable style={styles.botonAbonar} onPress={() => abrirPago(v)}>
                        <Ionicons name="add-circle-outline" size={16} color={Palette.onNavy} />
                        <Text style={styles.botonAbonarText}>Abonar a esta compra</Text>
                      </Pressable>
                    )}

                    <View style={styles.matriz}>
                      <View style={[styles.fila, styles.filaHead]}>
                        {COLUMNAS.map((c, k) => (
                          <Text key={c.t} style={[styles.celda, styles.celdaHead, { flex: c.f }, c.num && styles.celdaNum, k === COLUMNAS.length - 1 && styles.celdaUltima]}>{c.t}</Text>
                        ))}
                      </View>
                      {d.filas.length === 0 && <Text style={[styles.celda, { textAlign: 'center' }]}>Todavía no hay abonos.</Text>}
                      {d.filas.map((f, n) => (
                        <View key={n} style={[styles.fila, styles.filaInterna]}>
                          <Text style={[styles.celda, { flex: COLUMNAS[0].f }]}>{f.fecha}</Text>
                          <Text style={[styles.celda, styles.celdaNum, { flex: COLUMNAS[1].f }]}>{f.abono}</Text>
                          <Text style={[styles.celda, styles.celdaNum, styles.celdaSaldo, { flex: COLUMNAS[2].f }]}>{f.saldo}</Text>
                          <View style={[styles.celda, styles.celdaUltima, { flex: COLUMNAS[3].f, alignItems: 'center' }]}>
                            {f.metodo ? <Ionicons name={f.metodo === 'transferencia' ? 'swap-horizontal' : 'cash-outline'} size={18} color={Palette.navy} /> : null}
                            {!!f.quien && <Text style={styles.quien} numberOfLines={1}>{f.quien}</Text>}
                          </View>
                        </View>
                      ))}
                    </View>
                    <View style={styles.leyenda}>
                      <Ionicons name="cash-outline" size={14} color={Palette.textMuted} /><Text style={styles.leyendaText}>Efectivo</Text>
                      <Ionicons name="swap-horizontal" size={14} color={Palette.textMuted} /><Text style={styles.leyendaText}>Transferencia</Text>
                    </View>
                  </View>
                )}
              </View>
            )
          })}
        </ScrollView>
      )}

      <Modal visible={modalPago} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalPago(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Registrar pago</Text>
            <Pressable onPress={() => setModalPago(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.pagoCliente}>{cliente?.nombre}</Text>
            {destino ? (
              <>
                <Text style={styles.sub} numberOfLines={2}>
                  Compra: <Text style={styles.negrita}>{lineas.filter((l) => l.venta_pedido_id === destino.id).map((l) => `${l.cantidad} × ${l.productos?.nombre ?? 'Producto'}`).join(', ') || destino.descripcion || 'Compra'}</Text>
                </Text>
                <Text style={styles.sub}>Debe en esta compra: <Text style={styles.negrita}>{clp(maximo)}</Text></Text>
              </>
            ) : (
              <Text style={styles.sub}>Debe en total: <Text style={styles.negrita}>{clp(deuda)}</Text></Text>
            )}

            <Text style={styles.label}>Monto a abonar</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.moneda}>$</Text>
              <TextInput style={styles.inputMonto} value={monto} onChangeText={(t) => setMonto(miles(t))} keyboardType="numeric"
                placeholder="0" placeholderTextColor={Palette.textFaint} />
            </View>

            <Text style={styles.label}>Forma de pago</Text>
            <View style={styles.metodos}>
              {([['efectivo', 'Efectivo', 'cash-outline'], ['transferencia', 'Transferencia', 'swap-horizontal']] as const).map(([k, t, ic]) => (
                <Pressable key={k} style={[styles.metodo, metodo === k && styles.metodoActivo]} onPress={() => setMetodo(k)}>
                  <Ionicons name={ic} size={18} color={metodo === k ? Palette.onNavy : Palette.navy} />
                  <Text style={[styles.metodoText, metodo === k && { color: Palette.onNavy }]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.nota}>
              {destino ? 'El abono se aplica solo a esta compra.' : 'El abono se descuenta primero de la compra más antigua que todavía tenga saldo.'}
            </Text>

            <Pressable style={[styles.botonGuardar, guardando && { opacity: 0.6 }]} onPress={guardarPago} disabled={guardando}>
              <Text style={styles.botonPagarText}>{guardando ? 'Guardando...' : 'Guardar pago'}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const Dato = ({ icono, texto }: { icono: keyof typeof Ionicons.glyphMap; texto: string }) => (
  <View style={styles.dato}>
    <Ionicons name={icono} size={18} color={Palette.navy} />
    <Text style={styles.datoText}>{texto}</Text>
  </View>
)

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  datoText: { fontSize: 14, color: Palette.text, flex: 1 },
  resumenFila: { flexDirection: 'row', gap: 8 },
  resumenCaja: { flex: 1, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  resumenLabel: { fontSize: 11, fontWeight: '600', color: Palette.textMuted, marginBottom: 4 },
  resumenValor: { fontSize: 16, fontWeight: '800', color: Palette.text },
  seccion: { fontSize: 13, fontWeight: '700', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  accionesFila: { flexDirection: 'row', gap: 10 },
  accion: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
  accionOff: { backgroundColor: Palette.grayPill },
  accionText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
  botonAbonar: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.orange, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  botonAbonarText: { color: Palette.onNavy, fontSize: 13, fontWeight: '800' },
  itemCard: { backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, borderLeftWidth: 5, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  desplegado: { padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: Palette.border },
  itemNombre: { fontSize: 15, fontWeight: '800', color: Palette.text },
  estadoPill: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  estadoPillText: { fontSize: 12, fontWeight: '800' },
  detalleTop: { borderRadius: 16, borderWidth: 2, padding: 14, gap: 8 },
  detalleSaldo: { fontSize: 20, fontWeight: '800' },
  banner: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8, gap: 6 },
  bannerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  bannerProducto: { flex: 1, fontSize: 15, fontWeight: '800' },
  bannerEstado: { fontSize: 13, fontWeight: '800' },
  barra: { height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  barraRelleno: { height: 8, borderRadius: 4 },
  bannerSub: { fontSize: 12, color: Palette.textMuted },
  quien: { fontSize: 10, color: Palette.textMuted, marginTop: 1, maxWidth: 60 },
  botonPagar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Palette.orange, borderRadius: 14, paddingVertical: 14 },
  botonGuardar: { backgroundColor: Palette.navy, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  botonPagarText: { color: Palette.onNavy, fontSize: 16, fontWeight: '800' },
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  pagoCliente: { fontSize: 20, fontWeight: '800', color: Palette.text, marginBottom: 2 },
  label: { fontSize: 14, fontWeight: '600', color: Palette.text, marginBottom: 6, marginTop: 18 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 56 },
  moneda: { fontSize: 20, fontWeight: '700', color: Palette.textMuted, marginRight: 6 },
  inputMonto: { flex: 1, fontSize: 22, fontWeight: '800', color: Palette.text },
  metodos: { flexDirection: 'row', gap: 10 },
  metodo: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Palette.navySoft, borderRadius: 12, paddingVertical: 14 },
  metodoActivo: { backgroundColor: Palette.navy },
  metodoText: { fontSize: 14, fontWeight: '700', color: Palette.navy },
  nota: { fontSize: 12, color: Palette.textMuted, marginTop: 16 },
  leyenda: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  punto: { width: 10, height: 10, borderRadius: 5 },
  leyendaText: { fontSize: 12, color: Palette.textMuted, marginRight: 8 },
  matriz: { backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, overflow: 'hidden' },
  fila: { flexDirection: 'row' },
  filaHead: { backgroundColor: Palette.navySoft },
  filaInterna: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.07)' },
  grupo: { borderTopWidth: 1, borderTopColor: Palette.border, borderLeftWidth: 5 },
  celda: { paddingHorizontal: 6, paddingVertical: 10, fontSize: 12, color: Palette.text, justifyContent: 'center' },
  celdaHead: { fontSize: 11, fontWeight: '800', color: Palette.navy, paddingVertical: 9 },
  celdaProducto: { fontWeight: '800' },
  celdaNum: { textAlign: 'right' },
  celdaSaldo: { fontWeight: '800' },
  celdaUltima: { textAlign: 'center' },
  cardHintMini: { fontSize: 12, color: Palette.textFaint, textAlign: 'center' },
  compra: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, overflow: 'hidden' },
  compraCabecera: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  compraTitulo: { fontSize: 15, fontWeight: '700', color: Palette.text },
  sub: { fontSize: 12, color: Palette.textMuted, marginTop: 2 },
  negrita: { fontWeight: '800', color: Palette.text },
  pill: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '800' },
  compraDetalle: { backgroundColor: Palette.cream, borderTopWidth: 1, borderTopColor: Palette.border, padding: 12, gap: 8 },
  montos: { flexDirection: 'row', justifyContent: 'space-between' },
  subSeccion: { fontSize: 12, fontWeight: '700', color: Palette.navy, marginTop: 4 },
  abono: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, padding: 10 },
  abonoNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Palette.navySoft, textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: '800', color: Palette.navy, overflow: 'hidden' },
  abonoFecha: { fontSize: 14, color: Palette.text },
  abonoMonto: { fontSize: 15, fontWeight: '800', color: Palette.text },
  verDetalle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  verDetalleText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14, paddingHorizontal: 20 },
})

export default HistorialCliente
