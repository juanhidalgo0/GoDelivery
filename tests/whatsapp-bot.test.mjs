// Bot de WhatsApp (functions/whatsapp/): conversaciones completas contra el webhook real, con
// los triggers reales, en el emulador. Los mensajes que el bot "manda" quedan en wa_outbox.
//
//   FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --config firebase.emulators-auth.json --only functions,firestore,auth --project demo-godelivery "node tests/whatsapp-bot.test.mjs"
//
// Cubre: menú, mandado de compra y de envío, pedido escrito a un comercio (precio, rechazo y
// pase a mandado), link al catálogo, avisos de estado, soporte, cadete para comercios,
// cancelar desde "Mis pedidos", mensajes repetidos, pausa cuando contesta una persona, modo prueba
// (lista de números) y reglas.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, arrayUnion } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const FN_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const WEBHOOK = `http://${FN_HOST}/${PROJECT}/us-central1/whatsappWebhook`;

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8') },
});

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label); }
  else { fail++; failures.push(label); console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}
async function throws(fn) { try { await fn(); return false; } catch { return true; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(400); }
  return null;
}
async function asAdmin(fn) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); });
  return out;
}
const docData = (p) => asAdmin(async (db) => { const x = await getDoc(doc(db, p)); return x.exists() ? x.data() : null; });
const ordersOf = (waId) => asAdmin(async (db) => (await getDocs(query(collection(db, 'orders'), where('waPhone', '==', waId)))).docs.map((d) => ({ id: d.id, ...d.data() })));
const quotesOf = (waId) => asAdmin(async (db) => (await getDocs(query(collection(db, 'wa_quotes'), where('waPhone', '==', waId)))).docs.map((d) => ({ id: d.id, ...d.data() })));

