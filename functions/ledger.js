// GoDelivery — Cuenta corriente del cadete (lado servidor)
//
// Cada peso que cambia el saldo de un cadete es un renglón en driver_ledger/{id}, que nunca se
// edita ni se borra (anular = renglón inverso). users.deliveryDebt es el saldo resultante:
//   positivo → el cadete le debe a la app      negativo → la app le debe al cadete
// src/utils/driver-ledger.js cumple el mismo contrato para el admin, y las reglas lo hacen
// cumplir: deliveryDebt sólo cambia junto con un renglón nuevo cuyo balanceAfter es el saldo nuevo.
//
// Acá viven los movimientos que genera el sistema: cada pedido completado (tarifa − cupón −
// GoPoints − incentivo) y la cuota diaria, que se cobra al completar el pedido N° canonMinOrders del día.
// También el tope de deuda (settings/global.debtLimitEnabled + maxDebtLimit): pasado el tope el
// cadete no puede conectarse ni recibe pedidos nuevos hasta que pague.

const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function argentinaDateStr(date = new Date()) {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(date);
}

function driverNameOf(u) {
  return u.displayName || u.name || "Repartidor";
}

// Writes the entries (in order) and the new balance. Everything must already be read: Firestore
// transactions don't allow reads after writes. The first entry for a driver also writes their
// opening balance (what deliveryDebt said before the ledger existed). Each entry gets the driver's
// next line number (seq): entries written together share their timestamp, seq keeps their order.
function postEntries(tx, db, userRef, userData, entries) {
  const today = argentinaDateStr();
  let balance = round2(userData.deliveryDebt || 0);
  let seq = Number(userData.ledgerSeq) || 0;
  const base = {
    driverId: userRef.id,
    driverName: driverNameOf(userData),
    dayStr: today,
    createdBy: "sistema",
    createdAt: FieldValue.serverTimestamp()
  };
  if (userData.ledgerOpened !== true) {
    tx.set(db.collection("driver_ledger").doc(`open_${userRef.id}`), {
      ...base,
      type: "opening",
      amount: balance,
      balanceAfter: balance,
      seq: ++seq,
      concept: "Saldo al empezar la cuenta corriente"
    });
  }
  let lastId = null;
  for (const e of entries) {
    const { id, ...fields } = e;
    balance = round2(balance + round2(fields.amount));
    tx.set(db.collection("driver_ledger").doc(id), { ...base, ...fields, amount: round2(fields.amount), balanceAfter: balance, seq: ++seq });
    lastId = id;
  }
  return { balance, lastId, seq };
}

function ledgerUserFields(balance, lastId, seq) {
  return {
    deliveryDebt: balance,
    ledgerLastEntryId: lastId,
    ledgerSeq: seq,
    ledgerOpened: true,
    ledgerUpdatedAt: FieldValue.serverTimestamp()
  };
}

function isCanonPaid(canon) {
  return !!canon && (canon.settled === true || ["approved", "paid", "settled"].includes(canon.status));
}

async function loadAccountSettings(db) {
  const snap = await db.collection("settings").doc("global").get();
  const s = snap.exists ? snap.data() : {};
  const amount = Number(s.canonAmount) > 0 ? Number(s.canonAmount) : 2000;
  const minOrders = Math.max(1, Math.floor(Number(s.canonMinOrders) || 1));
  return { amount, minOrders, debtPolicy: debtPolicyOf(s) };
}

// ---------------------------------------------------------------- tope de deuda

const DEBT_WARNING_SHARE = 0.8;

function debtPolicyOf(settings) {
  const limit = Number(settings.maxDebtLimit) || 0;
  return { enabled: settings.debtLimitEnabled === true && limit > 0, limit };
}

async function loadDebtPolicy(db = getFirestore()) {
  const snap = await db.collection("settings").doc("global").get();
  return debtPolicyOf(snap.exists ? snap.data() : {});
}

// Same rule as the driver app's connect check: strictly above the limit. Admins are never blocked.
function isOverDebtLimit(user, policy) {
  if (!policy.enabled || !user) return false;
  if (user.role === "admin" || user.isAdmin === true) return false;
  return (Number(user.deliveryDebt) || 0) > policy.limit;
}

