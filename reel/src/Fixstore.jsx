// Video de Fixstore en GO! (1080x1920, ~21 s). Mismo lenguaje que el video de marca (Brand.jsx).
//   1. "¿Conocés a Fixstore?": su perfil de Instagram (recreado, con las fotos de su tienda en GO!)
//   2. Se toca la foto de perfil: el logo viaja y se vuelve la tienda de Fixstore en la app
//   3. La app real: parlante JBL + templado, carrito
//   4. Mapa: de la puerta de Fixstore a tu casa
//   5. Cierre: "Fixstore ya está en GO!", horario y descarga
// Grabación: flows/go-fixstore.js (con REEL_FAKE_TZ para que figure abierto). Recorrido: node route.mjs 691 1284 1010 1800 fixstore-route
// Render: npx remotion render src/index.js GoFixstore out/GO-fixstore.mp4 --crf=16
import React from 'react';
import { AbsoluteFill, Audio, Sequence, Img, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { Phone, PHONE_W, PHONE_H, K, STATUS_PT } from './Phone.jsx';
import { cameraAt } from './Clip.jsx';
import { FPS, captureBlock, captureLayers } from './capture.js';
import fixData from './captures/go-fixstore.json';
import ROUTE from './fixstore-route.json';
import {
  DISPLAY, BODY, INK, PAPER, ON_INK, ON_INK_2, RED, E_OUT, E_IO, E_IN, E_BACK, clamp, p, lerp, COVER,
  BASE, phoneBox, toScreen, Title, GoMark, pulseAt, MARK_K, DOT, HouseIcon,
} from './Brand.jsx';

// Música: base propia generada con music.mjs (118 BPM; el drop cae en T.G0, los golpes en T.R0 y T.O0).
const MUSIC = 'music/fixstore.wav';
const IMG = (f) => staticFile(`img/fixstore/${f}`);

// ─── Grabación ───
const mark = (l) => fixData.marks.find(m => m.label === l).t;
const GO = captureBlock('go-fixstore', fixData, [
  { from: ['tienda', 1.6], to: ['jbl', 0], speed: 1.6 },
  { from: ['jbl', 0], to: ['jbl-ok', 0], speed: 1.7 },
  { from: ['jbl-ok', 0], to: ['templado', 0], speed: 2.0 },
  { from: ['templado', 0], to: ['templado-ok', 0], speed: 2.4 },
  { from: ['templado-ok', 0], to: ['skip', 0.05], speed: 1.2 },
  { from: ['carrito', 0.1], to: ['carrito', 1.6], speed: 1.2 },
], { virtualTaps: [{ t: mark('carrito') + 1.3, x: 280, y: 663 }] });

// ─── Línea de tiempo (segundos) ───
const T = {};
T.igUp = 3.1;                                   // vuelve arriba del perfil
T.igTap = 3.7;                                  // toque en la foto de perfil
T.G0 = 3.85;                                    // el logo viaja; aparece la tienda en GO!
T.P0 = T.G0 + 0.65;                             // arranca la grabación
T.pTap = T.P0 + GO.taps[GO.taps.length - 1].vt; // toque en Confirmar
// El mapa y el cierre caen en tiempos de la música (music.mjs: 118 BPM, tiempo 0 en T.G0).
const BEAT = 60 / 118;
T.R0 = T.G0 + 20 * BEAT;                        // el rojo tapó todo: mapa (~0.55 s después del toque)
T.O0 = T.G0 + 27 * BEAT;                        // cierre
T.END = T.O0 + 3.6;
export const FIXSTORE_DURATION = T.END;

// ─── 1. Perfil de Instagram (recreado; en puntos, 393x798) ───
const IG_BG = '#000';
const IG_TX = '#f5f5f5';
const IG_TX2 = '#a8a8a8';
const IG_BTN = '#262626';
const IG_GRID = ['banner.jpg', 'p34.jpg', 'p02.jpg', 'p13.jpg', 'p25.jpg', 'p28.jpg', 'p30.jpg', 'p22.jpg', 'p08.jpg',
  'p32.jpg', 'p35.jpg', 'p06.jpg', 'p27.jpg', 'p23.jpg', 'p26.jpg', 'p29.jpg', 'p17.jpg', 'p00.jpg'];
const TILE_W = (393 - 2) / 3, TILE_H = TILE_W * 4 / 3;
const GRID_TOP = 322;
// Foto de perfil (centro y diámetro de la imagen, en puntos)
const IG_LOGO = { x: 16 + 44, y: 52 + 44, d: 78 };
// Logo en la tienda de GO! (primer cuadro de la grabación)
const GO_LOGO = { x: 77, y: 195, d: 64 };

const igScroll = (t) => {
  const down = interpolate(t, [0.9, 2.9], [0, 470], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const up = p(t, T.igUp, T.igUp + 0.45, E_OUT);
  return down * (1 - up);
};

const Stat = ({ n, l }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 70 }}>
    <span style={{ fontSize: 16, fontWeight: 700, color: IG_TX }}>{n}</span>
    <span style={{ fontSize: 13, color: IG_TX, marginTop: 1 }}>{l}</span>
  </div>
);
const IgIcon = ({ kind, on }) => {
  const c = on ? IG_TX : IG_TX2;
  if (kind === 'grid') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>
  );
  if (kind === 'reels') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M10 9.5v5l4.5-2.5z" fill={c} /></svg>
  );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="12" cy="10" r="3" /><path d="M7 19c1-2.5 3-3.6 5-3.6s4 1.1 5 3.6" /></svg>
  );
};

