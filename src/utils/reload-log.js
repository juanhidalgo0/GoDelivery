// Registro de reinicios de la app (diagnóstico).
//
// "La app se recarga sola" puede ser que la app misma recargue (versión nueva, Firestore roto,
// una pantalla que no cargó) o que el sistema la cierre por memoria y la vuelva a abrir. Desde
// afuera se ven iguales (splash y logo). Acá:
// - antes de cada recarga que pide la app se anota el motivo (markReload);
// - mientras la app está abierta se anota cada 5 s que sigue viva, en qué pantalla y si se veía;
// - al arrancar se mira cómo terminó la vez anterior y, si fue un reinicio, se guarda en
//   Firestore (app_restarts) para verlo desde Admin → Reinicios.

const MARK_KEY = 'gd_reload_mark';
const ALIVE_KEY = 'gd_alive';
const PENDING_KEY = 'gd_restart_pending';
const LEFT_KEY = 'gd_left_page'; // la página se cerró por navegación (si el sistema mata la app, no se llega a anotar)

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
const drop = (k) => { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } };

/** Llamar justo antes de recargar la app por código. */
export function markReload(reason) {
  write(MARK_KEY, { reason: String(reason || 'sin motivo').slice(0, 200), at: Date.now(), route: location.hash || '#/' });
}

export function platform() {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) return `app ${cap.getPlatform?.() || ''}`.trim();
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const os = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : (/Android/.test(navigator.userAgent) ? 'android' : 'pc');
  return `${standalone ? 'pwa' : 'web'} ${os}`;
}

function classifyLastExit() {
  const mark = read(MARK_KEY);
  const alive = read(ALIVE_KEY);
  const left = read(LEFT_KEY);
  drop(MARK_KEY);
  drop(LEFT_KEY);
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || 'navigate';
  const now = Date.now();

  if (mark && now - mark.at < 2 * 60 * 1000) {
    return { kind: 'la app recargó', reason: mark.reason, route: mark.route };
  }
  if (!alive || now - alive.at > 90 * 1000) return null; // primera apertura o volvió mucho después: normal
  if (nav === 'reload') {
    return { kind: 'recarga manual', reason: 'botón Recargar, deslizar para refrescar o el navegador', route: alive.route, wasVisible: alive.visible };
  }
  // Salió a otra página (el sorteo es /sorteo.html y vuelve con un enlace a /#/) o volvió con
  // "atrás": la app arranca de nuevo, pero nadie la cerró. Antes figuraba como "el sistema la cerró".
  if (nav === 'back_forward' || (left && now - left.at < 2 * 60 * 1000)) return null;
  return {
    kind: 'reinicio sin aviso',
    reason: alive.visible ? 'se cerró con la app en pantalla (falla o falta de memoria)' : 'el sistema la cerró en segundo plano (probablemente memoria)',
    route: alive.route,
    wasVisible: alive.visible,
  };
}

let started = false;

export function initReloadLog() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const last = classifyLastExit();
  if (last) {
    console.warn('[Reinicio]', last.kind, '·', last.reason, '·', last.route);
    write(PENDING_KEY, { ...last, at: Date.now(), platform: platform(), ua: navigator.userAgent.slice(0, 160) });
  }

  const beat = () => write(ALIVE_KEY, { at: Date.now(), route: location.hash || '#/', visible: document.visibilityState === 'visible' });
  beat();
  setInterval(beat, 5000);
  document.addEventListener('visibilitychange', beat);
  window.addEventListener('pagehide', () => write(LEFT_KEY, { at: Date.now(), route: location.hash || '#/' }));

  flushWhenSignedIn();
}

async function flushWhenSignedIn() {
  const pending = read(PENDING_KEY);
  if (!pending) return;
  const { getState, subscribe } = await import('../state.js');
  let sending = false; // el usuario cambia varias veces al arrancar: sin esto se guardaba 3-4 veces
  const send = async (user) => {
    if (!user?.uid || !read(PENDING_KEY)) return false;
    if (sending) return true;
    sending = true;
    try {
      const { db } = await import('../firebase.js');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'app_restarts'), {
        ...pending,
        uid: user.uid,
        userName: user.displayName || user.name || '',
        role: user.role || 'user',
        appVersion: localStorage.getItem('gd_app_version') || '',
        createdAt: serverTimestamp(),
      });
      drop(PENDING_KEY);
    } catch (e) {
      console.warn('[Reinicio] no se pudo guardar el registro:', e?.code || e);
    }
    return true;
  };
  if (await send(getState().user)) return;
  const unsub = subscribe('user', async (u) => { if (await send(u)) unsub?.(); });
}
