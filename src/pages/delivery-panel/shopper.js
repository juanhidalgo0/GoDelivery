// "Compra el repartidor": el repartidor abre la lista del pedido al llegar al comercio y la va
// marcando mientras compra: qué llevó, qué faltaba y qué cambió el cliente. Al final carga el total
// del ticket (y si quiere, una foto) y el servidor (functions/ventra-bridge.js → shopperCheckout) recalcula el pedido con eso.
// Lo marcado queda guardado en el celular hasta cargar la compra (src/utils/shopper-marks.js).
// Las cuentas que se ven acá son las mismas del servidor (src/utils/shopper.js).
import { auth } from '../../firebase.js';
import { icon } from '../../utils/icons.js';
import { functionUrl } from '../../utils/functions-url.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { esc, money, isCashPayment, driverTokens } from '../../components/driver-ui.js';
import { applyShopping, parseMoney, ticketLooksOff, MAX_ADDED_ITEMS, MAX_ADDED_QTY } from '../../utils/shopper.js';
import { loadShopperMarks, saveShopperMarks, clearShopperMarks } from '../../utils/shopper-marks.js';
import { isWeighedItem, orderedGrams, itemPricePerKg, formatWeight } from '../../utils/weight.js';

const CHOICES = [
  { id: 'found', label: 'Lo llevo' },
  { id: 'missing', label: 'No había' },
  // Lo sacó el cliente: solo el tacho, va último
  { id: 'removed', iconName: 'trash', ariaLabel: 'El cliente lo sacó' },
];

/** Lo que el repartidor marcó, en el formato que espera el servidor */
function toResults(state) {
  const out = {};
  state.forEach((s, idx) => {
    if (s.choice === 'missing') out[idx] = { status: 'missing' };
    else if (s.choice === 'removed') out[idx] = { status: 'removed' };
    else if (s.weighed && s.choice === 'found') out[idx] = { status: 'found', paid: parseMoney(s.paid) };
    else out[idx] = { status: 'found', qty: s.qty };
  });
  return out;
}

async function uploadTicketPhoto(orderId, file) {
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const { compressImage } = await import('../../utils/format.js');
  const { storage } = await import('../../firebase.js');
  const optimized = await compressImage(file, 1280, 0.82);
  const snapshot = await uploadBytes(ref(storage, `order_tickets/${orderId}/${Date.now()}.jpg`), optimized, { contentType: optimized.type || 'image/jpeg' });
  return getDownloadURL(snapshot.ref);
}

async function postShopperCheckout(body) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(functionUrl('shopperCheckout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo guardar la compra');
  return data;
}

/**
 * beforeConfirm: se llama al tocar "Listo, ya compré" (con la lista escondida); si devuelve algo
 * falso no se carga la compra. submit y uploadPhoto: quién carga la compra y la foto del ticket (la
 * vista previa no usa el servidor).
 */
