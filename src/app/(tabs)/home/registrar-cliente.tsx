import { Palette } from "@/constants/palette";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../../components/Header";
import { supabase } from "../../../lib/supabase";

const RegistrarCliente = () => {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [rut, setRut] = useState("");
  const [telefono, setTelefono] = useState("");

  // Campos para la tabla direcciones
  const [pais, setPais] = useState("Chile");
  const [region, setRegion] = useState("Región del Maule");
  const [ciudad, setCiudad] = useState("Colbún");
  const [calle, setCalle] = useState("");
  const [numero, setNumero] = useState("");

  const [loading, setLoading] = useState(false);

  const guardarCliente = async () => {
    if (!nombre || !telefono || !rut || !calle) {
      Alert.alert("Error", "El nombre, RUT, teléfono y calle son obligatorios");
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert("Error", "No hay una sesión activa");
        setLoading(false);
        return;
      }

      // =========================================================================
      // INICIO DE LA SECCIÓN QUE CALCULA LA LATITUD Y LONGITUD
      // =========================================================================
      let latitud: number | null = null;
      let longitud: number | null = null;

      try {
        // Pedir permisos de uso de ubicación si el sistema lo requiere
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status === 'granted') {
          const direccionCompleta = `${calle} ${numero ? `N° ${numero}` : ""}, ${ciudad}, ${region}, ${pais}`;
          console.log("Buscando coordenadas para:", direccionCompleta); // Para depurar en consola

          const resultadosGeocoding = await Location.geocodeAsync(direccionCompleta);
          console.log("Resultado geocoding:", resultadosGeocoding); // Ver qué devuelve

          if (resultadosGeocoding.length > 0) {
            latitud = resultadosGeocoding[0].latitude;
            longitud = resultadosGeocoding[0].longitude;
          }
        } else {
          console.log("Permiso de ubicación denegado por el usuario.");
        }
      } catch (geoError) {
        console.warn("Error en geocodificación:", geoError);
      }
      try {
        // 1. Unimos todas las casillas de texto en una sola dirección legible
        const direccionCompleta = `${calle} ${numero ? `N° ${numero}` : ""}, ${ciudad}, ${region}, ${pais}`;

        // 2. Usamos expo-location para convertir el texto en coordenadas geográficas
        const resultadosGeocoding =
          await Location.geocodeAsync(direccionCompleta);

        // 3. Si encuentra resultados, extraemos la latitud y longitud
        if (resultadosGeocoding.length > 0) {
          latitud = resultadosGeocoding[0].latitude;
          longitud = resultadosGeocoding[0].longitude;
        }
      } catch (geoError) {
        console.warn(
          "No se pudo obtener la geolocalización automática:",
          geoError,
        );
      }
      // =========================================================================
      // FIN DE LA SECCIÓN DE CÁLCULO DE COORDENADAS
      // =========================================================================

      // 1. Insertar en la tabla 'clientes'
      const { data: clienteCreado, error: errorCliente } = await supabase
        .from("clientes")
        .insert([
          {
            nombre: nombre,
            rut: rut,
            telefono: telefono,
            creado_por: user.id,
          },
        ])
        .select("id")
        .single();

      if (errorCliente) throw errorCliente;

      // 2. Insertar en la tabla 'direcciones' incluyendo las coordenadas calculadas
      const { error: errorDireccion } = await supabase
        .from("direcciones")
        .insert([
          {
            cliente_id: clienteCreado.id,
            pais: pais,
            region: region,
            ciudad: ciudad,
            calle: calle,
            numero: numero ? numero : null,
            latitud: latitud, // <--- Se guarda el resultado del cálculo
            longitud: longitud, // <--- Se guarda el resultado del cálculo
          },
        ]);

      if (errorDireccion) throw errorDireccion;

      Alert.alert("Éxito", "Cliente y dirección registrados con ubicación");

      // Limpiar estados
      setNombre("");
      setRut("");
      setTelefono("");
      setCalle("");
      setNumero("");
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

      <ScrollView contentContainerStyle={styles.form}>
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

        <Text style={styles.label}>País</Text>
        <TextInput
          style={styles.input}
          value={pais}
          onChangeText={setPais}
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>Región</Text>
        <TextInput
          style={styles.input}
          value={region}
          onChangeText={setRegion}
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>Ciudad / Comuna</Text>
        <TextInput
          style={styles.input}
          value={ciudad}
          onChangeText={setCiudad}
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>Calle / Pasaje / Villa *</Text>
        <TextInput
          style={styles.input}
          value={calle}
          onChangeText={setCalle}
          placeholder="Ej. Pasaje Los Aromos"
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>Número de casa / Sitio</Text>
        <TextInput
          style={styles.input}
          value={numero}
          onChangeText={setNumero}
          placeholder="Ej. 1234 o Sitio 5"
          placeholderTextColor={Palette.textFaint}
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
