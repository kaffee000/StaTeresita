// Geocodificación de direcciones: convierte calle/número/ciudad/región/país
// en latitud y longitud para guardarlas en la tabla `direcciones` de Supabase.
//
// Estrategia:
//   1. En iOS/Android se usa el geocodificador nativo (expo-location).
//   2. Si no hay resultado (o estamos en web, donde expo-location ya no geocodifica),
//      se usa Nominatim (OpenStreetMap), que no requiere API key.
//   3. Si con número no se encuentra, se reintenta solo con la calle.

import * as Location from "expo-location";
import { Platform } from "react-native";

export type DireccionInput = {
  pais: string;
  region: string;
  ciudad: string;
  calle: string;
  numero?: string | null;
};

export type Coordenadas = {
  latitud: number;
  longitud: number;
  fuente: "nativo" | "osm";
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const limpiar = (s?: string | null) => (s ?? "").trim();

// Solo aceptamos coordenadas dentro de un rango razonable para Chile continental/insular,
// para evitar guardar coincidencias de otro país con el mismo nombre de calle.
const dentroDeChile = (lat: number, lng: number) =>
  lat >= -56.5 && lat <= -17 && lng >= -110 && lng <= -66;

const esValida = (lat: number, lng: number, pais: string) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  (pais.toLowerCase() !== "chile" || dentroDeChile(lat, lng));

async function geocodificarNativo(
  d: DireccionInput,
): Promise<Coordenadas | null> {
  if (Platform.OS === "web") return null;

  try {
    // En Android el geocodificador exige permiso de ubicación.
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      ({ status } = await Location.requestForegroundPermissionsAsync());
    }
    if (status !== "granted") return null;

    const calleNumero = [limpiar(d.calle), limpiar(d.numero)]
      .filter(Boolean)
      .join(" ");
    const texto = [calleNumero, d.ciudad, d.region, d.pais]
      .map(limpiar)
      .filter(Boolean)
      .join(", ");

    const resultados = await Location.geocodeAsync(texto);
    const r = resultados.find((x) =>
      esValida(x.latitude, x.longitude, limpiar(d.pais)),
    );
    return r
      ? { latitud: r.latitude, longitud: r.longitude, fuente: "nativo" }
      : null;
  } catch (e) {
    console.warn("Geocodificación nativa falló:", e);
    return null;
  }
}

async function buscarNominatim(
  street: string,
  d: DireccionInput,
): Promise<Coordenadas | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    street,
    city: limpiar(d.ciudad),
    state: limpiar(d.region),
    country: limpiar(d.pais),
  });
  if (limpiar(d.pais).toLowerCase() === "chile") {
    params.set("countrycodes", "cl");
  }

  // En web el navegador no permite cambiar el User-Agent (envía Referer),
  // en nativo nos identificamos como pide la política de uso de Nominatim.
  const headers: Record<string, string> = { "Accept-Language": "es" };
  if (Platform.OS !== "web") headers["User-Agent"] = "StaTeresita/1.0";

  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers,
  });
  if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);

  const data: { lat: string; lon: string }[] = await res.json();
  if (!data.length) return null;

  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  return esValida(lat, lng, limpiar(d.pais))
    ? { latitud: lat, longitud: lng, fuente: "osm" }
    : null;
}

async function geocodificarOSM(d: DireccionInput): Promise<Coordenadas | null> {
  const calle = limpiar(d.calle);
  const numero = limpiar(d.numero);
  try {
    if (numero) {
      const conNumero = await buscarNominatim(`${numero} ${calle}`, d);
      if (conNumero) return conNumero;
    }
    return await buscarNominatim(calle, d);
  } catch (e) {
    console.warn("Geocodificación OpenStreetMap falló:", e);
    return null;
  }
}

/**
 * Calcula latitud y longitud de una dirección. Devuelve `null` si no se encontró,
 * nunca lanza error (el registro del cliente no debe fallar por esto).
 */
export async function geocodificarDireccion(
  d: DireccionInput,
): Promise<Coordenadas | null> {
  if (!limpiar(d.calle)) return null;
  return (await geocodificarNativo(d)) ?? (await geocodificarOSM(d));
}
