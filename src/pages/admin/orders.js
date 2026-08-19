import { db } from '../../firebase.js';
import { doc, getDoc, collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { formatPrice, formatDate } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal } from '../../components/modal.js';
import { getState, subscribe } from '../../state.js';
import { registerUnsubscribe } from '../../utils/cleanup.js';

const userCache = {};
let knownOrderIds = null;
const newOrderAlerts = {};
let currentLimit = 30;
let isHistoryMode = false;
let infiniteObserver = null;
let pageLoadTime = 0;

async function getOrFetchUserProfile(userId) {
  if (!userId) return null;
  if (userCache[userId] !== undefined) return userCache[userId];
  
  userCache[userId] = null;
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('../../firebase.js');
    const userSnap = await getDoc(doc(db, 'users', userId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      let photo = data.photoURL || data.profilePhoto || null;
      const role = data.role;
      let displayId = data.dlId || data.goId || '---';

      if (role === 'comercio' || role === 'commerce') {
        const comSnap = await getDoc(doc(db, 'comercios', userId));
        if (comSnap.exists()) {
          const comData = comSnap.data();
          photo = comData.logo || comData.image || photo;
        }
      }
      
      const profile = {
        photo,
        role,
        displayId,
        displayName: data.displayName || 'Usuario'
      };
      userCache[userId] = profile;
      return profile;
    }
  } catch (e) {
    console.error('[Orders] Error fetching user profile:', userId, e);
  }
  return null;
}

const commerceLogoCache = {};

async function getOrFetchCommerceLogo(comercioId) {
  if (!comercioId) return null;
  if (commerceLogoCache[comercioId] !== undefined) return commerceLogoCache[comercioId];
  
  commerceLogoCache[comercioId] = null;
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('../../firebase.js');
    const comSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (comSnap.exists()) {
      const data = comSnap.data();
      const logo = data.logo || data.image || null;
      commerceLogoCache[comercioId] = logo;
      return logo;
    }
  } catch (e) {
    console.error('[Orders] Error fetching commerce logo:', comercioId, e);
  }
  return null;
}

let allOrders = [];
let ordersUnsubscribe = null;

