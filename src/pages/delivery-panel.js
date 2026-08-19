import { collection, query, where, getDocs, doc, updateDoc, onSnapshot as firebaseOnSnapshot, runTransaction, serverTimestamp, writeBatch, increment, addDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { getState, setState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { formatPrice, isScheduleActive } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { db, storage } from '../firebase.js';
import { App } from '@capacitor/app';

import { isDelivery } from '../auth.js';
import { registerUnsubscribe } from '../utils/cleanup.js';

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

  const unsubFn = () => {
    listener.stop();
    activeListeners = activeListeners.filter(l => l !== listener);
  };
  registerUnsubscribe(unsubFn);
  return unsubFn;
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
  const user = getState().user;
  if (!user || !isDelivery()) {
    content.innerHTML = `<div class="empty-state">Acceso denegado</div>`;
    return;
  }
  window.autoAcceptEnabled = user.autoAcceptEnabled || false;
  window.expiredLocalOrders = new Set();

  // Real-time listener for pending proofs of this driver
  if (user?.uid && !window._driverProofsUnsub) {
    const qProofs = query(
      collection(db, 'delivery_settlement_proofs'),
      where('driverId', '==', user.uid),
      where('status', '==', 'pending')
    );
    window._driverProofsUnsub = firebaseOnSnapshot(qProofs, (snap) => {
      const pendingProofs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setState('pendingProofs', pendingProofs);
      const barContainer = document.getElementById('session-status-bar-container');
      if (barContainer) {
        barContainer.innerHTML = renderStatusBar(getState().user || user);
        attachStatusBarListeners(getState().user || user);
      }
    });
  }

  const currentHash = window.location.hash || '';
  if (currentHash.includes('tab=settlements')) {
    setTimeout(() => {
      if (user?.uid) {
        showBalanceHistoryModal(user.uid);
      }
    }, 500);
  }

  if (currentHash.includes('action=renew_session')) {
    setTimeout(async () => {
      try {
        const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
        const { db } = await import('../firebase.js');
        await updateDoc(doc(db, 'users', user.uid), {
          lastTripAcceptedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          inactivityWarningSentAt: null
        });
        setState('user', {
          ...getState().user,
          lastTripAcceptedAt: new Date(),
          lastActivityAt: new Date(),
          inactivityWarningSentAt: null
        });
        showToast('✅ Tu sesión fue restablecida. Seguís conectado y disponible para recibir pedidos.', 'success');
      } catch (err) {
        console.error('Error renewing session:', err);
      }
    }, 300);
  }

  window.toggleAutoAccept = async (checked, userId) => {
    window.autoAcceptEnabled = checked;
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      await updateDoc(doc(db, 'users', userId), {
        autoAcceptEnabled: checked
      });
      console.log('[toggleAutoAccept] Updated Firestore autoAcceptEnabled to', checked);
    } catch (err) {
      console.error('Error saving autoAcceptEnabled:', err);
    }
  };

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



  const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : window.Capacitor.platform !== 'web'));
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
          <div id="delivery-earnings-widget"></div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--space-4); background: rgba(var(--color-primary-rgb, 225, 29, 72), 0.05); padding: var(--space-3) var(--space-4); border-radius: 16px; border: 1px dashed rgba(var(--color-primary-rgb, 225, 29, 72), 0.15);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:14px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
                Auto-Aceptar Pedidos
              </span>
              <button id="auto-accept-info-btn" style="border:none; background:none; color:var(--color-text-secondary); cursor:pointer; padding:2px; display:flex; align-items:center; justify-content:center; opacity:0.8; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8">
                ${icon('helpCircle', 16)}
              </button>
            </div>
            <label class="ios-switch" style="position:relative; display:inline-block; width:44px; height:24px; cursor:pointer; margin:0;">
              <input type="checkbox" id="auto-accept-toggle" style="opacity:0; width:0; height:0; position:absolute;" onchange="
                window.toggleAutoAccept(this.checked, '${user.uid}');
                const slider = this.nextElementSibling;
                slider.style.backgroundColor = this.checked ? 'var(--color-primary, #e11d48)' : '#ccc';
                slider.querySelector('span').style.transform = this.checked ? 'translateX(20px)' : 'translateX(0)';
              " ${window.autoAcceptEnabled ? 'checked' : ''} />
              <span class="ios-slider" style="position:absolute; inset:0; background-color:${window.autoAcceptEnabled ? 'var(--color-primary, #e11d48)' : '#ccc'}; border-radius:34px; transition:0.3s; display:flex; align-items:center; padding: 0 3px;">
                <span style="height:18px; width:18px; background-color:white; border-radius:50%; transition:0.3s; box-shadow:0 2px 4px rgba(0,0,0,0.2); display:block; transform:${window.autoAcceptEnabled ? 'translateX(20px)' : 'translateX(0)'};"></span>
              </span>
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

    // Attach listener for auto-accept info button (renders bottom card/sheet)
    const infoBtn = document.getElementById('auto-accept-info-btn');
    if (infoBtn) {
      infoBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Remove existing sheet if any
        const existing = document.getElementById('info-bottom-sheet');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'info-bottom-sheet';
        overlay.style.cssText = `
          position: fixed;
          inset: 0;
          z-index: 999999;
          background: rgba(0,0,0,0.4);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          opacity: 0;
          transition: opacity 0.3s ease;
        `;

        overlay.innerHTML = `
          <div id="info-bottom-sheet-card" style="
            background: var(--color-bg);
            border-top-left-radius: 24px;
            border-top-right-radius: 24px;
            padding: var(--space-6) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom, 0px)) var(--space-5);
            box-shadow: 0 -8px 32px rgba(0,0,0,0.15);
            transform: translateY(100%);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
          ">
            <!-- Drag indicator handle -->
            <div style="width: 36px; height: 5px; background: var(--color-border-light, #e5e7eb); border-radius: 3px; align-self: center; margin-bottom: 8px;"></div>
            
            <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; color: var(--color-text-primary); margin: 0; padding-right: var(--space-6);">
              Modo Auto-Aceptar
            </h3>
            
            <div style="font-size: 14.5px; line-height: 1.6; color: var(--color-text-secondary); font-weight: 550; display:flex; flex-direction:column; gap:12px;">
              <p style="margin:0;"><strong>¿Cómo funciona?</strong></p>
              <p style="margin:0;">Al activar esta opción, cualquier pedido exclusivo que se te asigne en cola será <strong>aceptado automáticamente</strong> por el sistema sin necesidad de que presiones el botón de aceptar.</p>
              <p style="margin:0;">⚠️ <strong>Importante:</strong> Evita que tus pedidos expiren por inactividad y mantiene tu flujo de trabajo constante.</p>
            </div>
            
            <button id="info-bottom-sheet-close-btn" style="
              width: 100%;
              height: 54px;
              border: none;
              background: var(--color-primary);
              color: white;
              border-radius: 16px;
              font-weight: 900;
              font-size: 15.5px;
              cursor: pointer;
              margin-top: 8px;
              box-shadow: 0 8px 24px rgba(225,29,72,0.25);
            ">
              Entendido
            </button>
          </div>
        `;

        document.body.appendChild(overlay);

        // Animate in
        setTimeout(() => {
          overlay.style.opacity = '1';
          const card = document.getElementById('info-bottom-sheet-card');
          if (card) card.style.transform = 'translateY(0)';
        }, 10);

        const closeSheet = () => {
          const card = document.getElementById('info-bottom-sheet-card');
          if (card) card.style.transform = 'translateY(100%)';
          overlay.style.opacity = '0';
          setTimeout(() => overlay.remove(), 300);
        };

        overlay.onclick = (e) => {
          if (e.target === overlay) closeSheet();
        };

        const closeBtn = document.getElementById('info-bottom-sheet-close-btn');
        if (closeBtn) closeBtn.onclick = closeSheet;
      };
    }
  }

  // Ensure inactivity check and heartbeat is running if online
  if (user?.isOnline) {
    startInactivityCheck(user);
    startHeartbeat(user);
  }

  // Update header and status bar (non-destructive)
  // ─── Delivery Drawer (hamburger menu, identical pattern to commerce panel) ───
  document.getElementById('delivery-drawer-backdrop')?.remove();
  document.getElementById('delivery-drawer')?.remove();

  const deliveryBackdropEl = document.createElement('div');
  deliveryBackdropEl.id = 'delivery-drawer-backdrop';
  deliveryBackdropEl.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; opacity: 0; pointer-events: none; transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);";
  document.body.appendChild(deliveryBackdropEl);

  const deliveryDrawerEl = document.createElement('div');
  deliveryDrawerEl.id = 'delivery-drawer';
  deliveryDrawerEl.style.cssText = "position: fixed; top: 0; right: 0; bottom: 0; width: 300px; background: var(--color-surface); box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 10001; transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; border-top-left-radius: 20px; border-bottom-left-radius: 20px;";
  deliveryDrawerEl.innerHTML = `
    <div style="padding: 20px 20px 14px; display:flex; align-items:center; justify-content:space-between; border-bottom: 1px solid var(--color-border-light);">
      <h2 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Opciones</h2>
      <button id="delivery-drawer-close-btn" style="width:36px; height:36px; border-radius:10px; border:none; background:var(--color-bg-secondary); color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center;">${icon('close', 16)}</button>
    </div>
    <div style="flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:4px;">
      <a href="#/delivery/history" id="delivery-drawer-history" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; text-decoration:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(100,116,139,0.09); color:#64748b;">${icon('history', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Historial de Pedidos</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </a>
      <a href="#/delivery/finances" id="delivery-drawer-finances" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; text-decoration:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(34,197,94,0.09); color:#16a34a;">${icon('bank', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Finanzas y Cuentas</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </a>
      <a href="#/delivery/config" id="delivery-drawer-config" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; text-decoration:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(99,102,241,0.09); color:#6366f1;">${icon('settings', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Configuración de Perfil</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </a>
      <div style="height:1px; background:var(--color-border-light); margin:8px 0;"></div>
      <button id="delivery-drawer-support-btn" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; border:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer; width:100%; text-align:left;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(14,165,233,0.08); color:#0284c7;">${icon('headset', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Soporte Técnico</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </button>
      <button id="delivery-drawer-info-btn" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; border:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer; width:100%; text-align:left;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:rgba(245,158,11,0.1); color:#f59e0b;">${icon('helpCircle', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Funcionamiento del Sistema</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </button>
    </div>
  `;
  document.body.appendChild(deliveryDrawerEl);

  const openDeliveryDrawer = () => {
    deliveryDrawerEl.style.transform = 'translateX(0)';
    deliveryBackdropEl.style.opacity = '1';
    deliveryBackdropEl.style.pointerEvents = 'auto';
  };
  const closeDeliveryDrawer = () => {
    deliveryDrawerEl.style.transform = 'translateX(100%)';
    deliveryBackdropEl.style.opacity = '0';
    deliveryBackdropEl.style.pointerEvents = 'none';
  };

  deliveryBackdropEl.addEventListener('click', closeDeliveryDrawer);
  document.getElementById('delivery-drawer-close-btn')?.addEventListener('click', closeDeliveryDrawer);

  // Close drawer on nav link click
  ['delivery-drawer-history','delivery-drawer-finances','delivery-drawer-config'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', closeDeliveryDrawer);
  });

  // Support button
  document.getElementById('delivery-drawer-support-btn')?.addEventListener('click', async () => {
    closeDeliveryDrawer();
    try {
      const { openSupportTicketModal } = await import('../components/support-bot.js');
      await openSupportTicketModal(user.uid, `Repartidor: ${user.displayName || user.email || user.uid}`);
    } catch (err) {
      console.error('Error opening support ticket:', err);
    }
  });

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
        <div style="position:relative;z-index:2;flex-shrink:0;">
          <button id="delivery-hamburger-btn" title="Menú de Opciones" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            ${icon('menu', 22)}
          </button>
        </div>
      </div>
    `;

    document.getElementById('delivery-hamburger-btn')?.addEventListener('click', () => {
      import('../utils/audio-manager.js').catch(() => {});
      openDeliveryDrawer();
    });

    // Wire info button inside drawer
    document.getElementById('delivery-drawer-info-btn')?.addEventListener('click', () => {
      closeDeliveryDrawer();

      const existing = document.getElementById('info-bottom-sheet');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'info-bottom-sheet';
      overlay.style.cssText = `position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: flex-end; opacity: 0; transition: opacity 0.3s ease;`;
      overlay.innerHTML = `
        <div id="info-bottom-sheet-card" style="background: var(--color-bg); border-top-left-radius: 24px; border-top-right-radius: 24px; padding: var(--space-6) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom, 0px)) var(--space-5); box-shadow: 0 -8px 32px rgba(0,0,0,0.15); transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; gap: var(--space-4); max-height: 85vh;">
          <div style="width: 36px; height: 5px; background: var(--color-border-light, #e5e7eb); border-radius: 3px; align-self: center; margin-bottom: 8px;"></div>
          <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; color: var(--color-text-primary); margin: 0; padding-right: var(--space-6); text-align: left;">Funcionamiento del Sistema</h3>
          <div style="font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); font-weight: 550; display:flex; flex-direction:column; gap:16px; max-height:55vh; overflow-y:auto; padding-right:6px; text-align: left;">
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">🔄 Asignación en Cola (Round-Robin)</p>
              <p style="margin: 0;">Los pedidos listos se ofrecen a un repartidor a la vez de forma exclusiva durante 30 segundos. La cola prioriza a quienes no hayan rechazado el pedido y desempata seleccionando a quien tenga menos pedidos completados hoy.</p>
            </div>
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">🛑 Desconexión Automática por Inactividad</p>
              <p style="margin: 0;">Si dejas expirar o rechazas 2 pedidos de forma consecutiva, el sistema pausará tu sesión automáticamente cambiándote a desconectado. Esto evita que dejes pedidos trabados si no estás atento al celular.</p>
            </div>
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">📦 Co-retiros Simultáneos</p>
              <p style="margin: 0;">Puedes llevar hasta 2 pedidos activos en curso de comercios diferentes. Si los pedidos pertenecen al mismo comercio, puedes llevar hasta 3 pedidos simultáneos (lote optimizado del local).</p>
            </div>
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">❌ Cancelación Automática por Falta de Cobertura</p>
              <p style="margin: 0;">Si todos los repartidores activos de la zona rechazan o ignoran el pedido, la orden se cancela de forma automática, notificando al cliente y reembolsándole su saldo y puntos al instante.</p>
            </div>
          </div>
          <button id="info-bottom-sheet-close-btn" style="width: 100%; height: 54px; border: none; background: var(--color-primary); color: white; border-radius: 16px; font-weight: 900; font-size: 15.5px; cursor: pointer; margin-top: 8px; box-shadow: 0 8px 24px rgba(225,29,72,0.25);">Entendido</button>
        </div>
      `;
      document.body.appendChild(overlay);
      setTimeout(() => {
        overlay.style.opacity = '1';
        const card = document.getElementById('info-bottom-sheet-card');
        if (card) card.style.transform = 'translateY(0)';
      }, 10);
      const closeSheet = () => {
        const card = document.getElementById('info-bottom-sheet-card');
        if (card) card.style.transform = 'translateY(100%)';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
      };
      overlay.onclick = (e) => { if (e.target === overlay) closeSheet(); };
      document.getElementById('info-bottom-sheet-close-btn')?.addEventListener('click', closeSheet);
    });
  }

  const barContainer = document.getElementById('session-status-bar-container');
  if (barContainer) {
    barContainer.innerHTML = renderStatusBar(user);
    attachStatusBarListeners(user);
  }

  let activeTab = sessionStorage.getItem('deliveryTab') || 'available';
  sessionStorage.removeItem('deliveryTab');

  renderDailyEarningsWidget(user);

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

  let lastKnownOnlineStatus = user?.isOnline || false;
  window.__gd_delivery_unsub = subscribe('user', (newUser) => {
    if (!newUser) {
      if (inactivityTimer) {
        clearInterval(inactivityTimer);
        inactivityTimer = null;
      }
      stopHeartbeat();
      return;
    }

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
      hidePausedSessionModal();
    } else {
      hidePausedSessionModal();
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
    if (!user || !user.uid) return;

    // Available Badge
    const qAvailable = query(collection(db, 'orders'), where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending']));
    const unsubAvailable = onSnapshot(qAvailable, (snap) => {
      const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const batches = new Set();
      allOrders.forEach(o => {
        if (o.driverId) return;
        if (o.queueTargetDriverId !== user?.uid) return;
        if ((o.manuallyRejectedDrivers || []).includes(user?.uid)) return;
        
        const mode = user?.deliveryMode || 'both';
        if (mode === 'trip' && !o.isTrip) return;
        if (mode === 'delivery' && o.isTrip) return;
        
        if (o.isTrip) {
          const isApproved = user?.tripStatus === 'approved' || user?.role === 'chofer';
          if (!isApproved) return;
           const requestedTripType = (o.tripType || 'auto').toLowerCase();
           const driverVehicleType = (user?.tripVehicleType || user?.vehicleType || '').toLowerCase();
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

  // Auto-open take order modal if takeOrderId or orderId is in URL query parameters
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  const hashParams = new URLSearchParams(hashQuery);
  const targetTakeOrderId = hashParams.get('takeOrderId') || hashParams.get('orderId');

  if (targetTakeOrderId && window._processedTakeOrderId !== targetTakeOrderId) {
    window._processedTakeOrderId = targetTakeOrderId;
    const cleanHash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', window.location.pathname + cleanHash);

    setTimeout(async () => {
      try {
        let orderToTake = null;
        const orderDocSnap = await getDoc(doc(db, 'orders', targetTakeOrderId));
        if (orderDocSnap.exists()) {
          orderToTake = { id: orderDocSnap.id, ...orderDocSnap.data() };
        } else {
          const numericVal = parseInt(targetTakeOrderId);
          if (!isNaN(numericVal)) {
            const qNumeric = query(collection(db, 'orders'), where('orderId', '==', numericVal));
            const numSnap = await getDocs(qNumeric);
            if (!numSnap.empty) {
              orderToTake = { id: numSnap.docs[0].id, ...numSnap.docs[0].data() };
            }
          }
        }

        if (orderToTake && !orderToTake.driverId) {
          showConfirm({
            title: `¿Tomar Pedido #${orderToTake.orderId || orderToTake.displayId || ''}?`,
            message: `<strong>${orderToTake.comercioName || 'Pedido'}</strong><br>Cliente: ${orderToTake.userName || 'Cliente'}<br>Dirección: ${orderToTake.deliveryAddress || ''}`,
            confirmText: 'SÍ, TOMAR PEDIDO',
            onConfirm: () => {
              takeBatch(orderToTake.bundleId || orderToTake.id, user);
            }
          });
        }
      } catch (e) {
        console.warn('[Delivery Panel] Error auto-opening target take order modal:', e);
      }
    }, 400);
  }

  try {
    if (tab === 'available') {
      const q = query(
        collection(db, 'orders'),
        where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending'])
      );

      let isInitial = true;
      const listUnsub = onSnapshot(q, (snap) => {
        const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Auto-ready manual scheduled orders when current time >= dispatchAt
        const currentTimeMs = Date.now() + (getState().serverTimeOffset || 0);
        allOrders.forEach(o => {
          if (o.isManual && o.status === 'confirmed' && o.dispatchAt) {
            const dispatchTime = o.dispatchAt.toMillis ? o.dispatchAt.toMillis() : new Date(o.dispatchAt).getTime();
            if (currentTimeMs >= dispatchTime) {
              console.log(`Auto-readying manual order #${o.orderId} from delivery panel`);
              updateDoc(doc(db, 'orders', o.id), {
                status: 'ready',
                readyAt: serverTimestamp()
              }).catch(err => console.error("Error auto-readying manual order:", err));
            }
          }
        });
        
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

          const now = Date.now() + (getState().serverTimeOffset || 0);
          const offeredAt = o.queueOfferedAt ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime()) : (o.readyAt ? (o.readyAt.toMillis ? o.readyAt.toMillis() : new Date(o.readyAt).getTime()) : (o.createdAt ? (o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime()) : now));
          const isTargetMe = o.queueTargetDriverId === user.uid;
          const isCoPickup = o.isCoPickupOffer || o.isSuggestedCoPickup || false;
          const isOwn = o.isOwnDeliveryOrder || o.isPermanentOffer || isCoPickup || false;

          const isCommerceReady = o.isFavor || o.isTrip || o.status === 'ready';
          const offerAgeMs = now - offeredAt;
          const needsQueueAssign = isCommerceReady && !isOwn && (
                                   !o.queueTargetDriverId || 
                                   (o.queueTargetDriverId && offerAgeMs >= 30000)
                                   );
          if (needsQueueAssign) {
            updateDispatchQueue(o.id);
          }

          const isManuallyRejected = (o.manuallyRejectedDrivers || []).includes(user.uid);
          if (isManuallyRejected) return;

          const isTargetedToMe = o.queueTargetDriverId === user.uid;
          const isQueueRejected = (o.queueRejectedDrivers || []).includes(user.uid);
          if (isQueueRejected && !isTargetedToMe) return;

          window.expiredLocalOrders = window.expiredLocalOrders || new Set();
          if (window.expiredLocalOrders.has(o.id) && !isTargetedToMe) return;

          // For regular commerce orders, require status === 'ready' before offering to drivers
          if (!o.isFavor && !o.isTrip && o.status !== 'ready') return;

          if (o.queueTargetDriverId) {
            // Exclusive offer: only show to targeted driver
            if (o.queueTargetDriverId !== user.uid) return;
          }

          // Handle Auto-Accept
          if (o.queueTargetDriverId === user.uid && window.autoAcceptEnabled) {
            if (!window.activeAutoAccepts) window.activeAutoAccepts = new Set();
            if (!window.activeAutoAccepts.has(o.id)) {
              window.activeAutoAccepts.add(o.id);
              showToast('⚡ Auto-Aceptando pedido...', 'info');
              setTimeout(async () => {
                try {
                  const freshSnap = await getDoc(doc(db, 'orders', o.id));
                  if (freshSnap.exists() && !freshSnap.data().driverId && freshSnap.data().queueTargetDriverId === user.uid) {
                    await takeBatch(o.bundleId || o.id, user);
                  }
                } catch (e) {
                  console.error('[AutoAccept] Error auto-taking batch:', e);
                } finally {
                  window.activeAutoAccepts.delete(o.id);
                }
              }, 400);
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
        // Full-screen overlay trigger for exclusive offer
        const exclusiveBatch = sortedBatches.find(b => {
          const orderObj = b.isBundle ? b.orders[0] : b.order;
          return orderObj && !orderObj.driverId && orderObj.queueTargetDriverId === user.uid;
        });

        if (exclusiveBatch) {
          stopExclusiveOfferAlert();
          showExclusiveOfferOverlay(exclusiveBatch, user);
        } else {
          stopExclusiveOfferAlert();
          hideExclusiveOfferOverlay();
        }

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

        const userState = getState().user;
        const nowMs = Date.now() + (getState().serverTimeOffset || 0);
        const cooldownMs = userState?.cooldownUntil ? (userState.cooldownUntil.toMillis ? userState.cooldownUntil.toMillis() : new Date(userState.cooldownUntil).getTime()) : 0;
        const cooldownRemaining = Math.max(0, Math.floor((cooldownMs - nowMs) / 1000));

        let cooldownHtml = '';

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
          container.innerHTML = cooldownHtml + `
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

        container.innerHTML = cooldownHtml + `
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
              const nowMs = Date.now() + (getState().serverTimeOffset || 0);
              const offeredAt = orderObj?.queueOfferedAt 
                ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) 
                : (orderObj?.createdAt ? (orderObj.createdAt.toMillis ? orderObj.createdAt.toMillis() : new Date(orderObj.createdAt).getTime()) : nowMs);
              
              const elapsed = Math.max(0, Math.floor((nowMs - offeredAt) / 1000));
              const remaining = Math.max(1, 30 - (elapsed % 30));
              const expiryMs = nowMs + (remaining * 1000);

              return `
                <div class="admin-card expandable-card collapsed" data-id="${b.id}" style="margin-bottom: 20px; border: 1px solid var(--color-border); background: var(--color-bg-card); padding: 22px; border-radius: 28px; position:relative; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.03); ${anyPending ? 'opacity: 0.8;' : ''}">
                  <div style="position:absolute; top:0; left:0; width:6px; height:100%; background:${isTrip ? '#3b82f6' : (isFavor ? favorColor : '#00D67F')};"></div>
                  
                  ${orderObj?.isOwnDeliveryOrder || orderObj?.isPermanentOffer ? `
                    <div style="background:rgba(227, 0, 27, 0.08); border:1px solid rgba(227, 0, 27, 0.15); border-radius:16px; padding:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; width:100%;">
                      <span style="font-size:12px; font-weight:800; color:#E3001B; display:flex; align-items:center; gap:6px;">
                        ⚠️ ${orderObj?.isPermanentOffer ? 'OFERTA DISPONIBLE:' : 'EXCLUSIVO COMERCIO:'}
                      </span>
                      <span style="font-size:14px; font-weight:950; color:#E3001B;" class="queue-countdown" data-is-own-delivery="true" data-expiry="0" data-order-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}">Permanente</span>
                    </div>
                  ` : `
                    <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.15); border-radius:16px; padding:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; width:100%;">
                      <span style="font-size:12px; font-weight:800; color:#ef4444; display:flex; align-items:center; gap:6px;">
                        ⚠️ OFERTA EXCLUSIVA:
                      </span>
                      <span style="font-size:14px; font-weight:950; color:#ef4444;" class="queue-countdown" data-expiry="${expiryMs}" data-order-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}">${remaining}s</span>
                    </div>
                  `}
                  
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
                        ${b.order.favorType === 'compra' ? `
                          <div style="margin-bottom:10px; padding:10px 12px; border-radius:12px; background:${b.order.allowDirectReplacement ? 'rgba(5,150,105,0.1)' : 'rgba(225,29,72,0.1)'}; border:1px solid ${b.order.allowDirectReplacement ? 'rgba(5,150,105,0.3)' : 'rgba(225,29,72,0.3)'}; color:${b.order.allowDirectReplacement ? '#059669' : '#E11D48'}; font-size:11.5px; font-weight:800; display:flex; align-items:center; gap:8px;">
                            ${b.order.allowDirectReplacement ? `
                              <span>🔄 <strong>MODO REEMPLAZO DIRECTO:</strong> Si un producto no está en stock, traé uno similar (ej: Coca por Pepsi) sin consultar al cliente.</span>
                            ` : `
                              <span>💬 <strong>ATENCIÓN PERSONALIZADA:</strong> Consultá al cliente por chat ante cualquier cambio, variante o precio.</span>
                            `}
                          </div>
                        ` : ''}
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
                                 data-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}" 
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
          const countdownElements = container.querySelectorAll('.queue-countdown');
          const cooldownEl = container.querySelector('.cooldown-timer');
          if (countdownElements.length === 0 && !cooldownEl) {
            clearInterval(countdownInterval);
            window.queueCountdownInterval = null;
            return;
          }

          // Update cooldown banner in real-time
          if (cooldownEl) {
            const expiry = parseInt(cooldownEl.dataset.expiry);
            const now = Date.now() + (getState().serverTimeOffset || 0);
            const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
            
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            cooldownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            if (remaining <= 0) {
              if (window.queueCountdownInterval) clearInterval(window.queueCountdownInterval);
              window.queueCountdownInterval = null;
              loadTabContent('available', container, user);
              return;
            }
          }

          countdownElements.forEach(el => {
            const isOwn = el.dataset.isOwnDelivery === 'true';
            if (isOwn) {
              el.textContent = "Permanente";
              return;
            }

            const expiry = parseInt(el.dataset.expiry);
            if (isNaN(expiry)) return;

            const now = Date.now() + (getState().serverTimeOffset || 0);
            const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
            el.textContent = `${remaining}s`;

            if (remaining <= 0) {
              const orderIdsStr = el.dataset.orderIds;
              if (orderIdsStr && el.dataset.rotating !== 'true') {
                el.dataset.rotating = 'true';
                console.log(`[Queue Countdown] Timer expired for orderIds: ${orderIdsStr}. Rotating offer...`);
                const orderIds = orderIdsStr.split(',');

                window.expiredLocalOrders = window.expiredLocalOrders || new Set();
                orderIds.forEach(oid => window.expiredLocalOrders.add(oid));

                stopExclusiveOfferAlert();

                // Trigger instant server rotation for each expired order
                orderIds.forEach(id => {
                  updateDispatchQueue(id).catch(err => {
                    console.error(`[Queue Countdown] Error updating dispatch queue for ${id}:`, err);
                  }).finally(() => {
                    setTimeout(() => {
                      el.dataset.rotating = 'false';
                    }, 3000);
                  });
                });
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
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            showToast('Rechazando pedido...', 'info');
            
            try {
              // Add driver to manuallyRejectedDrivers & queueRejectedDrivers of these orders
              await runTransaction(db, async (transaction) => {
                const oIdsStr = btn.dataset.ids;
                if (!oIdsStr) return;
                const oIds = oIdsStr.split(',');
                for (const oId of oIds) {
                  const orderRef = doc(db, 'orders', oId);
                  const oSnap = await transaction.get(orderRef);
                  if (oSnap.exists()) {
                    const data = oSnap.data();
                    const manualRejected = data.manuallyRejectedDrivers || [];
                    const passiveRejected = data.queueRejectedDrivers || [];
                    if (!manualRejected.includes(user.uid)) manualRejected.push(user.uid);
                    if (!passiveRejected.includes(user.uid)) passiveRejected.push(user.uid);
                    transaction.update(orderRef, {
                      manuallyRejectedDrivers: manualRejected,
                      queueRejectedDrivers: passiveRejected,
                      queueTargetDriverId: null,
                      queueTargetDriverName: null,
                      queueOfferedAt: null,
                      isPermanentOffer: null
                    });
                  }
                }
              });
              
              showToast('Pedido rechazado', 'warning');
            } catch (err) {
              console.error(err);
              showToast('Error al procesar rechazo', 'error');
              btn.disabled = false;
            }
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
        where('driverId', '==', user.uid)
      );

      let suggestedUnsub = null;
      let currentSuggestedOrders = [];

      const listUnsub = onSnapshot(q, (snap) => {
        const orders = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(o => !['completed', 'cancelled'].includes(o.status));

        if (suggestedUnsub) {
          suggestedUnsub();
          suggestedUnsub = null;
        }

        if (orders.length === 0) {
          container.innerHTML = `
            <div class="empty-state-mini" style="padding: 3rem 1rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px;">
              <p style="margin: 0; color: var(--color-text-tertiary); font-weight: 700;">No tenés pedidos en curso</p>
              <button id="btn-demo-hoja-ruta" style="padding: 10px 18px; border-radius: 14px; border: 1.5px solid var(--color-primary); background: rgba(var(--color-primary-rgb), 0.08); color: var(--color-primary); font-weight: 800; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: var(--shadow-sm); transition: all 0.2s;">
                ${icon('eye', 16)} Ver Hoja de Ruta Demo (Simulación)
              </button>
            </div>
          `;
          const demoBtn = container.querySelector('#btn-demo-hoja-ruta');
          if (demoBtn) {
            demoBtn.onclick = () => {
              const mockOrder = {
                id: 'DEMO-991',
                orderId: 'DEMO-1042',
                status: 'accepted',
                favorType: 'mandado',
                isFavor: true,
                userName: 'Juan Hidalgo',
                userPhone: '2215550199',
                comercioName: 'Verdulería "El Trébol"',
                comercioAddress: 'Av. San Martín 450, Magdalena',
                pickupAddress: 'Av. San Martín 450, Magdalena',
                deliveryAddress: 'Brenan 1340, Magdalena',
                subtotal: 3500,
                deliveryCost: 8000,
                total: 11500,
                paymentMethod: 'efectivo',
                details: '1kg papas, 1/2kg tomates, 1 verdeo',
                verificationCode: '4829',
                acceptedAt: new Date()
              };
              delete container.dataset.lastActiveFingerprint;
              renderActiveTimeline([mockOrder], []);
            };
          }
          return;
        }

        // Check if co-pickup recommendations apply
        const activeUnpickedComercioIds = [...new Set(
          orders.filter(o => !o.pickedUpAt && o.status !== 'delivering' && o.comercioId).map(o => o.comercioId)
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
          pickedUp: o.status === 'delivering' || !!o.pickedUpAt,
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
                  if (o.favorType === 'encomienda' || o.serviceType === 'encomienda') {
                    stopName = '📦 Retiro de Encomienda';
                  } else if (o.favorType === 'pagodeservicios') {
                    const match = o.details?.match(/🏢\s*\*\*Servicio:\*\*\s*(.*?)(?=\n|$)/i);
                    stopName = match ? match[1].trim() : 'Pago de Servicio';
                  } else {
                    const stores = parseFavorDetails(o.details || o.description);
                    stopName = stores.length > 0 ? stores[0].name : (o.comercioName || 'Punto de Retiro');
                  }
                } else {
                  stopName = o.comercioName || 'Comercio a Comprar';
                }
              }

              pickupsByCommerce.set(key, {
                comercioName: stopName,
                address: o.pickupAddress || o.originAddress || o.comercioAddress || 'Punto de Retiro',
                isFavor: !!o.isFavor,
                orders: []
              });
            }
            pickupsByCommerce.get(key).orders.push(o);
          }

          // Drop-off stops (unique per address)
          const dropAddress = o.deliveryAddress || o.destinationAddress || 'Dirección de Entrega';
          if (!deliveries.has(dropAddress)) {
            deliveries.set(dropAddress, { userName: o.userName || 'Cliente', orders: [] });
          }
          deliveries.get(dropAddress).orders.push(o);
        });

        // Convert pickups to stops
        pickupsByCommerce.forEach((group, key) => {
          const allPickedUp = group.orders.every(o => o.status === 'delivering' || !!o.pickedUpAt);
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
                  const addressVal = (stop.type === 'PICKUP' ? stop.docId : stop.address) || '';
                  const stopKey = (stop.type + '_' + addressVal).replace(/[^a-zA-Z0-9]/g, '_');
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
                  <div class="stop-item" style="position:relative; margin-bottom:36px;">
                    <!-- Timeline Dot -->
                    <div style="position:absolute; left:-38px; top:8px; width:20px; height:20px; border-radius:50%; background:${stop.pickedUp ? '#10b981' : (isActive ? stopColor : 'var(--color-border-light)')}; border:4px solid var(--color-bg-card); z-index:2; box-shadow:0 6px 15px rgba(0,0,0,0.12); transition:all 0.4s;">
                      ${isActive ? `<div style="position:absolute; inset:-8px; border-radius:50%; border:2.5px solid ${stopColor}; opacity:0.4; animation: pulse-dot 2s infinite;"></div>` : ''}
                    </div>
                    
                    <div style="background:${isActive ? 'var(--color-bg)' : 'rgba(var(--color-bg-secondary-rgb), 0.5)'}; border:${isActive ? '2.5px' : '1.5px'} solid ${isActive ? stopColor : stopColor + '44'}; border-radius:26px; padding:0 24px 24px 24px; overflow:hidden; transition:all 0.4s; ${isActive ? `box-shadow: 0 15px 40px rgba(${stopRgb}, 0.12);` : ''}">
                      
                      <!-- Card Header Strip -->
                      <div style="background:${stopColor}; color:#ffffff; margin-left:-24px; margin-right:-24px; padding:10px 24px; font-size:11.5px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:18px; display:flex; align-items:center; gap:8px;">
                        ${(() => {
                          const o = firstOrder;
                          if (o.isTrip) return icon('navigation', 14) + ' GO VIAJE';
                          if (o.isFavor) {
                            if (o.favorType === 'gocash') return icon('dollarSign', 14) + ' GO CASH';
                            if (o.favorType === 'pagodeservicios') return icon('creditCard', 14) + ' PAGO DE SERVICIO';
                            if (o.favorType === 'mandado') return `<img src="/go-pickup-point.png" style="width:20px; height:20px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:6px;" /> ENCOMIENDA`;
                            if (o.favorType === 'compra') return `<img src="/go-bag.png" style="width:20px; height:20px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:6px;" /> MANDADO`;
                            return `<img src="/go-bag.png" style="width:20px; height:20px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:6px;" /> MANDADO`;
                          }
                          return icon('shoppingCart', 14) + ' COMERCIO';
                        })()}
                      </div>
                      
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                        <div>
                          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <span style="font-size:10px; font-weight:900; text-transform:uppercase; color:${isActive ? stopColor : 'var(--color-text-tertiary)'}; letter-spacing:0.1em; display:inline-flex; align-items:center; gap:5px;">
                              ${(() => {
                                const hasTrip = (stop.orders || []).some(o => o.isTrip);
                                const isPickup = stop.type === 'PICKUP';
                                if (hasTrip) {
                                  const text = isPickup ? 'Punto de Encuentro' : 'Destino del Viaje';
                                  const ic = isPickup ? icon('mapPin', 12) : icon('navigationArrow', 12);
                                  return `${ic} ${text}`;
                                } else {
                                  const text = isPickup ? 'Punto de Retiro' : 'Punto de Entrega';
                                  const ic = isPickup ? icon('store', 12) : icon('home', 12);
                                  return `${ic} ${text}`;
                                }
                              })()}
                            </span>
                            ${isActive ? `<div style="background:var(--color-primary); width:6px; height:6px; border-radius:50%; animation: blink 1s infinite;"></div>` : ''}
                          </div>
                          <h4 style="margin:0; font-size:16.5px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.02em; line-height:1.4; text-align:left;">
                            ${stop.type === 'PICKUP' ? (stop.comercioName || 'Punto de Retiro') : (stop.address || 'Dirección de Entrega')}
                          </h4>
                          ${(stop.type === 'DROP_OFF' && stop.orders?.[0]?.addressNotes) ? `
                            <div style="font-size:12px; font-weight:700; color:#d97706; margin-top:4.5px; text-align:left;">
                              ⚠️ Ref: ${stop.orders[0].addressNotes}
                            </div>
                          ` : ''}
                          ${(() => {
                            if (stop.type === 'DROP_OFF') return '';
                            const o = stop.orders && stop.orders[0];
                            if (o && o.estimatedReadyAt) {
                              const dateObj = o.estimatedReadyAt.toDate ? o.estimatedReadyAt.toDate() : new Date(o.estimatedReadyAt);
                              const hh = String(dateObj.getHours()).padStart(2, '0');
                              const mm = String(dateObj.getMinutes()).padStart(2, '0');
                              const readyTimeStr = `${hh}:${mm} hs`;
                              return `
                                <div style="margin-top:6px; background:linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04)); border:1px solid rgba(245,158,11,0.25); color:#d97706; padding:5px 10px; border-radius:10px; font-size:10.5px; font-weight:900; display:inline-flex; align-items:center; gap:5px;">
                                  ${icon('clock', 12)} 🍳 Listo en cocina a las ${readyTimeStr}
                                </div>
                              `;
                            }
                            return '';
                          })()}
                        </div>
                        ${stop.pickedUp ? `
                          <div style="background:rgba(34, 197, 94, 0.12); color:var(--color-success); padding:5px 12px; border-radius:10px; font-size:10px; font-weight:900; display:flex; align-items:center; gap:6px; letter-spacing:0.02em;">
                            ${icon('check', 14)} COMPLETADO
                          </div>
                        ` : ''}
                      </div>
                      


                      ${(() => {
                        if (stop.type === 'DROP_OFF') {
                          return '';
                        } else {
                          return '';
                        }
                      })()}

                      <!-- Collapsible Stop Details -->
                      ${stop.type === 'PICKUP' ? `

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
                              const allPickedUp = stop.orders.every(o => o.status === 'delivering' || !!o.pickedUpAt);
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
                          
                          ${(() => {
                            const favorOrder = stop.orders.find(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios'));
                            if (!favorOrder) return '';
                            return `
                              <button class="btn driver-card-edit-price-btn" 
                                      data-order-id="${favorOrder.id}"
                                      style="width:100%; height:44px; font-size:12.5px; font-weight:800; border-radius:14px; border:1px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text-primary); transition:all 0.3s; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; margin-top:8px; box-sizing:border-box;">
                                ${icon('creditCard', 14)} ${favorOrder.favorType === 'pagodeservicios' ? 'Ingresar Valor de Facturas' : 'Ingresar/Modificar Compra'} (${favorOrder.subtotal ? `$${favorOrder.subtotal}` : 'No cargado'})
                              </button>
                            `;
                          })()}
                        </div>
                        
                        <!-- Row 3: Ver Detalle del Pedido (Bottom Sheet) -->
                        <div style="width:100%;">
                          <button class="btn view-stop-details-sheet-btn" 
                                  data-key="${stopKey}"
                                  style="width:100%; height:44px; font-size:12.5px; font-weight:800; border-radius:14px; border:none; background:linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color:white; transition:all 0.3s; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.18); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; margin-top:2px;">
                            ${icon('shoppingBag', 14)} Ver Detalle del Pedido
                          </button>
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

        container.querySelectorAll('.view-stop-details-sheet-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const stop = stops.find(s => {
              const addressVal = (s.type === 'PICKUP' ? s.docId : s.address) || '';
              const sKey = (s.type + '_' + addressVal).replace(/[^a-zA-Z0-9]/g, '_');
              return sKey === key;
            });
            if (stop) {
              showStopDetailsBottomSheet(stop);
            }
          });
        });

        container.querySelectorAll('.driver-card-edit-price-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const orderId = btn.dataset.orderId;
            const { doc, getDoc } = await import('firebase/firestore');
            const { db } = await import('../firebase.js');
            const orderSnap = await getDoc(doc(db, 'orders', orderId));
            if (orderSnap.exists()) {
              const orderData = { id: orderSnap.id, ...orderSnap.data() };
              showEditFavorPriceModal(orderData, true);
            }
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
                      const isEncomienda = order.favorType === 'encomienda' || (order.isFavor && order.favorType === 'encomienda');
                      const codeStr = (order.verificationCode && !isEncomienda) ? ` Tené listo tu código de entrega: ${order.verificationCode}` : '';
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

            const noCodeRequired = orders.filter(o => ids.includes(o.id)).some(o => o.isManual === true || o.noCodeRequired === true || o.source === 'whatsapp_bot' || o.favorType === 'encomienda' || (o.isFavor && o.favorType === 'encomienda'));
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
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const orderId = btn.dataset.orderId;
            if (!orderId) return;
            const { openChat } = await import('../components/chat.js');
            openChat({ 
              orderId: btn.dataset.orderId, 
              type: 'client-delivery', 
              otherName: btn.dataset.clientName || 'Cliente',
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
                            { label: 'Retirado', time: main.pickedUpAt, color: 'var(--color-primary)', done: main.status === 'delivering' || !!main.pickedUpAt },
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
            if (btn.dataset.source === 'whatsapp_bot' && btn.dataset.userPhone) {
              const clean = btn.dataset.userPhone.replace(/\D/g, '');
              const full = clean.startsWith('54') ? clean : `54${clean}`;
              window.open(`https://wa.me/${full}`, '_blank');
              return;
            }
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
            <div style="display:flex; flex-direction:column; gap:12px;">
              <!-- Resumen de Billetera -->
              <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:12px;">
                <h4 style="margin:0; font-size:13px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
                  ${icon('wallet', 16)} Resumen de Billetera
                </h4>
                <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px; font-weight:600; color:var(--color-text-secondary);">
                  <div style="display:flex; justify-content:space-between;">
                    <span>Ganancias por Transferencia (Digital)</span>
                    <span id="wallet-digital-earnings" style="color:#10b981; font-weight:700;">$ 0</span>
                  </div>
                  <div style="display:flex; justify-content:space-between;">
                    <span>Cobros en Efectivo (Bolsillo)</span>
                    <span id="wallet-cash-earnings" style="color:#f59e0b; font-weight:700;">$ 0</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; border-top:1px dashed var(--color-border-light); padding-top:8px; font-weight:700;">
                    <span>Total Facturado (Ambos)</span>
                    <span id="wallet-total-combined" style="color:var(--color-text-primary); font-weight:800;">$ 0</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; color:#ef4444;">
                    <span>Tarifa App (A Liquidar)</span>
                    <span id="wallet-app-fee" style="font-weight:700;">-$ 0</span>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:4px; border-top:1.5px solid var(--color-border-light); padding-top:10px; margin-top:4px;">
                    <div style="display:flex; justify-content:space-between; font-weight:900; font-size:14px;">
                      <span style="color:var(--color-text-primary);">Balance Neto</span>
                      <span id="wallet-net-balance" style="font-size:16px;">$ 0</span>
                    </div>
                    <div style="font-size:10px; color:var(--color-text-tertiary); text-align:center; font-weight:700; opacity:0.8; margin-top:2px;">
                      Fórmula: Digital + Efectivo - Tarifa App
                    </div>
                  </div>
                </div>
              </div>

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
      const shippingFee = Number(order.shippingFee || order.deliveryFee || 0);
      const serviceFee = Number(order.appUsageFee || order.serviceFee || 0);
      const tip = Number(order.tip || 0);
      const discount = Number(order.discount || 0);
      const purchaseFee = Number(order.purchaseFee || 0);
      const extraStopsFee = Number(order.extraStopsFee || 0);
      
      const newItemsCost = Math.max(0, newTotal - (shippingFee + serviceFee + tip + purchaseFee + extraStopsFee - discount));

      await updateDoc(doc(db, 'orders', order.id), {
        total: newTotal,
        totalAmount: newTotal,
        itemsCost: newItemsCost,
        subtotal: newItemsCost,
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

export async function showEditFavorPriceModal(order, isPersistent = false) {
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

  // Remove existing sheets if any
  document.getElementById('v5-price-edit-sheet')?.remove();
  document.getElementById('v5-price-edit-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'v5-price-edit-backdrop';
  backdrop.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99998; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); opacity: 0; transition: opacity 0.3s ease;";

  const sheet = document.createElement('div');
  sheet.id = 'v5-price-edit-sheet';
  sheet.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; box-shadow: 0 -12px 30px rgba(0,0,0,0.15); z-index: 99999; transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); max-height: 85vh; display: flex; flex-direction: column; padding-bottom: calc(20px + env(safe-area-inset-bottom, 16px)); overflow: hidden;";

  const titleText = order.favorType === 'pagodeservicios' ? 'Monto de Servicios' : 'Precios por Comercio';
  const subtitleText = order.favorType === 'pagodeservicios' ? 'Ingresá el valor total de las facturas pagadas.' : 'Ingresá el valor de los productos de cada local.';

  sheet.innerHTML = `
    <!-- Touch Drag Handle & Header -->
    <div class="sheet-drag-header" style="background: linear-gradient(135deg, var(--color-primary) 0%, #be123c 100%); color: white; padding: 12px 20px 16px; display: flex; flex-direction: column; align-items: center; position: relative; cursor: grab; flex-shrink: 0; box-shadow: 0 4px 15px rgba(190, 18, 60, 0.15); z-index: 10;">
      <div style="width: 40px; height: 4px; background: rgba(255,255,255,0.4); border-radius: 2px; margin-bottom: 12px;"></div>
      <div style="width: 100%; display: flex; align-items: center; gap: 12px; text-align: left;">
        <div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">
          ${icon('creditCard', 20)}
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0;">
          <h3 style="margin: 0; font-size: 16.5px; font-weight: 900; color: white; letter-spacing: -0.01em;">${titleText}</h3>
          <span style="font-size: 11.5px; color: rgba(255,255,255,0.85); font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${subtitleText}</span>
        </div>
        <button id="v5-price-edit-close" style="background: rgba(255,255,255,0.15); border: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: white; transition: background 0.2s;">
          ${icon('close', 14)}
        </button>
      </div>
    </div>

    <!-- Content Area (Scrollable) -->
    <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;">
      <div style="background:var(--color-bg-secondary); border-radius:24px; padding:20px; border:1.5px solid var(--color-border-light); display:flex; flex-direction:column; gap:16px; box-shadow: var(--shadow-sm);">
        <div style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; text-align:left; margin-bottom:4px;">
          ${order.favorType === 'pagodeservicios' ? 'Costo facturas' : 'Costo de productos'}
        </div>
        
        ${stores.map((st, idx) => {
          const price = currentPrices[st.name] || '';
          return `
            <div style="display:flex; flex-direction:column; gap:6px; text-align:left;">
              <label style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; justify-content:space-between; gap:6px;">
                <span>${order.favorType === 'pagodeservicios' ? '🧾' : '🏪'} <strong>${st.name}</strong></span>
                <span style="font-weight:600; font-size:11px; color:var(--color-text-secondary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:180px;">${st.items}</span>
              </label>
              <div style="position:relative;">
                <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:800; color:var(--color-text-tertiary);">$</span>
                <input type="number" class="favor-store-price-input" data-store-name="${st.name}" value="${price}" placeholder="0" style="width:100%; box-sizing:border-box; height:48px; border-radius:14px; border:2px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text); font-size:18px; font-weight:900; padding:0 16px 0 35px; outline:none; transition:border-color 0.3s;" inputmode="decimal">
              </div>
            </div>
          `;
        }).join('')}

        <div style="border-top:1.5px dashed var(--color-border-light); padding-top:14px; display:flex; justify-content:space-between; align-items:center; font-size:13.5px; font-weight:800; color:var(--color-text-primary);">
          <span>${order.favorType === 'pagodeservicios' ? 'Total Servicios:' : 'Total Productos:'}</span>
          <span id="favor-products-sum" style="font-size:17px; font-weight:950; color:#10b981;">${formatPrice(order.subtotal || 0)}</span>
        </div>

        <div style="border-top:1.5px dashed var(--color-border-light); padding-top:14px; display:flex; flex-direction:column; gap:8px; text-align:left; font-size:13px; font-weight:600; color:var(--color-text-secondary);">
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

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:4px;">
        <button id="cancel-edit-price" style="height:50px; border-radius:16px; background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border-light); font-weight:900; font-size:13.5px; cursor:pointer;">CANCELAR</button>
        <button id="confirm-edit-price" style="height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:950; font-size:13.5px; cursor:pointer; box-shadow:0 6px 16px rgba(var(--color-primary-rgb),0.2);">GUARDAR</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  // Trigger animation
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });

  const closeSheet = () => {
    backdrop.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 350);
  };

  backdrop.onclick = closeSheet;
  sheet.querySelector('#v5-price-edit-close').onclick = closeSheet;
  sheet.querySelector('#cancel-edit-price').onclick = closeSheet;

  // Touch Swipe-to-Close Implementation
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  const dragHeader = sheet.querySelector('.sheet-drag-header');

  dragHeader.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    isDragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });

  dragHeader.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      sheet.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: true });

  dragHeader.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    const deltaY = currentY - startY;
    if (deltaY > 120) {
      closeSheet();
    } else {
      sheet.style.transform = 'translateY(0)';
    }
  });

  const inputs = sheet.querySelectorAll('.favor-store-price-input');
  const sumDisplay = sheet.querySelector('#favor-products-sum');
  const preview = sheet.querySelector('#client-total-preview');

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

  sheet.querySelector('#confirm-edit-price').onclick = () => {
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

    closeSheet();
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
    total: newTotal,
    updatedAt: serverTimestamp()
  });

  // Send real-time notification banner to customer
  if (freshOrder.userId) {
    try {
      await addDoc(collection(db, 'users', freshOrder.userId, 'notifications'), {
        title: '💰 Precios cargados en tu pedido',
        body: `El repartidor ingresó el valor de los productos (${formatPrice(val)}). Total a abonar: ${formatPrice(newTotal)}.`,
        type: 'price_updated',
        orderId: orderId,
        status: 'unread',
        createdAt: serverTimestamp()
      });
    } catch (notifErr) {
      console.warn('Could not send price update notification to user:', notifErr);
    }
  }

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

async function notifyAdminsOnDriverConnection(driverUser, action) {
  try {
    const { collection, query, where, getDocs, addDoc, serverTimestamp } = await import('firebase/firestore');
    
    // Multi-query to cover both role == 'admin' and isAdmin == true to ensure kioscopaulos7@gmail.com and all admins get notified
    const [roleSnap, isAdminSnap] = await Promise.all([
      getDocs(query(collection(db, 'users'), where('role', '==', 'admin'))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'users'), where('isAdmin', '==', true))).catch(() => ({ docs: [] }))
    ]);

    const adminIds = new Set();
    [...roleSnap.docs, ...isAdminSnap.docs].forEach(d => adminIds.add(d.id));

    const isConnect = action === 'connect';
    const title = isConnect ? '🟢 Repartidor Conectado' : '🔴 Repartidor Desconectado';
    const driverName = driverUser.displayName || driverUser.name || 'Repartidor';
    const body = isConnect 
      ? `SOPORTE GO: El repartidor ${driverName} se acaba de CONECTAR y está disponible para pedidos.` 
      : `SOPORTE GO: El repartidor ${driverName} se acaba de DESCONECTAR.`;

    for (const adminId of adminIds) {
      try {
        await addDoc(collection(db, 'users', adminId, 'notifications'), {
          title,
          body,
          type: 'driver_status_change',
          driverId: driverUser.uid || driverUser.id,
          status: 'unread',
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.warn('Error notifying admin:', adminId, err);
      }
    }
  } catch (err) {
    console.error('Error in notifyAdminsOnDriverConnection:', err);
  }
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
  
  const { deleteField } = await import('firebase/firestore');
  // Update Firestore in background
  await updateDoc(doc(db, 'users', user.uid), {
    isOnline: true,
    currentSessionId: sessionRef.id,
    lastActivityAt: serverTimestamp(),
    lastTripAcceptedAt: serverTimestamp(),
    missedOffersCount: 0,
    cooldownUntil: deleteField(),
    disconnectedReason: deleteField()
  });
  
  startInactivityCheck(updatedUser);
  startHeartbeat(updatedUser);
  
  // Notify all admins about driver connection
  notifyAdminsOnDriverConnection(updatedUser, 'connect');
  
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

  // Notify all admins about driver disconnection
  notifyAdminsOnDriverConnection(user, 'disconnect');

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
  inactivityTimer = null;
  // Desconexión por inactividad deshabilitada del lado del cliente.
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
  `;
}

async function loadProfessionalStats(driverId, callback = null) {
  const { getDocs, getDoc, doc, collection, query, where } = await import('firebase/firestore');
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

    // Compute cash vs digital split for Billetera
    let cashEarnings = 0;
    let digitalEarnings = 0;
    orders.forEach(o => {
      const method = (o.paymentMethod || 'efectivo').toLowerCase();
      if (method === 'efectivo' || method === 'cash') {
        cashEarnings += (o.deliveryCost || 0);
      } else {
        digitalEarnings += (o.deliveryCost || 0);
      }
    });

    const combinedTotal = cashEarnings + digitalEarnings;

    // Fetch user debt
    const userDocSnap = await getDoc(doc(db, 'users', driverId));
    const debt = userDocSnap.exists() ? (userDocSnap.data().deliveryDebt || 0) : 0;
    const netBalance = digitalEarnings + cashEarnings - debt;

    if (document.getElementById('wallet-digital-earnings')) document.getElementById('wallet-digital-earnings').textContent = formatPrice(digitalEarnings);
    if (document.getElementById('wallet-cash-earnings')) document.getElementById('wallet-cash-earnings').textContent = formatPrice(cashEarnings);
    if (document.getElementById('wallet-total-combined')) document.getElementById('wallet-total-combined').textContent = formatPrice(combinedTotal);
    if (document.getElementById('wallet-app-fee')) document.getElementById('wallet-app-fee').textContent = `-${formatPrice(debt)}`;
    
    const netBalanceEl = document.getElementById('wallet-net-balance');
    if (netBalanceEl) {
      netBalanceEl.textContent = formatPrice(netBalance);
      netBalanceEl.style.color = netBalance >= 0 ? '#10b981' : '#ef4444';
    }

    // Render the CSS/SVG charts dynamically
    renderFinancesCharts(orders);

    if (callback) callback({ today: earningsDay, week: earningsWeek, month: earningsMonth });
  } catch (e) { console.error(e); }
}

async function showBalanceManagementModal(user, debt) {
  const pendingProofs = getState().pendingProofs || [];
  const totalPending = pendingProofs.reduce((sum, p) => sum + (p.amount || 0), 0);

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)) 20px; background:var(--color-bg); height:100%; display:flex; flex-direction:column; overflow:hidden; justify-content:space-between;';
  
  modalEl.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; gap:16px; overflow:hidden;">
      <div class="debt-card-v3" style="
        background: ${debt > 0 ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)' : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'};
        border: 1.5px solid ${debt > 0 ? '#fecaca' : '#bbf7d0'};
        border-radius: 24px; padding: 24px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.04);
        text-align: center;
        flex-shrink: 0;
        margin-top: 10px;
      ">
        <style>
          [data-theme="dark"] .debt-card-v3 {
            background: ${debt > 0 ? 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)' : 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)'} !important;
            border-color: ${debt > 0 ? '#991b1b' : '#065f46'} !important;
          }
        </style>
        <span style="font-size:11px; font-weight:900; color:${debt > 0 ? '#ef4444' : '#10b981'}; text-transform:uppercase; letter-spacing:0.1em; display:block; margin-bottom:8px;">Balance Pendiente</span>
        <div style="font-size:38px; font-weight:950; color:${debt > 0 ? '#ef4444' : '#10b981'}; letter-spacing:-1.5px; line-height:1;">${formatPrice(debt)}</div>
        <p style="font-size:12px; color:var(--color-text-secondary); margin:14px 0 0; font-weight:700; line-height:1.45; opacity:0.85;">
          ${debt > 0 ? 'Este monto será descontado de tus próximas ganancias.' : 'No tenés deudas pendientes con la plataforma.'}
        </p>
      </div>

      ${totalPending > 0 ? `
        <div style="background:linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(217,119,6,0.04) 100%); border:1px solid rgba(245,158,11,0.25); border-radius:18px; padding:12px 16px; display:flex; gap:8px; align-items:center; margin-top:2px; box-shadow:var(--shadow-sm); flex-shrink:0;">
          <span style="font-size:16px;">⏳</span>
          <div style="font-size:11.5px; color:#d97706; font-weight:700; line-height:1.4; text-align:left;">
            Tenés una transferencia de <strong style="font-weight:900;">${formatPrice(totalPending)}</strong> pendiente de validación por administración.
          </div>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; flex-shrink:0;">
        <button id="modal-view-history-btn" style="height:50px; border-radius:16px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text-primary); font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; transition:all 0.2s;">
          ${icon('history', 16)} Historial
        </button>
        <button id="modal-regularize-btn" style="height:50px; border-radius:16px; background:var(--color-primary); border:none; color:white; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; box-shadow:0 6px 16px rgba(var(--color-primary-rgb), 0.25); transition:all 0.2s;">
          ${icon('wallet', 16)} Regularizar
        </button>
      </div>
    </div>

    <button id="modal-send-proof-btn" style="width:100%; height:54px; border-radius:18px; background:#25D366; border:none; color:white; font-weight:950; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; box-shadow:0 8px 20px rgba(37, 211, 102, 0.25); flex-shrink:0; margin-top:20px;">
      ${icon('whatsappLogo', 20)} Enviar comprobante
    </button>
  `;

  showModal({ 
    title: 'Gestión de Balance', 
    content: modalEl, 
    height: '70dvh',
    headerBackground: '#E11D48',
    headerTextColor: 'white'
  });

  modalEl.querySelector('#modal-view-history-btn').onclick = () => {
    showBalanceHistoryModal(user.uid);
  };
  modalEl.querySelector('#modal-regularize-btn').onclick = () => {
    const pendingProofs = getState().pendingProofs || [];
    if (pendingProofs.length > 0) {
      showToast('⚠️ Ya tenés una liquidación pendiente de verificación.', 'warning');
      return;
    }
    showRegularizeModal(debt);
  };
  modalEl.querySelector('#modal-send-proof-btn').onclick = () => {
    const pendingProofs = getState().pendingProofs || [];
    if (pendingProofs.length > 0) {
      showToast('⚠️ Ya tenés una liquidación pendiente de verificación.', 'warning');
      return;
    }
    const wsp = getState().whatsappPayments || '5491123456789';
    const msg = encodeURIComponent(`Hola, adjunto comprobante de pago de GoDelivery.\n---\nREPARTIDOR: ${user.displayName || user.name}\nID: ${user.deliveryId || '---'}\nMONTO: ${formatPrice(debt)}\nDETALLE: Saldar balance pendiente.`);
    window.open(`https://wa.me/${wsp}?text=${msg}`, '_blank');
  };
}

