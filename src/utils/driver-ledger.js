// GoDelivery — Utility: cuenta corriente del cadete (acciones del admin)
//
// Cada peso que cambia el saldo de un cadete es un renglón en driver_ledger/{id}, que nunca se
// edita ni se borra: anular es agregar el renglón inverso. users.deliveryDebt es el saldo:
//   positivo → el cadete le debe a la app      negativo → la app le debe al cadete
// Los movimientos del sistema (pedidos, cuota diaria) los escribe el servidor (functions/ledger.js)
// con el mismo contrato, y las reglas lo hacen cumplir: deliveryDebt sólo cambia junto con un
// renglón nuevo cuyo balanceAfter es el saldo nuevo.
//
// Tipos que registra el admin (amount con signo, + sube lo que el cadete debe):
//   payment    → el cadete paga (−)          payout   → la app le paga al cadete (+)
//   adjustment → corrección con motivo (±)   reversal → anula otro renglón (inverso)

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const METHOD_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', mercadopago: 'Mercado Pago' };

// Writes one admin entry (plus the opening balance the first time) inside a transaction whose
// reads are already done, and the driver doc's only write (userExtra adds fields). Returns the new balance.
function postEntry(fs, tx, db, userRef, userData, id, fields, adminEmail, userExtra = {}) {
  const { doc, serverTimestamp } = fs;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const base = {
    driverId: userRef.id,
    driverName: userData.displayName || userData.name || 'Repartidor',
    dayStr: today,
    createdBy: adminEmail || 'Admin',
    createdAt: serverTimestamp()
  };
  const before = round2(userData.deliveryDebt || 0);
  // Line number within the driver's account: keeps the order of entries with the same timestamp.
  let seq = Number(userData.ledgerSeq) || 0;
  if (userData.ledgerOpened !== true) {
    tx.set(doc(db, 'driver_ledger', `open_${userRef.id}`), {
      ...base, type: 'opening', amount: before, balanceAfter: before, seq: ++seq,
      concept: 'Saldo al empezar la cuenta corriente'
    });
  }
  const amount = round2(fields.amount);
  const balance = round2(before + amount);
  tx.set(doc(db, 'driver_ledger', id), { ...base, ...fields, amount, balanceAfter: balance, seq: ++seq });
  tx.update(userRef, { deliveryDebt: balance, ledgerLastEntryId: id, ledgerOpened: true, ledgerSeq: seq, ledgerUpdatedAt: serverTimestamp(), ...userExtra });
  return balance;
}

// Readable reason for a failed write; offline is the common one and used to look like a hang.
export function ledgerErrorText(err, fallback = 'No se pudo registrar el movimiento') {
  if (err?.code === 'unavailable' || err?.code === 'deadline-exceeded' || /offline/i.test(err?.message || '')) {
    return 'Sin conexión con la base de datos: no se registró nada. Recargá la página y probá de nuevo.';
  }
  if (err?.code === 'permission-denied') return 'Sin permiso para registrar el movimiento: revisá que tu cuenta sea admin.';
  return err?.message && !err.code ? err.message : fallback;
}

// A fresh id for a form: the same id twice (double tap, retry) can only book once.
export function newRequestId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// The driver pays the app. Any amount, any time: paying more than the balance leaves credit.
// Also writes the old settlement/movement docs that the current screens and reports still read,
// and approves the transfer receipt when it comes from one. `extra` adds writes to the same transaction.
export async function registerDriverPayment({ db, driverId, amount, method = 'efectivo', note = '', proofId = null, requestId, adminEmail, concept, kind, extra }) {
  const fs = await import('firebase/firestore');
  const { runTransaction, doc, collection, serverTimestamp } = fs;
  const paid = round2(amount);
  if (!(paid > 0)) throw new Error('Ingresá un monto mayor a $0');
  const entryId = proofId ? `pay_proof_${proofId}` : `pay_${requestId || newRequestId()}`;
  const userRef = doc(db, 'users', driverId);
  const entryRef = doc(db, 'driver_ledger', entryId);
  const settlementRef = doc(collection(db, 'delivery_debt_settlements'));
  const transRef = doc(collection(db, 'delivery_transactions'));

  return runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const entrySnap = await tx.get(entryRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    if (entrySnap.exists()) throw new Error('Este cobro ya estaba registrado');
    const u = userSnap.data();
    const before = round2(u.deliveryDebt || 0);
    const label = METHOD_LABEL[method] || 'Efectivo';
    const balance = postEntry(fs, tx, db, userRef, u, entryId, {
      type: 'payment',
      amount: -paid,
      method,
      concept: concept || `Pago del cadete (${label})`,
      note,
      proofId,
      settlementId: settlementRef.id
    }, adminEmail, { lastLiquidationAt: serverTimestamp() });
    tx.set(settlementRef, {
      driverId,
      driverName: u.displayName || u.name || 'Repartidor',
      driverEmail: u.email || '',
      amount: paid,
      debtCleared: paid,
      grossDebt: before,
      remainingDebt: balance,
      method,
      notes: note,
      proofId,
      ...(kind ? { kind } : {}),
      transactionId: transRef.id,
      ledgerEntryId: entryId,
      settledBy: adminEmail,
      createdAt: serverTimestamp()
    });
    tx.set(transRef, {
      driverId,
      type: 'liquidation',
      amount: -paid,
      amountPaid: paid,
      settlementId: settlementRef.id,
      ledgerEntryId: entryId,
      description: `${concept || 'Pago de deuda'} (${label})${note ? ': ' + note : ''}`,
      settledBy: adminEmail,
      createdAt: serverTimestamp()
    });
    if (proofId) {
      tx.update(doc(db, 'delivery_settlement_proofs', proofId), {
        status: 'approved', approvedAmount: paid, settledAt: serverTimestamp(), settledBy: adminEmail
      });
    }
    const ids = { entryId, settlementId: settlementRef.id, transactionId: transRef.id };
    extra?.(tx, ids);
    return { ...ids, previousBalance: before, newBalance: balance };
  });
}

