// "GO! estrena imagen": tells each account, once, that the app has a new look, with a
// message for its role. People who signed up after the launch never saw the old app,
// so it is not shown to them.
import { getState, subscribe } from '../state.js';
import { db } from '../firebase.js';
import { isAdmin, isComercio, isDelivery } from '../auth.js';
import { icon } from '../utils/icons.js';
import { showGoSheet, isAnySheetOpen } from './go-sheet.js';

const FLAG = 'seenRedesign2026b'; // v2: shown again to everyone once
const LOCAL_KEY = 'gd_seen_redesign_2026b';
const LAUNCH = new Date('2026-09-28T00:00:00-03:00').getTime();

const row = (iconName, title, text) =>
  `<li><span>${icon(iconName, 17)}</span><span><strong>${title}</strong><small>${text}</small></span></li>`;

const MESSAGES = {
  client: {
    eyebrow: 'Novedades',
    title: 'GO! estrena imagen',
    body: `
      <p>Renovamos la app de punta a punta para que pedir sea más simple y rápido.</p>
      <ul class="go-bsheet-list">
        ${row('grid', 'Todo a mano', 'Mandados, Viajes, Market y Ofertas se abren desde el inicio.')}
        ${row('award', 'Club GO renovado', 'Tus puntos y tu nivel, claros en tu perfil.')}
        ${row('zap', 'Más fluida', 'Pantallas más rápidas y un buscador que encuentra productos.')}
      </ul>`,
  },
  comercio: {
    eyebrow: 'Novedades para tu comercio',
    title: 'GO! estrena imagen',
    body: `
      <p>La app tiene un diseño nuevo. Tu panel y tus pedidos funcionan igual que siempre.</p>
      <ul class="go-bsheet-list">
        ${row('store', 'Tu tienda luce mejor', 'Tus productos y tu marca se ven más prolijos para tus clientes.')}
        ${row('clipboard', 'Mismo panel', 'Pedidos, productos y horarios, donde siempre.')}
        ${row('chat', '¿Algo raro?', 'Escribinos desde Soporte y lo resolvemos.')}
      </ul>`,
  },
  delivery: {
    eyebrow: 'Novedades para repartidores',
    title: 'GO! estrena imagen',
    body: `
      <p>Renovamos la app. Tu forma de trabajar no cambia: los pedidos se toman y entregan igual.</p>
      <ul class="go-bsheet-list">
        ${row('menu', 'Todo en el menú ☰', 'Ganancias, historial, ayuda y modo cliente.')}
        ${row('shoppingBag', 'Modo cliente sin desconectarte', 'Pedí algo y seguís en línea; volvés con Delivery.')}
        ${row('bell', 'Ofertas donde estés', 'Te llegan aunque estés en otra pantalla de la app.')}
      </ul>`,
  },
  admin: {
    eyebrow: 'Novedades',
    title: 'GO! estrena imagen',
    body: `
      <p>La app tiene la nueva identidad GO! en todas las pantallas: clientes, comercios, repartidores y administración.</p>
      <ul class="go-bsheet-list">
        ${row('shieldCheck', 'Misma lógica', 'Pedidos, pagos y reglas no cambian.')}
        ${row('headset', 'Revisá lo nuevo', 'Si ves algo raro, avisá y lo ajustamos.')}
      </ul>`,
  },
};

function roleOf() {
  if (isAdmin()) return 'admin';
  if (isComercio()) return 'comercio';
  if (isDelivery()) return 'delivery';
  return 'client';
}

function createdAtMs(user) {
  const c = user.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c.seconds === 'number') return c.seconds * 1000;
  const t = new Date(c).getTime();
  return isNaN(t) ? 0 : t;
}

async function markSeen(user) {
  try { localStorage.setItem(LOCAL_KEY, user.uid); } catch (e) {}
  try {
    const { doc, updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'users', user.uid), { [FLAG]: true });
  } catch (e) {
    console.warn('[WhatsNew] Could not save the flag on the account:', e);
  }
}

let scheduled = false;

function tryShow(attempt = 0) {
  const user = getState().user;
  if (!user?.uid) return;
  if (user[FLAG] === true) return;
  try { if (localStorage.getItem(LOCAL_KEY) === user.uid) return; } catch (e) {}

  const created = createdAtMs(user);
  if (created && created >= LAUNCH) { markSeen(user); return; } // new since the launch

  // Wait for the splash, the welcome and any other sheet (up to ~40 s).
  if (isAnySheetOpen()) {
    if (attempt < 20) setTimeout(() => tryShow(attempt + 1), 2000);
    return;
  }

  const msg = MESSAGES[roleOf()];
  showGoSheet({
    id: 'go-whats-new-sheet',
    art: '<img src="/logo-brand.jpg?v=2" alt="" />',
    eyebrow: msg.eyebrow,
    title: msg.title,
    bodyHtml: msg.body,
    primary: { label: 'Buenísimo' },
    onClose: () => markSeen(user),
  });
}

/** Call once at startup: shows the news as soon as a signed-in user is known. */
export function initWhatsNew() {
  if (scheduled) return;
  const start = () => {
    if (scheduled || !getState().user?.uid) return;
    scheduled = true;
    setTimeout(() => tryShow(), 1500);
  };
  start();
  if (!scheduled) {
    const unsub = subscribe('user', () => {
      start();
      if (scheduled) unsub?.();
    });
  }
}
