// Último cuadro capturado con tiempo <= t (búsqueda binaria).
export function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return frames[lo];
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Interpola keyframes de cámara {t, s, x, y} (tiempo de captura) con easing suave.
export function cameraAt(kfs, t) {
  if (t <= kfs[0].t) return kfs[0];
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t <= b.t) {
      const p = ease((t - a.t) / (b.t - a.t || 1));
      return { s: a.s + (b.s - a.s) * p, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
    }
  }
  return kfs[kfs.length - 1];
}
