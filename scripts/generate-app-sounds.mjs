// Genera los sonidos de aviso de la app (public/assets/sounds/*.wav).
//
//   node scripts/generate-app-sounds.mjs
//
// notification.mp3 y message.mp3 eran páginas HTML guardadas con extensión .mp3 (desde mayo):
// ningún teléfono podía reproducirlas, sonaba siempre el sonido sintetizado de respaldo y cada
// vez quedaba un error en Admin → Errores ("Playback failed… no supported source"). Estos WAV
// suenan igual que ese respaldo (AudioManager.playSynthNotification en src/utils/audio-manager.js).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RATE = 44100;

// [inicio s, frecuencia Hz, pico, fin del ataque s, fin s]
const SOUNDS = {
  // Las tres notas de playSynthNotification: mi, sol, do subiendo
  'notification.wav': { peak: 0.45, notes: [[0, 659.25, 1, 0.02, 0.3], [0.08, 783.99, 1, 0.1, 0.38], [0.16, 1046.5, 1, 0.18, 0.46]] },
  // Mensaje de chat: dos notas cortas, más suave
  'message.wav': { peak: 0.35, notes: [[0, 880, 1, 0.012, 0.18], [0.07, 1318.5, 1, 0.082, 0.26]] },
};

// Como exponentialRampToValueAtTime de Web Audio: de 0.001 al pico y de vuelta a 0.001
function envelope(t, start, attackEnd, end) {
  if (t < start || t > end) return 0;
  const floor = 0.001;
  if (t <= attackEnd) return floor * Math.pow(1 / floor, (t - start) / (attackEnd - start));
  return Math.pow(floor, (t - attackEnd) / (end - attackEnd));
}

function render({ peak, notes }) {
  const duration = Math.max(...notes.map(n => n[4])) + 0.05;
  const total = Math.ceil(duration * RATE);
  const samples = new Float32Array(total);
  for (const [start, freq, gain, attackEnd, end] of notes) {
    for (let i = Math.floor(start * RATE); i < Math.min(total, Math.ceil(end * RATE)); i++) {
      const t = i / RATE;
      samples[i] += gain * Math.sin(2 * Math.PI * (t - start) * freq) * envelope(t, start, attackEnd, end);
    }
  }
  const max = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.round((samples[i] / max) * peak * 32767), i * 2);

  // WAV PCM 16 bits mono: lo reproducen Android, iPhone y cualquier navegador
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return { data: Buffer.concat([header, pcm]), duration };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public/assets/sounds');
fs.mkdirSync(dir, { recursive: true });
for (const [name, def] of Object.entries(SOUNDS)) {
  const { data, duration } = render(def);
  fs.writeFileSync(path.join(dir, name), data);
  console.log(`Wrote public/assets/sounds/${name} (${duration.toFixed(2)} s, ${Math.round(data.length / 1024)} KB)`);
}
