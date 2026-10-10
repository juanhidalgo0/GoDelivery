// Video de marca: mandado a una farmacia. Termina en el resumen, sin solicitarlo (no crea pedido).
// Marcas: 'home', 'menu', 'form', 'destino', 'resumen'.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
await page.goto('https://godelivery-magdalena.web.app/#/');
await page.evaluate(() => localStorage.removeItem('gd-cart'));
await page.reload();
await page.waitForTimeout(7000);
await page.evaluate(() => document.querySelector('#page-home')?.scrollTo(0, 0));
// Sin subrayado del corrector en lo que se escribe (los campos lo heredan del documento).
await page.evaluate(() => { document.documentElement.spellcheck = false; });
await page.waitForTimeout(800);

const r = await startRecording(ctx, page, 'go-mandado');
const settle = (ms) => page.waitForTimeout(ms);
let meta;
try {
  r.mark('home');
  await settle(1800);
  await r.tap(page.locator('#home-mandados-btn'), { pause: 200 });
  await page.getByText('Compramos lo que necesites').first().waitFor({ timeout: 15000 });
  r.mark('menu');
  await settle(2600);
  await r.tap(page.getByText('Compramos lo que necesites').first(), { pause: 200 });
  const stop = page.getByPlaceholder(/Verduler/);
  await stop.waitFor({ timeout: 15000 });
  r.mark('form');
  await settle(1200);
  await r.tap(stop, { pause: 300 });
  await r.type(stop, 'Farmacia', 70);
  await settle(400);
  const items = page.getByPlaceholder(/1kg papas/);
  await r.tap(items, { pause: 300 });
  await r.type(items, 'Ibuprofeno y alcohol en gel', 55);
  await settle(1000);
  await r.tap(page.getByText(/Elegir destino/).first(), { pause: 200 });
  await page.getByText('TUS DIRECCIONES GUARDADAS').waitFor({ timeout: 15000 }).catch(() => {});
  r.mark('destino');
  await settle(1300);
  await r.tap(page.getByText('Casa', { exact: true }).filter({ visible: true }).first(), { pause: 1100 });
  const det = page.getByPlaceholder(/Detalle: Nro/);
  await r.tap(det, { pause: 300 });
  await det.fill('');
  await r.type(det, 'Timbre 2', 70);
  await settle(900);
  await r.tap(page.getByText('SIGUIENTE').last(), { pause: 200 });
  await page.getByText('SOLICITAR COMPRA').last().waitFor({ timeout: 15000 });
  r.mark('resumen');
  await settle(1300);
  await r.tap(page.getByText('Efectivo', { exact: true }).last(), { pause: 2000 });
  r.mark('fin');
} finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)) };
