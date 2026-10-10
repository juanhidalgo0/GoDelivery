// Sorteo de los 1.000 vecinos: post de feed (4:5, fijo) y reel (9:16, animado, 16 s).
//   npx remotion still src/index.js SorteoFeed out/sorteo-feed.png
//   npx remotion render src/index.js SorteoReel out/sorteo-reel.mp4 --crf=16
// Premios: $150.000 en Puntos GO (1° 50.000, 2° 30.000, 3° 20.000, 4° al 8° 10.000 c/u).
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate, spring, Easing } from 'remotion';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { FPS } from './capture.js';

const { fontFamily: DISPLAY } = loadMontserrat('normal', { weights: ['800', '900'], subsets: ['latin'] });
const { fontFamily: BODY } = loadInter('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] });

const INK = '#0b0b0c';
const INK_2 = '#161618';
const INK_LINE = '#2c2c30';
const PAPER = '#f4f2ee';
const LINE = '#e4dfd6';
const TEXT2 = '#57534e';
const ON_INK = '#f7f5f1';
const ON_INK_2 = 'rgba(247,245,241,0.62)';
const RED = '#e11d48';
const ROSE = '#fda4af';

const PRIZES = [
  { pos: 2, amount: '$30.000', h: 0.8 },
  { pos: 1, amount: '$50.000', h: 1 },
  { pos: 3, amount: '$20.000', h: 0.64 },
];
const TOTAL = 150000;
const URL = 'godelivery-magdalena.web.app/sorteo';
const CHANCES = [
  ['+5', 'Por cada pedido'],
  ['+2', 'Por cada vecino que invitás'],
  ['+2', 'Si activás las notificaciones'],
  ['+1', 'Solo por anotarte'],
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const ramp = (t, a, b, from = 0, to = 1, easing = OUT) => interpolate(t, [a, b], [from, to], { ...clamp, easing });
const pop = (frame, at, cfg = { damping: 13, stiffness: 190 }) => spring({ frame: frame - Math.round(at * FPS), fps: FPS, config: cfg });
const fmt = (n) => Math.round(n).toLocaleString('es-AR');

// Números pseudoaleatorios fijos: el confeti sale igual en cada render.
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const CONFETTI_COLORS = [RED, ON_INK, ROSE, RED, '#fb7185'];
const makeConfetti = (n, seed) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    x: r(), y: r(), a: r() * Math.PI * 2, v: 0.55 + r() * 0.75, spin: (r() - 0.5) * 900, rot: r() * 360,
    w: 10 + r() * 16, h: 6 + r() * 10, round: r() < 0.3, color: CONFETTI_COLORS[Math.floor(r() * CONFETTI_COLORS.length)],
  }));
};

const Piece = ({ p, x, y, rot, opacity = 1 }) => (
  <div style={{
    position: 'absolute', left: x, top: y, width: p.round ? p.h * 1.4 : p.w, height: p.round ? p.h * 1.4 : p.h,
    borderRadius: p.round ? '50%' : 2, background: p.color, transform: `rotate(${rot}deg)`, opacity,
  }} />
);

// Confeti quieto, repartido en una zona (post fijo).
const StillConfetti = ({ pieces, box }) => (
  <>
    {pieces.map((p, i) => (
      <Piece key={i} p={p} x={box.x + p.x * box.w} y={box.y + p.y * box.h} rot={p.rot} opacity={0.35 + p.v * 0.6} />
    ))}
  </>
);

// Explosión de confeti desde un punto, con gravedad.
const Burst = ({ pieces, t, at, cx, cy, power = 1500 }) => {
  const dt = t - at;
  if (dt < 0 || dt > 3.2) return null;
  return (
    <>
      {pieces.map((p, i) => {
        const vx = Math.cos(p.a) * power * p.v;
        const vy = Math.sin(p.a) * power * p.v - 900;
        const drag = (1 - Math.exp(-dt * 2.2)) / 2.2;
        const x = cx + vx * drag;
        const y = cy + vy * drag + 700 * dt * dt;
        return <Piece key={i} p={p} x={x} y={y} rot={p.rot + p.spin * dt} opacity={ramp(dt, 2.4, 3.2, 1, 0)} />;
      })}
    </>
  );
};

