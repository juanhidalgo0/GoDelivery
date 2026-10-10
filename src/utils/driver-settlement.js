// GoDelivery — Utility: cobro de deuda del cadete ("liquidación")
//
// Un cobro es un renglón "payment" de la cuenta corriente (src/utils/driver-ledger.js), usado por
// Repartidores (settings.js), la aprobación de comprobantes y Comisiones. deliveryDebt ya viene
// neto de cupones e incentivos (el servidor los descuenta al completar cada pedido), así que el
// pago se resta tal cual. Pagar de más deja saldo a favor del cadete.
//
// Además de su renglón, cada cobro sigue dejando lo que leen las pantallas y reportes actuales:
//   delivery_debt_settlements/{id}  → historial del admin
//   delivery_transactions/{id}      → movimiento "liquidation" (lo leen el cadete y los reportes)

import { registerDriverPayment, reverseLedgerEntry, reverseLegacySettlement } from './driver-ledger.js';

// Orders and daily fees are only marked settled when the payment covers the whole balance:
// a partial payment leaves them pending so the remainder still shows up as owed.
//
// Resolves as soon as the payment itself is committed (one transaction). Marking orders and
// fees as settled is only bookkeeping and runs afterwards: it's returned as `bookkeeping` for
// whoever needs to wait for it (tests); the UI doesn't.
export async function settleDriverDebt({ db, driverId, currentDebt, amount, method, notes, proofId, requestId, adminEmail }) {
  const { writeBatch, collection, query, where, getDocs, serverTimestamp } = await import('firebase/firestore');

  // Started now, in parallel with the payment, so it reflects what existed at settlement time
  // (an order completed right after keeps its fee pending) without delaying the payment.
  const mayClose = currentDebt === undefined || amount >= currentDebt;
  const settleables = mayClose ? Promise.all([
    getDocs(query(collection(db, 'orders'), where('driverId', '==', driverId))),
    getDocs(query(collection(db, 'delivery_canon_payments'), where('driverId', '==', driverId)))
  ]) : null;
  settleables?.catch(() => {}); // Awaited later; avoid an unhandled rejection if the payment fails first.

  const result = await registerDriverPayment({ db, driverId, amount, method, note: notes, proofId, requestId, adminEmail });

  // Bookkeeping flags, in chunks to stay under the 500-writes-per-batch limit.
  // The payment itself is already booked above; a failure here only leaves stale flags.
  const bookkeeping = (async () => {
    if (!settleables || result.newBalance > 0) return;
    const [ordersSnap, canonSnap] = await settleables;
    const marks = [
      ...ordersSnap.docs
        .filter((d) => d.data().isSettledDriver !== true && ['delivered', 'completed'].includes(d.data().status))
        .map((d) => [d.ref, { isSettledDriver: true, driverCommissionStatus: 'paid', driverSettledAt: serverTimestamp(), driverSettlementId: result.settlementId }]),
      // Revoked fees were never charged; marking them settled would read as "paid".
      ...canonSnap.docs
        .filter((d) => d.data().settled !== true && d.data().status !== 'revoked')
        .map((d) => [d.ref, { settled: true, status: 'settled', settledAt: serverTimestamp(), settlementId: result.settlementId }])
    ];
    for (let i = 0; i < marks.length; i += 450) {
      const b = writeBatch(db);
      marks.slice(i, i + 450).forEach(([ref, data]) => b.update(ref, data));
      await b.commit();
    }
  })().catch((markErr) => console.warn('Payment booked, but could not mark orders/fees as settled:', markErr));

  return { newDebt: result.newBalance, settlementId: result.settlementId, entryId: result.entryId, bookkeeping };
}

// Undoes a payment: a reversal entry puts the balance back, the old settlement is marked voided,
// its movement is removed (so reports stop counting it as income) and the orders/fees it marked
// are pending again.
export async function voidDriverSettlement({ db, settlementId, adminEmail, reason = '' }) {
  const { doc, getDoc, writeBatch, collection, query, where, getDocs, serverTimestamp } = await import('firebase/firestore');
  const settlementRef = doc(db, 'delivery_debt_settlements', settlementId);
  const snap = await getDoc(settlementRef);
  if (!snap.exists()) throw new Error('La liquidación no existe');
  const s = { id: snap.id, ...snap.data() };
  if (s.voided === true) throw new Error('Esa liquidación ya estaba anulada');

  const cleanup = (tx) => {
    tx.update(settlementRef, { voided: true, voidedBy: adminEmail, voidedAt: serverTimestamp() });
    if (s.transactionId) tx.delete(doc(db, 'delivery_transactions', s.transactionId));
    if (s.proofId) tx.update(doc(db, 'delivery_settlement_proofs', s.proofId), { status: 'pending', settledAt: null, settledBy: null });
  };
  if (s.ledgerEntryId) {
    await reverseLedgerEntry({ db, entryId: s.ledgerEntryId, reason: reason || 'Liquidación anulada', adminEmail, extra: cleanup });
  } else {
    await reverseLegacySettlement({ db, settlement: s, reason, adminEmail, extra: cleanup });
  }

  const [ordersSnap, canonSnap] = await Promise.all([
    getDocs(query(collection(db, 'orders'), where('driverSettlementId', '==', settlementId))),
    getDocs(query(collection(db, 'delivery_canon_payments'), where('settlementId', '==', settlementId)))
  ]);
  const unmarks = [
    ...ordersSnap.docs.map((d) => [d.ref, { isSettledDriver: false, driverCommissionStatus: 'pending', driverSettledAt: null, driverSettlementId: null }]),
    ...canonSnap.docs.map((d) => [d.ref, { settled: false, status: 'pending', settledAt: null, settlementId: null }])
  ];
  for (let i = 0; i < unmarks.length; i += 450) {
    const b = writeBatch(db);
    unmarks.slice(i, i + 450).forEach(([ref, data]) => b.update(ref, data));
    await b.commit();
  }
  return s;
}