// A driver who just went online while above the limit is taken offline again, with the reason,
// so their app shows why (and onDriverDisconnected sends the notice).
async function blockIfOverDebtLimit(userId) {
  const db = getFirestore();
  const policy = await loadDebtPolicy(db);
  if (!policy.enabled) return "off";
  const userRef = db.collection("users").doc(userId);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return "missing";
    const u = snap.data();
    if (u.isOnline !== true) return "offline";
    if (!isOverDebtLimit(u, policy)) return "ok";
    tx.update(userRef, {
      isOnline: false,
      currentSessionId: null,
      disconnectedReason: "debt_limit",
      debtBlockedAt: FieldValue.serverTimestamp()
    });
    if (u.currentSessionId) {
      tx.set(db.collection("deliverySessions").doc(u.currentSessionId), { endTime: FieldValue.serverTimestamp() }, { merge: true });
    }
    return "blocked";
  });
  logger.info(`[DebtLimit] ${userId} connect: ${outcome}`);
  return outcome;
}

// Notice when an order takes the balance past 80% of the limit or past the limit itself.
async function notifyDebtThreshold(userRef, before, after, policy) {
  if (!policy.enabled) return;
  const warnAt = policy.limit * DEBT_WARNING_SHARE;
  const fmt = (n) => `${Math.round(n).toLocaleString("es-AR")}`;
  let notice = null;
  if (before <= policy.limit && after > policy.limit) {
    notice = {
      title: "⛔ Llegaste al tope de deuda",
      body: `Tu saldo es ${fmt(after)} y el tope es ${fmt(policy.limit)}. Terminá tus pedidos en curso; no vas a recibir pedidos nuevos hasta que pagues (Mi cuenta → Pagar).`
    };
  } else if (before < warnAt && after >= warnAt && after <= policy.limit) {
    notice = {
      title: "⚠️ Te estás acercando al tope de deuda",
      body: `Tu saldo es ${fmt(after)} de un tope de ${fmt(policy.limit)}. Pagá cuando puedas desde Mi cuenta para seguir recibiendo pedidos.`
    };
  }
  if (!notice) return;
  await userRef.collection("notifications").add({
    ...notice,
    type: "debt_limit",
    url: "#/delivery-panel",
    status: "unread",
    createdAt: FieldValue.serverTimestamp()
  }).catch((err) => logger.warn("[DebtLimit] notification failed:", err));
}

