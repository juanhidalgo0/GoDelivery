// Simulación de punta a punta: caja Ventra ↔ GO con "lo compra el repartidor".
// Nada toca producción: GO en los emuladores y una caja Ventra de prueba (otra base).
//
//   1. npx firebase-tools emulators:start --config firebase.e2e.json --project demo-godelivery
//   2. caja Ventra de prueba con GO_FUNCTIONS_URL=http://127.0.0.1:5001/demo-godelivery/us-central1
//      (en el puerto de VENTRA_URL, usuario ADMIN / VENTRA_PASS)
//   3. node tests/simulacion-ventra-go.mjs
//
// Recorre: vincular con el código, publicar el catálogo (sin cigarrillos ni alcohol, sin lo que no
// tiene precio ni lo que va por peso), cambios de precio en la caja que llegan a GO, nombre propio
// puesto en GO que la caja no pisa, pedido del cliente directo al repartidor, compra con faltante
// y parcial, entrega, pedidos y números en la caja, pedido sin nada (se cancela) y desvincular.
import { createRequire } from 'module';
import assert from 'assert';
import { seed, SIM } from './simulacion-paulos-seed.mjs';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const db = admin.firestore();
const auth = admin.auth();
const PROJECT = 'demo-godelivery';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const VENTRA = process.env.VENTRA_URL || 'http://127.0.0.1:3020/api';
const VENTRA_PASS = process.env.VENTRA_PASS || 'sim1234';
if (!process.env.VENTRA_DB) throw new Error('Falta VENTRA_DB: la base de la caja de prueba');
const CID = SIM.comercioId;

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(500); } return v; };

