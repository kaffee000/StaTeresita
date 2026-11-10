import { Palette } from '@/constants/palette'
import { clp, fechaCorta } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface Venta {
  id: string
  monto_total: number
  saldo_pendiente: number
  descripcion: string
  fecha_venta: string | null
  clientes: { nombre: string } | null
}

// La fecha del abono puede llamarse distinto según la tabla; probamos los nombres habituales
const fechaDe = (p: any): string | null => p.creado_en ?? p.fecha_pago ?? p.fecha ?? p.created_at ?? null

const DetalleCompra = () => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [venta, setVenta] = useState<Venta | null>(null)
  const [pagos, setPagos] = useState<any[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data: v } = await supabase
          .from('ventas_pedidos')
          .select('id, monto_total, saldo_pendiente, descripcion, fecha_venta, clientes ( nombre )')
          .eq('id', id)
          .single()
        if (v) setVenta(v as any)

        const { data: ps } = await supabase
          .from('pagos')
          .select('*')
          .eq('venta_pedido_id', id)
        const lista = (ps || []).slice().sort((a: any, b: any) =>
          String(fechaDe(b) ?? '').localeCompare(String(fechaDe(a) ?? '')))
        setPagos(lista)
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

  const volver = () => {
    if (router.canGoBack()) router.back()
  }

  const total = Number(venta?.monto_total ?? 0)
  const saldo = Number(venta?.saldo_pendiente ?? 0)
  const abonado = Math.max(total - saldo, 0)
  const progreso = total > 0 ? Math.min(abonado / total, 1) : 0

  const estado = saldo <= 0
    ? { texto: 'Pagada', fondo: Palette.greenSoft, color: Palette.green }
    : abonado > 0
      ? { texto: 'Parcial', fondo: Palette.amberSoft, color: Palette.amber }
      : { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted }

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
        <View style={styles.heroRow}>
          <Pressable onPress={volver} style={styles.iconButton}>
            <Ionicons name="arrow-back-outline" size={22} color={Palette.onNavy} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Detalle de compra</Text>
            <Text style={styles.heroTitle} numberOfLines={1}>{venta?.descripcion ?? ''}</Text>
          </View>
        </View>
        {venta && (
          <View style={[styles.pill, { backgroundColor: estado.fondo }]}>
            <Text style={[styles.pillText, { color: estado.color }]}>{estado.texto}</Text>
          </View>
        )}
      </View>

      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : !venta ? (
        <Text style={styles.empty}>No se encontró la compra.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Saldo pendiente</Text>
            <Text style={styles.saldo}>{clp(saldo)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progreso * 100}%` }]} />
            </View>
            <Text style={styles.cardHint}>Monto que aún queda por pagar de esta compra.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Resumen de la compra</Text>
            <Fila etiqueta="Cliente" valor={venta.clientes?.nombre ?? '—'} />
            <Fila etiqueta="Monto total" valor={clp(total)} />
            <Fila etiqueta="Total abonado" valor={clp(abonado)} />
            <Fila etiqueta="Fecha" valor={fechaCorta(venta.fecha_venta) || '—'} ultima />
          </View>

          <Text style={styles.sectionTitle}>Abonos realizados</Text>
          {pagos.length === 0 && <Text style={styles.empty}>Todavía no hay abonos.</Text>}
          {pagos.map((p) => (
            <View key={p.id ?? `${fechaDe(p)}-${p.monto_abonado}`} style={styles.abono}>
              <Ionicons name="checkmark-circle-outline" size={20} color={Palette.navy} />
              <Text style={styles.abonoFecha}>{fechaCorta(fechaDe(p)) || 'Abono'}</Text>
              <Text style={styles.abonoMonto}>{clp(Number(p.monto_abonado))}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const Fila = ({ etiqueta, valor, ultima }: { etiqueta: string; valor: string; ultima?: boolean }) => (
  <View style={[styles.fila, !ultima && styles.filaBorde]}>
    <Text style={styles.filaEtiqueta}>{etiqueta}</Text>
    <Text style={styles.filaValor}>{valor}</Text>
  </View>
)

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  hero: {
    backgroundColor: Palette.navy,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    gap: 12,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.onNavyFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: { fontSize: 12, color: Palette.onNavyMuted },
  heroTitle: { fontSize: 20, fontWeight: '800', color: Palette.onNavy },
  pill: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: '700' },
  content: { padding: 20, gap: 14 },
  card: {
    backgroundColor: Palette.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 16,
  },
  cardLabel: { fontSize: 13, color: Palette.textMuted },
  saldo: { fontSize: 30, fontWeight: '800', color: Palette.text, marginTop: 2 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.grayPill,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: Palette.navy },
  cardHint: { fontSize: 12, color: Palette.textFaint, marginTop: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Palette.text, marginBottom: 6 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  filaBorde: { borderBottomWidth: 1, borderBottomColor: Palette.border },
  filaEtiqueta: { fontSize: 14, color: Palette.textMuted },
  filaValor: { fontSize: 14, fontWeight: '700', color: Palette.text },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
  },
  abono: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Palette.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
  },
  abonoFecha: { flex: 1, fontSize: 14, color: Palette.text },
  abonoMonto: { fontSize: 15, fontWeight: '800', color: Palette.text },
  empty: { color: Palette.textMuted, textAlign: 'center', marginTop: 20 },
})

export default DetalleCompra