// A completed order: books its net fee and, when it's the Nth of the day, the daily fee.
// Idempotent: a retried trigger finds the order's entry already there and does nothing.
async function applyCompletedOrder({ orderId, order, eventId }) {
  const db = getFirestore();
  const driverId = order.driverId;
  if (!driverId) return null;
  const { amount: canonAmount, minOrders, debtPolicy } = await loadAccountSettings(db);
  const today = argentinaDateStr();
  const userRef = db.collection("users").doc(driverId);
  const canonEntryRef = db.collection("driver_ledger").doc(`canon_${driverId}_${today}`);
  const canonDocRef = db.collection("delivery_canon_payments").doc(`${driverId}_${today}`);
  const orderEntriesQ = db.collection("driver_ledger").where("orderId", "==", orderId).where("type", "==", "order");
  const orderRef = db.collection("orders").doc(orderId);

  const appFee = round2(order.appUsageFee || 0);
  const coupon = round2(order.couponDiscount || 0);
  // GoPoints the customer redeemed (in pesos): the driver collects that much less and GO absorbs it,
  // same as a coupon. Booked from 10-10-2026; earlier orders weren't credited.
  const points = round2(order.discountAmount || 0);
  const incentive = round2(order.driverIncentiveAmount || 0);
  const orderNum = order.orderId || orderId.slice(0, 6);

  const outcome = await db.runTransaction(async (tx) => {
    const [userSnap, previous, canonEntrySnap, canonDocSnap] = await Promise.all([
      tx.get(userRef), tx.get(orderEntriesQ), tx.get(canonEntryRef), tx.get(canonDocRef)
    ]);
    if (!userSnap.exists) return { status: "missing" };
    if (previous.docs.some((d) => !d.data().reversedById)) return { status: "already" };
    const u = userSnap.data();

    const sameDay = u.lastDeliveryDateStr === today;
    const todayCount = sameDay ? (u.completedOrdersToday || 0) + 1 : 1;

    const orderEntryId = previous.empty ? `order_${orderId}` : `order_${orderId}_${eventId}`;
    const entries = [{
      // A re-completed order (after being reversed) gets a fresh id tied to this event.
      id: orderEntryId,
      type: "order",
      amount: appFee - coupon - points - incentive,
      concept: `Pedido #${orderNum}`,
      orderId,
      orderNumber: orderNum,
      appFee,
      couponCredit: coupon,
      pointsCredit: points,
      incentiveCredit: incentive
    }];

    const exempt = u.isCanonExempt === true || u.role === "admin" || u.isAdmin === true;
    // lastCanonChargeDate === today: charged (or prepaid) today by the connect-time charge
    // this replaced, during the day it was deployed.
    const chargeCanon = !exempt && todayCount >= minOrders && !canonEntrySnap.exists && u.lastCanonChargeDate !== today;
    if (chargeCanon) {
      entries.push({
        id: canonEntryRef.id,
        type: "daily_fee",
        amount: canonAmount,
        concept: `Cuota diaria ${today.split("-").reverse().join("/")}`,
        canonDate: today
      });
    }

    const { balance, lastId, seq } = postEntries(tx, db, userRef, u, entries);
    tx.update(userRef, {
      ...ledgerUserFields(balance, lastId, seq),
      lastDeliveryAt: FieldValue.serverTimestamp(),
      lastDeliveryDateStr: today,
      completedOrdersToday: todayCount,
      completedOrdersCount: FieldValue.increment(1),
      recentCompletedTimes: FieldValue.arrayUnion(Date.now()),
      ...(chargeCanon ? { lastCanonChargeDate: today } : {})
    });
    // Tells reports this order is accounted in the ledger (older orders use the old estimate).
    // onOrderStatusChange ignores changes to this field.
    tx.update(orderRef, { ledgerEntryId: orderEntryId });

    if (chargeCanon) {
      // Old screens and reports still read these; the ledger entry above is what counts.
      const canon = canonDocSnap.exists ? canonDocSnap.data() : null;
      tx.set(canonDocRef, isCanonPaid(canon)
        ? { chargedToDebt: true, amount: canon.amount || canonAmount, ledgerChargeId: canonEntryRef.id }
        : {
          driverId,
          driverName: driverNameOf(u),
          dateStr: today,
          amount: canonAmount,
          status: "pending",
          settled: false,
          chargedToDebt: true,
          ledgerChargeId: canonEntryRef.id,
          createdAt: FieldValue.serverTimestamp()
        }, { merge: true });
      tx.set(db.collection("delivery_transactions").doc(), {
        driverId,
        type: "canon_charge",
        amount: canonAmount,
        description: `Cuota diaria (${today})`,
        ledgerEntryId: canonEntryRef.id,
        createdAt: FieldValue.serverTimestamp()
      });
    }
    return { status: "applied", todayCount, chargeCanon, balance, previousBalance: round2(u.deliveryDebt || 0) };
  });

  logger.info(`[Ledger] order ${orderId} → ${driverId}: ${JSON.stringify(outcome)}`);
  if (outcome.status === "applied") await notifyDebtThreshold(userRef, outcome.previousBalance, outcome.balance, debtPolicy);
  if (outcome.chargeCanon) {
    await userRef.collection("notifications").add({
      title: "🛵 Cuota diaria registrada",
      body: `Se sumaron $${canonAmount.toLocaleString("es-AR")} de la cuota de hoy a tu saldo${minOrders > 1 ? ` (completaste ${minOrders} pedidos)` : ""}. No se cobra de nuevo en el día.`,
      type: "canon_charge",
      url: "#/delivery-panel",
      status: "unread",
      createdAt: FieldValue.serverTimestamp()
    }).catch((err) => logger.warn("[Ledger] canon notification failed:", err));
  }
  return outcome;
}

