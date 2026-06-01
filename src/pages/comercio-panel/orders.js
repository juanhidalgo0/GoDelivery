import { db } from '../../firebase.js';
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc, serverTimestamp, addDoc, getDocs, orderBy, setDoc } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { formatPrice, formatDate } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal, closeModal } from '../../components/modal.js';
import { getUnreadCount, onUnreadChange } from '../../components/chat-notifier.js';
import { openChat } from '../../components/chat.js';

let ordersUnsub = null;

export async function renderComercioOrders(manualId = null) {
  const params = getRouteParams();
  const comercioId = manualId || params.id;
  if (!comercioId) return;

  // Dynamically inject styles into head to guarantee active CSS rules
  if (!document.getElementById('orders-panel-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'orders-panel-styles';
    styleEl.innerHTML = getOrderStyles().replace('<style>', '').replace('</style>', '');
    document.head.appendChild(styleEl);
  }

  const panelId = 'page-commerce';
  const content = document.getElementById(panelId) || document.getElementById('app-content');

  // SMART RENDER: Only set shell if it's not already there to avoid white flash
  if (!content.querySelector('.orders-panel-page')) {
    content.innerHTML = `
      <div class="orders-panel-page">
        <div id="orders-header-container"></div>
        <div id="orders-tabs-container"></div>
        <div class="orders-scroll-area">
          <div id="orders-list-container">
            <div class="loader-container"><div class="loader"></div></div>
          </div>
        </div>
      </div>
      ${getOrderStyles()}
    `;
  }

  let activeFilter = 'pending';
  let viewMode = 'management';
  let allOrders = [];
  let isAlarmMutedLocally = false;

  const updateMutePill = () => {
    const pendingCount = allOrders.filter(o => o.status === 'pending').length;
    let pill = document.getElementById('comercio-mute-alarm-pill');

    if (pendingCount > 0 && !isAlarmMutedLocally && viewMode === 'management') {
      if (!pill) {
        pill = document.createElement('div');
        pill.id = 'comercio-mute-alarm-pill';
        pill.style.cssText = `
          position: fixed;
          bottom: 84px;
          left: 50%;
          transform: translateX(-50%) translateY(20px);
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1.5px solid rgba(225, 29, 72, 0.35);
          border-radius: 30px;
          padding: 12px 24px;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 1000;
          cursor: pointer;
          color: white;
          font-family: var(--font-display);
          font-weight: 900;
          font-size: 12px;
          letter-spacing: 0.05em;
          box-shadow: 0 10px 30px rgba(225, 29, 72, 0.35);
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          opacity: 0;
        `;
        document.body.appendChild(pill);

        pill.onclick = () => {
          import('../../utils/audio-manager.js').then(m => {
            m.AudioManager.hapticLight();
          });
          isAlarmMutedLocally = true;
          window.dispatchEvent(new CustomEvent('mute-commerce-alarm'));
          updateMutePill();
        };
      }

      pill.innerHTML = `
        <span class="animate-pulse" style="display:inline-block; width:8px; height:8px; background:#e11d48; border-radius:50%; box-shadow:0 0 10px #e11d48;"></span>
        ${icon('bell', 16)}
        <span>SILENCIAR ALARMA PENDIENTE</span>
      `;

      requestAnimationFrame(() => {
        pill.style.transform = 'translateX(-50%) translateY(0)';
        pill.style.opacity = '1';
      });
    } else {
      if (pill) {
        pill.style.transform = 'translateX(-50%) translateY(20px)';
        pill.style.opacity = '0';
        setTimeout(() => {
          pill.remove();
        }, 400);
      }
    }
  };

  const renderHeader = async () => {
    const headerContainer = document.getElementById('orders-header-container');
    if (!headerContainer) return;

    if (viewMode === 'management') {
      // PRE-FETCH/CACHE LOGIC: Use state if available to render instantly
      const cached = getState().currentComercio;
      const comData = (cached && cached.id === comercioId) ? cached : null;
      
      let isPaused = comData ? comData.isPaused : false;

      // Render instantly with what we have
      headerContainer.innerHTML = `
        <div class="orders-sticky-header" style="position: relative; overflow: hidden;">
          <!-- Decorative Circles -->
          <div style="position: absolute; top: -15px; right: -15px; width: 60px; height: 60px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
          
          <div class="orders-header-left" style="position: relative; z-index: 2; display: flex; align-items: center;">
            ${window.innerWidth >= 1024 ? `
              <a href="#/" style="display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.25); text-decoration: none; margin-right: 14px; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                ${icon('chevronLeft', 22)}
              </a>
            ` : ''}
            <div class="orders-header-icon-wrap">
              ${icon('restaurant', 20)}
            </div>
            <div class="orders-header-info">
              <h1 class="orders-header-title">Gestión de Pedidos</h1>
              <div class="orders-header-status-row">
                <span class="orders-live-dot ${isPaused ? 'paused' : ''}"></span>
                <p class="orders-header-subtitle">${isPaused ? 'Pausado' : 'En vivo'}</p>
              </div>
            </div>
          </div>

          <div class="orders-header-actions" style="position: relative; z-index: 2;">
            <button class="hdr-icon-btn" id="new-manual-order-btn" title="Nuevo Pedido">
              ${icon('plus', 18)}
            </button>
            <button class="hdr-icon-btn" id="go-to-history" title="Historial">
              ${icon('history', 18)}
            </button>
            <a href="#/mi-comercio/${comercioId}/settings" class="hdr-icon-btn" title="Configuración">
              ${icon('settings', 18)}
            </a>
          </div>
        </div>
      `;

      // Background update if no cache or to ensure freshness
      if (!comData) {
        const comSnap = await getDoc(doc(db, 'comercios', comercioId));
        if (comSnap.exists()) {
          const freshData = { id: comSnap.id, ...comSnap.data() };
          import('../../state.js').then(m => m.setState('currentComercio', freshData));
          if (freshData.isPaused !== isPaused) {
            const dot = headerContainer.querySelector('.orders-live-dot');
            const sub = headerContainer.querySelector('.orders-header-subtitle');
            if (dot) dot.className = `orders-live-dot ${freshData.isPaused ? 'paused' : ''}`;
            if (sub) sub.textContent = freshData.isPaused ? 'Pausado' : 'En vivo';
          }
        }
      }


      // Panic toggle removed from header — now lives in Settings page
    } else {
      headerContainer.innerHTML = `
        <div class="orders-sticky-header history-header">
          <button class="hdr-icon-btn" id="back-to-mgmt" title="Volver">${icon('back', 18)}</button>
          <div class="orders-header-info">
            <h1 class="orders-header-title">Historial</h1>
            <p class="orders-header-subtitle">Pedidos finalizados y cancelados</p>
          </div>
        </div>
      `;
    }

    document.getElementById('new-manual-order-btn')?.addEventListener('click', () => {
      showNewManualOrderModal(comercioId);
    });
    
    document.getElementById('go-to-history')?.addEventListener('click', () => {
      viewMode = 'history';
      renderView();
    });
    document.getElementById('back-to-mgmt')?.addEventListener('click', () => {
      viewMode = 'management';
      renderView();
    });
  };

  const renderTabs = () => {
    const tabsContainer = document.getElementById('orders-tabs-container');
    if (!tabsContainer) return;

    if (viewMode === 'management') {
      tabsContainer.innerHTML = `
        <div class="orders-tab-bar-pro">
          <button class="tab-pill-pro ${activeFilter === 'pending' ? 'active active-pending' : ''}" data-filter="pending">
            <div class="tab-icon">${icon('clock', 20)}</div>
            <div class="tab-label-group">
              <span class="tab-label">Pendientes</span>
              <span class="tab-count-badge" id="count-pending">0</span>
            </div>
          </button>
          <button class="tab-pill-pro ${activeFilter === 'confirmed' ? 'active active-confirmed' : ''}" data-filter="confirmed">
            <div class="tab-icon">${icon('restaurant', 20)}</div>
            <div class="tab-label-group">
              <span class="tab-label">Preparando</span>
              <span class="tab-count-badge" id="count-confirmed">0</span>
            </div>
          </button>
          <button class="tab-pill-pro ${activeFilter === 'ready' ? 'active active-ready' : ''}" data-filter="ready">
            <div class="tab-icon">${icon('readyBox', 20)}</div>
            <div class="tab-label-group">
              <span class="tab-label">Listos</span>
              <span class="tab-count-badge" id="count-ready">0</span>
            </div>
          </button>
        </div>
      `;
      tabsContainer.querySelectorAll('.tab-pill-pro').forEach(btn => {
        btn.addEventListener('click', () => {
          activeFilter = btn.dataset.filter;
          renderTabs();
          renderFilteredOrders(allOrders, activeFilter, comercioId, false);
        });
      });
      updateAllCounts(allOrders);
    } else {
      tabsContainer.innerHTML = '';
    }
  };

  const renderView = () => {
    renderHeader();
    renderTabs();
    if (viewMode === 'management') {
      renderFilteredOrders(allOrders, activeFilter, comercioId, false);
    } else {
      renderFilteredOrders(allOrders, 'completed', comercioId, true);
    }
    updateMutePill();
  };

  let isInitial = true;
  const q = query(collection(db, 'orders'), where('comercioId', '==', comercioId));
  ordersUnsub = onSnapshot(q, (snap) => {
    const newOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    // Detect new pending orders to show toast (Only after initial load)
    if (!isInitial) {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const order = { id: change.doc.id, ...change.doc.data() };
          if (order.status === 'pending') {
            showToast(`¡Nuevo pedido #${order.orderId || ''}!`, 'success');
            isAlarmMutedLocally = false; // Reset mute when a new pending order arrives
            if (typeof playNotificationSound === 'function') playNotificationSound();
          }
        }
      });
    }

    isInitial = false;
    allOrders = newOrders;
    renderView();
  });

  const unreadUnsub = onUnreadChange(() => {
    updateAllUnreadBadges(allOrders);
  });

  return {
    cleanup: () => {
      if (ordersUnsub) ordersUnsub();
      if (unreadUnsub) unreadUnsub();
      const pill = document.getElementById('comercio-mute-alarm-pill');
      if (pill) pill.remove();
    }
  };
}

