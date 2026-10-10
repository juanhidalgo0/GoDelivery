import { db } from '../firebase.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { isAdmin, isSuperAdmin } from '../auth.js';
import { setBanner, clearBanner, activeBanners } from './banner-manager.js';
import { showToast } from './toast.js';
import { sendLocalNotification } from '../utils/notifications.js';
import { AudioManager } from '../utils/audio-manager.js';
import { watchWaQuotes, stopWaQuotes } from './wa-quotes.js';

let commerceUnsub = null;
let comerciosListUnsub = null;
let lastKnownPendingIds = new Set();
let currentPendingOrders = [];
let myComercioIds = [];
// Consultas por WhatsApp esperando respuesta: también hacen sonar la alarma
let waQuoteCount = 0;
const comercioNames = {};

// Sound URL - Ultra-Loud Attention Alert (Rhythmic & High Frequency)
// Archivo propio: suena aunque el CDN externo esté caído o la señal sea mala
const SOUND_URL = '/sounds/pedido-nuevo.wav';

let isMonitorInitialized = false;
let isMutedGlobally = false;

export function initCommerceMonitor() {
  if (isMonitorInitialized) return;
  isMonitorInitialized = true;

  // Con el primer clic/tecla la alarma queda habilitada (en PC el navegador la bloquea hasta entonces)
  AudioManager.primeLoop(SOUND_URL);

  const user = getState().user;
  
  if (user) startCommerceListListener(user);

  // El perfil se vuelve a publicar seguido (rol, saldo, etc.): sólo se rearma si cambia
  // quién es o qué rol tiene, para no cortar la alarma a cada rato
  let watchKey = user ? watchKeyOf(user) : '';
  subscribe('user', (newUser) => {
    const key = newUser ? watchKeyOf(newUser) : '';
    if (key === watchKey) return;
    watchKey = key;
    if (newUser) startCommerceListListener(newUser);
    else stopAllMonitoring();
  });

  // El aviso flotante dice si el navegador tiene el sonido bloqueado (PC sin un clic todavía)
  window.addEventListener('go-audio-blocked', () => renderOrderAlert());
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => setTimeout(renderOrderAlert, 0), { once: true, capture: true }));

  // Register global alarm mute listener exactly once
  window.addEventListener('mute-commerce-alarm', () => {
    isMutedGlobally = true;
    AudioManager.stopLoop(SOUND_URL);
    updateMutePill(false);
  });
}

function unlockAudio() {
  // AudioManager handles this now
}

const watchKeyOf = (u) => `${u.uid}|${u.role || ''}|${u.isComercio ? 1 : 0}|${u.comercioId || ''}|${isAdmin() ? 1 : 0}`;

function startCommerceListListener(user) {
  if (comerciosListUnsub) comerciosListUnsub();
  comerciosListUnsub = null;
  const admin = isAdmin() || isSuperAdmin();

  // El admin atiende GoMarket (lo busca entre todos); el resto escucha los comercios de los
  // que es dueño. No se mira el rol: hay dueños a los que nunca se les dio y igual reciben
  // pedidos, y la consulta vacía de un cliente común no cuesta nada.
  const q = admin
    ? query(collection(db, 'comercios'))
    : query(collection(db, 'comercios'), where('ownerId', '==', user.uid));

  comerciosListUnsub = onSnapshot(q, (snap) => {
    let ids;
    if (admin) {
      // Admin acts as GoMarket owner
      const goMarket = snap.docs.find(d => {
        const n = (d.data().name || '').toLowerCase();
        return n.includes('go!') && n.includes('market');
      });
      ids = goMarket ? [goMarket.id] : [];
    } else {
      ids = snap.docs.map(d => d.id);
      // Comercio viejo sin ownerId: el usuario lo tiene anotado en su perfil
      if (!ids.length && user.comercioId) ids.push(user.comercioId);
      // Con varios comercios el aviso dice de cuál es el pedido
      snap.docs.forEach(d => { comercioNames[d.id] = d.data().name || ''; });
    }
    ids = ids.slice(0, 30); // tope del filtro 'in'

    // Cualquier cambio en el doc del comercio (pausa, rating…) dispara esto: si la lista
    // es la misma, la escucha de pedidos sigue como está y la alarma no se corta
    const same = ids.length === myComercioIds.length && ids.every((id, i) => id === myComercioIds[i]);
    if (same && (commerceUnsub || !ids.length)) return;
    myComercioIds = ids;

    if (myComercioIds.length > 0) {
      startOrdersListener();
    } else {
      stopOrdersListener();
    }
  }, (err) => console.warn('[Commerce Monitor] comercios:', err?.code || err));
}

