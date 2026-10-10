// Hoja de contactos de cuadros extraídos (out/f/*.png). Uso: node contact.mjs desde hasta salida.png
import { Jimp } from 'jimp';
import fs from 'node:fs';
const [a, b, out] = process.argv.slice(2);
const files = fs.readdirSync('out/f').filter(f => /^\d+\.png$/.test(f)).sort().slice(+a, +b);
const imgs = await Promise.all(files.map(f => Jimp.read('out/f/' + f)));
const w = imgs[0].bitmap.width, h = imgs[0].bitmap.height, cols = 8;
const g = new Jimp({ width: w * cols, height: h * Math.ceil(imgs.length / cols), color: 0x808080ff });
imgs.forEach((im, i) => g.composite(im, (i % cols) * w, Math.floor(i / cols) * h));
await g.write(out);