function updateAllCounts(orders) {
  const counts = {
    pending: orders.filter(o => o.status === 'pending').length,
    confirmed: orders.filter(o => o.status === 'confirmed').length,
    ready: orders.filter(o => o.status === 'ready').length,
    delivering: orders.filter(o => o.status === 'delivering').length
  };
  Object.entries(counts).forEach(([status, count]) => {
    const el = document.getElementById(`count-${status}`);
    if (el) {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    }
  });
}

function renderFilteredOrders(orders, filter, comercioId, isHistory) {
  const container = document.getElementById('orders-list-container');
  if (!container) return;

  let filtered;
  if (isHistory) {
    filtered = orders.filter(o => o.status === 'completed' || o.status === 'cancelled');
  } else {
    filtered = orders.filter(o => o.status === filter);
  }

  if (filtered.length === 0) {
    const emptyMsg = isHistory ? 'Sin historial' : { pending: 'Sin pendientes', confirmed: 'Nada en preparación', ready: 'Nada listo', delivering: 'En camino' }[filter];
    container.innerHTML = `<div class="orders-empty-state">${icon('shoppingBag', 48)}<p>${emptyMsg || 'Sin pedidos'}</p></div>`;
    return;
  }

  container.innerHTML = `<div class="orders-card-list">${filtered.map(o => renderOrderCard(o, isHistory)).join('')}</div>`;
  attachOrderListeners(container, filtered, comercioId);
  updateAllUnreadBadges(filtered);
}

