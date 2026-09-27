// Enviar el mandado y ver qué pasa después.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs');
const r = await startRecording(ctx, page, 'mandado2');
await page.waitForTimeout(800);
await r.tap(page.getByText('SOLICITAR COMPRA').last(), { pause: 3000 });
await page.screenshot({ path: 'captures/mandado2-a.png', scale: 'css' });
// Si pide confirmación, confirmar.
const confirm = page.locator('button', { hasText: /CONFIRMAR|Confirmar|S[ií], solicitar/ }).last();
if (await confirm.isVisible().catch(() => false)) {
  r.mark('confirm');
  await r.tap(confirm, { pause: 8000 });
} else {
  await page.waitForTimeout(6000);
}
const meta = await r.stop();
await page.screenshot({ path: 'captures/mandado2-end.png', scale: 'css' });
return { frames: meta.frames.length, secs: meta.frames.at(-1).t, url: page.url(), marks: meta.marks };
