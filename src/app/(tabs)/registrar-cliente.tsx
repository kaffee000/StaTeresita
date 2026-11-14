import Header from "@/components/Header";
import { Palette } from "@/constants/palette";
import { geocodificarDireccion } from "@/lib/geocoding";
import { supabase } from "@/lib/supabase";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Región usada solo para mejorar la geocodificación (no se guarda en la BD).
const PAIS = "Chile";
const REGION = "Región del Maule";

type Opcion = { id: string; nombre: string; padre_id?: string };

type Catalogo = {
  comunas: Opcion[];
  sectores: Opcion[]; // padre_id = comuna_id
  calles: Opcion[]; // padre_id = sector_id
  pasajes: Opcion[]; // padre_id = sector_id
};

const CATALOGO_VACIO: Catalogo = {
  comunas: [],
  sectores: [],
  calles: [],
  pasajes: [],
};

// Compara sin mayúsculas, tildes ni espacios extra ("Castaños" == "castanos ").
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buscarExacta = (opciones: Opcion[], texto: string) =>
  opciones.find((o) => normalizar(o.nombre) === normalizar(texto));

// -----------------------------------------------------------------------------
// Campo de texto con sugerencias de valores ya registrados.
// Si lo escrito no coincide con ninguno, se indica que se creará uno nuevo.
// -----------------------------------------------------------------------------
type CampoProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opciones: Opcion[];
  placeholder?: string;
  editable: boolean;
  obligatorio?: boolean;
  tipoNuevo: { nombre: string; femenino: boolean }; // para el aviso "Se creará..."
};

