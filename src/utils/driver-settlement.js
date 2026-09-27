// GoDelivery — Utility: liquidación de deuda del cadete
//
// Única forma de bajar deliveryDebt por un pago, usada por Repartidores (settings.js),
// la aprobación de comprobantes y Comisiones. deliveryDebt ya viene neto de cupones:
// el servidor los descuenta al completar cada pedido, así que el pago se resta tal cual.
//
// Cada liquidación deja:
//   delivery_debt_settlements/{id}  → historial del admin (con lo necesario para anularla)
//   delivery_transactions/{id}      → movimiento "liquidation" (lo leen el cadete y los reportes)

// Orders and daily fees are only marked settled when the payment covers the whole debt:
// a partial payment leaves them pending so the remainder still shows up as owed.
//
// Resolves as soon as the payment itself is committed (one transaction). Marking orders and
// fees as settled is only bookkeeping and runs afterwards: it's returned as `bookkeeping` for
// whoever needs to wait for it (tests); the UI doesn't.
export async function settleDriverDebt({ db, driverId, driverName, driverEmail, currentDebt, amount, method, notes, proofId, adminEmail }) {
  const { runTransaction, writeBatch, doc, collection, query, where, getDocs, increment, serverTimestamp } = await import('firebase/firestore');

  // Started now, in parallel with the transaction, so it reflects what existed at settlement
  // time (an order completed right after keeps its fee pending) without delaying the payment.
  const mayClose = currentDebt === undefined || amount >= currentDebt;
  const settleables = mayClose ? Promise.all([
    getDocs(query(collection(db, 'orders'), where('driverId', '==', driverId))),
    getDocs(query(collection(db, 'delivery_canon_payments'), where('driverId', '==', driverId)))
  ]) : null;
  settleables?.catch(() => {}); // Awaited later; avoid an unhandled rejection if the payment fails first.

  const settlementRef = doc(collection(db, 'delivery_debt_settlements'));
  const transRef = doc(collection(db, 'delivery_transactions'));
  const userRef = doc(db, 'users', driverId);
  // A transaction, not a batch: offline, a batch is queued silently and the button hangs (and a
  // second click would settle twice once the connection returns); a transaction needs the server
  // and fails instead. It also reads the debt as it is right now, not as the screen showed it.
  const { debtCleared, freshDebt } = await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    const debtNow = Math.max(0, userSnap.data().deliveryDebt || 0);
    // e.g. an earlier attempt that was queued offline already went through.
    if (debtNow <= 0) throw new Error('Este repartidor ya no tiene deuda: no se registró ningún cobro');
    const cleared = Math.max(0, Math.min(amount, debtNow));
    tx.update(userRef, {
      deliveryDebt: increment(-cleared),
      lastLiquidationAt: serverTimestamp()
    });
    tx.set(settlementRef, {
      driverId,
      driverName: driverName || 'Repartidor',
      driverEmail: driverEmail || '',
      amount,
      debtCleared: cleared,
      grossDebt: debtNow,
      remainingDebt: Math.max(0, debtNow - cleared),
      method,
      notes: notes || '',
      proofId: proofId || null,
      transactionId: transRef.id,
      settledBy: adminEmail,
      createdAt: serverTimestamp()
    });
    tx.set(transRef, {
      driverId,
      type: 'liquidation',
      amount: -cleared,
      amountPaid: amount,
      settlementId: settlementRef.id,
      description: `Liquidación de deuda (${method === 'transferencia' ? 'Transferencia' : 'Efectivo'})${notes ? ': ' + notes : ''}`,
      settledBy: adminEmail,
      createdAt: serverTimestamp()
    });
    if (proofId) {
      tx.update(doc(db, 'delivery_settlement_proofs', proofId), {
        status: 'approved',
        approvedAmount: amount,
        settledAt: serverTimestamp(),
        settledBy: adminEmail
      });
    }
    return { debtCleared: cleared, freshDebt: debtNow };
  });
  // Bookkeeping flags, in chunks to stay under the 500-writes-per-batch limit.
  // The debt itself is already settled above; a failure here only leaves stale flags.
  const bookkeeping = (async () => {
    // Only a payment that covered the whole current debt closes the pending orders and fees.
    if (!settleables || amount < freshDebt) return;
    const [ordersSnap, canonSnap] = await settleables;
    const marks = [
      ...ordersSnap.docs
        .filter((d) => d.data().isSettledDriver !== true && ['delivered', 'completed'].includes(d.data().status))
        .map((d) => [d.ref, { isSettledDriver: true, driverCommissionStatus: 'paid', driverSettledAt: serverTimestamp(), driverSettlementId: settlementRef.id }]),
      // Revoked fees were never charged; marking them settled would read as "paid" and skip the next charge.
      ...canonSnap.docs
        .filter((d) => d.data().settled !== true && d.data().status !== 'revoked')
        .map((d) => [d.ref, { settled: true, status: 'settled', settledAt: serverTimestamp(), settlementId: settlementRef.id }])
    ];
    for (let i = 0; i < marks.length; i += 450) {
      const b = writeBatch(db);
      marks.slice(i, i + 450).forEach(([ref, data]) => b.update(ref, data));
      await b.commit();
    }
  })().catch((markErr) => console.warn('Debt settled, but could not mark orders/fees as settled:', markErr));

  return { newDebt: Math.max(0, freshDebt - debtCleared), settlementId: settlementRef.id, bookkeeping };
}

// Undoes a liquidation: the debt goes back up by what it cleared, its movement is removed
// (so reports stop counting it as income) and the orders/fees it marked are pending again.
export async function voidDriverSettlement({ db, settlementId, adminEmail }) {
  const { runTransaction, writeBatch, doc, collection, query, where, getDocs, increment, serverTimestamp } = await import('firebase/firestore');
  const settlementRef = doc(db, 'delivery_debt_settlements', settlementId);

  const s = await runTransaction(db, async (tx) => {
    const snap = await tx.get(settlementRef);
    if (!snap.exists()) throw new Error('La liquidación no existe');
    const data = snap.data();
    if (data.voided === true) throw new Error('Esa liquidación ya estaba anulada');
    if (data.kind === 'canon') throw new Error('Es un pago de cuota diaria: deshacelo con el botón "Cuota Hoy"');
    // Older records have no debtCleared; for them the amount paid is the best figure.
    const restore = typeof data.debtCleared === 'number' ? data.debtCleared : (data.amount || 0);
    tx.update(doc(db, 'users', data.driverId), { deliveryDebt: increment(restore) });
    tx.update(settlementRef, { voided: true, voidedBy: adminEmail, voidedAt: serverTimestamp() });
    if (data.transactionId) tx.delete(doc(db, 'delivery_transactions', data.transactionId));
    if (data.proofId) tx.update(doc(db, 'delivery_settlement_proofs', data.proofId), { status: 'pending', settledAt: null, settledBy: null });
    return data;
  });

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
