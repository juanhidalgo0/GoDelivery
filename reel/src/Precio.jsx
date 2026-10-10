// Serie "¿Cuánto te sale ir hasta...?" (1080x1920, ~13 s por destino). Una pregunta, la moto que viaja del
// centro al destino con un taxímetro que gira sin dejar leer el precio, el precio de golpe y la misma
// cuenta en la app. El último cuadro vuelve al mapa del primero, así el video empalma al repetirse.
// Datos: node map-viajes.mjs (mapa, recorridos y precios) y flows/go-precio.js (la app) + node prep.mjs.
import React from 'react';
import { AbsoluteFill, Audio, Sequence, Img, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { Phone, PHONE_W, PHONE_H, BEZEL, FRAME, K, STATUS_PT } from './Phone.jsx';
import { cameraAt } from './Clip.jsx';
import { FPS, captureBlock, captureLayers } from './capture.js';
import MAP from './viajes-map.json';
import capAtalaya from './captures/go-precio-atalaya.json';
import { DISPLAY, BODY, INK, ON_INK, ON_INK_2, RED, E_OUT, E_IO, E_IN, E_BACK, clamp, p, lerp, GoMark, pulseAt, HouseIcon } from './Brand.jsx';
import { MotoGlyph } from './Viajes.jsx';

const CAPTURES = { atalaya: capAtalaya };
// Orden de la serie (para la etiqueta "1/5")
const SERIE = ['atalaya', 'rio', 'penal', 'nestle', 'jbs'];

// ─── Línea de tiempo (segundos) ───
const T = {
  TRIP0: 1.75,   // la pregunta sube y arranca la moto
  ARR: 5.25,     // la moto llega
  REV: 5.45,     // el precio
  APP0: 7.5,     // la app
  END0: 13.3,    // cierre sobre el mapa
};
T.END = T.END0 + 1.8;
export const PRECIO_DURATION = T.END;

const ease = Easing.inOut(Easing.cubic);
const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtKm = (n) => n.toFixed(1).replace('.', ',');

// ─── Mapa ───
const DPR = MAP.dpr;
const IMG_W = MAP.w * DPR, IMG_H = MAP.h * DPR;
function routeOf(id) {
  const pts = MAP.destinos[id].ruta;
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  const at = (f) => {
    const d = Math.max(0, Math.min(1, f)) * total;
    let i = 1; while (i < len.length - 1 && len[i] < d) i++;
    const k = (d - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return { i, pt: [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)] };
  };
  return { pts, at };
}

// Cámara: s = px de video por px CSS del mapa; f = punto del mapa que queda en `anchor`.
const START_CAM = { s: 1.5, f: MAP.origen, anchor: [540, 1010] };
function mapCam(t, route) {
  if (t < T.TRIP0) {
    // Leve acercamiento sobre el centro mientras se lee la pregunta
    return { ...START_CAM, s: lerp(1.42, 1.5, p(t, 0, T.TRIP0, Easing.linear)) };
  }
  const prog = p(t, T.TRIP0 + 0.15, T.ARR, ease);
  const rider = route.at(prog).pt;
  const ahead = route.at(prog + 0.06).pt;
  const follow = p(t, T.TRIP0, T.TRIP0 + 0.6, E_IO);
  const f = [lerp(MAP.origen[0], lerp(rider[0], ahead[0], 0.5), follow), lerp(MAP.origen[1], lerp(rider[1], ahead[1], 0.5), follow)];
  // Se abre para que se vea el viaje y se cierra de golpe al llegar
  let s = lerp(1.5, 0.95, p(t, T.TRIP0, T.TRIP0 + 0.9, E_IO));
  s = lerp(s, 2.1, p(t, T.ARR - 0.25, T.REV + 0.15, E_OUT));
  const anchor = [540, lerp(1010, 1060, follow)];
  // En el cierre vuelve al encuadre del principio (el video empalma)
  if (t >= T.END0) return START_CAM;
  return { s, f, anchor };
}
const toScreen = (cam, [x, y]) => [cam.anchor[0] + cam.s * (x - cam.f[0]), cam.anchor[1] + cam.s * (y - cam.f[1])];

const PinIcon = ({ c, size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

const Label = ({ x, y, text, k = 1, dark = false }) => (
  <div style={{
    position: 'absolute', left: x, top: y, transform: `translate(-50%, 0) scale(${k})`, transformOrigin: 'top center',
    padding: '10px 18px', borderRadius: 999, background: dark ? INK : ON_INK, color: dark ? ON_INK : INK,
    fontFamily: BODY, fontWeight: 800, fontSize: 26, letterSpacing: '0.12em', whiteSpace: 'nowrap', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
  }}>{text}</div>
);

const MapLayer = ({ t, id, route }) => {
  const cam = mapCam(t, route);
  const inTrip = t >= T.TRIP0 && t < T.END0;
  const prog = inTrip ? p(t, T.TRIP0 + 0.15, T.ARR, ease) : 0;
  const partial = (() => { const { i, pt } = route.at(prog); return [...route.pts.slice(0, i), pt]; })();
  const path = partial.map((pt, i) => { const [x, y] = toScreen(cam, pt); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  const [ox, oy] = toScreen(cam, MAP.origen);
  const [dx, dy] = toScreen(cam, MAP.destinos[id].punto);
  const [rx, ry] = toScreen(cam, route.at(prog).pt);
  const dir = (() => { const a = route.at(Math.max(0, prog - 0.01)).pt, b = route.at(Math.min(1, prog + 0.01)).pt; return b[0] < a[0] - 0.5 ? -1 : 1; })();
  const destIn = p(t, T.TRIP0 + 0.4, T.TRIP0 + 0.9, E_BACK) * interpolate(dy, [430, 560], [0, 1], clamp);
  const arrive = p(t, T.ARR, T.ARR + 0.8, E_OUT);
  // Durante la app y el cierre el mapa queda de fondo, oscuro y desenfocado
  const dim = Math.max(p(t, T.APP0 - 0.5, T.APP0, Easing.linear) * (1 - p(t, T.END0 - 0.3, T.END0 + 0.2, Easing.linear)), 0);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <AbsoluteFill style={{ opacity: 1 - dim * 0.55, filter: dim > 0.01 ? `blur(${dim * 10}px)` : undefined }}>
        <Img src={staticFile('img/map-viajes.png')} style={{
          position: 'absolute', left: cam.anchor[0] - cam.s * cam.f[0], top: cam.anchor[1] - cam.s * cam.f[1], width: IMG_W, height: IMG_H,
          transformOrigin: '0 0', transform: `scale(${cam.s / DPR})`, filter: 'grayscale(1) brightness(1.95) contrast(1.2)',
        }} />
        {inTrip && (
          <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0 }}>
            <path d={path} fill="none" stroke="rgba(225,29,72,0.3)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
            <path d={path} fill="none" stroke={RED} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {/* El centro */}
        <div style={{
          position: 'absolute', left: ox - 42, top: oy - 42, width: 84, height: 84, borderRadius: '50%', background: ON_INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}><HouseIcon c={INK} /></div>
        <Label x={ox} y={oy + 56} text="CENTRO" k={t < T.TRIP0 + 1 || t >= T.END0 ? 1 : 1 - p(t, T.TRIP0 + 0.6, T.TRIP0 + 1, E_IN)} />
        {/* El destino */}
        {inTrip && (
          <>
            <div style={{ position: 'absolute', left: dx - 46, top: dy - 46, width: 92, height: 92, transform: `scale(${destIn})` }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `4px solid ${RED}`, transform: `scale(${1 + arrive * 1.6})`, opacity: t > T.ARR ? 1 - arrive : 0 }} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%', background: RED, border: `5px solid ${ON_INK}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
              }}><PinIcon c={ON_INK} /></div>
            </div>
            <Label x={dx} y={dy + 60} text={MAP.destinos[id].nombre} k={destIn * (1 - p(t, T.REV - 0.15, T.REV + 0.1, E_IN))} dark />
          </>
        )}
        {/* La moto */}
        {inTrip && t < T.APP0 && (
          <div style={{
            position: 'absolute', left: rx - 52, top: ry - 52 + Math.sin(t * 20) * 2.5 * (prog < 1 ? 1 : 0), width: 104, height: 104, borderRadius: '50%',
            background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: `scale(${p(t, T.TRIP0, T.TRIP0 + 0.35, E_BACK) * (1 - p(t, T.ARR, T.ARR + 0.25, E_IN))})`,
            boxShadow: '0 0 0 12px rgba(225,29,72,0.25), 0 14px 34px rgba(0,0,0,0.5)',
          }}>
            <div style={{ transform: `scaleX(${dir})`, display: 'flex' }}><MotoGlyph w={72} color={ON_INK} /></div>
          </div>
        )}
      </AbsoluteFill>
      {/* Legibilidad arriba y abajo */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 760, background: 'linear-gradient(rgba(11,11,12,0.9) 0%, rgba(11,11,12,0.55) 55%, rgba(11,11,12,0) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 700, background: 'linear-gradient(rgba(11,11,12,0) 0%, rgba(11,11,12,0.75) 60%, rgba(11,11,12,0.92) 100%)' }} />
    </AbsoluteFill>
  );
};

// ─── 1. La pregunta ───
const Line = ({ t, a, out, children, size, color = ON_INK }) => {
  const k = p(t, a, a + 0.32, E_OUT);
  return (
    <div style={{ overflow: 'hidden', padding: '0.12em 0 0.04em', margin: '-0.12em 0 -0.04em' }}>
      <div style={{
        fontFamily: DISPLAY, fontWeight: 900, fontSize: size, lineHeight: 1.0, letterSpacing: '-0.02em', color, whiteSpace: 'nowrap',
        transform: `translateY(${(1 - k) * 110 - out * 120}%) scale(${lerp(1.08, 1, k)})`, transformOrigin: 'left bottom',
      }}>{children}</div>
    </div>
  );
};

const Question = ({ t, nombre }) => {
  if (t > T.TRIP0 + 0.5) return null;
  const out = p(t, T.TRIP0 - 0.1, T.TRIP0 + 0.3, E_IN);
  const destSize = Math.min(200, 940 / (nombre.length * 0.74 + 0.6));
  return (
    <div style={{ position: 'absolute', left: 72, top: 330 }}>
      <Line t={t} a={0.0} out={out} size={132}>¿CUÁNTO</Line>
      <Line t={t} a={0.18} out={out} size={132}>TE SALE IR</Line>
      <Line t={t} a={0.36} out={out} size={132}>HASTA</Line>
      <div style={{ marginTop: 10 }}>
        <Line t={t} a={0.62} out={out} size={destSize} color={RED}>{nombre}?</Line>
      </div>
    </div>
  );
};

// Encabezado compacto durante el viaje
const Header = ({ t, nombre }) => {
  const a = p(t, T.TRIP0 + 0.1, T.TRIP0 + 0.5, E_OUT);
  const b = p(t, T.APP0 - 0.5, T.APP0 - 0.2, E_IN);
  if (a <= 0 || b >= 1) return null;
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, top: 250, opacity: a * (1 - b), transform: `translateY(${(1 - a) * 30 - b * 30}px)` }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 64, lineHeight: 1.05, color: ON_INK, letterSpacing: '-0.015em' }}>
        ¿Cuánto te sale ir<br />hasta <span style={{ color: RED }}>{nombre.charAt(0) + nombre.slice(1).toLowerCase()}</span>?
      </div>
    </div>
  );
};

