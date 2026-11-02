// Plugin propio GoNative (android/.../GoNativePlugin.java, ios/App/App/GoNativePlugin.swift):
// vibraciones y el cartel de la tienda para calificar la app. Las apps instaladas antes no lo
// tienen: la vibración cae a navigator.vibrate (solo Android) y la reseña no hace nada.
import { registerPlugin, Capacitor } from '@capacitor/core';

let proxy = null;
export function goNative() {
  if (!Capacitor.isPluginAvailable('GoNative')) return null;
  if (!proxy) proxy = registerPlugin('GoNative');
  return proxy;
}

const PATTERNS = { light: 12, medium: 18, heavy: 30, selection: 8, success: [20, 60, 30], warning: [40, 80, 40], error: [60, 60, 60, 60, 60] };

/** kind: light | medium | heavy | selection | success | warning | error */
export function haptic(kind = 'light') {
  const plugin = goNative();
  if (plugin) {
    plugin.haptic({ kind }).catch(() => {});
    return;
  }
  try { navigator.vibrate?.(PATTERNS[kind] ?? 12); } catch (e) { /* sin vibración */ }
}

const REVIEW_KEY = 'gd_app_review_asked_at';
const REVIEW_EVERY_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Cartel de Apple o Google para calificar GO!. Espera a que no haya ningún cartel de la app
 * abierto (después de calificar al cadete viene el del comercio), y se pide como mucho cada 4
 * meses: las tiendas igual lo limitan.
 */
export function requestAppReview() {
  const plugin = goNative();
  if (!plugin) return;
  try {
    const last = Number(localStorage.getItem(REVIEW_KEY)) || 0;
    if (Date.now() - last < REVIEW_EVERY_MS) return;
    localStorage.setItem(REVIEW_KEY, String(Date.now()));
  } catch (e) { return; }
  let quietChecks = 0;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    quietChecks = document.querySelector('.modal-overlay') ? 0 : quietChecks + 1;
    if (quietChecks >= 3) {
      clearInterval(timer);
      plugin.requestReview().catch(() => {});
    } else if (tries > 240) {
      clearInterval(timer);
    }
  }, 500);
}
