// Mensajes de voz del chat, con la forma de un audio de WhatsApp: play, barras con punto que avanza,
// foto con micrófono (verde sin escuchar, celeste ya escuchado) y velocidad 1x/1,5x/2x al reproducir.
import { icon } from '../utils/icons.js';

const BARS = 32;
const SPEEDS = [1, 1.5, 2];
let speedIndex = 0;

const PLAY = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5.1v13.8c0 .8.9 1.3 1.6.8l10.6-6.9c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.8 8 4.3 8 5.1z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg>';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const formatDuration = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Audios viejos (sin forma guardada): siempre las mismas barras para el mismo mensaje
function fallbackWave(seed) {
  let h = 7;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 73 + i * 17) % 9973;
    return 0.22 + ((h % 100) / 100) * 0.78;
  });
}

/** La forma real del audio: 32 alturas entre 0 y 1. Si el celular no puede analizarlo, null. */
export async function analyzeWaveform(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks = Array.from({ length: BARS }, (_, i) => {
      let sum = 0;
      const end = Math.min(data.length, (i + 1) * step);
      for (let j = i * step; j < end; j += Math.ceil(step / 200)) sum = Math.max(sum, Math.abs(data[j]));
      return sum;
    });
    const top = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.round(Math.max(0.12, p / top) * 100) / 100);
  } catch (e) {
    return null;
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}

export function audioBubbleHtml(msg, { timeStr = '', ticksHtml = '', isMine = false } = {}) {
  const wave = Array.isArray(msg.waveform) && msg.waveform.length ? msg.waveform : fallbackWave(msg.id);
  const bars = wave.map((v) => `<i style="height:${Math.round(Math.max(0.12, Number(v) || 0) * 100)}%"></i>`).join('');
  const avatar = msg.senderPhoto
    ? `<img src="${esc(msg.senderPhoto)}" alt="" loading="lazy">`
    : `<span>${esc((msg.senderName || 'U')[0].toUpperCase())}</span>`;
  return `
    <div class="wa-audio ${msg.played ? 'is-played' : ''}" data-msg="${esc(msg.id)}" data-duration="${Number(msg.duration) || 0}" data-mine="${isMine ? 1 : 0}">
      <audio class="wa-chat-audio" src="${esc(msg.audioUrl)}" preload="${msg.duration ? 'none' : 'metadata'}"></audio>
      <button type="button" class="wa-play" aria-label="Reproducir audio">${PLAY}</button>
      <div class="wa-track">
        <div class="wa-bars">${bars}</div>
        <span class="wa-dot"></span>
        <input type="range" class="wa-seek" min="0" max="1000" value="0" aria-label="Posición del audio">
      </div>
      <div class="wa-side">
        <div class="wa-avatar">${avatar}<b class="wa-mic">${icon('mic', 10)}</b></div>
        <button type="button" class="wa-speed" aria-label="Velocidad">1x</button>
      </div>
      <div class="wa-meta">
        <span class="wa-time">${msg.duration ? formatDuration(msg.duration) : '0:00'}</span>
        <span class="wa-stamp"><span>${esc(timeStr)}</span>${ticksHtml}</span>
      </div>
      ${msg.transcript ? `<div class="wa-transcript">${esc(msg.transcript)}</div>` : ''}
    </div>`;
}

const speedLabel = () => `${String(SPEEDS[speedIndex]).replace('.', ',')}x`;

function paint(player, audio) {
  const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(player.dataset.duration) || 0;
  const pct = total ? Math.min(1, audio.currentTime / total) : 0;
  const bars = player.querySelectorAll('.wa-bars i');
  const reached = Math.round(pct * bars.length);
  bars.forEach((bar, i) => bar.classList.toggle('on', i < reached));
  player.querySelector('.wa-dot').style.left = `${pct * 100}%`;
  if (!player.classList.contains('is-seeking')) player.querySelector('.wa-seek').value = Math.round(pct * 1000);
  const playing = !audio.paused || audio.currentTime > 0;
  player.querySelector('.wa-time').textContent = formatDuration(playing ? audio.currentTime : total);
}

function setButton(player, playing) {
  player.classList.toggle('is-playing', playing);
  const btn = player.querySelector('.wa-play');
  btn.innerHTML = playing ? PAUSE : PLAY;
  btn.setAttribute('aria-label', playing ? 'Pausar audio' : 'Reproducir audio');
}

function bind(player, audio) {
  if (audio._bound) return;
  audio._bound = true;
  audio.addEventListener('timeupdate', () => paint(player, audio));
  audio.addEventListener('loadedmetadata', () => {
    // Los webm de Chrome no traen duración hasta recorrerlos; con la guardada alcanza
    if (Number.isFinite(audio.duration) && !player.dataset.duration) player.dataset.duration = audio.duration;
    paint(player, audio);
  });
  audio.addEventListener('waiting', () => player.classList.add('is-loading'));
  audio.addEventListener('playing', () => player.classList.remove('is-loading'));
  audio.addEventListener('canplay', () => player.classList.remove('is-loading'));
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    setButton(player, false);
    player.classList.remove('is-started');
    paint(player, audio);
    player.querySelector('.wa-time').textContent = formatDuration(player.dataset.duration);
  });
  audio.addEventListener('pause', () => setButton(player, false));
  audio.addEventListener('play', () => setButton(player, true));
  audio.addEventListener('error', async () => {
    player.classList.remove('is-loading');
    setButton(player, false);
    const { showToast } = await import('./toast.js');
    showToast('No se pudo reproducir este audio. Probá de nuevo.', 'error');
  });
}

/** Escucha los audios de la lista de mensajes. onPlayed(idDelMensaje): el que lo recibió lo escuchó. */
export function initAudioPlayers(container, { onPlayed } = {}) {
  if (container.dataset.audioReady) return () => pauseAll(container);
  container.dataset.audioReady = '1';

  container.addEventListener('click', (e) => {
    const speed = e.target.closest('.wa-speed');
    if (speed) {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      container.querySelectorAll('.wa-chat-audio').forEach((a) => { a.playbackRate = SPEEDS[speedIndex]; });
      container.querySelectorAll('.wa-speed').forEach((b) => { b.textContent = speedLabel(); });
      return;
    }
    const play = e.target.closest('.wa-play');
    if (!play) return;
    const player = play.closest('.wa-audio');
    const audio = player.querySelector('audio');
    bind(player, audio);
    if (!audio.paused) { audio.pause(); return; }
    pauseAll(container, audio);
    audio.playbackRate = SPEEDS[speedIndex];
    player.querySelector('.wa-speed').textContent = speedLabel();
    player.classList.add('is-started');
    if (audio.readyState < 2) player.classList.add('is-loading');
    audio.play().then(() => {
      if (player.dataset.mine !== '1' && !player.classList.contains('is-played')) {
        player.classList.add('is-played');
        onPlayed?.(player.dataset.msg);
      }
    }).catch((err) => {
      if (err?.name !== 'AbortError') console.warn('[chat] audio', err);
      player.classList.remove('is-loading');
    });
  });

  container.addEventListener('input', (e) => {
    if (!e.target.classList.contains('wa-seek')) return;
    const player = e.target.closest('.wa-audio');
    const audio = player.querySelector('audio');
    bind(player, audio);
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(player.dataset.duration) || 0;
    if (!total) return;
    audio.currentTime = (e.target.value / 1000) * total;
    player.classList.add('is-started');
    paint(player, audio);
  });

  return () => pauseAll(container);
}

function pauseAll(container, except = null) {
  container.querySelectorAll('.wa-chat-audio').forEach((a) => { if (a !== except && !a.paused) a.pause(); });
}
