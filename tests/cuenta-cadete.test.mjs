// Cuenta corriente del cadete: pedidos y cuota diaria (Cloud Function real) + acciones del admin.
//
//   FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --only functions,firestore --project demo-godelivery "node tests/cuenta-cadete.test.mjs"
//
// Completa pedidos de verdad para que corra onOrderStatusChange (functions/ledger.js), y usa las
// utilidades del admin (src/utils/driver-ledger.js, driver-settlement.js, canon.js) con las
// reglas reales. Al final revisa que en cada cadete la suma de sus renglones sea su saldo.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { argentinaDateStr, toggleCanonPaidToday } from '../src/utils/canon.js';
import { registerDriverPayout, adjustDriverBalance, reverseLedgerEntry } from '../src/utils/driver-ledger.js';
import { settleDriverDebt, voidDriverSettlement } from '../src/utils/driver-settlement.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({
  projectId: process.env.GCLOUD_PROJECT || 'demo-godelivery',
  firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8') },
});

const today = argentinaDateStr();
const jefe = env.authenticatedContext('jefe', { email: 'kioscopaulos7@gmail.com' }).firestore();
let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label); }
  else { fail++; failures.push(label); console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}
async function throws(fn) { try { await fn(); return false; } catch { return true; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function asAdmin(fn) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); });
  return out;
}
const userOf = (uid) => asAdmin(async (db) => (await getDoc(doc(db, 'users', uid))).data());
const debtOf = async (uid) => (await userOf(uid)).deliveryDebt;
const docData = (p) => asAdmin(async (db) => { const x = await getDoc(doc(db, p)); return x.exists() ? x.data() : null; });
const entriesOf = (uid) => asAdmin(async (db) => (await getDocs(query(collection(db, 'driver_ledger'), where('driverId', '==', uid)))).docs.map((d) => ({ id: d.id, ...d.data() })));
const canonCharges = async (uid) => (await entriesOf(uid)).filter((e) => e.type === 'daily_fee').length;

// The trigger runs asynchronously: poll until the expected state or give up.
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(400); }
  return false;
}
let orderSeq = 0;
// Creates an order on its way and completes it, so the real trigger books it.
async function completeOrder(driverId, { fee = 0, coupon = 0, points = 0, incentive = 0 } = {}) {
  const id = `o${++orderSeq}_${driverId}`;
  await asAdmin(async (db) => {
    await setDoc(doc(db, 'orders', id), { orderId: 1000 + orderSeq, driverId, status: 'delivering', appUsageFee: fee, couponDiscount: coupon, discountAmount: points, driverIncentiveAmount: incentive });
  });
  await asAdmin((db) => updateDoc(doc(db, 'orders', id), { status: 'completed' }));
  return id;
}
const setOnline = (uid, isOnline) => asAdmin((db) => updateDoc(doc(db, 'users', uid), { isOnline }));
const setOrderStatus = (id, status) => asAdmin((db) => updateDoc(doc(db, 'orders', id), { status }));

await env.clearFirestore();
await asAdmin(async (db) => {
  await setDoc(doc(db, 'settings/global'), { canonAmount: 1500, canonMinOrders: 2 });
  await setDoc(doc(db, 'users/jefe'), { role: 'admin', isAdmin: true });
  const driver = (extra) => ({ role: 'delivery', isDelivery: true, deliveryStatus: 'approved', isOnline: true, deliveryDebt: 1000, displayName: 'Cadete', ...extra });
  await setDoc(doc(db, 'users/normal'), driver());
  await setDoc(doc(db, 'users/exento'), driver({ isCanonExempt: true }));
  await setDoc(doc(db, 'users/legacy'), driver({ lastCanonChargeDate: today }));
  await setDoc(doc(db, 'users/cupones'), driver({ deliveryDebt: 0 }));
  await setDoc(doc(db, 'users/puntos'), driver({ deliveryDebt: 0, isCanonExempt: true }));
  await setDoc(doc(db, 'users/prepago'), driver());
  await setDoc(doc(db, 'users/liq'), driver({ deliveryDebt: 5000 }));
});

console.log('=========== PEDIDOS Y CUOTA DIARIA (servidor) ===========');

