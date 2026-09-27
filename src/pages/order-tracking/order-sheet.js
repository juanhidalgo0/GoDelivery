// Hoja "Tu pedido" del seguimiento (vista del cliente): qué pediste, cuánto pagás línea por línea
// (con recargos y descuentos, siempre cuadrando con el total) y dónde se entrega.
import { icon } from '../../utils/icons.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const isTakeaway = (o) => o.deliveryType === 'takeaway' || o.deliveryType === 'retiro';
const isEncomienda = (o) => o.favorType === 'encomienda' || o.serviceType === 'encomienda' || o.favorType === 'mandado' || o.isEncomienda === true;
const isGoCash = (o) => o.favorType === 'gocash' || o.isGoCash === true;
const isTransfer = (o) => { const pm = String(o.paymentMethod || '').toLowerCase(); return pm === 'mercadopago' || pm.includes('transf'); };

/** Líneas del precio. Lo que no llega a sumar el total va en "Otros ajustes": nunca queda descuadrado. */
export function priceLines(o) {
  const n = (v) => Math.round(Number(v) || 0);
  const items = n(o.itemsCost || o.subtotal || o.itemsTotal || o.purchaseCost || (o.items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1), 0));
  const rain = n(o.rainSurcharge), night = n(o.nightSurcharge), tip = n(o.tip || o.tipAmount);
  // El envío guardado ya incluye la lluvia y el horario nocturno (se muestran aparte)
  const shipping = Math.max(0, n(o.shippingFee || o.deliveryFee || o.shippingCost || o.deliveryCost) - rain - night);
  const lines = [];
  if (o.isTrip) lines.push({ label: 'Viaje', value: shipping });
  else {
    if (o.isFavor) {
      if (!isGoCash(o) && !isEncomienda(o)) lines.push({ label: o.favorType === 'pagodeservicios' ? 'Facturas' : 'Compra', value: items, pending: items === 0, hint: items === 0 ? 'La carga el repartidor cuando compra' : '' });
    } else lines.push({ label: 'Productos', value: items });
    if (!isTakeaway(o)) lines.push({ label: 'Envío', value: shipping });
  }
  if (n(o.purchaseFee)) lines.push({ label: 'Gestión de la compra', value: n(o.purchaseFee) });
  if (n(o.extraStopsFee)) lines.push({ label: 'Comercios extra', value: n(o.extraStopsFee) });
  if (rain) lines.push({ label: 'Recargo por lluvia', value: rain });
  if (night) lines.push({ label: 'Recargo nocturno', value: night });
  const service = n(o.appUsageFee || o.serviceFee || o.platformFee);
  if (service) lines.push({ label: 'Tarifa de servicio', value: service });
  if (tip) lines.push({ label: 'Propina', value: tip });
  const coupon = n(o.couponDiscount), points = n(o.discountAmount), other = (!coupon && !points) ? n(o.discount) : 0;
  if (coupon) lines.push({ label: `Cupón${o.couponCode ? ` ${o.couponCode}` : ''}`, value: -coupon, good: true });
  if (points) lines.push({ label: 'Go Points', value: -points, good: true });
  if (other) lines.push({ label: 'Descuento', value: -other, good: true });
  const total = n(o.totalAmount || o.total) || lines.reduce((s, l) => s + l.value, 0);
  const diff = total - lines.reduce((s, l) => s + (l.pending ? 0 : l.value), 0);
  if (Math.abs(diff) >= 1 && !lines.some(l => l.pending)) lines.push({ label: 'Otros ajustes', value: diff });
  return { lines, total };
}

// Comercios de un mandado (campo nuevo o el texto de siempre)
function favorStores(o) {
  if (Array.isArray(o.mandadoStops) && o.mandadoStops.length) return o.mandadoStops.map(s => ({ store: s.store || 'Comercio', items: s.items || '' }));
  const raw = String(o.details || o.description || '').replace(/\*\*/g, '');
  const out = [];
  const re = /(?:🏪\s*)?\d+\.\s*Comercio\s*:\s*([^\n📦]+)[\s\S]*?(?:📦\s*)?Pedido\s*:\s*([^\n]*)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) out.push({ store: m[1].trim(), items: m[2].trim() });
  if (!out.length && raw) out.push({ store: String(o.pickupAddress || '').replace(/^Comercio:\s*/i, '') || 'Pedido', items: raw.replace(/\s+/g, ' ').trim().slice(0, 300) });
  return out;
}

