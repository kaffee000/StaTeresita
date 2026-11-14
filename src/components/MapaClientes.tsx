// Mapa de clientes para iOS / Android (react-native-maps).
// La versión web está en MapaClientes.web.tsx (Metro elige el archivo según la plataforma).

import { Palette } from "@/constants/palette";
import { clp } from "@/lib/format";
import { useCallback, useEffect, useRef } from "react";
import { Alert, StyleSheet } from "react-native";
import MapView, { Marker } from "react-native-maps";
import {
  CENTRO_INICIAL,
  deudaTotal,
  MapaClientesProps,
  titulo,
} from "./mapaClientes.types";

export default function MapaClientes({
  ubicaciones,
  onPressCliente,
}: MapaClientesProps) {
  const mapRef = useRef<MapView>(null);

  // Encuadra el mapa para que se vean todos los puntos guardados
  const encuadrar = useCallback(() => {
    if (!mapRef.current || !ubicaciones.length) return;
    if (ubicaciones.length === 1) {
      const u = ubicaciones[0];
      mapRef.current.animateToRegion(
        {
          latitude: u.latitud,
          longitude: u.longitud,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        400,
      );
      return;
    }
    mapRef.current.fitToCoordinates(
      ubicaciones.map((u) => ({ latitude: u.latitud, longitude: u.longitud })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true },
    );
  }, [ubicaciones]);

  // Los datos llegan después de que el mapa está listo: se encuadra al cambiar
  useEffect(() => {
    encuadrar();
  }, [encuadrar]);

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      initialRegion={{
        latitude: CENTRO_INICIAL.latitud,
        longitude: CENTRO_INICIAL.longitud,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
      onMapReady={encuadrar}
      onLongPress={(e) => {
        const c = e.nativeEvent.coordinate;
        Alert.alert(
          "Punto seleccionado",
          `Lat: ${c.latitude.toFixed(5)}, Lng: ${c.longitude.toFixed(5)}`,
        );
      }}
    >
      {ubicaciones.map((u) => {
        const deuda = deudaTotal(u);
        const nombres = u.clientes
          .map((c) => (c.deuda > 0 ? `${c.nombre} (debe ${clp(c.deuda)})` : c.nombre))
          .join("\n");
        return (
          <Marker
            key={u.id}
            coordinate={{ latitude: u.latitud, longitude: u.longitud }}
            pinColor={deuda > 0 ? Palette.amber : Palette.green}
            title={titulo(u)}
            description={
              u.clientes.length === 1
                ? `${u.direccion} · ${deuda > 0 ? `Debe ${clp(deuda)}` : "Al día"}`
                : `${u.direccion}\n${nombres}`
            }
            // Tocar la burbuja abre la ficha del cliente (si hay uno solo en esa casa)
            onCalloutPress={
              u.clientes.length === 1 && onPressCliente
                ? () => onPressCliente(u.clientes[0].id)
                : undefined
            }
          />
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", height: "100%" },
});
