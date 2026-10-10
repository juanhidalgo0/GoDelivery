// Acciones del comercio sobre un pedido, compartidas por la tarjeta y el detalle.
// Aceptar pide el tiempo de preparación (lo ve el cliente); rechazar o cancelar
// piden el motivo (también lo ve el cliente).
import { db } from '../../firebase.js';
import { doc, getDoc, updateDoc, runTransaction, serverTimestamp, increment, Timestamp, deleteField } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { cpSheet } from './shell.js';

export const PREP_OPTIONS = [10, 15, 20, 30, 45, 60];
export const REJECT_REASONS = [
  'Me falta un producto',
  'Estamos por cerrar',
  'Mucha demanda en este momento',
  'No hacemos envíos a esa zona',
];

const lastPrepKey = (cid) => `gd-comercio-prep-${cid}`;

function defaultPrep(order, comercio) {
  try {
    const saved = Number(localStorage.getItem(lastPrepKey(order.comercioId)));
    if (PREP_OPTIONS.includes(saved)) return saved;
  } catch (e) {}
  const avg = Number(comercio?.averagePrepTime);
  if (avg > 0) return PREP_OPTIONS.reduce((best, m) => (Math.abs(m - avg) < Math.abs(best - avg) ? m : best), 20);
  return 20;
}

// Hoja "¿Cuánto tarda?" → acepta. Devuelve true si quedó aceptado.
export function askPrepAndAccept(order, comercio) {
  return new Promise((resolve) => {
    let chosen = defaultPrep(order, comercio);
    let done = false;
    const chips = () => PREP_OPTIONS.map(m => `<button type="button" class="cp-chip ${m === chosen ? 'is-on' : ''}" data-min="${m}" style="justify-content:center">${m} min</button>`).join('');
    const sheet = cpSheet({
      title: `¿Cuánto tarda el #${order.orderId || ''}?`,
      sub: 'El cliente lo ve en el seguimiento de su pedido.',
      bodyHtml: `<div id="cp-prep-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px">${chips()}</div>`,
      actions: [
        { label: 'Volver', cls: 'is-ghost' },
        {
          label: `Aceptar · ${chosen} min`, cls: 'is-go',
          onClick: async () => {
            done = true;
            const ok = await acceptOrder(order, chosen);
            resolve(ok);
          },
        },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    const grid = sheet.el.querySelector('#cp-prep-grid');
    const cta = sheet.el.querySelector('[data-act="1"]');
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-min]');
      if (!b) return;
      chosen = Number(b.dataset.min);
      grid.innerHTML = chips();
      cta.textContent = `Aceptar · ${chosen} min`;
    });
  });
}

export async function acceptOrder(order, minutes) {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'orders', order.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('gone');
      if (snap.data().status !== 'pending') throw new Error('not-pending');
      tx.update(ref, {
        status: 'confirmed',
        confirmedAt: serverTimestamp(),
        preparationTimeMinutes: minutes,
        estimatedReadyAt: Timestamp.fromMillis(Date.now() + minutes * 60000),
      });
    });
    try { localStorage.setItem(lastPrepKey(order.comercioId), String(minutes)); } catch (e) {}
    showToast(`Pedido #${order.orderId || ''} aceptado · ${minutes} min`, 'success');
    return true;
  } catch (e) {
    showToast(e.message === 'not-pending' ? 'Ese pedido ya no está pendiente (el cliente lo canceló o cambió).' : 'No se pudo aceptar. Revisá la conexión y probá de nuevo.', 'error');
    return false;
  }
}

// Hoja de motivos → rechaza (pendiente) o cancela (ya aceptado). Devuelve true si se hizo.
export function askReasonAndCancel(order) {
  const isPending = order.status === 'pending';
  return new Promise((resolve) => {
    let done = false;
    const sheet = cpSheet({
      title: isPending ? `¿Por qué rechazás el #${order.orderId || ''}?` : `¿Por qué cancelás el #${order.orderId || ''}?`,
      sub: 'Se lo decimos al cliente. No se puede deshacer.',
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:8px">
          ${REJECT_REASONS.map(r => `<button type="button" class="cp-btn is-block" data-reason="${r}" style="justify-content:flex-start">${r}</button>`).join('')}
          <div class="cp-row" style="gap:8px">
            <input class="cp-input" id="cp-other-reason" placeholder="Otro motivo" maxlength="120" />
            <button type="button" class="cp-btn is-red" id="cp-other-send" style="flex-shrink:0">Enviar</button>
          </div>
        </div>`,
      actions: [{ label: 'Volver', cls: 'is-ghost' }],
      onClose: () => { if (!done) resolve(false); },
    });
    const go = async (reason) => {
      if (!reason) return;
      done = true;
      sheet.close('action');
      resolve(await cancelOrder(order, reason));
    };
    sheet.el.querySelectorAll('[data-reason]').forEach(b => b.addEventListener('click', () => go(b.dataset.reason)));
    sheet.el.querySelector('#cp-other-send').addEventListener('click', () => {
      const v = sheet.el.querySelector('#cp-other-reason').value.trim();
      if (!v) { sheet.el.querySelector('#cp-other-reason').focus(); return; }
      go(v);
    });
  });
}

export async function cancelOrder(order, reason) {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'orders', order.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('gone');
      const data = snap.data();
      if (!['pending', 'confirmed'].includes(data.status)) throw new Error('moved');
      tx.update(ref, {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledBy: 'comercio',
        cancelReason: reason,
      });
      // Los puntos que usó el cliente vuelven a su cuenta
      if (data.pointsRedeemed > 0 && data.userId) {
        tx.update(doc(db, 'users', data.userId), { points: increment(data.pointsRedeemed) });
      }
    });
    showToast(order.status === 'pending' ? 'Pedido rechazado. Le avisamos al cliente.' : 'Pedido cancelado. Le avisamos al cliente.', 'info');
    return true;
  } catch (e) {
    showToast(e.message === 'moved' ? 'Ese pedido ya cambió de estado.' : 'No se pudo cancelar. Probá de nuevo.', 'error');
    return false;
  }
}

export async function markReady(order) {
  await updateDoc(doc(db, 'orders', order.id), { status: 'ready', readyAt: serverTimestamp() });
  if (order.confirmedAt) updateAveragePrepTime(order.comercioId, order.confirmedAt);
}

export async function undoReady(order) {
  await updateDoc(doc(db, 'orders', order.id), { status: 'confirmed', readyAt: deleteField() });
}

export async function completeOrder(order) {
  await updateDoc(doc(db, 'orders', order.id), { status: 'completed', completedAt: serverTimestamp() });
  showToast(`Pedido #${order.orderId || ''} entregado`, 'success');
}

export async function updateAveragePrepTime(comercioId, confirmedAt) {
  if (!confirmedAt) return;
  try {
    const confMs = confirmedAt.toMillis ? confirmedAt.toMillis() : (confirmedAt.seconds ? confirmedAt.seconds * 1000 : new Date(confirmedAt).getTime());
    const durationMin = Math.round((Date.now() - confMs) / 60000);
    if (durationMin < 1 || durationMin > 180) return;
    const ref = doc(db, 'comercios', comercioId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current = typeof snap.data().averagePrepTime === 'number' ? snap.data().averagePrepTime : 15;
    const next = Math.max(5, Math.min(90, Math.round(0.2 * durationMin + 0.8 * current)));
    await updateDoc(ref, { averagePrepTime: next });
  } catch (e) {
    console.warn('No se pudo actualizar el tiempo promedio:', e);
  }
}
