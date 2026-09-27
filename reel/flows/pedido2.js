// Segunda parte: confirmar el pedido y ver el seguimiento.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs');
const r = await startRecording(ctx, page, 'pedido2');
await page.waitForTimeout(900);
await r.tap(page.locator('button', { hasText: 'CONFIRMAR Y PEDIR' }).last(), { pause: 9000 });
r.mark('tracking');
const meta = await r.stop();
await page.screenshot({ path: 'captures/pedido2-end.png', scale: 'css' });
return { frames: meta.frames.length, secs: meta.frames.at(-1).t, url: page.url() };
