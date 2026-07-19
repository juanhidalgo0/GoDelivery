import { collection, query, where, getDocs, doc, updateDoc, onSnapshot as firebaseOnSnapshot, runTransaction, serverTimestamp, writeBatch, increment, addDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { getState, setState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { db } from '../firebase.js';
import { App } from '@capacitor/app';

import { isDelivery } from '../auth.js';

export function getOrderDriverEarnings(o) {
  if (o.isTrip || o.isFavor) {
    return (o.deliveryCost || 0) + (o.purchaseFee || 0) + (o.extraStopsFee || 0) + (o.tip || o.tipAmount || 0);
  }
  return (o.deliveryCost || 0) + (o.tip || o.tipAmount || 0);
}
import { showDeliveryMapModal } from '../components/delivery-map-modal.js';
import { showConfirm, showModal, closeModal } from '../components/modal.js';

// --- LIFECYCLE AWARE ONSNAPSHOT WRAPPER FOR BATTERY & DATA OPTIMIZATION ---
let isAppActive = true;
let activeListeners = [];

function onSnapshot(q, callback, errCallback) {
  let unsub = null;
  const listener = {
    q,
    callback,
    errCallback,
    start: () => {
      if (unsub) return;
      try {
        unsub = firebaseOnSnapshot(q, callback, errCallback);
      } catch (err) {
        console.error('Error starting snapshot listener:', err);
      }
    },
    stop: () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
    }
  };

  activeListeners.push(listener);
  if (isAppActive) {
    listener.start();
  }

  return () => {
    listener.stop();
    activeListeners = activeListeners.filter(l => l !== listener);
  };
}

// Track application background/foreground state changes
try {
  App.addListener('appStateChange', (state) => {
    console.log('Delivery Panel Lifecycle: App state changed. isActive =', state.isActive);
    isAppActive = state.isActive;
    if (isAppActive) {
      console.log(`Delivery Panel Lifecycle: Resuming ${activeListeners.length} active Firestore listeners...`);
      activeListeners.forEach(l => l.start());
    } else {
      console.log(`Delivery Panel Lifecycle: Pausing ${activeListeners.length} active Firestore listeners to save battery & data...`);
      activeListeners.forEach(l => l.stop());
    }
  });
} catch (e) {
  console.warn('Capacitor App state tracking not available in this environment:', e);
}

function getFavorTypeMeta(favorType) {
  switch (favorType) {
    case 'gocash':
      return {
        title: 'Go Cash',
        label: 'GO CASH',
        headerText: 'Detalles del Cambio (Go Cash)',
        color: '#6366f1',
        textColor: '#6366f1'
      };
    case 'mandado': // In DB, Encomiendas are favorType: 'mandado'
      return {
        title: 'GoFavor: Encomienda',
        label: 'ENCOMIENDA',
        headerText: 'Detalles de la Encomienda',
        color: '#10b981',
        textColor: '#10b981'
      };
    case 'pagodeservicios':
      return {
        title: 'GoFavor: PAGO DE SERVICIO',
        label: 'PAGO DE SERVICIOS',
        headerText: 'Detalles de Pago de Servicios',
        color: '#d97706',
        textColor: '#d97706'
      };
    case 'compra': // In DB, Mandados/Compras are favorType: 'compra'
    default:
      return {
        title: 'GoFavor: Mandado',
        label: 'MANDADO',
        headerText: 'Detalles del Mandado',
        color: '#ef4444',
        textColor: '#ef4444'
      };
  }
}

function getRgbString(colorHex) {
  if (colorHex === '#6366f1') return '99, 102, 241';
  if (colorHex === '#10b981') return '16, 185, 129';
  if (colorHex === '#d97706') return '217, 119, 6';
  return '239, 68, 68';
}

function formatFavorDetailsHTML(detailsStr) {
  if (!detailsStr) return '';
  let html = detailsStr;
  const lines = html.split('\n');
  return `<div style="display:flex; flex-direction:column; gap:6px;">
    ${lines.map(line => {
      let lineHtml = line.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--color-text-primary); font-weight:800;">$1</strong>');
      return `<div style="font-size:12.5px; line-height:1.4; color:var(--color-text-secondary);">${lineHtml}</div>`;
    }).join('')}
  </div>`;
}

function parseFavorDetails(details) {
  if (!details) return [];
  const stores = [];
  const regex = /🏪\s*\*\*?\d+\.\s*Comercio:\*\*?\s*(.*?)(?=\s*📦|$)/gi;
  const matches = [...details.matchAll(regex)];
  
  matches.forEach((match, index) => {
    const storeName = match[1].trim();
    const nextIndex = index + 1 < matches.length ? matches[index + 1].index : details.length;
    const subStr = details.slice(match.index, nextIndex);
    const pedMatch = subStr.match(/📦\s*\*\*?Pedido:\*\*?\s*([\s\S]*?)(?=\n*🏪|$)/i);
    
    stores.push({
      name: storeName,
      items: pedMatch ? pedMatch[1].trim() : ''
    });
  });
  
  return stores;
}

let activeOrdersCount = 0;
let activeOrdersList = [];
const commerceCache = new Map();

export async function renderDeliveryPanel() {
  const panelId = 'page-delivery';
  const content = document.getElementById(panelId) || document.getElementById('app-content');
  if (!content) return;
  content.style.overflow = 'hidden';

  // HOTSPOTS IMPLEMENTATION & ROUND ROBIN QUEUE
  window.autoAcceptEnabled = false;

  // Setup click listener on content for coupon info cards (with cleanup to avoid duplicate listeners)
  if (content._couponListener) {
    content.removeEventListener('click', content._couponListener);
  }
  content._couponListener = (e) => {
    const infoBtn = e.target.closest('.coupon-info-btn');
    if (infoBtn) {
      e.stopPropagation();
      e.preventDefault();
      
      const discountVal = Number(infoBtn.dataset.discount || 0);
      
      showModal({
        title: '',
        hideHeader: true,
        height: 'auto',
        content: `
          <div style="padding:24px 20px; font-family:var(--font-body); color:var(--color-text-primary); display:flex; flex-direction:column; gap:16px;">
            <div style="text-align:center; margin-bottom:8px;">
              <div style="font-size:40px; display:inline-block; animation: scale-pulse 2s infinite;">🎟️</div>
            </div>
            
            <h4 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; text-align:center; line-height:1.3; color:#a855f7; display:flex; align-items:center; justify-content:center; gap:6px;">
              ${icon('tag', 18)} Cupones y Ofertas en GoDelivery
            </h4>
            
            <p style="font-size:13px; color:var(--color-text-secondary); margin:0; line-height:1.5; text-align:center; font-weight:500;">
              ¡Tu ganancia por el envío está 100% protegida! A continuación te explicamos exactamente cómo funciona:
            </p>
            
            <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:16px; padding:6px; background:rgba(34, 197, 94, 0.1); border-radius:50%; color:#22c55e; flex-shrink:0;">💸</span>
                <div>
                  <strong style="font-size:12px; display:block; color:var(--color-text-primary); margin-bottom:2px;">Absorción por la Plataforma</strong>
                  <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.4; display:block;">
                    Cualquier cupón o descuento (Envío Gratis o Descuento %) es una campaña publicitaria de <strong>GO Delivery</strong> para atraer clientes y aumentar tus pedidos. El costo lo asume en su totalidad la empresa, <strong>nunca tú</strong>.
                  </span>
                </div>
              </div>
              
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:16px; padding:6px; background:rgba(168, 85, 247, 0.1); border-radius:50%; color:#a855f7; flex-shrink:0;">🔄</span>
                <div>
                  <strong style="font-size:12px; display:block; color:var(--color-text-primary); margin-bottom:2px;">Descuento en tu Deuda</strong>
                  <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.4; display:block;">
                    Dado que el cliente te paga menos en efectivo, el monto descontado (en este pedido: <strong>${formatPrice(discountVal)}</strong>) se <strong>restará de tu deuda</strong> de comisiones con la aplicación al momento de completar la entrega.
                  </span>
                </div>
              </div>
              
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:16px; padding:6px; background:rgba(0, 158, 227, 0.1); border-radius:50%; color:#009ee3; flex-shrink:0;">🛡️</span>
                <div>
                  <strong style="font-size:12px; display:block; color:var(--color-text-primary); margin-bottom:2px;">Ingreso Neto Intacto</strong>
                  <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.4; display:block;">
                    Tus ganancias netas reales por el reparto y las propinas no sufren ningún tipo de descuento. ¡Trabajas con total tranquilidad!
                  </span>
                </div>
              </div>
            </div>
            
            <button id="coupon-modal-close-btn" class="btn btn-primary" style="height:48px; border-radius:14px; font-weight:900; font-size:14px; background:#a855f7; border:none; color:white; margin-top:8px; cursor:pointer; box-shadow:0 6px 16px rgba(168, 85, 247, 0.25);">
              ¡ENTENDIDO!
            </button>
          </div>
        `
      });
      
      const closeBtn = document.getElementById('coupon-modal-close-btn');
      if (closeBtn) {
        closeBtn.onclick = () => closeModal();
      }
    }
  };
  content.addEventListener('click', content._couponListener);

  const user = getState().user;
  if (!user || !isDelivery()) {
    content.innerHTML = `<div class="empty-state">Acceso denegado</div>`;
    return;
  }

  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative ? 'var(--status-bar-height, 24px)' : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  const existingPanel = content.querySelector('.delivery-panel-page');
  if (!existingPanel) {
    content.innerHTML = `
      <div class="delivery-panel-page delivery-panel page-enter" style="display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden; background:var(--color-bg); position:relative;">
        <div id="delivery-header-slot" style="flex-shrink:0; z-index:110; background:var(--color-primary); padding-top: ${topPadding};"></div>
        <div id="session-status-bar-container" style="flex-shrink:0; z-index:100; background:var(--color-bg); border-bottom:1px solid var(--color-border-light); box-shadow:0 4px 10px rgba(0,0,0,0.05);"></div>
        
        <!-- Scrollable content area -->
        <div id="delivery-scroll-area" style="flex:1; overflow-y:auto; padding:20px 20px 100px 20px; -webkit-overflow-scrolling:touch;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--color-text-primary);">
              <input type="checkbox" id="auto-accept-toggle" onchange="window.autoAcceptEnabled = this.checked;" /> Auto-Aceptar
            </label>
          </div>
          <div class="tab-pills" style="margin-bottom: var(--space-6); display: flex; gap: var(--space-2); scrollbar-width: none;">
            <button class="tab-pill" data-tab="available" style="flex: 1; white-space: nowrap; height:44px; border-radius:12px; border:none; font-weight:700; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${icon('package', 18)} Disponibles
            </button>
            <button class="tab-pill" data-tab="active" style="flex: 1; white-space: nowrap; height:44px; border-radius:12px; border:none; font-weight:700; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${icon('bike', 18)} En curso
            </button>
          </div>
          <div id="delivery-content">
            <div class="loader-dots" style="margin: 4rem auto;"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    `;
    setupPersistentBadges();
  }

  // Ensure inactivity check and heartbeat is running if online
  if (user.isOnline) {
    startInactivityCheck(user);
    startHeartbeat(user);
  }

  // Update header and status bar (non-destructive)
  const headerSlot = document.getElementById('delivery-header-slot');
  if (headerSlot) {
    headerSlot.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding: 12px 20px 20px 20px;background:var(--color-primary);border-bottom:none;box-shadow:0 4px 12px rgba(0,0,0,0.1);position:relative;overflow:hidden;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -15px; right: -15px; width: 60px; height: 60px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
        
        <div style="flex:1;min-width:0;position:relative;z-index:2;padding-right:4px;">
          <h1 style="font-family:var(--font-display);font-weight:800;font-size:17px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Panel Delivery</h1>
          <p style="font-size:10px;color:rgba(255,255,255,0.85);font-weight:700;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Repartidor ${user.deliveryId || 'Oficial'}</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;position:relative;z-index:2;flex-shrink:0;">
          <a href="#/delivery/history" title="Historial de Pedidos" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            ${icon('history', 22)}
          </a>
          <a href="#/delivery/finances" title="Finanzas y Cuentas" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            ${icon('bank', 22)}
          </a>
          <a href="#/delivery/config" title="Configuración de Perfil" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            ${icon('settings', 22)}
          </a>
          <button id="delivery-contact-support-btn" title="Contactar a Soporte" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            ${icon('helpCircle', 22)}
          </button>
        </div>
      </div>
    `;

    document.getElementById('delivery-contact-support-btn')?.addEventListener('click', () => {
      const fab = document.getElementById('support-bot-fab-btn');
      if (fab) {
        fab.click();
      } else {
        import('../components/support-bot.js').then(m => {
          m.initSupportBot();
          setTimeout(() => {
            document.getElementById('support-bot-fab-btn')?.click();
          }, 150);
        });
      }
    });
  }

  const barContainer = document.getElementById('session-status-bar-container');
  if (barContainer) {
    barContainer.innerHTML = renderStatusBar(user);
    attachStatusBarListeners(user);
  }

  let activeTab = sessionStorage.getItem('deliveryTab') || 'available';
  sessionStorage.removeItem('deliveryTab');

  const container = document.getElementById('delivery-content');

  const updateUI = (newTab) => {
    document.querySelectorAll('.tab-pill').forEach(btn => {
      const isActive = btn.dataset.tab === newTab;
      btn.classList.toggle('active', isActive);
      if (btn.classList.contains('header-action-btn')) {
        btn.style.background = isActive ? 'white' : 'rgba(255,255,255,0.15)';
        btn.style.color = isActive ? 'var(--color-primary)' : 'white';
        btn.style.border = 'none';
        btn.style.boxShadow = isActive ? '0 4px 12px rgba(0,0,0,0.15)' : 'none';
      } else {
        btn.style.background = isActive ? 'var(--color-primary)' : 'var(--color-bg-secondary)';
        btn.style.color = isActive ? 'white' : 'var(--color-text-tertiary)';
      }
    });
  };

  // Re-attach tab switching listeners
  document.querySelectorAll('.tab-pill').forEach(btn => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      updateUI(activeTab);
      loadTabContent(activeTab, container, user);
    };
  });

  // BREAKING THE INFINITE LOOP: 
  // We no longer call renderDeliveryPanel() inside the subscribe to 'user'.
  // Instead, we only update the specific components that need real-time sync.
  if (window.__gd_delivery_unsub) {
    window.__gd_delivery_unsub();
  }

  let lastKnownOnlineStatus = user.isOnline;
  window.__gd_delivery_unsub = subscribe('user', (newUser) => {
    const bar = document.getElementById('session-status-bar-container');
    if (bar) {
      bar.innerHTML = renderStatusBar(newUser);
      attachStatusBarListeners(newUser);
    }
    
    if (!newUser.isOnline) {
      if (inactivityTimer) {
        clearInterval(inactivityTimer);
        inactivityTimer = null;
      }
      stopHeartbeat();
    }

    // Middle content sync
    const contentArea = document.getElementById('delivery-content');
    if (contentArea) {
      if (newUser.isOnline !== lastKnownOnlineStatus) {
        lastKnownOnlineStatus = newUser.isOnline;
        loadTabContent(activeTab, contentArea, newUser);
      }
    }
  });

  const handleExternalSwitch = (e) => {
    if (e.detail) {
      activeTab = e.detail;
      updateUI(activeTab);
      loadTabContent(activeTab, container, user);
    }
  };
  window.addEventListener('switch-delivery-tab', handleExternalSwitch);

  window.addEventListener('hashchange', () => {
    if (window.__gd_delivery_unsub) {
      window.__gd_delivery_unsub();
      window.__gd_delivery_unsub = null;
    }
    window.removeEventListener('switch-delivery-tab', handleExternalSwitch);
  }, { once: true });

  updateUI(activeTab);
  loadTabContent(activeTab, container, user);

  // --- PERSISTENT TAB BADGE LISTENERS ---
  function setupPersistentBadges() {
    // Available Badge
    const qAvailable = query(collection(db, 'orders'), where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending']));
    const unsubAvailable = onSnapshot(qAvailable, (snap) => {
      const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const batches = new Set();
      allOrders.forEach(o => {
        if (o.driverId) return;
        if (o.queueTargetDriverId !== user.uid) return;
        
        const mode = user.deliveryMode || 'both';
        if (mode === 'trip' && !o.isTrip) return;
        if (mode === 'delivery' && o.isTrip) return;
        
        if (o.isTrip) {
          const isApproved = user.tripStatus === 'approved' || user.role === 'chofer';
          if (!isApproved) return;
           const requestedTripType = (o.tripType || 'auto').toLowerCase();
           const driverVehicleType = (user.tripVehicleType || user.vehicleType || '').toLowerCase();
           if (requestedTripType !== driverVehicleType) return;
           batches.add(o.id);
        }
        else if (o.isFavor) batches.add(o.id);
        else if (o.bundleId) batches.add(o.bundleId);
        else if (o.status === 'ready') batches.add(o.id);
      });
      
      const count = batches.size;
      const pill = document.querySelector('.tab-pill[data-tab="available"]');
      if (pill) {
        const existingBadge = pill.querySelector('.tab-count-badge');
        if (existingBadge) existingBadge.remove();
        if (count > 0) {
          pill.insertAdjacentHTML('beforeend', `<span class="tab-count-badge" style="background:#ef4444; color:white; font-size:10px; font-weight:900; padding:2px 6px; border-radius:10px; margin-left:6px;">${count}</span>`);
        }
      }
    });

    // Active Badge
    const qActive = query(collection(db, 'orders'), where('driverId', '==', user.uid));
    const unsubActive = onSnapshot(qActive, (snap) => {
      const activeOrders = snap.docs.filter(d => !['completed', 'cancelled'].includes(d.data().status)).map(d => ({ id: d.id, ...d.data() }));
      activeOrdersList = activeOrders;
      activeOrdersCount = activeOrders.length;
      // Group active by bundleId to count "tasks"
      const activeBatches = new Set();
      activeOrders.forEach(o => activeBatches.add(o.bundleId || o.id));
      
      const count = activeBatches.size;
      const pill = document.querySelector('.tab-pill[data-tab="active"]');
      if (!pill) return;
      
      const existingBadge = pill.querySelector('.tab-count-badge');
      if (existingBadge) existingBadge.remove();
      
      if (count > 0) {
        pill.insertAdjacentHTML('beforeend', `<span class="tab-count-badge" style="background:var(--color-primary); color:white; font-size:10px; font-weight:900; padding:2px 6px; border-radius:10px; margin-left:6px; animation: badge-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">${count}</span>`);
      }
    });

    if (!document.getElementById('badge-animations')) {
      const s = document.createElement('style'); s.id = 'badge-animations';
      s.textContent = `@keyframes badge-pop { 0% { transform: scale(0.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`;
      document.head.appendChild(s);
    }

    window.addEventListener('hashchange', () => {
      unsubAvailable();
      unsubActive();
    }, { once: true });
  };

setupPersistentBadges();
}

let tabUnsub = null;

function loadTabContent(tab, container, user) {
  // Cleanup previous tab listener
  if (tabUnsub) { tabUnsub(); tabUnsub = null; }
  stopExclusiveOfferAlert();

  // Clear cached tab rendering fingerprints to force a fresh render on tab load or switch
  if (container) {
    delete container.dataset.lastAvailableFingerprint;
    delete container.dataset.lastActiveFingerprint;
  }

  container.innerHTML = `<div class="loader-dots" style="margin: 2rem auto;"><span></span><span></span><span></span></div>`;

  try {
    if (tab === 'available') {
      const q = query(
        collection(db, 'orders'),
        where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending'])
      );


      let isInitial = true;
      const listUnsub = onSnapshot(q, (snap) => {
        const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        const hasExclusiveOffer = allOrders.some(o => !o.driverId && o.queueTargetDriverId === user.uid);
        if (hasExclusiveOffer) {
          playExclusiveOfferAlert();
        } else {
          stopExclusiveOfferAlert();
        }
        
        // 1. Separate favors/trips, and group ready orders by commerce
        const favors = [];
        const trips = [];
        const readyOrdersByCommerce = new Map(); // comercioId -> Array of orders
        const otherOrders = []; // e.g. orders with bundleId

        allOrders.forEach(o => {
          if (o.driverId) return;

          const now = Date.now();
          const offeredAt = o.queueOfferedAt ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime()) : (o.queueTargetDriverId ? now : 0);
          const isTargetMe = o.queueTargetDriverId === user.uid;
          const needsQueueAssign = (!o.queueTargetDriverId && (now - offeredAt >= 15000)) || 
                                   (o.queueTargetDriverId && isTargetMe && (now - offeredAt >= 30000)) ||
                                   (o.queueTargetDriverId && !isTargetMe && (now - offeredAt >= 33000));
          if (needsQueueAssign) {
            updateDispatchQueue(o.id);
          }

          // Filter: only show if offered to me!
          if (o.queueTargetDriverId !== user.uid) return;

          // Handle Auto-Accept
          if (o.queueTargetDriverId === user.uid && window.autoAcceptEnabled) {
            if (!window.activeAutoAccepts) window.activeAutoAccepts = new Set();
            if (!window.activeAutoAccepts.has(o.id)) {
              window.activeAutoAccepts.add(o.id);
              showToast('Auto-Aceptando pedido en 2s...', 'info');
              setTimeout(async () => {
                const freshSnap = await getDoc(doc(db, 'orders', o.id));
                if (freshSnap.exists() && !freshSnap.data().driverId && freshSnap.data().queueTargetDriverId === user.uid) {
                  takeBatch(o.bundleId || o.id, user);
                }
                window.activeAutoAccepts.delete(o.id);
              }, 2000);
            }
          }

          const mode = user.deliveryMode || 'both';
          if (mode === 'trip' && !o.isTrip) return;
          if (mode === 'delivery' && o.isTrip) return;
          
          if (o.isTrip) {
            const isApproved = user.tripStatus === 'approved' || user.role === 'chofer';
            if (!isApproved) return;
            const requestedTripType = (o.tripType || 'auto').toLowerCase();
            const driverVehicleType = (user.tripVehicleType || user.vehicleType || '').toLowerCase();
            if (requestedTripType !== driverVehicleType) return;
            trips.push(o);
          } else if (o.isFavor) {
            favors.push(o);
          } else if (o.bundleId) {
            otherOrders.push(o); // Keep existing backend bundles
          } else if (o.status === 'ready') {
            if (!readyOrdersByCommerce.has(o.comercioId)) {
              readyOrdersByCommerce.set(o.comercioId, []);
            }
            readyOrdersByCommerce.get(o.comercioId).push(o);
          }
        });

        const batches = new Map();

        // 2. Add backend bundles (otherOrders)
        otherOrders.forEach(o => {
          if (!batches.has(o.bundleId)) {
            batches.set(o.bundleId, {
              id: o.bundleId,
              isBundle: true,
              orders: [],
              createdAt: o.createdAt,
              deliveryAddress: o.deliveryAddress,
              total: 0,
              subtotal: 0,
              deliveryCost: 0,
              appUsageFee: 0,
              commissionAmount: 0,
              discountAmount: 0,
              couponDiscount: 0
            });
          }
          const b = batches.get(o.bundleId);
          b.orders.push(o);
          b.total += o.total;
          b.subtotal += (o.subtotal || 0);
          b.deliveryCost += (o.deliveryCost || 0);
          b.appUsageFee += (o.appUsageFee || 0);
          b.commissionAmount += (o.commissionAmount || 0);
          b.discountAmount += (o.discountAmount || 0);
          b.couponDiscount += (o.couponDiscount || 0);
          if (o.createdAt?.toMillis() < b.createdAt?.toMillis()) b.createdAt = o.createdAt;
        });

        // 3. Add favors
        favors.forEach(o => {
          batches.set(o.id, {
            id: o.id,
            isBundle: false,
            isFavor: true,
            order: o,
            createdAt: o.createdAt,
            deliveryAddress: o.deliveryAddress,
            total: o.total,
            subtotal: o.subtotal || 0,
            deliveryCost: o.deliveryCost || 0,
            purchaseFee: o.purchaseFee || 0,
            extraStopsFee: o.extraStopsFee || 0,
            appUsageFee: o.appUsageFee || 0,
            commissionAmount: o.commissionAmount || 0,
            discountAmount: o.discountAmount || 0,
            couponDiscount: o.couponDiscount || 0
          });
        });

        // 3b. Add trips
        trips.forEach(o => {
          batches.set(o.id, {
            id: o.id,
            isBundle: false,
            isTrip: true,
            order: o,
            createdAt: o.createdAt,
            deliveryAddress: o.deliveryAddress,
            total: o.total,
            subtotal: o.subtotal || 0,
            deliveryCost: o.deliveryCost || 0,
            purchaseFee: o.purchaseFee || 0,
            appUsageFee: o.appUsageFee || 0,
            commissionAmount: o.commissionAmount || 0,
            discountAmount: o.discountAmount || 0,
            couponDiscount: o.couponDiscount || 0
          });
        });

        // 4. Add dynamic commerce-grouped ready orders (max 3 per group, distance <500m between deliveries)
        readyOrdersByCommerce.forEach((ordersList, commerceId) => {
          ordersList.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
          
          const chunks = [];
          const visited = new Set();

          for (let i = 0; i < ordersList.length; i++) {
            if (visited.has(ordersList[i].id)) continue;
            
            const currentChunk = [ordersList[i]];
            visited.add(ordersList[i].id);

            const c1 = ordersList[i].deliveryCoords;
            if (c1) {
              // Find up to 2 other orders close to this one (<500m)
              for (let j = 0; j < ordersList.length; j++) {
                if (currentChunk.length >= 3) break;
                if (visited.has(ordersList[j].id)) continue;

                const c2 = ordersList[j].deliveryCoords;
                if (c2) {
                  const dist = getHaversineDistance(c1.lat, c1.lng, c2.lat, c2.lng);
                  if (dist <= 500) {
                    currentChunk.push(ordersList[j]);
                    visited.add(ordersList[j].id);
                  }
                }
              }
            }
            chunks.push(currentChunk);
          }

          chunks.forEach((chunk, chunkIdx) => {
            const firstOrder = chunk[0];
            const batchId = chunk.length === 1 ? firstOrder.id : `dynamic-commerce-${commerceId}-${chunkIdx}`;
            
            if (chunk.length === 1) {
              batches.set(batchId, {
                id: batchId,
                isBundle: false,
                isFavor: false,
                order: firstOrder,
                createdAt: firstOrder.createdAt,
                deliveryAddress: firstOrder.deliveryAddress,
                total: firstOrder.total,
                subtotal: firstOrder.subtotal || 0,
                deliveryCost: firstOrder.deliveryCost || 0,
                appUsageFee: firstOrder.appUsageFee || 0,
                commissionAmount: firstOrder.commissionAmount || 0,
                discountAmount: firstOrder.discountAmount || 0,
                couponDiscount: firstOrder.couponDiscount || 0
              });
            } else {
              batches.set(batchId, {
                id: batchId,
                isBundle: true,
                isDynamicGroup: true,
                comercioId: commerceId,
                comercioName: firstOrder.comercioName,
                orders: chunk,
                createdAt: chunk.reduce((earliest, o) => {
                  if (!earliest) return o.createdAt;
                  return (o.createdAt?.toMillis() || 0) < (earliest.toMillis() || 0) ? o.createdAt : earliest;
                }, null),
                deliveryAddress: chunk.map(o => o.deliveryAddress).join(' | '),
                total: chunk.reduce((sum, o) => sum + o.total, 0),
                subtotal: chunk.reduce((sum, o) => sum + (o.subtotal || 0), 0),
                deliveryCost: chunk.reduce((sum, o) => sum + (o.deliveryCost || 0), 0),
                appUsageFee: chunk.reduce((sum, o) => sum + (o.appUsageFee || 0), 0),
                commissionAmount: chunk.reduce((sum, o) => sum + (o.commissionAmount || 0), 0),
                discountAmount: chunk.reduce((sum, o) => sum + (o.discountAmount || 0), 0),
                couponDiscount: chunk.reduce((sum, o) => sum + (o.couponDiscount || 0), 0)
              });
            }
          });
        });

        const isBatchScheduled = (b) => {
          if (b.isBundle) {
            return b.orders && b.orders.some(o => o.isScheduled);
          }
          return b.order ? !!b.order.isScheduled : false;
        };

        const sortedBatches = Array.from(batches.values())
          .sort((a, b) => {
            const aSched = isBatchScheduled(a);
            const bSched = isBatchScheduled(b);
            if (aSched && !bSched) return -1;
            if (!aSched && bSched) return 1;
            return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
          });

        // Toast for new available orders (Only after initial load and only if driver has no active orders)
        if (!isInitial && activeOrdersCount === 0) {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const order = { id: change.doc.id, ...change.doc.data() };
              if (!order.driverId && (order.status === 'ready' || order.bundleId)) {
                if (order.queueTargetDriverId !== user.uid) return;
                showToast(`¡Nuevo pedido disponible!`, 'info');
              }
            }
          });
        }
        isInitial = false;

        // Bypassing DOM updates if the batches fingerprint hasn't changed
        const availableFingerprint = JSON.stringify(sortedBatches.map(b => {
          const orderObj = b.isBundle ? b.orders[0] : b.order;
          return {
            id: b.id,
            isBundle: b.isBundle,
            total: b.total,
            ordersCount: b.orders?.length || 0,
            ordersStatus: b.orders ? b.orders.map(o => o.status) : (b.order ? b.order.status : ''),
            queueTargetDriverId: orderObj?.queueTargetDriverId || null,
            queueOfferedAt: orderObj?.queueOfferedAt ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) : 0
          };
        }));

        if (container.dataset.lastAvailableFingerprint === availableFingerprint) {
          return;
        }
        container.dataset.lastAvailableFingerprint = availableFingerprint;

        if (!getState().user?.isOnline) {
          container.innerHTML = `
            <div class="empty-state-mini offline-message-container" style="padding: 5rem 1rem; text-align: center;">
              <div style="font-size: 64px; margin-bottom: 1.5rem; opacity: 0.1; color: var(--color-text-primary); display: flex; justify-content: center;">${icon('wifiSlash', 64)}</div>
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--color-text-secondary);">Estás desconectado</h3>
              <p style="font-size: var(--font-sm); color: var(--color-text-tertiary); max-width: 240px; margin: 0 auto;">Debés conectarte para empezar a recibir y tomar pedidos disponibles.</p>
              <button onclick="document.getElementById('session-toggle-btn').click()" class="btn btn-primary" style="margin-top:20px; padding:0 24px; height:44px; border-radius:12px; font-weight:800;">CONECTAR AHORA</button>
            </div>
          `;
          return;
        }

        if (sortedBatches.length === 0) {
          container.innerHTML = `
            <div class="empty-state-mini" style="padding: 5rem 1rem; text-align: center;">
              <div style="font-size: 64px; margin-bottom: 1.5rem; opacity: 0.1; color: var(--color-text-primary); display: flex; justify-content: center;">${icon('package', 64)}</div>
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--color-text-secondary);">Sin pedidos disponibles</h3>
              <p style="font-size: var(--font-sm); color: var(--color-text-tertiary); max-width: 200px; margin: 0 auto;">Te avisaremos cuando un comercio tenga un pedido listo para retirar.</p>
            </div>
          `;
          return;
        }

        if (!document.getElementById('expandable-card-styles')) {
          const s = document.createElement('style');
          s.id = 'expandable-card-styles';
          s.textContent = `
            .expandable-card { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; position: relative; overflow: hidden; }
            .expandable-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: rgba(var(--color-primary-rgb), 0.3); }
            .expandable-card.collapsed .card-details-area { display: none; }
            .expandable-card.collapsed { padding-bottom: 16px !important; }
            
            .expand-icon-span { transition: transform 0.3s ease; display: inline-flex; align-items: center; justify-content: center; }
            .expandable-card:not(.collapsed) .expand-icon-span { transform: rotate(180deg); }
            .expand-text-span::after { content: 'Ver detalles'; }
            .expandable-card:not(.collapsed) .expand-text-span::after { content: 'Ocultar detalles'; }
            
            .expand-indicator-btn:hover {
              background: rgba(var(--color-primary-rgb), 0.1) !important;
              transform: scale(1.01);
            }
          `;
          document.head.appendChild(s);
        }

        container.innerHTML = `
          <div class="delivery-orders-list">
            ${sortedBatches.map(b => {
              const isBundle = b.isBundle;
              const isFavor = b.isFavor;
              const isTrip = b.isTrip;
              const favorType = b.order?.favorType;
              const tripType = b.order?.tripType;
              
              let title = b.comercioName || b.order?.comercioName || 'Comercio';
              if (isBundle) {
                if (b.isDynamicGroup) {
                  title = `Lote ${b.comercioName} (${b.orders.length} pedidos)`;
                } else {
                  title = `Lote Multi-Local (${b.orders.length} locales)`;
                }
              } else if (isFavor) {
                title = getFavorTypeMeta(favorType).title;
              } else if (isTrip) {
                title = tripType === 'moto' ? 'Viaje en Moto solicitado' : 'Viaje en Auto solicitado';
              }
              
              const isScheduled = isBundle ? b.orders.some(o => o.isScheduled) : (b.order ? !!b.order.isScheduled : false);
              const scheduledTime = isBundle ? (b.orders.find(o => o.isScheduled)?.scheduledTime || '') : (b.order?.scheduledTime || '');
              const scheduledDate = isBundle ? (b.orders.find(o => o.isScheduled)?.scheduledDate || '') : (b.order?.scheduledDate || '');

              const scheduledBadge = isScheduled ? `
                <div style="background: #8b5cf6; color: white; border-radius: 12px; padding: 6px 12px; font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.2);">
                  <span style="display: flex; align-items: center;">${icon('calendar', 14, '', 'white')}</span> <span style="letter-spacing: 0.02em;">PROGRAMADO: ${scheduledDate} a las <span style="text-decoration: underline; font-weight: 900;">${scheduledTime} HS</span></span>
                </div>
              ` : '';

              const anyPending = isBundle ? b.orders.some(o => o.status === 'pending') : false;
              const allReady = isBundle ? b.orders.every(o => o.status === 'ready') : (isFavor || isTrip || b.order.status === 'ready');

              const favorMeta = isFavor ? getFavorTypeMeta(favorType) : null;
              const favorColor = favorMeta ? favorMeta.color : '#ef4444';
              const favorRgb = favorMeta ? getRgbString(favorMeta.color) : '239, 68, 68';

              const orderObj = b.isBundle ? b.orders[0] : b.order;
              const offeredAt = orderObj?.queueOfferedAt ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) : (orderObj?.queueTargetDriverId ? Date.now() : 0);
              const elapsed = Math.floor((Date.now() - offeredAt) / 1000);
              const remaining = offeredAt > 0 ? Math.max(0, 30 - elapsed) : 0;

              return `
                <div class="admin-card expandable-card collapsed" data-id="${b.id}" style="margin-bottom: 20px; border: 1px solid var(--color-border); background: var(--color-bg-card); padding: 22px; border-radius: 28px; position:relative; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.03); ${anyPending ? 'opacity: 0.8;' : ''}">
                  <div style="position:absolute; top:0; left:0; width:6px; height:100%; background:${isTrip ? '#3b82f6' : (isFavor ? favorColor : '#00D67F')};"></div>
                  
                  ${remaining > 0 ? `
                    <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.15); border-radius:16px; padding:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; width:100%;">
                      <span style="font-size:12px; font-weight:800; color:#ef4444; display:flex; align-items:center; gap:6px;">
                        ⚠️ OFERTA EXCLUSIVA:
                      </span>
                      <span style="font-size:14px; font-weight:950; color:#ef4444;" class="queue-countdown" data-expiry="${offeredAt + 30000}" data-order-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}">${remaining}s</span>
                    </div>
                  ` : ''}
                  
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
                    <div style="flex:1;">
                      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap: wrap;">
                        <span style="font-size:10px; font-weight:900; color:white; background:${isTrip ? '#3b82f6' : (isFavor ? favorColor : '#00D67F')}; padding:3px 10px; border-radius:8px; text-transform:uppercase; letter-spacing: 0.03em;">${isTrip ? 'VIAJE' : (isFavor ? favorMeta.label : 'DISPONIBLE')}</span>
                        <span style="font-size:10.5px; font-weight:800; color:var(--color-text-tertiary);">${new Date(b.createdAt?.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <strong style="font-size:19px; font-weight:950; letter-spacing:-0.5px; display:block; color:var(--color-text-primary); line-height: 1.25;">${title}</strong>
                      ${scheduledBadge}
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:24px; font-weight:950; color:var(--color-text-primary); letter-spacing:-1px; line-height: 1.1;">${formatPrice(b.total)}</div>
                      <div style="font-size:9.5px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; margin-top: 3px; letter-spacing: 0.02em;">A Cobrar</div>
                    </div>
                  </div>
 
                  <div style="display:flex; gap:12px; margin-top:16px; margin-bottom:20px;">
                    <!-- Costo Productos / Servicio -->
                    <div style="flex:1; background: ${isTrip ? '#3b82f6' : favorColor}; padding:14px 10px; border-radius:18px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; box-shadow: 0 6px 15px ${isTrip ? 'rgba(59, 130, 246, 0.15)' : `rgba(${favorRgb}, 0.15)`}; border: none;">
                      <div style="font-size:9.5px; font-weight:800; color:rgba(255,255,255,0.8); text-transform:uppercase; letter-spacing: 0.05em;">${isTrip ? 'Costo Viaje' : (isFavor ? (favorType === 'pagodeservicios' ? 'Costo Servicios' : (favorType === 'gocash' ? 'Costo Gestión' : 'Costo Productos')) : 'Costo Productos')}</div>
                      <div style="font-size:18px; font-weight:950; color:white; letter-spacing: -0.5px;">${isTrip ? formatPrice(b.total) : ((b.subtotal || 0) > 0 ? formatPrice(b.subtotal) : 'PENDIENTE')}</div>
                    </div>
                    <!-- Ganancia Tuya -->
                    <div style="flex:1; background: #10b981; padding:14px 10px; border-radius:18px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; box-shadow: 0 6px 15px rgba(16, 185, 129, 0.15); border: none;">
                      <div style="font-size:9.5px; font-weight:800; color:rgba(255,255,255,0.8); text-transform:uppercase; letter-spacing: 0.05em;">Ganancia Tuya</div>
                      <div style="font-size:18px; font-weight:950; color:white; letter-spacing: -0.5px;">${formatPrice(getOrderDriverEarnings(b))}</div>
                    </div>
                  </div>
 
                  ${(b.discountAmount || 0) > 0 ? `
                    <div style="background:rgba(34, 197, 94, 0.05); border:1px solid rgba(34, 197, 94, 0.2); border-radius:16px; padding:12px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                      <div style="font-size:11px; font-weight:800; color:var(--color-success); display:flex; align-items:center; gap:6px;">
                        ${icon('sparkles', 14)} Descuento GoPoints
                      </div>
                      <div style="font-size:13px; font-weight:900; color:var(--color-success);">- ${formatPrice(b.discountAmount)}</div>
                    </div>
                    <div style="font-size:10px; color:#f59e0b; font-weight:700; margin-bottom:16px; padding:0 4px; line-height:1.3; display:flex; align-items:center; gap:6px;">
                      ${icon('info', 12)} Descuento absorbido por GO Delivery. Se descontará de tu deuda de la app.
                    </div>
                  ` : ''}
 
                  ${(b.couponDiscount || 0) > 0 ? `
                    <div style="background:rgba(168, 85, 247, 0.04); border:1px dashed rgba(168, 85, 247, 0.25); border-radius:16px; padding:12px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                      <div style="font-size:11px; font-weight:800; color:#a855f7; display:flex; align-items:center; gap:6px;">
                        ${icon('tag', 14)} Cupón de Descuento
                      </div>
                      <div style="font-size:13px; font-weight:900; color:#a855f7;">- ${formatPrice(b.couponDiscount)}</div>
                    </div>
                    <div style="font-size:10px; color:#a855f7; font-weight:700; margin-bottom:16px; padding:0 4px; line-height:1.3; display:flex; align-items:center; justify-content:space-between; gap:6px;">
                      <span style="display:flex; align-items:center; gap:4px;">
                        ${icon('info', 12)} Absorbido por GO Delivery. Se descontará de tu deuda.
                      </span>
                      <button class="coupon-info-btn" data-discount="${b.couponDiscount}" style="background:rgba(168, 85, 247, 0.1); border:none; color:#a855f7; font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:2px; flex-shrink:0;">
                        Info
                      </button>
                    </div>
                  ` : ''}
 
                  <div class="expand-indicator-btn" style="margin-top: 4px; margin-bottom: 12px; padding: 10px; background: rgba(var(--color-primary-rgb), 0.05); border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; font-weight: 850; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.05em; transition: all 0.2s; border: 1px dashed rgba(var(--color-primary-rgb), 0.25);">
                    <span class="expand-text-span"></span>
                    <span class="expand-icon-span" style="display: flex; align-items: center; transition: transform 0.3s ease;">${icon('caretDown', 14)}</span>
                  </div>
 
                  <div class="card-details-area">
                    ${isTrip ? `
                      <div style="margin-bottom:16px; padding:14px; background:var(--color-bg-secondary); border-radius:18px; border:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.02em;">Detalles del trayecto</div>
                        <div style="font-size:13px; font-weight:700; color:var(--color-text-primary); display:flex; flex-direction:column; gap:8px;">
                          <div>
                            <span style="color:var(--color-text-tertiary); text-transform:uppercase; font-size:9px; display:block; margin-bottom:2px;">Origen / Buscar en:</span>
                            <div style="display:flex; align-items:center; gap:6px;">${icon('mapPin', 14)} ${b.order.pickupAddress}</div>
                          </div>
                          <div style="margin-top:4px;">
                            <span style="color:var(--color-text-tertiary); text-transform:uppercase; font-size:9px; display:block; margin-bottom:2px;">Destino / Llevar a:</span>
                            <div style="display:flex; align-items:center; gap:6px;">${icon('navigation', 14)} ${b.order.deliveryAddress}</div>
                          </div>
                        </div>
                      </div>
                    ` : isFavor ? `
                      <div style="margin-bottom:16px; padding:14px; background:var(--color-bg-secondary); border-radius:18px; border:1px solid var(--color-border-light); text-align:left;">
                        <div style="font-size:9px; font-weight:900; color:${favorMeta.textColor}; text-transform:uppercase; margin-bottom:10px; letter-spacing:0.04em;">${favorMeta.headerText}</div>
                        ${(() => {
                          const stores = parseFavorDetails(b.order.details || b.order.description);
                          const storePrices = b.order.storePrices || {};
                          if (stores.length > 0) {
                            return `
                              <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin-bottom:10px;">
                                ${stores.map(st => `
                                  <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:12.5px; border-bottom:1.5px solid var(--color-border-light); padding-bottom:8px; margin-bottom:2px;">
                                    <div style="display:flex; flex-direction:column; gap:2px; text-align:left; align-items:flex-start; flex:1; padding-right:8px;">
                                      <strong style="color:var(--color-text-primary); font-weight:800;">${st.name}</strong>
                                      <span style="color:var(--color-text-secondary); font-size:11.5px; font-weight:500;">${st.items}</span>
                                    </div>
                                    ${storePrices[st.name] ? `<span style="font-weight:900; color:var(--color-text-primary); margin-left:12px; white-space:nowrap;">${formatPrice(storePrices[st.name])}</span>` : ''}
                                  </div>
                                `).join('')}
                              </div>
                            `;
                          } else {
                            return `<div style="margin-bottom:10px;">${formatFavorDetailsHTML(b.order.details || b.order.description)}</div>`;
                          }
                        })()}
                        ${b.order.pickupAddress ? `
                          <div style="font-size:11px; font-weight:700; color:var(--color-text-primary); margin-top:10px; display:flex; align-items:flex-start; gap:6px;">
                            <span style="color:var(--color-text-tertiary); text-transform:uppercase; font-size:9px; display:flex; align-items:center; gap:4px; font-weight:800;">${icon('mapPin', 13)} Recoger en:</span>
                            <span style="font-weight:600; color:var(--color-text-secondary); flex:1;">${b.order.pickupAddress}</span>
                          </div>
                        ` : ''}
                      </div>
                    ` : (isBundle ? `
                      <div style="margin-bottom:16px; padding:12px; background:rgba(var(--color-primary-rgb), 0.03); border-radius:14px; border:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:900; color:var(--color-primary); text-transform:uppercase; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                          ${icon('store', 14)} ${b.isDynamicGroup ? 'PEDIDOS DEL COMERCIO' : `RETIRO EN ${b.orders.length} LOCALES`}
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                          ${b.orders.map(o => `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap: 8px;">
                              <span style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 220px;">
                                ${b.isDynamicGroup ? `#${o.orderId} - ${o.deliveryAddress}` : o.comercioName}
                              </span>
                              <span style="font-size:9px; font-weight:900; padding:2px 8px; border-radius:6px; background:${o.status === 'ready' ? 'var(--color-success)' : 'var(--color-bg-secondary)'}; color:${o.status === 'ready' ? 'white' : 'var(--color-text-tertiary)'}; flex-shrink: 0;">
                                ${o.status === 'ready' ? 'LISTO' : 'PREPARANDO'}
                              </span>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    ` : '')}
 
                    ${remaining > 0 ? `
                       <div style="display:flex; gap:12px; width:100%; margin-top:8px;">
                         <button class="btn take-batch-btn" 
                                 data-id="${b.id}" 
                                 ${!allReady ? 'disabled' : ''}
                                 style="flex:2; height: 50px; border-radius:16px; font-weight:950; font-size:14px; text-transform:uppercase; border:none; background:var(--color-primary); color:white; box-shadow:0 6px 15px rgba(var(--color-primary-rgb),0.2); display:flex; align-items:center; justify-content:center; gap:8px;">
                           ${icon('checkCircle', 18)} Aceptar
                         </button>
                         <button class="btn reject-order-btn" 
                                 data-id="${b.isBundle ? b.orders[0].id : b.order.id}" 
                                 style="flex:1; height: 50px; border-radius:16px; font-weight:950; font-size:14px; text-transform:uppercase; border:1.5px solid rgba(239, 68, 68, 0.4); background:rgba(239, 68, 68, 0.05); color:#ef4444; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                           ${icon('close', 14)} Rechazar
                         </button>
                       </div>
                     ` : `
                       <button class="btn btn-primary btn-block take-batch-btn" 
                               data-id="${b.id}" 
                               ${!allReady ? 'disabled' : ''}
                               style="height: 54px; border-radius:18px; font-weight:950; font-size:15px; text-transform:uppercase; letter-spacing:0.02em; gap:10px; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.2); ${!allReady ? 'opacity:0.5; filter:grayscale(1); box-shadow:none;' : ''}">
                         ${!allReady ? 'Esperando locales...' : `${icon('checkCircle', 20)} TOMAR VIAJE / PEDIDO`}
                       </button>
                     `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        container.querySelectorAll('.expandable-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.btn')) return; // Don't collapse when clicking button
            card.classList.toggle('collapsed');
          });
        });

        // Start active countdown intervals
        if (window.queueCountdownInterval) clearInterval(window.queueCountdownInterval);
        const countdownInterval = setInterval(() => {
          container.querySelectorAll('.queue-countdown').forEach(el => {
            const expiry = parseInt(el.dataset.expiry);
            const now = Date.now();
            const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
            el.textContent = `${remaining}s`;
             if (remaining <= 0) {
               clearInterval(countdownInterval);
               const orderIdsStr = el.dataset.orderIds;
               if (orderIdsStr) {
                 const orderIds = orderIdsStr.split(',');
                 console.log(`[Queue countdown expired] Triggering rotation for orders:`, orderIds);
                 orderIds.forEach(id => updateDispatchQueue(id));
               }
             }
          });
        }, 1000);
        window.queueCountdownInterval = countdownInterval;

        container.querySelectorAll('.take-batch-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            showConfirm({
              title: '¿Tomar este pedido?',
              message: 'Te asignarás como el repartidor oficial. Deberás dirigirte al comercio lo antes posible.',
              confirmText: 'SÍ, TOMAR PEDIDO',
              onConfirm: () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 20, 'animate-spin') + ' TOMANDO...';
                takeBatch(btn.dataset.id, user, sortedBatches.find(b => b.id === btn.dataset.id), btn);
              }
            });
          });
        });

        container.querySelectorAll('.reject-order-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const rejectModalContent = document.createElement('div');
            rejectModalContent.style.cssText = 'padding:20px; display:flex; flex-direction:column; gap:16px;';
            rejectModalContent.innerHTML = `
              <p style="font-size:13px; color:var(--color-text-secondary); line-height:1.5; text-align:center;">
                Por favor selecciona el motivo del rechazo. Se aplicará una pausa de 3 minutos.
              </p>
              <select id="reject-reason-select" style="width:100%; height:48px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); outline:none;">
                <option value="distancia">Distancia excesiva</option>
                <option value="mecanico">Problema mecánico / Pinchadura</option>
                <option value="inseguro">Zona insegura</option>
                <option value="emergencia">Emergencia personal</option>
                <option value="poca_ganancia">Poca ganancia</option>
              </select>
              <button id="confirm-reject-btn" style="width:100%; height:48px; border-radius:14px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:14px; cursor:pointer; box-shadow:0 8px 16px rgba(var(--color-primary-rgb), 0.2);">
                CONFIRMAR RECHAZO
              </button>
            `;
            showModal({ title: 'Motivo del Rechazo', content: rejectModalContent, height: 'auto' });
            
            rejectModalContent.querySelector('#confirm-reject-btn').onclick = async () => {
              const reason = rejectModalContent.querySelector('#reject-reason-select').value;
              closeModal();
              showToast('Procesando rechazo...', 'info');
              
              try {
                // Apply cooldown of 3 minutes in driver users document
                await updateDoc(doc(db, 'users', user.uid), {
                  cooldownUntil: new Date(Date.now() + 3 * 60 * 1000)
                });
                
                // Add driver to queueRejectedDrivers of this order
                await runTransaction(db, async (transaction) => {
                  const oId = btn.dataset.id;
                  const orderRef = doc(db, 'orders', oId);
                  const oSnap = await transaction.get(orderRef);
                  if (oSnap.exists()) {
                    const rejected = oSnap.data().queueRejectedDrivers || [];
                    if (!rejected.includes(user.uid)) {
                      rejected.push(user.uid);
                    }
                    transaction.update(orderRef, {
                      queueRejectedDrivers: rejected,
                      queueTargetDriverId: null,
                      queueTargetDriverName: null,
                      queueOfferedAt: null
                    });
                  }
                });
                
                showToast('Pedido rechazado. Cooldown de 3 minutos activo.', 'warning');
              } catch (err) {
                console.error(err);
                showToast('Error al procesar rechazo', 'error');
              }
            };
          });
        });

        container.querySelectorAll('.view-map-btn').forEach(btn => {
          const batch = sortedBatches.find(b => b.id === btn.dataset.id);
          const orderForMap = batch.isBundle ? batch.orders[0] : batch.order;
          btn.addEventListener('click', () => showDeliveryMapModal(orderForMap, batch.isBundle ? batch.orders : null));
        });
        });

        // ── Scheduled Trips Section (for approved chofers) ──
        // NOTE: This runs OUTSIDE the main available-orders onSnapshot, at the tab level.
        if (user.tripStatus === 'approved') {
          const qScheduled = query(
            collection(db, 'orders'),
            where('status', '==', 'scheduled'),
            where('isTrip', '==', true)
          );

          const scheduledUnsub = onSnapshot(qScheduled, (scheduledSnap) => {
            // Re-create the container if it was destroyed by the main onSnapshot re-render
            let scheduledContainer = document.getElementById('scheduled-trips-section');
            if (!scheduledContainer) {
              scheduledContainer = document.createElement('div');
              scheduledContainer.id = 'scheduled-trips-section';
              container.appendChild(scheduledContainer);
            }
            const scheduledTrips = scheduledSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(o => {
                if (o.driverId && o.driverId !== user.uid) return false;
                const reqType = (o.tripType || 'auto').toLowerCase();
                const driverType = (user.tripVehicleType || user.vehicleType || 'auto').toLowerCase();
                return reqType === driverType;
              });

            if (scheduledTrips.length === 0) {
              scheduledContainer.innerHTML = '';
              return;
            }

            scheduledContainer.innerHTML = `
              <div style="margin-top:24px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-left:4px;">
                  <div style="width:28px; height:28px; border-radius:8px; background:rgba(139,92,246,0.12); display:flex; align-items:center; justify-content:center; color:#8b5cf6;">
                    ${icon('calendar', 16)}
                  </div>
                  <span style="font-size:13px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.03em;">Viajes Programados</span>
                  <span style="font-size:10px; font-weight:900; color:white; background:#8b5cf6; padding:2px 8px; border-radius:8px;">${scheduledTrips.length}</span>
                </div>
                ${scheduledTrips.map(trip => {
                  const scheduledDate = trip.scheduledFor?.toDate ? trip.scheduledFor.toDate() : new Date(trip.scheduledFor);
                  const dateStr = scheduledDate.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
                  const timeStr = scheduledDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                  const isAssignedToMe = trip.driverId === user.uid;
                  const isUnassigned = !trip.driverId;

                  return `
                    <div class="admin-card" style="margin-bottom:14px; border:1px solid ${isAssignedToMe ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}; background:var(--color-bg-card); padding:18px; border-radius:22px; position:relative; overflow:hidden; ${isAssignedToMe ? 'box-shadow:0 4px 16px rgba(139,92,246,0.1);' : ''}">
                      <div style="position:absolute; top:0; left:0; width:5px; height:100%; background:#8b5cf6;"></div>
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <div>
                          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="font-size:9px; font-weight:900; color:white; background:#8b5cf6; padding:2px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.03em;">PROGRAMADO</span>
                            ${isAssignedToMe ? '<span style="font-size:9px; font-weight:900; color:white; background:#22c55e; padding:2px 8px; border-radius:6px;">ACEPTADO</span>' : ''}
                          </div>
                          <strong style="font-size:15px; font-weight:900; color:var(--color-text-primary); display:block;">Viaje en ${(trip.tripType || 'auto') === 'moto' ? 'Moto 🏍️' : 'Auto 🚗'}</strong>
                        </div>
                        <div style="text-align:right;">
                          <div style="font-size:18px; font-weight:950; color:var(--color-text-primary);">${formatPrice(trip.total || trip.deliveryCost || 0)}</div>
                          <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">A Cobrar</div>
                        </div>
                      </div>
                      <div style="background:rgba(139,92,246,0.06); border:1px solid rgba(139,92,246,0.12); border-radius:14px; padding:10px 12px; margin-bottom:12px; display:flex; align-items:center; gap:10px;">
                        <span style="font-size:20px;">📅</span>
                        <div>
                          <div style="font-size:12px; font-weight:800; color:#8b5cf6;">${dateStr} — ${timeStr} hs</div>
                          <div style="font-size:10px; font-weight:600; color:var(--color-text-tertiary);">Pasajero: ${trip.userName || 'Cliente'}</div>
                        </div>
                      </div>
                      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                          <div style="width:8px; height:8px; border-radius:50%; background:#22c55e; flex-shrink:0;"></div>
                          <span style="font-size:11.5px; font-weight:600; color:var(--color-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${trip.pickupAddress || 'Origen'}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                          <div style="width:8px; height:8px; border-radius:50%; background:var(--color-primary); flex-shrink:0;"></div>
                          <span style="font-size:11.5px; font-weight:600; color:var(--color-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${trip.deliveryAddress || 'Destino'}</span>
                        </div>
                      </div>
                      ${isUnassigned ? `
                        <button class="btn btn-primary btn-block accept-scheduled-btn" data-trip-id="${trip.id}"
                          style="height:48px; border-radius:14px; font-weight:900; font-size:13px; text-transform:uppercase; letter-spacing:0.02em; gap:8px; background:linear-gradient(135deg, #8b5cf6, #7c3aed); box-shadow:0 6px 16px rgba(139,92,246,0.25); border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                          ${icon('checkCircle', 18)} ACEPTAR VIAJE PROGRAMADO
                        </button>
                      ` : `
                        <div style="text-align:center; padding:8px; background:rgba(34,197,94,0.06); border-radius:12px; border:1px solid rgba(34,197,94,0.15);">
                          <span style="font-size:12px; font-weight:800; color:#22c55e;">✅ Ya aceptaste este viaje</span>
                        </div>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            `;

            // Bind accept buttons
            scheduledContainer.querySelectorAll('.accept-scheduled-btn').forEach(btn => {
              btn.addEventListener('click', async () => {
                const tripId = btn.dataset.tripId;
                showConfirm({
                  title: '📅 ¿Aceptar viaje programado?',
                  message: 'Te comprometerás a realizar este viaje en la fecha y hora indicadas. Recibirás un recordatorio antes de la hora del viaje.',
                  confirmText: 'Sí, Aceptar',
                  onConfirm: async () => {
                    try {
                      btn.disabled = true;
                      btn.innerHTML = icon('loader', 18, 'animate-spin') + ' Aceptando...';
                      const tripDoc = doc(db, 'orders', tripId);
                      await updateDoc(tripDoc, {
                        driverId: user.uid,
                        driverName: user.displayName || user.name || 'Chofer'
                      });

                      // Send notification to user
                      try {
                        const trip = scheduledTrips.find(t => t.id === tripId);
                        if (trip && trip.userId) {
                          await addDoc(collection(db, 'users', trip.userId, 'notifications'), {
                            title: '🚗 Chofer asignado a tu viaje programado',
                            body: `${user.displayName || 'Un chofer'} aceptó tu viaje programado. Te notificaremos antes de la hora del viaje.`,
                            type: 'scheduled_trip_accepted',
                            orderId: tripId,
                            createdAt: serverTimestamp(),
                            read: false
                          });
                        }
                      } catch (e) {
                        console.warn('Error sending scheduled trip notification:', e);
                      }

                      showToast('¡Viaje programado aceptado!', 'success');
                    } catch (err) {
                      console.error('Error accepting scheduled trip:', err);
                      showToast('Error al aceptar el viaje: ' + err.message, 'error');
                      btn.disabled = false;
                      btn.innerHTML = icon('checkCircle', 18) + ' ACEPTAR VIAJE PROGRAMADO';
                    }
                  }
                });
              });
            });
          });

          // Clean up scheduled listener when main listener is cleaned
          const originalUnsub = listUnsub;
          tabUnsub = () => {
            originalUnsub();
            scheduledUnsub();
          };
        } else {
          tabUnsub = listUnsub;
        }

        // ── Countdown Banner for driver's own upcoming scheduled trips ──
        if (user.tripStatus === 'approved') {
          const bannerQ = query(
            collection(db, 'orders'),
            where('driverId', '==', user.uid),
            where('status', '==', 'scheduled'),
            where('isTrip', '==', true)
          );
          const bannerUnsub = onSnapshot(bannerQ, (bSnap) => {
            document.getElementById('scheduled-trip-banner')?.remove();
            const myScheduled = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (myScheduled.length === 0) return;

            // Find the nearest scheduled trip
            const now = Date.now();
            let nearest = null;
            let nearestMs = Infinity;
            myScheduled.forEach(t => {
              const ts = t.scheduledFor?.toDate ? t.scheduledFor.toDate().getTime() : 0;
              const diff = ts - now;
              if (diff > 0 && diff < nearestMs) {
                nearestMs = diff;
                nearest = t;
              }
            });

            if (!nearest || nearestMs > 4 * 60 * 60 * 1000) return; // Only show within 4 hours

            const banner = document.createElement('div');
            banner.id = 'scheduled-trip-banner';
            banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9990; padding:12px 16px; background:linear-gradient(135deg, #7c3aed, #8b5cf6); color:white; display:flex; align-items:center; gap:10px; box-shadow:0 4px 16px rgba(139,92,246,0.3); font-size:13px; font-weight:700;';

            function updateBannerTime() {
              const diff = (nearest.scheduledFor?.toDate ? nearest.scheduledFor.toDate().getTime() : 0) - Date.now();
              if (diff <= 0) {
                banner.innerHTML = `<span style="font-size:18px;">🚗</span> <span>¡Tu viaje programado comienza AHORA!</span>`;
                return;
              }
              const hrs = Math.floor(diff / 3600000);
              const mins = Math.floor((diff % 3600000) / 60000);
              banner.innerHTML = `<span style="font-size:18px;">⏰</span> <span>Viaje programado en <strong>${hrs}h ${mins}m</strong></span> <span style="margin-left:auto; font-size:10px; opacity:0.8; text-transform:uppercase;">${nearest.deliveryAddress || ''}</span>`;
            }

            updateBannerTime();
            const bannerInterval = setInterval(updateBannerTime, 60000);
            banner._interval = bannerInterval;

            document.body.appendChild(banner);

            // Cleanup when navigating away
            const cleanupBanner = () => {
              clearInterval(bannerInterval);
              banner.remove();
            };
            window.addEventListener('hashchange', cleanupBanner, { once: true });
          });

          // Add to cleanup
          const prevUnsub = tabUnsub;
          tabUnsub = () => {
            prevUnsub();
            bannerUnsub();
            document.getElementById('scheduled-trip-banner')?.remove();
          };
        }

    } else if (tab === 'active') {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid),
        where('status', 'in', ['confirmed', 'ready', 'delivering'])
      );

      let suggestedUnsub = null;
      let currentSuggestedOrders = [];

      const listUnsub = onSnapshot(q, (snap) => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (suggestedUnsub) {
          suggestedUnsub();
          suggestedUnsub = null;
        }

        if (orders.length === 0) {
          container.innerHTML = `<div class="empty-state-mini" style="padding: 3rem 1rem;">No tenés pedidos en curso</div>`;
          return;
        }

        // Check if co-pickup recommendations apply
        const activeUnpickedComercioIds = [...new Set(
          orders.filter(o => !o.pickedUpAt && o.comercioId).map(o => o.comercioId)
        )];

        // Under the new rule, co-pickup suggestions are shown if the current route consists of exactly 1 active order,
        // or if they have exactly 2 active orders and both belong to the same local (since the maximum same-local limit is 3).
        const hasSpace = orders.length === 1 || (orders.length === 2 && orders.every(o => o.comercioId && o.comercioId === orders[0].comercioId));

        if (activeUnpickedComercioIds.length > 0 && hasSpace) {
          const qSuggested = query(
            collection(db, 'orders'),
            where('comercioId', 'in', activeUnpickedComercioIds),
            where('status', '==', 'ready')
          );
          
          suggestedUnsub = onSnapshot(qSuggested, (suggestedSnap) => {
            currentSuggestedOrders = suggestedSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(o => !o.driverId && !o.bundleId);
            
            renderActiveTimeline(orders, currentSuggestedOrders);
          });
        } else {
          renderActiveTimeline(orders, []);
        }
      });

      async function renderActiveTimeline(orders, suggestedOrders) {
        // Fetch missing commerce addresses
        for (const o of orders) {
          if (!o.isFavor && o.comercioId && !o.pickupAddress && !o.comercioAddress) {
            if (!commerceCache.has(o.comercioId)) {
              try {
                const cSnap = await getDoc(doc(db, 'comercios', o.comercioId));
                if (cSnap.exists()) {
                  const cData = cSnap.data();
                  commerceCache.set(o.comercioId, {
                    address: cData.address || '',
                    name: cData.name || ''
                  });
                } else {
                  commerceCache.set(o.comercioId, { address: '', name: '' });
                }
              } catch (err) {
                console.error('Error fetching commerce address:', err);
              }
            }
            const cached = commerceCache.get(o.comercioId);
            if (cached) {
              o.comercioAddress = cached.address;
              if (!o.comercioName) o.comercioName = cached.name;
            }
          }
        }

        const fingerprint = JSON.stringify(orders.map(o => ({
          id: o.id,
          status: o.status,
          pickedUp: !!o.pickedUpAt,
          isAtDoor: !!o.isAtDoor,
          comercioId: o.comercioId,
          orderId: o.orderId,
          deliveryAddress: o.deliveryAddress,
          comercioAddress: o.comercioAddress || '',
          subtotal: o.subtotal || 0,
          total: o.total || 0
        }))) + '_' + JSON.stringify(suggestedOrders.map(o => o.id));

        if (container.dataset.lastActiveFingerprint === fingerprint) {
          console.log('[Active Timeline] Fingerprint matches, bypassing DOM replacement to prevent refresh loops');
          return;
        }
        container.dataset.lastActiveFingerprint = fingerprint;

        if (orders.length === 0) {
          container.innerHTML = `<div class="empty-state-mini" style="padding: 3rem 1rem;">No tenés pedidos en curso</div>`;
          return;
        }

        // Group active orders into a single route timeline
        const stops = [];
        const deliveries = new Map(); // address -> {userName, orders: []}
        const pickupsByCommerce = new Map(); // comercioId -> { comercioName, address, isFavor, orders: [] }

        orders.forEach(o => {
          if (o.favorType === 'gocash') {
            // Go Cash orders do not have a pickup stop, only drop-off.
            // Mark as pickedUpAt in local UI state so the drop-off delivery button is enabled immediately.
            o.pickedUpAt = o.acceptedAt || new Date();
          } else {
            let key = o.comercioId || (o.isFavor ? `favor_${o.id}` : `order_${o.id}`);
            if (!pickupsByCommerce.has(key)) {
              let stopName = o.comercioName;
              if (!stopName) {
                if (o.isTrip) {
                  stopName = 'Punto de Encuentro';
                } else if (o.isFavor) {
                  if (o.favorType === 'pagodeservicios') {
                    const match = o.details?.match(/🏢\s*\*\*Servicio:\*\*\s*(.*?)(?=\n|$)/i);
                    stopName = match ? match[1].trim() : 'Pago de Servicio';
                  } else if (o.favorType === 'mandado') {
                    stopName = 'Punto de Retiro';
                  } else {
                    stopName = 'Comercio a Comprar';
                  }
                } else {
                  stopName = 'Comercio a Comprar';
                }
              }

              pickupsByCommerce.set(key, {
                comercioName: stopName,
                address: o.pickupAddress || o.comercioAddress || '',
                isFavor: !!o.isFavor,
                orders: []
              });
            }
            pickupsByCommerce.get(key).orders.push(o);
          }

          // Drop-off stops (unique per address)
          if (!deliveries.has(o.deliveryAddress)) {
            deliveries.set(o.deliveryAddress, { userName: o.userName, orders: [] });
          }
          deliveries.get(o.deliveryAddress).orders.push(o);
        });

        // Convert pickups to stops
        pickupsByCommerce.forEach((group, key) => {
          const allPickedUp = group.orders.every(o => !!o.pickedUpAt);
          const firstOrder = group.orders[0];
          const totalAmountToPay = group.orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);

          stops.push({
            type: 'PICKUP',
            comercioName: group.comercioName,
            address: group.address,
            pickedUp: allPickedUp,
            isFavor: group.isFavor,
            orders: group.orders,
            amountToPay: totalAmountToPay,
            status: firstOrder.status,
            orderId: group.orders.map(o => o.orderId).join(' + '),
            docId: group.orders.map(o => o.id).join(',') // Comma-separated for atomic multi-pickup
          });
        });

        // Drop-off stops
        deliveries.forEach((data, addr) => {
          stops.push({
            type: 'DROP_OFF',
            address: addr,
            userName: data.userName,
            orders: data.orders
          });
        });

        // TSP Route Optimization for Active Stops
        if (window.lastRiderPos) {
          const startPt = window.lastRiderPos;
          const pendingPickups = stops.filter(s => s.type === 'PICKUP' && !s.pickedUp);
          const completedPickups = stops.filter(s => s.type === 'PICKUP' && s.pickedUp);
          const dropoffs = stops.filter(s => s.type === 'DROP_OFF');

          pendingPickups.sort((a, b) => {
            const aCoords = a.orders[0]?.comercioCoords || startPt;
            const bCoords = b.orders[0]?.comercioCoords || startPt;
            const distA = Math.hypot((aCoords.lat || aCoords.latitude || 0) - startPt.lat, (aCoords.lng || aCoords.longitude || 0) - startPt.lng);
            const distB = Math.hypot((bCoords.lat || bCoords.latitude || 0) - startPt.lat, (bCoords.lng || bCoords.longitude || 0) - startPt.lng);
            return distA - distB;
          });

          let lastPt = startPt;
          if (pendingPickups.length > 0) {
            const lastPickup = pendingPickups[pendingPickups.length - 1];
            lastPt = lastPickup.orders[0]?.comercioCoords || startPt;
          } else if (completedPickups.length > 0) {
            const lastPickup = completedPickups[completedPickups.length - 1];
            lastPt = lastPickup.orders[0]?.comercioCoords || startPt;
          }

          const sortedDropoffs = [];
          let currentPt = { lat: lastPt.lat || lastPt.latitude || 0, lng: lastPt.lng || lastPt.longitude || 0 };
          
          while (dropoffs.length > 0) {
            let nearestIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < dropoffs.length; i++) {
              const dCoords = dropoffs[i].orders[0]?.deliveryCoords || currentPt;
              const dist = Math.hypot((dCoords.lat || dCoords.latitude || 0) - currentPt.lat, (dCoords.lng || dCoords.longitude || 0) - currentPt.lng);
              if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
              }
            }
            const nearest = dropoffs.splice(nearestIdx, 1)[0];
            sortedDropoffs.push(nearest);
            const nextCoords = nearest.orders[0]?.deliveryCoords || currentPt;
            currentPt = { lat: nextCoords.lat || nextCoords.latitude || 0, lng: nextCoords.lng || nextCoords.longitude || 0 };
          }

          stops.length = 0;
          stops.push(...pendingPickups, ...completedPickups, ...sortedDropoffs);
        } else {
          stops.sort((a, b) => {
            if (a.type === b.type) return 0;
            return a.type === 'PICKUP' ? -1 : 1;
          });
        }

        // Suggestion Card HTML
        const suggestedCardHtml = suggestedOrders.length > 0 ? `
          <!-- Premium Amber Glowing Card for Chained Orders -->
          <div class="suggested-co-pickup-card page-enter" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%); border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 28px; padding: 24px; margin-bottom: 24px; position: relative; overflow: hidden; box-shadow: 0 10px 25px rgba(245, 158, 11, 0.05); animation: pulse-border 2s infinite ease-in-out;">
            <!-- Decorative blur glow -->
            <div style="position: absolute; top: -30px; right: -30px; width: 100px; height: 100px; background: radial-gradient(circle, rgba(245, 158, 11, 0.2) 0%, transparent 75%); filter: blur(10px); pointer-events: none;"></div>
            
            <div style="display: flex; gap: 16px; align-items: flex-start; position: relative; z-index: 2;">
              <div style="width: 46px; height: 46px; background: #f59e0b; color: white; border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 15px rgba(245, 158, 11, 0.3); flex-shrink: 0; animation: scale-pulse 2s infinite;">
                ${icon('bike', 22)}
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-size: 10px; font-weight: 900; background: rgba(245, 158, 11, 0.15); color: #d97706; padding: 4px 10px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.05em;">CO-RETIROS OPTIMIZADOS</span>
                  <div style="width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; animation: blink 1.2s infinite;"></div>
                </div>
                <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 900; color: var(--color-text-primary); letter-spacing: -0.01em;">¡Aprovechá tu viaje a ${suggestedOrders[0].comercioName || 'el local'}!</h4>
                <p style="margin: 0 0 16px 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.45; font-weight: 600;">Hay ${suggestedOrders.length} ${suggestedOrders.length === 1 ? 'pedido disponible' : 'pedidos disponibles'} en este negocio. ¡Sumalos a tu ruta para optimizar tu tiempo y ganancias!</p>
                
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  ${suggestedOrders.map(so => `
                    <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 12px; transition: all 0.3s; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
                      <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: 900; color: var(--color-text-primary);">#${so.orderId}</span>
                        <span style="font-size: 14px; font-weight: 900; color: #10b981;">+ ${formatPrice(so.deliveryCost || 0)}</span>
                      </div>
                      
                      <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary);">
                        <span style="flex-shrink: 0; color: var(--color-text-tertiary);">${icon('mapPin', 14)}</span>
                        <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1;">${so.deliveryAddress}</span>
                      </div>
                      
                      <button class="btn add-suggested-order-btn" 
                              data-id="${so.id}" 
                              style="width: 100%; height: 42px; border-radius: 12px; border: none; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; font-size: 12px; font-weight: 900; letter-spacing: 0.02em; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 6px 15px rgba(245, 158, 11, 0.2); transition: all 0.3s;">
                        ${icon('plusCircle', 14)} SUMAR A MI RUTA
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        ` : '';

        container.innerHTML = `
          <div class="route-manager-v4" style="display: flex; flex-direction: column; gap: 20px; padding-bottom: 40px;">
            ${suggestedCardHtml}

            <div style="background:var(--color-bg-card); border-radius:32px; padding:28px; border:1px solid var(--color-border-light); box-shadow:var(--shadow-xl); position:relative; overflow:hidden;">
              <div style="position:absolute; top:0; left:0; width:6px; height:100%; background:var(--color-primary); opacity:0.4;"></div>
              
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:28px;">
                <div style="display:flex; align-items:center; gap:14px;">
                  <div style="width:44px; height:44px; background:rgba(var(--color-primary-rgb), 0.1); color:var(--color-primary); border-radius:14px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.1);">
                    ${icon('route', 24)}
                  </div>
                  <div>
                    <h3 style="font-family:var(--font-display); font-size:20px; font-weight:900; margin:0; letter-spacing:-0.03em;">Hoja de Ruta</h3>
                    <div style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.08em; opacity:0.8;">Secuencia de logística</div>
                  </div>
                </div>
                <span style="background:var(--color-bg-secondary); color:var(--color-text-primary); padding:6px 14px; border-radius:12px; font-weight:900; font-size:11px; border:1px solid var(--color-border-light);">${orders.length} PEDIDOS</span>
              </div>
              
              <div class="timeline-container" style="position:relative; padding-left:38px;">
                <div style="position:absolute; left:9px; top:15px; bottom:15px; width:2px; background:linear-gradient(to bottom, var(--color-primary), var(--color-border-light)); border-radius:4px; opacity:0.2;"></div>
                
                ${stops.map((stop, idx) => {
                  const isActive = !stop.pickedUp && (idx === 0 || stops[idx-1].pickedUp);
                  const stopKey = (stop.type + '_' + (stop.type === 'PICKUP' ? stop.docId : stop.address)).replace(/[^a-zA-Z0-9]/g, '_');
                  container._expandedStops = container._expandedStops || new Set();
                  const isExpanded = container._expandedStops.has(stopKey);

                  const firstOrder = stop.orders?.[0];
                  const isTrip = stop.orders?.some(o => o.isTrip);
                  let stopColor = '#10b981'; // Green default for standard order delivery
                  if (isTrip) {
                    stopColor = '#3b82f6'; // Blue for trips
                  } else if (firstOrder?.isFavor) {
                    stopColor = getFavorTypeMeta(firstOrder.favorType).color;
                  } else if (stop.type === 'PICKUP') {
                    stopColor = '#7c3aed'; // Purple default for standard commerce pickup
                  }
                  const stopRgb = getRgbString(stopColor);

                  return `
                  <div class="stop-item" style="position:relative; margin-bottom:36px; animation: slide-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; animation-delay: ${idx * 0.1}s; opacity:0;">
                    <!-- Timeline Dot -->
                    <div style="position:absolute; left:-38px; top:8px; width:20px; height:20px; border-radius:50%; background:${stop.pickedUp ? '#10b981' : (isActive ? stopColor : 'var(--color-border-light)')}; border:4px solid var(--color-bg-card); z-index:2; box-shadow:0 6px 15px rgba(0,0,0,0.12); transition:all 0.4s;">
                      ${isActive ? `<div style="position:absolute; inset:-8px; border-radius:50%; border:2.5px solid ${stopColor}; opacity:0.4; animation: pulse-dot 2s infinite;"></div>` : ''}
                    </div>
                    
                    <div style="background:${isActive ? 'var(--color-bg)' : 'rgba(var(--color-bg-secondary-rgb), 0.5)'}; border:${isActive ? '2.5px' : '1.5px'} solid ${isActive ? stopColor : stopColor + '44'}; border-radius:26px; padding:24px; transition:all 0.4s; ${isActive ? `box-shadow: 0 15px 40px rgba(${stopRgb}, 0.12);` : ''}">
                      
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                        <div>
                          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <span style="font-size:10px; font-weight:900; text-transform:uppercase; color:${isActive ? stopColor : 'var(--color-text-tertiary)'}; letter-spacing:0.1em;">
                              ${(() => {
                                const hasTrip = (stop.orders || []).some(o => o.isTrip);
                                if (hasTrip) {
                                  return stop.type === 'PICKUP' ? 'Punto de Encuentro' : 'Destino del Viaje';
                                }
                                return stop.type === 'PICKUP' ? 'Punto de Retiro' : 'Punto de Entrega';
                              })()}
                            </span>
                            ${isActive ? `<div style="background:var(--color-primary); width:6px; height:6px; border-radius:50%; animation: blink 1s infinite;"></div>` : ''}
                          </div>
                          <h4 style="margin:0; font-size:18px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.02em;">
                            ${stop.type === 'PICKUP' ? stop.comercioName : stop.userName}
                          </h4>
                          ${(() => {
                            if (stop.type === 'DROP_OFF') return '';
                            const orderTypes = Array.from(new Set((stop.orders || []).map(o => {
                              if (o.isTrip) return 'viaje';
                              if (o.isFavor) {
                                if (o.favorType === 'gocash') return 'go cash';
                                if (o.favorType === 'pagodeservicios') return 'pago de servicios';
                                if (o.favorType === 'mandado') return 'encomienda';
                                if (o.favorType === 'compra') return 'mandado';
                                return 'encomienda';
                              }
                              return 'comercio';
                            })));
                            return `
                              <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; margin-bottom:2px;">
                                ${orderTypes.map(t => {
                                  let bg = '', border = '', color = '', iconName = '', label = '';
                                  if (t === 'pago de servicios') {
                                    bg = 'rgba(217, 119, 6, 0.12)';
                                    border = '1px solid rgba(217, 119, 6, 0.25)';
                                    color = '#d97706';
                                    iconName = 'creditCard';
                                    label = 'Pago de Servicio';
                                  } else if (t === 'mandado') {
                                    bg = 'rgba(244, 63, 94, 0.12)';
                                    border = '1px solid rgba(244, 63, 94, 0.25)';
                                    color = '#e11d48';
                                    iconName = 'shoppingBag';
                                    label = 'Mandado';
                                  } else if (t === 'encomienda') {
                                    bg = 'rgba(16, 185, 129, 0.12)';
                                    border = '1px solid rgba(16, 185, 129, 0.25)';
                                    color = '#059669';
                                    iconName = 'package';
                                    label = 'Encomienda';
                                  } else if (t === 'go cash') {
                                    bg = 'rgba(59, 130, 246, 0.12)';
                                    border = '1px solid rgba(59, 130, 246, 0.25)';
                                    color = '#2563eb';
                                    iconName = 'dollarSign';
                                    label = 'Go Cash';
                                  } else if (t === 'viaje') {
                                    bg = 'rgba(236, 72, 153, 0.12)';
                                    border = '1px solid rgba(236, 72, 153, 0.25)';
                                    color = '#db2777';
                                    iconName = 'navigation';
                                    label = 'Viaje';
                                  } else {
                                    bg = 'rgba(139, 92, 246, 0.12)';
                                    border = '1px solid rgba(139, 92, 246, 0.25)';
                                    color = '#7c3aed';
                                    iconName = 'shoppingCart';
                                    label = 'Comercio';
                                  }
                                  return `
                                    <span style="background:${bg}; border:${border}; color:${color}; padding:4px 10px; border-radius:10px; font-size:9.5px; font-weight:900; text-transform:uppercase; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:4px; flex-shrink:0;">
                                      ${icon(iconName, 11)} ${label}
                                    </span>
                                  `;
                                }).join('')}
                              </div>
                            `;
                          })()}
                        </div>
                        ${stop.pickedUp ? `
                          <div style="background:rgba(34, 197, 94, 0.12); color:var(--color-success); padding:5px 12px; border-radius:10px; font-size:10px; font-weight:900; display:flex; align-items:center; gap:6px; letter-spacing:0.02em;">
                            ${icon('check', 14)} COMPLETADO
                          </div>
                        ` : ''}
                      </div>
                      
                      <div style="font-size:13px; color:var(--color-text-secondary); margin-bottom:12px; display:flex; align-items:center; gap:8px; font-weight:700; opacity:0.9;">
                        <div style="color:var(--color-primary); opacity:0.7;">${icon('mapPin', 16)}</div>
                        <span>${stop.address}</span>
                      </div>
                      ${stop.type === 'DROP_OFF' ? `
                        <div style="margin-top: -4px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 8px;">
                          ${stop.orders.map(o => `
                            <div style="display: flex; flex-direction: column; gap: 6px; background: rgba(var(--color-primary-rgb, 79, 70, 229), 0.03); border: 1.5px solid var(--color-border-light); padding: 12px; border-radius: 16px;">
                              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12.5px; font-weight: 750;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                  <span style="color: var(--color-text-tertiary); font-size: 11px; text-transform: uppercase;">Pago:</span>
                                  <span style="color: ${o.paymentMethod === 'mercadopago' ? '#009EE3' : '#22C55E'}; font-weight: 900; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
                                    ${o.paymentMethod === 'mercadopago' ? '💳 Transferencia' : '💵 Efectivo'}
                                  </span>
                                </div>
                                ${o.isScheduled ? `
                                  <span style="background: rgba(139, 92, 246, 0.12); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 6px; padding: 2px 6px; font-size: 9.5px; font-weight: 900; text-transform: uppercase; display: flex; align-items: center; gap: 2px;">
                                    📅 ${o.scheduledTime}
                                  </span>
                                ` : ''}
                              </div>
                              ${o.addressNotes ? `
                                <div style="display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.4;">
                                  <span style="color: var(--color-text-tertiary); font-size: 11px; text-transform: uppercase; margin-top: 2px;">Ref:</span>
                                  <span style="background: var(--color-bg-secondary); padding: 4px 8px; border-radius: 8px; border: 1px solid var(--color-border-light); flex: 1;">
                                    ${o.addressNotes}
                                  </span>
                                </div>
                              ` : `
                                <div style="font-size: 12.5px; color: var(--color-text-tertiary); font-style: italic; font-weight: 600;">Sin referencia de ubicación</div>
                              `}
                            </div>
                          `).join('')}
                        </div>
                      ` : ''}

                      <!-- Collapsible Stop Details -->
                      ${stop.type === 'PICKUP' ? `
                        <!-- Toggle Button -->
                        <button class="toggle-stop-details-btn ${isExpanded ? 'active' : ''}" data-key="${stopKey}" style="margin-bottom: ${isExpanded ? '12px' : '0'};">
                          ${icon('chevronDown', 14)}
                          <span>${isExpanded ? 'Ocultar detalle de pedido' : 'Mostrar detalle de pedido'}</span>
                        </button>

                        <div class="collapsible-stop-details ${isExpanded ? 'expanded' : ''}" id="details-${stopKey}" style="background:var(--color-bg-secondary); border-radius:20px; padding:18px; border:1px solid var(--color-border-light); display:flex; flex-direction:column; gap:10px;">
                          ${!stop.isFavor ? `
                            <!-- Commerce Order Details (Single or Batch) -->
                            <div style="display:flex; flex-direction:column; gap:8px; text-align:left; width:100%;">
                              <div style="font-size:9.5px; font-weight:900; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">Detalle del Pedido de Comercio</div>
                              ${stop.orders.map(o => `
                                <div style="background:rgba(var(--color-primary-rgb, 225,29,72),0.02); border:1px solid var(--color-border-light); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:6px;">
                                  <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:800; color:var(--color-text-primary);">
                                    <span>Pedido #${o.orderId || '---'}</span>
                                    <span>${formatPrice(o.subtotal || 0)}</span>
                                  </div>
                                  ${o.items && o.items.length > 0 ? `
                                    <div style="font-size:12px; color:var(--color-text-secondary); margin-top:2px; font-weight:600; padding-left:8px; border-left:2px solid var(--color-primary); display:flex; flex-direction:column; gap:4px;">
                                      ${o.items.map(item => `
                                        <div style="display:flex; flex-direction:column; gap:1px; text-align:left;">
                                          <div style="color:var(--color-text-primary);"><span style="color:var(--color-primary); font-weight:800;">${item.qty || 1}x</span> ${item.name}</div>
                                          ${item.options && item.options.length > 0 ? `
                                            <div style="font-size:10.5px; color:var(--color-primary); font-weight:700; padding-left:8px; margin-top:1px; text-align:left;">
                                              Sabores: ${item.options.map(opt => `${opt.qty > 1 ? `${opt.qty}x ` : ''}${opt.name}`).join(', ')}
                                            </div>
                                          ` : ''}
                                        </div>
                                      `).join('')}
                                    </div>
                                  ` : `
                                    <div style="font-size:11.5px; color:var(--color-text-tertiary); font-style:italic;">
                                      Pedido en ${o.comercioName || 'Comercio'}
                                    </div>
                                  `}
                                </div>
                              `).join('')}
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px dashed var(--color-border-light); width:100%;">
                              <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">A abonar al comercio:</span>
                              <span style="font-size:18px; color:var(--color-primary); font-weight:950; letter-spacing:-0.02em;">${formatPrice(stop.amountToPay)}</span>
                            </div>
                          ` : `
                            <!-- GoFavor (Single or Batch) -->
                            <div style="background:rgba(var(--color-primary-rgb),0.05); border-radius:14px; padding:12px; border:1px dashed rgba(var(--color-primary-rgb),0.3); display:flex; flex-direction:column; gap:8px; text-align:left; width:100%;">
                              <div style="font-size:9px; font-weight:850; color:${getFavorTypeMeta(stop.orders[0].favorType).textColor}; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px; text-align:left;">${getFavorTypeMeta(stop.orders[0].favorType).headerText}</div>
                              ${(() => {
                                const order = stop.orders[0];
                                const details = order.details || '';
                                const stores = parseFavorDetails(details);
                                const storePrices = order.storePrices || {};
                                if (stores.length > 0) {
                                  return stores.map(st => `
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:13px; font-weight:600; color:var(--color-text-secondary); line-height:1.4; border-bottom:1.5px solid var(--color-border-light); padding-bottom:6px; margin-bottom:2px;">
                                      <div style="display:flex; flex-direction:column; gap:2px; text-align:left; align-items:flex-start; flex:1; padding-right:8px;">
                                        <strong style="color:var(--color-text-primary); font-weight:800;">${st.name}</strong>
                                        <span style="font-size:11.5px; color:var(--color-text-secondary); font-weight:500;">${st.items}</span>
                                      </div>
                                      ${storePrices[st.name] ? `<span style="font-weight:900; color:var(--color-text-primary); margin-left:12px; white-space:nowrap;">${formatPrice(storePrices[st.name])}</span>` : ''}
                                    </div>
                                  `).join('');
                                } else {
                                  return formatFavorDetailsHTML(details);
                                }
                              })()}
                            </div>
                            ${!stop.isFavor ? `
                              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                                <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">A abonar al comercio:</span>
                                <span style="font-size:16px; color:var(--color-primary); font-weight:900; letter-spacing:-0.02em;">${formatPrice(stop.amountToPay)}</span>
                              </div>
                            ` : ''}
                          `}
                        </div>
                      ` : `
                        <!-- Toggle Button -->
                        <button class="toggle-stop-details-btn ${isExpanded ? 'active' : ''}" data-key="${stopKey}" style="margin-bottom: ${isExpanded ? '12px' : '0'};">
                          ${icon('chevronDown', 14)}
                          <span>${isExpanded ? 'Ocultar detalle de entrega' : 'Mostrar detalle de entrega'}</span>
                        </button>

                        <div class="collapsible-stop-details ${isExpanded ? 'expanded' : ''}" id="details-${stopKey}" style="background:var(--color-bg-secondary); border-radius:20px; padding:18px; border:1px solid var(--color-border-light); display:flex; flex-direction:column; gap:10px;">
                          <div style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Desglose de Cobro</div>
                          ${stop.orders.map(o => `
                            <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                              <span style="color:var(--color-text-secondary); opacity:0.8;">Pedido #${o.orderId} (${o.isFavor ? (o.favorType === 'gocash' ? 'Go Cash' : (o.favorType === 'mandado' ? 'Mandado' : 'Compra')) : (o.comercioName || 'Pedido')})</span>
                              <span style="color:var(--color-text-primary);">${formatPrice(o.subtotal || 0)}</span>
                            </div>
                          `).join('')}
                          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600; padding-top:8px; border-top:1px dashed var(--color-border-light);">
                            <span style="color:var(--color-text-secondary); opacity:0.8;">Costo de Envío</span>
                            <span style="color:var(--color-text-primary);">${formatPrice(stop.orders.reduce((s, o) => s + (o.deliveryCost || 0), 0))}</span>
                          </div>
                          ${(() => {
                            const totalTips = stop.orders.reduce((s, o) => s + (o.tip || 0), 0);
                            if (totalTips > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600; color: #10b981;">
                                  <span>Propina al Repartidor</span>
                                  <span>+ ${formatPrice(totalTips)}</span>
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                            <span style="color:var(--color-text-secondary); opacity:0.8;">Tarifa de Uso App</span>
                            <span style="color:var(--color-text-primary);">${formatPrice(stop.orders.reduce((s, o) => s + (o.appUsageFee || 0), 0))}</span>
                          </div>
                          ${stop.orders.some(o => o.isFavor && o.favorType === 'compra') ? `
                            <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                              <span style="color:var(--color-text-secondary); opacity:0.8;">Gestión Especial</span>
                              <span style="color:var(--color-text-primary);">${formatPrice(stop.orders.reduce((s, o) => s + (o.purchaseFee || 800), 0))}</span>
                            </div>
                          ` : ''}
                          ${(() => {
                            const totalExtraStops = stop.orders.reduce((s, o) => s + (o.extraStopsFee || 0), 0);
                            if (totalExtraStops > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                                  <span style="color:var(--color-text-secondary); opacity:0.8;">Paradas Extra</span>
                                  <span style="color:var(--color-text-primary);">${formatPrice(totalExtraStops)}</span>
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          ${(() => {
                            const totalDiscount = stop.orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
                            if (totalDiscount > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-success);">
                                  <span style="display:flex; align-items:center; gap:4px;">${icon('sparkles', 12)} Descuento GoPoints</span>
                                  <span>- ${formatPrice(totalDiscount)}</span>
                                </div>
                                <div style="font-size:10px; color:#f59e0b; font-weight:700; margin-top:4px; margin-bottom:8px; line-height:1.3; text-align:right;">
                                  El descuento es absorbido por GO Delivery y se descontará de tu deuda de la app.
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          ${(() => {
                            const totalCouponDiscount = stop.orders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
                            const couponCodes = stop.orders.filter(o => o.couponCode).map(o => o.couponCode);
                            if (totalCouponDiscount > 0 || couponCodes.length > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:#a855f7; background: rgba(168, 85, 247, 0.06); padding: 8px 12px; border-radius: 12px; border: 1px dashed rgba(168, 85, 247, 0.25); margin-top: 4px; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;">
                                  <span style="display:flex; align-items:center; gap:4px; min-width: 0; flex: 1; text-align: left;">
                                    ${icon('tag', 12)}
                                    <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">Cupón: ${couponCodes.join(', ') || 'Promo'}</span>
                                  </span>
                                  <span style="flex-shrink: 0; white-space: nowrap;">- ${formatPrice(totalCouponDiscount)}</span>
                                </div>
                                <div style="font-size:10px; color:#a855f7; font-weight:700; margin-top:4px; margin-bottom:8px; line-height:1.3; display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                  <span style="display:flex; align-items:center; gap:4px;">
                                    ${icon('info', 12)} Absorbido por GO Delivery. Se descontará de tu deuda.
                                  </span>
                                  <button class="coupon-info-btn" data-discount="${totalCouponDiscount}" style="background:rgba(168, 85, 247, 0.1); border:none; color:#a855f7; font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:2px; flex-shrink:0;">
                                    Info
                                  </button>
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:12px; border-top:1.5px solid var(--color-border-light);">
                            <span style="font-size:12px; color:var(--color-text-primary); font-weight:900; text-transform:uppercase;">TOTAL A COBRAR</span>
                            <span style="font-size:18px; color:var(--color-text-primary); font-weight:900; letter-spacing:-0.03em;">${formatPrice(stop.orders.reduce((s, o) => s + (o.total || 0), 0))}</span>
                          </div>
                          ${stop.orders.some(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios')) ? `
                            <button class="btn edit-favor-price-btn" 
                                    data-id="${stop.orders.find(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios')).id}"
                                    style="width:100%; height:42px; border-radius:14px; background:rgba(var(--color-primary-rgb),0.1); border:1px solid rgba(var(--color-primary-rgb),0.2); color:var(--color-primary); font-size:12px; font-weight:900; margin-top:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                              ${icon('edit', 14)} ${stop.orders.some(o => o.favorType === 'pagodeservicios') ? 'Cargar valor de servicios' : 'Cargar valor de productos'}
                            </button>
                          ` : ''}
                        </div>
                      `}

                      <!-- Actions: Two rows -->
                      <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                        <!-- Row 1: Utility Buttons (Equal size) -->
                        <div style="display:flex; gap:8px; align-items:center; height:48px; width:100%;">
                          <button class="btn view-active-map-btn" 
                                  data-id="${stop.type === 'PICKUP' ? stop.docId : stop.orders[0].id}" 
                                  ${stop.type === 'PICKUP' && stop.pickedUp ? 'disabled' : ''}
                                  style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:none; background:rgba(var(--color-primary-rgb), 0.15); color:var(--color-primary); transition:all 0.3s; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.1); ${stop.type === 'PICKUP' && stop.pickedUp ? 'opacity:0.45; cursor:not-allowed; box-shadow:none;' : ''}">
                            ${icon('navigationArrow', 26)} 
                          </button>

                          ${(() => {
                            const isManualStop = stop.orders && stop.orders[0] && stop.orders[0].isManual === true;
                            if (stop.type === 'DROP_OFF') {
                              return !isManualStop ? `
                                <button class="btn chat-client-btn" data-order-id="${stop.orders[0].id}" data-order-num="${stop.orders[0].orderId}" data-client-name="${stop.userName}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-primary); transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('chat', 20)}</button>
                                <button class="btn whatsapp-client-btn" data-phone="${stop.orders[0].userPhone || ''}" data-client-name="${stop.userName}" data-order-num="${stop.orders[0].orderId}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:#25d366; transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('whatsapp', 20)}</button>
                              ` : `
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin chat">${icon('chat', 20)}</button>
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin WhatsApp">${icon('whatsapp', 20)}</button>
                              `;
                            } else {
                              return !isManualStop ? `
                                <button class="btn chat-client-btn" data-order-id="${stop.orders[0].id}" data-order-num="${stop.orders[0].orderId}" data-client-name="${stop.orders[0].userName || 'Cliente'}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-primary); transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('chat', 20)}</button>
                                <button class="btn whatsapp-client-btn" data-phone="${stop.orders[0].userPhone || ''}" data-client-name="${stop.orders[0].userName || 'Cliente'}" data-order-num="${stop.orders[0].orderId}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:#25d366; transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('whatsapp', 20)}</button>
                              ` : `
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin chat">${icon('chat', 20)}</button>
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin WhatsApp">${icon('whatsapp', 20)}</button>
                              `;
                            }
                          })()}
                          <button class="btn delivery-support-order-btn" data-order-id="${stop.orders[0].id}" data-order-num="${stop.orders[0].orderId}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-primary); transition:all 0.3s; box-shadow: var(--shadow-sm);" title="Soporte Técnico">${icon('headset', 20)}</button>
                        </div>

                        <!-- Row 2: Main Action Button (Spans full width) -->
                        <div style="width:100%;">
                          ${stop.type === 'PICKUP' ? (() => {
                            const isDigitalReceipt = stop.orders.some(o => o.favorType === 'pagodeservicios' && o.details?.includes('Foto Digital por Chat'));
                            return `
                              <button class="btn mark-picked-up-btn" 
                                      data-id="${stop.docId}" 
                                      data-istrip="${stop.isFavor ? 'false' : stop.orders.some(o => o.isTrip)}"
                                      data-isdigitalreceipt="${isDigitalReceipt}"
                                      ${stop.pickedUp ? 'disabled' : ''}
                                      style="width:100%; height:48px; font-size:13.5px; font-weight:900; border-radius:16px; border:none; color:white; background:${stop.pickedUp ? 'var(--color-success)' : 'var(--color-primary)'}; box-shadow: ${stop.pickedUp ? 'none' : '0 8px 20px rgba(var(--color-primary-rgb), 0.2)'}; transition:all 0.3s; ${stop.pickedUp ? 'opacity:0.6;' : ''} display:flex; align-items:center; justify-content:center; gap:8px; white-space:nowrap; letter-spacing:0.02em;">
                                ${stop.pickedUp ? icon('check', 16) : (stop.orders.some(o => o.isTrip) ? icon('user', 16) : (isDigitalReceipt ? icon('checkCircle', 16) : icon('package', 16)))} 
                                ${stop.pickedUp ? (stop.orders.some(o => o.isTrip) ? 'EN VIAJE' : 'RETIRADO') : (stop.orders.some(o => o.isTrip) ? 'PASAJERO A BORDO' : (isDigitalReceipt ? 'PAGADO' : 'RETIRAR'))}
                              </button>
                            `;
                          })() : ''}
                          
                          ${stop.type === 'DROP_OFF' ? `
                            ${(() => {
                              const hasNotifiedAtDoor = stop.orders.every(o => o.isAtDoor);
                              const allPickedUp = stop.orders.every(o => !!o.pickedUpAt);
                              const isTrip = stop.orders.some(o => o.isTrip);
                              const isPagoServiciosDigital = stop.orders.some(o => o.favorType === 'pagodeservicios' && o.receiptDeliveryType === 'digital');

                              const isManualStop = stop.orders.some(o => o.isManual === true);

                              if (!isTrip && !hasNotifiedAtDoor && !isPagoServiciosDigital && !isManualStop) {
                                return `
                                  <button class="btn notify-at-door-btn" 
                                          data-ids="${stop.orders.map(o => o.id).join(',')}" 
                                          ${!allPickedUp ? 'disabled' : ''}
                                          style="width:100%; height:48px; font-size:13px; font-weight:900; border-radius:16px; border:none; color:white; background:#f59e0b; box-shadow: ${!allPickedUp ? 'none' : '0 8px 20px rgba(245, 158, 11, 0.25)'}; transition:all 0.3s; ${!allPickedUp ? 'opacity:0.4;' : ''} display:flex; align-items:center; justify-content:center; gap:6px; letter-spacing:0.02em;">
                                    ${icon('bell', 14)} AVISAR AFUERA
                                  </button>
                                `;
                              } else {
                                return `
                                  <button class="btn mark-delivered-btn" 
                                          data-ids="${stop.orders.map(o => o.id).join(',')}" 
                                          data-codes="${stop.orders.map(o => o.verificationCode).join(',')}"
                                          data-istrip="${isTrip}"
                                          ${!allPickedUp ? 'disabled' : ''}
                                          style="width:100%; height:48px; font-size:13px; font-weight:900; border-radius:16px; border:none; color:white; background:var(--color-success); box-shadow: ${!allPickedUp ? 'none' : '0 8px 20px rgba(34, 197, 94, 0.25)'}; transition:all 0.3s; ${!allPickedUp ? 'opacity:0.4;' : ''} display:flex; align-items:center; justify-content:center; gap:6px; letter-spacing:0.02em;">
                                    ${icon('checkCircle', 14)} ${isTrip ? 'FINALIZAR VIAJE' : (stop.orders.some(o => o.favorType === 'gocash') ? 'FINALIZAR GO CASH' : 'ENTREGAR')}
                                  </button>
                                `;
                              }
                            })()}
                          ` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                `}).join('')}
              </div>
            </div>
            
            <style>
              .collapsible-stop-details {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, margin 0.3s ease;
                opacity: 0;
              }
              .collapsible-stop-details.expanded {
                max-height: 1000px;
                opacity: 1;
                margin-top: 10px;
                margin-bottom: 12px;
              }
              .toggle-stop-details-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                background: var(--color-bg-secondary);
                border: 1px solid var(--color-border-light);
                padding: 10px 14px;
                border-radius: 16px;
                font-size: 12px;
                font-weight: 800;
                color: var(--color-text-secondary);
                cursor: pointer;
                margin-top: 10px;
                margin-bottom: 12px;
                transition: all 0.2s ease;
                width: 100%;
              }
              .toggle-stop-details-btn:hover {
                background: var(--color-border-light);
                color: var(--color-text-primary);
              }
              .toggle-stop-details-btn svg {
                transition: transform 0.3s ease;
              }
              .toggle-stop-details-btn.active svg {
                transform: rotate(180deg);
              }

              @keyframes pulse-border {
                0%, 100% { border-color: rgba(245, 158, 11, 0.4); box-shadow: 0 10px 25px rgba(245, 158, 11, 0.05); }
                50% { border-color: rgba(245, 158, 11, 0.8); box-shadow: 0 10px 25px rgba(245, 158, 11, 0.15); }
              }
              @keyframes scale-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.06); }
              }
              @keyframes pulse-dot { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }
              @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
              @keyframes slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            </style>
          </div>
        `;

        // Attach action event listeners
        container.querySelectorAll('.toggle-stop-details-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const collapsible = container.querySelector(`#details-${key}`);
            const btnText = btn.querySelector('span');
            const isPickup = key.startsWith('PICKUP');
            
            if (container._expandedStops.has(key)) {
              container._expandedStops.delete(key);
              collapsible?.classList.remove('expanded');
              btn.classList.remove('active');
              btn.style.marginBottom = '0';
              if (btnText) btnText.textContent = isPickup ? 'Mostrar detalle de pedido' : 'Mostrar detalle de entrega';
            } else {
              container._expandedStops.add(key);
              collapsible?.classList.add('expanded');
              btn.classList.add('active');
              btn.style.marginBottom = '12px';
              if (btnText) btnText.textContent = isPickup ? 'Ocultar detalle de pedido' : 'Ocultar detalle de entrega';
            }
          });
        });

        container.querySelectorAll('.add-suggested-order-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            showConfirm({
              title: '¿Sumar pedido recomendado?',
              message: 'Este pedido se retirará del mismo comercio y podrás llevarlo en tu ruta de entrega actual.',
              confirmText: 'SÍ, SUMAR A MI RUTA',
              onConfirm: () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 14, 'animate-spin') + ' SUMANDO...';
                takeBatch(btn.dataset.id, user, null, btn);
              }
            });
          });
        });

        container.querySelectorAll('.mark-picked-up-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const isTrip = btn.dataset.istrip === 'true';
            const isDigitalReceipt = btn.dataset.isdigitalreceipt === 'true';

            if (isDigitalReceipt) {
              showConfirm({
                title: '¿Confirmar Pago de Servicio?',
                message: 'Confirmá que realizaste el pago del servicio para proceder a tomarle una foto al recibo/comprobante de pago.',
                confirmText: 'Confirmar y Abrir Cámara',
                onConfirm: async () => {
                  btn.disabled = true;
                  btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Abriendo cámara...';
                  
                  const handleDigitalReceiptUpload = async (file) => {
                    btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Subiendo comprobante...';
                    try {
                      const orderId = btn.dataset.id;
                      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                      const { storage } = await import('../firebase.js');

                      // 1. Add uploading placeholder to chat
                      const msgRef = await addDoc(collection(db, 'orders', orderId, 'messages'), {
                        senderId: user.uid,
                        senderName: user.displayName || user.name || 'Repartidor',
                        text: 'Subiendo comprobante...',
                        type: 'image',
                        status: 'uploading',
                        createdAt: serverTimestamp()
                      });

                      // 2. Upload file
                      const fileRef = ref(storage, `chats/${orderId}/${Date.now()}_comprobante.jpg`);
                      const metadata = { contentType: file.type || 'image/jpeg' };
                      await uploadBytes(fileRef, file, metadata);
                      const url = await getDownloadURL(fileRef);

                      // 3. Update chat message
                      await updateDoc(msgRef, {
                        text: '',
                        imageUrl: url,
                        status: 'ready'
                      });

                      // 4. Mark order as picked up
                      await markAsPickedUp(orderId);

                      // 5. Send message requesting verification code to client
                      await addDoc(collection(db, 'orders', orderId, 'messages'), {
                        senderId: 'system',
                        senderName: 'GoDelivery',
                        text: `⚠️ **Código de Entrega Solicitado**\n\nEl repartidor ha subido la foto del comprobante de pago de tu servicio.\n\nPor favor, facilítale el **Código de Entrega de 4 dígitos** que ves en tu pantalla de seguimiento para que pueda finalizar el pedido.`,
                        createdAt: serverTimestamp(),
                        type: 'system'
                      });

                      showToast('¡Comprobante enviado y pedido marcado como pagado!', 'success');
                    } catch (err) {
                      console.error('Digital receipt upload error:', err);
                      showToast('Error al subir el comprobante: ' + err.toString(), 'error');
                      btn.disabled = false;
                      btn.innerHTML = icon('checkCircle', 16) + ' PAGADO';
                    }
                  };

                  const showPhotoPreviewModal = async (file, onConfirm, onCancel) => {
                    const fileUrl = URL.createObjectURL(file);
                    const overlayEl = document.createElement('div');
                    overlayEl.style.cssText = `
                      position: fixed;
                      top: 0;
                      left: 0;
                      width: 100vw;
                      height: 100vh;
                      background: #090d16;
                      z-index: 999999;
                      display: flex;
                      flex-direction: column;
                      justify-content: space-between;
                      font-family: var(--font-display, 'Outfit', sans-serif);
                      color: white;
                      opacity: 0;
                      transition: opacity 0.3s ease;
                    `;
                    overlayEl.innerHTML = `
                      <!-- Top Translucent Header -->
                      <div style="padding: calc(16px + env(safe-area-inset-top, 16px)) 20px 16px; text-align: center; background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent); z-index: 10;">
                        <h3 style="margin: 0; font-size: 19px; font-weight: 950; letter-spacing: -0.5px; color: white;">Comprobante de Pago</h3>
                        <p style="margin: 4px 0 0; font-size: 12.5px; color: #94a3b8; font-weight: 550;">Asegúrate de que la foto sea totalmente legible</p>
                      </div>

                      <!-- Image Fill Container -->
                      <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; position: relative;">
                        <img src="${fileUrl}" style="width: 100%; height: 100%; object-fit: contain;">
                      </div>

                      <!-- Bottom Translucent Controls -->
                      <div style="padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)); background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0)); display: grid; grid-template-columns: 1fr 1fr; gap: 16px; z-index: 10; width: 100%; box-sizing: border-box;">
                        <button id="cancel-preview-btn" style="height: 54px; border-radius: 18px; background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); color: white; border: 1.5px solid rgba(255,255,255,0.15); font-weight: 900; cursor: pointer; text-transform: uppercase; font-size: 14px; transition: all 0.2s;">
                          Cancelar
                        </button>
                        <button id="upload-preview-btn" style="height: 54px; border-radius: 18px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; border: none; font-weight: 950; cursor: pointer; text-transform: uppercase; font-size: 14px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
                          Subir
                        </button>
                      </div>
                    `;

                    document.body.appendChild(overlayEl);
                    requestAnimationFrame(() => {
                      overlayEl.style.opacity = '1';
                    });

                    overlayEl.querySelector('#cancel-preview-btn').onclick = () => {
                      URL.revokeObjectURL(fileUrl);
                      overlayEl.style.opacity = '0';
                      setTimeout(() => {
                        overlayEl.remove();
                        if (onCancel) onCancel();
                      }, 300);
                    };

                    overlayEl.querySelector('#upload-preview-btn').onclick = () => {
                      URL.revokeObjectURL(fileUrl);
                      overlayEl.style.opacity = '0';
                      setTimeout(() => {
                        overlayEl.remove();
                        if (onConfirm) onConfirm();
                      }, 300);
                    };
                  };

                  const startCameraCapture = async () => {
                    const resetBtnState = () => {
                      btn.disabled = false;
                      btn.innerHTML = icon('checkCircle', 16) + ' PAGADO';
                    };

                    try {
                      const { Capacitor } = await import('@capacitor/core');
                      if (Capacitor.isNativePlatform()) {
                        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
                        const photo = await Camera.getPhoto({
                          quality: 85,
                          allowEditing: false,
                          resultType: CameraResultType.Uri,
                          source: CameraSource.Camera
                        });
                        const response = await fetch(photo.webPath);
                        const blob = await response.blob();
                        const file = new File([blob], `comprobante_${Date.now()}.jpg`, { type: 'image/jpeg' });
                        await showPhotoPreviewModal(file, () => handleDigitalReceiptUpload(file), resetBtnState);
                      } else {
                        // Create web input element dynamically
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.setAttribute('capture', 'environment');
                        input.onchange = async (e) => {
                          const file = e.target.files[0];
                          if (file) {
                            await showPhotoPreviewModal(file, () => handleDigitalReceiptUpload(file), resetBtnState);
                          } else {
                            resetBtnState();
                          }
                        };
                        input.click();
                      }
                    } catch (err) {
                      console.warn('Capacitor camera error, falling back to input file click', err);
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = async (e) => {
                        const file = e.target.files[0];
                        if (file) {
                          await showPhotoPreviewModal(file, () => handleDigitalReceiptUpload(file), resetBtnState);
                        } else {
                          resetBtnState();
                        }
                      };
                      input.click();
                    }
                  };

                  await startCameraCapture();
                }
              });
              return;
            }

            showConfirm({
              title: isTrip ? '¿Confirmar Inicio de Viaje?' : '¿Confirmar Retiro?',
              message: isTrip ? 'Confirmá que el pasajero ya está a bordo para iniciar el trayecto.' : 'Asegurate de haber recibido todos los productos del local.',
              confirmText: isTrip ? 'Iniciar Viaje' : 'Sí, retirar',
              onConfirm: async () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Actualizando...';
                await markAsPickedUp(btn.dataset.id);
                
                const firstId = btn.dataset.id.split(',')[0];
                const order = orders.find(o => o.id === firstId);
                if (order && order.isFavor && order.favorType === 'compra') {
                  showEditFavorPriceModal(order, true);
                }
              }
            });
          });
        });

        container.querySelectorAll('.notify-at-door-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const ids = btn.dataset.ids.split(',');
            
            // Check if any order is GoFavor Compra and hasn't loaded product prices
            for (const orderId of ids) {
              const order = orders.find(o => o.id === orderId);
              if (order && order.isFavor && (order.favorType === 'compra' || order.favorType === 'pagodeservicios') && !order.subtotal) {
                showToast(order.favorType === 'pagodeservicios' ? '⚠️ Debes ingresar el valor de las facturas antes de avisar que estás afuera' : '⚠️ Debes ingresar el valor de los productos antes de avisar que estás afuera', 'warning');
                showEditFavorPriceModal(order, true);
                return;
              }
            }

            showConfirm({
              title: '¿Avisar que estás afuera?',
              message: 'Se le enviará una notificación en tiempo real al cliente indicándole que ya te encuentras afuera en la puerta de su domicilio.',
              confirmText: 'Sí, Avisar',
              cancelText: 'Cancelar',
              onConfirm: async () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 14, 'animate-spin') + ' NOTIFICANDO...';
                
                try {
                  for (const orderId of ids) {
                    const order = orders.find(o => o.id === orderId);
                    if (!order) continue;
                    
                    await updateDoc(doc(db, 'orders', orderId), {
                      isAtDoor: true,
                      atDoorAt: serverTimestamp()
                    });
                    
                    if (order.userId) {
                      const codeStr = order.verificationCode ? ` Tené listo tu código de entrega: ${order.verificationCode}` : '';
                      await addDoc(collection(db, 'users', order.userId, 'notifications'), {
                        title: '¡Tu repartidor está en la puerta!',
                        body: order.isFavor 
                          ? `El repartidor llegó con tu favor. ¡Salí a recibirlo!${codeStr}` 
                          : `Prepárate para recibir tu pedido. ¡Ya llegó!${codeStr}`,
                        type: 'system',
                        status: 'unread',
                        createdAt: serverTimestamp()
                      });
                    }
                  }
                  showToast('Cliente notificado', 'success');
                } catch (err) {
                  console.error('Error in notify-at-door:', err);
                  showToast('Error al notificar al cliente', 'danger');
                  btn.disabled = false;
                  btn.innerHTML = icon('bell', 14) + ' AVISAR AFUERA';
                }
              }
            });
          });
        });

        container.querySelectorAll('.mark-delivered-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const ids = btn.dataset.ids.split(',');
            const codes = btn.dataset.codes.split(',');
            const isTrip = btn.dataset.istrip === 'true';

            // Check if it's a GoFavor Compra and hasn't loaded product prices (subtotal is 0 or empty)
            const orderId = ids[0];
            const order = orders.find(o => o.id === orderId);
            if (order && order.isFavor && (order.favorType === 'compra' || order.favorType === 'pagodeservicios') && !order.subtotal) {
              showToast(order.favorType === 'pagodeservicios' ? '⚠️ Debes ingresar el valor de las facturas antes de entregar el pedido' : '⚠️ Debes ingresar el valor de los productos antes de entregar el pedido', 'warning');
              showEditFavorPriceModal(order, true);
              return;
            }

            const noCodeRequired = orders.filter(o => ids.includes(o.id)).some(o => o.isManual === true || o.noCodeRequired === true);
            openSlideToConfirmModal({
              isTrip,
              noCodeRequired,
              codes,
              ids,
              orders,
              onConfirm: async () => {
                showToast(isTrip ? 'Finalizando viaje...' : 'Procesando entrega...', 'info');
                await markAsDelivered(ids);
              }
            });
          });
        });

        container.querySelectorAll('.view-active-map-btn').forEach(btn => {
          const firstId = btn.dataset.id.split(',')[0];
          const order = orders.find(o => o.id === firstId);
          btn.addEventListener('click', () => showDeliveryMapModal(order, orders));
        });

        container.querySelectorAll('.edit-favor-price-btn').forEach(btn => {
          const order = orders.find(o => o.id === btn.dataset.id);
          btn.addEventListener('click', () => showEditFavorPriceModal(order));
        });

        container.querySelectorAll('.btn-save-store-prices').forEach(btn => {
          btn.addEventListener('click', async () => {
            const orderId = btn.dataset.orderId;
            const inputs = container.querySelectorAll(`.store-price-input[data-order-id="${orderId}"]`);
            const storePrices = {};
            inputs.forEach(input => {
              const storeName = input.dataset.storeName;
              const priceVal = parseFloat(input.value) || 0;
              storePrices[storeName] = priceVal;
            });
            
            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = icon('loader', 14, 'animate-spin') + ' GUARDANDO...';
            
            try {
              await saveFavorStorePrices(orderId, storePrices);
              showToast('Precios actualizados correctamente', 'success');
            } catch (err) {
              console.error(err);
              showToast('Error al guardar precios', 'error');
            } finally {
              btn.disabled = false;
              btn.innerHTML = originalText;
            }
          });
        });

        container.querySelectorAll('.chat-client-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const { openChat } = await import('../components/chat.js');
            openChat({ 
              orderId: btn.dataset.orderId, 
              type: 'client-delivery', 
              otherName: btn.dataset.clientName,
              orderNum: btn.dataset.orderNum 
            });
          });
        });

        container.querySelectorAll('.whatsapp-client-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const rawPhone = btn.dataset.phone || '';
            const clientName = btn.dataset.clientName || 'Cliente';
            const orderNum = btn.dataset.orderNum || '';
            if (!rawPhone) {
              showToast('El cliente no posee un número de teléfono configurado.', 'warning');
              return;
            }
            let cleanedPhone = rawPhone.replace(/\D/g, '');
            if (cleanedPhone.startsWith('54')) {
              if (!cleanedPhone.startsWith('549')) {
                cleanedPhone = '549' + cleanedPhone.substring(2);
              }
            } else if (cleanedPhone.startsWith('15')) {
              cleanedPhone = '549' + cleanedPhone.substring(2);
            } else if (!cleanedPhone.startsWith('549') && cleanedPhone.length <= 10) {
              cleanedPhone = '549' + cleanedPhone;
            }
            const msg = encodeURIComponent(`Hola ${clientName}, soy el repartidor de GoDelivery en camino con tu pedido #${orderNum}.`);
            const waUrl = `https://wa.me/${cleanedPhone}?text=${msg}`;
            window.open(waUrl, '_blank');
          });
        });

        container.querySelectorAll('.delivery-support-order-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const orderId = btn.dataset.orderId;
            const orderNum = btn.dataset.orderNum;

            try {
              const { openSupportTicketModal } = await import('../components/support-bot.js');
              await openSupportTicketModal(orderId, orderNum);
            } catch (err) {
              console.error('Error opening support ticket chat:', err);
              import('../components/toast.js').then(t => t.showToast('Error al abrir chat de soporte', 'danger'));
            }
          });
        });
      }

      tabUnsub = () => {
        if (listUnsub) listUnsub();
        if (suggestedUnsub) suggestedUnsub();
      };

    } else if (tab === 'history') {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid),
        where('status', 'in', ['completed', 'cancelled'])
      );

      tabUnsub = onSnapshot(q, (snap) => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        if (orders.length === 0) {
          container.innerHTML = `<div class="empty-state-mini" style="padding: 3rem 1rem;">Aún no tenés entregas terminadas</div>`;
          return;
        }

        const groupedMap = new Map();
        orders.forEach(o => {
          const key = o.bundleId || `single-${o.id}`;
          if (!groupedMap.has(key)) groupedMap.set(key, []);
          groupedMap.get(key).push(o);
        });

        const groups = Array.from(groupedMap.values()).sort((a, b) => 
          (b[0].createdAt?.toMillis() || 0) - (a[0].createdAt?.toMillis() || 0)
        );

        const currentSessionId = getState().user?.currentSessionId;

        container.innerHTML = `
          <div class="delivery-orders-list page-enter">
            ${groups.map(group => {
              const isBundle = group.length > 1;
              const main = group[0];
              const totalAmount = group.reduce((sum, o) => sum + (o.total || 0), 0);
              const totalDelivery = group.reduce((sum, o) => {
                return sum + getOrderDriverEarnings(o);
              }, 0);
              const totalAppFee = group.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
              const isFromCurrentSession = currentSessionId && (main.deliverySessionId === currentSessionId);

              return `
                <div class="admin-card history-group-card" data-card-id="${main.id}" style="margin-bottom:12px; border-radius:20px; border:1.5px solid var(--color-border-light); overflow:hidden; transition:all 0.3s; cursor:pointer;">
                  <div class="history-card-header" style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; position:relative;">
                    <div style="position:absolute; left:0; top:0; bottom:0; width:4px; background:${main.status === 'completed' ? '#10b981' : '#ef4444'}; border-radius:0 4px 4px 0;"></div>
                    ${isFromCurrentSession ? `<div style="position:absolute; top:8px; right:16px; background:#10b981; color:white; font-size:7px; font-weight:900; padding:2px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em;">Sesión</div>` : ''}
                    <div style="flex:1; min-width:0;">
                      <div style="font-size:15px; font-weight:800; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:3px;">
                        ${isBundle ? `Lote · ${group.length} pedidos` : (main.isFavor ? getFavorTypeMeta(main.favorType).title : (main.comercioName || 'Pedido'))}
                      </div>
                      <div style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--color-text-tertiary); font-weight:600;">
                        <span style="color:${main.status === 'completed' ? '#10b981' : '#ef4444'};">${main.status === 'completed' ? '✓ Entregado' : '✕ Cancelado'}</span>
                        <span>·</span>
                        <span>${main.createdAt ? new Date(main.createdAt.toDate()).toLocaleDateString('es-AR', {day:'2-digit', month:'short'}) : '---'} ${main.createdAt ? new Date(main.createdAt.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                        <span>·</span>
                        <span style="font-weight:800;">#${main.orderId || '---'}</span>
                      </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                      <div style="font-weight:900; font-size:17px; color:${main.status === 'completed' ? '#10b981' : 'var(--color-text-tertiary)'}; letter-spacing:-0.5px;">${formatPrice(totalAmount)}</div>
                      <div style="font-size:10px; font-weight:700; color:#10b981;">${icon('chevronDown', 12)} +${formatPrice(totalDelivery)}</div>
                    </div>
                  </div>

                  <div class="history-card-details" style="display:none; border-top:1.5px solid var(--color-border-light);">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0; border-bottom:1px solid var(--color-border-light);">
                      <div style="padding:12px 20px; border-right:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Tu Ganancia</div>
                        <div style="font-size:15px; font-weight:900; color:#10b981;">${formatPrice(totalDelivery)}</div>
                      </div>
                      <div style="padding:12px 20px;">
                        <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Tarifa App</div>
                        <div style="font-size:15px; font-weight:900; color:#ef4444;">${formatPrice(totalAppFee)}</div>
                      </div>
                    </div>

                    <div style="padding:16px 20px;">
                      ${group.map(o => `
                        <div style="margin-bottom:12px; padding:12px; background:var(--color-bg-secondary); border-radius:14px; border:1px solid var(--color-border-light);">
                          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span style="font-size:13px; font-weight:800; color:${o.isFavor ? getFavorTypeMeta(o.favorType).textColor : 'var(--color-text-primary)'};">${o.isFavor ? getFavorTypeMeta(o.favorType).headerText : (o.comercioName || 'Pedido')}</span>
                            <span style="font-size:13px; font-weight:800; color:var(--color-text-primary);">${formatPrice(o.subtotal || 0)}</span>
                          </div>
                          ${o.isFavor ? (() => {
                            const stores = parseFavorDetails(o.details || o.description);
                            const storePrices = o.storePrices || {};
                            if (stores.length > 0) {
                              return `
                                <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
                                  ${stores.map(st => `
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:12.5px; border-bottom:1.5px solid var(--color-border-light); padding-bottom:6px; margin-bottom:2px;">
                                      <div style="display:flex; flex-direction:column; gap:2px; text-align:left; align-items:flex-start; flex:1; padding-right:8px;">
                                        <strong style="color:var(--color-text-primary); font-weight:800;">${st.name}</strong>
                                        <span style="color:var(--color-text-secondary); font-size:11.5px; font-weight:500;">${st.items}</span>
                                      </div>
                                      ${storePrices[st.name] ? `<span style="font-weight:900; color:var(--color-text-primary); margin-left:12px; white-space:nowrap;">${formatPrice(storePrices[st.name])}</span>` : ''}
                                    </div>
                                  `).join('')}
                                </div>
                              `;
                            } else {
                              return formatFavorDetailsHTML(o.details || o.description);
                            }
                          })() : (o.items ? o.items.map(item => `
                            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; padding-left:8px;">
                              <span style="color:var(--color-text-tertiary); font-weight:600;">${item.qty || 1}× ${item.name}</span>
                              <span style="color:var(--color-text-tertiary);">${formatPrice((item.price || 0) * (item.qty || 1))}</span>
                            </div>
                          `).join('') : '')}
                        </div>
                      `).join('')}
                    </div>

                    <div style="padding:0 20px 16px;">
                      <div style="background:var(--color-bg-secondary); border-radius:16px; padding:16px; border:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:14px; display:flex; align-items:center; gap:6px; letter-spacing:0.06em;">
                          ${icon('activity', 13)} Tiempos
                        </div>
                        <div style="position:relative; padding-left:22px;">
                          <div style="position:absolute; left:5px; top:6px; bottom:6px; width:1.5px; background:var(--color-border-light);"></div>
                          ${[
                            { label: 'Creado', time: main.createdAt, color: 'var(--color-primary)', done: true },
                            { label: 'Retirado', time: main.pickedUpAt, color: 'var(--color-primary)', done: !!main.pickedUpAt },
                            { label: 'Entregado', time: main.deliveredAt, color: '#10b981', done: !!main.deliveredAt }
                          ].map(step => `
                            <div style="margin-bottom:10px; position:relative; display:flex; justify-content:space-between; align-items:center;">
                              <div style="position:absolute; left:-22px; top:3px; width:11px; height:11px; border-radius:50%; background:${step.done ? step.color : 'var(--color-border-light)'}; border:2px solid var(--color-bg-secondary); ${step.done && step.color === '#10b981' ? 'box-shadow:0 0 6px rgba(16,185,129,0.4);' : ''}"></div>
                              <span style="font-size:12px; font-weight:700; color:${step.done ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)'};">${step.label}</span>
                              <span style="font-size:11px; font-weight:800; color:var(--color-text-tertiary);">${step.time ? new Date(step.time.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    </div>

                    <div style="padding:0 20px 16px;">
                      ${!main.isManual ? `
                        <button class="view-history-chat-btn" data-order-id="${main.id}" data-order-num="${main.orderId}" data-client-name="${main.userName}" style="width:100%; height:40px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text-primary); font-size:11px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
                          ${icon('messageSquare', 14)} Chat con cliente
                        </button>
                      ` : `
                        <button disabled style="width:100%; height:40px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text-tertiary); font-size:11px; font-weight:800; opacity:0.4; cursor:not-allowed; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
                          ${icon('messageSquare', 14)} Pedido manual - Sin chat
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        container.querySelectorAll('.history-card-header').forEach(header => {
          header.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('a')) return;
            const card = header.closest('.history-group-card');
            const details = card.querySelector('.history-card-details');
            if (details) {
              const isHidden = details.style.display === 'none';
              details.style.display = isHidden ? 'block' : 'none';
              card.style.boxShadow = isHidden ? '0 8px 24px rgba(0,0,0,0.08)' : 'none';
            }
          });
        });

        container.querySelectorAll('.view-history-chat-btn').forEach(btn => {
          btn.onclick = async () => {
            const { openChat } = await import('../components/chat.js');
            openChat({ 
              orderId: btn.dataset.orderId, 
              orderNum: btn.dataset.orderNum,
              type: 'client-delivery', 
              otherName: btn.dataset.clientName 
            });
          };
        });
      });
    } else if (tab === 'finances') {
      let sessionOrdersUnsub = null;
      const q = query(doc(db, 'users', user.uid));
      const userUnsub = onSnapshot(q, async (snap) => {
        const userData = snap.data();
        const debt = userData?.deliveryDebt || 0;
        const currentSessionId = userData?.currentSessionId;
        const online = getState().user?.isOnline;

        container.innerHTML = `
          <div class="delivery-finances-v4 page-enter" style="display:flex; flex-direction:column; gap:12px; padding:0 0 10px; width:100%; box-sizing:border-box;">
            <!-- Active Session Card -->
            <div style="background:var(--color-bg-card); border:1.5px solid ${online ? 'rgba(16,185,129,0.3)' : 'var(--color-border-light)'}; border-radius:24px; padding:18px 20px; position:relative; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,0.04); transition:all 0.4s ease;">
              ${online ? `<div style="position:absolute; top:-20px; right:-20px; width:120px; height:120px; background:radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%);"></div>` : ''}
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="width:10px; height:10px; border-radius:50%; background:${online ? '#10b981' : 'var(--color-text-tertiary)'}; ${online ? 'box-shadow:0 0 10px #10b981; animation: pulse 2s infinite;' : ''}"></div>
                  <span style="font-size:11px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">${online ? 'Sesión en Vivo' : 'Última Sesión'}</span>
                </div>
                <span style="font-size:9px; font-weight:900; padding:4px 10px; border-radius:8px; background:${online ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-secondary)'}; color:${online ? '#10b981' : 'var(--color-text-tertiary)'}; text-transform:uppercase; letter-spacing:0.03em; border:1px solid ${online ? 'rgba(16,185,129,0.15)' : 'var(--color-border-light)'};">${online ? 'Activa' : 'Finalizada'}</span>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; opacity:0.7;">Ganancia</div>
                  <div style="font-size:30px; font-weight:950; color:${online ? '#10b981' : 'var(--color-text-primary)'}; letter-spacing:-1px; line-height:1.1;" id="session-total-earned">$ 0</div>
                </div>
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; opacity:0.7;">Pedidos</div>
                  <div style="font-size:30px; font-weight:950; color:var(--color-text-primary); letter-spacing:-1px; line-height:1.1;" id="session-orders-count">0</div>
                </div>
              </div>
            </div>

            <!-- Stats Grid -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
              ${['Hoy', 'Semana', 'Mes'].map(label => `
                <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:16px; padding:10px 8px; text-align:center; box-shadow:var(--shadow-sm); transition:all 0.3s;">
                  <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; letter-spacing:0.05em; opacity:0.8;">${label}</div>
                  <div style="font-size:15px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.5px;" id="stats-${label.toLowerCase() === 'semana' ? 'week' : (label.toLowerCase() === 'hoy' ? 'day' : 'month')}">$ 0</div>
                </div>
              `).join('')}
            </div>

            <!-- Charts Container -->
            <div id="finances-charts-container" style="display:flex; flex-direction:column; gap:12px;">
              <div class="skeleton" style="height:140px; border-radius:24px;"></div>
              <div class="skeleton" style="height:140px; border-radius:24px;"></div>
            </div>

            <!-- Operations Stack -->
            <div style="display:flex; flex-direction:column; gap:10px;">
              <!-- Gestor de Balance -->
              <button id="open-balance-mgmt-btn" style="width:100%; height:48px; border-radius:16px; background:var(--color-bg-card); border:1.5px solid ${debt > 0 ? 'rgba(239,68,68,0.2)' : 'var(--color-border-light)'}; color:var(--color-text-primary); font-weight:900; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:0 16px; transition:all 0.3s; box-shadow:0 4px 12px rgba(0,0,0,0.02); flex-shrink:0;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="color:${debt > 0 ? '#ef4444' : '#10b981'}; opacity:0.8; display:flex; align-items:center;">${icon('bank', 16)}</div>
                  Gestión de Balance
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:14.5px; font-weight:950; color:${debt > 0 ? '#ef4444' : '#10b981'}; letter-spacing:-0.02em;">${formatPrice(debt)}</span>
                  ${icon('chevronRight', 14, 'opacity:0.3')}
                </div>
              </button>

              <!-- Inline Sessions History List -->
              <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:20px; padding:14px 16px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
                    ${icon('history', 15)} Historial de Sesiones
                  </h4>
                  <button id="view-sessions-history-btn" style="background:none; border:none; color:var(--color-primary); font-size:10.5px; font-weight:800; cursor:pointer; padding:0; outline:none;">Ver todas</button>
                </div>
                
                <div id="recent-sessions-list" style="display:flex; flex-direction:column; gap:6px;">
                  <div class="skeleton" style="height:36px; border-radius:10px;"></div>
                  <div class="skeleton" style="height:36px; border-radius:10px;"></div>
                  <div class="skeleton" style="height:36px; border-radius:10px;"></div>
                </div>
              </div>
            </div>
          </div>
        `;

        // Load Session Stats
        if (currentSessionId) {
          if (!sessionOrdersUnsub || sessionOrdersUnsub.sessionId !== currentSessionId) {
            if (sessionOrdersUnsub) {
              sessionOrdersUnsub.unsub();
            }
            try {
              const { onSnapshot: fOnSnapshot, query: fQuery, collection: fCollection, where: fWhere } = await import('firebase/firestore');
              const unsub = fOnSnapshot(fQuery(
                fCollection(db, 'orders'),
                fWhere('driverId', '==', user.uid),
                fWhere('status', '==', 'completed'),
                fWhere('deliverySessionId', '==', currentSessionId)
              ), (ordersSnap) => {
                const totalEarned = ordersSnap.docs.reduce((sum, d) => {
                  return sum + getOrderDriverEarnings(d.data());
                }, 0);
                const count = ordersSnap.size;
                
                if (document.getElementById('session-total-earned')) document.getElementById('session-total-earned').textContent = formatPrice(totalEarned);
                if (document.getElementById('session-orders-count')) document.getElementById('session-orders-count').textContent = count;
              }, (err) => {
                console.error('Error in live orders snapshot:', err);
              });
              sessionOrdersUnsub = { sessionId: currentSessionId, unsub };
            } catch (e) {
              console.error('Error starting live session listener:', e);
            }
          }
        } else {
          if (sessionOrdersUnsub) {
            sessionOrdersUnsub.unsub();
            sessionOrdersUnsub = null;
          }
          // Fetch the latest session summary
          (async () => {
             const { getDocs, query, collection, where, limit } = await import('firebase/firestore');
             try {
               const latestSnap = await getDocs(query(
                 collection(db, 'deliverySessions'),
                 where('driverId', '==', user.uid),
                 limit(20) // Get recent ones to avoid large fetch
               ));
               if (!latestSnap.empty) {
                 const sessions = latestSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                 sessions.sort((a, b) => (b.startTime?.toMillis() || 0) - (a.startTime?.toMillis() || 0));
                 const sd = sessions[0];
                 
                 let displayTotal = sd.totalEarned || 0;
                 let displayCount = sd.ordersCount || 0;
                 
                 if (displayTotal === 0) {
                   const { getDocs, query, collection, where } = await import('firebase/firestore');
                   const liveSnap = await getDocs(query(
                     collection(db, 'orders'),
                     where('deliverySessionId', '==', sd.id),
                     where('status', '==', 'completed')
                   ));
                   if (!liveSnap.empty) {
                     displayTotal = liveSnap.docs.reduce((s, d) => {
                        return s + getOrderDriverEarnings(d.data());
                      }, 0);
                     displayCount = liveSnap.size;
                   }
                 }

                 if (document.getElementById('session-total-earned')) document.getElementById('session-total-earned').textContent = formatPrice(displayTotal);
                 if (document.getElementById('session-orders-count')) document.getElementById('session-orders-count').textContent = displayCount;
               }
             } catch(e) {}
          })();
        }

        // Load Global Stats
        loadProfessionalStats(user.uid);
        loadRecentSessionsList(user.uid);

        // Listeners
        document.getElementById('view-sessions-history-btn')?.addEventListener('click', () => {
          showSessionsHistoryModal(user.uid);
        });

        document.getElementById('open-balance-mgmt-btn')?.addEventListener('click', () => {
          showBalanceManagementModal(user, debt);
        });


      });

      tabUnsub = () => {
        userUnsub();
        if (sessionOrdersUnsub) {
          sessionOrdersUnsub.unsub();
        }
      };
    } else if (tab === 'config') {
      const isTripApproved = user.tripStatus === 'approved';
      const isTripPending = user.tripStatus === 'pending';
      const isTripRejected = user.tripStatus === 'rejected';

      // Default values for Trip Vehicle
      const defaultTripModel = user.tripVehicleModel || user.tripApplication?.vehicleModel || user.vehicleModel || '';
      const defaultTripColor = user.tripVehicleColor || user.tripApplication?.vehicleColor || user.vehicleColor || '';
      const defaultTripPatent = user.tripVehiclePatent || user.tripApplication?.vehicleDetails || user.vehicleDetails || user.patente || '';
      const defaultTripVehicleType = user.tripVehicleType || user.tripApplication?.vehicleType || user.vehicleType || 'Auto';

      // Default values for Delivery Vehicle
      const defaultDelivType = user.deliveryVehicleType || 'Moto';
      const defaultDelivModel = user.deliveryVehicleModel || '';
      const defaultDelivColor = user.deliveryVehicleColor || '';
      const defaultDelivPatent = user.deliveryVehiclePatent || '';

      let configHtml = `
        <div style="display:flex; flex-direction:column; gap:20px; font-family:var(--font-body); color:var(--color-text-primary); max-width:550px; margin:0 auto; padding-bottom:40px;">
          
          <!-- Card 1: Datos del Repartidor -->
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
            <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
              ${icon('user', 20)} Datos del Repartidor
            </h3>
            
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Alias de Transferencia (Obligatorio) *</label>
              <input type="text" id="config-alias-input" value="${user.transferAlias || ''}" placeholder="Ej: alias.mp" style="width:100%; height:48px; border-radius:12px; border:2px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:14px; font-weight:700; padding:0 14px; outline:none; transition:border-color 0.2s;" />
            </div>
          </div>
      `;

      if (isTripApproved) {
        configHtml += `
          <!-- Card 2: Tipo de Trabajo -->
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
            <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
              ${icon('settings', 20)} Tipo de Trabajo
            </h3>

            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">¿Qué querés recibir? *</label>
              <select id="config-deliverymode-select" style="width:100%; height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:14px; font-weight:700; padding:0 14px; outline:none; font-family:inherit;">
                <option value="delivery" ${user.deliveryMode === 'delivery' ? 'selected' : ''}>Solo Envíos (Pedidos y Favores)</option>
                <option value="trip" ${user.deliveryMode === 'trip' ? 'selected' : ''}>Solo Viajes (Traslado de Pasajeros)</option>
                <option value="both" ${(!user.deliveryMode || user.deliveryMode === 'both') ? 'selected' : ''}>Ambos (Envíos y Viajes)</option>
              </select>
            </div>
          </div>
        `;
      } else {
        configHtml += `
          <!-- Card 2: Postulación para Viajes -->
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
            <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
              ${icon('car', 20)} Habilitar Viajes (Pasajeros)
            </h3>
            <p style="font-size:12.5px; color:var(--color-text-secondary); margin:0; line-height:1.45; font-weight:500;">
              Para poder trasladar pasajeros y realizar Viajes en GoDelivery, debés postularte adjuntando la documentación de tu vehículo.
            </p>
            <div style="margin-top:4px;">
              ${isTripPending ? `
                <div style="background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.2); border-radius:16px; padding:12px 16px; display:flex; align-items:center; gap:10px;">
                  <span style="font-size:20px; animation:scale-pulse 2s infinite;">⏳</span>
                  <div>
                    <strong style="font-size:13px; color:var(--color-text-primary); display:block;">Solicitud de Chofer pendiente</strong>
                    <span style="font-size:11.5px; color:var(--color-text-secondary);">Estamos revisando tus documentos. Te notificaremos pronto.</span>
                  </div>
                </div>
              ` : isTripRejected ? `
                <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2); border-radius:16px; padding:12px 16px; display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:20px; color:#ef4444;">❌</span>
                    <div>
                      <strong style="font-size:13px; color:var(--color-text-primary); display:block;">Solicitud rechazada</strong>
                      <span style="font-size:11.5px; color:var(--color-text-secondary);">Tu postulación no cumple con los requisitos mínimos.</span>
                    </div>
                  </div>
                  <button id="reapply-trip-btn" class="btn btn-outline btn-block" style="height:38px; border-radius:10px; font-weight:800; font-size:12px;">Volver a postularse...</button>
                </div>
              ` : `
                <button id="apply-trip-btn" class="btn btn-primary btn-block" style="height:48px; border-radius:14px; font-weight:900; font-size:13.0px; background:#3b82f6; border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 12px rgba(59,130,246,0.2);">
                  ${icon('car', 16)} Postularse para Realizar Viajes
                </button>
              `}
            </div>
          </div>
        `;
      }

      // Render single mandatory vehicle configuration card for everyone!
      configHtml += `
        <!-- Card 3: Configuración de tu Vehículo -->
        <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:20px; box-shadow:var(--shadow-sm);">
          <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
            ${icon('car', 20)} Configuración de tu Vehículo
          </h3>

          <div style="padding:14px; border:1.5px solid rgba(59,130,246,0.15); background:rgba(59,130,246,0.02); border-radius:20px; display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Tipo de Vehículo (Obligatorio) *</label>
              <select id="config-vehicle-type-select" style="width:100%; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none; font-family:inherit;">
                <option value="" disabled ${!defaultTripVehicleType ? 'selected' : ''}>-- Seleccioná tipo --</option>
                <option value="Moto" ${defaultTripVehicleType.toLowerCase() === 'moto' ? 'selected' : ''}>🏍️ Moto</option>
                <option value="Auto" ${defaultTripVehicleType.toLowerCase() === 'auto' ? 'selected' : ''}>🚗 Auto</option>
              </select>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Modelo / Marca *</label>
                <input type="text" id="config-vehicle-model-input" value="${defaultTripModel}" placeholder="Ej: Fiat Cronos / Honda Wave" style="width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none;" />
              </div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Color *</label>
                <input type="text" id="config-vehicle-color-input" value="${defaultTripColor}" placeholder="Ej: Blanco" style="width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none;" />
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Número de Patente *</label>
              <input type="text" id="config-vehicle-patent-input" value="${defaultTripPatent}" placeholder="Ej: AB123CD" style="width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none;" />
            </div>
          </div>
        </div>
      `;

      configHtml += `
          <!-- Save button -->
          <button id="config-save-btn" class="btn btn-primary btn-block" style="height:56px; border-radius:20px; font-weight:900; font-size:15px; background:#E11D48; border:none; color:white; box-shadow:0 8px 20px rgba(225, 29, 72, 0.2); cursor:pointer;">
            Guardar Configuración
          </button>
        </div>
      `;

      container.innerHTML = configHtml;

      // Apply button Click
      const applyBtn = document.getElementById('apply-trip-btn');
      const reapplyBtn = document.getElementById('reapply-trip-btn');
      const handleApplyClick = () => showTripApplicationModal(user);
      if (applyBtn) applyBtn.onclick = handleApplyClick;
      if (reapplyBtn) reapplyBtn.onclick = handleApplyClick;

      document.getElementById('config-save-btn').onclick = async () => {
        const aliasVal = document.getElementById('config-alias-input').value.trim();

        if (!aliasVal) {
          showToast('El alias es obligatorio', 'warning');
          return;
        }

        const vehicleTypeSelect = document.getElementById('config-vehicle-type-select');
        const vehicleType = vehicleTypeSelect ? vehicleTypeSelect.value : '';
        const vehicleModel = document.getElementById('config-vehicle-model-input').value.trim();
        const vehicleColor = document.getElementById('config-vehicle-color-input').value.trim();
        const vehiclePatent = document.getElementById('config-vehicle-patent-input').value.trim();

        if (!vehicleType || !vehicleModel || !vehicleColor || !vehiclePatent) {
          showToast('Debés completar todos los datos del vehículo (tipo, modelo, color y patente) para poder recibir viajes y pedidos.', 'warning');
          return;
        }

        const saveBtn = document.getElementById('config-save-btn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = icon('loader', 20, 'animate-spin') + ' Guardando...';

        try {
          const { doc: fDoc, updateDoc: fUpdateDoc } = await import('firebase/firestore');
          const userRef = fDoc(db, 'users', user.uid);
          
          const updateFields = {
            transferAlias: aliasVal
          };

          if (isTripApproved) {
            const modeVal = document.getElementById('config-deliverymode-select').value;
            updateFields.deliveryMode = modeVal;
          }

          // Unify vehicle information across all fields for absolute compatibility
          const vTypeLower = vehicleType.toLowerCase();
          
          updateFields.tripVehicleType = vTypeLower;
          updateFields.tripVehicleModel = vehicleModel;
          updateFields.tripVehicleColor = vehicleColor;
          updateFields.tripVehiclePatent = vehiclePatent;
          
          updateFields.deliveryVehicleType = vehicleType;
          updateFields.deliveryVehicleModel = vehicleModel;
          updateFields.deliveryVehicleColor = vehicleColor;
          updateFields.deliveryVehiclePatent = vehiclePatent;

          updateFields.vehicleType = vTypeLower;
          updateFields.vehicleModel = vehicleModel;
          updateFields.vehicleColor = vehicleColor;
          updateFields.vehicleDetails = vehiclePatent;
          updateFields.patente = vehiclePatent;

          await fUpdateDoc(userRef, updateFields);

          setState('user', { 
            ...getState().user, 
            ...updateFields
          });

          showToast('¡Configuración guardada con éxito!', 'success');
        } catch (err) {
          console.error('Error saving config:', err);
          showToast('Error al guardar la configuración', 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = 'Guardar Configuración';
        }
      };

      tabUnsub = () => {};
    }
  } catch (err) {
    console.error('Error loading delivery tab:', err);
    container.innerHTML = `<div class="empty-state-mini">Error al cargar datos</div>`;
  }
}

