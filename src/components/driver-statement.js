// GoDelivery — Estado de cuenta del cadete (compartido por el admin y la app del cadete)
//
// Lee los renglones de driver_ledger (ver src/utils/driver-ledger.js) y los dibuja como un
// extracto bancario: agrupados por día, con el monto de cada movimiento y el saldo que dejó.
// El mismo componente sirve a las dos partes; `perspective` sólo cambia cómo se nombra cada
// cosa ("Pagaste" / "Cobro") y `.gd-stmt--driver` toma los colores del panel del cadete.

import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';

export const STATEMENT_PAGE_SIZE = 40;

// One page of a driver's entries, newest first. `cursor` is the last snapshot of the previous page.
export async function fetchStatementPage(db, driverId, cursor = null, pageSize = STATEMENT_PAGE_SIZE) {
  const { collection, query, where, orderBy, limit, startAfter, getDocs } = await import('firebase/firestore');
  const parts = [collection(db, 'driver_ledger'), where('driverId', '==', driverId), orderBy('seq', 'desc')];
  if (cursor) parts.push(startAfter(cursor));
  parts.push(limit(pageSize));
  const snap = await getDocs(query(...parts));
  return {
    entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize
  };
}

// Positive balance: the driver owes the app. Negative: the app owes the driver.
export function balanceInfo(balance, perspective = 'admin') {
  const b = Math.round((Number(balance) || 0) * 100) / 100;
  const driver = perspective === 'driver';
  if (b > 0) return { tone: 'debt', amount: b, label: driver ? 'Debés' : 'Debe', hint: driver ? 'Le debés a GO!' : 'Le debe a la app' };
  if (b < 0) return { tone: 'credit', amount: -b, label: 'A favor', hint: driver ? 'GO! te debe' : 'La app le debe' };
  return { tone: 'clear', amount: 0, label: 'Al día', hint: 'Sin saldo pendiente' };
}

export function balanceText(balance, perspective = 'admin') {
  const info = balanceInfo(balance, perspective);
  return info.tone === 'clear' ? 'Al día' : `${info.label} ${formatPrice(info.amount)}`;
}

const METHOD = { efectivo: 'Efectivo', transferencia: 'Transferencia', mercadopago: 'Mercado Pago' };

function dateOf(e) {
  const t = e.createdAt;
  if (t?.toDate) return t.toDate();
  if (t?.seconds) return new Date(t.seconds * 1000);
  return new Date(); // Pending server timestamp: it's being written right now.
}

// Title, detail line, icon and category of an entry, worded for who's reading it.
export function describeEntry(e, perspective = 'admin') {
  const driver = perspective === 'driver';
  const method = METHOD[e.method] ? ` · ${METHOD[e.method]}` : '';
  switch (e.type) {
    case 'opening':
      // Once the old history is imported below it, the opening only marks where the account starts.
      return (Number(e.amount) || 0) === 0
        ? { kind: 'other', icon: 'receipt', title: 'Inicio de la cuenta corriente', detail: 'Lo de abajo es el detalle del sistema anterior' }
        : { kind: 'other', icon: 'receipt', title: 'Saldo inicial', detail: driver ? 'Saldo que tenías al empezar la cuenta corriente' : 'Saldo que traía al empezar la cuenta corriente' };
    case 'history': {
      // What the old system recorded, brought in as the detail of the opening balance.
      const base = describeEntry({ ...e, type: e.historyKind === 'daily_fee' ? 'daily_fee' : e.historyKind === 'payment' ? 'payment' : 'order' }, perspective);
      if (e.historyKind === 'difference') {
        return { kind: 'money', icon: 'alertCircle', title: e.concept || 'Diferencia con el saldo registrado', detail: e.note || '', legacy: true };
      }
      return { ...base, title: e.historyKind === 'payment' ? (driver ? 'Pagaste' : 'Cobro') : base.title, detail: e.historyKind === 'payment' ? (e.note || '') : base.detail, legacy: true };
    }
    case 'order': {
      const bits = [`Tarifa app ${formatPrice(e.appFee || 0)}`];
      if (e.couponCredit > 0) bits.push(`cupón −${formatPrice(e.couponCredit)}`);
      if (e.pointsCredit > 0) bits.push(`GoPoints −${formatPrice(e.pointsCredit)}`);
      if (e.incentiveCredit > 0) bits.push(`incentivo −${formatPrice(e.incentiveCredit)}`);
      return { kind: 'order', icon: 'shoppingBag', title: e.concept || 'Pedido', detail: bits.join(' · ') };
    }
    case 'daily_fee':
      return { kind: 'fee', icon: 'motorcycle', title: e.concept || 'Cuota diaria', detail: 'Cuota por trabajar el día' };
    case 'payment':
      return { kind: 'money', icon: 'checkCircle', title: (driver ? 'Pagaste' : 'Cobro') + method, detail: e.note || (e.proofId ? 'Con comprobante' : '') };
    case 'payout':
      return { kind: 'money', icon: 'wallet', title: (driver ? 'GO! te pagó' : 'Pago al cadete') + method, detail: e.note || '' };
    case 'adjustment':
      return { kind: 'money', icon: 'edit', title: 'Ajuste', detail: e.note || e.concept };
    case 'reversal': {
      const title = e.reversesType === 'payment' ? (driver ? 'Se anuló un pago tuyo' : 'Cobro anulado')
        : e.reversesType === 'payout' ? (driver ? 'Se anuló un pago de GO!' : 'Pago al cadete anulado')
          : e.concept || 'Anulación';
      return { kind: 'money', icon: 'refresh', title, detail: e.note || '' };
    }
    default:
      return { kind: 'other', icon: 'receipt', title: e.concept || 'Movimiento', detail: e.note || '' };
  }
}