// The app pays the driver (usually the credit from coupons and incentives).
export async function registerDriverPayout({ db, driverId, amount, method = 'efectivo', note = '', requestId, adminEmail }) {
  const fs = await import('firebase/firestore');
  const { runTransaction, doc } = fs;
  const paid = round2(amount);
  if (!(paid > 0)) throw new Error('Ingresá un monto mayor a $0');
  const entryId = `payout_${requestId || newRequestId()}`;
  const userRef = doc(db, 'users', driverId);
  const entryRef = doc(db, 'driver_ledger', entryId);
  return runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const entrySnap = await tx.get(entryRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    if (entrySnap.exists()) throw new Error('Este pago ya estaba registrado');
    const u = userSnap.data();
    const newBalance = postEntry(fs, tx, db, userRef, u, entryId, {
      type: 'payout',
      amount: paid,
      method,
      concept: `Pago al cadete (${METHOD_LABEL[method] || 'Efectivo'})`,
      note
    }, adminEmail);
    return { entryId, previousBalance: round2(u.deliveryDebt || 0), newBalance };
  });
}

// A correction with a mandatory reason: + adds to what the driver owes, − takes it off.
export async function adjustDriverBalance({ db, driverId, amount, reason, requestId, adminEmail }) {
  const fs = await import('firebase/firestore');
  const { runTransaction, doc } = fs;
  const value = round2(amount);
  if (!value) throw new Error('Ingresá un monto distinto de $0');
  if (!reason || !reason.trim()) throw new Error('El ajuste necesita un motivo');
  const entryId = `adj_${requestId || newRequestId()}`;
  const userRef = doc(db, 'users', driverId);
  const entryRef = doc(db, 'driver_ledger', entryId);
  return runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const entrySnap = await tx.get(entryRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    if (entrySnap.exists()) throw new Error('Este ajuste ya estaba registrado');
    const u = userSnap.data();
    const newBalance = postEntry(fs, tx, db, userRef, u, entryId, {
      type: 'adjustment',
      amount: value,
      concept: value > 0 ? 'Ajuste: suma a la deuda' : 'Ajuste: descuenta de la deuda',
      note: reason.trim()
    }, adminEmail);
    return { entryId, previousBalance: round2(u.deliveryDebt || 0), newBalance };
  });
}

// Undoes an entry with its opposite. The original stays, marked as reversed. `extra` lets the
// caller fold the old docs' cleanup into the same transaction (writes only, reads are done).
export async function reverseLedgerEntry({ db, entryId, reason = '', adminEmail, extra }) {
  const fs = await import('firebase/firestore');
  const { runTransaction, doc, serverTimestamp } = fs;
  const entryRef = doc(db, 'driver_ledger', entryId);
  return runTransaction(db, async (tx) => {
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists()) throw new Error('El movimiento no existe');
    const e = entrySnap.data();
    if (e.reversedById) throw new Error('Ese movimiento ya estaba anulado');
    if (['opening', 'reversal', 'history'].includes(e.type)) throw new Error('Ese movimiento no se puede anular');
    const userRef = doc(db, 'users', e.driverId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    const revId = `rev_${entryId}`;
    const newBalance = postEntry(fs, tx, db, userRef, userSnap.data(), revId, {
      type: 'reversal',
      amount: -(e.amount || 0),
      concept: `Anulación: ${e.concept || 'movimiento'}`,
      note: reason,
      reversesId: entryId,
      // What it undoes, so the cash report can tell a returned payment from a forgiven fee.
      reversesType: e.type,
      ...(e.method ? { method: e.method } : {}),
      ...(e.orderId ? { orderId: e.orderId } : {})
    }, adminEmail);
    tx.update(entryRef, { reversedById: revId, reversedAt: serverTimestamp(), reversedBy: adminEmail || 'Admin' });
    extra?.(tx, e);
    return { reversalId: revId, reversed: e, newBalance };
  });
}

// Settlements from before the ledger have no entry to reverse: their undo is a reversal entry of
// what they cleared, keyed by the settlement so it can only happen once.
export async function reverseLegacySettlement({ db, settlement, reason = '', adminEmail, extra }) {
  const fs = await import('firebase/firestore');
  const { runTransaction, doc } = fs;
  const restore = round2(typeof settlement.debtCleared === 'number' ? settlement.debtCleared : (settlement.amount || 0));
  const userRef = doc(db, 'users', settlement.driverId);
  const entryId = `rev_legacy_${settlement.id}`;
  const entryRef = doc(db, 'driver_ledger', entryId);
  return runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const entrySnap = await tx.get(entryRef);
    if (!userSnap.exists()) throw new Error('El repartidor no existe');
    if (entrySnap.exists()) throw new Error('Esa liquidación ya estaba anulada');
    const newBalance = postEntry(fs, tx, db, userRef, userSnap.data(), entryId, {
      type: 'reversal',
      amount: restore,
      concept: 'Anulación de un cobro anterior a la cuenta corriente',
      note: reason,
      legacySettlementId: settlement.id,
      reversesType: 'payment',
      method: settlement.method || 'efectivo'
    }, adminEmail);
    extra?.(tx);
    return { newBalance };
  });
}
