import { Palette } from "@/constants/palette";
import { esGerente } from "@/lib/demoJornada";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

export default function TabLayout() {
  const [rolUsuario, setRolUsuario] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const soyGerente = esGerente(rolUsuario);

  useEffect(() => {
    async function fetchUserRole() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data, error } = await supabase
            .from("perfiles")
            .select("rol")
            .eq("id", user.id)
            .single();

          if (data && !error) {
            setRolUsuario(data.rol);
          }
        }
      } catch (error) {
        console.error(
          "Error al obtener el rol del usuario para las pestañas:",
          error,
        );
      } finally {
        setLoading(false);
      }
    }

    fetchUserRole();
  }, []);

  if (loading) {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Palette.navy,
        headerShown: false,
        tabBarStyle: {
          elevation: 0,
          height: Platform.OS === "ios" ? 85 : 65,
          paddingBottom: Platform.OS === "ios" ? 25 : 10,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          paddingBottom: 4,
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "",
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="clientes"
        options={{
          title: "",
          tabBarIcon: ({ color }) => (
            <Ionicons name="people-outline" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="registrar-cliente"
        options={{
          title: "",
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-add-outline" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="registrar-venta"
        options={{
          title: "",
          tabBarIcon: ({ color }) => (
            <Ionicons name="cart-outline" size={24} color={color} />
          ),
        }}
      />

      {/* Solicitudes de descuento: visible SOLAMENTE para el gerente/administrador.
          Se oculta con href: null (si no se renderiza, Expo Router la agrega igual como pestaña). */}
      <Tabs.Screen
        name="solicitudes-descuento"
        options={{
          title: "",
          href: soyGerente ? undefined : null,
          tabBarIcon: ({ color }) => (
            <Ionicons name="pricetag-outline" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="ver-historial"
        options={{
          title: "",
          tabBarIcon: ({ color }) => (
            <Ionicons name="time-outline" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