async function showRegularizeModal(debt) {
  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)) 20px; background:var(--color-bg); height:100%; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden;';
  
  const bankAlias = getState().bankAlias || 'godelivery.oficial';
  const bankOwner = getState().bankOwner || 'GoDelivery S.R.L.';

  modalEl.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; gap:20px; overflow-y:auto; margin-bottom:16px;">
      <p style="font-size:13.5px; color:var(--color-text-secondary); margin:10px 0 0; font-weight:700; text-align:center; line-height:1.5;">
        Para saldar tu deuda de <strong style="color:#ef4444; font-size:16px; font-weight:950;">${formatPrice(debt)}</strong>, realizá una transferencia bancaria o Mercado Pago:
      </p>

      <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:22px; padding:22px; box-shadow:var(--shadow-sm);">
        <div style="margin-bottom:16px; border-bottom:1px dashed var(--color-border-light); padding-bottom:14px;">
          <label style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; display:block; letter-spacing:0.06em;">ALIAS / CVU</label>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:18px; color:var(--color-text-primary); letter-spacing:0.02em; font-family:var(--font-mono, monospace);">${bankAlias}</strong>
            <button class="btn-copy" onclick="navigator.clipboard.writeText('${bankAlias}'); showToast('Copiado', 'success')" style="background:rgba(var(--color-primary-rgb),0.08); border:none; color:var(--color-primary); cursor:pointer; width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
              ${icon('copy', 16)}
            </button>
          </div>
        </div>
        
        <div>
          <label style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; display:block; letter-spacing:0.06em;">TITULAR</label>
          <strong style="font-size:15px; color:var(--color-text-primary); font-weight:800;">${bankOwner}</strong>
        </div>
      </div>

      <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.15); border-radius:18px; padding:16px; display:flex; gap:12px; align-items:flex-start;">
        <div style="color:#d97706; margin-top:2px; display:flex; flex-shrink:0;">${icon('info', 18)}</div>
        <p style="font-size:12.5px; color:var(--color-text-secondary); margin:0; line-height:1.45; font-weight:600;">
          Una vez realizada la transferencia, seleccioná y subí la foto de tu comprobante para que el administrador la verifique y active tu saldo.
        </p>
      </div>
    </div>

    <input type="file" id="receipt-file-input" accept="image/*" style="display:none;" />
    
    <button id="modal-upload-receipt-btn"
            style="width:100%; height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:950; font-size:14px; cursor:pointer; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.25); display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; flex-shrink:0; transition:all 0.2s;">
      ${icon('camera', 20)} SUBIR COMPROBANTE
    </button>
  `;

  showModal({ 
    title: 'Regularizar Balance', 
    content: modalEl, 
    height: '70dvh',
    headerBackground: '#E11D48',
    headerTextColor: 'white'
  });

  const fileInput = modalEl.querySelector('#receipt-file-input');
  const uploadBtn = modalEl.querySelector('#modal-upload-receipt-btn');

  uploadBtn.onclick = () => {
    fileInput.click();
  };

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = 'Subiendo comprobante...';
    uploadBtn.style.opacity = '0.7';

    try {
      const user = getState().user;
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      
      const storageRef = ref(storage, `delivery_receipts/${user.uid}_${Date.now()}.jpg`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(snapshot.ref);

      // Create transaction request in Firestore collection delivery_settlement_proofs
      await addDoc(collection(db, 'delivery_settlement_proofs'), {
        driverId: user.uid,
        driverName: user.displayName || user.name || 'Repartidor',
        driverDeliveryId: user.deliveryId || '---',
        amount: debt,
        imageUrl: downloadUrl,
        status: 'pending',
        createdAt: new Date()
      });

      showToast('✅ Comprobante subido con éxito. El administrador lo revisará en breve.', 'success');
      closeModal(); // close Regularize Modal
      closeModal(); // close Balance Management Modal
    } catch (err) {
      console.error(err);
      showToast('❌ Error al subir comprobante. Reintenta.', 'error');
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = `${icon('camera', 20)} SUBIR COMPROBANTE`;
      uploadBtn.style.opacity = '1';
    }
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
async function showCompletedOrderDetailsModal(orderId) {
  const { getDoc, doc } = await import('firebase/firestore');
  const orderDoc = await getDoc(doc(db, 'orders', orderId));
  if (!orderDoc.exists()) {
    import('../components/toast.js').then(m => m.showToast('No se encontró el pedido', 'warning'));
    return;
  }
  const o = { id: orderDoc.id, ...orderDoc.data() };
  
  const content = document.createElement('div');
  content.style.cssText = 'padding:24px; background:var(--color-bg); display:flex; flex-direction:column; gap:16px;';
  
  let itemsHtml = '';
  if (o.isFavor) {
    itemsHtml = `<p style="font-size:13.5px; color:var(--color-text-secondary); line-height:1.4; margin:0;">${o.details || o.description || 'Sin descripción'}</p>`;
  } else if (o.items && o.items.length > 0) {
    itemsHtml = o.items.map(item => `
      <div style="font-size:13px; color:var(--color-text-secondary); margin-bottom:6px;"><span style="color:var(--color-primary); font-weight:800;">${item.qty || 1}x</span> ${item.name}</div>
    `).join('');
  } else {
    itemsHtml = `<p style="font-size:13px; color:var(--color-text-tertiary); font-style:italic; margin:0;">Pedido de Comercio</p>`;
  }

  const totalAmount = (o.subtotal || 0) + (o.deliveryCost || 0) + (o.tip || 0) + (o.appUsageFee || 0);

  content.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">
      <div>
        <span style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Cliente</span>
        <div style="font-size:14px; font-weight:800; color:var(--color-text-primary); margin-top:2px;">${o.userName || 'Cliente'}</div>
        ${o.userPhone ? `<div style="font-size:12px; color:var(--color-text-secondary); margin-top:2px;">Tel: ${o.userPhone}</div>` : ''}
      </div>

      <div>
        <span style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Dirección de Entrega</span>
        <div style="font-size:13.5px; font-weight:700; color:var(--color-text-primary); margin-top:2px;">${o.deliveryAddress || '---'}</div>
        ${o.addressNotes ? `<div style="font-size:12.5px; color:#d97706; font-weight:700; margin-top:2px;">⚠️ Ref: ${o.addressNotes}</div>` : ''}
      </div>

      <div style="border-top:1px solid var(--color-border-light); padding-top:12px;">
        <span style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Productos</span>
        <div style="margin-top:6px;">${itemsHtml}</div>
      </div>

      <div style="background:var(--color-bg-secondary); border-radius:16px; padding:14px; border:1px solid var(--color-border-light); display:flex; flex-direction:column; gap:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:600;">
          <span style="color:var(--color-text-secondary);">Subtotal Productos</span>
          <span style="color:var(--color-text-primary);">$${Math.round(o.subtotal || 0).toLocaleString('es-AR')}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:600;">
          <span style="color:var(--color-text-secondary);">Costo de Envío</span>
          <span style="color:var(--color-text-primary);">$${Math.round(o.deliveryCost || 0).toLocaleString('es-AR')}</span>
        </div>
        ${o.tip > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:600; color:#10b981;">
            <span>Propina</span>
            <span>+$${Math.round(o.tip || 0).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${o.appUsageFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:600; color:#f59e0b;">
            <span>Tarifa de Uso App</span>
            <span>+$${Math.round(o.appUsageFee || 0).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:900; border-top:1px solid var(--color-border-light); padding-top:8px; margin-top:4px;">
          <span>Total Cobrado</span>
          <span style="color:var(--color-primary);">$${Math.round(totalAmount).toLocaleString('es-AR')}</span>
        </div>
      </div>
    </div>
  `;

  showModal({ title: `Detalle de Pedido #${o.orderId || '---'}`, content });
}

