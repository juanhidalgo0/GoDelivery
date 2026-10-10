// Pieza gráfica de Go Cash: "El cajero, en tu puerta." — 4:5 (feed) y 9:16 (estados e historias).
// Efectivo del lado papel, transferencia del lado tinta, y el punto rojo de GO! en el medio.
// Billetes dibujados (no fotos): no se reproducen billetes reales.
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

const { fontFamily: DISPLAY } = loadMontserrat('normal', { weights: ['800', '900'], subsets: ['latin'] });
const { fontFamily: BODY } = loadInter('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] });

const INK = '#0b0b0c';
const PAPER = '#f4f2ee';
const PAPER_2 = '#ebe7e0';
const LINE = '#e4dfd6';
const TEXT2 = '#57534e';
const ON_INK = '#f7f5f1';
const ON_INK_2 = 'rgba(247,245,241,0.62)';
const RED = '#e11d48';

const Eyebrow = ({ children, color = TEXT2, size = 26 }) => (
  <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: size, letterSpacing: '0.24em', textTransform: 'uppercase', color }}>{children}</div>
);

// Pila de billetes estilizados.
const Bills = ({ w }) => (
  <svg width={w} height={w * 0.86} viewBox="0 0 300 258">
    {[[34, 150, -4], [22, 104, 3], [14, 50, -7]].map(([x, y, r], i) => (
      <g key={i} transform={`rotate(${r} 150 ${y + 40})`}>
        <rect x={x} y={y} width="252" height="84" rx="14" fill={i === 2 ? '#fff' : PAPER_2} stroke={INK} strokeWidth="4.5" />
        {i === 2 && (
          <>
            <rect x={x + 12} y={y + 12} width="228" height="60" rx="8" fill="none" stroke={LINE} strokeWidth="3" />
            <circle cx={x + 126} cy={y + 42} r="23" fill={INK} />
            <text x={x + 126} y={y + 52} textAnchor="middle" fontFamily={DISPLAY} fontWeight="900" fontSize="30" fill={ON_INK}>$</text>
            <rect x={x + 30} y={y + 32} width="46" height="7" rx="3.5" fill={LINE} />
            <rect x={x + 30} y={y + 46} width="30" height="7" rx="3.5" fill={LINE} />
            <rect x={x + 176} y={y + 32} width="46" height="7" rx="3.5" fill={LINE} />
            <rect x={x + 192} y={y + 46} width="30" height="7" rx="3.5" fill={LINE} />
          </>
        )}
      </g>
    ))}
  </svg>
);

// Teléfono con la transferencia acreditada.
const TransferPhone = ({ w }) => (
  <svg width={w} height={w * 1.2} viewBox="0 0 200 240">
    <rect x="42" y="8" width="116" height="224" rx="24" fill="#18181a" stroke={ON_INK} strokeWidth="4.5" />
    <rect x="80" y="20" width="40" height="9" rx="4.5" fill={ON_INK} opacity="0.35" />
    <circle cx="100" cy="92" r="30" fill={RED} />
    <path d="M86 92l10 10 19-20" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="64" y="142" width="72" height="12" rx="6" fill={ON_INK} />
    <rect x="76" y="164" width="48" height="8" rx="4" fill={ON_INK} opacity="0.4" />
    <rect x="62" y="194" width="76" height="22" rx="11" fill="none" stroke={ON_INK} strokeOpacity="0.35" strokeWidth="3" />
  </svg>
);

// Unión de las dos tarjetas: flechas de ida y vuelta con el punto rojo del splash arriba.
const Swap = ({ d }) => {
  const k = d / 140;
  return (
    <div style={{ position: 'relative', width: d, height: d }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: PAPER, border: `${5 * k}px solid ${INK}`,
        boxShadow: '0 20px 44px rgba(11,11,12,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width={64 * k} height={64 * k} viewBox="0 0 64 64" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 22h42l-11-11" /><path d="M54 42H12l11 11" />
        </svg>
      </div>
      <span style={{
        position: 'absolute', top: -2 * k, left: '50%', width: 22 * k, height: 22 * k, marginLeft: -11 * k, borderRadius: '50%',
        background: RED, boxShadow: `0 0 0 ${8 * k}px rgba(225,29,72,0.22)`,
      }} />
    </div>
  );
};

const Card = ({ dark, w, h, children }) => (
  <div style={{
    width: w, height: h, borderRadius: 44, background: dark ? INK : '#fff', position: 'relative', overflow: 'hidden',
    boxShadow: dark ? '0 24px 50px rgba(11,11,12,0.25)' : `0 0 0 2px ${LINE}, 0 24px 50px rgba(28,25,23,0.08)`,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 40, boxSizing: 'border-box',
  }}>{children}</div>
);

const CardLabel = ({ dark, title, sub }) => (
  <div style={{ textAlign: 'center', marginTop: 18 }}>
    <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 38, letterSpacing: '-0.01em', color: dark ? ON_INK : INK }}>{title}</div>
    <div style={{ marginTop: 6, fontFamily: BODY, fontWeight: 600, fontSize: 24, color: dark ? ON_INK_2 : TEXT2 }}>{sub}</div>
  </div>
);

