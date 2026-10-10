// Renderiza el mapa propio de Magdalena (estilo "GO oscuro" de la app) en alta resolución para la escena
// "puerta a puerta", y exporta las calles en píxeles de la imagen para trazar un recorrido real.
// Uso: node map.mjs   →  public/img/map-dark.png + src/map-roads.json
import fs from 'node:fs';
import { chromium } from 'playwright';

const APP = 'https://godelivery-magdalena.web.app';
const W = 1350, H = 2400, DPR = 2;          // px CSS del mapa; la imagen sale a W*DPR x H*DPR
const CENTER = [-57.5146, -35.0811];
const ZOOM = 16.1;

const LAYERS = JSON.parse(fs.readFileSync('../src/utils/go-map-layers.json', 'utf8')).goDark
  // Sin carteles de negocios, números ni íconos: el mapa es fondo, no protagonista.
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
await page.waitForFunction(() => window.__idle === true, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'public/img/map-dark.png' });

// Calles visibles, en px CSS del mapa (x DPR = px de la imagen).
const roads = await page.evaluate(() => {
  const ids = map.getStyle().layers.filter(l => l.type === 'line' && /^roads_(minor|major|other|link)$/.test(l.id)).map(l => l.id);
  const out = [];
  for (const f of map.queryRenderedFeatures({ layers: ids })) {
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) out.push({ kind: f.properties.kind, name: f.properties.name || '', pts: line.map(c => { const p = map.project(c); return [+p.x.toFixed(1), +p.y.toFixed(1)]; }) });
  }
  return out;
});
fs.writeFileSync('src/map-roads.json', JSON.stringify({ w: W, h: H, dpr: DPR, roads }));
console.log('mapa listo:', roads.length, 'tramos de calle');
await browser.close();
