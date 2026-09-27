// Genera los efectos de sonido del anuncio (WAV 44.1 kHz mono). Sin archivos de terceros.
import fs from 'node:fs';
const SR = 44100;
function wav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767 | 0, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(`public/sfx/${name}.wav`, Buffer.concat([h, data]));
}
const len = (s) => Math.round(s * SR);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// Toque: "tic" corto y suave, tipo iOS.
wav('tap', Array.from({ length: len(0.06) }, (_, i) => {
  const t = i / SR;
  return 0.55 * Math.exp(-t * 90) * (Math.sin(2 * Math.PI * 2200 * t) * 0.6 + Math.sin(2 * Math.PI * 1300 * t) * 0.4) + 0.08 * rnd() * Math.exp(-t * 400);
}));

// Whoosh: ruido filtrado con barrido y envolvente suave.
{
  const n = len(0.55); let lp = 0; const out = [];
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const cutoff = 0.02 + 0.25 * Math.sin(Math.PI * p);
    lp += cutoff * (rnd() - lp);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, p * 1.15)), 2);
    out.push(lp * env * 2.2);
  }
  wav('whoosh', out);
}

// Éxito: dos notas limpias ascendentes (campanita).
wav('success', Array.from({ length: len(0.9) }, (_, i) => {
  const t = i / SR;
  const note = (f, start) => t < start ? 0 : Math.exp(-(t - start) * 6) * (Math.sin(2 * Math.PI * f * (t - start)) + 0.25 * Math.sin(2 * Math.PI * f * 2 * (t - start)));
  return 0.32 * (note(1046.5, 0) + note(1568, 0.12));
}));
console.log(fs.readdirSync('public/sfx'));
