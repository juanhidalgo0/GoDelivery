// Detector de errores (lado app).
//
// Manda al servidor (functions/client-errors.js → client_errors → Admin → Errores) los errores que
// ve la app en el celular de cada persona:
// - "error": excepciones que nadie atrapó;
// - "promesa": promesas rechazadas sin catch;
// - "capturado": console.error(...) con un Error adentro (el catch que mostró "Error al guardar"),
//   y las funciones del servidor que le responden a la app con un error 5xx;
// - "toast": los mensajes de error que vio la persona (showToast(..., 'error')). No avisan solos:
//   sirven para ver qué errores le aparecen a la gente y dónde.
// Cada error se manda una sola vez por sesión y como mucho MAX_PER_SESSION en total, en tandas.
// En desarrollo no manda nada (salvo localStorage gd_report_dev = 1, para probarlo contra los emuladores).

import { functionUrl } from './functions-url.js';
import { platform } from './reload-log.js';

const MAX_PER_SESSION = 15;
const FLUSH_MS = 3000;

const seen = new Set();
let queue = [];
let sentCount = 0;
let timer = null;
let reporting = false; // un error dentro del propio envío no se reporta (evita bucles)

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

function errorText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e.message) return e.code && !String(e.message).includes(e.code) ? `${e.message} (${e.code})` : e.message;
  try { return JSON.stringify(e).slice(0, 300); } catch (x) { return String(e); }
}

function queueReport(kind, message, stack) {
  if (reporting) return;
  message = clip(message, 500).trim();
  if (!message) return;
  const key = `${kind}|${message.slice(0, 200)}|${clip(stack, 2000).split('\n').find(l => /\.js/.test(l)) || ''}`;
  if (seen.has(key) || sentCount >= MAX_PER_SESSION) return;
  seen.add(key);
  sentCount++;
  queue.push({ kind, message, stack: clip(stack, 2000), route: clip(location.hash || '#/', 120), at: Date.now() });
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

async function payload(batch) {
  let user = null, idToken = null;
  try {
    const { getState } = await import('../state.js');
    user = getState().user || null;
  } catch (e) { /* sin estado todavía */ }
  try {
    const { auth } = await import('../firebase.js');
    if (auth?.currentUser) idToken = await auth.currentUser.getIdToken();
  } catch (e) { /* invitado o sin conexión */ }
  const common = {
    platform: platform(),
    version: (() => { try { return localStorage.getItem('gd_app_version') || ''; } catch (e) { return ''; } })(),
    ua: clip(navigator.userAgent, 200),
    role: user?.role || (user ? 'user' : 'invitado'),
    userName: clip(user?.displayName || user?.name || '', 60),
  };
  return { idToken, errors: batch.map(r => ({ ...common, ...r })) };
}

async function flush() {
  timer = null;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  reporting = true;
  try {
    const body = JSON.stringify(await payload(batch));
    await fetch(functionUrl('reportClientError'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch (e) {
    /* sin conexión: se pierde, no se reintenta */
  } finally {
    reporting = false;
  }
}

// Al cerrar la app lo pendiente sale por sendBeacon (texto plano: sin preflight, el servidor lo parsea)
function flushOnExit() {
  if (!queue.length || !navigator.sendBeacon) return;
  const batch = queue;
  queue = [];
  const common = { platform: platform(), ua: clip(navigator.userAgent, 200) };
  try { navigator.sendBeacon(functionUrl('reportClientError'), JSON.stringify({ errors: batch.map(r => ({ ...common, ...r })) })); } catch (e) { /* nada */ }
}

/** Mensaje de error que se le mostró a la persona (lo llama components/toast.js). */
export function reportUserFacingError(message) {
  if (!started) return;
  queueReport('toast', clip(message, 300), new Error().stack || '');
}

// Las funciones propias (cloudfunctions.net/<nombre>) que responden 5xx: el servidor falló
function watchFunctionResponses() {
  const original = window.fetch?.bind(window);
  if (!original) return;
  window.fetch = async (...args) => {
    const res = await original(...args);
    try {
      const url = String(typeof args[0] === 'string' ? args[0] : (args[0]?.url || ''));
      const m = /cloudfunctions\.net\/([\w-]+)|127\.0\.0\.1:5001\/[^/]+\/[^/]+\/([\w-]+)/.exec(url);
      const name = m && (m[1] || m[2]);
      if (name && name !== 'reportClientError' && res.status >= 500) {
        queueReport('capturado', `La función ${name} respondió ${res.status}`, new Error().stack || '');
      }
    } catch (e) { /* nunca romper fetch */ }
    return res;
  };
}

let started = false;
export function initErrorReporter() {
  if (started || typeof window === 'undefined') return;
  // En desarrollo no manda nada, salvo que se pida para probarlo (localStorage gd_report_dev = 1)
  if (import.meta.env.DEV) { try { if (localStorage.getItem('gd_report_dev') !== '1') return; } catch (e) { return; } }
  started = true;

  window.addEventListener('error', (e) => {
    // Recursos que no cargaron (imágenes) llegan acá sin mensaje: no son errores de código
    if (!e.message && !e.error) return;
    queueReport('error', errorText(e.error) || e.message, e.error?.stack || `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    queueReport('promesa', errorText(r), r?.stack || '');
  });

  const original = console.error.bind(console);
  console.error = (...args) => {
    original(...args);
    try {
      const err = args.find(a => a instanceof Error);
      if (!err) return;
      const prefix = args.filter(a => typeof a === 'string').join(' ').trim();
      queueReport('capturado', `${prefix ? prefix + ' ' : ''}${errorText(err)}`, err.stack || '');
    } catch (e) { /* nunca romper console.error */ }
  };

  watchFunctionResponses();

  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnExit(); });
}
