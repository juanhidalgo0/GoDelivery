// "Compra el repartidor" + puente con Ventra, contra los emuladores (nada toca producción):
//
//   npx firebase-tools emulators:exec --config firebase.e2e.json --project demo-godelivery \
//     --only auth,firestore,functions,storage "node tests/compra-repartidor.test.mjs"
//
// Vincula un comercio con un código, publica su catálogo como lo hace Ventra (reutilizando un
// producto viejo por código de barras), crea pedidos de cliente (pago, sin tope, agotados), el
// repartidor carga la compra (faltante, parcial, reemplazo, ticket) y la caja lee los pedidos.
// También revisa que un pedido a un comercio común siga esperando la confirmación del comercio.

import { createRequire } from 'module';
import assert from 'assert';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const auth = admin.auth();
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(400); } return v; };

async function account(email, password, data) {
  let u;
  try { u = await auth.getUserByEmail(email); } catch { u = await auth.createUser({ email, password, displayName: data.displayName }); }
  await db.doc(`users/${u.uid}`).set({ email, createdAt: Timestamp.now(), ...data }, { merge: true });
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}
const post = async (fn, body, headers = {}) => {
  const r = await fetch(`${FN}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, body: j };
};
const bridge = (body, key) => post('ventraBridge', body, key ? { 'x-ventra-key': key } : {});
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ─── Datos ───
const STORE = { lat: -35.0790, lng: -57.5140 };
const HOME = { lat: -35.0835, lng: -57.5230 };
const allDay = [{ open: '00:00', close: '23:59' }];
await db.doc('settings/global').set({ deliveryMinPrice: 1500, appUsageFeeRate: 0.05, rainMode: 'off' }, { merge: true });
const cliente = await account('cliente.shop@e2e.test', 'shop-cliente-123', { displayName: 'Lucía Prueba', role: 'user', phone: '2221000101', phoneVerified: true, points: 0 });
const cadete = await account('cadete.shop@e2e.test', 'shop-cadete-123', { displayName: 'Martín Cadete', role: 'delivery', isDelivery: true, deliveryStatus: 'approved', isOnline: true, deliveryDebt: 0, vehicleType: 'moto' });
const otro = await account('otro.shop@e2e.test', 'shop-otro-123', { displayName: 'Otro Cadete', role: 'delivery', isDelivery: true, deliveryStatus: 'approved', isOnline: false, deliveryDebt: 0 });
const CID = 'shop-paulos';
const PIZZA = 'shop-pizzeria';
for (const [id, name, extra] of [[CID, 'Kiosco Paulos (prueba)', { fulfillmentMode: 'shopper' }], [PIZZA, 'Pizzería común (prueba)', {}]]) {
  await db.doc(`comercios/${id}`).set({
    name, ownerId: 'dueno-' + id, approvedByAdmin: true, isActive: true, isPaused: false, address: 'San Martín 1240', coords: STORE,
    schedules: allDay, daysOpen: [0, 1, 2, 3, 4, 5, 6], weeklySchedule: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, allDay])), createdAt: Timestamp.now(), ...extra,
  });
}
// Un producto de la conexión vieja (sin ventraId): Ventra tiene que reutilizarlo por código de barras
await db.doc(`comercios/${CID}/products/viejo-coca`).set({ name: 'COCA VIEJA', barcode: '7790895000997', price: 1000, isAvailable: true, stockMode: 'limited', stockQuantity: 3, salesCount: 42 });
// Un corte por peso: precio por kilo, se elige de a 500 g
await db.doc(`comercios/${CID}/products/vacio`).set({ name: 'Vacío', price: 24000, soldByWeight: true, weightStep: 500, isAvailable: true, stockMode: 'unlimited' });
await db.doc(`comercios/${PIZZA}/products/muzza`).set({ name: 'Muzzarella', price: 9000, isAvailable: true, stockMode: 'unlimited' });

let KEY = '';
const order = (cid, cart, extra = {}) => post('createOrder', {
  cart, address: 'Av. Mitre 820', deliveryCoords: HOME, paymentMethod: 'efectivo', totalDelivery: 0, redeemedPoints: 0, tip: 0, allowReplacement: true, ...extra,
}, { Authorization: `Bearer ${cliente.token}`, 'x-idempotency-key': `t-${Date.now()}-${Math.random()}` });
const item = (cid, id, name, qty, price) => ({ comercioId: cid, comercioName: cid === CID ? 'Kiosco Paulos (prueba)' : 'Pizzería', product: { id, name, price }, qty });

// ─── Vinculación ───
await t('vincular: código de 8, una sola vez; la clave sirve solo para ese comercio', async () => {
  await db.doc('ventra_links/ABCD2345').set({ comercioId: CID, createdBy: 'admin', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 864e5) });
  assert.strictEqual((await bridge({ action: 'link', code: 'ZZZZ9999' })).status, 404);
  const r = await bridge({ action: 'link', code: 'abcd-2345', storeName: 'Paulos' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.key.length >= 40);
  assert.strictEqual(r.body.store.fulfillmentMode, 'shopper');
  KEY = r.body.key;
  assert.strictEqual((await bridge({ action: 'link', code: 'ABCD2345' })).status, 409);
  assert.strictEqual((await bridge({ action: 'status' }, 'x'.repeat(48))).status, 401);
  const st = await bridge({ action: 'status' }, KEY);
  assert.strictEqual(st.body.store.comercioId, CID);
  assert.strictEqual((await db.doc(`comercios/${CID}`).get()).data().ventraLinked, true);
});
await t('vincular: un código vencido no sirve', async () => {
  await db.doc('ventra_links/VENC1234').set({ comercioId: CID, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.strictEqual((await bridge({ action: 'link', code: 'VENC1234' })).status, 410);
});

// ─── Catálogo ───
await t('catálogo: crea, reutiliza el viejo por código de barras, sin stock y con foto', async () => {
  const r = await bridge({ action: 'catalog', syncStock: false, upserts: [
    { ventraId: 'v-coca', barcode: '7790895000997', name: 'Coca-Cola 2,25 L', price: 3500, category: 'Bebidas', image: PIXEL },
    { ventraId: 'v-alfa', barcode: '7790580660000', name: 'Alfajor Triple', price: 1100, category: 'Golosinas' },
    { ventraId: 'v-yerba', name: 'Yerba 1 kg', price: 5200, category: 'Almacén' },
    { ventraId: 'v-sin-precio', name: 'Sin precio', price: 0 },
  ] }, KEY);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.written, 3);
  assert.strictEqual(r.body.errors.length, 1);
  const coca = (await db.doc(`comercios/${CID}/products/viejo-coca`).get()).data();
  assert.strictEqual(coca.ventraId, 'v-coca', 'reutiliza el producto viejo');
  assert.strictEqual(coca.name, 'Coca-Cola 2,25 L');
  assert.strictEqual(coca.salesCount, 42, 'conserva lo que ya tenía');
  assert.strictEqual(coca.stockMode, 'unlimited');
  assert.strictEqual(coca.isAvailable, true);
  assert.ok(/^https:\/\//.test(coca.image) || /^http:\/\//.test(coca.image), 'foto en Storage: ' + coca.image);
  const cats = (await db.collection(`comercios/${CID}/categories`).get()).docs.map((d) => d.data().name).sort();
  assert.deepStrictEqual(cats, ['Almacén', 'Bebidas', 'Golosinas']);
});
await t('catálogo: con stock sincronizado, sin stock queda no disponible; borrar oculta', async () => {
  await bridge({ action: 'catalog', syncStock: true, upserts: [{ ventraId: 'v-yerba', name: 'Yerba 1 kg', price: 5200, stock: 0 }] }, KEY);
  let y = (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-yerba').get()).docs[0].data();
  assert.strictEqual(y.isAvailable, false);
  assert.strictEqual(y.stockMode, 'limited');
  await bridge({ action: 'catalog', syncStock: false, upserts: [{ ventraId: 'v-yerba', name: 'Yerba 1 kg', price: 5200 }] }, KEY);
  y = (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-yerba').get()).docs[0].data();
  assert.strictEqual(y.isAvailable, true);
  await bridge({ action: 'catalog', upserts: [], deletes: ['v-yerba'] }, KEY);
  y = (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-yerba').get()).docs[0].data();
  assert.strictEqual(y.isAvailable, false);
  assert.strictEqual(y.hiddenByVentra, true);
  // Publicación completa: lo que no vino se oculta, lo que vino vuelve
  await bridge({ action: 'catalog', syncStock: false, upserts: [{ ventraId: 'v-yerba', name: 'Yerba 1 kg', price: 5200 }], publishedIds: ['v-coca', 'v-yerba'] }, KEY);
  const alfa = (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-alfa').get()).docs[0].data();
  assert.strictEqual(alfa.hiddenByVentra, true);
  y = (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-yerba').get()).docs[0].data();
  assert.strictEqual(y.isAvailable, true);
  await bridge({ action: 'catalog', syncStock: false, upserts: [{ ventraId: 'v-alfa', name: 'Alfajor Triple', price: 1100 }] }, KEY);
});

await t('catálogo: nombre y precio de Ventra llegan; el nombre que el dueño cambia en GO queda solo en GO', async () => {
  const q = () => db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-alfa').get().then((s) => s.docs[0]);
  // Cambio de nombre y precio en Ventra: llegan a GO
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-alfa', name: 'ALF TRIPLE CHOC', price: 1200 }] }, KEY);
  let a = (await q()).data();
  assert.strictEqual(a.name, 'ALF TRIPLE CHOC');
  assert.strictEqual(a.ventraName, 'ALF TRIPLE CHOC');
  assert.strictEqual(a.price, 1200, 'el precio nuevo llega');
  // El dueño lo renombra y lo oculta desde el panel de GO
  await (await q()).ref.update({ name: 'Triple Choco', nameLockedInGo: true, isAvailable: false, hiddenInGo: true });
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-alfa', name: 'ALF TRIPLE CHOC', price: 1300 }] }, KEY);
  a = (await q()).data();
  assert.strictEqual(a.name, 'Triple Choco', 'Ventra no pisa el nombre puesto en GO');
  assert.strictEqual(a.price, 1300, 'pero el precio sí');
  assert.strictEqual(a.isAvailable, false, 'y sigue oculto');
  // Vuelve a mostrarlo y al nombre de Ventra
  await (await q()).ref.update({ nameLockedInGo: false, hiddenInGo: false, isAvailable: true });
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-alfa', name: 'Alfajor Triple', price: 1100 }] }, KEY);
  a = (await q()).data();
  assert.strictEqual(a.name, 'Alfajor Triple');
  assert.strictEqual(a.isAvailable, true);
});
await t('catálogo: el rubro que le ponen en GO queda si en Ventra no tiene rubro', async () => {
  const q = () => db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-alfa').get().then((s) => s.docs[0]);
  const cat = await db.collection(`comercios/${CID}/categories`).add({ name: 'Golosinas GO', order: 9, isActive: true });
  await (await q()).ref.update({ categoryId: cat.id });
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-alfa', name: 'Alfajor Triple', price: 1100 }] }, KEY);
  assert.strictEqual((await q()).data().categoryId, cat.id, 'sin rubro en Ventra: queda el de GO');
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-alfa', name: 'Alfajor Triple', price: 1100, category: 'Golosinas' }] }, KEY);
  const ventraCat = (await db.collection(`comercios/${CID}/categories`).where('name', '==', 'Golosinas').get()).docs[0];
  assert.strictEqual((await q()).data().categoryId, ventraCat.id, 'con rubro en Ventra: manda el de Ventra');
});
await t('catálogo: el rubro de la IA ("Rubro › Subrubro") se crea en GO y no pisa uno puesto', async () => {
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-ia1', name: 'FERNET BRANCA 750', price: 9000, goCategory: 'Vinos y bebidas blancas › Fernet y aperitivos' }] }, KEY);
  const p1 = (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', 'v-ia1').get()).docs[0];
  const cats = (await db.collection(`comercios/${CID}/categories`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const sub = cats.find((c) => c.id === p1.data().categoryId);
  assert.strictEqual(sub?.name, 'Fernet y aperitivos');
  assert.strictEqual(cats.find((c) => c.id === sub.parentCategoryId)?.name, 'Vinos y bebidas blancas');
  // El dueño lo pasa a otro rubro en GO: la IA no lo vuelve a mover
  await p1.ref.update({ categoryId: sub.parentCategoryId });
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-ia1', name: 'FERNET BRANCA 750', price: 9100, goCategory: 'Vinos y bebidas blancas › Fernet y aperitivos' }] }, KEY);
  assert.strictEqual((await p1.ref.get()).data().categoryId, sub.parentCategoryId);
  // Un rubro apagado en GO se vuelve a prender si se usa
  const off = await db.collection(`comercios/${CID}/categories`).add({ name: 'Golosinas viejas', order: 50, isActive: false });
  await bridge({ action: 'catalog', upserts: [{ ventraId: 'v-ia2', name: 'TURRON', price: 500, category: 'Golosinas viejas' }] }, KEY);
  assert.strictEqual((await off.get()).data().isActive, true);
});

// ─── Pedidos ───
const prod = async (vid) => (await db.collection(`comercios/${CID}/products`).where('ventraId', '==', vid).get()).docs[0];
let ORDER_ID = '';
await t('pedido: va directo a los repartidores (sin que el comercio confirme)', async () => {
  const coca = await prod('v-coca'); const alfa = await prod('v-alfa'); const yerba = await prod('v-yerba');
  const r = await order(CID, [item(CID, coca.id, 'Coca', 2, 3500), item(CID, alfa.id, 'Alfajor', 3, 1100), item(CID, yerba.id, 'Yerba', 1, 5200)]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  ORDER_ID = r.body.orders[0].docId;
  const o = (await db.doc(`orders/${ORDER_ID}`).get()).data();
  assert.strictEqual(o.isShopper, true);
  assert.strictEqual(o.shopPending, true);
  assert.strictEqual(o.status, 'pending');
  assert.strictEqual(o.subtotal, 2 * 3500 + 3 * 1100 + 5200);
  assert.strictEqual(o.items[0].ventraId, 'v-coca');
  assert.strictEqual(o.items[0].barcode, '7790895000997');
  // No le llega el "Confirmalo" al comercio
  const notes = await db.collection('notifications').where('orderId', '==', ORDER_ID).get();
  assert.strictEqual(notes.size, 0);
  // El despacho le ofrece el pedido al repartidor conectado
  const offered = await until(async () => (await db.doc(`orders/${ORDER_ID}`).get()).data().queueTargetDriverId);
  assert.strictEqual(offered, cadete.uid, 'se le ofreció al cadete conectado');
});
await t('pedido: pagar online no se puede (el repartidor paga en el mostrador)', async () => {
  const coca = await prod('v-coca');
  const r = await order(CID, [item(CID, coca.id, 'Coca', 1, 3500)], { paymentMethod: 'tarjeta' });
  assert.strictEqual(r.status, 500);
  assert.match(r.body.error, /efectivo o por transferencia/);
});
await t('pedido: "TRANSFERENCIA" del carrito (mercadopago) sí se acepta', async () => {
  const coca = await prod('v-coca');
  const r = await order(CID, [item(CID, coca.id, 'Coca', 1, 3500)], { paymentMethod: 'mercadopago' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const id = r.body.orders[0].docId;
  assert.strictEqual((await db.doc(`orders/${id}`).get()).data().isShopper, true);
  await db.doc(`orders/${id}`).update({ status: 'cancelled' });
});
await t('pedido: no hay tope por pedido (uno grande pasa)', async () => {
  const yerba = await prod('v-yerba');
  const r = await order(CID, [item(CID, yerba.id, 'Yerba', 20, 5200)]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  await db.doc(`orders/${r.body.orders[0].docId}`).update({ status: 'cancelled' });
});
await t('pedido a un comercio común: sigue esperando que el comercio confirme', async () => {
  const r = await order(PIZZA, [item(PIZZA, 'muzza', 'Muzzarella', 1, 9000)]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const id = r.body.orders[0].docId;
  const o = (await db.doc(`orders/${id}`).get()).data();
  assert.ok(!o.isShopper);
  const notes = await until(async () => (await db.collection('notifications').where('orderId', '==', id).get()).size);
  assert.strictEqual(notes, 1, 'el comercio recibe el aviso');
  await sleep(2500);
  assert.ok(!(await db.doc(`orders/${id}`).get()).data().queueTargetDriverId, 'no se ofrece a repartidores antes de estar listo');
});
await t('comercio común: lo pausado no se puede pedir (la tienda puede mostrar el menú guardado)', async () => {
  await db.doc(`comercios/${PIZZA}/products/fuga`).set({ name: 'Fugazzeta', price: 9500, isAvailable: false, stockMode: 'unlimited' });
  const r = await order(PIZZA, [item(PIZZA, 'fuga', 'Fugazzeta', 1, 9500)]);
  assert.notStrictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.error || '', /no está disponible/);
});

// ─── Compra ───
const checkout = (who, body) => post('shopperCheckout', { orderId: ORDER_ID, ...body }, { Authorization: `Bearer ${who.token}` });
await t('compra: solo el repartidor del pedido', async () => {
  await db.doc(`orders/${ORDER_ID}`).update({ driverId: cadete.uid, status: 'accepted', queueTargetDriverId: null });
  const r = await checkout(otro, { results: {} });
  assert.strictEqual(r.status, 403);
});
await t('compra: el ticket muy distinto de lo marcado se rechaza', async () => {
  const r = await checkout(cadete, { results: { 2: { status: 'missing' } }, ticketTotal: 2000 });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /no coincide/);
});
await t('compra: faltante, parcial y reemplazo; el total se cierra con el ticket', async () => {
  // Coca: 2 → reemplazo por Pepsi a 3300 x2 · Alfajor: había 2 de 3 · Yerba: no había
  const computed = 3300 * 2 + 1100 * 2;
  const r = await checkout(cadete, { results: { 0: { status: 'replaced', replacementName: 'Pepsi 2,25 L', replacementPrice: 3300, qty: 2 }, 1: { status: 'found', qty: 2 }, 2: { status: 'missing' } }, ticketTotal: computed });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const o = (await db.doc(`orders/${ORDER_ID}`).get()).data();
  assert.strictEqual(o.shopPending, false);
  assert.strictEqual(o.subtotal, computed);
  assert.strictEqual(o.estimatedSubtotal, 2 * 3500 + 3 * 1100 + 5200);
  assert.deepStrictEqual(o.items.map((i) => i.shopStatus), ['replaced', 'partial', 'missing']);
  assert.strictEqual(o.items[2].qty, 0);
  assert.strictEqual(o.appUsageFee, Math.ceil((computed * 0.05) / 10) * 10);
  assert.strictEqual(o.total, computed + o.deliveryCost + o.appUsageFee);
  // La yerba queda agotada 24 h y al cliente le llega el aviso
  const y = (await prod('v-yerba')).data();
  assert.strictEqual(y.isAvailable, false);
  assert.strictEqual(y.unavailableReason, 'shopper_missing');
  const n = await db.collection(`users/${cliente.uid}/notifications`).where('type', '==', 'order_update').get();
  assert.ok(n.size >= 1);
  assert.strictEqual((await checkout(cadete, { results: {} })).status, 409, 'no se carga dos veces');
});
await t('agotado: no se puede pedir hasta que vuelve; Ventra no lo pisa', async () => {
  const yerba = await prod('v-yerba');
  const r = await order(CID, [item(CID, yerba.id, 'Yerba', 1, 5200)]);
  assert.match(r.body.error || '', /no está disponible/);
  await bridge({ action: 'catalog', syncStock: false, upserts: [{ ventraId: 'v-yerba', name: 'Yerba 1 kg', price: 5200 }] }, KEY);
  assert.strictEqual((await prod('v-yerba')).data().isAvailable, false, 'sigue agotado aunque Ventra lo publique');
});
await t('caja (Ventra): lee los pedidos con lo que se compró', async () => {
  const r = await bridge({ action: 'orders', since: Date.now() - 3600e3 }, KEY);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const o = r.body.orders.find((x) => x.id === ORDER_ID);
  assert.ok(o);
  assert.strictEqual(o.isShopper, true);
  assert.strictEqual(o.items[1].ventraId, 'v-alfa');
  assert.strictEqual(o.items[1].qty, 2);
  assert.strictEqual(o.items[0].replacement.name, 'Pepsi 2,25 L');
  assert.strictEqual(o.customer, 'Lucía', 'solo el nombre de pila');
  assert.ok(!('userPhone' in o) && !('deliveryAddress' in o), 'sin datos del cliente');
});
await t('caja (Ventra): consulta liviana, solo lo nuevo y los abiertos; nunca pedidos ajenos', async () => {
  const all = (await bridge({ action: 'orders' }, KEY)).body.orders;
  const newest = Math.max(...all.map((x) => x.createdAt));
  const r = await bridge({ action: 'orders', since: newest, openIds: [ORDER_ID, 'no-existe'] }, KEY);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.orders.map((x) => x.id), [ORDER_ID], 'nada nuevo: solo el abierto que pidió');
  assert.ok(r.body.serverTime > 0);
  const pizzaOrder = (await db.collection('orders').where('comercioId', '==', PIZZA).limit(1).get()).docs[0];
  const foreign = await bridge({ action: 'orders', since: newest, openIds: [pizzaOrder.id] }, KEY);
  assert.strictEqual(foreign.body.orders.length, 0, 'un pedido de otro comercio no se devuelve');
});
await t('si no había nada, el pedido se cancela sin cargo', async () => {
  const coca = await prod('v-coca');
  const r = await order(CID, [item(CID, coca.id, 'Coca', 1, 3500)]);
  const id = r.body.orders[0].docId;
  await db.doc(`orders/${id}`).update({ driverId: cadete.uid, status: 'accepted' });
  const c = await post('shopperCheckout', { orderId: id, results: { 0: { status: 'missing' } } }, { Authorization: `Bearer ${cadete.token}` });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  assert.strictEqual(c.body.cancelled, true);
  assert.strictEqual((await db.doc(`orders/${id}`).get()).data().status, 'cancelled');
});
await t('vuelve a estar disponible cuando vence el plazo', async () => {
  const { restoreMissing } = require('./ventra-bridge.js');
  const y = await prod('v-yerba');
  await y.ref.update({ unavailableUntil: Timestamp.fromMillis(Date.now() - 1000) });
  const n = await restoreMissing(db);
  assert.ok(n >= 1);
  const after = (await prod('v-yerba')).data();
  assert.strictEqual(after.isAvailable, true);
  assert.strictEqual(after.unavailableReason, undefined);
});
await t('desvincular: la clave deja de servir', async () => {
  assert.strictEqual((await bridge({ action: 'unlink' }, KEY)).status, 200);
  assert.strictEqual((await bridge({ action: 'status' }, KEY)).status, 401);
});
await t('por peso: el repartidor carga lo que le cobraron y el cliente paga eso', async () => {
  const r = await order(CID, [item(CID, 'vacio', 'Vacío', 2, 12000)]); // 2 × 500 g = 1 kg
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const id = r.body.orders[0].docId;
  const o0 = (await db.doc(`orders/${id}`).get()).data();
  assert.strictEqual(o0.hasWeighedItems, true);
  assert.strictEqual(o0.estimatedSubtotal, 24000);
  await db.doc(`orders/${id}`).update({ driverId: cadete.uid, status: 'accepted', queueTargetDriverId: null });
  const sin = await post('shopperCheckout', { orderId: id, results: { 0: { status: 'found' } } }, { Authorization: `Bearer ${cadete.token}` });
  assert.strictEqual(sin.status, 400);
  assert.match(sin.body.error, /cuánto te cobraron/);
  const ok = await post('shopperCheckout', { orderId: id, results: { 0: { status: 'found', paid: 25300 } } }, { Authorization: `Bearer ${cadete.token}` });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  const o = (await db.doc(`orders/${id}`).get()).data();
  assert.strictEqual(o.subtotal, 25300, 'se cobra lo que le cobraron');
  assert.strictEqual(o.weighPending, false);
  assert.strictEqual(o.items[0].actualGrams, Math.round(25300 * 1000 / 24000), 'los gramos salen del precio por kilo');
  assert.strictEqual(o.total, 25300 + o.deliveryCost + o.appUsageFee);
  await db.doc(`orders/${id}`).update({ status: 'cancelled' });
});
await t('la app muestra las mismas cuentas que el servidor (src/utils/shopper.js)', async () => {
  const server = require('./shopper.js');
  const client = await import('../src/utils/shopper.js');
  const base = { items: [{ name: 'A', qty: 2, price: 1000 }, { name: 'B', qty: 3, price: 2500 }, { name: 'C', qty: 1, price: 999.5 }],
    appUsageFeeRate: 0.05, deliveryCost: 1500, couponProductsPercent: 10, discountAmount: 200, allowReplacement: true };
  const cases = [
    [{}, null],
    [{ 0: { status: 'missing' } }, null],
    [{ 1: { status: 'found', qty: 1 } }, 11000],
    [{ 2: { status: 'replaced', replacementName: 'D', replacementPrice: 1200 } }, ''],
    [{ 0: { status: 'missing' }, 1: { status: 'missing' }, 2: { status: 'missing' } }, null],
    [{}, 99999],
  ];
  // Por peso: lo que le cobraron
  const weighed = { ...base, items: [...base.items, { name: 'Vacío', qty: 2, price: 12000, soldByWeight: true, weightStep: 500, pricePerKg: 24000 }] };
  for (const [results, ticket] of [[{}, null], [{ 3: { status: 'found', paid: 25300 } }, null], [{ 3: { status: 'missing' } }, null]]) {
    assert.deepStrictEqual(client.applyShopping(weighed, results, ticket), server.applyShopping(weighed, results, ticket), JSON.stringify(results));
  }
  for (const [results, ticket] of cases) {
    assert.deepStrictEqual(client.applyShopping(base, results, ticket), server.applyShopping(base, results, ticket), JSON.stringify(results));
  }
  for (const m of ['efectivo', 'mercadopago', 'tarjeta', 'transferencia', 'online']) {
    assert.strictEqual(client.isOnlinePayment(m), server.isOnlinePayment(m), m);
  }
});

console.log(`\n${ok} bien, ${bad} con falla`);
process.exit(bad ? 1 : 0);