function renderOrderCard(o, isHistory = false) {
  const statusLabel = getStatusLabel(o.status);
  const formatH = (ts) => ts ? ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---';

  return `
    <div class="order-card-pro simplified-card ${o.status}" data-id="${o.id}">
      <div class="card-side-indicator"></div>
      <div class="card-main-content">
        <div class="card-top-row">
          <span class="order-id-red">#${o.orderId || '---'}</span>
          <span class="order-time-grey">${formatDate(o.createdAt?.toDate())}</span>
          <div class="card-status-badge">${statusLabel}</div>
        </div>
        <div class="simplified-card-body">
          <div class="customer-info-minimal">
            <strong>${o.userName || 'Cliente'}</strong>
            <span class="order-exact-time">${icon('clock', 10)} ${formatH(o.createdAt)}</span>
          </div>
          <div class="card-right-section">
            <div class="price-main">${formatPrice(o.total)}</div>
            <div class="expand-indicator">${icon('chevronDown', 14)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachOrderListeners(container, orders, comercioId) {
  container.querySelectorAll('.order-card-pro').forEach(card => {
    card.addEventListener('click', () => {
      const order = orders.find(o => o.id === card.dataset.id);
      if (order) showOrderDetailModal(order);
    });
  });
}

function showOrderDetailModal(initialOrder) {
  const modalEl = document.createElement('div');
  modalEl.className = `order-detail-modal-root status-${initialOrder.status}`;

  let modalUnsub = null;

  const renderContent = (o) => {
    const formatH = (ts) => ts ? ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---';
    const isHistory = o.status === 'completed' || o.status === 'cancelled';
    const unreadCount = getUnreadCount(o.id, 'client-commerce');
    const shortUserId = o.userId ? o.userId.slice(-6) : '---';

    modalEl.className = `order-detail-modal-root status-${o.status}`;
    modalEl.innerHTML = `
      <div class="modal-internal-header">
        <div class="header-top-row">
          <div class="header-title-group">
            <div class="order-label">Pedido</div>
            <h2 class="order-number">#${o.orderId || '---'}</h2>
          </div>
          <div class="header-actions">
            <button class="modal-print-icon" id="print-detail-modal" title="Imprimir Comanda">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"></path></svg>
            </button>
            <button class="modal-close-icon" id="close-detail-modal">${icon('close', 20)}</button>
          </div>
        </div>
        <div class="header-bottom-row">
          <div class="order-date">${formatDate(o.createdAt?.toDate())} • ${formatH(o.createdAt)}</div>
          <div class="card-status-badge badge-${o.status}">${getStatusLabel(o.status)}</div>
        </div>
      </div>

      <div class="detail-scroll-area">
        <div class="detail-body-container">
          <div class="detail-section">
            <div class="section-title-premium">Cliente</div>
            <div class="detail-customer-box-premium">
              <div class="customer-avatar-premium">${o.userName?.charAt(0) || 'U'}</div>
              <div class="customer-text-premium">
                <strong>${o.userName || 'Cliente'}</strong>
                <div class="customer-id-premium">ID: #${shortUserId}</div>
              </div>
              ${!isHistory ? `
              <button class="chat-btn-mini chat-order-btn" data-id="${o.id}" data-client="${o.userName}" data-num="${o.orderId}">
                ${icon('chatBubble', 16)} Chat
                <span class="unread-count-bubble" id="modal-unread-${o.id}" style="${unreadCount > 0 ? 'display:flex;' : 'display:none;'}">${unreadCount}</span>
              </button>
              ` : ''}
            </div>
          </div>

          <div class="detail-section productos-section">
            <div class="section-title-premium">Productos</div>
            <div class="detail-items-list-premium">
              ${o.items?.map(i => `<div class="detail-item-premium"><div class="item-qty-badge">${i.qty}x</div><div class="item-name">${i.name}</div><div class="item-price">${formatPrice(i.price * i.qty)}</div></div>`).join('')}
            </div>
            <div style="margin-top:12px; background:${o.allowReplacement ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'}; border:1px solid ${o.allowReplacement ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}; border-radius:10px; padding:10px 12px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:16px;">${o.allowReplacement ? '🔄' : '⚠️'}</span>
              <div style="display:flex; flex-direction:column; gap:1px;">
                <span style="font-size:11px; font-weight:800; color:${o.allowReplacement ? '#22C55E' : '#EF4444'}; text-transform:uppercase; letter-spacing:0.03em;">
                  ${o.allowReplacement ? 'Permite Reemplazos' : 'No permite Reemplazos'}
                </span>
                <span style="font-size:10px; color:var(--color-text-secondary); font-weight:500;">
                  ${o.allowReplacement ? 'El cliente autoriza a cambiar productos faltantes por similares.' : 'Contactar al cliente antes de realizar cambios de productos.'}
                </span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <div class="section-title-premium">Entrega</div>
            <div class="detail-address-box-premium">
              <div class="address-icon-wrap">${icon('mapPin', 20)}</div>
              <div class="address-text-content">
                <span class="address-label">Dirección destino</span>
                <span class="address-text">${o.deliveryAddress || o.address || 'Retiro en local'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-footer-dock-premium">
        <div class="price-summary-card-premium">
          <div class="summary-row"><span>Subtotal</span><span>${formatPrice(o.subtotal || o.total - (o.deliveryCost || 0) - (o.appUsageFee || 0))}</span></div>
          <div class="summary-row"><span>Envío</span><span>${formatPrice(o.deliveryCost || 0)}</span></div>
          ${o.appUsageFee ? `<div class="summary-row"><span>Tarifa de servicio</span><span>${formatPrice(o.appUsageFee)}</span></div>` : ''}
          <div class="summary-divider"></div>
          <div class="summary-row total-row"><span>Total</span><span class="total-amount">${formatPrice(o.total)}</span></div>
        </div>

        ${!isHistory ? `
        <div class="detail-actions-section-premium">
          ${o.status === 'pending' ? `
            <button class="btn-action-premium confirm confirm-order-btn" data-id="${o.id}">${icon('check', 18)} Confirmar Pedido</button>
            <div class="action-grid-2">
              <button class="btn-action-premium outline modify-order-btn" data-id="${o.id}">${icon('edit', 16)} Modificar</button>
              <button class="btn-action-premium reject reject-order-btn" data-id="${o.id}">${icon('close', 16)} Rechazar</button>
            </div>
          ` : o.status === 'confirmed' ? `
            <button class="btn-action-premium confirm ready-order-btn" data-id="${o.id}">${icon('readyBox', 18)} Marcar como Listo</button>
            <div class="action-grid-2">
              <button class="btn-action-premium outline modify-order-btn" data-id="${o.id}">${icon('edit', 16)} Modificar</button>
              <button class="btn-action-premium reject cancel-confirmed-btn" data-id="${o.id}">${icon('close', 16)} Cancelar</button>
            </div>
          ` : o.status === 'ready' ? `
            <div style="display:flex; align-items:center; gap:8px; justify-content:center; padding:16px; border-radius:16px; background:rgba(13,148,136,0.08); border:1px solid rgba(13,148,136,0.2); color:#0d9488; font-weight:800; font-size:13px; text-transform:uppercase; letter-spacing:0.02em;">
              ${icon('bike', 18)} Esperando retiro del repartidor
            </div>
          ` : o.status === 'delivering' ? `
            <button class="btn-action-premium confirm complete-order-btn" data-id="${o.id}">${icon('checkCircle', 18)} Marcar Entregado</button>
          ` : ''}
        </div>
        ` : ''}
      </div>
    `;

    // Attach modal listeners dynamically
    modalEl.querySelector('#close-detail-modal')?.addEventListener('click', () => {
      if (modalUnsub) modalUnsub();
      closeModal();
    });

    modalEl.querySelector('#print-detail-modal')?.addEventListener('click', async () => {
      const { printComanda } = await import('../../utils/print.js');
      printComanda(o);
    });
    
    modalEl.querySelector('.confirm-order-btn')?.addEventListener('click', () => {
      showConfirm({
        title: 'Confirmar',
        message: '¿Estás seguro que deseas confirmar este pedido? Se notificará al cliente.',
        onConfirm: async () => {
          const { runTransaction, doc: fDoc, serverTimestamp } = await import('firebase/firestore');
          try {
            await runTransaction(db, async (transaction) => {
              const orderRef = fDoc(db, 'orders', o.id);
              const orderSnap = await transaction.get(orderRef);
              if (!orderSnap.exists()) throw "Pedido no encontrado";

              if (orderSnap.data().status !== 'pending') {
                throw "El pedido ya no está pendiente (fue cancelado o modificado).";
              }

              transaction.update(orderRef, {
                status: 'confirmed',
                confirmedAt: serverTimestamp()
              });
            });
            if (modalUnsub) modalUnsub();
            closeModal();
            showToast('Pedido confirmado', 'success');
          } catch (err) {
            console.error('Error confirming order:', err);
            showToast(typeof err === 'string' ? err : 'Error al confirmar', 'error');
          }
        }
      });
    });

    modalEl.querySelector('.reject-order-btn')?.addEventListener('click', () => {
      showConfirm({
        title: 'Rechazar',
        message: '¿Estás seguro que deseas rechazar este pedido? Esta acción no se puede deshacer.',
        danger: true,
        onConfirm: async () => {
          try {
            const { runTransaction, doc: fDoc, serverTimestamp, increment } = await import('firebase/firestore');
            await runTransaction(db, async (transaction) => {
              const orderRef = fDoc(db, 'orders', o.id);
              const orderSnap = await transaction.get(orderRef);
              if (!orderSnap.exists()) throw "Order not found";

              const orderData = orderSnap.data();

              if (orderData.status !== 'pending') {
                throw "El pedido ya no está pendiente.";
              }

              transaction.update(orderRef, {
                status: 'cancelled',
                cancelledAt: serverTimestamp()
              });

              if (orderData.pointsRedeemed > 0 && orderData.userId) {
                const userRef = fDoc(db, 'users', orderData.userId);
                transaction.update(userRef, {
                  points: increment(orderData.pointsRedeemed)
                });
              }
            });

            if (modalUnsub) modalUnsub();
            closeModal();
            showToast('Pedido rechazado y puntos devueltos', 'info');
          } catch (err) {
            console.error('Error rejecting order:', err);
            showToast('Error al procesar cancelación', 'error');
          }
        }
      });
    });

    modalEl.querySelector('.ready-order-btn')?.addEventListener('click', () => {
      showConfirm({
        title: 'Marcar Listo',
        message: '¿El pedido ya está preparado para entregar o enviar?',
        onConfirm: async () => {
          await updateDoc(doc(db, 'orders', o.id), { status: 'ready', readyAt: serverTimestamp() });
          if (modalUnsub) modalUnsub();
          closeModal(); showToast('Listo', 'success');
        }
      });
    });

    modalEl.querySelector('.cancel-confirmed-btn')?.addEventListener('click', () => {
      showConfirm({
        title: 'Cancelar Pedido',
        message: '¿Estás seguro que deseas cancelar este pedido que ya está en preparación? Se notificará al cliente.',
        danger: true,
        onConfirm: async () => {
          const { runTransaction, doc: fDoc, serverTimestamp, increment } = await import('firebase/firestore');
          try {
            await runTransaction(db, async (transaction) => {
              const orderRef = fDoc(db, 'orders', o.id);
              const orderSnap = await transaction.get(orderRef);
              if (!orderSnap.exists()) throw "Order not found";
              const orderData = orderSnap.data();

              transaction.update(orderRef, {
                status: 'cancelled',
                cancelledAt: serverTimestamp(),
                cancelledBy: 'comercio'
              });

              if (orderData.pointsRedeemed > 0 && orderData.userId) {
                transaction.update(fDoc(db, 'users', orderData.userId), { points: increment(orderData.pointsRedeemed) });
              }
            });
            if (modalUnsub) modalUnsub();
            closeModal();
            showToast('Pedido cancelado', 'info');
          } catch (err) {
            showToast('Error al cancelar', 'error');
          }
        }
      });
    });

    modalEl.querySelector('.complete-order-btn')?.addEventListener('click', async () => {
      await updateDoc(doc(db, 'orders', o.id), { status: 'completed', completedAt: serverTimestamp() });
      if (modalUnsub) modalUnsub();
      closeModal(); showToast('Entregado', 'success');
    });

    modalEl.querySelector('.chat-order-btn')?.addEventListener('click', () => {
      openChat({ orderId: o.id, type: 'client-commerce', otherName: o.userName, orderNum: o.orderId, senderDisplayName: 'Comercio' });
    });

    modalEl.querySelector('.modify-order-btn')?.addEventListener('click', () => {
      showModifyOrderModal(o);
    });
  };

  // Render initial content
  renderContent(initialOrder);

  // Open the modal with onClose cleanup
  showModal({ content: modalEl, height: '92dvh', hideHeader: true, onClose: () => {
    if (modalUnsub) {
      modalUnsub();
      modalUnsub = null;
    }
  }});

  // Real-time Firestore document updates
  modalUnsub = onSnapshot(doc(db, 'orders', initialOrder.id), (snap) => {
    if (snap.exists()) {
      const updatedOrder = { id: snap.id, ...snap.data() };
      
      // Reactive re-render of products, pricing, buttons, etc.
      renderContent(updatedOrder);

      // Status change validation
      if (updatedOrder.status !== initialOrder.status) {
        showToast(`El pedido cambió a: ${getStatusLabel(updatedOrder.status)}`, 'info');
        if (['ready', 'delivering', 'completed', 'cancelled'].includes(updatedOrder.status)) {
          setTimeout(() => {
            if (modalUnsub) {
              modalUnsub();
              modalUnsub = null;
            }
            closeModal();
          }, 1500);
        }
      }
    }
  });
}

async function showModifyOrderModal(order) {
  const commerceId = order.comercioId;
  let items = JSON.parse(JSON.stringify(order.items || []));
  let customMode = false;
  let customPrice = '';
  let customDesc = '';
  let allProducts = [];
  let categories = [];
  let searchTerm = '';
  let selectedCatId = 'all';

  // Pre-load Precio Fijo if order already has it
  if (order.isFixedPrice || (items.length === 1 && (items[0].name === 'Precio Fijo' || items[0].name === 'Monto Fijo' || items[0].name === 'Ajuste'))) {
    customMode = true;
    customPrice = items[0].price.toString();
    customDesc = items[0].name;
  }

  try {
    const prodsSnap = await getDocs(collection(db, 'comercios', commerceId, 'products'));
    allProducts = prodsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const catsSnap = await getDocs(query(collection(db, 'comercios', commerceId, 'categories'), orderBy('order')));
    categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { }

  const modalEl = document.createElement('div');
  modalEl.className = "modify-order-modal-container";
  modalEl.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--color-bg);color:var(--color-text-primary);';
  let changeDetails = '';

  function renderResults() {
    const resultsContainer = modalEl.querySelector('#mod-search-results-container');
    if (!resultsContainer) return;
    let filtered = allProducts;
    if (selectedCatId !== 'all') filtered = filtered.filter(p => p.categoryId === selectedCatId);
    if (searchTerm.trim().length > 0) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(s));
    } else if (selectedCatId === 'all') { resultsContainer.innerHTML = ''; return; }
    const results = filtered.slice(0, 8);
    if (results.length === 0) { resultsContainer.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:var(--color-text-tertiary);">Sin resultados</div>'; return; }
    resultsContainer.innerHTML = results.map(p => `
      <div class="mod-search-item" data-id="${p.id}"><img src="${p.image || '/logo.png'}" /><div class="mod-search-item-info"><div class="name">${p.name}</div><div class="price">${formatPrice(p.price)}</div></div><div class="mod-search-item-add">${icon('plus', 16)}</div></div>
    `).join('');
    resultsContainer.querySelectorAll('.mod-search-item').forEach(el => {
      el.addEventListener('click', () => {
        const prod = allProducts.find(p => p.id === el.dataset.id);
        if (prod) { items.push({ id: prod.id, name: prod.name, price: prod.price, qty: 1, image: prod.image }); renderModifyUI(); showToast(`Agregado: ${prod.name}`, 'info'); }
      });
    });
  }

  function renderModifyUI() {
    const subtotal = customMode ? (parseFloat(customPrice) || 0) : items.reduce((s, i) => s + i.price * i.qty, 0);
    const appFee = order.appUsageFee || 0;
    const discount = order.discountAmount || 0;
    const total = subtotal + (order.deliveryCost || 0) + appFee - discount;
    modalEl.innerHTML = `
      ${getOrderStyles()}
      <div style="padding:24px; flex:1; overflow-y:auto; scrollbar-width:none;">
        <div class="mod-tab-header">
          <button class="mod-tab-btn ${!customMode ? 'active' : ''}" id="mod-items-tab">${icon('shoppingBag', 14)} Ítems</button>
          <button class="mod-tab-btn ${customMode ? 'active' : ''}" id="mod-custom-tab">${icon('dollarSign', 14)} Precio Fijo</button>
        </div>
        ${customMode ? `
          <div class="mod-custom-section animate-fade-in">
            <div style="background:rgba(225,29,72,0.05); border:1px dashed rgba(225,29,72,0.3); padding:16px; border-radius:18px; margin-bottom:20px; font-size:12px; line-height:1.5; color:var(--color-text-secondary); display:flex; align-items:flex-start; gap:10px;">
              <div style="color:var(--color-primary); font-size:18px; margin-top:2px; display:flex; align-items:center;">${icon('info', 18)}</div>
              <div>
                <strong style="color:var(--color-text-primary);">Modo Precio Fijo Activo</strong><br/>
                Esta modalidad reemplaza todos los productos del carrito por un monto total único. Ideal cuando negocias un precio final cerrado con el cliente.
              </div>
            </div>
            <div class="mod-input-group">
              <label>Concepto / Detalle</label>
              <input type="text" id="custom-desc" class="mod-input" value="${customDesc || 'Precio Fijo'}" placeholder="Ej: Ajuste de Pedido, Monto Fijo, etc." />
            </div>
            <div class="mod-input-group">
              <label>Precio Único Total ($)</label>
              <input type="number" id="custom-price" class="mod-input price" value="${customPrice}" placeholder="0.00" inputmode="decimal" style="font-size:24px; font-weight:900; color:var(--color-primary); text-align:center; padding:12px 16px; border-radius:14px; background:var(--color-bg-secondary);" />
            </div>
          </div>
        ` : `
          <div class="mod-items-section animate-fade-in">
            <div class="mod-search-area"><div class="mod-search-input-wrapper">${icon('search', 16)}<input type="text" id="mod-prod-search-input" placeholder="Buscar productos..." value="${searchTerm}" /></div>
            <div class="mod-cat-scroll hide-scrollbar"><button class="mod-cat-pill ${selectedCatId === 'all' ? 'active' : ''}" data-cat-id="all">Todos</button>${categories.map(c => `<button class="mod-cat-pill ${selectedCatId === c.id ? 'active' : ''}" data-cat-id="${c.id}">${c.name}</button>`).join('')}</div><div id="mod-search-results-container" class="mod-search-results-list"></div></div>
            <div class="mod-items-list">${items.length === 0 ? `<div class="mod-empty-items">${icon('shoppingBag', 40)}<span style="font-size:13px; font-weight:700; margin-top:12px;">El pedido no tiene ítems</span></div>` : items.map((item, idx) => `
                <div class="mod-item-card"><div class="mod-item-main"><div class="mod-item-info"><div class="name">${item.name}</div><div class="price-edit"><span>$</span><input type="number" class="item-price-input" data-idx="${idx}" value="${item.price}" /></div></div>
                <div class="mod-item-controls"><button class="mod-qty-btn" data-idx="${idx}" data-action="minus">${icon('minus', 12)}</button><span class="mod-qty-val">${item.qty}</span><button class="mod-qty-btn" data-idx="${idx}" data-action="plus">${icon('plus', 12)}</button></div><button class="mod-remove-btn" data-idx="${idx}">${icon('trash', 16)}</button></div></div>
              `).join('')}
            </div>
          </div>
        `}
        
        <!-- Detalle de Cambios/Reemplazos que se enviara por chat -->
        <div class="mod-input-group" style="margin-top:20px; border-top:1px solid var(--color-border-light); padding-top:16px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.05em;">
            ✏️ Detalle de Cambios / Reemplazos (Se enviará por chat)
          </label>
          <textarea id="mod-change-details" class="mod-input" placeholder="Ej: Se reemplazó Coca-Cola 2L por Pepsi 2.25L sin cargo extra." style="width:100%; height:64px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:10px 12px; font-size:13px; font-weight:600; outline:none; resize:none; font-family:inherit; background:var(--color-bg-secondary); color:var(--color-text-primary); margin-top:8px;">${changeDetails}</textarea>
        </div>
      </div>
      <div class="mod-footer"><div class="mod-total-display"><div class="label">Total Final:</div><div class="amount">${formatPrice(total)}</div></div><button id="save-modify-btn" class="mod-save-btn">Guardar</button></div>
    `;

    const updateTotalPriceDisplay = () => {
      const subtotal = customMode ? (parseFloat(customPrice) || 0) : items.reduce((s, i) => s + i.price * i.qty, 0);
      const appFee = order.appUsageFee || 0;
      const discount = order.discountAmount || 0;
      const total = subtotal + (order.deliveryCost || 0) + appFee - discount;
      const amountEl = modalEl.querySelector('.mod-total-display .amount');
      if (amountEl) amountEl.textContent = formatPrice(total);
    };

    modalEl.querySelector('#mod-items-tab')?.addEventListener('click', () => { customMode = false; renderModifyUI(); });
    modalEl.querySelector('#mod-custom-tab')?.addEventListener('click', () => { customMode = true; renderModifyUI(); });
    modalEl.querySelector('#mod-prod-search-input')?.addEventListener('input', (e) => { searchTerm = e.target.value; renderResults(); });
    modalEl.querySelectorAll('.mod-cat-pill').forEach(btn => btn.addEventListener('click', () => {
      selectedCatId = btn.dataset.catId;
      modalEl.querySelectorAll('.mod-cat-pill').forEach(b => b.classList.toggle('active', b.dataset.catId === selectedCatId));
      renderResults();
    }));
    modalEl.querySelectorAll('.mod-qty-btn').forEach(btn => btn.addEventListener('click', () => { const idx = parseInt(btn.dataset.idx); if (btn.dataset.action === 'plus') items[idx].qty++; else if (items[idx].qty > 1) items[idx].qty--; else items.splice(idx, 1); renderModifyUI(); }));
    modalEl.querySelectorAll('.mod-remove-btn').forEach(btn => btn.addEventListener('click', () => { items.splice(parseInt(btn.dataset.idx), 1); renderModifyUI(); }));
    
    modalEl.querySelector('#custom-desc')?.addEventListener('input', (e) => { customDesc = e.target.value; });
    modalEl.querySelector('#custom-price')?.addEventListener('input', (e) => { customPrice = e.target.value; updateTotalPriceDisplay(); });
    modalEl.querySelector('#mod-change-details')?.addEventListener('input', (e) => { changeDetails = e.target.value; });
    modalEl.querySelectorAll('.item-price-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(input.dataset.idx);
        const val = parseFloat(e.target.value) || 0;
        items[idx].price = val;
        updateTotalPriceDisplay();
      });
    });

    modalEl.querySelector('#save-modify-btn')?.addEventListener('click', async () => {
      const b = modalEl.querySelector('#save-modify-btn');
      try {
        let nI, nS;
        if (customMode) {
          const p = parseFloat(customPrice);
          if (isNaN(p) || p <= 0) {
            showToast('Ingresa un precio único válido mayor a 0', 'warning');
            return;
          }
          nI = [{ name: (customDesc || '').trim() || 'Precio Fijo', price: p, qty: 1 }];
          nS = p;
        } else {
          if (items.length === 0) {
            showToast('El pedido debe tener al menos un producto o un precio fijo', 'warning');
            return;
          }
          nI = items;
          nS = items.reduce((s, i) => s + i.price * i.qty, 0);
        }
        b.disabled = true;
        b.innerHTML = icon('loader', 16, 'animate-spin') + ' Guardando...';

        const appFee = order.appUsageFee || 0;
        const discount = order.discountAmount || 0;
        const nT = nS + (order.deliveryCost || 0) + appFee - discount;
        await updateDoc(doc(db, 'orders', order.id), { 
          items: nI, 
          subtotal: nS, 
          total: nT, 
          modifiedAt: serverTimestamp(), 
          isModified: true,
          isFixedPrice: customMode,
          changeDetails: changeDetails.trim() || null
        });

        // Send automatic message via chat detailing changes
        if (changeDetails.trim().length > 0) {
          const { collection, addDoc, getDoc, setDoc } = await import('firebase/firestore');
          const chatId = `${order.id}_client-commerce`;
          const chatRef = doc(db, 'chats', chatId);
          const messagesRef = collection(chatRef, 'messages');
          
          const msgText = `🔄 MODIFICACIÓN DE PEDIDO:\nTotal anterior: ${formatPrice(order.total)}\nNuevo total: ${formatPrice(nT)}\n\nDetalle de cambios:\n${changeDetails.trim()}`;

          const chatSnap = await getDoc(chatRef);
          if (!chatSnap.exists()) {
            await setDoc(chatRef, {
              orderId: order.id,
              orderNum: order.orderId,
              type: 'client-commerce',
              clientName: order.userName,
              comercioName: order.comercioName,
              createdAt: serverTimestamp(),
              lastMessage: msgText,
              lastMessageAt: serverTimestamp()
            });
          } else {
            await updateDoc(chatRef, {
              lastMessage: msgText,
              lastMessageAt: serverTimestamp()
            });
          }

          await addDoc(messagesRef, {
            senderId: commerceId,
            senderName: order.comercioName || 'Comercio',
            text: msgText,
            type: 'text',
            timestamp: serverTimestamp(),
            read: false
          });
        }

        closeModal(); 
        showToast('Pedido modificado con éxito', 'success');
      } catch (err) { 
        b.disabled = false; 
        b.innerHTML = 'Guardar';
        console.error(err);
        showToast('Error al modificar el pedido', 'error');
      }
    });
    renderResults();
  }
  renderModifyUI();
  showModal({ title: `Modificar Pedido #${order.orderId}`, content: modalEl, height: '90dvh', hideHeader: false });
}

async function showNewManualOrderModal(comercioId) {
  // 1. Fetch commerce coordinates and address to enable distance calculations
  let comData = null;
  try {
    const comSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (comSnap.exists()) {
      comData = comSnap.data();
    }
  } catch (err) {
    console.error('Error fetching commerce data:', err);
  }

  if (!comData || !comData.coords) {
    showToast('Debes configurar la ubicación de tu comercio en Ajustes antes de poder crear pedidos manuales.', 'warning');
    return;
  }

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding:24px; background:var(--color-bg); display:flex; flex-direction:column; gap:16px; max-height:85dvh; overflow-y:auto; scrollbar-width:none;';

  // Tracking state variables for resolved address coordinates and costs
  let selectedCoords = null;
  let selectedAddress = '';
  let deliveryCost = 0;
  let estimatedDistance = 0;

  modalEl.innerHTML = `
    <style>
      .manual-address-wrapper {
        position: relative;
        width: 100%;
      }
      .suggestions-list {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--color-bg-card);
        border: 1.5px solid var(--color-border-light);
        border-radius: 12px;
        box-shadow: var(--shadow-lg);
        z-index: 9999;
        max-height: 200px;
        overflow-y: auto;
        margin-top: 4px;
        display: none;
      }
      .suggestion-item {
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
        border-bottom: 1px solid var(--color-border-light);
        transition: background 0.2s;
      }
      .suggestion-item:last-child {
        border-bottom: none;
      }
      .suggestion-item:hover {
        background: var(--color-bg-secondary);
        color: var(--color-primary);
      }
      .pricing-summary-box {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border-light);
        border-radius: 16px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 8px;
      }
      .pricing-summary-box .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text-secondary);
      }
      .pricing-summary-box .row.total-row {
        font-size: 16px;
        color: var(--color-text-primary);
        border-top: 1px solid var(--color-border-light);
        padding-top: 8px;
        margin-top: 4px;
      }
      .pricing-summary-box .value-accent {
        color: var(--color-primary);
        font-weight: 950;
        font-size: 14px;
      }
      .pricing-summary-box .total-accent {
        color: var(--color-primary);
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 20px;
      }
    </style>

    <div style="display:flex; flex-direction:column; gap:16px;">
      <div>
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Cliente / Nombre</label>
        <input type="text" id="manual-name" placeholder="Ej: Juan Perez" style="width:100%; height:48px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text); font-size:14px; padding:0 16px; outline:none;" />
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; display:block;">Dirección de Entrega</label>
        <div style="display:flex; gap:8px; width:100%; position:relative;">
          <div class="manual-address-wrapper" style="flex:1;">
            <input type="text" id="manual-address" placeholder="Escribí calle y altura (ej: Goenaga 120)" autocomplete="off" style="width:100%; height:48px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text); font-size:14px; padding:0 16px; outline:none;" />
            <div id="suggestions-dropdown" class="suggestions-list" style="position: absolute; top: 100%; left: 0; right: 0; background: var(--color-surface, #ffffff); border: 1.5px solid var(--color-border-light, #e2e8f0); border-radius: 12px; box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1)); z-index: 9999; max-height: 200px; overflow-y: auto; margin-top: 4px; display: none;"></div>
          </div>
          <button id="manual-map-btn" type="button" title="Seleccionar en Mapa" style="height:48px; width:48px; border-radius:12px; background:white; border:1.5px solid var(--color-border); color:var(--color-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:var(--shadow-sm); flex-shrink:0;">
            ${icon('mapPin', 20)}
          </button>
        </div>
        <div id="selected-address-badge" style="display:none; font-size:12px; font-weight:700; color:#0d9488; background:rgba(13,148,136,0.08); border:1px solid rgba(13,148,136,0.2); border-radius:8px; padding:8px 12px; align-items:center; gap:6px; word-break:break-all; line-height:1.4;">
          ${icon('checkCircle', 14)} Ubicación establecida
        </div>
      </div>

      <div>
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Detalle del Pedido (Opcional)</label>
        <textarea id="manual-detail" placeholder="Ej: 1 Pizza, 2 Cocas..." style="width:100%; height:70px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text); font-size:14px; padding:12px; outline:none; resize:none; font-family:inherit;"></textarea>
      </div>

      <div>
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Precio de los Productos ($)</label>
        <input type="number" id="manual-subtotal" placeholder="0.00" style="width:100%; height:48px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text); font-size:18px; font-weight:800; padding:0 16px; outline:none;" inputmode="decimal" />
      </div>

      <!-- Pricing Summary Box -->
      <div class="pricing-summary-box">
        <div class="row">
          <span>Productos:</span>
          <span id="subtotal-value">$0.00</span>
        </div>
        <div class="row">
          <span>Costo de Envío:</span>
          <div style="display:flex; flex-direction:column; align-items:flex-end;">
            <span id="delivery-fee-value" class="value-accent">$0.00</span>
            <small id="delivery-dist-value" style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">(0.0 km)</small>
          </div>
        </div>
        <div class="row total-row">
          <span>Total Final:</span>
          <span id="total-final-value" class="total-accent">$0.00</span>
        </div>
      </div>
    </div>

    <button id="create-manual-btn" style="width:100%; height:56px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 12px 24px rgba(var(--color-primary-rgb), 0.3); margin-top:8px;">
      Crear Pedido
    </button>
  `;

  showModal({ title: 'Nuevo Pedido Manual', content: modalEl, height: 'auto' });

  const addressInput = modalEl.querySelector('#manual-address');
  const suggestionsDropdown = modalEl.querySelector('#suggestions-dropdown');
  const badgeEl = modalEl.querySelector('#selected-address-badge');
  const mapBtn = modalEl.querySelector('#manual-map-btn');
  const subtotalInput = modalEl.querySelector('#manual-subtotal');

  // Interactive selection and shipping calculation utility
  const selectLocation = async (coords, address) => {
    selectedCoords = coords;
    selectedAddress = address;
    addressInput.value = address;
    suggestionsDropdown.style.display = 'none';

    // Show verification success badge
    badgeEl.style.display = 'flex';
    badgeEl.innerHTML = `${icon('checkCircle', 14)} Ubicación establecida: <span style="font-weight:800; margin-left:4px; color:var(--color-text);">${address}</span>`;

    // Compute shipping fee based on distance
    try {
      const { getDistance, calculateDynamicFee } = await import('../../utils/geo.js');
      const distance = await getDistance(comData.coords.lat, comData.coords.lng, coords.lat, coords.lng);
      estimatedDistance = distance;

      let fee = calculateDynamicFee(distance);
      // Support rain surcharge
      if (getState().isRaining) {
        fee += (getState().deliveryRainSurcharge || 300);
      }
      deliveryCost = fee;

      // Update summary displays
      modalEl.querySelector('#delivery-fee-value').textContent = formatPrice(deliveryCost);
      modalEl.querySelector('#delivery-dist-value').textContent = `(${distance.toFixed(1)} km)`;

      updateTotals();
    } catch (err) {
      console.error('Error calculating shipping fee:', err);
      showToast('Error al calcular el costo de envío', 'error');
    }
  };

  // Keyboard autocomplete trigger with debouncing
  let debounceTimeout;
  addressInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    const term = e.target.value;
    if (term.trim().length < 3) {
      suggestionsDropdown.style.display = 'none';
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const { searchAddressSuggestions } = await import('../../utils/geo.js');
        const suggestions = await searchAddressSuggestions(term);
        if (suggestions.length === 0) {
          suggestionsDropdown.style.display = 'none';
          return;
        }

        suggestionsDropdown.innerHTML = suggestions.map(s => `
          <div class="suggestion-item" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${s.address}" style="padding: 12px 16px; font-size: 13px; font-weight: 700; color: var(--color-text-primary, #1e293b); cursor: pointer; border-bottom: 1px solid var(--color-border-light, #e2e8f0); background: var(--color-surface, #ffffff); transition: background 0.2s;">
            ${s.address}
          </div>
        `).join('');
        suggestionsDropdown.style.display = 'block';

        suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(item => {
          item.onmouseenter = () => {
            item.style.background = 'var(--color-bg-secondary, #f1f5f9)';
            item.style.color = 'var(--color-primary, #e11d48)';
          };
          item.onmouseleave = () => {
            item.style.background = 'var(--color-surface, #ffffff)';
            item.style.color = 'var(--color-text-primary, #1e293b)';
          };
          item.onclick = () => {
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            const addr = item.dataset.addr;
            selectLocation({ lat, lng }, addr);
          };
        });
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }, 400);
  });

  // Bind Enter key to select the first suggestion
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = suggestionsDropdown.querySelector('.suggestion-item');
      if (firstItem) {
        firstItem.click();
      }
    }
  });

  // Close search suggestions on click outside
  document.addEventListener('click', (e) => {
    if (!addressInput.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
      suggestionsDropdown.style.display = 'none';
    }
  });

  // Map picker integration fallback
  mapBtn.onclick = async () => {
    try {
      const { showLocationPicker } = await import('../../components/location-modal.js');
      showLocationPicker({
        initialCoords: selectedCoords || comData.coords,
        initialAddress: selectedAddress || comData.address || '',
        onSelect: ({ coords, address }) => {
          selectLocation(coords, address);
        }
      });
    } catch (err) {
      console.error('Error loading location picker modal:', err);
      showToast('Error al abrir el mapa', 'error');
    }
  };

  // Live total sum recalculation
  const updateTotals = () => {
    const subtotal = parseFloat(subtotalInput.value) || 0;
    const total = subtotal + deliveryCost;

    modalEl.querySelector('#subtotal-value').textContent = formatPrice(subtotal);
    modalEl.querySelector('#total-final-value').textContent = formatPrice(total);
  };

  subtotalInput.addEventListener('input', updateTotals);

  // Firestore submission validation and write
  modalEl.querySelector('#create-manual-btn').onclick = async () => {
    const name = modalEl.querySelector('#manual-name').value.trim();
    const detail = modalEl.querySelector('#manual-detail').value.trim();
    const subtotal = parseFloat(subtotalInput.value);

    if (!name) {
      showToast('Por favor completa el nombre del cliente', 'warning');
      return;
    }
    if (!selectedCoords) {
      showToast('Por favor selecciona la dirección mediante el buscador o el mapa (obligatorio)', 'warning');
      return;
    }
    if (isNaN(subtotal) || subtotal <= 0) {
      showToast('Por favor ingresa un precio de productos válido mayor a 0', 'warning');
      return;
    }

    const btn = modalEl.querySelector('#create-manual-btn');
    btn.disabled = true;
    btn.innerHTML = icon('loader', 20, 'animate-spin');

    try {
      const orderData = {
        orderId: Math.floor(1000 + Math.random() * 9000),
        comercioId,
        comercioName: comData.name,
        comercioCoords: comData.coords || null,
        comercioAddress: comData.address || '',
        userName: name,
        deliveryAddress: selectedAddress,
        deliveryCoords: selectedCoords,
        deliveryCost: deliveryCost,
        items: [{ name: detail || 'Pedido Manual', qty: 1, price: subtotal }],
        subtotal: subtotal,
        total: subtotal + deliveryCost,
        status: 'confirmed',
        createdAt: serverTimestamp(),
        confirmedAt: serverTimestamp(),
        paymentMethod: 'efectivo',
        paymentStatus: 'pending',
        isManual: true,
        isRaining: getState().isRaining || false,
        rainSurcharge: getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0,
        appUsageFee: 0
      };

      await addDoc(collection(db, 'orders'), orderData);
      closeModal();
      showToast('Pedido manual creado', 'success');
    } catch (err) {
      console.error('Error writing order document:', err);
      showToast('Error al crear pedido', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Crear Pedido';
    }
  };
}

