// Copia el worker de MapLibre a public/ para que el mapa web lo pueda cargar.
// MapLibre 6 busca su worker junto a su propio archivo (import.meta.url), lo que
// no funciona cuando Metro empaqueta la librería. Se ejecuta en "postinstall".
const fs = require("fs");
const path = require("path");

const origen = path.join(
  __dirname,
  "..",
  "node_modules",
  "maplibre-gl",
  "dist",
  "maplibre-gl-worker.mjs",
);
const destino = path.join(__dirname, "..", "public", "maplibre-gl-worker.mjs");

if (!fs.existsSync(origen)) {
  console.warn("[maplibre] No se encontró el worker en", origen);
  process.exit(0);
}
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origen, destino);
console.log("[maplibre] Worker copiado a public/maplibre-gl-worker.mjs");
