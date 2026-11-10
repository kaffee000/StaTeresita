import { Palette } from "@/constants/palette";
import { geocodificarDireccion } from "@/lib/geocoding";
import { useRouter } from "expo-router";
import { useState } from "react";
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
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

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

      // Calcular latitud y longitud a partir de la dirección ingresada
      const coords = await geocodificarDireccion({
        pais,
        region,
        ciudad,
        calle,
        numero,
      });
      const latitud = coords?.latitud ?? null;
      const longitud = coords?.longitud ?? null;
      console.log("Coordenadas calculadas:", coords);

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
            latitud: latitud,
            longitud: longitud,
          },
        ]);

      if (errorDireccion) throw errorDireccion;

      Alert.alert(
        "Éxito",
        coords
          ? `Cliente registrado. Ubicación: ${coords.latitud.toFixed(5)}, ${coords.longitud.toFixed(5)}`
          : "Cliente registrado, pero no se pudo calcular la ubicación de la dirección.",
      );

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
