// app/index.tsx
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { Palette } from '@/constants/palette'


const Index = () => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {

    if (!email || !password) {
      Alert.alert('Error', 'Por favor ingresa tu correo y contraseña')
      return
    }
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      Alert.alert('Error al iniciar sesión', error.message)
      setLoading(false)
    } else {
      setLoading(false)
      router.replace('./(tabs)/home');

    }

  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* Cabecera de marca */}
      <View style={[styles.hero, { paddingTop: insets.top + 40 }]}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>ST</Text>
        </View>
        <Text style={styles.brand}>Santa Teresita</Text>
        <Text style={styles.brandSubtitle}>Artículos para el hogar, casa por casa</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Bienvenido</Text>
          <Text style={styles.subtitle}>Inicia sesión para continuar</Text>

          {/* Campo de correo */}
          <Text style={styles.label}>Correo</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color={Palette.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="correo@ejemplo.com"
              placeholderTextColor={Palette.textFaint}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Campo de contraseña */}
          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={Palette.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Contraseña"
              placeholderTextColor={Palette.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!mostrarPassword}
            />
            <Pressable 
              onPress={() => setMostrarPassword(!mostrarPassword)}
              style={styles.eyeIcon}
            >
              <Ionicons 
                name={mostrarPassword ? "eye-outline" : "eye-off-outline"} 
                size={20} 
                color={Palette.textMuted} 
              />
            </Pressable>
          </View>

          {/* Botón de inicio de sesión */}
          <Pressable 
            onPress={handleLogin}
            disabled={loading}
            style={({ pressed }) => [
              styles.loginButton,
              (pressed || loading) && styles.buttonPressed
            ]}
          >
            {loading ? (
              <ActivityIndicator color={Palette.onNavy} />
            ) : (
              <Text style={styles.loginButtonText}>Iniciar Sesión</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  hero: {
    backgroundColor: Palette.navy,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 96,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: Palette.onNavyFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logoText: { color: Palette.onNavy, fontSize: 22, fontWeight: '800' },
  brand: { fontSize: 30, fontWeight: '800', color: Palette.onNavy },
  brandSubtitle: { fontSize: 14, color: Palette.onNavyMuted, marginTop: 6, textAlign: 'center' },
  content: { paddingHorizontal: 20, marginTop: -64 },
  card: {
    backgroundColor: Palette.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    shadowColor: Palette.navyDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  title: { fontSize: 20, fontWeight: '700', color: Palette.text },
  subtitle: { fontSize: 14, color: Palette.textMuted, marginTop: 4, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: Palette.text, marginBottom: 6 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.inputFill,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    height: 52,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: Palette.text },
  eyeIcon: { padding: 8 },
  loginButton: {
    backgroundColor: Palette.navy,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonPressed: { opacity: 0.7 },
  loginButtonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
})

export default Index
