// Video de Viajes en moto (1080x1920, ~27 s). Mismo lenguaje que el video de marca (Brand.jsx): el splash,
// títulos que suben desde una línea, el teléfono con la app real y el mapa oscuro de Magdalena.
//   1. Splash "Viajes en moto"            4. Mapa: la moto recorre Magdalena
//   2. "¿Llegás tarde?" → "Pedí una moto."  5. Seguimiento en vivo en el teléfono
//   3. El pedido en la app (precio antes)   6. Cierre con descarga
// Grabaciones: flows/go-viaje.js y flows/go-viaje-seguimiento.js (vista previa local con datos de prueba).
import React from 'react';
import { AbsoluteFill, Audio, Sequence, Img, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { Phone, PHONE_W, PHONE_H } from './Phone.jsx';
import { cameraAt } from './Clip.jsx';
import { FPS, captureBlock, captureLayers } from './capture.js';
import viajeData from './captures/go-viaje.json';
import seguimientoData from './captures/go-viaje-seguimiento.json';
import ROUTE from './map-route.json';
import {
  DISPLAY, BODY, INK, PAPER, ON_INK, ON_INK_2, RED, E_OUT, E_IO, E_IN, E_ROLL, E_BACK, clamp, p, lerp, COVER,
  BASE, phoneBox, toScreen, Title, GoMark, pulseAt, MARK, MARK_K, DOT, HouseIcon,
} from './Brand.jsx';

// Música opcional (public/music/...). null: solo efectos.
const MUSIC = null;

// ─── Grabaciones ───
const VIAJE = captureBlock('go-viaje', viajeData, [
  { from: ['viajes', 0.3], to: ['origen', 0], speed: 1.5 },
  { from: ['origen', 0], to: ['destino', 0], speed: 1.6 },
  { from: ['destino', 0], to: ['precio', 0.1], speed: 1.4 },
  { from: ['precio', 0.1], to: ['precio', 2.1], speed: 1.0 },
  { from: ['precio', 2.1], to: ['confirmar', 1.75], speed: 1.25 },
]);
const SEG = captureBlock('go-viaje-seguimiento', seguimientoData, [
  { from: ['seguimiento', 0.3], to: ['seguimiento', 9.3], speed: 1.8 },
]);

// ─── Línea de tiempo (segundos) ───
const T = {};
T.H0 = 2.9;                                            // "¿Llegás tarde?"
T.H1 = 4.75;                                           // la moto entra: "Pedí una moto."
T.P0 = 7.4;                                            // el teléfono con el pedido
T.price = T.P0 + VIAJE.toVideo(VIAJE.at(['precio', 0.1]));
T.pTap = T.P0 + VIAJE.taps[VIAJE.taps.length - 1].vt;  // toque en Confirmar
T.R0 = T.pTap + 0.5;                                   // el rojo tapó todo: mapa
T.S0 = T.R0 + 3.9;                                     // seguimiento en vivo
T.O0 = T.S0 + SEG.duration + 0.1;                      // cierre
T.END = T.O0 + 3.4;
export const VIAJES_DURATION = T.END;

// ─── La moto: el ícono de la app (Phosphor "motorcycle" relleno, licencia MIT) ───
// draw: aparece de atrás hacia adelante (de izquierda a derecha), como si entrara andando.
const MOTO_PATH = "M216,120a41,41,0,0,0-6.6.55l-5.82-15.14A55.64,55.64,0,0,1,216,104a8,8,0,0,0,0-16H196.88L183.47,53.13A8,8,0,0,0,176,48H144a8,8,0,0,0,0,16h26.51l9.23,24H152c-18.5,0-33.5,4.31-43.37,12.46a16,16,0,0,1-16.76,2.07c-10.58-4.81-73.29-30.12-73.8-30.26a8,8,0,0,0-5,15.19S68.57,109.4,79.6,120.4A55.67,55.67,0,0,1,95.43,152H79.2a40,40,0,1,0,0,16h52.12a31.91,31.91,0,0,0,30.74-23.1,56,56,0,0,1,26.59-33.72l5.82,15.13A40,40,0,1,0,216,120ZM40,168H62.62a24,24,0,1,1,0-16H40a8,8,0,0,0,0,16Zm176,16a24,24,0,0,1-15.58-42.23l8.11,21.1a8,8,0,1,0,14.94-5.74L215.35,136l.65,0a24,24,0,0,1,0,48Z";
export const MotoGlyph = ({ w, draw = 1, color = INK }) => (
  <svg width={w} height={w} viewBox="0 0 256 256" style={{ overflow: 'visible', clipPath: draw < 1 ? `inset(0 ${(1 - Math.max(0, draw)) * 100}% 0 0)` : undefined }}>
    <path d={MOTO_PATH} fill={color} />
  </svg>
);

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
          }}>Viajes en moto</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── 2. El gancho ───