async function showTripApplicationModal(user) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('../firebase.js');

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;';
  
  modalEl.innerHTML = `
    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
      <div style="width: 52px; height: 52px; background: rgba(59, 130, 246, 0.1); color: #3b82f6; border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);">
        ${icon('car', 32)}
      </div>
      <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; color: var(--color-text-primary); margin: 0;">Postulación de Chofer</h3>
      <p style="font-size: 12.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; max-width: 280px;">
        Completá este formulario profesional para habilitar el traslado de pasajeros en GoDelivery.
      </p>
    </div>

    <form id="trip-app-form" style="display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px;">
      
      <!-- Full Name -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Nombre Completo *</label>
        <input type="text" id="tapp-fullname" required placeholder="Ej: Juan Pérez" value="${user.displayName || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Phone -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Teléfono de Contacto *</label>
        <input type="tel" id="tapp-phone" required placeholder="Ej: 2215551234" value="${user.phone || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Vehículo *</label>
        <select id="tapp-vehicle" required style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s; color: var(--color-text-primary); font-family: inherit;">
          <option value="Auto" selected>Auto</option>
          <option value="Moto">Moto</option>
        </select>
      </div>

      <!-- Vehicle Model -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Modelo del Vehículo (Marca, Modelo) *</label>
        <input type="text" id="tapp-vehiclemodel" required placeholder="Ej: Fiat Cronos / Honda Wave" value="${user.vehicleModel || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle Color -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Color del Vehículo *</label>
        <input type="text" id="tapp-vehiclecolor" required placeholder="Ej: Blanco / Negro / Rojo" value="${user.vehicleColor || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle Plate -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Patente del Vehículo *</label>
        <input type="text" id="tapp-vehicledetails" required placeholder="Ej: AA123BC / A012BCD" value="${user.vehicleDetails || user.patente || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Required Driver License Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Foto de Licencia de Conducir (Registro) *</label>
        <input type="file" id="tapp-licencia-file" accept="image/*" style="display:none;" required />
        <button type="button" id="tlicencia-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-primary-light); color:var(--color-text-primary);">
          ${icon('camera', 16)} <span id="tlicencia-file-label">Subir foto de Registro...</span>
        </button>
      </div>

      <!-- Required Vehicle Insurance Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Foto de Seguro del Vehículo *</label>
        <input type="file" id="tapp-seguro-file" accept="image/*" style="display:none;" required />
        <button type="button" id="tseguro-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-primary-light); color:var(--color-text-primary);">
          ${icon('camera', 16)} <span id="tseguro-file-label">Subir foto de Seguro...</span>
        </button>
      </div>

      <!-- Submit button -->
      <button type="submit" id="submit-tapp-btn" class="btn btn-primary" style="width: 100%; height: 50px; border-radius: 14px; background: #3b82f6; color: white; border: none; font-weight: 900; font-size: 14.5px; cursor: pointer; box-shadow: 0 8px 24px rgba(59,130,246, 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 10px;">
        ${icon('check', 18)} Enviar Solicitud de Chofer
      </button>
    </form>
  `;

  showModal({ title: '', content: modalEl, height: '80dvh', hideHeader: true });

  const licenciaFileInput = modalEl.querySelector('#tapp-licencia-file');
  const licenciaBtn = modalEl.querySelector('#tlicencia-file-btn');
  const licenciaLabel = modalEl.querySelector('#tlicencia-file-label');

  const seguroFileInput = modalEl.querySelector('#tapp-seguro-file');
  const seguroBtn = modalEl.querySelector('#tseguro-file-btn');
  const seguroLabel = modalEl.querySelector('#tseguro-file-label');

  licenciaBtn.onclick = () => licenciaFileInput.click();
  seguroBtn.onclick = () => seguroFileInput.click();

  licenciaFileInput.onchange = () => {
    if (licenciaFileInput.files.length > 0) {
      licenciaLabel.textContent = licenciaFileInput.files[0].name;
      licenciaBtn.style.borderColor = '#22c55e';
    }
  };

  seguroFileInput.onchange = () => {
    if (seguroFileInput.files.length > 0) {
      seguroLabel.textContent = seguroFileInput.files[0].name;
      seguroBtn.style.borderColor = '#22c55e';
    }
  };

  const form = modalEl.querySelector('#trip-app-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const fullName = modalEl.querySelector('#tapp-fullname').value.trim();
    const phone = modalEl.querySelector('#tapp-phone').value.trim();
    const vehicleType = modalEl.querySelector('#tapp-vehicle').value;
    const vehicleModel = modalEl.querySelector('#tapp-vehiclemodel').value.trim();
    const vehicleColor = modalEl.querySelector('#tapp-vehiclecolor').value.trim();
    const vehicleDetails = modalEl.querySelector('#tapp-vehicledetails').value.trim();

    if (!fullName || !phone || !vehicleType || !vehicleModel || !vehicleColor || !vehicleDetails) {
      showToast('Por favor, completa todos los campos requeridos.', 'warning');
      return;
    }

    if (licenciaFileInput.files.length === 0) {
      showToast('Por favor, subí la foto de tu registro/licencia.', 'warning');
      return;
    }

    if (seguroFileInput.files.length === 0) {
      showToast('Por favor, subí la foto del seguro.', 'warning');
      return;
    }

    const submitBtn = modalEl.querySelector('#submit-tapp-btn');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.innerHTML = `<div class="spinner-mini" style="width:16px; height:16px; border-width:2px; border-top-color:#fff; margin:0; display:inline-block;"></div> Subiendo archivos...`;

    try {
      const uploadPromises = [];

      // 1. License Upload
      let licenciaUrl = '';
      const licenciaFile = licenciaFileInput.files[0];
      const licenciaRef = ref(storage, `trip_applications/${user.uid}/licencia_${Date.now()}_${licenciaFile.name}`);
      uploadPromises.push(uploadBytes(licenciaRef, licenciaFile).then(async (snap) => {
        licenciaUrl = await getDownloadURL(snap.ref);
      }));

      // 2. Insurance Upload
      let seguroUrl = '';
      const seguroFile = seguroFileInput.files[0];
      const seguroRef = ref(storage, `trip_applications/${user.uid}/seguro_${Date.now()}_${seguroFile.name}`);
      uploadPromises.push(uploadBytes(seguroRef, seguroFile).then(async (snap) => {
        seguroUrl = await getDownloadURL(snap.ref);
      }));

      await Promise.all(uploadPromises);

      const applicationData = {
        userId: user.uid,
        fullName,
        phone,
        vehicleType,
        vehicleModel,
        vehicleColor,
        vehicleDetails,
        licenciaUrl,
        seguroUrl,
        status: 'pending',
        appliedAt: serverTimestamp()
      };

      // Save in global trip_applications collection
      await setDoc(doc(db, 'trip_applications', user.uid), applicationData);

      // Update user document
      await setDoc(doc(db, 'users', user.uid), {
        tripStatus: 'pending',
        tripApplication: applicationData,
        phone: phone
      }, { merge: true });

      showToast('¡Postulación de Chofer enviada correctamente! Revisaremos tus documentos pronto.', 'success');
      closeModal();
    } catch (err) {
      console.error('Error saving trip application:', err);
      showToast('Error al enviar postulación: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.innerHTML = `${icon('check', 18)} Enviar Solicitud de Chofer`;
    }
  };
}

