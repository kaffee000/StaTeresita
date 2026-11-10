// Este archivo no se encuentra implementado, puesto que es un complemento, se piensa trabajar para el siguiente sprint.
import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { clp, fechaCorta } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Solicitud {
  id: string
  tipo: 'porcentaje' | 'monto'
  valor: number
  motivo: string | null
  creado_en: string
  productos: { nombre: string; precio_venta: number } | null
  clientes: { nombre: string } | null
  perfiles: { nombre: string } | null
}

const SolicitudesDescuento = () => {
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [procesando, setProcesando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('solicitudes_descuento')
      .select('id, tipo, valor, motivo, creado_en, productos ( nombre, precio_venta ), clientes ( nombre ), perfiles ( nombre )')
      .eq('estado', 'pendiente')
      .order('creado_en', { ascending: true })
    setErrorCarga(error ? error.message : null)
    setSolicitudes((data as any[]) || [])
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const resolver = async (s: Solicitud, estado: 'aprobada' | 'rechazada') => {
    setProcesando(s.id)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('solicitudes_descuento')
      .update({ estado, resuelto_por: user?.id, resuelto_en: new Date().toISOString() })
      .eq('id', s.id)
    setProcesando(null)
    if (error) Alert.alert('Error', error.message)
    else cargar()
  }

  const textoDescuento = (s: Solicitud) => {
    const lista = Number(s.productos?.precio_venta ?? 0)
    if (s.tipo === 'porcentaje') return `${Number(s.valor)}% (${clp(lista * Number(s.valor) / 100)} por unidad)`
    const pct = lista > 0 ? (Number(s.valor) / lista) * 100 : 0
    return `${clp(Number(s.valor))} por unidad (${pct.toFixed(1)}%)`
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Descuentos" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : errorCarga ? (
        <View style={styles.aviso}>
          <Ionicons name="warning-outline" size={22} color={Palette.amber} />
          <Text style={styles.avisoText}>No se pudo cargar: {errorCarga}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.seccion}>Solicitudes pendientes ({solicitudes.length})</Text>
          {solicitudes.length === 0 && <Text style={styles.vacio}>No hay solicitudes pendientes.</Text>}
          {solicitudes.map((s) => (
            <View key={s.id} style={styles.card}>
              <Text style={styles.titulo}>{s.productos?.nombre ?? 'Producto'}</Text>
              <Text style={styles.sub}>Pide: {s.perfiles?.nombre ?? 'Casero'}{s.clientes?.nombre ? ` · Cliente: ${s.clientes.nombre}` : ''}</Text>
              <Text style={styles.sub}>Precio de lista: {clp(Number(s.productos?.precio_venta ?? 0))} · {fechaCorta(s.creado_en)}</Text>
              <View style={styles.descuento}>
                <Text style={styles.descuentoLabel}>Descuento solicitado</Text>
                <Text style={styles.descuentoValor}>{textoDescuento(s)}</Text>
              </View>
              {!!s.motivo && <Text style={styles.sub}>Motivo: {s.motivo}</Text>}
              <View style={styles.acciones}>
                <Pressable style={[styles.btn, styles.btnRechazar]} disabled={procesando === s.id} onPress={() => resolver(s, 'rechazada')}>
                  <Text style={styles.btnRechazarText}>Rechazar</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnAprobar]} disabled={procesando === s.id} onPress={() => resolver(s, 'aprobada')}>
                  <Text style={styles.btnAprobarText}>Aprobar</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 20, gap: 12 },
  aviso: { margin: 20, padding: 16, borderRadius: 14, backgroundColor: Palette.amberSoft, flexDirection: 'row', gap: 10 },
  avisoText: { flex: 1, color: Palette.amber, fontSize: 14, lineHeight: 20 },
  seccion: { fontSize: 13, fontWeight: '700', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  vacio: { color: Palette.textMuted, textAlign: 'center', marginTop: 12 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 6 },
  titulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  descuento: { backgroundColor: Palette.amberSoft, borderRadius: 12, padding: 10, marginTop: 4 },
  descuentoLabel: { fontSize: 12, color: Palette.amber },
  descuentoValor: { fontSize: 16, fontWeight: '800', color: Palette.text },
  acciones: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnAprobar: { backgroundColor: Palette.navy },
  btnAprobarText: { color: Palette.onNavy, fontWeight: '700' },
  btnRechazar: { backgroundColor: Palette.grayPill },
  btnRechazarText: { color: Palette.text, fontWeight: '700' },
})

export default SolicitudesDescuento