function sheetHtml(o, flags) {
  const store = o.comercioRealName || o.comercioName || '';
  const { lines, total } = priceLines(o);
  let what = '';
  if (o.isTrip) {
    what = `
      <div class="gt-od-route">
        <div><i class="a"></i><span><b>Desde</b>${esc(o.originAddress || o.pickupAddress || '')}</span></div>
        <div><i class="b"></i><span><b>Hasta</b>${esc(o.destinationAddress || o.deliveryAddress || '')}</span></div>
      </div>`;
  } else if (o.isFavor) {
    what = favorStores(o).map((st, i) => `
      <div class="gt-od-item">
        <span class="gt-od-qty">${i + 1}</span>
        <div class="gt-od-name">${esc(st.store)}${st.items ? `<small>${esc(st.items)}</small>` : ''}</div>
      </div>`).join('');
  } else {
    what = (Array.isArray(o.items) ? o.items : []).map(it => `
      <div class="gt-od-item">
        <span class="gt-od-qty">${esc(it.qty || it.quantity || 1)}×</span>
        <div class="gt-od-name">${esc(it.name || it.title || 'Producto')}${it.notes ? `<small>“${esc(it.notes)}”</small>` : ''}</div>
        <span class="gt-od-price">${money((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1))}</span>
      </div>`).join('');
  }
  const payNote = isTakeaway(o) ? 'Pagás al retirar en el local'
    : (isTransfer(o) ? `Por transferencia${o.driverAlias ? ` al alias ${esc(o.driverAlias)}` : ' al alias del repartidor'}, al recibir` : 'En efectivo, al recibir');
  const title = o.isTrip ? 'Tu viaje' : (o.isFavor ? (isGoCash(o) ? 'Tu Go Cash' : (isEncomienda(o) ? 'Tu encomienda' : 'Tu mandado')) : 'Tu pedido');
  return `
    <div class="gt-od-backdrop" id="gt-od-backdrop"></div>
    <div class="gt-od" role="dialog" aria-label="${esc(title)}">
      <div class="gt-od-grab"></div>
      <div class="gt-od-head">
        <div>
          <div class="gt-od-title">${esc(title)}</div>
          <div class="gt-od-sub">${o.orderId ? `Pedido #${esc(o.orderId)}` : ''}${store && !o.isFavor && !o.isTrip ? ` · ${esc(store)}` : ''}</div>
        </div>
        <button class="gt-od-x" id="gt-od-close" aria-label="Cerrar">${icon('close', 18)}</button>
      </div>
      <div class="gt-od-body">
        ${what ? `<div class="gt-od-sec">${o.isTrip ? 'Recorrido' : (o.isFavor ? 'Qué pediste' : 'Productos')}</div><div class="gt-od-box">${what}</div>` : ''}
        <div class="gt-od-sec">Cuánto pagás</div>
        <div class="gt-od-box gt-od-prices">
          ${lines.map(l => `<div class="gt-od-line ${l.good ? 'good' : ''}"><span>${esc(l.label)}${l.hint ? `<small>${esc(l.hint)}</small>` : ''}</span><b>${l.pending ? '<em>A confirmar</em>' : (l.value < 0 ? '−' : '') + money(Math.abs(l.value))}</b></div>`).join('')}
          <div class="gt-od-total"><span>Total</span><b>${money(total)}</b></div>
          <div class="gt-od-pay">${icon(isTransfer(o) ? 'creditCard' : 'dollarSign', 15)}<span>${payNote}</span></div>
        </div>
        ${!o.isTrip && !isTakeaway(o) && o.deliveryAddress ? `
          <div class="gt-od-sec">Entrega</div>
          <div class="gt-od-box"><div class="gt-od-item"><span class="gt-od-qty">${icon('home', 15)}</span><div class="gt-od-name">${esc(o.deliveryAddress)}${o.addressNotes ? `<small>${esc(o.addressNotes)}</small>` : ''}</div></div></div>` : ''}
        ${flags.canCancel ? `<button class="gt-od-cancel" id="gt-od-cancel">${o.isTrip ? 'Cancelar viaje' : 'Cancelar pedido'}</button>` : ''}
      </div>
    </div>`;
}

/** Abre la hoja dentro de la pantalla de seguimiento (hereda los colores del tema). */
export function openClientOrderSheet(o, flags = {}) {
  if (!document.getElementById('gt-order-sheet-css')) {
    const st = document.createElement('style');
    st.id = 'gt-order-sheet-css';
    st.textContent = ORDER_SHEET_CSS;
    document.head.appendChild(st);
  }
  const host = document.querySelector('.tracking-v5-viewport') || document.body;
  host.querySelector('#gt-od-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'gt-od-wrap';
  wrap.innerHTML = sheetHtml(o, flags);
  host.appendChild(wrap);
  void wrap.offsetHeight; // aplica el estado inicial antes de animar
  setTimeout(() => wrap.classList.add('open'), 16);
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 280); };
  wrap.querySelector('#gt-od-backdrop').onclick = close;
  wrap.querySelector('#gt-od-close').onclick = close;
  wrap.querySelector('#gt-od-cancel')?.addEventListener('click', () => { close(); document.getElementById('v5-cancel-order-btn')?.click(); });
}

const ORDER_SHEET_CSS = `
  #gt-od-wrap .gt-od-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); z-index: 9998; opacity: 0; transition: opacity .25s ease; }
  #gt-od-wrap .gt-od { position: fixed; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 520px; z-index: 9999; background: var(--gt-bg, #fff); border-radius: 24px 24px 0 0;
    box-shadow: 0 -12px 40px rgba(15,23,42,.25); transform: translateY(100%); transition: transform .3s cubic-bezier(.16,1,.3,1);
    max-height: 88vh; max-height: 88dvh; display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; color: var(--gt-tx, #0F172A);
    padding-bottom: max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)); }
  #gt-od-wrap.open .gt-od-backdrop { opacity: 1; }
  #gt-od-wrap.open .gt-od { transform: none; }
  .gt-od-grab { width: 40px; height: 4px; border-radius: 2px; background: var(--gt-line, #E5E7EB); margin: 8px auto 0; flex-shrink: 0; }
  .gt-od-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px 6px; flex-shrink: 0; }
  .gt-od-title { font-family: var(--font-display, 'Outfit', sans-serif); font-size: 22px; font-weight: 700; }
  .gt-od-sub { font-size: 13px; color: var(--gt-tx3, #94A3B8); margin-top: 1px; }
  .gt-od-x { width: 40px; height: 40px; border-radius: 20px; border: 0; background: var(--gt-card, #F5F6F8); color: var(--gt-tx2, #475569); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
  .gt-od-body { overflow-y: auto; padding: 0 18px 18px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  .gt-od-sec { font-size: 13px; font-weight: 700; color: var(--gt-tx2, #475569); margin: 16px 2px 8px; }
  .gt-od-box { background: var(--gt-card, #F5F6F8); border-radius: 18px; padding: 2px 14px; }
  .gt-od-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; }
  .gt-od-item + .gt-od-item { border-top: 1px solid var(--gt-line, #E5E7EB); }
  .gt-od-qty { min-width: 28px; height: 28px; border-radius: 9px; background: var(--gt-bg, #fff); color: var(--gt-tx2, #475569); font-size: 12.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .gt-od-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 600; line-height: 1.35; padding-top: 4px; }
  .gt-od-name small { display: block; font-size: 13px; font-weight: 500; color: var(--gt-tx2, #475569); margin-top: 2px; }
  .gt-od-price { font-size: 14.5px; font-weight: 600; padding-top: 4px; flex-shrink: 0; }
  .gt-od-prices { padding: 8px 14px 14px; }
  .gt-od-line { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 7px 0; font-size: 14.5px; color: var(--gt-tx2, #475569); }
  .gt-od-line b { color: var(--gt-tx, #0F172A); font-weight: 600; white-space: nowrap; }
  .gt-od-line small { display: block; font-size: 12px; color: var(--gt-tx3, #94A3B8); margin-top: 1px; }
  .gt-od-line em { font-style: normal; color: var(--gt-amber, #B45309); font-weight: 600; }
  .gt-od-line.good, .gt-od-line.good b { color: var(--gt-green, #059669); }
  .gt-od-total { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid var(--gt-line, #E5E7EB); margin-top: 6px; padding-top: 12px; font-size: 16px; font-weight: 700; }
  .gt-od-total b { font-family: var(--font-display, 'Outfit', sans-serif); font-size: 24px; font-weight: 700; }
  .gt-od-pay { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--gt-tx2, #475569); margin-top: 8px; }
  .gt-od-route { display: flex; flex-direction: column; gap: 12px; padding: 12px 0; }
  .gt-od-route > div { display: flex; gap: 12px; align-items: flex-start; font-size: 14.5px; }
  .gt-od-route i { width: 10px; height: 10px; border-radius: 5px; margin-top: 5px; flex-shrink: 0; }
  .gt-od-route i.a { background: var(--gt-green, #059669); } .gt-od-route i.b { background: var(--gt-brand, #E11D48); }
  .gt-od-route b { display: block; font-size: 12px; color: var(--gt-tx3, #94A3B8); font-weight: 600; }
  .gt-od-cancel { display: block; margin: 16px auto 0; border: 0; background: none; color: var(--gt-red, #DC2626); font-weight: 600; font-size: 14px; cursor: pointer; padding: 8px 12px; font-family: inherit; }
`;
