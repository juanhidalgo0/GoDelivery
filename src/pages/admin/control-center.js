// GoDelivery — Premium Operations Control Center (Centro de Control Unificado)
import { getState } from '../../state.js';
import { db } from '../../firebase.js';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { showToast } from '../../components/toast.js';

let unsubOrders = null;
let unsubSupport = null;
let unsubDrivers = null;

let allOrders = [];
let allSupportChats = [];
let allOnlineDrivers = [];

let orderFilter = 'all'; // 'all' | 'app' | 'whatsapp' | 'active'
let supportFilter = 'all'; // 'all' | 'whatsapp' | 'app'

const STATUS_CONFIG = {
  pending: { label: 'PENDIENTE', color: '#FFA500', bg: 'rgba(255, 165, 0, 0.1)' },
  confirmed: { label: 'PREPARANDO', color: '#3498DB', bg: 'rgba(52, 152, 219, 0.1)' },
  preparing: { label: 'PREPARANDO', color: '#3498DB', bg: 'rgba(52, 152, 219, 0.1)' },
  ready: { label: 'LISTO (ESPERANDO MOTOCADETE)', color: '#0d9488', bg: 'rgba(13, 148, 136, 0.1)' },
  accepted: { label: 'ACEPTADO', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
  on_way: { label: 'EN CAMINO', color: '#9B59B6', bg: 'rgba(155, 89, 182, 0.1)' },
  delivering: { label: 'EN CAMINO', color: '#9B59B6', bg: 'rgba(155, 89, 182, 0.1)' },
  completed: { label: 'ENTREGADO', color: '#27AE60', bg: 'rgba(39, 174, 96, 0.1)' },
  cancelled: { label: 'CANCELADO', color: '#E74C3C', bg: 'rgba(231, 76, 60, 0.1)' }
};

function getStatusKey(status) {
  if (!status) return 'pending';
  const s = status.toLowerCase();
  if (s === 'delivered') return 'completed';
  if (s === 'en_camino') return 'on_way';
  return s;
}

export async function renderAdminControlCenter(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative ? 'var(--status-bar-height, 24px)' : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  // Ensure window.showOrderDetail is loaded
  if (!window.showOrderDetail) {
    import('./orders.js').then(m => {
      if (m.renderAdminOrders) {
        // Trigger background load to attach window.showOrderDetail
      }
    });
  }

  content.innerHTML = `
    <style>
      .cc-column-card {
        background: var(--color-surface);
        border: 1.5px solid var(--color-border-light);
        border-radius: 28px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.04);
        display: flex;
        flex-direction: column;
        height: calc(100vh - 150px);
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cc-column-header {
        padding: 18px 22px;
        border-bottom: 1px solid var(--color-border-light);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--color-bg-secondary);
      }
      .cc-column-body {
        flex: 1;
        overflow-y: auto;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        -webkit-overflow-scrolling: touch;
      }
      .cc-badge-count {
        background: var(--color-primary);
        color: white;
        font-size: 11.5px;
        font-weight: 900;
        padding: 3px 10px;
        border-radius: 100px;
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.25);
      }
      
      /* Premium order-card-v4 matching Registro de Ventas */
      .order-card-v4 {
        background: var(--color-surface);
        border-radius: 24px;
        padding: 0 20px 18px 20px;
        border: 1.5px solid var(--color-border-light);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
        position: relative;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
        overflow: hidden;
      }
      .order-card-v4:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.08);
      }
      .s-pill-v4 {
        background: var(--st-bg);
        color: var(--st-color);
        font-weight: 900;
        font-size: 10px;
        padding: 3px 10px;
        border-radius: 100px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        display: inline-block;
      }

      @media (max-width: 1100px) {
        .cc-grid {
          grid-template-columns: 1fr !important;
        }
        .cc-column-card {
          height: 650px !important;
        }
      }
    </style>

    <div class="admin-page page-enter" style="display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--color-bg); overflow: hidden; position: relative;">
      
      <!-- Top Premium Live Operating Bar (Header) -->
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; padding: ${topPadding} 22px 16px 22px; border-bottom-left-radius: 32px; border-bottom-right-radius: 32px; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.35); z-index: 100; flex-shrink: 0;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <button id="cc-back-btn" style="background: rgba(255,255,255,0.15); border: none; color: white; border-radius: 14px; padding: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
              ${icon('chevronLeft', 20)}
            </button>
            <div>
              <div style="font-weight: 950; font-size: 21px; font-family: var(--font-display); letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px;">
                🎛️ Centro de Control Operativo
              </div>
              <div style="font-size: 12px; opacity: 0.75; font-weight: 600;">Panel Unificado: Pedidos, Soporte y Repartidores en Vivo</div>
            </div>
          </div>

          <!-- Live KPIs & Bot Status Controls -->
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div style="background: rgba(255,255,255,0.08); border-radius: 16px; padding: 8px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid rgba(255,255,255,0.12);">
              <span style="font-size: 13px; font-weight: 850; display: flex; align-items: center; gap: 6px;">
                🛵 <span id="cc-stat-drivers" style="color:#10b981; font-weight:950;">0</span> Motos
              </span>
              <span style="opacity: 0.3;">|</span>
              <span style="font-size: 13px; font-weight: 850; display: flex; align-items: center; gap: 6px;">
                📦 <span id="cc-stat-orders" style="color:#38bdf8; font-weight:950;">0</span> Activos
              </span>
              <span style="opacity: 0.3;">|</span>
              <span style="font-size: 13px; font-weight: 850; display: flex; align-items: center; gap: 6px; color: #f59e0b;">
                💬 <span id="cc-stat-support" style="font-weight:950;">0</span> Consultas
              </span>
            </div>

            <!-- WhatsApp Bot Quick Mode Selector -->
            <div style="display: flex; align-items: center; gap: 6px; background: rgba(37,211,102,0.15); padding: 5px 10px; border-radius: 16px; border: 1px solid rgba(37,211,102,0.35);">
              <span style="font-size: 11px; font-weight: 900; color: #25D366; text-transform: uppercase; letter-spacing:0.04em;">Bot WA:</span>
              <button class="wsp-mode-btn active" data-mode="normal" style="background: #25D366; color: white; border: none; border-radius: 10px; padding: 4px 10px; font-size: 11px; font-weight: 900; cursor: pointer; transition:all 0.2s;">🟢 Normal</button>
              <button class="wsp-mode-btn" data-mode="delay" style="background: rgba(255,255,255,0.15); color: white; border: none; border-radius: 10px; padding: 4px 10px; font-size: 11px; font-weight: 900; cursor: pointer; transition:all 0.2s;">🟡 Alta Demora</button>
              <button class="wsp-mode-btn" data-mode="paused" style="background: rgba(255,255,255,0.15); color: white; border: none; border-radius: 10px; padding: 4px 10px; font-size: 11px; font-weight: 900; cursor: pointer; transition:all 0.2s;">🔴 Pausado</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Main 3-Column Operations Grid -->
      <div style="flex: 1; overflow-y: auto; padding: 22px; box-sizing: border-box;">
        <div class="cc-grid" style="display: grid; grid-template-columns: 1.35fr 1.15fr 1fr; gap: 22px; height: 100%;">
          
          <!-- COLUMN 1: Monitor de Pedidos Unificado (Idéntico a Registro de Ventas) -->
          <div class="cc-column-card">
            <div class="cc-column-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 950; font-size: 16px; color: var(--color-text-primary); font-family: var(--font-display);">📦 Monitor de Pedidos</span>
                <span class="cc-badge-count" id="badge-orders-count">0</span>
              </div>
              <div style="display: flex; gap: 4px;">
                <button class="cc-filter-btn active" data-filter-type="orders" data-val="all" style="font-size: 10.5px; font-weight: 900; padding: 5px 10px; border-radius: 10px; border: none; background: var(--color-primary); color: white; cursor: pointer;">Todos</button>
                <button class="cc-filter-btn" data-filter-type="orders" data-val="app" style="font-size: 10.5px; font-weight: 900; padding: 5px 10px; border-radius: 10px; border: 1px solid var(--color-border-light); background: transparent; color: var(--color-text-secondary); cursor: pointer;">App</button>
                <button class="cc-filter-btn" data-filter-type="orders" data-val="whatsapp" style="font-size: 10.5px; font-weight: 900; padding: 5px 10px; border-radius: 10px; border: 1px solid var(--color-border-light); background: transparent; color: var(--color-text-secondary); cursor: pointer;">WhatsApp</button>
              </div>
            </div>
            <div class="cc-column-body" id="col-orders-body">
              <div style="text-align: center; padding: 60px 20px; opacity: 0.5;">
                <div class="spinner-mini" style="margin: 0 auto 12px;"></div>
                <span>Cargando pedidos en vivo...</span>
              </div>
            </div>
          </div>

          <!-- COLUMN 2: Central de Atención y Soporte (App + WA Directo) -->
          <div class="cc-column-card">
            <div class="cc-column-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 950; font-size: 16px; color: var(--color-text-primary); font-family: var(--font-display);">💬 Atención y Soporte</span>
                <span class="cc-badge-count" id="badge-support-count" style="background: #f59e0b;">0</span>
              </div>
              <div style="display: flex; gap: 4px;">
                <button class="cc-filter-btn active" data-filter-type="support" data-val="all" style="font-size: 10.5px; font-weight: 900; padding: 5px 10px; border-radius: 10px; border: none; background: #f59e0b; color: white; cursor: pointer;">Todos</button>
                <button class="cc-filter-btn" data-filter-type="support" data-val="whatsapp" style="font-size: 10.5px; font-weight: 900; padding: 5px 10px; border-radius: 10px; border: 1px solid var(--color-border-light); background: transparent; color: var(--color-text-secondary); cursor: pointer;">WhatsApp</button>
                <button class="cc-filter-btn" data-filter-type="support" data-val="app" style="font-size: 10.5px; font-weight: 900; padding: 5px 10px; border-radius: 10px; border: 1px solid var(--color-border-light); background: transparent; color: var(--color-text-secondary); cursor: pointer;">App</button>
              </div>
            </div>
            <div class="cc-column-body" id="col-support-body">
              <div style="text-align: center; padding: 60px 20px; opacity: 0.5;">
                <div class="spinner-mini" style="margin: 0 auto 12px;"></div>
                <span>Cargando mensajes...</span>
              </div>
            </div>
          </div>

          <!-- COLUMN 3: Repartidores Conectados en Vivo -->
          <div class="cc-column-card">
            <div class="cc-column-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 950; font-size: 16px; color: var(--color-text-primary); font-family: var(--font-display);">🛵 Repartidores en Vivo</span>
                <span class="cc-badge-count" id="badge-drivers-count" style="background: #10b981;">0</span>
              </div>
            </div>
            <div class="cc-column-body" id="col-drivers-body">
              <div style="text-align: center; padding: 60px 20px; opacity: 0.5;">
                <div class="spinner-mini" style="margin: 0 auto 12px;"></div>
                <span>Cargando cadetes...</span>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  `;

  // Attach Back button
  const backBtn = content.querySelector('#cc-back-btn');
  if (backBtn) backBtn.onclick = () => { window.location.hash = '#/admin'; };

  // Attach Bot Mode buttons
  content.querySelectorAll('.wsp-mode-btn').forEach(btn => {
    btn.onclick = () => {
      content.querySelectorAll('.wsp-mode-btn').forEach(b => {
        b.style.background = 'rgba(255,255,255,0.15)';
        b.classList.remove('active');
      });
      btn.style.background = btn.dataset.mode === 'normal' ? '#25D366' : (btn.dataset.mode === 'delay' ? '#f59e0b' : '#ef4444');
      btn.classList.add('active');
      showToast(`Modo Bot de WhatsApp cambiado a: ${btn.dataset.mode.toUpperCase()}`, 'info');
    };
  });

  // Attach Column filter buttons
  content.querySelectorAll('.cc-filter-btn').forEach(btn => {
    btn.onclick = () => {
      const type = btn.dataset.filterType;
      const val = btn.dataset.val;
      content.querySelectorAll(`.cc-filter-btn[data-filter-type="${type}"]`).forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'var(--color-text-secondary)';
        b.style.border = '1px solid var(--color-border-light)';
      });
      btn.style.background = type === 'orders' ? 'var(--color-primary)' : '#f59e0b';
      btn.style.color = 'white';
      btn.style.border = 'none';

      if (type === 'orders') {
        orderFilter = val;
        renderOrdersColumn();
      } else if (type === 'support') {
        supportFilter = val;
        renderSupportColumn();
      }
    };
  });

  startListeners(content);

  // Start live 1-second interval for offer countdown timers
  if (!window.adminOfferTimerInterval) {
    window.adminOfferTimerInterval = setInterval(() => {
      const timers = document.querySelectorAll('.admin-offer-timer');
      if (!timers.length) return;
      const now = Date.now() + (getState().serverTimeOffset || 0);
      timers.forEach(t => {
        const offeredAt = parseInt(t.dataset.offeredAt, 10);
        if (!offeredAt) return;
        const elapsedSec = Math.floor((now - offeredAt) / 1000);
        const remainingSec = Math.max(0, 30 - elapsedSec);
        t.textContent = `${remainingSec}s`;
      });
    }, 1000);
  }

  return {
    cleanup: () => {
      if (unsubOrders) unsubOrders();
      if (unsubSupport) unsubSupport();
      if (unsubDrivers) unsubDrivers();
    }
  };
}