// Logo GO!: círculo con borde y el punto rojo arriba (como la faja del billete).
export const Logo = ({ d = 84, dot = 1, color = ON_INK, bg = INK }) => (
  <div style={{
    position: 'relative', width: d, height: d, borderRadius: '50%', border: `${d * 0.05}px solid ${color}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: DISPLAY, fontWeight: 900, fontSize: d * 0.36, letterSpacing: -d * 0.012, color,
  }}>
    GO!
    <span style={{
      position: 'absolute', top: -d * 0.11, left: '50%', width: d * 0.19, height: d * 0.19, marginLeft: -d * 0.095,
      borderRadius: '50%', background: RED, boxShadow: `0 0 0 ${d * 0.06}px ${bg}`, transform: `scale(${dot})`,
    }} />
  </div>
);

const Eyebrow = ({ children, color = ON_INK_2, size = 26, style }) => (
  <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: size, letterSpacing: '0.24em', textTransform: 'uppercase', color, ...style }}>{children}</div>
);

const Star = ({ s = 40, color = RED }) => (
  <svg width={s} height={s} viewBox="0 0 24 24"><path fill={color} d="M12 1.8l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.6l-6.3 3.6 1.5-7.1L1.8 9.2 9 8.4z" /></svg>
);

// Podio de premios. grow[i] (0..1) anima cada bloque; w = ancho total.
// dark: sobre fondo tinta, el 2° y 3° van en papel para que se vean.
const Podium = ({ w, maxH, grow = [1, 1, 1], scale = 1, dark = false }) => {
  const gap = 16 * scale;
  const bw = (w - gap * 2) / 3;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap, width: w, height: maxH + 70 * scale }}>
      {PRIZES.map((p, i) => {
        const g = grow[i];
        const first = p.pos === 1;
        return (
          <div key={p.pos} style={{ width: bw, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, g * 3) }}>
            <div style={{ height: 62 * scale, display: 'flex', alignItems: 'flex-end', paddingBottom: 10 * scale, transform: `scale(${Math.min(1, g * 1.4)})` }}>
              {first ? <Star s={50 * scale} /> : null}
            </div>
            <div style={{
              width: '100%', height: maxH * p.h * g, borderRadius: `${26 * scale}px ${26 * scale}px ${14 * scale}px ${14 * scale}px`,
              background: first ? RED : dark ? PAPER : INK, color: first || !dark ? ON_INK : INK, overflow: 'hidden',
              display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 22 * scale,
              boxShadow: first ? '0 24px 50px rgba(225,29,72,0.35)' : '0 18px 40px rgba(11,11,12,0.25)',
            }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (first ? 34 : 28) * scale, color: first ? '#ffe4e9' : dark ? TEXT2 : ON_INK_2 }}>{p.pos}°</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: (first ? 50 : 42) * scale, letterSpacing: -1.5 * scale, marginTop: 2 * scale, whiteSpace: 'nowrap' }}>{p.amount}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Franja "4° al 8°": cinco premios de $10.000.
const MorePrizes = ({ scale = 1, shown = 5, dark = false }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 * scale,
    borderRadius: 22 * scale, padding: `${18 * scale}px ${26 * scale}px`,
    background: dark ? INK_2 : '#fff', border: `${2 * scale}px solid ${dark ? INK_LINE : LINE}`,
  }}>
    <div>
      <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 20 * scale, letterSpacing: '0.16em', textTransform: 'uppercase', color: RED }}>4° al 8° premio</div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 38 * scale, letterSpacing: -1 * scale, color: dark ? ON_INK : INK, marginTop: 2 * scale }}>
        $10.000 <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 22 * scale, letterSpacing: 0, color: dark ? ON_INK_2 : TEXT2 }}>cada uno</span>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 10 * scale }}>
      {[4, 5, 6, 7, 8].map((n, i) => (
        <div key={n} style={{
          width: 48 * scale, height: 48 * scale, borderRadius: '50%', background: dark ? INK : INK, border: `${2 * scale}px solid ${dark ? INK_LINE : INK}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: ON_INK,
          fontFamily: DISPLAY, fontWeight: 900, fontSize: 20 * scale,
          transform: `scale(${i < shown ? 1 : 0})`,
        }}>{n}°</div>
      ))}
    </div>
  </div>
);

