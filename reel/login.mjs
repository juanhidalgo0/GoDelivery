// Abre Chrome con un perfil propio para el reel. El usuario inicia sesión a mano una sola vez;
// la sesión de Firebase queda guardada en .profile y la reutiliza la grabación.
import { chromium } from 'playwright';
const ctx = await chromium.launchPersistentContext('.profile', {
  channel: 'chrome',
  headless: false,
  ignoreDefaultArgs: ['--enable-automation'],
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://godelivery-magdalena.web.app/#/profile');
await page.bringToFront();
const readUser = () => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('firebaseLocalStorageDb');
  r.onsuccess = () => { try {
    const q = r.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
    q.onsuccess = () => res(q.result.map(x => x.value?.email).filter(Boolean).join(','));
  } catch { res(''); } };
  r.onerror = () => res('');
})).catch(() => '');
let closed = false; ctx.on('close', () => { closed = true; });
while (!closed) {
  const u = await readUser();
  if (u) { console.log('LOGUEADO:', u); await page.waitForTimeout(3000); await ctx.close(); break; }
  await new Promise(r => setTimeout(r, 2000));
}