function startListeners(content) {
  if (unsubOrders) unsubOrders();
  if (unsubSupport) unsubSupport();
  if (unsubDrivers) unsubDrivers();

  // 1. Listen to active & uncompleted orders
  const ordersQuery = query(
    collection(db, 'orders'),
    where('status', 'in', ['pending', 'confirmed', 'preparing', 'ready', 'on_way'])
  );

  unsubOrders = onSnapshot(ordersQuery, (snap) => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort newest first
    allOrders.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    const statOrders = content.querySelector('#cc-stat-orders');
    if (statOrders) statOrders.textContent = allOrders.length;
    renderOrdersColumn();
  }, err => console.error('Error in CC orders listener:', err));

  // 2. Listen to support chats
  const supportQuery = query(collection(db, 'support_chats'));
  unsubSupport = onSnapshot(supportQuery, (snap) => {
    allSupportChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allSupportChats.sort((a, b) => {
      const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : new Date(a.updatedAt || 0).getTime();
      const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : new Date(b.updatedAt || 0).getTime();
      return timeB - timeA;
    });

    const statSupport = content.querySelector('#cc-stat-support');
    if (statSupport) statSupport.textContent = allSupportChats.length;
    renderSupportColumn();
  }, err => console.error('Error in CC support listener:', err));

  // 3. Listen to online drivers
  const driversQuery = query(
    collection(db, 'users'),
    where('role', '==', 'delivery'),
    where('isOnline', '==', true)
  );

  unsubDrivers = onSnapshot(driversQuery, (snap) => {
    allOnlineDrivers = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const statDrivers = content.querySelector('#cc-stat-drivers');
    if (statDrivers) statDrivers.textContent = allOnlineDrivers.length;
    renderDriversColumn();
  }, err => console.error('Error in CC drivers listener:', err));
}

