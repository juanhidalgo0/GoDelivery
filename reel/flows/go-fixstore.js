// Video de Fixstore: tienda → parlante JBL → templado → carrito. Termina en el carrito, sin confirmar (no crea pedido).
// Fixstore abre 9–13 y 17–21: grabar con REEL_FAKE_TZ en una zona donde sea ese horario.
// Marcas: 'tienda', 'jbl', 'jbl-ok', 'templado', 'templado-ok', 'carrito'; 'skip'/'resume' delimitan esperas de carga.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
const STORE = '#/comercio/fixstore';
await page.goto('https://godelivery-magdalena.web.app/#/');
await page.evaluate(() => localStorage.removeItem('gd-cart'));
await page.reload();
await page.waitForTimeout(6000);
await page.goto('https://godelivery-magdalena.web.app/' + STORE);
await page.locator('.product-card', { hasText: 'Parlante clip 4' }).first().waitFor({ state: 'attached', timeout: 20000 });
// Que carguen todas las fotos (son lazy) antes de grabar: se recorre la lista y se vuelve arriba.
await page.evaluate(async () => {
  document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
  const card = document.querySelector('.product-card');
  let sc = card?.parentElement;
  while (sc && !(sc.scrollHeight > sc.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  sc = sc || document.scrollingElement;
  for (let y = 0; y < sc.scrollHeight; y += 500) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 150)); }
  await Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 8000); })));
  sc.scrollTop = 0;
});
await page.waitForTimeout(1500);

const r = await startRecording(ctx, page, 'go-fixstore');
const settle = (ms) => page.waitForTimeout(ms);
const addFrom = async (name, label) => {
  const card = page.locator('.product-card', { hasText: name }).first();
  await r.scrollTo(card, { targetY: 300, duration: label === 'jbl' ? 2200 : 900 });
  await settle(700);
  await r.tap(card, { pause: 200 });
  const add = page.locator('button', { hasText: /Agregar/ }).last();
  await add.waitFor({ timeout: 20000 });
  r.mark(label);
  await settle(1800);
  await r.tap(add, { pause: 1300 });
  r.mark(label + '-ok');
};
let meta;
try {
  r.mark('tienda');
  await settle(2200);
  await addFrom('Parlante clip 4', 'jbl');
  await settle(500);
  await addFrom('Templado 9D', 'templado');
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
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)), taps: meta.taps.length };