// ─── 2. El taxímetro ───
// Cada dígito es una tira 0-9 que gira; frena de izquierda a derecha justo al llegar.
const DIGIT_H = 1.0; // em
const Roller = ({ t, digit, lockAt, size, idx = 0 }) => {
  const spinStart = T.TRIP0 + 0.2;
  const k = p(t, lockAt - 0.9, lockAt, Easing.out(Easing.cubic));
  const spinning = t < lockAt;
  // Gira a velocidad constante y en la ventana de frenado se mezcla con un destino fijo (siempre hacia adelante)
  const speed = 19 + idx * 5.3;
  const free = (t - spinStart) * speed + idx * 3.7;
  const target = Math.ceil(((lockAt - spinStart) * speed + idx * 3.7 + 5) / 10) * 10 + digit;
  const v = spinning ? (free * (1 - k) + target * k) : digit;
  const off = ((v % 10) + 10) % 10;
  const blur = spinning ? Math.max(0, 1 - k) * 7 : 0;
  return (
    <span style={{ display: 'inline-block', height: `${DIGIT_H}em`, overflow: 'hidden', verticalAlign: 'top', fontSize: size }}>
      <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-off * DIGIT_H}em)`, filter: blur > 0.2 ? `blur(${blur}px)` : undefined }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => <span key={i} style={{ height: `${DIGIT_H}em`, lineHeight: `${DIGIT_H}em` }}>{d}</span>)}
      </span>
    </span>
  );
};

const PriceDigits = ({ t, text, lockBase, size, step = 0.12 }) => {
  let n = 0;
  const digits = [...text].filter(ch => /\d/.test(ch)).length;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'flex-start', lineHeight: `${DIGIT_H}em`, fontSize: size }}>
      {[...text].map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i} style={{ height: `${DIGIT_H}em` }}>{ch}</span>;
        const lockAt = lockBase - (digits - 1) * step + n * step + 0.3;
        n++;
        return <Roller key={i} t={t} digit={Number(ch)} lockAt={lockAt} size="1em" idx={n} />;
      })}
    </span>
  );
};

const Meter = ({ t, d }) => {
  const a = p(t, T.TRIP0 + 0.1, T.TRIP0 + 0.55, E_BACK);
  const lift = p(t, T.REV - 0.05, T.REV + 0.45, E_OUT);
  const gone = p(t, T.APP0 - 0.5, T.APP0 - 0.15, E_IN);
  if (a <= 0 || gone >= 1) return null;
  const km = d.km * p(t, T.TRIP0 + 0.15, T.ARR, ease);
  const priceText = fmtMoney(d.precio);
  const blink = Math.floor(t * 3) % 2 === 0;
  const guess = t < T.ARR - 0.2;
  // Al aparecer el precio el taxímetro sube al centro y crece
  const y = lerp(1430, 820, lift);
  const sc = lerp(1, 1.12, lift) * (1 + Math.sin(Math.max(0, t - T.REV) * 40) * 0.025 * (1 - p(t, T.REV, T.REV + 0.5, Easing.linear)));
  return (
    <div style={{
      position: 'absolute', left: 540, top: y, width: 900, transform: `translate(-50%, 0) scale(${a * sc * (1 - gone * 0.1)})`, opacity: 1 - gone,
      transformOrigin: 'top center',
    }}>
      <div style={{
        position: 'absolute', right: 34, top: -34, zIndex: 2, fontFamily: BODY, fontWeight: 800, fontSize: 30, letterSpacing: '0.1em', color: INK,
        background: ON_INK, borderRadius: 999, padding: '12px 24px', whiteSpace: 'nowrap', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        opacity: guess ? 1 : 0, transform: `rotate(-3deg) scale(${guess ? 1 + Math.sin(t * 7) * 0.05 : 0.6})`,
      }}>ADIVINÁ 👀</div>
      <div style={{
        borderRadius: 40, background: 'linear-gradient(180deg, #1a1a1d 0%, #0b0b0c 100%)', border: '2px solid rgba(247,245,241,0.14)',
        boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 0 ${lift > 0 ? 10 * (1 - lift) : 0}px rgba(225,29,72,0.4)`, padding: '30px 44px 34px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: BODY, fontWeight: 800, fontSize: 24, letterSpacing: '0.2em', color: ON_INK_2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: RED, opacity: t < T.ARR ? (blink ? 1 : 0.25) : 1 }} />
            {t < T.ARR ? 'VIAJE EN MOTO' : 'LLEGASTE'}
          </span>
          <span>{fmtKm(km)} KM</span>
        </div>
        <div style={{ marginTop: 14, fontFamily: DISPLAY, fontWeight: 900, color: ON_INK, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <PriceDigits t={t} text={priceText} lockBase={T.REV - 0.3} size={150} step={0.1} />
        </div>
      </div>
      {/* Debajo del precio, ya revelado */}
      <div style={{ marginTop: 34, textAlign: 'center', fontFamily: BODY, fontWeight: 800, fontSize: 30, letterSpacing: '0.16em', color: ON_INK, opacity: p(t, T.REV + 0.2, T.REV + 0.6) }}>
        DESDE EL CENTRO · EN MOTO
      </div>
    </div>
  );
};