async function showModifyOrderModal(order) {
  const { addDoc, doc, updateDoc, collection } = await import('firebase/firestore');

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding:24px; background:var(--color-bg); height:100%; display:flex; flex-direction:column;';
  
  modalEl.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2 style="font-family:var(--font-display); font-size:1.5rem; font-weight:900; margin:0; letter-spacing:-0.02em;">Modificar Pedido</h2>
      <p style="font-size:13px; color:var(--color-text-tertiary); margin-top:4px;">Ajustá el precio o agregá un detalle si hubo cambios.</p>
    </div>

    <div style="flex:1;">
      <div style="margin-bottom:20px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Nuevo Total ($)</label>
        <input type="number" id="new-total-input" value="${order.total}" style="width:100%; height:56px; border-radius:16px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); color:var(--color-text); font-size:24px; font-weight:800; padding:0 20px; outline:none;" inputmode="decimal" />
      </div>

      <div style="margin-bottom:20px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Detalle / Motivo (Opcional)</label>
        <textarea id="change-reason-input" placeholder="Ej: No había stock de coca de 2L, se llevó de 1.5L" style="width:100%; height:100px; border-radius:16px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); color:var(--color-text); font-size:14px; padding:16px; outline:none; resize:none; font-family:inherit;"></textarea>
      </div>
    </div>

    <button id="save-price-btn" style="width:100%; height:56px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 12px 24px rgba(var(--color-primary-rgb), 0.3);">
      Actualizar y Notificar
    </button>
  `;

  showModal({ content: modalEl, height: '60dvh' });

  modalEl.querySelector('#save-price-btn').onclick = async () => {
    const newTotal = parseFloat(modalEl.querySelector('#new-total-input').value);
    const reason = modalEl.querySelector('#change-reason-input').value.trim();

    if (isNaN(newTotal) || newTotal <= 0) {
      showToast('Ingresá un total válido', 'error');
      return;
    }

    const btn = modalEl.querySelector('#save-price-btn');
    btn.disabled = true;
    btn.innerHTML = icon('loader', 20, 'animate-spin');

    try {
      const diff = newTotal - order.total;
      const subtotalDiff = diff; // Simple assumption for total change

      await updateDoc(doc(db, 'orders', order.id), {
        total: newTotal,
        isModified: true,
        modifiedBy: 'delivery',
        modificationReason: reason,
        modifiedAt: serverTimestamp()
      });

      // Add system message to chat
      await addDoc(collection(db, 'orders', order.id, 'messages'), {
        senderId: 'system',
        senderName: 'Sistema',
        text: `📦 **Pedido Modificado**\nEl repartidor actualizó el total a **${formatPrice(newTotal)}**.\n${reason ? `Motivo: ${reason}` : ''}`,
        createdAt: serverTimestamp(),
        type: 'modification'
      });

      closeModal();
      showToast('Pedido actualizado', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al actualizar', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Actualizar y Notificar';
    }
  };
}

async function showEditFavorPriceModal(order, isPersistent = false) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { icon } = await import('../utils/icons.js');
  const { formatPrice } = await import('../utils/format.js');
  
  const deliveryFee = order.deliveryCost || 0;
  const appFee = order.appUsageFee || 0;
  const pFee = order.purchaseFee || 0;
  const extraStops = order.extraStopsFee || 0;
  const couponDiscount = order.couponDiscount || 0;
  const tip = order.tip || order.tipAmount || 0;
  const serviceTotal = deliveryFee + appFee + pFee + extraStops - couponDiscount + tip;

  let stores = parseFavorDetails(order.details || order.description);
  if (stores.length === 0) {
    let serviceName = 'Servicio';
    if (order.details) {
      const match = order.details.match(/(?:Servicio|Trámite):\s*([^\n]+)/i);
      if (match) serviceName = match[1].trim();
    }
    stores = [{
      name: serviceName,
      items: 'Pago de Servicio'
    }];
  }
  const currentPrices = order.storePrices || {};

  const modalEl = document.createElement('div');
  modalEl.innerHTML = `
    <div style="padding:24px; text-align:center;">
      <div style="width:64px; height:64px; background:rgba(var(--color-primary-rgb),0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--color-primary); margin:0 auto 20px;">
        ${icon('edit', 32)}
      </div>
      <h3 style="font-size:20px; font-weight:950; color:var(--color-text); margin-bottom:8px;">${order.favorType === 'pagodeservicios' ? 'Monto de Servicios' : 'Precios por Comercio'}</h3>
      <p style="font-size:13.5px; color:var(--color-text-secondary); line-height:1.5; margin-bottom:20px;">${order.favorType === 'pagodeservicios' ? 'Ingresá el valor total de las facturas o servicios abonados.' : 'Ingresá el valor de los productos comprados en cada local individualmente.'}</p>
      
      <div style="background:var(--color-bg-secondary); border-radius:24px; padding:20px; border:1px solid var(--color-border-light); margin-bottom:20px; display:flex; flex-direction:column; gap:16px;">
        <div style="font-size:11px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.1em; text-align:left; margin-bottom:4px;">${order.favorType === 'pagodeservicios' ? 'Costo facturas' : 'Costo de productos'}</div>
        
        ${stores.map((st, idx) => {
          const price = currentPrices[st.name] || '';
          return `
            <div style="display:flex; flex-direction:column; gap:6px; text-align:left;">
              <label style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; justify-content:space-between; gap:6px;">
                <span>${order.favorType === 'pagodeservicios' ? '🧾' : '🏪'} <strong>${st.name}</strong></span>
                <span style="font-weight:500; font-size:11px; color:var(--color-text-secondary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:180px;">${st.items}</span>
              </label>
              <div style="position:relative;">
                <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:800; color:var(--color-text-tertiary);">$</span>
                <input type="number" class="favor-store-price-input" data-store-name="${st.name}" value="${price}" placeholder="0" style="width:100%; box-sizing:border-box; height:48px; border-radius:14px; border:2px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text); font-size:18px; font-weight:900; padding:0 16px 0 35px; outline:none; transition:border-color 0.3s;" inputmode="decimal">
              </div>
            </div>
          `;
        }).join('')}

        <div style="border-top:1px dashed var(--color-border-light); padding-top:14px; display:flex; justify-content:space-between; align-items:center; font-size:13.5px; font-weight:800; color:var(--color-text-primary);">
          <span>${order.favorType === 'pagodeservicios' ? 'Total Servicios:' : 'Total Productos:'}</span>
          <span id="favor-products-sum" style="font-size:17px; font-weight:950; color:#10b981;">${formatPrice(order.subtotal || 0)}</span>
        </div>

        <div style="border-top:1px dashed var(--color-border-light); padding-top:14px; display:flex; flex-direction:column; gap:8px; text-align:left; font-size:13px; font-weight:600; color:var(--color-text-secondary);">
          <div style="display:flex; justify-content:space-between;">
            <span>Servicio (Envío/Gestión/App):</span>
            <span>+ ${formatPrice(deliveryFee + appFee + pFee + extraStops)}</span>
          </div>
          ${couponDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; color:#a855f7;">
            <span>Descuento de Cupón:</span>
            <span>- ${formatPrice(couponDiscount)}</span>
          </div>
          ` : ''}
          ${tip > 0 ? `
          <div style="display:flex; justify-content:space-between; color:#10b981;">
            <span>Propina al Repartidor:</span>
            <span>+ ${formatPrice(tip)}</span>
          </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:900; color:var(--color-primary); margin-top:4px;">
            <span>Cobrar al cliente:</span>
            <span id="client-total-preview">${formatPrice((parseFloat(order.subtotal) || 0) + serviceTotal)}</span>
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:${isPersistent ? '1fr' : '1fr 1fr'}; gap:12px;">
        ${isPersistent ? '' : '<button id="cancel-edit-price" style="height:54px; border-radius:18px; background:var(--color-bg-secondary); color:var(--color-text-secondary); border:none; font-weight:900; cursor:pointer;">CANCELAR</button>'}
        <button id="confirm-edit-price" style="height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:950; cursor:pointer; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.25);">GUARDAR</button>
      </div>
    </div>
  `;

  showModal({ content: modalEl, height: 'auto', hideHeader: true, persistent: isPersistent });

  const inputs = modalEl.querySelectorAll('.favor-store-price-input');
  const sumDisplay = modalEl.querySelector('#favor-products-sum');
  const preview = modalEl.querySelector('#client-total-preview');

  const updateTotals = () => {
    let sum = 0;
    inputs.forEach(input => {
      sum += parseFloat(input.value) || 0;
    });
    sumDisplay.textContent = formatPrice(sum);
    preview.textContent = formatPrice(sum + serviceTotal);
  };

  inputs.forEach(input => {
    input.oninput = updateTotals;
  });

  if (inputs.length > 0) {
    inputs[0].focus();
  }

  const cancelBtn = modalEl.querySelector('#cancel-edit-price');
  if (cancelBtn) {
    cancelBtn.onclick = () => closeModal();
  }

  modalEl.querySelector('#confirm-edit-price').onclick = () => {
    const storePrices = {};
    let hasInvalid = false;
    let sum = 0;

    inputs.forEach(input => {
      const name = input.dataset.storeName;
      const val = parseFloat(input.value) || 0;
      if (val < 0) hasInvalid = true;
      sum += val;
      storePrices[name] = val;
    });

    if (hasInvalid) {
      showToast('Por favor, ingresá montos válidos.', 'warning');
      return;
    }

    if (isPersistent && sum <= 0) {
      showToast(order.favorType === 'pagodeservicios' ? '⚠️ Debes ingresar el valor de las facturas pagadas.' : '⚠️ Debes ingresar el valor de los productos comprados.', 'warning');
      return;
    }

    closeModal();
    showToast('Actualizando precio...', 'info');

    (async () => {
      try {
        await saveFavorStorePrices(order.id, storePrices);
        showToast('Precios actualizados', 'success');
      } catch (e) {
        console.error('Update price error:', e);
        showToast('Error al actualizar', 'error');
      }
    })();
  };
}

async function saveFavorStorePrices(orderId, storePrices) {
  const { getDoc, doc: fDoc, serverTimestamp, addDoc, collection, updateDoc } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');
  const { formatPrice } = await import('../utils/format.js');
  
  // Fetch fresh data to ensure we have latest fees
  const snap = await getDoc(fDoc(db, 'orders', orderId));
  if (!snap.exists()) throw new Error('Order not found');
  const freshOrder = snap.data();
  
  const deliveryFee = freshOrder.deliveryCost || 0;
  const appFee = freshOrder.appUsageFee || 0;
  const pFee = freshOrder.purchaseFee || 0;
  const extraStops = freshOrder.extraStopsFee || 0;
  
  // Sum prices
  const val = Object.values(storePrices).reduce((sum, price) => sum + price, 0);
  const couponDiscount = freshOrder.couponDiscount || 0;
  const tip = freshOrder.tip || freshOrder.tipAmount || 0;
  const newTotal = Math.max(0, val + deliveryFee + appFee + pFee + extraStops - couponDiscount + tip);
  
  await updateDoc(fDoc(db, 'orders', orderId), {
    storePrices: storePrices,
    subtotal: val,
    total: newTotal
  });

  // Build detail message of stores
  const storeLines = Object.entries(storePrices)
    .map(([name, price]) => `• **${name}:** ${formatPrice(price)}`)
    .join('\n');

  // Add professional chat message
  await addDoc(collection(db, 'orders', orderId, 'messages'), {
    senderId: 'system',
    senderName: 'GoDelivery',
    text: `✅ **Actualización de Pedido**\n\nHola! El repartidor ha ingresado los precios de los productos en cada comercio:\n\n${storeLines}\n\n• **Total Productos:** ${formatPrice(val)}\n${pFee > 0 ? `• **Gestión Especial:** ${formatPrice(pFee)}\n` : ''}${extraStops > 0 ? `• **Paradas Extra:** ${formatPrice(extraStops)}\n` : ''}• **Servicio + Envío:** ${formatPrice(deliveryFee + appFee)}\n\n💰 **Total a abonar: ${formatPrice(newTotal)}**`,
    createdAt: serverTimestamp(),
    type: 'system'
  });
}
async function startSession(user) {
  const { getDoc, doc: fDoc } = await import('firebase/firestore');
  const userSnap = await getDoc(fDoc(db, 'users', user.uid));
  const userData = userSnap.exists() ? userSnap.data() : {};
  if (!userData.transferAlias || !userData.transferAlias.trim()) {
    showToast('⚠️ Debes configurar tu ALIAS para recibir transferencias en la sección de Configuración antes de conectarte.', 'warning');
    document.querySelector('.tab-pill[data-tab="config"]')?.click();
    return;
  }

  // FORCE GEOLOCATION PERMISSIONS
  let locationGranted = false;
  if (window.Capacitor && window.Capacitor.isNative) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const permStatus = await Geolocation.checkPermissions();
      if (permStatus.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location === 'granted') {
          locationGranted = true;
        }
      } else {
        locationGranted = true;
      }
    } catch (err) {
      console.warn('Capacitor native geolocation check failed:', err);
    }
  } else {
    locationGranted = true;
  }

  if (navigator.geolocation) {
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          (err) => {
            console.warn('High accuracy location failed, trying low accuracy...', err);
            navigator.geolocation.getCurrentPosition(
              resolve,
              (err2) => {
                reject(err2);
              },
              { timeout: 10000, enableHighAccuracy: false }
            );
          },
          { timeout: 8000, enableHighAccuracy: true }
        );
      });
    } catch (err) {
      console.warn('Geolocation check failed:', err);
      if (!window.Capacitor || !window.Capacitor.isNative) {
        showToast('⚠️ Conectado con precisión limitada. Activá tu GPS para recibir pedidos cercanos.', 'warning');
      } else {
        showToast('⚠️ Debes otorgar permisos de ubicación para poder conectarte y recibir pedidos.', 'danger');
        return; // Block native apps
      }
    }
  }

  // FORCE BACKGROUND LOCATION SETTINGS INSTRUCTION FOR NATIVE APPS
  if (window.Capacitor && window.Capacitor.isNative) {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const BgGeo = registerPlugin('BackgroundGeolocation');
      
      if (BgGeo) {
        showToast('Redirigiendo a permisos de ubicación...', 'info');
        
        // This triggers the native Android 11+ permission system prompt, 
        // which redirects the user directly to the app's location settings screen.
        const tempWatcherId = await BgGeo.addWatcher({
          backgroundMessage: "Activá el permiso de ubicación 'Permitir todo el tiempo' para poder recibir pedidos en segundo plano.",
          backgroundTitle: "GO! Permiso Requerido",
          requestPermissions: true,
          stale: true,
          distanceFilter: 1000
        }, () => {});
        
        // Cleanup the temporary watcher after a short delay
        setTimeout(() => {
          try {
            BgGeo.removeWatcher({ id: tempWatcherId });
          } catch(e) {}
        }, 5000);
      }
    } catch (err) {
      console.warn('Failed to trigger background permission check:', err);
    }
  }

  const { addDoc, collection, doc, updateDoc } = await import('firebase/firestore');
  const sessionRef = await addDoc(collection(db, 'deliverySessions'), {
    driverId: user.uid,
    startTime: serverTimestamp(),
    endTime: null,
    totalEarned: 0,
    ordersCount: 0
  });
  
  // Optimistic update FIRST
  const { setState, getState } = await import('../state.js');
  const updatedUser = { ...getState().user, isOnline: true, currentSessionId: sessionRef.id, lastActivityAt: new Date(), lastTripAcceptedAt: new Date() };
  setState('user', updatedUser);
  
  // Update Firestore in background
  await updateDoc(doc(db, 'users', user.uid), {
    isOnline: true,
    currentSessionId: sessionRef.id,
    lastActivityAt: serverTimestamp(),
    lastTripAcceptedAt: serverTimestamp()
  });
  
  startInactivityCheck(updatedUser);
  startHeartbeat(updatedUser);
  
  showToast('¡Sesión iniciada! Ya podés recibir pedidos.', 'success');
  
  // High-priority UI refresh
  const bar = document.getElementById('session-status-bar-container');
  if (bar) {
    bar.innerHTML = renderStatusBar(updatedUser);
    attachStatusBarListeners(updatedUser);
  }
}

async function endSession(user) {
  const { doc, updateDoc, getDoc } = await import('firebase/firestore');
  
  try {
    if (user.currentSessionId) {
      const sessRef = doc(db, 'deliverySessions', user.currentSessionId);
      const snap = await getDoc(sessRef);
      
      if (snap.exists()) {
        const { getDocs, query, collection, where } = await import('firebase/firestore');
        const ordersSnap = await getDocs(query(
          collection(db, 'orders'),
          where('deliverySessionId', '==', user.currentSessionId),
          where('status', '==', 'completed')
        ));
        const total = ordersSnap.docs.reduce((s, d) => {
          return s + getOrderDriverEarnings(d.data());
        }, 0);
        
        await updateDoc(sessRef, {
          endTime: serverTimestamp(),
          totalEarned: total,
          ordersCount: ordersSnap.size
        });
      } else {
        console.warn('endSession: Session document missing, skipping updateDoc');
      }
    }
  } catch (err) {
    console.error('Error updating session endTime:', err);
  }
  
  // Optimistic update FIRST
  const { setState, getState } = await import('../state.js');
  setState('user', { ...getState().user, isOnline: false, currentSessionId: null, lastActivityAt: null });

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      isOnline: false,
      currentSessionId: null,
      lastActivityAt: null
    });
  } catch (err) {
    console.error('Error updating user status in endSession:', err);
  }

  if (inactivityTimer) {
    clearInterval(inactivityTimer);
    inactivityTimer = null;
  }
  stopHeartbeat();

  showToast('Sesión finalizada. Hasta pronto.', 'info');
  
  // High-priority UI refresh
  const bar = document.getElementById('session-status-bar-container');
  const latest = getState().user;
  if (bar) {
    bar.innerHTML = renderStatusBar(latest);
    attachStatusBarListeners(latest);
  }
}

let inactivityTimer = null;
let heartbeatTimer = null;

function startHeartbeat(user) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  
  // Heartbeat every 2 minutes to keep delivery driver active
  heartbeatTimer = setInterval(async () => {
    const currentUser = getState().user || user;
    if (!currentUser || !currentUser.isOnline) {
      stopHeartbeat();
      return;
    }
    
    try {
      const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
      
      // Update Firestore timestamp
      await updateDoc(doc(db, 'users', currentUser.uid), {
        lastActivityAt: serverTimestamp()
      });
      
      // Update local state
      setState('user', { ...getState().user, lastActivityAt: new Date() });
      console.log('Heartbeat: updated lastActivityAt');
    } catch (e) {
      console.error('Heartbeat error:', e);
    }
  }, 120000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startInactivityCheck(user) {
  if (inactivityTimer) clearInterval(inactivityTimer);
  
  inactivityTimer = setInterval(async () => {
    const currentUser = getState().user || user;
    if (!currentUser || !currentUser.isOnline) return;
    
    const lastActivityValue = currentUser.lastActivityAt;
    let lastActivityDate;

    if (lastActivityValue && typeof lastActivityValue.toDate === 'function') {
      lastActivityDate = lastActivityValue.toDate();
    } else if (lastActivityValue instanceof Date) {
      lastActivityDate = lastActivityValue;
    } else if (typeof lastActivityValue === 'number') {
      lastActivityDate = new Date(lastActivityValue);
    } else {
      lastActivityDate = new Date();
    }

    // 1-hour trip/order inactivity check
    const lastTripValue = currentUser.lastTripAcceptedAt;
    let lastTripDate;
    if (lastTripValue && typeof lastTripValue.toDate === 'function') {
      lastTripDate = lastTripValue.toDate();
    } else if (lastTripValue instanceof Date) {
      lastTripDate = lastTripValue;
    } else if (typeof lastTripValue === 'number') {
      lastTripDate = new Date(lastTripValue);
    } else {
      lastTripDate = lastActivityDate; // fallback
    }

    const oneHour = 1 * 60 * 60 * 1000;
    const threeHours = 3 * 60 * 60 * 1000;
    
    if (new Date() - lastTripDate > threeHours) {
      console.log('Trip inactivity (3 hours) detected. Disconnecting...');
      await endSession(currentUser);
      renderDeliveryPanel();
      showToast('Sesión cerrada por inactividad (3 horas sin tomar viajes)', 'warning');
    } else if (new Date() - lastActivityDate > threeHours) {
      console.log('Inactivity detected. Disconnecting...');
      await endSession(currentUser);
      renderDeliveryPanel();
      showToast('Sesión cerrada por inactividad (3hs)', 'warning');
    }
  }, 60000); // Check every minute
}

function renderFinancesCharts(orders) {
  const container = document.getElementById('finances-charts-container');
  if (!container) return;

  const now = new Date();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dailyData = last7Days.map(date => {
    const dayOrders = orders.filter(o => {
      const oDate = new Date(o.deliveredAt);
      return oDate.getFullYear() === date.getFullYear() &&
             oDate.getMonth() === date.getMonth() &&
             oDate.getDate() === date.getDate();
    });
    const sum = dayOrders.reduce((s, o) => s + (o.deliveryCost || 0), 0);
    return {
      dayName: date.toLocaleDateString('es-ES', { weekday: 'short' }).substring(0, 2).toUpperCase(),
      amount: sum
    };
  });

  // Find max daily amount to scale bars
  const maxDaily = Math.max(...dailyData.map(d => d.amount), 1);

  // Calculate breakdown for Donut chart
  let totalBase = 0;
  let totalTips = 0;
  let totalExtras = 0;

  orders.forEach(o => {
    // Note: o.deliveryCost here has already been calculated as the net earnings in loadProfessionalStats!
    // Let's compute proportion based on original tip and extra values if they exist, or estimate.
    const tip = o.tip || o.tipAmount || 0;
    const extra = o.isFavor || o.isTrip ? ((o.purchaseFee || 0) + (o.extraStopsFee || 0)) : 0;
    const base = Math.max(0, o.deliveryCost - tip - extra);
    
    totalBase += base;
    totalTips += tip;
    totalExtras += extra;
  });

  const total = totalBase + totalTips + totalExtras;
  const basePct = total > 0 ? Math.round((totalBase / total) * 100) : 0;
  const tipsPct = total > 0 ? Math.round((totalTips / total) * 100) : 0;
  const extrasPct = total > 0 ? Math.max(0, 100 - basePct - tipsPct) : 0;

  const donutCircumference = 100;
  const strokeDash1 = `${basePct} ${donutCircumference - basePct}`;
  const strokeDash2 = `${tipsPct} ${donutCircumference - tipsPct}`;
  const strokeDash3 = `${extrasPct} ${donutCircumference - extrasPct}`;

  const offset1 = 100;
  const offset2 = 100 - basePct;
  const offset3 = 100 - basePct - tipsPct;

  container.innerHTML = `
    <!-- Weekly Bar Chart -->
    <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:18px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
      <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
        ${icon('chart', 16)} Actividad Semanal
      </h4>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; height:120px; padding:10px 0 5px; box-sizing:border-box;">
        ${dailyData.map(d => {
          const heightPct = Math.round((d.amount / maxDaily) * 100);
          return `
            <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:6px; cursor:pointer;" class="bar-chart-col">
              <div style="font-size:8px; font-weight:900; color:var(--color-text-tertiary); transform:scale(0.8); transition:all 0.2s;" class="bar-amount">${d.amount > 0 ? formatPrice(d.amount) : ''}</div>
              <div style="position:relative; width:12px; height:70px; background:var(--color-bg-secondary); border-radius:6px; overflow:hidden;">
                <div style="position:absolute; bottom:0; left:0; width:100%; height:${heightPct}%; background:linear-gradient(to top, var(--color-primary), #60a5fa); border-radius:6px; transition:height 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);"></div>
              </div>
              <div style="font-size:9.5px; font-weight:900; color:var(--color-text-tertiary);">${d.dayName}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Doughnut Distribution Chart -->
    <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:18px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
      <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
        ${icon('star', 15)} Distribución de Ganancias
      </h4>
      ${total > 0 ? `
        <div style="display:flex; align-items:center; gap:20px; justify-content:space-around;">
          <!-- SVG Donut -->
          <div style="position:relative; width:100px; height:100px;">
            <svg viewBox="0 0 42 42" width="100" height="100" style="transform:rotate(-90deg);">
              <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="var(--color-border-light)" stroke-width="4.5"></circle>
              <!-- Base -->
              ${basePct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#3b82f6" stroke-width="4.5" stroke-dasharray="${strokeDash1}" stroke-dashoffset="${offset1}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
              <!-- Tips -->
              ${tipsPct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#10b981" stroke-width="4.5" stroke-dasharray="${strokeDash2}" stroke-dashoffset="${offset2}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
              <!-- Extras -->
              ${extrasPct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#f59e0b" stroke-width="4.5" stroke-dasharray="${strokeDash3}" stroke-dashoffset="${offset3}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
            </svg>
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none;">
              <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; line-height:1;">Total</span>
              <span style="font-size:12.5px; font-weight:950; color:var(--color-text-primary); letter-spacing:-0.5px;">${formatPrice(total)}</span>
            </div>
          </div>

          <!-- Legends and values -->
          <div style="display:flex; flex-direction:column; gap:8px; flex:1;">
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#3b82f6;"></div>
                <span style="color:var(--color-text-secondary); font-weight:800;">Tarifa Envío</span>
              </div>
              <span style="font-weight:900; color:var(--color-text-primary);">${basePct}%</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#10b981;"></div>
                <span style="color:var(--color-text-secondary); font-weight:800;">Propinas</span>
              </div>
              <span style="font-weight:900; color:var(--color-text-primary);">${tipsPct}%</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#f59e0b;"></div>
                <span style="color:var(--color-text-secondary); font-weight:800;">Extras/Viajes</span>
              </div>
              <span style="font-weight:900; color:var(--color-text-primary);">${extrasPct}%</span>
            </div>
          </div>
        </div>
      ` : `
        <div style="text-align:center; padding:20px; font-size:11.5px; color:var(--color-text-tertiary); font-weight:700;">
          Aún no tienes entregas completadas en este período para graficar.
        </div>
      `}
    </div>

    <style>
      .bar-chart-col:hover .bar-amount {
        color: var(--color-primary) !important;
        transform: scale(1.05) translateY(-2px);
      }
      .legend-row {
        padding: 4px 6px;
        border-radius: 8px;
        transition: background 0.2s;
      }
      .legend-row:hover {
        background: var(--color-bg-secondary);
      }
    </style>
  `;
}

async function loadProfessionalStats(driverId, callback = null) {
  const { getDocs, collection, query, where } = await import('firebase/firestore');
  const q = query(collection(db, 'orders'), where('driverId', '==', driverId), where('status', '==', 'completed'));
  
  try {
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => {
      const data = d.data();
      let deliveredDate = null;
      if (data.deliveredAt && typeof data.deliveredAt.toDate === 'function') {
        deliveredDate = data.deliveredAt.toDate();
      } else if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        deliveredDate = data.createdAt.toDate();
      } else {
        deliveredDate = new Date();
      }
      const netEarnings = getOrderDriverEarnings(data);
      return {
        ...data,
        deliveryCost: netEarnings,
        deliveredAt: deliveredDate
      };
    });
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    
    const earningsDay = orders.filter(o => o.deliveredAt >= today).reduce((s, o) => s + (o.deliveryCost || 0), 0);
    const earningsWeek = orders.filter(o => o.deliveredAt >= weekAgo).reduce((s, o) => s + (o.deliveryCost || 0), 0);
    const earningsMonth = orders.filter(o => o.deliveredAt >= monthAgo).reduce((s, o) => s + (o.deliveryCost || 0), 0);
    
    if (document.getElementById('stats-day')) document.getElementById('stats-day').textContent = formatPrice(earningsDay);
    if (document.getElementById('stats-week')) document.getElementById('stats-week').textContent = formatPrice(earningsWeek);
    if (document.getElementById('stats-month')) document.getElementById('stats-month').textContent = formatPrice(earningsMonth);

    // Render the CSS/SVG charts dynamically
    renderFinancesCharts(orders);

    if (callback) callback({ today: earningsDay, week: earningsWeek, month: earningsMonth });
  } catch (e) { console.error(e); }
}

async function showBalanceManagementModal(user, debt) {
  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding:20px; background:var(--color-bg); height:100%; display:flex; flex-direction:column; overflow:hidden;';
  
  modalEl.innerHTML = `
    <div style="margin-bottom:16px; text-align:center; flex-shrink:0;">
      <div style="width:48px; height:48px; border-radius:16px; background:rgba(239,68,68,0.1); color:#ef4444; display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">
        ${icon('bank', 24)}
      </div>
      <h2 style="font-family:var(--font-display); font-size:1.4rem; font-weight:950; margin:0; letter-spacing:-0.03em; color:var(--color-text-primary);">Balance</h2>
      <p style="font-size:12px; color:var(--color-text-tertiary); margin-top:4px; font-weight:700; opacity:0.8;">Estado de cuenta y pagos</p>
    </div>

    <div style="flex:1; display:flex; flex-direction:column; gap:16px; overflow:hidden;">
      <div class="debt-card-v3" style="
        background: ${debt > 0 ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)' : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'};
        border: 1.5px solid ${debt > 0 ? '#fecaca' : '#bbf7d0'};
        border-radius: 24px; padding: 20px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.04);
        text-align: center;
        flex-shrink: 0;
      ">
        <style>
          [data-theme="dark"] .debt-card-v3 {
            background: ${debt > 0 ? 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)' : 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)'} !important;
            border-color: ${debt > 0 ? '#991b1b' : '#065f46'} !important;
          }
        </style>
        <span style="font-size:10px; font-weight:900; color:${debt > 0 ? '#ef4444' : '#10b981'}; text-transform:uppercase; letter-spacing:0.1em; display:block; margin-bottom:8px;">Balance Pendiente</span>
        <div style="font-size:36px; font-weight:950; color:${debt > 0 ? '#ef4444' : '#10b981'}; letter-spacing:-1.5px; line-height:1;">${formatPrice(debt)}</div>
        <p style="font-size:11px; color:var(--color-text-tertiary); margin:12px 0 0; font-weight:700; line-height:1.4; opacity:0.8;">
          ${debt > 0 ? 'Este monto será descontado de tus próximas ganancias.' : 'No tenés deudas pendientes con la plataforma.'}
        </p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; flex-shrink:0;">
        <button id="modal-view-history-btn" style="height:48px; border-radius:16px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text-primary); font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase;">
          ${icon('history', 16)} Historial
        </button>
        <button id="modal-regularize-btn" style="height:48px; border-radius:16px; background:var(--color-primary); border:none; color:white; font-weight:900; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; box-shadow:0 6px 15px rgba(var(--color-primary-rgb), 0.2);">
          ${icon('wallet', 16)} Regularizar
        </button>
      </div>

      <button id="modal-send-proof-btn" style="width:100%; height:54px; border-radius:18px; background:#25D366; border:none; color:white; font-weight:950; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; box-shadow:0 8px 20px rgba(37, 211, 102, 0.25); flex-shrink:0;">
        ${icon('whatsappLogo', 20)} Enviar comprobante
      </button>
    </div>
  `;

  showModal({ title: 'Gestión de Balance', content: modalEl, height: '70dvh' });

  modalEl.querySelector('#modal-view-history-btn').onclick = () => {
    showBalanceHistoryModal(user.uid);
  };
  modalEl.querySelector('#modal-regularize-btn').onclick = () => {
    showRegularizeModal(debt);
  };
  modalEl.querySelector('#modal-send-proof-btn').onclick = () => {
    const wsp = getState().whatsappPayments || '5491123456789';
    const msg = encodeURIComponent(`Hola, adjunto comprobante de pago de GoDelivery.\n---\nREPARTIDOR: ${user.displayName || user.name}\nID: ${user.deliveryId || '---'}\nMONTO: ${formatPrice(debt)}\nDETALLE: Saldar balance pendiente.`);
    window.open(`https://wa.me/${wsp}?text=${msg}`, '_blank');
  };
}

async function showRegularizeModal(debt) {
  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding:24px; background:var(--color-bg); height:100%; display:flex; flex-direction:column;';
  
  modalEl.innerHTML = `
    <div style="margin-bottom:24px; text-align:center;">
      <div style="width:64px; height:64px; border-radius:20px; background:rgba(79,70,229,0.1); color:#4f46e5; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
        ${icon('bank', 32)}
      </div>
      <h2 style="font-family:var(--font-display); font-size:1.5rem; font-weight:900; margin:0; letter-spacing:-0.02em;">Regularizar Balance</h2>
      <p style="font-size:13px; color:var(--color-text-tertiary); margin-top:8px;">Para saldar tu deuda de <strong>${formatPrice(debt)}</strong>, realizá una transferencia:</p>
    </div>

    <div style="flex:1;">
      <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:20px; padding:20px; margin-bottom:24px;">
        <div style="margin-bottom:16px; border-bottom:1px dashed var(--color-border-light); padding-bottom:12px;">
          <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; display:block;">ALIAS / CVU</label>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:18px; color:var(--color-text); letter-spacing:0.02em;">godelivery.pagos</strong>
            <button class="btn-copy" onclick="navigator.clipboard.writeText('godelivery.pagos'); showToast('Copiado', 'success')" style="background:none; border:none; color:var(--color-primary); cursor:pointer;">${icon('copy', 18)}</button>
          </div>
        </div>
        
        <div>
          <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; display:block;">TITULAR</label>
          <strong style="font-size:14px; color:var(--color-text);">GoDelivery S.R.L.</strong>
        </div>
      </div>

      <div style="background:rgba(255,193,7,0.1); border:1px solid rgba(255,193,7,0.2); border-radius:16px; padding:16px; display:flex; gap:12px; align-items:flex-start;">
        <div style="color:#ffc107; margin-top:2px;">${icon('info', 18)}</div>
        <p style="font-size:12px; color:var(--color-text-secondary); margin:0; line-height:1.4; font-weight:600;">
          Una vez realizada la transferencia, presioná el botón de abajo para enviar el comprobante por WhatsApp y que nuestro equipo habilite tu balance.
        </p>
      </div>
    </div>

    <button id="modal-send-proof-btn"
            style="width:100%; height:56px; border-radius:18px; background:#25D366; color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 12px 24px rgba(37,211,102,0.3); display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase;">
      <div style="color:white; display:flex;">${icon('whatsappLogo', 22)}</div> ENVIAR COMPROBANTE
    </button>
  `;

  showModal({ title: 'Regularizar Balance', content: modalEl, height: '70dvh' });

  modalEl.querySelector('#modal-send-proof-btn').onclick = () => {
    const user = getState().user;
    const wsp = getState().whatsappPayments || '5491123456789';
    const msg = encodeURIComponent(`Hola, adjunto comprobante de pago de GoDelivery.\n---\nREPARTIDOR: ${user.displayName || user.name}\nID: ${user.deliveryId || '---'}\nMONTO: ${formatPrice(debt)}\nDETALLE: Saldar balance pendiente.`);
    window.open(`https://wa.me/${wsp}?text=${msg}`, '_blank');
  };
}

async function loadRecentSessionsList(uid) {
  const container = document.getElementById('recent-sessions-list');
  if (!container) return;

  try {
    const { getDocs, query, collection, where } = await import('firebase/firestore');
    const q = query(
      collection(db, 'deliverySessions'),
      where('driverId', '==', uid)
    );
    const snap = await getDocs(q);
    let sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Fallback if empty
    if (sessions.length === 0) {
      const user = getState().user;
      if (user && user.deliveryId) {
        const snap2 = await getDocs(query(
          collection(db, 'deliverySessions'),
          where('driverDeliveryId', '==', user.deliveryId)
        ));
        sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }

    sessions = sessions.filter(s => s.startTime);
    sessions.sort((a, b) => (b.startTime?.toMillis() || 0) - (a.startTime?.toMillis() || 0));

    // Limit to 4 sessions
    const recent = sessions.slice(0, 4);

    if (recent.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:16px; color:var(--color-text-tertiary); font-size:12px; font-weight:700;">
          Aún no tenés sesiones registradas.
        </div>
      `;
      return;
    }

    // Fetch all completed orders for this driver to compute actual stats in real time
    const ordersSnap = await getDocs(query(
      collection(db, 'orders'),
      where('driverId', '==', uid),
      where('status', '==', 'completed')
    ));
    const allCompletedOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    container.innerHTML = recent.map(s => {
      let dateStr = 'Fecha desconocida';
      if (s.startTime) {
        const d = s.startTime.toDate ? s.startTime.toDate() : new Date(s.startTime);
        dateStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
        dateStr = dateStr.replace('.', '');
      }

      // Compute stats dynamically from Firestore orders for accuracy
      const sessOrders = allCompletedOrders.filter(o => {
        if (o.deliverySessionId === s.id) return true;
        // Fallback: match by timestamp range if deliverySessionId is missing
        if (!o.deliverySessionId && o.deliveredAt && s.startTime) {
          const deliveredTime = o.deliveredAt.toMillis ? o.deliveredAt.toMillis() : new Date(o.deliveredAt).getTime();
          const sessionStart = s.startTime.toMillis ? s.startTime.toMillis() : new Date(s.startTime).getTime();
          const sessionEnd = s.endTime 
            ? (s.endTime.toMillis ? s.endTime.toMillis() : new Date(s.endTime).getTime())
            : Date.now();
          return deliveredTime >= sessionStart && deliveredTime <= sessionEnd;
        }
        return false;
      });

      const total = sessOrders.reduce((sum, o) => {
        return sum + getOrderDriverEarnings(o);
      }, 0);

      const uniqueBundles = new Set(sessOrders.map(o => o.bundleId || o.id));
      const count = uniqueBundles.size;
      const isLive = s.id === getState().user?.currentSessionId;

      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:14px; gap:12px;">
          <div style="flex:1; display:flex; align-items:center; gap:8px;">
            <div style="width:8px; height:8px; border-radius:50%; background:${isLive ? '#22c55e' : 'var(--color-text-tertiary)'}; ${isLive ? 'box-shadow:0 0 8px #22c55e;' : ''}"></div>
            <span style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); text-transform:capitalize;">${dateStr}</span>
            ${isLive ? `<span style="font-size:9px; font-weight:900; background:rgba(34,197,94,0.1); color:#22c55e; padding:1px 6px; border-radius:4px; margin-left:4px;">VIVO</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:14px; text-align:right;">
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:8px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Pedidos</span>
              <span style="font-size:12px; font-weight:800; color:var(--color-text-primary);">${count}</span>
            </div>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:8px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Ganancia</span>
              <span style="font-size:12.5px; font-weight:900; color:var(--color-primary);">${formatPrice(total)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error rendering recent sessions:', err);
    container.innerHTML = `
      <div style="text-align:center; padding:16px; color:var(--color-text-tertiary); font-size:12px;">
        Error al cargar historial.
      </div>
    `;
  }
}

async function showSessionsHistoryModal(driverId) {
  const { getDocs, collection, query, where, orderBy } = await import('firebase/firestore');
  
  const content = document.createElement('div');
  content.style.cssText = 'padding:20px; background:var(--color-bg); min-height:60dvh; display:flex; flex-direction:column; gap:16px;';
  
  const now = new Date();
  let currentMonth = now.getMonth(); // 0-11
  let currentYear = now.getFullYear();

  const renderSessionList = async (month, year) => {
    const listContainer = content.querySelector('#sessions-list-render');
    listContainer.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;
    
    try {
      console.log('[DEBUG] Querying sessions for driverId:', driverId);
      const q = query(
        collection(db, 'deliverySessions'), 
        where('driverId', '==', driverId)
      );
      
      const snap = await getDocs(q);
      let sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      if (sessions.length === 0) {
        const user = getState().user;
        if (user.deliveryId) {
          const q2 = query(collection(db, 'deliverySessions'), where('driverDeliveryId', '==', user.deliveryId));
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
          }
        }
      }

      const startOfMonth = new Date(year, month, 1, 0, 0, 0).getTime();
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();

      sessions = sessions.filter(s => {
        let time = 0;
        if (s.startTime?.toMillis) time = s.startTime.toMillis();
        else if (s.startTime?.seconds) time = s.startTime.seconds * 1000;
        else if (s.startTime instanceof Date) time = s.startTime.getTime();
        else if (typeof s.startTime === 'number') time = s.startTime;
        
        return time >= startOfMonth && time <= endOfMonth;
      });

      sessions.sort((a, b) => (b.startTime?.toMillis() || 0) - (a.startTime?.toMillis() || 0));

      // Fetch all completed orders for this driver to compute actual stats in real time
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('driverId', '==', driverId),
        where('status', '==', 'completed')
      ));
      const allCompletedOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      sessions = sessions.map(s => {
        const sessOrders = allCompletedOrders.filter(o => {
          if (o.deliverySessionId === s.id) return true;
          // Fallback: match by timestamp range if deliverySessionId is missing
          if (!o.deliverySessionId && o.deliveredAt && s.startTime) {
            const deliveredTime = o.deliveredAt.toMillis ? o.deliveredAt.toMillis() : new Date(o.deliveredAt).getTime();
            const sessionStart = s.startTime.toMillis ? s.startTime.toMillis() : new Date(s.startTime).getTime();
            const sessionEnd = s.endTime 
              ? (s.endTime.toMillis ? s.endTime.toMillis() : new Date(s.endTime).getTime())
              : Date.now();
            return deliveredTime >= sessionStart && deliveredTime <= sessionEnd;
          }
          return false;
        });

        const totalEarned = sessOrders.reduce((sum, o) => {
          return sum + getOrderDriverEarnings(o);
        }, 0);

        const uniqueBundles = new Set(sessOrders.map(o => o.bundleId || o.id));
        const ordersCount = uniqueBundles.size;

        return {
          ...s,
          totalEarned,
          ordersCount
        };
      });
      
      const totalMonth = sessions.reduce((s, sess) => s + (sess.totalEarned || 0), 0);
      content.querySelector('#month-total-display').textContent = formatPrice(totalMonth);

      if (sessions.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align:center; padding:60px 20px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;">
            <div style="width:64px; height:64px; border-radius:50%; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary);">
              ${icon('calendar', 28)}
            </div>
            <div style="margin-top:4px;">
              <p style="margin:0; font-weight:800; font-size:14px; color:var(--color-text-primary);">Sin sesiones en este período</p>
              <p style="margin:4px 0 0; font-size:11.5px; color:var(--color-text-tertiary);">Las sesiones que realices en este mes aparecerán acá.</p>
            </div>
          </div>
        `;
        return;
      }
      
      listContainer.innerHTML = sessions.map(s => {
        const start = s.startTime?.toDate();
        const end = s.endTime?.toDate();
        let durationStr = 'En curso';
        
        if (start && end) {
          const diffMs = end - start;
          const hours = Math.floor(diffMs / 3600000);
          const minutes = Math.floor((diffMs % 3600000) / 60000);
          durationStr = `${hours > 0 ? hours + 'h ' : ''}${minutes}min`;
        }

        const isLive = s.id === getState().user?.currentSessionId;

        return `
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm); margin-bottom:12px; transition:all 0.2s;">
            <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-weight:900; font-size:15px; color:var(--color-text-primary); text-transform:capitalize;">
                  ${new Date(s.startTime?.toDate()).toLocaleDateString('es-AR', {day:'numeric', month:'short'})}
                </span>
                ${isLive ? `<span style="font-size:9px; font-weight:900; background:rgba(34,197,94,0.1); color:#22c55e; padding:1px 6px; border-radius:6px; letter-spacing:0.02em;">VIVO</span>` : ''}
              </div>
              <div style="font-size:11.5px; color:var(--color-text-secondary); font-weight:600; display:flex; align-items:center; gap:4px;">
                <span>${new Date(s.startTime?.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                <span style="opacity:0.5;">→</span>
                <span>${s.endTime ? new Date(s.endTime?.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Activa'}</span>
              </div>
              <div style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">
                Duración: <span style="color:var(--color-text-primary); font-weight:800;">${durationStr}</span>
              </div>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; gap:4px; margin-left:16px;">
              <div style="font-weight:950; font-size:18px; color:${isLive ? '#22c55e' : 'var(--color-primary)'}; letter-spacing:-0.5px;">${formatPrice(s.totalEarned || 0)}</div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">${s.ordersCount || 0} pedidos</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      listContainer.innerHTML = `<p style="color:var(--color-danger); text-align:center; font-size:12px; font-weight:700; padding:20px;">Error al cargar. Verificá tu conexión.</p>`;
    }
  };

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  content.innerHTML = `
    <!-- Top Month Selector Card -->
    <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm);">
      <div style="display:flex; align-items:center; gap:10px;">
        <button id="prev-month" style="width:38px; height:38px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
          ${icon('chevronLeft', 16)}
        </button>
        <div style="text-align:center; min-width:90px;">
          <div id="month-name" style="font-weight:900; font-size:15px; color:var(--color-text-primary); text-transform:capitalize;">${monthNames[currentMonth]}</div>
          <div id="year-name" style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); margin-top:2px;">${currentYear}</div>
        </div>
        <button id="next-month" style="width:38px; height:38px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
          ${icon('chevronRight', 16)}
        </button>
      </div>
      <div style="text-align:right;">
        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">Total Mes</div>
        <div id="month-total-display" style="font-size:20px; font-weight:950; color:#22c55e; letter-spacing:-0.5px;">$0</div>
      </div>
    </div>

    <!-- Actions Row -->
    <div style="display:flex; justify-content:center;">
      <button id="recalculate-sessions-btn" style="padding:10px 18px; border-radius:14px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); color:var(--color-primary); font-size:11px; font-weight:900; text-transform:uppercase; cursor:pointer; display:flex; align-items:center; gap:6px; letter-spacing:0.04em; transition:all 0.2s; box-shadow:var(--shadow-sm);" onmouseover="this.style.background='var(--color-bg-card)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
        ${icon('refresh', 13)} Recalcular Totales
      </button>
    </div>

    <!-- Session List Render Container -->
    <div id="sessions-list-render" style="flex:1; overflow-y:auto; padding-bottom:10px;"></div>
  `;
  
  showModal({ title: 'Historial de Sesiones', content, height: '80dvh' });
  
  renderSessionList(currentMonth, currentYear);

  content.querySelector('#prev-month').onclick = () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    content.querySelector('#month-name').textContent = monthNames[currentMonth];
    content.querySelector('#year-name').textContent = currentYear;
    renderSessionList(currentMonth, currentYear);
  };

  content.querySelector('#next-month').onclick = () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    content.querySelector('#month-name').textContent = monthNames[currentMonth];
    content.querySelector('#year-name').textContent = currentYear;
    renderSessionList(currentMonth, currentYear);
  };

  content.querySelector('#recalculate-sessions-btn').onclick = async () => {
    const btn = content.querySelector('#recalculate-sessions-btn');
    btn.disabled = true;
    btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Recalculando...';
    
    try {
      const { getDocs, collection, query, where, updateDoc, doc: fDoc } = await import('firebase/firestore');
      
      // 1. Fetch all completed orders for this driver
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'), 
        where('driverId', '==', driverId), 
        where('status', '==', 'completed')
      ));
      const orders = ordersSnap.docs.map(d => {
        const data = d.data();
        const netEarnings = getOrderDriverEarnings(data);
        return {
          ...data,
          deliveryCost: netEarnings,
          deliveredAt: data.deliveredAt?.toDate()
        };
      });

      // 2. Fetch all sessions for this driver
      const sessionsSnap = await getDocs(query(
        collection(db, 'deliverySessions'), 
        where('driverId', '==', driverId)
      ));
      
      for (const sDoc of sessionsSnap.docs) {
        const sess = sDoc.data();
        const start = sess.startTime?.toDate();
        const end = sess.endTime?.toDate() || new Date(); // If in progress, use now

        // Find orders delivered within this session
        const sessOrders = orders.filter(o => {
          if (!o.deliveredAt) return false;
          return o.deliveredAt >= start && o.deliveredAt <= end;
        });

        const newTotal = sessOrders.reduce((s, o) => s + (o.deliveryCost || 0), 0);
        
        // Count unique bundles or single orders as 1 delivery
        const uniqueBundles = new Set(sessOrders.map(o => o.bundleId || o.id));
        const newCount = uniqueBundles.size;

        // Update if different
        if (newTotal !== sess.totalEarned || newCount !== sess.ordersCount) {
          await updateDoc(fDoc(db, 'deliverySessions', sDoc.id), {
            totalEarned: newTotal,
            ordersCount: newCount
          });
        }
      }
      
      showToast('Totales sincronizados correctamente', 'success');
      renderSessionList(currentMonth, currentYear);
    } catch (e) {
      console.error(e);
      showToast('Error al recalcular', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = icon('refresh', 14) + ' Recalcular Totales';
    }
  };
}
async function showBalanceHistoryModal(driverId) {
  const { getDocs, collection, query, where, orderBy } = await import('firebase/firestore');
  
  const content = document.createElement('div');
  content.style.cssText = 'padding:24px; background:var(--color-bg); min-height:60dvh; display:flex; flex-direction:column;';
  content.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;
  
  showModal({ title: 'Historial de Balance', content, height: '80dvh' });
  
  try {
    const q = query(
      collection(db, 'delivery_transactions'), 
      where('driverId', '==', driverId)
    );
    
    const snap = await getDocs(q);
    const transactions = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    
    if (transactions.length === 0) {
      content.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--color-text-tertiary); opacity:0.6;">${icon('receipt', 48)}<p style="margin-top:16px; font-weight:600;">No hay movimientos registrados</p></div>`;
      return;
    }
    
    content.innerHTML = `
      <div style="flex:1; overflow-y:auto; padding-bottom:20px;">
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${transactions.map(t => {
            const isLiquidation = t.type === 'liquidation';
            const isCoupon = t.type === 'coupon_reimbursement';
            const amount = t.amount || 0;
            const absAmount = Math.abs(amount);

            let iconColor = '#ef4444';
            let iconBg = 'rgba(239,68,68,0.1)';
            let iconName = 'package';
            let amountSign = '+';
            let amountColor = '#ef4444';
            let labelText = 'Tarifa App';

            if (isLiquidation) {
              iconColor = '#22c55e';
              iconBg = 'rgba(34,197,94,0.1)';
              iconName = 'checkCircle';
              amountSign = '-';
              amountColor = '#22c55e';
              labelText = 'Saldo Restado';
            } else if (isCoupon) {
              iconColor = '#a855f7';
              iconBg = 'rgba(168,85,247,0.1)';
              iconName = 'tag';
              amountSign = '-';
              amountColor = '#a855f7';
              labelText = 'Reintegro Cupón';
            }
            
            return `
              <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:18px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm);">
                <div style="min-width:0; flex:1; display:flex; align-items:center; gap:14px;">
                  <div style="width:40px; height:40px; border-radius:12px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${icon(iconName, 20)}
                  </div>
                  <div style="min-width:0;">
                    <div style="font-weight:800; font-size:14px; color:var(--color-text); margin-bottom:2px;">${t.description || (isLiquidation ? 'Liquidación' : isCoupon ? 'Reintegro Cupón' : 'Entrega')}</div>
                    <div style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">
                      ${t.createdAt ? new Date(t.createdAt.toDate()).toLocaleDateString('es-AR', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : ''}
                    </div>
                  </div>
                </div>
                <div style="text-align:right; margin-left:16px;">
                  <div style="font-weight:900; font-size:17px; color:${amountColor}; letter-spacing:-0.5px;">
                    ${amountSign}${formatPrice(absAmount)}
                  </div>
                  <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">
                    ${labelText}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div style="margin-top:20px; padding-top:20px; border-top:1px solid var(--color-border-light); text-align:center;">
        <p style="font-size:11px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Historial completo de movimientos</p>
      </div>
    `;
  } catch (e) {
    console.error(e);
    content.innerHTML = `<p style="color:var(--color-danger); text-align:center; padding:40px;">Error al cargar el historial de balance.</p>`;
  }
}

function renderStatusBar(user) {
  // Always use fresh state for rendering styles
  const latestUser = getState().user || user;
  const finalIsOnline = latestUser.isOnline === true;
  
  if (!document.getElementById('status-bar-styles')) {
    const s = document.createElement('style');
    s.id = 'status-bar-styles';
    s.textContent = `
      @keyframes status-pulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
        70% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
      }
      .status-dot-active { animation: status-pulse 2s infinite; }
      .status-bar-slide { animation: slideInStatusBar 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
      @keyframes slideInStatusBar {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }

  return `
    <div id="session-status-bar" class="status-bar-slide" style="
      padding: 12px 20px;
      background: ${finalIsOnline ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.05)'};
      border-bottom: 1px solid ${finalIsOnline ? 'rgba(34,197,94,0.12)' : 'var(--color-border-light)'};
      display: flex; align-items: center; justify-content: space-between;
      backdrop-filter: blur(10px);
      transition: all 0.5s ease;
    ">
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="${finalIsOnline ? 'status-dot-active' : ''}" style="
          width: 10px; height: 10px; border-radius: 50%;
          background: ${finalIsOnline ? '#22c55e' : '#64748b'};
          box-shadow: ${finalIsOnline ? '0 0 12px #22c55e' : 'none'};
          transition: all 0.5s ease;
        "></div>
        <div style="display:flex; flex-direction:column;">
          <span style="
            font-size: 12px; font-weight: 800;
            color: ${finalIsOnline ? '#22c55e' : 'var(--color-text-tertiary)'};
            text-transform: uppercase; letter-spacing: 0.05em;
            transition: all 0.5s ease;
          ">
            ${finalIsOnline ? 'Conectado' : 'Desconectado'}
          </span>
          <span style="font-size: 10px; color: var(--color-text-tertiary); font-weight: 600;">
            ${finalIsOnline ? 'Recibiendo pedidos en vivo' : 'No visible para comercios'}
          </span>
        </div>
      </div>
      <button id="session-toggle-btn" style="
        height: 36px; padding: 0 18px; border-radius: 12px;
        border: none;
        background: ${finalIsOnline ? 'rgba(239, 68, 68, 0.08)' : 'var(--color-primary)'};
        color: ${finalIsOnline ? '#ef4444' : 'white'};
        font-weight: 900; font-size: 11px;
        cursor: pointer;
        box-shadow: ${finalIsOnline ? 'none' : '0 4px 15px rgba(var(--color-primary-rgb), 0.3)'};
        border: 1px solid ${finalIsOnline ? 'rgba(239, 68, 68, 0.2)' : 'transparent'};
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        text-transform: uppercase;
        display: flex; align-items: center; gap: 8px;
      ">
        ${finalIsOnline ? icon('x', 14) + ' Desconectar' : icon('power', 14) + ' Conectar'}
      </button>
    </div>
  `;
}

function attachStatusBarListeners(user) {
  const btn = document.getElementById('session-toggle-btn');
  if (!btn) return;
  
  btn.onclick = () => {
    if (user.isOnline) {
      if (activeOrdersCount > 0) {
        showToast('⚠️ No podés desconectarte si tenés pedidos en curso', 'warning');
        return;
      }
      showConfirm({
        title: '¿Desconectarse?',
        message: 'Dejarás de recibir notificaciones de nuevos pedidos.',
        confirmText: 'Sí, desconectar',
        onConfirm: async () => {
          try {
            btn.disabled = true;
            btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Desconectando...';
            await endSession(user);
          } catch (err) {
            console.error('Logout error:', err);
            showToast('Error al desconectar', 'error');
            btn.disabled = false;
            btn.innerHTML = icon('x', 14) + ' Desconectar';
          } finally {
            closeModal();
          }
        }
      });
    } else {
      showConfirm({
        title: '¿Conectarse?',
        message: 'Comenzarás a recibir pedidos disponibles en tu zona.',
        confirmText: 'Sí, conectar',
        onConfirm: async () => {
          try {
            btn.disabled = true;
            btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Conectando...';
            await startSession(user);
          } catch (err) {
            console.error('Login error:', err);
            showToast('Error al conectar', 'error');
            btn.disabled = false;
            btn.innerHTML = icon('power', 14) + ' Conectar';
          } finally {
            closeModal();
          }
        }
      });
    }
  };
}

// --- LOGIC FUNCTIONS ---

let isCurrentlyTakingBatch = false;

function getDistanceSync(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function takeBatch(batchId, user, batchData = null, btn = null) {
  if (isCurrentlyTakingBatch) {
    console.log('[takeBatch] A order claim is already in progress, ignoring double-click.');
    return;
  }
  isCurrentlyTakingBatch = true;
  try {
    // Check mandatory transfer alias
    const userData = getState().user || user;
    if (!userData.transferAlias || !userData.transferAlias.trim()) {
      showToast('⚠️ Debes configurar tu ALIAS para recibir transferencias en la sección de Configuración antes de tomar pedidos.', 'warning');
      document.querySelector('.tab-pill[data-tab="config"]')?.click();
      isCurrentlyTakingBatch = false;
      return;
    }

    // Default estimated delivery time to 30 mins
    const estTime = 30;

    let ordersToTake = [];
    if (batchData && batchData.isBundle) {
      ordersToTake = batchData.orders;
    } else if (batchData && batchData.order) {
      ordersToTake = [batchData.order];
    } else {
      const { getDocs, query, collection, where } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'orders'), where('bundleId', '==', batchId)));
      if (snap.empty) {
        const { getDoc, doc } = await import('firebase/firestore');
        const docSnap = await getDoc(doc(db, 'orders', batchId));
        if (docSnap.exists()) {
          ordersToTake = [{ id: docSnap.id, ...docSnap.data() }];
        } else {
          const single = await getDocs(query(collection(db, 'orders'), where('id', '==', batchId)));
          ordersToTake = single.docs.map(d => ({ id: d.id, ...d.data() }));
        }
      } else {
        ordersToTake = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }

    if (ordersToTake.length === 0) throw new Error('No se encontraron pedidos');

    // Anti-hoarding Smart Dynamic Cap Logic (Using cached activeOrdersList for immediate lookup)
    const activeOrders = activeOrdersList;
    const activeCount = activeOrders.length;
    const ordersToTakeCount = ordersToTake.length;
    const totalCount = activeCount + ordersToTakeCount;

    console.log(`[Smart Caps] Active count: ${activeCount}. Taking: ${ordersToTakeCount}. Total: ${totalCount}`);

    // Check if active orders and orders to take all belong to the same commerce local
    const allActiveFromSameCommerce = activeCount > 0 && activeOrders.every(o => o.comercioId && o.comercioId === activeOrders[0].comercioId);
    const firstActiveCommerceId = activeCount > 0 ? activeOrders[0].comercioId : null;
    const allTakingFromSameCommerce = ordersToTake.every(o => o.comercioId && o.comercioId === ordersToTake[0].comercioId);
    const takingCommerceId = ordersToTake[0]?.comercioId;

    const isSameCommerceCoRetiro = (activeCount === 0 && allTakingFromSameCommerce) || 
      (activeCount > 0 && allActiveFromSameCommerce && allTakingFromSameCommerce && firstActiveCommerceId === takingCommerceId);

    // Rule 1: If driver is already performing a co-retiro route (2 or more active orders in progress), they cannot take any more orders.
    // EXCEPTION: If the active orders and the new order are all from the SAME commerce, they can take up to 3 orders in total.
    if (activeCount >= 2) {
      if (!(isSameCommerceCoRetiro && totalCount <= 3)) {
        throw new Error(`¡Límite de co-retiro activo! Como ya estás realizando un co-retiro (${activeCount} pedidos activos), no podés tomar ningún otro pedido en simultáneo hasta que entregues los actuales.`);
      }
    }

    // Rule 2: If driver currently has a simple order (exactly 1 active order in progress), they are allowed to take exactly 1 additional simple order.
    // EXCEPTION: If they are all from the SAME commerce, they can take up to 2 additional orders (making 3 in total from that commerce).
    if (activeCount === 1) {
      if (isSameCommerceCoRetiro) {
        if (totalCount > 3) {
          throw new Error(`¡Límite de lote excedido! No podés tomar más de 3 pedidos de un mismo comercio en un solo lote (co-retiro máximo de 3).`);
        }
      } else {
        if (ordersToTakeCount > 1) {
          throw new Error(`¡Límite excedido! Ya tenés un pedido en curso. Solo podés sumar 1 pedido simple adicional a tu ruta (máximo 2 pedidos activos en total). No podés tomar un lote completo.`);
        }
        if (totalCount > 2) {
          throw new Error(`¡Límite excedido! No podés tener más de 2 pedidos activos en simultáneo.`);
        }
      }
    }

    // Rule 3: If driver has 0 active orders, they can take a simple order (1 order) OR a dynamic same-commerce bundle (co-retiro) of up to 3 orders.
    if (activeCount === 0) {
      if (ordersToTakeCount > 3) {
        throw new Error(`¡Límite de lote excedido! No podés tomar más de 3 pedidos de un mismo comercio en un solo lote (co-retiro máximo de 3).`);
      }
    }

    // Fetch initial driver GPS location with cached fallback and fast timeout to prevent blocking UI
    let initialDriverLocation = window.lastRiderPos || null;
    if (!initialDriverLocation && navigator.geolocation) {
      try {
        console.log('[takeBatch] Fetching initial driver location with fast timeout...');
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 1000, enableHighAccuracy: false });
        });
        initialDriverLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        window.lastRiderPos = initialDriverLocation;
      } catch (e) {
        console.warn('[takeBatch] Fast GPS location fetch timed out/failed', e);
      }
    }

    await runTransaction(db, async (transaction) => {
      const orderRefs = ordersToTake.map(o => doc(db, 'orders', o.id));
      const snaps = await Promise.all(orderRefs.map(ref => transaction.get(ref)));
      
      for (const snap of snaps) {
        if (!snap.exists()) throw 'Pedido no encontrado';
        if (snap.data().driverId) throw 'Pedido ya tomado por otro repartidor';
      }

      ordersToTake.forEach((o, index) => {
        const ref = orderRefs[index];
        const snap = snaps[index];
        const orderData = snap.data();

        let deliveryCost = orderData.deliveryCost;
        let total = orderData.total;

        if (orderData.isGoCash || orderData.favorType === 'gocash') {
          if (initialDriverLocation && orderData.deliveryCoords) {
            try {
              const dist = getDistanceSync(initialDriverLocation.lat, initialDriverLocation.lng, orderData.deliveryCoords.lat, orderData.deliveryCoords.lng);
              const state = getState();
              const basePriceVal = state.deliveryBasePrice || 1500;
              const pricePerKmVal = state.deliveryPricePerKm || 300;
              const minPriceVal = state.deliveryMinPrice || 1500;
              
              let rawFee = basePriceVal + (dist * pricePerKmVal);
              if (rawFee < minPriceVal) {
                rawFee = minPriceVal;
              }
              deliveryCost = Math.ceil(rawFee / 10) * 10;
              total = deliveryCost;
            } catch (e) {
              console.error("[takeBatch] Error calculating Go Cash delivery cost:", e);
            }
          }
        }

        const updateFields = {
          driverId: user.uid,
          driverName: user.displayName || user.name || 'Repartidor',
          driverPhoto: user.photoURL || '',
          driverPhone: user.phone || '',
          driverDeliveryId: user.deliveryId || '',
          driverAlias: userData.transferAlias || '',
          driverVehicleModel: userData.vehicleModel || '',
          driverVehicleColor: userData.vehicleColor || '',
          driverVehiclePatent: userData.vehicleDetails || userData.patente || '',
          deliverySessionId: user.currentSessionId || null,
          status: (o.isFavor || o.isTrip) ? 'confirmed' : o.status,
          acceptedAt: serverTimestamp(),
          estimatedDeliveryTime: estTime
        };

        if (orderData.isGoCash || orderData.favorType === 'gocash') {
          updateFields.deliveryCost = deliveryCost;
          updateFields.total = total;
        }

        if (initialDriverLocation) {
          updateFields.driverLocation = {
            lat: initialDriverLocation.lat,
            lng: initialDriverLocation.lng,
            updatedAt: serverTimestamp()
          };
        }
        transaction.update(ref, updateFields);

        // Add real-time push/in-app notification to the client
        if (o.isTrip) {
          const notifRef = doc(collection(db, 'users', o.userId, 'notifications'));
          transaction.set(notifRef, {
            type: 'trip_taken',
            title: '⚡ ¡Chofer asignado!',
            body: `El chofer está yendo a tu ubicación. Patente: ${userData.vehicleDetails || userData.patente || '---'}`,
            status: 'unread',
            url: `#/pedido/${o.id}`,
            createdAt: new Date()
          });
        }
      });

      // Update driver activity
      transaction.update(doc(db, 'users', user.uid), {
        lastActivityAt: serverTimestamp(),
        lastTripAcceptedAt: serverTimestamp()
      });
      user.lastActivityAt = new Date();
      user.lastTripAcceptedAt = new Date();
      setState('user', { ...getState().user, lastActivityAt: new Date(), lastTripAcceptedAt: new Date() });
    });

    // Send automated messages for Pago de Servicios orders
    for (const o of ordersToTake) {
      if (o.favorType === 'pagodeservicios') {
        try {
          const alias = userData.transferAlias || 'No configurado';
          const totalTransfer = o.total || 0;
          const driverName = user.displayName || user.name || 'Repartidor';
          
          await addDoc(collection(db, 'orders', o.id, 'messages'), {
            senderId: 'system',
            senderName: 'GoDelivery',
            text: `👋 ¡Hola! El repartidor **${driverName}** ha aceptado tu Pago de Servicio.\n\n🏦 **Detalles para Transferencia**:\n• **Monto a transferir:** ${formatPrice(totalTransfer)}\n• **Alias:** \`${alias}\`\n\nPor favor realiza la transferencia y envía el comprobante por este chat para que el repartidor proceda a pagar tu servicio.`,
            createdAt: serverTimestamp(),
            type: 'system'
          });
        } catch (msgErr) {
          console.error('Error sending automated accept message:', msgErr);
        }
      }
    }

    showToast('¡Pedido tomado! Empezá tu ruta.', 'success');
    // Automatically switch to active tab
    window.dispatchEvent(new CustomEvent('switch-delivery-tab', { detail: 'active' }));
  } catch (err) {
    console.error('takeBatch error:', err);
    showToast(err.toString(), 'error');
    if (btn) {
      btn.disabled = false;
      if (btn.classList.contains('add-suggested-order-btn')) {
        btn.innerHTML = `${icon('plusCircle', 14)} SUMAR A MI RUTA`;
      } else {
        btn.innerHTML = `${icon('checkCircle', 20)} TOMAR PEDIDO`;
      }
    }
  } finally {
    isCurrentlyTakingBatch = false;
  }
}

export const takeOrder = takeBatch;

export async function markAsPickedUp(orderIdOrIds) {
  const ids = Array.isArray(orderIdOrIds) ? orderIdOrIds : orderIdOrIds.split(',');
  try {
    let lat = null;
    let lng = null;
    if (window.lastRiderPos) {
      lat = window.lastRiderPos.lat;
      lng = window.lastRiderPos.lng;
    } else if (navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 1000, enableHighAccuracy: false });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        window.lastRiderPos = { lat, lng };
      } catch (e) {
        console.warn('Location fetch failed on pickup', e);
      }
    }

    const updates = {
      pickedUpAt: serverTimestamp(),
      status: 'delivering'
    };

    if (lat !== null && lng !== null) {
      updates.driverLocation = { lat, lng, updatedAt: serverTimestamp() };
    }

    try {
      const batch = writeBatch(db);
      ids.forEach(id => {
        batch.update(doc(db, 'orders', id), updates);
      });
      await batch.commit();
      
      // Send real-time push/in-app notifications to the clients with their verification codes
      for (const id of ids) {
        try {
          const orderSnap = await getDoc(doc(db, 'orders', id));
          if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            if (orderData.userId) {
              const codeStr = orderData.verificationCode ? ` Tené listo tu código de entrega: ${orderData.verificationCode}` : '';
              await addDoc(collection(db, 'users', orderData.userId, 'notifications'), {
                title: orderData.isFavor ? '¡Tu favor va en camino! 🚴' : '¡Tu pedido va en camino! 🚴',
                body: orderData.isFavor 
                  ? `El repartidor ya retiró tu favor y va para allá.${codeStr}` 
                  : `El repartidor retiró tu pedido y va hacia tu domicilio.${codeStr}`,
                type: 'system',
                status: 'unread',
                createdAt: serverTimestamp()
              });
            }
          }
        } catch (notifErr) {
          console.warn('Could not send pickup notification to user:', notifErr);
        }
      }

      showToast(ids.length > 1 ? 'Pedidos retirados con éxito' : 'Pedido retirado con éxito', 'success');
    } catch (err) {
      console.warn('Network issue, order marked picked up locally:', err);
      showToast('Retiro guardado localmente (se sincronizará al recuperar señal)', 'info');
    }
  } catch (err) {
    console.error('markAsPickedUp error:', err);
    showToast('Error al retirar el pedido', 'error');
  }
}

