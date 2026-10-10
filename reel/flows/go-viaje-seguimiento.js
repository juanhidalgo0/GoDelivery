// Video de Viajes en moto: el chofer en camino, en vivo. Graba la vista previa de seguimiento
// (src/dev/tracking-seed.js, caso 'viaje', servidor seguimiento-demo en :5175): no toca la base real.
// Marcas: 'seguimiento', 'fin'.
const { startRecording } = await import('file:///C:/Users/PC/Desktop/GoDelivery/reel/recorder.mjs?v=' + Date.now());
await page.goto('http://localhost:5175/?caso=viaje&vel=6#/pedido/demo');
await page.reload();
await page.waitForTimeout(4000); // mapa, ruta por calles (OSRM) y primeros pasos del chofer

const r = await startRecording(ctx, page, 'go-viaje-seguimiento');
let meta;
try {
  r.mark('seguimiento');
  await page.waitForTimeout(12000);
  r.mark('fin');
} finally {
  meta = await r.stop();
}
return { frames: meta.frames.length, secs: +meta.frames.at(-1).t.toFixed(1), marks: meta.marks.map(m => m.label + '@' + m.t.toFixed(1)) };
