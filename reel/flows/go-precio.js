// Serie "¿Cuánto te sale ir hasta...?": el viaje del centro a un destino en la app, hasta ver el
// precio y tocar Pedir viaje (sin confirmar). Vista previa local (viajes-demo :5180), datos de prueba.
// Uso: ./run.sh "$(sed 's/__DESTINO__/atalaya/g' flows/go-precio.js)"   → captures/go-precio-atalaya
// Marcas: 'viajes', 'origen', 'destino', 'precio', 'pedir', 'fin'.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
await page.goto('http://localhost:5180/?destino=__DESTINO__#/viajes');
await page.reload();
await page.locator('#viaje-origin-btn').waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);

const r = await startRecording(ctx, page, 'go-precio-__DESTINO__');
const settle = (ms) => page.waitForTimeout(ms);
let meta;
try {
  r.mark('viajes');
  await settle(900);
  await r.tap(page.locator('#viaje-origin-btn'), { pause: 200 });
  await page.locator('.saved-addr-chip[data-id="centro"]').waitFor({ timeout: 15000 });
  r.mark('origen');
  await settle(800);
  await r.tap(page.locator('.saved-addr-chip[data-id="centro"]'), { pause: 800 });
  await r.tap(page.locator('#viaje-dest-btn'), { pause: 200 });
  await page.locator('.saved-addr-chip[data-id="__DESTINO__"]').waitFor({ timeout: 15000 });
  r.mark('destino');
  await settle(800);
  await r.tap(page.locator('.saved-addr-chip[data-id="__DESTINO__"]'), { pause: 200 });
  await page.locator('#trip-cost-box').waitFor({ state: 'visible', timeout: 15000 });
  r.mark('precio');
  await settle(2000);
  await r.tap(page.locator('#request-trip-btn'), { pause: 200 });
  await page.getByText(/Confirmar viaje/).waitFor({ timeout: 15000 });
  r.mark('pedir');
  await settle(1400);
  r.mark('fin');
} finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)) };