const STATUS_CONFIG = {
  pending: { label: 'PENDIENTE', color: '#FFA500', bg: 'rgba(255, 165, 0, 0.1)' },
  confirmed: { label: 'PREPARANDO', color: '#3498DB', bg: 'rgba(52, 152, 219, 0.1)' },
  ready: { label: 'LISTO (ESPERANDO REPARTIDOR)', color: '#0d9488', bg: 'rgba(13, 148, 136, 0.1)' },
  accepted: { label: 'ACEPTADO', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
  delivering: { label: 'EN CAMINO', color: '#9B59B6', bg: 'rgba(155, 89, 182, 0.1)' },
  completed: { label: 'ENTREGADO', color: '#27AE60', bg: 'rgba(39, 174, 96, 0.1)' },
  cancelled: { label: 'CANCELADO', color: '#E74C3C', bg: 'rgba(231, 76, 60, 0.1)' }
};

function getComercioDisplayName(o) {
  if (o.isTrip) return 'Go Viaje';
  if (o.isFavor) {
    if (o.favorType === 'gocash') return 'Go Cash';
    if (o.favorType === 'encomienda' || o.favorType === 'mandado') return 'Encomienda';
    if (o.favorType === 'compra') return 'Mandado';
    if (o.favorType === 'pagodeservicios') return 'Pago de Servicios';
    return 'Mandado';
  }
  return o.comercioName || 'Comercio';
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
  
  if (stores.length === 0) {
    stores.push({
      name: 'Favor',
      items: details
    });
  }
  return stores;
}

export async function renderAdminOrders() {
  const content = document.getElementById('app-content');
  allOrders = [];
  isHistoryMode = false;
  currentLimit = 30;
  pageLoadTime = Date.now();
  
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; overflow:hidden; background:var(--color-bg);">
      <!-- Red Premium Header (Single Row) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
          <a href="#/admin" style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; text-decoration:none; transition:all 0.2s; position:relative; z-index:2; flex-shrink:0;">
            ${icon('chevronLeft', 24)}
          </a>
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; letter-spacing:-0.03em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; position:relative; z-index:2;">Registro de Ventas</h1>
        </div>

        <a href="#/admin/support-chats" id="orders-support-chats-btn" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; transition:all 0.2s; position:relative; z-index:2; flex-shrink:0;" title="Mesa de Ayuda">
          ${icon('chatBubble', 22)}
        </a>
      </div>

      <!-- Advanced Search & Main 3 Segments (APP / WHATSAPP / CHATS) -->
      <div style="padding:16px 20px; flex-shrink:0; background:linear-gradient(to bottom, var(--color-surface), var(--color-bg));">
        
        <!-- Ultra-Premium Segmented Control Bar (APP / WHATSAPP) -->
        <div class="premium-segmented-bar" style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:5px; display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:14px; box-shadow:0 4px 20px rgba(0,0,0,0.03);">
          <button class="main-segment-btn active" data-segment="app" style="height:44px; border-radius:16px; border:none; background:linear-gradient(135deg, #e11d48, #be123c); color:white; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 14px rgba(225,29,72,0.3); transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
            <div style="width:24px; height:24px; border-radius:8px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('smartphone', 14, '', '#FFF')}</div>
            <span>App</span>
            <span id="seg-count-app" style="background:rgba(255,255,255,0.25); color:white; padding:2px 7px; border-radius:100px; font-size:10px; font-weight:900;">0</span>
          </button>

          <button class="main-segment-btn" data-segment="whatsapp" style="height:44px; border-radius:16px; border:none; background:transparent; color:var(--color-text-secondary); font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
            <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" style="width:20px; height:20px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(37,211,102,0.2));" alt="WhatsApp" />
            <span>WhatsApp</span>
            <span id="seg-count-wa" style="background:rgba(37,211,102,0.15); color:#16a34a; padding:2px 7px; border-radius:100px; font-size:10px; font-weight:900;">0</span>
          </button>
        </div>

        <div class="search-box-v4" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:4px 6px; display:flex; align-items:center; box-shadow:var(--shadow-sm); margin-bottom:14px;">
          <div style="padding:0 12px; color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('search', 18)}</div>
          <input type="text" id="order-search" placeholder="Buscar cliente, comercio, ID o monto..." 
            style="flex:1; padding:10px 0; background:transparent; border:none; color:var(--color-text); font-weight:700; font-size:14.5px; outline:none;" />
        </div>
        
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:12px 14px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:8px;">
            <div id="toggle-filters-btn" style="font-size:10px; font-weight:900; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px; cursor:pointer; user-select:none; flex-shrink:1; min-width:0;">
              <span style="display:flex;">${icon('filter', 12)}</span>
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Filtros</span>
              <span id="filters-chevron-icon" style="transition:transform 0.2s; display:flex; align-items:center; color:var(--color-text-secondary);">${icon('chevronDown', 14)}</span>
            </div>

            <!-- ACTIVOS / TODOS Segmented Pill Switch -->
            <div id="history-switch-container" style="display:inline-flex; background:var(--color-bg-secondary); border-radius:100px; padding:3px; border:1px solid var(--color-border-light); flex-shrink:0; align-items:center;">
              <button id="switch-activos-btn" type="button" style="padding:4px 11px; border-radius:100px; border:none; background:var(--color-primary); color:white; font-size:11px; font-weight:900; transition:all 0.2s; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 6px rgba(225,29,72,0.3);">
                <span style="width:6px; height:6px; border-radius:50%; background:#00D67F; box-shadow:0 0 6px #00D67F;"></span>
                Activos
              </button>
              <button id="switch-todos-btn" type="button" style="padding:4px 11px; border-radius:100px; border:none; background:transparent; color:var(--color-text-tertiary); font-size:11px; font-weight:800; transition:all 0.2s; cursor:pointer;">
                Todos
              </button>
            </div>
          </div>
          
          <div id="filters-collapsible-content" style="display:none; margin-top:14px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; display:block; margin-bottom:6px; letter-spacing:0.02em;">Estado</label>
                <div style="position:relative; width:100%;">
                  <div style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-primary); pointer-events:none; display:flex; align-items:center; z-index:10;">
                    ${icon('activity', 16)}
                  </div>
                  <select id="filter-status-select" class="premium-select">
                    <option value="all">🟢 Todos los Estados</option>
                    <option value="pending">⏳ Pendientes</option>
                    <option value="confirmed">👨‍🍳 Preparando</option>
                    <option value="delivering">🚴 En Camino</option>
                    <option value="completed">✅ Entregados</option>
                    <option value="cancelled">❌ Cancelados</option>
                  </select>
                </div>
              </div>
              <div>
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; display:block; margin-bottom:6px; letter-spacing:0.02em;">Servicio</label>
                <div style="position:relative; width:100%;">
                  <div style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-primary); pointer-events:none; display:flex; align-items:center; z-index:10;">
                    ${icon('grid', 16)}
                  </div>
                  <select id="filter-type-select" class="premium-select">
                    <option value="all">⚡ Todos los Servicios</option>
                    <option value="comercio">🏪 Comercios</option>
                    <option value="mandado">🛵 Mandados</option>
                    <option value="encomienda">📦 Encomiendas</option>
                    <option value="gocash">💵 Go Cash</option>
                    <option value="trip">🚴 Go Viaje</option>
                  </select>
                </div>
              </div>
            </div>
            
            <div class="premium-date-grid">
              <div>
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; display:block; margin-bottom:6px; letter-spacing:0.02em;">Desde</label>
                <div style="position:relative; width:100%;">
                  <div style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); pointer-events:none; display:flex; align-items:center; z-index:10;">
                    ${icon('calendar', 14)}
                  </div>
                  <input type="date" id="filter-date-start" class="premium-input-date" />
                </div>
              </div>
              <div>
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; display:block; margin-bottom:6px; letter-spacing:0.02em;">Hasta</label>
                <div style="position:relative; width:100%;">
                  <div style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); pointer-events:none; display:flex; align-items:center; z-index:10;">
                    ${icon('calendar', 14)}
                  </div>
                  <input type="date" id="filter-date-end" class="premium-input-date" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="admin-registry-list-container" style="flex:1; overflow-y:auto; padding:0 20px 20px;">
        <div style="text-align:center; padding:100px 20px;">
          <div class="loader-dots"><span></span><span></span><span></span></div>
          <p style="font-size:12px; color:var(--color-text-tertiary); margin-top:12px; font-weight:800; text-transform:uppercase;">Iniciando Estación de Auditoría...</p>
        </div>
      </div>
    </div>

    <style>
      .f-chip-v4 { padding:10px 20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; font-size:12px; font-weight:900; color:var(--color-text-tertiary); cursor:pointer; white-space:nowrap; transition:all 0.2s; }
      .f-chip-v4.active { background:var(--c, var(--color-primary)); color:white; border-color:transparent; box-shadow:0 4px 12px var(--c, rgba(227,27,35,0.3)); }
      
      .t-chip { padding:10px 18px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; font-size:11px; font-weight:900; color:var(--color-text-tertiary); cursor:pointer; white-space:nowrap; transition:all 0.2s; }
      .t-chip.active { background:var(--color-primary); color:white; border-color:transparent; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.3); }

      .premium-select, .premium-input-date {
        width: 100% !important;
        max-width: 100% !important;
        height: 46px !important;
        min-height: 46px !important;
        line-height: 46px !important;
        border-radius: 16px !important;
        padding: 0 12px 0 36px !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        font-family: inherit !important;
        border: 1.5px solid var(--color-border-light) !important;
        background-color: var(--color-surface) !important;
        color: var(--color-text) !important;
        outline: none !important;
        cursor: pointer !important;
        box-sizing: border-box !important;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.02) !important;
        display: block !important;
        margin: 0 !important;
      }
      .premium-select {
        appearance: none !important;
        -webkit-appearance: none !important;
        -moz-appearance: none !important;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23e11d48' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>") !important;
        background-repeat: no-repeat !important;
        background-position: right 12px center !important;
        background-size: 14px !important;
        padding-right: 30px !important;
      }
      .premium-input-date::-webkit-calendar-picker-indicator {
        cursor: pointer !important;
        opacity: 0.6 !important;
        filter: invert(15%) sepia(95%) saturate(6932%) hue-rotate(354deg) brightness(91%) contrast(92%);
        padding: 0 !important;
        margin: 0 !important;
      }
      .premium-select:focus, .premium-input-date:focus {
        border-color: var(--color-primary) !important;
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.08), 0 0 0 3px rgba(225, 29, 72, 0.15) !important;
        transform: translateY(-1px);
      }

      .premium-date-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 12px;
      }
      @media (max-width: 480px) {
        .premium-date-grid {
          grid-template-columns: 1fr !important;
        }
      }

      @keyframes vibrate-shake {
        0%, 100% { transform: scale(1) translateX(0); }
        2%, 6%, 10%, 14%, 18%, 22%, 26%, 30%, 34%, 38%, 42%, 46% { transform: scale(1.02) translateX(-3px) rotate(-0.5deg); }
        4%, 8%, 12%, 16%, 20%, 24%, 28%, 32%, 36%, 40%, 44%, 48% { transform: scale(1.02) translateX(3px) rotate(0.5deg); }
        50% { transform: scale(1) translateX(0); }
      }
      .vibrate-new-order {
        animation: vibrate-shake 5s cubic-bezier(.36,.07,.19,.97) both !important;
        border: 2px solid var(--color-primary) !important;
        box-shadow: 0 0 20px rgba(225, 29, 72, 0.35) !important;
      }

      .order-card-v4 { 
        background:var(--color-surface); 
        border-radius: 24px;
        padding: 0 20px 20px 20px;
        margin-bottom: 16px;
        border: 1px solid var(--color-border);
        box-shadow: var(--shadow-sm);
        position: relative;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s, border-color 0.2s;
        overflow: hidden;
      }
      .order-card-v4:hover { transform: translateY(-3px); box-shadow:var(--shadow-lg); border-color:var(--color-primary); }
      .order-card-v4::before { content:''; position:absolute; left:0; top:0; width:6px; height:100%; background:var(--srv-color, var(--st-color)); }
      
      .s-pill-v4 { font-size:10px; font-weight:900; padding:5px 12px; border-radius:10px; background:var(--st-bg); color:var(--st-color); letter-spacing:0.05em; }
    </style>
  `;

  setupEventListeners();
  loadAllOrders();

  try {
    const { getRouteParams } = await import('../../router.js');
    const params = getRouteParams();
    if (params && params.orderId) {
      setTimeout(() => {
        window.showOrderDetail(params.orderId);
      }, 350);
    }
  } catch (err) {
    console.error('Error auto-opening order detail:', err);
  }
}

let currentSegment = 'app';
let supportUnsubscribe = null;
let allSupportChats = [];

function loadSupportChats() {
  if (supportUnsubscribe) supportUnsubscribe();
  const q = query(collection(db, 'support_chats'));
  supportUnsubscribe = onSnapshot(q, (snap) => {
    allSupportChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allSupportChats.sort((a, b) => {
      const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : new Date(a.updatedAt || 0).getTime();
      const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : new Date(b.updatedAt || 0).getTime();
      return timeB - timeA;
    });

    const chatsBadge = document.getElementById('seg-count-chats');
    if (chatsBadge) chatsBadge.textContent = allSupportChats.length;

    if (currentSegment === 'chats') {
      renderOrdersList();
    }
  }, err => console.error('Error fetching support chats in orders.js:', err));
}

function setupEventListeners() {
  document.getElementById('order-search')?.addEventListener('input', () => renderOrdersList());
  document.getElementById('filter-status-select')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-type-select')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-date-start')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-date-end')?.addEventListener('change', () => renderOrdersList());

  document.querySelectorAll('.main-segment-btn').forEach(btn => {
    btn.onclick = () => {
      const seg = btn.dataset.segment;
      currentSegment = seg;

      document.querySelectorAll('.main-segment-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'var(--color-text-secondary)';
        b.style.boxShadow = 'none';
        b.classList.remove('active');

        const appBadge = b.querySelector('#seg-count-app');
        if (appBadge) {
          appBadge.style.background = 'var(--color-bg-secondary)';
          appBadge.style.color = 'var(--color-text-secondary)';
        }
        const waBadge = b.querySelector('#seg-count-wa');
        if (waBadge) {
          waBadge.style.background = 'rgba(37,211,102,0.15)';
          waBadge.style.color = '#16a34a';
        }
      });

      btn.classList.add('active');

      if (seg === 'app') {
        btn.style.background = 'linear-gradient(135deg, #e11d48, #be123c)';
        btn.style.color = 'white';
        btn.style.boxShadow = '0 4px 14px rgba(225,29,72,0.3)';
        const appBadge = btn.querySelector('#seg-count-app');
        if (appBadge) {
          appBadge.style.background = 'rgba(255,255,255,0.25)';
          appBadge.style.color = 'white';
        }
      } else if (seg === 'whatsapp') {
        btn.style.background = 'linear-gradient(135deg, #25D366, #128C7E)';
        btn.style.color = 'white';
        btn.style.boxShadow = '0 4px 14px rgba(37,211,102,0.3)';
        const waBadge = btn.querySelector('#seg-count-wa');
        if (waBadge) {
          waBadge.style.background = 'rgba(255,255,255,0.25)';
          waBadge.style.color = 'white';
        }
      }

      renderOrdersList();
    };
  });

  const switchActivosBtn = document.getElementById('switch-activos-btn');
  const switchTodosBtn = document.getElementById('switch-todos-btn');
  let isLoadingMoreHistory = false;

  if (switchActivosBtn && switchTodosBtn) {
    switchActivosBtn.onclick = () => {
      if (!isHistoryMode) return;
      isHistoryMode = false;
      currentLimit = 30;
      switchActivosBtn.style.background = 'var(--color-primary)';
      switchActivosBtn.style.color = 'white';
      switchActivosBtn.style.boxShadow = '0 2px 6px rgba(225,29,72,0.3)';
      switchTodosBtn.style.background = 'transparent';
      switchTodosBtn.style.color = 'var(--color-text-tertiary)';
      switchTodosBtn.style.boxShadow = 'none';
      showToast('🟢 Mostrando únicamente Pedidos Activos', 'info');
      loadAllOrders();
    };

    switchTodosBtn.onclick = () => {
      if (isHistoryMode) return;
      isHistoryMode = true;
      currentLimit = 30;
      switchTodosBtn.style.background = 'var(--color-primary)';
      switchTodosBtn.style.color = 'white';
      switchTodosBtn.style.boxShadow = '0 2px 6px rgba(225,29,72,0.3)';
      switchActivosBtn.style.background = 'transparent';
      switchActivosBtn.style.color = 'var(--color-text-tertiary)';
      switchActivosBtn.style.boxShadow = 'none';
      showToast('📜 Mostrando Historial Completo (Paginado de a 30 pedidos)', 'info');
      loadAllOrders();
    };
  }

  const listContainer = document.getElementById('admin-registry-list-container');
  if (listContainer) {
    listContainer.onscroll = () => {
      if (!isHistoryMode || isLoadingMoreHistory) return;
      const nearBottom = listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 150;
      if (nearBottom) {
        isLoadingMoreHistory = true;
        currentLimit += 30;
        console.log(`[Orders History] Infinite scroll bottom reached. Increasing limit to ${currentLimit}`);
        loadAllOrders();
        setTimeout(() => { isLoadingMoreHistory = false; }, 1200);
      }
    };
  }

  // Collapsible Filters Toggle
  const toggleBtn = document.getElementById('toggle-filters-btn');
  const filtersContent = document.getElementById('filters-collapsible-content');
  const chevron = document.getElementById('filters-chevron-icon');
  if (toggleBtn && filtersContent) {
    toggleBtn.onclick = () => {
      const isHidden = filtersContent.style.display === 'none';
      filtersContent.style.display = isHidden ? 'block' : 'none';
      if (chevron) {
        chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    };
  }

  // Real-time support chat unread bubble badge
  const updateChatBadge = (count) => {
    const btn = document.getElementById('btn-go-to-chats');
    if (!btn) return;
    let badge = btn.querySelector('.chat-badge-bubble');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-badge-bubble';
        badge.style.cssText = 'position:absolute; top:-4px; right:-4px; background:#E11D48; color:white; font-size:9px; font-weight:900; height:18px; min-width:18px; border-radius:9px; padding:0 5px; display:flex; align-items:center; justify-content:center; border:2px solid var(--color-primary); box-shadow:0 2px 5px rgba(0,0,0,0.2); box-sizing:border-box; z-index:10;';
        btn.appendChild(badge);
      }
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      if (badge) badge.style.display = 'none';
    }
  };

  const initialCount = getState().unreadSupportCount || 0;
  updateChatBadge(initialCount);
  subscribe('unreadSupportCount', (count) => updateChatBadge(count || 0));
}

let chatSubFilter = 'all'; // 'all' | 'client' | 'delivery' | 'comercio' | 'whatsapp'

function renderSupportChatsList(container) {
  const searchText = String(document.getElementById('order-search')?.value || '').toLowerCase();
  
  let chats = [...allSupportChats];

  // Apply Subfilter (All, Clientes, Repartidores, Comercios, WhatsApp)
  if (chatSubFilter === 'whatsapp') {
    chats = chats.filter(c => c.source === 'whatsapp_bot' || c.isWhatsAppBot === true || /^\d{8,15}$/.test(String(c.userId)));
  } else if (chatSubFilter === 'delivery') {
    chats = chats.filter(c => c.userRole === 'delivery' || c.role === 'delivery');
  } else if (chatSubFilter === 'comercio') {
    chats = chats.filter(c => c.userRole === 'comercio' || c.userRole === 'commerce' || c.role === 'comercio');
  } else if (chatSubFilter === 'client') {
    chats = chats.filter(c => !c.isWhatsAppBot && c.source !== 'whatsapp_bot' && c.userRole !== 'delivery' && c.userRole !== 'comercio' && c.userRole !== 'commerce');
  }

  // Search text filter
  if (searchText) {
    chats = chats.filter(c => 
      String(c.userName || '').toLowerCase().includes(searchText) ||
      String(c.lastMessage || '').toLowerCase().includes(searchText) ||
      String(c.userPhone || c.userId || '').includes(searchText)
    );
  }

  let subfilterBarHtml = `
    <div id="chats-subfilter-bar" style="display:flex; gap:6px; overflow-x:auto; padding-bottom:12px; margin-bottom:14px; border-bottom:1px solid var(--color-border-light); -webkit-overflow-scrolling:touch;">
      <button class="chat-subfilter-btn ${chatSubFilter === 'all' ? 'active' : ''}" data-subfilter="all" style="font-size:11px; font-weight:900; padding:6px 12px; border-radius:10px; border:none; background:${chatSubFilter === 'all' ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${chatSubFilter === 'all' ? 'white' : 'var(--color-text-secondary)'}; cursor:pointer; flex-shrink:0;">Todos (${allSupportChats.length})</button>
      <button class="chat-subfilter-btn ${chatSubFilter === 'client' ? 'active' : ''}" data-subfilter="client" style="font-size:11px; font-weight:900; padding:6px 12px; border-radius:10px; border:none; background:${chatSubFilter === 'client' ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${chatSubFilter === 'client' ? 'white' : 'var(--color-text-secondary)'}; cursor:pointer; flex-shrink:0;">👤 Clientes</button>
      <button class="chat-subfilter-btn ${chatSubFilter === 'delivery' ? 'active' : ''}" data-subfilter="delivery" style="font-size:11px; font-weight:900; padding:6px 12px; border-radius:10px; border:none; background:${chatSubFilter === 'delivery' ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${chatSubFilter === 'delivery' ? 'white' : 'var(--color-text-secondary)'}; cursor:pointer; flex-shrink:0;">🛵 Repartidores</button>
      <button class="chat-subfilter-btn ${chatSubFilter === 'comercio' ? 'active' : ''}" data-subfilter="comercio" style="font-size:11px; font-weight:900; padding:6px 12px; border-radius:10px; border:none; background:${chatSubFilter === 'comercio' ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${chatSubFilter === 'comercio' ? 'white' : 'var(--color-text-secondary)'}; cursor:pointer; flex-shrink:0;">🏬 Comercios</button>
      <button class="chat-subfilter-btn ${chatSubFilter === 'whatsapp' ? 'active' : ''}" data-subfilter="whatsapp" style="font-size:11px; font-weight:900; padding:6px 12px; border-radius:10px; border:none; background:${chatSubFilter === 'whatsapp' ? '#25D366' : 'var(--color-surface)'}; color:${chatSubFilter === 'whatsapp' ? 'white' : 'var(--color-text-secondary)'}; cursor:pointer; flex-shrink:0;">💬 WhatsApp</button>
    </div>
  `;

  if (chats.length === 0) {
    container.innerHTML = subfilterBarHtml + `
      <div style="text-align:center; padding:60px 20px; opacity:0.5;">
        ${icon('headset', 44)}
        <p style="font-weight:900; font-size:15px; margin-top:14px;">Sin requerimientos de chat</p>
        <p style="font-size:12px;">No hay consultas para el filtro seleccionado.</p>
      </div>
    `;
    attachSubfilterEvents(container);
    return;
  }

  let html = subfilterBarHtml;
  chats.forEach(c => {
    const isWsp = c.source === 'whatsapp_bot' || c.isWhatsAppBot === true || /^\d{8,15}$/.test(String(c.userId));
    const phone = String(c.userPhone || c.userId || c.phone || '').replace(/\D/g, '');
    const isUnread = c.unreadByAdmin === true;

    let roleTagBg = '#f59e0b';
    let roleTagLabel = '📱 TICKET APP';
    if (isWsp) {
      roleTagBg = '#25D366';
      roleTagLabel = '💬 WHATSAPP';
    } else if (c.userRole === 'delivery' || c.role === 'delivery') {
      roleTagBg = '#10b981';
      roleTagLabel = '🛵 REPARTIDOR';
    } else if (c.userRole === 'comercio' || c.userRole === 'commerce' || c.role === 'comercio') {
      roleTagBg = '#d97706';
      roleTagLabel = '🏬 COMERCIO';
    } else {
      roleTagBg = '#3b82f6';
      roleTagLabel = '👤 CLIENTE';
    }

    html += `
      <div style="background:var(--color-surface); border-radius:22px; padding:18px; margin-bottom:14px; border:1.5px solid ${isWsp ? '#25D366' : 'var(--color-border-light)'}; display:flex; flex-direction:column; gap:10px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:${roleTagBg}; color:white; font-size:9.5px; font-weight:900; padding:2px 8px; border-radius:6px; text-transform:uppercase;">${roleTagLabel}</span>
            <span style="font-weight:900; font-size:15px; color:var(--color-text-primary);">${c.userName || phone || 'Usuario'}</span>
          </div>
          ${isUnread ? `<span style="background:#ef4444; color:white; font-size:9px; font-weight:900; padding:2px 6px; border-radius:100px;">NUEVO</span>` : ''}
        </div>

        <div style="font-size:13px; color:var(--color-text-secondary); font-weight:600;">
          <strong>Último Mensaje:</strong> ${c.lastMessage || 'Solicitó atención con operador'}
        </div>

        <div style="display:flex; gap:10px; margin-top:4px;">
          ${isWsp ? `
            <button class="btn-open-wsp-direct" data-phone="${phone}" style="flex:1; height:40px; border-radius:12px; background:#25D366; color:white; border:none; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 12px rgba(37,211,102,0.25);">
              ${icon('whatsapp', 16, '', '#FFF')} Abrir Chat de WhatsApp
            </button>
          ` : `
            <button class="btn-open-app-support" data-user-id="${c.userId || c.id}" style="flex:1; height:40px; border-radius:12px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
              ${icon('chatBubble', 16)} Atender Chat App
            </button>
          `}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  attachSubfilterEvents(container);

  container.querySelectorAll('.btn-open-wsp-direct').forEach(btn => {
    btn.onclick = () => {
      const clean = (btn.dataset.phone || '').replace(/\D/g, '');
      const full = clean.startsWith('54') ? clean : `549${clean}`;
      window.open(`https://wa.me/${full}`, '_blank');
    };
  });

  container.querySelectorAll('.btn-open-app-support').forEach(btn => {
    btn.onclick = () => {
      window.location.hash = `#/admin/support-chats?userId=${btn.dataset.userId}`;
    };
  });
}

