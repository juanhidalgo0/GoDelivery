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
  const { getDocs, collection, query, where } = await import('firebase/firestore');
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

    // Last 30 days' earnings by how the customer paid. The balance with GO! lives in "Mi cuenta":
    // mixing it in here compared a month of earnings with a debt of any age.
    let cashEarnings = 0;
    let digitalEarnings = 0;
    orders.filter(o => o.deliveredAt >= monthAgo).forEach(o => {
      const method = (o.paymentMethod || 'efectivo').toLowerCase();
      if (method === 'efectivo' || method === 'cash') {
        cashEarnings += (o.deliveryCost || 0);
      } else {
        digitalEarnings += (o.deliveryCost || 0);
      }
    });

    if (document.getElementById('wallet-digital-earnings')) document.getElementById('wallet-digital-earnings').textContent = formatPrice(digitalEarnings);
    if (document.getElementById('wallet-cash-earnings')) document.getElementById('wallet-cash-earnings').textContent = formatPrice(cashEarnings);
    if (document.getElementById('wallet-total-combined')) document.getElementById('wallet-total-combined').textContent = formatPrice(cashEarnings + digitalEarnings);

    // Render the CSS/SVG charts dynamically
    renderFinancesCharts(orders);

    if (callback) callback({ today: earningsDay, week: earningsWeek, month: earningsMonth });
  } catch (e) { console.error(e); }
}

// "Mi cuenta": the driver's balance with GO!, their latest movements and how to pay.
// Same data and look as the admin's statement (src/components/driver-statement.js).
export async function showBalanceManagementModal(user) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { doc, getDoc } = await import('firebase/firestore');
  const { ensureStatementStyles, renderBalanceHero, renderStatementList, fetchStatementPage, balanceInfo } = await import('../../components/driver-statement.js');
  ensureStatementStyles();
  const isLight = getDriverMapTheme() === 'light';
  const uid = user?.uid || getState().user?.uid;

  const modalEl = document.createElement('div');
  modalEl.className = 'gd-stmt gd-stmt--driver';
  modalEl.style.cssText = 'padding:18px 18px calc(20px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 16px))); background:var(--driver-bg-panel); min-height:100%; box-sizing:border-box;';
  modalEl.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';
  showModal({
    title: 'Mi cuenta con GO!',
    content: modalEl,
    height: '85dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });

  // Fresh balance: the one in memory may be a few seconds old.
  let balance = Number(user?.deliveryDebt) || 0;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) balance = Number(snap.data().deliveryDebt) || 0;
  } catch (err) {
    console.warn('[Mi cuenta] using cached balance:', err);
  }
  const info = balanceInfo(balance, 'driver');
  const pendingProofs = getState().pendingProofs || [];
  const inReview = pendingProofs.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const limitOn = getState().debtLimitEnabled === true;
  const limit = Number(getState().maxDebtLimit) || 0;
  const caption = info.tone === 'debt'
    ? 'Pagás cuando quieras y el monto que quieras.'
    : info.tone === 'credit'
      ? 'Es plata que GO! te debe (cupones e incentivos). Coordiná el cobro con administración.'
      : 'No tenés saldo pendiente.';
  const usedPct = limitOn && limit > 0 ? Math.min(100, Math.round((Math.max(0, balance) / limit) * 100)) : 0;

  modalEl.innerHTML = `
    ${renderBalanceHero(balance, { perspective: 'driver', caption })}
    ${inReview > 0 ? `<div class="gd-stmt-note">${icon('hourglass', 14)} Tenés ${formatPrice(inReview)} en revisión: administración está validando tu comprobante.</div>` : ''}
    ${limitOn && limit > 0 && info.tone === 'debt' ? `
      <div style="background:var(--driver-bg-elevated); border:1px solid var(--driver-border); border-radius:16px; padding:12px 14px;">
        <div style="display:flex; justify-content:space-between; font-size:11.5px; font-weight:800; color:var(--driver-text-secondary);">
          <span>Tope de deuda</span><span>${formatPrice(Math.max(0, balance))} de ${formatPrice(limit)}</span>
        </div>
        <div style="height:6px; border-radius:6px; background:var(--driver-border); margin-top:8px; overflow:hidden;">
          <div style="height:100%; width:${usedPct}%; background:${usedPct >= 80 ? '#f43f5e' : '#10b981'}; border-radius:6px;"></div>
        </div>
        ${usedPct >= 80 ? `<div style="font-size:11.5px; font-weight:700; color:#f43f5e; margin-top:8px;">Si pasás el tope no vas a poder conectarte hasta pagar.</div>` : ''}
      </div>` : ''}

    <div style="display:grid; grid-template-columns:${info.tone === 'debt' ? '1fr 1fr' : '1fr'}; gap:10px;">
      ${info.tone === 'debt' ? `<button id="acct-pay-btn" class="gd-stmt-btn" style="background:#e11d48; color:white;">${icon('bank', 17)} Pagar</button>` : ''}
      <button id="acct-wsp-btn" class="gd-stmt-btn gd-stmt-btn--ghost">${icon('whatsappLogo', 17)} ${info.tone === 'credit' ? 'Coordinar cobro' : 'Administración'}</button>
    </div>

    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:4px;">
      <div style="font-size:13px; font-weight:900;">Últimos movimientos</div>
      <button id="acct-all-btn" style="background:none; border:none; color:#f43f5e; font-size:12px; font-weight:800; cursor:pointer; padding:4px 0;">Ver estado de cuenta</button>
    </div>
    <div id="acct-latest" style="display:flex; flex-direction:column; gap:14px;"><div class="loader-dots" style="margin:20px auto;"><span></span><span></span><span></span></div></div>
  `;

  const latest = modalEl.querySelector('#acct-latest');
  fetchStatementPage(db, uid, null, 6)
    .then(({ entries }) => { latest.innerHTML = renderStatementList(entries, { perspective: 'driver', emptyText: 'Todavía no hay movimientos en tu cuenta.' }); })
    .catch(() => { latest.innerHTML = '<div class="gd-stmt-empty"><p>No se pudieron cargar los movimientos.</p></div>'; });

  modalEl.querySelector('#acct-all-btn').onclick = () => showBalanceHistoryModal(uid);
  modalEl.querySelector('#acct-pay-btn')?.addEventListener('click', () => showRegularizeModal(Math.max(0, balance - inReview) || Math.max(0, balance)));
  modalEl.querySelector('#acct-wsp-btn').onclick = () => {
    const u = getState().user || user || {};
    const wsp = getState().whatsappPayments || '5491123456789';
    const text = info.tone === 'credit'
      ? `Hola! Soy ${u.displayName || u.name || 'repartidor'} (ID ${u.deliveryId || '---'}). En la app figura que GO! me debe ${formatPrice(info.amount)}. ¿Cómo coordinamos el cobro?`
      : `Hola! Soy ${u.displayName || u.name || 'repartidor'} (ID ${u.deliveryId || '---'}). Te escribo por mi cuenta: ${info.tone === 'debt' ? `figura un saldo de ${formatPrice(info.amount)}` : 'estoy al día'}.`;
    window.open(`https://wa.me/${wsp}?text=${encodeURIComponent(text)}`, '_blank');
  };
}