export function openSlideToConfirmModal({ isTrip, noCodeRequired, codes, ids, orders, onConfirm }) {
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 8px 16px 16px;';

  modalContent.innerHTML = `
    <div>
      ${(!isTrip && !noCodeRequired) ? `
        <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:16px; line-height:1.5; text-align:center;">
          Pedile al cliente su <strong>código de 4 dígitos</strong> para validar la entrega.
        </p>
        <div style="margin-bottom:24px;">
          <input type="text" id="modal-verification-input" 
                 placeholder="0000" maxlength="4" inputmode="numeric"
                 style="width:100%; height:64px; border-radius:20px; background:var(--color-bg-secondary); border:3px solid var(--color-border); text-align:center; font-size:32px; font-weight:950; letter-spacing:10px; color:var(--color-text-primary); box-shadow:var(--shadow-sm); transition:all 0.3s ease;">
        </div>
      ` : `
        <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:24px; line-height:1.5; text-align:center;">
          ${isTrip ? 'Confirmá que llegaste al destino y que el pasajero descendió del vehículo.' : 'Confirmá la entrega de este pedido manual. No requiere código.'}
        </p>
      `}

      <!-- Slider Container -->
      <div id="slide-confirm-container" class="slider-container" style="
        position: relative; 
        width: 100%; 
        height: 60px; 
        background: var(--color-bg-secondary); 
        border-radius: 30px; 
        border: 2px solid var(--color-border); 
        overflow: hidden; 
        user-select: none;
        touch-action: none;
        ${(!isTrip && !noCodeRequired) ? 'opacity: 0.5; pointer-events: none;' : ''}
        transition: opacity 0.3s ease;
      ">
        <div class="slider-bg" style="position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: linear-gradient(90deg, var(--color-primary), #10b981); border-radius: 30px; touch-action: none;"></div>
        <div class="slider-text" style="position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 900; color: var(--color-text-secondary); pointer-events: none; text-transform: uppercase; letter-spacing: 0.05em; touch-action: none;">
          ${(!isTrip && !noCodeRequired) ? 'INGRESE EL CÓDIGO' : 'DESLIZÁ PARA CONFIRMAR'}
        </div>
        <div class="slider-handle" style="position: absolute; top: 4px; left: 4px; width: 48px; height: 48px; background: white; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; cursor: grab; transition: left 0.1s ease; touch-action: none;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--color-primary); display: flex; align-items: center; justify-content: center; color: white; touch-action: none;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="touch-action: none;"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        </div>
      </div>
      <p style="font-size:11px; text-align:center; color:var(--color-text-tertiary); margin-top:20px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Seguridad GoDelivery</p>
    </div>
  `;

  showModal({
    title: isTrip ? '🚕 ¿Finalizar Viaje?' : 'Verificación de Entrega',
    content: modalContent,
    height: 'auto'
  });

  const containerEl = modalContent.querySelector('#slide-confirm-container');
  const handle = modalContent.querySelector('.slider-handle');
  const bg = modalContent.querySelector('.slider-bg');
  const text = modalContent.querySelector('.slider-text');
  const input = modalContent.querySelector('#modal-verification-input');

  let isDragging = false;
  let startX = 0;
  let maxSlide = 0;

  const unlockSlider = () => {
    containerEl.style.opacity = '1';
    containerEl.style.pointerEvents = 'auto';
    text.textContent = 'DESLIZÁ PARA CONFIRMAR';
    text.style.color = 'var(--color-text-primary)';
  };

  if (input) {
    setTimeout(() => input.focus(), 300);
    input.addEventListener('input', () => {
      input.style.borderColor = 'var(--color-primary)';
      if (input.value.length === 4) {
        const isCorrect = codes.includes(input.value);
        if (isCorrect) {
          input.style.borderColor = 'var(--color-success)';
          input.disabled = true;
          unlockSlider();
        } else {
          input.style.borderColor = 'var(--color-danger)';
          input.style.animation = 'shake 0.4s ease';
          setTimeout(() => {
            input.style.animation = '';
            input.value = '';
            input.focus();
          }, 400);
          showToast('Código incorrecto', 'danger');
        }
      }
    });
  }

  const onStart = (e) => {
    isDragging = true;
    startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
    maxSlide = containerEl.clientWidth - handle.clientWidth - 8;
    handle.style.transition = 'none';
    bg.style.transition = 'none';
    handle.style.cursor = 'grabbing';
  };

  const onMove = (e) => {
    if (!isDragging) return;
    const clientX = (e.type === 'touchmove') ? e.touches[0].clientX : e.clientX;
    let deltaX = clientX - startX;
    if (deltaX < 0) deltaX = 0;
    if (deltaX > maxSlide) deltaX = maxSlide;

    handle.style.left = `${deltaX + 4}px`;
    bg.style.width = `${((deltaX + 24) / containerEl.clientWidth) * 100}%`;
    text.style.opacity = Math.max(0, 1 - (deltaX / (maxSlide * 0.6)));
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    handle.style.cursor = 'grab';
    const currentLeft = parseInt(handle.style.left) - 4;

    if (currentLeft >= maxSlide * 0.9) {
      handle.style.transition = 'all 0.2s ease';
      bg.style.transition = 'all 0.2s ease';
      handle.style.left = `${maxSlide + 4}px`;
      bg.style.width = '100%';
      text.style.opacity = '0';

      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }

      setTimeout(() => {
        closeModal();
        onConfirm();
      }, 200);
    } else {
      handle.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      bg.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      handle.style.left = '4px';
      bg.style.width = '0%';
      text.style.opacity = '1';
    }
  };

  handle.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);

  handle.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onEnd);
}