function attachSubfilterEvents(container) {
  container.querySelectorAll('.chat-subfilter-btn').forEach(btn => {
    btn.onclick = () => {
      chatSubFilter = btn.dataset.subfilter;
      renderOrdersList();
    };
  });
}

function renderOrdersList() {
  const container = document.getElementById('admin-registry-list-container');
  if (!container) return;

  if (currentSegment === 'chats') {
    renderSupportChatsList(container);
    return;
  }

  const searchText = (document.getElementById('order-search')?.value || '').toLowerCase();
  const filter = document.getElementById('filter-status-select')?.value || 'all';
  const typeFilter = document.getElementById('filter-type-select')?.value || 'all';
  const startDateStr = document.getElementById('filter-date-start')?.value || '';
  const endDateStr = document.getElementById('filter-date-end')?.value || '';

  let filtered = [...allOrders];

  // Filter by Segment (APP vs WHATSAPP)
  if (currentSegment === 'app') {
    filtered = filtered.filter(o => o.source !== 'whatsapp_bot');
  } else if (currentSegment === 'whatsapp') {
    filtered = filtered.filter(o => o.source === 'whatsapp_bot');
  }

  // Update counts on badges
  const appCount = allOrders.filter(o => o.source !== 'whatsapp_bot').length;
  const waCount = allOrders.filter(o => o.source === 'whatsapp_bot').length;
  const badgeApp = document.getElementById('seg-count-app');
  const badgeWa = document.getElementById('seg-count-wa');
  if (badgeApp) badgeApp.textContent = appCount;
  if (badgeWa) badgeWa.textContent = waCount;

  // Filter by search text
  if (searchText) {
    filtered = filtered.filter(o => {
      const matchId = String(o.orderId || '').toLowerCase().includes(searchText) || 
                      String(o.orderNumber || '').toLowerCase().includes(searchText) || 
                      String(o.displayId || '').toLowerCase().includes(searchText) || 
                      String(o.id || '').toLowerCase().includes(searchText);
      const matchClient = String(o.userName || '').toLowerCase().includes(searchText);
      const matchCommerce = String(o.comercioName || '').toLowerCase().includes(searchText);
      const matchAmount = String(o.total || '').toLowerCase().includes(searchText);
      return matchId || matchClient || matchCommerce || matchAmount;
    });
  }

  // Filter by status
  if (filter !== 'all') {
    filtered = filtered.filter(o => {
      const st = (o.status || '').toLowerCase();
      if (filter === 'pending') return st === 'pending' || st === 'pendiente';
      if (filter === 'accepted') return st === 'accepted' || st === 'aceptado' || st === 'preparing' || st === 'preparando';
      if (filter === 'delivering') return st === 'delivering' || st === 'en_camino' || st === 'at_door';
      if (filter === 'delivered') return st === 'delivered' || st === 'entregado' || st === 'completed';
      if (filter === 'cancelled') return st === 'cancelled' || st === 'cancelado';
      if (filter === 'scheduled') return o.isScheduled === true;
      return true;
    });
  }

  // Filter by service type
  if (typeFilter !== 'all') {
    filtered = filtered.filter(o => {
      if (typeFilter === 'whatsapp') return o.source === 'whatsapp_bot';
      if (typeFilter === 'commerce') return !o.isTrip && !o.isFavor && o.source !== 'whatsapp_bot';
      if (typeFilter === 'favor') return o.isFavor && o.favorType !== 'gocash' && o.source !== 'whatsapp_bot';
      if (typeFilter === 'gocash') return o.isFavor && o.favorType === 'gocash';
      if (typeFilter === 'trip') return o.isTrip;
      return true;
    });
  }

  // Filter by Date Range
  if (startDateStr) {
    const startDate = new Date(startDateStr + 'T00:00:00');
    filtered = filtered.filter(o => {
      const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
      return orderDate && orderDate >= startDate;
    });
  }

  if (endDateStr) {
    const endDate = new Date(endDateStr + 'T23:59:59');
    filtered = filtered.filter(o => {
      const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
      return orderDate && orderDate <= endDate;
    });
  }

  renderFilteredOrders(container, filtered);
}

function loadAllOrders() {
  const dot = document.getElementById('conn-dot');
  const diag = document.getElementById('conn-diag');
  
  if (ordersUnsubscribe) ordersUnsubscribe();

  let q;
  if (!isHistoryMode) {
    // ACTIVE ORDERS ONLY (Default Mode: Avoids unnecessary reads)
    q = query(
      collection(db, 'orders'),
      where('status', 'in', ['pending', 'confirmed', 'preparing', 'ready', 'accepted', 'delivering', 'on_way'])
    );
  } else {
    // HISTORICAL ORDERS (Paginated 30 at a time on scroll)
    q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc'),
      limit(currentLimit)
    );
  }
  
  ordersUnsubscribe = onSnapshot(q, (snap) => {
    registerUnsubscribe(ordersUnsubscribe);
    if (dot) {
      dot.style.background = isHistoryMode ? '#3B82F6' : '#00D67F';
      dot.style.boxShadow = isHistoryMode ? '0 0 10px #3B82F6' : '0 0 10px #00D67F';
    }
    if (diag) {
      diag.textContent = isHistoryMode ? `• HISTORIAL COMPLETO (${snap.size})` : `• ACTIVOS EN VIVO (${snap.size})`;
    }

    const isFirstLoad = (knownOrderIds === null);
    if (isFirstLoad) {
      knownOrderIds = new Set();
    }

    allOrders = [];
    snap.forEach(doc => {
      try {
        const data = doc.data();
        allOrders.push({ id: doc.id, ...data });
        
        if (isFirstLoad) {
          knownOrderIds.add(doc.id);
        } else {
          if (!knownOrderIds.has(doc.id)) {
            knownOrderIds.add(doc.id);
            
            const orderMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : (data.createdAt ? new Date(data.createdAt).getTime() : 0);
            const isCreatedAfterLoad = orderMs > (pageLoadTime - 2000);
            
            if (isCreatedAfterLoad) {
              newOrderAlerts[doc.id] = Date.now();
              // Try to play notification sound
              try {
                import('../../utils/audio-manager.js').then(({ AudioManager }) => {
                  AudioManager.play('new_order');
                }).catch(() => {});
              } catch(e) {}
            }
          }
        }
      } catch(e) {}
    });

    // Sort active/pending scheduled orders to the top, completed/cancelled scheduled orders fallback chronologically
    allOrders.sort((a, b) => {
      const isAActiveScheduled = a.isScheduled && !['delivered', 'completed', 'cancelled', 'entregado'].includes(a.status?.toLowerCase());
      const isBActiveScheduled = b.isScheduled && !['delivered', 'completed', 'cancelled', 'entregado'].includes(b.status?.toLowerCase());
      
      if (isAActiveScheduled && !isBActiveScheduled) return -1;
      if (!isAActiveScheduled && isBActiveScheduled) return 1;
      
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return bTime - aTime;
    });
    
    renderOrdersList();
  }, (err) => {
    if (dot) dot.style.background = '#E74C3C';
    showToast('Error de sincronización: ' + err.message, 'danger');
  });
}