// ── Mensajes simulados de Meta ──
let msgSeq = 0;
async function post(body) {
  const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`webhook respondió ${res.status}`);
}
async function incoming(from, message, name = 'Cliente Test') {
  const m = { from, id: `wamid.test.${++msgSeq}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message };
  await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name } }], messages: [m] } }] }] });
  return m;
}
const text = (from, body, name) => incoming(from, { type: 'text', text: { body } }, name);
const tap = (from, id, title = id) => incoming(from, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const pick = (from, id, title = id) => incoming(from, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const loc = (from, latitude, longitude, address = '') => incoming(from, { type: 'location', location: { latitude, longitude, address } });

// ── Lo que contestó el bot ──
const seen = {};
async function outbox(to) {
  return asAdmin(async (db) => (await getDocs(query(collection(db, 'wa_outbox'), where('to', '==', to)))).docs
    .map((d) => d.data()).sort((a, b) => a.at - b.at));
}
// Mensajes nuevos para `to` desde la última vez que se miró. El banner (imagen) y las reacciones
// quedan aparte en `extras`, para que los checks de cada paso miren el mensaje con texto.
const extras = {};
async function replies(to, { wait = 0, min = 1 } = {}) {
  const got = await waitFor(async () => { const all = await outbox(to); return all.length - (seen[to] || 0) >= min ? all : null; }, wait || 1500)
    || await outbox(to);
  const fresh = got.slice(seen[to] || 0).map((o) => o.payload);
  seen[to] = got.length;
  const side = (p) => p.type === 'image' || p.type === 'reaction';
  extras[to] = fresh.filter(side);
  return fresh.filter((p) => !side(p));
}
const bodyOf = (p) => (p.type === 'text' ? p.text.body : p.interactive.body.text);
const headedOf = (p) => [p.interactive?.header?.text, bodyOf(p)].filter(Boolean).join('\n');
const linkOf = (p) => (p && p.interactive?.type === 'cta_url' ? p.interactive.action.parameters.url : '');
const idsOf = (p) => {
  if (p.type !== 'interactive') return [];
  if (p.interactive.type === 'button') return p.interactive.action.buttons.map((b) => b.reply.id);
  if (p.interactive.type === 'list') return p.interactive.action.sections.flatMap((s) => s.rows.map((r) => r.id));
  return [];
};
const allText = (ps) => ps.map(bodyOf).join('\n---\n');
const isMenu = (p) => p && p.interactive?.type === 'list' && ['m_compra', 'm_humano'].every((id) => idsOf(p).includes(id));

// ── Datos ──
const CENTER = { lat: -35.0811, lng: -57.5146 };
await asAdmin(async (db) => {
  await setDoc(doc(db, 'settings', 'global'), { deliveryMinPrice: 1500, deliveryBasePrice: 1500, deliveryPricePerKm: 300, rainMode: 'off', favorPurchaseFee: 800, appUsageFeeRate: 0.05 });
  await setDoc(doc(db, 'settings', 'settings'), { lastOrderId: 100 });
  // Las charlas de siempre se prueban por el chat; el formulario nativo tiene su sección (14)
  // notify: los avisos de seguimiento están apagados por defecto; acá se prenden para probarlos (la 14 los prueba apagados)
  await setDoc(doc(db, 'settings', 'whatsapp_bot'), { form: false, notify: true });
  // Estas charlas prueban el camino paso a paso con banner; el camino corto y el tope tienen su sección (16)
  await setDoc(doc(db, 'wa_config', 'bot'), { short: false, banner: true });
  await setDoc(doc(db, 'users', 'driver1'), { isOnline: true, role: 'delivery', displayName: 'Juan Cadete' });
  await setDoc(doc(db, 'users', 'cliente1'), { phone: '2215550001', displayName: 'Ana Pérez', role: 'user' });
  await setDoc(doc(db, 'users', 'dueno1'), { role: 'comercio', displayName: 'Pepe' });
  await setDoc(doc(db, 'users', 'dueno2'), { role: 'comercio', displayName: 'Otro' });
  await setDoc(doc(db, 'comercios', 'pizza'), { name: 'Pizzería Don Pepe', approvedByAdmin: true, isActive: true, ownerId: 'dueno1', coords: { lat: -35.083, lng: -57.516 }, phone: '2215559999', category: 'Pizzería' });
  await setDoc(doc(db, 'comercios', 'burger'), { name: 'Burger Go', approvedByAdmin: true, isActive: true, ownerId: 'dueno2', coords: { lat: -35.08, lng: -57.51 }, category: 'Hamburguesas' });
  await setDoc(doc(db, 'comercios', 'burger', 'products', 'p1'), { name: 'Hamburguesa', price: 5000, isAvailable: true });
  await setDoc(doc(db, 'comercios', 'paulos'), { name: 'Kiosco Paulos', approvedByAdmin: false, isActive: true });
  await setDoc(doc(db, 'comercios', 'sanjavier'), { name: 'Carnicería San Javier', approvedByAdmin: false, isActive: true });
  await setDoc(doc(db, 'mandadoPlaces', 'el-lucianito'), { name: 'El Lucianito', lat: -35.08, lng: -57.51 });
  await setDoc(doc(db, 'giveaways', 'g1'), { title: 'Sorteo de Prueba', subtitle: 'Un premio', active: true, status: 'active', targetAudience: 'all', endsAt: new Date(Date.now() + 7 * 864e5) });
  await setDoc(doc(db, 'comercios', 'cerrado'), { name: 'Heladería Cerrada', approvedByAdmin: true, isActive: true, ownerId: 'dueno2', weeklySchedule: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } });
});

// ═════ 1. Menú ═════
console.log('\n1. Menú');
const A = '5492215551111';
await text(A, 'hola', 'Carla');
let r = await replies(A);
check('responde con el menú desplegable', r.length === 1 && isMenu(r[0]) && ['m_compra', 'm_envio', 'm_comercio', 'm_pedidos', 'm_puntos', 'm_humano'].every((id) => idsOf(r[0]).includes(id)), idsOf(r[0]).join(','));
check('el menú va por secciones con pie', r[0].interactive.action.sections.map((x) => x.title).join('|') === 'Pedir|Mi cuenta|Ayuda' && r[0].interactive.footer?.text === 'GO! Delivery · Magdalena', JSON.stringify(r[0].interactive.action.sections.map((x) => x.title)));
check('saluda por el nombre', bodyOf(r[0]).includes('Carla'));
check('el primer saludo del día trae el banner arriba', extras[A].length === 1 && extras[A][0].type === 'image' && extras[A][0].image.link.endsWith('/wa-banner.jpg') && extras[A][0].image.caption.includes('GO! Delivery'), JSON.stringify(extras[A]));
await text(A, 'menu');
r = await replies(A);
check('el banner sale una sola vez por día', isMenu(r[0]) && extras[A].length === 0, JSON.stringify(extras[A]));
await tap(A, 'm_more');
r = await replies(A);
check('"Más opciones" (botón de mensajes viejos) sigue andando', r[0].interactive?.type === 'list' && ['m_comercio', 'm_pedidos', 'm_puntos', 'm_humano'].every((id) => idsOf(r[0]).includes(id)), idsOf(r[0]).join(','));

// ═════ 2. Mandado de compra ═════
console.log('\n2. Mandado de compra');
await pick(A, 'm_compra');
r = await replies(A);
check('pregunta en qué comercio', bodyOf(r[0]).includes('qué comercio'), bodyOf(r[0]));
await tap(A, 'd_done');
r = await replies(A);
check('sin comercio no avanza', bodyOf(r[0]).includes('nombre del comercio'), bodyOf(r[0]));
await text(A, 'Almacén Don José');
r = await replies(A);
check('pregunta qué comprar en ese comercio', bodyOf(r[0]).includes('Almacén Don José'), bodyOf(r[0]));
await tap(A, 'd_done');
r = await replies(A);
check('sin lista no avanza', bodyOf(r[0]).includes('Todavía no me dijiste'), bodyOf(r[0]));
await text(A, '2 kg de papa y una lavandina');
r = await replies(A);
check('anota y ofrece Listo u Otro comercio', idsOf(r[0]).includes('d_done') && idsOf(r[0]).includes('c_more'));
await text(A, 'y un sachet de leche');
await replies(A);
await tap(A, 'c_more');
r = await replies(A);
check('pide el otro comercio', bodyOf(r[0]).includes('otro comercio'), bodyOf(r[0]));
await text(A, 'Farmacia Pasteur');
await replies(A);
await text(A, 'un ibuprofeno');
await replies(A);
await tap(A, 'd_done');
r = await replies(A);
check('pide la ubicación de entrega', r[0].interactive?.type === 'location_request_message');
await loc(A, -35.09, -57.52, 'Calle 12 450');
r = await replies(A);
check('pide datos para encontrarlo', idsOf(r[0]).includes('n_none'));
await text(A, 'timbre 2B');
r = await replies(A);
check('pregunta cómo paga', idsOf(r[0]).includes('p_efectivo') && idsOf(r[0]).includes('p_transferencia'));
await tap(A, 'p_efectivo');
r = await replies(A);
const sumA = bodyOf(r[0]);
check('muestra el resumen con total', sumA.includes('Total:') && sumA.includes('lavandina') && sumA.includes('leche'), sumA);
check('el resumen cobra el servicio de compra', sumA.includes('Servicio de compra: $800'), sumA);
check('el resumen lista cada comercio y cobra la parada extra', sumA.includes('Almacén Don José') && sumA.includes('Farmacia Pasteur') && sumA.includes('Paradas extra (1): $500'), sumA);
check('confirmar / cancelar', idsOf(r[0]).includes('c_ok'));
await tap(A, 'c_ok');
r = await replies(A);
check('confirma con número de pedido', /Pedido #101/.test(headedOf(r[0])), headedOf(r[0]));
let oA = (await ordersOf(A))[0];
check('pedido creado como compra del bot', oA && oA.source === 'whatsapp_bot' && oA.isFavor === true && oA.favorType === 'compra');
check('compra sale del centro, va a la ubicación', oA.pickupCoords?.lat === CENTER.lat && oA.deliveryCoords?.lat === -35.09);
check('guarda detalle, datos y pago', oA.details.includes('leche') && oA.addressNotes === 'timbre 2B' && oA.paymentMethod === 'efectivo');
check('total = envío + compra + parada extra + uso de app', oA.total === oA.deliveryCost + oA.purchaseFee + oA.extraStopsFee + oA.appUsageFee && oA.purchaseFee === 800 && oA.extraStopsFee === 500 && oA.deliveryCost >= 1500, JSON.stringify({ t: oA.total, d: oA.deliveryCost, p: oA.purchaseFee, e: oA.extraStopsFee, f: oA.appUsageFee }));
check('cada comercio queda como parada, como en la app', oA.stopsCount === 2 && oA.mandadoStops?.length === 2 && oA.mandadoStops[0].store === 'Almacén Don José' && oA.mandadoStops[0].items.includes('leche') && oA.mandadoStops[1].store === 'Farmacia Pasteur' && oA.pickupAddress === 'Múltiples comercios (2 comercios)', JSON.stringify(oA.mandadoStops));
check('el detalle usa el formato que lee el panel', oA.details.includes('🏪 1. Comercio: Almacén Don José') && oA.details.includes('📦 Pedido: un ibuprofeno'), oA.details);
check('cliente sin cuenta: se identifica por el número', oA.userId === A);
check('el pedido lleva su llave de seguimiento', typeof oA.trackingToken === 'string' && oA.trackingToken.length >= 20);
check('la confirmación trae el botón de seguimiento en vivo', linkOf(r[0]).endsWith(`/en-vivo/${oA.trackingToken}`) && !bodyOf(r[0]).includes('/en-vivo/'), JSON.stringify(r[0]));
check('con encabezado y pie', r[0].interactive.header?.text.includes('#101') && r[0].interactive.footer?.text === 'GO! Delivery · Magdalena');
check('la confirmación es un solo mensaje (sin 👍, que también se cobra)', r.length === 1 && extras[A].length === 0, JSON.stringify(extras[A]));
check('y dice que el seguimiento está en el link', bodyOf(r[0]).includes('Seguir en vivo'), bodyOf(r[0]));
const uA = await docData(`users/${A}`);
check('el cliente de WhatsApp queda como usuario de GO!', uA && uA.isWhatsAppClient === true && uA.role === 'user' && uA.points === 0 && !!uA.displayName && uA.waPhone === A);
check('no queda paso a medias', (await docData(`wa_sessions/${A}`)).step === 'idle');

// ═════ 3. Avisos de estado ═════
console.log('\n3. Avisos de estado');
await asAdmin((db) => updateDoc(doc(db, 'orders', oA.id), { driverId: 'driver1', driverName: 'Juan Cadete', status: 'accepted' }));
r = await replies(A, { wait: 15000 });
check('avisa quién tomó el pedido', allText(r).includes('Juan Cadete'), allText(r));
check('con el botón para verlo en el mapa', r.some((p) => linkOf(p).endsWith(`/en-vivo/${oA.trackingToken}`)) && !allText(r).includes('/en-vivo/'), JSON.stringify(r));
await asAdmin((db) => updateDoc(doc(db, 'orders', oA.id), { isAtDoor: true }));
r = await replies(A, { wait: 15000 });
check('avisa que llegó', allText(r).includes('llegó'), allText(r));
await asAdmin((db) => updateDoc(doc(db, 'orders', oA.id), { status: 'completed' }));
r = await replies(A, { wait: 15000 });
check('avisa que se entregó', allText(r).includes('entregado'), allText(r));

// ═════ 4. Envío con dirección guardada y cliente con cuenta ═════
console.log('\n4. Envío (encomienda) y cliente con cuenta');
const B = '5492215550001';
await pick(B, 'm_envio');
await replies(B);
await text(B, 'Unas llaves');
await replies(B);
await text(B, 'listo');
r = await replies(B);
check('"listo" escrito equivale al botón: pide dónde retirar', r[0].interactive?.type === 'location_request_message' && bodyOf(r[0]).includes('retiramos'));
await text(B, 'Avenida 9 de Julio 800');
r = await replies(B);
check('pide adónde llevar', r[0].interactive?.type === 'location_request_message');
await loc(B, -35.07, -57.5);
await replies(B);
await tap(B, 'n_none');
await replies(B);
await text(B, 'transferencia');
r = await replies(B);
check('"transferencia" escrito elige el pago', bodyOf(r[0]).includes('Transferencia'));
check('envío sin servicio de compra', !bodyOf(r[0]).includes('Servicio de compra'));
await text(B, 'dale');
r = await replies(B);
check('"dale" confirma', /Pedido #\d+/.test(headedOf(r[0])), headedOf(r[0]));
const oB = (await ordersOf(B))[0];
check('encomienda creada', oB && oB.favorType === 'mandado' && oB.pickupAddress === 'Avenida 9 de Julio 800' && oB.paymentMethod === 'transferencia');
check('número con cuenta en la app: el pedido queda a su nombre', oB.userId === 'cliente1' && oB.userName === 'Ana Pérez');
check('con cuenta en la app no se crea otro usuario', !(await docData(`users/${B}`)));

// Segundo pedido: ofrece la dirección anterior
await pick(B, 'm_compra');
await replies(B);
await text(B, 'Panadería La Unión');
await replies(B);
await text(B, 'pan');
await replies(B);
await tap(B, 'd_done');
r = await replies(B);
check('ofrece la dirección de la vez pasada', idsOf(r[0]).includes('a_last'));
check('una pregunta de sí/no va con botones a la vista, no en desplegable', r[0].interactive?.type === 'button', r[0].interactive?.type);
await tap(B, 'a_last');
r = await replies(B);
check('con la dirección guardada pasa directo al pago', idsOf(r[0]).includes('p_efectivo'));
await text(B, 'cancelar');
r = await replies(B);
check('cancelar corta el pedido', bodyOf(r[0]).includes('cancelado'));
check('no se creó otro pedido', (await ordersOf(B)).length === 1);

// ═════ 5. Comercio sin catálogo: el comercio pone el precio ═════
console.log('\n5. Pedido escrito a un comercio');
const C = '5492215552222';
await pick(C, 'm_comercio');
r = await replies(C);
const kIds = idsOf(r[0]);
check('lista los comercios abiertos', kIds.includes('k:pizza') && kIds.includes('k:burger'), kIds.join(','));
check('no lista los cerrados', !kIds.includes('k:cerrado'));
check('ofrece buscar otro', kIds.includes('k_other'));
await text(C, 'don pepe');
r = await replies(C);
check('encuentra el comercio por nombre', bodyOf(r[0]).includes('Pizzería Don Pepe'), bodyOf(r[0]));
await text(C, '2 muzzas grandes');
r = await replies(C);
check('anota el pedido', idsOf(r[0]).includes('d_done'));
await tap(C, 'd_done');
await replies(C);
await text(C, 'Calle 10 número 123 entre 5 y 6');
await replies(C);
await tap(C, 'n_none');
await replies(C);
await tap(C, 'p_efectivo');
r = await replies(C);
check('el resumen explica que el comercio pone el precio', bodyOf(r[0]).includes('si lo tiene y cuánto sale'), bodyOf(r[0]));
await tap(C, 'c_ok');
r = await replies(C);
check('avisa que le preguntamos al comercio', bodyOf(r[0]).includes('Le preguntamos'));
let qC = (await quotesOf(C))[0];
check('consulta creada esperando al comercio', qC && qC.status === 'waiting' && qC.comercioId === 'pizza' && qC.requestText === '2 muzzas grandes');
check('dirección escrita sin coordenadas', qC.deliveryAddress.startsWith('Calle 10') && qC.deliveryCoords === null);
await text(C, 'y?');
r = await replies(C);
check('mientras espera, le dice que siga esperando', bodyOf(r[0]).includes('esperando'));

// Reglas: solo el dueño responde, una vez, con un precio válido
const pepe = env.authenticatedContext('dueno1').firestore();
const otro = env.authenticatedContext('dueno2').firestore();
const cli = env.authenticatedContext('cliente1').firestore();
check('otro comercio no la ve', await throws(() => getDoc(doc(otro, 'wa_quotes', qC.id))));
check('un cliente no la ve', await throws(() => getDoc(doc(cli, 'wa_quotes', qC.id))));
check('el dueño la ve', !(await throws(() => getDoc(doc(pepe, 'wa_quotes', qC.id)))));
check('otro comercio no puede responder', await throws(() => updateDoc(doc(otro, 'wa_quotes', qC.id), { status: 'quoted', price: 1 })));
check('el dueño no puede tocar el teléfono', await throws(() => updateDoc(doc(pepe, 'wa_quotes', qC.id), { customerPhone: 'x' })));
check('precio inválido rechazado', await throws(() => updateDoc(doc(pepe, 'wa_quotes', qC.id), { status: 'quoted', price: 0 })));
check('el dueño responde el precio', !(await throws(() => updateDoc(doc(pepe, 'wa_quotes', qC.id), { status: 'quoted', price: 10000, prepMinutes: 20, commerceNote: 'Salen en 20' }))));
check('no puede responder dos veces', await throws(() => updateDoc(doc(pepe, 'wa_quotes', qC.id), { status: 'rejected' })));

r = await replies(C, { wait: 15000 });
const priceMsg = r.find((p) => idsOf(p).some((i) => i.startsWith('q_ok:')));
check('al cliente le llega el precio con botones', !!priceMsg, allText(r));
check('el mensaje muestra productos, envío y total', priceMsg && bodyOf(priceMsg).includes('Productos: $10.000') && bodyOf(priceMsg).includes('Total:'), priceMsg && bodyOf(priceMsg));
check('incluye la aclaración del comercio', priceMsg && bodyOf(priceMsg).includes('Salen en 20'));
qC = (await quotesOf(C))[0];
check('precio calculado guardado en la consulta', qC.pricing && qC.pricing.subtotal === 10000 && qC.pricing.appUsageFee === 500);
await tap(C, `q_ok:${qC.id}`);
r = await replies(C);
check('confirma el pedido', /Pedido #\d+ confirmado/.test(headedOf(r[0])), headedOf(r[0]));
const oC = (await ordersOf(C))[0];
check('pedido de comercio ya aceptado', oC && oC.comercioId === 'pizza' && oC.status === 'confirmed' && oC.preparationTimeMinutes === 20);
check('total igual al que vio el cliente', oC.total === qC.pricing.total && oC.subtotal === 10000 && oC.total === 10000 + oC.deliveryCost + 500);
check('el comercio ve qué pidió', oC.items[0].notes.includes('2 muzzas grandes'));
check('consulta marcada como aceptada', (await quotesOf(C))[0].status === 'accepted');
await tap(C, `q_ok:${qC.id}`);
r = await replies(C);
check('tocar Confirmar de nuevo no duplica', bodyOf(r[0]).includes('ya está confirmado') && (await ordersOf(C)).length === 1, bodyOf(r[0]));

// ═════ 6. El comercio no lo tiene → mandado ═════
console.log('\n6. Rechazo y pase a mandado');
await pick(C, 'm_comercio');
await replies(C);
await pick(C, 'k:pizza');
await replies(C);
await text(C, 'una fugazzeta');
await replies(C);
await tap(C, 'd_done');
r = await replies(C);
check('ofrece la dirección anterior', idsOf(r[0]).includes('a_last'));
await tap(C, 'a_last');
await replies(C);
await tap(C, 'p_efectivo');
await replies(C);
await tap(C, 'c_ok');
await replies(C);
const qC2 = (await quotesOf(C)).find((q) => q.status === 'waiting');
await updateDoc(doc(pepe, 'wa_quotes', qC2.id), { status: 'rejected', rejectReason: 'No tengo lo que pide' });
r = await replies(C, { wait: 15000 });
const rej = r.find((p) => idsOf(p).some((i) => i.startsWith('qm:')));
check('avisa el rechazo con el motivo y ofrece mandado', rej && bodyOf(rej).includes('No tengo lo que pide'), allText(r));
await tap(C, `qm:${qC2.id}`);
r = await replies(C, { min: 2 });
check('pasa a mandado con lo que ya contó', allText(r).includes('fugazzeta') && r.some((p) => idsOf(p).includes('c_ok')), allText(r));
await tap(C, 'c_ok');
r = await replies(C);
const oC2 = (await ordersOf(C)).find((o) => o.isFavor);
check('mandado creado desde la consulta rechazada', oC2 && oC2.favorType === 'compra' && oC2.details.includes('fugazzeta'));
check('con el comercio de la consulta como parada', oC2 && oC2.mandadoStops?.[0]?.store === 'Pizzería Don Pepe' && oC2.mandadoStops[0].items.includes('fugazzeta'), JSON.stringify(oC2 && oC2.mandadoStops));

// Consulta vencida
await pick(C, 'm_comercio'); await replies(C);
await pick(C, 'k:pizza'); await replies(C);
await text(C, 'faina'); await replies(C);
await tap(C, 'd_done'); await replies(C);
await tap(C, 'a_last'); await replies(C);
await tap(C, 'p_efectivo'); await replies(C);
await tap(C, 'c_ok'); await replies(C);
const qC3 = (await quotesOf(C)).find((q) => q.status === 'waiting');
await asAdmin((db) => updateDoc(doc(db, 'wa_quotes', qC3.id), { status: 'expired' }));
r = await replies(C, { wait: 15000 });
check('si el comercio no responde, ofrece mandado', allText(r).includes('no respondió a tiempo'), allText(r));

// ═════ 7. Comercio con catálogo y comercio cerrado ═════
console.log('\n7. Catálogo y comercios cerrados');
const D = '5492215553333';
await pick(D, 'm_comercio'); await replies(D);
await pick(D, 'k:burger');
r = await replies(D);
check('con catálogo: ofrece ver menú o escribir', idsOf(r[0]).includes('k_menu') && idsOf(r[0]).includes('k_write'));
await tap(D, 'k_menu');
r = await replies(D);
check('manda el link a la tienda', r[0].interactive?.type === 'cta_url' && r[0].interactive.action.parameters.url.endsWith('/#/tienda/burger-go'));
await pick(D, 'm_comercio'); await replies(D);
await text(D, 'heladeria cerrada');
r = await replies(D);
check('comercio cerrado: lo dice y ofrece mandado', bodyOf(r[0]).includes('cerrado') && idsOf(r[0]).includes('m_compra'), bodyOf(r[0]));
await pick(D, 'm_comercio'); await replies(D);
await text(D, 'la verduleria de enfrente');
r = await replies(D);
check('comercio que no está en GO: ofrece mandado', bodyOf(r[0]).includes('No encontré') && idsOf(r[0]).includes('m_compra'));
await tap(D, 'm_compra');
r = await replies(D);
check('el mandado recuerda dónde comprar', bodyOf(r[0]).includes('la verduleria de enfrente'), bodyOf(r[0]));

// ═════ 8. Mis pedidos y cancelar ═════
console.log('\n8. Mis pedidos');
const E = '5492215554444';
await pick(E, 'm_compra'); await replies(E);
await text(E, 'Kiosco Al Paso'); await replies(E);
await text(E, 'cigarrillos'); await replies(E);
await tap(E, 'd_done'); await replies(E);
await loc(E, -35.08, -57.51); await replies(E);
await tap(E, 'n_none'); await replies(E);
await tap(E, 'p_efectivo'); await replies(E);
await tap(E, 'c_ok'); await replies(E);
const oE = (await ordersOf(E))[0];
await pick(E, 'm_pedidos');
r = await replies(E);
check('lista el pedido en curso', bodyOf(r[0]).includes(`#${oE.orderId}`) && bodyOf(r[0]).includes('Buscando cadete'), bodyOf(r[0]));
check('ofrece cancelarlo', idsOf(r[0]).includes(`oc:${oE.id}`));
await tap(E, `oc:${oE.id}`);
r = await replies(E);
check('lo cancela', bodyOf(r[0]).includes('cancelé'));
check('pedido cancelado por el cliente', (await docData(`orders/${oE.id}`)).status === 'cancelled' && (await docData(`orders/${oE.id}`)).cancelledBy === 'cliente');
r = await replies(E, { wait: 4000, min: 1 });
check('no manda un segundo aviso de cancelación', r.length === 0, allText(r));

// ═════ 9. Soporte ═════
console.log('\n9. Soporte');
await pick(E, 'm_humano');
r = await replies(E);
check('pasa con una persona', bodyOf(r[0]).includes('persona'));
await text(E, 'Hola, me cobraron mal');
r = await replies(E, { wait: 2000, min: 1 });
check('el bot no contesta mientras habla con soporte', r.length === 0);
const sup = await docData(`support_chats/${E}`);
check('el mensaje llega al panel de soporte', sup && sup.source === 'whatsapp_bot' && sup.unreadByAdmin === true && sup.messages.some((m) => m.text === 'Hola, me cobraron mal'));
await asAdmin((db) => updateDoc(doc(db, 'support_chats', E), { unreadByUser: true, messages: arrayUnion({ sender: 'admin', text: 'Ya lo revisamos, perdón', timestamp: Date.now() }) }));
r = await replies(E, { wait: 15000 });
check('la respuesta del equipo le llega por WhatsApp', allText(r).includes('Ya lo revisamos'), allText(r));
await text(E, 'menu');
r = await replies(E);
check('"menú" sale de soporte', isMenu(r[0]));

// ═════ 10. Comercio que pide cadete ═════
console.log('\n10. Cadete para un comercio');
const P = '5492215559999';
await text(P, 'hola');
r = await replies(P);
check('al comercio le ofrece pedir cadete', idsOf(r[0]).includes('m_cadete'));
await text(P, 'pedido');
r = await replies(P);
check('una palabra suelta ya no crea un cadete', (await ordersOf(P)).length === 0);
await pick(P, 'm_cadete'); await replies(P);
await tap(P, 'cd_ok');
r = await replies(P);
check('pide el cadete', bodyOf(r[0]).includes('Cadete pedido'));
const oP = (await ordersOf(P))[0];
check('pedido de cadetería del comercio', oP && oP.isCommerceCadeteria === true && oP.comercioId === 'pizza');

// ═════ 11. Repetidos, pausa humana y sin cadetes ═════
console.log('\n11. Casos de borde');
const F = '5492215556666';
const dup = { from: F, id: 'wamid.dup.1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hola' } };
const dupBody = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: F, profile: { name: 'F' } }], messages: [dup] } }] }] };
await post(dupBody); await post(dupBody);
r = await replies(F, { wait: 2000 });
check('un mensaje repetido por Meta se contesta una sola vez', r.length === 1);
await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ from: '5492210000000', to: F, id: 'wamid.echo.1', type: 'text', text: { body: 'Hola, te atiendo yo' } }] } }] }] });
await text(F, 'gracias!');
r = await replies(F, { wait: 2000, min: 1 });
check('si el dueño contestó a mano, el bot no se mete', r.length === 0);
const old = { from: '5492215557777', id: 'wamid.old.1', timestamp: String(Math.floor(Date.now() / 1000) - 3600), type: 'text', text: { body: 'hola' } };
await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [old] } }] }] });
r = await replies('5492215557777', { wait: 1500, min: 1 });
check('un mensaje de hace una hora no se contesta', r.length === 0);
await asAdmin((db) => updateDoc(doc(db, 'users', 'driver1'), { isOnline: false }));
const G = '5492215558888';
await pick(G, 'm_compra'); await replies(G);
await text(G, 'Kiosco'); await replies(G);
await text(G, 'algo'); await replies(G);
await tap(G, 'd_done'); await replies(G);
await loc(G, -35.08, -57.51); await replies(G);
await tap(G, 'n_none'); await replies(G);
await tap(G, 'p_efectivo'); await replies(G);
await tap(G, 'c_ok');
r = await replies(G);
check('sin cadetes conectados: avisa y no crea el pedido', bodyOf(r[0]).includes('no hay cadetes') && (await ordersOf(G)).length === 0);
check('ofrece avisarle cuando haya', idsOf(r[0]).includes('w_yes'));
await tap(G, 'w_yes');
r = await replies(G);
check('queda en la lista de espera', !!(await docData(`wa_waitlist/${G}`)) && bodyOf(r[0]).includes('te aviso'), bodyOf(r[0]));
await asAdmin((db) => updateDoc(doc(db, 'users', 'driver1'), { isOnline: true }));
r = await replies(G, { wait: 20000 });
check('cuando se conecta un cadete, le avisa con Confirmar', r.some((p) => bodyOf(p).includes('Ya hay un cadete') && idsOf(p).includes('c_ok')), allText(r));
await tap(G, 'c_ok');
r = await replies(G);
check('y con Confirmar se crea el pedido guardado', (await ordersOf(G)).length === 1 && !(await docData(`wa_waitlist/${G}`)), allText(r));
await asAdmin((db) => updateDoc(doc(db, 'users', 'driver1'), { isOnline: false }));
const verify = await fetch(`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=123`);
check('la verificación de Meta rechaza un token equivocado', verify.status === 403);