// ─── Clientes HTTP ───
let VTOKEN = '';
const ventra = async (method, path, body) => {
  const r = await fetch(`${VENTRA}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VTOKEN}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, body: j };
};
async function signIn(a) {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password: a.password, returnSecureToken: true }),
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}
const go = async (fn, body, token, extra = {}) => {
  const r = await fetch(`${FN}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, body: j };
};
const goProducts = async () => (await db.collection(`comercios/${CID}/products`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const byBarcode = async (code) => (await goProducts()).find((p) => p.barcode === code);
const vProduct = async (code) => {
  const r = await ventra('GET', `/products?search=${code}`);
  const list = Array.isArray(r.body) ? r.body : (r.body?.data || r.body?.items || []);
  return list.find((p) => p.barcode === code);
};

// ─── Preparación (se puede correr muchas veces) ───
const login = await fetch(`${VENTRA}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ADMIN', password: VENTRA_PASS }) }).then((r) => r.json());
VTOKEN = login.accessToken;
assert.ok(VTOKEN, 'login de la caja de prueba');
await ventra('POST', '/go/unlink');
// La caja de prueba vuelve al estado inicial (precios, nombres y elecciones de la corrida anterior)
async function ventraDb(fn) {
  const { PrismaClient } = createRequire('C:/Users/PC/Desktop/Kiosco/apps/backend/package.json')('@prisma/client');
  const pc = new PrismaClient({ datasources: { db: { url: 'file:' + process.env.VENTRA_DB } } });
  try { return await fn(pc); } finally { await pc.$disconnect(); }
}
await ventraDb(async (pc) => {
  for (const tbl of ['go_products', 'go_orders', 'go_published']) await pc.$executeRawUnsafe(`DELETE FROM ${tbl}`).catch(() => {});
  for (const [code, price, name] of [
    ['7790580000011', 900, 'Alfajor Guaymallén Triple'], ['7790580000028', 1100, 'Alfajor Jorgito Chocolate'],
    ['7790387000017', 5200, 'Yerba Playadito 1 kg'], ['7622300000011', 1400, 'Galletitas Oreo 118 g'],
  ]) await pc.$executeRawUnsafe('UPDATE products SET sale_price = ?, name = ?, is_active = 1 WHERE barcode = ?', price, name, code);
});
for (const col of ['products', 'categories']) {
  const s = await db.collection(`comercios/${CID}/${col}`).get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
}
const old = await db.collection('orders').where('comercioId', '==', CID).get();
await Promise.all(old.docs.map((d) => d.ref.delete()));
const { cadeteUid } = await seed();
const cliente = await signIn(SIM.cliente);
const cadete = await signIn(SIM.cadete);
const HOME = { lat: -35.0835, lng: -57.5230 };
const order = (items, extra = {}) => go('createOrder', {
  cart: items.map(([p, qty]) => ({ comercioId: CID, comercioName: 'Kiosco Paulos (simulación)', product: { id: p.id, name: p.name, price: p.price }, qty })),
  address: 'Av. Mitre 820', deliveryCoords: HOME, paymentMethod: 'efectivo', totalDelivery: 0, redeemedPoints: 0, tip: 0, allowReplacement: true, ...extra,
}, cliente.token, { 'x-idempotency-key': `sim-${Date.now()}-${Math.random()}` });

// ─── 1. Vincular ───
await t('caja: un código equivocado no vincula', async () => {
  const r = await ventra('POST', '/go/link', { code: 'ZZZZ9999' });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.message, /Código no encontrado/);
});
await t('caja: vincula con el código de GO y queda en modo "lo compra el repartidor"', async () => {
  const r = await ventra('POST', '/go/link', { code: SIM.code.toLowerCase().replace(/(....)/, '$1-') });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.linked, true);
  assert.strictEqual(r.body.fulfillmentMode, 'shopper');
  assert.strictEqual(r.body.shopperMaxTotal, 40000);
  assert.strictEqual(r.body.isMainPc, true);
  assert.strictEqual(r.body.publishMode, 'categories');
  const cats = await ventra('GET', '/categories');
  const names = new Map(cats.body.map((c) => [c.id, c.name]));
  const chosen = r.body.publishCategories.map((id) => names.get(id));
  assert.ok(!chosen.includes('Cigarrillos') && !chosen.includes('Bebidas con alcohol'), 'cigarrillos y alcohol arrancan afuera: ' + chosen);
  assert.ok(chosen.includes('Golosinas'));
});

// ─── 2. Catálogo ───
await t('catálogo: se publica solo, con fotos y rubros; sin cigarrillos, alcohol, sin precio ni por peso', async () => {
  await ventra('POST', '/go/sync-now');
  const ps = await until(async () => { const l = await goProducts(); return l.length >= 34 ? l : null; });
  assert.ok(ps, 'llegaron los productos');
  const names = ps.map((p) => p.name);
  assert.ok(names.includes('Coca-Cola 2,25 L'));
  assert.ok(!names.some((n) => /Marlboro|Quilmes|Fernet|Philip/.test(n)), 'sin cigarrillos ni alcohol');
  assert.ok(!names.includes('Pan francés'), 'por peso no');
  assert.ok(!names.includes('Bolsa de regalo (sin precio)'), 'sin precio no');
  // 38 - 2 cigarrillos - 2 alcohol = 34 (los sin rubro entran: "Sin rubro" arranca elegido)
  // GO muestra exactamente lo que la caja dice que publica (la base de prueba trae además productos viejos sin rubro)
  const published = (await ventra('GET', '/go/products?only=published')).body;
  assert.ok(published.length >= 34);
  assert.strictEqual(ps.filter((p) => p.isAvailable !== false).length, published.length);
  assert.deepStrictEqual(new Set(ps.filter((p) => p.isAvailable !== false).map((p) => p.ventraId)), new Set(published.map((p) => p.id)));
  const coca = ps.find((p) => p.barcode === '7790895000997');
  assert.strictEqual(coca.price, 3800);
  assert.strictEqual(coca.stockMode, 'unlimited', 'sin stock');
  assert.ok(/^https?:\/\//.test(coca.image), 'foto subida: ' + coca.image);
  const cats = (await db.collection(`comercios/${CID}/categories`).get()).docs.map((d) => d.data().name);
  assert.ok(cats.includes('Golosinas') && cats.includes('Bebidas'));
});
await t('catálogo: un cambio de precio en la caja llega a GO en segundos', async () => {
  const p = await vProduct('7790580000011');
  const r = await ventra('PATCH', `/products/${p.id}`, { salePrice: 950 });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  const g = await until(async () => { const x = await byBarcode('7790580000011'); return x && x.price === 950 ? x : null; });
  assert.ok(g, 'el precio nuevo llegó solo (sin apretar nada)');
});
await t('catálogo: cambios masivos (como una lista de precios) también llegan', async () => {
  // Fuera de los avisos de siempre: lo encuentra la comparación periódica
  await ventraDb((pc) => pc.$executeRawUnsafe(`UPDATE products SET sale_price = sale_price + 100, updated_at = CURRENT_TIMESTAMP WHERE barcode IN ('7790387000017', '7622300000011')`));
  await ventra('POST', '/go/sync-now');
  assert.strictEqual((await byBarcode('7790387000017')).price, 5300);
  assert.strictEqual((await byBarcode('7622300000011')).price, 1500);
});
await t('catálogo: el nombre que el dueño cambia en GO queda solo en GO; el precio sigue llegando', async () => {
  const g = await byBarcode('7790580000028');
  await db.doc(`comercios/${CID}/products/${g.id}`).update({ name: 'Jorgito de chocolate', nameLockedInGo: true });
  const p = await vProduct('7790580000028');
  await ventra('PATCH', `/products/${p.id}`, { salePrice: 1150, name: 'ALF JORGITO CHOC' });
  const after = await until(async () => { const x = await byBarcode('7790580000028'); return x && x.price === 1150 ? x : null; });
  assert.ok(after, 'llegó el precio');
  assert.strictEqual(after.name, 'Jorgito de chocolate', 'el nombre de GO no se pisa');
  assert.strictEqual(after.ventraName, 'ALF JORGITO CHOC');
  const vp = await vProduct('7790580000028');
  assert.strictEqual(vp.name, 'ALF JORGITO CHOC', 'en la caja queda el de la caja');
});
await t('catálogo: sumar a mano un producto de un rubro sin publicar y sacar otro', async () => {
  const marl = await vProduct('7790400000017');
  const sugus = await vProduct('7790580000066');
  await ventra('PUT', '/go/products', { ids: [marl.id], publish: true });
  await ventra('PUT', '/go/products', { ids: [sugus.id], publish: false });
  await ventra('POST', '/go/sync-now');
  assert.strictEqual((await byBarcode('7790400000017'))?.isAvailable, true);
  assert.strictEqual((await byBarcode('7790580000066')).isAvailable, false);
  // Vuelven a la regla general
  await ventra('PUT', '/go/products', { ids: [marl.id, sugus.id], publish: null });
  await ventra('POST', '/go/sync-now');
  assert.strictEqual((await byBarcode('7790400000017')).isAvailable, false);
  assert.strictEqual((await byBarcode('7790580000066')).isAvailable, true);
});

// ─── 3. Pedido ───
let ORDER = '';
await t('pedido: el cliente pide y va directo al repartidor (el kiosco no confirma nada)', async () => {
  const coca = await byBarcode('7790895000997');
  const alfa = await byBarcode('7790580000011');
  const yerba = await byBarcode('7790387000017');
  const r = await order([[coca, 1], [alfa, 2], [yerba, 1]]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  ORDER = r.body.orders[0].docId;
  const o = (await db.doc(`orders/${ORDER}`).get()).data();
  assert.strictEqual(o.isShopper, true);
  assert.strictEqual(o.estimatedSubtotal, 3800 + 950 * 2 + 5300);
  const offered = await until(async () => (await db.doc(`orders/${ORDER}`).get()).data().queueTargetDriverId);
  assert.strictEqual(offered, cadeteUid, 'se le ofreció al repartidor conectado');
});
await t('caja: ve el pedido nuevo (aviso y lista)', async () => {
  await ventra('POST', '/go/sync-now');
  const list = await ventra('GET', '/go/orders');
  const o = list.body.find((x) => x.id === ORDER);
  assert.ok(o, 'la caja tiene el pedido');
  assert.strictEqual(o.status, 'pending');
  assert.strictEqual(o.shopPending, true);
  assert.strictEqual(o.items.length, 3);
});
await t('repartidor: acepta, compra (alfajor: había 1; yerba: no había) y carga el ticket', async () => {
  await db.doc(`orders/${ORDER}`).update({ driverId: cadeteUid, driverName: 'Martín Repartidor', status: 'accepted', acceptedAt: new Date() });
  const sub = 3800 + 950;
  const r = await go('shopperCheckout', { orderId: ORDER, results: { 1: { status: 'found', qty: 1 }, 2: { status: 'missing' } }, ticketTotal: sub }, cadete.token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const o = (await db.doc(`orders/${ORDER}`).get()).data();
  assert.strictEqual(o.subtotal, sub);
  assert.strictEqual(o.shopMissingCount, 1);
  assert.strictEqual(o.items[1].shopStatus, 'partial');
  const yerba = await byBarcode('7790387000017');
  assert.strictEqual(yerba.isAvailable, false, 'lo que faltó queda agotado un día');
  // Y la caja no lo vuelve a mostrar aunque publique de nuevo
  await ventra('POST', '/go/sync-now');
  assert.strictEqual((await byBarcode('7790387000017')).isAvailable, false);
});
await t('caja: "Cobrar pedido GO" deja la venta unida al pedido (una sola vez) y baja el stock', async () => {
  await ventra('POST', '/go/sync-now');
  const o = (await ventra('GET', '/go/orders?status=open')).body.find((x) => x.id === ORDER);
  assert.ok(o && !o.saleId, 'está en la lista para cobrar');
  const active = (await ventra('GET', '/cash/active')).body;
  let session = (Array.isArray(active) ? active : []).find((s) => s.status === 'OPEN');
  if (!session) session = (await ventra('POST', '/cash/open', { terminalName: 'SIM-GO', openingAmount: 0 })).body;
  assert.ok(session?.id, 'caja abierta');
  const coca = await vProduct('7790895000997');
  const alfa = await vProduct('7790580000011');
  const before = Number(coca.stock);
  // Lo que llevó el repartidor: la Coca y 1 alfajor (la yerba no había)
  const sale = await ventra('POST', '/sales', {
    sessionId: session.id, items: [{ productId: coca.id, quantity: 1 }, { productId: alfa.id, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 3800 + 950 }], goOrderId: ORDER,
  });
  assert.ok(sale.status < 300, JSON.stringify(sale.body));
  assert.strictEqual(sale.body.notes, `Pedido GO #${o.number}`);
  const after = (await ventra('GET', '/go/orders')).body.find((x) => x.id === ORDER);
  assert.strictEqual(after.saleId, sale.body.id);
  assert.ok(!(await ventra('GET', '/go/orders?status=open')).body.some((x) => x.id === ORDER && !x.saleId), 'sale de la lista para cobrar');
  if (!coca.unlimitedStock) assert.strictEqual(Number((await vProduct('7790895000997')).stock), before - 1, 'el stock baja por la venta');
  // Otra venta con el mismo pedido no le cambia la venta
  const again = await ventra('POST', '/sales', { sessionId: session.id, items: [{ productId: coca.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 3800 }], goOrderId: ORDER });
  assert.ok(again.status < 300);
  assert.strictEqual((await ventra('GET', '/go/orders')).body.find((x) => x.id === ORDER).saleId, sale.body.id);
});
await t('repartidor: entrega; la caja ve el pedido terminado con lo que se compró', async () => {
  await db.doc(`orders/${ORDER}`).update({ status: 'delivering', pickedUpAt: new Date() });
  await db.doc(`orders/${ORDER}`).update({ status: 'completed', completedAt: new Date() });
  await ventra('POST', '/go/sync-now');
  const o = (await ventra('GET', '/go/orders')).body.find((x) => x.id === ORDER);
  assert.strictEqual(o.status, 'completed');
  assert.strictEqual(o.items[2].shopStatus, 'missing');
  assert.strictEqual(o.customer, 'Lucía', 'solo el nombre de pila');
});
await t('pedido sin nada en el local: se cancela sin cargo', async () => {
  const coca = await byBarcode('7790895001000');
  const r = await order([[coca, 2]]);
  const id = r.body.orders[0].docId;
  await db.doc(`orders/${id}`).update({ driverId: cadeteUid, status: 'accepted' });
  const c = await go('shopperCheckout', { orderId: id, results: { 0: { status: 'missing' } } }, cadete.token);
  assert.strictEqual(c.body.cancelled, true);
});
await t('pedido: más que el tope no se puede; por transferencia sí', async () => {
  const aceite = await byBarcode('7790387000048'); // 3100 x 13 = 40300
  const big = await order([[aceite, 13]]);
  assert.match(big.body.error || '', /tope por pedido/);
  const coca = await byBarcode('7790895000997');
  const tr = await order([[coca, 1]], { paymentMethod: 'mercadopago' });
  assert.strictEqual(tr.status, 200, JSON.stringify(tr.body));
  await db.doc(`orders/${tr.body.orders[0].docId}`).update({ status: 'cancelled', cancelReason: 'Cancelado por el cliente', cancelledBy: 'client' });
});
await t('caja: números de GO (vendido, entregados, faltantes, cancelados)', async () => {
  await ventra('POST', '/go/sync-now');
  const s = (await ventra('GET', '/go/stats')).body;
  assert.strictEqual(s.delivered, 1);
  assert.strictEqual(s.revenue, 3800 + 950);
  assert.strictEqual(s.avgTicket, 4750);
  assert.strictEqual(s.cancelled, 2);
  assert.ok(s.missing.some((m) => /Yerba/.test(m.name)), 'la yerba aparece entre lo que faltó');
  assert.ok(s.missing.some((m) => /Coca-Cola 500/.test(m.name)));
  assert.deepStrictEqual(s.topProducts.map((p) => p.name).sort(), ['Alfajor Guaymallén Triple', 'Coca-Cola 2,25 L']);
  assert.ok(s.cancelReasons.some((r) => /No había ninguno/.test(r.reason)));
});
await t('caja: el cajero ve los pedidos pero no los números ni la configuración', async () => {
  const lc = await fetch(`${VENTRA}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'CAJERO', password: VENTRA_PASS }) }).then((r) => r.json());
  const h = { Authorization: `Bearer ${lc.accessToken}` };
  assert.strictEqual((await fetch(`${VENTRA}/go/orders`, { headers: h })).status, 200);
  assert.strictEqual((await fetch(`${VENTRA}/go/stats`, { headers: h })).status, 403);
  assert.strictEqual((await fetch(`${VENTRA}/go/settings`, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const st = await fetch(`${VENTRA}/go/status`, { headers: h }).then((r) => r.json());
  assert.ok(!('api_key' in st) && !('apiKey' in st), 'la clave nunca sale de la caja');
});
// SIM_KEEP=1: deja todo armado para recorrer las pantallas (caja vinculada y un pedido nuevo esperando repartidor)
if (process.env.SIM_KEEP) {
  const many = await goProducts();
  const pick = (code) => many.find((p) => p.barcode === code);
  const r = await order([[pick('7790895000997'), 1], [pick('7790580000035'), 2], [pick('7622300000011'), 1], [pick('7790895001031'), 2],
    [pick('7790387000024'), 1], [pick('7790742000017'), 2], [pick('7791290000031'), 1], [pick('7790580000042'), 1]]);
  console.log('Pedido nuevo para el repartidor:', r.status, r.body?.orders?.[0]?.docId || JSON.stringify(r.body));
  await ventra('POST', '/go/sync-now');
  console.log(`
${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
}
await t('caja: desvincular deja la clave sin efecto en GO', async () => {
  const r = await ventra('POST', '/go/unlink');
  assert.strictEqual(r.body.linked, false);
  const keys = await db.collection('ventra_keys').where('comercioId', '==', CID).get();
  assert.strictEqual(keys.size, 0);
});

console.log(`\n${ok} bien, ${bad} con falla`);
process.exit(bad ? 1 : 0);
