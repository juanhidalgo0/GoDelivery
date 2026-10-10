// Video de marca GO! — "Servicio puerta a puerta" (1080x1920, ~30 s).
// El hilo es el punto rojo del splash: gira alrededor del logo al abrir, recorre Magdalena de una puerta a
// la otra y vuelve al anillo en el cierre. Las transiciones son las de la app: círculos que se abren desde
// los botones y la tinta que sube hacia el encabezado.
import React from 'react';
import { AbsoluteFill, Img, Audio, Sequence, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { Phone, PHONE_W, PHONE_H, BEZEL, FRAME, K, STATUS_PT } from './Phone.jsx';
import { cameraAt } from './Clip.jsx';
import { FPS, captureBlock, captureLayers } from './capture.js';
import pedidoData from './captures/go-pedido.json';
import mandadoData from './captures/go-mandado.json';
import COMERCIOS from './comercios.json';
import ROUTE from './map-route.json';

const { fontFamily: DISPLAY } = loadMontserrat('normal', { weights: ['800', '900'], subsets: ['latin'] });
const { fontFamily: BODY } = loadInter('normal', { weights: ['600', '700', '800'], subsets: ['latin'] });

// Tokens de go-brand.css
const INK = '#0b0b0c';
const PAPER = '#f4f2ee';
const LINE = '#e4dfd6';
const TEXT2 = '#57534e';
const ON_INK = '#f7f5f1';
const ON_INK_2 = 'rgba(247,245,241,0.62)';
const RED = '#e11d48';

// Curvas de la app (splash y hojas)
const E_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const E_IO = Easing.bezier(0.65, 0, 0.35, 1);
const E_IN = Easing.bezier(0.7, 0, 0.84, 0);
const E_ROLL = Easing.bezier(0.7, 0, 0.2, 1);
const E_BACK = Easing.out(Easing.back(1.6));
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const p = (t, a, b, e = E_OUT) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: e });
const lerp = (a, b, k) => a + (b - a) * k;
const COVER = 2400; // radio que tapa todo el cuadro desde cualquier punto

// Música opcional (public/music/...). null: solo efectos.
const MUSIC = null;

// ─── Grabaciones ───
const mark = (d, l) => d.marks.find(m => m.label === l).t;

const PEDIDO = captureBlock('go-pedido', pedidoData, [
  { from: ['home', 1.3], to: ['home', 2.75], speed: 1.6 },
  { from: ['lista', 0.2], to: ['lista', 1.5], speed: 1.5 },
  { from: ['tienda', 0.3], to: ['tienda', 1.85], speed: 1.5 },
  { from: ['producto', 0], to: ['agregado', 0.35], speed: 2.6 },
  { from: ['carrito', 0.1], to: ['carrito', 1.6], speed: 1.2 },
], { virtualTaps: [{ t: mark(pedidoData, 'carrito') + 1.3, x: 280, y: 663 }] });

const MANDADO = captureBlock('go-mandado', mandadoData, [
  { from: ['home', 1.0], speed: 1.2 },
  { from: ['menu', 0], speed: 1.85 },
  { from: ['form', 0], speed: 2.9 },
  { from: ['destino', 0], speed: 3.2 },
  { from: ['resumen', 0], to: ['resumen', 2.0], speed: 1.4 },
], { virtualTaps: [{ t: mark(mandadoData, 'resumen') + 1.7, x: 224, y: 699 }] });

// ─── Línea de tiempo (segundos) ───
const T = {};
T.P0 = 6.6;                                         // arranca el pedido (el teléfono sube un poco antes)
T.pTap = T.P0 + PEDIDO.taps[PEDIDO.taps.length - 1].vt; // toque en Confirmar
T.I0 = T.pTap + 0.55;                               // la tinta ya tapó todo: "¿No está en la app?"
T.M0 = T.I0 + 1.4;                                  // arranca el mandado
T.mTap = T.M0 + MANDADO.taps[MANDADO.taps.length - 1].vt; // toque en Solicitar compra
T.R0 = T.mTap + 0.5;                                // el rojo tapó todo: mapa
T.O0 = T.R0 + 4.45;                                 // cierre
T.END = T.O0 + 3.2;
export const BRAND_DURATION = T.END;