// An order that stops being completed (cancelled after delivery, status fixed by the admin):
// its fee is reversed. The daily fee stays; the admin can reverse it by hand if it applies.
async function reverseCompletedOrder({ orderId, newStatus }) {
  const db = getFirestore();
  const activeQ = db.collection("driver_ledger").where("orderId", "==", orderId).where("type", "==", "order");
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(activeQ);
    const active = snap.docs.filter((d) => !d.data().reversedById);
    if (active.length === 0) return "nothing";
    // All entries of one order belong to one driver; reversals go against that driver's balance.
    const userRef = db.collection("users").doc(active[0].data().driverId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return "missing";
    const entries = active.map((d) => ({
      id: `rev_${d.id}`,
      type: "reversal",
      amount: -(d.data().amount || 0),
      concept: `Anulación: ${d.data().concept || "pedido"} (pasó a ${newStatus})`,
      reversesId: d.id,
      reversesType: "order",
      orderId
    }));
    const { balance, lastId, seq } = postEntries(tx, db, userRef, userSnap.data(), entries);
    tx.update(userRef, ledgerUserFields(balance, lastId, seq));
    active.forEach((d) => tx.update(d.ref, {
      reversedById: `rev_${d.id}`,
      reversedAt: FieldValue.serverTimestamp(),
      reversedBy: "sistema"
    }));
    return "reversed";
  });
  logger.info(`[Ledger] order ${orderId} left completed (${newStatus}): ${outcome}`);
  return outcome;
}

// ---------------------------------------------------------------- historia anterior

const HISTORY_BATCH = 400;

