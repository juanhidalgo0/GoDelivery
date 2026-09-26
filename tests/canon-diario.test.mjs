// Cuota diaria: cobro automático al conectarse (Cloud Function) y botón "Cuota Hoy" del admin.
//
//   npx firebase-tools emulators:exec --only functions,firestore --project demo-godelivery "node tests/canon-diario.test.mjs"
//
// Corre la función real chargeDailyCanonOnConnect en el emulador y toggleCanonPaidToday
// (src/utils/canon.js) con las reglas reales.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { argentinaDateStr, toggleCanonPaidToday } from '../src/utils/canon.js';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function asAdmin(fn) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); });
  return out;
}
const userOf = (uid) => asAdmin(async (db) => (await getDoc(doc(db, 'users', uid))).data());
const canonOf = (uid) => asAdmin(async (db) => { const s = await getDoc(doc(db, 'delivery_canon_payments', `${uid}_${today}`)); return s.exists() ? s.data() : null; });
const chargesOf = (uid) => asAdmin(async (db) => (await getDocs(query(collection(db, 'delivery_transactions'), where('driverId', '==', uid)))).docs.map((d) => d.data()).filter((t) => t.type === 'canon_charge').length);
const setOnline = (uid, isOnline) => asAdmin((db) => updateDoc(doc(db, 'users', uid), { isOnline }));

// The trigger runs asynchronously: poll until the expected state or give up.
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(400); }
  return false;
}

await env.clearFirestore();
await asAdmin(async (db) => {
  await setDoc(doc(db, 'settings/global'), { canonAmount: 1500 });
  await setDoc(doc(db, 'users/jefe'), { role: 'admin', isAdmin: true });
  const driver = (extra) => ({ role: 'delivery', isDelivery: true, deliveryStatus: 'approved', isOnline: false, deliveryDebt: 1000, displayName: 'Cadete', ...extra });
  await setDoc(doc(db, 'users/normal'), driver());
  await setDoc(doc(db, 'users/exento'), driver({ isCanonExempt: true }));
  await setDoc(doc(db, 'users/prepago'), driver());
  await setDoc(doc(db, 'users/legacy'), driver({ lastCanonChargeDate: today }));
  await setDoc(doc(db, 'users/postulado'), driver({ role: 'user', isDelivery: true }));
  await setDoc(doc(db, 'users/cliente'), { role: 'user', isOnline: false, deliveryDebt: 0 });
  await setDoc(doc(db, 'users/doble'), driver());
  await setDoc(doc(db, 'users/revocado'), driver());
  await setDoc(doc(db, 'delivery_canon_payments', `revocado_${today}`), { driverId: 'revocado', amount: 1500, status: 'revoked', settled: false });
});

console.log('=========== COBRO AUTOMATICO AL CONECTARSE ===========');

await setOnline('normal', true);
check('primera conexion del dia: suma la cuota configurada',
  await waitFor(async () => (await userOf('normal')).deliveryDebt === 2500));
const n = await userOf('normal');
check('marca lastCanonChargeDate con el dia argentino', n.lastCanonChargeDate === today, n.lastCanonChargeDate);
const c = await canonOf('normal');
check('crea la cuota del dia pendiente', c?.status === 'pending' && c?.settled === false && c?.amount === 1500, JSON.stringify(c));
check('registra un movimiento de cobro', (await chargesOf('normal')) === 1);

await setOnline('normal', false);
await setOnline('normal', true);
await sleep(4000);
check('reconectarse el mismo dia NO vuelve a cobrar', (await userOf('normal')).deliveryDebt === 2500);
check('...ni duplica el movimiento', (await chargesOf('normal')) === 1);

// Dos cambios casi simultáneos (dos teléfonos / trigger repetido).
await setOnline('doble', true);
await setOnline('doble', false);
await setOnline('doble', true);
await waitFor(async () => (await userOf('doble')).deliveryDebt !== 1000);
await sleep(4000);
check('conexiones en rafaga cobran una sola vez', (await userOf('doble')).deliveryDebt === 2500, String((await userOf('doble')).deliveryDebt));

await setOnline('postulado', true);
check('cadete aprobado por solicitud (rol user + isDelivery) tambien paga',
  await waitFor(async () => (await userOf('postulado')).deliveryDebt === 2500));

await setOnline('revocado', true);
check('una cuota anulada se vuelve a cobrar al conectarse',
  await waitFor(async () => (await userOf('revocado')).deliveryDebt === 2500));

await setOnline('exento', true);
await setOnline('legacy', true);
await setOnline('cliente', true);
await sleep(5000);
check('cadete exento NO paga', (await userOf('exento')).deliveryDebt === 1000);
check('cadete ya cobrado hoy por la app vieja NO paga de nuevo', (await userOf('legacy')).deliveryDebt === 1000);
check('un cliente que no es cadete NO paga', (await userOf('cliente')).deliveryDebt === 0);

console.log('=========== BOTON "CUOTA HOY" DEL ADMIN ===========');

const toggle = (driverId) => toggleCanonPaidToday({ db: jefe, driverId, canonAmount: 1500, adminEmail: 'admin@test' });

// Ya cobrada → el admin recibe el efectivo → baja la deuda.
check('cuota ya cobrada: el admin la marca pagada', (await toggle('normal')) === 'paid');
check('...y se descuenta de la deuda', (await userOf('normal')).deliveryDebt === 1000);
check('...y queda pagada', (await canonOf('normal'))?.status === 'paid');
check('deshacer devuelve la cuota a la deuda', (await toggle('normal')) === 'undone' && (await userOf('normal')).deliveryDebt === 2500);
check('...y vuelve a quedar pendiente', (await canonOf('normal'))?.status === 'pending');