// ─── Teléfono ───
const BASE = { s: 0.86, x: 196.5, y: 399 };
const FOCUS_Y = 1263;
const TOP_MIN = 560;
function phoneBox(cam) {
  const dx = BEZEL + FRAME + cam.x * K - PHONE_W / 2;
  const dy = BEZEL + FRAME + (cam.y + STATUS_PT) * K - PHONE_H / 2;
  const slack = Math.max(0, (cam.s - BASE.s) * PHONE_W * 0.5);
  const px = Math.min(Math.max(540 - cam.s * dx, 540 - slack), 540 + slack);
  const py = Math.max(FOCUS_Y - cam.s * dy, TOP_MIN + cam.s * PHONE_H / 2);
  return { px, py, s: cam.s };
}
const toScreen = (box, x, y) => [
  box.px + box.s * (BEZEL + FRAME + x * K - PHONE_W / 2),
  box.py + box.s * (BEZEL + FRAME + (y + STATUS_PT) * K - PHONE_H / 2),
];

// Acercamientos: en la foto de la hamburguesa y mientras se escribe el mandado.
function zoomKeys(block, from, to, z) {
  const a = block.toVideo(block.at(from)), b = block.toVideo(block.at(to));
  return [{ t: 0, ...BASE }, { t: a, ...BASE }, { t: a + 0.45, ...z }, { t: b - 0.4, ...z }, { t: b, ...BASE }, { t: 999, ...BASE }];
}
const PEDIDO_CAM = zoomKeys(PEDIDO, ['producto', 0.1], ['producto', 2.05], { s: 1.1, x: 196.5, y: 215 });
const MANDADO_CAM = zoomKeys(MANDADO, ['form', 0.15], ['destino', -0.05], { s: 1.16, x: 196.5, y: 190 });

function phoneAt(t) {
  if (t < T.I0) return { block: PEDIDO, lt: t - T.P0, cam: PEDIDO_CAM };
  if (t >= T.M0 - 0.7 && t < T.R0) return { block: MANDADO, lt: t - T.M0, cam: MANDADO_CAM };
  return null;
}
const MANDADOS_BTN = toScreen(phoneBox(BASE), 58, 331);

const PhoneLayer = ({ t }) => {
  if (t < T.P0 - 0.6) return null;
  const st = phoneAt(t);
  if (!st) return null;
  const lt = Math.max(0, Math.min(st.lt, st.block.duration - 0.001));
  const box = phoneBox(cameraAt(st.cam, lt));
  const rise = p(t, T.P0 - 0.55, T.P0 + 0.3, E_OUT);
  const { layers, status } = captureLayers(st.block, lt);
  const taps = st.block.taps.map(tp => ({ x: tp.x, y: tp.y, age: st.lt - tp.vt }));
  return (
    <div style={{
      position: 'absolute', left: box.px - PHONE_W / 2, top: box.py - PHONE_H / 2 + (1 - rise) * 1150,
      width: PHONE_W, height: PHONE_H, transform: `scale(${box.s})`,
    }}>
      <Phone layers={layers} status={status} taps={taps} />
    </div>
  );
};

// ─── Tipografía ───
const Title = ({ t, a, b = null, eyebrow, lines, dark = false, top = 150, size = 92 }) => {
  if (t < a - 0.02 || (b != null && t > b + 0.5)) return null;
  const eIn = p(t, a, a + 0.75);
  const ex = b != null ? p(t, b, b + 0.35, E_IN) : 0;
  return (
    <div style={{ position: 'absolute', left: 72, right: 60, top }}>
      <div style={{
        fontFamily: BODY, fontWeight: 700, fontSize: 25, textTransform: 'uppercase', whiteSpace: 'nowrap',
        letterSpacing: `${lerp(0.5, 0.24, eIn)}em`, color: dark ? ON_INK_2 : TEXT2, opacity: eIn * (1 - ex),
      }}>{eyebrow}</div>
      <div style={{ marginTop: 10 }}>
        {lines.map((ln, i) => {
          const k = p(t, a + 0.08 + i * 0.08, a + 0.72 + i * 0.08);
          const o = b != null ? p(t, b + i * 0.05, b + 0.36 + i * 0.05, E_IN) : 0;
          return (
            <div key={i} style={{ overflow: 'hidden', padding: '0.14em 0 0.04em', margin: '-0.14em 0 -0.04em' }}>
              <div style={{
                fontFamily: DISPLAY, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.015em',
                color: dark ? ON_INK : INK, whiteSpace: 'nowrap', transform: `translateY(${(1 - k) * 118 - o * 118}%)`,
              }}>{ln}</div>
            </div>
          );
        })}
      </div>
      <div style={{
        marginTop: 26, width: 64, height: 8, borderRadius: 4, background: RED, transformOrigin: 'left center',
        transform: `scaleX(${p(t, a + 0.32, a + 0.8) * (1 - ex)})`,
      }} />
    </div>
  );
};