// ═════ 12. Modo prueba (lista de números) ═════
console.log('\n12. Modo prueba');
const T1 = '5492215550010', T2 = '5492215550011', NO = '5492215550099';
await asAdmin((db) => setDoc(doc(db, 'wa_config', 'test_mode'), {
  enabled: true,
  numbers: [{ phone: '2215550010', label: 'Yo' }, '5492215550011'],
}));
await text(T1, 'hola');
r = await replies(T1, { wait: 4000 });
check('modo prueba: contesta a un número de la lista', r.length === 1 && isMenu(r[0]));
await text(T2, 'hola');
r = await replies(T2, { wait: 4000 });
check('modo prueba: reconoce el número escrito completo, con 549', r.length === 1);
const mNo = await text(NO, 'hola, ¿venís el domingo?');
r = await replies(NO, { wait: 2500, min: 1 });
check('modo prueba: a un número fuera de la lista no le contesta', r.length === 0);
check('modo prueba: de ese número no guarda nada', !(await docData(`wa_inbound/${mNo.id}`)) && !(await docData(`wa_sessions/${NO}`)));
await post({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ from: '5492210000000', to: NO, id: 'wamid.echo.2', type: 'text', text: { body: 'Sí, el domingo voy' } }] } }] }] });
await sleep(1500);
check('modo prueba: lo que el dueño contesta a un contacto suyo tampoco se guarda', !(await docData(`wa_sessions/${NO}`)));
await asAdmin((db) => updateDoc(doc(db, 'wa_config', 'test_mode'), { enabled: false }));
await text(NO, 'hola');
r = await replies(NO, { wait: 4000 });
check('modo prueba apagado: contesta a todos', r.length === 1);
await asAdmin((db) => setDoc(doc(db, 'users', 'admin1'), { role: 'admin' }));
const adm = env.authenticatedContext('admin1').firestore();
check('el admin ve la lista del modo prueba', !(await throws(() => getDoc(doc(adm, 'wa_config', 'test_mode')))));
check('un cliente no ve la lista del modo prueba', await throws(() => getDoc(doc(cli, 'wa_config', 'test_mode'))));
check('un cliente no puede sumarse a la lista', await throws(() => setDoc(doc(cli, 'wa_config', 'test_mode'), { enabled: true, numbers: ['2215550001'] })));

