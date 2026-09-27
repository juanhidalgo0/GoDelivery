// Hoja de contactos: un cuadro cada `step` segundos, para planificar cortes. Uso: node sheet.mjs <nombre> [step]
import { Jimp } from 'jimp';
import fs from 'node:fs';
const [name, stepArg] = process.argv.slice(2);
const step = Number(stepArg || 1);
const m = JSON.parse(fs.readFileSync(`src/captures/${name}.json`, 'utf8'));
const picks = [];
for (let t = 0; t <= m.duration; t += step) picks.push([...m.frames].reverse().find(f => f.t <= t) || m.frames[0]);
const W = 131, H = 266, cols = 8;
const sheet = new Jimp({ width: W * cols, height: (H + 14) * Math.ceil(picks.length / cols), color: 0xffffffff });
for (const [i, f] of picks.entries()) {
  const img = await Jimp.read(`public/captures/${name.startsWith('_tmp') ? 'pedido2' : name}/${f.file}`);
  img.resize({ w: W, h: H });
  sheet.composite(img, (i % cols) * W, Math.floor(i / cols) * (H + 14) + 14);
}
await sheet.write(`captures/sheet-${name}.png`);
console.log(picks.length, 'cuadros');
