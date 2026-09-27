// Procesa una grabación: color de la franja superior de cada cuadro (para la status bar) y exporta
// src/captures/<nombre>.json con cuadros, toques y marcas.
// Uso: node prep.mjs <nombre>
import fs from 'node:fs';
import path from 'node:path';
import { Jimp } from 'jimp';

const name = process.argv[2];
const dir = path.join('public', 'captures', name);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const hex = (n) => n.toString(16).padStart(2, '0');
let last = null;
for (const [i, f] of meta.frames.entries()) {
  const img = await Jimp.read(path.join(dir, f.file));
  // Promedio de una fila cerca del borde superior, lejos de los bordes laterales.
  let r = 0, g = 0, b = 0, n = 0;
  for (let x = 60; x < img.bitmap.width - 60; x += 12) {
    const idx = (img.bitmap.width * 3 + x) * 4;
    r += img.bitmap.data[idx]; g += img.bitmap.data[idx + 1]; b += img.bitmap.data[idx + 2]; n++;
  }
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  f.top = `#${hex(r)}${hex(g)}${hex(b)}`;
  f.dark = (0.299 * r + 0.587 * g + 0.114 * b) > 150; // texto oscuro sobre fondo claro
  if (i % 100 === 0) process.stdout.write(`${i}/${meta.frames.length} `);
  last = f;
}
fs.mkdirSync('src/captures', { recursive: true });
meta.duration = last ? last.t + 0.1 : 0;
fs.writeFileSync(path.join('src', 'captures', `${name}.json`), JSON.stringify(meta));
console.log(`\n${name}: ${meta.frames.length} cuadros, ${meta.duration.toFixed(1)}s, ${meta.taps.length} toques`);