// La moto entra en un disco rojo (como los íconos de servicio de la app) con líneas de velocidad.
const DISC = 400;
const MotoHero = ({ t }) => {
  if (t < T.H1 - 0.1 || t > T.P0) return null;
  const enter = p(t, T.H1, T.H1 + 0.62, E_BACK);
  const leave = p(t, T.P0 - 1.0, T.P0 - 0.55, E_IN);
  const x = lerp(-1150, 0, enter) + leave * 1500;
  const draw = p(t, T.H1 + 0.25, T.H1 + 1.05, E_OUT);
  // Vibración del motor en ralentí cuando está quieta
  const idle = enter >= 0.999 && leave === 0 ? Math.sin(t * 52) * 1.6 : 0;
  // Líneas de velocidad: largas al entrar, se recogen al frenar y vuelven al salir
  const speed = Math.max(1 - p(t, T.H1 + 0.3, T.H1 + 0.75, E_OUT), leave);
  const lines = [[0.24, 1, RED], [0.42, 0.7, INK], [0.6, 0.9, INK], [0.78, 0.55, RED]];
  return (
    <div style={{ position: 'absolute', left: 540 - DISC / 2, top: 700, width: DISC, height: DISC, transform: `translateX(${x}px) translateY(${idle}px)`, filter: leave > 0.05 ? `blur(${leave * 8}px)` : undefined }}>
      {lines.map(([y, len, c], i) => (
        <div key={i} style={{
          position: 'absolute', right: DISC - 30, top: y * DISC, height: i % 2 ? 10 : 14, borderRadius: 8, background: c,
          width: 520 * len * speed, opacity: speed * (c === RED ? 1 : 0.85),
        }} />
      ))}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 0 22px rgba(225,29,72,0.14), 0 40px 80px rgba(225,29,72,0.28)',
      }}>
        <MotoGlyph w={250} draw={draw} color={ON_INK} sw={1.7} />
      </div>
    </div>
  );
};

// ─── 3. El teléfono ───
function zoomKeys(block, from, to, z) {
  const a = block.toVideo(block.at(from)), b = block.toVideo(block.at(to));
  return [{ t: 0, ...BASE }, { t: a, ...BASE }, { t: a + 0.45, ...z }, { t: b - 0.4, ...z }, { t: b, ...BASE }, { t: 999, ...BASE }];
}
const VIAJE_CAM = zoomKeys(VIAJE, ['precio', 0.25], ['precio', 2.05], { s: 1.12, x: 196.5, y: 300 });
const SEG_CAM = [{ t: 0, ...BASE }, { t: SEG.duration, s: 0.92, x: 196.5, y: 330 }];

function phoneAt(t) {
  if (t >= T.P0 - 0.7 && t < T.R0) return { block: VIAJE, lt: t - T.P0, cam: VIAJE_CAM, enter: T.P0 };
  if (t >= T.S0 - 0.7 && t < T.O0 + 0.1) return { block: SEG, lt: t - T.S0, cam: SEG_CAM, enter: T.S0 };
  return null;
}

const PhoneLayer = ({ t }) => {
  const st = phoneAt(t);
  if (!st) return null;
  const lt = Math.max(0, Math.min(st.lt, st.block.duration - 0.001));
  const box = phoneBox(cameraAt(st.cam, lt));
  const rise = p(t, st.enter - 0.55, st.enter + 0.3, E_OUT) - (st.block === SEG ? p(t, T.O0 - 0.9, T.O0 - 0.35, E_IN) : 0);
  const { layers, status } = captureLayers(st.block, lt);
  const taps = st.block.taps.map(tp => ({ x: tp.x, y: tp.y, age: st.lt - tp.vt }));
  return (
    <div style={{
      position: 'absolute', left: box.px - PHONE_W / 2, top: box.py - PHONE_H / 2 + (1 - rise) * 1150,
      width: PHONE_W, height: PHONE_H, transform: `scale(${box.s})`,
      filter: st.block === SEG ? 'drop-shadow(0 40px 80px rgba(0,0,0,0.55))' : undefined,
    }}>
      <Phone layers={layers} status={status} taps={taps} />
    </div>
  );
};