function renderFilteredOrders(container, filtered) {
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:100px 20px; opacity:0.4;">
        ${icon('search', 56)}
        <p style="font-weight:900; font-size:16px; margin-top:16px;">Sin resultados</p>
        <p style="font-size:12px;">Prueba con otros términos o filtros</p>
      </div>
    `;
    return;
  }

  const htmlContent = filtered.map(o => {
    const sKey = getStatusKey(o.status);
    const config = STATUS_CONFIG[sKey] || STATUS_CONFIG.pending;
    
    const dateObj = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
    const dateStr = dateObj ? (dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : 'Fecha desconocida';

    const scheduledBadge = o.isScheduled ? `
      <div style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 6px; padding: 2px 6px; font-size: 10px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; text-transform: uppercase;">
        📅 Programado: ${o.scheduledTime}
      </div>
    ` : '';

    const clientProfile = userCache[o.userId];
    if (clientProfile === undefined && o.userId) {
      getOrFetchUserProfile(o.userId).then(() => renderOrdersList());
    }
    const driverProfile = userCache[o.driverId];
    if (driverProfile === undefined && o.driverId) {
      getOrFetchUserProfile(o.driverId).then(() => renderOrdersList());
    }

    const clientPhoto = clientProfile?.photo || null;
    const driverPhoto = driverProfile?.photo || null;
    const driverDlId = o.driverDlId || driverProfile?.displayId || '---';

    let serviceLabel = 'Comercio';
    let serviceColor = '#D946EF';
    let serviceIconHtml = icon('store', 20);

    const isWhatsApp = o.source === 'whatsapp_bot';
    if (isWhatsApp) {
      serviceLabel = 'MANDADO (WHATSAPP)';
      serviceColor = '#25D366';
      const waLogoUrl = 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg';
      serviceIconHtml = `<img src="${waLogoUrl}" style="width:24px; height:24px; object-fit:contain;" alt="WhatsApp" />`;
    } else if (o.isTrip) {
      serviceLabel = 'Go Viaje';
      serviceColor = '#3B82F6';
      if (o.driverId && driverPhoto) {
        serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
      } else {
        serviceIconHtml = icon('bike', 20);
      }
    } else if (o.isFavor) {
      if (o.favorType === 'gocash') {
        serviceLabel = 'Go Cash';
        serviceColor = '#6366F1';
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('wallet', 20);
        }
      } else if (o.favorType === 'encomienda' || o.favorType === 'mandado') {
        serviceLabel = 'Encomienda';
        serviceColor = '#10B981';
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('package', 20);
        }
      } else if (o.favorType === 'pagodeservicios') {
        serviceLabel = 'Pago de Servicios';
        serviceColor = '#F59E0B';
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('bank', 20);
        }
      } else {
        serviceLabel = 'Mandado';
        serviceColor = '#E11D48';
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('truck', 20);
        }
      }
    } else {
      serviceLabel = o.comercioName || 'Comercio';
      serviceColor = '#D946EF';
      const logoUrl = getState().comerciosData?.[o.comercioId] || commerceLogoCache[o.comercioId];
      if (!logoUrl && o.comercioId) {
        if (commerceLogoCache[o.comercioId] === undefined) {
          getOrFetchCommerceLogo(o.comercioId).then(() => renderOrdersList());
        }
      }

      if (logoUrl) {
        serviceIconHtml = `<img src="${logoUrl}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" />`;
      } else {
        serviceIconHtml = icon('store', 20);
      }
    }

    let serviceHeaderText = 'COMERCIO';
    if (isWhatsApp) {
      serviceHeaderText = 'WHATSAPP';
    } else if (o.isTrip) {
      serviceHeaderText = 'GO VIAJE';
    } else if (o.isFavor) {
      if (o.favorType === 'gocash') {
        serviceHeaderText = 'GO CASH';
      } else if (o.favorType === 'encomienda' || o.favorType === 'mandado') {
        serviceHeaderText = 'ENCOMIENDA';
      } else if (o.favorType === 'pagodeservicios') {
        serviceHeaderText = 'PAGO DE SERVICIOS';
      } else {
        serviceHeaderText = 'MANDADO';
      }
    }

    const displayOrderNum = o.orderNumber ? `#${o.orderNumber}` : (o.orderId ? `#${o.orderId}` : (o.displayId ? `#${o.displayId}` : '#---'));

    return `
      <div class="order-card-v4" onclick="window.showOrderDetail('${o.id}')" style="--st-color:${config.color}; --st-bg:${config.bg}; --srv-color:${serviceColor}; padding-top: 0px;">
        <div style="background:var(--srv-color); color:white; padding:10px 20px; margin:0 -20px 16px -20px; border-radius:23px 23px 0 0; font-weight:900; font-size:12px; font-family:var(--font-display); text-transform:uppercase; letter-spacing:0.06em; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 10px rgba(0,0,0,0.04);">
          <span>${serviceHeaderText}</span>
          <span>${displayOrderNum}</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:40px; height:40px; border-radius:12px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:${serviceColor}; flex-shrink:0; overflow:hidden; border:1px solid var(--color-border-light);">
              ${serviceIconHtml}
            </div>
            <div>
              <div style="font-weight:850; font-size:15px; color:var(--color-text-primary);">${serviceLabel}</div>
              <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary);">${dateStr}</div>
              ${scheduledBadge}
            </div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <div class="s-pill-v4" style="margin-bottom:2px;">${config.label}</div>
            <div style="font-weight:900; font-size:18px; color:var(--color-primary);">${formatPrice(o.total || 0)}</div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; width:100%; padding-top:14px; border-top:1px solid var(--color-border-light);">
          ${o.driverId ? `
            <div style="display:flex; align-items:center; gap:8px;">
              ${driverPhoto ? `
                <img src="${driverPhoto}" style="width:22px; height:22px; border-radius:50%; object-fit:cover; border:1px solid var(--color-border-light);" referrerpolicy="no-referrer" />
              ` : `
                <div style="width:22px; height:22px; border-radius:50%; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary); font-size:10px; font-weight:800; border:1px solid var(--color-border-light);">R</div>
              `}
              <span style="font-size:12px; font-weight:800; color:var(--color-text-secondary);"><span style="color:var(--color-text-tertiary); font-weight:700;">Repartidor:</span> ${o.driverName || 'Repartidor'} (ID: ${driverDlId})</span>
            </div>
          ` : (o.status === 'ready' || o.status === 'confirmed' || o.status === 'preparing' || o.status === 'pending') ? `
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:6px 10px; border-radius:10px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); font-size:11.5px; font-weight:800; color:#d97706;">
              <span>
                ${(() => {
                  if (o.queueTargetDriverName) {
                    const nowMs = Date.now() + (getState().serverTimeOffset || 0);
                    const offeredAtMs = o.queueOfferedAt ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime()) : nowMs;
                    const elapsedSec = Math.floor((nowMs - offeredAtMs) / 1000);
                    const remainingSec = Math.max(0, 30 - elapsedSec);
                    return `⏳ Ofrecido a: <strong>${o.queueTargetDriverName}</strong> <span class="admin-offer-timer" data-offered-at="${offeredAtMs}" style="background:rgba(245,158,11,0.2); color:#b45309; padding:1px 6px; border-radius:6px; font-weight:900; margin-left:4px;">${remainingSec}s</span>`;
                  }
                  if (o.status === 'confirmed' || o.status === 'preparing') return `🍳 En preparación`;
                  if (o.status === 'pending') return `🏪 Esperando confirmación del local`;
                  return `🔍 Buscando repartidor en tiempo real...`;
                })()}
              </span>
            </div>
          ` : ''}

          <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <div style="display:flex; align-items:center; gap:8px;">
              ${clientPhoto ? `
                <img src="${clientPhoto}" style="width:22px; height:22px; border-radius:50%; object-fit:cover; border:1px solid var(--color-border-light);" referrerpolicy="no-referrer" />
              ` : `
                <div style="width:22px; height:22px; border-radius:50%; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary); font-size:10px; font-weight:800; border:1px solid var(--color-border-light);">C</div>
              `}
              <span style="font-size:12px; font-weight:800; color:var(--color-text-secondary);"><span style="color:var(--color-text-tertiary); font-weight:700;">Cliente:</span> ${o.userName || 'Cliente'} (ID: ${o.goId || clientProfile?.displayId || '---'})</span>
            </div>
            <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary);">
              ${o.paymentMethod === 'mercadopago' ? 'Transferencia' : 'Efectivo'}
            </div>
          </div>

          <!-- Colorful High-End Quick Action Buttons Row -->
          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:14px; padding-top:12px; border-top:1.5px dashed var(--color-border-light);" onclick="event.stopPropagation();">
            <!-- 1. Liberar Button (Vibrant Coral/Red) -->
            <button class="order-quick-action-btn reassign-btn" data-order-id="${o.id}" style="height:36px; padding:0 8px; border-radius:12px; border:1px solid rgba(239,68,68,0.25); background:linear-gradient(135deg, rgba(239,68,68,0.12), rgba(220,38,38,0.06)); color:#dc2626; font-size:11.5px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1); box-shadow:0 2px 6px rgba(239,68,68,0.08);" title="Liberar pedido para asignar a otro repartidor">
              <span style="display:flex;">${icon('refreshCw', 13)}</span>
              <span>Liberar</span>
            </button>
            
            <!-- 2. Chat Button (Vibrant Cyan/Blue) -->
            <button class="order-quick-action-btn chat-btn" data-order-id="${o.id}" style="height:36px; padding:0 8px; border-radius:12px; border:1px solid rgba(14,165,233,0.25); background:linear-gradient(135deg, rgba(14,165,233,0.12), rgba(2,132,199,0.06)); color:#0284c7; font-size:11.5px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1); box-shadow:0 2px 6px rgba(14,165,233,0.08);" title="Abrir Chat del Pedido">
              <span style="display:flex;">${icon('chatBubble', 13)}</span>
              <span>Chat</span>
            </button>
            
            <!-- 3. En Vivo Button (Vibrant Emerald/Green) -->
            <button class="order-quick-action-btn track-btn" data-order-id="${o.id}" style="height:36px; padding:0 8px; border-radius:12px; border:1px solid rgba(34,197,94,0.25); background:linear-gradient(135deg, rgba(34,197,94,0.12), rgba(22,163,74,0.06)); color:#15803d; font-size:11.5px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1); box-shadow:0 2px 6px rgba(34,197,94,0.08);" title="Ver Seguimiento en Vivo">
              <span style="display:flex;">${icon('mapPin', 13)}</span>
              <span>En Vivo</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = htmlContent + `
    <div id="orders-scroll-sentinel" style="height: 50px; display: flex; align-items: center; justify-content: center; width: 100%; color: var(--color-text-tertiary); font-size: 12px; font-weight: 800; padding: 10px 0;">
      ${filtered.length >= currentLimit ? '<div class="loader-dots" style="margin: 5px auto;"><span></span><span></span><span></span></div>' : '— Fin del registro de ventas —'}
    </div>
  `;

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

  // Bind Quick Action Buttons Event Listeners
  document.querySelectorAll('.order-quick-action-btn.reassign-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (!orderId) return;
      await openReleaseDriverModal(orderId);
    };
  });

  document.querySelectorAll('.order-quick-action-btn.chat-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (!orderId) return;
      const { openChat } = await import('../../components/chat.js');
      openChat({
        orderId,
        type: 'client-delivery',
        otherName: 'Chat del Pedido',
        orderNum: orderId.slice(0, 6),
        senderDisplayName: 'Admin',
        isAudit: true
      });
    };
  });

  document.querySelectorAll('.order-quick-action-btn.track-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (!orderId) return;
      const { showModal } = await import('../../components/modal.js');
      const { renderOrderTracking } = await import('../order-tracking.js');
      const modalContent = document.createElement('div');
      modalContent.style.cssText = 'padding: 0; width: 100%; height: 100%; overflow-y: auto;';
      
      showModal({
        title: `Seguimiento en Vivo - #${orderId.slice(0, 6)}`,
        content: modalContent,
        fullscreen: true,
        height: '100%'
      });
      
      renderOrderTracking(orderId, modalContent, true);
    };
  });

  if (infiniteObserver) {
    infiniteObserver.disconnect();
    infiniteObserver = null;
  }

  if (filtered.length >= currentLimit) {
    const sentinel = document.getElementById('orders-scroll-sentinel');
    if (sentinel) {
      infiniteObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          infiniteObserver.disconnect();
          infiniteObserver = null;
          currentLimit += 50;
          loadAllOrders();
        }
      }, { threshold: 0.1 });
      infiniteObserver.observe(sentinel);
    }
  }
}

