// "¿Cuánto te sale ir en moto hasta...?" — un solo video con varios destinos (1080x1920, ~20-25 s).
//   1. La pregunta, con el destino girando como una ruleta hasta caer en el primero
//   2. Primer destino completo: la moto viaja por el mapa y el taxímetro gira hasta frenar en el precio
//   3. Los demás destinos, más rápido (corte al centro y otra vez)
//   4. Tarifario: todos los precios juntos
//   5. La app (mismo precio)            6. Cierre sobre el mapa del principio (empalma al repetirse)
// Datos: node map-viajes.mjs (mapa, recorridos y precios) y flows/go-precio.js + node prep.mjs (la app).
import React from 'react';
import { AbsoluteFill, Audio, Sequence, Img, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { Phone, PHONE_W, PHONE_H, BEZEL, FRAME, K, STATUS_PT } from './Phone.jsx';
import { cameraAt } from './Clip.jsx';
import { FPS, captureBlock, captureLayers } from './capture.js';
import MAP from './viajes-map.json';
import capAtalaya from './captures/go-precio-atalaya.json';
import { DISPLAY, BODY, INK, ON_INK, ON_INK_2, RED, E_OUT, E_IO, E_IN, E_BACK, clamp, p, lerp, GoMark, pulseAt, HouseIcon } from './Brand.jsx';
import { MotoGlyph } from './Viajes.jsx';

// Destinos en el orden del video (los que tengan recorrido en viajes-map.json)
const ORDEN = ['atalaya', 'rio', 'penal', 'empalme', 'nestle', 'jbs'].filter(id => MAP.destinos[id]);
// Cómo se nombran en las frases ("¿Y hasta el río?")
const DICHO = { atalaya: 'Atalaya', rio: 'el río', penal: 'el penal', empalme: 'Empalme', nestle: 'Nestlé', jbs: 'JBS' };
const CORTO = { atalaya: 'ATALAYA', rio: 'EL RÍO', penal: 'EL PENAL', empalme: 'EMPALME', nestle: 'NESTLÉ', jbs: 'JBS' };

const ease = Easing.inOut(Easing.cubic);
const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtKm = (n) => n.toFixed(1).replace('.', ',');

// ─── Línea de tiempo ───
const Q_END = 1.9;
const LEGS = [];
{
  let t0 = Q_END;
  ORDEN.forEach((id, i) => {
    const first = i === 0;
    const ride = first ? 3.2 : 1.35;
    const leg = { id, i, t0, arr: t0 + ride, rev: t0 + ride + 0.15, end: t0 + ride + (first ? 1.35 : 0.85), first };
    LEGS.push(leg);
    t0 = leg.end;
  });
}
const T = {};
T.BOARD0 = LEGS[LEGS.length - 1].end;
T.APP0 = T.BOARD0 + 2.8;
T.END0 = T.APP0 + 4.9;
T.END = T.END0 + 1.8;
export const TARIFAS_DURATION = T.END;
const legAt = (t) => LEGS.find(l => t >= l.t0 && t < l.end) || null;

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
const ROUTES = Object.fromEntries(ORDEN.map(id => [id, routeOf(id)]));
const START_CAM = { s: 1.5, f: MAP.origen, anchor: [540, 1010], blur: 0 };
const legProg = (t, l) => p(t, l.t0 + (l.first ? 0.15 : 0.25), l.arr, ease);

function mapCam(t) {
  if (t < Q_END) return { ...START_CAM, s: lerp(1.42, 1.5, p(t, 0, Q_END, Easing.linear)) };
  if (t >= T.END0) return START_CAM;
  const l = legAt(t) || LEGS[LEGS.length - 1];
  const route = ROUTES[l.id];
  const prog = legProg(t, l);
  const rider = route.at(prog).pt;
  const ahead = route.at(prog + 0.06).pt;
  const follow = [lerp(rider[0], ahead[0], 0.5), lerp(rider[1], ahead[1], 0.5)];
  // Cada tramo arranca en el centro: el primero desde el encuadre inicial, los demás con un barrido rápido
  const prev = l.i > 0 ? MAP.destinos[LEGS[l.i - 1].id].punto : MAP.origen;
  const whip = l.first ? 1 : p(t, l.t0, l.t0 + 0.32, E_IO);
  const toFollow = p(t, l.t0 + (l.first ? 0 : 0.25), l.t0 + (l.first ? 0.6 : 0.55), E_IO);
  const center = [lerp(prev[0], MAP.origen[0], whip), lerp(prev[1], MAP.origen[1], whip)];
  const f = [lerp(center[0], follow[0], toFollow), lerp(center[1], follow[1], toFollow)];
  let s = l.first ? lerp(1.5, 0.95, p(t, l.t0, l.t0 + 0.9, E_IO)) : lerp(lerp(1.9, 1.1, whip), 1.0, p(t, l.t0 + 0.25, l.t0 + 0.6, E_IO));
  s = lerp(s, 1.9, p(t, l.arr - 0.25, l.rev + 0.15, E_OUT));
  const blur = l.first ? 0 : Math.sin(Math.PI * p(t, l.t0, l.t0 + 0.32, Easing.linear)) * 14;
  return { s, f, anchor: [540, 1050], blur };
}
const toScreen = (cam, [x, y]) => [cam.anchor[0] + cam.s * (x - cam.f[0]), cam.anchor[1] + cam.s * (y - cam.f[1])];

const PinIcon = ({ c, size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
const Label = ({ x, y, text, k = 1, dark = false, o = 1 }) => (
  <div style={{
    position: 'absolute', left: x, top: y, transform: `translate(-50%, 0) scale(${k})`, transformOrigin: 'top center', opacity: o,
    padding: '10px 18px', borderRadius: 999, background: dark ? INK : ON_INK, color: dark ? ON_INK : INK,
    fontFamily: BODY, fontWeight: 800, fontSize: 26, letterSpacing: '0.12em', whiteSpace: 'nowrap', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
  }}>{text}</div>
);
const pathOf = (cam, pts) => pts.map((pt, i) => { const [x, y] = toScreen(cam, pt); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');

const MapLayer = ({ t }) => {
  const cam = mapCam(t);
  const l = legAt(t);
  const inLegs = t >= Q_END && t < T.BOARD0;
  const dim = Math.max(p(t, T.BOARD0 - 0.1, T.BOARD0 + 0.4, Easing.linear) * (1 - p(t, T.END0 - 0.3, T.END0 + 0.2, Easing.linear)), 0);
  const [ox, oy] = toScreen(cam, MAP.origen);
  return (
    <AbsoluteFill style={{ background: INK }}>
      <AbsoluteFill style={{ opacity: 1 - dim * 0.55, filter: dim > 0.01 || cam.blur > 0.3 ? `blur(${dim * 10 + cam.blur}px)` : undefined }}>
        <Img src={staticFile('img/map-viajes.png')} style={{
          position: 'absolute', left: cam.anchor[0] - cam.s * cam.f[0], top: cam.anchor[1] - cam.s * cam.f[1], width: IMG_W, height: IMG_H,
          transformOrigin: '0 0', transform: `scale(${cam.s / DPR})`, filter: 'grayscale(1) brightness(1.95) contrast(1.2)',
        }} />
        <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0 }}>
          {/* Los viajes anteriores quedan marcados: se arma la red de destinos */}
          {inLegs && LEGS.filter(x => l && x.i < l.i).map(x => (
            <path key={x.id} d={pathOf(cam, ROUTES[x.id].pts)} fill="none" stroke="rgba(225,29,72,0.45)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {inLegs && l && (() => {
            const r = ROUTES[l.id];
            const { i, pt } = r.at(legProg(t, l));
            const d = pathOf(cam, [...r.pts.slice(0, i), pt]);
            return (<>
              <path d={d} fill="none" stroke="rgba(225,29,72,0.3)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} fill="none" stroke={RED} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
            </>);
          })()}
        </svg>
        {/* Destinos ya visitados (chicos) y el actual */}
        {inLegs && l && LEGS.filter(x => x.i <= l.i).map(x => {
          const [dx, dy] = toScreen(cam, MAP.destinos[x.id].punto);
          const current = x.i === l.i;
          const pop = current ? p(t, l.t0 + 0.3, l.t0 + 0.7, E_BACK) * interpolate(dy, [430, 560], [0, 1], clamp) : 0.6;
          const ring = current ? p(t, l.arr, l.arr + 0.8, E_OUT) : 0;
          return (
            <React.Fragment key={x.id}>
              <div style={{ position: 'absolute', left: dx - 46, top: dy - 46, width: 92, height: 92, transform: `scale(${pop})`, opacity: current ? 1 : 0.8 }}>
                {current && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `4px solid ${RED}`, transform: `scale(${1 + ring * 1.6})`, opacity: t > l.arr ? 1 - ring : 0 }} />}
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%', background: current ? RED : INK, border: `5px solid ${ON_INK}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
                }}><PinIcon c={ON_INK} /></div>
              </div>
              {current && <Label x={dx} y={dy + 60} text={CORTO[x.id]} k={pop * (1 - p(t, l.rev - 0.15, l.rev + 0.1, E_IN))} dark />}
            </React.Fragment>
          );
        })}
        {/* El centro */}
        <div style={{
          position: 'absolute', left: ox - 42, top: oy - 42, width: 84, height: 84, borderRadius: '50%', background: ON_INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}><HouseIcon c={INK} /></div>
        <Label x={ox} y={oy + 56} text="CENTRO" o={inLegs && l && legProg(t, l) > 0.08 ? 1 - p(legProg(t, l), 0.08, 0.15, Easing.linear) : 1} />
        {/* La moto */}
        {inLegs && l && t < l.arr + 0.25 && (() => {
          const r = ROUTES[l.id];
          const prog = legProg(t, l);
          const [rx, ry] = toScreen(cam, r.at(prog).pt);
          const a = r.at(Math.max(0, prog - 0.01)).pt, b = r.at(Math.min(1, prog + 0.01)).pt;
          const dir = b[0] < a[0] - 0.5 ? -1 : 1;
          return (
            <div style={{
              position: 'absolute', left: rx - 52, top: ry - 52 + Math.sin(t * 20) * 2.5 * (prog < 1 ? 1 : 0), width: 104, height: 104, borderRadius: '50%',
              background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: `scale(${p(t, l.t0 + (l.first ? 0 : 0.2), l.t0 + (l.first ? 0.35 : 0.45), E_BACK) * (1 - p(t, l.arr, l.arr + 0.25, E_IN))})`,
              boxShadow: '0 0 0 12px rgba(225,29,72,0.25), 0 14px 34px rgba(0,0,0,0.5)',
            }}>
              <div style={{ transform: `scaleX(${dir})`, display: 'flex' }}><MotoGlyph w={72} color={ON_INK} /></div>
            </div>
          );
        })()}
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 760, background: 'linear-gradient(rgba(11,11,12,0.9) 0%, rgba(11,11,12,0.55) 55%, rgba(11,11,12,0) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 700, background: 'linear-gradient(rgba(11,11,12,0) 0%, rgba(11,11,12,0.75) 60%, rgba(11,11,12,0.92) 100%)' }} />
    </AbsoluteFill>
  );
};