export async function showSuccessCelebration(orders, onFinish) {
  const user = getState().user;
  const currentSessionId = user?.currentSessionId;
  let previousSessionEarned = 0;
  let currentDebt = orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);

  const totalEarned = orders.reduce((sum, o) => {
    return sum + getOrderDriverEarnings(o);
  }, 0);

  if (currentSessionId) {
    try {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid),
        where('deliverySessionId', '==', currentSessionId),
        where('status', '==', 'completed')
      );
      const snap = await getDocs(q);
      let totalCompletedInSession = 0;
      snap.docs.forEach(d => {
        const o = d.data();
        const netEarnings = getOrderDriverEarnings(o);
        totalCompletedInSession += netEarnings;
      });

      const currentOrderIds = orders.map(o => o.id);
      let currentOrdersSessionEarnings = 0;
      snap.docs.forEach(d => {
        if (currentOrderIds.includes(d.id)) {
          const o = d.data();
          const netEarnings = getOrderDriverEarnings(o);
          currentOrdersSessionEarnings += netEarnings;
        }
      });
      previousSessionEarned = Math.max(0, totalCompletedInSession - currentOrdersSessionEarnings);
    } catch (e) {
      console.error('Error calculating session earnings for celebration:', e);
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'delivery-success-celebration';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #E11D48;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #0f172a;
    font-family: var(--font-display, 'Outfit', sans-serif);
    opacity: 0;
    transition: opacity 0.5s cubic-bezier(0.19, 1, 0.22, 1);
    overflow: hidden;
  `;

  const previousDebt = Math.max(0, (getState().user?.deliveryDebt || 0) - currentDebt);

  overlay.innerHTML = `
    <!-- Expanding Morphing White Sphere from Center -->
    <div class="celebration-circle-grow" style="
      position: absolute;
      width: 10px;
      height: 10px;
      background: rgba(248, 250, 252, 1);
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      transform-origin: center;
      animation: expandWhiteCircle 1.6s cubic-bezier(0.85, 0, 0.15, 1) forwards;
      z-index: 1;
      pointer-events: none;
    "></div>

    <canvas id="confetti-canvas" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 2; opacity: 0; animation: fadeInConfetti 1s ease 1s forwards;"></canvas>
    
    <div style="text-align:center; z-index: 10; padding:36px 28px; max-width:400px; display:flex; flex-direction:column; align-items:center; gap:24px; width:92%; box-sizing:border-box; background: white; border: 1.5px solid rgba(0,0,0,0.06); border-radius: 36px; box-shadow: 0 30px 60px -15px rgba(15, 23, 42, 0.12); transform: scale(0.9) translateY(20px); opacity: 0; animation: modalEntrance 0.8s cubic-bezier(0.19, 1, 0.22, 1) 0.5s forwards;">
      
      <!-- Brand Logo Header -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 2px;">
        <img src="/go! (2).png" alt="Go!" style="width: 86px; height: 86px; border-radius: 50%; object-fit: cover; filter: drop-shadow(0 6px 15px rgba(0, 0, 0, 0.15)); animation: bounceLogo 2.2s infinite ease-in-out;">
      </div>

      <div style="text-align: center; display: flex; flex-direction: column; gap: 6px;">
        <h1 style="font-size: 26px; font-weight: 950; margin: 0; letter-spacing: -0.8px; color: #0f172a;">¡Entrega Completada!</h1>
        <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.45; font-weight: 600;">¡Excelente trabajo! Has sumado ganancias a tu cuenta.</p>
      </div>
      
      <div style="background: #f8fafc; border: 1.5px solid rgba(0,0,0,0.04); padding: 24px; border-radius: 28px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.01);">
        <div style="text-align: center;">
          <span style="font-size: 10.5px; font-weight: 900; text-transform: uppercase; color: #0d9488; letter-spacing: 0.1em; display: block; margin-bottom: 4px;">Ganado en este viaje</span>
          <div id="celebration-amount" style="font-size: 40px; font-weight: 950; color: #0f172a; letter-spacing: -1.5px; line-height: 1;">$ 0.00</div>
        </div>
        
        <div style="height: 1.5px; background: rgba(0,0,0,0.05); width: 100%;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: #64748b;">
          <span style="display: flex; align-items: center; gap: 8px;">💼 Total Sesión Actual</span>
          <span id="celebration-session-amount" style="font-size: 18px; font-weight: 950; color: #0f172a; letter-spacing: -0.5px;">$ 0.00</span>
        </div>

        <div style="height: 1.5px; background: rgba(0,0,0,0.05); width: 100%;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: #e11d48;">
          <span style="display: flex; align-items: center; gap: 8px;">💳 Tarifa App a Rendir (Total)</span>
          <span id="celebration-debt-amount" style="font-size: 18px; font-weight: 950; color: #e11d48; letter-spacing: -0.5px;">$ 0.00</span>
        </div>
      </div>

      <button id="celebration-continue-btn" style="
        background: linear-gradient(135deg, #E11D48 0%, #BE123C 100%); 
        color: white; 
        border: none; 
        padding: 18px 40px; 
        font-weight: 900; 
        font-size: 15px; 
        border-radius: 20px; 
        cursor: pointer; 
        box-shadow: 0 8px 25px rgba(225, 29, 72, 0.25);
        transition: all 0.3s cubic-bezier(0.19, 1, 0.22, 1);
        width: 100%;
        height: auto;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      ">
        Entendido
      </button>
    </div>

    <style>
      @keyframes expandWhiteCircle {
        0% {
          transform: translate(-50%, -50%) scale(0);
        }
        100% {
          transform: translate(-50%, -50%) scale(350);
        }
      }
      @keyframes modalEntrance {
        to { transform: scale(1) translateY(0); opacity: 1; }
      }
      @keyframes fadeInConfetti {
        to { opacity: 1; }
      }
      @keyframes bounceLogo {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      #celebration-continue-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 30px rgba(225, 29, 72, 0.35);
      }
      #celebration-continue-btn:active {
        transform: translateY(1px) scale(0.98);
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);
      }
    </style>
  `;

  document.body.appendChild(overlay);
  
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });

  const canvas = overlay.querySelector('#confetti-canvas');
  const ctx = canvas.getContext('2d');
  let animationFrameId;

  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const confettiCount = 150;
  const confettiList = [];
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  for (let i = 0; i < confettiCount; i++) {
    confettiList.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * confettiCount,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    });
  }

  function drawConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    confettiList.forEach((c) => {
      c.tiltAngle += c.tiltAngleIncremental;
      c.y += (Math.cos(c.d) + 3 + c.r / 2) / 2;
      c.x += Math.sin(c.tiltAngle);
      c.tilt = Math.sin(c.tiltAngle - c.d / 3) * 15;

      ctx.beginPath();
      ctx.lineWidth = c.r;
      ctx.strokeStyle = c.color;
      ctx.moveTo(c.x + c.tilt + c.r / 2, c.y);
      ctx.lineTo(c.x + c.tilt, c.y + c.tilt + c.r / 2);
      ctx.stroke();

      if (c.y > canvas.height) {
        c.x = Math.random() * canvas.width;
        c.y = -20;
        c.tilt = Math.random() * 10 - 5;
      }
    });

    animationFrameId = requestAnimationFrame(drawConfetti);
  }
  drawConfetti();

  const amountEl = overlay.querySelector('#celebration-amount');
  const sessionAmountEl = overlay.querySelector('#celebration-session-amount');
  const debtAmountEl = overlay.querySelector('#celebration-debt-amount');
  
  sessionAmountEl.textContent = formatPrice(previousSessionEarned);
  if (debtAmountEl) {
    debtAmountEl.textContent = formatPrice(previousDebt);
  }

  let currentVal = 0;
  const duration = 1200;
  const stepTime = 20;
  const totalSteps = duration / stepTime;
  const stepAmount = totalEarned / totalSteps;
  const stepDebt = currentDebt / totalSteps;

  const counterInterval = setInterval(() => {
    currentVal += stepAmount;
    let isDone = false;
    if (currentVal >= totalEarned) {
      currentVal = totalEarned;
      isDone = true;
    }
    amountEl.textContent = formatPrice(currentVal);
    sessionAmountEl.textContent = formatPrice(previousSessionEarned + currentVal);
    
    if (debtAmountEl) {
      const currentDebtVal = isDone ? (previousDebt + currentDebt) : (previousDebt + (currentVal / (totalEarned || 1)) * currentDebt);
      debtAmountEl.textContent = formatPrice(currentDebtVal);
    }
    
    if (isDone) {
      clearInterval(counterInterval);
    }
  }, stepTime);

  const cleanup = () => {
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', resizeCanvas);
    clearInterval(counterInterval);
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      if (onFinish) onFinish();
    }, 400);
  };

  overlay.querySelector('#celebration-continue-btn').addEventListener('click', cleanup);
}

export async function markAsDelivered(orderIdOrIds) {
  const ids = Array.isArray(orderIdOrIds) ? orderIdOrIds : orderIdOrIds.split(',');
  const user = getState().user;
  
  try {
    // 1. Fetch the orders
    const q = query(collection(db, 'orders'), where('__name__', 'in', ids));
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const totalAppFee = orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
    const batch = writeBatch(db);

    // 2. Update orders to completed (this is fully authorized by the driver's write rules on orders)
    ids.forEach(id => {
      const orderData = orders.find(o => o.id === id);
      batch.update(doc(db, 'orders', id), {
        status: 'completed',
        deliveredAt: serverTimestamp(),
        deliverySessionId: user.currentSessionId || orderData?.deliverySessionId || null
      });
    });

    if (totalAppFee > 0) {
      batch.update(doc(db, 'users', user.uid), {
        deliveryDebt: increment(totalAppFee)
      });
      
      const currentLocalUser = getState().user || {};
      const newDebt = (currentLocalUser.deliveryDebt || 0) + totalAppFee;
      setState('user', { ...currentLocalUser, deliveryDebt: newDebt });
    }

    try {
      await batch.commit();
      
      // Trigger Success Celebration Modal
      showSuccessCelebration(orders, () => {
        showCustomerRatingModal(orders);
      });
    } catch (err) {
      console.error('Error committing delivery batch:', err);
      showToast('Error al confirmar la entrega en el servidor. Por favor, reintentá.', 'error');
    }
  } catch (err) {
    console.error('markAsDelivered error:', err);
    showToast('Error al procesar la entrega', 'error');
  }
}

/**
 * Show anonymous customer rating modal for completed orders
 */
export function showCustomerRatingModal(orders, index = 0) {
  if (!orders || index >= orders.length) {
    closeModal();
    return;
  }

  const order = orders[index];
  if (!order || !order.userId) {
    showCustomerRatingModal(orders, index + 1);
    return;
  }

  let selectedRating = 0;
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 32px 24px 24px; text-align: center;';

  function render() {
    modalContent.innerHTML = `
      <div style="margin-bottom: 28px;">
        <div style="width: 72px; height: 72px; background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05)); color: #10b981; border-radius: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 8px 25px rgba(16,185,129,0.12);">
          ${icon('star', 36)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; margin: 0 0 8px; color: var(--color-text-primary); letter-spacing: -0.02em;">
          ¿Cómo fue el cliente?
        </h2>
        <p style="font-size: 14px; color: var(--color-text-secondary); margin: 0; line-height: 1.5;">
          Puntuá a <strong style="color: var(--color-text-primary);">${order.userName || 'el cliente'}</strong> (Pedido #${order.orderId})
        </p>
      </div>

      <div class="rating-stars" style="display: flex; justify-content: center; gap: 12px; margin-bottom: 28px;">
        ${[1, 2, 3, 4, 5].map(i => `
          <button class="star-btn" data-value="${i}" style="
            width: 52px; height: 52px; border-radius: 16px; border: 2px solid ${i <= selectedRating ? '#f59e0b' : 'var(--color-border-light)'};
            background: ${i <= selectedRating ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-secondary)'};
            color: ${i <= selectedRating ? '#f59e0b' : 'var(--color-text-tertiary)'};
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            transition: all 0.2s; transform: ${i <= selectedRating ? 'scale(1.1)' : 'scale(1)'};
            box-shadow: ${i <= selectedRating ? '0 4px 12px rgba(245,158,11,0.2)' : 'none'};
          ">
            ${icon('star', 24)}
          </button>
        `).join('')}
      </div>

      ${selectedRating > 0 ? `
        <div style="text-align: left; margin-bottom: 20px;">
          <label style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 6px;">
            Comentario (opcional)
          </label>
          <textarea id="customer-rating-comment" class="input" placeholder="Ej. Cliente súper amable y puntual..." 
            style="width: 100%; min-height: 80px; resize: none; font-size: 14px; border-radius: 16px; background:var(--color-bg-page); border:1.5px solid var(--color-border-light); padding:10px 12px; outline:none; box-sizing:border-box; color:var(--color-text-primary);"></textarea>
          <p style="font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 6px; line-height: 1.3;">
            Tu reseña es 100% anónima. El cliente nunca sabrá quién la dejó.
          </p>
        </div>
      ` : ''}

      <div style="display: flex; gap: 10px; margin-top: 8px;">
        <button class="btn btn-ghost" id="customer-rating-skip-btn" style="flex: 1; height: 52px; border-radius: 16px; font-weight: 700; color: var(--color-text-secondary); background:var(--color-bg-secondary); border:1px solid var(--color-border-light);">
          Omitir
        </button>
        <button class="btn btn-primary" id="customer-rating-submit-btn" style="flex: 2; height: 52px; border-radius: 16px; font-weight: 800; font-size: 1rem; opacity: ${selectedRating > 0 ? '1' : '0.4'}; pointer-events: ${selectedRating > 0 ? 'auto' : 'none'}; background:var(--color-primary); border:none; color:white;"
        >
          ${icon('star', 18)} Calificar Cliente
        </button>
      </div>
    `;

    // Star clicks
    modalContent.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRating = parseInt(btn.dataset.value);
        render();
      });
    });

    // Skip
    modalContent.querySelector('#customer-rating-skip-btn')?.addEventListener('click', () => {
      closeModal();
      showCustomerRatingModal(orders, index + 1);
    });

    // Submit
    modalContent.querySelector('#customer-rating-submit-btn')?.addEventListener('click', async () => {
      if (selectedRating === 0) return;

      const comment = modalContent.querySelector('#customer-rating-comment')?.value?.trim() || '';
      const submitBtn = modalContent.querySelector('#customer-rating-submit-btn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `${icon('loader', 18, 'animate-spin')} Enviando...`;

      try {
        // Save rating on order (anonymously)
        const orderRef = doc(db, 'orders', order.id);
        await updateDoc(orderRef, {
          customerRating: selectedRating,
          customerRatingComment: comment,
          customerRatedAt: serverTimestamp()
        });

        // Save rating on user's ratings list (anonymously)
        const userRef = doc(db, 'users', order.userId);
        await updateDoc(userRef, {
          ratings: arrayUnion({
            orderId: order.id,
            rating: selectedRating,
            comment: comment,
            createdAt: new Date().toISOString()
            // CRITICAL: We completely omit driverId, driverName to preserve absolute anonymity!
          })
        });

        closeModal();
        showToast('¡Gracias por tu puntuación!', 'success');
        
        // Go to next customer in the batch recursively
        showCustomerRatingModal(orders, index + 1);
      } catch (err) {
        console.error('Error submitting customer rating:', err);
        showToast('Error al enviar la puntuación', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${icon('star', 18)} Calificar Cliente`;
      }
    });
  }

  render();

  showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    height: 'auto'
  });
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const deltaPhi = (lat2-lat1) * Math.PI/180;
  const deltaLambda = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}

