// Historias destacadas de GO! (Instagram): portadas (1080x1080) e historias (1080x1920), con el estilo de la app.
// Cada cuadro de la composición es una pieza. Render:
//   npx remotion render src/index.js GoDestacadas out/destacadas --sequence --image-format=png
//   npx remotion render src/index.js GoPortadas out/destacadas/portadas --sequence --image-format=png
// y después: node destacadas.mjs (renombra los archivos).
// Capturas en public/img/destacadas (navegador del reel, con comercios abiertos y sin avisos de primera vez).
import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { Phone, PHONE_W, PHONE_H } from './Phone.jsx';
import { DISPLAY, BODY, INK, PAPER, LINE, TEXT2, ON_INK, ON_INK_2, RED, HouseIcon } from './Brand.jsx';
import COMERCIOS from './comercios.json';
import ROUTE from './map-route.json';

const D = (f) => staticFile(`img/destacadas/${f}`);
// Zona segura de Instagram: arriba van la barra de progreso y el perfil, abajo el cuadro de respuesta.
const TOP = 250;

// ─── Íconos de la app (src/utils/icons.js) ───
const ICONS = {
  bag: <><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  package: <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  store: <><path d="M3 9l1-4h16l1 4" /><path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" /><path d="M9 21V9" /><path d="M3 9h18" /><rect x="13" y="13" width="6" height="4" rx="1" /></>,
};
const Icon = ({ name, size, color, stroke = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
);

// ─── Piezas de texto ───
const Eyebrow = ({ children, dark }) => (
  <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 28, letterSpacing: '0.24em', textTransform: 'uppercase', color: dark ? ON_INK_2 : TEXT2 }}>{children}</div>
);
const Bar = ({ mt = 30 }) => <div style={{ marginTop: mt, width: 72, height: 9, borderRadius: 5, background: RED }} />;
const Head = ({ lines, dark, size = 104 }) => (
  <div style={{ marginTop: 14 }}>
    {lines.map((ln, i) => (
      <div key={i} style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.015em', color: dark ? ON_INK : INK, whiteSpace: 'nowrap' }}>{ln}</div>
    ))}
  </div>
);
const Body = ({ children, dark, mt = 34, size = 38 }) => (
  <div style={{ marginTop: mt, fontFamily: BODY, fontWeight: 600, fontSize: size, lineHeight: 1.38, color: dark ? ON_INK_2 : TEXT2, maxWidth: 900 }}>{children}</div>
);
const Block = ({ children, top = TOP }) => <div style={{ position: 'absolute', left: 80, right: 80, top }}>{children}</div>;

// Teléfono con una captura (393x798 puntos), centrado y cortado por el borde de abajo.
const PhoneShot = ({ src, top, scale = 0.8, x = 540 }) => (
  <div style={{ position: 'absolute', left: x - PHONE_W / 2, top: top - PHONE_H * (1 - scale) / 2, width: PHONE_W, height: PHONE_H, transform: `scale(${scale})` }}>
    <Phone status={{ bg: INK, dark: false }} screen={<Img src={D(src)} style={{ width: 393, height: 798 }} />} />
  </div>
);
const Dark = ({ children }) => <AbsoluteFill style={{ background: INK }}>{children}</AbsoluteFill>;
const Light = ({ children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 1000px at 540px 1300px, #fbfaf8 0%, ${PAPER} 70%)` }}>{children}</AbsoluteFill>
);
// Pie con la marca: anillo con el punto rojo y "GO!".
const Stamp = ({ dark }) => (
  <div style={{ position: 'absolute', right: 80, top: TOP - 6, display: 'flex', alignItems: 'center', gap: 14 }}>
    <div style={{ position: 'relative', width: 58, height: 58, borderRadius: '50%', border: `2.5px solid ${dark ? ON_INK : INK}` }}>
      <span style={{ position: 'absolute', top: -6, left: 23, width: 11, height: 11, borderRadius: '50%', background: RED }} />
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 900, fontSize: 19, color: dark ? ON_INK : INK }}>GO!</span>
    </div>
  </div>
);
const StepNum = ({ n, dark }) => (
  <div style={{
    width: 76, height: 76, borderRadius: '50%', background: RED, color: '#fff', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 900, fontSize: 38,
    boxShadow: dark ? 'none' : '0 10px 24px rgba(225,29,72,0.25)',
  }}>{n}</div>
);

