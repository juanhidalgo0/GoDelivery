// GoDelivery — Utility: cuota diaria del cadete
//
// El cobro lo hace el servidor (functions/ledger.js) al completar el pedido N° canonMinOrders del
// día: suma un renglón "daily_fee" a la cuenta corriente. Acá vive lo que hace el admin a mano:
// registrar que el cadete le pagó la cuota de hoy en mano, o deshacerlo. Ese pago es un cobro
// común de la cuenta corriente: si la cuota todavía no se cobró (no llegó a los pedidos), le
// queda a favor, y cuando se cobre se compensa sola.
//
// El doc delivery_canon_payments/{uid}_{fecha} sigue existiendo para el chip "Cuota Hoy":
//   pending  → cobrada en la deuda, todavía no pagada
//   paid     → pagada al admin con este botón (ledgerEntryId es su renglón)
//   settled  → pagada dentro de una liquidación
//   approved → pagada por Mercado Pago (sistema viejo)

import { registerDriverPayment, reverseLedgerEntry } from './driver-ledger.js';

// Same day boundary as the server: Argentina, not UTC and not the device's zone.
export function argentinaDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date);
}

export function isCanonPaid(canon) {
  return !!canon && (canon.settled === true || ['approved', 'paid', 'settled'].includes(canon.status));
}

// Marks today's fee as paid in hand, or undoes it. Returns 'paid' | 'prepaid' | 'undone'.
export async function toggleCanonPaidToday({ db, driverId, canonAmount, adminEmail }) {
  const { doc, getDoc, serverTimestamp } = await import('firebase/firestore');
  const today = argentinaDateStr();
  const canonRef = doc(db, 'delivery_canon_payments', `${driverId}_${today}`);
  const canonSnap = await getDoc(canonRef);
  const canon = canonSnap.exists() ? canonSnap.data() : null;
  const dayLabel = today.split('-').reverse().join('/');

  if (!isCanonPaid(canon)) {
    const amount = canon?.amount > 0 ? canon.amount : canonAmount;
    const charged = canon?.chargedToDebt === true;
    await registerDriverPayment({
      db,
      driverId,
      amount,
      method: 'efectivo',
      note: charged ? '' : 'Pagada antes de que se cobre: queda a favor hasta que se cobre',
      requestId: `canon_${driverId}_${today}_${Date.now().toString(36)}`,
      adminEmail,
      concept: `Pago de cuota diaria ${dayLabel}`,
      kind: 'canon',
      // Only the chip's state; the payment is what moves the balance.
      extra: (tx, { entryId, settlementId, transactionId }) => tx.set(canonRef, {
        driverId,
        dateStr: today,
        amount,
        status: 'paid',
        settled: true,
        paidByAdmin: true,
        ledgerEntryId: entryId,
        settlementId,
        transactionIds: [transactionId],
        settledAt: serverTimestamp(),
        ...(canon ? {} : { createdAt: serverTimestamp() })
      }, { merge: true })
    });
    return charged ? 'paid' : 'prepaid';
  }

  // Undo. Only what this button did; a liquidation or Mercado Pago payment is undone elsewhere.
  if (canon.paidByAdmin !== true || !canon.ledgerEntryId) {
    throw new Error(canon.status === 'approved'
      ? 'La cuota de hoy se pagó por Mercado Pago'
      : canon.paidByAdmin === true
        ? 'Ese pago es anterior a la cuenta corriente: anulalo desde el historial de liquidaciones'
        : 'La cuota de hoy se pagó dentro de una liquidación: anulá esa liquidación');
  }
  await reverseLedgerEntry({
    db,
    entryId: canon.ledgerEntryId,
    reason: 'Pago de cuota deshecho',
    adminEmail,
    extra: (tx) => {
      // Remove this payment's movements so reports stop counting it as income.
      (canon.transactionIds || []).forEach((id) => tx.delete(doc(db, 'delivery_transactions', id)));
      if (canon.settlementId) {
        tx.update(doc(db, 'delivery_debt_settlements', canon.settlementId), { voided: true, voidedBy: adminEmail, voidedAt: serverTimestamp() });
      }
      if (canon.chargedToDebt === true) {
        tx.set(canonRef, { status: 'pending', settled: false, paidByAdmin: false, ledgerEntryId: null, settlementId: null, transactionIds: [] }, { merge: true });
      } else {
        tx.delete(canonRef);
      }
    }
  });
  return 'undone';
}
