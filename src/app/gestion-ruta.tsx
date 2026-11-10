import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente, Parada, store, textoEstado, uid } from '@/lib/demoJornada'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Cliente { id: string; nombre: string; direccion: string | null }

const VISITA = {
  pendiente: { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted },
  visitado: { texto: 'Visitado', fondo: Palette.greenSoft, color: Palette.green },
  no_esta: { texto: 'No estaba', fondo: Palette.amberSoft, color: Palette.amber },
} as const

// Pantalla solo de apariencia: las asignaciones viven en memoria (lib/demoJornada.ts).
// Lo único que se lee de Supabase es el rol y la lista de clientes (tablas que ya existían).
const GestionRuta = () => {
  const [, setTick] = useState(0)
  const refrescar = () => setTick((t) => t + 1)
  const [soyGerente, setSoyGerente] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedores, setVendedores] = useState<{ casero_id: string; nombre: string; furgon: string | null }[]>([])

  const [caseroModal, setCaseroModal] = useState<{ casero_id: string; nombre: string } | null>(null)
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')

  const editable = store.estado === 'preparacion' && soyGerente
  const caseros = vendedores
  const paradas = store.paradas

  useFocusEffect(
    useCallback(() => {
      const leer = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
          setSoyGerente(esGerente(perfil?.rol))
        }
        const { data: cs } = await supabase.from('clientes').select('id, nombre, direccion').order('nombre', { ascending: true })
        setClientes((cs as Cliente[]) || [])
        const { data: vs } = await supabase.from('perfiles').select('id, nombre, rol').in('rol', ['vendedor', 'dueno']).order('nombre', { ascending: true })
        // Furgón asignado a cada trabajador (si ya se ejecutó asignar_furgon.sql)
        const { data: fs } = await supabase.from('ubicaciones_inventario').select('nombre, responsable_id').eq('tipo', 'furgon').eq('activo', true)
        const furgonDe = (id: string) => ((fs as any[]) || []).find((f) => f.responsable_id === id)?.nombre ?? null
        setVendedores(((vs as any[]) || []).map((v) => ({ casero_id: v.id, nombre: v.nombre, furgon: furgonDe(v.id) })))
      }
      leer()
      refrescar()
    }, [])
  )

  const paradasDe = (casero_id: string) => paradas.filter((p) => p.casero_id === casero_id).sort((a, b) => a.orden - b.orden)
  const sinAsignar = clientes.filter((c) => !paradas.some((p) => p.cliente_id === c.id))

  // ---------- Asignar ----------
  const abrirAsignar = (c: { casero_id: string; nombre: string }) => {
    setSeleccion([]); setBusqueda('')
    setCaseroModal(c)
  }

  const alternar = (id: string) =>
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const guardarAsignacion = () => {
    if (!caseroModal || seleccion.length === 0) return
    const actuales = paradasDe(caseroModal.casero_id)
    const base = actuales.length ? Math.max(...actuales.map((p) => p.orden)) : 0
    seleccion.forEach((cliente_id, i) => {
      const c = clientes.find((x) => x.id === cliente_id)
      if (!c) return
      store.paradas.push({
        id: uid(), casero_id: caseroModal.casero_id, cliente_id, nombre: c.nombre,
        direccion: c.direccion, orden: base + i + 1, estado_visita: 'pendiente',
      })
    })
    setCaseroModal(null)
    refrescar()
  }

  const quitar = (p: Parada) => {
    store.paradas = store.paradas.filter((x) => x.id !== p.id)
    refrescar()
  }

  const mover = (p: Parada, delta: -1 | 1) => {
    const lista = paradasDe(p.casero_id)
    const i = lista.findIndex((x) => x.id === p.id)
    const otro = lista[i + delta]
    if (!otro) return
    const tmp = p.orden; p.orden = otro.orden; otro.orden = tmp
    refrescar()
  }

  const filtrados = sinAsignar.filter((c) => {
    const t = busqueda.trim().toLowerCase()
    if (!t) return true
    return c.nombre.toLowerCase().includes(t) || (c.direccion ?? '').toLowerCase().includes(t)
  })

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Gestionar ruta" />

      {(
        <ScrollView contentContainerStyle={styles.content}>
          {/* Resumen */}
          <View style={styles.resumen}>
            <Text style={styles.resumenLabel}>Jornada de hoy · {textoEstado(store.estado)}</Text>
            <View style={styles.resumenRow}>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{caseros.length}</Text>
                <Text style={styles.resumenTxt}>caseros</Text>
              </View>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{paradas.length}</Text>
                <Text style={styles.resumenTxt}>clientes asignados</Text>
              </View>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{sinAsignar.length}</Text>
                <Text style={styles.resumenTxt}>sin asignar</Text>
              </View>
            </View>
            {!editable && (
              <Text style={styles.resumenNota}>
                {soyGerente ? 'La jornada ya inició: la ruta está bloqueada.' : 'Solo el gerente puede modificar las rutas.'}
              </Text>
            )}
          </View>

          {caseros.length === 0 && (
            <View style={styles.aviso}>
              <Ionicons name="information-circle-outline" size={22} color={Palette.navy} />
              <Text style={[styles.avisoText, { color: Palette.text }]}>
                No hay trabajadores (vendedor o dueno) en la tabla perfiles.
              </Text>
            </View>
          )}

          {caseros.map((c) => {
            const lista = paradasDe(c.casero_id)
            return (
              <View key={c.casero_id} style={styles.caseroCard}>
                <View style={styles.caseroTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{c.nombre.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.caseroNombre}>{c.nombre}</Text>
                    <Text style={styles.sub}>{c.furgon ? `${c.furgon} · ` : ''}{lista.length} clientes</Text>
                  </View>
                  {editable && (
                    <Pressable style={styles.botonChico} onPress={() => abrirAsignar(c)}>
                      <Ionicons name="add" size={16} color={Palette.onNavy} />
                      <Text style={styles.botonChicoText}>Asignar</Text>
                    </Pressable>
                  )}
                </View>

                {lista.length === 0 && <Text style={styles.sub}>Sin clientes asignados.</Text>}
                {lista.map((p, i) => {
                  const v = VISITA[p.estado_visita] ?? VISITA.pendiente
                  return (
                    <View key={p.id} style={styles.parada}>
                      <View style={styles.numero}><Text style={styles.numeroText}>{i + 1}</Text></View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.paradaNombre} numberOfLines={1}>{p.nombre}</Text>
                        {!!p.direccion && (
                          <View style={styles.dirRow}>
                            <Ionicons name="location-outline" size={13} color={Palette.textMuted} />
                            <Text style={styles.dirText} numberOfLines={1}>{p.direccion}</Text>
                          </View>
                        )}
                        <View style={[styles.pill, { backgroundColor: v.fondo }]}>
                          <Text style={[styles.pillText, { color: v.color }]}>{v.texto}</Text>
                        </View>
                      </View>
                      {editable && (
                        <View style={styles.acciones}>
                          <Pressable onPress={() => mover(p, -1)} hitSlop={6}><Ionicons name="chevron-up" size={20} color={i === 0 ? Palette.border : Palette.navy} /></Pressable>
                          <Pressable onPress={() => mover(p, 1)} hitSlop={6}><Ionicons name="chevron-down" size={20} color={i === lista.length - 1 ? Palette.border : Palette.navy} /></Pressable>
                          <Pressable onPress={() => quitar(p)} hitSlop={6}><Ionicons name="close-circle-outline" size={20} color={Palette.textFaint} /></Pressable>
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            )
          })}
        </ScrollView>
      )}

      {/* Modal: asignar clientes */}
      <Modal visible={!!caseroModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCaseroModal(null)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Clientes para {caseroModal?.nombre}</Text>
            <Pressable onPress={() => setCaseroModal(null)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <View style={{ padding: 16, paddingBottom: 0 }}>
            <TextInput style={styles.input} value={busqueda} onChangeText={setBusqueda}
              placeholder="Buscar por nombre o dirección" placeholderTextColor={Palette.textFaint} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {filtrados.length === 0 && <Text style={styles.sub}>No quedan clientes sin asignar.</Text>}
            {filtrados.map((c) => {
              const activo = seleccion.includes(c.id)
              return (
                <Pressable key={c.id} style={[styles.opcion, activo && styles.opcionActiva]} onPress={() => alternar(c.id)}>
                  <Ionicons name={activo ? 'checkbox' : 'square-outline'} size={22} color={activo ? Palette.navy : Palette.textFaint} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paradaNombre}>{c.nombre}</Text>
                    {!!c.direccion && <Text style={styles.sub} numberOfLines={1}>{c.direccion}</Text>}
                  </View>
                </Pressable>
              )
            })}
          </ScrollView>
          <View style={{ padding: 16 }}>
            <Pressable style={[styles.boton, seleccion.length === 0 && { opacity: 0.5 }]}
              onPress={guardarAsignacion} disabled={seleccion.length === 0}>
              <Text style={styles.botonText}>{`Asignar ${seleccion.length} cliente${seleccion.length === 1 ? '' : 's'}`}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 20, gap: 12 },
  aviso: { margin: 0, padding: 16, borderRadius: 14, backgroundColor: Palette.amberSoft, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avisoText: { flex: 1, color: Palette.amber, fontSize: 14, lineHeight: 20 },
  resumen: { backgroundColor: Palette.navy, borderRadius: 18, padding: 16 },
  resumenLabel: { fontSize: 12, color: Palette.onNavyMuted },
  resumenRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  resumenItem: { flex: 1, backgroundColor: Palette.onNavyFill, borderRadius: 12, padding: 10 },
  resumenNum: { fontSize: 22, fontWeight: '800', color: Palette.onNavy },
  resumenTxt: { fontSize: 12, color: Palette.onNavyMuted },
  resumenNota: { fontSize: 12, color: Palette.onNavyMuted, marginTop: 10 },
  caseroCard: { backgroundColor: Palette.card, borderRadius: 18, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  caseroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontWeight: '800', fontSize: 16 },
  caseroNombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  botonChico: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonChicoText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  parada: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 14, padding: 10 },
  numero: { width: 26, height: 26, borderRadius: 13, backgroundColor: Palette.grayPill, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  paradaNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { flex: 1, fontSize: 12, color: Palette.textMuted },
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  acciones: { alignItems: 'center', gap: 2 },
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text, flex: 1, marginRight: 8 },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16, color: Palette.text },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  opcionActiva: { borderColor: Palette.navy, backgroundColor: Palette.navySoft },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
})

export default GestionRuta