// ───────────────────────────── Post fijo 4:5 ─────────────────────────────
export const SorteoFeed = () => {
  const confetti = makeConfetti(34, 11);
  return (
    <AbsoluteFill style={{ background: INK, color: ON_INK, padding: '60px 72px 56px', display: 'flex', flexDirection: 'column' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(700px 560px at 88% 20%, rgba(225,29,72,0.30), transparent 70%)' }} />
      <StillConfetti pieces={confetti} box={{ x: 640, y: 150, w: 380, h: 330 }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Logo d={80} />
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 28 }}>GO! Delivery</div>
            <Eyebrow size={17} style={{ marginTop: 4 }}>Servicio puerta a puerta</Eyebrow>
          </div>
        </div>
        <div style={{ background: RED, borderRadius: 999, padding: '14px 26px', fontFamily: DISPLAY, fontWeight: 900, fontSize: 22, letterSpacing: '0.14em' }}>SORTEO</div>
      </div>

      <div style={{ position: 'relative', marginTop: 44 }}>
        <Eyebrow size={28}>Ya somos</Eyebrow>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 212, lineHeight: 0.9, letterSpacing: -10, marginLeft: -8, marginTop: 10 }}>
          1.000<span style={{ color: RED }}>!</span>
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 54, letterSpacing: -1, marginTop: 8 }}>VECINOS EN GO!</div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 28, color: ON_INK_2, marginTop: 12 }}>
          Gracias, Magdalena. <span style={{ color: ON_INK, fontWeight: 800 }}>Lo festejamos con un sorteo.</span>
        </div>
      </div>

      <div style={{ position: 'relative', marginTop: 38, background: PAPER, color: INK, borderRadius: 36, padding: '30px 40px 32px', boxShadow: '0 30px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow color={TEXT2} size={21}>Sorteamos</Eyebrow>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 82, letterSpacing: -4, lineHeight: 1, marginTop: 6 }}>
              $150.000<span style={{ fontSize: 34, letterSpacing: -0.5, color: RED, marginLeft: 12 }}>en Puntos GO</span>
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', top: 30, right: 40, background: INK, color: ON_INK, borderRadius: 999, padding: '10px 20px', fontFamily: DISPLAY, fontWeight: 900, fontSize: 22 }}>8 ganadores</div>
        <div style={{ marginTop: -14 }}>
          <Podium w={856} maxH={196} />
        </div>
        <div style={{ marginTop: 14 }}><MorePrizes scale={0.86} /></div>
      </div>

      <div style={{ position: 'relative', marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 30 }}>Cada pedido suma <span style={{ color: RED }}>+5 chances</span></div>
          <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 22, color: ON_INK_2, marginTop: 6 }}>{URL}</div>
        </div>
        <div style={{ background: ON_INK, color: INK, borderRadius: 999, padding: '20px 30px', fontFamily: DISPLAY, fontWeight: 900, fontSize: 25, whiteSpace: 'nowrap' }}>Anotate gratis</div>
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Reel 9:16 ─────────────────────────────
// Tiempos (s)
const T = {
  COUNT: 0.25, COUNT_END: 1.75, BANG: 1.8, THANKS: 2.35,
  S2: 4.4, TOTAL: 4.9, TOTAL_END: 6.3,
  PODIUM: 7.0, MORE: 9.1,
  S3: 10.6, OUTRO: 13.3, END: 16.3,
};
export const SORTEO_REEL_DURATION = T.END;

