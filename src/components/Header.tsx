import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Palette } from '@/constants/palette'


interface HeaderProps {
  title: string
}

const Header = (props: HeaderProps) => {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const volver = () => {
    if (router.canGoBack()) { 
      router.back()
    }
  }

  const cerrarSesion = () => {

    router.replace('/')
    console.log('Cerrando sesión...')
  }

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={volver} style={styles.iconButton}>
        <Ionicons size={22} color={Palette.onNavy} name='arrow-back-outline' />
      </Pressable>

      <Text style={styles.title}>{props.title}</Text>

      <Pressable onPress={cerrarSesion} style={styles.iconButton}>
        <Ionicons size={22} color={Palette.onNavy} name='log-out-outline' />
      </Pressable>
    </View>
  )
}


const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: Palette.navy,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.onNavyFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.onNavy,
  },
})

export default Header
