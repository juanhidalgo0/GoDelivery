// GoDelivery — Utility: cuota diaria del cadete
//
// El cobro automático lo hace el servidor (chargeDailyCanonOnConnect en functions/index.js)
// la primera vez en el día que el cadete se conecta. Acá vive lo que hace el admin a mano:
// registrar que el cadete le pagó la cuota de hoy, o deshacerlo.
//
// Estados del doc delivery_canon_payments/{uid}_{fecha}:
//   pending  → cobrada en la deuda, todavía no pagada
//   paid     → pagada al admin con este botón (debtReduced dice cuánto se bajó de la deuda)
//   settled  → pagada dentro de una liquidación
//   approved → pagada por Mercado Pago
//   revoked  → anulada

// Same day boundary as the server: Argentina, not UTC and not the device's zone.
export function argentinaDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date);
}

export function isCanonPaid(canon) {
  return !!canon && (canon.settled === true || ['approved', 'paid', 'settled'].includes(canon.status));
}

// Marks today's fee as paid in hand, or undoes it. Returns what happened, for the toast.
export async function toggleCanonPaidToday({ db, driverId, canonAmount, adminEmail }) {
  const { runTransaction, doc, collection, increment, serverTimestamp } = await import('firebase/firestore');
  const today = argentinaDateStr();
  const userRef = doc(db, 'users', driverId);
  const canonRef = doc(db, 'delivery_canon_payments', `${driverId}_${today}`);

  return runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const canonSnap = await tx.get(canonRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    const u = userSnap.data();
    const canon = canonSnap.exists() ? canonSnap.data() : null;
    const driverName = u.displayName || u.name || 'Repartidor';

    if (!isCanonPaid(canon)) {
      const amount = canon?.amount > 0 ? canon.amount : canonAmount;
      // Already added to the debt today (by the server, or by an older app version).
      const chargedToday = u.lastCanonChargeDate === today && !!canon && canon.status !== 'revoked';
      const settlementRef = doc(collection(db, 'delivery_debt_settlements'));
      const payRef = doc(collection(db, 'delivery_transactions'));
      // Prepaid fees never went through the server's charge, so the ledger gets the charge here.
      const chargeRef = chargedToday ? null : doc(collection(db, 'delivery_transactions'));
      tx.set(settlementRef, {
        driverId,
        driverName,
        driverEmail: u.email || '',
        amount,
        method: 'efectivo',
        notes: chargedToday ? `Cuota diaria ${today}` : `Cuota diaria ${today} (pagada antes de conectarse)`,
        kind: 'canon',
        settledBy: adminEmail,
        createdAt: serverTimestamp()
      });
      tx.set(canonRef, {
        driverId,
        driverName,
        dateStr: today,
        amount,
        status: 'paid',
        settled: true,
        paidByAdmin: true,
        debtReduced: chargedToday ? amount : 0,
        settlementId: settlementRef.id,
        transactionIds: chargeRef ? [payRef.id, chargeRef.id] : [payRef.id],
        settledAt: serverTimestamp(),
        ...(canon ? {} : { createdAt: serverTimestamp() })
      }, { merge: true });
      tx.set(payRef, {
        driverId,
        type: 'liquidation',
        amount: -amount,
        description: `Pago de cuota diaria (${today})`,
        settlementId: settlementRef.id,
        settledBy: adminEmail,
        createdAt: serverTimestamp()
      });
      if (chargedToday) {
        tx.update(userRef, { deliveryDebt: increment(-amount) });
      } else {
        // Prepaid: the server sees today's fee as paid and won't charge it on connect.
        tx.update(userRef, { lastCanonChargeDate: today });
        tx.set(chargeRef, {
          driverId,
          type: 'canon_charge',
          amount,
          description: `Cuota diaria (${today}, pagada por adelantado)`,
          createdAt: serverTimestamp()
        });
      }
      return chargedToday ? 'paid' : 'prepaid';
    }

    // Undo. Only what this button did; a liquidation or Mercado Pago payment is undone elsewhere.
    if (canon.paidByAdmin !== true) {
      throw new Error(canon.status === 'approved'
        ? 'La cuota de hoy se pagó por Mercado Pago'
        : 'La cuota de hoy se pagó dentro de una liquidación: anulá esa liquidación');
    }
    const amount = canon.amount || canonAmount;
    // Remove this payment's movements so reports stop counting it as income.
    (canon.transactionIds || []).forEach((id) => tx.delete(doc(db, 'delivery_transactions', id)));
    if (canon.settlementId) {
      tx.update(doc(db, 'delivery_debt_settlements', canon.settlementId), { voided: true, voidedBy: adminEmail, voidedAt: serverTimestamp() });
    }
    // Back to owed: restore what the payment took off, or charge it now if it was prepaid
    // and the driver is already connected (the connect-time charge was skipped).
    const chargeNow = (canon.debtReduced || 0) > 0 ? canon.debtReduced : (u.isOnline === true ? amount : 0);
    if (chargeNow > 0) {
      tx.update(userRef, { deliveryDebt: increment(chargeNow), lastCanonChargeDate: today });
      tx.set(canonRef, { status: 'pending', settled: false, paidByAdmin: false, debtReduced: 0, chargedToDebt: true, settlementId: null, transactionIds: [] }, { merge: true });
      if (!(canon.debtReduced > 0)) {
        // Prepaid and already connected: this is a fresh charge (the server skipped it).
        tx.set(doc(collection(db, 'delivery_transactions')), {
          driverId,
          type: 'canon_charge',
          amount: chargeNow,
          description: `Cuota diaria (${today})`,
          createdAt: serverTimestamp()
        });
      }
    } else {
      // Offline and never charged: the next connection charges it as usual.
      tx.update(userRef, { lastCanonChargeDate: null });
      tx.set(canonRef, { status: 'revoked', settled: false, paidByAdmin: false, debtReduced: 0, settlementId: null, transactionIds: [] }, { merge: true });
    }
    return 'undone';
  });
}