// ─── Marca: anillo, punto rojo y GO! (como el splash) ───
const pulseAt = (u) => ({
  s: interpolate(u, [0, 0.22, 0.5], [1, 1.35, 1], clamp),
  halo: interpolate(u, [0, 0.22, 0.5], [4, 10, 4], clamp),
  a: u < 0 ? 0.22 : interpolate(u, [0, 0.22], [0.22, 0], clamp),
});

const GoMark = ({ size, draw, logo, pulse, rider = 1 }) => {
  const k = size / 184;
  const C = 2 * Math.PI * 92;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox="0 0 200 200" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <circle cx="100" cy="100" r="92" fill="none" stroke={ON_INK} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - draw)} opacity={draw > 0.001 ? 1 : 0} />
      </svg>
      <div style={{
        position: 'absolute', top: 12 * k, left: 12 * k, width: size - 24 * k, height: size - 24 * k, borderRadius: '50%',
        overflow: 'hidden', background: INK, clipPath: `inset(0 ${(1 - logo) * 100}% 0 0)`, transform: `translateX(${-10 * k * (1 - logo)}px)`,
      }}>
        <Img src={staticFile('img/logo-brand.jpg')} style={{ position: 'absolute', top: '-1.5%', left: '-1.5%', width: '103%', height: '103%', objectFit: 'cover', mixBlendMode: 'lighten' }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, transform: `rotate(${draw * 360}deg)`, opacity: rider }}>
        <span style={{
          position: 'absolute', top: 2.4 * k, left: '50%', width: 10 * k, height: 10 * k, marginLeft: -5 * k, borderRadius: '50%',
          background: RED, boxShadow: `0 0 0 ${pulse.halo * k}px rgba(225,29,72,${pulse.a})`, transform: `scale(${pulse.s})`,
        }} />
      </div>
    </div>
  );
};
const MARK = 400;
const MARK_K = MARK / 184;
const DOT = 10 * MARK_K;

// ─── 1. Apertura: el splash de la app ───
const Intro = ({ t }) => {
  if (t > 2.95) return null;
  const roll = p(t, 2.4, 2.9, E_ROLL);
  const lift = p(t, 2.25, 2.5, E_IN);
  const tag = p(t, 0.8, 1.55);
  return (
    <AbsoluteFill style={{ background: INK, clipPath: `inset(0 0 ${roll * 100}% 0)` }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - lift, transform: `translateY(${-70 * lift}px) scale(${1 - 0.04 * lift})` }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -40 }}>
          <GoMark size={MARK} draw={p(t, 0.15, 1.0, E_IO)} logo={p(t, 0.45, 1.05)} pulse={pulseAt(t - 1.0)} />
          <div style={{ width: 84, height: 9, marginTop: 64, borderRadius: 5, background: RED, transformOrigin: 'left center', transform: `scaleX(${p(t, 0.75, 1.2)})` }} />
          <div style={{
            marginTop: 34, fontFamily: BODY, fontWeight: 700, fontSize: 30, textTransform: 'uppercase',
            letterSpacing: `${lerp(0.5, 0.24, tag)}em`, color: ON_INK_2, opacity: tag, marginRight: `-${lerp(0.5, 0.24, tag)}em`,
          }}>Servicio puerta a puerta</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── 2. Los comercios ───
const cleanName = (n) => n.split('|')[0].replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️‍]/gu, '').trim();
const WALL = { cols: 4, D: 200, colW: 236, pitch: 300, top: 500, speed: 34 };
const WALL_X0 = (1080 - WALL.cols * WALL.colW) / 2;
const WALL_ITEMS = [];
for (let c = 0; c < WALL.cols; c++) {
  const list = COMERCIOS.filter((_, i) => i % WALL.cols === c);
  list.forEach((com, k) => WALL_ITEMS.push({ ...com, name: cleanName(com.name), c, k, n: list.length }));
}
const wallY = (it, t) => {
  const period = it.n * WALL.pitch;
  const dir = it.c % 2 ? 1 : -1;
  const y0 = WALL.top - WALL.pitch + it.k * WALL.pitch + (it.c % 2 ? WALL.pitch / 2 : 0) + dir * (t - 2.4) * WALL.speed;
  return ((y0 - (WALL.top - WALL.pitch)) % period + period) % period + (WALL.top - WALL.pitch);
};
const wallDelay = (it) => 2.55 + Math.max(0, (wallY(it, 2.55) - WALL.top) / WALL.pitch) * 0.1 + it.c * 0.05;

