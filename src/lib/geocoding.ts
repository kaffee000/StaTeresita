// Geocodificación de direcciones: convierte comuna/sector/calle/pasaje/número
// en latitud y longitud para guardarlas en la tabla `direcciones` de Supabase.
//
// Estrategia (se detiene en el primer resultado válido):
//   1. En iOS/Android se usa el geocodificador nativo (expo-location).
//   2. Si no hay resultado (o estamos en web, donde expo-location ya no geocodifica),
//      se usa Nominatim (OpenStreetMap), que no requiere API key.
//   En ambos casos se prueba de lo más preciso a lo más general:
//      calle + número -> pasaje + número -> calle en el sector -> calle -> pasaje -> sector.
//
// Cada resultado se VALIDA antes de aceptarlo, porque los buscadores devuelven
// "lo más parecido" aunque sea otra calle u otra comuna:
//   - la calle encontrada debe llamarse como la buscada,
//   - debe estar en la comuna indicada,
//   - si se buscó por pasaje o por sector, debe estar en ese sector/villa
//     ("Pasaje 1" existe en casi todas las villas).
// Es preferible no guardar coordenadas a guardar una ubicación equivocada.

import * as Location from "expo-location";
import { Platform } from "react-native";

export type DireccionInput = {
  pais: string;
  region: string;
  ciudad: string; // comuna
  calle: string;
  numero?: string | null;
  sector?: string | null; // villa / población / sector
  pasaje?: string | null;
};

export type Coordenadas = {
  latitud: number;
  longitud: number;
  fuente: "nativo" | "osm";
  /** Qué búsqueda encontró el punto (para saber qué tan preciso es). */
  precision: Intento["nivel"];
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const limpiar = (s?: string | null) => (s ?? "").trim();

const unir = (partes: (string | null | undefined)[], sep = ", ") =>
  partes.map(limpiar).filter(Boolean).join(sep);

/** Minúsculas, sin tildes ni signos: "Bernardo O'Higgins" -> "bernardo ohiggins". */
const normalizar = (s?: string | null) =>
  limpiar(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Quita prefijos que cambian entre fuentes: "Pasaje", "Calle", "Villa", "Población"... */
const nucleo = (s?: string | null) =>
  normalizar(s)
    .replace(
      /^(pasaje|psje|pje|calle|avenida|av|camino|villa|poblacion|pobl|sector|condominio|conjunto|barrio)\s+/,
      "",
    )
    .trim();

/** Mismo nombre, tolerando prefijos ("Pasaje Los Aromos" == "Los Aromos"). */
const mismoNombre = (encontrado?: string | null, buscado?: string | null) => {
  const a = nucleo(encontrado);
  const b = nucleo(buscado);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
};

/** El texto (dirección completa devuelta) menciona el nombre buscado. */
const menciona = (texto: string, nombre?: string | null) => {
  const n = nucleo(nombre);
  return !!n && normalizar(texto).includes(n);
};

// Solo aceptamos coordenadas dentro de un rango razonable para Chile continental/insular,
// para evitar guardar coincidencias de otro país con el mismo nombre de calle.
const dentroDeChile = (lat: number, lng: number) =>
  lat >= -56.5 && lat <= -17 && lng >= -110 && lng <= -66;

const esValida = (lat: number, lng: number, pais: string) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  (pais.toLowerCase() !== "chile" || dentroDeChile(lat, lng));

// Un número solo sirve para geocodificar si es numérico ("1234"), no "Sitio 5" o "km 3".
const numeroUtil = (numero?: string | null) => {
  const n = limpiar(numero);
  return /^\d+[a-zA-Z]?$/.test(n) ? n : "";
};

/** Variantes a buscar, de la más precisa a la más general. */
type Intento = {
  nivel:
    | "calle y número"
    | "pasaje y número"
    | "calle en el sector"
    | "calle"
    | "pasaje"
    | "centro del sector";
  calle?: string; // nombre que debe tener la calle encontrada (sin número)
  numero?: string;
  sector?: string; // se incluye en la búsqueda
  exigirSector?: boolean; // el resultado debe estar en ese sector/villa
};

function intentos(d: DireccionInput): Intento[] {
  const calle = limpiar(d.calle);
  const pasaje = limpiar(d.pasaje);
  const sector = limpiar(d.sector);
  const numero = numeroUtil(d.numero);

  const lista: Intento[] = [];
  if (numero) lista.push({ nivel: "calle y número", calle, numero });
  if (pasaje && numero && sector)
    lista.push({ nivel: "pasaje y número", calle: pasaje, numero, sector, exigirSector: true });
  if (sector) lista.push({ nivel: "calle en el sector", calle, sector });
  lista.push({ nivel: "calle", calle });
  if (pasaje && sector)
    lista.push({ nivel: "pasaje", calle: pasaje, sector, exigirSector: true });
  if (sector) lista.push({ nivel: "centro del sector", sector, exigirSector: true });
  return lista;
}

/** Texto de búsqueda libre para un intento. */
const textoBusqueda = (it: Intento, d: DireccionInput) =>
  unir([
    unir([it.calle, it.numero], " "),
    it.sector,
    d.ciudad,
    d.region,
    d.pais,
  ]);

// -----------------------------------------------------------------------------
// Geocodificador nativo (iOS / Android)
// -----------------------------------------------------------------------------

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

    const pais = limpiar(d.pais);
    for (const it of intentos(d)) {
      const resultados = await Location.geocodeAsync(textoBusqueda(it, d));
      for (const r of resultados.slice(0, 3)) {
        if (!esValida(r.latitude, r.longitude, pais)) continue;

        // El geocodificador nativo solo entrega coordenadas: se consulta qué hay
        // en ese punto para comprobar que es la calle/comuna/sector buscados.
        const [lugar] = await Location.reverseGeocodeAsync({
          latitude: r.latitude,
          longitude: r.longitude,
        });
        if (!lugar) continue;
        const texto = unir([
          lugar.name,
          lugar.street,
          lugar.district,
          lugar.city,
          lugar.subregion,
        ]);
        const calleOk = !it.calle || mismoNombre(lugar.street ?? lugar.name, it.calle);
        const comunaOk = menciona(texto, d.ciudad);
        const sectorOk = !it.exigirSector || menciona(texto, it.sector);
        if (calleOk && comunaOk && sectorOk) {
          return {
            latitud: r.latitude,
            longitud: r.longitude,
            fuente: "nativo",
            precision: it.nivel,
          };
        }
      }
    }
    return null;
  } catch (e) {
    console.warn("Geocodificación nativa falló:", e);
    return null;
  }
}

