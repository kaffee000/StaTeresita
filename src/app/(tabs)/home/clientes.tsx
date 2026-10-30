import Header from "@/components/Header";
import { Palette } from "@/constants/palette";
import { clp } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface Cliente {
  id: string;
  nombre: string;
  rut: string | null;
  telefono: string | null;
  direccion: string | null;
}
interface VentaResumen {
  cliente_id: string;
  saldo_pendiente: number;
  monto_total: number;
}

const norm = (t: string | null | undefined) => (t ?? "").toLowerCase();

// Lista de clientes con su deuda. Al tocar uno se abre su historial completo.
// Solo lee las tablas clientes y ventas_pedidos.
const Clientes = () => {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [ventas, setVentas] = useState<VentaResumen[]>([]);
  const [busca, setBusca] = useState("");

  useFocusEffect(
    useCallback(() => {
      const cargar = async () => {
        const [c, v] = await Promise.all([
          supabase
            .from("clientes")
            .select("id, nombre, rut, telefono, direccion")
            .order("nombre", { ascending: true }),
          supabase
            .from("ventas_pedidos")
            .select("cliente_id, saldo_pendiente, monto_total")
            .neq("estado_pago", "anulada"),
        ]);
        setError(c.error?.message ?? v.error?.message ?? null);
        setClientes((c.data as Cliente[]) || []);
        setVentas((v.data as VentaResumen[]) || []);
        setCargando(false);
      };
      cargar();
    }, []),
  );

  const deudaDe = (id: string) =>
    ventas
      .filter((v) => v.cliente_id === id)
      .reduce((n, v) => n + Number(v.saldo_pendiente), 0);
  const comprasDe = (id: string) =>
    ventas.filter((v) => v.cliente_id === id).length;

  const filtrados = clientes.filter((c) =>
    norm(`${c.nombre} ${c.rut ?? ""} ${c.direccion ?? ""}`).includes(
      norm(busca),
    ),
  );

  return (
    <SafeAreaView style={styles.container} edges={["left", "right", "bottom"]}>
      <Header title="Clientes" />
      <View style={styles.buscador}>
        <Ionicons name="search" size={18} color={Palette.textFaint} />
        <TextInput
          style={styles.buscadorInput}
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por nombre, RUT o dirección"
          placeholderTextColor={Palette.textFaint}
        />
      </View>

      {cargando ? (
        <ActivityIndicator
          size="large"
          color={Palette.navy}
          style={{ marginTop: 40 }}
        />
      ) : error ? (
        <Text style={styles.vacio}>No se pudo cargar: {error}</Text>
      ) : (
        <FlatList
          data={filtrados}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          ListEmptyComponent={
            <Text style={styles.vacio}>
              {busca
                ? "Ningún cliente coincide."
                : "Aún no hay clientes registrados."}
            </Text>
          }
          renderItem={({ item }) => {
            const deuda = deudaDe(item.id);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() =>
                  router.push({
                    pathname: "/cliente/[id]",
                    params: { id: item.id },
                  } as any)
                }
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.nombre.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre} numberOfLines={1}>
                    {item.nombre}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {[item.rut, item.direccion].filter(Boolean).join(" · ") ||
                      "Sin datos de contacto"}
                  </Text>
                  <Text style={styles.sub}>
                    {comprasDe(item.id)}{" "}
                    {comprasDe(item.id) === 1 ? "compra" : "compras"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor:
                        deuda > 0 ? Palette.amberSoft : Palette.greenSoft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: deuda > 0 ? Palette.amber : Palette.green },
                    ]}
                  >
                    {deuda > 0 ? clp(deuda) : "Al día"}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={Palette.textFaint}
                />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  buscador: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    margin: 16,
  },
  buscadorInput: { flex: 1, fontSize: 15, color: Palette.text },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Palette.navySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17, fontWeight: "800", color: Palette.navy },
  nombre: { fontSize: 16, fontWeight: "700", color: Palette.text },
  sub: { fontSize: 12, color: Palette.textMuted, marginTop: 1 },
  pill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: "800" },
  vacio: {
    textAlign: "center",
    color: Palette.textMuted,
    marginTop: 40,
    fontSize: 15,
    paddingHorizontal: 20,
  },
});

export default Clientes;