// ═════ 13. Seguimiento en vivo por link, usuario de WhatsApp y chat ═════
console.log('\n13. Seguimiento en vivo');
const SESSION = `http://${FN_HOST}/${PROJECT}/us-central1/waTrackingSession`;
const session = async (token) => {
  const res = await fetch(SESSION, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const uA2 = await waitFor(async () => { const u = await docData(`users/${A}`); return u && u.completedOrdersCount === 1 ? u : null; }, 15000);
check('al entregarse el pedido suma GoPoints como en la app', uA2 && uA2.points > 0, JSON.stringify(uA2 && { p: uA2.points, c: uA2.completedOrdersCount }));
let sA = await session(oA.trackingToken);
check('el link abre una sesión del cliente de WhatsApp', sA.status === 200 && sA.body.mode === 'session' && typeof sA.body.customToken === 'string' && sA.body.orderId === oA.id, JSON.stringify(sA));
const sB = await session(oB.trackingToken);
check('con cuenta en la app: abre el pedido en la app (sin dar su sesión)', sB.status === 200 && sB.body.mode === 'app' && sB.body.orderId === oB.id && !sB.body.customToken, JSON.stringify(sB));
check('un link inventado no abre nada', (await session('A'.repeat(24))).status === 404 && (await session('../x')).status === 404);
const TK = 'tkActivo_' + 'x'.repeat(20);
await asAdmin(async (db) => {
  await setDoc(doc(db, 'orders', 'waActivo'), { orderId: 900, userId: A, waPhone: A, userName: 'Carla', trackingToken: TK, status: 'delivering', driverId: 'driver1', driverName: 'Juan Cadete', isFavor: true, source: 'whatsapp_bot' });
  await setDoc(doc(db, 'orders', 'waActivo', 'live', 'driver'), { lat: -35.08, lng: -57.51, updatedAt: new Date() });
  await setDoc(doc(db, 'orders', 'waPendiente'), { orderId: 901, userId: A, waPhone: A, userName: 'Carla', trackingToken: 'tkPend_' + 'y'.repeat(20), status: 'pending', isFavor: true, source: 'whatsapp_bot' });
});
await replies(A, { wait: 3000 });
const waCli = env.authenticatedContext(A).firestore();
check('con su sesión ve su pedido y la moto en vivo', !(await throws(() => getDoc(doc(waCli, 'orders', 'waActivo')))) && !(await throws(() => getDoc(doc(waCli, 'orders', 'waActivo', 'live', 'driver')))));
check('no ve pedidos de otros', await throws(() => getDoc(doc(waCli, 'orders', oB.id))));
check('otro usuario no ve el pedido de WhatsApp', await throws(() => getDoc(doc(cli, 'orders', 'waActivo'))));
await replies(A, { wait: 3000 });
check('puede cancelar su pedido mientras nadie lo tomó', !(await throws(() => updateDoc(doc(waCli, 'orders', 'waPendiente'), { status: 'cancelled', cancelledBy: 'client', cancelReason: 'Cancelado por el cliente' }))));
r = await replies(A, { wait: 15000 });
check('cancelado desde el link: el bot lo confirma', allText(r).includes('Cancelaste el pedido #901'), allText(r));
await asAdmin((db) => updateDoc(doc(db, 'orders', 'waActivo'), { status: 'completed', completedAt: new Date(Date.now() - 13 * 3600 * 1000) }));
await replies(A, { wait: 6000 });
sA = await session(TK);
check('terminado hace más de 12 h: el link ya no abre sesión', sA.body.mode === 'ended' && !sA.body.customToken, JSON.stringify(sA));

console.log('\n14. Pedido de corrido y más');
await asAdmin((db) => updateDoc(doc(db, 'users', 'driver1'), { isOnline: true }));
const H = '5492215559001';
await text(H, 'tienen delivery en magdalena?');
r = await replies(H);
check('una pregunta no se toma como pedido (sin IA)', isMenu(r[0]), bodyOf(r[0]));
await text(H, 'una coca de paulos, dos manzanas del lucianito y 1kg de carne de san javier');
r = await replies(H);
const ent = bodyOf(r[0]);
check('entiende el pedido de corrido con reglas (3 comercios)', ent.includes('Entendí esto') && ent.includes('Kiosco Paulos') && ent.includes('El Lucianito') && ent.includes('Carnicería San Javier') && ent.includes('1kg de carne'), ent);
check('pide confirmar o corregir', idsOf(r[0]).includes('p_ok') && idsOf(r[0]).includes('p_fix'));
await tap(H, 'p_ok');
r = await replies(H);
check('confirmado, pide la entrega', r[0].interactive?.type === 'location_request_message');
await loc(H, -35.09, -57.52, 'Calle 12 450');
await replies(H);
await tap(H, 'n_none'); await replies(H);
await tap(H, 'p_efectivo');
r = await replies(H);
check('el resumen cobra 2 paradas extra y ofrece Editar', bodyOf(r[0]).includes('Paradas extra (2): $1.000') && idsOf(r[0]).includes('e_edit'), bodyOf(r[0]));
await tap(H, 'e_edit');
r = await replies(H);
check('Editar muestra qué cambiar', ['e_items', 'e_delivery', 'e_notes', 'e_pay'].every((id) => idsOf(r[0]).includes(id)), idsOf(r[0]).join(','));
await pick(H, 'e_pay'); await replies(H);
await tap(H, 'p_transferencia');
r = await replies(H);
check('después de editar vuelve al resumen con el cambio', bodyOf(r[0]).includes('Transferencia') && idsOf(r[0]).includes('c_ok'), bodyOf(r[0]));
await tap(H, 'c_ok');
await replies(H);
const oH = (await ordersOf(H))[0];
check('pedido con las 3 paradas', oH && oH.mandadoStops?.length === 3 && oH.extraStopsFee === 1000 && oH.paymentMethod === 'transferencia', JSON.stringify(oH && oH.mandadoStops));
await text(H, 'hola');
r = await replies(H);
check('con un pedido anterior, el menú ofrece repetirlo', idsOf(r[0]).includes('m_repeat'), idsOf(r[0]).join(','));
await tap(H, 'm_repeat');
r = await replies(H, { min: 2 });
check('repetir arma el mismo pedido para confirmar', allText(r).includes('Kiosco Paulos') && r.some((p) => idsOf(p).includes('c_ok')), allText(r));
await tap(H, 'e_edit'); await replies(H);
await pick(H, 'e_delivery');
r = await replies(H);
check('cambiar la entrega ofrece la dirección guardada', idsOf(r[0]).includes('a_last') && idsOf(r[0]).includes('a_new'));
await tap(H, 'a_new'); await replies(H);
await loc(H, -35.07, -57.50, 'Calle 5 100'); await replies(H);
await tap(H, 'n_none');
r = await replies(H);
check('con la dirección nueva vuelve al resumen', bodyOf(r[0]).includes('Calle 5 100') && idsOf(r[0]).includes('c_ok'), bodyOf(r[0]));
await tap(H, 'c_ok'); await replies(H);
await tap(H, 'm_compra'); await replies(H);
await text(H, 'Kiosco'); await replies(H);
await text(H, 'chicles'); await replies(H);
await tap(H, 'd_done');
r = await replies(H);
check('con 2 direcciones guardadas, las ofrece en una lista', r[0].interactive?.type === 'list' && ['a_0', 'a_1', 'a_new'].every((id) => idsOf(r[0]).includes(id)), idsOf(r[0]).join(','));
await text(H, 'cancelar'); await replies(H);
await tap(H, 'm_compra'); await replies(H);
await text(H, 'una coca de paulos, carne de San Javier');
r = await replies(H);
check('en el paso del comercio también entiende todo junto', bodyOf(r[0]).includes('Entendí esto') && bodyOf(r[0]).includes('Carnicería San Javier'), bodyOf(r[0]));
await tap(H, 'p_fix');
r = await replies(H, { min: 2 });
check('Corregir vuelve al paso a paso', allText(r).includes('qué comercio'), allText(r));
await text(H, 'cancelar'); await replies(H);
await tap(H, 'm_puntos');
r = await replies(H);
check('Puntos y sorteos muestra los GoPoints y el sorteo abierto', bodyOf(r[0]).includes('Tus GoPoints') && bodyOf(r[0]).includes('Sorteo de Prueba') && idsOf(r[0]).includes('gw:g1'), bodyOf(r[0]));
await tap(H, 'gw:g1');
r = await replies(H);
check('se anota en el sorteo', bodyOf(r[0]).includes('Ya estás participando') && !!(await docData(`giveaways/g1/entries/${H}`)), bodyOf(r[0]));
await tap(H, 'gw:g1');
r = await replies(H);
check('anotarse dos veces no duplica', bodyOf(r[0]).includes('Ya estabas anotado'), bodyOf(r[0]));
const sH = await docData(`wa_sessions/${H}`);
check('la charla queda registrada para el admin', Array.isArray(sH.log) && sH.log.some((l) => l.dir === 'in') && sH.log.some((l) => l.dir === 'out'));

// ═════ 14. Formulario nativo (WhatsApp Flows) ═════
console.log('\n14. Formulario nativo');
await asAdmin((db) => setDoc(doc(db, 'settings', 'whatsapp_bot'), { form: true }));
const FF = '5492215557070';
const formOf = (p) => (p && p.interactive?.type === 'flow' ? p.interactive.action.parameters : null);
const sendForm = (from, data) => incoming(from, { type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify(data) } } });
async function compraHastaEntrega(who, store, items) {
  await text(who, 'hola'); await replies(who);
  await pick(who, 'm_compra'); await replies(who);
  await text(who, store); await replies(who);
  await text(who, items); await replies(who);
  await tap(who, 'd_done');
  return replies(who);
}
r = await compraHastaEntrega(FF, 'Almacén Don José', '2 cocas de 1,5');
let fp = formOf(r[0]);
check('después de la lista manda el formulario "Completar pedido"', !!fp && fp.flow_cta === 'Completar pedido' && fp.flow_action === 'navigate' && fp.flow_action_payload.screen === 'PEDIDO' && !!fp.flow_id, JSON.stringify(r[0]));
check('el formulario trae el resumen y ofrece ubicación u otra dirección', fp && fp.flow_action_payload.data.summary.includes('**Almacén Don José**: 2 cocas') && fp.flow_action_payload.data.init_address === 'gps' && ['gps', 'new'].every((id) => fp.flow_action_payload.data.addresses.some((a) => a.id === id)) && fp.flow_action_payload.data.show_tip === true, JSON.stringify(fp && fp.flow_action_payload.data));
await sendForm(FF, { flow_token: 'viejo', address: 'new', new_address: 'Calle 9 N° 800', pay: 'efectivo', tip: '0' });
r = await replies(FF);
check('un formulario viejo no se usa: manda el vigente', bodyOf(r[0]).includes('es de antes') && !!formOf(r[1]) && formOf(r[1]).flow_token !== fp.flow_token, allText(r));
fp = formOf(r[1]);
await sendForm(FF, { flow_token: fp.flow_token, address: 'new', new_address: 'Calle 12 N° 345', notes: 'casa verde', pay: 'transferencia', tip: 'other', tip_other: '1.250' });
r = await replies(FF);
const sumF = bodyOf(r[0]);
check('con el formulario va directo al resumen, con la propina de "Otro monto"', sumF.includes('Calle 12 N° 345 (casa verde)') && sumF.includes('Transferencia') && sumF.includes('Propina para el cadete: $1.250') && idsOf(r[0]).includes('c_ok'), sumF);
await tap(FF, 'c_ok');
r = await replies(FF);
const oF = (await ordersOf(FF))[0];
check('el pedido lleva la propina sumada al total, como en la app', oF && oF.tip === 1250 && oF.total === oF.deliveryCost + oF.purchaseFee + oF.extraStopsFee + oF.appUsageFee + 1250, oF && JSON.stringify({ tip: oF.tip, total: oF.total }));
check('y la dirección, los datos y el pago del formulario', oF && oF.deliveryAddress === 'Calle 12 N° 345' && oF.addressNotes === 'casa verde' && oF.paymentMethod === 'transferencia');
check('la confirmación muestra el total con propina', headedOf(r[0]).includes(oF.total.toLocaleString('es-AR')), headedOf(r[0]));
// Segunda vez: la dirección guardada aparece en el formulario; con "mandar mi ubicación" la pide por el chat
r = await compraHastaEntrega(FF, 'Farmacia Pasteur', 'un ibuprofeno');
fp = formOf(r[0]);
check('la dirección guardada aparece en el desplegable', fp && fp.flow_action_payload.data.addresses[0].id === 'a_0' && fp.flow_action_payload.data.addresses[0].title.includes('Calle 12') && fp.flow_action_payload.data.init_address === 'a_0', JSON.stringify(fp && fp.flow_action_payload.data.addresses));
await sendForm(FF, { flow_token: fp.flow_token, address: 'gps', pay: 'efectivo', tip: '300' });
r = await replies(FF);
check('"Mandar mi ubicación" la pide con el botón de WhatsApp', r[0].interactive?.type === 'location_request_message', JSON.stringify(r[0]));
await loc(FF, -35.085, -57.515, 'Calle 3 120');
r = await replies(FF);
check('con la ubicación va directo al resumen (sin volver a preguntar datos ni pago)', bodyOf(r[0]).includes('Resumen') && bodyOf(r[0]).includes('Efectivo') && bodyOf(r[0]).includes('Propina para el cadete: $300'), bodyOf(r[0]));
await text(FF, 'cancelar'); await replies(FF);
// Con el interruptor apagado vuelve a preguntar por el chat
await asAdmin((db) => setDoc(doc(db, 'settings', 'whatsapp_bot'), { form: false }));
r = await compraHastaEntrega(FF, 'Almacén Don José', 'un alfajor');
check('con form: false pregunta la dirección por el chat', !formOf(r[0]) && idsOf(r[0]).includes('a_last'), JSON.stringify(r[0]));

