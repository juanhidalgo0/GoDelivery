// Seguimiento en vivo de un pedido de WhatsApp: /en-vivo/{token} (el bot manda el link;
// servidor: functions/whatsapp/tracking.js).
//
// La página es solo la pantalla de seguimiento de la app, sin router, encabezado ni barra: no hay
// a dónde navegar. El token del link se cambia por una sesión del cliente de WhatsApp (su usuario
// users/{número}) que vive en memoria, solo en esta pestaña (firebase.js, isWaTrackingPage). Con
// esa sesión el mapa en vivo, el chat con el cadete, cancelar y calificar funcionan como en la app.
import { auth, db } from './firebase.js';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { setState, initTheme } from './state.js';
import { functionUrl } from './utils/functions-url.js';
import { initErrorReporter } from './utils/error-reporter.js';

initErrorReporter();
initTheme();

const content = document.getElementById('app-content');

function tokenFromUrl() {
  const m = window.location.pathname.match(/^\/en-vivo\/([A-Za-z0-9_-]+)/);
  return (m && m[1]) || new URLSearchParams(window.location.search).get('t') || '';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showMessage(title, text, { retry = false } = {}) {
  content.innerHTML = `
    <div class="ev-msg">
      <div class="ev-logo">GO!</div>
      <h1>${esc(title)}</h1>
      <p>${text}</p>
      ${retry ? '<button class="ev-btn" id="ev-retry">Probar de nuevo</button>' : ''}
    </div>`;
  document.getElementById('ev-retry')?.addEventListener('click', () => window.location.reload());
}

const BACK_TO_WA = 'Volvé a la charla de WhatsApp con GO! y escribí <b>menú</b> → <b>Mis pedidos</b>.';

async function start() {
  const token = tokenFromUrl();
  if (!token) return showMessage('Link incompleto', `Parece que el link se cortó al copiarlo. ${BACK_TO_WA}`);

  let data;
  try {
    const res = await fetch(functionUrl('waTrackingSession'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    data = await res.json().catch(() => ({}));
    if (res.status === 404) return showMessage('No encontramos este pedido', `Puede que el link esté incompleto. ${BACK_TO_WA}`);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  } catch (err) {
    console.error('[en-vivo] No se pudo abrir la sesión:', err);
    return showMessage('No pudimos abrir tu pedido', 'Revisá tu conexión y probá de nuevo.', { retry: true });
  }

  if (data.mode === 'ended') {
    const what = data.status === 'cancelled' ? 'fue cancelado' : 'ya fue entregado';
    return showMessage(`Pedido${data.orderNum ? ` #${esc(data.orderNum)}` : ''} terminado`, `Este pedido ${what}. Para pedir otra cosa, escribí <b>menú</b> en la charla de WhatsApp con GO!.`);
  }

  // El número tiene cuenta en la app: el pedido se abre en la app, con su propio login
  if (data.mode === 'app') {
    window.location.replace(`/#/pedido/${encodeURIComponent(data.orderId)}`);
    return;
  }

  try {
    const cred = await signInWithCustomToken(auth, data.customToken);
    const profile = await getDoc(doc(db, 'users', cred.user.uid)).catch(() => null);
    setState('user', {
      uid: cred.user.uid,
      displayName: data.userName || 'Cliente',
      role: 'user',
      ...(profile && profile.exists() ? profile.data() : {}),
      isWhatsAppClient: true,
    });
  } catch (err) {
    console.error('[en-vivo] No se pudo iniciar la sesión del cliente:', err);
    return showMessage('No pudimos abrir tu pedido', 'Probá de nuevo en un ratito.', { retry: true });
  }

  const { renderOrderTracking } = await import('./pages/order-tracking.js');
  renderOrderTracking(data.orderId, content, false, false, false, { waClient: true });
}

start();