const o1 = await completeOrder('normal', { fee: 500, coupon: 100 });
check('pedido completado: suma tarifa − cupón al saldo',
  await waitFor(async () => (await debtOf('normal')) === 1400), String(await debtOf('normal')));
let normal = await entriesOf('normal');
const opening = normal.find((e) => e.type === 'opening');
check('el primer movimiento abre el saldo inicial con la deuda anterior', opening?.amount === 1000 && opening?.balanceAfter === 1000, JSON.stringify(opening));
const e1 = normal.find((e) => e.id === `order_${o1}`);
check('renglón del pedido con su desglose y saldo', e1?.amount === 400 && e1?.appFee === 500 && e1?.couponCredit === 100 && e1?.balanceAfter === 1400, JSON.stringify(e1));
check('con 1 pedido (mínimo 2) todavía NO cobra la cuota', (await canonCharges('normal')) === 0);

const o2 = await completeOrder('normal', { fee: 300 });
check('el pedido N° 2 del día suma su tarifa y la cuota',
  await waitFor(async () => (await debtOf('normal')) === 3200), String(await debtOf('normal')));
check('un solo renglón de cuota', (await canonCharges('normal')) === 1);
const canonDoc = await docData(`delivery_canon_payments/normal_${today}`);
check('la cuota queda pendiente para el chip "Cuota Hoy"', canonDoc?.status === 'pending' && canonDoc?.chargedToDebt === true, JSON.stringify(canonDoc));
check('marca lastCanonChargeDate con el día argentino', (await userOf('normal')).lastCanonChargeDate === today);

await setOrderStatus(o2, 'cancelled');
check('un pedido completado que se cancela devuelve su tarifa',
  await waitFor(async () => (await debtOf('normal')) === 2900), String(await debtOf('normal')));
check('...con un renglón de anulación, y el original queda marcado',
  (await entriesOf('normal')).some((e) => e.id === `rev_order_${o2}` && e.amount === -300) &&
  (await docData(`driver_ledger/order_${o2}`))?.reversedById === `rev_order_${o2}`);

await setOrderStatus(o2, 'completed');
check('si se vuelve a completar, se cobra de nuevo',
  await waitFor(async () => (await debtOf('normal')) === 3200), String(await debtOf('normal')));
await completeOrder('normal', { fee: 200 });
check('pedidos siguientes del día: solo su tarifa, la cuota no se repite',
  await waitFor(async () => (await debtOf('normal')) === 3400) && (await canonCharges('normal')) === 1, String(await debtOf('normal')));

await completeOrder('exento', { fee: 100 });
await completeOrder('exento', { fee: 100 });
check('cadete exento: tarifas sí, cuota no',
  await waitFor(async () => (await debtOf('exento')) === 1200) && (await canonCharges('exento')) === 0, String(await debtOf('exento')));

await completeOrder('legacy');
await completeOrder('legacy');
await waitFor(async () => (await entriesOf('legacy')).filter((e) => e.type === 'order').length === 2);
check('ya cobrado hoy por el sistema anterior: no cobra de nuevo', (await debtOf('legacy')) === 1000 && (await canonCharges('legacy')) === 0);

await completeOrder('cupones', { fee: 100, coupon: 600 });
check('cupón mayor que la tarifa: la app le queda debiendo al cadete (saldo negativo)',
  await waitFor(async () => (await debtOf('cupones')) === -500), String(await debtOf('cupones')));

// GoPoints: el cadete cobra menos y GO lo absorbe igual que un cupón
const op = await completeOrder('puntos', { fee: 300, coupon: 100, points: 800 });
check('GoPoints: se descuentan de la tarifa como el cupón (300 − 100 − 800)',
  await waitFor(async () => (await debtOf('puntos')) === -600), String(await debtOf('puntos')));
const ep = (await entriesOf('puntos')).find((e) => e.id === `order_${op}`);
check('...y el renglón guarda el crédito de GoPoints aparte', ep?.pointsCredit === 800 && ep?.couponCredit === 100 && ep?.amount === -600, JSON.stringify(ep));

console.log('=========== COBROS, PAGOS AL CADETE Y AJUSTES (admin) ===========');