let recurring5MinInterval = null;

function startOrdersListener() {
  stopOrdersListener();
  if (myComercioIds.length === 0) return;

  watchWaQuotes(myComercioIds, (n) => {
    if (n > waQuoteCount) isMutedGlobally = false;
    waQuoteCount = n;
    syncAlarm();
  });

  const q = query(
    collection(db, 'orders'),
    where('comercioId', 'in', myComercioIds),
    where('status', '==', 'pending')
  );
  commerceUnsub = onSnapshot(q, (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    currentPendingOrders = orders;
    
    let hasNew = false;
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const id = change.doc.id;
        if (!lastKnownPendingIds.has(id)) {
          hasNew = true;
          lastKnownPendingIds.add(id);
        }
      }
    });

    if (hasNew) {
      isMutedGlobally = false; // Reset mute when new order arrives!
    }

    syncAlarm();
    if (hasNew && orders.length > 0 && !isMutedGlobally) {
      AudioManager.hapticError(); // Play a strong tactile alarm warning
    }

    if (hasNew && lastKnownPendingIds.size > 0) {
      const count = orders.length;
      sendLocalNotification(
        `¡Nuevo${count > 1 ? 's' : ''} Pedido${count > 1 ? 's' : ''}!`, 
        `Tenés ${count} pedido${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''}.`,
        { type: 'order', silent: true, url: `#/mi-comercio/${currentPendingOrders[0]?.comercioId || myComercioIds[0]}/orders` }
      );
    }

    // Handle 5-Minute Recurring Reminder Timer for Commerce
    if (orders.length > 0) {
      if (!recurring5MinInterval) {
        recurring5MinInterval = setInterval(async () => {
          if (currentPendingOrders.length > 0) {
            console.log(`⏰ [Commerce Monitor] 5-minute reminder: ${currentPendingOrders.length} pending order(s)`);
            isMutedGlobally = false;
            AudioManager.startLoop(SOUND_URL, 0.95);
            AudioManager.hapticError();

            const count = currentPendingOrders.length;
            sendLocalNotification(
              `⚠️ ¡RECORDATORIO DE PEDIDO!`, 
              `Tenés ${count} pedido${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''} sin aceptar o rechazar.`,
              { type: 'order', silent: true, url: `#/mi-comercio/${currentPendingOrders[0]?.comercioId || myComercioIds[0]}/orders` }
            );

            // Insert notification in Firestore for record
            try {
              const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
              const user = getState().user;
              if (user?.uid) {
                await addDoc(collection(db, 'notifications'), {
                  userId: user.uid,
                  title: '⚠️ ¡RECORDATORIO DE PEDIDO PENDIENTE!',
                  body: `Tenés ${count} pedido(s) sin aceptar o rechazar. Por favor confirmá o cancelá para continuar.`,
                  type: 'pending_reminder',
                  read: false,
                  createdAt: serverTimestamp()
                });
              }
            } catch (err) {}
          }
        }, 5 * 60 * 1000); // Every 5 minutes
      }
    } else {
      if (recurring5MinInterval) {
        clearInterval(recurring5MinInterval);
        recurring5MinInterval = null;
      }
    }

    const currentIds = new Set(orders.map(o => o.id));
    lastKnownPendingIds = new Set([...lastKnownPendingIds].filter(id => currentIds.has(id)));

    updateBannerState();
    updateMutePill((orders.length + waQuoteCount) > 0 && !isMutedGlobally);
  }, (err) => console.warn('[Commerce Monitor] pedidos:', err?.code || err));
}

function syncAlarm() {
  const ringing = (currentPendingOrders.length + waQuoteCount) > 0 && !isMutedGlobally;
  if (ringing) AudioManager.startLoop(SOUND_URL, 0.95);
  else AudioManager.stopLoop(SOUND_URL);
  updateMutePill(ringing);
}

function stopOrdersListener() {
  if (commerceUnsub) commerceUnsub();
  commerceUnsub = null;
  stopWaQuotes();
  waQuoteCount = 0;
  if (recurring5MinInterval) {
    clearInterval(recurring5MinInterval);
    recurring5MinInterval = null;
  }
  AudioManager.stopLoop(SOUND_URL);
  updateMutePill(false);
}

