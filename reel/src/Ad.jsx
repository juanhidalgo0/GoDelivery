import React from 'react';
import { AbsoluteFill, Img, Audio, Sequence, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Outfit';
import { Phone, PHONE_W, PHONE_H, BEZEL, FRAME, K, STATUS_PT } from './Phone.jsx';
import { frameAt, cameraAt } from './Clip.jsx';
import { ConfirmScreen, TrackingScreen, MandadoOkScreen, ProductPhoto } from './Screens.jsx';
import pedido from './captures/pedido-dry.json';
import mandado from './captures/mandado-dry.json';

const { fontFamily } = loadFont('normal', { weights: ['500', '600', '800'] });

export const FPS = 30;
const RED = '#E11D48';
const INK = '#111114';
const MUTED = '#6E6E78';
const B = 0.66;                       // escala del teléfono en reposo
const ANCHOR = { x: 540, y: 1085 };   // centro del teléfono (zona segura de Instagram)
const PHONE_MIN_TOP = 555;            // el teléfono nunca sube sobre los títulos
const XFADE = 0.35;                   // fundido entre bloques
const CUT_FADE = 0.2;                 // fundido en los cortes de carga
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const easeOut = Easing.out(Easing.cubic);

// ─── Grabación → línea de tiempo ───
/**
 * Convierte una grabación en un bloque de video:
 * - arranca en `startAt` (segundos de captura) y corta las esperas entre marcas 'skip' y 'resume';
 * - cada escena tiene su propia velocidad; la escena sin `text` continúa el título anterior;
 * - `virtualTaps` son toques dibujados que no se ejecutaron en la app (p. ej. el botón final).
 */
function captureBlock(name, data, scenes, { startAt, end = data.duration, virtualTaps = [] }) {
  const mark = (l) => data.marks.find(m => m.label === l).t;
  const skips = [];
  data.marks.forEach((m, i) => {
    if (m.label !== 'skip') return;
    const r = data.marks.slice(i + 1).find(x => x.label === 'resume');
    if (r) skips.push([m.t, r.t]);
  });
  const bounds = scenes.map((s, i) => ({ ...s, from: i === 0 ? startAt : mark(s.at), to: scenes[i + 1] ? mark(scenes[i + 1].at) : end }));
  const segs = [];
  let vt = 0;
  for (const sc of bounds) {
    let cur = sc.from;
    const cuts = skips.filter(([a, b]) => b > sc.from && a < sc.to);
    const ranges = [];
    for (const [a, b] of cuts) { if (a > cur) ranges.push([cur, a]); cur = Math.max(cur, b); }
    if (sc.to > cur) ranges.push([cur, sc.to]);
    ranges.forEach(([a, b], i) => {
      const len = (b - a) / sc.speed;
      segs.push({ from: a, to: b, speed: sc.speed, start: vt, len, cut: segs.length > 0 && (i > 0 || cuts.some(([, r]) => Math.abs(r - a) < 0.01)) });
      vt += len;
    });
  }
  const duration = vt;
  const segAt = (t) => segs.find(s => t < s.start + s.len) || segs[segs.length - 1];
  const toCapture = (t) => { const s = segAt(t); return { ct: Math.min(s.to, s.from + Math.max(0, t - s.start) * s.speed), seg: s }; };
  const toVideo = (ct) => { const s = segs.find(s => ct >= s.from - 0.001 && ct <= s.to + 0.001); return s ? s.start + (ct - s.from) / s.speed : null; };

  // Títulos: una escena con texto abre un título que dura hasta la próxima escena con texto.
  const titles = [];
  bounds.forEach((sc) => {
    const a = Math.max(0, toVideo(sc.from) ?? 0);
    if (sc.text) titles.push({ label: sc.label, text: sc.text, a, b: duration });
    if (titles.length > 1 && sc.text) titles[titles.length - 2].b = a;
  });
  // Cámara: zoom suave solo en las escenas que lo piden.
  const home = (t) => ({ t, s: B, x: 196, y: 399 });
  const camera = [home(0)];
  bounds.forEach((sc, i) => {
    if (!sc.zoom) return;
    const a = toVideo(sc.from) ?? 0;
    let j = i + 1; while (bounds[j] && !bounds[j].text) j++;
    const b = bounds[j] ? toVideo(bounds[j].from) : duration;
    const zin = a + (sc.zoom.delay ?? 0.4), zout = b - 0.15;
    if (zout - zin < 2.2) return;
    const z = { s: sc.zoom.s, x: sc.zoom.x, y: sc.zoom.y };
    camera.push(home(zin), { t: zin + 0.9, ...z }, { t: zout - 0.8, ...z }, home(zout));
  });
  camera.push(home(duration + 99));

  const taps = [...data.taps, ...virtualTaps].map(p => ({ ...p, vt: toVideo(p.t) })).filter(p => p.vt != null);
  const swipes = (data.swipes || []).map(p => {
    const v = toVideo(p.t); if (v == null) return null;
    return { ...p, vt: v, vdur: p.dur / segAt(v).speed };
  }).filter(Boolean);
  return { kind: 'capture', name, data, duration, toCapture, segs, titles, camera, taps, swipes };
}

// Cuadros para el instante t: se mezclan los cuadros capturados dentro de este cuadro de video (desenfoque de movimiento natural).
function captureLayers(block, t) {
  const { ct, seg } = block.toCapture(t);
  const ct1 = Math.min(seg.to, ct + seg.speed / FPS);
  const fr = block.data.frames;
  const inside = fr.filter(f => f.t >= ct && f.t < ct1);
  const picks = inside.length ? (inside.length > 3 ? [0, 1, 2].map(i => inside[Math.floor(i * inside.length / 3)]) : inside) : [frameAt(fr, ct)];
  const layers = picks.map((f, i) => ({ capture: block.name, file: f.file, opacity: 1 / (i + 1) }));
  // Fundido en el corte de una espera de carga: el último cuadro antes del corte se desvanece.
  if (seg.cut && t - seg.start < CUT_FADE) {
    const prev = block.segs[block.segs.indexOf(seg) - 1];
    if (prev) layers.push({ capture: block.name, file: frameAt(fr, prev.to).file, opacity: 1 - (t - seg.start) / CUT_FADE });
  }
  return { layers, status: { bg: picks[0].top, dark: picks[0].dark } };
}

// ─── Guion ───
const PHOTO = { capture: 'pedido-dry', file: [...pedido.frames].reverse().find(f => f.t <= pedido.marks.find(m => m.label === 'producto').t + 1.3).file };

const PEDIDO = captureBlock('pedido-dry', pedido, [
  { at: 'home', speed: 1.45, label: 'PEDIDOS', text: 'Elegí qué *comer*' },
  { at: 'lista', speed: 1.45 },
  { at: 'tienda', speed: 1.1, label: 'PASO 1', text: 'Tu local *favorito*' },
  { at: 'producto', speed: 1.5, label: 'PASO 2', text: 'Armá tu *pedido*', zoom: { s: 0.8, x: 196, y: 430, delay: 0.5 } },
  { at: 'agregado', speed: 1.4 },
  { at: 'carrito', speed: 1.0, label: 'PASO 3', text: 'Confirmá en *un toque*' },
], { startAt: 0.9, virtualTaps: [{ t: pedido.duration - 0.35, x: 279, y: 666 }] });

const MANDADO = captureBlock('mandado-dry', mandado, [
  { at: 'home', speed: 1.5, label: 'MANDADOS', text: 'Pedí lo que *quieras*' },
  { at: 'menu', speed: 1.5 },
  { at: 'form', speed: 2.3, label: 'PASO 1', text: 'Escribí qué *necesitás*', zoom: { s: 0.84, x: 196, y: 340, delay: 0.4 } },
  { at: 'destino', speed: 2.4, label: 'PASO 2', text: 'Elegí *dónde* recibirlo' },
  { at: 'resumen', speed: 1.2, label: 'PASO 3', text: 'Tocá *Solicitar*' },
], { startAt: 1.3, virtualTaps: [{ t: mandado.duration - 0.35, x: 224, y: 708 }] });

const screenBlock = (id, duration, label, text, Screen, status, sound) => ({ kind: 'screen', id, duration, titles: [{ label, text, a: 0, b: duration }], Screen, status, sound });

const HOOK = 2.2;
const OUTRO = 3.2;

// Arma la línea de tiempo de un reel: gancho → bloques (con sus títulos) → cierre, más los sonidos.
function buildAd({ hookTitle, blocks }) {
  let cursor = HOOK;
  blocks.forEach(b => { b.start = cursor; cursor += b.duration; });
  const outroStart = cursor;
  const titles = [
    { ...hookTitle, a: 0, b: HOOK },
    ...blocks.flatMap(bl => bl.titles.map(ti => ({ ...ti, a: bl.start + ti.a, b: bl.start + ti.b }))),
  ];
  const sfx = [
    { t: 1.45, src: 'whoosh', v: 0.3 },
    ...blocks.filter(b => b.kind === 'capture').flatMap(b => b.taps.map(p => ({ t: b.start + p.vt - 0.03, src: 'tap', v: 0.55 }))),
    ...blocks.filter(b => b.kind === 'screen').map(b => b.sound === 'success'
      ? { t: b.start + 0.25, src: 'success', v: 0.4 }
      : { t: b.start - 0.05, src: 'whoosh', v: 0.18 }),
    { t: outroStart + 0.05, src: 'whoosh', v: 0.3 },
  ];
  return { blocks, titles, sfx, outroStart, total: outroStart + OUTRO };
}

const PEDIDOS = buildAd({
  hookTitle: { label: 'GO! DELIVERY', text: '¿Antojo de algo *rico*?' },
  blocks: [
    PEDIDO,
    screenBlock('confirm', 2.2, '¡LISTO!', 'Pedido *confirmado*', ({ t }) => <ConfirmScreen t={t} photo={PHOTO} />, { bg: '#F7F8FA', dark: true }, 'success'),
    screenBlock('tracking', 4.0, 'EN VIVO', 'Seguí tu pedido *en vivo*', ({ t }) => <TrackingScreen t={t} />, { bg: '#FFFFFF', dark: true }),
  ],
});

const MANDADOS = buildAd({
  hookTitle: { label: 'GO! MANDADOS', text: '¿Necesitás *algo*?' },
  blocks: [
    MANDADO,
    screenBlock('mandadoOk', 2.8, '¡LISTO!', 'Te lo *traemos*', ({ t }) => <MandadoOkScreen t={t} />, { bg: '#F7F8FA', dark: true }, 'success'),
  ],
});

// ─── Contenido de pantalla de un bloque en su tiempo local ───
function blockContent(block, t) {
  if (block.kind === 'capture') {
    const { layers, status } = captureLayers(block, Math.min(t, block.duration - 0.001));
    const taps = block.taps.map(p => ({ x: p.x, y: p.y, age: t - p.vt }));
    const swipes = block.swipes.map(p => ({ x: p.x, y0: p.y0, y1: p.y1, dur: p.vdur, age: t - p.vt }));
    return { layers, status, taps, swipes };
  }
  return { screen: <block.Screen t={t} />, status: block.status };
}

// Nodo en px de pantalla para superponer el bloque anterior durante un fundido.
const Overlay = ({ content, opacity }) => (
  <div style={{ position: 'absolute', inset: 0, opacity }}>
    {content.layers && content.layers.map((l, i) => (
      <Img key={i} src={staticFile(`captures/${l.capture}/${l.file}`)} style={{
        position: 'absolute', top: STATUS_PT * K, left: 0, width: PHONE_W - (BEZEL + FRAME) * 2, height: (852 - STATUS_PT) * K, opacity: l.opacity,
      }} />
    ))}
    {content.screen && (
      <div style={{ position: 'absolute', top: STATUS_PT * K, left: 0, width: 393 * K, height: (852 - STATUS_PT) * K, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 393, height: 798, transform: `scale(${K})`, transformOrigin: '0 0' }}>{content.screen}</div>
      </div>
    )}
  </div>
);

// ─── Piezas visuales ───
const Background = () => (
  <AbsoluteFill style={{ background: '#F4F4F6' }}>
    <div style={{
      position: 'absolute', left: 540 - 820, top: 1060 - 820, width: 1640, height: 1640, borderRadius: '50%',
      background: 'radial-gradient(circle, #FFFFFF 0%, rgba(255,255,255,0.65) 35%, rgba(255,255,255,0) 65%)',
    }} />
    <div style={{
      position: 'absolute', left: 540 - 560, top: 1160 - 560, width: 1120, height: 1120, borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(225,29,72,0.08) 0%, rgba(225,29,72,0) 60%)',
    }} />
  </AbsoluteFill>
);

