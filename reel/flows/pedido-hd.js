// Pedido real en Rey del pollo, en una sola toma y con pausas para que se lea cada pantalla.
// Marcas: escenas para textos/zooms; 'skip'/'resume' delimitan esperas de carga que el montaje corta.
// DRY = true: se detiene antes de confirmar (no crea pedido).
const DRY = globalThis.__DRY === true;
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
const r = await startRecording(ctx, page, DRY ? 'pedido-dry' : 'pedido-hd');
const settle = (ms) => page.waitForTimeout(ms);
let meta;
try { flow: {

  r.mark('home');
  await settle(1800);
  await r.tap(page.locator('a[href="#/category/Comida"]').first(), { pause: 200 });
  r.mark('skip');
  const card = page.locator('#category-comercios-grid a[href="#/comercio/miZhd86ppRUVvLaWqOp0AzAV0k13"]');
  await card.waitFor({ state: 'attached', timeout: 20000 });
  await settle(1200);
  r.mark('resume');
  r.mark('lista');
  await settle(900);
  await r.scrollTo(card, { targetY: 190, duration: 1400 });
  await settle(900);
  await r.tap(card, { pause: 200 });
  r.mark('skip');
  await page.getByText('Milanesa napolitana').first().waitFor({ timeout: 20000 });
  await settle(1000);
  r.mark('resume');
  r.mark('tienda');
  await settle(1800);
  await r.tap(page.locator('.product-card', { hasText: 'Milanesa napolitana' }).first(), { pause: 200 });
  r.mark('skip');
  await page.locator('button', { hasText: /Elegir sabores|Agregar/ }).last().waitFor({ timeout: 20000 });
  await settle(700);
  r.mark('resume');
  r.mark('producto');
  await settle(1800);
  await r.tap(page.getByText('Napolitana', { exact: true }).first(), { pause: 1000 });
  await r.tap(page.locator('button', { hasText: 'Agregar' }).last(), { pause: 1500 });
  r.mark('agregado');
  const fab = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a,button,div')].find(e => {
      const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return s.position === 'fixed' && b.width > 40 && b.width < 90 && b.top > 600 && b.left > 280;
    });
    if (!el) return null; const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2];
  });
  await r.tap(fab || [342, 745], { pause: 200 });
  r.mark('skip');
  // El carrito puede venir en dos pasos (SIGUIENTE → CONFIRMAR) o en uno solo (CONFIRMAR).
  const siguiente = page.locator('button', { hasText: 'SIGUIENTE' }).last();
  const confirmar = page.locator('button', { hasText: /^\s*CONFIRMAR\s*$/ }).last();
  await siguiente.or(confirmar).first().waitFor({ timeout: 20000 });
  await settle(600);
  r.mark('resume');
  r.mark('carrito');
  await settle(2600);
  // En ensayo la toma termina en el carrito: el toque en Confirmar y lo que sigue se animan en el video.
  if (DRY) break flow;
  if (await siguiente.isVisible().catch(() => false)) {
    await r.tap(siguiente, { pause: 200 });
    await confirmar.waitFor({ timeout: 20000 });
    r.mark('pago');
    await settle(2200);
  }
  await r.tap(confirmar, { pause: 200 });
  await page.locator('button', { hasText: 'CONFIRMAR Y PEDIR' }).last().waitFor({ timeout: 20000 });
  r.mark('confirmar');
  await settle(2400);
  if (!DRY) {
    await r.tap(page.locator('button', { hasText: 'CONFIRMAR Y PEDIR' }).last(), { pause: 200 });
    r.mark('skip');
    await page.getByText('Pedido realizado').first().waitFor({ timeout: 30000 }).catch(() => {});
    r.mark('resume');
    r.mark('exito');
    await page.waitForURL(/#\/pedido\//, { timeout: 30000 });
    r.mark('skip');
    await settle(2500); // carga del mapa
    r.mark('resume');
    r.mark('tracking');
    await settle(4000);
  }
} } finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), url: page.url(), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)) };
