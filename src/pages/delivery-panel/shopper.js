// "Compra el repartidor": el repartidor está en el mostrador del comercio con la lista del
// pedido. Marca qué llevó, qué faltaba y qué reemplazó, carga el total del ticket y el
// servidor (functions/ventra-bridge.js → shopperCheckout) recalcula el pedido con eso.
// Las cuentas que se ven acá son las mismas del servidor (src/utils/shopper.js).
import { auth } from '../../firebase.js';
import { icon } from '../../utils/icons.js';
import { functionUrl } from '../../utils/functions-url.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { esc, money, isCashPayment } from '../../components/driver-ui.js';
import { applyShopping } from '../../utils/shopper.js';

const CHOICES = [
  { id: 'found', label: 'Lo llevo' },
  { id: 'partial', label: 'Menos' },
  { id: 'missing', label: 'No había' },
  { id: 'replaced', label: 'Otro' },
];

/** Lo que el repartidor marcó, en el formato que espera el servidor */
function toResults(state) {
  const out = {};
  state.forEach((s, idx) => {
    if (s.choice === 'missing') out[idx] = { status: 'missing' };
    else if (s.choice === 'partial') out[idx] = { status: 'found', qty: s.qty };
    else if (s.choice === 'replaced') out[idx] = { status: 'replaced', qty: s.qty, replacementName: s.repName, replacementPrice: Number(s.repPrice) || 0 };
    else out[idx] = { status: 'found' };
  });
  return out;
}

