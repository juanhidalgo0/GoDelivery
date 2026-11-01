// Acciones del comercio sobre un pedido, compartidas por la tarjeta y el detalle.
// Aceptar pide el tiempo de preparación (lo ve el cliente); rechazar o cancelar
// piden el motivo (también lo ve el cliente).
import { db } from '../../firebase.js';
import { doc, getDoc, updateDoc, runTransaction, serverTimestamp, increment, Timestamp, deleteField } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { cpSheet } from './shell.js';
import { formatPrice } from '../../utils/format.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import {
  applyWeights, isWeighedItem, orderedGrams, toleranceRange, itemPricePerKg, formatWeight, parseWeightInput, WEIGHT_TOLERANCE,
} from '../../utils/weight.js';

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
    if (e.message === 'not-pending') showToast('Ese pedido ya no está pendiente (el cliente lo canceló o cambió).', 'warning');
    else showToast('No se pudo aceptar. Revisá la conexión y probá de nuevo.', 'error');
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

// Pedido con productos por peso: antes de "Listo" el comercio anota lo que pesó cada corte
// y el pedido se recalcula (src/utils/weight.js). Si un corte se va más del 10% de lo pedido,
// tiene que confirmar que lo habló con el cliente. Devuelve true si quedó guardado.
export function askWeights(order) {
  return new Promise((resolve) => {
    const lines = (order.items || []).map((it, idx) => ({ it, idx })).filter(({ it }) => isWeighedItem(it));
    const kgText = (g) => (g > 0 ? (g / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 }) : '');
    const pct = Math.round(WEIGHT_TOLERANCE * 100);
    let done = false;
    const sheet = cpSheet({
      title: `¿Cuánto pesó el #${order.orderId || ''}?`,
      sub: `Anotá lo que marca la balanza. El cliente paga eso: hasta un ${pct}% más o menos de lo que pidió, sin preguntarle.`,
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:10px">
          ${lines.map(({ it, idx }) => {
            const r = toleranceRange(it);
            const opts = Array.isArray(it.options) && it.options.length ? `<div class="cp-small">${esc(it.options.map(o => o?.name).filter(Boolean).join(', '))}</div>` : '';
            const note = it.notes ? `<div class="cp-small" style="color:#b45309">“${esc(it.notes)}”</div>` : '';
            return `
              <div style="border:1px solid var(--go-line); border-radius:14px; padding:12px">
                <div style="font-weight:800">${esc(it.name)}</div>
                <div class="cp-small">Pidió ${formatWeight(orderedGrams(it))} · ${formatPrice(itemPricePerKg(it))}/kg · sin preguntar: de ${formatWeight(r.min)} a ${formatWeight(r.max)}</div>
                ${opts}${note}
                <div class="cp-row" style="gap:8px; margin-top:8px; align-items:center">
                  <input class="cp-input" data-w-idx="${idx}" inputmode="decimal" autocomplete="off" placeholder="Ej: ${kgText(orderedGrams(it)) || '1'}" value="${kgText(Number(it.actualGrams) || 0)}" aria-label="Kilos de ${esc(it.name)}" style="max-width:130px" />
                  <span class="cp-small">kg</span>
                  <span class="cp-money" data-w-line="${idx}" style="margin-left:auto">—</span>
                </div>
                <div class="cp-small" data-w-warn="${idx}" style="color:#b91c1c; font-weight:700; margin-top:6px; display:none"></div>
              </div>`;
          }).join('')}
          <div class="cp-row" style="justify-content:space-between; font-weight:800">
            <span>Productos</span><span class="cp-money" id="cp-w-sub">—</span>
          </div>
          <div class="cp-small" id="cp-w-diff"></div>
          <label id="cp-w-ok" style="display:none; gap:8px; align-items:flex-start; background:#fef3c7; border-radius:12px; padding:10px 12px; font-size:13px; font-weight:700; cursor:pointer">
            <input type="checkbox" id="cp-w-ok-check" style="margin-top:2px" />
            <span>Ya lo hablé con el cliente por el chat y está de acuerdo</span>
          </label>
        </div>`,
      actions: [
        { label: 'Volver', cls: 'is-ghost' },
        { label: 'Guardar y marcar listo', cls: 'is-go', onClick: async () => {
          const res = compute();
          if (res.missing.length) { showToast('Falta anotar el peso de algún producto.', 'warning'); focusFirst(res.missing[0]); return false; }
          if (res.outOfRange.length && !sheet.el.querySelector('#cp-w-ok-check').checked) {
            showToast(`Hay un corte que se va más del ${pct}%: hablalo con el cliente antes.`, 'warning');
            return false;
          }
          const ok = await saveWeights(order, readGrams());
          if (!ok) return false;
          done = true;
          resolve(true);
        } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });

    const inputs = [...sheet.el.querySelectorAll('[data-w-idx]')];
    const readGrams = () => Object.fromEntries(inputs.map(i => [i.dataset.wIdx, parseWeightInput(i.value) || 0]));
    const focusFirst = (idx) => sheet.el.querySelector(`[data-w-idx="${idx}"]`)?.focus();
    const compute = () => {
      const res = applyWeights(order, readGrams());
      const estimated = Number(order.estimatedSubtotal ?? order.subtotal) || 0;
      lines.forEach(({ it, idx }) => {
        const line = res.patch.items[idx];
        const has = !res.missing.includes(idx);
        sheet.el.querySelector(`[data-w-line="${idx}"]`).textContent = has ? formatPrice(line.price * (Number(line.qty) || 1)) : '—';
        const warn = sheet.el.querySelector(`[data-w-warn="${idx}"]`);
        const out = res.outOfRange.includes(idx);
        warn.style.display = out ? 'block' : 'none';
        if (out) warn.textContent = `${formatWeight(line.actualGrams)} se va más del ${pct}% de lo que pidió (${formatWeight(orderedGrams(it))}).`;
      });
      const complete = !res.missing.length;
      sheet.el.querySelector('#cp-w-sub').textContent = complete ? formatPrice(res.patch.subtotal) : '—';
      const diff = res.patch.subtotal - estimated;
      sheet.el.querySelector('#cp-w-diff').textContent = complete && Math.round(diff) !== 0
        ? `${formatPrice(Math.abs(diff))} ${diff > 0 ? 'más' : 'menos'} que lo estimado (${formatPrice(estimated)}). Le avisamos el total final al cliente.`
        : '';
      sheet.el.querySelector('#cp-w-ok').style.display = res.outOfRange.length ? 'flex' : 'none';
      return res;
    };
    inputs.forEach(i => i.addEventListener('input', compute));
    compute();
    setTimeout(() => inputs.find(i => !i.value)?.focus(), 300);
  });
}

// Guarda el peso real recalculando sobre el pedido como está ahora (no sobre la copia de la tarjeta).
export async function saveWeights(order, gramsByIndex) {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'orders', order.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('gone');
      const data = snap.data();
      if (!['pending', 'confirmed', 'preparing', 'ready'].includes(data.status)) throw new Error('moved');
      const res = applyWeights(data, gramsByIndex);
      if (res.missing.length) throw new Error('missing');
      tx.update(ref, { ...res.patch, weighedAt: serverTimestamp(), weightOverApproved: res.outOfRange.length > 0 });
    });
    return true;
  } catch (e) {
    showToast(e.message === 'moved' ? 'Ese pedido ya salió o se canceló: no se puede cambiar el peso.' : 'No se pudo guardar el peso. Probá de nuevo.', 'error');
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
