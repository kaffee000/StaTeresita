import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Header from '../components/Header';
import { supabase } from '../lib/supabase';
import { Palette } from '@/constants/palette'

const Historial = () => {
  const router = useRouter();
  const [ventas, setVentas] = useState<any[]>([]);
  

const formatearMoneda = (valor: string | number) => {
    const numero = valor.toString().replace(/\D/g, '')
    return numero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  }


  const formatearFecha = (fechaOriginal: string) => {
    if (!fechaOriginal) return '';
    const fecha = new Date(fechaOriginal);
    return fecha.toLocaleDateString('es-CL');
  };

useEffect(() => {
    const cargarHistorial = async () => {
      const { data, error } = await supabase
        .from('ventas_pedidos')
        .select(`
          id,
          monto_total,
          descripcion,
          fecha_venta, 
          saldo_pendiente,
          clientes ( nombre ),
          perfiles ( nombre ) 
        `)
        .order('fecha_venta', { ascending: false }); 

      if (error) {
        console.log("Error de Supabase en historial:", error.message);
      } else {
        setVentas(data || []);
      }
    };
    cargarHistorial();
  }, []);

return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Historial de Ventas" />
      <FlatList
        data={ventas}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No hay ventas registradas.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.tarjeta, pressed && { opacity: 0.8 }]}
            onPress={() => router.push({ pathname: '/compra/[id]', params: { id: item.id } } as any)}
          >
            <View style={styles.tarjetaHeader}>
              <Text style={styles.textoDestacado}>{item.clientes?.nombre}</Text>
              <Text style={styles.fechaText}>{formatearFecha(item.fecha_venta)}</Text>
            </View>
            
            <Text style={styles.descripcionText}>{item.descripcion}</Text>
            
            <View style={styles.detalleContainer}>
              <Text style={styles.vendedorText}>Vendedor: {item.perfiles?.nombre || 'Desconocido'}</Text>
              <Text style={styles.montoText}>${formatearMoneda(item.monto_total)}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  tarjeta: { 
    backgroundColor: Palette.card, 
    padding: 16, 
    marginBottom: 14, 
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    elevation: 2,
    shadowColor: Palette.navyDark, 
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  tarjetaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  textoDestacado: { fontSize: 17, fontWeight: '700', color: Palette.text },
  fechaText: { fontSize: 13, color: Palette.textMuted },
  descripcionText: { fontSize: 15, color: Palette.textMuted, marginBottom: 12 },
  detalleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    paddingTop: 12,
  },
  vendedorText: { fontSize: 13, color: Palette.textMuted, fontStyle: 'italic' },
  montoText: { fontSize: 18, fontWeight: '800', color: Palette.green },
  emptyText: { textAlign: 'center', color: Palette.textMuted, marginTop: 40, fontSize: 16 }
});

export default Historial;