const LogoWall = ({ t }) => {
  if (t < 2.3 || t > T.P0 + 0.4) return null;
  const out = p(t, T.P0 - 0.4, T.P0 + 0.3, E_IN);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 - 0.05 * out})`, filter: out > 0 ? `blur(${out * 10}px)` : undefined }}>
      {WALL_ITEMS.map((it, i) => {
        const y = wallY(it, t);
        if (y > 1920 || y < WALL.top - WALL.pitch) return null;
        const d = wallDelay(it);
        const k = p(t, d, d + 0.55, E_BACK);
        const x = WALL_X0 + it.c * WALL.colW + (WALL.colW - WALL.D) / 2;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, width: WALL.D, opacity: p(t, d, d + 0.2, Easing.linear), transform: `scale(${lerp(0.35, 1, k)})` }}>
            <div style={{
              width: WALL.D, height: WALL.D, borderRadius: '50%', background: '#fff', overflow: 'hidden', position: 'relative',
              boxShadow: `0 0 0 2px ${LINE}, 0 22px 44px rgba(28,25,23,0.10), 0 6px 14px rgba(28,25,23,0.06)`,
            }}>
              <Img src={staticFile(`img/logos/${it.file}`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{
              marginTop: 18, width: WALL.colW, marginLeft: -(WALL.colW - WALL.D) / 2, textAlign: 'center', fontFamily: BODY, fontWeight: 600,
              fontSize: 22, color: TEXT2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{it.name}</div>
          </div>
        );
      })}
      {/* El muro se pierde debajo del título */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 660, background: `linear-gradient(${PAPER} 0%, ${PAPER} 62%, rgba(244,242,238,0) 100%)` }} />
    </AbsoluteFill>
  );
};

// ─── 3. "¿No está en la app?" ───
const PEDIDO_TAP = (() => { const v = PEDIDO.taps[PEDIDO.taps.length - 1]; return toScreen(phoneBox(BASE), v.x, v.y); })();
const Interstitial = ({ t }) => {
  if (t < T.pTap || t > T.M0 + 0.1) return null;
  const grow = p(t, T.pTap + 0.05, T.I0, E_IO);
  const shrink = p(t, T.M0 - 0.5, T.M0 - 0.02, E_IO);
  const [cx, cy] = shrink > 0 ? MANDADOS_BTN : PEDIDO_TAP;
  const btnR = 23 * K * BASE.s;
  const r = shrink > 0 ? lerp(COVER, btnR, shrink) : grow * COVER;
  const fade = p(t, T.M0 - 0.08, T.M0 + 0.08, Easing.linear);
  const textOut = p(t, T.M0 - 0.62, T.M0 - 0.4, E_IN);
  const line = (i, text) => {
    const a = T.I0 - 0.08 + i * 0.36;
    const k = p(t, a, a + 0.32, E_OUT);
    return (
      <div style={{ overflow: 'hidden', padding: '0.14em 0 0.04em', margin: '-0.14em 0 -0.04em' }}>
        <div style={{
          fontFamily: DISPLAY, fontWeight: 900, fontSize: 128, lineHeight: 1.02, letterSpacing: '-0.02em', color: ON_INK, whiteSpace: 'nowrap',
          transform: `translateY(${(1 - k) * 100}%) scale(${lerp(1.06, 1, k)})`, transformOrigin: 'left bottom',
        }}>{text}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ background: INK, clipPath: `circle(${r}px at ${cx}px ${cy}px)`, opacity: 1 - fade }}>
      <div style={{ position: 'absolute', left: 72, top: 700, opacity: 1 - textOut, transform: `translateY(${-40 * textOut}px)` }}>
        <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 25, letterSpacing: '0.24em', color: ON_INK_2, textTransform: 'uppercase', opacity: p(t, T.I0 + 0.3, T.I0 + 0.8) }}>Mandados</div>
        <div style={{ marginTop: 14 }}>
          {line(0, '¿NO ESTÁ')}
          {line(1, 'EN LA APP?')}
        </div>
        <div style={{ marginTop: 34, width: 64, height: 8, borderRadius: 4, background: RED, transformOrigin: 'left center', transform: `scaleX(${p(t, T.I0 + 0.45, T.I0 + 0.85)})` }} />
      </div>
    </AbsoluteFill>
  );
};

// ─── 4. De puerta a puerta: el mapa de Magdalena ───
const R_PTS = ROUTE.pts;
const R_LEN = [0];
for (let i = 1; i < R_PTS.length; i++) R_LEN.push(R_LEN[i - 1] + Math.hypot(R_PTS[i][0] - R_PTS[i - 1][0], R_PTS[i][1] - R_PTS[i - 1][1]));
const R_TOTAL = R_LEN[R_LEN.length - 1];
const routeAt = (f) => {
  const d = f * R_TOTAL;
  let i = 1; while (i < R_LEN.length - 1 && R_LEN[i] < d) i++;
  const k = (d - R_LEN[i - 1]) / (R_LEN[i] - R_LEN[i - 1] || 1);
  return { i, pt: [lerp(R_PTS[i - 1][0], R_PTS[i][0], k), lerp(R_PTS[i - 1][1], R_PTS[i][1], k)] };
};
const R_BOX = R_PTS.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]);
const R_CENTER = [(R_BOX[0] + R_BOX[2]) / 2, (R_BOX[1] + R_BOX[3]) / 2];
const R_END = R_PTS[R_PTS.length - 1];
const MAP_W = 2700, MAP_H = 4800;

function mapCamera(u) {
  const draw = p(u, 0.4, 3.25, E_IO);
  const rider = routeAt(draw).pt;
  const push = p(u, -0.2, 3.6, Easing.inOut(Easing.quad));
  let s = lerp(0.6, 0.67, push);
  let f = [lerp(R_CENTER[0], rider[0], 0.1), lerp(R_CENTER[1], rider[1], 0.1)];
  const toEnd = p(u, 3.45, 4.0, E_IO);
  f = [lerp(f[0], R_END[0], toEnd), lerp(f[1], R_END[1], toEnd)];
  const anchor = [540, lerp(1190, 960, toEnd)];
  s *= Math.pow(7, p(u, 3.7, 4.45, E_IN));
  return { s, f, anchor, draw, rider };
}
const mapToScreen = (cam, [x, y]) => [cam.anchor[0] + cam.s * (x - cam.f[0]), cam.anchor[1] + cam.s * (y - cam.f[1])];

const StoreIcon = ({ c }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 13v7h14v-7" /><path d="M10 20v-4h4v4" />
  </svg>
);
const HouseIcon = ({ c }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5L12 3l9 7.5" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" />
  </svg>
);

const MapScene = ({ t }) => {
  const u = t - T.R0;
  // Aparece recién cuando el rojo tapó el teléfono.
  if (u < 0 || t > T.O0 + 0.02) return null;
  const cam = mapCamera(u);
  const fadeOut = p(u, 4.0, 4.45, Easing.linear);
  const partial = (() => { const { i, pt } = routeAt(cam.draw); return [...R_PTS.slice(0, i), pt]; })();
  const toS = (pt) => mapToScreen(cam, pt);
  const path = partial.map((pt, i) => `${i ? 'L' : 'M'}${toS(pt)[0].toFixed(1)} ${toS(pt)[1].toFixed(1)}`).join(' ');
  const [sx, sy] = toS(R_PTS[0]);
  const [ex, ey] = toS(R_END);
  const [rx, ry] = toS(cam.rider);
  const pinA = p(u, 0.15, 0.6, E_BACK), pinB = p(u, 0.45, 0.9, E_BACK);
  const arrive = pulseAt(u - 3.25);
  const ring = p(u, 3.25, 4.0, E_OUT);
  const pinsOut = p(u, 3.7, 4.0, Easing.linear);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <AbsoluteFill style={{ opacity: 1 - fadeOut }}>
        <Img src={staticFile('img/map-dark.png')} style={{
          position: 'absolute', left: cam.anchor[0] - cam.s * cam.f[0], top: cam.anchor[1] - cam.s * cam.f[1], width: MAP_W, height: MAP_H,
          transformOrigin: '0 0', transform: `scale(${cam.s})`, filter: 'grayscale(1) brightness(1.08) contrast(1.12)',
        }} />
        <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0 }}>
          <path d={path} fill="none" stroke="rgba(225,29,72,0.28)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
          <path d={path} fill="none" stroke={RED} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Puerta del comercio */}
        <div style={{
          position: 'absolute', left: sx - 40, top: sy - 40, width: 80, height: 80, borderRadius: '50%', background: ON_INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          transform: `scale(${pinA})`, opacity: 1 - pinsOut,
        }}><StoreIcon c={INK} /></div>
        {/* Puerta de tu casa */}
        <div style={{ position: 'absolute', left: ex - 40, top: ey - 40, width: 80, height: 80, transform: `scale(${pinB})`, opacity: 1 - pinsOut }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `3px solid ${RED}`, transform: `scale(${1 + ring * 1.4})`, opacity: u > 3.25 ? 1 - ring : 0 }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%', background: INK, border: `4px solid ${ON_INK}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}><HouseIcon c={ON_INK} /></div>
        </div>
      </AbsoluteFill>
      {/* El punto rojo: el mismo del splash */}
      {u > 0.3 && (
        <div style={{
          position: 'absolute', left: rx - DOT / 2, top: ry - DOT / 2, width: DOT, height: DOT, borderRadius: '50%', background: RED,
          boxShadow: `0 0 0 ${arrive.halo * MARK_K}px rgba(225,29,72,${u > 3.25 ? arrive.a : 0.22})`, transform: `scale(${arrive.s})`,
        }} />
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 820, opacity: 1 - p(u, 3.5, 3.9, Easing.linear), background: 'linear-gradient(rgba(11,11,12,0.94) 0%, rgba(11,11,12,0.78) 40%, rgba(11,11,12,0) 100%)' }} />
      <Title t={t} a={T.R0 + 0.45} b={T.R0 + 3.45} dark eyebrow="Repartidores de Magdalena" lines={['DE SU PUERTA', 'A LA TUYA.']} />
    </AbsoluteFill>
  );
};

