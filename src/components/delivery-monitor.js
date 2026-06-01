import { db } from '../firebase.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { isDelivery } from '../auth.js';
import { setBanner, clearBanner } from './banner-manager.js';
import { AudioManager } from '../utils/audio-manager.js';
import { FABStack } from '../utils/fab-stack.js';
import { takeOrder, markAsDelivered } from '../pages/delivery-panel.js';
import { showDeliveryMapModal } from './delivery-map-modal.js';

let availableUnsub = null;
let activeUnsub = null;
let lastKnownConfirmedIds = new Set();
let currentAvailableOrders = [];
let currentActiveOrder = null;

let isMonitorInitialized = false;

export function initDeliveryMonitor() {
  if (isMonitorInitialized) return;
  isMonitorInitialized = true;

  let lastUserUid = null;
  let lastUserRole = null;

  const checkAndStart = (user) => {
    if (!user) {
      stopMonitoring();
      lastUserUid = null;
      lastUserRole = null;
      return;
    }

    const currentRole = user.role || (user.isDelivery ? 'delivery' : 'user');
    const onlineStatus = user.isOnline || false;

    // Only restart if the user changed, their role changed, or their online status changed
    if (user.uid !== lastUserUid || currentRole !== lastUserRole || onlineStatus !== lastOnlineStatus) {
      console.log('DeliveryMonitor: State changed, checking monitoring...');
      if (isDelivery() && onlineStatus) {
        console.log('DeliveryMonitor: User is delivery and online, starting listeners');
        startMonitoring(user);
      } else {
        console.log('DeliveryMonitor: User is NOT delivery or offline, stopping listeners');
        stopMonitoring();
      }
      lastUserUid = user.uid;
      lastUserRole = currentRole;
      lastOnlineStatus = onlineStatus;
    }
  };

  let lastOnlineStatus = false;
  // Initial check
  checkAndStart(getState().user);

  subscribe('user', (newUser) => {
    checkAndStart(newUser);
  });

  // Global listeners for delivery actions (Map Modal calls these)
  window.addEventListener('take-order-delivery', async (e) => {
    const { showConfirm } = await import('./modal.js');
    showConfirm({
      title: '¿Tomar este pedido?',
      message: 'Te asignarás como repartidor y deberás retirarlo lo antes posible.',
      confirmText: 'Sí, tomar pedido',
      onConfirm: () => {
        takeOrder(e.detail.orderId, getState().user);
      }
    });
  });

  window.addEventListener('confirm-order-delivery', async (e) => {
    markAsDelivered(e.detail.orderId);
  });
}

function startMonitoring(user) {
  if (!user) return;
  stopMonitoring();

  // 1. Listen for Available Orders
  const qAvailable = query(
    collection(db, 'orders'),
    where('status', 'in', ['ready', 'pending', 'confirmed'])
  );

  availableUnsub = onSnapshot(qAvailable, (snap) => {
    console.log(`DeliveryMonitor: Received update for available orders. Count: ${snap.docs.length}`);
    const orders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => !o.driverId)
      .filter(o => {
        if (o.isFavor) return true;
        if (o.status === 'ready') return true;
        if (['pending', 'confirmed'].includes(o.status) && o.isMultiOrder) return true;
        return false;
      });

    console.log(`DeliveryMonitor: Filtered available orders: ${orders.length}`);
    currentAvailableOrders = orders;

    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const order = { id: change.doc.id, ...change.doc.data() };
        if (!order.driverId && !lastKnownConfirmedIds.has(order.id)) {
          lastKnownConfirmedIds.add(order.id);
          const qualifies = order.isFavor || order.status === 'ready' || (['pending', 'confirmed'].includes(order.status) && order.isMultiOrder);
          if (qualifies && currentActiveCount === 0) {
            notifyNewOrder(order);
          }
        }
      }
    });

    const currentIds = new Set(orders.map(d => d.id));
    lastKnownConfirmedIds = currentIds;
    updateBannerState();
  });

  // 2. Listen for My Active Order
  const qActive = query(
    collection(db, 'orders'),
    where('driverId', '==', user.uid)
  );

  activeUnsub = onSnapshot(qActive, (snap) => {
    const active = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(o => !['completed', 'cancelled'].includes(o.status));

    currentActiveOrder = active.length > 0 ? active[0] : null;
    currentActiveCount = active.length;
    updateBannerState();
  });
}

let currentActiveCount = 0;

function stopMonitoring() {
  if (availableUnsub) availableUnsub();
  if (activeUnsub) activeUnsub();
  availableUnsub = null;
  activeUnsub = null;
  currentAvailableOrders = [];
  currentActiveOrder = null;
  clearBanner('delivery');
  clearDeliveryIndicator();
}

function notifyNewOrder(order) {
  if (currentActiveCount > 0) {
    console.log('[DeliveryMonitor] Suppressing notifyNewOrder because driver has active orders:', currentActiveCount);
    return;
  }

  // Use professional local sound
  AudioManager.playSound('/assets/sounds/notification.mp3');

  // Vibration for mobile (professional app feel)
  AudioManager.vibrate([300, 100, 300, 100, 400]);

  // Use swRegistration.showNotification for mobile compatibility
  if ('serviceWorker' in navigator && Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(reg => {
      let body = `¡Nuevo pedido! ${order.comercioName} tiene un pedido listo para retirar.`;
      if (order.isFavor) {
        const favorTypeLabel = order.favorType === 'compra' ? 'COMPRA' : 'MANDADO';
        body = `🛵 ¡Nuevo GoFavor disponible! Hay un nuevo GoFavor (${favorTypeLabel}) listo para tomar.`;
      }

      reg.showNotification('Go Delivery', {
        body: body,
        icon: '/logo-pwa.png',
        badge: '/logo-pwa.png',
        tag: `order-${order.id}`,
        renotify: true,
        data: { url: '#/delivery' },
        vibrate: [300, 100, 300, 100, 400]
      });
    });
  }
}

