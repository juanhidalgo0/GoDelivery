// Mandado real a Farmacia, en una sola toma con pausas de lectura. DRY = true: no lo envía.
const DRY = globalThis.__DRY === true;
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
const r = await startRecording(ctx, page, DRY ? 'mandado-dry' : 'mandado-hd');
const settle = (ms) => page.waitForTimeout(ms);
let meta;
try {

  r.mark('home');
  await settle(1800);
  await r.tap(page.locator('#home-mandados-btn'), { pause: 200 });
  await page.getByText('Compramos lo que necesites').first().waitFor({ timeout: 15000 });
  r.mark('menu');
  await settle(2200);
  await r.tap(page.getByText('Compramos lo que necesites').first(), { pause: 200 });
  const stop = page.getByPlaceholder(/Verduler/);
  await stop.waitFor({ timeout: 15000 });
  r.mark('form');
  await settle(1400);
  await r.tap(stop, { pause: 350 });
  await r.type(stop, 'Farmacia');
  await settle(500);
  const items = page.getByPlaceholder(/1kg papas/);
  await r.tap(items, { pause: 350 });
  await r.type(items, 'Ibuprofeno y alcohol en gel');
  await settle(1300);
  await r.tap(page.getByText(/Elegir destino/).first(), { pause: 200 });
  await page.getByText('TUS DIRECCIONES GUARDADAS').waitFor({ timeout: 15000 }).catch(() => {});
  r.mark('destino');
  await settle(1500);
  await r.tap([200, 465], { pause: 1300 });
  const det = page.getByPlaceholder(/Detalle: Nro/);
  await r.tap(det, { pause: 350 });
  await det.fill('');
  await r.type(det, 'Timbre 2');
  await settle(1300);
  await r.tap(page.getByText('SIGUIENTE').last(), { pause: 200 });
  await page.getByText('SOLICITAR COMPRA').last().waitFor({ timeout: 15000 });
  r.mark('resumen');
  await settle(1500);
  await r.tap(page.getByText('Efectivo', { exact: true }).last(), { pause: 1800 });
  if (!DRY) {
    await r.tap(page.getByText('SOLICITAR COMPRA').last(), { pause: 200 });
    const confirm = page.locator('button', { hasText: /^\s*CONFIRMAR\s*$/ }).last();
    await confirm.waitFor({ timeout: 15000 });
    r.mark('confirmar');
    await settle(900);
    await r.tap(confirm, { pause: 200 });
    r.mark('skip');
    await page.waitForURL(/#\/pedido\//, { timeout: 30000 });
    await settle(2500);
    r.mark('resume');
    r.mark('tracking');
    await settle(4500);
  }
} finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), url: page.url(), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)) };