// Rojo que sale de "Solicitar compra" y se cierra en el punto de partida del recorrido.
const MANDADO_TAP = (() => { const v = MANDADO.taps[MANDADO.taps.length - 1]; return toScreen(phoneBox(BASE), v.x, v.y); })();
const RedWipe = ({ t }) => {
  if (t < T.mTap || t > T.R0 + 0.75) return null;
  const grow = p(t, T.mTap + 0.05, T.R0, E_IO);
  const shrink = p(t, T.R0 + 0.02, T.R0 + 0.62, E_IO);
  const start = mapToScreen(mapCamera(t - T.R0), R_PTS[0]);
  const [cx, cy] = shrink > 0 ? start : MANDADO_TAP;
  const r = shrink > 0 ? lerp(COVER, DOT / 2, shrink) : grow * COVER;
  return <AbsoluteFill style={{ background: RED, clipPath: `circle(${r}px at ${cx}px ${cy}px)` }} />;
};

// ─── 5. Cierre ───
const Outro = ({ t }) => {
  const u = t - T.O0;
  if (u < 0) return null;
  const markTop = 520;
  const ringTop = [540, markTop + 2.4 * MARK_K + DOT / 2];
  const move = p(u, 0, 0.4, E_IO);
  const draw = p(u, 0.4, 1.2, E_IO);
  const tag = p(u, 1.0, 1.75);
  const cta = p(u, 1.5, 2.15);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <div style={{ position: 'absolute', left: 540 - MARK / 2, top: markTop }}>
        <GoMark size={MARK} draw={draw} logo={p(u, 0.68, 1.25)} pulse={pulseAt(u - 1.2)} rider={u >= 0.4 ? 1 : 0} />
      </div>
      {u < 0.4 && (
        <div style={{
          position: 'absolute', left: 540 - DOT / 2, top: lerp(960, ringTop[1], move) - DOT / 2, width: DOT, height: DOT, borderRadius: '50%',
          background: RED, boxShadow: `0 0 0 ${4 * MARK_K}px rgba(225,29,72,0.22)`,
        }} />
      )}
      <div style={{ position: 'absolute', top: markTop + MARK + 64, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 84, height: 9, borderRadius: 5, background: RED, transform: `scaleX(${p(u, 0.95, 1.4)})` }} />
        <div style={{
          marginTop: 38, fontFamily: BODY, fontWeight: 800, fontSize: 38, textTransform: 'uppercase', color: ON_INK,
          letterSpacing: `${lerp(0.46, 0.22, tag)}em`, marginRight: `-${lerp(0.46, 0.22, tag)}em`, opacity: tag,
        }}>Servicio puerta a puerta</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1330, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: cta, transform: `translateY(${(1 - cta) * 30}px)` }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 76, color: ON_INK, letterSpacing: '-0.015em' }}>DESCARGÁ GO!</div>
        <div style={{ marginTop: 34, display: 'flex', gap: 20 }}>
          {['App Store', 'Google Play'].map(s => (
            <div key={s} style={{ padding: '18px 34px', borderRadius: 999, border: '2px solid rgba(247,245,241,0.22)', fontFamily: BODY, fontWeight: 700, fontSize: 30, color: ON_INK }}>{s}</div>
          ))}
        </div>
        <div style={{ marginTop: 40, fontFamily: BODY, fontWeight: 600, fontSize: 26, letterSpacing: '0.2em', textTransform: 'uppercase', color: ON_INK_2 }}>Magdalena · Buenos Aires</div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Sonido ───