// ─── 4. Mapa de Magdalena: la moto de una puerta a la otra ───
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
  const push = p(u, -0.2, 7, Easing.inOut(Easing.quad));
  const s = lerp(0.6, 0.7, push);
  const f = [lerp(R_CENTER[0], rider[0], 0.12), lerp(R_CENTER[1], rider[1], 0.12)];
  return { s, f, anchor: [540, 1190], draw, rider };
}
const mapToScreen = (cam, [x, y]) => [cam.anchor[0] + cam.s * (x - cam.f[0]), cam.anchor[1] + cam.s * (y - cam.f[1])];
// Rumbo de la moto (para que mire hacia donde va)
const headingAt = (draw) => {
  const a = routeAt(Math.max(0, draw - 0.01)).pt, b = routeAt(Math.min(1, draw + 0.01)).pt;
  return b[0] < a[0] ? -1 : 1;
};

const PinIcon = ({ c }) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

const MapScene = ({ t }) => {
  const u = t - T.R0;
  if (u < 0 || t > T.O0 + 0.1) return null;
  const cam = mapCamera(u);
  const dim = p(u, 3.45, 4.1, Easing.linear);
  const partial = (() => { const { i, pt } = routeAt(cam.draw); return [...R_PTS.slice(0, i), pt]; })();
  const toS = (pt) => mapToScreen(cam, pt);
  const path = partial.map((pt, i) => `${i ? 'L' : 'M'}${toS(pt)[0].toFixed(1)} ${toS(pt)[1].toFixed(1)}`).join(' ');
  const [sx, sy] = toS(R_PTS[0]);
  const [ex, ey] = toS(R_END);
  const [rx, ry] = toS(cam.rider);
  const pinA = p(u, 0.15, 0.6, E_BACK), pinB = p(u, 0.45, 0.9, E_BACK);
  const ring = p(u, 3.25, 4.0, E_OUT);
  const chip = p(u, 0.3, 0.7, E_BACK);
  const bob = Math.sin(u * 18) * 2.5 * (cam.draw < 1 ? 1 : 0);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <AbsoluteFill style={{ opacity: 1 - dim * 0.62, filter: dim > 0 ? `blur(${dim * 6}px)` : undefined }}>
        <Img src={staticFile('img/map-dark.png')} style={{
          position: 'absolute', left: cam.anchor[0] - cam.s * cam.f[0], top: cam.anchor[1] - cam.s * cam.f[1], width: MAP_W, height: MAP_H,
          transformOrigin: '0 0', transform: `scale(${cam.s})`, filter: 'grayscale(1) brightness(1.08) contrast(1.12)',
        }} />
        <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0 }}>
          <path d={path} fill="none" stroke="rgba(225,29,72,0.28)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
          <path d={path} fill="none" stroke={RED} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Donde te buscan */}
        <div style={{
          position: 'absolute', left: sx - 40, top: sy - 40, width: 80, height: 80, borderRadius: '50%', background: ON_INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)', transform: `scale(${pinA})`,
        }}><HouseIcon c={INK} /></div>
        {/* A donde vas */}
        <div style={{ position: 'absolute', left: ex - 40, top: ey - 40, width: 80, height: 80, transform: `scale(${pinB})` }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `3px solid ${RED}`, transform: `scale(${1 + ring * 1.4})`, opacity: u > 3.25 ? 1 - ring : 0 }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%', background: INK, border: `4px solid ${ON_INK}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}><PinIcon c={ON_INK} /></div>
        </div>
        {/* La moto */}
        {u > 0.3 && (
          <div style={{
            position: 'absolute', left: rx - 48, top: ry - 48 + bob, width: 96, height: 96, borderRadius: '50%', background: RED,
            display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${chip})`,
            boxShadow: '0 0 0 10px rgba(225,29,72,0.22), 0 14px 34px rgba(0,0,0,0.5)',
          }}>
            <div style={{ transform: `scaleX(${headingAt(cam.draw)})`, display: 'flex' }}><MotoGlyph w={60} color={ON_INK} sw={2.1} /></div>
          </div>
        )}
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 820, background: 'linear-gradient(rgba(11,11,12,0.94) 0%, rgba(11,11,12,0.78) 40%, rgba(11,11,12,0) 100%)' }} />
      <Title t={t} a={T.R0 + 0.45} b={T.S0 - 0.45} dark eyebrow="Choferes habilitados" lines={['DE TU PUERTA', 'A DONDE VAYAS.']} />
      <Title t={t} a={T.S0 + 0.15} b={T.S0 + 2.3} dark eyebrow="Seguimiento" lines={['LO SEGUÍS', 'EN VIVO.']} />
      <Title t={t} a={T.S0 + 2.75} b={T.O0 - 0.75} dark eyebrow="Efectivo o transferencia" lines={['PAGÁS AL', 'TERMINAR.']} />
    </AbsoluteFill>
  );
};

// Rojo que sale de "Confirmar" y se cierra en la puerta donde te buscan.
const RedWipe = ({ t }) => {
  if (t < T.pTap || t > T.R0 + 0.75) return null;
  const v = VIAJE.taps[VIAJE.taps.length - 1];
  const tap = toScreen(phoneBox(cameraAt(VIAJE_CAM, v.vt)), v.x, v.y);
  const grow = p(t, T.pTap + 0.05, T.R0, E_IO);
  const shrink = p(t, T.R0 + 0.02, T.R0 + 0.62, E_IO);
  const start = mapToScreen(mapCamera(t - T.R0), R_PTS[0]);
  const [cx, cy] = shrink > 0 ? start : tap;
  const r = shrink > 0 ? lerp(COVER, 40, shrink) : grow * COVER;
  return <AbsoluteFill style={{ background: RED, clipPath: `circle(${r}px at ${cx}px ${cy}px)` }} />;
};

// ─── 6. Cierre ───
const Outro = ({ t }) => {
  const u = t - T.O0;
  if (u < -0.6) return null;
  const wipe = p(t, T.O0 - 0.6, T.O0 + 0.05, E_IO);
  const markTop = 470;
  const tag = p(u, 0.75, 1.5);
  const cta = p(u, 1.25, 1.9);
  return (
    <AbsoluteFill style={{ background: INK, clipPath: `circle(${wipe * COVER}px at 540px 1250px)` }}>
      <div style={{ position: 'absolute', left: 540 - MARK / 2, top: markTop }}>
        <GoMark size={MARK} draw={p(u, 0.1, 0.9, E_IO)} logo={p(u, 0.4, 0.95)} pulse={pulseAt(u - 0.9)} />
      </div>
      <div style={{ position: 'absolute', top: markTop + MARK + 64, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 84, height: 9, borderRadius: 5, background: RED, transform: `scaleX(${p(u, 0.7, 1.15)})` }} />
        <div style={{
          marginTop: 38, fontFamily: BODY, fontWeight: 800, fontSize: 38, textTransform: 'uppercase', color: ON_INK,
          letterSpacing: `${lerp(0.46, 0.22, tag)}em`, marginRight: `-${lerp(0.46, 0.22, tag)}em`, opacity: tag,
        }}>Viajes en moto</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1290, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: cta, transform: `translateY(${(1 - cta) * 30}px)` }}>
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
  { t: T.H0 + 0.05, src: 'thump', v: 0.7 },
  { t: T.H0 + 0.33, src: 'thump', v: 0.7 },
  { t: T.H1 - 0.12, src: 'whoosh', v: 0.5 },
  { t: T.H1 + 0.55, src: 'thump', v: 0.75 },
  { t: T.P0 - 0.68, src: 'whoosh', v: 0.42 },
  ...VIAJE.taps.map(tp => ({ t: T.P0 + tp.vt - 0.02, src: 'tap', v: 0.45 })),
  { t: T.pTap - 0.45, src: 'riser', v: 0.3 },
  { t: T.pTap + 0.02, src: 'whoosh', v: 0.36 },
  { t: T.R0 + 3.25, src: 'success', v: 0.34 },
  { t: T.S0 - 0.55, src: 'whoosh', v: 0.3 },
  { t: T.O0 - 0.55, src: 'swish', v: 0.4 },
  { t: T.O0 + 0.9, src: 'go-logo', v: 0.8 },
].filter(s => s.t >= 0);

// ─── Composición ───
export const Viajes = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 1000px at 540px 1250px, #fbfaf8 0%, ${PAPER} 70%)` }} />
      <Title t={t} a={T.H0 + 0.05} b={T.H1 - 0.3} top={720} size={150} eyebrow="Viajes GO!" lines={['¿LLEGÁS', 'TARDE?']} />
      <MotoHero t={t} />
      <Title t={t} a={T.H1 + 0.45} b={T.P0 - 1.0} top={1240} size={140} eyebrow="Viajes en moto" lines={['PEDÍ UNA', 'MOTO.']} />
      <Title t={t} a={T.P0 + 0.2} b={T.price - 0.45} eyebrow="Viajes en moto" lines={['ELEGÍS', 'A DÓNDE.']} />
      <Title t={t} a={T.price - 0.1} b={T.pTap - 0.15} eyebrow="Sin sorpresas" lines={['VES EL PRECIO', 'ANTES.']} />
      <MapScene t={t} />
      <PhoneLayer t={t} />
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