// ═════ 15. Sin avisos de seguimiento (por defecto) y contador del cupo gratis ═════
console.log('\n15. Sin avisos y contador');
await asAdmin((db) => setDoc(doc(db, 'settings', 'whatsapp_bot'), { form: false }));
await asAdmin((db) => updateDoc(doc(db, 'orders', oF.id), { driverId: 'driver1', driverName: 'Juan Cadete', status: 'accepted' }));
await sleep(6000);
await asAdmin((db) => updateDoc(doc(db, 'orders', oF.id), { isAtDoor: true, status: 'completed' }));
r = await replies(FF, { wait: 8000 });
check('sin notify: no le manda avisos de seguimiento', r.length === 0 && extras[FF].length === 0, allText(r));
const month = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const usage = await docData(`wa_usage/${month}`);
const totalOut = await asAdmin(async (db) => (await getDocs(collection(db, 'wa_outbox'))).size);
check('cuenta los mensajes del mes contra el cupo gratis', usage && usage.free === 1000 && usage.sent === totalOut && usage.byType.interactive > 0 && usage.byType.text > 0, JSON.stringify({ usage, totalOut }));

// ═════ 16. Camino corto, ajustes del admin, vinculación y tope de gasto ═════
console.log('\n16. Camino corto, ajustes y tope');
await asAdmin((db) => setDoc(doc(db, 'wa_config', 'bot'), { greeting: 'Buenas {nombre}, ¿qué te traemos?', hiddenOptions: ['m_puntos'] }));
const Q = '5492215557001';
await text(Q, 'hola', 'Lola');
r = await replies(Q);
check('corto: sin banner por defecto', r.length === 1 && extras[Q].length === 0, JSON.stringify(extras[Q]));
check('el saludo es el que cargó el admin', bodyOf(r[0]).startsWith('Buenas Lola, ¿qué te traemos?'), bodyOf(r[0]));
check('una opción oculta no sale en el menú', !idsOf(r[0]).includes('m_puntos') && idsOf(r[0]).includes('m_compra'), idsOf(r[0]).join(','));
const qStart = (await outbox(Q)).length;
await pick(Q, 'm_compra');
r = await replies(Q);
check('corto: pide todo junto', bodyOf(r[0]).includes('en un solo mensaje'), bodyOf(r[0]));
await text(Q, '2 cocas de Paulos, calle 12 n° 345, efectivo');
r = await replies(Q);
check('corto: con todo en un mensaje va directo al resumen', bodyOf(r[0]).includes('Resumen') && bodyOf(r[0]).includes('calle 12 n° 345') && bodyOf(r[0]).includes('Efectivo') && bodyOf(r[0]).includes('Kiosco Paulos'), bodyOf(r[0]));
await tap(Q, 'c_ok');
r = await replies(Q);
const oQ = await waitFor(async () => asAdmin(async (db) => { const s = await getDocs(query(collection(db, 'orders'), where('waPhone', '==', Q))); return s.empty ? null : s.docs[0].data(); }), 8000);
check('corto: crea el pedido con comercio y dirección', oQ && oQ.isFavor === true && oQ.mandadoStops?.[0]?.store === 'Kiosco Paulos' && (oQ.deliveryAddress || oQ.userAddress || '').includes('calle 12'), JSON.stringify(oQ));
check('corto: pedido completo en 3 mensajes del bot', (await outbox(Q)).length - qStart === 3, String((await outbox(Q)).length - qStart));