async function showBalanceHistoryModal(driverId) {
  const { getDocs, getDoc, doc, collection, query, where } = await import('firebase/firestore');
  
  const content = document.createElement('div');
  content.style.cssText = 'padding:16px 20px; background:var(--color-bg); min-height:60dvh; display:flex; flex-direction:column;';
  content.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;
  
  showModal({ 
    title: 'Historial de Balance', 
    content, 
    height: '80dvh',
    headerBackground: '#E11D48',
    headerTextColor: 'white'
  });
  
  try {
    // 1. Fetch user deliveryDebt from Firestore reference correctly
    const userDocSnap = await getDoc(doc(db, 'users', driverId));
    const userData = userDocSnap.exists() ? userDocSnap.data() : {};
    const actualDebt = userData.deliveryDebt || 0;
    const lastLiquidationAt = userData.lastLiquidationAt;

    // 2. Fetch transactions
    const qTrans = query(
      collection(db, 'delivery_transactions'), 
      where('driverId', '==', driverId)
    );
    const transSnap = await getDocs(qTrans);
    const transList = transSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 3. Fetch completed orders pending liquidation
    const qOrders = query(
      collection(db, 'orders'),
      where('driverId', '==', driverId),
      where('status', '==', 'completed')
    );
    const ordersSnap = await getDocs(qOrders);
    const pendingOrdersList = ordersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => {
        let isSettled = o.isSettledDriver === true;
        if (!isSettled && lastLiquidationAt) {
          const lqTime = lastLiquidationAt.toMillis ? lastLiquidationAt.toMillis() : new Date(lastLiquidationAt).getTime();
          const orderTime = o.deliveredAt ? (o.deliveredAt.toMillis ? o.deliveredAt.toMillis() : new Date(o.deliveredAt).getTime()) : (o.createdAt ? (o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime()) : 0);
          if (orderTime > 0 && orderTime <= lqTime) {
            isSettled = true;
          }
        }
        return !isSettled && (o.appUsageFee || 0) > 0;
      })
      .map(o => ({
        id: o.id,
        type: 'app_usage_fee',
        amount: o.appUsageFee,
        description: `Tarifa de Uso App (Pedido #${o.orderId})`,
        createdAt: o.deliveredAt || o.createdAt,
        orderId: o.id
      }));

    // 4. Algorithm to build "Pendientes de Liquidar" list that sums exactly to actualDebt
    const allCharges = [
      ...pendingOrdersList,
      ...transList.filter(t => t.type === 'canon_charge').map(t => ({
        id: t.id,
        type: 'canon_charge',
        amount: t.amount,
        description: t.description || 'Canon Diario Jornada',
        createdAt: t.createdAt
      }))
    ].sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime();
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime();
      return (timeB || 0) - (timeA || 0);
    });

    const pendingCharges = [];
    let accumulated = 0;
    for (const charge of allCharges) {
      if (accumulated >= actualDebt) break;
      const amt = charge.amount || 0;
      if (accumulated + amt <= actualDebt) {
        pendingCharges.push(charge);
        accumulated += amt;
      } else {
        const partialAmt = actualDebt - accumulated;
        pendingCharges.push({
          ...charge,
          amount: partialAmt,
          isPartial: true
        });
        accumulated += partialAmt;
      }
    }

    const discrepancy = actualDebt - accumulated;
    if (Math.abs(discrepancy) > 1) {
      pendingCharges.push({
        id: 'virtual_adjustment',
        type: 'adjustment_charge',
        amount: discrepancy,
        description: 'Saldo Pendiente Anterior',
        createdAt: null
      });
    }

    // 5. Liquidations tab list (all past liquidations/coupons)
    const liquidationsList = transList
      .filter(t => t.type === 'liquidation' || t.type === 'coupon_reimbursement')
      .sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime();
        return (timeB || 0) - (timeA || 0);
      });

    // 6. Draw Tabs
    content.innerHTML = `
      <!-- Tab Headers -->
      <div style="display:flex; background:var(--color-bg-secondary); border-radius:16px; padding:4px; margin-bottom:18px; border:1px solid var(--color-border-light); flex-shrink:0;">
        <button id="tab-btn-pending" style="flex:1; height:40px; border-radius:12px; border:none; background:var(--color-surface); color:var(--color-primary); font-size:12px; font-weight:800; cursor:pointer; transition:all 0.2s; box-shadow:var(--shadow-sm);">
          A Liquidar ($${Math.round(actualDebt).toLocaleString('es-AR')})
        </button>
        <button id="tab-btn-history" style="flex:1; height:40px; border-radius:12px; border:none; background:transparent; color:var(--color-text-secondary); font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
          Liquidaciones
        </button>
      </div>

      <!-- Tab Content Area -->
      <div id="balance-tab-content-area" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding-bottom:10px;">
      </div>
    `;

    const pendingBtn = content.querySelector('#tab-btn-pending');
    const historyBtn = content.querySelector('#tab-btn-history');
    const contentArea = content.querySelector('#balance-tab-content-area');

    function renderTab(tabName) {
      if (tabName === 'pending') {
        pendingBtn.style.background = 'var(--color-surface)';
        pendingBtn.style.color = 'var(--color-primary)';
        pendingBtn.style.fontWeight = '800';
        pendingBtn.style.boxShadow = 'var(--shadow-sm)';
        
        historyBtn.style.background = 'transparent';
        historyBtn.style.color = 'var(--color-text-secondary)';
        historyBtn.style.fontWeight = '700';
        historyBtn.style.boxShadow = 'none';

        if (pendingCharges.length === 0) {
          contentArea.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--color-text-tertiary); opacity:0.6;">${icon('checkCircle', 48)}<p style="margin-top:16px; font-weight:600;">¡Tu cuenta está al día!</p></div>`;
          return;
        }

        contentArea.innerHTML = pendingCharges.map(t => {
          const isCanon = t.type === 'canon_charge';
          const isAppFee = t.type === 'app_usage_fee';
          const rawDate = t.createdAt ? (t.createdAt.toMillis ? t.createdAt.toMillis() : new Date(t.createdAt).getTime()) : null;
          const formattedDate = rawDate ? `📅 ${new Date(rawDate).toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})} hs` : 'Saldo Pendiente';
          
          let iconColor = isCanon ? '#e11d48' : '#f59e0b';
          let iconBg = isCanon ? 'rgba(225,29,72,0.08)' : 'rgba(245,158,11,0.08)';
          let iconName = isCanon ? 'bike' : 'cart';
          if (t.type === 'adjustment_charge') {
            iconColor = '#64748b';
            iconBg = 'rgba(100,116,139,0.08)';
            iconName = 'receipt';
          }

          return `
            <div class="balance-item-card" data-order-id="${t.orderId || ''}" style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:18px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; cursor:${t.orderId ? 'pointer' : 'default'}; transition:all 0.2s; box-shadow:var(--shadow-xs);">
              <div style="min-width:0; flex:1; display:flex; align-items:center; gap:10px;">
                <div style="width:34px; height:34px; border-radius:10px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon(iconName, 16)}
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:1px;">
                  <div style="font-weight:800; font-size:13.5px; color:var(--color-text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${t.description}</div>
                  <div style="font-size:10px; color:var(--color-text-tertiary); font-weight:700;">${formattedDate}</div>
                </div>
              </div>
              <div style="text-align:right; margin-left:12px; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-weight:900; font-size:15px; color:${iconColor}; letter-spacing:-0.5px;">+$${Math.round(amount).toLocaleString('es-AR')}</span>
                <span style="font-size:8px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">${isCanon ? 'CANON' : isAppFee ? 'TARIFA APP' : 'SALDO'}</span>
              </div>
            </div>
          `;
        }).join('');

        contentArea.querySelectorAll('.balance-item-card').forEach(card => {
          if (card.dataset.orderId) {
            card.addEventListener('click', () => {
              showCompletedOrderDetailsModal(card.dataset.orderId);
            });
            // Hover styling
            card.onmouseover = () => { card.style.borderColor = 'var(--color-primary)'; card.style.background = 'rgba(var(--color-primary-rgb), 0.02)'; };
            card.onmouseout = () => { card.style.borderColor = 'var(--color-border-light)'; card.style.background = 'var(--color-surface)'; };
          }
        });

      } else {
        historyBtn.style.background = 'var(--color-surface)';
        historyBtn.style.color = 'var(--color-primary)';
        historyBtn.style.fontWeight = '800';
        historyBtn.style.boxShadow = 'var(--shadow-sm)';
        
        pendingBtn.style.background = 'transparent';
        pendingBtn.style.color = 'var(--color-text-secondary)';
        pendingBtn.style.fontWeight = '700';
        pendingBtn.style.boxShadow = 'none';

        if (liquidationsList.length === 0) {
          contentArea.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--color-text-tertiary); opacity:0.6;">${icon('receipt', 48)}<p style="margin-top:16px; font-weight:600;">No hay liquidaciones registradas</p></div>`;
          return;
        }

        contentArea.innerHTML = liquidationsList.map(t => {
          const isCoupon = t.type === 'coupon_reimbursement';
          const formattedDate = t.createdAt ? new Date(t.createdAt.toMillis ? t.createdAt.toMillis() : new Date(t.createdAt).getTime()).toLocaleDateString('es-AR', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Reciente';
          
          const iconColor = isCoupon ? '#a855f7' : '#22c55e';
          const iconBg = isCoupon ? 'rgba(168,85,247,0.08)' : 'rgba(34,197,94,0.08)';
          const iconName = isCoupon ? 'tag' : 'checkCircle';

          return `
            <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:18px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-xs);">
              <div style="min-width:0; flex:1; display:flex; align-items:center; gap:10px;">
                <div style="width:34px; height:34px; border-radius:10px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon(iconName, 16)}
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:1px;">
                  <div style="font-weight:800; font-size:13.5px; color:var(--color-text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${t.description || 'Liquidación de Balance'}</div>
                  <div style="font-size:10px; color:var(--color-text-tertiary); font-weight:700;">${formattedDate}</div>
                </div>
              </div>
              <div style="text-align:right; margin-left:12px; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-weight:900; font-size:15px; color:${iconColor}; letter-spacing:-0.5px;">-$${Math.round(Math.abs(t.amount || 0)).toLocaleString('es-AR')}</span>
                <span style="font-size:8px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">${isCoupon ? 'REINTEGRO' : 'LIQUIDADO'}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    pendingBtn.onclick = () => renderTab('pending');
    historyBtn.onclick = () => renderTab('history');

    // Default to pending tab
    renderTab('pending');

  } catch (e) {
    console.error("Error drawing balance history modal:", e);
    content.innerHTML = `<p style="color:var(--color-danger); text-align:center; padding:40px;">Error al cargar el historial de balance.</p>`;
  }
}

function renderStatusBar(user) {
  // Always use fresh state for rendering styles
  const latestUser = getState().user || user;
  if (!latestUser) return '';
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

  const pendingProofs = getState().pendingProofs || [];
  const totalPending = pendingProofs.reduce((sum, p) => sum + (p.amount || 0), 0);
  const pendingBadgeHtml = totalPending > 0 ? `
    <div style="
      font-size: 10px;
      font-weight: 900;
      background: linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(217,119,6,0.08) 100%);
      color: #d97706;
      padding: 6px 11px;
      border-radius: 100px;
      border: 1px solid rgba(245,158,11,0.25);
      display: flex; align-items: center; gap: 5px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: all 0.2s ease;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(245,158,11,0.1);
    " onclick="document.getElementById('status-tarife-badge')?.click()">
      <span style="opacity: 0.75; font-size:9px; letter-spacing:0.5px;">⏳ PENDIENTE:</span>
      <strong style="font-weight: 950; font-size: 11px;">${formatPrice(totalPending)}</strong>
    </div>
  ` : '';

  return `
    <div id="session-status-bar" class="status-bar-slide" style="
      padding: 12px 16px;
      background: ${finalIsOnline ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.05)'};
      border-bottom: 1px solid ${finalIsOnline ? 'rgba(34,197,94,0.12)' : 'var(--color-border-light)'};
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px;
      backdrop-filter: blur(10px);
      transition: all 0.5s ease;
    ">
      <div style="display:flex; align-items:center; gap:10px; flex-shrink:1; min-width:0;">
        <div class="${finalIsOnline ? 'status-dot-active' : ''}" style="
          width: 8px; height: 8px; border-radius: 50%;
          background: ${finalIsOnline ? '#22c55e' : '#64748b'};
          box-shadow: ${finalIsOnline ? '0 0 10px #22c55e' : 'none'};
          transition: all 0.5s ease;
          flex-shrink: 0;
        "></div>
        <div style="display:flex; flex-direction:column; min-width:0;">
          <span style="
            font-size: 11px; font-weight: 800;
            color: ${finalIsOnline ? '#22c55e' : 'var(--color-text-tertiary)'};
            text-transform: uppercase; letter-spacing: 0.05em;
            transition: all 0.5s ease;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          ">
            ${finalIsOnline ? 'Conectado' : 'Desconectado'}
          </span>
          <span style="font-size: 9px; color: var(--color-text-tertiary); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${finalIsOnline ? 'En línea' : 'No visible'}
          </span>
        </div>
      </div>

      <!-- BADGES CONTAINER -->
      <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
        ${pendingBadgeHtml}
        
        <!-- TARIFA APP BADGE -->
        <div id="status-tarife-badge" style="
          font-size: 10px;
          font-weight: 900;
          background: ${(latestUser.deliveryDebt || 0) > 0
            ? 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(185,28,28,0.08) 100%)'
            : 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(5,150,105,0.08) 100%)'};
          color: ${(latestUser.deliveryDebt || 0) > 0 ? '#ef4444' : '#10b981'};
          padding: 6px 11px;
          border-radius: 100px;
          border: 1px solid ${(latestUser.deliveryDebt || 0) > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'};
          display: flex; align-items: center; gap: 5px;
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          transition: all 0.2s ease;
          flex-shrink: 0;
          box-shadow: ${(latestUser.deliveryDebt || 0) > 0 ? '0 2px 8px rgba(239,68,68,0.1)' : '0 2px 8px rgba(16,185,129,0.1)'};
        ">
          <span style="opacity: 0.75; font-size:9px; letter-spacing:0.5px;">TARIFA:</span>
          <strong style="font-weight: 950; font-size: 11px;">${formatPrice(latestUser.deliveryDebt || 0)}</strong>
        </div>
      </div>

      <button id="session-toggle-btn" style="
        height: 33px; padding: 0 14px; border-radius: 100px;
        border: none;
        background: ${finalIsOnline
          ? 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(185,28,28,0.07) 100%)'
          : 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)'};
        color: ${finalIsOnline ? '#ef4444' : 'white'};
        font-weight: 900; font-size: 10px; letter-spacing: 0.3px;
        cursor: pointer;
        box-shadow: ${finalIsOnline ? '0 1px 4px rgba(239,68,68,0.15)' : '0 4px 15px rgba(225,29,72,0.3)'};
        border: 1px solid ${finalIsOnline ? 'rgba(239,68,68,0.2)' : 'transparent'};
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        text-transform: uppercase;
        display: flex; align-items: center; gap: 6px;
        flex-shrink: 0;
      ">
        ${finalIsOnline ? icon('x', 11) + ' Salir' : icon('power', 11) + ' Conectar'}
      </button>
    </div>
  `;
}

export async function ensureDriverPermissions() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const notifHelpText = isStandalone
    ? (isIOS 
        ? 'En tu iPhone: Abrí la app <b>Ajustes</b> ➔ <b>Notificaciones</b> ➔ Buscá <b>GoDelivery</b> ➔ Activá <b>Permitir notificaciones</b>.'
        : 'En tu Android: Mantené presionado el icono de la App <b>GoDelivery</b> en tu pantalla de inicio ➔ <b>Información de la app (ⓘ)</b> ➔ <b>Permisos</b> ➔ <b>Notificaciones</b> ➔ Cambiá a <b>Permitir</b>.')
    : 'Habilitá las notificaciones desde los ajustes de tu celular o el icono del navegador.';

  const locationHelpText = isStandalone
    ? (isIOS
        ? 'En tu iPhone: Abrí <b>Ajustes</b> ➔ <b>Privacidad y seguridad</b> ➔ <b>Localización</b> ➔ Buscá <b>GoDelivery / Safari</b> ➔ Seleccioná <b>"Al usar la app"</b>.'
        : 'En tu Android: Mantené presionado el icono de la App <b>GoDelivery</b> en tu pantalla de inicio ➔ <b>Información de la app (ⓘ)</b> ➔ <b>Permisos</b> ➔ <b>Ubicación</b> ➔ Cambiá a <b>Permitir solo con la app en uso</b>.')
    : 'Permití el acceso a la ubicación GPS desde la configuración de tu celular o navegador.';

  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      try {
        const { requestWebPushPermission } = await import('../utils/notifications.js');
        const res = await requestWebPushPermission();
        if (res !== 'granted') {
          showToast('⚠️ Es obligatorio permitir las notificaciones para conectarte y recibir pedidos.', 'warning');
          return false;
        }
      } catch (e) {
        console.warn('Error requesting notifications:', e);
      }
    } else if (Notification.permission === 'denied') {
      showModal({
        title: '🔔 Permiso de Notificaciones Requerido',
        content: `
          <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center;">
              ${icon('bell', 28)}
            </div>
            <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: var(--color-text-primary);">Notificaciones Desactivadas</h3>
            <p style="margin: 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.55; font-weight: 600;">
              Las notificaciones son obligatorias para que te lleguen los avisos de pedidos a tu celular.<br><br>
              ${notifHelpText}
            </p>
          </div>
        `,
        height: 'auto'
      });
      return false;
    }
  }

  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3500, maximumAge: 10000, enableHighAccuracy: true });
      });

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile && pos && pos.coords && typeof pos.coords.accuracy === 'number' && pos.coords.accuracy > 100) {
        const preciseHelpText = isStandalone
          ? (isIOS
              ? 'En tu iPhone: Abrí <b>Ajustes</b> ➔ <b>Privacidad y seguridad</b> ➔ <b>Localización</b> ➔ Buscá <b>GoDelivery / Safari</b> ➔ Activá el switch <b>"Ubicación precisa"</b>.'
              : 'En tu Android: Mantené presionado el icono de <b>GoDelivery</b> en tu pantalla de inicio ➔ <b>Info de la app (ⓘ)</b> ➔ <b>Permisos</b> ➔ <b>Ubicación</b> ➔ Activá el switch <b>"Usar ubicación precisa"</b>.')
          : 'Activá el switch "Ubicación precisa" en los permisos de ubicación de tu celular o navegador.';

        showModal({
          title: '📍 Ubicación Precisa Requerida',
          content: `
            <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
              <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(245, 158, 11, 0.12); color: #d97706; display: flex; align-items: center; justify-content: center;">
                ${icon('mapPin', 28)}
              </div>
              <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: var(--color-text-primary);">Desactivá la Ubicación Aproximada</h3>
              <p style="margin: 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.55; font-weight: 600;">
                Estás utilizando la opción de <b>Ubicación Aproximada</b> (precisión actual: ~${Math.round(pos.coords.accuracy)}m). Para conectarte y repartir en GoDelivery es obligatorio activar la <b>Ubicación Precisa</b>.<br><br>
                ${preciseHelpText}
              </p>
            </div>
          `,
          height: 'auto'
        });
        return false;
      }
    } catch (err) {
      if (err.code === 1 /* PERMISSION_DENIED */) {
        showModal({
          title: '📍 Permiso de Ubicación Requerido',
          content: `
            <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
              <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center;">
                ${icon('mapPin', 28)}
              </div>
              <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: var(--color-text-primary);">Ubicación GPS Desactivada</h3>
              <p style="margin: 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.55; font-weight: 600;">
                El acceso a tu ubicación GPS es obligatorio para asignarte pedidos cercanos y transmitir tu recorrido a los clientes.<br><br>
                ${locationHelpText}
              </p>
            </div>
          `,
          height: 'auto'
        });
        return false;
      }
    }
  }

  return true;
}

function attachStatusBarListeners(user) {
  const btn = document.getElementById('session-toggle-btn');
  if (!btn || !user) return;

  const badge = document.getElementById('status-tarife-badge');
  if (badge) {
    badge.onclick = () => {
      const latest = getState().user || user;
      showBalanceManagementModal(latest, latest.deliveryDebt || 0);
    };
  }
  
  btn.onclick = async () => {
    const currentUser = getState().user || user;
    if (!currentUser) return;
    if (currentUser.isOnline) {
      if (activeOrdersCount > 0) {
        showToast('⚠️ No podés desconectarte si tenés pedidos en curso', 'warning');
        return;
      }
      showConfirm({
        title: '¿Desconectarse?',
        message: 'Dejarás de recibir notificaciones de nuevos pedidos.',
        confirmText: 'Sí, desconectar',
        onConfirm: () => {
          closeModal();
          // Instant optimistic local state update (0ms, no spinner!)
          setState('user', { ...getState().user, isOnline: false, currentSessionId: null, lastActivityAt: null });
          const bar = document.getElementById('session-status-bar-container');
          const latest = getState().user;
          if (bar) {
            bar.innerHTML = renderStatusBar(latest);
            attachStatusBarListeners(latest);
          }
          endSession(user).catch(err => console.error('Background disconnection error:', err));
        }
      });
    } else {
      if (btn.disabled) return;

      // Semáforo de Deuda guard
      const debtLimitEnabled = getState().debtLimitEnabled === true;
      const maxDebtLimit = getState().maxDebtLimit !== undefined ? getState().maxDebtLimit : 15000;
      const debt = currentUser.deliveryDebt || 0;
      
      if (debtLimitEnabled && debt > maxDebtLimit) {
        showModal({
          title: '🚨 Cuenta Suspendida por Deuda',
          content: `
            <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; background: var(--color-bg);">
              <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center;">
                ${icon('shieldAlert', 28)}
              </div>
              <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: var(--color-text-primary);">Límite de Deuda Excedido</h3>
              <p style="margin: 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.55; font-weight: 600;">
                Tu deuda acumulada es de <strong style="color:#ef4444;">${formatPrice(debt)}</strong>, lo cual supera el límite permitido de <strong>${formatPrice(maxDebtLimit)}</strong>.<br><br>
                Para poder conectarte y seguir recibiendo pedidos, debés transferir y subir tu comprobante de pago en el Gestor de Balance.
              </p>
              <button id="modal-suspend-pay-btn" style="width:100%; height:48px; border-radius:14px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:13px; cursor:pointer; text-transform:uppercase; margin-top:8px; box-shadow:0 6px 16px rgba(var(--color-primary-rgb),0.25);">
                Regularizar Ahora
              </button>
            </div>
          `,
          height: 'auto',
          headerBackground: '#E11D48',
          headerTextColor: 'white'
        });
        
        document.getElementById('modal-suspend-pay-btn').onclick = () => {
          closeModal();
          showBalanceManagementModal(currentUser, debt);
        };
        return;
      }
      
      const originalText = btn.innerHTML;

      try {
        // Mandatorio: alias de transferencia configurado para poder recibir pagos y conectarse
        if (!user.transferAlias || !user.transferAlias.trim()) {
          showToast('⚠️ Debes configurar tu ALIAS para recibir transferencias en tu Perfil antes de conectarte.', 'warning');
          return;
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        const isExempt = user.isCanonExempt === true || user.role === 'admin' || user.isAdmin === true;
        const isFirstConnectionToday = !isExempt && user.lastCanonChargeDate !== todayStr;
        const configuredCanonAmount = getState().canonAmount || 2000;

        const modalMessage = isFirstConnectionToday
          ? `Comenzarás a recibir pedidos en tu zona. Se sumarán <b>$${configuredCanonAmount.toLocaleString('es-AR')}</b> de canon diario a tu saldo de comisiones.`
          : 'Comenzarás a recibir pedidos disponibles en tu zona.';

        // Show confirm modal INSTANTLY (0ms latency)
        showConfirm({
          title: '¿Conectarse?',
          message: modalMessage,
          confirmText: 'Sí, conectar',
          onConfirm: () => {
            closeModal();

            // Instant optimistic local state update (0ms, no spinner/loader!)
            const previousUser = getState().user;
            setState('user', { ...previousUser, isOnline: true });
            
            const bar = document.getElementById('session-status-bar-container');
            const latest = getState().user;
            if (bar) {
              bar.innerHTML = renderStatusBar(latest);
              attachStatusBarListeners(latest);
            }

            // Process background checks & session start
            (async () => {
              try {
                // Mandatorio: permisos de notificaciones y ubicación GPS autorizados
                const okPermissions = await ensureDriverPermissions();
                if (!okPermissions) {
                  setState('user', { ...previousUser, isOnline: false });
                  if (bar) {
                    bar.innerHTML = renderStatusBar(getState().user);
                    attachStatusBarListeners(getState().user);
                  }
                  return;
                }

                if (isFirstConnectionToday) {
                  const { doc, setDoc, updateDoc, increment, serverTimestamp, collection, getDoc } = await import('firebase/firestore');
                  const { db } = await import('../firebase.js');

                  const canonDocRef = doc(db, 'delivery_canon_payments', `${user.uid}_${todayStr}`);
                  
                  // Double check in Firestore to absolutely prevent duplicates
                  const canonSnap = await getDoc(canonDocRef);
                  if (canonSnap.exists() && canonSnap.data().amount > 0) {
                    console.log(`[Canon] Already charged for today (${todayStr}) in Firestore. Skipping duplicate charge.`);
                  } else {
                    // 1. Record individual Canon transaction
                    await setDoc(canonDocRef, {
                      driverId: user.uid,
                      driverName: user.displayName || user.name || 'Repartidor',
                      dateStr: todayStr,
                      amount: configuredCanonAmount,
                      settled: false,
                      createdAt: serverTimestamp()
                    }, { merge: true });

                    // 2. Record in delivery_transactions so it appears in the Driver's Balance History
                    const transRef = doc(collection(db, 'delivery_transactions'));
                    await setDoc(transRef, {
                      driverId: user.uid,
                      type: 'canon_charge',
                      amount: configuredCanonAmount,
                      description: `Canon Diario Jornada (${todayStr})`,
                      createdAt: serverTimestamp()
                    });

                    // 3. Add canon amount to deliveryDebt and update lastCanonChargeDate
                    await updateDoc(doc(db, 'users', user.uid), {
                      deliveryDebt: increment(configuredCanonAmount),
                      lastCanonChargeDate: todayStr
                    });

                    showToast(`🛵 Se registraron +$${configuredCanonAmount.toLocaleString('es-AR')} de canon diario en tu saldo de comisiones.`, 'info');
                  }
                }

                await startSession(user);
                
                // Auto open functioning info sheet for the first 3 connections
                const connKey = `gd_delivery_connect_count_${user.uid}`;
                let connCount = parseInt(localStorage.getItem(connKey) || '0', 10);
                if (connCount < 3) {
                  connCount += 1;
                  localStorage.setItem(connKey, connCount.toString());
                  setTimeout(() => {
                    document.getElementById('delivery-contact-support-btn')?.click();
                  }, 600);
                }
              } catch (err) {
                console.error('Login error:', err);
                showToast('Error al conectar', 'error');
                setState('user', { ...previousUser, isOnline: false });
                if (bar) {
                  bar.innerHTML = renderStatusBar(getState().user);
                  attachStatusBarListeners(getState().user);
                }
              }
            })();
          }
        });
      } catch (err) {
        console.error('Error al conectar:', err);
        showToast('Error al conectar repartidor', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
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

    // Unlimited orders per delivery driver: Allow accepting any order or batch freely
    console.log(`[Take Batch] Active count: ${activeCount}. Taking: ${ordersToTakeCount}. Total: ${totalCount}`);

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
          status: (o.isFavor || o.isTrip) ? 'confirmed' : 'accepted',
          acceptedAt: serverTimestamp(),
          estimatedDeliveryTime: estTime,
          queueTargetDriverId: null,
          queueTargetDriverName: null,
          queueOfferedAt: null
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

        // Bind new driver to chat channels
        try {
          const cdRef = doc(db, 'chats', `${o.id}_client-delivery`);
          transaction.set(cdRef, {
            orderId: o.id,
            type: 'client-delivery',
            driverId: user.uid,
            driverName: user.displayName || user.name || 'Repartidor',
            userId: o.userId || null,
            participants: arrayUnion(...[user.uid, o.userId].filter(Boolean))
          }, { merge: true });

          if (o.comercioId) {
            const comdRef = doc(db, 'chats', `${o.id}_commerce-delivery`);
            transaction.set(comdRef, {
              orderId: o.id,
              type: 'commerce-delivery',
              driverId: user.uid,
              driverName: user.displayName || user.name || 'Repartidor',
              comercioId: o.comercioId,
              participants: arrayUnion(...[user.uid, o.comercioId].filter(Boolean))
            }, { merge: true });
          }
        } catch (e) {
          console.warn('[takeBatch] Error updating chat doc in transaction:', e);
        }

        // Add real-time push/in-app notification to the client (if registered user)
        if (o.userId) {
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

            // Global push notification collection write
            const pushRef = doc(collection(db, 'notifications'));
            transaction.set(pushRef, {
              userId: o.userId,
              title: '⚡ ¡Chofer asignado!',
              body: `El chofer está yendo a tu ubicación. Patente: ${userData.vehicleDetails || userData.patente || '---'}`,
              type: 'trip_taken',
              orderId: o.id,
              createdAt: new Date(),
              read: false
            });
          } else {
            // Standard commerce order or favor
            const notifRef = doc(collection(db, 'users', o.userId, 'notifications'));
            transaction.set(notifRef, {
              type: 'order_taken',
              title: '🛵 ¡Repartidor asignado!',
              body: `Tu pedido de ${o.comercioName || 'el comercio'} fue tomado por ${userData.displayName || userData.name || 'un repartidor'} y va en camino.`,
              status: 'unread',
              url: `#/pedido/${o.id}`,
              createdAt: new Date()
            });

            // Global push notification collection write
            const pushRef = doc(collection(db, 'notifications'));
            transaction.set(pushRef, {
              userId: o.userId,
              title: '🛵 ¡Repartidor asignado!',
              body: `Tu pedido de ${o.comercioName || 'el comercio'} fue tomado por ${userData.displayName || userData.name || 'un repartidor'} y va en camino.`,
              type: 'order_taken',
              orderId: o.id,
              createdAt: new Date(),
              read: false
            });
          }
        }
      });

      // Update driver activity
      transaction.update(doc(db, 'users', user.uid), {
        lastActivityAt: serverTimestamp(),
        lastTripAcceptedAt: serverTimestamp(),
        missedOffersCount: 0
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

    showToast('¡Pedido tomado! Abriendo mapa en vivo...', 'success');
    // Automatically switch to active tab
    window.dispatchEvent(new CustomEvent('switch-delivery-tab', { detail: 'active' }));

    // Automatically open the Live GPS Tracking Map for the accepted order
    if (ordersToTake && ordersToTake.length > 0) {
      const targetOrder = ordersToTake[0];
      setTimeout(() => {
        showDeliveryMapModal(targetOrder, ordersToTake);
      }, 350);
    }
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

  // Optimistic UI response: Feedback is instant to the rider
  showToast(ids.length > 1 ? 'Pedidos retirados con éxito 🚴' : 'Pedido retirado con éxito 🚴', 'success');

  // Asynchronous background execution (does not block UI)
  (async () => {
    try {
      let lat = window.lastRiderPos?.lat || null;
      let lng = window.lastRiderPos?.lng || null;

      if (!lat && navigator.geolocation) {
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

      const batch = writeBatch(db);
      ids.forEach(id => {
        batch.update(doc(db, 'orders', id), updates);
      });
      await batch.commit();
      
      // Background non-blocking notification to users
      Promise.all(ids.map(async id => {
        try {
          const orderSnap = await getDoc(doc(db, 'orders', id));
          if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            if (orderData.userId) {
              const isEncomienda = orderData.favorType === 'encomienda' || (orderData.isFavor && orderData.favorType === 'encomienda');
              const codeStr = (orderData.verificationCode && !isEncomienda) ? ` Tené listo tu código de entrega: ${orderData.verificationCode}` : '';
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
      }));
    } catch (err) {
      console.warn('Async pickup sync error:', err);
    }
  })();
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
        <img src="/logo-pwa.png" alt="Go! Delivery" onerror="this.onerror=null; this.src='/logo.png';" style="width: 86px; height: 86px; border-radius: 50%; object-fit: cover; filter: drop-shadow(0 6px 15px rgba(0, 0, 0, 0.15)); animation: bounceLogo 2.2s infinite ease-in-out;">
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
  
  // 0. Optimistic local update: remove delivered orders from route sheet immediately (0ms delay)
  if (window.activeOrdersList && Array.isArray(window.activeOrdersList)) {
    window.activeOrdersList = window.activeOrdersList.filter(o => !ids.includes(o.id));
  }
  
  try {
    // 1. Update order documents to 'completed' FIRST to guarantee they leave active route sheet
    const now = new Date();
    for (const id of ids) {
      try {
        await updateDoc(doc(db, 'orders', id), {
          status: 'completed',
          deliveredAt: serverTimestamp(),
          deliverySessionId: user?.currentSessionId || null
        });
      } catch (uErr) {
        console.warn(`[markAsDelivered] Direct updateDoc notice for order ${id}:`, uErr);
      }
    }

    // 2. Fetch the orders for rewards calculation & UI display
    let orders = [];
    try {
      const q = query(collection(db, 'orders'), where('__name__', 'in', ids));
      const snap = await getDocs(q);
      orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[markAsDelivered] Error fetching orders for rewards:', e);
      orders = ids.map(id => ({ id, status: 'completed' }));
    }

    const totalAppFee = orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
    if (totalAppFee > 0) {
      const currentLocalUser = getState().user || {};
      const newDebt = (currentLocalUser.deliveryDebt || 0) + totalAppFee;
      setState('user', { ...currentLocalUser, deliveryDebt: newDebt });
    }

    // 3. Process rewards in background batch (isolated so rewards error never blocks delivery)
    setTimeout(async () => {
      try {
        const customerUids = [...new Set(orders.map(o => o.userId).filter(Boolean))];
        const customerDataMap = {};
        for (const uid of customerUids) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) {
            customerDataMap[uid] = userSnap.data();
          }
        }
        const rewardsBatch = writeBatch(db);
        let rewardsCount = 0;
        for (const id of ids) {
          const orderData = orders.find(o => o.id === id);
          if (orderData?.userId && customerDataMap[orderData.userId]) {
            const { processOrderCompletionRewards } = await import('../utils/rewards.js');
            await processOrderCompletionRewards(rewardsBatch, orderData.userId, customerDataMap[orderData.userId], id);
            rewardsCount++;
          }
        }
        if (rewardsCount > 0) {
          await rewardsBatch.commit();
        }
      } catch (rErr) {
        console.warn('[markAsDelivered] Rewards background processing notice:', rErr);
      }
    }, 50);

    // 4. Trigger Success Celebration Modal
    showSuccessCelebration(orders, () => {
      showCustomerRatingModal(orders);
    });
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
    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return;
    const o = orderSnap.data();
    if (o.driverId) return;

    // Los pedidos gastronómicos/comercio solo se ofrecen cuando pasan a estar en estado "listo"
    if (!o.isFavor && !o.isTrip && o.status !== 'ready') {
      return;
    }

    const now = Date.now() + (getState().serverTimeOffset || 0);
    const offeredAt = o.queueOfferedAt 
      ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime())
      : null;

    // GUARD 1: Si la oferta actual está dirigida y tiene menos de 28s de emitida, NO ROTAR.
    // Esto evita que relojes desfasados salten ofertas activas a los pocos segundos.
    if (o.queueTargetDriverId && offeredAt && (now - offeredAt < 28000)) {
      return;
    }

    const prevTargetDriverId = o.queueTargetDriverId || null;
    let manualRejected = [...(o.manuallyRejectedDrivers || [])];
    let offeredDrivers = [...(o.queueOfferedDrivers || o.queueRejectedDrivers || [])];

    if (prevTargetDriverId && !offeredDrivers.includes(prevTargetDriverId)) {
      offeredDrivers.push(prevTargetDriverId);
    }

    // Direct assignment override from Admin
    let nextDriverId = null;
    let nextDriverName = null;

    const targetDirectUid = o.directDriverUid || o.preferredDriverUid;
    if (targetDirectUid && targetDirectUid !== 'rotation' && !manualRejected.includes(targetDirectUid) && !offeredDrivers.includes(targetDirectUid)) {
      const directDriverSnap = await getDoc(doc(db, 'users', targetDirectUid));
      if (directDriverSnap.exists()) {
        const dData = directDriverSnap.data();
        nextDriverId = targetDirectUid;
        nextDriverName = dData.displayName || dData.name || 'Repartidor';
        console.log(`[Queue] Asignación directa prioritaria de admin a: ${nextDriverName} (${nextDriverId})`);
      }
    }

    if (!nextDriverId) {
      // Fetch all online drivers
      const usersSnap = await getDocs(collection(db, 'users'));
      const onlineDrivers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => (u.isDelivery === true || u.role === 'delivery' || u.role === 'driver' || u.role === 'chofer') && u.isOnline === true);

      if (onlineDrivers.length === 0) return;

      // 1. Filtrar repartidores en línea que aún NO han recibido la oferta en esta ronda
      let candidates = onlineDrivers.filter(d => !offeredDrivers.includes(d.id) && !manualRejected.includes(d.id));

      if (candidates.length === 0) {
        // Ronda completada para todos los repartidores. Iniciar nueva ronda excluyendo los que rechazaron manualmente.
        const nonManualRejectingDrivers = onlineDrivers.filter(d => !manualRejected.includes(d.id));
        if (nonManualRejectingDrivers.length > 0) {
          console.log(`[Queue] Ronda de ofertas completada. Reiniciando ciclo secuencial para ${nonManualRejectingDrivers.length} repartidores.`);
          offeredDrivers = [];
          candidates = nonManualRejectingDrivers;
        } else {
          console.log(`[Queue] Todos los repartidores en línea rechazaron manualmente el pedido.`);
          offeredDrivers = [];
          candidates = onlineDrivers;
        }
      }

      const nextDriver = candidates.length > 0 ? candidates[0] : null;
      if (nextDriver) {
        nextDriverId = nextDriver.id;
        nextDriverName = nextDriver.name || nextDriver.displayName || 'Repartidor';
        if (!offeredDrivers.includes(nextDriverId)) {
          offeredDrivers.push(nextDriverId);
        }
      }
    }

    await runTransaction(db, async (transaction) => {
      const freshSnap = await transaction.get(orderRef);
      if (!freshSnap.exists()) return;
      const fresh = freshSnap.data();
      if (fresh.driverId) throw new Error('already_assigned');

      const freshOfferedAt = fresh.queueOfferedAt 
        ? (fresh.queueOfferedAt.toMillis ? fresh.queueOfferedAt.toMillis() : new Date(fresh.queueOfferedAt).getTime())
        : null;
      const freshNow = Date.now() + (getState().serverTimeOffset || 0);

      // GUARD 2: Candado dentro de la transacción de 28 segundos mínimos de duración por oferta
      if (fresh.queueTargetDriverId && freshOfferedAt && (freshNow - freshOfferedAt < 28000) && fresh.queueTargetDriverId === prevTargetDriverId) {
        throw new Error('offer_still_active');
      }

      const rejectedList = nextDriverId ? offeredDrivers.filter(id => id !== nextDriverId) : offeredDrivers;
      transaction.update(orderRef, {
        queueTargetDriverId: nextDriverId,
        queueTargetDriverName: nextDriverName,
        queueOfferedAt: nextDriverId ? serverTimestamp() : null,
        queueOfferedDrivers: offeredDrivers,
        queueRejectedDrivers: rejectedList,
        manuallyRejectedDrivers: manualRejected,
        isPermanentOffer: null
      });
    });

    console.log(`[Queue] Pedido #${o.orderId || orderId} rotado secuencialmente a: ${nextDriverName || 'Buscando'}`);
  } catch (txErr) {
    if (txErr.message === 'already_assigned' || txErr.message === 'offer_still_active') {
      // Aborto normal por candado de tiempo o pedido ya asignado
    } else {
      console.error('[Queue transaction error]', txErr);
    }
  }
}