function updateBannerState() {
  // Group orders by bundleId to count batches, not individual orders
  const batches = new Set();
  currentAvailableOrders.forEach(o => {
    batches.add(o.bundleId || o.id);
  });
  const availableCount = batches.size;

  if (currentActiveOrder) {
    updateActiveDeliveryFAB(currentActiveOrder, currentActiveCount);
  } else if (availableCount > 0) {
    updateDeliveryFAB(availableCount);
  } else {
    clearDeliveryIndicator();
  }
}

function updateActiveDeliveryFAB(order, count) {
  let fab = document.getElementById('global-active-delivery-fab');
  // Clear available fab if exists
  const avFab = document.getElementById('global-delivery-available-fab');
  if (avFab) avFab.remove();

  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'global-active-delivery-fab';
    fab.style.cssText = `
      position: fixed; right: 20px;
      padding: 10px 24px; border-radius: 24px;
      display: flex; align-items: center; gap: 14px;
      color: white; cursor: pointer; z-index: 1460;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.3);
      transition: all 0.6s cubic-bezier(0.23, 1, 0.32, 1);
      transform: scale(0) translateY(40px); opacity: 0;
      border: 1px solid rgba(255,255,255,0.25); 
      font-family: var(--font-display);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.9) 0%, rgba(109, 40, 217, 0.9) 100%);
      animation: fab-pulse 2s infinite;
    `;

    if (!document.getElementById('fab-pulse-styles')) {
      const s = document.createElement('style');
      s.id = 'fab-pulse-styles';
      s.textContent = `
        @keyframes fab-pulse {
          0% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.7); }
          70% { box-shadow: 0 0 0 15px rgba(124, 58, 237, 0); }
          100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0); }
        }
      `;
      document.head.appendChild(s);
    }

    fab.onclick = () => {
      sessionStorage.setItem('deliveryTab', 'active');
      window.location.hash = '#/delivery';
    };
    document.body.appendChild(fab);

    requestAnimationFrame(() => {
      fab.style.transform = 'scale(1) translateY(0)';
      fab.style.opacity = '1';
      FABStack.reposition();
    });
  }

  const statusText = order.status === 'delivering' ? 'En entrega' : 'Retirar pedido';
  const label = count > 1 ? `${count} Pedidos activos` : statusText;

  fab.innerHTML = `
    <span style="display:flex;">${icon('bike', 22)}</span>
    <span>${label.toUpperCase()}</span>
    <div class="fab-toggle-dot"></div>
  `;

  fab.onclick = () => {
    sessionStorage.setItem('deliveryTab', 'active');
    if (window.location.hash === '#/delivery') {
      window.dispatchEvent(new CustomEvent('switch-delivery-tab', { detail: 'active' }));
    } else {
      window.location.hash = '#/delivery';
    }
  };
  FABStack.reposition();
}

function updateDeliveryFAB(count) {
  let fab = document.getElementById('global-delivery-available-fab');

  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'global-delivery-available-fab';
    fab.style.cssText = `
      position: fixed; right: 20px;
      padding: 10px 24px; border-radius: 24px;
      display: flex; align-items: center; gap: 14px;
      color: white; cursor: pointer; z-index: 1460;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.2);
      transition: all 0.6s cubic-bezier(0.23, 1, 0.32, 1);
      transform: scale(0) translateY(40px); opacity: 0;
      border: 1px solid rgba(255,255,255,0.2); 
      font-family: var(--font-display);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.9) 0%, rgba(5, 150, 105, 0.9) 100%);
    `;
    document.body.appendChild(fab);

    if (!document.getElementById('delivery-fab-styles')) {
      const s = document.createElement('style');
      s.id = 'delivery-fab-styles';
      s.textContent = `
        @keyframes delivery-pulse {
          0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(99, 102, 241, 0); }
          100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
        }
        .delivery-fab-active { animation: delivery-pulse 2s infinite; }
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
  fab.className = 'delivery-fab-active';
  fab.innerHTML = `
    ${icon('bike', 20)}
    <span>${count} Pedido${count > 1 ? 's' : ''} Disponible${count > 1 ? 's' : ''}</span>
    <div class="fab-toggle-dot"></div>
  `;

  fab.onclick = () => {
    sessionStorage.setItem('deliveryTab', 'available');
    if (window.location.hash === '#/delivery') {
      window.dispatchEvent(new CustomEvent('switch-delivery-tab', { detail: 'available' }));
    } else {
      window.location.hash = '#/delivery';
    }
  };
}

function clearDeliveryIndicator() {
  ['global-delivery-available-fab', 'global-active-delivery-fab'].forEach(id => {
    const fab = document.getElementById(id);
    if (fab) {
      fab.style.transform = 'scale(0) translateY(20px)';
      fab.style.opacity = '0';
      setTimeout(() => {
        if (fab.parentNode) fab.remove();
        FABStack.reposition();
      }, 500);
    }
  });
}