function getStatusKey(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('pend')) return 'pending';
  if (s.includes('confir') || s.includes('prepar')) return 'confirmed';
  if (s.includes('ready')) return 'ready';
  if (s.includes('accept')) return 'accepted';
  if (s.includes('camino') || s.includes('delivering')) return 'delivering';
  if (s.includes('entreg') || s.includes('complet')) return 'completed';
  if (s.includes('cancel')) return 'cancelled';
  return 'pending';
}

window.showOrderDetail = async (idOrObject) => {
  let o = typeof idOrObject === 'string' ? allOrders.find(item => item.id === idOrObject) : idOrObject;
  if (!o && typeof idOrObject === 'string') {
    // Try to fetch from Firestore if not in local allOrders
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('../../firebase.js');
    const snap = await getDoc(doc(db, 'orders', idOrObject));
    if (snap.exists()) o = { id: snap.id, ...snap.data() };
  }
  const isProductsPending = o.isFavor && (o.favorType === 'compra' || o.favorType === 'mandado') && !o.subtotal;
  const subtotalDisplay = isProductsPending ? 'Pendiente' : formatPrice(o.subtotal || 0);
  const parsedStores = o.isFavor ? parseFavorDetails(o.details || o.description) : [];
  const hasCommerce = !o.isTrip && (!o.isFavor || (o.isFavor && o.favorType !== 'gocash' && o.favorType !== 'encomienda' && o.comercioName));

  const formatTime = (ts) => {
    if (!ts) return null;
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const steps = [
    { label: 'Pedido Creado', time: formatTime(o.createdAt), icon: 'clock', color: '#3498DB', bg: 'rgba(52, 152, 219, 0.1)' }
  ];

  if (!o.isTrip && !o.isFavor) {
    steps.push({ label: 'Confirmado por Comercio', time: formatTime(o.confirmedAt), icon: 'checkCircle', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' });
  }

  steps.push({
    label: 'Asignado a Repartidor',
    time: (o.driverId || o.driverName) ? formatTime(o.acceptedAt || o.driverAssignedAt) : null,
    icon: 'user',
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.1)'
  });

  steps.push({ label: 'Retirado (En Camino)', time: formatTime(o.pickedUpAt), icon: 'truck', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)' });
  steps.push({ label: 'Entregado con Éxito', time: formatTime(o.deliveredAt || o.completedAt), icon: 'check', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' });

  if (o.status === 'cancelled' || o.cancelledAt) {
    const cancelledByMap = {
      'client':   { label: 'Cancelado por el Cliente',     emoji: '👤' },
      'comercio': { label: 'Cancelado por el Comercio',    emoji: '🏪' },
      'admin':    { label: 'Cancelado por el Admin',       emoji: '🛡️' },
      'system':   { label: 'Cancelado automáticamente',   emoji: '🤖' },
    };
    const cancelActor = cancelledByMap[o.cancelledBy] || { label: o.cancelledBy ? `Cancelado por: ${o.cancelledBy}` : 'Cancelado (motivo desconocido)', emoji: '❌' };
    steps.push({
      label: `${cancelActor.emoji} ${cancelActor.label}`,
      time: formatTime(o.cancelledAt),
      icon: 'xCircle',
      color: '#EF4444',
      bg: 'rgba(239, 68, 68, 0.1)'
    });
  }

  const timelineHtml = `
    <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border); border-radius:24px; padding:20px; margin-bottom:20px; box-shadow:var(--shadow-sm);">
      <h3 style="font-size:11px; font-weight:900; text-transform:uppercase; color:var(--color-text-tertiary); margin-bottom:18px; letter-spacing:0.05em;">Cronología de Estados</h3>
      <div style="display:flex; flex-direction:column; gap:16px; position:relative; padding-left:14px;">
        <!-- Vertical Line -->
        <div style="position:absolute; left:23px; top:10px; bottom:10px; width:2px; background:var(--color-border-light); z-index:1;"></div>
        
        ${steps.map((step, idx) => {
          let timeDisplay = step.time;
          let isDone = !!timeDisplay;
          
          // If a later step is completed, this step must have happened
          const subsequentDone = steps.slice(idx + 1).some(s => !!s.time);
          if (subsequentDone && !isDone) {
            isDone = true;
            timeDisplay = 'Confirmado';
          }
          
          return `
            <div style="display:flex; align-items:center; justify-content:space-between; position:relative; z-index:2;">
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:22px; height:22px; border-radius:50%; background:${isDone ? step.bg : 'var(--color-bg-secondary)'}; border:2px solid ${isDone ? step.color : 'var(--color-border)'}; display:flex; align-items:center; justify-content:center; color:${isDone ? step.color : 'var(--color-text-tertiary)'}; flex-shrink:0;">
                  ${icon(step.icon, 10)}
                </div>
                <span style="font-size:13px; font-weight:700; color:${isDone ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)'};">${step.label}</span>
              </div>
              <span style="font-size:12px; font-weight:800; color:${isDone ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)'}; font-family:var(--font-display);">${timeDisplay || 'Pendiente'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  const detailHtml = document.createElement('div');
  detailHtml.style.cssText = 'flex:1; overflow-y:auto; padding:20px; scrollbar-width:none;';
  detailHtml.innerHTML = `
    <div style="text-align:center; margin-bottom:24px;">
       <div style="display:inline-block; padding:4px 12px; background:var(--color-bg-secondary); border-radius:10px; font-size:10px; font-weight:900; color:var(--color-text-tertiary); margin-bottom:8px;">AUDITORÍA #${o.orderId}</div>
       <h2 style="font-size:26px; font-weight:900; margin:0; letter-spacing:-0.03em;">Desglose Comercial</h2>
    </div>

    ${timelineHtml}

    <!-- Product List -->
    <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border); border-radius:24px; padding:20px; margin-bottom:20px;">
       <h3 style="font-size:11px; font-weight:900; text-transform:uppercase; color:var(--color-text-tertiary); margin-bottom:15px; letter-spacing:0.05em;">Detalles del Pedido / Mandado</h3>
       
       ${o.isFavor ? `
         <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:15px;">
           ${parsedStores.length > 0 ? parsedStores.map((s, idx) => `
             <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:16px;">
               <div style="font-weight:900; font-size:13px; color:var(--color-primary); display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                 🏪 Comercio ${idx + 1}: <span style="color:var(--color-text);">${s.name}</span>
               </div>
               <div style="font-size:13px; font-weight:700; color:var(--color-text-secondary); white-space:pre-line; line-height:1.4;">
                 ${s.items || 'Sin detalles'}
               </div>
             </div>
           `).join('') : `
             <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:16px;">
               <div style="font-size:13px; font-weight:700; color:var(--color-text-secondary); white-space:pre-line; line-height:1.4;">
                 ${o.details || o.description || 'Sin detalles'}
               </div>
             </div>
           `}
         </div>
       ` : `
         <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:15px;">
           ${o.items?.map(i => `
             <div style="display:flex; justify-content:space-between; font-weight:700; font-size:14px;">
               <span style="color:var(--color-text);"><span style="color:var(--color-primary);">${i.qty}x</span> ${i.name}</span>
               <span style="color:var(--color-text-secondary);">${formatPrice(i.price * i.qty)}</span>
             </div>
           `).join('') || '<p style="text-align:center; opacity:0.5;">Sin productos</p>'}
         </div>
       `}
       
       <div style="border-top:1px dashed var(--color-border); padding-top:15px; display:flex; flex-direction:column; gap:8px;">
         <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-text-tertiary);">
           <span>Subtotal Productos</span>
           <span style="font-weight:800; color:${isProductsPending ? '#d97706' : 'var(--color-text-secondary)'};">${subtotalDisplay}</span>
         </div>
         ${o.pointsRedeemed > 0 ? `
           <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:#a855f7;">
             <span>Puntos Usados (${o.pointsRedeemed.toLocaleString('es-AR')} pts)</span>
             <span>-${formatPrice(o.discountAmount || 0)}</span>
           </div>
         ` : ''}
         ${o.couponCode ? `
           <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:#a855f7;">
             <span>Cupón Usado (${o.couponCode})</span>
             <span>-${formatPrice(o.couponDiscount || 0)}</span>
           </div>
         ` : ''}
         <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-text-tertiary);">
           <span>Costo de Envío</span>
           <span style="color:var(--color-success);">${formatPrice((o.deliveryCost || 0) - (o.rainSurcharge || 0))}</span>
         </div>
         ${(o.rainSurcharge || 0) > 0 ? `
           <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:#009EE3;">
             <span>Recargo por Lluvia 🌧️</span>
             <span style="font-weight:800;">+${formatPrice(o.rainSurcharge)}</span>
           </div>
         ` : ''}
         ${o.isFavor ? `
           <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-text-tertiary);">
             <span>Tarifa de Gestión (Mandado)</span>
             <span>${formatPrice(o.purchaseFee || 0)}</span>
           </div>
           ${o.extraStopsFee ? `
             <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-text-tertiary);">
               <span>Paradas Extra</span>
               <span>${formatPrice(o.extraStopsFee)}</span>
             </div>
           ` : ''}
         ` : ''}
         <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-text-tertiary);">
           <span>Tarifa de Servicio (App)</span>
           <span>${formatPrice(o.appUsageFee || 0)}</span>
         </div>
         ${o.tip || o.tipAmount ? `
           <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-text-tertiary);">
             <span>Propina</span>
             <span>${formatPrice(o.tip || o.tipAmount || 0)}</span>
           </div>
         ` : ''}
         <div style="margin-top:10px; padding-top:15px; border-top:2px solid var(--color-border); display:flex; justify-content:space-between; font-size:24px; font-weight:900; color:var(--color-primary);">
           <span>Total Final</span>
           <span>${formatPrice(o.total || 0)}</span>
         </div>
       </div>
    </div>

    <!-- Platform Economy (Internal Audit) -->
    <div style="background:var(--color-primary-light); border:1px solid rgba(227,27,35,0.1); border-radius:24px; padding:20px; margin-bottom:20px;">
       <h3 style="font-size:11px; font-weight:900; text-transform:uppercase; color:var(--color-primary); margin-bottom:15px; letter-spacing:0.05em;">Economía GoDelivery</h3>
       <div style="display:flex; flex-direction:column; gap:12px;">
         <div style="display:flex; justify-content:space-between; align-items:center;">
           <div>
             <div style="font-size:13px; font-weight:800; color:var(--color-text);">Comisión Comercio</div>
             <div style="font-size:10px; font-weight:700; color:var(--color-text-tertiary);">Retención por venta</div>
           </div>
           <span style="font-weight:900; font-size:16px; color:var(--color-primary);">${formatPrice(o.commissionAmount || 0)}</span>
         </div>
         <div style="display:flex; justify-content:space-between; align-items:center;">
           <div>
             <div style="font-size:13px; font-weight:800; color:var(--color-text);">Tarifa Operativa</div>
             <div style="font-size:10px; font-weight:700; color:var(--color-text-tertiary);">Ingreso directo plataforma</div>
           </div>
           <span style="font-weight:900; font-size:16px; color:var(--color-primary);">${formatPrice(o.appUsageFee || 0)}</span>
         </div>
       </div>
    </div>

    <!-- Logistics & Participants -->
    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">
       <!-- Cliente Card -->
       <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; gap:16px;">
         <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
           <div style="width:40px; height:40px; border-radius:50%; background:var(--color-bg-secondary); overflow:hidden; border:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
             <img id="audit-client-img" style="width:100%; height:100%; object-fit:cover; display:none;" />
             <div id="audit-client-placeholder" style="font-weight:900; font-size:16px; color:var(--color-text-tertiary); display:block;">
               ${(o.userName || 'U')[0].toUpperCase()}
             </div>
           </div>
           <div style="min-width:0; flex:1;">
             <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">Cliente</div>
             <div style="font-weight:900; font-size:15px; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${o.userName}</div>
             <div id="audit-client-goid" style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); margin-top:2px;">ID: ${o.goId || 'Cargando...'}</div>
           </div>
         </div>
         <div id="audit-client-wa-container" style="flex-shrink:0;">
           ${o.userPhone ? `
             <a href="https://wa.me/${o.userPhone.replace(/\D/g, '').startsWith('54') ? o.userPhone.replace(/\D/g, '') : '54' + o.userPhone.replace(/\D/g, '')}" target="_blank" style="display:flex; align-items:center; gap:6px; padding:8px 16px; border-radius:12px; background:#25D366; color:white; font-size:12.5px; font-weight:800; text-decoration:none; box-shadow:0 4px 12px rgba(37,211,102,0.25); transition:all 0.2s;" onmouseover="this.style.opacity='0.9'; this.style.transform='translateY(-1px)';" onmouseout="this.style.opacity='1'; this.style.transform='none';">
               ${icon('whatsapp', 14, '', '#FFF')} WhatsApp
             </a>
           ` : ''}
         </div>
       </div>

       <!-- Repartidor Card -->
       <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; gap:16px;">
         <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
           <div style="width:40px; height:40px; border-radius:50%; background:var(--color-bg-secondary); overflow:hidden; border:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
             <img id="audit-driver-img" style="width:100%; height:100%; object-fit:cover; display:none;" />
             <div id="audit-driver-placeholder" style="font-weight:900; font-size:16px; color:var(--color-text-tertiary); display:block;">
               ${(o.driverId || o.queueTargetDriverId) ? ((o.driverName || o.queueTargetDriverName || 'R')[0].toUpperCase()) : '?'}
             </div>
           </div>
           <div style="min-width:0; flex:1;">
             <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">Repartidor</div>
             <div style="font-weight:900; font-size:15px; color:var(--color-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${o.driverName || (o.queueTargetDriverName ? (() => {
                  const nowMs = Date.now() + (getState().serverTimeOffset || 0);
                  const offeredAtMs = o.queueOfferedAt ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime()) : nowMs;
                  const elapsedSec = Math.floor((nowMs - offeredAtMs) / 1000);
                  const remainingSec = Math.max(0, 30 - elapsedSec);
                  return `⏳ Ofrecido: ${o.queueTargetDriverName} <span class="admin-offer-timer" data-offered-at="${offeredAtMs}" style="background:rgba(245,158,11,0.2); color:#b45309; padding:1px 6px; border-radius:6px; font-weight:900; margin-left:4px;">${remainingSec}s</span>`;
                })() : 'Sin asignar')}
             </div>
             <div id="audit-driver-goid" style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); margin-top:2px;">ID: ${o.driverDlId || (o.driverId ? 'Cargando...' : '---')}</div>
           </div>
         </div>
         <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
           ${(o.driverId || o.queueTargetDriverId) && o.status !== 'delivered' && o.status !== 'completed' && o.status !== 'cancelled' ? `
             <button id="admin-release-driver-btn" data-order-id="${o.id}" style="display:flex; align-items:center; gap:5px; padding:8px 14px; border-radius:12px; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.25); font-size:12px; font-weight:900; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(239,68,68,0.1)'">
               🔓 Liberar
             </button>
           ` : ''}
           ${o.driverId ? `
             <button id="btn-msg-support-driver" style="display:flex; align-items:center; gap:6px; padding:8px 14px; border-radius:12px; background:rgba(225,29,72,0.08); color:var(--color-primary); border:none; font-size:12.5px; font-weight:800; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 12px rgba(225,29,72,0.15);" onmouseover="this.style.transform='translateY(-1px)';" onmouseout="this.style.transform='none';">
               ${icon('send', 14)} Chat
             </button>
           ` : ''}
         </div>
       </div>
    </div>

    <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:20px; margin-bottom:20px;">
       <div style="display:flex; justify-content:space-between; margin-bottom:12px; align-items:flex-start;">
         <span style="font-size:12px; font-weight:700; opacity:0.6; flex-shrink:0;">Punto de Retiro:</span>
         <span style="font-size:12px; font-weight:850; text-align:right; max-width:210px; color:#16a34a; word-break:break-word;">
           📍 ${o.pickupAddress || o.comercioAddress || o.originAddress || getComercioDisplayName(o) || 'Punto de Retiro'}
         </span>
       </div>
       <div style="display:flex; justify-content:space-between; margin-bottom:12px; align-items:flex-start;">
         <span style="font-size:12px; font-weight:700; opacity:0.6; flex-shrink:0;">Punto de Entrega:</span>
         <span style="font-size:12px; font-weight:850; text-align:right; max-width:210px; color:#e11d48; word-break:break-word;">
           🎯 ${o.deliveryAddress || o.destinationAddress || 'Dirección de Entrega'}
         </span>
       </div>
       <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
         <span style="font-size:12px; font-weight:700; opacity:0.6;">Método de Pago:</span>
         <span style="font-size:12px; font-weight:800; text-transform:uppercase;">${o.paymentMethod || 'Efectivo'}</span>
       </div>
       <div style="display:flex; justify-content:space-between; border-top:1px dashed var(--color-border-light); padding-top:12px;">
         <span style="font-size:12px; font-weight:700; opacity:0.6;">Código de Entrega:</span>
         <span style="font-size:12px; font-weight:800; color:${(o.favorType === 'encomienda' || o.serviceType === 'encomienda') ? 'var(--color-text-tertiary)' : (o.verificationCode ? 'var(--color-primary)' : 'var(--color-text-tertiary)')}; letter-spacing: ${(o.favorType === 'encomienda' || o.serviceType === 'encomienda') ? 'normal' : (o.verificationCode ? '2px' : 'normal')};">
           ${(o.favorType === 'encomienda' || o.serviceType === 'encomienda') ? 'No requiere código (Encomienda)' : (o.verificationCode || 'Pendiente / No disponible')}
         </span>
       </div>
    </div>

    <!-- Auditory Chats -->
    <div style="display:grid; grid-template-columns:${hasCommerce ? '1fr 1fr' : '1fr'}; gap:12px; margin-bottom:30px; padding-bottom:10px;">
       ${hasCommerce ? `
         <button class="btn-chat-audit" data-type="client-commerce" data-other="${o.comercioName}" style="height:54px; border-radius:18px; background:var(--color-bg-secondary); border:1px solid var(--color-border); color:var(--color-text); font-weight:900; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
           ${icon('messageSquare', 18)} CHAT COMERCIO
         </button>
       ` : ''}
       <button class="btn-chat-audit" data-type="client-delivery" data-other="${o.driverName || 'Delivery'}" style="height:54px; border-radius:18px; background:var(--color-bg-secondary); border:1px solid var(--color-border); color:var(--color-text); font-weight:900; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
         ${icon('bike', 18)} CHAT DELIVERY
       </button>
    </div>
  `;

  showModal({
    title: 'Estación de Auditoría',
    content: detailHtml,
    footer: `
      <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
        <button id="admin-live-tracking-btn" class="btn" style="width:100%; height:54px; border-radius:18px; font-weight:900; background:linear-gradient(135deg, #2563eb, #1d4ed8); color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 15px rgba(37,99,235,0.3);">
          ${icon('navigationArrow', 20)} SEGUIMIENTO EN TIEMPO REAL (GPS)
        </button>
        ${o.status !== 'cancelled' && o.status !== 'completed' && o.status !== 'entregado' ? `
          <button id="admin-cancel-order-btn" class="btn" style="width:100%; height:54px; border-radius:18px; font-weight:900; background:#E74C3C; color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${icon('xCircle', 20)} CANCELAR PEDIDO
          </button>
        ` : ''}
        <button id="admin-delete-order-btn" class="btn" style="width:100%; height:54px; border-radius:18px; font-weight:900; background:linear-gradient(135deg, #111827, #1f2937); color:#EF4444; border:1px solid #EF4444; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
          ${icon('trash', 20)} ELIMINAR PEDIDO (BORRAR DB)
        </button>
        <button id="close-audit-modal" class="btn btn-primary" style="width:100%; height:54px; border-radius:18px; font-weight:900;">
          CERRAR AUDITORÍA
        </button>
      </div>
    `,
    onOpen: () => {
      // Live tracking button handler
      const trackingBtn = document.getElementById('admin-live-tracking-btn');
      if (trackingBtn) {
        trackingBtn.onclick = async () => {
          const { showDeliveryMapModal } = await import('../../components/delivery-map-modal.js');
          showDeliveryMapModal(o);
        };
      }
      // Load client profile
      if (o.userId) {
        getOrFetchUserProfile(o.userId).then((profile) => {
          const clientImg = document.getElementById('audit-client-img');
          if (clientImg && profile?.photo) {
            clientImg.src = profile.photo;
            clientImg.style.display = 'block';
            const clientPlaceholder = document.getElementById('audit-client-placeholder');
            if (clientPlaceholder) clientPlaceholder.style.display = 'none';
          }
          const clientGoId = document.getElementById('audit-client-goid');
          if (clientGoId && profile?.displayId) {
            clientGoId.textContent = `ID: ${profile.displayId}`;
          }
        });
      }

      // Load driver profile
      if (o.driverId) {
        getOrFetchUserProfile(o.driverId).then((profile) => {
          const driverImg = document.getElementById('audit-driver-img');
          if (driverImg && profile?.photo) {
            driverImg.src = profile.photo;
            driverImg.style.display = 'block';
            const driverPlaceholder = document.getElementById('audit-driver-placeholder');
            if (driverPlaceholder) driverPlaceholder.style.display = 'none';
          }
          const driverGoId = document.getElementById('audit-driver-goid');
          if (driverGoId && (profile?.displayId || o.driverDlId)) {
            driverGoId.textContent = `ID: ${o.driverDlId || profile.displayId}`;
          }
        });
      }

      // Release driver button handler
      const releaseBtn = document.getElementById('admin-release-driver-btn');
      if (releaseBtn) {
        releaseBtn.addEventListener('click', async () => {
          await openReleaseDriverModal(o);
        });
      }

      // Close modal handler inside onOpen
      const closeBtn = document.getElementById('close-audit-modal');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      // Delete button handler (Erases order completely from DB)
      const deleteBtn = document.getElementById('admin-delete-order-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          const { showConfirm } = await import('../../components/modal.js');
          showConfirm({
            title: '⚠️ ¿ELIMINAR PEDIDO POR COMPLETO? (DB)',
            message: `¿Estás completamente seguro de que deseas ELIMINAR permanentemente el pedido #${o.orderId || '---'}? Se borrará de la base de datos y no computará en los montos facturados, desapareciendo como si nunca hubiera existido. Esta acción no se puede deshacer.`,
            danger: true,
            onConfirm: async () => {
              const { showToast } = await import('../../components/toast.js');
              try {
                const { deleteDoc, doc: fDoc } = await import('firebase/firestore');
                await deleteDoc(fDoc(db, 'orders', o.id));
                closeModal();
                showToast('Pedido eliminado definitivamente de la base de datos.', 'success');
                // Refresh list
                location.reload();
              } catch (err) {
                console.error('[Admin Delete] Error:', err);
                showToast('Error al eliminar el pedido: ' + err, 'danger');
              }
            }
          });
        });
      }

      // Cancel button handler inside onOpen
      const cancelBtn = document.getElementById('admin-cancel-order-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          const { showModal, closeModal: closeCancelModal } = await import('../../components/modal.js');
          const { showToast } = await import('../../components/toast.js');
          
          const modalDiv = document.createElement('div');
          modalDiv.style.cssText = 'padding:24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg); border-radius:24px;';
          modalDiv.innerHTML = `
            <div style="text-align:center;">
              <div style="font-size:32px; margin-bottom:8px;">🚨</div>
              <h3 style="font-size:18px; font-weight:900; color:var(--color-text-primary); margin:0;">Cancelar Pedido #${o.orderId || '---'}</h3>
              <p style="font-size:13px; color:var(--color-text-tertiary); margin:6px 0 0;">Ingresá el motivo de la cancelación. Se le enviará esta explicación al cliente junto a su notificación.</p>
            </div>

            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Motivo de cancelación (Obligatorio)</label>
              <textarea id="admin-cancel-reason-input" placeholder="Ej: El local se encuentra sin stock del producto seleccionado..." style="width:100%; height:90px; border-radius:14px; border:1.5px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text-primary); padding:12px; font-size:13px; font-weight:600; outline:none; resize:none; font-family:inherit;"></textarea>
            </div>

            <div style="display:flex; gap:10px; width:100%; margin-top:8px;">
              <button id="cancel-reason-abort-btn" class="btn btn-ghost" style="flex:1; height:48px; border-radius:14px; font-weight:800; font-size:13px;">Volver</button>
              <button id="cancel-reason-confirm-btn" class="btn btn-danger" style="flex:1.5; height:48px; border-radius:14px; font-weight:900; font-size:13px; background:#EF4444; color:white; border:none; box-shadow:0 6px 18px rgba(239,68,68,0.35);">Confirmar Cancelación</button>
            </div>
          `;

          showModal({
            title: 'Motivo de Cancelación',
            content: modalDiv,
            hideHeader: true,
            height: 'auto'
          });

          document.getElementById('cancel-reason-abort-btn').onclick = () => closeCancelModal();

          document.getElementById('cancel-reason-confirm-btn').onclick = async () => {
            const reasonInput = document.getElementById('admin-cancel-reason-input');
            const reason = reasonInput ? reasonInput.value.trim() : '';

            if (!reason) {
              if (reasonInput) {
                reasonInput.style.borderColor = '#EF4444';
                reasonInput.focus();
              }
              showToast('Por favor explicá el motivo de la cancelación.', 'warning');
              return;
            }

            const confirmBtnEl = document.getElementById('cancel-reason-confirm-btn');
            confirmBtnEl.disabled = true;
            confirmBtnEl.innerHTML = 'Cancelando...';

            try {
              const { getDoc, updateDoc, addDoc, collection, doc: fDoc, serverTimestamp, increment } = await import('firebase/firestore');
              
              const orderRef = fDoc(db, 'orders', o.id);
              const orderSnap = await getDoc(orderRef);
              if (!orderSnap.exists()) throw "El pedido no existe.";

              const orderData = orderSnap.data();

              // 1. Update order status and cancel reason
              await updateDoc(orderRef, {
                status: 'cancelled',
                cancelledAt: serverTimestamp(),
                cancelledBy: 'admin',
                cancelReason: reason
              });

              // 2. Restore points if redeemed
              if (orderData.pointsRedeemed > 0 && orderData.userId) {
                const userRef = fDoc(db, 'users', orderData.userId);
                await updateDoc(userRef, {
                  points: increment(orderData.pointsRedeemed)
                }).catch(e => console.warn('Error restoring points:', e));
              }

              // 3. Dispatch notification to customer with explicit cancel reason
              if (orderData.userId) {
                await addDoc(collection(db, 'users', orderData.userId, 'notifications'), {
                  title: '❌ Tu pedido fue cancelado',
                  body: `Motivo: ${reason}`,
                  type: 'order_cancelled',
                  orderId: o.id,
                  status: 'unread',
                  createdAt: serverTimestamp()
                }).catch(e => console.warn('Error sending user cancel notification:', e));
              }

              closeCancelModal();
              closeModal();
              showToast('Pedido cancelado y cliente notificado.', 'success');
            } catch (err) {
              console.error('[Admin Cancel] Error:', err);
              showToast('Error al cancelar el pedido: ' + err, 'danger');
              if (confirmBtnEl) {
                confirmBtnEl.disabled = false;
                confirmBtnEl.innerHTML = 'Confirmar Cancelación';
              }
            }
          };
        });
      }
    }
  });

  // Load client GO-ID dynamically
  if (o.userId) {
    getDoc(doc(db, 'users', o.userId)).then(snap => {
      if (snap.exists()) {
        const u = snap.data();
        const clientBadge = document.getElementById('audit-client-goid');
        if (clientBadge) clientBadge.textContent = `ID: ${u.goPointsId || u.goId || 'Sin ID'}`;

        // Update client WhatsApp link if not present on order document
        const phone = u.phone || u.phoneNumber || '';
        if (phone && !o.userPhone) {
          const clean = phone.replace(/\D/g, '');
          const url = `https://wa.me/${clean.startsWith('54') ? clean : '54' + clean}`;
          const waContainer = document.getElementById('audit-client-wa-container');
          if (waContainer) {
            waContainer.innerHTML = `
              <a href="${url}" target="_blank" style="display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:10px; background:#25D366; color:white; font-size:11px; font-weight:800; text-decoration:none; box-shadow:0 2px 8px rgba(37,211,102,0.25); transition:all 0.2s;" onmouseover="this.style.opacity='0.9';" onmouseout="this.style.opacity='1';">
                ${icon('whatsapp', 13, '', '#FFF')} WhatsApp
              </a>
            `;
          }
        }
      }
    }).catch(() => {});
  } else {
    const clientBadge = document.getElementById('audit-client-goid');
    if (clientBadge) clientBadge.textContent = 'ID: ---';
  }

  // Load driver DL-ID dynamically
  if (o.driverId) {
    getDoc(doc(db, 'users', o.driverId)).then(snap => {
      if (snap.exists()) {
        const u = snap.data();
        const driverBadge = document.getElementById('audit-driver-goid');
        if (driverBadge) driverBadge.textContent = `ID: ${u.deliveryId || u.goId || 'Sin ID'}`;
      }
    }).catch(() => {});
  }

  // Handle direct support message to driver
  document.getElementById('btn-msg-support-driver')?.addEventListener('click', async () => {
    openAdminToDriverSupportChatModal(o.driverId, o.driverName || 'Repartidor', o.id, o.orderId);
  });

  detailHtml.querySelectorAll('.btn-chat-audit').forEach(btn => {
    btn.onclick = async () => {
      if (o.source === 'whatsapp_bot' && o.userPhone) {
        const cleanPhone = o.userPhone.replace(/\D/g, '');
        const fullPhone = cleanPhone.startsWith('54') ? cleanPhone : `54${cleanPhone}`;
        window.open(`https://wa.me/${fullPhone}`, '_blank');
        return;
      }
      const { openChat } = await import('../../components/chat.js');
      openChat({
        orderId: o.id,
        orderNum: o.orderId,
        type: btn.dataset.type,
        otherName: btn.dataset.other,
        senderDisplayName: 'Admin (Audit)',
        isAudit: true
      });
    };
  });
};