// -----------------------------------------------------------------------------
// OpenStreetMap (Nominatim)
// -----------------------------------------------------------------------------

type ResultadoNominatim = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
};

// La política de uso de Nominatim permite como máximo 1 consulta por segundo.
let ultimaConsulta = 0;
const esperarTurno = async () => {
  const espera = ultimaConsulta + 1100 - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaConsulta = Date.now();
};

async function consultarNominatim(
  params: Record<string, string>,
  d: DireccionInput,
): Promise<ResultadoNominatim[]> {
  await esperarTurno();
  const query = new URLSearchParams({
    format: "jsonv2",
    limit: "5",
    addressdetails: "1",
    ...params,
  });
  if (limpiar(d.pais).toLowerCase() === "chile") query.set("countrycodes", "cl");

  // En web el navegador no permite cambiar el User-Agent (envía Referer),
  // en nativo nos identificamos como pide la política de uso de Nominatim.
  const headers: Record<string, string> = { "Accept-Language": "es" };
  if (Platform.OS !== "web") headers["User-Agent"] = "StaTeresita/1.0";

  const res = await fetch(`${NOMINATIM_URL}?${query.toString()}`, { headers });
  if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
  return res.json();
}

/** Comprueba que el resultado de Nominatim corresponda a lo que se buscó. */
function resultadoCoincide(r: ResultadoNominatim, it: Intento, d: DireccionInput) {
  const a = r.address ?? {};
  const calleEncontrada = a.road ?? a.pedestrian ?? a.footway ?? r.name;
  const calleOk = !it.calle || mismoNombre(calleEncontrada, it.calle);
  const comunaOk = menciona(r.display_name, d.ciudad);
  const sectorOk = !it.exigirSector || menciona(r.display_name, it.sector);
  return calleOk && comunaOk && sectorOk;
}

async function geocodificarOSM(d: DireccionInput): Promise<Coordenadas | null> {
  const pais = limpiar(d.pais);
  try {
    for (const it of intentos(d)) {
      // Sin sector, la búsqueda estructurada calle + comuna es más precisa;
      // con sector se usa búsqueda libre (Nominatim no tiene campo "villa").
      const params: Record<string, string> =
        it.calle && !it.sector
          ? {
              street: unir([it.numero, it.calle], " "), // Nominatim espera "número calle"
              city: limpiar(d.ciudad),
              state: limpiar(d.region),
              country: pais,
            }
          : { q: textoBusqueda(it, d) };

      const resultados = await consultarNominatim(params, d);
      const r = resultados.find(
        (x) =>
          esValida(parseFloat(x.lat), parseFloat(x.lon), pais) &&
          resultadoCoincide(x, it, d),
      );
      if (r) {
        // Si se buscó con número pero OpenStreetMap solo conoce la calle (sin
        // numeración), el punto está en la calle, no en la casa exacta.
        const sinNumero = !!it.numero && !r.address?.house_number;
        return {
          latitud: parseFloat(r.lat),
          longitud: parseFloat(r.lon),
          fuente: "osm",
          precision: sinNumero
            ? it.nivel === "pasaje y número"
              ? "pasaje"
              : "calle"
            : it.nivel,
        };
      }
    }
    return null;
  } catch (e) {
    console.warn("Geocodificación OpenStreetMap falló:", e);
    return null;
  }
}

/**
 * Calcula latitud y longitud de una dirección. Devuelve `null` si no se encontró
 * una ubicación confiable; nunca lanza error (el registro del cliente no debe
 * fallar por esto).
 */
export async function geocodificarDireccion(
  d: DireccionInput,
): Promise<Coordenadas | null> {
  if (!limpiar(d.calle)) return null;
  return (await geocodificarNativo(d)) ?? (await geocodificarOSM(d));
}
