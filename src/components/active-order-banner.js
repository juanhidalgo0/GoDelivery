// GoDelivery — Active Order Banner Component (Customer Side)
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { setBanner, clearBanner } from './banner-manager.js';
import { sendLocalNotification } from '../utils/notifications.js';
import { FABStack } from '../utils/fab-stack.js';

let activeUnsub = null;
let lastStatuses = {}; // Track last status per orderId

let isMonitorInitialized = false;

export function initActiveOrderBanner() {
  if (isMonitorInitialized) return;
  isMonitorInitialized = true;

  const user = getState().user;

  // Clear any existing banner to avoid stale UI
  clearBanner('customer');

  if (user) {
    startListening(user.uid);
  }

  subscribe('user', (newUser) => {
    if (newUser) {
      startListening(newUser.uid);
    } else {
      stopListening();
    }
  });
}

function startListening(userId) {
  if (activeUnsub) activeUnsub();

  const q = query(
    collection(db, 'orders'),
    where('userId', '==', userId),
    where('status', 'in', ['pending', 'confirmed', 'ready', 'delivering', 'completed'])
  );

  activeUnsub = onSnapshot(q, (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Check for completed orders that haven't been dismissed yet and are recent (less than 12 hours old)
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    const undismissedCompleted = orders.filter(o => {
      const isCompleted = o.status === 'completed' || o.status === 'entregado';
      if (!isCompleted) return false;

      const isDismissed = localStorage.getItem(`gd_dismissed_points_modal_${o.id}`) === 'true';
      if (isDismissed) return false;

      let completedTime = 0;
      if (o.completedAt) {
        completedTime = o.completedAt.toMillis ? o.completedAt.toMillis() : new Date(o.completedAt).getTime();
      } else if (o.createdAt) {
        completedTime = o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime();
      }

      return completedTime > twelveHoursAgo;
    });

    undismissedCompleted.forEach(async (completedOrder) => {
      // Show unified rating and points modal globally!
      const { showDeliveryRating } = await import('./delivery-rating.js');
      showDeliveryRating(completedOrder);
    });

    const activeOrders = orders.filter(o => !['completed', 'cancelled'].includes(o.status))
      .sort((a, b) => {
        const statusOrder = { delivering: 0, ready: 1, confirmed: 2, pending: 3 };
        const aStatus = statusOrder[a.status] ?? 99;
        const bStatus = statusOrder[b.status] ?? 99;
        if (aStatus !== bStatus) return aStatus - bStatus;
        return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
      });

    updateBannerState(activeOrders[0] || null, activeOrders);
  }, (err) => {
    console.error('Error in ActiveOrderBanner listener:', err);
  });
}

function stopListening() {
  if (activeUnsub) {
    activeUnsub();
    activeUnsub = null;
  }
  clearBanner('customer');
}

function updateBannerState(order, allOrders = []) {
  // Hide customer tracking banner if currently in delivery panel pages to avoid confusion
  const hash = window.location.hash || '';
  if (hash.startsWith('#/delivery') || hash.startsWith('#/delivery/')) {
    clearOrderIndicator();
    return;
  }

  if (!order) {
    clearOrderIndicator();
    return;
  }

  // Final statuses - clear and return
  if (['completed', 'cancelled'].includes(order.status)) {
    clearOrderIndicator();
    if (order.status === 'completed' && lastStatuses[order.id] !== 'completed') {
      setTimeout(async () => {
        const { showDeliveryRating } = await import('./delivery-rating.js');
        showDeliveryRating(order);
      }, 1500);
    }
    lastStatuses[order.id] = order.status;
    return;
  }

  const prevStatus = lastStatuses[order.id];
  lastStatuses[order.id] = order.status;

  let color1, color2, title, iconName = 'shoppingBag';

  switch (order.status) {
    case 'pending':
      // Do not render any badge or indicator in 'pending' status
      clearOrderIndicator();
      return;
    case 'confirmed':
      if (order.isTrip) {
        color1 = '#EF4444'; color2 = '#DC2626'; // Bright Red!
        title = 'Chofer en camino';
        iconName = 'car';
      } else {
        color1 = '#0284c7'; color2 = '#0369a1';
        title = 'Preparando pedido';
      }
      break;
    case 'ready':
      if (order.isTrip) {
        color1 = '#EF4444'; color2 = '#DC2626';
        title = 'Chofer en camino';
        iconName = 'car';
      } else {
        color1 = '#7c3aed'; color2 = '#5b21b6';
        title = '¡Pedido listo!';
      }
      break;
    case 'delivering':
      if (order.isTrip) {
        color1 = '#059669'; color2 = '#10b981';
        title = 'Viaje iniciado';
        iconName = 'car';
      } else {
        color1 = '#059669'; color2 = '#10b981';
        title = '¡Pedido en camino!';
        iconName = 'bike';
      }
      break;
    default:
      return;
  }

  // Show persistent floating indicator
  const showCode = !order.isTrip && (order.status === 'delivering' || (order.bundleId && allOrders.some(o => o.bundleId === order.bundleId && o.status === 'delivering')));
  updateOrderFAB(order, { color1, color2, title, iconName, showCode });

  // If status JUST changed, also show a brief banner for attention
  if (prevStatus && prevStatus !== order.status) {
    showStatusToast(title, order);

    // Generate highly professional, descriptive text in Spanish instead of raw status codes
    let statusDesc = '';
    if (order.isTrip) {
      if (order.status === 'confirmed' || order.status === 'ready') {
        statusDesc = `El chofer está yendo a tu ubicación. Patente: ${order.driverVehiclePatent || '---'}`;
      } else if (order.status === 'delivering') {
        statusDesc = 'El viaje ha iniciado. Pasajero a bordo.';
      } else {
        statusDesc = `Tu viaje cambió al estado: ${order.status}`;
      }
    } else {
      switch (order.status) {
        case 'confirmed':
          statusDesc = 'El comercio confirmó tu pedido y comenzó a prepararlo.';
          break;
        case 'ready':
          statusDesc = 'El comercio ya preparó tu pedido y el repartidor se dirige a retirarlo.';
          break;
        case 'delivering':
          statusDesc = `El repartidor ya retiró tu pedido y está en camino a tu ubicación. Código de entrega: ${order.verificationCode || '----'}`;
          break;
        default:
          statusDesc = `Tu pedido cambió al estado: ${order.status}`;
      }
    }

    // SEND TO DRAWER
    sendLocalNotification(title, statusDesc, {
      type: 'order',
      url: `#/pedido/${order.id}`,
      tag: `order-${order.id}-${order.status}`
    });
  }
}

