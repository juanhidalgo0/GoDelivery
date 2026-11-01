// Tarifa propia de encomiendas: createFavorOrder (función real) usa encomiendaPricing solo en las
// encomiendas; las compras siguen con el delivery general. Apagada, nada cambia.
//
//   Necesita el emulador de auth (firebase.json no lo trae):
//   npx firebase-tools emulators:exec --config firebase.emulators-auth.json --only auth,functions,firestore --project demo-godelivery "node tests/encomienda-tarifa.test.mjs"
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
const requireFn = createRequire(path.join(HERE, '..', 'functions', 'package.json'));
const admin = requireFn('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = requireFn('firebase-admin/firestore').getFirestore();
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1/createFavorOrder`;

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { if (ok) { pass++; console.log('  OK   ' + label); } else { fail++; console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); } };

async function testUser(name) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${name}-${Date.now()}@test.local`, password: `pw-${Math.random().toString(36).slice(2)}`, returnSecureToken: true }) });
  const j = await r.json();
  await db.doc(`users/${j.localId}`).set({ displayName: name, role: 'user', phone: '2221000000' });
  return j.idToken;
}

const GENERAL = { rainMode: 'off', deliveryBasePrice: 1500, deliveryMinPrice: 1500, deliveryPricePerKm: 300, deliveryDistanceRules: [{ name: 'Lejos', limitKm: 0, price: 9000 }] };
await db.doc('users/cadete').set({ role: 'delivery', isDelivery: true, isOnline: true });

// Misma coordenada de retiro y entrega: 0 km, el precio es el mínimo o la regla fija
const SPOT = { lat: -35.08, lng: -57.515 };
async function order(type, deliveryCost, extra = {}) {
  const token = await testUser(type);
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({
    type, pickupAddress: 'Retiro', pickupCoords: SPOT, deliveryAddress: 'Entrega', deliveryCoords: SPOT, details: 'Una caja',
    deliveryCost, purchaseFee: type === 'compra' ? 800 : 0, appUsageFee: 0, stopsCount: 1, tip: 0, paymentMethod: 'efectivo',
    clientRequestId: `req-${Math.random().toString(36).slice(2)}`, ...extra,
  }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.orderId) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
  return (await db.doc(`orders/${j.orderId}`).get()).data();
}

await db.doc('settings/global').set(GENERAL);
let o = await order('mandado', 0);
check('sin configurar: la encomienda usa la general (regla fija $9000)', o.deliveryCost === 9000, String(o.deliveryCost));

await db.doc('settings/global').set({ ...GENERAL, encomiendaPricing: { enabled: false, basePrice: 500, minPrice: 700, pricePerKm: 100 } });
o = await order('mandado', 0);
check('apagada: sigue usando la general', o.deliveryCost === 9000, String(o.deliveryCost));

await db.doc('settings/global').set({ ...GENERAL, encomiendaPricing: { enabled: true, basePrice: 500, minPrice: 700, pricePerKm: 100 } });
o = await order('mandado', 0);
check('activa: la app no puede cobrar menos que el mínimo propio ($700)', o.deliveryCost === 700, String(o.deliveryCost));
o = await order('mandado', 700);
check('activa: acepta el precio propio y no lo pisa con la general', o.deliveryCost === 700, String(o.deliveryCost));
o = await order('compra', 0);
check('activa: la compra sigue con la general', o.deliveryCost === 9000, String(o.deliveryCost));
o = await order('mandado', 0, { pickupCoords: undefined });
check('activa y sin coordenadas: cobra el mínimo propio', o.deliveryCost === 700, String(o.deliveryCost));
o = await order('mandado', 0, { deliveryCoords: { lat: -35.08 + 0.09, lng: -57.515 } });
check('activa: suma por km con el factor de calle (10 km x 1,25 x $100 + $500 ≈ $1750)', Math.abs(o.deliveryCost - 1750) <= 30, String(o.deliveryCost));

console.log(`\n  PASARON: ${pass}   |   FALLARON: ${fail}`);
process.exit(fail ? 1 : 0);
