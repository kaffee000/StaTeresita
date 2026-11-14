// Mapa de clientes para web (MapLibre + mapa base de OpenStreetMap, sin API key).
// react-native-maps no funciona en web; Metro usa este archivo en lugar de MapaClientes.tsx.

import { Palette } from "@/constants/palette";
import { clp } from "@/lib/format";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Map, {
  MapRef,
  Marker,
  NavigationControl,
  Popup,
  type StyleSpecification,
} from "react-map-gl/maplibre";
import {
  CENTRO_INICIAL,
  deudaTotal,
  MapaClientesProps,
  titulo,
  UbicacionMapa,
} from "./mapaClientes.types";

const ESTILO_OSM: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Carga MapLibre solo en el navegador (no en el render estático del servidor) y le
// indica dónde está su worker, copiado a public/ por scripts/copiar-worker-maplibre.js.
let mapLibPromise: Promise<typeof import("maplibre-gl")> | null = null;
const cargarMapLibre = () =>
  (mapLibPromise ??= import("maplibre-gl").then((m) => {
    m.setWorkerUrl(new URL("/maplibre-gl-worker.mjs", window.location.origin).href);
    return m;
  }));

export default function MapaClientes({
  ubicaciones,
  onPressCliente,
}: MapaClientesProps) {
  const mapRef = useRef<MapRef>(null);
  const [listo, setListo] = useState(false);
  // En el render estático del servidor no hay `window`: el mapa se monta solo en el navegador
  const [enNavegador, setEnNavegador] = useState(false);
  useEffect(() => setEnNavegador(true), []);
  const [seleccion, setSeleccion] = useState<UbicacionMapa | null>(null);

  // Encuadra el mapa para que se vean todos los puntos guardados
  const encuadrar = useCallback(() => {
    const map = mapRef.current;
    if (!map || !ubicaciones.length) return;
    if (ubicaciones.length === 1) {
      const u = ubicaciones[0];
      map.flyTo({ center: [u.longitud, u.latitud], zoom: 16, duration: 400 });
      return;
    }
    const lngs = ubicaciones.map((u) => u.longitud);
    const lats = ubicaciones.map((u) => u.latitud);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      // Más margen arriba: el pin se dibuja hacia arriba desde la coordenada
      { padding: { top: 60, bottom: 30, left: 40, right: 40 }, maxZoom: 16, duration: 400 },
    );
  }, [ubicaciones]);

  useEffect(() => {
    if (listo) encuadrar();
  }, [listo, encuadrar]);

  if (!enNavegador) return null;

  return (
    <Map
      ref={mapRef}
      mapLib={cargarMapLibre()}
      initialViewState={{
        longitude: CENTRO_INICIAL.longitud,
        latitude: CENTRO_INICIAL.latitud,
        zoom: 12,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={ESTILO_OSM}
      onLoad={() => setListo(true)}
    >
      <NavigationControl position="top-right" showCompass={false} />

      {ubicaciones.map((u) => (
        <Marker
          key={u.id}
          longitude={u.longitud}
          latitude={u.latitud}
          anchor="bottom"
          color={deudaTotal(u) > 0 ? Palette.amber : Palette.green}
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setSeleccion(u);
          }}
        />
      ))}

      {seleccion && (
        <Popup
          longitude={seleccion.longitud}
          latitude={seleccion.latitud}
          offset={36}
          maxWidth="260px"
          onClose={() => setSeleccion(null)}
          closeOnClick={false}
        >
          <div style={{ fontFamily: "system-ui, sans-serif", color: Palette.text, minWidth: 160 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{titulo(seleccion)}</div>
            <div style={{ fontSize: 12, color: Palette.textMuted, marginBottom: 6 }}>
              {seleccion.direccion}
            </div>
            {seleccion.clientes.map((c) => (
              <div
                key={c.id}
                onClick={onPressCliente ? () => onPressCliente(c.id) : undefined}
                style={{
                  fontSize: 13,
                  padding: "3px 0",
                  cursor: onPressCliente ? "pointer" : "default",
                  color: Palette.navy,
                }}
              >
                {seleccion.clientes.length > 1 ? `${c.nombre} · ` : ""}
                <span style={{ color: c.deuda > 0 ? Palette.amber : Palette.green }}>
                  {c.deuda > 0 ? `Debe ${clp(c.deuda)}` : "Al día"}
                </span>
              </div>
            ))}
          </div>
        </Popup>
      )}
    </Map>
  );
}