function updateOrderFAB(order, config) {
  let fab = document.getElementById('global-order-fab');
  const bottomBase = 70 + 20; // Navbar + margin

  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'global-order-fab';
    fab.style.cssText = `
      position: fixed; right: 20px;
      padding: 10px 22px; border-radius: 24px;
      display: flex; align-items: center; gap: 14px;
      color: white; cursor: pointer; z-index: 1400;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.3);
      transition: all 0.6s cubic-bezier(0.23, 1, 0.32, 1);
      transform: scale(0) translateY(40px); opacity: 0;
      border: 1px solid rgba(255,255,255,0.25); 
      font-family: var(--font-display);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    `;
    document.body.appendChild(fab);

    if (!document.getElementById('order-fab-styles')) {
      const s = document.createElement('style');
      s.id = 'order-fab-styles';
      s.textContent = `
        @keyframes order-pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(255, 255, 255, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
        }
        .order-fab-active { animation: order-pulse 2s infinite; }
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
  fab.style.background = `linear-gradient(135deg, ${config.color1} 0%, ${config.color2} 100%)`;
  fab.className = 'order-fab-active';
  
  let subtitleHtml = '';
  if (order.isTrip && order.driverId) {
    subtitleHtml = `<span style="font-size:11px; font-weight:900; margin-top:2px;">PATENTE: ${order.driverVehiclePatent || '---'}</span>`;
  } else if (config.showCode) {
    subtitleHtml = `<span style="font-size:14px; font-weight:950; letter-spacing:2px; margin-top:2px;">CÓD: ${order.verificationCode}</span>`;
  } else {
    subtitleHtml = `<span style="font-size:11px; font-weight:700; opacity:0.7; margin-top:2px;">Pedido #${order.orderId || order.id.slice(0,6)}</span>`;
  }

  fab.innerHTML = `
    ${icon(config.iconName, 22)}
    <div style="display:flex; flex-direction:column; align-items:flex-start; line-height:1.1; margin-right:8px;">
      <span style="font-size:9px; opacity:0.85; font-weight:800; text-transform:uppercase; letter-spacing:0.02em;">${config.title}</span>
      ${subtitleHtml}
    </div>
    <div style="display:flex; gap:6px; align-items:center;">
      <button class="fab-action-btn fab-ver-btn" style="background:rgba(255,255,255,0.25); border:none; color:white; padding:5px 12px; border-radius:14px; font-size:11px; font-weight:900; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;">
        ${icon('eye', 12)} VER
      </button>
      <button class="fab-action-btn fab-chat-btn" style="background:white; border:none; color:${config.color2}; padding:5px 12px; border-radius:14px; font-size:11px; font-weight:900; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        ${icon('chat', 12)} CHAT
      </button>
    </div>
    <div class="fab-toggle-dot"></div>
  `;

  fab.onclick = async (e) => {
    const verBtn = e.target.closest('.fab-ver-btn');
    const chatBtn = e.target.closest('.fab-chat-btn');

    if (verBtn) {
      e.stopPropagation();
      window.location.hash = `#/pedido/${order.id}`;
      return;
    }

    if (chatBtn) {
      e.stopPropagation();
      const isDirectFavorOrTrip = order.isFavor || order.isTrip || !order.comercioId;
      
      if (isDirectFavorOrTrip && !order.driverId) {
        import('./toast.js').then(m => m.showToast('Esperando que un repartidor tome tu pedido para poder chatear', 'info'));
        return;
      }
      
      const { openChat } = await import('./chat.js');
      const chatType = isDirectFavorOrTrip ? 'client-delivery' : (order.status === 'delivering' ? 'client-delivery' : 'client-commerce');
      const recipientName = chatType === 'client-delivery' ? (order.driverName || 'Repartidor') : (order.comercioName || 'Comercio');
      
      openChat({
        orderId: order.id,
        type: chatType,
        otherName: recipientName,
        orderNum: order.orderId
      });
      return;
    }

    // Default FAB body click
    window.location.hash = `#/pedido/${order.id}`;
  };
}

function clearOrderIndicator() {
  const fab = document.getElementById('global-order-fab');
  if (fab) {
    fab.style.transform = 'scale(0) translateY(20px)';
    fab.style.opacity = '0';
    setTimeout(() => {
      fab.remove();
      FABStack.reposition();
    }, 500);
  }
}

async function showStatusToast(title, order) {
  const { showToast } = await import('./toast.js');
  showToast(title, 'info');
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash || '';
    if (hash.startsWith('#/delivery') || hash.startsWith('#/delivery/')) {
      clearOrderIndicator();
    }
  });
}