// Barra que se llena hasta el precio + etiqueta de la serie
const Progress = ({ t, id }) => {
  const fill = p(t, 0, T.REV, Easing.linear);
  const out = p(t, T.REV + 0.3, T.REV + 0.7, Easing.linear);
  const n = SERIE.indexOf(id) + 1;
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, top: 150, display: 'flex', alignItems: 'center', gap: 22, opacity: 1 - out * (t < T.END0 ? 1 : 0) }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(247,245,241,0.18)', overflow: 'hidden' }}>
        <div style={{ width: `${fill * 100}%`, height: '100%', background: RED, borderRadius: 4 }} />
      </div>
      <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 26, letterSpacing: '0.14em', color: ON_INK_2 }}>{n}/{SERIE.length}</div>
    </div>
  );
};

const Flash = ({ t }) => {
  const o = interpolate(t, [T.REV - 0.03, T.REV, T.REV + 0.22], [0, 0.85, 0], clamp);
  return o > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: o }} /> : null;
};

// ─── 3. La app ───
// El punto (x, y) de la pantalla del teléfono queda en (540, PHONE_FY) del video.
const PHONE_FY = 1065;
function phoneBoxAt(cam) {
  const dx = BEZEL + FRAME + cam.x * K - PHONE_W / 2;
  const dy = BEZEL + FRAME + (cam.y + STATUS_PT) * K - PHONE_H / 2;
  return { px: 540 - cam.s * dx, py: PHONE_FY - cam.s * dy, s: cam.s };
}
function appBlock(id) {
  const data = CAPTURES[id];
  if (!data) return null;
  const block = captureBlock(`go-precio-${id}`, data, [
    { from: ['destino', -0.3], to: ['precio', 0.2], speed: 1.0 },
    { from: ['precio', 0.2], to: ['precio', 2.2], speed: 1.0 },
    { from: ['precio', 2.2], to: ['pedir', 1.4], speed: 1.0 },
  ]);
  const a = block.toVideo(block.at(['precio', 0.3])), b = block.toVideo(block.at(['precio', 2.1]));
  const base = { s: 1.0, x: 196.5, y: 400 };
  const zoom = { s: 1.3, x: 196.5, y: 440 };
  const cam = [{ t: 0, ...base }, { t: a, ...base }, { t: a + 0.5, ...zoom }, { t: b - 0.3, ...zoom }, { t: b + 0.3, ...base }, { t: 99, ...base }];
  return { block, cam, priceAt: a, pedirAt: block.toVideo(block.at(['pedir', 0])) };
}

