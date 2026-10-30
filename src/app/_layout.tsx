import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'

const RootLayout = () => {
    return (
        <View style={{ flex: 1 }}>
            <Slot />
            <StatusBar style='light' />
        </View>
    )
}

export default RootLayout
