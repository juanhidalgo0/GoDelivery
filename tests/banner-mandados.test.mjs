// Banner de mandados con envío bonificado: createFavorOrder (función real) valida el descuento,
// lo guarda en el pedido y cuenta los usos del día en el banner (la app ya no lee los pedidos).
//
//   Necesita el emulador de auth (firebase.json no lo trae): se corre con una config aparte, p. ej.
//   npx firebase-tools emulators:exec --config firebase.emulators-auth.json --only auth,functions,firestore --project demo-godelivery "node tests/banner-mandados.test.mjs"
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

const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
await Promise.all([
  db.doc('settings/global').set({ rainMode: 'off', deliveryMinPrice: 1500 }),
  db.doc('users/cadete').set({ role: 'delivery', isDelivery: true, isOnline: true }),
  db.doc('banners_mandados/promo').set({ status: 'active', hasDiscount: true, discountAmount: 500, discountLimitPerDay: 2, merchantName: 'Farmacia' }),
  db.doc('banners_mandados/apagado').set({ status: 'paused', hasDiscount: true, discountAmount: 500 }),
]);

const body = (extra) => ({
  type: 'compra', pickupAddress: 'Comercio: Farmacia', pickupCoords: { lat: -35.08, lng: -57.515 },
  deliveryAddress: 'Mitre 820', deliveryCoords: { lat: -35.083, lng: -57.523 }, details: 'Ibuprofeno',
  deliveryCost: 2300, purchaseFee: 800, appUsageFee: 30, stopsCount: 1, tip: 0, paymentMethod: 'efectivo',
  clientRequestId: `req-${Math.random().toString(36).slice(2)}`, ...extra,
});
async function order(token, extra) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body(extra)) });
  const j = await r.json().catch(() => ({}));
  const id = j.orderId;
  if (!r.ok || !id) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
  return (await db.doc(`orders/${id}`).get()).data();
}

const t1 = await testUser('sinbanner');
const plain = await order(t1, {});
check('sin banner: sin descuento', !plain.bannerDiscount && plain.couponDiscount === 0, JSON.stringify({ c: plain.couponDiscount, t: plain.total }));

const t2 = await testUser('conbanner');
const withBanner = await order(t2, { originBannerId: 'promo', couponDiscount: 500 });
check('con banner activo: descuenta $500 del total', withBanner.total === plain.total - 500, `${withBanner.total} vs ${plain.total}`);
check('...lo guarda en el pedido (banner y descuento)', withBanner.originBannerId === 'promo' && withBanner.bannerDiscount === 500);
check('...y como descuento que absorbe GO (la cuenta del cadete lo acredita)', withBanner.couponDiscount === 500);
let banner = (await db.doc('banners_mandados/promo').get()).data();
check('...y cuenta el uso del día en el banner', banner.stats?.discountedByDay?.[day] === 1 && banner.stats?.conversions === 1, JSON.stringify(banner.stats));

const t3 = await testUser('trucho');
const forged = await order(t3, { originBannerId: 'apagado', couponDiscount: 500 });
check('banner pausado: el servidor no acepta el descuento que manda la app', forged.total === plain.total && forged.bannerDiscount === 0 && forged.couponDiscount === 0, JSON.stringify({ t: forged.total, b: forged.bannerDiscount }));

const t4 = await testUser('segundo');
await order(t4, { originBannerId: 'promo', couponDiscount: 500 });
const t5 = await testUser('tercero');
const over = await order(t5, { originBannerId: 'promo', couponDiscount: 500 });
banner = (await db.doc('banners_mandados/promo').get()).data();
check('pasado el tope del día (2) ya no descuenta', over.bannerDiscount === 0 && over.total === plain.total, JSON.stringify({ b: over.bannerDiscount, t: over.total }));
check('...pero cuenta la visita que convirtió', banner.stats.conversions === 3 && banner.stats.discountedByDay[day] === 2);

const t6 = await testUser('malid');
const bad = await order(t6, { originBannerId: '../orders/x', couponDiscount: 500 });
check('un id de banner raro se ignora', !bad.originBannerId && bad.total === plain.total);

console.log(`\n  PASARON: ${pass}   |   FALLARON: ${fail}`);
process.exit(fail ? 1 : 0);