// ─── 1. La pregunta, con el destino como ruleta ───
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
const Question = ({ t }) => {
  if (t > Q_END + 0.5) return null;
  const out = p(t, Q_END - 0.15, Q_END + 0.3, E_IN);
  // La palabra del destino pasa por todos y frena en el primero
  const names = ORDEN.map(id => CORTO[id] + '?');
  const spin = p(t, 0.6, 1.55, Easing.out(Easing.cubic));
  const steps = names.length * 2 + 0; // dos vueltas y cae en el primero
  const idx = Math.min(steps, Math.floor(spin * steps)) % names.length;
  const word = t < 1.55 ? names[idx] : names[0];
  const settle = p(t, 1.5, 1.75, E_BACK);
  const size = (w) => Math.min(190, 940 / (w.length * 0.74 + 0.2));
  return (
    <div style={{ position: 'absolute', left: 72, top: 330 }}>
      <Line t={t} a={0.0} out={out} size={124}>¿CUÁNTO TE</Line>
      <Line t={t} a={0.16} out={out} size={124}>SALE IR EN</Line>
      <Line t={t} a={0.32} out={out} size={124}>MOTO HASTA</Line>
      <div style={{ marginTop: 14, height: 200, overflow: 'hidden', opacity: t < 0.55 ? 0 : 1 - out }}>
        <div style={{
          fontFamily: DISPLAY, fontWeight: 900, fontSize: size(word), lineHeight: '200px', color: RED, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
          transform: `translateY(${t < 1.55 ? 0 : (1 - settle) * -8}px) scale(${t < 1.55 ? 1 : lerp(1.1, 1, settle)})`, transformOrigin: 'left center',
          filter: t < 1.45 ? `blur(${(1 - spin) * 3}px)` : undefined,
        }}>{word}</div>
      </div>
    </div>
  );
};

