import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'

// Stack en la raíz: login (index), las pestañas (tabs) y las pantallas
// que se abren encima de ellas (registrar-pago, cliente/[id], etc.),
// para que el botón "volver" del Header funcione.
const RootLayout = () => {
    return (
        <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false }} />
            <StatusBar style='light' />
        </View>
    )
}

export default RootLayout
