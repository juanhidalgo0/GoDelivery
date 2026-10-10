// Exporta ilustraciones SVG de la app a PNG con fondo transparente (y JPG con fondo blanco).
// Uso (desde reel/): node illus/export.mjs go-cash  →  ../public/go-cash.png y ../public/go-cash.jpg
import fs from 'node:fs';
import { chromium } from 'playwright';

const name = process.argv[2];
const svg = fs.readFileSync(`illus/${name}.svg`, 'utf8');
const html = (bg) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:${bg}}svg{display:block;will-change:transform;-webkit-font-smoothing:antialiased}svg text{text-rendering:geometricPrecision}</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
for (const [bg, file, opts] of [
  ['transparent', `../public/${name}.png`, { omitBackground: true }],
  ['#ffffff', `../public/${name}.jpg`, { type: 'jpeg', quality: 92 }],
  ['#f4f2ee', `out/${name}-preview.png`, {}],
]) {
  await page.setContent(html(bg));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 512, height: 512 }, ...opts });
}
await browser.close();
console.log('listo:', name);