function stopAllMonitoring() {
  stopOrdersListener();
  if (comerciosListUnsub) comerciosListUnsub();
  comerciosListUnsub = null;
  currentPendingOrders = [];
  clearBanner('commerce');
  AudioManager.stopLoop(SOUND_URL);
  updateMutePill(false);
}

function playAlertSound() {
  // Deprecated: Loop takes care of alerts dynamically
}

function updateBannerState() {
  const count = currentPendingOrders.length;
  const firstComercioId = count > 0 ? currentPendingOrders[0].comercioId : null;

  import('../state.js').then(m => m.setState('commercePendingCount', count));

  if (count === 0) {
    clearBanner('commerce');
    clearCommerceIndicator();
    return;
  }

  // Show persistent floating indicator for Commerce
  updateCommerceFAB(count, firstComercioId);
}

function updateCommerceFAB(count, comercioId) {
  alertState.count = count;
  alertState.comercioId = comercioId;
  renderOrderAlert();
}

function navigateToCommerceOrders(comercioId) {
  if (!comercioId) return;
  const targetHash = `#/mi-comercio/${comercioId}/orders`;
  if (window.location.hash === targetHash) {
    window.dispatchEvent(new CustomEvent('switch-order-tab', { detail: 'pending' }));
  } else {
    window.location.hash = targetHash;
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('switch-order-tab', { detail: 'pending' }));
    }, 150);
  }
  clearBanner('commerce');
}

function clearCommerceIndicator() {
  alertState.count = 0;
  renderOrderAlert();
}

function updateMutePill(show) {
  // El panel del comercio muestra su propio aviso de "Silenciar" debajo del encabezado
  window.__commerceAlarmRinging = !!show;
  window.dispatchEvent(new CustomEvent('commerce-alarm', { detail: { ringing: !!show } }));
  alertState.ringing = !!show;
  renderOrderAlert();
}

// ── Aviso de pedidos sin aceptar (fuera del panel) ──
// Una sola pastilla GO!: contador, qué pasa, silenciar (sólo mientras suena) e ir a verlos.
const alertState = { count: 0, comercioId: null, ringing: false };

function renderOrderAlert() {
  let el = document.getElementById('go-order-alert');
  if (!alertState.count) {
    if (el) {
      el.classList.remove('is-in');
      setTimeout(() => { if (!alertState.count) el.remove(); }, 300);
    }
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'go-order-alert';
    el.className = 'go-order-alert';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <button type="button" class="go-order-alert-main" data-alert="open">
        <span class="go-order-alert-count"></span>
        <span class="go-order-alert-text"><b></b><small>Tocá para verlos</small></span>
      </button>
      <button type="button" class="go-order-alert-mute" data-alert="mute" aria-label="Silenciar alarma">${icon('volumeOff', 18)}</button>
      <button type="button" class="go-order-alert-go" data-alert="open" aria-label="Ver pedidos">${icon('chevronRight', 18)}</button>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-alert]');
      if (!b) return;
      if (b.dataset.alert === 'mute') {
        AudioManager.hapticLight();
        window.dispatchEvent(new Event('mute-commerce-alarm'));
        return;
      }
      navigateToCommerceOrders(alertState.comercioId);
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  }
  const n = alertState.count;
  el.classList.toggle('is-ringing', alertState.ringing);
  el.querySelector('.go-order-alert-count').textContent = n > 99 ? '99+' : String(n);
  el.querySelector('.go-order-alert-text b').textContent = `${n} pedido${n === 1 ? '' : 's'} sin aceptar`;
  // Dueño de varios comercios: dónde están esperando
  const stores = [...new Set(currentPendingOrders.map(o => comercioNames[o.comercioId]).filter(Boolean))];
  el.querySelector('.go-order-alert-text small').textContent = AudioManager.isAudioBlocked()
    ? 'Sonido apagado · hacé clic para activarlo'
    : myComercioIds.length > 1 && stores.length ? `En ${stores.join(' y ')} · tocá para verlos` : 'Tocá para verlos';
  el.querySelector('.go-order-alert-mute').hidden = !alertState.ringing;
  // Si hay otros avisos flotantes a la izquierda (pedido en curso, cadete), va por encima
  const others = ['global-order-fab', 'global-active-delivery-fab', 'global-delivery-available-fab']
    .filter(id => { const f = document.getElementById(id); return f && f.style.opacity !== '0'; }).length;
  el.style.setProperty('--go-order-alert-lift', `${others * 68}px`);
}