export async function renderDailyEarningsWidget(user) {
  if (!user?.uid) return;

  let container = document.getElementById('delivery-earnings-widget');
  if (!container) {
    const tabPills = document.querySelector('.tab-pills');
    if (tabPills && tabPills.parentNode) {
      container = document.createElement('div');
      container.id = 'delivery-earnings-widget';
      tabPills.parentNode.insertBefore(container, tabPills);
    } else {
      const scrollArea = document.getElementById('delivery-scroll-area') || document.querySelector('.delivery-panel-page');
      if (!scrollArea) return;
      container = document.createElement('div');
      container.id = 'delivery-earnings-widget';
      scrollArea.prepend(container);
    }
  }

  const state = getState();
  const nightConfig = state.nightSurchargeConfig || { enabled: true, start: '00:00', end: '06:00', type: 'fixed', value: 0 };
  const incentiveConfig = state.driverIncentiveConfig;

  const isNightActive = isScheduleActive(nightConfig);
  const isRainActive = state.isRaining === true;
  const isIncentiveActive = isScheduleActive(incentiveConfig);

  let activeBadgesHtml = '';
  if (isNightActive) {
    const start = nightConfig.start || '00:00';
    const end = nightConfig.end || '06:00';
    const val = nightConfig.type === 'percentage' ? `${nightConfig.value || 0}%` : `$${nightConfig.value || 0}`;
    activeBadgesHtml += `
      <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(99, 102, 241, 0.25); border:1px solid rgba(129, 140, 248, 0.5); color:#A5B4FC; padding:6px 12px; border-radius:12px; font-size:11.5px; font-weight:800;">
        <span>🌙</span> Recargo Nocturno (${start} - ${end} hs) ${val !== '$0' && val !== '0%' ? `<span style="background:rgba(255,255,255,0.2); padding:1px 6px; border-radius:6px; font-size:10.5px; font-weight:900; color:white;">+${val}</span>` : ''}
      </div>
    `;
  }
  if (isRainActive) {
    const rainVal = state.deliveryRainSurcharge || 300;
    activeBadgesHtml += `
      <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(14, 165, 233, 0.25); border:1px solid rgba(56, 189, 248, 0.5); color:#38BDF8; padding:6px 12px; border-radius:12px; font-size:11.5px; font-weight:800;">
        <span>🌧️</span> Recargo Lluvia <span style="background:rgba(255,255,255,0.2); padding:1px 6px; border-radius:6px; font-size:10.5px; font-weight:900; color:white;">+${formatPrice(rainVal)}</span>
      </div>
    `;
  }
  if (isIncentiveActive) {
    const incVal = incentiveConfig.type === 'percentage' ? `${incentiveConfig.value || 0}%` : `$${incentiveConfig.value || 0}`;
    activeBadgesHtml += `
      <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(245, 158, 11, 0.25); border:1px solid rgba(251, 191, 36, 0.5); color:#FBBF24; padding:6px 12px; border-radius:12px; font-size:11.5px; font-weight:800;">
        <span>🚀</span> Incentivo Extra <span style="background:rgba(255,255,255,0.2); padding:1px 6px; border-radius:6px; font-size:10.5px; font-weight:900; color:white;">+${incVal}</span>
      </div>
    `;
  }

  const renderFrame = (todayTotal = 0, todayCount = 0) => {
    const avgEarnings = todayCount > 0 ? (todayTotal / todayCount) : 0;
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); border-radius: 20px; padding: 18px 20px; color: white; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(15,23,42,0.15); border: 1px solid rgba(255,255,255,0.08); position: relative; overflow: hidden;">
        <div style="position: absolute; right: -20px; top: -20px; width: 100px; height: 100px; background: rgba(34, 197, 94, 0.12); border-radius: 50%; blur: 20px; pointer-events: none;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: rgba(34, 197, 94, 0.2); color: #22C55E; border-radius: 8px; font-size: 14px;">⚡</span>
            <span style="font-size: 11.5px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: #94A3B8;">Jornada de Hoy</span>
          </div>
          <span style="font-size: 10.5px; font-weight: 800; background: rgba(34, 197, 94, 0.15); color: #4ADE80; padding: 3px 8px; border-radius: 20px; border: 1px solid rgba(74, 222, 128, 0.25);">
            En Vivo
          </span>
        </div>

        ${activeBadgesHtml ? `
          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.08);">
            ${activeBadgesHtml}
          </div>
        ` : ''}

        <div style="display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 12px; align-items: center;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #94A3B8; margin-bottom: 2px;">Ganancia Hoy</div>
            <div style="font-size: 22px; font-weight: 950; color: #22C55E; font-family: var(--font-display); letter-spacing: -0.02em;">
              ${formatPrice(todayTotal)}
            </div>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.1); padding-left: 12px;">
            <div style="font-size: 11px; font-weight: 700; color: #94A3B8; margin-bottom: 2px;">Entregas</div>
            <div style="font-size: 18px; font-weight: 900; color: #F8FAFC;">
              ${todayCount} <span style="font-size: 11px; font-weight: 700; color: #64748B;">pedidos</span>
            </div>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.1); padding-left: 12px;">
            <div style="font-size: 11px; font-weight: 700; color: #94A3B8; margin-bottom: 2px;">Promedio</div>
            <div style="font-size: 16px; font-weight: 900; color: #F8FAFC;">
              ${formatPrice(avgEarnings)}
            </div>
          </div>
        </div>

        <!-- Ver Pedidos Button -->
        ${todayCount > 0 ? `
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.07);">
          <button id="view-today-orders-btn" style="width:100%; height:36px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.07); color:rgba(255,255,255,0.8); font-size:11px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s; letter-spacing:0.3px; text-transform:uppercase;" onmouseover="this.style.background='rgba(255,255,255,0.13)'" onmouseout="this.style.background='rgba(255,255,255,0.07)'">
            ${icon('list', 14)} Ver pedidos de hoy (${todayCount})
          </button>
        </div>` : ''}
      </div>
    `;

    if (todayCount > 0) {
      document.getElementById('view-today-orders-btn')?.addEventListener('click', () => {
        window._todayOrdersList && openTodayOrdersSheet(window._todayOrdersList);
      });
    }
  };

  renderFrame(0, 0);

  try {
    const { collection, query, where, getDocs } = await import('firebase/firestore');
    const { db } = await import('../firebase.js');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const q = query(
      collection(db, 'orders'),
      where('driverId', '==', user.uid)
    );

    const snap = await getDocs(q);
    let todayTotal = 0;
    let todayCount = 0;
    const todayOrders = [];

    snap.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (data.status === 'delivered' || data.status === 'completed') {
        const timestamp = data.deliveredAt || data.completedAt || data.createdAt;
        if (timestamp) {
          const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
          if (date >= startOfDay) {
            todayCount++;
            const earnings = getOrderDriverEarnings(data) || 0;
            todayTotal += earnings;
            todayOrders.push({ id: docSnap.id, ...data, _earnings: earnings, _date: date });
          }
        }
      }
    });

    // Sort newest first
    todayOrders.sort((a, b) => b._date - a._date);
    window._todayOrdersList = todayOrders;

    renderFrame(todayTotal, todayCount);
  } catch (err) {
    console.warn('Error loading daily earnings widget:', err);
  }
}

function openTodayOrdersSheet(orders) {
  const existing = document.getElementById('today-orders-sheet');
  if (existing) existing.remove();

  const ordersHtml = orders.map((o, i) => {
    const timeStr = o._date ? o._date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const appFee = o.appUsageFee || o.appFee || o.deliveryFee || 0;
    const coupon = o.couponCode || o.appliedCoupon || null;
    const earnings = o._earnings || 0;
    const orderNum = o.orderNumber || o.id?.slice(-4)?.toUpperCase() || `#${i+1}`;

    return `
      <div style="background: var(--color-bg-secondary); border-radius: 14px; padding: 13px 15px; border: 1px solid var(--color-border-light); display: flex; flex-direction: column; gap: 8px;">
        <!-- Header row -->
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 30px; height: 30px; border-radius: 9px; background: rgba(225,29,72,0.1); display: flex; align-items: center; justify-content: center; color: var(--color-primary); font-size: 14px;">🛵</div>
            <div>
              <div style="font-size: 12px; font-weight: 900; color: var(--color-text-primary);">Pedido #${orderNum}</div>
              <div style="font-size: 10px; color: var(--color-text-tertiary); font-weight: 600;">${timeStr} · ${o.commerceName || 'Comercio'}</div>
            </div>
          </div>
          <div style="font-size: 16px; font-weight: 950; color: #22c55e; letter-spacing: -0.5px;">${formatPrice(earnings)}</div>
        </div>
        <!-- Fee row -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 10px; font-weight: 800; background: rgba(239,68,68,0.1); color: #ef4444; padding: 3px 8px; border-radius: 20px; border: 1px solid rgba(239,68,68,0.2);">Tarifa App: ${formatPrice(appFee)}</span>
          ${coupon ? `<span style="font-size: 10px; font-weight: 800; background: rgba(168,85,247,0.1); color: #a855f7; padding: 3px 8px; border-radius: 20px; border: 1px solid rgba(168,85,247,0.2);">🎟️ ${coupon}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'today-orders-sheet';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,0.5); display:flex; flex-direction:column; justify-content:flex-end; opacity:0; transition:opacity 0.3s ease;';
  overlay.innerHTML = `
    <div id="today-orders-sheet-card" style="background:var(--color-bg); border-top-left-radius:24px; border-top-right-radius:24px; display:flex; flex-direction:column; max-height:85vh; box-shadow:0 -8px 40px rgba(0,0,0,0.2); transform:translateY(100%); transition:transform 0.35s cubic-bezier(0.16,1,0.3,1);">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #dc2626 0%, #991b1b 100%); border-top-left-radius:24px; border-top-right-radius:24px; padding:18px 20px; position:relative; overflow:hidden; flex-shrink:0;">
        <div style="position:absolute; top:-20px; right:-20px; width:80px; height:80px; background:rgba(255,255,255,0.08); border-radius:50%;"></div>
        <div style="position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);"></div>
        <div style="display:flex; align-items:center; justify-content:space-between; position:relative; z-index:1;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; background:rgba(255,255,255,0.15); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px;">📦</div>
            <div>
              <div style="font-size:9.5px; font-weight:900; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:1px; margin-bottom:1px;">Jornada de Hoy</div>
              <div style="font-size:16px; font-weight:950; color:white; letter-spacing:-0.5px;">${orders.length} Pedido${orders.length !== 1 ? 's' : ''} Entregado${orders.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <button id="today-orders-close-btn" style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.2); color:white; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1;">×</button>
        </div>
      </div>
      <!-- Scrollable list -->
      <div style="overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; -webkit-overflow-scrolling:touch;">
        ${ordersHtml || '<div style="text-align:center; color:var(--color-text-tertiary); font-size:13px; padding:20px;">No hay pedidos entregados hoy</div>'}
        <div style="height: env(safe-area-inset-bottom, 12px);"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.opacity = '1';
    const card = document.getElementById('today-orders-sheet-card');
    if (card) card.style.transform = 'translateY(0)';
  }, 10);

  const closeSheet = () => {
    const card = document.getElementById('today-orders-sheet-card');
    if (card) card.style.transform = 'translateY(100%)';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 350);
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  document.getElementById('today-orders-close-btn')?.addEventListener('click', closeSheet);
}


let exclusiveModalCountdownInterval = null;

export function hideExclusiveOfferOverlay() {
  const existing = document.getElementById('exclusive-offer-fullscreen-overlay');
  if (existing) {
    existing.remove();
  }
  if (exclusiveModalCountdownInterval) {
    clearInterval(exclusiveModalCountdownInterval);
    exclusiveModalCountdownInterval = null;
  }
}

export function showExclusiveOfferOverlay(batch, user) {
  if (document.getElementById('exclusive-offer-fullscreen-overlay')) {
    return;
  }

  const orderObj = batch.isBundle ? batch.orders[0] : batch.order;
  if (!orderObj) return;

  const isFavor = batch.order?.isFavor;
  const isTrip = batch.order?.isTrip;
  
  let originTitle = batch.isBundle ? (batch.comercioName || 'Comercio') : (isTrip ? 'Pasajero / Punto de Inicio' : (isFavor ? (batch.order.favorTypeLabel || 'Favor') : (batch.order.comercioName || 'Comercio')));
  let destAddress = batch.isBundle ? batch.orders.map(o => o.destinationAddress || o.address || o.deliveryAddress).join(' • ') : (batch.order.destinationAddress || batch.order.address || batch.order.deliveryAddress || 'Dirección de entrega');
  let driverEarnings = getOrderDriverEarnings(batch);
  let totalToCollect = batch.total || 0;

  const offeredAt = orderObj?.queueOfferedAt ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) : (Date.now() + (getState().serverTimeOffset || 0));
  const calcRemaining = () => {
    const now = Date.now() + (getState().serverTimeOffset || 0);
    const elapsed = Math.floor((now - offeredAt) / 1000);
    return Math.max(0, 60 - elapsed);
  };

  const overlay = document.createElement('div');
  overlay.id = 'exclusive-offer-fullscreen-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: #F8FAFC;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-top: max(24px, env(safe-area-inset-top));
    padding-bottom: max(24px, env(safe-area-inset-bottom));
    padding-left: max(18px, env(safe-area-inset-left));
    padding-right: max(18px, env(safe-area-inset-right));
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow-y: auto;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <!-- Top Header -->
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 12px;">
      <div style="display: flex; align-items: center; gap: 8px; background: rgba(227, 0, 27, 0.08); border: 1.5px solid rgba(227, 0, 27, 0.25); padding: 8px 16px; border-radius: 99px;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #E3001B; box-shadow: 0 0 10px rgba(227, 0, 27, 0.5);"></span>
        <span style="font-size: 12.5px; font-weight: 900; color: #E3001B; text-transform: uppercase; letter-spacing: 0.05em;">🚨 ¡NUEVO PEDIDO EXCLUSIVO!</span>
      </div>
      
      <div style="background: #0F172A; color: white; border: 1px solid #1E293B; padding: 8px 16px; border-radius: 99px; font-weight: 900; font-size: 15px; font-variant-numeric: tabular-nums; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);">
        ⏳ <span id="exclusive-modal-countdown">${calcRemaining()}</span>s
      </div>
    </div>

    <!-- Main Content Body -->
    <div style="margin: 10px 0; display: flex; flex-direction: column; gap: 16px; width: 100%; flex: 1; justify-content: center;">
      
      <!-- Earnings Card -->
      <div style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 28px; padding: 24px; text-align: center; color: white; box-shadow: 0 14px 35px rgba(16, 185, 129, 0.3);">
        <div style="font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9; margin-bottom: 4px;">Tu Ganancia Estimada</div>
        <div style="font-size: 44px; font-weight: 950; letter-spacing: -1.5px; text-shadow: 0 2px 8px rgba(0,0,0,0.12);">${formatPrice(driverEarnings)}</div>
        <div style="font-size: 13px; opacity: 0.92; margin-top: 6px; font-weight: 700;">Cobro total al cliente: ${formatPrice(totalToCollect)}</div>
      </div>

      <!-- Route Info Card -->
      <div style="background: #FFFFFF; border: 1.5px solid #E2E8F0; border-radius: 26px; padding: 20px; color: #0F172A; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.04);">
        <!-- Origin -->
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div style="background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 16px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: #2563EB; font-size: 22px; flex-shrink: 0;">🏬</div>
          <div style="flex: 1;">
            <div style="font-size: 11px; font-weight: 850; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em;">Retiro (Origen)</div>
            <div style="font-size: 17px; font-weight: 900; color: #0F172A; margin-top: 2px; line-height: 1.25;">${originTitle}</div>
          </div>
        </div>

        <div style="width: 100%; height: 1px; background: #F1F5F9;"></div>

        <!-- Destination -->
        <div style="display: flex; gap: 14px; align-items: flex-start;">
          <div style="background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.25); border-radius: 16px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: #16A34A; font-size: 22px; flex-shrink: 0;">📍</div>
          <div style="flex: 1;">
            <div style="font-size: 11px; font-weight: 850; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em;">Entrega (Destino)</div>
            <div style="font-size: 15.5px; font-weight: 850; color: #1E293B; margin-top: 2px; line-height: 1.35;">${destAddress}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; margin-top: 12px;">
      <button id="fullscreen-accept-offer-btn" style="width: 100%; height: 64px; border-radius: 22px; background: #22C55E; color: white; font-size: 19px; font-weight: 950; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 10px 30px rgba(34, 197, 94, 0.4); letter-spacing: 0.02em;">
        ⚡ ACEPTAR PEDIDO AHORA
      </button>
      
      <button id="fullscreen-reject-offer-btn" style="width: 100%; height: 48px; border-radius: 18px; background: #F1F5F9; color: #475569; font-size: 14px; font-weight: 850; border: 1.5px solid #E2E8F0; cursor: pointer;">
        Silenciar / Ignorar
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  if (exclusiveModalCountdownInterval) clearInterval(exclusiveModalCountdownInterval);
  exclusiveModalCountdownInterval = setInterval(() => {
    const rem = calcRemaining();
    const cdEl = document.getElementById('exclusive-modal-countdown');
    if (cdEl) cdEl.textContent = rem;
    if (rem <= 0) {
      const orderIdToRotate = orderObj.id || batch.id;
      updateDispatchQueue(orderIdToRotate).catch(console.warn);
      playExclusiveOfferAlert();
    }
  }, 1000);

  const acceptBtn = overlay.querySelector('#fullscreen-accept-offer-btn');
  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      // Show professional fullscreen loading animation over the modal
      let loader = overlay.querySelector('#offer-accept-loader-screen');
      if (!loader) {
        loader = document.createElement('div');
        loader.id = 'offer-accept-loader-screen';
        loader.style.cssText = `
          position: absolute;
          inset: 0;
          background: rgba(255, 255, 255, 0.97);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 24px;
          text-align: center;
        `;
        loader.innerHTML = `
          <div style="width: 60px; height: 60px; border: 5px solid #E2E8F0; border-top-color: #22C55E; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 20px;"></div>
          <h3 style="font-size: 21px; font-weight: 950; color: #0F172A; margin: 0 0 6px 0;">¡Asignando Pedido!</h3>
          <p style="font-size: 14px; color: #64748B; margin: 0; font-weight: 600;">Cargando tu hoja de ruta y mapa de entrega...</p>
        `;
        overlay.appendChild(loader);
      }

      try {
        await takeBatch(batch.id, user, batch, acceptBtn);
      } catch (err) {
        console.error('[Accept batch error]', err);
        if (loader) loader.remove();
        showToast(err.message || 'No se pudo aceptar el pedido.', 'error');
        return;
      }

      // Hide alert & overlay only once assignment is completed and active order route is loaded
      stopExclusiveOfferAlert();
      hideExclusiveOfferOverlay();
    };
  }

  const rejectBtn = overlay.querySelector('#fullscreen-reject-offer-btn');
  if (rejectBtn) {
    rejectBtn.onclick = () => {
      stopExclusiveOfferAlert();
      hideExclusiveOfferOverlay();
    };
  }
}

export function showPausedSessionModal(user) {
  if (document.getElementById('paused-session-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'paused-session-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <div style="background: var(--color-bg-card, #1e293b); border: 2px solid #ef4444; border-radius: 32px; padding: 32px 24px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(239, 68, 68, 0.35);">
      <div style="font-size: 56px; margin-bottom: 12px;">🔕</div>
      <h2 style="font-size: 22px; font-weight: 950; color: var(--color-text-primary, #ffffff); margin-bottom: 10px; letter-spacing: -0.5px;">Sesión Pausada por Inactividad</h2>
      <p style="font-size: 14px; color: var(--color-text-secondary, #94a3b8); line-height: 1.55; margin-bottom: 26px;">
        Se pausó tu conexión automáticamente porque ignoraste 2 ofertas consecutivas de pedido.<br><br>
        Tocá a continuación para reanudar tu sesión y volver a recibir ofertas inmediatamente.
      </p>
      <button id="paused-session-reconnect-btn" style="width: 100%; height: 58px; border-radius: 20px; background: #22c55e; color: white; font-size: 17px; font-weight: 950; border: none; cursor: pointer; box-shadow: 0 10px 25px rgba(34, 197, 94, 0.35); text-transform: uppercase; letter-spacing: 0.03em;">
        ⚡ VOLVER A CONECTARME
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#paused-session-reconnect-btn');
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = '⏳ CONECTANDO...';
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          isOnline: true,
          missedOffersCount: 0,
          disconnectedReason: null
        });
        setState('user', { ...getState().user, isOnline: true, missedOffersCount: 0, disconnectedReason: null });
        overlay.remove();
        showToast('¡Sesión reanudada con éxito!', 'success');
      } catch (err) {
        console.error('Error re-connecting:', err);
        btn.disabled = false;
        btn.innerHTML = '⚡ VOLVER A CONECTARME';
        showToast('Error al reconectar. Reintenta.', 'error');
      }
    };
  }
}

export function hidePausedSessionModal() {
  const el = document.getElementById('paused-session-modal-overlay');
  if (el) el.remove();
}

export function playExclusiveOfferAlert() {
  if (window.exclusiveAlertInterval) return;

  const soundUrl = 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3';

  // Use the AudioManager to start a loop of the alert sound
  import('../utils/audio-manager.js').then(({ AudioManager }) => {
    AudioManager.startLoop(soundUrl, 1.0);
    AudioManager.startLoop('/assets/sounds/notification.mp3', 1.0);
  }).catch(err => console.warn('Could not start loop sound:', err));

  // Perform immediate initial strong vibration
  if (navigator.vibrate) {
    navigator.vibrate([600, 200, 600, 200, 600]);
  }

  // Vibrate strongly every 2.5 seconds
  window.exclusiveAlertInterval = setInterval(() => {
    if (navigator.vibrate) {
      navigator.vibrate([600, 200, 600, 200, 600]);
    }
  }, 2500);
}

export function stopExclusiveOfferAlert() {
  const soundUrl = 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3';

  // Stop the audio loop
  import('../utils/audio-manager.js').then(({ AudioManager }) => {
    AudioManager.stopLoop(soundUrl);
    AudioManager.stopLoop('/assets/sounds/notification.mp3');
  }).catch(err => console.warn('Could not stop loop sound:', err));

  // Clear vibration interval
  if (window.exclusiveAlertInterval) {
    clearInterval(window.exclusiveAlertInterval);
    window.exclusiveAlertInterval = null;
  }
  
  // Stop active vibrations
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

export function showCanonPaymentModal(user, dateStr) {
  import('../components/modal.js').then(({ showModal, closeModal }) => {
    const adminPhone = (window.gd_settings && window.gd_settings.whatsappPayments) || '5491123456789';
    const canonAmt = (window.gd_settings && window.gd_settings.canonAmount) || getState().canonAmount || 2000;
    const wpMessage = encodeURIComponent(`Hola! Soy ${user.displayName || 'repartidor'} (${user.uid}). Quisiera abonar/confirmar el canon diario de la jornada ${dateStr} ($${canonAmt.toLocaleString('es-AR')}) para que me habiliten ONLINE.`);
    const wpUrl = `https://wa.me/${adminPhone}?text=${wpMessage}`;

    showModal({
      title: '🛵 Jornada No Habilitada',
      hideHeader: false,
      content: `
        <div style="padding:16px; font-family:var(--font-body); text-align:center;">
          <div style="font-size:42px; margin-bottom:12px;">⚠️</div>
          <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin-bottom:8px; color:var(--color-text-primary);">
            Canon Diario Pendiente (${dateStr})
          </h3>
          <p style="font-size:13.5px; color:var(--color-text-secondary); line-height:1.5; margin-bottom:20px;">
            Tu jornada de hoy no se encuentra habilitada aún por administración. Aboná el canon diario de <strong>$${canonAmt.toLocaleString('es-AR')}</strong> o enviá el comprobante a soporte para activarla.
          </p>
          <div style="background:rgba(225,29,72,0.06); border:1px solid rgba(225,29,72,0.15); border-radius:14px; padding:12px; margin-bottom:20px; font-size:12.5px; color:var(--color-primary); font-weight:700;">
            💬 Contactate con el administrador por WhatsApp para confirmar tu pago y comenzar a recibir pedidos.
          </div>
          <a href="${wpUrl}" target="_blank" class="btn btn-primary btn-block" style="height:52px; border-radius:16px; font-weight:900; font-size:15px; background:#25D366; border:none; color:white; box-shadow:0 6px 20px rgba(37,211,102,0.3); display:flex; align-items:center; justify-content:center; gap:10px; text-decoration:none;">
            <span>Contactar Soporte por WhatsApp</span>
          </a>
        </div>
      `
    });
  });
}