// Pagada antes de conectarse → no se cobra al conectarse.
check('pago por adelantado (sin conectarse)', (await toggle('prepago')) === 'prepaid');
await setOnline('prepago', true);
await sleep(5000);
check('...al conectarse NO se le suma a la deuda', (await userOf('prepago')).deliveryDebt === 1000);
check('deshacer un prepago con el cadete ya conectado lo cobra en el momento',
  (await toggle('prepago')) === 'undone' && (await userOf('prepago')).deliveryDebt === 2500);

// Pagada dentro de una liquidación: el botón no la toca.
await asAdmin((db) => updateDoc(doc(db, 'delivery_canon_payments', `postulado_${today}`), { settled: true, status: 'settled' }));
let blocked = false;
try { await toggle('postulado'); } catch { blocked = true; }
check('NO deshace una cuota pagada en una liquidacion', blocked && (await userOf('postulado')).deliveryDebt === 2500);

console.log('=========== LIQUIDAR Y ANULAR ===========');

const { settleDriverDebt, voidDriverSettlement } = await import('../src/utils/driver-settlement.js');
await asAdmin(async (db) => {
  await setDoc(doc(db, 'users/liq'), { role: 'delivery', isDelivery: true, deliveryDebt: 5000, displayName: 'Liq' });
  await setDoc(doc(db, 'orders/lo1'), { driverId: 'liq', status: 'completed', appUsageFee: 500 });
  await setDoc(doc(db, 'orders/lo2'), { driverId: 'liq', status: 'completed', appUsageFee: 500 });
  await setDoc(doc(db, 'delivery_canon_payments/liq_2026-09-01'), { driverId: 'liq', amount: 1500, status: 'pending', settled: false });
  await setDoc(doc(db, 'delivery_canon_payments/liq_2026-09-02'), { driverId: 'liq', amount: 1500, status: 'revoked', settled: false });
  await setDoc(doc(db, 'delivery_settlement_proofs/pr1'), { driverId: 'liq', amount: 1000, status: 'pending' });
});
const settle = (extra) => settleDriverDebt({ db: jefe, driverId: 'liq', driverName: 'Liq', method: 'efectivo', adminEmail: 'admin@test', ...extra });
const orderSettled = (id) => asAdmin(async (db) => (await getDoc(doc(db, 'orders', id))).data().isSettledDriver === true);
const docData = (p) => asAdmin(async (db) => { const x = await getDoc(doc(db, p)); return x.exists() ? x.data() : null; });

await settle({ currentDebt: 5000, amount: 2000 });
check('pago parcial baja la deuda', (await userOf('liq')).deliveryDebt === 3000);
check('pago parcial NO marca pedidos como liquidados', !(await orderSettled('lo1')));

const { settlementId: fullId, bookkeeping } = await settle({ currentDebt: 3000, amount: 3000 });
await bookkeeping; // marking orders/fees runs after the payment resolves
check('pago total deja la deuda en 0', (await userOf('liq')).deliveryDebt === 0);
check('pago total marca los pedidos', (await orderSettled('lo1')) && (await orderSettled('lo2')));
check('pago total marca la cuota pendiente', (await docData('delivery_canon_payments/liq_2026-09-01'))?.status === 'settled');
check('pago total NO toca la cuota anulada', (await docData('delivery_canon_payments/liq_2026-09-02'))?.status === 'revoked');
const fullTx = (await docData(`delivery_debt_settlements/${fullId}`)).transactionId;

await voidDriverSettlement({ db: jefe, settlementId: fullId, adminEmail: 'admin@test' });
check('anular devuelve la deuda', (await userOf('liq')).deliveryDebt === 3000);
check('anular desmarca los pedidos', !(await orderSettled('lo1')) && !(await orderSettled('lo2')));
check('anular deja la cuota pendiente otra vez', (await docData('delivery_canon_payments/liq_2026-09-01'))?.status === 'pending');
check('anular borra el movimiento (los reportes no lo cuentan)', (await docData(`delivery_transactions/${fullTx}`)) === null);
check('la liquidacion queda marcada como anulada', (await docData(`delivery_debt_settlements/${fullId}`))?.voided === true);
let twice = false;
try { await voidDriverSettlement({ db: jefe, settlementId: fullId, adminEmail: 'admin@test' }); } catch { twice = true; }
check('no se puede anular dos veces', twice && (await userOf('liq')).deliveryDebt === 3000);

const { settlementId: proofSet } = await settle({ currentDebt: 3000, amount: 800, method: 'transferencia', proofId: 'pr1' });
const pr = await docData('delivery_settlement_proofs/pr1');
check('comprobante aprobado por el monto que llego', pr?.status === 'approved' && pr?.approvedAmount === 800 && (await userOf('liq')).deliveryDebt === 2200);
await voidDriverSettlement({ db: jefe, settlementId: proofSet, adminEmail: 'admin@test' });
check('anular la aprobacion devuelve el comprobante a pendientes', (await docData('delivery_settlement_proofs/pr1'))?.status === 'pending' && (await userOf('liq')).deliveryDebt === 3000);

console.log('');
console.log('================================================');
console.log('  PASARON: ' + pass + '   |   FALLARON: ' + fail);
failures.forEach((f) => console.log('   - ' + f));
console.log('================================================');
await env.cleanup();
process.exit(fail > 0 ? 1 : 0);