const Scene1 = ({ t, frame, burst }) => {
  const n = Math.round(interpolate(t, [T.COUNT, T.COUNT_END], [0, 1000], { ...clamp, easing: Easing.bezier(0.3, 0, 0.1, 1) }));
  const bang = pop(frame, T.BANG, { damping: 9, stiffness: 220 });
  const out = ramp(t, T.S2 - 0.35, T.S2, 0, 1, Easing.in(Easing.cubic));
  const shake = t > T.BANG && t < T.BANG + 0.25 ? Math.sin((t - T.BANG) * 90) * 10 * (1 - (t - T.BANG) / 0.25) : 0;
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 120}px)` }}>
      <Burst pieces={burst} t={t} at={T.BANG} cx={540} cy={860} />
      <div style={{ position: 'absolute', top: 560, left: 0, right: 0, textAlign: 'center', transform: `translateX(${shake}px)` }}>
        <Eyebrow size={40} style={{ opacity: ramp(t, 0, 0.4), letterSpacing: '0.3em' }}>Ya somos</Eyebrow>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 300, lineHeight: 1, letterSpacing: -14, marginTop: 24, color: ON_INK, whiteSpace: 'nowrap' }}>
          {fmt(n)}<span style={{ display: 'inline-block', color: RED, transform: `scale(${bang})`, transformOrigin: '50% 80%' }}>!</span>
        </div>
        <div style={{
          fontFamily: DISPLAY, fontWeight: 900, fontSize: 84, letterSpacing: -2, marginTop: 30,
          opacity: ramp(t, T.BANG + 0.1, T.BANG + 0.5), transform: `translateY(${ramp(t, T.BANG + 0.1, T.BANG + 0.6, 40, 0)}px)`,
        }}>VECINOS EN GO!</div>
        <div style={{
          fontFamily: BODY, fontWeight: 600, fontSize: 42, color: ON_INK_2, marginTop: 34,
          opacity: ramp(t, T.THANKS, T.THANKS + 0.45), transform: `translateY(${ramp(t, T.THANKS, T.THANKS + 0.5, 30, 0)}px)`,
        }}>Gracias, Magdalena ❤</div>
      </div>
    </AbsoluteFill>
  );
};

const Scene2 = ({ t, frame }) => {
  if (t < T.S2 - 0.1 || t > T.S3 + 0.2) return null;
  const inn = ramp(t, T.S2, T.S2 + 0.5);
  const out = ramp(t, T.S3 - 0.35, T.S3, 0, 1, Easing.in(Easing.cubic));
  const total = interpolate(t, [T.TOTAL, T.TOTAL_END], [0, TOTAL], { ...clamp, easing: Easing.bezier(0.2, 0, 0.1, 1) });
  const grow = [T.PODIUM + 0.35, T.PODIUM, T.PODIUM + 0.7].map(a => spring({ frame: frame - Math.round(a * FPS), fps: FPS, config: { damping: 14, stiffness: 120 } }));
  const more = [0, 1, 2, 3, 4].filter(i => t >= T.MORE + 0.35 + i * 0.12).length;
  const moreIn = pop(frame, T.MORE);
  return (
    <AbsoluteFill style={{ opacity: inn * (1 - out), transform: `translateY(${(1 - inn) * 80 - out * 120}px)` }}>
      <div style={{ position: 'absolute', top: 250, left: 80, right: 80 }}>
        <Eyebrow size={34} style={{ letterSpacing: '0.26em' }}>Lo festejamos sorteando</Eyebrow>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 176, letterSpacing: -8, lineHeight: 1, marginTop: 18, color: ON_INK }}>
          ${fmt(total)}
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 64, color: RED, marginTop: 10, opacity: ramp(t, T.TOTAL_END - 0.3, T.TOTAL_END + 0.1) }}>en Puntos GO</div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 34, color: ON_INK_2, marginTop: 14, opacity: ramp(t, T.TOTAL_END, T.TOTAL_END + 0.4) }}>
          Para usar en tus próximos pedidos
        </div>
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 820 }}>
        <Podium w={920} maxH={420} grow={grow} scale={1.25} dark />
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 1460, opacity: Math.min(1, moreIn), transform: `translateY(${(1 - moreIn) * 60}px)` }}>
        <MorePrizes scale={1.2} shown={more} dark />
      </div>
    </AbsoluteFill>
  );
};

const Scene3 = ({ t, frame }) => {
  if (t < T.S3 - 0.1 || t > T.OUTRO + 0.2) return null;
  const out = ramp(t, T.OUTRO - 0.35, T.OUTRO, 0, 1, Easing.in(Easing.cubic));
  const title = ramp(t, T.S3, T.S3 + 0.5);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 120}px)` }}>
      <div style={{ position: 'absolute', top: 360, left: 80, right: 80, opacity: title, transform: `translateY(${(1 - title) * 60}px)` }}>
        <Eyebrow size={34} style={{ letterSpacing: '0.26em' }}>¿Cómo participar?</Eyebrow>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 104, letterSpacing: -4, lineHeight: 0.98, marginTop: 18, color: ON_INK }}>
          SUMÁ<br />CHANCES<span style={{ color: RED }}>.</span>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 820, left: 80, right: 80, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {CHANCES.map(([n, label], i) => {
          const p = pop(frame, T.S3 + 0.45 + i * 0.28);
          return (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 34, background: INK_2, border: `2px solid ${INK_LINE}`, borderRadius: 30,
              padding: '28px 36px', opacity: Math.min(1, p * 1.5), transform: `translateX(${(1 - p) * 140}px)`,
            }}>
              <div style={{ width: 150, fontFamily: DISPLAY, fontWeight: 900, fontSize: 84, color: RED, letterSpacing: -2 }}>{n}</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, color: ON_INK, lineHeight: 1.15 }}>{label}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Outro = ({ t, frame, burst }) => {
  if (t < T.OUTRO - 0.1) return null;
  const logo = pop(frame, T.OUTRO + 0.05, { damping: 12, stiffness: 160 });
  const dot = pop(frame, T.OUTRO + 0.45, { damping: 8, stiffness: 240 });
  const txt = ramp(t, T.OUTRO + 0.55, T.OUTRO + 1.0);
  const btn = pop(frame, T.OUTRO + 0.95);
  const pulse = 1 + 0.03 * Math.sin(Math.max(0, t - T.OUTRO - 1.6) * 6);
  return (
    <AbsoluteFill>
      <Burst pieces={burst} t={t} at={T.OUTRO + 0.45} cx={540} cy={560} power={1300} />
      <div style={{ position: 'absolute', top: 400, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ transform: `scale(${logo})` }}><Logo d={250} dot={dot} /></div>
        <div style={{ opacity: txt, transform: `translateY(${(1 - txt) * 40}px)` }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 96, letterSpacing: -3, lineHeight: 1, marginTop: 80, color: ON_INK }}>
            ANOTATE<br />GRATIS<span style={{ color: RED }}>.</span>
          </div>
          <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 38, color: ON_INK_2, marginTop: 34 }}>
            $150.000 en Puntos GO · 8 ganadores
          </div>
        </div>
        <div style={{
          marginTop: 70, background: RED, borderRadius: 999, padding: '34px 60px', transform: `scale(${btn * pulse})`,
          fontFamily: DISPLAY, fontWeight: 900, fontSize: 44, color: '#fff', boxShadow: '0 24px 60px rgba(225,29,72,0.45)',
        }}>Entrá a la app y participá</div>
        <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 32, color: ON_INK, marginTop: 40, opacity: ramp(t, T.OUTRO + 1.2, T.OUTRO + 1.6) }}>{URL}</div>
      </div>
      <div style={{ position: 'absolute', bottom: 150, left: 0, right: 0, textAlign: 'center', opacity: ramp(t, T.OUTRO + 1.3, T.OUTRO + 1.7) }}>
        <Eyebrow size={24}>GO! Delivery · Servicio puerta a puerta · Magdalena</Eyebrow>
      </div>
    </AbsoluteFill>
  );
};

