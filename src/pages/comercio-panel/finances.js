// Números → Pagos y comisiones: cuánto le debés a GO!, pedido por pedido, y los pagos que ya hiciste.
import { db } from '../../firebase.js';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { COMMERCE_COMMISSION_ENABLED } from '../../utils/commerce-fees.js';
import { enterCommercePanel, getPanelComercio, cpEmpty, cpSkeleton } from './shell.js';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const tsMs = (ts) => (!ts ? 0 : ts.toMillis ? ts.toMillis() : ts.seconds ? ts.seconds * 1000 : new Date(ts).getTime());
const isPendingCommission = (o) => o.status === 'completed' && (!o.commissionStatus || o.commissionStatus === 'pending');

export async function renderComercioFinances() {
  const comercioId = getRouteParams().id;
  if (!comercioId) return;
  const body = await enterCommercePanel({
    comercioId, tab: 'numbers',
    sub: { title: 'Pagos y comisiones', back: `#/mi-comercio/${comercioId}` },
  });
  if (!body) return;

  let month = 'all';
  let view = 'orders';
  let orders = [];
  let settlements = [];

  body.innerHTML = `
    <div class="cp-page" id="cp-fin">
      <div id="cp-fin-summary">${cpSkeleton(1, 120)}</div>
      <div class="cp-seg" id="cp-fin-view" style="margin:4px 0 10px"></div>
      <div class="cp-chips" id="cp-fin-months" style="margin-bottom:12px"></div>
      <div id="cp-fin-list">${cpSkeleton(4, 64)}</div>
    </div>`;
  const root = body.querySelector('#cp-fin');

  const inMonth = (ms) => {
    if (month === 'all') return true;
    const [y, m] = month.split('-').map(Number);
    const d = new Date(ms);
    return d.getFullYear() === y && d.getMonth() + 1 === m;
  };

  const paint = () => {
    const pendingAll = orders.filter(isPendingCommission).reduce((s, o) => s + (Number(o.commissionAmount) || 0), 0);
    const paidAll = orders.filter(o => o.status === 'completed' && o.commissionStatus === 'paid').reduce((s, o) => s + (Number(o.commissionAmount) || 0), 0);
    const rate = getPanelComercio()?.commissionRate;

    root.querySelector('#cp-fin-summary').innerHTML = !COMMERCE_COMMISSION_ENABLED ? `
      <div class="cp-card">
        <div class="cp-strong" style="font-size:16px">Hoy GO! no cobra comisión</div>
        <div class="cp-muted" style="margin-top:4px">Los comercios usan la app gratis. Abajo queda el historial de lo que se pagó antes.</div>
      </div>` : `
      <div class="cp-card ${pendingAll > 0 ? 'is-warn' : ''}">
        <div class="cp-small">Le debés a GO!</div>
        <div class="cp-money" style="font-size:28px; margin:2px 0 6px">${formatPrice(pendingAll)}</div>
        <div class="cp-muted">Es la comisión${typeof rate === 'number' ? ` (${Math.round(rate * 100)}%)` : ''} de los pedidos entregados por la app que todavía no pagaste. Los pedidos manuales y los de tu catálogo de WhatsApp no pagan comisión.</div>
        <div class="cp-row" style="margin-top:10px"><span class="cp-small cp-grow">Ya pagaste en total</span><span class="cp-strong">${formatPrice(paidAll)}</span></div>
        <button type="button" class="cp-btn is-block" data-act="support" style="margin-top:12px">${icon('headset', 18)} Coordinar un pago con GO!</button>
      </div>`;

    const seg = (k, l) => `<button type="button" class="cp-chip ${view === k ? 'is-on' : ''}" data-view="${k}">${l}</button>`;
    root.querySelector('#cp-fin-view').innerHTML = seg('orders', 'Pedido por pedido') + seg('payments', 'Pagos hechos');

    const now = new Date();
    const chip = (v, l) => `<button type="button" class="cp-chip ${month === v ? 'is-on' : ''}" data-month="${v}">${l}</button>`;
    root.querySelector('#cp-fin-months').innerHTML = chip('all', 'Todo') + Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return chip(`${d.getFullYear()}-${d.getMonth() + 1}`, `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`);
    }).join('');

    const list = root.querySelector('#cp-fin-list');
    if (view === 'orders') {
      const rows = orders.filter(o => ['completed', 'cancelled'].includes(o.status) && inMonth(tsMs(o.createdAt)));
      if (!rows.length) { list.innerHTML = cpEmpty('receipt', 'Sin pedidos en este período'); return; }
      list.innerHTML = `<div class="cp-list">${rows.map(o => {
        const cancelled = o.status === 'cancelled';
        const paid = o.commissionStatus === 'paid';
        const amount = cancelled ? 0 : Number(o.commissionAmount) || 0;
        const tag = cancelled ? '<span class="cp-tag">Cancelado</span>' : amount === 0 ? '<span class="cp-tag">Sin comisión</span>' : paid ? '<span class="cp-tag is-green">Pagada</span>' : '<span class="cp-tag is-amber">Pendiente</span>';
        return `
          <div class="cp-item" style="cursor:default">
            <span class="cp-grow">
              <span class="cp-item-title">Pedido #${esc(o.orderId || o.id.slice(0, 6))}</span>
              <span class="cp-item-sub" style="display:block">${new Date(tsMs(o.createdAt)).toLocaleDateString('es-AR')} · ${esc(o.userName || o.guestName || 'Cliente')} · vendiste ${formatPrice(o.subtotal || 0)}</span>
              ${o.couponCode ? `<span class="cp-item-sub" style="display:block">Cupón ${esc(o.couponCode)}: -${formatPrice(o.couponDiscount || 0)} ${o.couponAbsorbedBy === 'comercio' ? '(lo pusiste vos)' : '(lo puso GO!)'}</span>` : ''}
            </span>
            <span style="text-align:right">
              <span class="cp-money" style="display:block">${formatPrice(amount)}</span>
              ${tag}
            </span>
          </div>`;
      }).join('')}</div>`;
    } else {
      const rows = settlements.filter(s => inMonth(tsMs(s.createdAt)));
      if (!rows.length) { list.innerHTML = cpEmpty('wallet', 'Todavía no hay pagos registrados', 'Cuando GO! registra un pago tuyo, aparece acá.'); return; }
      list.innerHTML = `<div class="cp-list">${rows.map(s => `
        <div class="cp-item" style="cursor:default">
          <span class="cp-item-icon">${icon('checkCircle', 20)}</span>
          <span class="cp-grow">
            <span class="cp-item-title">Pago registrado</span>
            <span class="cp-item-sub" style="display:block">${new Date(tsMs(s.createdAt)).toLocaleDateString('es-AR')}${(s.orderCount || s.ordersCount) ? ` · ${s.orderCount || s.ordersCount} pedidos` : ''}</span>
          </span>
          <span class="cp-money">${formatPrice(Number(s.amountCollected ?? s.amount) || 0)}</span>
        </div>`).join('')}</div>`;
    }
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-month],[data-view],[data-act]');
    if (!t) return;
    if (t.dataset.month) month = t.dataset.month;
    if (t.dataset.view) view = t.dataset.view;
    if (t.dataset.act === 'support') {
      const { openSupportTicketModal } = await import('../../components/support-bot.js');
      openSupportTicketModal(comercioId, `Pago de comisiones: ${getPanelComercio()?.name || ''}`);
      return;
    }
    paint();
  });

  try {
    const [oSnap, sSnap] = await Promise.all([
      getDocs(query(collection(db, 'orders'), where('comercioId', '==', comercioId))),
      getDocs(query(collection(db, 'settlements'), where('comercioId', '==', comercioId))).catch(() => ({ docs: [] })),
    ]);
    orders = oSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    settlements = sSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    paint();
  } catch (err) {
    console.error('Pagos:', err);
    root.innerHTML = cpEmpty('alertTriangle', 'No pudimos cargar tus pagos', 'Revisá la conexión y volvé a entrar.');
  }
}
