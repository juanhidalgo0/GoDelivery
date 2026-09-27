// Junta varios PNG en una grilla para revisarlos de una. Uso: node grid.mjs salida.png a.png b.png ...
import { Jimp } from 'jimp';
const [out, ...files] = process.argv.slice(2);
const imgs = await Promise.all(files.map(f => Jimp.read(f)));
const w = 270, h = 480, cols = Math.min(5, imgs.length);
const g = new Jimp({ width: w * cols, height: h * Math.ceil(imgs.length / cols), color: 0xffffffff });
imgs.forEach((im, i) => { im.resize({ w, h }); g.composite(im, (i % cols) * w, Math.floor(i / cols) * h); });
await g.write(out);