const SFX = [
  { t: 0.12, src: 'swish', v: 0.18 },
  { t: 1.0, src: 'go-logo', v: 0.75 },
  { t: 2.38, src: 'swish', v: 0.4 },
  ...WALL_ITEMS.map(wallDelay).sort((a, b) => a - b).filter((_, i) => i % 3 === 0).slice(0, 8).map(d => ({ t: d, src: 'pop', v: 0.16 })),
  { t: T.P0 - 0.55, src: 'whoosh', v: 0.32 },
  ...PEDIDO.taps.map(tp => ({ t: T.P0 + tp.vt - 0.02, src: 'tap', v: 0.45 })),
  { t: T.pTap - 0.45, src: 'riser', v: 0.3 },
  { t: T.I0 - 0.08, src: 'thump', v: 0.8 },
  { t: T.I0 + 0.28, src: 'thump', v: 0.8 },
  { t: T.M0 - 0.52, src: 'swish', v: 0.4 },
  ...MANDADO.taps.map(tp => ({ t: T.M0 + tp.vt - 0.02, src: 'tap', v: 0.45 })),
  { t: T.mTap + 0.02, src: 'whoosh', v: 0.36 },
  { t: T.R0 + 3.25, src: 'success', v: 0.34 },
  { t: T.R0 + 3.7, src: 'whoosh', v: 0.3 },
  { t: T.O0 + 1.2, src: 'go-logo', v: 0.8 },
].filter(s => s.t >= 0);

