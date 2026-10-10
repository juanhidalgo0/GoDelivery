// Hoja comparativa de íconos de moto (uso único para elegir uno). Uso: node compare-icons.cjs <carpeta con los svg>
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const D = process.argv[2];
const inner = (f) => fs.readFileSync(path.join(D, f), 'utf8').replace(/<\?xml[^>]*>/, '');
const opts = [
  ['A', 'Material · two wheeler', inner('mat-twowheeler.svg')],
  ['B', 'Phosphor · moto (relleno)', inner('ph-motorcycle-fill.svg')],
  ['C', 'Phosphor · moto (trazo grueso)', inner('ph-motorcycle-bold.svg')],
  ['D', 'Tabler · moto (línea)', inner('tabler-motorbike.svg')],
  ['Actual', 'El de ahora', '<svg viewBox="3 5 18 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"/><path d="M10 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"/><path d="M7.5 17.5h6l1.5-6.5h-5.5Z"/><path d="m11.5 11 1.5-4h2l2 2.5"/></svg>'],
];
const fix = (svg, size, color = '#f7f5f1') => svg
  .replace(/<svg([^>]*)>/, (m, a) => `<svg${a.replace(/\s(width|height|class)="[^"]*"/g, '')} width="${size}" height="${size}" style="color:${color}">`)
  .replace(/fill="currentColor"/g, `fill="${color}"`).replace(/stroke="currentColor"/g, `stroke="${color}"`)
  .replace(/<path d="M(\d)/g, (m) => m); // los svg de Material no traen fill: hereda del style
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0b0b0c;font-family:Inter,Arial,sans-serif;color:#f7f5f1;display:flex;gap:28px;padding:40px}
.col{display:flex;flex-direction:column;align-items:center;gap:30px;width:330px}
.k{font:900 64px Montserrat,Arial;color:#e11d48}.n{font:600 20px Inter,Arial;color:rgba(247,245,241,.7);text-align:center;height:48px}
.hero{width:300px;height:300px;border-radius:50%;background:#e11d48;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 18px rgba(225,29,72,.14);fill:#f7f5f1}
.map{width:300px;height:180px;border-radius:24px;background:#2a2a2e;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.map:before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 38px,rgba(255,255,255,.08) 38px 40px),repeating-linear-gradient(90deg,transparent 0 38px,rgba(255,255,255,.08) 38px 40px)}
.chip{width:96px;height:96px;border-radius:50%;background:#e11d48;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 10px rgba(225,29,72,.25);position:relative;fill:#f7f5f1}
.card{width:300px;height:110px;border-radius:24px;background:#fff;border:2.5px solid #0b0b0c;display:flex;align-items:center;gap:16px;padding:0 18px;box-sizing:border-box}
.sq{width:64px;height:64px;border-radius:18px;background:#0b0b0c;display:flex;align-items:center;justify-content:center;fill:#fff}
.t{color:#0b0b0c;font:800 20px Inter,Arial}.s{color:#78716c;font:700 13px Inter,Arial}
</style></head><body>${opts.map(([k, n, svg]) => `<div class="col"><div class="k">${k}</div><div class="n">${n}</div>
<div class="hero">${fix(svg, 190)}</div><div class="map"><div class="chip">${fix(svg, 58)}</div></div>
<div class="card"><div class="sq">${fix(svg, 34, '#ffffff')}</div><div><div class="t">Viaje en Moto</div><div class="s">Rápido y económico</div></div></div></div>`).join('')}</body></html>`;
const file = path.join(D, 'comparar.html');
fs.writeFileSync(file, html);
(async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await b.newPage({ viewport: { width: 1900, height: 900 } });
  await pg.goto(pathToFileURL(file).href);
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: 'out/iconos-moto.png', fullPage: true });
  await b.close();
  console.log('ok');
})();
