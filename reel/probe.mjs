import { chromium, devices } from 'playwright';
const ctx = await chromium.launchPersistentContext('.profile', {
  channel: 'chrome', headless: true, ignoreDefaultArgs: ['--enable-automation'],
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: devices['iPhone 15 Pro'].userAgent,
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(process.argv[2] || 'https://godelivery-magdalena.web.app/#/');
await page.waitForTimeout(6000);
const email = await page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('firebaseLocalStorageDb');
  r.onsuccess = () => { try { const tx = r.result.transaction('firebaseLocalStorage','readonly');
    const q = tx.objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => res(q.result.map(x=>x.value?.email).join(',')); } catch(e){ res('none:'+e.message) } };
  r.onerror = () => res('err');
}));
console.log('user:', email);
await page.screenshot({ path: 'captures/probe.png' });
await ctx.close();