const settle = (driverId, extra) => settleDriverDebt({ db: jefe, driverId, method: 'efectivo', adminEmail: 'admin@test', ...extra });

const { settlementId: partialId, entryId: partialEntry } = await settle('liq', { currentDebt: 5000, amount: 2000 });
check('cobro parcial baja el saldo', (await debtOf('liq')) === 3000);
const legacySet = await docData(`delivery_debt_settlements/${partialId}`);
check('...y deja la liquidación y el movimiento que leen las pantallas actuales',
  legacySet?.ledgerEntryId === partialEntry && !!(await docData(`delivery_transactions/${legacySet.transactionId}`)));
check('...con su renglón de pago', (await docData(`driver_ledger/${partialEntry}`))?.amount === -2000);

const { settlementId: overId, bookkeeping } = await settle('liq', { currentDebt: 3000, amount: 3500 });
await bookkeeping;
check('pagar de más deja saldo a favor (no rechaza el cobro)', (await debtOf('liq')) === -500);

await voidDriverSettlement({ db: jefe, settlementId: overId, adminEmail: 'admin@test' });
const overSet = await docData(`delivery_debt_settlements/${overId}`);
check('anular un cobro devuelve el saldo', (await debtOf('liq')) === 3000);
check('...con un renglón inverso: el original queda y se marca anulado',
  (await docData(`driver_ledger/${overSet.ledgerEntryId}`))?.reversedById === `rev_${overSet.ledgerEntryId}`);
const revDoc = await docData(`driver_ledger/rev_${overSet.ledgerEntryId}`);
check('...y la anulación dice qué deshizo y por qué medio (lo usa la caja)', revDoc?.reversesType === 'payment' && revDoc?.method === 'efectivo', JSON.stringify(revDoc));
check('...y el movimiento viejo se borra (los reportes no lo cuentan)', overSet?.voided === true && (await docData(`delivery_transactions/${overSet.transactionId}`)) === null);
check('no se puede anular dos veces', await throws(() => voidDriverSettlement({ db: jefe, settlementId: overId, adminEmail: 'admin@test' })) && (await debtOf('liq')) === 3000);

await asAdmin((db) => setDoc(doc(db, 'delivery_debt_settlements/viejo'), { driverId: 'liq', driverName: 'Liq', amount: 700, debtCleared: 700, method: 'efectivo' }));
await voidDriverSettlement({ db: jefe, settlementId: 'viejo', adminEmail: 'admin@test' });
check('anular un cobro anterior a la cuenta corriente también deja renglón', (await debtOf('liq')) === 3700 && !!(await docData('driver_ledger/rev_legacy_viejo')));

await asAdmin((db) => setDoc(doc(db, 'delivery_settlement_proofs/pr1'), { driverId: 'liq', amount: 1000, status: 'pending' }));
await settle('liq', { amount: 800, method: 'transferencia', proofId: 'pr1' });
const pr = await docData('delivery_settlement_proofs/pr1');
check('comprobante aprobado por el monto que llegó', pr?.status === 'approved' && pr?.approvedAmount === 800 && (await debtOf('liq')) === 2900);
check('el mismo comprobante no se puede cobrar dos veces',
  await throws(() => settle('liq', { amount: 800, method: 'transferencia', proofId: 'pr1' })) && (await debtOf('liq')) === 2900);

const reqId = 'form123';
await settle('liq', { amount: 100, requestId: reqId });
check('doble toque en el mismo formulario cobra una sola vez',
  await throws(() => settle('liq', { amount: 100, requestId: reqId })) && (await debtOf('liq')) === 2800);

await settle('cupones', { amount: 200 });
check('se le puede cobrar a un cadete con saldo a favor', (await debtOf('cupones')) === -700);
await registerDriverPayout({ db: jefe, driverId: 'cupones', amount: 700, method: 'transferencia', note: 'Cupones de la semana', adminEmail: 'admin@test' });
check('pagarle al cadete lo que tiene a favor lo deja en $0', (await debtOf('cupones')) === 0);
const payout = (await entriesOf('cupones')).find((e) => e.type === 'payout');
check('...y queda registrado con método y nota', payout?.amount === 700 && payout?.method === 'transferencia' && payout?.note === 'Cupones de la semana');

