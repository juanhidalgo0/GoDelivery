// Video de Viajes en moto: pedir un viaje de Casa a Trabajo. Graba sobre la vista previa local con
// datos de prueba (src/dev/viajes-seed.js, servidor viajes-demo en :5180): no toca la base real.
// Marcas: 'viajes', 'origen', 'destino', 'precio', 'confirmar', 'fin'.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
await page.goto('http://localhost:5180/#/viajes');
await page.reload();
await page.locator('#viaje-origin-btn').waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);

const r = await startRecording(ctx, page, 'go-viaje');
const settle = (ms) => page.waitForTimeout(ms);
let meta;
try {
  r.mark('viajes');
  await settle(1600);
  await r.tap(page.locator('#viaje-origin-btn'), { pause: 200 });
  await page.locator('.saved-addr-chip[data-id="a1"]').waitFor({ timeout: 15000 });
  r.mark('origen');
  await settle(1100);
  await r.tap(page.locator('.saved-addr-chip[data-id="a1"]'), { pause: 900 });
  await r.tap(page.locator('#viaje-dest-btn'), { pause: 200 });
  await page.locator('.saved-addr-chip[data-id="a2"]').waitFor({ timeout: 15000 });
  r.mark('destino');
  await settle(1100);
  await r.tap(page.locator('.saved-addr-chip[data-id="a2"]'), { pause: 200 });
  await page.locator('#trip-cost-box').waitFor({ state: 'visible', timeout: 15000 });
  r.mark('precio');
  await settle(2200);
  await r.tap(page.locator('#request-trip-btn'), { pause: 200 });
  await page.getByText(/Confirmar viaje/).waitFor({ timeout: 15000 });
  r.mark('confirmar');
  await settle(1500);
  await r.tap(page.getByRole('button', { name: 'Confirmar' }).last(), { pause: 1500 });
  r.mark('fin');
} finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)) };
