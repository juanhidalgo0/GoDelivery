import { db } from '../firebase.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { isComercio, isAdmin, isSuperAdmin } from '../auth.js';
import { setBanner, clearBanner, activeBanners } from './banner-manager.js';
import { showToast } from './toast.js';
import { sendLocalNotification } from '../utils/notifications.js';
import { AudioManager } from '../utils/audio-manager.js';
import { FABStack } from '../utils/fab-stack.js';

let commerceUnsub = null;
let comerciosListUnsub = null;
let lastKnownPendingIds = new Set();
let currentPendingOrders = [];
let myComercioIds = [];

// Sound URL - Ultra-Loud Attention Alert (Rhythmic & High Frequency)
const SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3';

let isMonitorInitialized = false;
let isMutedGlobally = false;

export function initCommerceMonitor() {
  if (isMonitorInitialized) return;
  isMonitorInitialized = true;

  const user = getState().user;
  
  if (user && (isComercio() || isAdmin() || isSuperAdmin())) {
    startCommerceListListener(user);
  }

  subscribe('user', (newUser) => {
    if (newUser && (isComercio() || isAdmin() || isSuperAdmin())) {
      startCommerceListListener(newUser);
    } else {
      stopAllMonitoring();
    }
  });

  // Register global alarm mute listener exactly once
  window.addEventListener('mute-commerce-alarm', () => {
    isMutedGlobally = true;
    AudioManager.stopLoop(SOUND_URL);
    console.log('🔇 Commerce pending order alarm muted globally.');
  });
}

function unlockAudio() {
  // AudioManager handles this now
}

function startCommerceListListener(user) {
  if (comerciosListUnsub) comerciosListUnsub();
  
  const q = query(collection(db, 'comercios'));
  
  comerciosListUnsub = onSnapshot(q, (snap) => {
    if (isAdmin() || isSuperAdmin()) {
      // Admin acts as GoMarket owner
      const goMarket = snap.docs.find(d => {
        const n = (d.data().name || '').toLowerCase();
        return n.includes('go!') && n.includes('market');
      });
      myComercioIds = goMarket ? [goMarket.id] : [];
    } else {
      // Normal commerce acts as owner of their commerces
      myComercioIds = snap.docs.filter(d => d.data().ownerId === user.uid).map(d => d.id);
    }

    if (myComercioIds.length > 0) {
      startOrdersListener();
    } else {
      stopOrdersListener();
    }
  });
}

function startOrdersListener() {
  stopOrdersListener();
  if (myComercioIds.length === 0) return;

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

    if (orders.length > 0 && !isMutedGlobally) {
      AudioManager.startLoop(SOUND_URL, 0.95);
      if (hasNew) {
        AudioManager.hapticError(); // Play a strong tactile alarm warning
      }
    } else {
      AudioManager.stopLoop(SOUND_URL);
    }

    if (hasNew && lastKnownPendingIds.size > 0) {
      const count = orders.length;
      sendLocalNotification(
        `¡Nuevo${count > 1 ? 's' : ''} Pedido${count > 1 ? 's' : ''}!`, 
        `Tenés ${count} pedido${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''}.`,
        { type: 'order', url: `#/mi-comercio/${myComercioIds[0]}/orders` }
      );
    }

    const currentIds = new Set(orders.map(o => o.id));
    lastKnownPendingIds = new Set([...lastKnownPendingIds].filter(id => currentIds.has(id)));

    updateBannerState();
  });
}

function stopOrdersListener() {
  if (commerceUnsub) commerceUnsub();
  commerceUnsub = null;
  AudioManager.stopLoop(SOUND_URL);
}

function stopAllMonitoring() {
  stopOrdersListener();
  if (comerciosListUnsub) comerciosListUnsub();
  comerciosListUnsub = null;
  currentPendingOrders = [];
  clearBanner('commerce');
  AudioManager.stopLoop(SOUND_URL);
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
  let fab = document.getElementById('global-commerce-pending-fab');

  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'global-commerce-pending-fab';
    fab.style.cssText = `
      position: fixed; right: 20px;
      padding: 12px 20px; border-radius: 30px;
      display: flex; align-items: center; gap: 10px;
      color: white; cursor: pointer; z-index: 1450;
      box-shadow: 0 8px 32px rgba(227, 27, 35, 0.4);
      transition: all 0.5s cubic-bezier(0.17, 0.89, 0.32, 1.27);
      transform: scale(0) translateY(20px); opacity: 0;
      border: 2px solid white; font-family: var(--font-display);
      font-weight: 800; font-size: 13px;
      background: linear-gradient(135deg, #FF4757 0%, #E31B23 100%);
    `;
    document.body.appendChild(fab);
    
    if (!document.getElementById('commerce-fab-styles')) {
      const s = document.createElement('style');
      s.id = 'commerce-fab-styles';
      s.textContent = `
        @keyframes commerce-pulse {
          0% { box-shadow: 0 0 0 0 rgba(227, 27, 35, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(227, 27, 35, 0); }
          100% { box-shadow: 0 0 0 0 rgba(227, 27, 35, 0); }
        }
        .commerce-fab-pulse { animation: commerce-pulse 1.5s infinite; }
      `;
      document.head.appendChild(s);
    }

    requestAnimationFrame(() => {
      fab.style.transform = 'scale(1) translateY(0)';
      fab.style.opacity = '1';
      FABStack.reposition();
    });
  }

  FABStack.reposition();
  fab.className = 'commerce-fab-pulse';
  fab.innerHTML = `
    ${icon('bell', 20)}
    <span>${count} Pedido${count > 1 ? 's' : ''} Pendiente${count > 1 ? 's' : ''}</span>
    <div class="fab-toggle-dot"></div>
  `;

  fab.onclick = () => navigateToCommerceOrders(comercioId);
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
  const fab = document.getElementById('global-commerce-pending-fab');
  if (fab) {
    fab.style.transform = 'scale(0) translateY(20px)';
    fab.style.opacity = '0';
    setTimeout(() => {
      fab.remove();
      FABStack.reposition();
    }, 500);
  }
}
