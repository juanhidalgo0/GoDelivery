import React from 'react';
import { Img, staticFile, interpolate, Easing } from 'remotion';

// iPhone 15 Pro: pantalla 393x852pt. El contenido capturado ocupa 393x798 (debajo de la status bar de 54pt).
export const PT_W = 393;
export const PT_H = 852;
export const STATUS_PT = 54;

// Ancho de pantalla en px del lienzo. Todo el teléfono escala a partir de esto.
export const SCREEN_W = 690;
export const K = SCREEN_W / PT_W; // px por punto
export const SCREEN_H = PT_H * K;
export const BEZEL = 15;
export const FRAME = 7;
const RADIUS = 55 * K;
export const PHONE_W = SCREEN_W + (BEZEL + FRAME) * 2;
export const PHONE_H = SCREEN_H + (BEZEL + FRAME) * 2;

const StatusBar = ({ bg, dark }) => {
  const c = dark ? '#0B0B0F' : '#FFFFFF';
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, width: SCREEN_W, height: STATUS_PT * K, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: `${6 * K}px ${34 * K}px 0 ${50 * K}px`, boxSizing: 'border-box', color: c,
      fontFamily: '-apple-system, "SF Pro Text", Inter, system-ui', fontWeight: 600, fontSize: 17 * K,
    }}>
      <span style={{ letterSpacing: -0.3 }}>9:41</span>
      <div style={{ display: 'flex', gap: 6 * K, alignItems: 'center' }}>
        <svg width={18 * K} height={12 * K} viewBox="0 0 18 12">
          {[0, 1, 2, 3].map(i => <rect key={i} x={i * 4.8} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="0.8" fill={c} />)}
        </svg>
        <svg width={17 * K} height={12 * K} viewBox="0 0 17 12" fill={c}>
          <path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2C14 1.6 11.4.6 8.5.6S3 1.6 1 3.6l1.2 1.2C3.9 3.2 6.1 2.3 8.5 2.3zm0 3.4c1.5 0 2.8.5 3.9 1.5l1.2-1.2C12.2 4.7 10.4 4 8.5 4s-3.7.7-5.1 2l1.2 1.2c1.1-1 2.4-1.5 3.9-1.5zm0 3.4c.6 0 1.1.2 1.5.6L8.5 11.2 7 9.7c.4-.4.9-.6 1.5-.6z" />
        </svg>
        <svg width={27 * K} height={13 * K} viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke={c} strokeOpacity="0.4" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" fill={c} />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill={c} fillOpacity="0.45" />
        </svg>
      </div>
    </div>
  );
};

