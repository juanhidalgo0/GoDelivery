// Renders the driver's in-app offer ping (AudioManager.playDriverRadarPing in
// src/utils/audio-manager.js) to a WAV, so the push that arrives with the app closed sounds the
// same as the offer on screen.
//
//   node scripts/generate-offer-sound.mjs
//
// Output: android/app/src/main/res/raw/alert.wav. The Android notification channels
// exclusive_offers / order_offers / admin_alerts point to raw/alert (src/utils/notifications.js);
// before this file existed those channels had no playable sound.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RATE = 44100;
const PINGS = 3;          // three pings, like the start of the in-app loop
const PING_GAP = 0.75;    // seconds between pings
const TAIL = 0.25;        // silence after the last one
const PEAK = 0.9;

// One ping: [start, oscillator, frequency, peak gain, attack end, decay end] — same values as the synth.
const NOTES = [
  [0.0, 'triangle', 880, 0.18, 0.015, 0.25],
  [0.09, 'sine', 1318.5, 0.20, 0.105, 0.45],
  [0.18, 'sine', 1760, 0.16, 0.195, 0.65]
];

const wave = (type, phase) => (type === 'triangle' ? 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1 : Math.sin(2 * Math.PI * phase));

// Web Audio's exponentialRampToValueAtTime from 0.001 up to the peak, then back down to 0.001.
function envelope(t, start, peak, attackEnd, decayEnd) {
  if (t < start || t > decayEnd) return 0;
  const floor = 0.001;
  if (t <= attackEnd) return floor * Math.pow(peak / floor, (t - start) / (attackEnd - start));
  return peak * Math.pow(floor / peak, (t - attackEnd) / (decayEnd - attackEnd));
}

const duration = (PINGS - 1) * PING_GAP + 0.65 + TAIL;
const total = Math.ceil(duration * RATE);
const samples = new Float32Array(total);
for (let p = 0; p < PINGS; p++) {
  const offset = p * PING_GAP;
  for (const [start, type, freq, peak, attackEnd, decayEnd] of NOTES) {
    const s0 = offset + start;
    const s1 = offset + decayEnd;
    for (let i = Math.floor(s0 * RATE); i < Math.min(total, Math.ceil(s1 * RATE)); i++) {
      const t = i / RATE;
      samples[i] += wave(type, (t - s0) * freq) * envelope(t, s0, peak, offset + attackEnd, s1);
    }
  }
}

const max = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
const pcm = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.round((samples[i] / max) * PEAK * 32767), i * 2);

// 16-bit mono PCM WAV (plays on Android and, as a notification sound, on iOS).
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'android/app/src/main/res/raw/alert.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`Wrote ${path.relative(root, out)} (${(duration).toFixed(2)} s, ${Math.round((44 + pcm.length) / 1024)} KB)`);
