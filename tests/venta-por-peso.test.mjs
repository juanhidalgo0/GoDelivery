// Venta por peso (carnicería): las cuentas de src/utils/weight.js, que el servidor (functions/weight.js)
// calcule igual, y un pedido de punta a punta con la función real createOrder: entra con el total
// estimado, el comercio carga lo que pesó con las reglas reales, y la cuenta del cadete toma lo pesado.
//
//   Necesita el emulador de auth (firebase.json no lo trae), igual que banner-mandados:
//   FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --config firebase.emulators-auth.json --only auth,functions,firestore --project demo-godelivery "node tests/venta-por-peso.test.mjs"
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import {
  applyWeights, formatWeight, parseWeightInput, stepPrice, weightStepOf, toleranceRange,
} from '../src/utils/weight.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
const requireFn = createRequire(path.join(HERE, '..', 'functions', 'package.json'));
const serverWeight = requireFn('./weight.js');
const admin = requireFn('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = requireFn('firebase-admin/firestore').getFirestore();
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1/createOrder`;

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { if (ok) { pass++; console.log('  OK   ' + label); } else { fail++; console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- cuentas
console.log('\nCuentas');
check('formatWeight: 250 g, 1 kg, 1,5 kg, 1,085 kg',
  formatWeight(250) === '250 g' && formatWeight(1000) === '1 kg' && formatWeight(1500) === '1,5 kg' && formatWeight(1085) === '1,085 kg',
  [250, 1000, 1500, 1085].map(formatWeight).join(' | '));
check('parseWeightInput entiende la balanza: "1,085", "1.085", "0,9 kg", "1085", "850 g"',
  parseWeightInput('1,085') === 1085 && parseWeightInput('1.085') === 1085 && parseWeightInput('0,9 kg') === 900 &&
  parseWeightInput('1085') === 1085 && parseWeightInput('850 g') === 850);
check('parseWeightInput descarta vacío, cero y letras', parseWeightInput('') === null && parseWeightInput('0') === null && parseWeightInput('abc') === null);
check('paso inválido cae en 250 g', weightStepOf({ weightStep: 333 }) === 250 && weightStepOf({ weightStep: 500 }) === 500);

const products = [
  { soldByWeight: true, weightStep: 250 }, { soldByWeight: true, weightStep: 100 },
  { soldByWeight: true, weightStep: 500 }, { soldByWeight: true, weightStep: 1000 }, { soldByWeight: true },
];
check('la app y el servidor dan el mismo precio por paso',
  products.every(p => [8500, 12345, 999.5].every(kg => stepPrice(kg, p) === serverWeight.stepPrice(kg, p) && weightStepOf(p) === serverWeight.weightStepOf(p))));

// Pedido como lo deja createOrder: 1 kg de vacío a $10.000/kg (4 pasos de 250 g) + 2 chorizos de $1.500
const baseOrder = () => ({
  items: [
    { name: 'Vacío', qty: 4, price: 2500, soldByWeight: true, weightStep: 250, grams: 1000, pricePerKg: 10000 },
    { name: 'Chorizo', qty: 2, price: 1500 },
  ],
  subtotal: 13000, deliveryCost: 2000, appUsageFee: 650, appUsageFeeRate: 0.05, discountAmount: 0, couponDiscount: 0,
  total: 15650, hasWeighedItems: true, weighPending: true,
});

let r = applyWeights(baseOrder(), { 0: 1085 });
check('pesó 1,085 kg: la línea pasa a $10.850', Math.round(r.patch.items[0].price * 4) === 10850, r.patch.items[0].price);
check('...productos $13.850, servicio $700 (5% redondeado a $10), total $16.550',
  r.patch.subtotal === 13850 && r.patch.appUsageFee === 700 && r.patch.total === 16550, JSON.stringify({ s: r.patch.subtotal, f: r.patch.appUsageFee, t: r.patch.total }));
check('...guarda lo estimado y deja de estar pendiente',
  r.patch.estimatedSubtotal === 13000 && r.patch.estimatedTotal === 15650 && r.patch.weighPending === false && r.patch.items[0].orderedPrice === 2500);
check('...dentro del 10%: no pide hablar con el cliente', r.outOfRange.length === 0 && r.missing.length === 0);
check('...los chorizos no se tocan', r.patch.items[1].price === 1500 && r.patch.items[1].qty === 2);

const again = applyWeights({ ...baseOrder(), ...r.patch }, { 0: 950 });
check('volver a pesar parte del precio por kilo, no del peso anterior',
  Math.round(again.patch.items[0].price * 4) === 9500 && again.patch.subtotal === 12500 && again.patch.estimatedTotal === 15650,
  JSON.stringify({ s: again.patch.subtotal, e: again.patch.estimatedTotal }));

const range = toleranceRange(baseOrder().items[0]);
check('tope de 1 kg: de 900 g a 1,1 kg', range.min === 900 && range.max === 1100);
check('1,1 kg justo entra; 1,101 kg ya no', applyWeights(baseOrder(), { 0: 1100 }).outOfRange.length === 0 && applyWeights(baseOrder(), { 0: 1101 }).outOfRange[0] === 0);
check('899 g también se va del tope', applyWeights(baseOrder(), { 0: 899 }).outOfRange[0] === 0);
check('sin peso cargado lo marca como faltante', applyWeights(baseOrder(), {}).missing[0] === 0);

r = applyWeights({ ...baseOrder(), couponProductsPercent: 10, couponDiscount: 1300, total: 14350 }, { 0: 1200 });
check('cupón del 10% sobre productos se recalcula sobre lo pesado', r.patch.couponDiscount === 1500 && r.patch.total === 15000 + 2000 + 750 - 1500,
  JSON.stringify({ c: r.patch.couponDiscount, t: r.patch.total }));
r = applyWeights({ ...baseOrder(), discountAmount: 500, total: 15150 }, { 0: 1000 });
check('GoPoints quedan fijos', r.patch.total === 15150);
r = applyWeights({ ...baseOrder(), totalAmount: 15650 }, { 0: 1000 });
check('si el pedido tiene totalAmount, también se actualiza', r.patch.totalAmount === r.patch.total);

// ---------------------------------------------------------------- de punta a punta
console.log('\nPedido real');
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8') },
});

const signUp = async (name) => {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${name}-${Date.now()}@test.local`, password: `pw-${Math.random().toString(36).slice(2)}`, returnSecureToken: true }) });
  return res.json();
};
const client = await signUp('cliente');
const shopUid = 'carnicero';
const C = 'carniceria-test';
await Promise.all([
  db.doc('settings/global').set({ rainMode: 'off', deliveryMinPrice: 1500, appUsageFeeRate: 0.05 }),
  db.doc(`users/${client.localId}`).set({ displayName: 'Cliente', role: 'user', phone: '2221000000', phoneVerified: true }),
  db.doc('users/cadete-peso').set({ role: 'delivery', isDelivery: true, isOnline: true, displayName: 'Cadete' }),
  db.doc(`comercios/${C}`).set({ name: 'Carnicería Test', ownerId: shopUid, coords: { lat: -35.08, lng: -57.515 } }),
  db.doc(`comercios/${C}/products/vacio`).set({ name: 'Vacío', price: 10000, soldByWeight: true, weightStep: 250, stockMode: 'unlimited', isAvailable: true }),
  db.doc(`comercios/${C}/products/chori`).set({ name: 'Chorizo', price: 1500, stockMode: 'limited', stockQuantity: 10, isAvailable: true }),
]);

