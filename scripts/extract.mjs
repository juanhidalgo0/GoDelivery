// Baja del mapa mundial de Protomaps (OpenStreetMap) solo los pedazos de Magdalena y alrededores,
// y los guarda como archivos sueltos {z}/{x}/{y}.pbf para servirlos desde Firebase Hosting.
import { PMTiles, FetchSource } from 'pmtiles';
import fs from 'fs';
import path from 'path';

const BUILD = process.argv[2] || '20260927';
const OUT = process.argv[3] || './tiles';
// Partido de Magdalena y alrededores (ciudad en -35.08, -57.51)
const BBOX = { minLat: -35.36, maxLat: -34.94, minLng: -57.78, maxLng: -57.24 };
const MAXZ = 15;

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const src = new FetchSource(`https://build.protomaps.com/${BUILD}.pmtiles`);
const pm = new PMTiles(src);
const header = await pm.getHeader();
console.log('maxZoom archivo:', header.maxZoom, 'compresión tiles:', header.tileCompression);
const meta = await pm.getMetadata();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'metadata.json'), JSON.stringify({ build: BUILD, bbox: BBOX, maxzoom: MAXZ, vector_layers: meta.vector_layers, attribution: meta.attribution }, null, 1));

const jobs = [];
for (let z = 0; z <= Math.min(MAXZ, header.maxZoom); z++) {
  const x0 = lon2x(BBOX.minLng, z), x1 = lon2x(BBOX.maxLng, z);
  const y0 = lat2y(BBOX.maxLat, z), y1 = lat2y(BBOX.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([z, x, y]);
}
console.log('tiles a bajar:', jobs.length);

let done = 0, bytes = 0, empty = 0;
const worker = async () => {
  while (jobs.length) {
    const [z, x, y] = jobs.shift();
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await pm.getZxy(z, x, y);
        if (r && r.data && r.data.byteLength) {
          const dir = path.join(OUT, String(z), String(x));
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${y}.pbf`), Buffer.from(r.data));
          bytes += r.data.byteLength;
        } else empty++;
        break;
      } catch (e) {
        if (attempt === 3) console.warn('falló', z, x, y, e.message);
        await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
      }
    }
    if (++done % 250 === 0) console.log(done, 'listos', (bytes / 1e6).toFixed(1), 'MB');
  }
};
await Promise.all(Array.from({ length: 12 }, worker));
console.log('LISTO', done, 'tiles,', empty, 'vacíos,', (bytes / 1e6).toFixed(1), 'MB');
