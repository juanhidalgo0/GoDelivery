// Los repartidores solo trabajan desde la app instalada de la tienda (iOS / Android).
//
// Desde el navegador o la PWA no hay rastreo en segundo plano, las notificaciones llegan tarde o
// no llegan y la pantalla se duerme: los pedidos se trababan. Fuera de la app nativa el panel del
// cadete queda tapado por esta pantalla, sin "seguir en el navegador". Los admins no se bloquean.
//
// Si tiene pedidos en curso puede terminarlos (no se lo deja con un pedido a medias), pero no
// conectarse: assertCanGoOnline() corta "Iniciar Jornada" y, si figuraba conectado, se lo
// desconecta para que no le lleguen ofertas que no va a ver.
//
// Interruptor de emergencia: settings/global.allowWebDrivers = true lo apaga sin publicar.
// En desarrollo: localStorage gd_allow_web_driver = '1'.

import { getState, setState } from '../state.js';
import { isAdmin, isDelivery } from '../auth.js';
import { APP_STORE_URL, PLAY_STORE_URL } from './install-lock.js';
import { icon } from '../utils/icons.js';

const LOCK_ID = 'driver-app-gate';
let finishingOrders = false; // eligió "terminar mis pedidos" en esta sesión

function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

export function mustUseNativeApp(user = getState().user) {
  if (!user || isNativeApp()) return false;
  if (!isDelivery() || isAdmin()) return false;
  if (user.email === 'test-delivery@godelivery.com') return false; // revisión de las tiendas
  if (getState().allowWebDrivers === true) return false;
  if (import.meta.env.DEV) { try { if (localStorage.getItem('gd_allow_web_driver') === '1') return false; } catch (e) {} }
  return true;
}

async function forceOffline(user) {
  if (!user?.isOnline) return;
  try {
    const { db } = await import('../firebase.js');
    const { doc, updateDoc } = await import('firebase/firestore');
    setState('user', { ...getState().user, isOnline: false, currentSessionId: null });
    await updateDoc(doc(db, 'users', user.uid), { isOnline: false, currentSessionId: null, disconnectedReason: 'web_no_permitida' });
  } catch (e) {
    console.warn('[DriverGate] No se pudo desconectar:', e);
  }
}

async function activeOrdersOf(uid) {
  try {
    const { db } = await import('../firebase.js');
    const { collection, query, where, getDocs } = await import('firebase/firestore');
    const snap = await getDocs(query(collection(db, 'orders'), where('driverId', '==', uid)));
    return snap.docs.filter((d) => !['completed', 'cancelled', 'delivered'].includes(d.data().status)).length;
  } catch (e) {
    return 0;
  }
}

/** Antes de conectarse: false (y explica por qué) si está fuera de la app nativa. */
export function assertCanGoOnline(user) {
  if (!mustUseNativeApp(user)) return true;
  if (finishingOrders) {
    // Está terminando sus pedidos: no se le vuelve a tapar la pantalla, solo se le explica
    import('./toast.js').then((m) => m.showToast('Para tomar pedidos nuevos tenés que usar la app de la tienda', 'warning', 6000)).catch(() => {});
  } else {
    showDriverAppGate(user);
  }
  return false;
}

/**
 * Lo llama el panel del cadete al dibujarse. Devuelve true si la pantalla quedó bloqueada.
 */
export async function enforceDriverApp(user = getState().user) {
  if (!mustUseNativeApp(user)) { document.getElementById(LOCK_ID)?.remove(); return false; }
  forceOffline(user);
  if (finishingOrders) return false;
  await showDriverAppGate(user);
  return true;
}

