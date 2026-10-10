// Mapa amplio de Magdalena para la serie "¿Cuánto te sale ir hasta...?" (Precio.jsx): del centro a
// cada destino, con el recorrido por calles reales (OSRM) y el precio calculado como la app.
// Uso: node map-viajes.mjs  →  public/img/map-viajes.png + src/viajes-map.json
import fs from 'node:fs';
import { chromium } from 'playwright';

const APP = 'https://godelivery-magdalena.web.app';
const W = 2600, H = 3700, DPR = 2;
const CENTER = [-57.5107, -35.0545];
const ZOOM = 14;

// "El centro": Plaza San Martín
const ORIGIN = { lat: -35.0806743, lng: -57.5177564 };
export const DESTINOS = {
  atalaya: { nombre: 'ATALAYA', lat: -35.0250665, lng: -57.5299177 },
  rio: { nombre: 'EL RÍO', lat: -35.0312866, lng: -57.5062131 },
  penal: { nombre: 'EL PENAL', lat: -35.1035, lng: -57.4725 },
  empalme: { nombre: 'EMPALME', lat: -35.0699366, lng: -57.53437 },  // ex estación Empalme Magdalena (barrio El Zorzal)
};

// Tarifa de Viajes publicada (settings/global) y la cuenta de src/pages/viajes.js
const g = await (await fetch('https://firestore.googleapis.com/v1/projects/godelivery-magdalena/databases/(default)/documents/settings/global')).json();
const num = (k, d) => Number(g.fields?.[k]?.integerValue ?? g.fields?.[k]?.doubleValue ?? d);
const tarifa = { base: num('tripBasePrice', 1500), porKm: num('tripPricePerKm', 300), minimo: num('tripMinPrice', 1500) };
const km = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 1.25;
};
const precio = (d) => Math.ceil(Math.max(tarifa.minimo, tarifa.base + d * tarifa.porKm) / 10) * 10;

const LAYERS = JSON.parse(fs.readFileSync('../src/utils/go-map-layers.json', 'utf8')).goDark
  .filter(l => !['pois', 'address_label', 'roads_oneway', 'roads_shields'].includes(l.id));
const style = {
  version: 8,
  glyphs: `${APP}/map/fonts/{fontstack}/{range}.pbf`,
  sprite: `${APP}/map/sprites/dark`,
  sources: { protomaps: { type: 'vector', tiles: [`${APP}/map/tiles/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 15 } },
  layers: LAYERS,
};
const html = `<!doctype html><html><head>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css"><style>html,body{margin:0;background:#0b0b0c}#map{width:${W}px;height:${H}px}</style>
</head><body><div id="map"></div><script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js"></script><script>
  window.map = new maplibregl.Map({ container: 'map', style: ${JSON.stringify(style)}, center: ${JSON.stringify(CENTER)}, zoom: ${ZOOM},
    pixelRatio: ${DPR}, attributionControl: false, interactive: false, fadeDuration: 0, preserveDrawingBuffer: true });
  map.on('idle', () => { window.__idle = true; });
</script></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
await page.route(`${APP}/__reel-map`, r => r.fulfill({ contentType: 'text/html', body: html }));
await page.goto(`${APP}/__reel-map`);
await page.waitForFunction(() => window.__idle === true, null, { timeout: 90000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'public/img/map-viajes.png' });

const project = (pts) => page.evaluate((pts) => pts.map(c => { const p = map.project(c); return [+p.x.toFixed(1), +p.y.toFixed(1)]; }), pts);
const out = { w: W, h: H, dpr: DPR, tarifa, origen: (await project([[ORIGIN.lng, ORIGIN.lat]]))[0], destinos: {} };
for (const [id, d] of Object.entries(DESTINOS)) {
  const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${ORIGIN.lng},${ORIGIN.lat};${d.lng},${d.lat}?overview=full&geometries=geojson`)).json();
  const coords = r.routes?.[0]?.geometry?.coordinates || [[ORIGIN.lng, ORIGIN.lat], [d.lng, d.lat]];
  const dist = km(ORIGIN, d);
  out.destinos[id] = {
    nombre: d.nombre, km: +dist.toFixed(1), precio: precio(dist),
    punto: (await project([[d.lng, d.lat]]))[0],
    ruta: await project(coords),
  };
  console.log(`${id}: ${dist.toFixed(1)} km → $${precio(dist)} (${coords.length} puntos)`);
}
fs.writeFileSync('src/viajes-map.json', JSON.stringify(out));
await browser.close();