check('un ajuste sin motivo se rechaza', await throws(() => adjustDriverBalance({ db: jefe, driverId: 'liq', amount: 300, reason: ' ', adminEmail: 'admin@test' })));
await adjustDriverBalance({ db: jefe, driverId: 'liq', amount: -300, reason: 'Pedido con problema, se le perdona la tarifa', adminEmail: 'admin@test' });
check('un ajuste con motivo mueve el saldo', (await debtOf('liq')) === 2500);

const canonEntry = `canon_normal_${today}`;
await reverseLedgerEntry({ db: jefe, entryId: canonEntry, reason: 'Cuota perdonada', adminEmail: 'admin@test' });
check('el admin puede anular una cuota cobrada por el sistema', (await debtOf('normal')) === 1900);
check('...pero no dos veces', await throws(() => reverseLedgerEntry({ db: jefe, entryId: canonEntry, adminEmail: 'admin@test' })));

console.log('=========== BOTÓN "CUOTA HOY" ===========');

const toggle = (driverId) => toggleCanonPaidToday({ db: jefe, driverId, canonAmount: 1500, adminEmail: 'admin@test' });
check('pagada antes de cobrarse: queda a favor', (await toggle('prepago')) === 'prepaid' && (await debtOf('prepago')) === -500);
check('...y el chip la muestra pagada', (await docData(`delivery_canon_payments/prepago_${today}`))?.status === 'paid');
await completeOrder('prepago');
await completeOrder('prepago');
check('al llegar a los pedidos se cobra y compensa el pago',
  await waitFor(async () => (await debtOf('prepago')) === 1000), String(await debtOf('prepago')));
check('...sin pisar el chip de pagada', (await docData(`delivery_canon_payments/prepago_${today}`))?.status === 'paid');
check('deshacer el pago devuelve la cuota a la deuda', (await toggle('prepago')) === 'undone' && (await debtOf('prepago')) === 2500);
check('...y la cuota vuelve a pendiente', (await docData(`delivery_canon_payments/prepago_${today}`))?.status === 'pending');
check('con la cuota ya cobrada, el botón la descuenta', (await toggle('prepago')) === 'paid' && (await debtOf('prepago')) === 1000);

await settle('exento', { amount: 1200 });
await asAdmin((db) => setDoc(doc(db, `delivery_canon_payments/exento_${today}`), { driverId: 'exento', amount: 1500, status: 'settled', settled: true }));
check('NO deshace una cuota pagada dentro de una liquidación', await throws(() => toggle('exento')));

// Undoing a daily-fee payment from the statement (any day, not only today's button).
const canonPay = (await entriesOf('prepago')).find((e) => e.type === 'payment' && !e.reversedById);
await voidDriverSettlement({ db: jefe, settlementId: canonPay.settlementId, adminEmail: 'admin@test' });
check('un pago de cuota también se anula desde el estado de cuenta', (await debtOf('prepago')) === 2500);
check('...y el chip de la cuota vuelve a pendiente', (await docData(`delivery_canon_payments/prepago_${today}`))?.status === 'pending');

console.log('=========== TOPE DE DEUDA (servidor) ===========');

const notifTitles = (uid) => asAdmin(async (db) => (await getDocs(collection(db, 'users', uid, 'notifications'))).docs.map((d) => d.data().title || ''));
await asAdmin(async (db) => {
  await setDoc(doc(db, 'settings/global'), { debtLimitEnabled: true, maxDebtLimit: 5000 }, { merge: true });
  // Only the drivers of this section online, so dispatch has a known field.
  for (const uid of ['normal', 'exento', 'legacy', 'cupones', 'prepago', 'liq']) await updateDoc(doc(db, 'users', uid), { isOnline: false });
  const driver = (extra) => ({ role: 'delivery', isDelivery: true, deliveryStatus: 'approved', displayName: 'Tope', ...extra });
  await setDoc(doc(db, 'users/tope_alto'), driver({ isOnline: false, deliveryDebt: 7000 }));
  await setDoc(doc(db, 'users/tope_bajo'), driver({ isOnline: false, deliveryDebt: 1000 }));
  // Created already online (no connect trigger), to see that dispatch skips it.
  await setDoc(doc(db, 'users/tope_online'), driver({ isOnline: true, deliveryDebt: 9000 }));
  await setDoc(doc(db, 'users/tope_aviso'), driver({ isOnline: false, deliveryDebt: 3500 }));
});