const QF = '5492215557002';
await text(QF, 'hola'); await replies(QF);
await pick(QF, 'm_compra'); await replies(QF);
await text(QF, 'un alfajor');
r = await replies(QF);
check('corto: si falta la dirección pregunta solo eso', bodyOf(r[0]).includes('Adónde'), bodyOf(r[0]));
await text(QF, 'calle 8 n° 20, casa verde');
r = await replies(QF);
check('corto: no pide datos aparte, sigue con el pago', idsOf(r[0]).includes('p_efectivo'), bodyOf(r[0]));
await pick(QF, 'p_transferencia');
r = await replies(QF);
check('corto: y después el resumen', bodyOf(r[0]).includes('Resumen') && bodyOf(r[0]).includes('Transferencia'), bodyOf(r[0]));
await text(QF, 'cancelar'); await replies(QF);

const QE = '5492215557003';
await text(QE, 'hola'); await replies(QE);
await pick(QE, 'm_envio'); await replies(QE);
await text(QE, 'unas llaves, retiro: calle 9 n° 120, entrega: calle 20 n° 88, transferencia');
r = await replies(QE);
check('corto: envío con retiro y entrega en un mensaje', bodyOf(r[0]).includes('Resumen') && bodyOf(r[0]).includes('calle 9 n° 120') && bodyOf(r[0]).includes('calle 20 n° 88'), bodyOf(r[0]));
await text(QE, 'cancelar'); await replies(QE);

