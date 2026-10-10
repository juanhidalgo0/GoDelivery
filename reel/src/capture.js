// Grabación → tramo de video. Cada escena toma un intervalo de la captura (por marcas, con desplazamiento
// opcional) y lo reproduce a su velocidad; las escenas se encadenan sin huecos.
import { frameAt } from './Clip.jsx';

export const FPS = 30;
const CUT_FADE = 0.18;

/**
 * scenes: [{ from: ['marca', +seg], to: ['marca', +seg], speed }]  (to por defecto: el from de la escena siguiente)
 * virtualTaps: toques dibujados que no se ejecutaron en la app, en tiempo de captura.
 */
export function captureBlock(name, data, scenes, { virtualTaps = [] } = {}) {
  const at = (ref) => {
    if (typeof ref === 'number') return ref;
    const [label, d = 0] = ref;
    const m = data.marks.find(x => x.label === label);
    if (!m) throw new Error(`${name}: falta la marca ${label}`);
    return m.t + d;
  };
  let vt = 0;
  const segs = scenes.map((sc, i) => {
    const from = at(sc.from);
    const to = sc.to != null ? at(sc.to) : (scenes[i + 1] ? at(scenes[i + 1].from) : data.duration);
    const len = (to - from) / sc.speed;
    const seg = { from, to, speed: sc.speed, start: vt, len, cut: false };
    vt += len;
    return seg;
  });
  // Hay corte (con fundido) donde una escena no arranca donde terminó la anterior.
  segs.forEach((s, i) => { if (i > 0 && Math.abs(segs[i - 1].to - s.from) > 0.05) s.cut = true; });
  const duration = vt;
  const segAt = (t) => segs.find(s => t < s.start + s.len) || segs[segs.length - 1];
  const toCapture = (t) => { const s = segAt(t); return { ct: Math.min(s.to, s.from + Math.max(0, t - s.start) * s.speed), seg: s }; };
  const toVideo = (ct) => { const s = segs.find(s => ct >= s.from - 0.001 && ct <= s.to + 0.001); return s ? s.start + (ct - s.from) / s.speed : null; };
  const taps = [...data.taps, ...virtualTaps].map(p => ({ ...p, vt: toVideo(p.t) })).filter(p => p.vt != null);
  return { name, data, duration, segs, toCapture, toVideo, at, taps };
}

// Cuadros para el instante t (tiempo del tramo): se mezclan los cuadros capturados dentro de este cuadro
// de video (desenfoque de movimiento natural) y se funde el corte de las esperas de carga.
export function captureLayers(block, t) {
  const tt = Math.max(0, Math.min(t, block.duration - 0.001));
  const { ct, seg } = block.toCapture(tt);
  const ct1 = Math.min(seg.to, ct + seg.speed / FPS);
  const fr = block.data.frames;
  const inside = fr.filter(f => f.t >= ct && f.t < ct1);
  const picks = inside.length ? (inside.length > 3 ? [0, 1, 2].map(i => inside[Math.floor(i * inside.length / 3)]) : inside) : [frameAt(fr, ct)];
  const layers = picks.map((f, i) => ({ capture: block.name, file: f.file, opacity: 1 / (i + 1) }));
  if (seg.cut && tt - seg.start < CUT_FADE) {
    const prev = block.segs[block.segs.indexOf(seg) - 1];
    if (prev) layers.push({ capture: block.name, file: frameAt(fr, prev.to - 0.02).file, opacity: 1 - (tt - seg.start) / CUT_FADE });
  }
  return { layers, status: { bg: picks[0].top, dark: picks[0].dark } };
}