await setOnline('tope_alto', true);
check('conectarse por encima del tope: el servidor lo vuelve a desconectar',
  await waitFor(async () => { const u = await userOf('tope_alto'); return u.isOnline === false && u.disconnectedReason === 'debt_limit'; }));
check('...y le avisa por qué', await waitFor(async () => (await notifTitles('tope_alto')).some((t) => t.includes('Tope de deuda'))));

await setOnline('tope_bajo', true);
await sleep(4000);
check('por debajo del tope se conecta normal', (await userOf('tope_bajo')).isOnline === true);

await asAdmin((db) => setDoc(doc(db, 'orders/fav_tope1'), { isFavor: true, favorType: 'mandado', status: 'pending', total: 1000, createdAt: new Date() }));
await waitFor(async () => !!(await docData('orders/fav_tope1'))?.queueTargetDriverId, 25000);
check('el despacho saltea al que pasó el tope', (await docData('orders/fav_tope1'))?.queueTargetDriverId === 'tope_bajo', (await docData('orders/fav_tope1'))?.queueTargetDriverId);

await asAdmin((db) => setDoc(doc(db, 'orders/fav_tope2'), { isFavor: true, favorType: 'mandado', status: 'pending', total: 1000, directDriverUid: 'tope_online', createdAt: new Date() }));
await waitFor(async () => !!(await docData('orders/fav_tope2'))?.queueTargetDriverId, 25000);
check('...aunque el cliente lo haya elegido directo', (await docData('orders/fav_tope2'))?.queueTargetDriverId === 'tope_bajo', (await docData('orders/fav_tope2'))?.queueTargetDriverId);

await completeOrder('tope_aviso', { fee: 600 });
check('al pasar el 80% del tope le llega un aviso',
  await waitFor(async () => (await notifTitles('tope_aviso')).some((t) => t.includes('acercando'))));
const avisoOrder = await completeOrder('tope_aviso', { fee: 1000 });
check('al pasar el tope le llega el aviso de tope',
  await waitFor(async () => (await notifTitles('tope_aviso')).some((t) => t.includes('Llegaste al tope'))));
check('el pedido queda marcado como asentado en la cuenta (lo usan los reportes)',
  (await docData(`orders/${avisoOrder}`))?.ledgerEntryId === `order_${avisoOrder}`);
const canonTx = await asAdmin(async (db) => (await getDocs(query(collection(db, 'delivery_transactions'), where('driverId', '==', 'tope_aviso')))).docs.map((d) => d.data()).find((t) => t.type === 'canon_charge'));
check('el movimiento viejo de la cuota apunta a su renglón (los reportes no lo cuentan dos veces)', canonTx?.ledgerEntryId === `canon_tope_aviso_${today}`, JSON.stringify(canonTx));

