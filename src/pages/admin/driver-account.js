// GoDelivery — Admin: estado de cuenta de un repartidor y caja de cobros/pagos
//
// Todo sale de la cuenta corriente (driver_ledger, ver src/utils/driver-ledger.js): el extracto
// es el mismo que ve el cadete (src/components/driver-statement.js) y la caja suma los
// movimientos de plata que registró el admin en un período.

import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { getState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal } from '../../components/modal.js';
import { ensureStatementStyles, renderBalanceHero, mountStatement, renderStatementList, fetchStatementPage } from '../../components/driver-statement.js';
import { ledgerErrorText, reverseLedgerEntry } from '../../utils/driver-ledger.js';
import { voidDriverSettlement } from '../../utils/driver-settlement.js';
import { argentinaDateStr } from '../../utils/canon.js';

const adminEmail = () => getState().user?.email || 'Admin';
const METHOD = { efectivo: 'Efectivo', transferencia: 'Transferencia', mercadopago: 'Mercado Pago' };

// Money movements and corrections can be undone from the statement. Orders and daily fees can
// too (a forgiven fee), but never the opening balance, the imported old history or an undo itself.
export function canReverseEntry(e) {
  return !e.reversedById && !['opening', 'reversal', 'history'].includes(e.type);
}

// Asks for the reason and undoes the entry. A payment that came with the old settlement docs goes
// through voidDriverSettlement so those docs (history, report movement, receipt) are undone too.
export function confirmReverseEntry({ db, entry, onDone }) {
  const el = document.createElement('div');
  el.style.cssText = 'padding:20px; display:flex; flex-direction:column; gap:14px;';
  el.innerHTML = `
    <div style="font-size:13.5px; font-weight:600; color:var(--color-text-secondary); line-height:1.5;">
      Se agrega un movimiento inverso de <b style="color:var(--color-text);">${formatPrice(Math.abs(entry.amount || 0))}</b> a la cuenta de
      <b style="color:var(--color-text);">${entry.driverName || 'el repartidor'}</b>. El original queda en el extracto, marcado como anulado.
    </div>
    <div>
      <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase;">Motivo</label>
      <input id="rev-reason" type="text" placeholder="Ej. Se registró dos veces" style="width:100%; box-sizing:border-box; height:48px; border-radius:14px; padding:0 14px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-weight:600; font-size:13.5px;" />
    </div>
    <button id="rev-confirm" style="height:50px; border-radius:16px; border:none; background:#e11d48; color:white; font-weight:900; font-size:14px; cursor:pointer;">Anular movimiento</button>
  `;
  showModal({ title: 'Anular movimiento', content: el, height: 'auto' });
  const btn = el.querySelector('#rev-confirm');
  btn.onclick = async () => {
    const reason = el.querySelector('#rev-reason').value.trim();
    if (!reason) {
      showToast('Escribí el motivo de la anulación', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Anulando...';
    try {
      if (entry.type === 'payment' && entry.settlementId) {
        await voidDriverSettlement({ db, settlementId: entry.settlementId, adminEmail: adminEmail(), reason });
      } else {
        await reverseLedgerEntry({ db, entryId: entry.id, reason, adminEmail: adminEmail() });
      }
      closeModal();
      showToast('Movimiento anulado', 'success');
      onDone?.();
    } catch (err) {
      console.error(err);
      showToast(ledgerErrorText(err, 'No se pudo anular el movimiento'), 'error');
      btn.disabled = false;
      btn.textContent = 'Anular movimiento';
    }
  };
}

// Plain-text statement to send the driver by WhatsApp.
function statementText(driver, balance, entries) {
  const lines = entries.slice(0, 10).map((e) => {
    const d = e.createdAt?.toDate ? e.createdAt.toDate() : new Date();
    const amt = Number(e.amount) || 0;
    return `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${e.concept || e.type}: ${amt > 0 ? '+' : '−'}${formatPrice(Math.abs(amt))}${e.reversedById ? ' (anulado)' : ''}`;
  });
  const b = Number(balance) || 0;
  const head = b > 0 ? `Tu saldo con GoDelivery: debés ${formatPrice(b)}.` : b < 0 ? `Tu saldo con GoDelivery: tenés ${formatPrice(-b)} a favor.` : 'Tu cuenta con GoDelivery está al día.';
  const alias = getState().bankAlias || 'godelivery.oficial';
  return `Hola ${driver.displayName || driver.name || ''}! ${head}\n\nÚltimos movimientos:\n${lines.join('\n') || 'Sin movimientos'}\n${b > 0 ? `\nPodés transferir al alias ${alias} y subir el comprobante desde la app (Mi cuenta → Pagar).` : ''}\nTambién lo ves completo en la app: Mi cuenta → Estado de cuenta.`;
}

// Driver's statement for the admin: balance, actions and every movement with "Anular".
// `onAction()` opens the Cobrar / Pagar / Ajuste modal.
export function openDriverStatement({ db, driver, onAction }) {
  ensureStatementStyles();
  const name = driver.displayName || driver.name || 'Repartidor';
  const el = document.createElement('div');
  el.className = 'gd-stmt';
  el.style.cssText = 'padding:16px 18px 28px;';
  el.innerHTML = `
    <div data-hero>${renderBalanceHero(driver.deliveryDebt || 0)}</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <button data-act class="gd-stmt-btn" style="background:var(--go-ink, #0b0b0c); color:white;">${icon('bank', 17)} Cobrar / Pagar</button>
      <button data-wsp class="gd-stmt-btn gd-stmt-btn--ghost">${icon('whatsappLogo', 17)} Enviar extracto</button>
    </div>
    <div data-body style="display:flex; flex-direction:column; gap:14px;"></div>
  `;
  showModal({ title: `Cuenta de ${name}`, content: el, height: '90dvh' });

  let latestEntries = [];
  let balance = driver.deliveryDebt || 0;
  const refreshHero = async () => {
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', driver.id)).catch(() => null);
    if (snap?.exists()) {
      balance = Number(snap.data().deliveryDebt) || 0;
      el.querySelector('[data-hero]').innerHTML = renderBalanceHero(balance);
    }
  };
  // The latest movements for the WhatsApp summary.
  const loadLatest = () => fetchStatementPage(db, driver.id, null, 10).then(({ entries }) => { latestEntries = entries; }).catch(() => {});
  const statement = mountStatement(el.querySelector('[data-body]'), {
    db,
    driverId: driver.id,
    perspective: 'admin',
    canReverse: canReverseEntry,
    onReverse: (entry) => confirmReverseEntry({ db, entry, onDone: () => reloadAll() }),
    emptyText: 'Todavía no hay movimientos. Si tenía deuda de antes, importá su historia desde Configuración → "Importar historial anterior".'
  });
  const reloadAll = () => { statement.reload(); refreshHero(); loadLatest(); };
  loadLatest();

  el.querySelector('[data-act]').onclick = () => onAction?.();
  el.querySelector('[data-wsp]').onclick = () => {
    const phone = (driver.phone || driver.whatsapp || '').replace(/\D/g, '');
    if (!phone) {
      showToast('El repartidor no tiene teléfono registrado', 'error');
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(statementText(driver, balance, latestEntries))}`, '_blank');
  };
  return { reload: reloadAll };
}

// ---------------------------------------------------------------- caja

const MONEY_TYPES = ['payment', 'payout', 'adjustment', 'reversal'];

function periodRange(period) {
  const today = argentinaDateStr();
  const shift = (days) => argentinaDateStr(new Date(Date.now() - days * 86400000));
  if (period === 'yesterday') return [shift(1), shift(1)];
  if (period === 'week') return [shift(6), today];
  if (period === 'month') return [`${today.slice(0, 7)}-01`, today];
  return [today, today];
}

// Cash effect of a money entry, by method: + came into GO!, − went out.
function cashEffect(e) {
  const t = e.type === 'reversal' ? e.reversesType : e.type;
  if (t !== 'payment' && t !== 'payout') return 0;
  return -(Number(e.amount) || 0); // payment −X (in +X), payout +X (out −X); reversals flip both.
}

export function renderCashTab(body, { db }) {
  ensureStatementStyles();
  let period = 'today';
  let entries = [];
  let search = '';
  body.innerHTML = `
    <div class="gd-stmt" style="gap:14px;">
      <div class="gd-stmt-pills">
        ${[['today', 'Hoy'], ['yesterday', 'Ayer'], ['week', '7 días'], ['month', 'Este mes']].map(([k, l]) => `<button type="button" class="gd-stmt-pill ${k === period ? 'is-on' : ''}" data-period="${k}">${l}</button>`).join('')}
      </div>
      <div data-cash-summary></div>
      <input data-cash-search type="text" placeholder="Buscar por repartidor o admin" style="width:100%; box-sizing:border-box; height:44px; border-radius:14px; padding:0 14px; font-weight:700; font-size:13px; background:var(--color-surface); border:1.5px solid var(--color-border); color:var(--color-text);" />
      <div data-cash-list style="display:flex; flex-direction:column; gap:14px;"></div>
    </div>
  `;
  const summaryEl = body.querySelector('[data-cash-summary]');
  const listEl = body.querySelector('[data-cash-list]');

  const drawList = () => {
    const q = search.toLowerCase().trim();
    const shown = entries.filter((e) => !q || (e.driverName || '').toLowerCase().includes(q) || (e.createdBy || '').toLowerCase().includes(q));
    // Each row names the driver: the statement component shows the concept, so prefix it.
    const named = shown.map((e) => ({ ...e, concept: e.concept, note: `${e.driverName || 'Repartidor'}${e.note ? ' · ' + e.note : ''}` }));
    listEl.innerHTML = renderStatementList(named, {
      perspective: 'admin',
      canReverse: canReverseEntry,
      emptyText: 'No hay cobros ni pagos registrados en este período.'
    });
    listEl.querySelectorAll('[data-stmt-reverse]').forEach((b) => {
      b.onclick = () => {
        const entry = entries.find((x) => x.id === b.dataset.stmtReverse);
        if (entry) confirmReverseEntry({ db, entry, onDone: load });
      };
    });
  };

  const drawSummary = () => {
    const byMethod = {};
    const byAdmin = {};
    let inTotal = 0;
    let outTotal = 0;
    let adjustments = 0;
    for (const e of entries) {
      const effect = cashEffect(e);
      if (effect) {
        const m = METHOD[e.method] || 'Efectivo';
        byMethod[m] = (byMethod[m] || 0) + effect;
        const who = e.createdBy || 'Admin';
        byAdmin[who] = (byAdmin[who] || 0) + effect;
        if (effect > 0) inTotal += effect; else outTotal -= effect;
      } else if (e.type === 'adjustment' || (e.type === 'reversal' && !['payment', 'payout'].includes(e.reversesType))) {
        adjustments += Math.abs(Number(e.amount) || 0);
      }
    }
    const tile = (label, value, color) => `
      <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:12px;">
        <div style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">${label}</div>
        <div style="font-size:19px; font-weight:950; color:${color}; margin-top:4px; letter-spacing:-0.5px;">${formatPrice(value)}</div>
      </div>`;
    const rows = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
      <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:700; padding:6px 0; border-top:1px solid var(--color-border-light);">
        <span style="color:var(--color-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">${k}</span>
        <span style="color:${v >= 0 ? '#059669' : '#e11d48'}; font-weight:900;">${v >= 0 ? '' : '−'}${formatPrice(Math.abs(v))}</span>
      </div>`).join('');
    summaryEl.innerHTML = `
      <div style="background:linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); border-radius:22px; padding:18px; color:white;">
        <div style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.08em;">Neto de caja</div>
        <div style="font-size:32px; font-weight:950; letter-spacing:-1px; margin-top:2px; color:${inTotal - outTotal >= 0 ? '#34d399' : '#fb7185'};">${inTotal - outTotal < 0 ? '−' : ''}${formatPrice(Math.abs(inTotal - outTotal))}</div>
        <div style="font-size:11.5px; color:rgba(255,255,255,0.6); font-weight:600; margin-top:4px;">Lo que entró por cobros menos lo que se pagó a los repartidores.</div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
        ${tile('Cobrado', inTotal, '#059669')}
        ${tile('Pagado a cadetes', outTotal, '#2563eb')}
      </div>
      ${Object.keys(byMethod).length ? `
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:10px 14px; margin-top:10px;">
          <div style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Por medio (neto)</div>
          ${rows(byMethod)}
          <div style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin:10px 0 4px;">Por admin (neto)</div>
          ${rows(byAdmin)}
        </div>` : ''}
      ${adjustments > 0 ? `<div style="font-size:12px; font-weight:700; color:var(--color-text-tertiary); margin-top:8px;">Además hubo ${formatPrice(adjustments)} en ajustes y anulaciones de cargos (no mueven plata).</div>` : ''}
    `;
  };

  async function load() {
    listEl.innerHTML = '<div class="loader-dots" style="margin:30px auto;"><span></span><span></span><span></span></div>';
    const [from, to] = periodRange(period);
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'driver_ledger'),
        where('type', 'in', MONEY_TYPES), where('dayStr', '>=', from), where('dayStr', '<=', to)));
      const ms = (e) => (e.createdAt?.toMillis ? e.createdAt.toMillis() : Date.now());
      // Reversals of orders done by the server aren't cash work; keep only what a person registered.
      entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => e.createdBy && e.createdBy !== 'sistema')
        .sort((a, b) => ms(b) - ms(a));
      drawSummary();
      drawList();
    } catch (err) {
      console.error('[Caja] load failed:', err);
      listEl.innerHTML = `<div class="gd-stmt-empty">${icon('alertTriangle', 28)}<p>No se pudo cargar la caja. Revisá la conexión.</p></div>`;
    }
  }

  body.querySelectorAll('[data-period]').forEach((b) => {
    b.onclick = () => {
      period = b.dataset.period;
      body.querySelectorAll('[data-period]').forEach((x) => x.classList.toggle('is-on', x === b));
      load();
    };
  });
  body.querySelector('[data-cash-search]').oninput = (e) => { search = e.target.value; drawList(); };
  load();
  return { reload: load };
}