const callLink = async (body, token = 'sin-token') => {
  const res = await fetch(`http://${FN_HOST}/${PROJECT}/us-central1/waBotLink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token, ...body }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
check('vincular sin sesión de admin: rechazado', (await callLink({ action: 'status' })).status === 401);
const adm2 = env.authenticatedContext('admin1', { role: 'admin' }).firestore();
const cli2 = env.authenticatedContext('cliente1').firestore();
check('nadie puede leer el token del número', await throws(() => getDoc(doc(adm2, 'wa_secrets', 'cloud_api'))) && await throws(() => getDoc(doc(cli2, 'wa_secrets', 'cloud_api'))));
check('un cliente no ve ni cambia el tope', await throws(() => getDoc(doc(cli2, 'wa_config', 'bot'))) && await throws(() => setDoc(doc(cli2, 'wa_config', 'bot'), { budgetArs: 1 })));

// 1.000 gratis + 2.654 pagos a $37,68 son $100.003: pasó el tope de $100.000
const M = '5492215557004';
await asAdmin((db) => setDoc(doc(db, 'wa_usage', month), { sent: 3200 }, { merge: true }));
await text(M, 'hola');
r = await replies(M);
check('al 80% del tope sigue contestando', r.length === 1 && isMenu(r[0]));
const near = await waitFor(async () => { const u = await docData(`wa_usage/${month}`); return u.alerts?.near ? u : null; }, 4000);
check('al 80% queda registrado el aviso', !!near);
await asAdmin((db) => setDoc(doc(db, 'wa_usage', month), { sent: 3654 }, { merge: true }));
await text(M, 'menu');
r = await replies(M, { wait: 3000 });
const afterCap = await docData(`wa_usage/${month}`);
check('con el tope alcanzado el bot no contesta', r.length === 0, allText(r));
check('y no suma mensajes', afterCap.sent === 3654, String(afterCap.sent));
await asAdmin((db) => setDoc(doc(db, 'wa_config', 'bot'), { budgetArs: 200000 }, { merge: true }));
await text(M, 'menu');
r = await replies(M);
check('subiendo el tope vuelve a contestar', r.length === 1 && isMenu(r[0]));

console.log('\nDirección sin altura');
const V = '5492215557005';
await pick(V, 'm_envio'); await replies(V);
await text(V, 'Unas llaves'); await replies(V);
await text(V, 'Avenida 9 de Julio 800'); await replies(V);
await text(V, 'Doctor Patricio Brenan');
r = await replies(V);
check('sin altura pide la ubicación', r[0].interactive?.type === 'location_request_message' && bodyOf(r[0]).includes('no tiene altura'), bodyOf(r[0]));
await text(V, 'Barrio Bicentenario');
r = await replies(V);
check('si vuelve a escribir se acepta y sigue', !bodyOf(r[0]).includes('no tiene altura') && bodyOf(r[0]).length > 0, bodyOf(r[0]));

const V2 = '5492215557006';
await pick(V2, 'm_envio'); await replies(V2);
await text(V2, 'Unas llaves'); await replies(V2);
await text(V2, 'Avenida 9 de Julio 800'); await replies(V2);
await text(V2, 'Doctor Patricio Brenan'); await replies(V2);
await loc(V2, -35.0798, -57.5258, 'Brenan');
r = await replies(V2);
await text(V2, 'efectivo');
r = await replies(V2);
check('con la ubicación usa ese punto', bodyOf(r[0]).includes('Resumen'), bodyOf(r[0]));

console.log(`\n${pass} OK, ${fail} fallos`);
if (fail) { console.log('Fallaron:\n - ' + failures.join('\n - ')); }
await env.cleanup();
process.exit(fail ? 1 : 0);