const res = await fetch(FN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.idToken}` },
  body: JSON.stringify({
    cart: [
      // El precio que manda la app se ignora: vale el del producto guardado
      { comercioId: C, comercioName: 'Carnicería Test', product: { id: 'vacio', name: 'Vacío', price: 1 }, qty: 4, options: [] },
      { comercioId: C, comercioName: 'Carnicería Test', product: { id: 'chori', name: 'Chorizo', price: 1 }, qty: 2, options: [] },
    ],
    address: 'Mitre 820', deliveryCoords: { lat: -35.083, lng: -57.523 }, paymentMethod: 'efectivo', redeemedPoints: 0, totalDelivery: 0, tip: 0,
  }),
});
const out = await res.json().catch(() => ({}));
check('createOrder acepta el pedido', res.ok && out.orders?.length === 1, `${res.status} ${JSON.stringify(out)}`);
const orderId = out.orders?.[0]?.docId;
let o = orderId ? (await db.doc(`orders/${orderId}`).get()).data() : {};
const vac = o.items?.[0] || {};
check('1 kg de vacío a $10.000/kg = $10.000 (4 pasos de $2.500)', vac.price === 2500 && vac.qty === 4, JSON.stringify(vac));
check('...la línea guarda que es por peso, el paso, los gramos y el precio por kilo',
  vac.soldByWeight === true && vac.weightStep === 250 && vac.grams === 1000 && vac.pricePerKg === 10000);
check('...el pedido queda pendiente de pesar, con la tasa de servicio guardada',
  o.hasWeighedItems === true && o.weighPending === true && o.appUsageFeeRate === 0.05 && o.subtotal === 13000 && o.appUsageFee === 650, JSON.stringify({ s: o.subtotal, f: o.appUsageFee }));
check('...los chorizos siguen siendo unidades (sin campos de peso)', o.items?.[1]?.soldByWeight === undefined && o.items?.[1]?.price === 1500);
const chori = (await db.doc(`comercios/${C}/products/chori`).get()).data();
check('...el stock de chorizos baja 2; el vacío no lleva stock', chori.stockQuantity === 8);

// El carnicero pesa desde el panel (reglas reales)
const shopDb = env.authenticatedContext(shopUid).firestore();
const ref = doc(shopDb, 'orders', orderId);
const fresh = (await getDoc(ref)).data();
const weighed = applyWeights(fresh, { 0: 1085 });
let wrote = true;
try { await updateDoc(ref, { ...weighed.patch, weighedAt: new Date(), weightOverApproved: false }); } catch (e) { wrote = false; console.log('   ', e.message); }
check('las reglas dejan al comercio guardar el peso', wrote);
o = (await db.doc(`orders/${orderId}`).get()).data();
check('...total final = productos $13.850 + envío + servicio $700',
  o.subtotal === 13850 && o.appUsageFee === 700 && o.total === 13850 + o.deliveryCost + 700 && o.weighPending === false,
  JSON.stringify({ s: o.subtotal, f: o.appUsageFee, d: o.deliveryCost, t: o.total }));

// Sale y se entrega: la cuenta del cadete toma el servicio de lo pesado ($700, no $650)
await db.doc(`orders/${orderId}`).update({ status: 'ready', readyAt: new Date() });
await sleep(1500);
await db.doc(`orders/${orderId}`).update({ driverId: 'cadete-peso', driverName: 'Cadete', status: 'delivering' });
await db.doc(`orders/${orderId}`).update({ status: 'completed', completedAt: new Date() });
let entry = null;
for (let i = 0; i < 30 && !entry; i++) {
  const q = await db.collection('driver_ledger').where('orderId', '==', orderId).where('type', '==', 'order').get();
  entry = q.empty ? null : q.docs[0].data();
  if (!entry) await sleep(500);
}
check('la cuenta del cadete anota el servicio de lo pesado ($700)', entry?.amount === 700, JSON.stringify(entry));

await env.cleanup();
console.log(`\n  PASARON: ${pass}   |   FALLARON: ${fail}`);
process.exit(fail ? 1 : 0);