export function openShopperChecklist({ order, onDone, onCancel, beforeConfirm, submit = postShopperCheckout, uploadPhoto = uploadTicketPhoto }) {
  if (!order) return;
  document.getElementById('shopper-checklist-overlay')?.remove();
  const isLight = getDriverMapTheme() === 'light';
  // Colores fijos del panel del repartidor (los mismos de la tarjeta), con buen contraste en claro y oscuro
  const t = driverTokens(isLight);
  const red = isLight ? '#DC2626' : '#F87171';
  const amber = t.amberTx;
  const items = Array.isArray(order.items) ? order.items : [];
  const canReplace = order.allowReplacement === true;
  const saved = loadShopperMarks(order.id, items.length);
  // Lo que el cliente sumó por fuera de la app
  const added = saved && Array.isArray(saved.added) ? saved.added : [];
  // Marcas guardadas con botones que ya no están: "Menos" es "Lo llevo" con otra cantidad, "Otro" es sacar y agregar
  const state = saved ? saved.state.map(s => {
    if (s.choice === 'partial') return { ...s, choice: 'found' };
    if (s.choice !== 'replaced') return s;
    if (s.repName) added.push({ name: s.repName, price: s.repPrice, qty: s.qty || 1 });
    return { ...s, choice: 'removed' };
  }) : items.map(it => ({ choice: 'found', qty: Number(it.qty) || 1, repName: '', repPrice: '', weighed: isWeighedItem(it), paid: '' }));
  let ticket = saved ? String(saved.ticket || '') : '';
  let photo = saved ? String(saved.photo || '') : '';
  let photoState = '';
  // El ticket se aleja mucho de lo marcado: se pregunta una vez antes de cobrarlo
  let askTicket = false;
  const toAdded = () => added.map(a => ({ name: a.name, price: parseMoney(a.price), qty: a.qty }));
  const ticketValue = () => (ticket === '' ? null : parseMoney(ticket));
  let saving = false;
  const remember = () => { askTicket = false; saveShopperMarks(order.id, state, ticket, added, photo); };

  const border = isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)';
  const cardBg = isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)';
  const inputCss = `width:100%; box-sizing:border-box; padding:11px 12px; border-radius:12px; border:1.5px solid ${border}; background:${isLight ? '#fff' : 'rgba(255,255,255,0.06)'}; color:${t.tx}; font-size:15px; font-weight:700; outline:none;`;

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
    const choices = CHOICES;
    const paid = s.weighed ? parseMoney(s.paid) : 0;
    const approxGrams = (p) => Math.round(p * 1000 / (itemPricePerKg(it) || 1));
    const img = it.image ? `<img src="${esc(it.image)}" alt="" style="width:46px; height:46px; border-radius:12px; object-fit:cover; flex-shrink:0; background:#fff;">`
      : `<div style="width:46px; height:46px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:${t.card}; color:${t.tx2};">${icon('shoppingBag', 20)}</div>`;
    const qtyStepper = (max, min) => `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:12px; font-weight:800; color:${t.tx2};">Cantidad que llevás</span>
        <button data-qty="-1" data-idx="${idx}" ${s.qty <= min ? 'disabled' : ''} style="width:38px; height:38px; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:${t.tx}; font-size:18px; font-weight:900;">−</button>
        <b style="min-width:22px; text-align:center; font-size:16px; color:${t.tx};">${s.qty}</b>
        <button data-qty="1" data-idx="${idx}" ${s.qty >= max ? 'disabled' : ''} style="width:38px; height:38px; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:${t.tx}; font-size:18px; font-weight:900;">+</button>
      </div>`;
    return `
      <div style="background:${cardBg}; border:1.5px solid ${s.choice === 'missing' || s.choice === 'removed' ? 'rgba(239,68,68,0.45)' : s.choice === 'found' && s.qty === ordered ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.45)'}; border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; gap:10px; align-items:center;">
          ${img}
          <div style="flex:1; min-width:0;">
            <div style="font-size:15px; font-weight:900; color:${t.tx}; line-height:1.3; word-break:break-word; ${s.choice === 'missing' || s.choice === 'removed' ? 'text-decoration:line-through; opacity:.6;' : ''}">${s.weighed ? `${formatWeight(orderedGrams(it))} de ${esc(it.name)}` : `${ordered} × ${esc(it.name)}`}</div>
            <div style="font-size:12px; font-weight:700; color:${t.tx2}; margin-top:2px;">${s.weighed ? `${money(itemPricePerKg(it))} el kilo · por peso` : `${money(it.price)} c/u`}${it.barcode ? ` · cód. ${esc(it.barcode)}` : ''}</div>
            ${it.notes ? `<div style="font-size:12px; font-weight:700; color:${amber}; margin-top:2px;">Nota: ${esc(it.notes)}</div>` : ''}
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(${choices.length - 1}, 1fr) 44px; gap:6px;">
          ${choices.map(c => `<button data-choice="${c.id}" data-idx="${idx}" ${c.ariaLabel ? `aria-label="${c.ariaLabel}"` : ''} style="min-height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; padding:0 2px; font-size:12.5px; font-weight:900; cursor:pointer;
            border:1.5px solid ${s.choice === c.id ? 'transparent' : border};
            background:${s.choice === c.id ? (c.id === 'missing' || c.id === 'removed' ? '#DC2626' : c.id === 'found' ? '#15803D' : '#B45309') : 'transparent'};
            color:${s.choice === c.id ? '#fff' : t.tx};">${c.iconName ? icon(c.iconName, 18) : c.label}</button>`).join('')}
        </div>
        ${s.weighed && s.choice === 'found' ? `
          <label style="display:flex; flex-direction:column; gap:6px;">
            <span style="font-size:12px; font-weight:800; color:${t.tx2};">¿Cuánto te cobraron? (lo que dice la etiqueta o el ticket)</span>
            <input data-paid="${idx}" inputmode="decimal" placeholder="Ej: 25300" value="${esc(s.paid)}" style="${inputCss}">
          </label>
          <div data-paid-out="${idx}" style="font-size:12.5px; font-weight:800; color:${paid ? t.tx : amber};">${paid ? `${money(paid)} · unos ${formatWeight(approxGrams(paid))}` : 'Falta cargar lo que te cobraron'}</div>` : ''}
        ${s.choice === 'found' && !s.weighed ? qtyStepper(MAX_ADDED_QTY, 1) : ''}
      </div>`;
  };

  const addedRow = (a, i) => `
    <div style="background:${cardBg}; border:1.5px solid rgba(245,158,11,0.45); border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; gap:8px; align-items:center;">
        <input data-add-name="${i}" placeholder="¿Qué producto?" value="${esc(a.name)}" maxlength="120" style="${inputCss} flex:1; min-width:0;">
        <button data-add-del="${i}" aria-label="Quitar" style="width:44px; height:44px; flex-shrink:0; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:${t.tx2}; font-size:15px; font-weight:900; cursor:pointer;">✕</button>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <input data-add-price="${i}" inputmode="decimal" placeholder="Precio c/u" value="${esc(a.price)}" style="${inputCss} flex:1; min-width:0;">
        <button data-add-qty="-1" data-idx="${i}" ${a.qty <= 1 ? 'disabled' : ''} style="width:38px; height:38px; flex-shrink:0; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:${t.tx}; font-size:18px; font-weight:900;">−</button>
        <b style="min-width:22px; text-align:center; font-size:16px; color:${t.tx};">${a.qty}</b>
        <button data-add-qty="1" data-idx="${i}" ${a.qty >= MAX_ADDED_QTY ? 'disabled' : ''} style="width:38px; height:38px; flex-shrink:0; border-radius:12px; border:1.5px solid ${border}; background:transparent; color:${t.tx}; font-size:18px; font-weight:900;">+</button>
      </div>
    </div>`;

  const preview = () => applyShopping(order, toResults(state), ticketValue(), toAdded());

  const renderPhoto = () => {
    const box = overlay.querySelector('#shopper-photo-box');
    if (!box) return;
    box.innerHTML = `
      <button id="shopper-photo-btn" ${photoState === 'uploading' ? 'disabled' : ''} style="min-height:46px; border-radius:14px; border:1.5px solid ${border}; background:transparent; color:${t.tx}; font-size:14px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; padding:0 10px;">
        ${photo ? `<img src="${esc(photo)}" alt="" style="width:30px; height:30px; border-radius:7px; object-fit:cover;">` : icon('camera', 18)}
        ${photoState === 'uploading' ? 'Subiendo foto…' : photo ? 'Foto cargada: tocá para cambiarla' : 'Sacar foto del ticket (opcional)'}
      </button>
      ${photoState === 'error' ? `<div style="font-size:12.5px; font-weight:800; color:${red};">No se pudo subir la foto: probá de nuevo o seguí sin foto.</div>` : ''}`;
  };

  const renderSummary = () => {
    const { patch, errors, allMissing, missing } = preview();
    const el = overlay.querySelector('#shopper-summary');
    if (!el) return;
    const est = Number(order.estimatedTotal ?? order.total) || 0;
    const cash = isCashPayment(order);
    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:800; color:${t.tx2};"><span>Productos según lo marcado</span><span>${money(patch.shopComputedTotal)}</span></div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:4px;">
        <span style="font-size:14px; font-weight:900; color:${t.tx};">${cash ? 'Le cobrás al cliente' : 'Total del pedido'}</span>
        <span style="font-size:22px; font-weight:900; color:${t.tx};">${money(patch.total)}</span>
      </div>
      ${!askTicket && patch.shopTicketTotal && patch.shopTicketTotal !== patch.shopComputedTotal ? `<div style="font-size:12.5px; font-weight:800; color:${amber}; margin-top:4px;">El ticket dice ${money(patch.shopTicketTotal)}: el cliente paga según el ticket.</div>` : ''}
      ${Math.round(patch.total) !== Math.round(est) ? `<div style="font-size:12.5px; font-weight:700; color:${t.tx2}; margin-top:2px;">Antes era ${money(est)}${missing.length ? ` · faltan ${missing.length}` : ''}</div>` : ''}
      ${askTicket ? `<div style="margin-top:8px; padding:10px 12px; border-radius:12px; background:${t.amberBg}; font-size:13px; font-weight:800; color:${amber};">El ticket dice ${money(patch.shopTicketTotal)} y lo marcado suma ${money(patch.shopComputedTotal)}. Revisá que esté bien escrito: al cliente se le cobra ${money(patch.total)}.</div>` : ''}
      ${allMissing ? `<div style="margin-top:8px; font-size:12.5px; font-weight:800; color:${red};">No queda nada: el pedido se cancela y el cliente no paga.</div>` : ''}
      ${errors.length ? `<div style="margin-top:8px; font-size:12.5px; font-weight:800; color:${red};">${esc(errors[0])}</div>` : ''}`;
    const btn = overlay.querySelector('#shopper-confirm');
    if (btn) {
      btn.disabled = saving || errors.length > 0 || photoState === 'uploading';
      btn.style.opacity = btn.disabled ? '0.5' : '1';
      btn.textContent = saving ? 'Guardando…' : allMissing ? 'Cancelar pedido: no queda nada' : askTicket ? 'Sí, el ticket está bien' : 'Listo, ya compré';
    }
  };

  const renderList = () => {
    overlay.querySelector('#shopper-items').innerHTML = items.map(itemRow).join('');
    overlay.querySelector('#shopper-added').innerHTML = added.map(addedRow).join('');
    overlay.querySelector('#shopper-add').style.display = added.length >= MAX_ADDED_ITEMS ? 'none' : '';
    renderSummary();
  };

  overlay.innerHTML = `
    <div class="modal-content" data-scrollable="true" style="width:100%; max-width:500px; max-height:94dvh; background:${isLight ? '#ffffff' : '#0b111e'};
      border:1.5px solid ${border}; border-radius:28px 28px 0 0; box-shadow:0 -10px 40px rgba(0,0,0,0.6); display:flex; flex-direction:column; overflow:hidden; box-sizing:border-box;">
      <div style="padding:14px 18px 10px; border-bottom:1px solid ${border}; display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-shrink:0;">
        <div>
          <div style="font-size:16px; font-weight:900; color:${t.tx};">Comprá en ${esc(order.comercioName || 'el local')}</div>
          <div style="font-size:12px; font-weight:700; color:${t.tx2}; margin-top:2px;">Pedido #${esc(order.orderId || order.id.slice(0, 6))} · ${canReplace ? 'acepta reemplazos parecidos' : 'NO acepta reemplazos'}</div>
        </div>
        <button id="shopper-close" aria-label="Cerrar" style="width:44px; height:44px; border-radius:50%; background:${t.card}; border:none; color:${t.tx2}; font-size:16px; font-weight:900; cursor:pointer;">✕</button>
      </div>
      <div style="padding:10px 18px 0; font-size:13.5px; line-height:1.45; color:${t.tx2}; flex-shrink:0;">
        Marcá cada producto mientras comprás. Si algo no hay, tocá <b>No había</b>. Si el cliente lo sacó, tocá el <b>tacho</b>. Lo que sume${canReplace ? ' o un reemplazo' : ''} va en <b>Agregar producto</b>.${items.some(isWeighedItem) ? ' En lo que va por peso, cargá lo que te cobraron: el cliente paga eso.' : ''}
      </div>
      ${Number(order.transferSurchargeTotal) > 0 ? `
      <div style="margin:10px 18px 0; padding:10px 12px; border-radius:14px; background:${t.amberBg}; color:${amber}; font-size:12.5px; font-weight:700; line-height:1.4; flex-shrink:0;">
        El cliente paga con transferencia y ya sabe que ${esc(items.filter(i => Number(i.transferSurcharge) > 0).map(i => i.name).slice(0, 2).join(', '))}${items.filter(i => Number(i.transferSurcharge) > 0).length > 2 ? ' y otros' : ''} tienen recargo. Pagá en el kiosco con transferencia y cargá lo que te cobren.
      </div>` : ''}
      <!-- El ticket va al final de la lista (se carga al pagar): mientras compra, la lista tiene más lugar -->
      <div class="scrollable-y" data-scrollable="true" style="padding:10px 18px 14px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; flex:1 1 auto; min-height:120px;">
        <div id="shopper-items" style="display:flex; flex-direction:column; gap:10px;"></div>
        <div id="shopper-added" style="display:flex; flex-direction:column; gap:10px;"></div>
        <button id="shopper-add" style="min-height:46px; border-radius:14px; border:1.5px dashed ${border}; background:transparent; color:${t.tx}; font-size:14px; font-weight:900; cursor:pointer;">+ Agregar producto</button>
        <label style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
          <span style="font-size:13px; font-weight:800; color:${t.tx2};">Al pagar: total del ticket del local. Guardá el ticket en la bolsa.</span>
          <input id="shopper-ticket" inputmode="decimal" placeholder="Ej: 12500" value="${esc(ticket)}" style="${inputCss}">
        </label>
        <input type="file" id="shopper-photo-input" accept="image/*" capture="environment" style="display:none;">
        <div id="shopper-photo-box" style="display:flex; flex-direction:column; gap:6px;"></div>
      </div>
      <div style="padding:12px 18px calc(14px + env(safe-area-inset-bottom)); border-top:1px solid ${border}; display:flex; flex-direction:column; gap:10px; flex-shrink:0;">
        <div id="shopper-summary"></div>
        <button id="shopper-confirm" style="min-height:54px; border-radius:16px; border:none; background:#15803D; color:#fff; font-size:16px; font-weight:900; cursor:pointer;">Listo, ya compré</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  renderList();
  renderPhoto();

  overlay.querySelector('#shopper-photo-input').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    photoState = 'uploading';
    renderPhoto();
    renderSummary();
    try {
      photo = await uploadPhoto(order.id, file);
      photoState = '';
      remember();
    } catch (err) {
      photoState = 'error';
    }
    renderPhoto();
    renderSummary();
  };

  overlay.querySelector('#shopper-close').onclick = () => { close(); onCancel?.(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); onCancel?.(); return; }
    if (e.target.closest('#shopper-photo-btn')) {
      overlay.querySelector('#shopper-photo-input').click();
      return;
    }
    if (e.target.closest('#shopper-add')) {
      added.push({ name: '', price: '', qty: 1 });
      remember();
      renderList();
      overlay.querySelector(`[data-add-name="${added.length - 1}"]`)?.focus();
      return;
    }
    const addDel = e.target.closest('[data-add-del]');
    if (addDel) {
      added.splice(Number(addDel.dataset.addDel), 1);
      remember();
      renderList();
      return;
    }
    const addQty = e.target.closest('[data-add-qty]');
    if (addQty && !addQty.disabled) {
      added[Number(addQty.dataset.idx)].qty += Number(addQty.dataset.addQty);
      remember();
      renderList();
      return;
    }
    const choiceBtn = e.target.closest('[data-choice]');
    if (choiceBtn) {
      const idx = Number(choiceBtn.dataset.idx);
      const s = state[idx];
      const ordered = Number(items[idx].qty) || 1;
      s.choice = choiceBtn.dataset.choice;
      s.qty = ordered;
      remember();
      renderList();
      return;
    }
    const qtyBtn = e.target.closest('[data-qty]');
    if (qtyBtn && !qtyBtn.disabled) {
      const idx = Number(qtyBtn.dataset.idx);
      state[idx].qty += Number(qtyBtn.dataset.qty);
      remember();
      renderList();
    }
  });
  overlay.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'shopper-ticket') ticket = el.value;
    else if (el.dataset.addName !== undefined) added[Number(el.dataset.addName)].name = el.value;
    else if (el.dataset.addPrice !== undefined) added[Number(el.dataset.addPrice)].price = el.value;
    else if (el.dataset.paid !== undefined) {
      const idx = Number(el.dataset.paid);
      state[idx].paid = el.value;
      // Solo ese renglón (no se redibuja la lista para no perder el foco)
      const out = overlay.querySelector(`[data-paid-out="${idx}"]`);
      const p = parseMoney(el.value);
      if (out) {
        out.textContent = p ? `${money(p)} · unos ${formatWeight(Math.round(p * 1000 / (itemPricePerKg(items[idx]) || 1)))}` : 'Falta cargar lo que te cobraron';
        out.style.color = p ? t.tx : amber;
      }
    }
    else return;
    remember();
    renderSummary();
  });

  overlay.querySelector('#shopper-confirm').onclick = async () => {
    if (saving) return;
    const { errors, patch, allMissing } = preview();
    if (errors.length || photoState === 'uploading') return;
    if (!askTicket && !allMissing && ticketLooksOff(patch.shopTicketTotal, patch.shopComputedTotal)) {
      askTicket = true;
      renderSummary();
      return;
    }
    if (beforeConfirm) {
      // El aviso (p. ej. "estás lejos del comercio") se ve sobre el mapa, no detrás de la lista
      overlay.style.visibility = 'hidden';
      const ok = await beforeConfirm();
      overlay.style.visibility = '';
      if (!ok) return;
    }
    saving = true;
    renderSummary();
    try {
      const data = await submit({ orderId: order.id, results: toResults(state), ticketTotal: ticketValue(), added: toAdded(), ticketPhoto: photo || null });
      clearShopperMarks(order.id);
      close();
      onDone?.(data);
    } catch (err) {
      saving = false;
      renderSummary();
      const el = overlay.querySelector('#shopper-summary');
      if (el) el.insertAdjacentHTML('beforeend', `<div style="margin-top:8px; font-size:12.5px; font-weight:800; color:${red};">${esc(err.message || 'Sin conexión: probá de nuevo')}</div>`);
    }
  };
}