const STEPS = [
  { title: 'Lo pedís desde la app', sub: 'Mandados › Go Cash' },
  { title: 'Un repartidor va a tu puerta', sub: 'Con el efectivo, o a buscarlo' },
  { title: 'Intercambian en persona', sub: 'La transferencia se acredita ahí mismo' },
];

const Step = ({ n, title, sub, size }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
    <div style={{
      width: size, height: size, borderRadius: '50%', background: INK, color: ON_INK, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 900, fontSize: size * 0.42,
    }}>{n}</div>
    <div>
      <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: size * 0.5, color: INK, letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ marginTop: 4, fontFamily: BODY, fontWeight: 500, fontSize: size * 0.37, color: TEXT2 }}>{sub}</div>
    </div>
  </div>
);

const Lockup = ({ size = 74 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: INK, position: 'relative' }}>
      <Img src={staticFile('img/logo-brand.jpg')} style={{ position: 'absolute', top: '-1.5%', left: '-1.5%', width: '103%', height: '103%', objectFit: 'cover' }} />
    </div>
    <div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: size * 0.36, color: INK }}>GO! Delivery</div>
      <div style={{ marginTop: 4, fontFamily: BODY, fontWeight: 700, fontSize: size * 0.24, letterSpacing: '0.22em', textTransform: 'uppercase', color: TEXT2 }}>Servicio puerta a puerta</div>
    </div>
  </div>
);

// Llamado a descargar (sin montos ni costos en la pieza).
const Download = ({ size = 26 }) => (
  <div style={{
    padding: `${size * 0.6}px ${size * 1.1}px`, borderRadius: 999, background: INK, fontFamily: BODY, fontWeight: 800,
    fontSize: size, color: ON_INK, whiteSpace: 'nowrap',
  }}>Descargá GO! gratis</div>
);

const Poster = ({ story }) => {
  // story: 1080x1920, con márgenes para las barras de historias y estados.
  const L = story
    ? { pad: 80, top: 230, title: 114, cardsTop: 640, cardW: 424, cardH: 470, swap: 150, stepsTop: 1196, step: 80, stepGap: 34, footBottom: 250 }
    : { pad: 72, top: 84, title: 112, cardsTop: 470, cardW: 424, cardH: 400, swap: 140, stepsTop: 916, step: 66, stepGap: 22, footBottom: 64 };
  const gap = 1080 - L.pad * 2 - L.cardW * 2;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ background: `radial-gradient(900px 700px at 540px ${L.cardsTop + L.cardH / 2}px, #fbfaf8 0%, ${PAPER} 70%)` }} />
      <div style={{ position: 'absolute', left: L.pad, right: L.pad, top: L.top }}>
        <Eyebrow>Go Cash · Efectivo ⇄ Transferencia</Eyebrow>
        <div style={{ marginTop: 16, fontFamily: DISPLAY, fontWeight: 900, fontSize: L.title, lineHeight: 1.0, letterSpacing: '-0.02em', color: INK }}>
          EL CAJERO,<br />EN TU PUERTA.
        </div>
        <div style={{ marginTop: 30, width: 72, height: 9, borderRadius: 5, background: RED }} />
      </div>

      <div style={{ position: 'absolute', left: L.pad, top: L.cardsTop, display: 'flex', gap }}>
        <Card w={L.cardW} h={L.cardH}>
          <Bills w={L.cardW * 0.7} />
          <CardLabel title="EFECTIVO" sub="En mano" />
        </Card>
        <Card dark w={L.cardW} h={L.cardH}>
          <TransferPhone w={L.cardW * 0.46} />
          <CardLabel dark title="TRANSFERENCIA" sub="Al instante" />
        </Card>
      </div>
      <div style={{ position: 'absolute', left: 540 - L.swap / 2, top: L.cardsTop + L.cardH * 0.42 - L.swap / 2 }}>
        <Swap d={L.swap} />
      </div>

      <div style={{ position: 'absolute', left: L.pad, right: L.pad, top: L.stepsTop, display: 'flex', flexDirection: 'column', gap: L.stepGap }}>
        {STEPS.map((s, i) => <Step key={i} n={i + 1} {...s} size={L.step} />)}
      </div>

      <div style={{
        position: 'absolute', left: L.pad, right: L.pad, bottom: L.footBottom, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Lockup /><Download />
      </div>
    </AbsoluteFill>
  );
};

export const GoCashFeed = () => <Poster story={false} />;
export const GoCashStory = () => <Poster story />;