const CampoConSugerencias = ({
  label,
  value,
  onChange,
  opciones,
  placeholder,
  editable,
  obligatorio,
  tipoNuevo,
}: CampoProps) => {
  const [enfocado, setEnfocado] = useState(false);

  const exacta = buscarExacta(opciones, value);
  const sugerencias = useMemo(() => {
    const q = normalizar(value);
    return opciones
      .filter((o) => !q || normalizar(o.nombre).includes(q))
      .filter((o) => o !== exacta)
      .slice(0, 8);
  }, [opciones, value, exacta]);

  return (
    <View style={styles.campo}>
      <Text style={styles.label}>
        {label}
        {obligatorio ? " *" : ""}
      </Text>
      <TextInput
        style={[styles.input, enfocado && styles.inputFocused]}
        value={value}
        onChangeText={onChange}
        onFocus={() => setEnfocado(true)}
        // Se espera un momento para que el toque en una sugerencia alcance a registrarse
        onBlur={() => setTimeout(() => setEnfocado(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={Palette.textFaint}
        editable={editable}
        autoCapitalize="words"
      />

      {enfocado && sugerencias.length > 0 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
        >
          {sugerencias.map((o) => (
            <Pressable
              key={o.id}
              style={styles.chip}
              onPress={() => onChange(o.nombre)}
            >
              <Text style={styles.chipText}>{o.nombre}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {value.trim() !== "" && (
        <Text style={[styles.hint, exacta ? styles.hintOk : styles.hintNuevo]}>
          {exacta
            ? `✓ ${tipoNuevo.nombre} ${tipoNuevo.femenino ? "registrada" : "registrado"}`
            : `Se creará ${tipoNuevo.femenino ? "una nueva" : "un nuevo"} ${tipoNuevo.nombre}`}
        </Text>
      )}
    </View>
  );
};

// -----------------------------------------------------------------------------

const RegistrarCliente = () => {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [rut, setRut] = useState("");
  const [telefono, setTelefono] = useState("");

  // Dirección: comuna -> sector -> calle / pasaje -> número
  const [comuna, setComuna] = useState("");
  const [sector, setSector] = useState("");
  const [calle, setCalle] = useState("");
  const [pasaje, setPasaje] = useState("");
  const [numero, setNumero] = useState("");
  const [referencia, setReferencia] = useState("");

  const [catalogo, setCatalogo] = useState<Catalogo>(CATALOGO_VACIO);
  const [loading, setLoading] = useState(false);

  // Carga comunas, sectores, calles y pasajes existentes cada vez que se abre la pestaña
  useFocusEffect(
    useCallback(() => {
      let activo = true;
      (async () => {
        const [co, se, ca, pa] = await Promise.all([
          supabase.from("comunas").select("id, nombre").eq("activo", true).order("nombre"),
          supabase.from("sectores").select("id, nombre, comuna_id").eq("activo", true).order("nombre"),
          supabase.from("calles").select("id, nombre, sector_id").eq("activo", true).order("nombre"),
          supabase.from("pasajes").select("id, nombre, sector_id").eq("activo", true).order("nombre"),
        ]);
        const err = co.error ?? se.error ?? ca.error ?? pa.error;
        if (err) console.warn("Error al cargar ubicaciones:", err);
        if (!activo) return;

        const nuevo: Catalogo = {
          comunas: co.data ?? [],
          sectores: (se.data ?? []).map((s) => ({ id: s.id, nombre: s.nombre, padre_id: s.comuna_id })),
          calles: (ca.data ?? []).map((c) => ({ id: c.id, nombre: c.nombre, padre_id: c.sector_id })),
          pasajes: (pa.data ?? []).map((p) => ({ id: p.id, nombre: p.nombre, padre_id: p.sector_id })),
        };
        setCatalogo(nuevo);
        // Si solo hay una comuna, se deja preseleccionada
        if (nuevo.comunas.length === 1) {
          setComuna((actual) => actual || nuevo.comunas[0].nombre);
        }
      })();
      return () => {
        activo = false;
      };
    }, []),
  );

  // Opciones filtradas según el nivel superior elegido
  const comunaSel = buscarExacta(catalogo.comunas, comuna);
  const sectoresDeComuna = comunaSel
    ? catalogo.sectores.filter((s) => s.padre_id === comunaSel.id)
    : [];
  const sectorSel = buscarExacta(sectoresDeComuna, sector);
  const callesDeSector = sectorSel
    ? catalogo.calles.filter((c) => c.padre_id === sectorSel.id)
    : [];
  const pasajesDeSector = sectorSel
    ? catalogo.pasajes.filter((p) => p.padre_id === sectorSel.id)
    : [];

  const limpiarFormulario = () => {
    setNombre("");
    setRut("");
    setTelefono("");
    setSector("");
    setCalle("");
    setPasaje("");
    setNumero("");
    setReferencia("");
  };

  const guardarCliente = async () => {
    if (!nombre.trim() || !rut.trim() || !telefono.trim()) {
      Alert.alert("Error", "El nombre, RUT y teléfono son obligatorios");
      return;
    }
    if (!comuna.trim() || !sector.trim() || !calle.trim()) {
      Alert.alert("Error", "La comuna, el sector y la calle son obligatorios");
      return;
    }

    // Usa el nombre ya registrado si coincide (evita duplicados por tildes/mayúsculas)
    const comunaFinal = comunaSel?.nombre ?? comuna.trim();
    const sectorFinal = sectorSel?.nombre ?? sector.trim();
    const calleFinal = buscarExacta(callesDeSector, calle)?.nombre ?? calle.trim();
    const pasajeFinal = pasaje.trim()
      ? (buscarExacta(pasajesDeSector, pasaje)?.nombre ?? pasaje.trim())
      : null;

    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert("Error", "No hay una sesión activa");
        return;
      }

      // =====================================================================
      // CÁLCULO DE LATITUD Y LONGITUD
      // Usa comuna, sector, calle, pasaje y número (ver src/lib/geocoding.ts).
      // Si no se encuentra la ubicación, el cliente se registra igual sin coordenadas.
      // =====================================================================
      const coords = await geocodificarDireccion({
        pais: PAIS,
        region: REGION,
        ciudad: comunaFinal,
        sector: sectorFinal,
        calle: calleFinal,
        pasaje: pasajeFinal,
        numero,
      });
      console.log("Coordenadas calculadas:", coords);

      // Inserta/reutiliza comuna, sector, calle, pasaje y dirección, y crea el cliente
      const { error } = await supabase.rpc("registrar_cliente", {
        p_nombre: nombre,
        p_rut: rut,
        p_telefono: telefono,
        p_comuna: comunaFinal,
        p_sector: sectorFinal,
        p_calle: calleFinal,
        p_pasaje: pasajeFinal,
        p_numero: numero.trim() || null,
        p_referencia: referencia.trim() || null,
        p_latitud: coords?.latitud ?? null,
        p_longitud: coords?.longitud ?? null,
      });
      if (error) throw error;

      Alert.alert(
        "Éxito",
        coords
          ? `Cliente registrado. Ubicación: ${coords.latitud.toFixed(5)}, ${coords.longitud.toFixed(5)}`
          : "Cliente registrado, pero no se pudo calcular la ubicación de la dirección.",
      );

      limpiarFormulario();
      router.back();
    } catch (error: any) {
      console.error(error);
      Alert.alert("Error al guardar", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["left", "right", "bottom"]}>
      <Header title="Nuevo Cliente" />

      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Nombre completo *</Text>
        <TextInput
          style={styles.input}
          value={nombre}
          onChangeText={setNombre}
          placeholder="Ej. Juan Pérez"
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>RUT *</Text>
        <TextInput
          style={styles.input}
          value={rut}
          onChangeText={setRut}
          placeholder="Ej. 12345678-9"
          placeholderTextColor={Palette.textFaint}
          autoCapitalize="characters"
          editable={!loading}
        />

        <Text style={styles.label}>Teléfono *</Text>
        <TextInput
          style={styles.input}
          value={telefono}
          onChangeText={setTelefono}
          placeholder="Ej. +56 9 1234 5678"
          keyboardType="phone-pad"
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.sectionTitle}>Dirección</Text>

        <CampoConSugerencias
          label="Comuna"
          obligatorio
          tipoNuevo={{ nombre: "comuna", femenino: true }}
          value={comuna}
          onChange={(v) => {
            setComuna(v);
          }}
          opciones={catalogo.comunas}
          placeholder="Ej. Molina"
          editable={!loading}
        />

        <CampoConSugerencias
          label="Sector / Villa / Población"
          obligatorio
          tipoNuevo={{ nombre: "sector", femenino: false }}
          value={sector}
          onChange={setSector}
          opciones={sectoresDeComuna}
          placeholder="Ej. Villa Los Aromos"
          editable={!loading}
        />

        <CampoConSugerencias
          label="Calle"
          obligatorio
          tipoNuevo={{ nombre: "calle", femenino: true }}
          value={calle}
          onChange={setCalle}
          opciones={callesDeSector}
          placeholder="Ej. Los Aromos"
          editable={!loading}
        />

        <CampoConSugerencias
          label="Pasaje (opcional)"
          tipoNuevo={{ nombre: "pasaje", femenino: false }}
          value={pasaje}
          onChange={setPasaje}
          opciones={pasajesDeSector}
          placeholder="Ej. Pasaje 1"
          editable={!loading}
        />

        <Text style={styles.label}>Número de casa / Sitio</Text>
        <TextInput
          style={styles.input}
          value={numero}
          onChangeText={setNumero}
          placeholder="Ej. 1234, Sitio 5 o km 3"
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>Referencia</Text>
        <TextInput
          style={[styles.input, styles.inputMultilinea]}
          value={referencia}
          onChangeText={setReferencia}
          placeholder="Ej. Casa esquina, reja verde"
          placeholderTextColor={Palette.textFaint}
          multiline
          editable={!loading}
        />

        <Pressable
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={guardarCliente}
          disabled={loading}
        >
          <Text style={styles.submitButtonText}>
            {loading ? "Guardando..." : "Guardar Cliente"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  form: { padding: 24, paddingBottom: 40 },
  campo: {},
  label: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 6,
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: Palette.navy,
    marginTop: 12,
    marginBottom: 14,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 18,
    fontSize: 16,
    color: Palette.text,
  },
  inputFocused: { borderColor: Palette.navy },
  inputMultilinea: {
    height: 84,
    paddingTop: 14,
    textAlignVertical: "top",
  },
  chips: { gap: 8, paddingBottom: 6 },
  chipsScroll: { marginTop: -10, marginBottom: 10 },
  chip: {
    backgroundColor: Palette.navySoft,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { color: Palette.navy, fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, marginTop: -12, marginBottom: 14 },
  hintOk: { color: Palette.green },
  hintNuevo: { color: Palette.amber },
  submitButton: {
    backgroundColor: Palette.navy,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  submitButtonDisabled: {
    backgroundColor: "#8C90B5",
  },
  submitButtonText: { color: Palette.onNavy, fontSize: 16, fontWeight: "700" },
});

export default RegistrarCliente;