// ─── Cómo pedir ───
const PedirIntro = () => (
  <Dark>
    <Stamp dark />
    <Block>
      <Eyebrow dark>Cómo pedir</Eyebrow>
      <Head dark lines={['PEDÍ EN', '3 PASOS.']} size={128} />
      <Bar />
      <Body dark>Comida, súper, kiosco y más de Magdalena, desde la app y hasta tu puerta.</Body>
    </Block>
    <PhoneShot src="home.png" top={890} />
  </Dark>
);
const PedirPaso = ({ n, eyebrow, lines, text, shot }) => (
  <Light>
    <Stamp />
    <Block>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <StepNum n={n} />
        <Eyebrow>{eyebrow}</Eyebrow>
      </div>
      <Head lines={lines} />
      <Bar />
      <Body>{text}</Body>
    </Block>
    <PhoneShot src={shot} top={930} />
  </Light>
);

// Mapa oscuro de Magdalena con el recorrido de la moto (el mismo del video de marca).
const MAP_W = 2700, MAP_H = 4800;
const R_PTS = ROUTE.pts;
const R_BOX = R_PTS.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]);
const R_C = [(R_BOX[0] + R_BOX[2]) / 2, (R_BOX[1] + R_BOX[3]) / 2];
const PedirSeguimiento = () => {
  const s = 0.66, anchor = [540, 1335];
  const toS = ([x, y]) => [anchor[0] + s * (x - R_C[0]), anchor[1] + s * (y - R_C[1])];
  // La moto va por el 70 % del recorrido.
  const lens = [0]; for (let i = 1; i < R_PTS.length; i++) lens.push(lens[i - 1] + Math.hypot(R_PTS[i][0] - R_PTS[i - 1][0], R_PTS[i][1] - R_PTS[i - 1][1]));
  const goal = lens[lens.length - 1] * 0.7;
  let i = 1; while (lens[i] < goal) i++;
  const k = (goal - lens[i - 1]) / (lens[i] - lens[i - 1]);
  const rider = [R_PTS[i - 1][0] + (R_PTS[i][0] - R_PTS[i - 1][0]) * k, R_PTS[i - 1][1] + (R_PTS[i][1] - R_PTS[i - 1][1]) * k];
  const done = [...R_PTS.slice(0, i), rider].map(toS);
  const all = R_PTS.map(toS);
  const path = (pts) => pts.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const [sx, sy] = all[0], [ex, ey] = all[all.length - 1], [rx, ry] = toS(rider);
  return (
    <Dark>
      <Img src={staticFile('img/map-dark.png')} style={{
        position: 'absolute', left: anchor[0] - s * R_C[0], top: anchor[1] - s * R_C[1], width: MAP_W, height: MAP_H,
        transformOrigin: '0 0', transform: `scale(${s})`, filter: 'grayscale(1) brightness(1.08) contrast(1.12)',
      }} />
      <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0 }}>
        <path d={path(all)} fill="none" stroke="rgba(247,245,241,0.22)" strokeWidth="8" strokeDasharray="2 16" strokeLinecap="round" />
        <path d={path(done)} fill="none" stroke="rgba(225,29,72,0.28)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path(done)} fill="none" stroke={RED} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', left: sx - 40, top: sy - 40, width: 80, height: 80, borderRadius: '50%', background: ON_INK, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
        <Icon name="store" size={34} color={INK} stroke={2} />
      </div>
      <div style={{ position: 'absolute', left: ex - 40, top: ey - 40, width: 80, height: 80, borderRadius: '50%', background: INK, border: `4px solid ${ON_INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
        <HouseIcon c={ON_INK} />
      </div>
      <div style={{ position: 'absolute', left: rx - 22, top: ry - 22, width: 44, height: 44, borderRadius: '50%', background: RED, boxShadow: '0 0 0 14px rgba(225,29,72,0.22)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 880, background: 'linear-gradient(rgba(11,11,12,0.97) 0%, rgba(11,11,12,0.9) 60%, rgba(11,11,12,0) 100%)' }} />
      <Stamp dark />
      <Block>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <StepNum n={3} dark />
          <Eyebrow dark>Paso 3</Eyebrow>
        </div>
        <Head dark lines={['SEGUÍ TU', 'PEDIDO EN VIVO.']} />
        <Bar />
        <Body dark>Ves al repartidor en el mapa, de la puerta del comercio a la tuya.</Body>
      </Block>
    </Dark>
  );
};

// ─── Mandados ───
const MandadosIntro = () => (
  <Dark>
    <Stamp dark />
    <Block>
      <Eyebrow dark>Mandados</Eyebrow>
      <Head dark lines={['¿NO ESTÁ', 'EN LA APP?']} size={124} />
      <Bar />
      <Body dark>Te lo buscamos y te lo llevamos. Un repartidor hace por vos lo que necesites en el pueblo: buscar, llevar o comprar.</Body>
    </Block>
    <PhoneShot src="mandados.png" top={1010} />
  </Dark>
);
const MANDADO_TIPOS = [
  { img: 'go-bag.png', title: 'Mandado', text: 'Te compramos lo que necesites en cualquier negocio del pueblo. Hasta 5 paradas.' },
  { img: 'go-pickup-point.png', title: 'Encomienda', text: 'Buscamos algo y lo llevamos a donde nos digas.' },
  { img: 'go-cash.png', title: 'Go Cash', text: 'Cambiá efectivo por transferencia, o al revés.' },
];
const MandadosTipos = () => (
  <Light>
    <Stamp />
    <Block>
      <Eyebrow>Mandados</Eyebrow>
      <Head lines={['¿QUÉ PODÉS', 'PEDIR?']} />
      <Bar />
    </Block>
    <div style={{ position: 'absolute', left: 64, right: 64, top: 640, display: 'flex', flexDirection: 'column', gap: 30 }}>
      {MANDADO_TIPOS.map(m => (
        <div key={m.title} style={{
          display: 'flex', alignItems: 'center', gap: 36, padding: '40px 44px', borderRadius: 44, background: '#fff',
          boxShadow: `0 0 0 2px ${LINE}, 0 22px 44px rgba(28,25,23,0.08)`,
        }}>
          <div style={{ width: 170, height: 170, borderRadius: 38, background: '#efebe4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Img src={D(m.img)} style={{ width: 132, height: 132, objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 54, color: INK, letterSpacing: '-0.01em' }}>{m.title}</div>
            <div style={{ marginTop: 10, fontFamily: BODY, fontWeight: 600, fontSize: 33, lineHeight: 1.35, color: TEXT2 }}>{m.text}</div>
          </div>
        </div>
      ))}
    </div>
  </Light>
);
const MANDADO_PASOS = [
  { title: 'Elegí qué necesitás', text: 'Mandado, Encomienda o Go Cash.' },
  { title: 'Marcá los puntos en el mapa', text: 'Dónde retiramos o compramos, y dónde te lo entregamos.' },
  { title: 'Seguilo y chateá en vivo', text: 'Ves al repartidor en el mapa y coordinás los detalles por chat.' },
];
const MandadosPasos = () => (
  <Dark>
    <Stamp dark />
    <Block>
      <Eyebrow dark>Mandados</Eyebrow>
      <Head dark lines={['¿CÓMO', 'FUNCIONA?']} />
      <Bar />
    </Block>
    <div style={{ position: 'absolute', left: 80, right: 80, top: 690, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {MANDADO_PASOS.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 40, paddingBottom: i < 2 ? 70 : 0, position: 'relative' }}>
          {i < 2 && <div style={{ position: 'absolute', left: 37, top: 86, bottom: 10, width: 3, background: 'rgba(247,245,241,0.18)' }} />}
          <StepNum n={i + 1} dark />
          <div style={{ paddingTop: 4 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 52, color: ON_INK, lineHeight: 1.1 }}>{s.title}</div>
            <div style={{ marginTop: 14, fontFamily: BODY, fontWeight: 600, fontSize: 35, lineHeight: 1.38, color: ON_INK_2 }}>{s.text}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{ position: 'absolute', left: 80, right: 80, top: 1500, padding: '34px 40px', borderRadius: 32, border: '2px solid rgba(247,245,241,0.18)' }}>
      <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 26, letterSpacing: '0.2em', textTransform: 'uppercase', color: ON_INK_2 }}>En la app</div>
      <div style={{ marginTop: 10, fontFamily: BODY, fontWeight: 800, fontSize: 36, color: ON_INK }}>Inicio → Mandados</div>
    </div>
  </Dark>
);

// ─── Comercios ───
const cleanName = (n) => n.split('|')[0].replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️‍]/gu, '').trim();
const WALL = [{ name: 'FIXSTORE', src: staticFile('img/fixstore/logo.jpg') }, ...COMERCIOS.map(c => ({ name: cleanName(c.name), src: staticFile(`img/logos/${c.file}`) }))];
const ComerciosMuro = () => {
  const cols = 4, d = 196, colW = 236, pitch = 290, top = 790;
  const x0 = (1080 - cols * colW) / 2;
  return (
    <Light>
      {WALL.map((c, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const y = top + row * pitch + (col % 2 ? pitch / 2 : 0);
        if (y > 1920) return null;
        return (
          <div key={i} style={{ position: 'absolute', left: x0 + col * colW + (colW - d) / 2, top: y, width: d }}>
            <div style={{ width: d, height: d, borderRadius: '50%', background: '#fff', overflow: 'hidden', boxShadow: `0 0 0 2px ${LINE}, 0 22px 44px rgba(28,25,23,0.10)` }}>
              <Img src={c.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ marginTop: 16, width: colW, marginLeft: -(colW - d) / 2, textAlign: 'center', fontFamily: BODY, fontWeight: 600, fontSize: 22, color: TEXT2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 900, background: `linear-gradient(${PAPER} 0%, ${PAPER} 74%, rgba(244,242,238,0) 100%)` }} />
      <Stamp />
      <Block>
        <Eyebrow>Comunidad GO!</Eyebrow>
        <Head lines={['LOS COMERCIOS', 'DE MAGDALENA.']} size={96} />
        <Bar />
        <Body>Comida, almacén, postres, tecnología y más. Pedí a todos desde una sola app.</Body>
      </Block>
    </Light>
  );
};
const ComerciosNuevo = () => (
  <Light>
    <Stamp />
    <Block>
      <Eyebrow>Nuevo en GO! · Tecnología</Eyebrow>
      <Head lines={['FIXSTORE', 'YA ESTÁ EN GO!']} />
      <Bar />
      <Body>Accesorios, cargadores, parlantes y más. Lun a Sáb · 9 a 13 y 17 a 21 hs.</Body>
    </Block>
    <PhoneShot src="fixstore.jpg" top={930} />
  </Light>
);
const ComerciosSumate = () => (
  <Dark>
    <Stamp dark />
    <Block>
      <Eyebrow dark>Para comercios</Eyebrow>
      <Head dark lines={['¿TU COMERCIO', 'NO ESTÁ', 'EN GO!?']} size={108} />
      <Bar />
      <Body dark>Sumate y empezá a llegar a más clientes en Magdalena. En la app: Inicio → «Sumá tu comercio».</Body>
    </Block>
    <PhoneShot src="sumate.png" top={1130} />
  </Dark>
);

// Orden de salida (los nombres los pone destacadas.mjs).
export const HISTORIAS = [
  { file: 'como-pedir-1', C: PedirIntro },
  { file: 'como-pedir-2', C: () => <PedirPaso n={1} eyebrow="Paso 1" lines={['ELEGÍ EL', 'COMERCIO.']} text="Buscá por categoría o por nombre. Ves si está abierto, cuánto tarda y cuánto sale el envío." shot="comida.png" /> },
  { file: 'como-pedir-3', C: () => <PedirPaso n={2} eyebrow="Paso 2" lines={['ARMÁ TU', 'CARRITO.']} text="Elegís envío o retiro en el local, y pagás en efectivo o por transferencia." shot="carrito.png" /> },
  { file: 'como-pedir-4', C: PedirSeguimiento },
  { file: 'mandados-1', C: MandadosIntro },
  { file: 'mandados-2', C: MandadosTipos },
  { file: 'mandados-3', C: MandadosPasos },
  { file: 'comercios-1', C: ComerciosMuro },
  { file: 'comercios-2', C: ComerciosNuevo },
  { file: 'comercios-3', C: ComerciosSumate },
];
export const Destacadas = () => {
  const { C } = HISTORIAS[Math.min(useCurrentFrame(), HISTORIAS.length - 1)];
  return <C />;
};

// ─── Portadas (1080x1080): el anillo con el punto rojo del splash y el ícono de la app ───
export const PORTADAS = [
  { file: 'portada-como-pedir', icon: 'bag' },
  { file: 'portada-mandados', icon: 'package' },
  { file: 'portada-comercios', icon: 'store' },
];
export const Portadas = () => {
  const { icon } = PORTADAS[Math.min(useCurrentFrame(), PORTADAS.length - 1)];
  const R = 365;
  return (
    <AbsoluteFill style={{ background: INK, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: R * 2, height: R * 2 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `16px solid ${ON_INK}` }} />
        <span style={{ position: 'absolute', top: -38 + 8, left: R - 38, width: 76, height: 76, borderRadius: '50%', background: RED, boxShadow: '0 0 0 18px rgba(225,29,72,0.25)' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={360} color={ON_INK} stroke={1.9} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
