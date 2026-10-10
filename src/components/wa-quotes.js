// Consultas de pedidos por WhatsApp (functions/whatsapp/): el cliente escribió qué quiere y el
// comercio contesta si lo tiene y cuánto sale. La hoja se abre sola mientras haya alguna
// esperando; si el comercio la deja para después, queda una pastilla para volver a abrirla.
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { escapeHtml } from '../utils/escape.js';
import { showToast } from './toast.js';
import { getState } from '../state.js';

// Igual que QUOTE_WAIT_MS en functions/whatsapp/notify.js: después se le ofrece un mandado al cliente
const WAIT_MS = 10 * 60 * 1000;
const SNOOZE_MS = 2 * 60 * 1000;
const PREP_OPTIONS = [10, 15, 20, 30, 45, 60];
const REJECT_REASONS = ['No tengo lo que pide', 'Estamos por cerrar', 'Mucha demanda en este momento', 'No hacemos eso'];

let unsub = null;
let quotes = [];
let sheet = null;        // { id, close }
let opening = false;
let onCount = () => {};
let tick = null;
const snoozed = new Map();

export function watchWaQuotes(comercioIds, countCb) {
  stopWaQuotes();
  if (!comercioIds || !comercioIds.length) return;
  onCount = countCb || (() => {});
  const q = query(
    collection(db, 'wa_quotes'),
    where('comercioId', 'in', comercioIds.slice(0, 30)),
    where('status', '==', 'waiting')
  );
  unsub = onSnapshot(q, (snap) => {
    quotes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    onCount(quotes.length);
    if (sheet && !quotes.some(x => x.id === sheet.id)) { sheet.close('gone'); sheet = null; }
    maybeOpen();
    renderPill();
  }, (err) => console.warn('[Consultas WhatsApp]', err?.code || err));
  tick = setInterval(() => { maybeOpen(); renderPill(); }, 20 * 1000);
}

export function stopWaQuotes() {
  if (unsub) unsub();
  unsub = null;
  if (tick) clearInterval(tick);
  tick = null;
  quotes = [];
  if (sheet) { sheet.close('gone'); sheet = null; }
  renderPill();
}

function maybeOpen() {
  if (sheet) return;
  const now = Date.now();
  const next = quotes.find(q => !(snoozed.get(q.id) > now));
  if (next) openQuote(next);
}

const minsLeft = (q) => Math.max(0, Math.ceil(((q.createdAtMs || Date.now()) + WAIT_MS - Date.now()) / 60000));