// Encabezado de cada tramo
const Header = ({ t }) => {
  const l = legAt(t);
  if (!l) return null;
  const a = p(t, l.t0 + 0.05, l.t0 + 0.4, E_OUT);
  const out = l.i === LEGS.length - 1 ? p(t, l.end - 0.3, l.end, E_IN) : 0;
  const text = l.first ? <>¿Cuánto te sale ir<br />hasta <span style={{ color: RED }}>{DICHO[l.id]}</span>?</> : <>¿Y hasta <span style={{ color: RED }}>{DICHO[l.id]}</span>?</>;
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, top: 250, opacity: a * (1 - out), transform: `translateY(${(1 - a) * 40}px)` }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: l.first ? 64 : 84, lineHeight: 1.05, color: ON_INK, letterSpacing: '-0.015em' }}>{text}</div>
    </div>
  );
};

// Destinos arriba: el actual en rojo, los ya vistos con su precio
const Tracker = ({ t }) => {
  if (t < Q_END - 0.1 || t > T.BOARD0 + 0.3) return null;
  const a = p(t, Q_END - 0.1, Q_END + 0.3, E_OUT) * (1 - p(t, T.BOARD0, T.BOARD0 + 0.3, E_IN));
  const l = legAt(t);
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, top: 140, display: 'flex', gap: 12, opacity: a }}>
      {LEGS.map(x => {
        // Antes del primer tramo no se muestra ningún precio (se arruinaría el "adiviná")
        const done = l ? x.i < l.i || (x.i === l.i && t >= x.rev) : t >= T.BOARD0;
        const now = l && x.i === l.i && !done;
        return (
          <div key={x.id} style={{
            flex: 1, height: 52, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: now ? RED : done ? 'rgba(247,245,241,0.14)' : 'rgba(247,245,241,0.06)',
            border: `2px solid ${now ? RED : 'rgba(247,245,241,0.16)'}`,
            fontFamily: BODY, fontWeight: 800, fontSize: 20, letterSpacing: '0.06em', color: now || done ? ON_INK : ON_INK_2, whiteSpace: 'nowrap',
          }}>{done ? fmtMoney(MAP.destinos[x.id].precio) : CORTO[x.id]}</div>
        );
      })}
    </div>
  );
};

