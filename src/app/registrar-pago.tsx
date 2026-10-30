import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Header from '../components/Header'
import { supabase } from '../lib/supabase'
import { Palette } from '@/constants/palette'

interface VentaPendiente {
  id: string
  saldo_pendiente: number
  descripcion: string
  cliente_id?: string
  clientes: { nombre: string } | null
}

const RegistrarPago = () => {
  const router = useRouter()
  const { clienteId } = useLocalSearchParams<{ clienteId?: string }>()
  const [monto, setMonto] = useState('')
  const [loading, setLoading] = useState(false)
  
  const [ventasPendientes, setVentasPendientes] = useState<VentaPendiente[]>([])
  const [ventaSeleccionada, setVentaSeleccionada] = useState<VentaPendiente | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [cargandoVentas, setCargandoVentas] = useState(true)
  

  // Función para agregar el separador de miles automáticamente
  const formatearMoneda = (valor: string | number) => {
    const numero = valor.toString().replace(/\D/g, '')
    return numero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  }

  const manejarCambioMonto = (texto: string) => {
    setMonto(formatearMoneda(texto))
  }

  useEffect(() => {
    const obtenerDeudas = async () => {
      try {
        const { data, error } = await supabase
          .from('ventas_pedidos')
          .select(`
            id,
            saldo_pendiente,
            descripcion,
            cliente_id,
            clientes ( nombre )
          `)
          .gt('saldo_pendiente', 0)
          .order('creado_en', { ascending: false })

        if (error) throw error
        // @ts-ignore
        if (data) {
          // Si venimos desde un cliente de la lista, mostramos solo sus deudas
          const lista = clienteId ? (data as any[]).filter((v) => v.cliente_id === clienteId) : (data as any[])
          setVentasPendientes(lista)
          if (clienteId && lista.length === 1) setVentaSeleccionada(lista[0])
        }
      } catch (error) {
        console.error('Error al cargar deudas:', error)
      } finally {
        setCargandoVentas(false)
      }
    }
    obtenerDeudas()
  }, [])

  const guardarPago = async () => {
    const abono = parseFloat(monto.replace(/\./g, ''))
    
    if (!abono || !ventaSeleccionada) {
      Alert.alert('Error', 'Selecciona una deuda e ingresa un monto válido')
      return
    }

    if (abono > ventaSeleccionada.saldo_pendiente) {
      Alert.alert('Error', `El abono no puede superar la deuda actual ($${formatearMoneda(ventaSeleccionada.saldo_pendiente)})`)
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No hay sesión activa')

      const { error: pagoError } = await supabase
        .from('pagos')
        .insert([{
          venta_pedido_id: ventaSeleccionada.id,
          cobrador_id: user.id,
          monto_abonado: abono
        }])
      
      if (pagoError) throw pagoError

      const nuevoSaldo = ventaSeleccionada.saldo_pendiente - abono
      const nuevoEstado = nuevoSaldo <= 0 ? 'pagada' : 'pendiente'

      const { error: ventaError } = await supabase
        .from('ventas_pedidos')
        .update({ 
          saldo_pendiente: nuevoSaldo,
          estado_pago: nuevoEstado
        })
        .eq('id', ventaSeleccionada.id)

      if (ventaError) throw ventaError

      Alert.alert('Éxito', 'Pago registrado y saldo actualizado')
      router.back()
    } catch (error: any) {
      Alert.alert('Error al procesar pago', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Registrar Pago" />

      <View style={styles.form}>
        <Text style={styles.label}>Venta Pendiente</Text>
        <Pressable style={styles.selectorContainer} onPress={() => setModalVisible(true)}>
          <Text style={[styles.selectorText, !ventaSeleccionada && styles.placeholderText]}>
            {ventaSeleccionada 
              ? `${ventaSeleccionada.clientes?.nombre}- ${ventaSeleccionada.descripcion} (Debe: $${formatearMoneda(ventaSeleccionada.saldo_pendiente)})` 
              : 'Seleccionar deuda...'}
          </Text>
          <Ionicons name="chevron-down" size={20} color={Palette.textMuted} />
        </Pressable>

        <Text style={styles.label}>Monto a Abonar</Text>
        <View style={styles.inputContainer}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={Palette.textFaint}
            keyboardType="numeric"
            value={monto}
            onChangeText={manejarCambioMonto}
            editable={!loading}
          />
        </View>

        <Pressable 
          style={[styles.submitButton, loading && styles.submitButtonDisabled]} 
          onPress={guardarPago}
          disabled={loading}
        >
          <Text style={styles.submitButtonText}>
            {loading ? 'Procesando...' : 'Registrar Pago'}
          </Text>
        </Pressable>
      </View>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Deudas Pendientes</Text>
            <Pressable onPress={() => setModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={Palette.text} />
            </Pressable>
          </View>

          {cargandoVentas ? (
            <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={ventasPendientes}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContainer}
              ListEmptyComponent={<Text style={styles.emptyText}>No hay deudas pendientes.</Text>}
              renderItem={({ item }) => (
                <Pressable 
                  style={styles.ventaItem}
                  onPress={() => {
                    setVentaSeleccionada(item)
                    setModalVisible(false)
                  }}
                >
                  <View>
                    <Text style={styles.ventaNombre}>{item.clientes?.nombre} - {item.descripcion}</Text>

                    <Text style={styles.ventaSaldo}>Deuda: ${formatearMoneda(item.saldo_pendiente)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={Palette.textFaint} />
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  form: { padding: 24 },
  label: { fontSize: 14, color: Palette.text, marginBottom: 6, fontWeight: '600' },
  selectorContainer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12,
    paddingHorizontal: 14, height: 56, marginBottom: 20,
  },
  selectorText: { fontSize: 16, color: Palette.text, flex: 1, marginRight: 8 },
  placeholderText: { color: Palette.textFaint },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.card,
    borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14,
    height: 56, marginBottom: 20, fontSize: 16, color: Palette.text,
  },
  currency: { fontSize: 18, color: Palette.textMuted, marginRight: 8 },
  input: { flex: 1, fontSize: 18, color: Palette.text },
  submitButton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#8C90B5' },
  submitButtonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  closeButton: { padding: 4 },
  listContainer: { padding: 16 },
  ventaItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  ventaNombre: { fontSize: 16, color: Palette.text, fontWeight: '700' },
  ventaSaldo: { fontSize: 14, color: Palette.orange, marginTop: 4, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: Palette.textMuted, marginTop: 20 },
})

export default RegistrarPago