function mediaHtml(m) {
  const url = escapeHtml(m.url || '');
  if (m.type === 'audio') return `<audio controls preload="none" src="${url}" style="width:100%; margin-top:8px"></audio>`;
  if (m.type === 'image') return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Foto del pedido" style="width:100%; max-height:220px; object-fit:contain; border-radius:12px; margin-top:8px; background:var(--go-paper,#f4f2ee)"></a>`;
  return `<a href="${url}" target="_blank" rel="noopener" style="display:block; margin-top:8px">📎 Ver archivo</a>`;
}

async function openQuote(q) {
  if (sheet || opening) return;
  opening = true;
  let cpSheet;
  try {
    ({ cpSheet } = await import('../pages/comercio-panel/shell.js'));
  } finally {
    opening = false;
  }
  if (sheet) return;
  let prep = 20;
  let answered = false;
  const chips = () => PREP_OPTIONS.map(m => `<button type="button" class="cp-chip ${m === prep ? 'is-on' : ''}" data-min="${m}" style="justify-content:center">${m} min</button>`).join('');
  const left = minsLeft(q);
  const s = cpSheet({
    title: '📨 Pedido por WhatsApp',
    sub: `${q.customerName || 'Un cliente'} pregunta si lo tenés y cuánto sale.${left ? ` Responde en ${left} min o se le ofrece a otro.` : ''}`,
    bodyHtml: `
      <div style="background:var(--go-paper,#f4f2ee); border-radius:14px; padding:12px 14px; white-space:pre-wrap; font-size:15px; line-height:1.45">${escapeHtml(q.requestText || '(mandó audio o foto)')}</div>
      ${(q.media || []).map(mediaHtml).join('')}
      ${q.deliveryAddress ? `<p class="cp-sheet-sub" style="margin:10px 0 0">📍 Entrega en ${escapeHtml(q.deliveryAddress)}</p>` : ''}
      <label style="display:block; margin-top:14px; font-weight:700; font-size:13px">Precio total de los productos</label>
      <input id="waq-price" type="number" inputmode="numeric" min="1" step="1" placeholder="Ej: 12500" style="width:100%; box-sizing:border-box; height:48px; border-radius:12px; border:1px solid var(--go-line,#e4dfd6); padding:0 14px; font-size:18px; margin-top:6px; background:var(--go-card,#fff); color:inherit">
      <p class="cp-sheet-sub" style="margin:4px 0 0">Sin el envío: eso lo suma GO!.</p>
      <label style="display:block; margin-top:12px; font-weight:700; font-size:13px">¿En cuánto está listo?</label>
      <div id="waq-prep" style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:6px">${chips()}</div>
      <input id="waq-note" type="text" maxlength="160" placeholder="Aclaración para el cliente (opcional)" style="width:100%; box-sizing:border-box; height:44px; border-radius:12px; border:1px solid var(--go-line,#e4dfd6); padding:0 14px; font-size:14px; margin-top:12px; background:var(--go-card,#fff); color:inherit">`,
    actions: [
      { label: 'Enviar precio', cls: 'is-go', onClick: async (el) => {
        const price = Math.round(Number(el.querySelector('#waq-price').value));
        if (!(price > 0)) {
          showToast('Poné el precio total', 'warning');
          el.querySelector('#waq-price').focus();
          return false;
        }
        const ok = await answer(q.id, { status: 'quoted', price, prepMinutes: prep, commerceNote: el.querySelector('#waq-note').value.trim().slice(0, 160) });
        if (ok) { answered = true; showToast('Listo, le mandamos el precio al cliente', 'success'); }
        return ok;
      } },
      { label: 'No lo tengo', cls: 'is-ghost', onClick: () => { answered = true; askReject(q); } },
      { label: 'Después', cls: 'is-ghost' },
    ],
    onClose: (reason) => {
      if (sheet && sheet.id === q.id) sheet = null;
      if (!answered && reason !== 'gone') snoozed.set(q.id, Date.now() + SNOOZE_MS);
      renderPill();
    },
  });
  sheet = { id: q.id, close: s.close };
  renderPill();
  const grid = s.el.querySelector('#waq-prep');
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    prep = Number(b.dataset.min);
    grid.innerHTML = chips();
  });
}

async function askReject(q) {
  const { cpSheet } = await import('../pages/comercio-panel/shell.js');
  let done = false;
  const s = cpSheet({
    title: '¿Por qué no podés?',
    sub: 'Se lo decimos al cliente y le ofrecemos que un cadete lo consiga en otro lado.',
    bodyHtml: `<div id="waq-reasons" style="display:flex; flex-direction:column; gap:8px">${REJECT_REASONS.map(r => `<button type="button" class="cp-chip" data-r="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}</div>`,
    actions: [{ label: 'Volver', cls: 'is-ghost' }],
    onClose: () => { if (!done) { snoozed.delete(q.id); maybeOpen(); } },
  });
  s.el.querySelector('#waq-reasons').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    done = true;
    const ok = await answer(q.id, { status: 'rejected', rejectReason: b.dataset.r });
    if (ok) showToast('Listo, le avisamos al cliente', 'success');
    s.close('action');
  });
}

async function answer(quoteId, fields) {
  try {
    const ref = doc(db, 'wa_quotes', quoteId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status !== 'waiting') throw new Error('late');
      tx.update(ref, { ...fields, answeredAt: serverTimestamp(), answeredBy: getState().user?.uid || null });
    });
    return true;
  } catch (err) {
    showToast(err.message === 'late' ? 'Esta consulta ya venció o la respondió otra persona' : 'No se pudo enviar. Probá de nuevo.', 'error');
    return err.message === 'late';
  }
}

// Pastilla para volver a abrir las consultas que quedaron para después
function renderPill() {
  let el = document.getElementById('wa-quote-pill');
  const pending = sheet ? 0 : quotes.length;
  if (!pending) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'wa-quote-pill';
    el.type = 'button';
    el.style.cssText = 'position:fixed; left:50%; transform:translateX(-50%); bottom:calc(92px + env(safe-area-inset-bottom, 0px)); z-index:2147483000; border:0; border-radius:999px; padding:12px 18px; background:#25D366; color:#fff; font:700 14px Inter,system-ui,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.25); cursor:pointer; max-width:calc(100vw - 32px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis';
    el.addEventListener('click', () => {
      snoozed.clear();
      const first = quotes[0];
      if (first) openQuote(first);
    });
    document.body.appendChild(el);
  }
  el.textContent = `📨 ${pending} consulta${pending === 1 ? '' : 's'} por WhatsApp · Responder`;
}
