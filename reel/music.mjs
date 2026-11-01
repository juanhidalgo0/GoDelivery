// Pista musical del video de Fixstore (WAV 44.1 kHz estéreo), sintetizada acá: sin archivos de terceros.
// House pop a 118 BPM en La menor. La grilla arranca en el pase de Instagram a GO! (T.G0 de Fixstore.jsx) y
// cae justo en los cortes: +20 tiempos = el rojo hacia el mapa (T.R0), +27 = el cierre (T.O0), +29 = el sonido GO!.
// Si cambian los tiempos del video, ajustar G0 y DURATION. Uso: node music.mjs
import fs from 'node:fs';

const SR = 44100;
const BPM = 118;
const BEAT = 60 / BPM;
const G0 = 3.85;          // tiempo del video donde cae el tiempo 0 (el drop)
const DURATION = 21.2;    // largo del video
const N = Math.ceil(DURATION * SR);
const L = new Float32Array(N), R = new Float32Array(N);
// El bombo va en su propio canal: el resto "respira" con cada golpe (sidechain) y el bombo se suma limpio.
const KL = new Float32Array(N), KR = new Float32Array(N);
let TL = L, TR = R;
const tOf = (b) => G0 + b * BEAT;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// Suma una señal mono (fn de t local) con paneo, desde el tiempo `at` (s) durante `len` s.
function add(at, len, fn, gain = 1, pan = 0) {
  const s0 = Math.round(at * SR);
  const n = Math.round(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = gain * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  for (let i = 0; i < n; i++) {
    const k = s0 + i;
    if (k < 0 || k >= N) continue;
    const v = fn(i / SR, i);
    TL[k] += v * gl; TR[k] += v * gr;
  }
}

// Filtro de estado variable (pasa bajos / pasa altos), por instancia.
function svf() {
  let lp = 0, bp = 0;
  return (x, fc, q = 0.7) => {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
    lp += f * bp; const hp = x - lp - bp / q; bp += f * hp;
    return { lp, hp, bp };
  };
}
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));

// ─── Instrumentos ───
function kick(at, g = 1) {
  TL = KL; TR = KR;
  add(at, 0.42, (t) => {
    const ph = 2 * Math.PI * (45 * t + (95 / 32) * (1 - Math.exp(-t * 32)));
    return (Math.sin(ph) * Math.exp(-t * 7.5) + 0.25 * Math.exp(-t * 260) * Math.sin(2 * Math.PI * 1800 * t)) * 0.95;
  }, g);
  TL = L; TR = R;
}

function clap(at, g = 1) {
  const flt = svf();
  add(at, 0.3, (t) => {
    const bursts = [0, 0.011, 0.022].reduce((a, d) => a + (t >= d ? Math.exp(-(t - d) * (d < 0.02 ? 180 : 22)) : 0), 0);
    return flt(rnd(), 1500, 1.4).bp * bursts * 1.6;
  }, g * 0.5, 0.05);
}
function hat(at, open = false, g = 1, pan = 0.25) {
  const flt = svf();
  add(at, open ? 0.22 : 0.05, (t) => flt(rnd(), 7500, 0.8).hp * Math.exp(-t * (open ? 16 : 85)), g * (open ? 0.22 : 0.16), pan);
}
function snare(at, g = 1) {
  const flt = svf();
  add(at, 0.18, (t) => (flt(rnd(), 2600, 1).bp * 1.3 + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 26), g * 0.45, -0.05);
}
// Bajo: diente de sierra filtrado, notas cortas en contratiempo.
function bass(at, m, len, g = 1) {
  const flt = svf();
  const f = midi(m);
  add(at, len, (t) => {
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 5) * Math.min(1, (len - t) / 0.02);
    const x = saw(f * t) * 0.7 + Math.sin(2 * Math.PI * f * t) * 0.6;
    return flt(x, 350 + 900 * Math.exp(-t * 18), 1.1).lp * env;
  }, g * 0.55);
}
// Acorde: supersaw (3 sierras desafinadas por nota), una por canal con distinta afinación.
function chord(at, notes, len, { g = 1, cutoff = 2400, attack = 0.005, decay = 3, release = 0.06, sweep = 0 } = {}) {
  for (const [side, pan] of [[-1, -0.6], [1, 0.6]]) {
    const flt = svf();
    const oscs = notes.flatMap(m => [-1, 0, 1].map(d => midi(m) * Math.pow(2, (d * 9 + side * 4) / 1200)));
    const ph0 = oscs.map(() => (rnd() + 1) / 2);
    add(at, len + release, (t) => {
      let x = 0;
      for (let k = 0; k < oscs.length; k++) x += saw(ph0[k] + oscs[k] * t);
      x /= oscs.length;
      const env = Math.min(1, t / attack) * Math.exp(-t * decay / Math.max(len, 0.2)) * (t > len ? Math.exp(-(t - len) / (release / 4)) : 1);
      const fc = cutoff * (1 + sweep * Math.min(1, t / len));
      return flt(x, fc, 0.9).lp * env * 2.2;
    }, g * 0.32, pan);
  }
}
// Pluck: lead corto y brillante (cuadrada + triangular, filtro que se cierra).
function pluck(at, m, len, g = 1, pan = 0) {
  const flt = svf();
  const f = midi(m);
  add(at, len + 0.25, (t) => {
    const sq = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.5 + (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * 2 * t)) * 0.35;
    const env = Math.min(1, t / 0.003) * Math.exp(-t * 7);
    return flt(sq, 900 + 5000 * Math.exp(-t * 14), 1).lp * env;
  }, g * 0.26, pan);
}
// Ruido que sube (antes de un corte) y platillo.
function riser(at, len, g = 1) {
  const flt = svf();
  add(at, len, (t) => { const p = t / len; return flt(rnd(), 300 + 9000 * p * p, 1.2).bp * Math.pow(p, 2.2) * 1.4; }, g * 0.5);
}
function crash(at, g = 1) {
  const fl = svf(), fr = svf();
  add(at, 2.2, (t) => fl(rnd(), 6000, 0.7).hp * Math.exp(-t * 2.2) * (1 - Math.exp(-t * 300)), g * 0.28, -0.4);
  add(at, 2.2, (t) => fr(rnd(), 6500, 0.7).hp * Math.exp(-t * 2.3) * (1 - Math.exp(-t * 300)), g * 0.28, 0.4);
}
const boom = (at, g = 1) => add(at, 1.4, (t) => Math.sin(2 * Math.PI * (38 * t + (60 / 9) * (1 - Math.exp(-t * 9)))) * Math.exp(-t * 2.6), g * 0.75);

