import { db } from '../../firebase.js';
import { doc, getDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { formatPrice, formatDate } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal } from '../../components/modal.js';
import { getState, subscribe } from '../../state.js';

const userCache = {};
let knownOrderIds = null;
const newOrderAlerts = {};
let currentLimit = 50;
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
  currentLimit = 50;
  pageLoadTime = Date.now();
  
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; overflow:hidden; background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; text-decoration:none; transition:all 0.2s; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; letter-spacing:-0.03em;">Registro de Ventas</h1>
          <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
            <div id="conn-dot" style="width:8px; height:8px; border-radius:50%; background:#FFA500; box-shadow:0 0 8px #FFA500;"></div>
            <span id="conn-diag" style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.8); letter-spacing:0.05em; text-transform:uppercase;">AUDITORÍA GLOBAL</span>
          </div>
        </div>
        <a href="#/admin/support-chats" id="orders-support-chats-btn" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; transition:all 0.2s; position:relative; z-index:2; margin-right:4px;" title="Mesa de Ayuda">
          ${icon('chatBubble', 22)}
        </a>
        <button id="refresh-orders-btn" style="background:rgba(255,255,255,0.15); border:none; width:40px; height:40px; border-radius:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; transition:all 0.2s; position:relative; z-index:2;">
          ${icon('history', 22)}
        </button>
      </div>

      <!-- Advanced Search -->
      <div style="padding:16px 20px; flex-shrink:0; background:linear-gradient(to bottom, var(--color-surface), var(--color-bg));">
        <div class="search-box-v4" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:4px 6px; display:flex; align-items:center; box-shadow:var(--shadow-sm); margin-bottom:14px;">
          <div style="padding:0 12px; color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('search', 18)}</div>
          <input type="text" id="order-search" placeholder="Buscar cliente, comercio, ID o monto..." 
            style="flex:1; padding:10px 0; background:transparent; border:none; color:var(--color-text); font-weight:700; font-size:14.5px; outline:none;" />
        </div>
        
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px; box-shadow:var(--shadow-sm);">
          <div id="toggle-filters-btn" style="font-size:10px; font-weight:900; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.06em; display:flex; align-items:center; justify-content:space-between; cursor:pointer; user-select:none;">
            <div style="display:flex; align-items:center; gap:6px;">
              ${icon('filter', 12)} Filtros de Auditoría
            </div>
            <span id="filters-chevron-icon" style="transition:transform 0.2s; display:flex; align-items:center; color:var(--color-text-secondary);">${icon('chevronDown', 14)}</span>
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
        border:1px solid var(--color-border); 
        border-radius:24px; 
        padding:20px; 
        margin-bottom:16px; 
        cursor:pointer; 
        transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position:relative;
        overflow:hidden;
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