function updateAllUnreadBadges(orders) {
  orders.forEach(o => {
    const count = getUnreadCount(o.id, 'client-commerce');
    const badge = document.getElementById(`unread-badge-${o.id}`);
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'flex' : 'none'; }
  });
}

function getStatusLabel(status) {
  const labels = { pending: 'Pendiente', confirmed: 'Preparando', ready: 'Listo', delivering: 'En camino', completed: 'Entregado', cancelled: 'Cancelado' };
  return labels[status] || 'Pendiente';
}

function getOrderStyles() {
  return `<style>
    :root {
      --status-pending: #f59e0b;
      --status-confirmed: #3b82f6;
      --status-ready: #0d9488;
      --status-delivering: #8b5cf6;
      --status-completed: #10b981;
      --status-cancelled: #e11d48;
    }

    /* ── PAGE LAYOUT ─────────────────────────────── */
    .orders-panel-page { display:flex; flex-direction:column; min-height:calc(100dvh - 140px); background:var(--color-bg-page); }

    /* ── STICKY HEADER ───────────────────────────── */
    .orders-sticky-header {
      display:flex; align-items:center; justify-content:space-between;
      gap:16px; padding:16px 20px;
      background:var(--color-primary);
      flex-shrink:0;
      box-shadow: 0 4px 15px rgba(225, 29, 72, 0.12);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .orders-sticky-header.history-header { gap:14px; justify-content:flex-start; }

    /* Left cluster */
    .orders-header-left { display:flex; align-items:center; gap:12px; min-width:0; }
    .orders-header-icon-wrap {
      width:40px; height:40px; border-radius:12px; flex-shrink:0;
      background:rgba(255, 255, 255, 0.18);
      display:flex; align-items:center; justify-content:center;
      color:white;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .orders-header-info { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .orders-header-title {
      font-family:var(--font-display); font-weight:800; font-size:17px;
      color:white; margin:0; line-height:1.2;
      letter-spacing: -0.3px;
    }
    .orders-header-status-row { display:flex; align-items:center; gap:6px; }
    .orders-live-dot {
      width:6px; height:6px; border-radius:50%; background:#10b981; flex-shrink:0;
      box-shadow:0 0 0 3px rgba(255, 255, 255, 0.35);
      animation:pulseLive 2.2s ease-in-out infinite;
    }
    .orders-live-dot.paused {
      background:#f59e0b; box-shadow:0 0 0 3px rgba(255, 255, 255, 0.35); animation:none;
    }
    @keyframes pulseLive {
      0%,100% { box-shadow:0 0 0 3px rgba(255, 255, 255, 0.35); }
      50% { box-shadow:0 0 0 6px rgba(255, 255, 255, 0.0); }
    }
    .orders-header-subtitle {
      font-size:10px; color:rgba(255, 255, 255, 0.85); margin:0;
      font-weight:800; white-space:nowrap; text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    /* Right action cluster */
    .orders-header-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }

    /* Primary action buttons */
    .hdr-action-btn {
      display:flex; align-items:center; gap:6px;
      height:38px; padding:0 16px; border-radius:12px;
      font-weight:700; font-size:12px; cursor:pointer; border:none;
      transition:all 0.2s cubic-bezier(0.4,0,0.2,1);
      white-space:nowrap;
    }
    .hdr-action-btn:active { transform:scale(0.95); }
    .hdr-btn-primary { background:white; color:var(--color-primary); box-shadow:var(--shadow-sm); }
    .hdr-btn-primary:hover { filter:brightness(1.08); }
    .hdr-btn-danger {
      background:rgba(225,29,72,0.07); border:1.5px solid rgba(225,29,72,0.15);
      color:var(--status-cancelled);
    }
    .hdr-btn-danger svg { color:var(--status-cancelled); }
    .hdr-btn-danger.paused {
      background:rgba(16,185,129,0.07); border-color:rgba(16,185,129,0.2);
      color:var(--status-completed);
    }
    .hdr-btn-danger.paused svg { color:var(--status-completed); }
    .hdr-btn-danger:hover { opacity:0.85; }

    /* Icon-only buttons */
    .hdr-icon-btn {
      display:flex; align-items:center; justify-content:center;
      width:38px; height:38px; border-radius:12px; cursor:pointer;
      background:rgba(255,255,255,0.15);
      border:1px solid rgba(255,255,255,0.1);
      color:white;
      transition:all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      text-decoration:none;
    }
    .hdr-icon-btn:hover {
      background:rgba(255,255,255,0.25);
      transform: translateY(-1px);
    }
    .hdr-icon-btn:active {
      transform:scale(0.94) translateY(0);
      background:rgba(255,255,255,0.35);
    }

    /* ── TAB BAR ─────────────────────────────────── */
    .orders-tab-bar-pro {
      display:flex; gap:8px; padding:12px 16px;
      background:var(--color-bg-card);
      border-bottom:1.5px solid var(--color-border-light);
      overflow-x:auto; scrollbar-width:none; flex-shrink:0;
    }
    .tab-pill-pro {
      flex:1; min-width:78px; height:72px;
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
      background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:18px;
      color:var(--color-text-tertiary); transition:all 0.35s cubic-bezier(0.175,0.885,0.32,1.275);
      cursor:pointer; position:relative;
    }
    .tab-label { font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:inherit; }
    .tab-count-badge {
      position:absolute; top:-7px; right:-7px;
      background:#E11D48; color:white; font-size:9px; font-weight:900;
      min-width:20px; height:20px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 4px 12px rgba(225,29,72,0.25); border:2px solid var(--color-bg-card);
    }
    .tab-pill-pro.active-pending  { background:var(--status-pending);   color:white; border-color:transparent; box-shadow:0 8px 20px rgba(245,158,11,0.25); }
    .tab-pill-pro.active-confirmed{ background:var(--status-confirmed); color:white; border-color:transparent; box-shadow:0 8px 20px rgba(59,130,246,0.25); }
    .tab-pill-pro.active-ready    { background:var(--status-ready);     color:white; border-color:transparent; box-shadow:0 8px 20px rgba(13,148,136,0.25); }
    .tab-pill-pro.active-delivering{background:var(--status-delivering);color:white; border-color:transparent; box-shadow:0 8px 20px rgba(139,92,246,0.25); }

    /* ── ORDER CARDS ─────────────────────────────── */
    .orders-scroll-area { flex:1; padding:14px 16px; }
    .orders-card-list { display:flex; flex-direction:column; gap:10px; }
    .order-card-pro { background:var(--color-bg-card); border-radius:20px; overflow:hidden; display:flex; border:1.5px solid var(--color-border-light); cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,0.03); transition:box-shadow 0.2s, transform 0.15s; }
    .order-card-pro:active { transform:scale(0.985); box-shadow:0 1px 6px rgba(0,0,0,0.04); }
    .card-side-indicator { width:5px; background:var(--color-border-light); flex-shrink:0; }
    .pending   .card-side-indicator { background:var(--status-pending); }
    .confirmed .card-side-indicator { background:var(--status-confirmed); }
    .ready     .card-side-indicator { background:var(--status-ready); }
    .delivering.card-side-indicator { background:var(--status-delivering); }
    .completed .card-side-indicator { background:var(--status-completed); }

    .card-main-content { flex:1; padding:14px 18px; display:flex; flex-direction:column; gap:8px; }
    .card-top-row { display:flex; align-items:center; gap:8px; }
    .order-id-red { font-weight:900; font-size:14px; color:var(--color-text-primary); }
    .order-time-grey { font-size:11px; color:var(--color-text-tertiary); font-weight:600; }
    .card-status-badge { margin-left:auto; font-size:9px; font-weight:800; padding:3px 10px; border-radius:20px; text-transform:uppercase; background:var(--color-bg-secondary); color:var(--color-text-tertiary); letter-spacing:0.04em; }
    .pending .card-status-badge { background:rgba(245,158,11,0.1); color:var(--status-pending); }
    .confirmed .card-status-badge { background:rgba(59,130,246,0.1); color:var(--status-confirmed); }
    .ready .card-status-badge { background:rgba(13,148,136,0.1); color:var(--status-ready); }
    .delivering .card-status-badge { background:rgba(139,92,246,0.1); color:var(--status-delivering); }

    .simplified-card-body { display:flex; justify-content:space-between; align-items:center; }
    .customer-info-minimal strong { font-size:16px; color:var(--color-text-primary); }
    .order-exact-time { font-size:11px; color:var(--color-text-tertiary); display:flex; align-items:center; gap:4px; font-weight:700; margin-top:2px; }
    .price-main { font-weight:900; font-size:20px; color:var(--color-text-primary); }
    .pending .price-main { color:var(--status-pending); }
    .confirmed .price-main { color:var(--status-confirmed); }
    .ready .price-main { color:var(--status-ready); }
    .delivering .price-main { color:var(--status-delivering); }

    /* Modal Fixes */
    .order-detail-modal-root { display:flex; flex-direction:column; height:100%; background:var(--color-bg-page); color:var(--color-text-primary); overflow:hidden; }
    .modal-internal-header { padding:16px 20px 12px; background:var(--color-bg-card); border-bottom:1px solid var(--color-border-light); position:relative; z-index:20; display:flex; flex-direction:column; gap:12px; }
    .header-top-row { display:flex; justify-content:space-between; align-items:flex-start; }
    .header-title-group { display:flex; flex-direction:column; gap:2px; }
    .header-title-group .order-label { font-size:11px; color:var(--color-text-tertiary); text-transform:uppercase; font-weight:800; letter-spacing:1px; }
    .header-title-group .order-number { font-size:24px; font-weight:900; margin:0; color:var(--color-text-primary); line-height:1; }
    .header-actions { display:flex; gap:8px; align-items:center; }
    .modal-close-icon { background:var(--color-bg-secondary); border:1px solid var(--color-border-light); color:var(--color-text-tertiary); width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; }
    .modal-print-icon { background:white; border:1px solid var(--color-border-light); color:var(--color-primary); width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:var(--shadow-sm); }
    .header-bottom-row { display:flex; justify-content:space-between; align-items:center; }
    .order-date { font-weight:700; font-size:13px; color:var(--color-text-tertiary); }

    .detail-scroll-area { flex:1; display:flex; flex-direction:column; padding:12px 16px 0px 16px; overflow:hidden; }
    .detail-body-container { display:flex; flex-direction:column; gap:10px; height:100%; }
    
    .detail-actions-section { background:var(--color-bg-card); padding:16px; border-radius:24px; border:1px solid var(--color-border-light); box-shadow:0 4px 12px rgba(0,0,0,0.03); }
    .detail-actions-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .btn-action { display:flex; align-items:center; justify-content:center; gap:8px; height:52px; border-radius:16px; border:none; font-weight:800; font-size:13px; cursor:pointer; width:100%; box-sizing:border-box; }
    
    .status-pending .btn-action.confirm { background:var(--status-pending); color:white; }
    .status-confirmed .btn-action.confirm { background:var(--status-confirmed); color:white; }
    .status-ready .btn-action.confirm { background:var(--status-ready); color:white; }
    .status-delivering .btn-action.confirm { background:var(--status-delivering); color:white; }
    .btn-action.reject { background:rgba(239, 68, 68, 0.05); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.1); }
    .btn-action.outline { background:var(--color-bg-secondary); color:var(--color-text-primary); border:1px solid var(--color-border-light); position:relative; }

    .detail-timeline { display:flex; flex-direction:column; gap:16px; padding-left:4px; }
    .t-line-item { display:flex; gap:18px; position:relative; }
    .t-line-dot { width:10px; height:10px; border-radius:50%; background:var(--color-border-light); margin-top:5px; z-index:1; border:2px solid var(--color-bg-page); }
    .t-line-item.done .t-line-dot { background:var(--status-completed); box-shadow:0 0 10px rgba(16,185,129,0.3); }
    .t-line-item:not(:last-child)::after { content:''; position:absolute; left:4.5px; top:15px; bottom:-16px; width:1px; background:var(--color-border-light); }
    .t-line-info span { font-size:15px; font-weight:700; color:var(--color-text-tertiary); }
    .t-line-item.done .t-line-info span { color:var(--color-text-primary); }
    .t-line-info small { font-size:11px; color:var(--color-text-tertiary); font-weight:700; display:block; margin-top:2px; }

    .detail-customer-box { background:var(--color-bg-card); border:1px solid var(--color-border-light); padding:16px; border-radius:20px; display:flex; align-items:center; gap:16px; box-shadow:0 4px 12px rgba(0,0,0,0.02); }
    .customer-avatar { width:44px; height:44px; background:var(--color-bg-secondary); border-radius:14px; display:flex; align-items:center; justify-content:center; font-weight:900; color:var(--color-text-tertiary); font-size:18px; border:1px solid var(--color-border-light); }
    .customer-id { font-size:11px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px; }

    .detail-item { display:flex; justify-content:space-between; align-items:center; background:var(--color-bg-card); padding:14px 18px; border-radius:16px; margin-bottom:10px; border:1px solid var(--color-border-light); }
    .item-left { display:flex; align-items:center; gap:12px; }
    .detail-item .qty { color:var(--status-pending); font-weight:900; font-size:14px; }
    .detail-item .name { font-weight:700; color:var(--color-text-primary); }
    .detail-item .price { font-weight:800; color:var(--color-text-primary); }

    .detail-address-box { background:var(--color-bg-card); border:1px solid var(--color-border-light); padding:18px; border-radius:20px; display:flex; gap:14px; align-items:center; box-shadow:0 4px 12px rgba(0,0,0,0.02); }
    .address-text { font-size:14px; color:var(--color-text-secondary); font-weight:600; line-height:1.5; word-break:break-word; flex:1; }

    .detail-footer-dock { flex-shrink:0; background:var(--color-bg-card); border-top:1.5px solid var(--color-border-light); padding:16px 24px; }
    .price-summary-card { display:flex; flex-direction:column; gap:6px; }
    .summary-row { display:flex; justify-content:space-between; font-size:13px; color:var(--color-text-tertiary); font-weight:700; }
    .total-row { font-size:20px; font-weight:900; color:var(--color-text-primary); margin-top:4px; padding-top:8px; border-top:1.5px solid var(--color-border-light); }
    .orders-empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:80px 20px; color:var(--color-text-tertiary); }
    /* Premium Order Detail Modal Redesign */
    .section-title-premium { font-family:var(--font-display); font-size:14px; font-weight:800; color:var(--color-text); margin-bottom:6px; }
    
    .detail-timeline-premium { position:relative; padding-left:12px; }
    .t-line-item { position:relative; padding-bottom:20px; padding-left:24px; }
    .t-line-item:last-child { padding-bottom:0; }
    .t-line-item::before { content:''; position:absolute; left:0; top:6px; bottom:-6px; width:2px; background:var(--color-border-light); border-radius:2px; }
    .t-line-item:last-child::before { display:none; }
    .t-line-dot { position:absolute; left:-4px; top:4px; width:10px; height:10px; border-radius:50%; background:var(--color-border); border:2px solid white; z-index:2; transition:all 0.3s; }
    .t-line-item.done .t-line-dot { background:var(--status-completed); box-shadow:0 0 0 3px rgba(16,185,129,0.15); }
    .t-line-item.danger.done .t-line-dot { background:var(--status-cancelled); box-shadow:0 0 0 3px rgba(225,29,72,0.15); }
    .t-line-info { display:flex; flex-direction:column; gap:2px; }
    .t-line-info span { font-weight:700; font-size:14px; color:var(--color-text); }
    .t-line-info small { font-size:12px; color:var(--color-text-tertiary); font-weight:600; }

    .detail-section { display:flex; flex-direction:column; flex-shrink:0; }
    .productos-section { flex:1; min-height:80px; overflow:hidden; }

    .detail-customer-box-premium { display:flex; align-items:center; gap:12px; background:var(--color-bg-secondary); padding:10px 12px; border-radius:14px; border:1px solid var(--color-border-light); }
    .customer-avatar-premium { width:36px; height:36px; border-radius:10px; background:var(--color-primary-light); color:var(--color-primary); display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-weight:900; font-size:16px; flex-shrink:0; }
    .customer-text-premium { flex:1; min-width:0; }
    .customer-text-premium strong { font-size:14px; display:block; color:var(--color-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .customer-id-premium { font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px; }
    .chat-btn-mini { display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:10px; background:white; border:1px solid var(--color-border-light); font-weight:700; font-size:12px; color:var(--color-text); cursor:pointer; box-shadow:var(--shadow-sm); position:relative; }
    .chat-btn-mini:hover { background:var(--color-bg-secondary); }

    .detail-items-list-premium { display:flex; flex-direction:column; gap:6px; overflow-y:auto; padding-right:8px; padding-bottom:6px; flex:1; height:100%; }
    .detail-items-list-premium::-webkit-scrollbar { width:6px; }
    .detail-items-list-premium::-webkit-scrollbar-track { background:rgba(0,0,0,0.03); border-radius:6px; margin-bottom:6px; }
    .detail-items-list-premium::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.15); border-radius:6px; }
    .detail-item-premium { display:flex; align-items:center; gap:10px; background:var(--color-bg-secondary); padding:8px 12px; border-radius:12px; border:1px solid var(--color-border-light); flex-shrink:0; }
    .item-qty-badge { background:var(--color-primary); color:white; font-weight:900; font-size:11px; width:24px; height:24px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 6px rgba(var(--color-primary-rgb), 0.2); }
    .item-name { flex:1; font-weight:600; font-size:13px; color:var(--color-text); }
    .item-price { font-weight:800; font-size:13px; color:var(--color-text); }

    .detail-address-box-premium { display:flex; gap:12px; background:rgba(var(--color-primary-rgb), 0.05); border:1px solid rgba(var(--color-primary-rgb), 0.1); padding:10px 12px; border-radius:14px; }
    .address-icon-wrap { width:36px; height:36px; border-radius:10px; background:white; color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:var(--shadow-sm); }
    .address-text-content { display:flex; flex-direction:column; gap:2px; flex:1; }
    .address-label { font-size:10px; font-weight:800; text-transform:uppercase; color:var(--color-text-tertiary); letter-spacing:0.05em; }
    .address-text { font-size:13px; font-weight:600; color:var(--color-text); line-height:1.3; }

    .detail-footer-dock-premium { background:var(--color-bg); padding:10px 16px 12px 16px; border-top:1px solid var(--color-border-light); box-shadow:0 -10px 30px rgba(0,0,0,0.05); position:relative; z-index:10; }
    .price-summary-card-premium { background:var(--color-bg-secondary); padding:10px 14px; border-radius:14px; margin-bottom:10px; display:flex; flex-direction:column; gap:6px; border:1px solid var(--color-border-light); }
    .summary-row { display:flex; justify-content:space-between; font-size:13px; color:var(--color-text-secondary); font-weight:600; }
    .summary-divider { height:1px; background:var(--color-border-light); margin:2px 0; }
    .summary-row.total-row { font-size:15px; color:var(--color-text); font-weight:800; padding-top:4px; }
    .total-amount { font-family:var(--font-display); font-size:18px; color:var(--color-primary); }

    .detail-actions-section-premium { display:flex; flex-direction:column; gap:8px; }
    .action-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .btn-action-premium { display:flex; align-items:center; justify-content:center; gap:6px; padding:12px; border-radius:14px; font-weight:800; font-size:13px; border:none; cursor:pointer; transition:all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
    .btn-action-premium:active { transform:scale(0.96); }
    .btn-action-premium.confirm { background:var(--color-primary); color:white; box-shadow:0 8px 24px rgba(var(--color-primary-rgb), 0.3); }
    .btn-action-premium.reject { background:rgba(225,29,72,0.06); color:#e11d48; border:1.5px solid rgba(225,29,72,0.2); }
    .btn-action-premium.outline { background:white; border:1.5px solid var(--color-border); color:var(--color-text); box-shadow:var(--shadow-sm); }
    
    .card-status-badge { padding:6px 12px; border-radius:10px; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:0.05em; display:inline-flex; align-items:center; justify-content:center; }
    .badge-pending { background:#fef3c7; color:#d97706; box-shadow:0 0 0 1px rgba(217,119,6,0.2); }
    .badge-confirmed { background:#dbeafe; color:#2563eb; box-shadow:0 0 0 1px rgba(37,99,235,0.2); }
    .badge-ready { background:#ccfbf1; color:#0d9488; box-shadow:0 0 0 1px rgba(13,148,136,0.2); }
    .badge-delivering { background:#ede9fe; color:#7c3aed; box-shadow:0 0 0 1px rgba(124,58,237,0.2); }
    .badge-completed { background:#d1fae5; color:#059669; box-shadow:0 0 0 1px rgba(5,150,105,0.2); }
    .badge-cancelled { background:#ffe4e6; color:#e11d48; box-shadow:0 0 0 1px rgba(225,29,72,0.2); }

    @media (max-width: 400px) {
      .orders-header-title { font-size: 15px; }
      .orders-sticky-header { padding: 12px 14px; gap: 8px; }
      .orders-header-left { gap: 8px; }
      .orders-header-icon-wrap { width: 36px; height: 36px; border-radius: 10px; }
      .hdr-icon-btn { width: 34px; height: 34px; border-radius: 10px; }
    }

    /* ── MODIFY ORDER MODAL (PREMIUM) ── */
    .modify-order-modal-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-bg);
      color: var(--color-text-primary);
      position: relative;
    }

    /* Header / Tabs */
    .mod-tab-header {
      display: flex;
      background: var(--color-bg-secondary);
      padding: 6px;
      border-radius: 16px;
      margin-bottom: 20px;
      border: 1px solid var(--color-border-light);
    }
    .mod-tab-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px;
      border-radius: 12px;
      border: none;
      background: transparent;
      color: var(--color-text-secondary);
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.25s ease;
    }
    .mod-tab-btn:hover {
      color: var(--color-text-primary);
    }
    .mod-tab-btn.active {
      background: var(--color-bg);
      color: var(--color-primary);
      box-shadow: var(--shadow-sm);
    }

    /* Search Area */
    .mod-search-area {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    .mod-search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      background: var(--color-bg-secondary);
      border: 1.5px solid var(--color-border-light);
      border-radius: 14px;
      padding: 0 16px;
      height: 48px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .mod-search-input-wrapper:focus-within {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.1);
      background: var(--color-bg);
    }
    .mod-search-input-wrapper svg {
      color: var(--color-text-tertiary);
      margin-right: 12px;
    }
    .mod-search-input-wrapper input {
      border: none;
      background: transparent;
      width: 100%;
      height: 100%;
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary);
      outline: none;
    }

    /* Categories */
    .mod-cat-scroll {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
    }
    .mod-cat-scroll::-webkit-scrollbar {
      display: none;
    }
    .mod-cat-pill {
      flex-shrink: 0;
      padding: 8px 16px;
      border-radius: 12px;
      border: 1.5px solid var(--color-border-light);
      background: var(--color-bg-card);
      color: var(--color-text-secondary);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .mod-cat-pill:hover {
      border-color: var(--color-text-tertiary);
      color: var(--color-text-primary);
    }
    .mod-cat-pill.active {
      background: rgba(var(--color-primary-rgb), 0.08);
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    /* Search Results */
    .mod-search-results-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 240px;
      overflow-y: auto;
      margin-top: 4px;
      border-radius: 12px;
    }
    .mod-search-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border-light);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .mod-search-item:hover {
      background: var(--color-bg-card);
      border-color: var(--color-primary-light);
      transform: translateY(-1px);
    }
    .mod-search-item img {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 8px;
      background: var(--color-bg-secondary);
    }
    .mod-search-item-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mod-search-item-info .name {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .mod-search-item-info .price {
      font-size: 12px;
      font-weight: 800;
      color: var(--color-primary);
    }
    .mod-search-item-add {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--color-primary-light);
      color: var(--color-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .mod-search-item:hover .mod-search-item-add {
      background: var(--color-primary);
      color: white;
    }

    /* Items List */
    .mod-items-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
    }
    .mod-empty-items {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      color: var(--color-text-tertiary);
      text-align: center;
    }
    .mod-item-card {
      background: var(--color-bg-card);
      border: 1.5px solid var(--color-border-light);
      border-radius: 16px;
      padding: 12px 16px;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s;
    }
    .mod-item-card:focus-within {
      border-color: var(--color-primary-light);
    }
    .mod-item-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .mod-item-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .mod-item-info .name {
      font-size: 14px;
      font-weight: 700;
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    /* Price Edit Input */
    .price-edit {
      display: flex;
      align-items: center;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border-light);
      border-radius: 8px;
      padding: 2px 8px;
      width: 100px;
    }
    .price-edit span {
      font-size: 12px;
      font-weight: 700;
      color: var(--color-text-secondary);
      margin-right: 2px;
    }
    .price-edit input {
      border: none;
      background: transparent;
      width: 100%;
      font-size: 13px;
      font-weight: 800;
      color: var(--color-text-primary);
      outline: none;
      padding: 0;
    }

    /* Quantity Controls */
    .mod-item-controls {
      display: flex;
      align-items: center;
      background: var(--color-bg-secondary);
      border-radius: 10px;
      padding: 4px;
      border: 1px solid var(--color-border-light);
    }
    .mod-qty-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: none;
      background: var(--color-bg);
      color: var(--color-text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: all 0.2s;
    }
    .mod-qty-btn:hover {
      background: var(--color-bg-secondary);
      color: var(--color-primary);
    }
    .mod-qty-btn:active {
      transform: scale(0.9);
    }
    .mod-qty-val {
      width: 32px;
      text-align: center;
      font-size: 13px;
      font-weight: 800;
      color: var(--color-text-primary);
    }

    /* Remove Button */
    .mod-remove-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: none;
      background: rgba(239, 68, 68, 0.06);
      color: #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
      border: 1px solid rgba(239, 68, 68, 0.1);
    }
    .mod-remove-btn:hover {
      background: #ef4444;
      color: white;
      border-color: #ef4444;
    }
    .mod-remove-btn:active {
      transform: scale(0.9);
    }

    /* Custom / Extra Section */
    .mod-custom-section {
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--color-bg-secondary);
      padding: 20px;
      border-radius: 20px;
      border: 1px solid var(--color-border-light);
    }
    .mod-input-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mod-input-group label {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--color-text-tertiary);
      letter-spacing: 0.05em;
    }
    .mod-input {
      height: 48px;
      padding: 0 16px;
      border-radius: 12px;
      border: 1.5px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-text-primary);
      font-size: 14px;
      font-weight: 700;
      outline: none;
      transition: border-color 0.2s;
    }
    .mod-input:focus {
      border-color: var(--color-primary);
    }
    .mod-input.price {
      font-size: 18px;
      font-weight: 800;
      color: var(--color-primary);
    }

    /* Footer Dock */
    .mod-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px calc(16px + env(safe-area-inset-bottom, 0)) 24px;
      border-top: 1.5px solid var(--color-border-light);
      background: var(--color-bg-card);
      box-shadow: 0 -10px 30px rgba(0,0,0,0.04);
      flex-shrink: 0;
    }
    .mod-total-display {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .mod-total-display .label {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--color-text-tertiary);
      letter-spacing: 0.05em;
    }
    .mod-total-display .amount {
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: 900;
      color: var(--color-primary);
    }
    .mod-save-btn {
      height: 52px;
      padding: 0 28px;
      border-radius: 16px;
      border: none;
      background: var(--color-primary);
      color: white;
      font-size: 15px;
      font-weight: 900;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      box-shadow: 0 8px 24px rgba(var(--color-primary-rgb), 0.3);
    }
    .mod-save-btn:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
    .mod-save-btn:active {
      transform: scale(0.96) translateY(0);
    }
    .mod-save-btn:disabled {
      background: var(--color-border);
      color: var(--color-text-tertiary);
      box-shadow: none;
      cursor: not-allowed;
    }
  </style>`;
}

function playNotificationSound() { try { const sound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); sound.volume = 0.9; sound.play().catch(e => { }); } catch (err) { } }