const Caption = ({ t, a, b, text }) => {
  if (t < a - 0.05 || t > b + 0.3) return null;
  const k = p(t, a, a + 0.3, E_OUT), o = p(t, b, b + 0.25, E_IN);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 120, display: 'flex', justifyContent: 'center' }}>
      <div style={{ overflow: 'hidden', padding: '0.12em 0 0.04em' }}>
        <div style={{
          fontFamily: DISPLAY, fontWeight: 900, fontSize: 84, color: ON_INK, letterSpacing: '-0.015em', whiteSpace: 'nowrap',
          background: INK, borderRadius: 28, padding: '14px 40px 18px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          transform: `translateY(${(1 - k) * 130 - o * 130}%)`,
        }}>{text}</div>
      </div>
    </div>
  );
};

const AppScene = ({ t, app }) => {
  if (!app || t < T.APP0 - 0.6 || t > T.END0 + 0.1) return null;
  const lt = Math.max(0, Math.min(t - T.APP0, app.block.duration - 0.001));
  const box = phoneBoxAt(cameraAt(app.cam, lt));
  const rise = p(t, T.APP0 - 0.55, T.APP0 + 0.25, E_OUT) - p(t, T.END0 - 0.55, T.END0 + 0.1, E_IO);
  const { layers, status } = captureLayers(app.block, lt);
  const taps = app.block.taps.map(tp => ({ x: tp.x, y: tp.y, age: (t - T.APP0) - tp.vt }));
  const A = T.APP0;
  return (
    <>
      <div style={{
        position: 'absolute', left: box.px - PHONE_W / 2, top: box.py - PHONE_H / 2 + (1 - rise) * 1500,
        width: PHONE_W, height: PHONE_H, transform: `scale(${box.s})`, filter: 'drop-shadow(0 40px 90px rgba(0,0,0,0.6))',
      }}>
        <Phone layers={layers} status={status} taps={taps} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 330, background: 'linear-gradient(rgba(11,11,12,0.92), rgba(11,11,12,0))', opacity: rise }} />
      <Caption t={t} a={A + 0.15} b={A + app.priceAt - 0.15} text="Elegís a dónde" />
      <Caption t={t} a={A + app.priceAt + 0.05} b={A + app.pedirAt - 0.75} text="Ves el precio" />
      <Caption t={t} a={A + app.pedirAt - 0.55} b={T.END0 - 0.5} text="Pedís tu moto" />
    </>
  );
};

