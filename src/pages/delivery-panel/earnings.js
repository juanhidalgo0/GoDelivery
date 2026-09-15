// Earnings, balance and session-history rendering for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens a "Ganancias" screen, instead of on every panel load.
import { db } from '../../firebase.js';
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { getOrderDriverEarnings, getSessionTimestamp } from '../delivery-panel.js';

export function renderFinancesCharts(orders) {
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
    <div style="background:var(--driver-bg-elevated); border:1.5px solid var(--driver-border); border-radius:24px; padding:18px; box-shadow:0 8px 24px rgba(0,0,0,0.06); display:flex; flex-direction:column; gap:16px;">
      <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--driver-text-primary); display:flex; align-items:center; gap:6px;">
        ${icon('chart', 16)} Actividad Semanal
      </h4>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; height:120px; padding:10px 0 5px; box-sizing:border-box;">
        ${dailyData.map(d => {
          const heightPct = Math.round((d.amount / maxDaily) * 100);
          return `
            <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:6px; cursor:pointer;" class="bar-chart-col">
              <div style="font-size:8px; font-weight:900; color:var(--driver-text-secondary); transform:scale(0.8); transition:all 0.2s;" class="bar-amount">${d.amount > 0 ? formatPrice(d.amount) : ''}</div>
              <div style="position:relative; width:12px; height:70px; background:var(--driver-bg-panel); border-radius:6px; overflow:hidden;">
                <div style="position:absolute; bottom:0; left:0; width:100%; height:${heightPct}%; background:linear-gradient(to top, #e11d48, #60a5fa); border-radius:6px; transition:height 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);"></div>
              </div>
              <div style="font-size:9.5px; font-weight:900; color:var(--driver-text-secondary);">${d.dayName}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Doughnut Distribution Chart -->
    <div style="background:var(--driver-bg-elevated); border:1.5px solid var(--driver-border); border-radius:24px; padding:18px; box-shadow:0 8px 24px rgba(0,0,0,0.06); display:flex; flex-direction:column; gap:16px;">
      <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--driver-text-primary); display:flex; align-items:center; gap:6px;">
        ${icon('star', 15)} Distribución de Ganancias
      </h4>
      ${total > 0 ? `
        <div style="display:flex; align-items:center; gap:20px; justify-content:space-around;">
          <!-- SVG Donut -->
          <div style="position:relative; width:100px; height:100px;">
            <svg viewBox="0 0 42 42" width="100" height="100" style="transform:rotate(-90deg);">
              <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="var(--driver-border)" stroke-width="4.5"></circle>
              <!-- Base -->
              ${basePct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#3b82f6" stroke-width="4.5" stroke-dasharray="${strokeDash1}" stroke-dashoffset="${offset1}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
              <!-- Tips -->
              ${tipsPct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#10b981" stroke-width="4.5" stroke-dasharray="${strokeDash2}" stroke-dashoffset="${offset2}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
              <!-- Extras -->
              ${extrasPct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#f59e0b" stroke-width="4.5" stroke-dasharray="${strokeDash3}" stroke-dashoffset="${offset3}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
            </svg>
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none;">
              <span style="font-size:9px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.05em; line-height:1;">Total</span>
              <span style="font-size:12.5px; font-weight:950; color:var(--driver-text-primary); letter-spacing:-0.5px;">${formatPrice(total)}</span>
            </div>
          </div>

          <!-- Legends and values -->
          <div style="display:flex; flex-direction:column; gap:8px; flex:1;">
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#3b82f6;"></div>
                <span style="color:var(--driver-text-label); font-weight:800;">Tarifa Envío</span>
              </div>
              <span style="font-weight:900; color:var(--driver-text-primary);">${basePct}%</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#10b981;"></div>
                <span style="color:var(--driver-text-label); font-weight:800;">Propinas</span>
              </div>
              <span style="font-weight:900; color:var(--driver-text-primary);">${tipsPct}%</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#f59e0b;"></div>
                <span style="color:var(--driver-text-label); font-weight:800;">Extras/Viajes</span>
              </div>
              <span style="font-weight:900; color:var(--driver-text-primary);">${extrasPct}%</span>
            </div>
          </div>
        </div>
      ` : `
        <div style="text-align:center; padding:20px; font-size:11.5px; color:var(--driver-text-secondary); font-weight:700;">
          Aún no tienes entregas completadas en este período para graficar.
        </div>
      `}
  `;
}

export async function loadProfessionalStats(driverId, callback = null) {
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

export async function showBalanceManagementModal(user, debt) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');
  const { collection, query, where, getDocs } = await import('firebase/firestore');
  const { db } = await import('../../firebase.js');

  const pendingProofs = getState().pendingProofs || [];
  const totalPending = pendingProofs.reduce((sum, p) => sum + (p.amount || 0), 0);
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  // Fetch pending completed orders with coupons
  let pendingCouponOrders = [];
  try {
    const qOrders = query(
      collection(db, 'orders'),
      where('driverId', '==', user.uid),
      where('status', '==', 'completed')
    );
    const ordersSnap = await getDocs(qOrders);
    pendingCouponOrders = ordersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => o.isSettledDriver !== true && (o.couponDiscount || 0) > 0);
  } catch (err) {
    console.warn('[BalanceModal] Error fetching coupon orders:', err);
  }

  const totalCouponsCredit = pendingCouponOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
  const grossDebt = debt || 0;
  const netDebt = Math.max(0, grossDebt - totalCouponsCredit);

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)) 20px; background:var(--driver-bg-panel); height:100%; display:flex; flex-direction:column; overflow:hidden; justify-content:space-between;`;
  
  modalEl.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; gap:14px; overflow-y:auto; padding-right:2px;">
      <!-- Main Debt / Net Card -->
      <div class="debt-card-v3" style="
        background: ${netDebt > 0 ? (isLight ? 'rgba(225, 29, 72, 0.05)' : 'rgba(225, 29, 72, 0.08)') : (isLight ? 'rgba(16, 185, 129, 0.06)' : 'rgba(16, 185, 129, 0.1)')};
        border: 1.5px solid ${netDebt > 0 ? (isLight ? 'rgba(225, 29, 72, 0.2)' : 'rgba(225, 29, 72, 0.28)') : (isLight ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.35)')};
        border-radius: 24px; padding: 20px;
        box-shadow: 0 10px 30px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.35)'};
        text-align: center;
        flex-shrink: 0;
        margin-top: 4px;
      ">
        <span style="font-size:11px; font-weight:900; color:${netDebt > 0 ? '#e11d48' : '#10b981'}; text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:4px;">
          ${totalCouponsCredit > 0 ? 'Balance Neto a Liquidar' : 'Balance Pendiente'}
        </span>
        <div style="font-size:36px; font-weight:950; color:${netDebt > 0 ? '#e11d48' : '#10b981'}; letter-spacing:-1.5px; line-height:1.1;">
          ${formatPrice(netDebt)}
        </div>
        <p style="font-size:12px; color:var(--driver-text-label); margin:8px 0 0; font-weight:600; line-height:1.45;">
          ${totalCouponsCredit > 0 ? `Total calculado descontando ${formatPrice(totalCouponsCredit)} a tu favor por cupones.` : (grossDebt > 0 ? 'Total a liquidar con la plataforma.' : '¡Tu cuenta está al día sin deudas pendientes!')}
        </p>
      </div>

      <!-- Transparent Breakdown Card when coupons exist -->
      ${totalCouponsCredit > 0 ? `
        <div style="background:var(--driver-fill-faint); border:1.5px solid var(--driver-border); border-radius:20px; padding:14px 16px; display:flex; flex-direction:column; gap:8px; box-shadow:${isLight ? '0 4px 12px rgba(0,0,0,0.03)' : 'none'};">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; color:var(--driver-text-secondary);">
            <span>Deuda en Sistema (Tarifas / Cánones):</span>
            <strong style="color:#ef4444; font-weight:900; font-size:13.5px;">${formatPrice(grossDebt)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; color:var(--driver-text-secondary);">
            <span style="display:flex; align-items:center; gap:6px;">
              <span style="background:rgba(168,85,247,0.15); color:#a855f7; font-size:9.5px; font-weight:950; padding:2px 6px; border-radius:6px; text-transform:uppercase;">${pendingCouponOrders.length} ${pendingCouponOrders.length === 1 ? 'pedido' : 'pedidos'}</span>
              Crédito por Cupones Entregados:
            </span>
            <strong style="color:#a855f7; font-weight:950; font-size:13.5px;">-${formatPrice(totalCouponsCredit)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1.5px dashed var(--driver-border-strong); padding-top:8px; font-weight:950; margin-top:2px;">
            <span style="color:var(--driver-text-primary); font-size:13px;">Neto Real a Transferir:</span>
            <strong style="color:${netDebt > 0 ? '#10b981' : '#10b981'}; font-size:15px;">${formatPrice(netDebt)}</strong>
          </div>
        </div>

        <!-- Orders with coupons list -->
        <div style="background:rgba(168,85,247,0.05); border:1px solid rgba(168,85,247,0.18); border-radius:18px; padding:12px 14px; display:flex; flex-direction:column; gap:6px;">
          <div style="font-size:10.5px; font-weight:900; color:#a855f7; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
            <span style="display:inline-flex;">${icon('ticket', 12)}</span> Detalle de Cupones Aplicados
          </div>
          <div style="display:flex; flex-direction:column; gap:4px; max-height:100px; overflow-y:auto;">
            ${pendingCouponOrders.map(o => `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--driver-text-label);">
                <span>Pedido #${o.orderId || o.id.slice(0,6)} ${o.commerceName ? `(${o.commerceName})` : ''}</span>
                <strong style="color:#a855f7; font-weight:850;">-${formatPrice(o.couponDiscount)}</strong>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${totalPending > 0 ? `
        <div style="background:${isLight ? '#fef3c7' : 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(217,119,6,0.04) 100%)'}; border:1px solid ${isLight ? '#fde68a' : 'rgba(245,158,11,0.25)'}; border-radius:18px; padding:12px 16px; display:flex; gap:8px; align-items:center; margin-top:2px; box-shadow:0 8px 24px rgba(0,0,0,0.06); flex-shrink:0;">
          <span style="display:inline-flex;">${icon('hourglass', 16)}</span>
          <div style="font-size:11.5px; color:#d97706; font-weight:700; line-height:1.4; text-align:left;">
            Tenés una transferencia de <strong style="font-weight:900;">${formatPrice(totalPending)}</strong> pendiente de validación por administración.
          </div>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; flex-shrink:0;">
        <button id="modal-view-history-btn" style="height:50px; border-radius:16px; background:var(--driver-fill-subtle-b); border:1.5px solid var(--driver-border-soft); color:var(--driver-text-primary); font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; transition:all 0.2s;">
          ${icon('history', 16)} Historial
        </button>
        <button id="modal-regularize-btn" style="height:50px; border-radius:16px; background:#e11d48; border:none; color:white; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; box-shadow:0 6px 16px rgba(225, 29, 72, 0.35); transition:all 0.2s;">
          ${icon('wallet', 16)} Regularizar
        </button>
      </div>
    </div>

    <button id="modal-send-proof-btn" style="width:100%; height:54px; border-radius:18px; background:#25D366; border:none; color:white; font-weight:950; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; box-shadow:0 8px 20px rgba(37, 211, 102, 0.25); flex-shrink:0; margin-top:12px;">
      ${icon('whatsappLogo', 20)} Enviar comprobante
    </button>
  `;

  showModal({ 
    title: 'Gestión de Balance', 
    content: modalEl, 
    height: '75dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
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
    showRegularizeModal(netDebt, grossDebt, totalCouponsCredit);
  };
  modalEl.querySelector('#modal-send-proof-btn').onclick = () => {
    const pendingProofs = getState().pendingProofs || [];
    if (pendingProofs.length > 0) {
      showToast('⚠️ Ya tenés una liquidación pendiente de verificación.', 'warning');
      return;
    }
    const wsp = getState().whatsappPayments || '5491123456789';
    const detailMsg = totalCouponsCredit > 0
      ? `\nMONTO NETO A TRANSFERIR: ${formatPrice(netDebt)}\n(Deuda bruta: ${formatPrice(grossDebt)} - Cupones: ${formatPrice(totalCouponsCredit)})\nDETALLE: Saldar balance neto pendiente.`
      : `\nMONTO: ${formatPrice(grossDebt)}\nDETALLE: Saldar balance pendiente.`;
    const msg = encodeURIComponent(`Hola, adjunto comprobante de pago de GoDelivery.\n---\nREPARTIDOR: ${user.displayName || user.name}\nID: ${user.deliveryId || '---'}${detailMsg}`);
    window.open(`https://wa.me/${wsp}?text=${msg}`, '_blank');
  };
}

export async function showRegularizeModal(netDebt, grossDebt = netDebt, totalCouponsCredit = 0) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)) 20px; background:var(--driver-bg-panel); color:var(--driver-text-primary); height:100%; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden;`;
  
  const bankAlias = getState().bankAlias || 'godelivery.oficial';
  const bankOwner = getState().bankOwner || 'GoDelivery S.R.L.';

  modalEl.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; gap:16px; overflow-y:auto; margin-bottom:12px;">
      <div style="text-align:center; padding:4px 0;">
        <p style="font-size:13px; color:var(--driver-text-label); margin:0 0 6px 0; font-weight:600; line-height:1.45;">
          ${totalCouponsCredit > 0 ? `Deuda en sistema: <strong style="color:#ef4444;">${formatPrice(grossDebt)}</strong> | Descuento cupones: <strong style="color:#a855f7;">-${formatPrice(totalCouponsCredit)}</strong>` : 'Total adeudado a la plataforma:'}
        </p>
        <div style="font-size:32px; font-weight:950; color:#10b981; letter-spacing:-1px;">
          ${formatPrice(netDebt)}
        </div>
        <span style="font-size:11px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.05em;">Monto Neto a Transferir</span>
      </div>

      <div style="background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.05)'}; border:1.5px solid var(--driver-border-b); border-radius:22px; padding:20px; box-shadow:${isLight ? '0 4px 12px rgba(0,0,0,0.04)' : 'none'};">
        <div style="margin-bottom:14px; border-bottom:1px dashed var(--driver-border-strong); padding-bottom:12px;">
          <label style="font-size:10px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; margin-bottom:4px; display:block; letter-spacing:0.06em;">ALIAS / CVU</label>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:18px; color:var(--driver-text-primary); letter-spacing:0.02em; font-family:monospace;">${bankAlias}</strong>
            <button class="btn-copy" aria-label="Copiar alias o CVU" onclick="navigator.clipboard.writeText('${bankAlias}'); showToast('Copiado', 'success')" style="background:${isLight ? 'rgba(225,29,72,0.1)' : 'rgba(225,29,72,0.2)'}; border:none; color:#e11d48; cursor:pointer; width:44px; height:44px; border-radius:10px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
              ${icon('copy', 16)}
            </button>
          </div>
        </div>
        
        <div>
          <label style="font-size:10px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; margin-bottom:4px; display:block; letter-spacing:0.06em;">TITULAR</label>
          <strong style="font-size:14.5px; color:var(--driver-text-primary); font-weight:800;">${bankOwner}</strong>
        </div>
      </div>

      <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:18px; padding:14px; display:flex; gap:10px; align-items:flex-start;">
        <div style="color:#d97706; margin-top:2px; display:flex; flex-shrink:0;">${icon('info', 18)}</div>
        <p style="font-size:12px; color:${isLight ? '#92400e' : '#fbbf24'}; margin:0; line-height:1.45; font-weight:600;">
          Una vez realizada la transferencia, subí el comprobante para que administración verifique y reactive tu saldo neto de forma inmediata.
        </p>
      </div>
    </div>

    <input type="file" id="receipt-file-input" accept="image/*" style="display:none;" />
    
    <button id="modal-upload-receipt-btn"
            style="width:100%; height:54px; border-radius:18px; background:#e11d48; color:white; border:none; font-weight:950; font-size:14px; cursor:pointer; box-shadow:0 8px 20px rgba(225,29,72,0.35); display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; flex-shrink:0; transition:all 0.2s;">
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
      const { compressImage } = await import('../../utils/format.js');
      const { addDoc, collection } = await import('firebase/firestore');
      const { db, storage } = await import('../../firebase.js');
      const optimizedFile = await compressImage(file, 1280, 0.82);
      
      const storageRef = ref(storage, `delivery_receipts/${user.uid}_${Date.now()}.jpg`);
      const snapshot = await uploadBytes(storageRef, optimizedFile);
      const downloadUrl = await getDownloadURL(snapshot.ref);

      // Create transaction request in Firestore collection delivery_settlement_proofs
      await addDoc(collection(db, 'delivery_settlement_proofs'), {
        driverId: user.uid,
        driverName: user.displayName || user.name || 'Repartidor',
        driverDeliveryId: user.deliveryId || '---',
        amount: netDebt,
        grossDebt: grossDebt,
        couponsCredit: totalCouponsCredit,
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

export async function loadRecentSessionsList(uid) {
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
    sessions.sort((a, b) => getSessionTimestamp(b.startTime) - getSessionTimestamp(a.startTime));

    // Limit to 4 sessions
    const recent = sessions.slice(0, 4);

    if (recent.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:16px; color:var(--driver-text-secondary); font-size:12px; font-weight:700;">
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
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--driver-bg-panel); border:1px solid var(--driver-border); border-radius:14px; gap:12px;">
          <div style="flex:1; display:flex; align-items:center; gap:8px;">
            <div style="width:8px; height:8px; border-radius:50%; background:${isLive ? '#22c55e' : 'var(--driver-text-secondary)'}; ${isLive ? 'box-shadow:0 0 8px #22c55e;' : ''}"></div>
            <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary); text-transform:capitalize;">${dateStr}</span>
            ${isLive ? `<span style="font-size:9px; font-weight:900; background:rgba(34,197,94,0.1); color:#22c55e; padding:1px 6px; border-radius:4px; margin-left:4px;">VIVO</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:14px; text-align:right;">
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:8px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase;">Pedidos</span>
              <span style="font-size:12px; font-weight:800; color:var(--driver-text-primary);">${count}</span>
            </div>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:8px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase;">Ganancia</span>
              <span style="font-size:12.5px; font-weight:900; color:#e11d48;">${formatPrice(total)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error rendering recent sessions:', err);
    container.innerHTML = `
      <div style="text-align:center; padding:16px; color:var(--driver-text-secondary); font-size:12px;">
        Error al cargar historial.
      </div>
    `;
  }
}

export async function showSessionsHistoryModal(driverId) {
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

      sessions.sort((a, b) => getSessionTimestamp(b.startTime) - getSessionTimestamp(a.startTime));

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
            <div style="width:64px; height:64px; border-radius:50%; background:var(--driver-bg-panel); border:1.5px solid var(--driver-border); display:flex; align-items:center; justify-content:center; color:var(--driver-text-secondary);">
              ${icon('calendar', 28)}
            </div>
            <div style="margin-top:4px;">
              <p style="margin:0; font-weight:800; font-size:14px; color:var(--driver-text-primary);">Sin sesiones en este período</p>
              <p style="margin:4px 0 0; font-size:11.5px; color:var(--driver-text-secondary);">Las sesiones que realices en este mes aparecerán acá.</p>
            </div>
          </div>
        `;
        return;
      }
      
      listContainer.innerHTML = sessions.map(s => {
        const startMs = getSessionTimestamp(s.startTime);
        const endMs = getSessionTimestamp(s.endTime);
        const start = startMs ? new Date(startMs) : null;
        const end = endMs ? new Date(endMs) : null;
        let durationStr = 'En curso';
        
        if (start && end) {
          const diffMs = end - start;
          const hours = Math.floor(diffMs / 3600000);
          const minutes = Math.floor((diffMs % 3600000) / 60000);
          durationStr = `${hours > 0 ? hours + 'h ' : ''}${minutes}min`;
        }

        const isLive = s.id === getState().user?.currentSessionId;

        return `
          <div style="background:var(--driver-bg-elevated); border:1.5px solid var(--driver-border); border-radius:20px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 8px 24px rgba(0,0,0,0.06); margin-bottom:12px; transition:all 0.2s;">
            <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-weight:900; font-size:15px; color:var(--driver-text-primary); text-transform:capitalize;">
                  ${start ? start.toLocaleDateString('es-AR', {day:'numeric', month:'short'}) : 'Fecha desconocida'}
                </span>
                ${isLive ? `<span style="font-size:9px; font-weight:900; background:rgba(34,197,94,0.1); color:#22c55e; padding:1px 6px; border-radius:6px; letter-spacing:0.02em;">VIVO</span>` : ''}
              </div>
              <div style="font-size:11.5px; color:var(--driver-text-label); font-weight:600; display:flex; align-items:center; gap:4px;">
                <span>${start ? start.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                <span style="opacity:0.5;">→</span>
                <span>${end ? end.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Activa'}</span>
              </div>
              <div style="font-size:10.5px; color:var(--driver-text-secondary); font-weight:700; margin-top:2px;">
                Duración: <span style="color:var(--driver-text-primary); font-weight:800;">${durationStr}</span>
              </div>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; gap:4px; margin-left:16px;">
              <div style="font-weight:950; font-size:18px; color:${isLive ? '#22c55e' : '#e11d48'}; letter-spacing:-0.5px;">${formatPrice(s.totalEarned || 0)}</div>
              <div style="font-size:10px; font-weight:800; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.02em;">${s.ordersCount || 0} pedidos</div>
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
    <div style="background:var(--driver-bg-elevated); border:1.5px solid var(--driver-border); border-radius:24px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 8px 24px rgba(0,0,0,0.06);">
      <div style="display:flex; align-items:center; gap:10px;">
        <button id="prev-month" aria-label="Mes anterior" style="width:44px; height:44px; border-radius:12px; border:1px solid var(--driver-border); background:var(--driver-bg-panel); color:var(--driver-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.background='var(--driver-border)'" onmouseout="this.style.background='var(--driver-bg-panel)'">
          ${icon('chevronLeft', 16)}
        </button>
        <div style="text-align:center; min-width:90px;">
          <div id="month-name" style="font-weight:900; font-size:15px; color:var(--driver-text-primary); text-transform:capitalize;">${monthNames[currentMonth]}</div>
          <div id="year-name" style="font-size:10px; font-weight:800; color:var(--driver-text-secondary); margin-top:2px;">${currentYear}</div>
        </div>
        <button id="next-month" aria-label="Mes siguiente" style="width:44px; height:44px; border-radius:12px; border:1px solid var(--driver-border); background:var(--driver-bg-panel); color:var(--driver-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.background='var(--driver-border)'" onmouseout="this.style.background='var(--driver-bg-panel)'">
          ${icon('chevronRight', 16)}
        </button>
      </div>
      <div style="text-align:right;">
        <div style="font-size:9px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">Total Mes</div>
        <div id="month-total-display" style="font-size:20px; font-weight:950; color:#22c55e; letter-spacing:-0.5px;">$0</div>
      </div>
    </div>

    <!-- Actions Row -->
    <div style="display:flex; justify-content:center;">
      <button id="recalculate-sessions-btn" style="padding:10px 18px; border-radius:14px; background:var(--driver-bg-panel); border:1px solid var(--driver-border); color:#e11d48; font-size:11px; font-weight:900; text-transform:uppercase; cursor:pointer; display:flex; align-items:center; gap:6px; letter-spacing:0.04em; transition:all 0.2s; box-shadow:0 8px 24px rgba(0,0,0,0.06);" onmouseover="this.style.background='var(--driver-bg-elevated)'" onmouseout="this.style.background='var(--driver-bg-panel)'">
        ${icon('refresh', 13)} Recalcular Totales
      </button>
    </div>

    <!-- Session List Render Container -->
    <div id="sessions-list-render" style="flex:1; overflow-y:auto; padding-bottom:10px; touch-action:pan-y; -webkit-overflow-scrolling:touch;"></div>
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
        const start = sess.startTime?.toDate ? sess.startTime.toDate() : (sess.startTime ? new Date(sess.startTime) : new Date(0));
        const end = sess.endTime?.toDate ? sess.endTime.toDate() : (sess.endTime ? new Date(sess.endTime) : new Date());

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
export async function showCompletedOrderDetailsModal(orderId) {
  const { getDoc, doc } = await import('firebase/firestore');
  const orderDoc = await getDoc(doc(db, 'orders', orderId));
  if (!orderDoc.exists()) {
    import('../../components/toast.js').then(m => m.showToast('No se encontró el pedido', 'warning'));
    return;
  }
  const o = { id: orderDoc.id, ...orderDoc.data() };
  const { openCompletedOrderDetailsModal } = await import('./history.js');
  openCompletedOrderDetailsModal(o, getState().user);
}

export async function showBalanceHistoryModal(driverId) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { getDocs, getDoc, doc, collection, query, where } = await import('firebase/firestore');
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';
  
  const content = document.createElement('div');
  content.style.cssText = `padding:16px 20px; background:var(--driver-bg-panel); min-height:60dvh; display:flex; flex-direction:column; color:var(--driver-text-primary);`;
  content.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;
  
  showModal({ 
    title: 'Historial de Balance', 
    content, 
    height: '80dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });
  
  try {
    // 1. Fetch user deliveryDebt from Firestore reference correctly
    const userDocSnap = await getDoc(doc(db, 'users', driverId));
    const userData = userDocSnap.exists() ? userDocSnap.data() : {};
    const actualDebt = userData.deliveryDebt || 0;
    const lastLiquidationAt = userData.lastLiquidationAt;

    // 2. Fetch transactions and canon payments
    const [transSnap, canonSnap] = await Promise.all([
      getDocs(query(collection(db, 'delivery_transactions'), where('driverId', '==', driverId))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'delivery_canon_payments'), where('driverId', '==', driverId))).catch(() => ({ docs: [] }))
    ]);

    const transList = transSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const canonList = canonSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 3. Fetch completed orders pending liquidation
    const qOrders = query(
      collection(db, 'orders'),
      where('driverId', '==', driverId),
      where('status', '==', 'completed')
    );
    const ordersSnap = await getDocs(qOrders).catch(() => ({ docs: [] }));
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

    // 3b. Fetch pending coupon credits from delivered orders
    const pendingCouponOrdersList = ordersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => o.isSettledDriver !== true && (o.couponDiscount || 0) > 0)
      .map(o => ({
        id: `coupon_${o.id}`,
        type: 'coupon_credit',
        amount: -(o.couponDiscount || 0),
        rawDiscount: o.couponDiscount,
        description: `Crédito por Cupón (Pedido #${o.orderId || o.id.slice(0,6)})`,
        createdAt: o.deliveredAt || o.createdAt,
        orderId: o.id
      }));

    const totalCouponsCredit = pendingCouponOrdersList.reduce((sum, c) => sum + (c.rawDiscount || 0), 0);
    const netDebt = Math.max(0, actualDebt - totalCouponsCredit);

    // Build unique Canon charges list from both collections (deduplicated by date)
    const canonChargesMap = new Map();
    transList.filter(t => t.type === 'canon_charge').forEach(t => {
      const dStr = t.description?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || (t.createdAt?.toDate ? t.createdAt.toDate().toISOString().slice(0,10) : t.id);
      canonChargesMap.set(dStr, {
        id: t.id,
        type: 'canon_charge',
        amount: t.amount,
        description: t.description || `Canon Diario Jornada (${dStr})`,
        createdAt: t.createdAt,
        dateKey: dStr
      });
    });

    canonList.forEach(c => {
      const dStr = c.dateStr || (c.id?.split('_')[1]) || (c.createdAt?.toDate ? c.createdAt.toDate().toISOString().slice(0,10) : c.id);
      if (!c.settled && c.amount > 0 && !canonChargesMap.has(dStr)) {
        canonChargesMap.set(dStr, {
          id: c.id,
          type: 'canon_charge',
          amount: c.amount,
          description: `Canon Diario Jornada (${c.dateStr || dStr || 'Hoy'})`,
          createdAt: c.createdAt,
          dateKey: dStr
        });
      }
    });

    const allCharges = [
      ...pendingOrdersList,
      ...Array.from(canonChargesMap.values())
    ].sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
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

    // 5. Liquidations tab list
    const liquidationsList = transList
      .filter(t => t.type === 'liquidation' || t.type === 'coupon_reimbursement')
      .sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return (timeB || 0) - (timeA || 0);
      });

    let currentMainTab = 'pending';
    let currentFilterType = 'all'; // 'all' | 'app_fee' | 'canon' | 'coupon'

    // 6. Draw Tabs & Filter Header
    content.innerHTML = `
      <!-- Main Tabs -->
      <div style="display:flex; background:rgba(255,255,255,0.06); border-radius:16px; padding:4px; margin-bottom:12px; border:1px solid rgba(255,255,255,0.08); flex-shrink:0;">
        <button id="tab-btn-pending" style="flex:1; height:40px; border-radius:12px; border:none; background:rgba(225,29,72,0.2); color:#f43f5e; font-size:12px; font-weight:900; cursor:pointer; transition:all 0.2s;">
          A Liquidar ($${Math.round(netDebt).toLocaleString('es-AR')})
        </button>
        <button id="tab-btn-history" style="flex:1; height:40px; border-radius:12px; border:none; background:transparent; color:#94a3b8; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
          Liquidaciones
        </button>
      </div>

      <!-- Sub-Filter Switch (for Pending Charges) -->
      <div id="balance-sub-filter-row" style="display:flex; gap:6px; margin-bottom:14px; flex-shrink:0; overflow-x:auto;">
        <button class="balance-filter-pill active" data-filter="all" style="flex:1; min-width:60px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.12); color:white; font-size:11px; font-weight:800; cursor:pointer; transition:all 0.15s;">
          Todas
        </button>
        <button class="balance-filter-pill" data-filter="app_fee" style="flex:1; min-width:90px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.04); color:#94a3b8; font-size:11px; font-weight:700; cursor:pointer; transition:all 0.15s; display:flex; align-items:center; justify-content:center; gap:4px;">
          <span style="display:inline-flex;">${icon('cart', 12)}</span> Tarifa App
        </button>
        <button class="balance-filter-pill" data-filter="canon" style="flex:1; min-width:90px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.04); color:#94a3b8; font-size:11px; font-weight:700; cursor:pointer; transition:all 0.15s; display:flex; align-items:center; justify-content:center; gap:4px;">
          <span style="display:inline-flex;">${icon('motorcycle', 12)}</span> Canon Diario
        </button>
        ${totalCouponsCredit > 0 ? `
          <button class="balance-filter-pill" data-filter="coupon" style="flex:1; min-width:110px; height:34px; border-radius:10px; border:1px solid rgba(168,85,247,0.3); background:rgba(168,85,247,0.12); color:#c084fc; font-size:11px; font-weight:800; cursor:pointer; transition:all 0.15s; display:flex; align-items:center; justify-content:center; gap:4px;">
            <span style="display:inline-flex;">${icon('ticket', 12)}</span> Cupones (-$${Math.round(totalCouponsCredit).toLocaleString('es-AR')})
          </button>
        ` : ''}
      </div>

      <!-- Tab Content Area -->
      <div id="balance-tab-content-area" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding-bottom:10px; touch-action:pan-y; -webkit-overflow-scrolling:touch;">
      </div>
    `;

    const pendingBtn = content.querySelector('#tab-btn-pending');
    const historyBtn = content.querySelector('#tab-btn-history');
    const subFilterRow = content.querySelector('#balance-sub-filter-row');
    const contentArea = content.querySelector('#balance-tab-content-area');

    function updateFilterPillsUI() {
      subFilterRow.querySelectorAll('.balance-filter-pill').forEach(btn => {
        const isSelected = btn.dataset.filter === currentFilterType;
        btn.classList.toggle('active', isSelected);
        if (btn.dataset.filter === 'coupon') {
          btn.style.background = isSelected ? 'rgba(168,85,247,0.25)' : 'rgba(168,85,247,0.1)';
          btn.style.borderColor = isSelected ? 'rgba(168,85,247,0.5)' : 'rgba(168,85,247,0.25)';
          btn.style.color = isSelected ? '#ffffff' : '#c084fc';
        } else {
          btn.style.background = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)';
          btn.style.borderColor = isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)';
          btn.style.color = isSelected ? 'white' : '#94a3b8';
        }
        btn.style.fontWeight = isSelected ? '800' : '600';
      });
    }

    subFilterRow.querySelectorAll('.balance-filter-pill').forEach(btn => {
      btn.onclick = () => {
        currentFilterType = btn.dataset.filter;
        updateFilterPillsUI();
        renderTabContent();
      };
    });

    function renderTabContent() {
      if (currentMainTab === 'pending') {
        pendingBtn.style.background = 'rgba(225,29,72,0.2)';
        pendingBtn.style.color = '#f43f5e';
        pendingBtn.style.fontWeight = '900';
        
        historyBtn.style.background = 'transparent';
        historyBtn.style.color = '#94a3b8';
        historyBtn.style.fontWeight = '700';

        subFilterRow.style.display = 'flex';

        let filtered = [...pendingCharges, ...pendingCouponOrdersList];
        if (currentFilterType === 'app_fee') {
          filtered = pendingCharges.filter(t => t.type === 'app_usage_fee');
        } else if (currentFilterType === 'canon') {
          filtered = pendingCharges.filter(t => t.type === 'canon_charge');
        } else if (currentFilterType === 'coupon') {
          filtered = pendingCouponOrdersList;
        }

        if (filtered.length === 0) {
          contentArea.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:#94a3b8; opacity:0.8;">
              <div style="display:flex; justify-content:center; margin-bottom:10px; color:#94a3b8;">${icon('sparkles', 36)}</div>
              <p style="margin:0; font-weight:700; font-size:14px; color:white;">No hay registros pendientes</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">${currentFilterType === 'canon' ? 'No tenés canones diarios sin liquidar.' : currentFilterType === 'app_fee' ? 'No tenés tarifas de pedidos sin liquidar.' : currentFilterType === 'coupon' ? 'No tenés cupones pendientes.' : 'Tu cuenta está al día.'}</p>
            </div>
          `;
          return;
        }

        contentArea.innerHTML = filtered.map(t => {
          const isCanon = t.type === 'canon_charge';
          const isAppFee = t.type === 'app_usage_fee';
          const isCoupon = t.type === 'coupon_credit';
          const rawDate = t.createdAt ? (t.createdAt.toMillis ? t.createdAt.toMillis() : new Date(t.createdAt).getTime()) : null;
          const formattedDate = rawDate ? `<span style="display:inline-flex; vertical-align:middle;">${icon('calendar', 11)}</span> ${new Date(rawDate).toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})} hs` : 'Saldo Pendiente';
          
          let iconColor = isCanon ? '#f43f5e' : isAppFee ? '#f59e0b' : '#a855f7';
          let iconBg = isCanon ? 'rgba(225,29,72,0.12)' : isAppFee ? 'rgba(245,158,11,0.12)' : 'rgba(168,85,247,0.15)';
          let iconName = isCanon ? 'bike' : isAppFee ? 'cart' : 'tag';
          if (t.type === 'adjustment_charge') {
            iconColor = '#94a3b8';
            iconBg = 'rgba(148,163,184,0.1)';
            iconName = 'receipt';
          }

          const amountFormatted = isCoupon 
            ? `-$${Math.round(t.rawDiscount || 0).toLocaleString('es-AR')}`
            : `+$${Math.round(t.amount || 0).toLocaleString('es-AR')}`;
          const amountColor = isCoupon ? '#c084fc' : iconColor;

          return `
            <div class="balance-item-card" data-order-id="${t.orderId || ''}" style="background:rgba(255,255,255,0.04); border:1px solid ${isCoupon ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.08)'}; border-radius:18px; padding:13px 15px; display:flex; justify-content:space-between; align-items:center; cursor:${t.orderId ? 'pointer' : 'default'}; transition:all 0.2s;">
              <div style="min-width:0; flex:1; display:flex; align-items:center; gap:12px;">
                <div style="width:36px; height:36px; border-radius:12px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon(iconName, 18)}
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:2px;">
                  <div style="font-weight:800; font-size:13.5px; color:#f8fafc; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${t.description}</div>
                  <div style="font-size:11px; color:#94a3b8; font-weight:600;">${formattedDate}</div>
                </div>
              </div>
              <div style="text-align:right; margin-left:12px; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-weight:900; font-size:15px; color:${amountColor}; letter-spacing:-0.5px;">${amountFormatted}</span>
                <span style="font-size:9px; font-weight:850; color:${isCoupon ? '#a855f7' : '#64748b'}; text-transform:uppercase; letter-spacing:0.04em; margin-top:2px;">${isCanon ? 'CANON DIARIO' : isAppFee ? 'TARIFA APP' : isCoupon ? 'CRÉDITO A FAVOR' : 'SALDO'}</span>
              </div>
            </div>
          `;
        }).join('');

        contentArea.querySelectorAll('.balance-item-card').forEach(card => {
          if (card.dataset.orderId) {
            card.addEventListener('click', () => {
              showCompletedOrderDetailsModal(card.dataset.orderId);
            });
            card.onmouseover = () => { card.style.borderColor = 'rgba(225,29,72,0.4)'; card.style.background = 'rgba(255,255,255,0.07)'; };
            card.onmouseout = () => { card.style.borderColor = 'rgba(255,255,255,0.08)'; card.style.background = 'rgba(255,255,255,0.04)'; };
          }
        });

      } else {
        historyBtn.style.background = 'rgba(255,255,255,0.12)';
        historyBtn.style.color = 'white';
        historyBtn.style.fontWeight = '800';
        
        pendingBtn.style.background = 'transparent';
        pendingBtn.style.color = '#94a3b8';
        pendingBtn.style.fontWeight = '700';

        subFilterRow.style.display = 'none';

        if (liquidationsList.length === 0) {
          contentArea.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:#94a3b8; opacity:0.8;">
              <div style="display:flex; justify-content:center; margin-bottom:10px; color:#94a3b8;">${icon('clipboard', 36)}</div>
              <p style="margin:0; font-weight:700; font-size:14px; color:white;">No hay liquidaciones registradas</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">Tus liquidaciones aprobadas aparecerán aquí.</p>
            </div>
          `;
          return;
        }

        contentArea.innerHTML = liquidationsList.map(t => {
          const isCoupon = t.type === 'coupon_reimbursement';
          const formattedDate = t.createdAt ? new Date(t.createdAt.toMillis ? t.createdAt.toMillis() : new Date(t.createdAt).getTime()).toLocaleDateString('es-AR', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Reciente';
          
          const iconColor = isCoupon ? '#a855f7' : '#22c55e';
          const iconBg = isCoupon ? 'rgba(168,85,247,0.12)' : 'rgba(34,197,94,0.12)';
          const iconName = isCoupon ? 'tag' : 'checkCircle';

          return `
            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:18px; padding:13px 15px; display:flex; justify-content:space-between; align-items:center;">
              <div style="min-width:0; flex:1; display:flex; align-items:center; gap:12px;">
                <div style="width:36px; height:36px; border-radius:12px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon(iconName, 18)}
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:2px;">
                  <div style="font-weight:800; font-size:13.5px; color:#f8fafc; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${t.description || 'Liquidación de Balance'}</div>
                  <div style="font-size:11px; color:#94a3b8; font-weight:600;">${formattedDate}</div>
                </div>
              </div>
              <div style="text-align:right; margin-left:12px; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-weight:900; font-size:15px; color:${iconColor}; letter-spacing:-0.5px;">-$${Math.round(Math.abs(t.amount || 0)).toLocaleString('es-AR')}</span>
                <span style="font-size:9px; font-weight:850; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-top:2px;">${isCoupon ? 'REINTEGRO' : 'LIQUIDADO'}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    pendingBtn.onclick = () => {
      currentMainTab = 'pending';
      renderTabContent();
    };

    historyBtn.onclick = () => {
      currentMainTab = 'history';
      renderTabContent();
    };

    renderTabContent();
  } catch (e) {
    console.error("Error drawing balance history modal:", e);
    content.innerHTML = `<p style="color:var(--color-danger); text-align:center; padding:40px;">Error al cargar el historial de balance.</p>`;
  }
}