const SFX = [
  ...Array.from({ length: 9 }, (_, i) => ({ t: T.COUNT + i * 0.16, src: 'tap', v: 0.18 + i * 0.02 })),
  { t: T.BANG - 0.02, src: 'thump', v: 0.85 },
  { t: T.BANG + 0.02, src: 'success', v: 0.35 },
  { t: T.S2 - 0.4, src: 'swish', v: 0.4 },
  { t: T.TOTAL - 0.1, src: 'riser', v: 0.28 },
  { t: T.TOTAL_END, src: 'thump', v: 0.7 },
  { t: T.PODIUM, src: 'pop', v: 0.35 },
  { t: T.PODIUM + 0.35, src: 'pop', v: 0.3 },
  { t: T.PODIUM + 0.7, src: 'pop', v: 0.3 },
  ...[0, 1, 2, 3, 4].map(i => ({ t: T.MORE + 0.35 + i * 0.12, src: 'pop', v: 0.18 })),
  { t: T.S3 - 0.4, src: 'swish', v: 0.4 },
  ...CHANCES.map((_, i) => ({ t: T.S3 + 0.45 + i * 0.28, src: 'tap', v: 0.4 })),
  { t: T.OUTRO - 0.4, src: 'whoosh', v: 0.35 },
  { t: T.OUTRO + 0.45, src: 'go-logo', v: 0.8 },
];

export const SorteoReel = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const burst1 = makeConfetti(90, 5);
  const burst2 = makeConfetti(70, 23);
  // El brillo rojo del fondo acompaña cada escena.
  const glowY = interpolate(t, [0, T.S2, T.S3, T.OUTRO], [700, 400, 500, 600], clamp);
  return (
    <AbsoluteFill style={{ background: INK, color: ON_INK, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(900px 800px at 540px ${glowY}px, rgba(225,29,72,${0.12 + 0.12 * pop(frame, T.BANG)}), transparent 70%)` }} />
      <div style={{ position: 'absolute', top: 120, left: 80, right: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: ramp(t, 0.1, 0.5) * (1 - ramp(t, T.OUTRO - 0.3, T.OUTRO)) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Logo d={72} />
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 30 }}>GO! Delivery</div>
        </div>
        <div style={{ background: RED, borderRadius: 999, padding: '14px 28px', fontFamily: DISPLAY, fontWeight: 900, fontSize: 24, letterSpacing: '0.14em' }}>SORTEO</div>
      </div>
      {t < T.S2 + 0.1 && <Scene1 t={t} frame={frame} burst={burst1} />}
      <Scene2 t={t} frame={frame} />
      <Scene3 t={t} frame={frame} />
      <Outro t={t} frame={frame} burst={burst2} />
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(1.7 * FPS)}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