function setupEventListeners() {
  document.getElementById('order-search')?.addEventListener('input', () => renderOrdersList());
  document.getElementById('filter-status-select')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-type-select')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-date-start')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-date-end')?.addEventListener('change', () => renderOrdersList());
  const refreshBtn = document.getElementById('refresh-orders-btn');
  if (refreshBtn) refreshBtn.onclick = () => loadAllOrders();

  // Collapsible Filters Toggle
  const toggleBtn = document.getElementById('toggle-filters-btn');
  const filtersContent = document.getElementById('filters-collapsible-content');
  const chevron = document.getElementById('filters-chevron-icon');
  if (toggleBtn && filtersContent) {
    toggleBtn.onclick = () => {
      const isHidden = filtersContent.style.display === 'none';
      if (isHidden) {
        filtersContent.style.display = 'block';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      } else {
        filtersContent.style.display = 'none';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
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

function loadAllOrders() {
  const dot = document.getElementById('conn-dot');
  const diag = document.getElementById('conn-diag');
  
  if (ordersUnsubscribe) ordersUnsubscribe();

  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(currentLimit));
  
  ordersUnsubscribe = onSnapshot(q, (snap) => {
    if (dot) {
      dot.style.background = '#00D67F';
      dot.style.boxShadow = '0 0 10px #00D67F';
    }
    if (diag) diag.textContent = `• ONLINE (${snap.size})`;

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

    // Sort scheduled orders to the top
    allOrders.sort((a, b) => {
      const aSched = !!a.isScheduled;
      const bSched = !!b.isScheduled;
      if (aSched && !bSched) return -1;
      if (!aSched && bSched) return 1;
      return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
    });
    
    renderOrdersList();
  }, (err) => {
    if (dot) dot.style.background = '#E74C3C';
    showToast('Error de sincronización: ' + err.message, 'danger');
  });
}

function renderOrdersList() {
  const container = document.getElementById('admin-registry-list-container');
  if (!container) return;

  const searchText = (document.getElementById('order-search')?.value || '').toLowerCase();
  const filter = document.getElementById('filter-status-select')?.value || 'all';
  const typeFilter = document.getElementById('filter-type-select')?.value || 'all';
  const dateStartVal = document.getElementById('filter-date-start')?.value;
  const dateEndVal = document.getElementById('filter-date-end')?.value;

  let filtered = allOrders.filter(o => 
    (o.comercioName || '').toLowerCase().includes(searchText) ||
    (getComercioDisplayName(o)).toLowerCase().includes(searchText) ||
    (o.userName || '').toLowerCase().includes(searchText) ||
    (o.orderId || '').toString().includes(searchText) ||
    (o.total || '').toString().includes(searchText) ||
    (o.id || '').toLowerCase().includes(searchText)
  );

  if (filter !== 'all') {
    filtered = filtered.filter(o => {
      const s = (o.status || '').toLowerCase();
      if (filter === 'pending') return s.includes('pend');
      if (filter === 'confirmed') return s.includes('confir') || s.includes('prepar');
      if (filter === 'delivering') return s.includes('camino') || s.includes('delivering');
      if (filter === 'completed') return s.includes('entreg') || s.includes('complet') || s.includes('ready');
      if (filter === 'cancelled') return s.includes('cancel');
      return true;
    });
  }

  if (typeFilter !== 'all') {
    filtered = filtered.filter(o => {
      if (typeFilter === 'trip') return !!o.isTrip;
      if (typeFilter === 'gocash') return !!o.isFavor && o.favorType === 'gocash';
      if (typeFilter === 'encomienda') return !!o.isFavor && o.favorType === 'encomienda';
      if (typeFilter === 'mandado') return !!o.isFavor && (o.favorType === 'mandado' || o.favorType === 'compra');
      if (typeFilter === 'comercio') return !o.isTrip && !o.isFavor;
      return true;
    });
  }

  if (dateStartVal) {
    const parts = dateStartVal.split('-');
    const startMs = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 0, 0, 0, 0).getTime();
    filtered = filtered.filter(o => {
      const orderMs = o.createdAt?.toMillis ? o.createdAt.toMillis() : (o.createdAt ? new Date(o.createdAt).getTime() : 0);
      return orderMs >= startMs;
    });
  }

  if (dateEndVal) {
    const parts = dateEndVal.split('-');
    const endMs = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 23, 59, 59, 999).getTime();
    filtered = filtered.filter(o => {
      const orderMs = o.createdAt?.toMillis ? o.createdAt.toMillis() : (o.createdAt ? new Date(o.createdAt).getTime() : 0);
      return orderMs <= endMs;
    });
  }

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

    // Calculate service-specific parameters
    let serviceLabel = 'Comercio';
    let serviceColor = '#D946EF'; // Magenta
    let serviceIconHtml = icon('store', 20);

    if (o.isTrip) {
      serviceLabel = 'Go Viaje';
      serviceColor = '#3B82F6'; // Blue
      if (o.driverId && driverPhoto) {
        serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
      } else {
        serviceIconHtml = icon('bike', 20);
      }
    } else if (o.isFavor) {
      if (o.favorType === 'gocash') {
        serviceLabel = 'Go Cash';
        serviceColor = '#6366F1'; // Indigo
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('wallet', 20);
        }
      } else if (o.favorType === 'encomienda' || o.favorType === 'mandado') {
        serviceLabel = 'Encomienda';
        serviceColor = '#10B981'; // Green
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('package', 20);
        }
      } else if (o.favorType === 'pagodeservicios') {
        serviceLabel = 'Pago de Servicios';
        serviceColor = '#F59E0B'; // Gold
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('bank', 20);
        }
      } else { // compra / mandado
        serviceLabel = 'Mandado';
        serviceColor = '#E11D48'; // Red
        if (o.driverId && driverPhoto) {
          serviceIconHtml = `<img src="${driverPhoto}" style="width:100%; height:100%; border-radius:12px; object-fit:cover;" referrerpolicy="no-referrer" />`;
        } else {
          serviceIconHtml = icon('truck', 20);
        }
      }
    } else {
      // Regular commerce order
      serviceLabel = o.comercioName || 'Comercio';
      serviceColor = '#D946EF'; // Magenta
      
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
    if (o.isTrip) {
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

    let animationClass = '';
    if (newOrderAlerts[o.id]) {
      const elapsed = Date.now() - newOrderAlerts[o.id];
      if (elapsed < 5000) {
        animationClass = ' vibrate-new-order';
        // Automatically schedule a re-render after it stops vibrating
        setTimeout(() => {
          if (newOrderAlerts[o.id]) {
            delete newOrderAlerts[o.id];
            renderOrdersList();
          }
        }, 5100 - elapsed);
      } else {
        delete newOrderAlerts[o.id];
      }
    }

    return `
      <div class="order-card-v4${animationClass}" onclick="window.showOrderDetail('${o.id}')" style="--st-color:${config.color}; --st-bg:${config.bg}; --srv-color:${serviceColor}; padding-top: 0px;">
        <!-- Header -->
        <div style="background:var(--srv-color); color:white; padding:10px 20px; margin:0 -20px 16px -20px; border-radius:23px 23px 0 0; font-weight:900; font-size:12px; font-family:var(--font-display); text-transform:uppercase; letter-spacing:0.06em; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 10px rgba(0,0,0,0.04);">
          <span>${serviceHeaderText}</span>
          <span style="opacity:0.9;">#${o.orderId || '---'}</span>
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
          <!-- Repartidor -->
          ${o.driverId ? `
            <div style="display:flex; align-items:center; gap:8px;">
              ${driverPhoto ? `
                <img src="${driverPhoto}" style="width:22px; height:22px; border-radius:50%; object-fit:cover; border:1px solid var(--color-border-light);" referrerpolicy="no-referrer" />
              ` : `
                <div style="width:22px; height:22px; border-radius:50%; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary); font-size:10px; font-weight:800; border:1px solid var(--color-border-light);">R</div>
              `}
              <span style="font-size:12px; font-weight:800; color:var(--color-text-secondary);"><span style="color:var(--color-text-tertiary); font-weight:700;">Repartidor:</span> ${o.driverName || 'Repartidor'} (ID: ${driverDlId})</span>
            </div>
          ` : ''}

          <!-- Cliente -->
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
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = htmlContent + `
    <div id="orders-scroll-sentinel" style="height: 50px; display: flex; align-items: center; justify-content: center; width: 100%; color: var(--color-text-tertiary); font-size: 12px; font-weight: 800; padding: 10px 0;">
      ${filtered.length >= currentLimit ? '<div class="loader-dots" style="margin: 5px auto;"><span></span><span></span><span></span></div>' : '— Fin del registro de ventas —'}
    </div>
  `;

  // Setup infinite scroll IntersectionObserver
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
  if (s.includes('camino') || s.includes('delivering')) return 'delivering';
  if (s.includes('entreg') || s.includes('complet') || s.includes('ready')) return 'completed';
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
    time: formatTime(o.acceptedAt),
    icon: 'user',
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.1)'
  });

  steps.push({ label: 'Retirado (En Camino)', time: formatTime(o.pickedUpAt), icon: 'truck', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)' });
  steps.push({ label: 'Entregado con Éxito', time: formatTime(o.deliveredAt || o.completedAt), icon: 'check', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)' });

  if (o.status === 'cancelled' || o.cancelledAt) {
    steps.push({ label: 'Pedido Cancelado', time: formatTime(o.cancelledAt), icon: 'xCircle', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' });
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
             <span>Puntos Usados</span>
             <span>-${formatPrice(o.pointsRedeemed)}</span>
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
           <span style="color:var(--color-success);">${formatPrice(o.deliveryCost || 0)}</span>
         </div>
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
               ${o.driverId ? (o.driverName || 'R')[0].toUpperCase() : '?'}
             </div>
           </div>
           <div style="min-width:0; flex:1;">
             <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">Repartidor</div>
             <div style="font-weight:900; font-size:15px; color:var(--color-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${o.driverName || 'Sin asignar'}</div>
             <div id="audit-driver-goid" style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); margin-top:2px;">ID: ${o.driverDlId || (o.driverId ? 'Cargando...' : '---')}</div>
           </div>
         </div>
         <div style="flex-shrink:0;">
           ${o.driverId ? `
             <button id="btn-msg-support-driver" style="display:flex; align-items:center; gap:6px; padding:8px 16px; border-radius:12px; background:rgba(225,29,72,0.08); color:var(--color-primary); border:none; font-size:12.5px; font-weight:800; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 12px rgba(225,29,72,0.15);" onmouseover="this.style.transform='translateY(-1px)';" onmouseout="this.style.transform='none';">
               ${icon('send', 14)} Chat
             </button>
           ` : ''}
         </div>
       </div>
    </div>

    <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:20px; margin-bottom:20px;">
       <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
         <span style="font-size:12px; font-weight:700; opacity:0.6;">Comercio:</span>
         <span style="font-size:12px; font-weight:800;">${getComercioDisplayName(o)}</span>
       </div>
       <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
         <span style="font-size:12px; font-weight:700; opacity:0.6;">Ubicación:</span>
         <span style="font-size:12px; font-weight:800; text-align:right; max-width:180px;">${o.deliveryAddress}</span>
       </div>
       <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
         <span style="font-size:12px; font-weight:700; opacity:0.6;">Método:</span>
         <span style="font-size:12px; font-weight:800; text-transform:uppercase;">${o.paymentMethod || 'Efectivo'}</span>
       </div>
       <div style="display:flex; justify-content:space-between; border-top:1px dashed var(--color-border-light); padding-top:12px;">
         <span style="font-size:12px; font-weight:700; opacity:0.6;">Código de Entrega:</span>
         <span style="font-size:12px; font-weight:800; color:${o.verificationCode ? 'var(--color-primary)' : 'var(--color-text-tertiary)'}; letter-spacing: ${o.verificationCode ? '2px' : 'normal'};">
           ${o.verificationCode || 'Pendiente / No disponible'}
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
        ${o.status !== 'cancelled' ? `
          <button id="admin-cancel-order-btn" class="btn" style="width:100%; height:54px; border-radius:18px; font-weight:900; background:#E74C3C; color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${icon('xCircle', 20)} CANCELAR PEDIDO
          </button>
        ` : ''}
        <button id="close-audit-modal" class="btn btn-primary" style="width:100%; height:54px; border-radius:18px; font-weight:900;">
          CERRAR AUDITORÍA
        </button>
      </div>
    `,
    onOpen: () => {
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

      // Close modal handler inside onOpen
      const closeBtn = document.getElementById('close-audit-modal');
      if (closeBtn) closeBtn.onclick = () => closeModal();

      // Cancel button handler inside onOpen
      const cancelBtn = document.getElementById('admin-cancel-order-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          const { showConfirm } = await import('../../components/modal.js');
          showConfirm({
            title: '🚨 Cancelar Pedido (Admin)',
            message: `¿Estás seguro de que deseas cancelar el pedido #${o.orderId || '---'} de forma forzada? Esta acción devolverá los puntos al cliente (si aplica) y marcará el pedido como cancelado globalmente.`,
            danger: true,
            onConfirm: async () => {
              const { showToast } = await import('../../components/toast.js');
              try {
                const { getDoc, updateDoc, doc: fDoc, serverTimestamp, increment } = await import('firebase/firestore');
                
                const orderRef = fDoc(db, 'orders', o.id);
                const orderSnap = await getDoc(orderRef);
                if (!orderSnap.exists()) throw "El pedido no existe.";

                const orderData = orderSnap.data();

                await updateDoc(orderRef, {
                  status: 'cancelled',
                  cancelledAt: serverTimestamp(),
                  cancelledBy: 'admin'
                });

                if (orderData.pointsRedeemed > 0 && orderData.userId) {
                  const userRef = fDoc(db, 'users', orderData.userId);
                  await updateDoc(userRef, {
                    points: increment(orderData.pointsRedeemed)
                  });
                }

                closeModal();
                showToast('Pedido cancelado correctamente por el Administrador', 'success');
              } catch (err) {
                console.error('[Admin Cancel] Error:', err);
                showToast('Error al cancelar el pedido: ' + err, 'danger');
              }
            }
          });
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
