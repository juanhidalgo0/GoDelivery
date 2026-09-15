// Delivery history and completed-order-detail modals for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens the "Historial" screen, instead of on every panel load.
import { db } from '../../firebase.js';
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { getOrderDriverEarnings, cleanMandadoText, parseMandadoDetails, isOrderEncomienda } from '../delivery-panel.js';

export async function showDeliveryHistoryModal(user) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { collection, query, where, getDocs, limit, orderBy } = await import('firebase/firestore');

  const latestUser = getState().user || user;
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 12px 14px 0 14px;
    background: var(--driver-bg-panel);
    color: var(--driver-text-primary);
    height: 100%;
    min-height: 0;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    font-family: var(--font-body, sans-serif);
  `;

  modalEl.innerHTML = `
    <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
  `;

  showModal({
    title: `<span style="display:inline-flex; vertical-align:middle; margin-right:6px;">${icon('history', 20)}</span>Historial de Entregas`,
    content: modalEl,
    height: '85dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : '#ffffff'
  });

  try {
    let currentLimit = 35;
    let hasMoreOrders = true;
    let allOrders = [];

    async function fetchOrdersBatch() {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', latestUser.uid),
        where('status', 'in', ['completed', 'cancelled']),
        limit(currentLimit)
      );

      const snap = await getDocs(q);
      allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return tB - tA;
        });

      hasMoreOrders = snap.docs.length >= currentLimit;
    }

    await fetchOrdersBatch();

    let filterSettlement = 'all'; // 'all' | 'unsettled'
    let filterPeriod = 'all'; // 'all' | 'today'

    function renderHistoryList() {
      const now = new Date();
      const todayDateString = now.toDateString();

      const filteredOrders = allOrders.filter(o => {
        // Settlement filter
        if (filterSettlement === 'unsettled') {
          const isSettled = o.isSettledDriver === true;
          if (isSettled) return false;
        }

        // Period filter
        if (filterPeriod === 'today') {
          const oDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : null;
          if (!oDate || oDate.toDateString() !== todayDateString) return false;
        }

        return true;
      });

      const totalDelivered = filteredOrders.filter(o => o.status === 'completed').length;
      const totalEarnings = filteredOrders.filter(o => o.status === 'completed').reduce((sum, o) => {
        return sum + getOrderDriverEarnings(o);
      }, 0);

      modalEl.innerHTML = `
        <!-- FILTER CONTROLS BAR -->
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px; flex-shrink:0;">
          <!-- ROW 1: LIQUIDACION FILTER -->
          <div style="display:flex; gap:6px; background:var(--driver-fill-subtle-b); padding:4px; border-radius:14px;">
            <button id="filter-settle-all" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterSettlement === 'all' ? (isLight ? '#ffffff' : '#e11d48') : 'transparent'};
              color:${filterSettlement === 'all' ? (isLight ? '#0f172a' : '#ffffff') : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterSettlement === 'all' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterSettlement === 'all' ? (isLight ? '0 2px 8px rgba(0,0,0,0.1)' : '0 2px 8px rgba(225,29,72,0.4)') : 'none'};
            ">
              <span style="display:inline-flex; vertical-align:middle;">${icon('clipboard', 12)}</span> Todos (${allOrders.length})
            </button>
            <button id="filter-settle-unsettled" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterSettlement === 'unsettled' ? '#f59e0b' : 'transparent'};
              color:${filterSettlement === 'unsettled' ? '#ffffff' : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterSettlement === 'unsettled' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterSettlement === 'unsettled' ? '0 2px 8px rgba(245,158,11,0.4)' : 'none'};
            ">
              <span style="display:inline-flex; vertical-align:middle;">${icon('hourglass', 12)}</span> No Liquidados
            </button>
          </div>

          <!-- ROW 2: FECHA FILTER -->
          <div style="display:flex; gap:6px; background:var(--driver-fill-subtle-b); padding:4px; border-radius:14px;">
            <button id="filter-period-all" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterPeriod === 'all' ? (isLight ? '#ffffff' : '#2563eb') : 'transparent'};
              color:${filterPeriod === 'all' ? (isLight ? '#0f172a' : '#ffffff') : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterPeriod === 'all' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterPeriod === 'all' ? (isLight ? '0 2px 8px rgba(0,0,0,0.1)' : '0 2px 8px rgba(37,99,235,0.4)') : 'none'};
            ">
              <span style="display:inline-flex; vertical-align:middle;">${icon('calendar', 12)}</span> Todo el Historial
            </button>
            <button id="filter-period-today" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterPeriod === 'today' ? (isLight ? '#0f172a' : '#38bdf8') : 'transparent'};
              color:${filterPeriod === 'today' ? '#ffffff' : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterPeriod === 'today' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterPeriod === 'today' ? '0 2px 8px rgba(0,0,0,0.2)' : 'none'};
            ">
              <span style="display:inline-flex; vertical-align:middle;">${icon('zap', 12)}</span> Hoy
            </button>
          </div>
        </div>

        <!-- TOP STATS KPI -->
        <div style="
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;
          background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'};
          border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
          border-radius: 16px; padding: 10px 14px; flex-shrink: 0;
        ">
          <div style="display:flex; flex-direction:column;">
            <span style="font-size:10px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase;">Entregas Filtradas</span>
            <span style="font-size:20px; font-weight:950; color:var(--driver-text-primary);">${totalDelivered}</span>
          </div>
          <div style="display:flex; flex-direction:column; text-align:right;">
            <span style="font-size:10px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase;">Ganancia Real Total</span>
            <span style="font-size:20px; font-weight:950; color:#10b981;">$${totalEarnings.toLocaleString('es-AR')}</span>
          </div>
        </div>

        <!-- ORDERS LIST CONTAINER WITH NATIVE TOUCH SCROLL -->
        <div id="driver-history-scrollable-list" class="scrollable modal-scrollable-list delivery-orders-list" style="
          flex: 1 1 0;
          min-height: 0;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-y !important;
          overscroll-behavior-y: contain;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-bottom: calc(48px + max(env(safe-area-inset-bottom, 0px), 28px));
          padding-right: 2px;
        ">
          ${filteredOrders.length === 0 ? `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:45px 20px; text-align:center;">
              <div style="display:flex; justify-content:center; margin-bottom:8px; color:var(--driver-text-secondary-inverted);">${icon('search', 40)}</div>
              <h4 style="font-size:15px; font-weight:900; color:var(--driver-text-primary); margin:0 0 4px 0;">Sin entregas para este filtro</h4>
              <p style="font-size:12.5px; color:var(--driver-text-secondary); margin:0;">Probá cambiando los filtros superiores.</p>
            </div>
          ` : filteredOrders.map(o => {
            const isCompleted = o.status === 'completed';
            const isSettled = o.isSettledDriver === true;
            const isEncomienda = isOrderEncomienda(o);
            const orderDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : new Date();
            const dateStr = orderDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
            const timeStr = orderDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const earnings = getOrderDriverEarnings(o);

            let title = 'Pedido';
            if (isEncomienda) {
              title = `<span style="display:inline-flex; vertical-align:middle;">${icon('package', 12)}</span> Encomienda: ${cleanMandadoText(o.details || o.description || o.itemsText || 'Envío de paquete')}`;
            } else if (o.isFavor) {
              const parsed = parseMandadoDetails(o.description || o.itemsText || o.notes || o.details, o.comercioName || o.originAddress);
              title = `<span style="display:inline-flex; vertical-align:middle;">${icon('shoppingBag', 12)}</span> Mandado: ${parsed.comercio || 'Compra'}`;
            } else {
              title = `<span style="display:inline-flex; vertical-align:middle;">${icon('store', 12)}</span> ${o.comercioName || 'Pedido en local'}`;
            }

            const address = o.deliveryAddress || o.address || 'Magdalena';
            const itemsList = Array.isArray(o.items) ? o.items : (Array.isArray(o.products) ? o.products : []);

            return `
              <div class="history-order-card-item" data-order-id="${o.id}" style="
                background: ${isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.03)'};
                border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
                border-radius: 16px; padding: 12px 14px;
                display: flex; flex-direction: column; gap: 8px;
                box-shadow: 0 2px 8px ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.2)'};
                cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;
              ">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="background:${isCompleted ? '#dcfce7' : '#fee2e2'}; color:${isCompleted ? '#166534' : '#dc2626'}; font-size:10px; font-weight:900; padding:2px 7px; border-radius:6px;">
                      ${isCompleted ? '✓ Entregado' : '✕ Cancelado'}
                    </span>
                    <span style="background:${isSettled ? (isLight ? '#e0e7ff' : 'rgba(99,102,241,0.2)') : (isLight ? '#fef3c7' : 'rgba(245,158,11,0.2)')}; color:${isSettled ? (isLight ? '#3730a3' : '#a5b4fc') : (isLight ? '#b45309' : '#fbbf24')}; font-size:10px; font-weight:900; padding:2px 7px; border-radius:6px;">
                      ${isSettled ? '✓ Liquidado' : icon('hourglass', 10) + ' No liquidado'}
                    </span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:11px; font-weight:700; color:var(--driver-text-secondary);">
                      ${dateStr} · ${timeStr}
                    </span>
                    <span style="font-size:11px; font-weight:900; color:${isLight ? '#0f172a' : '#cbd5e1'};">
                      #${o.orderId || (o.id ? o.id.slice(-4) : '')}
                    </span>
                  </div>
                </div>

                <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
                  <div style="min-width:0; flex:1;">
                    <div style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${title}
                    </div>
                    <div style="font-size:11.5px; color:var(--driver-text-secondary); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; display:flex; align-items:center; gap:4px;">
                      <span style="display:inline-flex; flex-shrink:0;">${icon('mapPin', 11)}</span> ${address}
                    </div>
                  </div>
                  <div style="text-align:right; flex-shrink:0;">
                    <div style="font-size:15px; font-weight:950; color:${isCompleted ? '#10b981' : (isLight ? '#94a3b8' : '#64748b')};">
                      +$${earnings.toLocaleString('es-AR')}
                    </div>
                    <div style="font-size:10px; font-weight:700; color:var(--driver-text-secondary); margin-top:1px;">
                      Total: $${Number(o.totalAmount || o.total || 0).toLocaleString('es-AR')}
                    </div>
                  </div>
                </div>

                ${itemsList.length > 0 ? `
                  <div style="font-size:11px; color:var(--driver-text-secondary); font-weight:600; background:${isLight ? '#f8fafc' : 'rgba(0,0,0,0.2)'}; padding:4px 8px; border-radius:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${icon('shoppingBag', 11)} ${itemsList.map(it => `${it.quantity || it.cant || 1}x ${it.name || it.title || 'Ítem'}`).join(', ')}
                  </div>
                ` : ''}

                <div style="display:flex; align-items:center; justify-content:flex-end; gap:4px; font-size:11px; font-weight:800; color:var(--color-primary); margin-top:2px;">
                  <span>Ver detalle completo y chat</span>
                  <span>→</span>
                </div>
              </div>
            `;
          }).join('')}

          ${hasMoreOrders ? `
            <button id="btn-load-more-history" style="
              height: 48px; border-radius: 14px;
              background: var(--driver-fill-subtle-b);
              color: var(--driver-text-primary);
              border: 1.5px solid var(--driver-border-b);
              font-weight: 850; font-size: 13px;
              cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
              margin-top: 4px; margin-bottom: 12px; transition: all 0.2s;
            ">
              <span style='display:inline-flex;'>${icon('history', 16)}</span>
              <span>Cargar más entregas anteriores...</span>
            </button>
          ` : ''}
        </div>
      `;

      // Attach filter click listeners
      const btnSettleAll = modalEl.querySelector('#filter-settle-all');
      const btnSettleUnsettled = modalEl.querySelector('#filter-settle-unsettled');
      const btnPeriodAll = modalEl.querySelector('#filter-period-all');
      const btnPeriodToday = modalEl.querySelector('#filter-period-today');
      const btnLoadMore = modalEl.querySelector('#btn-load-more-history');

      if (btnSettleAll) btnSettleAll.onclick = () => { filterSettlement = 'all'; renderHistoryList(); };
      if (btnSettleUnsettled) btnSettleUnsettled.onclick = () => { filterSettlement = 'unsettled'; renderHistoryList(); };
      if (btnPeriodAll) btnPeriodAll.onclick = () => { filterPeriod = 'all'; renderHistoryList(); };
      if (btnPeriodToday) btnPeriodToday.onclick = () => { filterPeriod = 'today'; renderHistoryList(); };

      if (btnLoadMore) {
        btnLoadMore.onclick = async () => {
          btnLoadMore.disabled = true;
          btnLoadMore.innerHTML = `<span style='display:inline-flex;'>${icon('hourglass', 14)}</span> <span>Cargando entregas...</span>`;
          currentLimit += 35;
          await fetchOrdersBatch();
          renderHistoryList();
        };
      }

      // Attach order card click listeners
      modalEl.querySelectorAll('.history-order-card-item').forEach(card => {
        card.onclick = () => {
          const oId = card.dataset.orderId;
          const target = allOrders.find(x => x.id === oId);
          if (target) {
            openCompletedOrderDetailsModal(target, latestUser);
          }
        };
      });
    }

    renderHistoryList();
  } catch (err) {
    console.error('Error loading delivery history modal:', err);
    modalEl.innerHTML = `
      <div style="padding:30px; text-align:center; color:#ef4444; font-weight:800;">
        Error al cargar el historial. Reintenta.
      </div>
    `;
  }
}

export async function openCompletedOrderDetailsModal(order, user) {
  if (!order) return;
  const { showModal } = await import('../../components/modal.js');
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';
  const latestUser = getState().user || user || {};

  const isCompleted = order.status === 'completed';
  const isSettled = order.isSettledDriver === true;
  const isCash = order.paymentMethod === 'efectivo' || (order.paymentMethod && order.paymentMethod.toString().toLowerCase().includes('efect'));
  const isFavor = Boolean(order.isFavor);
  const isEncomienda = isOrderEncomienda(order);

  const orderDate = order.createdAt ? (order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt)) : new Date();
  const dateStr = orderDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = orderDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const clientFullName = order.userName || order.clientName || 'Cliente';
  const clientPhoto = order.userPhoto || order.clientPhoto || '';
  const clientPhone = order.userPhone || order.clientPhone || order.phone || '';
  const cleanPhone = clientPhone.replace(/\D/g, '');
  const waPhone = cleanPhone.startsWith('54') ? cleanPhone : `549${cleanPhone.replace(/^0+/, '')}`;
  const waUrl = cleanPhone ? `https://wa.me/${waPhone}` : '';

  const pickupAddr = order.pickupAddress || order.originAddress || order.comercioAddress || (isFavor ? 'Local de compra' : (order.comercioName || 'Comercio'));
  const deliveryAddr = order.deliveryAddress || order.address || 'Magdalena';

  // Earnings calculations
  const deliveryFee = Number(order.deliveryCost || order.shippingCost || order.deliveryFee || order.cost || 0);
  const purchaseFee = Number(order.purchaseFee || order.mandadoFee || order.managementFee || order.mandadoPersonalFee || order.gestionCost || 0);
  const extraStopsFee = Number(order.extraStopsCost || order.extraStopsFee || order.paradasCost || 0);
  const rainSurcharge = Number(order.rainSurcharge || order.deliveryRainSurcharge || order.recargoLluvia || (order.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const nightSurcharge = Number(order.nightSurcharge || order.nightFee || 0);
  const tipAmount = Number(order.tip || order.tipAmount || order.propina || 0);
  const driverEarnings = getOrderDriverEarnings(order);

  const productsCost = Number(order.purchaseCost !== undefined ? order.purchaseCost : (order.purchaseItemsTotal || order.subtotal || order.itemsTotal || 0));
  const appUsageFee = Number(order.appUsageFee || order.serviceFee || 0);
  const pointsDiscount = Number(order.pointsDiscount || order.discountPoints || order.pointsValue || order.pointsUsedDiscount || 0);
  const couponDiscount = Number(order.couponDiscount || order.discount || 0);
  const grandTotal = Number(order.totalAmount || order.total || 0);
  const itemsList = Array.isArray(order.items) ? order.items : (Array.isArray(order.products) ? order.products : []);

  let serviceLabel = icon('store', 12) + ' Pedido en Local';
  let detailsText = '';
  if (isEncomienda) {
    serviceLabel = icon('package', 12) + ' Encomienda';
    detailsText = cleanMandadoText(order.details || order.description || order.itemsText || 'Envío de paquete');
  } else if (isFavor) {
    const parsed = parseMandadoDetails(order.description || order.itemsText || order.notes || order.details, order.comercioName || order.originAddress);
    serviceLabel = icon('shoppingBag', 12) + ` Mandado: ${parsed.comercio || 'Compra'}`;
    detailsText = parsed.items;
  } else {
    serviceLabel = icon('store', 12) + ` ${order.comercioName || 'Pedido'}`;
    if (itemsList.length > 0) {
      detailsText = itemsList.map(it => `${it.quantity || it.cant || 1}x ${it.name || it.title || 'Ítem'}`).join(', ');
    }
  }

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 16px 18px calc(24px + env(safe-area-inset-bottom, 16px)) 18px;
    background: var(--driver-bg-panel);
    color: var(--driver-text-primary);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    font-family: var(--font-body, sans-serif);
    overflow-y: auto;
    max-height: 82vh;
    -webkit-overflow-scrolling: touch;
  `;

  modalEl.innerHTML = `
    <!-- 1. STATUS & DATE BAR -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; background:var(--driver-fill-faint); padding:8px 12px; border-radius:14px; border:1px solid var(--driver-border);">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="background:${isCompleted ? '#dcfce7' : '#fee2e2'}; color:${isCompleted ? '#166534' : '#dc2626'}; font-size:11px; font-weight:900; padding:3px 8px; border-radius:8px;">
          ${isCompleted ? '✓ Entregado' : '✕ Cancelado'}
        </span>
        <span style="background:${isSettled ? (isLight ? '#e0e7ff' : 'rgba(99,102,241,0.2)') : (isLight ? '#fef3c7' : 'rgba(245,158,11,0.2)')}; color:${isSettled ? (isLight ? '#3730a3' : '#a5b4fc') : (isLight ? '#b45309' : '#fbbf24')}; font-size:11px; font-weight:900; padding:3px 8px; border-radius:8px;">
          ${isSettled ? '✓ Liquidado' : icon('hourglass', 10) + ' No liquidado'}
        </span>
      </div>
      <div style="font-size:11.5px; font-weight:800; color:var(--driver-text-secondary);">
        ${dateStr} · ${timeStr}
      </div>
    </div>

    <!-- 2. CLIENT CARD -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--driver-fill-faint); padding:10px 14px; border-radius:16px; border:1px solid var(--driver-border);">
      <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
        ${clientPhoto ? `
          <img src="${clientPhoto}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid #e11d48;" />
        ` : `
          <div style="width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg, #e11d48, #be123c); display:flex; align-items:center; justify-content:center; color:white; font-size:16px; font-weight:900;">
            ${clientFullName.charAt(0).toUpperCase()}
          </div>
        `}
        <div style="min-width:0; flex:1;">
          <div style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${clientFullName}
          </div>
          <div style="font-size:11px; font-weight:700; color:var(--driver-text-secondary); margin-top:1px;">
            ${clientPhone ? icon('phone', 11) + ` ${clientPhone}` : 'Cliente GoDelivery'}
          </div>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:6px;">
        ${waUrl ? `
          <a href="${waUrl}" target="_blank" rel="noopener noreferrer" aria-label="Abrir WhatsApp con el cliente" style="width:36px; height:36px; border-radius:50%; background:#25D366; color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; box-shadow:0 3px 10px rgba(37,211,102,0.4);" title="WhatsApp">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          </a>
        ` : ''}
        <button id="open-history-chat-btn" aria-label="Abrir chat con el cliente" style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg, #e11d48, #be123c); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 3px 10px rgba(225,29,72,0.4);" title="Abrir Chat">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </button>
      </div>
    </div>

    <!-- 3. SERVICE & LOCATIONS CARD -->
    <div style="background:var(--driver-fill-faint); border:1px solid var(--driver-border); border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:8px;">
      <div style="font-size:13.5px; font-weight:900; color:var(--driver-accent-text);">
        ${serviceLabel}
      </div>
      ${detailsText ? `
        <div style="font-size:12px; color:var(--driver-text-tertiary); font-weight:700; background:${isLight ? '#ffffff' : 'rgba(0,0,0,0.2)'}; padding:8px 10px; border-radius:10px; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.06)'};">
          ${icon('edit', 11)} <strong>Detalle:</strong> ${detailsText}
        </div>
      ` : ''}
      <div style="font-size:11.5px; font-weight:600; color:var(--driver-text-secondary-b); display:flex; flex-direction:column; gap:4px; margin-top:2px;">
        <div>${icon('mapPin', 11)} <strong>Retiro:</strong> ${pickupAddr}</div>
        <div>${icon('home', 11)} <strong>Entrega:</strong> ${deliveryAddr}</div>
        ${(order.addressNotes || order.notes) ? `<div>${icon('edit', 11)} <strong>Nota entrega:</strong> "${cleanMandadoText(order.addressNotes || order.notes)}"</div>` : ''}
      </div>
    </div>

    <!-- 4. ITEM BY ITEM FINANCIAL BREAKDOWN -->
    <div style="background:var(--driver-fill-faint); border:1px solid var(--driver-border); border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:6px;">
      <div style="font-size:11px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
        Desglose Económico:
      </div>

      ${productsCost > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--driver-text-tertiary);">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('shoppingBag', 11)} ${isFavor ? 'Productos Comprados' : 'Subtotal Productos'}:</span>
          <span style="font-weight:800;">$${productsCost.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--driver-text-tertiary);">
        <span style="display:inline-flex;align-items:center;gap:4px;">${icon('motorcycle', 11)} Costo de Envío:</span>
        <span style="font-weight:800;">$${deliveryFee.toLocaleString('es-AR')}</span>
      </div>

      ${purchaseFee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--driver-text-tertiary);">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('zap', 11)} Gestión / Compra:</span>
          <span style="font-weight:800;">$${purchaseFee.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${extraStopsFee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--driver-text-tertiary);">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('mapPin', 11)} Paradas Adicionales:</span>
          <span style="font-weight:800;">$${extraStopsFee.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${rainSurcharge > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#0284c7;">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('cloudRain', 11)} Recargo por Lluvia:</span>
          <span style="font-weight:800;">+$${rainSurcharge.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${nightSurcharge > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#7c3aed;">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('moon', 11)} Recargo Nocturno:</span>
          <span style="font-weight:800;">+$${nightSurcharge.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${tipAmount > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#10b981;">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('gift', 11)} Propina:</span>
          <span style="font-weight:800;">+$${tipAmount.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      <!-- HIGHLIGHTED DRIVER REAL EARNING -->
      <div style="margin:6px 0; padding:8px 10px; border-radius:12px; background:${isLight ? '#ecfdf5' : 'rgba(16,185,129,0.12)'}; border:1.5px solid ${isLight ? '#a7f3d0' : 'rgba(16,185,129,0.3)'}; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:12px; font-weight:900; color:#047857; display:inline-flex; align-items:center; gap:4px;">${icon('wallet', 12)} TU GANANCIA REAL:</span>
        <span style="font-size:16px; font-weight:950; color:#10b981;">+$${driverEarnings.toLocaleString('es-AR')}</span>
      </div>

      ${appUsageFee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--driver-text-secondary);">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('smartphone', 11)} Tarifa por Servicio App:</span>
          <span style="font-weight:700;">$${appUsageFee.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${pointsDiscount > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#10b981;">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('gem', 11)} Descuento GoPuntos:</span>
          <span style="font-weight:800;">-$${pointsDiscount.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${couponDiscount > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#10b981;">
          <span style="display:inline-flex;align-items:center;gap:4px;">${icon('tag', 11)} Descuento Cupón:</span>
          <span style="font-weight:800;">-$${couponDiscount.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      <div style="border-top:1px solid var(--driver-border); padding-top:6px; margin-top:2px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:13px; font-weight:900; color:var(--driver-text-primary);">Total Pedido:</div>
          <div style="font-size:10px; font-weight:700; color:${isCash ? '#d97706' : '#0284c7'}; text-transform:uppercase;">
            ${isCash ? icon('dollarSign', 12) + ' Efectivo' : icon('creditCard', 12) + ' Transferencia'}
          </div>
        </div>
        <div style="font-size:17px; font-weight:950; color:var(--driver-text-primary);">
          $${grandTotal.toLocaleString('es-AR')}
        </div>
      </div>
    </div>

    <!-- 5. ACTION BUTTON: OPEN FINALIZED CHAT -->
    <button id="open-chat-action-btn" style="
      width: 100%; height: 46px; border-radius: 14px; border: none;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
      color: white; font-size: 13.5px; font-weight: 900;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer; box-shadow: 0 4px 16px rgba(225, 29, 72, 0.4);
      margin-top: 4px;
    ">
      <span style="display:inline-flex;">${icon('chatBubble', 16)}</span>
      <span>Ver Chat con el Cliente</span>
    </button>
  `;

  showModal({
    title: `<span style="display:inline-flex; vertical-align:middle; margin-right:6px;">${icon('receipt', 20)}</span>Pedido #${order.orderId || (order.id ? order.id.slice(-4) : '')}`,
    content: modalEl,
    height: '85dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : '#ffffff'
  });

  const chatTrigger = (e) => {
    e.stopPropagation();
    import('../../components/chat.js').then(({ openChat }) => {
      openChat({
        orderId: order.id,
        type: 'client-delivery',
        otherName: clientFullName,
        orderNum: order.orderId,
        senderDisplayName: latestUser.displayName || latestUser.name || 'Repartidor'
      });
    });
  };

  const btnHistoryChat = modalEl.querySelector('#open-history-chat-btn');
  const btnChatAction = modalEl.querySelector('#open-chat-action-btn');
  if (btnHistoryChat) btnHistoryChat.onclick = chatTrigger;
  if (btnChatAction) btnChatAction.onclick = chatTrigger;
}