export async function renderDeliveryHistory() {
  await renderSubPage('history', 'Historial de Pedidos');
}

export async function renderDeliveryFinances() {
  await renderSubPage('finances', 'Finanzas y Cuentas');
}

export async function renderDeliveryConfig() {
  await renderSubPage('config', 'Configuración de Perfil');
}

async function renderSubPage(tab, title) {
  const content = document.getElementById('app-content');
  if (!content) return;
  content.style.overflow = 'hidden';

  const user = getState().user;
  if (!user || !isDelivery()) {
    content.innerHTML = `<div class="empty-state">Acceso denegado</div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; width:100%; position:fixed; top:0; left:0; z-index:1000; overflow:hidden; background:var(--color-bg-secondary);">
      <!-- Header -->
      <div style="position:sticky; top:0; z-index:100; display:flex; align-items:center; gap:14px; padding: calc(16px + env(safe-area-inset-top, 0px)) 20px 16px 20px; background:var(--color-primary); flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/delivery" style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; flex-shrink:0; text-decoration:none; transition:all 0.2s; position:relative; z-index:2;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1; min-width:0; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">
            ${title}
          </h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.7); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.05em;">Repartidor ${user.deliveryId || ''}</p>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div id="sub-page-content" style="flex:1; overflow-y:auto; overflow-x:hidden; padding:16px 16px 40px; -webkit-overflow-scrolling:touch;">
        <div class="loader-dots" style="margin: 4rem auto;"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;

  const container = document.getElementById('sub-page-content');
  loadTabContent(tab, container, user);
}

export async function updateDispatchQueue(orderId) {
  try {
    const now = Date.now();
    
    // Fetch order doc first to verify state
    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return;
    const o = orderSnap.data();
    if (o.driverId) return;

    // Queue rotation is triggered strictly on timer expiration or queue assign necessity.

    const rejected = o.queueRejectedDrivers || [];
    if (o.queueTargetDriverId) {
      rejected.push(o.queueTargetDriverId);
      
      // Auto-pause inactive driver (Ghost driver check) synchronously
      try {
        const driverRef = doc(db, 'users', o.queueTargetDriverId);
        const dSnap = await getDoc(driverRef);
        if (dSnap.exists()) {
          const dData = dSnap.data();
          const missedCount = (dData.missedOffersCount || 0) + 1;
          if (missedCount >= 2) {
            await updateDoc(driverRef, { isOnline: false, missedOffersCount: 0 });
            showToast(`Repartidor ${dData.displayName || dData.name || ''} desconectado por inactividad.`, 'info');
          } else {
            await updateDoc(driverRef, { missedOffersCount: missedCount });
          }
        }
      } catch (de) {
        console.error('[Ghost check error]', de);
      }
    }

    // Fetch query snapshots OUTSIDE to avoid failed precondition errors
    const driversSnap = await getDocs(query(collection(db, 'users'), where('isOnline', '==', true)));
    const allDrivers = driversSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.role === 'delivery' || d.isDelivery === true);

    const activeOrdersSnap = await getDocs(query(collection(db, 'orders'), where('status', 'in', ['accepted', 'preparing', 'ready', 'picked_up', 'at_door'])));
    const busyDriverIds = new Set(activeOrdersSnap.docs.map(d => d.data().driverId).filter(Boolean));

    let targetDriverId = null;
    let targetDriverName = null;

    // Filter eligible drivers: exclude if they have rejected 3 or more times
    const eligibleDrivers = allDrivers.filter(d => {
      const occurrences = rejected.filter(id => id === d.id).length;
      if (occurrences >= 3) return false;
      if (busyDriverIds.has(d.id)) return false;
      
      if (d.cooldownUntil && (d.cooldownUntil.toMillis ? d.cooldownUntil.toMillis() : new Date(d.cooldownUntil).getTime()) > now) {
        return false;
      }

      const mode = d.deliveryMode || 'both';
      if (mode === 'trip' && !o.isTrip) return false;
      if (mode === 'delivery' && o.isTrip) return false;

      return true;
    });

    if (eligibleDrivers.length > 0) {
      // Sort: 
      // 1. Prioritize drivers with fewer rejection occurrences
      // 2. Then by completed orders today
      eligibleDrivers.sort((a, b) => {
        const occurrencesA = rejected.filter(id => id === a.id).length;
        const occurrencesB = rejected.filter(id => id === b.id).length;
        if (occurrencesA !== occurrencesB) {
          return occurrencesA - occurrencesB;
        }
        return (a.completedOrdersToday || 0) - (b.completedOrdersToday || 0);
      });

      // Find co-pickup driver if any among the eligible ones
      const coPickupDriver = eligibleDrivers.find(d => {
        return activeOrdersSnap.docs.some(docSnap => {
          const ord = docSnap.data();
          return ord.driverId === d.id && ord.comercioId === o.comercioId && !ord.pickedUpAt;
        });
      });

      const chosenDriver = coPickupDriver || eligibleDrivers[0];
      targetDriverId = chosenDriver.id;
      targetDriverName = chosenDriver.displayName || chosenDriver.name || 'Repartidor';

      await updateDoc(orderRef, {
        queueTargetDriverId: targetDriverId,
        queueTargetDriverName: targetDriverName,
        queueOfferedAt: Date.now(),
        queueRejectedDrivers: rejected
      });
    } else {
      // Exhausted all online drivers or no drivers online! Cancel the order!
      await updateDoc(orderRef, {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledBy: 'system',
        cancelReason: 'No hay repartidores disponibles en la zona',
        queueTargetDriverId: null,
        queueTargetDriverName: null,
        queueRejectedDrivers: rejected
      });

      // Refund user points if applicable
      if (o.pointsRedeemed > 0 && o.userId) {
        try {
          const userRef = doc(db, 'users', o.userId);
          await updateDoc(userRef, {
            points: increment(o.pointsRedeemed)
          });
        } catch (pe) {
          console.error('[Points refund error]', pe);
        }
      }
    }
  } catch (err) {
    console.error('Error in updateDispatchQueue:', err);
  }
}

export function playExclusiveOfferAlert() {
  if (window.exclusiveAlertInterval) return;

  if (navigator.vibrate) {
    navigator.vibrate([300, 100, 300]);
  }
  window.exclusiveAlertInterval = setInterval(() => {
    if (navigator.vibrate) {
      navigator.vibrate([300, 100, 300]);
    }
  }, 1600);
}

export function stopExclusiveOfferAlert() {
  if (window.exclusiveAlertInterval) {
    clearInterval(window.exclusiveAlertInterval);
    window.exclusiveAlertInterval = null;
  }
}