// ─── Armonía (La menor: Am F C G) ───
const CH = { Am: [57, 60, 64, 69], F: [57, 60, 65, 69], C: [55, 60, 64, 67], G: [55, 59, 62, 67] };
const ROOT = { Am: 45, F: 41, C: 36, G: 43 };
const chordAtBeat = (b) => {
  if (b < -4) return 'Am';
  if (b < 0) return 'F';
  if (b < 20) return ['Am', 'F', 'C', 'G', 'Am'][Math.floor(b / 4)];
  if (b < 24) return 'F';
  if (b < 27) return 'G';
  return 'C';
};

// Sidechain: todo menos bombo y platos "respira" con cada golpe de bombo.
const kicks = [];
const K = (b, g = 1) => { kick(tOf(b), g); kicks.push(tOf(b)); };

// ─── 1. Instagram (tiempos -7.6 a 0): colchón suave, arpegio y hats; el bombo entra en el último compás ───
const B0 = Math.ceil(-G0 / BEAT * 2) / 2; // primer octavo dentro del video
chord(0, CH.Am, tOf(-4), { g: 0.55, cutoff: 700, attack: 0.25, decay: 0.6, sweep: 0.6 });
chord(tOf(-4), CH.F, 4 * BEAT, { g: 0.6, cutoff: 1000, attack: 0.05, decay: 0.8, sweep: 1.2 });
const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
for (let b = B0, i = 0; b < 0; b += 0.5, i++) {
  const ch = CH[chordAtBeat(b)];
  pluck(tOf(b), ch[ARP[i % ARP.length]] + 12, 0.18, 0.55, i % 2 ? 0.35 : -0.35);
  if (b >= -6 && b % 1 !== 0) hat(tOf(b), false, 0.8);
}
for (let b = -4; b < 0; b++) K(b, 0.7);
riser(tOf(-2), 2 * BEAT, 0.9);
for (let b = -1; b < 0; b += 0.25) snare(tOf(b), 0.25 + 0.5 * (b + 1));