async function showDriverAppGate(user) {
  if (document.getElementById(LOCK_ID)) return;
  const pending = await activeOrdersOf(user.uid);
  if (document.getElementById(LOCK_ID)) return;

  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const store = (url, logo, name) => `
    <a href="${url}" target="_blank" rel="noopener noreferrer" class="gl-store">
      <span class="gl-store-logo">${logo}</span>
      <span class="gl-store-text"><small>Descargala en</small><strong>${name}</strong></span>
      <span class="gl-store-go">${icon('chevronRight', 18)}</span>
    </a>`;
  const apple = store(APP_STORE_URL, `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.82 1.11-1.96.99-3.1-.96.04-2.11.64-2.79 1.44-.59.69-1.12 1.83-.98 2.94 1.07.08 2.15-.55 2.78-1.28z"/></svg>`, 'App Store');
  const play = store(PLAY_STORE_URL, `<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#4285F4" d="M3.6 1.8l10.9 10.9-3.1 3.1L2.1 2.6c-.3.4-.3 1 0 1.4l1.5-2.2z"/><path fill="#EA4335" d="M14.5 12.7L3.6 23.6c.3.4.9.4 1.4.1l12.4-7.2-2.9-3.8z"/><path fill="#FBBC04" d="M21.9 11.3l-4.5-2.6-2.9 4 2.9 4 4.5-2.6c.8-.5.8-2.3 0-2.8z"/><path fill="#34A853" d="M3.6 1.8L14.5 12.7l2.9-4L5 1.5c-.5-.3-1.1-.3-1.4.3z"/></svg>`, 'Google Play');

  const el = document.createElement('div');
  el.id = LOCK_ID;
  el.className = 'pwa-lock-fullscreen';
  el.style.cssText = `position:fixed; inset:0; z-index:2147483000; background:#0b0b0c; color:#fff; display:flex; flex-direction:column; justify-content:space-between; align-items:center; box-sizing:border-box; overflow-y:auto; -webkit-overflow-scrolling:touch;
    padding: calc(max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 24px)) + 20px) 24px calc(max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 20px)) + 16px);
    font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);`;
  el.innerHTML = `
    <div class="gl-top">
      <span class="gl-ring"><img src="/logo-brand.jpg?v=2" alt="GO! Delivery" /><i></i></span>
    </div>
    <div class="gl-hero">
      <span class="go-eyebrow">Repartidores · GO!</span>
      <h1 class="go-title">Para repartir,<br>usá la app</h1>
      <span class="go-bar"></span>
      <p>Desde el navegador ya no se pueden tomar pedidos. Instalá la app oficial y entrá con la misma cuenta${user.email ? ` (<b>${String(user.email).replace(/[<>&"]/g, '')}</b>)` : ''}.</p>
      <ul class="gl-benefits">
        <li><span>${icon('bell', 18)}</span>Las ofertas de pedidos te suenan aunque tengas el celular bloqueado</li>
        <li><span>${icon('mapPin', 18)}</span>El cliente te ve en el mapa todo el viaje</li>
        <li><span>${icon('checkCircle', 18)}</span>Tu saldo, tus pedidos y tu historial siguen igual</li>
      </ul>
    </div>
    <div class="gl-actions">
      ${ios ? apple : android ? play : play + apple}
      ${pending ? `<button id="driver-gate-finish" class="gl-skip">${pending === 1 ? 'Terminar mi pedido en curso' : `Terminar mis ${pending} pedidos en curso`}</button>` : ''}
      <button id="driver-gate-client" class="gl-skip">Usar GO! como cliente</button>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('#driver-gate-finish')?.addEventListener('click', () => {
    finishingOrders = true;
    el.remove();
    import('./toast.js').then((m) => m.showToast('Podés terminar tus pedidos. Para tomar nuevos, instalá la app.', 'warning', 6000)).catch(() => {});
  });
  el.querySelector('#driver-gate-client')?.addEventListener('click', async () => {
    el.remove();
    const { switchToClientMode } = await import('../pages/delivery-panel.js');
    switchToClientMode('#/');
  });
}

// (z-index por encima de #app-overlay, 10000000: ninguna pantalla superpuesta la tapa)
// Sale del panel del cadete (modo cliente, otra pantalla): la pantalla no lo sigue
window.addEventListener('hashchange', () => {
  if (!(window.location.hash || '').startsWith('#/delivery')) document.getElementById(LOCK_ID)?.remove();
});