function renderOrdersColumn() {
  const container = document.getElementById('col-orders-body');
  const badge = document.getElementById('badge-orders-count');
  if (!container) return;

  let filtered = [...allOrders];
  if (orderFilter === 'app') {
    filtered = filtered.filter(o => o.source !== 'whatsapp_bot');
  } else if (orderFilter === 'whatsapp') {
    filtered = filtered.filter(o => o.source === 'whatsapp_bot');
  }

  if (badge) badge.textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 10px; opacity:0.5;">
        ${icon('shoppingBag', 40)}
        <p style="font-weight:900; font-size:15px; margin-top:12px;">Sin pedidos activos</p>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(o => {
    const sKey = getStatusKey(o.status);
    const config = STATUS_CONFIG[sKey] || STATUS_CONFIG.pending;
    
    const dateObj = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
    const dateStr = dateObj ? (dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : '---';

    const isWhatsApp = o.source === 'whatsapp_bot';
    let serviceLabel = 'Comercio';
    let serviceColor = '#D946EF';
    let serviceIconHtml = icon('store', 20);

    if (isWhatsApp) {
      serviceLabel = 'MANDADO (WHATSAPP)';
      serviceColor = '#25D366';
      const waLogoUrl = 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg';
      serviceIconHtml = `<img src="${waLogoUrl}" style="width:24px; height:24px; object-fit:contain;" alt="WhatsApp" />`;
    } else if (o.isTrip) {
      serviceLabel = 'Go Viaje';
      serviceColor = '#3B82F6';
      serviceIconHtml = icon('bike', 20);
    } else if (o.isFavor) {
      serviceLabel = o.favorType === 'gocash' ? 'Go Cash' : (o.favorType === 'encomienda' ? 'Encomienda' : 'Mandado');
      serviceColor = '#10B981';
      serviceIconHtml = icon('package', 20);
    } else {
      serviceLabel = o.comercioName || 'Comercio';
      serviceColor = '#D946EF';
      serviceIconHtml = icon('store', 20);
    }

    let serviceHeaderText = isWhatsApp ? 'WHATSAPP' : (o.isTrip ? 'GO VIAJE' : (o.isFavor ? 'MANDADO' : 'COMERCIO'));
    const displayOrderNum = o.orderNumber ? `#${o.orderNumber}` : (o.orderId ? `#${o.orderId}` : (o.displayId ? `#${o.displayId}` : '#---'));

    html += `
      <div class="order-card-v4" onclick="if (window.showOrderDetail) window.showOrderDetail('${o.id}');" style="--st-color:${config.color}; --st-bg:${config.bg}; --srv-color:${serviceColor}; padding-top: 0px;">
        <div style="background:var(--srv-color); color:white; padding:8px 16px; margin:0 -20px 14px -20px; border-radius:23px 23px 0 0; font-weight:900; font-size:11px; font-family:var(--font-display); text-transform:uppercase; letter-spacing:0.06em; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 10px rgba(0,0,0,0.04);">
          <span>${serviceHeaderText}</span>
          <span>${displayOrderNum}</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; border-radius:10px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:${serviceColor}; flex-shrink:0; overflow:hidden; border:1px solid var(--color-border-light);">
              ${serviceIconHtml}
            </div>
            <div>
              <div style="font-weight:850; font-size:14px; color:var(--color-text-primary); max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${serviceLabel}</div>
              <div style="font-size:10.5px; font-weight:800; color:var(--color-text-tertiary);">${dateStr}</div>
            </div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
            <div class="s-pill-v4">${config.label}</div>
            <div style="font-weight:950; font-size:16px; color:var(--color-primary);">${formatPrice(o.total || 0)}</div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:6px; width:100%; padding-top:12px; border-top:1px solid var(--color-border-light);">
          ${o.driverId ? `
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
              <span style="font-size:11.5px; font-weight:850; color:var(--color-text-secondary);"><span style="color:var(--color-text-tertiary); font-weight:700;">Moto:</span> ${o.driverName || 'Repartidor'}</span>
              <button onclick="event.stopPropagation(); if (window.showOrderDetail) window.showOrderDetail('${o.id}');" style="background:rgba(239,68,68,0.1); border:none; color:#ef4444; font-size:9.5px; font-weight:900; padding:2px 6px; border-radius:6px; cursor:pointer;">Liberar</button>
            </div>
          ` : `
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:5px 8px; border-radius:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); font-size:11px; font-weight:800; color:#d97706;">
              <span>
                ${(() => {
                  if (o.queueTargetDriverName) {
                    const nowMs = Date.now() + (getState().serverTimeOffset || 0);
                    const offeredAtMs = o.queueOfferedAt ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime()) : nowMs;
                    const elapsedSec = Math.floor((nowMs - offeredAtMs) / 1000);
                    const remainingSec = Math.max(0, 30 - elapsedSec);
                    return `⏳ Ofrecido: <strong>${o.queueTargetDriverName}</strong> <span class="admin-offer-timer" data-offered-at="${offeredAtMs}" style="background:rgba(245,158,11,0.2); color:#b45309; padding:1px 5px; border-radius:4px; font-weight:900;">${remainingSec}s</span>`;
                  }
                  if (o.status === 'confirmed' || o.status === 'preparing') return `🍳 En preparación`;
                  return `🔍 Buscando moto...`;
                })()}
              </span>
            </div>
          `}

          <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <span style="font-size:11.5px; font-weight:800; color:var(--color-text-secondary);"><span style="color:var(--color-text-tertiary); font-weight:700;">Cliente:</span> ${o.userName || 'Cliente'}</span>
            <span style="font-size:10.5px; font-weight:800; color:var(--color-text-tertiary);">${o.paymentMethod === 'mercadopago' ? 'Transferencia' : 'Efectivo'}</span>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderSupportColumn() {
  const container = document.getElementById('col-support-body');
  const badge = document.getElementById('badge-support-count');
  if (!container) return;

  let filtered = [...allSupportChats];
  if (supportFilter === 'whatsapp') {
    filtered = filtered.filter(c => c.source === 'whatsapp_bot' || c.isWhatsAppBot === true || /^\d{8,15}$/.test(String(c.userId)));
  } else if (supportFilter === 'app') {
    filtered = filtered.filter(c => c.source !== 'whatsapp_bot' && !c.isWhatsAppBot && !/^\d{8,15}$/.test(String(c.userId)));
  }

  if (badge) badge.textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 10px; opacity:0.5;">
        ${icon('headset', 40)}
        <p style="font-weight:900; font-size:15px; margin-top:12px;">Sin consultas pendientes</p>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(c => {
    const isWsp = c.source === 'whatsapp_bot' || c.isWhatsAppBot === true || /^\d{8,15}$/.test(String(c.userId));
    const phone = String(c.userPhone || c.userId || c.phone || '').replace(/\D/g, '');

    html += `
      <div style="background:var(--color-surface); border-radius:20px; padding:14px; border:1.5px solid ${isWsp ? '#25D366' : 'var(--color-border-light)'}; display:flex; flex-direction:column; gap:8px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:6px;">
            ${isWsp ? `<span style="background:#25D366; color:white; font-size:9px; font-weight:900; padding:2px 6px; border-radius:6px;">WHATSAPP</span>` : `<span style="background:#f59e0b; color:white; font-size:9px; font-weight:900; padding:2px 6px; border-radius:6px;">TICKET APP</span>`}
            <span style="font-weight:850; font-size:13.5px; color:var(--color-text-primary);">${c.userName || phone || 'Usuario'}</span>
          </div>
        </div>

        <div style="font-size:12px; color:var(--color-text-secondary); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${c.lastMessage || 'Solicitó asistencia'}
        </div>

        <div style="display:flex; gap:6px; margin-top:4px;">
          ${isWsp ? `
            <button class="btn-cc-wsp-direct" data-phone="${phone}" style="flex:1; height:36px; border-radius:10px; background:#25D366; color:white; border:none; font-weight:900; font-size:11.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 12px rgba(37,211,102,0.25);">
              ${icon('whatsapp', 15, '', '#FFF')} Abrir WhatsApp
            </button>
          ` : `
            <button class="btn-cc-app-chat" data-user-id="${c.userId || c.id}" style="flex:1; height:36px; border-radius:10px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:11.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
              ${icon('chatBubble', 15)} Atender Chat App
            </button>
          `}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.btn-cc-wsp-direct').forEach(btn => {
    btn.onclick = () => {
      const clean = (btn.dataset.phone || '').replace(/\D/g, '');
      const full = clean.startsWith('54') ? clean : `549${clean}`;
      window.open(`https://wa.me/${full}`, '_blank');
    };
  });

  container.querySelectorAll('.btn-cc-app-chat').forEach(btn => {
    btn.onclick = () => {
      window.location.hash = `#/admin/support-chats?userId=${btn.dataset.userId}`;
    };
  });
}