// ─── 2. El taxímetro ───
const Roller = ({ t, digit, lockAt, spinStart, idx }) => {
  const k = p(t, lockAt - 0.7, lockAt, Easing.out(Easing.cubic));
  const spinning = t < lockAt;
  const speed = 19 + idx * 5.3;
  const free = (t - spinStart) * speed + idx * 3.7;
  const target = Math.ceil(((lockAt - spinStart) * speed + idx * 3.7 + 5) / 10) * 10 + digit;
  const v = spinning ? (free * (1 - k) + target * k) : digit;
  const off = ((v % 10) + 10) % 10;
  const blur = spinning ? Math.max(0, 1 - k) * 7 : 0;
  return (
    <span style={{ display: 'inline-block', height: '1em', overflow: 'hidden', verticalAlign: 'top' }}>
      <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-off}em)`, filter: blur > 0.2 ? `blur(${blur}px)` : undefined }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => <span key={i} style={{ height: '1em', lineHeight: '1em' }}>{d}</span>)}
      </span>
    </span>
  );
};
const PriceDigits = ({ t, text, lastLock, spinStart, size }) => {
  const digits = [...text].filter(ch => /\d/.test(ch)).length;
  let n = 0;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'flex-start', lineHeight: '1em', fontSize: size }}>
      {[...text].map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i} style={{ height: '1em' }}>{ch}</span>;
        const lockAt = lastLock - (digits - 1 - n) * 0.09;
        const el = <Roller key={i} t={t} digit={Number(ch)} lockAt={lockAt} spinStart={spinStart} idx={n} />;
        n++;
        return el;
      })}
    </span>
  );
};

const Meter = ({ t }) => {
  const l = legAt(t);
  if (!l) return null;
  const d = MAP.destinos[l.id];
  const appear = l.first ? p(t, l.t0 + 0.1, l.t0 + 0.55, E_BACK) : 1;
  const gone = l.i === LEGS.length - 1 ? p(t, l.end - 0.35, l.end, E_IN) : 0;
  const km = d.km * legProg(t, l);
  const blink = Math.floor(t * 3) % 2 === 0;
  const guess = t < l.arr - 0.15;
  // Golpe al frenar: crece y vuelve
  const hit = interpolate(t, [l.rev - 0.02, l.rev + 0.12, l.rev + 0.4], [1, l.first ? 1.12 : 1.08, 1], clamp);
  // Entre tramos el taxímetro "se reinicia": baja y sube
  const swap = l.first ? 0 : interpolate(t, [l.t0, l.t0 + 0.12, l.t0 + 0.3], [0, 1, 0], clamp);
  return (
    <div style={{
      position: 'absolute', left: 540, top: 1400 + swap * 40, width: 900, transform: `translate(-50%, 0) scale(${appear * hit * (1 - gone * 0.1)})`, opacity: (1 - gone) * (1 - swap * 0.5),
      transformOrigin: 'center center',
    }}>
      <div style={{
        position: 'absolute', right: 34, top: -34, zIndex: 2, fontFamily: BODY, fontWeight: 800, fontSize: 30, letterSpacing: '0.1em', color: INK,
        background: ON_INK, borderRadius: 999, padding: '12px 24px', whiteSpace: 'nowrap', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        opacity: guess ? 1 : 0, transform: `rotate(-3deg) scale(${guess ? 1 + Math.sin(t * 7) * 0.05 : 0.6})`,
      }}>ADIVINÁ 👀</div>
      <div style={{
        borderRadius: 40, background: 'linear-gradient(180deg, #1a1a1d 0%, #0b0b0c 100%)', border: `2px solid ${t >= l.rev ? 'rgba(225,29,72,0.7)' : 'rgba(247,245,241,0.14)'}`,
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)', padding: '30px 44px 34px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: BODY, fontWeight: 800, fontSize: 24, letterSpacing: '0.2em', color: ON_INK_2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: RED, opacity: t < l.arr ? (blink ? 1 : 0.25) : 1 }} />
            {t < l.arr ? `A ${CORTO[l.id]}` : 'LLEGASTE'}
          </span>
          <span>{fmtKm(km)} KM</span>
        </div>
        <div style={{ marginTop: 14, fontFamily: DISPLAY, fontWeight: 900, color: ON_INK, letterSpacing: '-0.02em' }}>
          <PriceDigits key={l.id} t={t} text={fmtMoney(d.precio)} lastLock={l.rev} spinStart={l.t0 + 0.1} size={150} />
        </div>
      </div>
    </div>
  );
};

const Flash = ({ t }) => {
  let o = 0;
  for (const l of LEGS) o = Math.max(o, interpolate(t, [l.rev - 0.03, l.rev, l.rev + 0.2], [0, l.first ? 0.85 : 0.5, 0], clamp));
  return o > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: o }} /> : null;
};

// ─── 4. Tarifario ───
const Board = ({ t }) => {
  if (t < T.BOARD0 - 0.05 || t > T.APP0 + 0.1) return null;
  const a = p(t, T.BOARD0, T.BOARD0 + 0.4, E_OUT);
  const out = p(t, T.APP0 - 0.45, T.APP0 - 0.05, E_IN);
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, top: 380, opacity: 1 - out, transform: `translateY(${-out * 60}px)` }}>
      <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 26, letterSpacing: '0.22em', color: ON_INK_2, opacity: a }}>VIAJES EN MOTO · DESDE EL CENTRO</div>
      <div style={{ overflow: 'hidden', marginTop: 12 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 104, color: ON_INK, letterSpacing: '-0.02em', lineHeight: 1.02, transform: `translateY(${(1 - a) * 110}%)` }}>TARIFAS</div>
      </div>
      <div style={{ marginTop: 22, width: 70, height: 8, borderRadius: 4, background: RED, transformOrigin: 'left center', transform: `scaleX(${p(t, T.BOARD0 + 0.2, T.BOARD0 + 0.6)})` }} />
      <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {LEGS.map((x, i) => {
          const k = p(t, T.BOARD0 + 0.3 + i * 0.12, T.BOARD0 + 0.65 + i * 0.12, E_BACK);
          const d = MAP.destinos[x.id];
          return (
            <div key={x.id} style={{
              display: 'flex', alignItems: 'center', gap: 22, padding: '26px 30px', borderRadius: 28,
              background: 'rgba(247,245,241,0.07)', border: '2px solid rgba(247,245,241,0.12)',
              opacity: Math.min(1, k * 1.5), transform: `translateX(${(1 - k) * -80}px)`,
            }}>
              <div style={{ width: 62, height: 62, borderRadius: '50%', background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><PinIcon c={ON_INK} size={30} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 46, color: ON_INK, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{CORTO[x.id]}</div>
                <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 24, color: ON_INK_2, marginTop: 4 }}>{fmtKm(d.km)} km</div>
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 64, color: ON_INK, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.precio)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── 5. La app ───
const PHONE_FY = 1065;
function phoneBoxAt(cam) {
  const dx = BEZEL + FRAME + cam.x * K - PHONE_W / 2;
  const dy = BEZEL + FRAME + (cam.y + STATUS_PT) * K - PHONE_H / 2;
  return { px: 540 - cam.s * dx, py: PHONE_FY - cam.s * dy, s: cam.s };
}
const APP = (() => {
  const block = captureBlock('go-precio-atalaya', capAtalaya, [
    { from: ['destino', -0.3], to: ['precio', 0.2], speed: 1.15 },
    { from: ['precio', 0.2], to: ['precio', 1.9], speed: 1.0 },
    { from: ['precio', 1.9], to: ['pedir', 1.0], speed: 1.15 },
  ]);
  const a = block.toVideo(block.at(['precio', 0.3])), b = block.toVideo(block.at(['precio', 1.8]));
  const base = { s: 1.0, x: 196.5, y: 400 };
  const zoom = { s: 1.3, x: 196.5, y: 440 };
  const cam = [{ t: 0, ...base }, { t: a, ...base }, { t: a + 0.45, ...zoom }, { t: b - 0.25, ...zoom }, { t: b + 0.25, ...base }, { t: 99, ...base }];
  return { block, cam, priceAt: a, pedirAt: block.toVideo(block.at(['pedir', 0])) };
})();

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

const AppScene = ({ t }) => {
  if (t < T.APP0 - 0.6 || t > T.END0 + 0.15) return null;
  const lt = Math.max(0, Math.min(t - T.APP0, APP.block.duration - 0.001));
  const box = phoneBoxAt(cameraAt(APP.cam, lt));
  const rise = p(t, T.APP0 - 0.55, T.APP0 + 0.25, E_OUT) - p(t, T.END0 - 0.55, T.END0 + 0.1, E_IO);
  const { layers, status } = captureLayers(APP.block, lt);
  const taps = APP.block.taps.map(tp => ({ x: tp.x, y: tp.y, age: (t - T.APP0) - tp.vt }));
  const A = T.APP0;
  return (
    <>
      <div style={{
        position: 'absolute', left: box.px - PHONE_W / 2, top: box.py - PHONE_H / 2 + (1 - rise) * 1500,
        width: PHONE_W, height: PHONE_H, transform: `scale(${box.s})`, filter: 'drop-shadow(0 40px 90px rgba(0,0,0,0.6))',
      }}>
        <Phone layers={layers} status={status} taps={taps} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 330, background: 'linear-gradient(rgba(11,11,12,0.92), rgba(11,11,12,0))', opacity: Math.max(0, rise) }} />
      <Caption t={t} a={A + 0.15} b={A + APP.priceAt - 0.15} text="Elegís a dónde" />
      <Caption t={t} a={A + APP.priceAt + 0.05} b={A + APP.pedirAt - 0.7} text="Ves el precio" />
      <Caption t={t} a={A + APP.pedirAt - 0.5} b={T.END0 - 0.5} text="Pedís tu moto" />
    </>
  );
};

// ─── 6. Cierre ───
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
const SFX = (() => {
  const out = [
    { t: 0.0, src: 'thump', v: 0.75 }, { t: 0.16, src: 'thump', v: 0.55 }, { t: 0.32, src: 'thump', v: 0.55 },
    { t: 1.55, src: 'thump', v: 0.95 },
  ];
  for (let s = 0.62; s < 1.5; s += 0.11) out.push({ t: s, src: 'tap', v: 0.18 });
  LEGS.forEach((l) => {
    out.push({ t: l.t0 - 0.02, src: l.first ? 'whoosh' : 'swish', v: 0.42 });
    for (let s = l.t0 + 0.3; s < l.arr - 0.25; s += 0.26) out.push({ t: s, src: 'tap', v: 0.15 });
    if (l.first) out.push({ t: l.arr - 1.2, src: 'riser', v: 0.38 });
    out.push({ t: l.rev, src: 'thump', v: l.first ? 1.0 : 0.85 });
    out.push({ t: l.rev + 0.02, src: 'success', v: l.first ? 0.45 : 0.32 });
  });
  for (let i = 0; i < LEGS.length; i++) out.push({ t: T.BOARD0 + 0.3 + i * 0.12, src: 'pop', v: 0.3 });
  out.push({ t: T.APP0 - 0.5, src: 'whoosh', v: 0.4 });
  APP.block.taps.forEach(tp => out.push({ t: T.APP0 + tp.vt - 0.02, src: 'tap', v: 0.45 }));
  out.push({ t: T.END0 - 0.4, src: 'swish', v: 0.4 }, { t: T.END0 + 0.6, src: 'go-logo', v: 0.7 });
  return out.filter(s => s.t >= 0 && s.t < T.END);
})();

export const Tarifas = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <MapLayer t={t} />
      <Question t={t} />
      <Header t={t} />
      <Tracker t={t} />
      <Meter t={t} />
      <Board t={t} />
      <AppScene t={t} />
      <Outro t={t} />
      <Flash t={t} />
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(1.5 * FPS)}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// Para elegir cuadros de muestra
export const TARIFAS_TIMES = { T, LEGS: LEGS.map(l => ({ id: l.id, t0: l.t0, arr: l.arr, rev: l.rev, end: l.end })) };