// ─── 4. Cierre ───
const Outro = ({ t }) => {
  const u = t - T.END0;
  if (u < -0.1) return null;
  const tag = p(u, 0.45, 0.95);
  const cta = p(u, 0.6, 1.1);
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ position: 'absolute', top: 360, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <GoMark size={240} draw={p(u, 0, 0.6, E_IO)} logo={p(u, 0.2, 0.65)} pulse={pulseAt(u - 0.6)} />
        <div style={{ marginTop: 36, width: 70, height: 8, borderRadius: 4, background: RED, transform: `scaleX(${p(u, 0.35, 0.7)})` }} />
        <div style={{
          marginTop: 26, fontFamily: BODY, fontWeight: 800, fontSize: 32, textTransform: 'uppercase', color: ON_INK,
          letterSpacing: `${lerp(0.42, 0.22, tag)}em`, marginRight: `-${lerp(0.42, 0.22, tag)}em`, opacity: tag,
        }}>Viajes en moto</div>
      </div>
      <div style={{ position: 'absolute', top: 1380, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: cta, transform: `translateY(${(1 - cta) * 24}px)` }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 70, color: ON_INK, letterSpacing: '-0.015em' }}>DESCARGÁ GO!</div>
        <div style={{ marginTop: 26, display: 'flex', gap: 18 }}>
          {['App Store', 'Google Play'].map(s => (
            <div key={s} style={{ padding: '16px 30px', borderRadius: 999, border: '2px solid rgba(247,245,241,0.28)', fontFamily: BODY, fontWeight: 700, fontSize: 28, color: ON_INK }}>{s}</div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Sonido ───
function sfxFor(app) {
  const ticks = [];
  for (let s = T.TRIP0 + 0.3; s < T.ARR - 0.3; s += 0.26) ticks.push({ t: s, src: 'tap', v: 0.16 });
  return [
    { t: 0.0, src: 'thump', v: 0.75 },
    { t: 0.18, src: 'thump', v: 0.55 },
    { t: 0.36, src: 'thump', v: 0.55 },
    { t: 0.62, src: 'thump', v: 0.9 },
    { t: T.TRIP0 - 0.05, src: 'whoosh', v: 0.45 },
    ...ticks,
    { t: T.ARR - 1.3, src: 'riser', v: 0.4 },
    { t: T.REV, src: 'thump', v: 1.0 },
    { t: T.REV + 0.02, src: 'success', v: 0.45 },
    { t: T.APP0 - 0.5, src: 'whoosh', v: 0.4 },
    ...(app ? app.block.taps.map(tp => ({ t: T.APP0 + tp.vt - 0.02, src: 'tap', v: 0.45 })) : []),
    { t: T.END0 - 0.4, src: 'swish', v: 0.4 },
    { t: T.END0 + 0.6, src: 'go-logo', v: 0.7 },
  ].filter(s => s.t >= 0 && s.t < T.END);
}

// ─── Composición ───
export const Precio = ({ destino = 'atalaya' }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const d = MAP.destinos[destino];
  const route = React.useMemo(() => routeOf(destino), [destino]);
  const app = React.useMemo(() => appBlock(destino), [destino]);
  const sfx = React.useMemo(() => sfxFor(app), [app]);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <MapLayer t={t} id={destino} route={route} />
      <Question t={t} nombre={d.nombre} />
      <Header t={t} nombre={d.nombre} />
      <Meter t={t} d={d} />
      <Progress t={t} id={destino} />
      <AppScene t={t} app={app} />
      <Outro t={t} />
      <Flash t={t} />
      {sfx.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(1.5 * FPS)}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