console.log('=========== HISTORIA DEL SISTEMA ANTERIOR ===========');

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
await asAdmin(async (db) => {
  await setDoc(doc(db, 'users/viejo'), { role: 'delivery', isDelivery: true, displayName: 'Viejo', isOnline: false, deliveryDebt: 3000 });
  // What the old system left: completed orders, a daily fee and a payment, none with ledgerEntryId.
  await setDoc(doc(db, 'orders/v1'), { orderId: 9001, driverId: 'viejo', status: 'completed', appUsageFee: 500, deliveredAt: daysAgo(5) });
  await setDoc(doc(db, 'orders/v2'), { orderId: 9002, driverId: 'viejo', status: 'completed', appUsageFee: 800, couponDiscount: 300, deliveredAt: daysAgo(4) });
  await setDoc(doc(db, 'orders/v3'), { orderId: 9003, driverId: 'viejo', status: 'cancelled', appUsageFee: 999, deliveredAt: daysAgo(4) });
  await setDoc(doc(db, 'delivery_transactions/vt1'), { driverId: 'viejo', type: 'canon_charge', amount: 1500, description: 'Cuota diaria (2026-09-20)', createdAt: daysAgo(3) });
  await setDoc(doc(db, 'delivery_transactions/vt2'), { driverId: 'viejo', type: 'liquidation', amount: -1000, description: 'Liquidación de deuda (Efectivo)', createdAt: daysAgo(2) });
  await setDoc(doc(db, 'system_jobs/import1'), { type: 'import_driver_history', createdAt: new Date() });
});
check('el trabajo de importación termina', await waitFor(async () => (await docData('system_jobs/import1'))?.status === 'done', 60000), JSON.stringify(await docData('system_jobs/import1')));
const viejo = await entriesOf('viejo');
const hist = viejo.filter((e) => e.type === 'history').sort((a, b) => a.seq - b.seq);
check('trae pedidos, cuota y pago con su fecha (sin el cancelado)',
  hist.map((e) => e.historyKind).join(',') === 'order,order,daily_fee,payment,difference', hist.map((e) => e.historyKind).join(','));
check('...con el desglose de cada pedido', hist[1]?.amount === 500 && hist[1]?.couponCredit === 300);
check('lo no registrado queda en una línea de diferencia', hist[4]?.amount === 1500 && hist[4]?.balanceAfter === 3000, JSON.stringify(hist[4]));
const vOpen = viejo.find((e) => e.type === 'opening');
check('el saldo inicial pasa a $0 porque ya lo explica el detalle', vOpen?.amount === 0 && vOpen?.balanceAfter === 3000);
check('no cambia la deuda del repartidor', (await debtOf('viejo')) === 3000 && (await userOf('viejo')).ledgerHistoryImported === true);
const normalHist = (await entriesOf('normal')).filter((e) => e.type === 'history');
check('a quien ya tenía cuenta también le explica su saldo inicial', normalHist.length === 1 && normalHist[0].historyKind === 'difference' && normalHist[0].amount === 1000);
await asAdmin((db) => setDoc(doc(db, 'system_jobs/import2'), { type: 'import_driver_history', createdAt: new Date() }));
await waitFor(async () => (await docData('system_jobs/import2'))?.status === 'done', 60000);
check('correrlo de nuevo no duplica nada', (await entriesOf('viejo')).length === viejo.length && (await docData('system_jobs/import2'))?.imported === 0);
check('el admin no puede anular una línea del sistema anterior', await throws(() => reverseLedgerEntry({ db: jefe, entryId: hist[0].id, adminEmail: 'admin@test' })));

console.log('=========== CONSISTENCIA DEL LIBRO ===========');

for (const uid of ['normal', 'exento', 'legacy', 'cupones', 'puntos', 'prepago', 'liq', 'tope_aviso', 'viejo']) {
  const entries = await entriesOf(uid);
  const sum = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const u = await userOf(uid);
  const last = entries.find((e) => e.id === u.ledgerLastEntryId);
  check(`${uid}: la suma de los renglones es el saldo (${u.deliveryDebt})`, sum === u.deliveryDebt && last?.balanceAfter === u.deliveryDebt, `suma ${sum}, último ${last?.balanceAfter}`);
  // Read in line order (imported history numbered ≤ 0, then 1, 2, …), every entry's balance is the
  // previous one plus its amount.
  const bySeq = [...entries].sort((a, b) => a.seq - b.seq);
  const chainOk = bySeq.every((e, i) => (i === 0 || e.seq === bySeq[i - 1].seq + 1) &&
    Math.abs(e.balanceAfter - ((i === 0 ? 0 : bySeq[i - 1].balanceAfter) + e.amount)) < 0.005);
  check(`${uid}: los renglones van numerados seguidos y cada saldo sale del anterior`, chainOk && u.ledgerSeq === bySeq[bySeq.length - 1].seq);
}

console.log('');
console.log('================================================');
console.log('  PASARON: ' + pass + '   |   FALLARON: ' + fail);
failures.forEach((f) => console.log('   - ' + f));
console.log('================================================');
await env.cleanup();
process.exit(fail > 0 ? 1 : 0);