function toDate(t) {
  if (!t) return null;
  if (typeof t.toDate === "function") return t.toDate();
  if (t.seconds !== undefined) return new Date(t.seconds * 1000);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

// What the old system recorded for a driver, oldest first, as history entries: completed orders
// (fee − coupon − incentive, what it added to the debt), daily fees charged and payments. Only
// what predates the ledger (no ledgerEntryId): newer things already have their own entries.
async function legacyEventsOf(db, driverId) {
  const [ordersSnap, txSnap] = await Promise.all([
    db.collection("orders").where("driverId", "==", driverId).where("status", "==", "completed").get(),
    db.collection("delivery_transactions").where("driverId", "==", driverId).get()
  ]);
  const events = [];
  ordersSnap.docs.forEach((d) => {
    const o = d.data();
    if (o.ledgerEntryId) return;
    const appFee = round2(o.appUsageFee || 0);
    const coupon = round2(o.couponDiscount || 0);
    const incentive = round2(o.driverIncentiveAmount || 0);
    const amount = round2(appFee - coupon - incentive);
    const date = toDate(o.deliveredAt) || toDate(o.completedAt) || toDate(o.updatedAt) || toDate(o.createdAt);
    if (!date || (amount === 0 && appFee === 0)) return;
    const num = o.orderId || d.id.slice(0, 6);
    events.push({ historyKind: "order", amount, date, concept: `Pedido #${num}`, orderId: d.id, orderNumber: num, appFee, couponCredit: coupon, incentiveCredit: incentive });
  });
  txSnap.docs.forEach((d) => {
    const x = d.data();
    if (x.ledgerEntryId) return;
    const date = toDate(x.createdAt);
    if (!date) return;
    if (x.type === "canon_charge") {
      const day = (x.description || "").match(/d{4}-d{2}-d{2}/)?.[0] || argentinaDateStr(date);
      events.push({ historyKind: "daily_fee", amount: round2(Math.abs(Number(x.amount) || 0)), date, concept: `Cuota diaria ${day.split("-").reverse().join("/")}`, canonDate: day });
    } else if (x.type === "liquidation") {
      const amount = -round2(Math.abs(Number(x.amount) || 0));
      if (amount) events.push({ historyKind: "payment", amount, date, concept: "Pago", note: x.description || "" });
    }
  });
  return events.sort((a, b) => a.date - b.date);
}

// Brings a driver's old history into their statement, ending exactly at the balance they had when
// the ledger started. History entries (type "history") never move the balance again: they're the
// detail of the opening balance, which becomes $0 once they explain it. Whatever the old records
// don't account for (resets to $0, charges it never wrote down) goes in one "difference" line.
async function importLegacyHistory(driverId) {
  const db = getFirestore();
  const userRef = db.collection("users").doc(driverId);
  const openRef = db.collection("driver_ledger").doc(`open_${driverId}`);

  // 1. Make sure the account is open, so its starting balance is fixed from now on.
  const start = await db.runTransaction(async (tx) => {
    const [userSnap, openSnap] = await Promise.all([tx.get(userRef), tx.get(openRef)]);
    if (!userSnap.exists) return { status: "missing" };
    const u = userSnap.data();
    if (u.ledgerHistoryImported === true) return { status: "already" };
    if (u.ledgerOpened === true && openSnap.exists) return { status: "open", balance: round2(openSnap.data().balanceAfter || 0) };
    const balance = round2(u.deliveryDebt || 0);
    tx.set(openRef, {
      driverId, driverName: driverNameOf(u), dayStr: argentinaDateStr(), createdBy: "sistema",
      createdAt: FieldValue.serverTimestamp(), type: "opening", amount: balance, balanceAfter: balance, seq: 1,
      concept: "Saldo al empezar la cuenta corriente"
    });
    tx.update(userRef, { deliveryDebt: balance, ledgerOpened: true, ledgerSeq: 1, ledgerLastEntryId: openRef.id, ledgerUpdatedAt: FieldValue.serverTimestamp() });
    return { status: "open", balance };
  });
  if (start.status !== "open") return { driverId, status: start.status };

  const userData = (await userRef.get()).data();
  const events = await legacyEventsOf(db, driverId);
  const detailed = round2(events.reduce((sum, e) => sum + e.amount, 0));
  const difference = round2(start.balance - detailed);
  if (Math.abs(difference) >= 1) {
    const last = events.length ? events[events.length - 1].date : new Date();
    events.push({
      historyKind: "difference",
      amount: difference,
      date: new Date(Math.max(last.getTime() + 1000, Date.now() - 60000)),
      concept: "Diferencia con el saldo registrado",
      note: "Lo que el sistema anterior no dejó detallado (ajustes, reseteos o cargos sin registro)"
    });
  }

  // 2. The history lines, numbered below the opening entry (seq ≤ 0) so they list under it.
  let balance = 0;
  const docs = events.map((e, i) => {
    balance = round2(balance + e.amount);
    const { date, ...fields } = e;
    return [db.collection("driver_ledger").doc(`hist_${driverId}_${i}`), {
      ...fields,
      driverId,
      driverName: driverNameOf(userData),
      type: "history",
      balanceAfter: balance,
      seq: i - events.length + 1,
      dayStr: argentinaDateStr(date),
      createdBy: "sistema",
      createdAt: Timestamp.fromDate(date)
    }];
  });
  for (let i = 0; i < docs.length; i += HISTORY_BATCH) {
    const batch = db.batch();
    docs.slice(i, i + HISTORY_BATCH).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
  }

  // 3. The opening balance is now explained line by line: it stops adding to the sum.
  await db.runTransaction(async (tx) => {
    const [userSnap, openSnap] = await Promise.all([tx.get(userRef), tx.get(openRef)]);
    if (userSnap.data()?.ledgerHistoryImported === true || !openSnap.exists) return;
    if (docs.length) {
      tx.update(openRef, { amount: 0, concept: "Inicio de la cuenta corriente", note: "El saldo viene del detalle del sistema anterior (abajo)" });
    }
    tx.update(userRef, { ledgerHistoryImported: true });
  });
  return { driverId, status: "imported", lines: docs.length, difference };
}

module.exports = { importLegacyHistory, applyCompletedOrder, reverseCompletedOrder, blockIfOverDebtLimit, loadDebtPolicy, isOverDebtLimit, argentinaDateStr, round2 };
