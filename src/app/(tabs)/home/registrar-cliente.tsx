import { Palette } from "@/constants/palette";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../../components/Header";
import { supabase } from "../../../lib/supabase";

const RegistrarCliente = () => {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [rut, setRut] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");

  const [loading, setLoading] = useState(false);

  const guardarCliente = async () => {
    // 1. Validamos que los campos obligatorios no estén vacíos
    if (!nombre || !telefono || !rut || !direccion) {
      Alert.alert("Error", "El nombre, RUT y teléfono son obligatorios");
      return;
    }

    setLoading(true);
    try {
      // 2. Obtenemos el ID del usuario que está usando la app
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert("Error", "No hay una sesión activa");
        setLoading(false);
        return;
      }

      // 3. Insertamos los datos en la tabla clientes
      const { error } = await supabase.from("clientes").insert([
        {
          nombre: nombre,
          rut: rut,
          telefono: telefono,
          direccion: direccion,
          creado_por: user.id,
        },
      ]);

      if (error) throw error;

      Alert.alert("Éxito", "Cliente registrado correctamente");

      // 4. Limpiamos el formulario y volvemos al menú
      setNombre("");
      setRut("");
      setTelefono("");
      setDireccion("");
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

      <View style={styles.form}>
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

        <Text style={styles.label}>Dirección *</Text>
        <TextInput
          style={styles.input}
          value={direccion}
          onChangeText={setDireccion}
          placeholder="Ej. Calle Principal 123"
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
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  form: { padding: 24 },
  label: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 6,
    fontWeight: "600",
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
