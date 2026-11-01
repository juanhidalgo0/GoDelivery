// Recorrido por calles reales sobre el mapa renderizado (src/map-roads.json): camino más corto entre dos
// puntos (px CSS del mapa). Exporta src/map-route.json y una vista previa en captures/route.png.
// Uso: node route.mjs x0 y0 x1 y1 [nombre]   (nombre: src/<nombre>.json, por defecto map-route)
import fs from 'node:fs';
import { Jimp } from 'jimp';

const [x0, y0, x1, y1] = process.argv.slice(2, 6).map(Number);
const OUT = process.argv[6] || 'map-route';
const { roads, dpr } = JSON.parse(fs.readFileSync('src/map-roads.json', 'utf8'));
const TOL = 2.5;
const nodes = [];                       // [x, y]
const key = new Map();
const nodeOf = ([x, y]) => {
  const k = `${Math.round(x / TOL)},${Math.round(y / TOL)}`;
  if (!key.has(k)) { key.set(k, nodes.length); nodes.push([x, y]); }
  return key.get(k);
};
const adj = new Map();
const link = (a, b) => {
  if (a === b) return;
  const d = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
  (adj.get(a) || adj.set(a, []).get(a)).push([b, d]);
  (adj.get(b) || adj.set(b, []).get(b)).push([a, d]);
};
// Las calles vienen como tramos sueltos: se cortan en cada cruce para que el camino pueda doblar.
const segs = [];
for (const r of roads) for (let i = 1; i < r.pts.length; i++) segs.push({ a: r.pts[i - 1], b: r.pts[i], cuts: [0, 1] });
for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
  const { a: p, b: p2 } = segs[i], { a: q, b: q2 } = segs[j];
  const rx = p2[0] - p[0], ry = p2[1] - p[1], sx = q2[0] - q[0], sy = q2[1] - q[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) continue;
  const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / den;
  const u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / den;
  // Un poco de margen: los extremos de tramos casi se tocan en las esquinas.
  const e = 0.02;
  if (t > -e && t < 1 + e && u > -e && u < 1 + e) { segs[i].cuts.push(Math.min(1, Math.max(0, t))); segs[j].cuts.push(Math.min(1, Math.max(0, u))); }
}
for (const { a, b, cuts } of segs) {
  const pts = [...new Set(cuts)].sort((x, y) => x - y).map(c => [a[0] + (b[0] - a[0]) * c, a[1] + (b[1] - a[1]) * c]);
  for (let i = 1; i < pts.length; i++) link(nodeOf(pts[i - 1]), nodeOf(pts[i]));
}

const nearest = (x, y) => nodes.reduce((best, n, i) => (adj.has(i) && Math.hypot(n[0] - x, n[1] - y) < Math.hypot(nodes[best][0] - x, nodes[best][1] - y) ? i : best), [...adj.keys()][0]);
const s = nearest(x0, y0), t = nearest(x1, y1);
const dist = new Map([[s, 0]]), prev = new Map(), done = new Set();
while (true) {
  let u = -1, du = Infinity;
  for (const [n, d] of dist) if (!done.has(n) && d < du) { u = n; du = d; }
  if (u < 0 || u === t) break;
  done.add(u);
  for (const [v, w] of adj.get(u) || []) if (du + w < (dist.get(v) ?? Infinity)) { dist.set(v, du + w); prev.set(v, u); }
}
if (!dist.has(t)) { console.log('sin camino'); process.exit(1); }
const path = [];
for (let n = t; n !== undefined; n = prev.get(n)) path.unshift(nodes[n]);
// Sin vértices casi alineados: el trazo queda limpio.
const clean = path.filter((p, i) => {
  if (i === 0 || i === path.length - 1) return true;
  const a = path[i - 1], b = path[i + 1];
  const cross = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]));
  return cross / Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.8;
});
const len = clean.reduce((acc, p, i) => acc + (i ? Math.hypot(p[0] - clean[i - 1][0], p[1] - clean[i - 1][1]) : 0), 0);
fs.writeFileSync(`src/${OUT}.json`, JSON.stringify({ dpr, pts: clean.map(([x, y]) => [+(x * dpr).toFixed(1), +(y * dpr).toFixed(1)]) }));
console.log(`recorrido: ${clean.length} puntos, ${Math.round(len)} px CSS (~${Math.round(len * 1.6)} m)`);

const im = await Jimp.read('public/img/map-dark.png');
for (let i = 1; i < clean.length; i++) {
  const [ax, ay] = clean[i - 1], [bx, by] = clean[i];
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) * dpr);
  for (let k = 0; k <= n; k++) {
    const x = Math.round((ax + (bx - ax) * k / n) * dpr), y = Math.round((ay + (by - ay) * k / n) * dpr);
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) im.setPixelColor(0xe11d48ff, x + dx, y + dy);
  }
}
im.resize({ w: 675, h: 1200 });
await im.write(`captures/${OUT}.png`);
