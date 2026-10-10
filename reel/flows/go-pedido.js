// Video de marca: pedido de una Burger Go! en Don Burger Lomos. Termina en el carrito, sin confirmar (no crea pedido).
// Marcas: 'home', 'lista', 'tienda', 'producto', 'agregado', 'carrito'; 'skip'/'resume' delimitan esperas de carga.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
const STORE = 'Bvcm2PxTXGfzMrOj982IjbkSQhl1';
await page.goto('https://godelivery-magdalena.web.app/#/');
await page.evaluate(() => localStorage.removeItem('gd-cart'));
await page.reload();
await page.waitForTimeout(7000);
await page.evaluate(() => document.querySelector('#page-home')?.scrollTo(0, 0));
await page.waitForTimeout(800);

const r = await startRecording(ctx, page, 'go-pedido');
const settle = (ms) => page.waitForTimeout(ms);
let meta;
try {
  r.mark('home');
  await settle(2200);
  await r.tap(page.locator('a[href="#/category/Comida"]').first(), { pause: 200 });
  r.mark('skip');
  const card = page.locator(`#category-comercios-grid a[href="#/comercio/${STORE}"]`);
  await card.waitFor({ state: 'visible', timeout: 20000 });
  await settle(1500);
  r.mark('resume');
  r.mark('lista');
  await settle(1200);
  await r.tap(card, { pause: 200 });
  r.mark('skip');
  const product = page.locator('.product-card', { hasText: 'Burger Go!' }).first();
  await product.waitFor({ state: 'visible', timeout: 20000 });
  await settle(1500);
  r.mark('resume');
  r.mark('tienda');
  await settle(1600);
  await r.tap(product, { pause: 200 });
  const add = page.locator('button', { hasText: /Agregar/ }).last();
  await add.waitFor({ timeout: 20000 });
  r.mark('producto');
  await settle(2000);
  await r.tap(add, { pause: 1400 });
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
  await page.locator('button', { hasText: /CONFIRMAR|SIGUIENTE/ }).last().waitFor({ timeout: 20000 });
  await settle(1200);
  r.mark('resume');
  r.mark('carrito');
  await settle(2600);
} finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)), fab: meta.taps.length };