async function openAdminToDriverSupportChatModal(driverId, driverName, orderId, orderNum) {
  const { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, serverTimestamp, addDoc, collection } = await import('firebase/firestore');
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');
  
  const ticketDocId = `ticket_${orderId}`;
  const chatRef = doc(db, 'support_chats', ticketDocId);
  
  // Render structure inside modal
  const chatContainer = document.createElement('div');
  chatContainer.style.cssText = 'display:flex; flex-direction:column; height:80dvh; background:var(--color-bg); overflow:hidden;';
  chatContainer.innerHTML = `
    <!-- Header -->
    <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border); padding:16px 20px; display:flex; align-items:center; gap:12px; flex-shrink:0;">
      <div style="width:40px; height:40px; border-radius:50%; background:rgba(225,29,72,0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; font-weight:900; font-size:16px;">
        ${icon('bike', 20)}
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:900; font-size:14.5px; color:var(--color-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Soporte: ${driverName}</div>
        <div style="font-size:11px; font-weight:700; color:var(--color-text-tertiary);">Repartidor</div>
      </div>
    </div>
    <!-- Messages Box -->
    <div id="support-modal-messages" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; background:var(--color-bg-secondary);">
      <div style="text-align:center; padding:40px 10px; color:var(--color-text-tertiary); font-weight:600; font-size:13px;">
        Iniciá la conversación escribiendo un mensaje abajo.
      </div>
    </div>
    <!-- Input Footer -->
    <div style="padding:12px 20px; background:var(--color-surface); border-top:1px solid var(--color-border); display:flex; gap:10px; align-items:center; flex-shrink:0;">
      <input type="text" id="support-modal-input" placeholder="Escribí tu mensaje..." style="flex:1; height:46px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 16px; font-weight:700; font-size:13.5px; outline:none; background:var(--color-bg); color:var(--color-text);" />
      <button id="support-modal-send-btn" style="width:46px; height:46px; border-radius:14px; border:none; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 15px rgba(var(--color-primary-rgb),0.25);">
        ${icon('send', 20)}
      </button>
    </div>
  `;

  const modalInstance = showModal({
    title: '',
    content: chatContainer,
    hideHeader: true,
    height: '80dvh'
  });

  const messagesBox = chatContainer.querySelector('#support-modal-messages');
  const inputEl = chatContainer.querySelector('#support-modal-input');
  const sendBtn = chatContainer.querySelector('#support-modal-send-btn');

  // Real-time messages listener
  let unsub = onSnapshot(chatRef, (docSnap) => {
    if (docSnap.exists()) {
      const chatData = docSnap.data();
      const messages = chatData.messages || [];
      if (messages.length > 0) {
        messagesBox.innerHTML = messages.map(msg => {
          const isAdmin = msg.sender === 'admin';
          return `
            <div style="display:flex; flex-direction:column; align-items:${isAdmin ? 'flex-end' : 'flex-start'}; gap:4px;">
              <div style="max-width:80%; padding:10px 14px; border-radius:${isAdmin ? '16px 16px 4px 16px' : '16px 16px 16px 4px'}; background:${isAdmin ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${isAdmin ? 'white' : 'var(--color-text)'}; font-size:13.5px; font-weight:700; word-break:break-word; box-shadow:var(--shadow-sm);">
                ${msg.text}
              </div>
              <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); margin:0 4px;">
                ${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          `;
        }).join('');
        messagesBox.scrollTop = messagesBox.scrollHeight;
      }
    }
  });
  registerUnsubscribe(unsub);

  // Clean up snapshot listener on modal close
  modalInstance.onClose = () => {
    if (unsub) unsub();
  };

  const handleSend = async () => {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    try {
      const chatSnap = await getDoc(chatRef);
      const newMessage = {
        sender: 'admin',
        text: text,
        timestamp: Date.now()
      };

      if (!chatSnap.exists()) {
        const ticketNum = Math.floor(100000 + Math.random() * 900000);
        // Create support chat document in Firestore
        await setDoc(chatRef, {
          userId: driverId,
          userName: driverName,
          userRole: 'driver',
          status: 'open',
          ticketId: `#TK-${ticketNum}`,
          createdAt: serverTimestamp(),
          lastMessageText: text,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: false,
          unreadByUser: true,
          messages: [newMessage],
          activeOrderId: orderId || '',
          activeOrderNum: orderNum || ''
        });
      } else {
        await updateDoc(chatRef, {
          status: 'open',
          lastMessageText: text,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: false,
          unreadByUser: true,
          messages: arrayUnion(newMessage),
          activeOrderId: orderId || chatSnap.data().activeOrderId || '',
          activeOrderNum: orderNum || chatSnap.data().activeOrderNum || ''
        });
      }

      // Also trigger a push notification to the driver
      try {
        await addDoc(collection(db, 'users', driverId, 'notifications'), {
          title: '🚨 Mensaje de Soporte',
          body: text,
          type: 'system',
          status: 'unread',
          createdAt: serverTimestamp()
        });
      } catch (err) {}

    } catch (err) {
      console.error('Error sending support message:', err);
      showToast('Error al enviar mensaje', 'danger');
    }
  };

  sendBtn.onclick = handleSend;
  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') handleSend();
  };
}

