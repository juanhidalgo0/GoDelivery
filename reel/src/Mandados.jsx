// Reel "Cosas que en Magdalena ya no hacés vos": chat con mandados insólitos, cada uno entregado.
//   npx remotion render src/index.js MandadosRaros out/mandados-raros.mp4 --crf=16
// Los pedidos son ejemplos inventados (no son clientes reales); se pueden cambiar en MANDADOS.
import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, interpolate, spring, Easing } from 'remotion';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { FPS } from './capture.js';
import { Logo } from './Sorteo.jsx';

const { fontFamily: DISPLAY } = loadMontserrat('normal', { weights: ['800', '900'], subsets: ['latin'] });
const { fontFamily: BODY } = loadInter('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] });

const INK = '#0b0b0c';
const INK_2 = '#161618';
const INK_LINE = '#2c2c30';
const PAPER = '#f4f2ee';
const ON_INK = '#f7f5f1';
const ON_INK_2 = 'rgba(247,245,241,0.62)';
const RED = '#e11d48';
const GREEN = '#22c55e';

const MANDADOS = [
  { msg: '¿Me buscás el cargador que dejé en lo de mi vieja? Está enchufado al lado de la tele 🔌', reply: '¡Sale! 🛵', min: 14 },
  { msg: 'Llevale el táper a mi suegra. LLENO. Si llega vacío es guerra 🍝', reply: 'Con la vida 💪', min: 11 },
  { msg: 'Me olvidé las llaves en el laburo y estoy sentado en la vereda 😩', reply: 'Ya vamos 🔑', min: 9 },
  { msg: 'Facturas de dulce de leche antes de que se terminen. Es una emergencia 🥐', reply: 'Corriendo 🏃', min: 7 },
  { msg: 'Llevale este ramo a la chica de la verdulería. No digas de parte de quién 🌹', reply: 'Discreción total 🤐', min: 12 },
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const ramp = (t, a, b, from = 0, to = 1, easing = OUT) => interpolate(t, [a, b], [from, to], { ...clamp, easing });
const pop = (frame, at, cfg = { damping: 13, stiffness: 190 }) => spring({ frame: frame - Math.round(at * FPS), fps: FPS, config: cfg });

// Tiempos (s)
const HOOK_END = 1.9;
const CHAT = 2.3;
const STEP = 3.1;
const OUTRO = CHAT + MANDADOS.length * STEP + 0.4;
export const MANDADOS_DURATION = OUTRO + 4.6;

const SLOT = 470; // alto de cada mandado en el chat
const VIEW = 1180; // alto visible del chat
const at = (i) => CHAT + i * STEP;

const Bubble = ({ children, side, p, style }) => (
  <div style={{
    alignSelf: side === 'right' ? 'flex-end' : 'flex-start', maxWidth: 760,
    background: side === 'right' ? PAPER : RED, color: side === 'right' ? INK : '#fff',
    borderRadius: side === 'right' ? '40px 40px 10px 40px' : '40px 40px 40px 10px',
    padding: '26px 34px', fontFamily: BODY, fontWeight: 600, fontSize: 44, lineHeight: 1.28,
    opacity: Math.min(1, p * 2), transform: `scale(${0.6 + 0.4 * p})`,
    transformOrigin: side === 'right' ? '100% 100%' : '0% 100%', ...style,
  }}>{children}</div>
);

const Typing = ({ t }) => (
  <div style={{ alignSelf: 'flex-start', background: INK_2, border: `2px solid ${INK_LINE}`, borderRadius: 40, padding: '26px 32px', display: 'flex', gap: 12 }}>
    {[0, 1, 2].map(k => (
      <span key={k} style={{ width: 16, height: 16, borderRadius: '50%', background: ON_INK_2, transform: `translateY(${Math.sin(t * 14 - k * 0.9) * 6}px)` }} />
    ))}
  </div>
);

const Delivered = ({ p, min }) => (
  <div style={{
    alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 16, marginTop: 6,
    background: 'rgba(34,197,94,0.14)', border: `2px solid ${GREEN}`, borderRadius: 999, padding: '14px 30px',
    fontFamily: DISPLAY, fontWeight: 900, fontSize: 32, letterSpacing: '0.08em', color: GREEN,
    opacity: Math.min(1, p * 2), transform: `scale(${1.8 - 0.8 * p}) rotate(${(1 - p) * -8}deg)`,
  }}>✓ ENTREGADO <span style={{ fontFamily: BODY, fontWeight: 700, letterSpacing: 0, color: ON_INK_2 }}>en {MANDADOS_MIN_LABEL(min)}</span></div>
);
const MANDADOS_MIN_LABEL = (m) => `${m} min`;

const Chat = ({ t, frame }) => {
  if (t < CHAT - 0.2 || t > OUTRO + 0.3) return null;
  // Desplaza el chat para que el mandado actual quede abajo, con resorte en cada paso.
  const idx = MANDADOS.findLastIndex((_, i) => t >= at(i)) ;
  let scroll = 0;
  MANDADOS.forEach((_, i) => {
    const fit = VIEW - 120;
    const target = Math.max(0, (i + 1) * SLOT - fit) - Math.max(0, i * SLOT - fit);
    scroll += target * spring({ frame: frame - Math.round(at(i) * FPS), fps: FPS, config: { damping: 18, stiffness: 120 } });
  });
  const inn = ramp(t, CHAT - 0.2, CHAT + 0.3);
  const out = ramp(t, OUTRO - 0.35, OUTRO, 0, 1, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{ opacity: inn * (1 - out), transform: `translateY(${(1 - inn) * 60 - out * 120}px)` }}>
      {/* Cabecera estilo chat */}
      <div style={{ position: 'absolute', top: 400, left: 60, right: 60, display: 'flex', alignItems: 'center', gap: 22, paddingBottom: 26, borderBottom: `2px solid ${INK_LINE}` }}>
        <Logo d={84} />
        <div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 40 }}>GO! Mandados</div>
          <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 28, color: GREEN, marginTop: 4 }}>● en línea · Magdalena</div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 560, left: 60, right: 60, height: VIEW, overflow: 'hidden', maskImage: 'linear-gradient(transparent, #000 90px)', WebkitMaskImage: 'linear-gradient(transparent, #000 90px)' }}>
        <div style={{ transform: `translateY(${-scroll + 40}px)` }}>
          {MANDADOS.map((m, i) => {
            if (i > idx) return null;
            const s = at(i);
            const pMsg = pop(frame, s);
            const typing = t >= s + 0.75 && t < s + 1.3;
            const pReply = pop(frame, s + 1.3);
            const pDone = pop(frame, s + 2.1, { damping: 11, stiffness: 220 });
            return (
              <div key={i} style={{ height: SLOT, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Bubble side="right" p={pMsg}>{m.msg}</Bubble>
                {typing && <Typing t={t} />}
                {t >= s + 1.3 && <Bubble side="left" p={pReply} style={{ fontWeight: 800 }}>{m.reply}</Bubble>}
                {t >= s + 2.1 && <Delivered p={pDone} min={m.min} />}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Gancho: frase grande al centro que después sube y queda como título fijo.
const Hook = ({ t, frame }) => {
  if (t > OUTRO + 0.3) return null;
  const inn = pop(frame, 0.05, { damping: 12, stiffness: 170 });
  const move = ramp(t, HOOK_END, HOOK_END + 0.6, 0, 1, Easing.bezier(0.65, 0, 0.35, 1));
  const out = ramp(t, OUTRO - 0.35, OUTRO);
  const size = interpolate(move, [0, 1], [104, 62]);
  const top = interpolate(move, [0, 1], [640, 140]);
  const words = ['Cosas que', 'en Magdalena', 'ya no hacés vos'];
  return (
    <div style={{ position: 'absolute', top, left: 60, right: 60, textAlign: 'center', opacity: 1 - out }}>
      {words.map((w, i) => {
        const p = pop(frame, 0.05 + i * 0.22, { damping: 12, stiffness: 200 });
        return (
          <div key={w} style={{
            fontFamily: DISPLAY, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -size * 0.03,
            color: i === 2 ? RED : ON_INK, opacity: Math.min(1, p * 2) * inn, transform: `translateY(${(1 - p) * 50}px)`,
          }}>{w}{i === 2 ? ' 👇' : ''}</div>
        );
      })}
    </div>
  );
};

const Outro = ({ t, frame }) => {
  if (t < OUTRO - 0.1) return null;
  const logo = pop(frame, OUTRO + 0.05, { damping: 12, stiffness: 160 });
  const dot = pop(frame, OUTRO + 0.45, { damping: 8, stiffness: 240 });
  const txt = ramp(t, OUTRO + 0.5, OUTRO + 0.95);
  const moto = pop(frame, OUTRO + 0.8, { damping: 14, stiffness: 120 });
  const cta = pop(frame, OUTRO + 1.6);
  const pulse = 1 + 0.03 * Math.sin(Math.max(0, t - OUTRO - 2.2) * 6);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 250, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ transform: `scale(${logo})` }}><Logo d={220} dot={dot} /></div>
        <div style={{ opacity: txt, transform: `translateY(${(1 - txt) * 40}px)` }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 92, letterSpacing: -3, lineHeight: 1.02, marginTop: 70, color: ON_INK }}>
            Si se puede llevar,<br /><span style={{ color: RED }}>GO! lo lleva.</span>
          </div>
          <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 38, color: ON_INK_2, marginTop: 30 }}>
            Mandados en Magdalena · desde la app
          </div>
        </div>
        <Img src={staticFile('img/go-delivery-moto.png')} style={{
          width: 560, marginTop: 30, transform: `translateX(${(1 - moto) * 900}px)`,
        }} />
        <div style={{
          marginTop: 20, background: RED, borderRadius: 999, padding: '32px 54px', transform: `scale(${cta * pulse})`,
          fontFamily: DISPLAY, fontWeight: 900, fontSize: 40, color: '#fff', boxShadow: '0 24px 60px rgba(225,29,72,0.45)',
        }}>Comentá el mandado más raro 👇</div>
      </div>
      <div style={{ position: 'absolute', bottom: 120, left: 0, right: 0, textAlign: 'center', opacity: ramp(t, OUTRO + 1.8, OUTRO + 2.2) }}>
        <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 24, letterSpacing: '0.24em', textTransform: 'uppercase', color: ON_INK_2 }}>
          GO! Delivery · Servicio puerta a puerta
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SFX = [
  { t: 0.05, src: 'thump', v: 0.6 },
  { t: 0.27, src: 'tap', v: 0.35 },
  { t: 0.49, src: 'tap', v: 0.35 },
  { t: HOOK_END, src: 'swish', v: 0.4 },
  ...MANDADOS.flatMap((_, i) => [
    { t: at(i), src: 'pop', v: 0.45 },
    { t: at(i) + 1.3, src: 'tap', v: 0.45 },
    { t: at(i) + 2.1, src: 'success', v: 0.3 },
  ]),
  { t: OUTRO - 0.4, src: 'whoosh', v: 0.35 },
  { t: OUTRO + 0.45, src: 'go-logo', v: 0.8 },
  { t: OUTRO + 0.8, src: 'riser', v: 0.2 },
];

export const MandadosRaros = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <AbsoluteFill style={{ background: INK, color: ON_INK, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(900px 800px at 540px 1500px, rgba(225,29,72,0.16), transparent 70%)' }} />
      <Hook t={t} frame={frame} />
      <Chat t={t} frame={frame} />
      <Outro t={t} frame={frame} />
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * FPS)} durationInFrames={Math.round(1.7 * FPS)}>
          <Audio src={staticFile(`sfx/${s.src}.wav`)} volume={s.v} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
