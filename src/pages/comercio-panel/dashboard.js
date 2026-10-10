// Pestaña Números: cómo viene el local, de un vistazo. Hoy / 7 días / 30 días,
// ventas por día, lo más vendido, lo que se le debe a GO! y la calificación.
import { db } from '../../firebase.js';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { COMMERCE_COMMISSION_ENABLED } from '../../utils/commerce-fees.js';
import { enterCommercePanel, getPanelComercio, onPanelComercio, cpEmpty, cpSkeleton } from './shell.js';

const DAY = 86400000;
const tsMs = (ts) => (!ts ? 0 : ts.toMillis ? ts.toMillis() : ts.seconds ? ts.seconds * 1000 : new Date(ts).getTime());
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const productsOf = (o) => Number(o.subtotal ?? (o.total - (o.deliveryCost || 0) - (o.appUsageFee || 0))) || 0;
const DAY_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export async function renderComercioDashboard() {
  const comercioId = getRouteParams().id;
  if (!comercioId) return;
  const body = await enterCommercePanel({ comercioId, tab: 'numbers' });
  if (!body) return;

  let range = 'today';
  let orders = [];
  let pendingCommission = null;

  body.innerHTML = `
    <div class="cp-page" id="cp-numbers">
      <div class="cp-chips" id="cp-range" style="margin-bottom:12px"></div>
      <div id="cp-numbers-main">${cpSkeleton(1, 150)}${cpSkeleton(2, 120)}</div>
    </div>`;
  const root = body.querySelector('#cp-numbers');
  const main = root.querySelector('#cp-numbers-main');

  const paintRange = () => {
    const chip = (k, l) => `<button type="button" class="cp-chip ${range === k ? 'is-on' : ''}" data-range="${k}">${l}</button>`;
    root.querySelector('#cp-range').innerHTML = chip('today', 'Hoy') + chip('week', '7 días') + chip('month', '30 días');
  };

  const paint = () => {
    const now = Date.now();
    const from = range === 'today' ? startOfDay(now) : range === 'week' ? startOfDay(now) - 6 * DAY : startOfDay(now) - 29 * DAY;
    const inRange = orders.filter(o => tsMs(o.createdAt) >= from);
    const done = inRange.filter(o => o.status === 'completed' || o.status === 'delivering');
    const cancelled = inRange.filter(o => o.status === 'cancelled');
    const sold = done.reduce((s, o) => s + productsOf(o), 0);
    const prepTimes = inRange.filter(o => o.confirmedAt && o.readyAt).map(o => (tsMs(o.readyAt) - tsMs(o.confirmedAt)) / 60000).filter(m => m > 0 && m < 180);
    const avgPrep = prepTimes.length ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length) : null;

    // Últimos 7 días, siempre: sirve para ver la semana aunque se mire "Hoy"
    const days = Array.from({ length: 7 }, (_, i) => startOfDay(now) - (6 - i) * DAY);
    const perDay = days.map(d => orders
      .filter(o => (o.status === 'completed' || o.status === 'delivering') && tsMs(o.createdAt) >= d && tsMs(o.createdAt) < d + DAY)
      .reduce((s, o) => s + productsOf(o), 0));
    const maxDay = Math.max(1, ...perDay);

    const top = {};
    done.forEach(o => (o.items || []).forEach(it => {
      const k = it.name || 'Producto';
      top[k] = (top[k] || 0) + (Number(it.qty || it.quantity) || 1);
    }));
    const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const label = range === 'today' ? 'hoy' : range === 'week' ? 'en 7 días' : 'en 30 días';
    const c = getPanelComercio() || {};

    main.innerHTML = `
      <div class="cp-metrics">
        <div class="cp-metric"><div class="cp-metric-label">Vendiste ${label}</div><div class="cp-metric-value">${formatPrice(sold)}</div><div class="cp-metric-hint">En productos</div></div>
        <div class="cp-metric"><div class="cp-metric-label">Pedidos entregados</div><div class="cp-metric-value">${done.length}</div><div class="cp-metric-hint">${cancelled.length ? `${cancelled.length} cancelado${cancelled.length === 1 ? '' : 's'}` : 'Sin cancelaciones'}</div></div>
        <div class="cp-metric"><div class="cp-metric-label">Ticket promedio</div><div class="cp-metric-value">${done.length ? formatPrice(Math.round(sold / done.length)) : '—'}</div></div>
        <div class="cp-metric"><div class="cp-metric-label">Tiempo de preparación</div><div class="cp-metric-value">${avgPrep !== null ? `${avgPrep} min` : '—'}</div><div class="cp-metric-hint">Promedio real</div></div>
      </div>

      ${COMMERCE_COMMISSION_ENABLED ? `
      <a class="cp-card ${pendingCommission > 0 ? 'is-warn' : ''}" href="#/mi-comercio/${comercioId}/finances" style="display:block; text-decoration:none; color:inherit">
        <div class="cp-row">
          <span class="cp-grow">
            <span class="cp-small" style="display:block">Comisión de GO! pendiente</span>
            <span class="cp-money" style="font-size:22px">${pendingCommission === null ? '…' : formatPrice(pendingCommission)}</span>
          </span>
          <span class="cp-btn is-sm">Ver detalle ${icon('chevronRight', 16)}</span>
        </div>
      </a>` : `
      <div class="cp-card cp-row">
        <span class="cp-item-icon">${icon('checkCircle', 20)}</span>
        <span class="cp-grow"><span class="cp-strong" style="display:block">Usás GO! sin comisión</span><span class="cp-small">Todo lo que vendés es tuyo.</span></span>
      </div>`}

      <div class="cp-card">
        <div class="cp-row" style="margin-bottom:12px"><span class="cp-strong cp-grow">Ventas de los últimos 7 días</span><span class="cp-small">${formatPrice(perDay.reduce((a, b) => a + b, 0))}</span></div>
        <div class="cp-bars" role="img" aria-label="Ventas por día de los últimos 7 días">
          ${perDay.map((v, i) => `<div class="${i === 6 ? 'is-today' : ''}" title="${formatPrice(v)}"><i style="height:${Math.round((v / maxDay) * 100)}%"></i><span>${i === 6 ? 'Hoy' : DAY_LETTER[new Date(days[i]).getDay()]}</span></div>`).join('')}
        </div>
      </div>

      <div class="cp-card">
        <div class="cp-strong" style="margin-bottom:8px">Lo más vendido ${label}</div>
        ${topList.length ? topList.map(([name, qty], i) => `
          <div class="cp-row" style="padding:7px 0; ${i ? 'border-top:1px solid var(--go-line)' : ''}">
            <span class="cp-small" style="width:18px">${i + 1}</span>
            <span class="cp-grow cp-ellipsis">${esc(name)}</span>
            <span class="cp-strong">${qty}</span>
          </div>`).join('') : `<div class="cp-muted">Todavía no hay ventas ${label}.</div>`}
      </div>

      <div class="cp-card cp-row">
        <span class="cp-item-icon">${icon('star', 20)}</span>
        <span class="cp-grow">
          <span class="cp-strong" style="display:block">${c.ratingAverage ? `${Number(c.ratingAverage).toFixed(1)} de 5` : 'Sin calificaciones todavía'}</span>
          <span class="cp-small">${c.ratingCount ? `${c.ratingCount} opiniones de clientes` : 'Aparecen cuando tus clientes califican'}</span>
        </span>
      </div>

      <div class="cp-list">
        <a class="cp-item" href="#/mi-comercio/${comercioId}/metrics">
          <span class="cp-item-icon">${icon('trendingUp', 20)}</span>
          <span class="cp-grow"><span class="cp-item-title">Métricas detalladas</span><span class="cp-item-sub" style="display:block">Por fechas, horarios, clientes y productos</span></span>
          <span class="cp-chev">${icon('chevronRight', 18)}</span>
        </a>
        ${COMMERCE_COMMISSION_ENABLED ? `<a class="cp-item" href="#/mi-comercio/${comercioId}/finances">
          <span class="cp-item-icon">${icon('wallet', 20)}</span>
          <span class="cp-grow"><span class="cp-item-title">Pagos y comisiones</span><span class="cp-item-sub" style="display:block">Qué le debés a GO!, pedido por pedido</span></span>
          <span class="cp-chev">${icon('chevronRight', 18)}</span>
        </a>` : ''}
      </div>`;
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    paintRange();
    paint();
  });

  const stopComercio = onPanelComercio(() => { if (orders.length) paint(); });
  paintRange();

  try {
    const from = Timestamp.fromMillis(startOfDay(Date.now()) - 29 * DAY);
    let snap;
    try {
      snap = await getDocs(query(collection(db, 'orders'), where('comercioId', '==', comercioId), where('createdAt', '>=', from), orderBy('createdAt', 'desc')));
    } catch (err) {
      // Sin el índice compuesto: se traen todos y se filtra acá
      snap = await getDocs(query(collection(db, 'orders'), where('comercioId', '==', comercioId)));
    }
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => tsMs(o.createdAt) >= from.toMillis());
    paint();

    if (!COMMERCE_COMMISSION_ENABLED) return { cleanup: () => stopComercio() };
    const doneSnap = await getDocs(query(collection(db, 'orders'), where('comercioId', '==', comercioId), where('status', '==', 'completed')));
    pendingCommission = doneSnap.docs.map(d => d.data())
      .filter(o => !o.commissionStatus || o.commissionStatus === 'pending')
      .reduce((s, o) => s + (Number(o.commissionAmount) || 0), 0);
    paint();
  } catch (err) {
    console.error('Números:', err);
    main.innerHTML = cpEmpty('alertTriangle', 'No pudimos cargar tus números', 'Revisá la conexión y volvé a entrar.');
  }

  return { cleanup: () => stopComercio() };
}
