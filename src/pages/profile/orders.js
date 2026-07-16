
import { db } from '../../firebase.js';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';

function getFavorTypeMeta(favorType) {
  switch (favorType) {
    case 'gocash':
      return {
        title: 'Go Cash',
        label: 'GO CASH',
        color: '#6366f1',
        bg: 'rgba(99, 102, 241, 0.1)'
      };
    case 'encomienda':
      return {
        title: 'GoFavor: Encomienda',
        label: 'ENCOMIENDA',
        color: '#10b981',
        bg: 'rgba(16, 185, 129, 0.1)'
      };
    case 'pagodeservicios':
      return {
        title: 'GoFavor: PAGO DE SERVICIO',
        label: 'PAGO DE SERVICIOS',
        color: '#d97706',
        bg: 'rgba(217, 119, 6, 0.1)'
      };
    case 'mandado':
    case 'compra':
    default:
      return {
        title: favorType === 'compra' ? 'Go Favor: Compra' : 'Go Favor: Mandado',
        label: 'GO FAVOR',
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.1)'
      };
  }
}

function cleanFavorDetailsText(detailsStr) {
  if (!detailsStr) return '';
  return detailsStr
    .replace(/\*\*/g, '')
    .replace(/\n/g, ' · ');
}

export async function renderProfileOrders(content) {
  const user = getState().user;

  if (!user) {
    location.hash = '#/profile';
    return;
  }

  // Calculate padding dynamically for iOS/Android native
  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative 
    ? 'var(--status-bar-height, 24px)' 
    : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  content.innerHTML = `
    <div class="panel-page page-enter" style="background:var(--color-bg); height:100%; display:flex; flex-direction:column; overflow:hidden;">
      <!-- Premium Fixed Header -->
      <div style="width:100%; padding-top: ${topPadding}; background: var(--color-primary); position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1); flex-shrink: 0;">
        <div style="display:flex; align-items:center; gap:12px; padding: 12px 16px 20px 16px; color:white; position:relative; overflow:hidden;">
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          
          <a href="#/profile" style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.15); color:white; text-decoration:none; position:relative; z-index:2;">
            ${icon('chevronLeft', 24)}
          </a>
          <div>
            <h1 style="font-family:var(--font-display); font-weight:800; font-size:18px; margin:0; line-height:1.2; letter-spacing:-0.01em;">Mis Pedidos</h1>
            <p style="font-size:10px; color:rgba(255,255,255,0.85); font-weight:700; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.5px;">Historial y estado de tus compras</p>
          </div>
        </div>
      </div>
      
      <div style="flex:1; overflow-y:auto; padding:20px 20px 40px; -webkit-overflow-scrolling:touch;">
        <div id="profile-orders-list">
          <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>
  `;

  const q = query(collection(db, 'orders'), where('userId', '==', user.uid), limit(50));
  const unsub = onSnapshot(q, (snap) => {
    let orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Only show orders that the user made as a client, not ones received as commerce
    orders = orders.filter(o => o.comercioId !== user.uid);
    
    orders.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    
    renderOrders(orders);
  });

  return { 
    cleanup: () => {
      unsub();
      document.body.style.overflow = '';
    } 
  };
}