// ─── Composición ───
export const Brand = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const pedTitleOut = T.pTap - 0.1;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 1000px at 540px 1250px, #fbfaf8 0%, ${PAPER} 70%)` }} />
      <LogoWall t={t} />
      <Title t={t} a={2.75} b={T.P0 - 0.5} eyebrow="Comunidad GO!" lines={['LOS COMERCIOS', 'DE MAGDALENA']} />
      <PhoneLayer t={t} />
      <Title t={t} a={T.P0 + 0.2} b={pedTitleOut} eyebrow="Pedidos" lines={['PEDÍS EN', 'SEGUNDOS.']} />
      <Title t={t} a={T.M0 + 0.15} b={T.mTap - 1.55} eyebrow="Mandados" lines={['TE LO', 'BUSCAMOS.']} />
      <Title t={t} a={T.mTap - 1.1} b={T.mTap} eyebrow="Mandados" lines={['Y TE LO', 'LLEVAMOS.']} />
      <Interstitial t={t} />
      <MapScene t={t} />
      <RedWipe t={t} />
      <Outro t={t} />
      <Intro t={t} />
      {MUSIC && <Audio src={staticFile(MUSIC)} volume={(f) => interpolate(f, [0, 10, T.END * FPS - 45, T.END * FPS], [0, 0.9, 0.9, 0], clamp)} />}
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(1.7 * FPS)}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// Piezas compartidas con otros videos (Viajes.jsx): misma tipografía, marca y teléfono.
export { DISPLAY, BODY, INK, PAPER, LINE, TEXT2, ON_INK, ON_INK_2, RED, E_OUT, E_IO, E_IN, E_ROLL, E_BACK, clamp, p, lerp, COVER, BASE, phoneBox, toScreen, Title, GoMark, pulseAt, MARK, MARK_K, DOT, HouseIcon };