function showStopDetailsBottomSheet(stop) {
  document.getElementById('v5-stop-details-sheet')?.remove();
  document.getElementById('v5-stop-details-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'v5-stop-details-backdrop';
  backdrop.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99998; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); opacity: 0; pointer-events: none; transition: opacity 0.3s ease;";

  const sheet = document.createElement('div');
  sheet.id = 'v5-stop-details-sheet';
  sheet.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; box-shadow: 0 -12px 30px rgba(0,0,0,0.15); z-index: 99999; transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); max-height: 85vh; display: flex; flex-direction: column; padding-bottom: calc(20px + env(safe-area-inset-bottom, 16px));";

  const isPickup = stop.type === 'PICKUP';
  const firstOrder = stop.orders?.[0] || {};
  const totalAmountToPay = stop.orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const totalTips = stop.orders.reduce((sum, o) => sum + (o.tip || 0), 0);
  const totalDeliveryCost = stop.orders.reduce((sum, o) => {
    const baseFee = Math.max(0, (o.deliveryCost || 0) - (o.rainSurcharge || 0));
    return sum + baseFee;
  }, 0);
  const totalAppFee = stop.orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
  const totalPurchaseFee = stop.orders.reduce((sum, o) => sum + (o.purchaseFee || 0), 0);
  const totalRainSurcharge = stop.orders.reduce((sum, o) => sum + (o.rainSurcharge || 0), 0);
  const totalExtraStops = stop.orders.reduce((sum, o) => sum + (o.extraStopsFee || 0), 0);
  const totalDiscount = stop.orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
  const totalCouponDiscount = stop.orders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);

  let itemsHtml = '';
  if (stop.isFavor) {
    const details = firstOrder.details || firstOrder.description || '';
    const parsedStores = parseFavorDetails(details);
    if (parsedStores.length > 0) {
      itemsHtml = parsedStores.map((s, idx) => `
        <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow: var(--shadow-sm); margin-bottom: 10px;">
          <div style="display:flex; flex-direction:column; gap:4px; text-align:left; border-bottom:1px dashed var(--color-border-light); padding-bottom:10px;">
            <span style="font-size:9.5px; font-weight:900; color:#3b82f6; text-transform:uppercase; letter-spacing:0.08em;">Comercio ${idx + 1}</span>
            <div style="font-size:14.5px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; gap:8px;">
              <span style="font-size:16px;">🏪</span> ${s.name}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:4px; text-align:left;">
            <span style="font-size:9.5px; font-weight:900; color:#e11d48; text-transform:uppercase; letter-spacing:0.08em;">Detalle del Pedido</span>
            <div style="font-size:14px; font-weight:700; color:var(--color-text-secondary); line-height:1.4; display:flex; align-items:flex-start; gap:8px;">
              <span style="font-size:16px; margin-top:2px;">📦</span> 
              <div style="flex:1; white-space: pre-wrap;">${s.items}</div>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      itemsHtml = `
        <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:18px; padding:16px; text-align:left;">
          <div style="font-size:14px; font-weight:700; color:var(--color-text-secondary); line-height:1.4; white-space: pre-wrap;">
            ${details}
          </div>
        </div>
      `;
    }
  } else {
    itemsHtml = stop.orders.map(o => `
      <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:800; color:var(--color-text-primary);">
          <span>Pedido #${o.orderId || '---'}</span>
          <span>$${Math.round(o.subtotal || 0).toLocaleString('es-AR')}</span>
        </div>
        ${o.items && o.items.length > 0 ? `
          <div style="font-size:12px; color:var(--color-text-secondary); padding-left:8px; border-left:2.5px solid var(--color-primary); display:flex; flex-direction:column; gap:4px;">
            ${o.items.map(item => `
              <div><span style="color:var(--color-primary); font-weight:800;">${item.qty || 1}x</span> ${item.name}</div>
            `).join('')}
          </div>
        ` : `<div style="font-size:11.5px; color:var(--color-text-tertiary); font-style:italic;">Pedido de Comercio</div>`}
      </div>
    `).join('');
  }

  const orderNumber = firstOrder.orderId || '---';
  const isEncomienda = firstOrder.favorType === 'mandado';
  
  const headerBg = isEncomienda 
    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
    : 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)';
  const headerIconSrc = isEncomienda ? '/go-pickup-point.png' : '/go-bag.png';
  const headerShadow = isEncomienda 
    ? '0 4px 15px rgba(5, 150, 105, 0.15)' 
    : '0 4px 15px rgba(190, 18, 60, 0.15)';

  sheet.innerHTML = `
    <div style="background: ${headerBg}; padding: 18px 24px; border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; color: white; position: relative; box-shadow: ${headerShadow};">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${headerIconSrc}" style="width: 48px; height: 48px; object-fit: contain; display: block; flex-shrink: 0; margin-right: 4px;" />
        <div style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
          <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: white; letter-spacing: -0.01em;">Desglose del Importe</h3>
          <span style="font-size: 12px; color: rgba(255,255,255,0.85); font-weight: 600;">Detalle transparente del pedido #${orderNumber}</span>
        </div>
      </div>
      <button id="v5-stop-details-close" style="background: rgba(255,255,255,0.15); border: none; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: white; transition: background 0.2s;">
        ${icon('close', 16)}
      </button>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; flex-direction: column; gap: 6px; text-align: left;">
        <span style="font-size: 10px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px;">${isPickup ? 'Origen / Retiro' : 'Destino / Entrega'}</span>
        <strong style="font-size: 15px; color: var(--color-text-primary); font-weight: 800;">${isPickup ? (stop.comercioName || 'Comercio') : stop.address}</strong>
        ${(!isPickup && firstOrder.addressNotes) ? `<span style="font-size: 12.5px; color:#d97706; font-weight:700;">⚠️ Ref: ${firstOrder.addressNotes}</span>` : ''}
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
        <span style="font-size: 10px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px;">Productos / Contenido</span>
        ${itemsHtml}
      </div>

      <div style="background: var(--color-surface); border-radius: 24px; padding: 20px; border: 1.5px solid var(--color-border-light); display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-sm);">
        <div style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; text-align: left;">Desglose de Cobro</div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
          <span>Costo del Mandado / Productos:</span>
          ${totalAmountToPay === 0 ? `
            <span style="background: #fef3c7; color: #d97706; font-size: 10px; font-weight: 900; padding: 4px 8px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #fde68a;">PENDIENTE</span>
          ` : `
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalAmountToPay).toLocaleString('es-AR')}</span>
          `}
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
          <span>Costo de Envío / Reparto:</span>
          <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalDeliveryCost).toLocaleString('es-AR')}</span>
        </div>
        
        ${totalPurchaseFee > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Gestión de Compra / Trámite:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalPurchaseFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalRainSurcharge > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Recargo por Lluvia:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalRainSurcharge).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalExtraStops > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Paradas Extra:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalExtraStops).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalTips > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: #10b981;">
            <span>Propina al Repartidor:</span>
            <span style="font-weight: 800;">+ $${Math.round(totalTips).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalAppFee > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Tarifa de Servicio:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalAppFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalDiscount > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 750; color: var(--color-success);">
            <span>Descuento GoPoints:</span>
            <span>- $${Math.round(totalDiscount).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalCouponDiscount > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 750; color: #a855f7;">
            <span>Descuento Cupón:</span>
            <span>- $${Math.round(totalCouponDiscount).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 15.5px; font-weight: 900; padding-top: 14px; border-top: 2px dashed var(--color-border-light); margin-top: 4px;">
          <span style="color: var(--color-text-primary); letter-spacing: -0.01em;">${isPickup ? 'TOTAL A ABONAR:' : 'TOTAL FINAL:'}</span>
          <span style="color: #e11d48; font-size: 21px; font-weight: 950; letter-spacing: -0.02em;">$${Math.round(isPickup ? (stop.amountToPay || 0) : stop.orders.reduce((s, o) => s + (o.total || o.totalAmount || 0), 0)).toLocaleString('es-AR')}</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    backdrop.style.pointerEvents = 'auto';
    sheet.style.transform = 'translateY(0)';
  });

  const close = () => {
    backdrop.style.opacity = '0';
    backdrop.style.pointerEvents = 'none';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 350);
  };

  backdrop.onclick = close;
  sheet.querySelector('#v5-stop-details-close').onclick = close;
}