export function openShopperChecklist({ order, onDone, onCancel }) {
  if (!order) return;
  document.getElementById('shopper-checklist-overlay')?.remove();
  const isLight = getDriverMapTheme() === 'light';
  const items = Array.isArray(order.items) ? order.items : [];
  const canReplace = order.allowReplacement === true;
  const state = items.map(it => ({ choice: 'found', qty: Number(it.qty) || 1, repName: '', repPrice: '' }));
  let ticket = '';
  let saving = false;

  const border = isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)';
  const cardBg = isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)';
  const inputCss = `width:100%; box-sizing:border-box; padding:11px 12px; border-radius:12px; border:1.5px solid ${border}; background:${isLight ? '#fff' : 'rgba(255,255,255,0.06)'}; color:var(--driver-text-primary); font-size:15px; font-weight:700; outline:none;`;

  const overlay = document.createElement('div');
  overlay.id = 'shopper-checklist-overlay';
  overlay.className = 'modal-overlay';
  overlay.setAttribute('data-scrollable', 'true');
  overlay.style.cssText = `position:fixed; inset:0; height:100dvh; background:rgba(0,0,0,0.75); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
    z-index:99999999; display:flex; align-items:flex-end; justify-content:center; touch-action:pan-y;`;

  const close = () => { overlay.remove(); };

  const itemRow = (it, idx) => {
    const s = state[idx];
    const ordered = Number(it.qty) || 1;
    const choices = CHOICES.filter(c => (c.id !== 'replaced' || canReplace) && (c.id !== 'partial' || ordered > 1));
    const img = it.image ? `<img src="${esc(it.image)}" alt="" style="width:46px; height:46px; border-radius:12px; object-fit:cover; flex-shrink:0; background:#fff;">`
      : `<div style="width:46px; height:46px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:var(--driver-fill-subtle); color:var(--driver-text-secondary);">${icon('shoppingBag', 20)}</div>`;
    const qtyStepper = (max, min) => `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:12px; font-weight:800; color:var(--driver-text-secondary);">Cantidad que llevás</span>
        <button data-qty="-1" data-idx="${idx}" ${s.qty <= min ? 'disabled' : ''} style="width:38px; height:38px; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:var(--driver-text-primary); font-size:18px; font-weight:900;">−</button>
        <b style="min-width:22px; text-align:center; font-size:16px; color:var(--driver-text-primary);">${s.qty}</b>
        <button data-qty="1" data-idx="${idx}" ${s.qty >= max ? 'disabled' : ''} style="width:38px; height:38px; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:var(--driver-text-primary); font-size:18px; font-weight:900;">+</button>
      </div>`;
    return `
      <div style="background:${cardBg}; border:1.5px solid ${s.choice === 'missing' ? 'rgba(239,68,68,0.45)' : s.choice === 'found' ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.45)'}; border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; gap:10px; align-items:center;">
          ${img}
          <div style="flex:1; min-width:0;">
            <div style="font-size:14.5px; font-weight:900; color:var(--driver-text-primary); line-height:1.25; ${s.choice === 'missing' ? 'text-decoration:line-through; opacity:.6;' : ''}">${ordered} × ${esc(it.name)}</div>
            <div style="font-size:12px; font-weight:700; color:var(--driver-text-secondary); margin-top:2px;">${money(it.price)} c/u${it.barcode ? ` · cód. ${esc(it.barcode)}` : ''}</div>
            ${it.notes ? `<div style="font-size:12px; font-weight:700; color:#f59e0b; margin-top:2px;">Nota: ${esc(it.notes)}</div>` : ''}
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(${choices.length}, 1fr); gap:6px;">
          ${choices.map(c => `<button data-choice="${c.id}" data-idx="${idx}" style="min-height:40px; border-radius:12px; font-size:12.5px; font-weight:900; cursor:pointer;
            border:1.5px solid ${s.choice === c.id ? 'transparent' : border};
            background:${s.choice === c.id ? (c.id === 'missing' ? '#ef4444' : c.id === 'found' ? '#16a34a' : '#f59e0b') : 'transparent'};
            color:${s.choice === c.id ? '#fff' : 'var(--driver-text-primary)'};">${c.label}</button>`).join('')}
        </div>
        ${s.choice === 'partial' ? qtyStepper(ordered - 1, 1) : ''}
        ${s.choice === 'replaced' ? `
          <input data-rep-name="${idx}" placeholder="¿Qué llevás en su lugar?" value="${esc(s.repName)}" maxlength="120" style="${inputCss}">
          <div style="display:flex; gap:8px; align-items:center;">
            <input data-rep-price="${idx}" inputmode="decimal" placeholder="Precio c/u" value="${esc(s.repPrice)}" style="${inputCss} flex:1;">
          </div>
          ${ordered > 1 ? qtyStepper(ordered, 1) : ''}` : ''}
      </div>`;
  };

  const preview = () => applyShopping(order, toResults(state), ticket === '' ? null : Number(String(ticket).replace(/[^\d.]/g, '')));

  const renderSummary = () => {
    const { patch, errors, allMissing, missing } = preview();
    const el = overlay.querySelector('#shopper-summary');
    if (!el) return;
    const est = Number(order.estimatedTotal ?? order.total) || 0;
    const cash = isCashPayment(order);
    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:800; color:var(--driver-text-secondary);"><span>Productos según lo marcado</span><span>${money(patch.shopComputedTotal)}</span></div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:4px;">
        <span style="font-size:14px; font-weight:900; color:var(--driver-text-primary);">${cash ? 'Le cobrás al cliente' : 'Total del pedido'}</span>
        <span style="font-size:22px; font-weight:900; color:var(--driver-text-primary);">${money(patch.total)}</span>
      </div>
      ${Math.round(patch.total) !== Math.round(est) ? `<div style="font-size:11.5px; font-weight:700; color:var(--driver-text-secondary); margin-top:2px;">Antes era ${money(est)}${missing.length ? ` · faltan ${missing.length}` : ''}</div>` : ''}
      ${allMissing ? `<div style="margin-top:8px; font-size:12.5px; font-weight:800; color:#ef4444;">No había nada: el pedido se cancela y el cliente no paga.</div>` : ''}
      ${errors.length ? `<div style="margin-top:8px; font-size:12.5px; font-weight:800; color:#ef4444;">${esc(errors[0])}</div>` : ''}`;
    const btn = overlay.querySelector('#shopper-confirm');
    if (btn) {
      btn.disabled = saving || errors.length > 0;
      btn.style.opacity = btn.disabled ? '0.5' : '1';
      btn.textContent = saving ? 'Guardando…' : allMissing ? 'Cancelar pedido: no había nada' : 'Listo, ya compré';
    }
  };

  const renderList = () => {
    overlay.querySelector('#shopper-items').innerHTML = items.map(itemRow).join('');
    renderSummary();
  };

  overlay.innerHTML = `
    <div class="modal-content" data-scrollable="true" style="width:100%; max-width:500px; max-height:94dvh; background:${isLight ? '#ffffff' : '#0b111e'};
      border:1.5px solid ${border}; border-radius:28px 28px 0 0; box-shadow:0 -10px 40px rgba(0,0,0,0.6); display:flex; flex-direction:column; overflow:hidden; box-sizing:border-box;">
      <div style="padding:14px 18px 10px; border-bottom:1px solid ${border}; display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-shrink:0;">
        <div>
          <div style="font-size:16px; font-weight:900; color:var(--driver-text-primary);">Comprá en ${esc(order.comercioName || 'el local')}</div>
          <div style="font-size:12px; font-weight:700; color:var(--driver-text-secondary); margin-top:2px;">Pedido #${esc(order.orderId || order.id.slice(0, 6))} · ${canReplace ? 'acepta reemplazos parecidos' : 'NO acepta reemplazos'}</div>
        </div>
        <button id="shopper-close" aria-label="Cerrar" style="width:44px; height:44px; border-radius:50%; background:var(--driver-fill-subtle); border:none; color:var(--driver-text-secondary); font-size:16px; font-weight:900; cursor:pointer;">✕</button>
      </div>
      <div style="padding:10px 18px 0; font-size:12.5px; line-height:1.4; color:var(--driver-text-secondary); flex-shrink:0;">
        Pagá en el mostrador y marcá cómo te fue con cada producto. Si algo no estaba, se saca del pedido y el cliente paga menos.
      </div>
      <div id="shopper-items" class="scrollable-y" data-scrollable="true" style="padding:10px 18px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; flex:1 1 auto; min-height:120px;"></div>
      <div style="padding:12px 18px calc(14px + env(safe-area-inset-bottom)); border-top:1px solid ${border}; display:flex; flex-direction:column; gap:10px; flex-shrink:0;">
        <label style="display:flex; flex-direction:column; gap:6px;">
          <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-secondary);">Total del ticket del local (si te dieron)</span>
          <input id="shopper-ticket" inputmode="decimal" placeholder="Ej: 12500" style="${inputCss}">
        </label>
        <div id="shopper-summary"></div>
        <button id="shopper-confirm" style="min-height:54px; border-radius:16px; border:none; background:#16a34a; color:#fff; font-size:16px; font-weight:900; cursor:pointer;">Listo, ya compré</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  renderList();

  overlay.querySelector('#shopper-close').onclick = () => { close(); onCancel?.(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); onCancel?.(); return; }
    const choiceBtn = e.target.closest('[data-choice]');
    if (choiceBtn) {
      const idx = Number(choiceBtn.dataset.idx);
      const s = state[idx];
      const ordered = Number(items[idx].qty) || 1;
      s.choice = choiceBtn.dataset.choice;
      s.qty = s.choice === 'partial' ? Math.max(1, ordered - 1) : ordered;
      renderList();
      if (s.choice === 'replaced') overlay.querySelector(`[data-rep-name="${idx}"]`)?.focus();
      return;
    }
    const qtyBtn = e.target.closest('[data-qty]');
    if (qtyBtn && !qtyBtn.disabled) {
      const idx = Number(qtyBtn.dataset.idx);
      state[idx].qty += Number(qtyBtn.dataset.qty);
      renderList();
    }
  });
  overlay.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'shopper-ticket') ticket = t.value;
    else if (t.dataset.repName !== undefined) state[Number(t.dataset.repName)].repName = t.value;
    else if (t.dataset.repPrice !== undefined) state[Number(t.dataset.repPrice)].repPrice = t.value.replace(/[^\d.,]/g, '').replace(',', '.');
    else return;
    renderSummary();
  });

  overlay.querySelector('#shopper-confirm').onclick = async () => {
    if (saving) return;
    const { errors } = preview();
    if (errors.length) return;
    saving = true;
    renderSummary();
    try {
      const token = await auth.currentUser?.getIdToken();
      const ticketTotal = ticket === '' ? null : Number(String(ticket).replace(/[^\d.]/g, ''));
      const res = await fetch(functionUrl('shopperCheckout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: order.id, results: toResults(state), ticketTotal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la compra');
      close();
      onDone?.(data);
    } catch (err) {
      saving = false;
      renderSummary();
      const el = overlay.querySelector('#shopper-summary');
      if (el) el.insertAdjacentHTML('beforeend', `<div style="margin-top:8px; font-size:12.5px; font-weight:800; color:#ef4444;">${esc(err.message || 'Sin conexión: probá de nuevo')}</div>`);
    }
  };
}