const IgProfile = ({ t, hideLogo }) => {
  const sy = igScroll(t);
  return (
    <div style={{ position: 'absolute', inset: 0, background: IG_BG, fontFamily: `${BODY}, system-ui`, color: IG_TX, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${-sy}px)` }}>
        {/* Encabezado */}
        <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" style={{ position: 'absolute', left: 12 }} fill="none" stroke={IG_TX} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          <span style={{ fontSize: 17, fontWeight: 700 }}>fixstore.ar</span>
          <span style={{ position: 'absolute', right: 16, fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>···</span>
        </div>
        {/* Foto de perfil con el aro de historias */}
        <div style={{ position: 'absolute', left: IG_LOGO.x - 44, top: IG_LOGO.y - 44, width: 88, height: 88, borderRadius: '50%', background: 'conic-gradient(from 200deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #feda75)' }}>
          <div style={{ position: 'absolute', inset: 2.5, borderRadius: '50%', background: IG_BG }} />
          {!hideLogo && <Img src={IMG('logo.jpg')} style={{ position: 'absolute', left: 5, top: 5, width: IG_LOGO.d, height: IG_LOGO.d, borderRadius: '50%', objectFit: 'cover' }} />}
        </div>
        <div style={{ position: 'absolute', left: 122, top: 58 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>fixstore.ar</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
            <Stat n="1.451" l="publicaciones" />
            <Stat n="12,6 mil" l="seguidores" />
            <Stat n="5.330" l="seguidos" />
          </div>
        </div>
        {/* Biografía */}
        <div style={{ position: 'absolute', left: 16, right: 16, top: 152, fontSize: 14, lineHeight: 1.38 }}>
          <div style={{ fontWeight: 700 }}>Local en Magdalena 📍</div>
          <div>🚀 Productos de primera</div>
          <div>📱 Venta y reparación de equipos</div>
          <div style={{ color: IG_TX2 }}>Accesorios para celu · Audio · Tecnología</div>
        </div>
        {/* Botones */}
        <div style={{ position: 'absolute', left: 16, right: 16, top: 242, display: 'flex', gap: 7 }}>
          {['Siguiendo', 'Mensaje'].map(s => (
            <div key={s} style={{ flex: 1, height: 33, borderRadius: 9, background: IG_BTN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{s}</div>
          ))}
          <div style={{ width: 36, height: 33, borderRadius: 9, background: IG_BTN, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={IG_TX} strokeWidth="2.2" strokeLinecap="round"><circle cx="9" cy="8" r="4" /><path d="M2 21c1-4 4-6 7-6s6 2 7 6M19 8v6M16 11h6" /></svg>
          </div>
        </div>
        {/* Pestañas */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 284, height: 36, display: 'flex' }}>
          {['grid', 'reels', 'tagged'].map((k, i) => (
            <div key={k} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: i === 0 ? `1.5px solid ${IG_TX}` : '1px solid #262626' }}>
              <IgIcon kind={k} on={i === 0} />
            </div>
          ))}
        </div>
        {/* Grilla */}
        {IG_GRID.map((f, i) => (
          <div key={f} style={{
            position: 'absolute', left: (i % 3) * (TILE_W + 1), top: GRID_TOP + Math.floor(i / 3) * (TILE_H + 1), width: TILE_W, height: TILE_H, overflow: 'hidden', background: '#111',
          }}>
            <Img src={IMG(f)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Teléfono: Instagram → GO! ───
const BOX = phoneBox(BASE);
const GO_CAM = (() => {
  const a = GO.toVideo(GO.at(['jbl', 0.15])), b = GO.toVideo(GO.at(['jbl', 2.2]));
  const z = { s: 1.08, x: 196.5, y: 215 };
  return [{ t: 0, ...BASE }, { t: a, ...BASE }, { t: a + 0.45, ...z }, { t: b - 0.4, ...z }, { t: b, ...BASE }, { t: 999, ...BASE }];
})();

const goSwipes = (lt) => GO.data.swipes
  .map(s => ({ s, vt: GO.toVideo(s.t) }))
  .filter(x => x.vt != null)
  .map(({ s, vt }) => ({ x: s.x, y0: s.y0, y1: s.y1, dur: s.dur / 1.6, age: lt - vt }));

const PhoneLayer = ({ t }) => {
  if (t > T.R0 + 0.05) return null;
  const rise = p(t, -0.4, 0.55, E_OUT);
  const lt = t - T.P0;
  const glt = Math.max(0, Math.min(lt, GO.duration - 0.001));
  const box = t < T.P0 ? BOX : phoneBox(cameraAt(GO_CAM, glt));
  const { layers, status } = captureLayers(GO, glt);
  // Revelado de la tienda: un círculo que se abre desde la foto de perfil.
  const rev = p(t, T.G0, T.G0 + 0.6, E_IO);
  const showIg = t < T.G0 + 0.6;
  const r = rev * 1000;
  const mask = `radial-gradient(circle at ${IG_LOGO.x}px ${IG_LOGO.y}px, transparent ${r}px, #000 ${r + 0.5}px)`;
  // La foto de perfil viaja hasta el logo de la tienda.
  const mv = p(t, T.G0, T.G0 + 0.65, E_IO);
  const lg = { x: lerp(IG_LOGO.x, GO_LOGO.x, mv), y: lerp(IG_LOGO.y, GO_LOGO.y, mv), d: lerp(IG_LOGO.d, GO_LOGO.d, mv) };
  const pop = 1 + 0.12 * Math.sin(Math.PI * mv);
  const flying = t >= T.G0 && t < T.G0 + 0.68;
  const igTaps = [{ x: IG_LOGO.x, y: IG_LOGO.y, age: t - T.igTap }];
  const igSwipes = [{ x: 250, y0: 640, y1: 260, dur: 2.0, age: t - 0.9 }, { x: 250, y0: 300, y1: 560, dur: 0.45, age: t - T.igUp }];
  const inGo = t >= T.G0;
  const taps = inGo ? GO.taps.map(tp => ({ x: tp.x, y: tp.y, age: lt - tp.vt })) : igTaps;
  return (
    <div style={{
      position: 'absolute', left: box.px - PHONE_W / 2, top: box.py - PHONE_H / 2 + (1 - rise) * 260,
      width: PHONE_W, height: PHONE_H, transform: `scale(${box.s * lerp(0.94, 1, rise)})`,
    }}>
      <Phone
        layers={inGo ? layers : []}
        status={showIg && rev < 0.5 ? { bg: IG_BG, dark: false } : status}
        screen={showIg ? (
          <div style={{ position: 'absolute', inset: 0, WebkitMaskImage: rev > 0 ? mask : undefined, maskImage: rev > 0 ? mask : undefined }}>
            <IgProfile t={t} hideLogo={t >= T.G0} />
          </div>
        ) : null}
        taps={taps}
        swipes={inGo ? goSwipes(lt) : igSwipes}
      >
        {/* El logo de la grabación se tapa (con el aro blanco de la tarjeta) hasta que llega el que viaja. */}
        {flying && (
          <div style={{
            position: 'absolute', left: (GO_LOGO.x - 36) * K, top: (GO_LOGO.y + STATUS_PT - 36) * K, width: 72 * K, height: 72 * K,
            borderRadius: '50%', background: '#fff',
          }} />
        )}
        {flying && (
          <Img src={IMG('logo.jpg')} style={{
            position: 'absolute', left: (lg.x - lg.d * pop / 2) * K, top: (lg.y + STATUS_PT - lg.d * pop / 2) * K,
            width: lg.d * pop * K, height: lg.d * pop * K, borderRadius: '50%', objectFit: 'cover',
            boxShadow: `0 ${14 * mv * (1 - mv) * 4}px ${40 * mv * (1 - mv) * 4}px rgba(0,0,0,0.35)`,
          }} />
        )}
      </Phone>
    </div>
  );
};

// ─── 4. Mapa: de la puerta de Fixstore a tu casa ───
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
const M = { draw0: 0.35, draw1: 2.35, toEnd0: 2.55, toEnd1: 3.05, zoom0: 2.8, zoom1: 3.55 };

function mapCamera(u) {
  const draw = p(u, M.draw0, M.draw1, E_IO);
  const rider = routeAt(draw).pt;
  const push = p(u, -0.2, 3.0, Easing.inOut(Easing.quad));
  let s = lerp(0.95, 1.05, push);
  let f = [lerp(R_CENTER[0], rider[0], 0.15), lerp(R_CENTER[1], rider[1], 0.15)];
  const toEnd = p(u, M.toEnd0, M.toEnd1, E_IO);
  f = [lerp(f[0], R_END[0], toEnd), lerp(f[1], R_END[1], toEnd)];
  const anchor = [540, lerp(1250, 960, toEnd)];
  s *= Math.pow(5, p(u, M.zoom0, M.zoom1, E_IN));
  return { s, f, anchor, draw, rider };
}
const mapToScreen = (cam, [x, y]) => [cam.anchor[0] + cam.s * (x - cam.f[0]), cam.anchor[1] + cam.s * (y - cam.f[1])];

const MapScene = ({ t }) => {
  const u = t - T.R0;
  if (u < 0 || t > T.O0 + 0.02) return null;
  const cam = mapCamera(u);
  const fadeOut = p(u, 3.05, 3.5, Easing.linear);
  const partial = (() => { const { i, pt } = routeAt(cam.draw); return [...R_PTS.slice(0, i), pt]; })();
  const toS = (pt) => mapToScreen(cam, pt);
  const path = partial.map((pt, i) => `${i ? 'L' : 'M'}${toS(pt)[0].toFixed(1)} ${toS(pt)[1].toFixed(1)}`).join(' ');
  const [sx, sy] = toS(R_PTS[0]);
  const [ex, ey] = toS(R_END);
  const [rx, ry] = toS(cam.rider);
  const pinA = p(u, 0.1, 0.55, E_BACK), pinB = p(u, 0.4, 0.85, E_BACK);
  const arrive = pulseAt(u - M.draw1);
  const ring = p(u, M.draw1, M.draw1 + 0.75, E_OUT);
  const pinsOut = p(u, 2.8, 3.05, Easing.linear);
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
        {/* Puerta de Fixstore: su logo */}
        <div style={{
          position: 'absolute', left: sx - 48, top: sy - 48, width: 96, height: 96, borderRadius: '50%', background: '#000', overflow: 'hidden',
          border: `4px solid ${ON_INK}`, boxShadow: '0 10px 30px rgba(0,0,0,0.45)', transform: `scale(${pinA})`, opacity: 1 - pinsOut,
        }}><Img src={IMG('logo.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
        {/* Puerta de tu casa */}
        <div style={{ position: 'absolute', left: ex - 40, top: ey - 40, width: 80, height: 80, transform: `scale(${pinB})`, opacity: 1 - pinsOut }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `3px solid ${RED}`, transform: `scale(${1 + ring * 1.4})`, opacity: u > M.draw1 ? 1 - ring : 0 }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%', background: INK, border: `4px solid ${ON_INK}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}><HouseIcon c={ON_INK} /></div>
        </div>
      </AbsoluteFill>
      {u > M.draw0 - 0.05 && (
        <div style={{
          position: 'absolute', left: rx - DOT / 2, top: ry - DOT / 2, width: DOT, height: DOT, borderRadius: '50%', background: RED,
          boxShadow: `0 0 0 ${arrive.halo * MARK_K}px rgba(225,29,72,${u > M.draw1 ? arrive.a : 0.22})`, transform: `scale(${arrive.s})`,
        }} />
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 820, opacity: 1 - p(u, 2.6, 3.0, Easing.linear), background: 'linear-gradient(rgba(11,11,12,0.94) 0%, rgba(11,11,12,0.78) 40%, rgba(11,11,12,0) 100%)' }} />
      <Title t={t} a={T.R0 + 0.4} b={T.R0 + 2.6} dark size={84} eyebrow="Repartidores de Magdalena" lines={['PEDILO Y', 'TE LO LLEVAMOS.']} />
    </AbsoluteFill>
  );
};

// Rojo que sale de "Confirmar" y se cierra en la puerta de Fixstore.
const CONFIRM_TAP = (() => { const v = GO.taps[GO.taps.length - 1]; return toScreen(BOX, v.x, v.y); })();
const RedWipe = ({ t }) => {
  if (t < T.pTap || t > T.R0 + 0.75) return null;
  const grow = p(t, T.pTap + 0.05, T.R0, E_IO);
  const shrink = p(t, T.R0 + 0.02, T.R0 + 0.62, E_IO);
  const start = mapToScreen(mapCamera(t - T.R0), R_PTS[0]);
  const [cx, cy] = shrink > 0 ? start : CONFIRM_TAP;
  const r = shrink > 0 ? lerp(COVER, 44, shrink) : grow * COVER;
  return <AbsoluteFill style={{ background: RED, clipPath: `circle(${r}px at ${cx}px ${cy}px)` }} />;
};

// ─── 5. Cierre ───
const OUT_MARK = 250;
const Outro = ({ t }) => {
  const u = t - T.O0;
  if (u < 0) return null;
  const cy = 520;
  const gx = 540 + 165, fx = 540 - 165;
  const k = OUT_MARK / 184;
  const ringTop = cy - OUT_MARK / 2 + 2.4 * k + 5 * k;
  const move = p(u, 0, 0.4, E_IO);
  const draw = p(u, 0.35, 1.05, E_IO);
  const fix = p(u, 0.25, 0.8, E_BACK);
  const head = (i) => p(u, 0.75 + i * 0.1, 1.35 + i * 0.1);
  const info = p(u, 1.35, 1.95);
  const cta = p(u, 1.7, 2.3);
  const dotX = lerp(540, gx, move), dotY = lerp(960, ringTop, move);
  const dotD = lerp(DOT, 10 * k, move);
  return (
    <AbsoluteFill style={{ background: INK }}>
      {/* Fixstore + GO! */}
      <div style={{
        position: 'absolute', left: fx - OUT_MARK / 2 + 12 * k, top: cy - OUT_MARK / 2 + 12 * k, width: OUT_MARK - 24 * k, height: OUT_MARK - 24 * k,
        borderRadius: '50%', overflow: 'hidden', background: '#000', boxShadow: `0 0 0 ${2.5 * k}px ${ON_INK}`, transform: `scale(${fix})`,
      }}><Img src={IMG('logo.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
      <div style={{
        position: 'absolute', left: 540 - 20, top: cy - 30, width: 40, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: DISPLAY, fontWeight: 900, fontSize: 52, color: ON_INK_2, opacity: p(u, 0.55, 0.9),
      }}>+</div>
      <div style={{ position: 'absolute', left: gx - OUT_MARK / 2, top: cy - OUT_MARK / 2 }}>
        <GoMark size={OUT_MARK} draw={draw} logo={p(u, 0.6, 1.1)} pulse={pulseAt(u - 1.05)} rider={u >= 0.35 ? 1 : 0} />
      </div>
      {u < 0.35 && (
        <div style={{
          position: 'absolute', left: dotX - dotD / 2, top: dotY - dotD / 2, width: dotD, height: dotD, borderRadius: '50%',
          background: RED, boxShadow: `0 0 0 ${4 * MARK_K}px rgba(225,29,72,0.22)`,
        }} />
      )}
      {/* Titular */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {['FIXSTORE', 'YA ESTÁ EN GO!'].map((ln, i) => (
          <div key={i} style={{ overflow: 'hidden', padding: '0.14em 0 0.04em', margin: '-0.14em 0 -0.04em' }}>
            <div style={{
              fontFamily: DISPLAY, fontWeight: 900, fontSize: 104, lineHeight: 1.02, letterSpacing: '-0.015em', color: ON_INK,
              whiteSpace: 'nowrap', transform: `translateY(${(1 - head(i)) * 118}%)`,
            }}>{ln}</div>
          </div>
        ))}
        <div style={{ marginTop: 40, width: 84, height: 9, borderRadius: 5, background: RED, transform: `scaleX(${p(u, 1.15, 1.6)})` }} />
        <div style={{
          marginTop: 36, fontFamily: BODY, fontWeight: 800, fontSize: 34, textTransform: 'uppercase', color: ON_INK,
          letterSpacing: `${lerp(0.4, 0.16, info)}em`, marginRight: `-${lerp(0.4, 0.16, info)}em`, opacity: info,
        }}>Lun a Sáb · 9–13 y 17–21</div>
      </div>
      {/* Descarga */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1390, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: cta, transform: `translateY(${(1 - cta) * 30}px)` }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 64, color: ON_INK, letterSpacing: '-0.015em' }}>DESCARGÁ GO!</div>
        <div style={{ marginTop: 30, display: 'flex', gap: 20 }}>
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
  { t: 0.0, src: 'whoosh', v: 0.28 },
  { t: T.igTap - 0.02, src: 'tap', v: 0.45 },
  { t: T.G0 + 0.02, src: 'swish', v: 0.42 },
  { t: T.G0 + 0.62, src: 'pop', v: 0.3 },
  ...GO.taps.map(tp => ({ t: T.P0 + tp.vt - 0.02, src: 'tap', v: 0.45 })),
  { t: T.pTap + 0.02, src: 'whoosh', v: 0.36 },
  { t: T.R0 + M.draw1, src: 'success', v: 0.34 },
  { t: T.R0 + M.zoom0, src: 'whoosh', v: 0.3 },
  { t: T.O0 + 0.3, src: 'pop', v: 0.3 },
  { t: T.O0 + 1.05, src: 'go-logo', v: 0.8 },
].filter(s => s.t >= 0);

// ─── Composición ───
export const Fixstore = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 1000px at 540px 1250px, #fbfaf8 0%, ${PAPER} 70%)` }} />
      <PhoneLayer t={t} />
      <Title t={t} a={0.1} b={T.G0 - 0.25} eyebrow="Tecnología en Magdalena" lines={['¿CONOCÉS A', 'FIXSTORE?']} />
      <Title t={t} a={T.G0 + 0.2} b={T.P0 + 2.2} eyebrow="Fixstore" lines={['AHORA TAMBIÉN', 'ESTÁ EN GO!']} />
      <Title t={t} a={T.P0 + 2.55} b={T.pTap - 0.1} size={80} eyebrow="En la app" lines={['ACCESORIOS,', 'CARGADORES,', 'PARLANTES Y MÁS']} />
      <MapScene t={t} />
      <RedWipe t={t} />
      <Outro t={t} />
      {MUSIC && <Audio src={staticFile(MUSIC)} volume={0.8} />}
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(1.7 * FPS)}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