// ─── 2. La app (0 a 20) y 3. el mapa (20 a 27): ritmo completo ───
const groove = (from, to) => {
  for (let b = from; b < to; b += 0.5) {
    const onBeat = b % 1 === 0;
    const ch = chordAtBeat(b);
    if (onBeat) K(b);
    if (onBeat && ((b % 4 + 4) % 4 === 1 || (b % 4 + 4) % 4 === 3)) clap(tOf(b));
    if (!onBeat) { hat(tOf(b), true, 0.9); bass(tOf(b), ROOT[ch], BEAT * 0.45); }
    hat(tOf(b + 0.25), false, 0.55, -0.3);
  }
  // Acordes sincopados: 1, el "y" del 2 y el 4
  for (let bar = Math.floor(from / 4) * 4; bar < to; bar += 4) {
    for (const off of [0, 1.5, 3]) {
      const b = bar + off;
      if (b < from || b >= to) continue;
      chord(tOf(b), CH[chordAtBeat(b)], BEAT * (off === 1.5 ? 1.2 : 0.7), { g: 0.85, cutoff: 3200, decay: 4 });
    }
  }
};
crash(tOf(0), 0.9);
boom(tOf(0), 0.5);
groove(0, 19);
// Respiro antes del rojo (el toque en Confirmar cae en el tiempo 19)
riser(tOf(19), BEAT, 1);
for (let b = 19; b < 20; b += 0.25) snare(tOf(b), 0.35 + 0.6 * (b - 19));
chord(tOf(19), CH.Am, BEAT, { g: 0.5, cutoff: 1200, sweep: 3 });

crash(tOf(20), 1);
boom(tOf(20), 0.6);
groove(20, 26.5);
// Gancho en el mapa
[[20, 76, 0.5], [20.5, 74, 0.25], [20.75, 72, 0.5], [21.5, 69, 0.5], [22, 72, 0.5], [22.5, 74, 0.5], [23, 76, 1],
 [24, 79, 0.5], [24.5, 76, 0.5], [25, 74, 0.5], [25.5, 72, 0.5], [26, 74, 0.5]].forEach(([b, m, d]) => {
  pluck(tOf(b), m, d * BEAT, 1.15, 0.1);
  pluck(tOf(b + 0.75), m, d * BEAT * 0.6, 0.35, -0.5); // eco
});
for (let b = 26.5; b < 27; b += 0.25) snare(tOf(b), 0.5 + 0.4 * (b - 26.5) * 2);

// ─── 4. Cierre (27 en adelante): golpe en Do mayor, el ritmo sigue más liviano y remata ───
crash(tOf(27), 1.1);
boom(tOf(27), 0.9);
chord(tOf(27), CH.C, 2 * BEAT, { g: 1.1, cutoff: 2600, attack: 0.004, decay: 1.2 });
for (let b = 27; b < 33; b += 0.5) {
  const onBeat = b % 1 === 0;
  if (onBeat && b > 27) K(b, 0.85);
  if (!onBeat) { hat(tOf(b), true, 0.7); bass(tOf(b), ROOT.C, BEAT * 0.45, 0.8); }
  if (onBeat && (b === 28 || b === 30 || b === 32)) clap(tOf(b), 0.8);
}
chord(tOf(29), CH.C, 4 * BEAT, { g: 0.55, cutoff: 1800, attack: 0.08, decay: 0.9 });
[[29, 79], [29.5, 76], [30, 72], [31, 74], [31.5, 76]].forEach(([b, m]) => pluck(tOf(b), m, BEAT * 0.5, 0.8, 0.15));
// Remate final
K(33, 1);
crash(tOf(33), 1);
chord(tOf(33), [48, 55, 60, 64, 67], 2.4 * BEAT, { g: 1.0, cutoff: 2200, decay: 1.4, release: 0.5 });
bass(tOf(33), 36, 1.5 * BEAT, 1);

// ─── Mezcla ───
// Sidechain: lo que no es bombo baja un 45 % en cada golpe y vuelve en ~150 ms.
const duck = new Float32Array(N).fill(1);
for (const kt of kicks) {
  const s0 = Math.round(kt * SR);
  for (let i = 0; i < 0.25 * SR; i++) { const k = s0 + i; if (k >= 0 && k < N) duck[k] = Math.min(duck[k], 1 - 0.45 * Math.exp(-i / SR * 14)); }
}
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh((L[i] * duck[i] + KL[i]) * 0.9); R[i] = Math.tanh((R[i] * duck[i] + KR[i]) * 0.9);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
// Fundido corto al final y normalización a -1 dB
const norm = 0.89 / peak;
const fadeFrom = (DURATION - 0.35) * SR;
const out = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const f = i > fadeFrom ? Math.max(0, 1 - (i - fadeFrom) / (0.35 * SR)) : 1;
  out.writeInt16LE(Math.round(L[i] * norm * f * 32767), i * 4);
  out.writeInt16LE(Math.round(R[i] * norm * f * 32767), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + out.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(out.length, 40);
fs.mkdirSync('public/music', { recursive: true });
fs.writeFileSync('public/music/fixstore.wav', Buffer.concat([h, out]));
console.log(`public/music/fixstore.wav: ${DURATION}s, ${BPM} BPM, pico ${peak.toFixed(2)}`);
