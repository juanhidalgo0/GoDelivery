// Pantallas recreadas con el diseño de GO! (se dibujan en puntos, 393x798, dentro del iPhone).
// Se usan para la parte del flujo que no se graba: confirmación, seguimiento y mandado solicitado.
import React from 'react';
import { Img, staticFile, interpolate, Easing } from 'remotion';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

const { fontFamily: DISPLAY } = loadOutfit('normal', { weights: ['700', '800', '900'] });
const { fontFamily: BODY } = loadInter('normal', { weights: ['500', '600', '700', '800'] });

export const RED = '#E11D48';
const INK = '#0F172A';
const MUTED = '#64748B';
const BG = '#F7F8FA';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const easeOut = Easing.out(Easing.cubic);
const backOut = Easing.out(Easing.back(1.8));
const fadeUp = (t, a, b = a + 0.35) => {
  const p = interpolate(t, [a, b], [0, 1], { ...clamp, easing: easeOut });
  return { opacity: p, transform: `translateY(${(1 - p) * 14}px)` };
};

// Foto real del producto: recorte (en puntos de la captura) de un cuadro del modal de producto.
export const ProductPhoto = ({ photo, crop = { x: 0, y: 0, w: 393 }, w, h, radius = 12, style }) => {
  const k = w / crop.w;
  return (
    <div style={{ width: w, height: h, borderRadius: radius, overflow: 'hidden', position: 'relative', flexShrink: 0, ...style }}>
      <Img src={staticFile(`captures/${photo.capture}/${photo.file}`)} style={{
        position: 'absolute', left: -crop.x * k, top: -crop.y * k, width: 393 * k, height: 798 * k,
      }} />
    </div>
  );
};

const CheckBadge = ({ t, size = 104 }) => {
  const s = interpolate(t, [0.05, 0.45], [0, 1], { ...clamp, easing: backOut });
  const draw = interpolate(t, [0.3, 0.65], [1, 0], { ...clamp, easing: easeOut });
  const ring = interpolate(t, [0.35, 1.2], [1, 1.7], { ...clamp, easing: easeOut });
  const ringOp = interpolate(t, [0.35, 1.2], [0.35, 0], clamp);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: RED, opacity: ringOp, transform: `scale(${ring})` }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: `linear-gradient(145deg, #FF2E55, ${RED})`,
        transform: `scale(${s})`, boxShadow: '0 14px 30px rgba(225,29,72,0.35)',
      }}>
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <path d="M29 52 L44 66 L72 36" fill="none" stroke="white" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"
            pathLength="1" strokeDasharray="1" strokeDashoffset={draw} />
        </svg>
      </div>
    </div>
  );
};

// ─── ¡Pedido confirmado! ───
export const ConfirmScreen = ({ t, photo }) => (
  <div style={{ position: 'absolute', inset: 0, background: BG, fontFamily: BODY, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <div style={{ marginTop: 120 }}><CheckBadge t={t} /></div>
    <div style={{ ...fadeUp(t, 0.35), marginTop: 26, fontFamily: DISPLAY, fontWeight: 800, fontSize: 27, color: INK, letterSpacing: -0.5 }}>
      ¡Pedido confirmado!
    </div>
    <div style={{ ...fadeUp(t, 0.45), marginTop: 8, fontSize: 14, color: MUTED, fontWeight: 500, textAlign: 'center', padding: '0 40px', lineHeight: 1.45 }}>
      <b style={{ color: INK }}>Rey del pollo</b> ya está preparando tu pedido
    </div>
    <div style={{
      ...fadeUp(t, 0.6), marginTop: 30, width: 345, background: 'white', borderRadius: 22, padding: 16, boxSizing: 'border-box',
      boxShadow: '0 6px 24px rgba(15,23,42,0.07)', border: '1px solid #EEF0F4',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ProductPhoto photo={photo} crop={{ x: 95, y: 25, w: 190 }} w={58} h={58} radius={14} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, color: INK }}>Milanesa napolitana</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>Con fritas · x1</div>
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: INK }}>$ 15.000</div>
      </div>
      <div style={{ height: 1, background: '#EEF0F4', margin: '14px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: MUTED, fontWeight: 600 }}>
        <span>Envío</span><span style={{ color: '#10B981' }}>$ 2.150</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, alignItems: 'baseline' }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, color: INK }}>Total</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, color: RED }}>$ 17.150</span>
      </div>
    </div>
    <div style={{
      ...fadeUp(t, 0.85), position: 'absolute', bottom: 40, left: 24, right: 24, height: 54, borderRadius: 18, background: RED,
      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 16,
      boxShadow: '0 10px 24px rgba(225,29,72,0.3)', letterSpacing: 0.3,
    }}>SEGUIR MI PEDIDO</div>
  </div>
);

