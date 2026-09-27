// Deja la app en el inicio, con el carrito vacío y sin popups.
await page.goto('https://godelivery-magdalena.web.app/#/');
await page.evaluate(() => localStorage.removeItem('gd-cart'));
await page.reload();
await page.waitForTimeout(6000);
for (let i = 0; i < 3; i++) {
  const popup = await page.getByText('EXCLUSIVO EN LA APP').isVisible().catch(() => false);
  if (!popup) break;
  await page.touchscreen.tap(343, 174);
  await page.waitForTimeout(1500);
}
await page.evaluate(() => document.querySelector('#page-home')?.scrollTo(0, 0));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'captures/prep.png', scale: 'css' });
return 'listo';
