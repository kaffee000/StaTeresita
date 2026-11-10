import { Palette } from "@/constants/palette";
import { esGerente, store } from "@/lib/demoJornada";
import { clp } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface PuntoMapa {
  id: string;
  cliente_id: string;
  calle: string | null;
  numero: string | null;
  ciudad: string | null;
  latitud: number;
  longitud: number;
}

interface ClienteFila {
  id: string;
  nombre: string;
  direccion: string | null;
}

const HomeScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rolUsuario, setRolUsuario] = useState<string | null>(null);
  const [nombreUsuario, setNombreUsuario] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteFila[]>([]);
  const [deudas, setDeudas] = useState<Record<string, number>>({});
  const [puntos, setPuntos] = useState<PuntoMapa[]>([]);
  const mapRef = useRef<MapView>(null);
  const [, setTick] = useState(0);
  const soyGerente = esGerente(rolUsuario);

  useEffect(() => {
    const obtenerRol = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from("perfiles")
          .select("rol, nombre")
          .eq("id", user.id)
          .single();

        if (data) {
          setRolUsuario(data.rol);
          setNombreUsuario((data as any).nombre ?? null);
        }
      }
    };
    obtenerRol();
  }, []);

  // Clientes y lo que debe cada uno (se refresca al volver a esta pantalla)
  useFocusEffect(
    useCallback(() => {
      const cargar = async () => {
        const { data: cs } = await supabase
          .from("clientes")
          .select("id, nombre, direccion")
          .order("nombre", { ascending: true });
        const { data: vs } = await supabase
          .from("ventas_pedidos")
          .select("cliente_id, saldo_pendiente")
          .gt("saldo_pendiente", 0);
        // Direcciones que tienen coordenadas calculadas (latitud/longitud)
        const { data: ds, error: errorDirecciones } = await supabase
          .from("direcciones")
          .select("id, cliente_id, calle, numero, ciudad, latitud, longitud")
          .not("latitud", "is", null)
          .not("longitud", "is", null);
        if (errorDirecciones) {
          console.warn("Error al cargar direcciones:", errorDirecciones);
        }

        const mapa: Record<string, number> = {};
        (vs || []).forEach((v: any) => {
          mapa[v.cliente_id] =
            (mapa[v.cliente_id] || 0) + Number(v.saldo_pendiente);
        });
        setClientes((cs as ClienteFila[]) || []);
        setDeudas(mapa);
        setPuntos(
          ((ds as any[]) || [])
            .map((d) => ({
              ...d,
              latitud: Number(d.latitud),
              longitud: Number(d.longitud),
            }))
            .filter(
              (d) => Number.isFinite(d.latitud) && Number.isFinite(d.longitud),
            ),
        );
      };
      cargar();
      setTick((t) => t + 1); // refresca el resumen de la jornada (datos de ejemplo en memoria)
    }, []),
  );

  // Iniciar / finalizar la jornada (solo apariencia: se guarda en memoria, no en Supabase) Se implementara cuando estemos trabajando con las rutas
  const cambiarEstado = (nuevo: "en_curso" | "finalizada") => {
    const iniciar = nuevo === "en_curso";
    Alert.alert(
      iniciar ? "Iniciar ruta" : "Finalizar ruta",
      iniciar
        ? "Al iniciar se bloquean la carga de los furgones, los clientes asignados y su orden. Las ventas y los abonos siguen funcionando."
        : "Se cerrará la jornada de hoy.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: iniciar ? "Iniciar" : "Finalizar",
          onPress: () => {
            store.estado = nuevo;
            setTick((t) => t + 1);
          },
        },
      ],
    );
  };

  const nombrePorCliente: Record<string, string> = {};
  clientes.forEach((c) => (nombrePorCliente[c.id] = c.nombre));

  // Ajustar el mapa para que se vean todos los puntos de los clientes
  const encuadrarPuntos = useCallback(() => {
    if (!puntos.length || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      puntos.map((p) => ({ latitude: p.latitud, longitude: p.longitud })),
      {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: true,
      },
    );
  }, [puntos]);

  useEffect(() => {
    encuadrarPuntos();
  }, [encuadrarPuntos]);

  const conDeuda = clientes.filter((c) => (deudas[c.id] || 0) > 0).length;
  const totalPorCobrar = (Object.values(deudas) as number[]).reduce(
    (s, n) => s + n,
    0,
  );
  const progreso = clientes.length
    ? (clientes.length - conDeuda) / clientes.length
    : 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Cabecera con resumen */}
        <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroHello}>
                Hola{nombreUsuario ? `, ${nombreUsuario}` : ""}
              </Text>
              <Text style={styles.heroBrand}>Santa Teresita</Text>
            </View>
            <Pressable
              onPress={() => router.replace("/")}
              style={styles.iconButton}
            >
              <Ionicons
                name="log-out-outline"
                size={22}
                color={Palette.onNavy}
              />
            </Pressable>
          </View>

          {
            soyGerente ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.heroJornadaTitle}>Jornada de hoy</Text>
                  {/* Botones Iniciar ruta / Finalizar ruta (desactivados por ahora) Se implementara cuando estemos trabajando con las rutas
                {store.estado === 'preparacion' && (
                  <Pressable style={styles.jornadaBtn} onPress={() => cambiarEstado('en_curso')}>
                    <Ionicons name="play" size={13} color={Palette.onNavy} />
                    <Text style={styles.jornadaBtnText}>Iniciar ruta</Text>
                  </Pressable>
                )}
                {store.estado === 'en_curso' && (
                  <Pressable style={styles.jornadaBtn} onPress={() => cambiarEstado('finalizada')}>
                    <Ionicons name="stop" size={13} color={Palette.onNavy} />
                    <Text style={styles.jornadaBtnText}>Finalizar ruta</Text>
                  </Pressable>
                )}
                */}
                </View>
                <View style={{ height: 14 }} />
                <View style={styles.gestionRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.gestionCard,
                      styles.gestionMint,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => router.push("/inventario-gerente")}
                  >
                    <View
                      style={[
                        styles.gestionIcon,
                        { backgroundColor: Palette.onNavy },
                      ]}
                    >
                      <Ionicons
                        name="cube-outline"
                        size={24}
                        color={Palette.navy}
                      />
                    </View>
                    <Text style={styles.gestionTitulo}>
                      Gestionar inventario
                    </Text>
                    <Text style={styles.gestionSub}>
                      Revisa stock, productos y movimientos.
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={Palette.onNavyMuted}
                      style={styles.gestionChevron}
                    />
                  </Pressable>

                  {/* Botón Gestionar ruta (desactivado por ahora)
                <Pressable
                  style={({ pressed }) => [styles.gestionCard, styles.gestionLila, pressed && styles.cardPressed]}
                  onPress={() => router.push('/gestion-ruta')}
                >
                  <View style={[styles.gestionIcon, { backgroundColor: Palette.onNavy }]}>
                    <Ionicons name="map-outline" size={24} color={Palette.navy} />
                  </View>
                  <Text style={styles.gestionTitulo}>Gestionar ruta</Text>
                  <Text style={styles.gestionSub}>Revisa asignaciones, furgones y estado de visitas.</Text>
                  <Ionicons name="chevron-forward" size={20} color={Palette.onNavyMuted} style={styles.gestionChevron} />
                </Pressable>
                */}
                </View>
              </>
            ) : null
            /* Recuadro "Cobranza" del casero (comentado por ahora)
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Cobranza</Text>
            <Text style={styles.summaryBig}>{conDeuda} de {clientes.length} clientes por visitar</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progreso * 100}%` }]} />
            </View>
            <Text style={styles.summarySmall}>Por cobrar: {clp(totalPorCobrar)}</Text>
          </View>
          */
          }
        </View>

        <View style={styles.actionsContainer}>
          <Text style={styles.sectionTitle}>Accesos rápidos</Text>

          <View style={styles.quickRow}>
            <Pressable
              style={({ pressed }) => [
                styles.quick,
                pressed && styles.cardPressed,
              ]}
              onPress={() => router.push("/registrar-cliente")}
            >
              <View
                style={[
                  styles.quickIcon,
                  { backgroundColor: Palette.navySoft },
                ]}
              >
                <Ionicons
                  name="person-add-outline"
                  size={24}
                  color={Palette.navy}
                />
              </View>
              <Text style={styles.quickText}>Nuevo cliente</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.quick,
                pressed && styles.cardPressed,
              ]}
              onPress={() => router.push("/registrar-venta")}
            >
              <View
                style={[
                  styles.quickIcon,
                  { backgroundColor: Palette.navySoft },
                ]}
              >
                <Ionicons name="cart-outline" size={24} color={Palette.navy} />
              </View>
              <Text style={styles.quickText}>Registrar venta</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.quick,
                pressed && styles.cardPressed,
              ]}
              onPress={() => router.push("/clientes")}
            >
              <View
                style={[
                  styles.quickIcon,
                  { backgroundColor: Palette.navySoft },
                ]}
              >
                <Ionicons
                  name="people-outline"
                  size={24}
                  color={Palette.navy}
                />
              </View>
              <Text style={styles.quickText}>Ver clientes</Text>
            </Pressable>

            {/* Registrar pago: oculto para el gerente (paga desde la ficha de cada cliente) */}
            {!soyGerente && (
              <Pressable
                style={({ pressed }) => [
                  styles.quick,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => router.push("/registrar-pago")}
              >
                <View
                  style={[
                    styles.quickIcon,
                    { backgroundColor: Palette.greenSoft },
                  ]}
                >
                  <Ionicons
                    name="cash-outline"
                    size={24}
                    color={Palette.green}
                  />
                </View>
                <Text style={styles.quickText}>Registrar pago</Text>
              </Pressable>
            )}

            {rolUsuario === "dueno" && (
              <Pressable
                style={({ pressed }) => [
                  styles.quick,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => router.push("/ver-historial")}
              >
                <View
                  style={[
                    styles.quickIcon,
                    { backgroundColor: Palette.amberSoft },
                  ]}
                >
                  <Ionicons
                    name="time-outline"
                    size={24}
                    color={Palette.orange}
                  />
                </View>
                <Text style={styles.quickText}>Historial</Text>
              </Pressable>
            )}

            {rolUsuario === "dueno" && (
              <Pressable
                style={({ pressed }) => [
                  styles.quick,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => router.push("/solicitudes-descuento")}
              >
                <View
                  style={[
                    styles.quickIcon,
                    { backgroundColor: Palette.navySoft },
                  ]}
                >
                  <Ionicons
                    name="pricetag-outline"
                    size={24}
                    color={Palette.navy}
                  />
                </View>
                <Text style={styles.quickText}>Descuentos</Text>
              </Pressable>
            )}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>
            Mapa de clientes
          </Text>

          {/* --- MAPA: un marcador por cada dirección con latitud/longitud --- */}
          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: -35.6975, // Centro de Colbún
                longitude: -71.4214,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
              onMapReady={encuadrarPuntos}
              onLongPress={(e) => {
                const coords = e.nativeEvent.coordinate;
                Alert.alert(
                  "Punto seleccionado",
                  `Lat: ${coords.latitude.toFixed(4)}, Lng: ${coords.longitude.toFixed(4)}`,
                );
              }}
            >
              {puntos.map((p) => {
                const deuda = deudas[p.cliente_id] || 0;
                const direccion = [
                  [p.calle, p.numero].filter(Boolean).join(" "),
                  p.ciudad,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <Marker
                    key={p.id}
                    coordinate={{ latitude: p.latitud, longitude: p.longitud }}
                    title={nombrePorCliente[p.cliente_id] ?? "Cliente"}
                    description={
                      deuda > 0
                        ? `${direccion} · Debe ${clp(deuda)}`
                        : `${direccion} · Al día`
                    }
                    pinColor={deuda > 0 ? Palette.amber : Palette.green}
                  />
                );
              })}
            </MapView>
          </View>
          <Text style={styles.mapHint}>
            {puntos.length
              ? `${puntos.length} ${puntos.length === 1 ? "dirección" : "direcciones"} con ubicación`
              : "Ningún cliente tiene ubicación guardada todavía."}
          </Text>
          {/* --- FIN DEL MAPA --- */}

          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Clientes</Text>

          {clientes.length === 0 && (
            <Text style={styles.emptyText}>
              Aún no hay clientes registrados.
            </Text>
          )}

          {clientes.map((c, i) => {
            const deuda = deudas[c.id] || 0;
            return (
              <View key={c.id} style={styles.clienteRow}>
                <View style={styles.numero}>
                  <Text style={styles.numeroText}>{i + 1}</Text>
                </View>
                <View style={styles.clienteInfo}>
                  <Text style={styles.clienteNombre} numberOfLines={1}>
                    {c.nombre}
                  </Text>
                  {!!c.direccion && (
                    <View style={styles.dirRow}>
                      <Ionicons
                        name="location-outline"
                        size={13}
                        color={Palette.textMuted}
                      />
                      <Text style={styles.dirText} numberOfLines={1}>
                        {c.direccion}
                      </Text>
                    </View>
                  )}
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
                      {deuda > 0 ? `Debe ${clp(deuda)}` : "Al día"}
                    </Text>
                  </View>
                </View>
                {deuda > 0 && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.cobrarBtn,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() =>
                      router.push({
                        pathname: "/registrar-pago",
                        params: { clienteId: c.id },
                      } as any)
                    }
                  >
                    <Text style={styles.cobrarText}>Cobrar/Abonar</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.cream,
  },
  mapContainer: {
    width: "100%",
    height: 250,
    borderRadius: 16,
    overflow: "hidden",
    marginVertical: 10,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  mapHint: {
    fontSize: 12,
    color: Palette.textMuted,
    marginBottom: 8,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  hero: {
    backgroundColor: Palette.navy,
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  heroHello: { fontSize: 13, color: Palette.onNavyMuted },
  heroBrand: { fontSize: 22, fontWeight: "800", color: Palette.onNavy },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.onNavyFill,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCard: {
    backgroundColor: Palette.onNavyFill,
    borderRadius: 18,
    padding: 16,
  },
  summaryLabel: { fontSize: 12, fontWeight: "600", color: Palette.onNavyMuted },
  summaryBig: {
    fontSize: 20,
    fontWeight: "800",
    color: Palette.onNavy,
    marginTop: 4,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.onNavyFill,
    marginTop: 12,
    overflow: "hidden",
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: Palette.orange },
  jornadaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Palette.orange,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  jornadaBtnText: { color: Palette.onNavy, fontSize: 13, fontWeight: "800" },
  heroJornadaTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Palette.onNavyMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  gestionRow: { flexDirection: "row", gap: 10 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gestionChevron: { position: "absolute", top: 14, right: 12 },
  gestionCard: {
    flex: 1,
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    backgroundColor: Palette.onNavyFill,
    padding: 14,
    minHeight: 148,
  },
  gestionMint: {},
  gestionLila: {},
  gestionIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  gestionTitulo: { fontSize: 16, fontWeight: "800", color: Palette.onNavy },
  gestionSub: { fontSize: 12, lineHeight: 16, color: Palette.onNavyMuted },
  summarySmall: { fontSize: 13, color: Palette.onNavyMuted, marginTop: 10 },
  actionsContainer: {
    padding: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Palette.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  quick: {
    width: "47.5%",
    flexGrow: 1,
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  quickText: { flex: 1, fontSize: 14, fontWeight: "700", color: Palette.text },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  emptyText: { color: Palette.textMuted, textAlign: "center", marginTop: 8 },
  clienteRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 12,
    gap: 10,
  },
  numero: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Palette.grayPill,
    alignItems: "center",
    justifyContent: "center",
  },
  numeroText: { fontSize: 13, fontWeight: "700", color: Palette.textMuted },
  clienteInfo: { flex: 1, gap: 4 },
  clienteNombre: { fontSize: 15, fontWeight: "700", color: Palette.text },
  dirRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dirText: { flex: 1, fontSize: 12, color: Palette.textMuted },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { fontSize: 11, fontWeight: "700" },
  cobrarBtn: {
    backgroundColor: Palette.navy,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cobrarText: { color: Palette.onNavy, fontSize: 12, fontWeight: "700" },
});

export default HomeScreen;