function renderDriversColumn() {
  const container = document.getElementById('col-drivers-body');
  const badge = document.getElementById('badge-drivers-count');
  if (!container) return;

  if (badge) badge.textContent = allOnlineDrivers.length;

  if (allOnlineDrivers.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 10px; opacity:0.5;">
        ${icon('bike', 40)}
        <p style="font-weight:900; font-size:15px; margin-top:12px;">Sin cadetes conectados</p>
      </div>
    `;
    return;
  }

  let html = '';
  allOnlineDrivers.forEach(d => {
    const activeCount = allOrders.filter(o => o.driverId === d.id || o.queueTargetDriverId === d.id).length;

    html += `
      <div style="background:var(--color-surface); border-radius:20px; padding:14px; border:1.5px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; gap:10px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
          <div style="width:42px; height:42px; border-radius:14px; background:linear-gradient(135deg,#10b981,#059669); color:white; display:flex; align-items:center; justify-content:center; font-weight:900; flex-shrink:0;">
            ${(d.name || 'R')[0].toUpperCase()}
          </div>
          <div style="min-width:0; flex:1;">
            <div style="font-weight:850; font-size:14px; color:var(--color-text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${d.name || 'Repartidor'}
            </div>
            <div style="font-size:11.5px; color:var(--color-text-secondary); font-weight:700; margin-top:2px;">
              ID: ${d.displayId || d.id.slice(0,6)} • <span style="color:#10b981; font-weight:900;">${activeCount} pedidos</span>
            </div>
          </div>
        </div>
        <button class="btn-cc-driver-contact" data-phone="${d.phone || d.whatsapp || ''}" style="height:34px; padding:0 12px; border-radius:10px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); color:var(--color-text-primary); font-size:11px; font-weight:850; cursor:pointer;">
          Contactar
        </button>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.btn-cc-driver-contact').forEach(btn => {
    btn.onclick = () => {
      const clean = (btn.dataset.phone || '').replace(/\D/g, '');
      if (clean) {
        const full = clean.startsWith('54') ? clean : `549${clean}`;
        window.open(`https://wa.me/${full}`, '_blank');
      } else {
        showToast('El repartidor no posee teléfono registrado', 'warning');
      }
    };
  });
}
