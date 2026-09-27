// Grabación cuadro a cuadro vía CDP screencast + registro de toques para dibujarlos en el video.
import fs from 'node:fs';
import path from 'node:path';

export async function startRecording(ctx, page, name) {
  const dir = path.join('public', 'captures', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const taps = [];
  const swipes = [];
  const marks = [];
  const t0 = Date.now();
  const writes = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const t = f.metadata.timestamp * 1000;
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t });
    writes.push(fs.promises.writeFile(path.join(dir, file), Buffer.from(f.data, 'base64')));
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  // Sin maxWidth/maxHeight el screencast entrega el tamaño en puntos (393px), no en Retina.
  const vp = page.viewportSize();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: vp.width * 3, maxHeight: vp.height * 3 });

  const now = () => Date.now();
  const rec = {
    dir,
    // Toque visible: mueve, marca el toque (para el círculo animado) y hace click táctil.
    async tap(locatorOrXY, { pause = 250 } = {}) {
      let x, y;
      if (Array.isArray(locatorOrXY)) [x, y] = locatorOrXY;
      else {
        await locatorOrXY.scrollIntoViewIfNeeded();
        const b = await locatorOrXY.boundingBox();
        x = b.x + b.width / 2; y = b.y + b.height / 2;
      }
      taps.push({ t: now(), x, y });
      await page.waitForTimeout(120);
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(pause);
    },
    // Scroll suave hasta que `locator` quede a `targetY` puntos del borde superior (animación JS con ease-in-out).
    // Se registra como "swipe" para dibujar el dedo arrastrando en el video.
    async scrollTo(locator, { targetY = 220, duration = 1100 } = {}) {
      const handle = await locator.elementHandle();
      const info = await handle.evaluate((el, targetY) => {
        let sc = el.parentElement;
        while (sc && !(sc.scrollHeight > sc.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
        sc = sc || document.scrollingElement;
        const delta = el.getBoundingClientRect().top - targetY;
        return { delta: Math.max(-sc.scrollTop, Math.min(delta, sc.scrollHeight - sc.clientHeight - sc.scrollTop)) };
      }, targetY);
      const dist = info.delta;
      const t = now();
      swipes.push({ t, dur: duration / 1000, x: 250, y0: 600, y1: 600 - Math.min(380, Math.abs(dist)) * Math.sign(dist) });
      await handle.evaluate((el, { dist, duration }) => new Promise(res => {
        let sc = el.parentElement;
        while (sc && !(sc.scrollHeight > sc.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
        sc = sc || document.scrollingElement;
        const start = sc.scrollTop, t0 = performance.now();
        const prevBehavior = sc.style.scrollBehavior; sc.style.scrollBehavior = 'auto';
        const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / duration);
          sc.scrollTop = start + dist * ease(p);
          if (p < 1) requestAnimationFrame(step); else { sc.style.scrollBehavior = prevBehavior; res(); }
        };
        requestAnimationFrame(step);
      }), { dist, duration });
    },
    async type(locator, text, delay = 95) {
      await locator.pressSequentially(text, { delay });
    },
    mark(label) { marks.push({ t: now(), label }); },
    async stop() {
      await cdp.send('Page.stopScreencast');
      await Promise.all(writes);
      const tStart = frames.length ? frames[0].t : t0;
      const meta = {
        frames: frames.map(f => ({ file: f.file, t: (f.t - tStart) / 1000 })),
        taps: taps.map(p => ({ ...p, t: (p.t - tStart) / 1000 })),
        swipes: swipes.map(p => ({ ...p, t: (p.t - tStart) / 1000 })),
        marks: marks.map(m => ({ ...m, t: (m.t - tStart) / 1000 })),
      };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
      return meta;
    },
  };
  return rec;
}