export const STATEMENT_FILTERS = [
  ['all', 'Todo'],
  ['order', 'Pedidos'],
  ['fee', 'Cuotas'],
  ['money', 'Pagos y ajustes']
];

function dayLabel(d) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hoy';
  if (same(d, yesterday)) return 'Ayer';
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Entries grouped by day. `canReverse(e)` decides which rows get an "Anular" button (admin).
export function renderStatementList(entries, { perspective = 'admin', filter = 'all', canReverse = null, emptyText } = {}) {
  const shown = entries.filter((e) => filter === 'all' || describeEntry(e, perspective).kind === filter);
  if (shown.length === 0) {
    return `<div class="gd-stmt-empty">${icon('receipt', 30)}<p>${emptyText || 'Todavía no hay movimientos.'}</p></div>`;
  }
  const groups = [];
  for (const e of shown) {
    const d = dateOf(e);
    const key = d.toDateString();
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: dayLabel(d), rows: [] });
    groups[groups.length - 1].rows.push(e);
  }
  return groups.map((g) => `
    <div>
      <div class="gd-stmt-day">${g.label}</div>
      <div class="gd-stmt-group">
        ${g.rows.map((e) => {
          const v = describeEntry(e, perspective);
          const amount = Number(e.amount) || 0;
          const tone = amount > 0 ? 'is-charge' : amount < 0 ? 'is-credit' : '';
          const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
          const time = dateOf(e).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
          const who = perspective === 'admin' && e.createdBy && e.createdBy !== 'sistema' ? ` · ${escapeHtml(e.createdBy)}` : '';
          const reversed = !!e.reversedById;
          return `
            <div class="gd-stmt-row ${reversed ? 'is-reversed' : ''}" ${e.orderId && (e.type === 'order' || e.historyKind === 'order') ? `data-stmt-order="${escapeHtml(e.orderId)}"` : ''}>
              <div class="gd-stmt-ico gd-stmt-ico--${v.kind}">${icon(v.icon, 17)}</div>
              <div class="gd-stmt-main">
                <div class="gd-stmt-title">${escapeHtml(v.title)}${reversed ? ' <span class="gd-stmt-tag">Anulado</span>' : ''}${v.legacy ? ' <span class="gd-stmt-tag">Sistema anterior</span>' : ''}</div>
                <div class="gd-stmt-sub">${v.detail ? `${escapeHtml(v.detail)} · ` : ''}${time}${who}</div>
                ${canReverse && canReverse(e) ? `<button type="button" class="gd-stmt-act" data-stmt-reverse="${escapeHtml(e.id)}">Anular</button>` : ''}
              </div>
              <div class="gd-stmt-amt ${tone}">
                <b>${sign}${formatPrice(Math.abs(amount))}</b>
                <span>${balanceText(e.balanceAfter, perspective)}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

// Big balance card at the top of both screens.
export function renderBalanceHero(balance, { perspective = 'admin', caption = '' } = {}) {
  const info = balanceInfo(balance, perspective);
  return `
    <div class="gd-stmt-hero gd-stmt-hero--${info.tone}">
      <div class="gd-stmt-hero-label">${info.tone === 'clear' ? (perspective === 'driver' ? 'Estás al día' : 'Al día') : info.hint}</div>
      <div class="gd-stmt-hero-amount">${formatPrice(info.amount)}</div>
      ${caption ? `<div class="gd-stmt-hero-caption">${caption}</div>` : ''}
    </div>`;
}

export function renderFilterPills(active) {
  return `<div class="gd-stmt-pills">${STATEMENT_FILTERS.map(([k, label]) => `<button type="button" class="gd-stmt-pill ${k === active ? 'is-on' : ''}" data-stmt-filter="${k}">${label}</button>`).join('')}</div>`;
}

// Styles live here once, so the admin and the driver screens stay identical.
export function ensureStatementStyles() {
  if (document.getElementById('gd-stmt-styles')) return;
  const style = document.createElement('style');
  style.id = 'gd-stmt-styles';
  style.textContent = `
    .gd-stmt { --st-text: var(--color-text); --st-muted: var(--color-text-tertiary); --st-card: var(--color-surface);
      --st-border: var(--color-border-light); --st-soft: var(--color-bg-secondary);
      --st-debt: #e11d48; --st-credit: #059669; --st-info: #2563eb;
      display: flex; flex-direction: column; gap: 14px; color: var(--st-text); }
    .gd-stmt--driver { --st-text: var(--driver-text-primary); --st-muted: var(--driver-text-secondary);
      --st-card: var(--driver-bg-elevated, rgba(127,127,127,0.06)); --st-border: var(--driver-border, rgba(127,127,127,0.18));
      --st-soft: var(--driver-fill-subtle-b, rgba(127,127,127,0.1)); --st-credit: #10b981; --st-debt: #f43f5e; }
    .gd-stmt-hero { border-radius: 22px; padding: 18px; text-align: center; border: 1.5px solid; }
    .gd-stmt-hero--debt { background: rgba(225,29,72,0.06); border-color: rgba(225,29,72,0.22); color: var(--st-debt); }
    .gd-stmt-hero--credit { background: rgba(5,150,105,0.07); border-color: rgba(5,150,105,0.25); color: var(--st-credit); }
    .gd-stmt-hero--clear { background: var(--st-soft); border-color: var(--st-border); color: var(--st-text); }
    .gd-stmt-hero-label { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
    .gd-stmt-hero-amount { font-size: 34px; font-weight: 950; letter-spacing: -1.2px; line-height: 1.15; margin-top: 2px; }
    .gd-stmt-hero-caption { font-size: 12px; font-weight: 600; color: var(--st-muted); margin-top: 6px; line-height: 1.45; }
    .gd-stmt-pills { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
    .gd-stmt-pills::-webkit-scrollbar { display: none; }
    .gd-stmt-pill { flex-shrink: 0; height: 32px; padding: 0 13px; border-radius: 10px; border: 1px solid var(--st-border);
      background: transparent; color: var(--st-muted); font-size: 12px; font-weight: 800; cursor: pointer; }
    .gd-stmt-pill.is-on { background: var(--st-text); border-color: var(--st-text); color: var(--st-card); }
    .gd-stmt-day { font-size: 10.5px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: var(--st-muted); margin: 4px 4px 8px; }
    .gd-stmt-group { background: var(--st-card); border: 1px solid var(--st-border); border-radius: 18px; overflow: hidden; }
    .gd-stmt-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-top: 1px solid var(--st-border); }
    .gd-stmt-row:first-child { border-top: 0; }
    .gd-stmt-row[data-stmt-order] { cursor: pointer; }
    .gd-stmt-ico { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      background: var(--st-soft); color: var(--st-muted); }
    .gd-stmt-ico--order { background: rgba(245,158,11,0.12); color: #d97706; }
    .gd-stmt-ico--fee { background: rgba(225,29,72,0.1); color: var(--st-debt); }
    .gd-stmt-ico--money { background: rgba(5,150,105,0.1); color: var(--st-credit); }
    .gd-stmt-main { flex: 1; min-width: 0; }
    .gd-stmt-title { font-weight: 800; font-size: 13.5px; line-height: 1.3; overflow-wrap: anywhere; }
    .gd-stmt-sub { font-size: 11.5px; font-weight: 600; color: var(--st-muted); margin-top: 2px; line-height: 1.35; }
    .gd-stmt-amt { text-align: right; flex-shrink: 0; }
    .gd-stmt-amt b { display: block; font-size: 14.5px; font-weight: 900; letter-spacing: -0.3px; }
    .gd-stmt-amt span { display: block; font-size: 10.5px; font-weight: 700; color: var(--st-muted); margin-top: 2px; white-space: nowrap; }
    .gd-stmt-amt.is-charge b { color: var(--st-debt); }
    .gd-stmt-amt.is-credit b { color: var(--st-credit); }
    .gd-stmt-row.is-reversed .gd-stmt-amt b, .gd-stmt-row.is-reversed .gd-stmt-sub { text-decoration: line-through; opacity: 0.55; }
    .gd-stmt-tag { display: inline-block; font-size: 9.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em;
      padding: 2px 6px; border-radius: 6px; background: var(--st-soft); color: var(--st-muted); vertical-align: 1px; }
    .gd-stmt-act { margin-top: 3px; padding: 2px 0; border: 0; background: none; color: var(--st-debt);
      font-size: 11.5px; font-weight: 800; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .gd-stmt-empty { text-align: center; padding: 40px 16px; color: var(--st-muted); }
    .gd-stmt-empty p { margin: 10px 0 0; font-weight: 700; font-size: 13px; }
    .gd-stmt-more { height: 42px; border-radius: 14px; border: 1px solid var(--st-border); background: transparent;
      color: var(--st-text); font-weight: 800; font-size: 12.5px; cursor: pointer; }
    .gd-stmt-btn { height: 48px; border-radius: 16px; border: none; font-weight: 900; font-size: 13px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; white-space: nowrap; }
    .gd-stmt-btn--ghost { background: transparent; border: 1.5px solid var(--st-border); color: var(--st-text); }
    .gd-stmt-note { border-radius: 16px; padding: 12px 14px; font-size: 12.5px; font-weight: 700; line-height: 1.45;
      background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.28); color: #b45309; }
    .gd-stmt--driver .gd-stmt-note { color: #f59e0b; }
  `;
  document.head.appendChild(style);
}

// A paged statement inside `root`: filter pills, grouped list and "Ver más". Returns
// { reload } so the caller can refresh it after registering or reversing something.
export function mountStatement(root, { db, driverId, perspective = 'admin', canReverse = null, onReverse = null, onOrder = null, emptyText }) {
  ensureStatementStyles();
  let entries = [];
  let cursor = null;
  let hasMore = false;
  let filter = 'all';
  let loading = false;

  root.innerHTML = `
    ${renderFilterPills(filter)}
    <div data-stmt-list style="display:flex; flex-direction:column; gap:14px;"><div class="loader-dots" style="margin:30px auto;"><span></span><span></span><span></span></div></div>
    <button type="button" class="gd-stmt-more" data-stmt-more style="display:none;">Ver movimientos anteriores</button>
  `;
  const list = root.querySelector('[data-stmt-list]');
  const more = root.querySelector('[data-stmt-more]');

  const draw = () => {
    list.innerHTML = renderStatementList(entries, { perspective, filter, canReverse, emptyText });
    more.style.display = hasMore ? 'block' : 'none';
    list.querySelectorAll('[data-stmt-reverse]').forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const entry = entries.find((x) => x.id === b.dataset.stmtReverse);
        if (entry && onReverse) onReverse(entry);
      };
    });
    if (onOrder) list.querySelectorAll('[data-stmt-order]').forEach((row) => { row.onclick = () => onOrder(row.dataset.stmtOrder); });
  };
  const load = async (reset) => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const page = await fetchStatementPage(db, driverId, reset ? null : cursor);
      entries = reset ? page.entries : [...entries, ...page.entries];
      cursor = page.cursor;
      hasMore = page.hasMore;
      draw();
    } catch (err) {
      console.error('[Statement] load failed:', err);
      list.innerHTML = `<div class="gd-stmt-empty">${icon('alertTriangle', 28)}<p>No se pudo cargar el estado de cuenta. Revisá la conexión.</p></div>`;
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  root.querySelectorAll('[data-stmt-filter]').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.stmtFilter;
      root.querySelectorAll('[data-stmt-filter]').forEach((x) => x.classList.toggle('is-on', x === b));
      draw();
    };
  });
  more.onclick = () => load(false);
  load(true);
  return { reload: () => load(true) };
}