export async function openReleaseDriverModal(idOrOrder) {
  const { getDocs, collection, query, where, doc, getDoc, updateDoc, setDoc, serverTimestamp, arrayUnion } = await import('firebase/firestore');
  const { db } = await import('../../firebase.js');
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');

  let o = typeof idOrOrder === 'object' && idOrOrder !== null ? idOrOrder : null;
  if (!o && typeof idOrOrder === 'string') {
    o = allOrders.find(item => item.id === idOrOrder);
    if (!o) {
      const snap = await getDoc(doc(db, 'orders', idOrOrder));
      if (snap.exists()) {
        o = { id: snap.id, ...snap.data() };
      }
    }
  }

  if (!o) {
    showToast('❌ Pedido no encontrado', 'error');
    return;
  }

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding:24px; background:var(--color-bg); display:flex; flex-direction:column; gap:16px;';
  modalContent.innerHTML = `<div class="loader-dots" style="margin:20px auto;"><span></span><span></span><span></span></div>`;

  showModal({
    title: 'Liberar y Asignar Pedido',
    content: modalContent
  });

  try {
    const driversSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'delivery')));
    const drivers = driversSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.isOnline === true);

    modalContent.innerHTML = `
      <div style="font-size:13.5px; color:var(--color-text-secondary); line-height:1.4;">
        ¿Cómo deseas liberar este pedido (#${o.orderNumber || o.id.slice(0,6)})? El repartidor actual se desvinculará del pedido.
      </div>

      <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Destino / Reasignación</label>
        <select id="v5-assign-driver-select" class="select" style="width:100%; height:48px; border-radius:14px; padding:0 12px; background:var(--color-bg-card); font-size:13.5px; font-weight:600; outline:none; border:1.5px solid var(--color-border-light);">
          <option value="rotation">🔄 Devolver a rotación general (ofrecer a otros)</option>
          ${drivers.map(d => `
            <option value="${d.uid}">${d.displayName || d.name || 'Repartidor'} (ID: ${d.displayId || '---'})</option>
          `).join('')}
        </select>
      </div>

      <div style="display:flex; gap:10px; margin-top:16px; border-top:1px solid var(--color-border-light); padding-top:16px;">
        <button class="btn btn-ghost" id="v5-cancel-release-btn" style="flex:1; height:48px; border-radius:14px; font-weight:800;">CANCELAR</button>
        <button class="btn btn-primary" id="v5-confirm-release-btn" style="flex:2; height:48px; border-radius:14px; font-weight:900;">CONFIRMAR LIBERACIÓN</button>
      </div>
    `;

    modalContent.querySelector('#v5-cancel-release-btn').onclick = () => closeModal();
    modalContent.querySelector('#v5-confirm-release-btn').onclick = async () => {
      const select = modalContent.querySelector('#v5-assign-driver-select');
      const destination = select.value;
      const confirmBtn = modalContent.querySelector('#v5-confirm-release-btn');

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = icon('loader', 14, 'animate-spin') + ' PROCESANDO...';

      try {
        const oldDriverId = o.driverId;

        if (destination === 'rotation') {
          // Standard release (rotation)
          const updateFields = {
            driverId: null,
            driverName: null,
            driverPhoto: null,
            driverPhone: null,
            queueTargetDriverId: null,
            queueTargetDriverName: null,
            queueOfferedAt: null,
            status: 'ready'
          };
          if (oldDriverId) {
            updateFields.queueRejectedDrivers = arrayUnion(oldDriverId);
          }
          await updateDoc(doc(db, 'orders', o.id), updateFields);

          // Reset chats
          try {
            const clientChatRef = doc(db, 'chats', `${o.id}_client-delivery`);
            const cdSnap = await getDoc(clientChatRef);
            if (cdSnap.exists()) {
              const cdData = cdSnap.data();
              const prevDriver = cdData.driverId || oldDriverId;
              const newParts = (cdData.participants || []).filter(p => p !== prevDriver && p !== oldDriverId);
              await updateDoc(clientChatRef, {
                driverId: null,
                driverName: null,
                participants: newParts
              });
            }
            const comChatRef = doc(db, 'chats', `${o.id}_commerce-delivery`);
            const comSnap = await getDoc(comChatRef);
            if (comSnap.exists()) {
              const comData = comSnap.data();
              const prevDriver = comData.driverId || oldDriverId;
              const newParts = (comData.participants || []).filter(p => p !== prevDriver && p !== oldDriverId);
              await updateDoc(comChatRef, {
                driverId: null,
                driverName: null,
                participants: newParts
              });
            }
          } catch (e) {
            console.warn('[Admin Release] Chat reset error:', e);
          }

          showToast('🔓 Pedido liberado con éxito. Se volvió a ofertar en rotación.', 'success');
          const { updateDispatchQueue } = await import('../delivery-panel.js');
          updateDispatchQueue(o.id);

        } else {
          // Re-offer exclusively to selected driver in rotation (rotar / ofertar sin auto-asignar)
          const selectedDriver = drivers.find(d => d.uid === destination);
          if (!selectedDriver) throw new Error('Repartidor no encontrado');

          const updateFields = {
            driverId: null,
            driverName: null,
            driverPhoto: null,
            driverPhone: null,
            driverDlId: null,
            driverAlias: null,
            driverVehicleModel: null,
            driverVehicleColor: null,
            driverVehiclePatent: null,
            queueTargetDriverId: selectedDriver.uid,
            queueTargetDriverName: selectedDriver.displayName || selectedDriver.name || 'Repartidor',
            queueOfferedAt: serverTimestamp(),
            directDriverUid: selectedDriver.uid,
            status: (o.isFavor || o.isTrip) ? 'pending' : 'ready'
          };

          if (oldDriverId) {
            updateFields.queueRejectedDrivers = arrayUnion(oldDriverId);
          }
          if (Array.isArray(o.manuallyRejectedDrivers) && o.manuallyRejectedDrivers.includes(selectedDriver.uid)) {
            updateFields.manuallyRejectedDrivers = arrayRemove(selectedDriver.uid);
          }

          await updateDoc(doc(db, 'orders', o.id), updateFields);

          // Reset chats so previous driver is unlinked
          try {
            const clientChatRef = doc(db, 'chats', `${o.id}_client-delivery`);
            const cdSnap = await getDoc(clientChatRef);
            if (cdSnap.exists()) {
              const cdData = cdSnap.data();
              const prevDriver = cdData.driverId || oldDriverId;
              const newParts = (cdData.participants || []).filter(p => p !== prevDriver && p !== oldDriverId);
              await updateDoc(clientChatRef, { driverId: null, driverName: null, participants: newParts });
            }
            const comChatRef = doc(db, 'chats', `${o.id}_commerce-delivery`);
            const comSnap = await getDoc(comChatRef);
            if (comSnap.exists()) {
              const comData = comSnap.data();
              const prevDriver = comData.driverId || oldDriverId;
              const newParts = (comData.participants || []).filter(p => p !== prevDriver && p !== oldDriverId);
              await updateDoc(comChatRef, { driverId: null, driverName: null, participants: newParts });
            }
          } catch (e) {
            console.warn('[Admin Release] Chat reset error:', e);
          }

          // Trigger exclusive push notification for target driver
          try {
            const orderNum = o.orderId || o.id.slice(-6).toUpperCase();
            await addDoc(collection(db, 'users', selectedDriver.uid, 'notifications'), {
              title: '🛵 ¡Nueva Oferta Exclusiva!',
              body: `Se te ha ofertado en rotación el pedido #${orderNum}. ¡Ingresá para aceptar!`,
              type: 'new_exclusive_offer',
              orderId: o.id,
              status: 'unread',
              createdAt: serverTimestamp()
            });

            await addDoc(collection(db, 'notifications'), {
              userId: selectedDriver.uid,
              title: '🛵 ¡Nueva Oferta Exclusiva!',
              body: `Se te ha ofertado en rotación el pedido #${orderNum}.`,
              url: `#/delivery`,
              type: 'new_exclusive_offer',
              createdAt: serverTimestamp()
            });
          } catch (notifErr) {
            console.warn('[Admin Release] Push notification trigger warning:', notifErr);
          }

          showToast(`🛵 Pedido ofertado en rotación exclusivamente a ${selectedDriver.displayName || selectedDriver.name}.`, 'success');
        }

        closeModal();
        document.getElementById('close-audit-modal')?.click();
        renderOrdersList();

      } catch (err) {
        console.error('[Admin Assign/Release] Error:', err);
        showToast('Error al reasignar pedido: ' + err, 'danger');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'CONFIRMAR LIBERACIÓN';
      }
    };

  } catch (e) {
    console.error('Error loading drivers:', e);
    modalContent.innerHTML = `<p style="color:var(--color-danger); text-align:center;">Error al cargar la lista de repartidores.</p>`;
  }
}