function renderOrders(orders) {
  const container = document.getElementById('profile-orders-list');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:80px 20px; color:var(--color-text-tertiary);">
        <div style="width:80px; height:80px; border-radius:30px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; margin:0 auto 20px;">
          ${icon('shoppingBag', 32)}
        </div>
        <p style="font-weight:800; font-size:18px; color:var(--color-text); margin-bottom:8px;">No tenés pedidos aún</p>
        <p style="font-size:14px; margin-bottom:24px;">¡Explorá los mejores comercios y hacé tu primer pedido!</p>
        <a href="#/" class="btn btn-primary" style="padding:12px 24px; border-radius:14px; font-weight:800;">Explorar Comercios</a>
      </div>
    `;
    delete container.dataset.lastOrdersFingerprint;
    return;
  }

  // Avoid flickering by not resetting the innerHTML if the content hasn't structurally changed
  const fingerprint = JSON.stringify(orders.map(o => ({
    id: o.id,
    status: o.status,
    total: o.total,
    driverId: o.driverId || ''
  })));

  if (container.dataset.lastOrdersFingerprint === fingerprint) {
    return;
  }
  container.dataset.lastOrdersFingerprint = fingerprint;

  container.innerHTML = orders.map((o, index) => {
    const isActive = ['pending', 'confirmed', 'ready', 'delivering'].includes(o.status);
    
    // Status specific styles
    const statusConfig = {
      pending: { label: 'Pendiente', color: '#64748b', bg: 'rgba(100, 116, 139, 0.1)', pulse: false },
      confirmed: { label: 'Preparando', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', pulse: false },
      ready: { label: 'Buscando Repartidor', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)', pulse: true },
      delivering: { label: 'En Camino', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', pulse: true },
      completed: { label: 'Recibido', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', pulse: false },
      cancelled: { label: 'Cancelado', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', pulse: false }
    };

    const config = statusConfig[o.status] || statusConfig.pending;

    // Use page-enter only for initial load/staggering, avoid re-adding animation classes on status changes to prevent flash
    const animationClass = container.dataset.lastOrdersFingerprint ? '' : `page-enter stagger-${Math.min(index + 1, 6)}`;

    return `
      <div class="order-card-v3 ${animationClass}" onclick="location.hash='#/pedido/${o.id}'" style="
        background: var(--color-surface);
        border: 1px solid ${isActive ? config.color + '44' : 'var(--color-border-light)'};
        border-radius: 24px;
        padding: 20px;
        margin-bottom: 16px;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: ${isActive ? `0 10px 25px ${config.color}15` : 'var(--shadow-sm)'};
        position: relative;
        overflow: hidden;
      ">
        ${isActive ? `<div style="position:absolute; top:0; left:0; width:4px; height:100%; background:${config.color};"></div>` : ''}
        
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="font-size:10px; font-weight:900; padding:2px 8px; border-radius:8px; background:${o.isFavor ? getFavorTypeMeta(o.favorType).bg : 'rgba(var(--color-primary-rgb),0.1)'}; color:${o.isFavor ? getFavorTypeMeta(o.favorType).color : 'var(--color-primary)'}; text-transform:uppercase; letter-spacing:0.05em;">
                ${o.isFavor ? getFavorTypeMeta(o.favorType).label : 'PEDIDO'}
              </span>
              <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">#${o.orderId || o.id.slice(0,6)}</span>
            </div>
            <div style="font-weight:900; font-size:18px; color:var(--color-text); letter-spacing:-0.02em;">
              ${o.isFavor ? getFavorTypeMeta(o.favorType).title : (o.comercioName || 'Pedido')}
            </div>
            <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase; margin-top:4px; display:flex; align-items:center; gap:6px;">
              ${icon('clock', 12)}
              ${o.createdAt?.toDate() ? new Date(o.createdAt.toDate()).toLocaleDateString('es-AR', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Reciente'}
            </div>
          </div>
          <span style="
            font-size:11px; 
            font-weight:900; 
            padding:6px 12px; 
            border-radius:10px; 
            background:${config.bg}; 
            color:${config.color};
            display:flex;
            align-items:center;
            gap:6px;
            text-transform:uppercase;
            letter-spacing:0.02em;
          " class="${config.pulse ? 'animate-pulse' : ''}">
            ${config.pulse ? `<span style="width:6px; height:6px; border-radius:50%; background:${config.color};"></span>` : ''}
            ${config.label}
          </span>
        </div>
        
        <div style="height:1px; background:var(--color-border-light); margin-bottom:14px; opacity:0.5;"></div>
 
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:13px; color:var(--color-text-secondary); font-weight:600; max-width:65%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${o.isFavor ? (cleanFavorDetailsText(o.details) || 'Ver detalles...') : (o.items ? o.items.map(i => i.name).join(', ') : 'Detalle no disponible')}
          </div>
          <div style="font-weight:950; font-size:18px; color:var(--color-text); letter-spacing:-0.03em;">${formatPrice(o.total)}</div>
        </div>
      </div>
    `;
  }).join('');
}