// Pay by bank transfer: the driver chooses how much, transfers and uploads the receipt.
// The admin approves it for what actually arrived (Repartidores → Validaciones).
export async function showRegularizeModal(suggestedAmount = 0) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');
  const { ensureStatementStyles } = await import('../../components/driver-statement.js');
  ensureStatementStyles();
  const isLight = getDriverMapTheme() === 'light';
  const bankAlias = getState().bankAlias || 'godelivery.oficial';
  const bankOwner = getState().bankOwner || 'GoDelivery S.R.L.';

  const modalEl = document.createElement('div');
  modalEl.className = 'gd-stmt gd-stmt--driver';
  modalEl.style.cssText = 'padding:18px 18px calc(20px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 16px))); background:var(--driver-bg-panel); min-height:100%; box-sizing:border-box;';
  const step = (n, text) => `<div style="display:flex; gap:10px; align-items:flex-start; font-size:12.5px; font-weight:700; color:var(--driver-text-secondary); line-height:1.45;"><span style="width:22px; height:22px; border-radius:50%; background:var(--driver-text-primary); color:var(--driver-bg-panel); font-size:11px; font-weight:900; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${n}</span><span>${text}</span></div>`;
  modalEl.innerHTML = `
    <div>
      <label style="font-size:10.5px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:6px;">¿Cuánto vas a pagar?</label>
      <input id="pay-amount-input" type="number" inputmode="decimal" min="0" value="${suggestedAmount > 0 ? Math.round(suggestedAmount * 100) / 100 : ''}" style="width:100%; box-sizing:border-box; height:56px; border-radius:16px; border:1.5px solid var(--driver-border); background:var(--driver-bg-elevated); color:var(--driver-text-primary); font-size:24px; font-weight:950; padding:0 16px;" />
      <div style="font-size:11.5px; font-weight:600; color:var(--driver-text-secondary); margin-top:6px;">Podés pagar todo o una parte. Si pagás de más, te queda a favor.</div>
    </div>

    <div style="background:var(--driver-bg-elevated); border:1px solid var(--driver-border); border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="min-width:0;">
          <div style="font-size:10px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.06em;">Alias / CVU</div>
          <div style="font-size:17px; font-weight:900; font-family:monospace; overflow-wrap:anywhere;">${bankAlias}</div>
        </div>
        <button id="pay-copy-btn" aria-label="Copiar alias" style="width:44px; height:44px; border-radius:12px; border:none; background:rgba(225,29,72,0.15); color:#f43f5e; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('copy', 16)}</button>
      </div>
      <div style="border-top:1px dashed var(--driver-border); padding-top:10px;">
        <div style="font-size:10px; font-weight:900; color:var(--driver-text-secondary); text-transform:uppercase; letter-spacing:0.06em;">Titular</div>
        <div style="font-size:14px; font-weight:800;">${bankOwner}</div>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:10px;">
      ${step(1, 'Transferí el monto al alias de arriba.')}
      ${step(2, 'Subí la captura del comprobante.')}
      ${step(3, 'Administración lo valida y se descuenta de tu cuenta.')}
    </div>

    <input type="file" id="receipt-file-input" accept="image/*" style="display:none;" />
    <button id="modal-upload-receipt-btn" class="gd-stmt-btn" style="background:#e11d48; color:white; height:54px;">${icon('camera', 19)} Subir comprobante</button>
  `;
  showModal({
    title: 'Pagar por transferencia',
    content: modalEl,
    height: 'auto',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });

  modalEl.querySelector('#pay-copy-btn').onclick = () => {
    navigator.clipboard?.writeText(bankAlias).then(() => showToast('Alias copiado', 'success')).catch(() => showToast(bankAlias, 'info'));
  };
  const fileInput = modalEl.querySelector('#receipt-file-input');
  const uploadBtn = modalEl.querySelector('#modal-upload-receipt-btn');
  const amountOf = () => Math.round((parseFloat(modalEl.querySelector('#pay-amount-input').value) || 0) * 100) / 100;
  uploadBtn.onclick = () => {
    if (amountOf() <= 0) {
      showToast('Escribí cuánto transferiste', 'warning');
      return;
    }
    fileInput.click();
  };
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const amount = amountOf();
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = 'Subiendo comprobante...';
    uploadBtn.style.opacity = '0.7';
    try {
      const user = getState().user;
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { compressImage } = await import('../../utils/format.js');
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      const { storage } = await import('../../firebase.js');
      const optimizedFile = await compressImage(file, 1280, 0.82);
      const snapshot = await uploadBytes(ref(storage, `delivery_receipts/${user.uid}_${Date.now()}.jpg`), optimizedFile);
      const downloadUrl = await getDownloadURL(snapshot.ref);
      await addDoc(collection(db, 'delivery_settlement_proofs'), {
        driverId: user.uid,
        driverName: user.displayName || user.name || 'Repartidor',
        driverDeliveryId: user.deliveryId || '---',
        amount,
        balanceAtUpload: Number(user.deliveryDebt) || 0,
        imageUrl: downloadUrl,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      showToast('✅ Comprobante enviado. Administración lo va a revisar en breve.', 'success');
      closeModal();
    } catch (err) {
      console.error(err);
      showToast('❌ No se pudo subir el comprobante. Probá de nuevo.', 'error');
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = `${icon('camera', 19)} Subir comprobante`;
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

// Full statement: every movement of the driver's account, with the balance each one left.
export async function showBalanceHistoryModal(driverId) {
  const { showModal } = await import('../../components/modal.js');
  const { doc, getDoc } = await import('firebase/firestore');
  const { ensureStatementStyles, renderBalanceHero, mountStatement } = await import('../../components/driver-statement.js');
  ensureStatementStyles();
  const isLight = getDriverMapTheme() === 'light';

  const content = document.createElement('div');
  content.className = 'gd-stmt gd-stmt--driver';
  content.style.cssText = 'padding:16px 18px calc(20px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 16px))); background:var(--driver-bg-panel); min-height:100%; box-sizing:border-box;';
  content.innerHTML = `<div data-hero></div><div data-body style="display:flex; flex-direction:column; gap:14px;"></div>`;
  showModal({
    title: 'Estado de cuenta',
    content,
    height: '88dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });

  getDoc(doc(db, 'users', driverId)).then((snap) => {
    const hero = content.querySelector('[data-hero]');
    if (hero && snap.exists()) hero.innerHTML = renderBalanceHero(Number(snap.data().deliveryDebt) || 0, { perspective: 'driver' });
  }).catch(() => {});

  mountStatement(content.querySelector('[data-body]'), {
    db,
    driverId,
    perspective: 'driver',
    onOrder: (orderId) => showCompletedOrderDetailsModal(orderId),
    emptyText: 'Todavía no hay movimientos en tu cuenta. Van a aparecer acá tus pedidos, cuotas y pagos.'
  });
}