// ─── Mapa ilustrado (calles de fantasía, sin ubicaciones reales) ───
const BLOCK = 92, STREET = 13, ROT = -16;
// Las calles pasan por múltiplos de BLOCK; el recorrido va por ellas (coordenadas antes de rotar).
const ROUTE = [[92, 184], [92, 368], [276, 368], [276, 552]];
const routeLen = ROUTE.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]), 0);
function pointAt(p) {
  let d = p * routeLen;
  for (let i = 1; i < ROUTE.length; i++) {
    const [ax, ay] = ROUTE[i - 1], [bx, by] = ROUTE[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (d <= seg) return [ax + (bx - ax) * d / seg, ay + (by - ay) * d / seg];
    d -= seg;
  }
  return ROUTE[ROUTE.length - 1];
}
const MapView = ({ t }) => {
  const draw = interpolate(t, [0.15, 0.9], [1, 0], { ...clamp, easing: easeOut });
  const moto = interpolate(t, [0.6, 4.2], [0.08, 0.62], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const [mx, my] = pointAt(moto);
  const cols = [], rows = [];
  for (let x = -BLOCK * 3; x < 393 + BLOCK * 3; x += BLOCK) cols.push(x);
  for (let y = -BLOCK * 3; y < 798 + BLOCK * 3; y += BLOCK) rows.push(y);
  const parks = [[138, 230], [322, 506], [46, 598]];
  const pts = ROUTE.map(p => p.join(',')).join(' ');
  return (
    <svg width="393" height="798" viewBox="0 0 393 798" style={{ position: 'absolute', inset: 0 }}>
      <rect width="393" height="798" fill="#FFFFFF" />
      <g transform={`rotate(${ROT} 196 399)`}>
        {cols.map(x => rows.map(y => {
          const park = parks.some(([px, py]) => Math.abs(px - (x + BLOCK / 2)) < BLOCK / 2 && Math.abs(py - (y + BLOCK / 2)) < BLOCK / 2);
          return <rect key={`${x}-${y}`} x={x + STREET / 2} y={y + STREET / 2} width={BLOCK - STREET} height={BLOCK - STREET} rx="6"
            fill={park ? '#D6EED8' : '#ECEFF3'} />;
        }))}
        {/* Avenida */}
        <rect x={-400} y={368 - 9} width={1200} height={18} fill="#FFFFFF" stroke="#E2E6EB" strokeWidth="1" />
        {/* Recorrido */}
        <polyline points={pts} fill="none" stroke="white" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={pts} fill="none" stroke={RED} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
          pathLength="1" strokeDasharray="1" strokeDashoffset={draw} />
        {/* Local */}
        <g transform={`translate(${ROUTE[0][0]} ${ROUTE[0][1]}) rotate(${-ROT})`}>
          <circle r="17" fill={RED} stroke="white" strokeWidth="3" />
          <text y="6" textAnchor="middle" fontSize="16">🍗</text>
        </g>
        {/* Casa */}
        <g transform={`translate(${ROUTE[3][0]} ${ROUTE[3][1]}) rotate(${-ROT})`}>
          <circle r="17" fill={INK} stroke="white" strokeWidth="3" />
          <path d="M-7 1 L0 -6 L7 1 M-5 -1 V7 H5 V-1" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Moto */}
        <g transform={`translate(${mx} ${my}) rotate(${-ROT})`}>
          <circle r={26 + 4 * Math.sin(t * 5)} fill={RED} opacity="0.12" />
          <circle r="19" fill="white" stroke={RED} strokeWidth="3" />
          <text y="7" textAnchor="middle" fontSize="19">🛵</text>
        </g>
      </g>
    </svg>
  );
};

const STEPS = ['Pendiente', 'Aprobado', 'Preparando', 'Listo', 'En camino'];
const Stepper = ({ t, steps = STEPS, from, to, at }) => {
  const p = interpolate(t, [at, at + 0.6], [0, 1], { ...clamp, easing: easeOut });
  const active = p > 0.6 ? to : from;
  const fill = (from + (to - from) * p) / (steps.length - 1);
  return (
    <div style={{ position: 'relative', height: 50, margin: '0 6px' }}>
      <div style={{ position: 'absolute', top: 10, left: 16, right: 16, height: 3, background: '#E5E7EB', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 10, left: 16, width: `calc((100% - 32px) * ${fill})`, height: 3, background: RED, borderRadius: 2 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'space-between' }}>
        {steps.map((s, i) => {
          const done = i < active, cur = i === active;
          const pulse = cur ? 1 + 0.18 * Math.max(0, Math.sin(t * 5)) : 1;
          return (
            <div key={s} style={{ width: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 -14px' }}>
              <div style={{
                width: 23, height: 23, borderRadius: '50%', background: done || cur ? RED : 'white',
                border: done || cur ? 'none' : '2px solid #E5E7EB', boxSizing: 'border-box', transform: `scale(${pulse})`,
                boxShadow: cur ? '0 0 0 5px rgba(225,29,72,0.15)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {done && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2 L5 8.5 L9.5 3.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, fontWeight: cur ? 800 : 600, color: cur ? RED : '#94A3B8', whiteSpace: 'nowrap' }}>{s}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CodeBar = ({ code, style }) => (
  <div style={{
    height: 50, borderRadius: 16, background: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, ...style,
  }}>
    <span style={{ color: 'white', fontFamily: DISPLAY, fontWeight: 800, fontSize: 13, letterSpacing: 0.8 }}>CÓDIGO DE ENTREGA</span>
    <span style={{ color: '#FF4D6D', fontFamily: DISPLAY, fontWeight: 900, fontSize: 21, letterSpacing: 7 }}>{code}</span>
  </div>
);

// ─── Seguimiento en vivo ───
export const TrackingScreen = ({ t }) => {
  const sheet = interpolate(t, [0.05, 0.55], [260, 0], { ...clamp, easing: easeOut });
  const eta = Math.max(9, Math.round(interpolate(t, [0.8, 4.2], [14, 11], clamp)));
  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: BODY, overflow: 'hidden' }}>
      <MapView t={t} />
      {/* Barra superior */}
      <div style={{ position: 'absolute', top: 10, left: 16, right: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 42, height: 42, borderRadius: 14, background: 'white', boxShadow: '0 4px 14px rgba(15,23,42,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M15 5 L8 12 L15 19" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div style={{ flex: 1, height: 42, borderRadius: 21, background: 'white', boxShadow: '0 4px 14px rgba(15,23,42,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: DISPLAY, fontWeight: 800, fontSize: 15, color: INK }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#10B981', boxShadow: '0 0 0 4px rgba(16,185,129,0.18)' }} />
          Seguimiento en vivo
        </div>
      </div>
      {/* Panel inferior */}
      <div style={{
        position: 'absolute', left: 10, right: 10, bottom: 10, background: 'white', borderRadius: 28, padding: 16, boxSizing: 'border-box',
        boxShadow: '0 -6px 30px rgba(15,23,42,0.12)', transform: `translateY(${sheet}px)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#FFF1F3', border: '1px solid #FFD5DD', borderRadius: 18, padding: '12px 14px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🛵</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, color: RED }}>¡Tu pedido va en camino!</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>Llega en <b style={{ color: INK }}>{eta} min</b> · Rey del pollo</div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}><Stepper t={t} from={3} to={4} at={1.0} /></div>
        <CodeBar code="4821" style={{ marginTop: 14 }} />
      </div>
    </div>
  );
};

// ─── ¡Mandado solicitado! ───
export const MandadoOkScreen = ({ t }) => {
  const bag = interpolate(t, [0.05, 0.5], [0, 1], { ...clamp, easing: backOut });
  return (
    <div style={{ position: 'absolute', inset: 0, background: BG, fontFamily: BODY, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ marginTop: 92, position: 'relative', width: 130, height: 130 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#FFE4E9', transform: `scale(${bag})` }} />
        <Img src={staticFile('img/go-bag.png')} style={{
          position: 'absolute', left: 15, top: 8, width: 100, transform: `scale(${bag}) rotate(${(1 - bag) * -20 + Math.sin(t * 3) * 3}deg)`,
          filter: 'drop-shadow(0 10px 14px rgba(0,0,0,0.18))',
        }} />
      </div>
      <div style={{ ...fadeUp(t, 0.3), marginTop: 22, fontFamily: DISPLAY, fontWeight: 800, fontSize: 27, color: INK, letterSpacing: -0.5 }}>
        ¡Mandado solicitado!
      </div>
      <div style={{ ...fadeUp(t, 0.4), marginTop: 8, fontSize: 14, color: MUTED, fontWeight: 500, textAlign: 'center', padding: '0 44px', lineHeight: 1.45 }}>
        Un repartidor va a comprarlo y te lo lleva a tu puerta
      </div>
      <div style={{
        ...fadeUp(t, 0.55), marginTop: 26, width: 345, background: 'white', borderRadius: 22, padding: 16, boxSizing: 'border-box',
        boxShadow: '0 6px 24px rgba(15,23,42,0.07)', border: '1px solid #EEF0F4',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: '#FFF1F3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>💊</div>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, color: INK }}>Farmacia</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>Ibuprofeno y alcohol en gel</div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <Stepper t={t} steps={['Solicitado', 'Buscando', 'Comprando', 'En camino']} from={0} to={1} at={0.9} />
        </div>
      </div>
      <CodeBar code="3519" style={{ ...fadeUp(t, 0.75), position: 'absolute', bottom: 40, left: 24, right: 24 }} />
    </div>
  );
};