const Title = ({ label, text, a, b, t, first, last }) => {
  if (t < a - 0.05 || t > b + 0.05) return null;
  const inP = first ? interpolate(t, [0.1, 0.7], [0, 1], { ...clamp, easing: easeOut }) : interpolate(t, [a + 0.05, a + 0.6], [0, 1], { ...clamp, easing: easeOut });
  const outP = last ? 0 : interpolate(t, [b - 0.28, b], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <div style={{
      position: 'absolute', top: 222, left: 40, right: 40, textAlign: 'center', fontFamily,
      opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 24 - outP * 12}px)`,
    }}>
      <div style={{ color: RED, fontWeight: 600, fontSize: 30, letterSpacing: 5, marginBottom: 16 }}>{label}</div>
      <div style={{ color: INK, fontWeight: 800, fontSize: 76, letterSpacing: -2.2, lineHeight: 1.08 }}>
        {text.split('*').map((p, i) => <span key={i} style={{ color: i % 2 ? RED : INK }}>{p}</span>)}
      </div>
    </div>
  );
};

// Gancho: la foto del plato, flotando, que "entra" al teléfono.
const HookFood = ({ t }) => {
  if (t > HOOK + 0.1) return null;
  const inP = interpolate(t, [0.1, 0.8], [0, 1], { ...clamp, easing: easeOut });
  const outP = interpolate(t, [1.35, 2.05], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const w = 840, h = Math.round(w * 232 / 393);
  return (
    <div style={{
      position: 'absolute', left: 540 - w / 2, top: 1010 - h / 2, width: w, height: h,
      opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 50 + outP * 120 + Math.sin(t * 1.6) * 6}px) scale(${(0.94 + 0.06 * inP) * (1 - 0.35 * outP)}) rotate(${-2.5 + outP * 2.5}deg)`,
    }}>
      <ProductPhoto photo={PHOTO} crop={{ x: 80, y: 50, w: 250 }} w={w} h={h} radius={44}
        style={{ boxShadow: '0 40px 80px rgba(20,20,30,0.22), 0 12px 24px rgba(20,20,30,0.12)' }} />
      <div style={{
        position: 'absolute', left: 36, bottom: -34, padding: '16px 28px', borderRadius: 26, background: 'white', fontFamily,
        boxShadow: '0 16px 40px rgba(20,20,30,0.14)', display: 'flex', alignItems: 'baseline', gap: 18,
      }}>
        <span style={{ fontWeight: 800, fontSize: 38, color: INK }}>Milanesa napolitana</span>
        <span style={{ fontWeight: 800, fontSize: 34, color: RED }}>$ 15.000</span>
      </div>
    </div>
  );
};

