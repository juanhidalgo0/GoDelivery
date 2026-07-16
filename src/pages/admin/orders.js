import { db } from '../../firebase.js';
import { doc, getDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { formatPrice, formatDate } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal } from '../../components/modal.js';

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
    if (o.favorType === 'encomienda') return 'Encomienda';
    if (o.favorType === 'mandado' || o.favorType === 'compra') return 'Mandado';
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
        <button id="refresh-orders-btn" style="background:rgba(255,255,255,0.15); border:none; width:40px; height:40px; border-radius:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; transition:all 0.2s; position:relative; z-index:2;">
          ${icon('history', 22)}
        </button>
      </div>

      <!-- Advanced Search & Filter -->
      <div style="padding:20px; flex-shrink:0; background:linear-gradient(to bottom, var(--color-surface), var(--color-bg));">
        <div class="search-box-v4" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:6px; display:flex; align-items:center; box-shadow:var(--shadow-md);">
          <div style="padding:0 15px; color:var(--color-text-tertiary);">${icon('search', 20)}</div>
          <input type="text" id="order-search" placeholder="Cliente, Comercio, ID o Monto..." 
            style="flex:1; padding:12px 0; background:transparent; border:none; color:var(--color-text); font-weight:700; font-size:15px; outline:none;" />
        </div>
        
        <div class="filter-bar-v4" style="display:flex; gap:10px; margin-top:16px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none;">
          <button class="f-chip-v4 active" data-status="all">Todos</button>
          <button class="f-chip-v4" data-status="pending" style="--c:#FFA500;">Pendientes</button>
          <button class="f-chip-v4" data-status="confirmed" style="--c:#3498DB;">Preparando</button>
          <button class="f-chip-v4" data-status="delivering" style="--c:#9B59B6;">En Camino</button>
          <button class="f-chip-v4" data-status="completed" style="--c:#27AE60;">Éxito</button>
          <button class="f-chip-v4" data-status="cancelled" style="--c:#E74C3C;">Bajas</button>
        </div>

        <!-- Order Type Filter Bar -->
        <div class="type-filter-bar" style="display:flex; gap:8px; margin-top:12px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none;">
          <button class="t-chip active" data-type="all">Todos los Tipos</button>
          <button class="t-chip" data-type="comercio">Comercio</button>
          <button class="t-chip" data-type="mandado">Mandado</button>
          <button class="t-chip" data-type="encomienda">Encomienda</button>
          <button class="t-chip" data-type="gocash">Go Cash</button>
          <button class="t-chip" data-type="trip">Go Viaje</button>
        </div>

        <!-- Date Range Filter -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px;">
          <div>
            <label style="font-size:9px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; display:block; margin-bottom:4px; letter-spacing:0.02em;">Desde (Fecha/Hora)</label>
            <input type="datetime-local" id="filter-date-start" style="width:100%; height:38px; border-radius:10px; padding:0 8px; font-size:12px; font-weight:700; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); outline:none;" />
          </div>
          <div>
            <label style="font-size:9px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; display:block; margin-bottom:4px; letter-spacing:0.02em;">Hasta (Fecha/Hora)</label>
            <input type="datetime-local" id="filter-date-end" style="width:100%; height:38px; border-radius:10px; padding:0 8px; font-size:12px; font-weight:700; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); outline:none;" />
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
      .order-card-v4::before { content:''; position:absolute; left:0; top:0; width:6px; height:100%; background:var(--st-color); }
      
      .s-pill-v4 { font-size:10px; font-weight:900; padding:5px 12px; border-radius:10px; background:var(--st-bg); color:var(--st-color); letter-spacing:0.05em; }
    </style>
  `;

  setupEventListeners();
  loadAllOrders();
}

function setupEventListeners() {
  document.getElementById('order-search')?.addEventListener('input', () => renderOrdersList());
  document.querySelectorAll('.f-chip-v4').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('.f-chip-v4').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderOrdersList();
    };
  });
  document.querySelectorAll('.t-chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('.t-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderOrdersList();
    };
  });
  document.getElementById('filter-date-start')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('filter-date-end')?.addEventListener('change', () => renderOrdersList());
  document.getElementById('refresh-orders-btn').onclick = () => loadAllOrders();
}

function loadAllOrders() {
  const dot = document.getElementById('conn-dot');
  const diag = document.getElementById('conn-diag');
  
  if (ordersUnsubscribe) ordersUnsubscribe();

  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(100));
  
  ordersUnsubscribe = onSnapshot(q, (snap) => {
    if (dot) {
      dot.style.background = '#00D67F';
      dot.style.boxShadow = '0 0 10px #00D67F';
    }
    if (diag) diag.textContent = `• ONLINE (${snap.size})`;

    allOrders = [];
    snap.forEach(doc => {
      try { allOrders.push({ id: doc.id, ...doc.data() }); } catch(e) {}
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
  const filter = document.querySelector('.f-chip-v4.active')?.dataset.status || 'all';
  const typeFilter = document.querySelector('.t-chip.active')?.dataset.type || 'all';
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
    const startMs = new Date(dateStartVal).getTime();
    filtered = filtered.filter(o => {
      const orderMs = o.createdAt?.toMillis ? o.createdAt.toMillis() : (o.createdAt ? new Date(o.createdAt).getTime() : 0);
      return orderMs >= startMs;
    });
  }

  if (dateEndVal) {
    const endMs = new Date(dateEndVal).getTime();
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

  container.innerHTML = filtered.map(o => {
    const sKey = getStatusKey(o.status);
    const config = STATUS_CONFIG[sKey] || STATUS_CONFIG.pending;
    
    const dateObj = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
    const dateStr = dateObj ? (dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : 'Fecha desconocida';

    const scheduledBadge = o.isScheduled ? `
      <div style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 6px; padding: 2px 6px; font-size: 10px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; text-transform: uppercase;">
        📅 Programado: ${o.scheduledTime}
      </div>
    ` : '';

    return `
      <div class="order-card-v4" onclick="window.showOrderDetail('${o.id}')" style="--st-color:${config.color}; --st-bg:${config.bg};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:40px; height:40px; border-radius:12px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-primary);">
              ${icon('package', 20)}
            </div>
            <div>
              <div style="font-weight:900; font-size:16px; color:var(--color-text);">#${o.orderId || '---'}</div>
              <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary);">${dateStr}</div>
              ${scheduledBadge}
            </div>
          </div>
          <div class="s-pill-v4">${config.label}</div>
        </div>

        <div style="display:grid; grid-template-columns:1.2fr 0.8fr; gap:15px; margin-bottom:16px;">
          <div>
            <div style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; letter-spacing:0.05em;">Vendedor</div>
            <div style="font-weight:800; font-size:14px; color:var(--color-text);">${getComercioDisplayName(o)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; letter-spacing:0.05em;">Total</div>
            <div style="font-weight:900; font-size:18px; color:var(--color-primary);">${formatPrice(o.total || 0)}</div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:14px; border-top:1px solid var(--color-border-light);">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:24px; height:24px; border-radius:50%; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary);">
              ${icon('user', 14)}
            </div>
            <span style="font-size:12px; font-weight:800; color:var(--color-text-secondary);">${o.userName || 'Cliente'}</span>
          </div>
          <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary);">
            ${o.paymentMethod === 'mercadopago' ? 'Transferencia' : 'Efectivo'}
          </div>
        </div>
      </div>
    `;
  }).join('');
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

  const detailHtml = document.createElement('div');
  detailHtml.style.cssText = 'flex:1; overflow-y:auto; padding:20px; scrollbar-width:none;';
  detailHtml.innerHTML = `
    <div style="text-align:center; margin-bottom:24px;">
       <div style="display:inline-block; padding:4px 12px; background:var(--color-bg-secondary); border-radius:10px; font-size:10px; font-weight:900; color:var(--color-text-tertiary); margin-bottom:8px;">AUDITORÍA #${o.orderId}</div>
       <h2 style="font-size:26px; font-weight:900; margin:0; letter-spacing:-0.03em;">Desglose Comercial</h2>
    </div>

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
         <div style="min-width:0; flex:1;">
           <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Cliente</div>
           <div style="font-weight:900; font-size:15px; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${o.userName}</div>
           <div id="audit-client-goid" style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); margin-top:2px;">ID: ${o.goId || 'Cargando...'}</div>
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
         <div style="min-width:0; flex:1;">
           <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Repartidor</div>
           <div style="font-weight:900; font-size:15px; color:var(--color-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${o.driverName || 'Sin asignar'}</div>
           <div id="audit-driver-goid" style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); margin-top:2px;">ID: ${o.driverDlId || (o.driverId ? 'Cargando...' : '---')}</div>
         </div>
         <div style="flex-shrink:0;">
           ${o.driverId ? `
             <button id="btn-msg-support-driver" style="display:flex; align-items:center; gap:6px; padding:8px 16px; border-radius:12px; background:rgba(225,29,72,0.08); color:var(--color-primary); border:none; font-size:12.5px; font-weight:800; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 12px rgba(225,29,72,0.15);" onmouseover="this.style.transform='translateY(-1px)';" onmouseout="this.style.transform='none';">
               ${icon('send', 14)} Soporte
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
    `
  });

  document.getElementById('close-audit-modal').onclick = () => closeModal();

  document.getElementById('admin-cancel-order-btn')?.addEventListener('click', async () => {
    const { showConfirm } = await import('../../components/modal.js');
    showConfirm({
      title: '🚨 Cancelar Pedido (Admin)',
      message: `¿Estás seguro de que deseas cancelar el pedido #${o.orderId || '---'} de forma forzada? Esta acción devolverá los puntos al cliente (si aplica) y marcará el pedido como cancelado globalmente.`,
      danger: true,
      onConfirm: async () => {
        const { showToast } = await import('../../components/toast.js');
        try {
          const { runTransaction, doc: fDoc, serverTimestamp, increment } = await import('firebase/firestore');
          await runTransaction(db, async (transaction) => {
            const orderRef = fDoc(db, 'orders', o.id);
            const orderSnap = await transaction.get(orderRef);
            if (!orderSnap.exists()) throw "El pedido no existe.";

            const orderData = orderSnap.data();

            transaction.update(orderRef, {
              status: 'cancelled',
              cancelledAt: serverTimestamp(),
              cancelledBy: 'admin'
            });

            if (orderData.pointsRedeemed > 0 && orderData.userId) {
              const userRef = fDoc(db, 'users', orderData.userId);
              transaction.update(userRef, {
                points: increment(orderData.pointsRedeemed)
              });
            }
          });

          closeModal();
          showToast('Pedido cancelado correctamente por el Administrador', 'success');
        } catch (err) {
          console.error('[Admin Cancel] Error:', err);
          showToast('Error al cancelar el pedido: ' + err, 'danger');
        }
      }
    });
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
    const msg = prompt('Escribí el mensaje que querés enviarle al repartidor de parte de Soporte:');
    if (!msg || !msg.trim()) return;
    
    try {
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      const { showToast } = await import('../../components/toast.js');
      await addDoc(collection(db, 'users', o.driverId, 'notifications'), {
        title: '🚨 Mensaje urgente de Soporte',
        body: msg.trim(),
        type: 'system',
        status: 'unread',
        createdAt: serverTimestamp()
      });
      showToast('Mensaje de soporte enviado al repartidor con éxito', 'success');
    } catch (e) {
      const { showToast } = await import('../../components/toast.js');
      showToast('Error al enviar el mensaje', 'danger');
    }
  });

  detailHtml.querySelectorAll('.btn-chat-audit').forEach(btn => {
    btn.onclick = async () => {
      const { openChat } = await import('../../components/chat.js');
      openChat({
        orderId: o.id,
        orderNum: o.orderId,
        type: btn.dataset.type,
        otherName: btn.dataset.other,
        senderDisplayName: 'Admin (Audit)'
      });
    };
  });
};