// Toque: círculo gris translúcido, discreto, con un anillo suave.
const Tap = ({ x, y, age }) => {
  if (age < -0.15 || age > 0.6) return null;
  const inP = interpolate(age, [-0.15, 0], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const outP = interpolate(age, [0.1, 0.55], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring = interpolate(age, [0, 0.5], [1, 1.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const size = 40 * K;
  const cx = x * K, cy = (y + STATUS_PT) * K;
  return (
    <>
      <div style={{
        position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, height: size, borderRadius: '50%',
        background: 'rgba(60,60,67,0.28)', border: `${1.5 * K}px solid rgba(255,255,255,0.7)`,
        transform: `scale(${0.7 + 0.3 * inP})`, opacity: inP * outP,
      }} />
      <div style={{
        position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, height: size, borderRadius: '50%',
        border: `${1.5 * K}px solid rgba(60,60,67,0.35)`, transform: `scale(${ring})`, opacity: age > 0 ? outP * 0.8 : 0,
      }} />
    </>
  );
};

// Dedo deslizando (scroll): el mismo círculo recorriendo la pantalla.
const Swipe = ({ x, y0, y1, age, dur }) => {
  if (age < -0.15 || age > dur + 0.3) return null;
  const p = interpolate(age, [0, dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const op = interpolate(age, [-0.15, 0, dur, dur + 0.3], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const size = 40 * K;
  const cy = (y0 + (y1 - y0) * p + STATUS_PT) * K;
  return (
    <div style={{
      position: 'absolute', left: x * K - size / 2, top: cy - size / 2, width: size, height: size, borderRadius: '50%',
      background: 'rgba(60,60,67,0.28)', border: `${1.5 * K}px solid rgba(255,255,255,0.7)`, opacity: op,
    }} />
  );
};

/**
 * Teléfono con contenido adentro.
 * layers: cuadros de captura [{ capture, file, opacity }] que se superponen (mezcla de cuadros = movimiento fluido).
 * screen: pantalla recreada en React, diseñada en puntos (393x798), debajo de la status bar.
 * status: { bg, dark } para la status bar.
 * taps/swipes: indicadores de toque en puntos, con age = segundos desde el toque.
 */
export const Phone = ({ layers = [], screen = null, status = { bg: '#fff', dark: true }, taps = [], swipes = [], masks = [], children = null }) => {
  const W = SCREEN_W + (BEZEL + FRAME) * 2;
  const H = SCREEN_H + (BEZEL + FRAME) * 2;
  return (
    <div style={{ position: 'relative', width: W, height: H }}>
      {/* Botones laterales */}
      {[[-4, 250, 90], [-4, 360, 90], [-4, 170, 48], [W - 3, 320, 150]].map(([l, t, h], i) => (
        <div key={i} style={{
          position: 'absolute', left: l, top: t, width: 7, height: h, borderRadius: 4,
          background: 'linear-gradient(90deg,#3a3a3f,#8d8d94,#3a3a3f)',
        }} />
      ))}
      {/* Marco de titanio */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: RADIUS + BEZEL + FRAME,
        background: 'linear-gradient(135deg,#6b6b72 0%,#2b2b30 18%,#9a9aa2 50%,#2b2b30 82%,#5d5d63 100%)',
        boxShadow: '0 50px 100px rgba(20,20,30,0.20), 0 14px 30px rgba(20,20,30,0.12)',
      }} />
      {/* Bisel negro */}
      <div style={{
        position: 'absolute', inset: FRAME, borderRadius: RADIUS + BEZEL, background: '#050506',
        boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.08)',
      }} />
      {/* Pantalla */}
      <div style={{
        position: 'absolute', left: BEZEL + FRAME, top: BEZEL + FRAME, width: SCREEN_W, height: SCREEN_H,
        borderRadius: RADIUS, overflow: 'hidden', background: status.bg,
      }}>
        {layers.map((l, i) => (
          <Img key={i} src={staticFile(`captures/${l.capture}/${l.file}`)} style={{
            position: 'absolute', top: STATUS_PT * K, left: 0, width: SCREEN_W, height: (PT_H - STATUS_PT) * K, opacity: l.opacity ?? 1,
          }} />
        ))}
        {screen && (
          <div style={{ position: 'absolute', top: STATUS_PT * K, left: 0, width: SCREEN_W, height: (PT_H - STATUS_PT) * K, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', width: PT_W, height: PT_H - STATUS_PT, transform: `scale(${K})`, transformOrigin: '0 0' }}>
              {screen}
            </div>
          </div>
        )}
        {/* children: contenido extra en px de pantalla (p. ej. la pantalla anterior durante un fundido) */}
        {children}
        {/* Zonas difuminadas por privacidad (coordenadas de captura, en puntos) */}
        {masks.map((m, i) => (
          <div key={i} style={{
            position: 'absolute', left: m.x * K, top: (m.y + STATUS_PT) * K, width: m.w * K, height: m.h * K,
            backdropFilter: `blur(${m.blur ?? 16}px)`, WebkitBackdropFilter: `blur(${m.blur ?? 16}px)`,
            background: 'rgba(240,242,245,0.25)', borderRadius: (m.r ?? 0) * K, opacity: m.opacity ?? 1,
          }} />
        ))}
        <StatusBar bg={status.bg} dark={status.dark} />
        {taps.map((t, i) => <Tap key={i} {...t} />)}
        {swipes.map((t, i) => <Swipe key={'s' + i} {...t} />)}
        {/* Dynamic Island */}
        <div style={{
          position: 'absolute', top: 11 * K, left: (SCREEN_W - 126 * K) / 2, width: 126 * K, height: 37 * K,
          borderRadius: 20 * K, background: '#000',
        }} />
        {/* Home indicator */}
        <div style={{
          position: 'absolute', bottom: 8 * K, left: (SCREEN_W - 139 * K) / 2, width: 139 * K, height: 5 * K,
          borderRadius: 3 * K, background: 'rgba(0,0,0,0.85)',
        }} />
        {/* Reflejo del vidrio */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 28%, rgba(255,255,255,0) 40%)',
        }} />
      </div>
    </div>
  );
};