// Gancho de mandados: la bolsa GO! flotando sobre un disco suave.
const HookBag = ({ t }) => {
  if (t > HOOK + 0.1) return null;
  const inP = interpolate(t, [0.1, 0.75], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const outP = interpolate(t, [1.35, 2.05], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return (
    <div style={{
      position: 'absolute', left: 540 - 320, top: 1000 - 320, width: 640, height: 640,
      opacity: Math.min(1, inP) * (1 - outP), transform: `translateY(${outP * 120 + Math.sin(t * 1.6) * 8}px) scale(${(0.85 + 0.15 * inP) * (1 - 0.35 * outP)})`,
    }}>
      <div style={{ position: 'absolute', inset: 40, borderRadius: '50%', background: 'radial-gradient(circle, #FFE4E9 0%, #FFF1F3 55%, rgba(255,241,243,0) 72%)' }} />
      <Img src={staticFile('img/go-bag.png')} style={{
        position: 'absolute', left: 120, top: 80, width: 400, transform: `rotate(${-6 + Math.sin(t * 2) * 3}deg)`,
        filter: 'drop-shadow(0 34px 40px rgba(20,20,30,0.22))',
      }} />
    </div>
  );
};

const Outro = ({ t }) => {
  if (t < 0) return null;
  const a = interpolate(t, [0.55, 1.15], [0, 1], { ...clamp, easing: easeOut });
  const b = interpolate(t, [0.7, 1.3], [0, 1], { ...clamp, easing: easeOut });
  const c = interpolate(t, [0.85, 1.45], [0, 1], { ...clamp, easing: easeOut });
  return (
    <AbsoluteFill style={{ fontFamily, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -120 }}>
        <Img src={staticFile('img/app-icon.png')} style={{
          width: 210, height: 210, borderRadius: 48, opacity: a, transform: `translateY(${(1 - a) * 28}px) scale(${0.94 + 0.06 * a})`,
          boxShadow: '0 30px 60px rgba(20,20,30,0.2)',
        }} />
        <div style={{ marginTop: 54, color: INK, fontWeight: 800, fontSize: 100, letterSpacing: -3.5, opacity: b, transform: `translateY(${(1 - b) * 24}px)` }}>
          <span style={{ color: RED }}>Descargala</span> gratis
        </div>
        <div style={{ marginTop: 26, color: MUTED, fontWeight: 500, fontSize: 38, opacity: c, transform: `translateY(${(1 - c) * 18}px)` }}>
          App Store · Google Play
        </div>
        <div style={{ marginTop: 14, color: MUTED, fontWeight: 600, fontSize: 32, opacity: c, letterSpacing: 0.5 }}>
          GO! Delivery · Magdalena
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Composición ───
const makeAd = ({ blocks: BLOCKS, titles: TITLES, sfx: SFX, outroStart: OUTRO_START }, Hook) => () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  // Bloque activo y contenido del teléfono.
  let bi = BLOCKS.findIndex(b => t < b.start + b.duration);
  if (bi < 0) bi = BLOCKS.length - 1;
  const block = BLOCKS[bi];
  const lt = Math.max(0, Math.min(t - block.start, block.duration));
  const content = blockContent(block, lt);
  let overlay = null;
  if (bi > 0 && lt < XFADE) {
    const prev = BLOCKS[bi - 1];
    overlay = <Overlay content={blockContent(prev, prev.duration)} opacity={1 - interpolate(lt, [0, XFADE], [0, 1], { ...clamp, easing: easeOut })} />;
  }

  // Cámara.
  const cam = block.kind === 'capture' ? cameraAt(block.camera, lt) : { s: B, x: 196, y: 399 };
  const dx = BEZEL + FRAME + cam.x * K - PHONE_W / 2;
  const dy = BEZEL + FRAME + (cam.y + STATUS_PT) * K - PHONE_H / 2;
  let px = ANCHOR.x - cam.s * dx;
  let py = Math.max(ANCHOR.y - cam.s * dy, PHONE_MIN_TOP + cam.s * PHONE_H / 2);
  const slack = (cam.s - B) * PHONE_W * 0.5;
  px = Math.min(Math.max(px, 540 - slack), 540 + slack);

  const enter = interpolate(t, [1.4, 2.25], [0, 1], { ...clamp, easing: easeOut });
  const leave = interpolate(t - OUTRO_START, [0, 0.6], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  py += (1 - enter) * 110 + leave * 80;

  return (
    <AbsoluteFill>
      <Background />
      <Hook t={t} />
      <div style={{
        position: 'absolute', left: px - PHONE_W / 2, top: py - PHONE_H / 2, width: PHONE_W, height: PHONE_H,
        transform: `scale(${cam.s * (0.96 + 0.04 * enter)})`, opacity: enter * (1 - leave),
      }}>
        <Phone {...content}>{overlay}</Phone>
      </div>
      <div style={{ opacity: 1 - leave }}>
        {TITLES.map((ti, i) => <Title key={i} {...ti} t={t} first={i === 0} last={i === TITLES.length - 1} />)}
      </div>
      <Outro t={t - OUTRO_START} />
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.max(0, Math.round(s.t * FPS))} durationInFrames={FPS}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const Pedidos = makeAd(PEDIDOS, HookFood);
export const Mandados = makeAd(MANDADOS, HookBag);
export const DURATIONS = { Pedidos: PEDIDOS.total, Mandados: MANDADOS.total };
