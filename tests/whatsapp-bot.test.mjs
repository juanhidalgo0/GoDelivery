// Bot de WhatsApp (functions/whatsapp/): conversaciones completas contra el webhook real, con
// los triggers reales, en el emulador. Los mensajes que el bot "manda" quedan en wa_outbox.
//
//   FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --only functions,firestore --project demo-godelivery "node tests/whatsapp-bot.test.mjs"
//
// Cubre: menú, mandado de compra y de envío, pedido escrito a un comercio (precio, rechazo y
// pase a mandado), link al catálogo, avisos de estado, soporte, cadete para comercios,
// cancelar desde "Mis pedidos", mensajes repetidos, pausa cuando contesta una persona y reglas.

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
// Mensajes nuevos para `to` desde la última vez que se miró
async function replies(to, { wait = 0, min = 1 } = {}) {
  const got = await waitFor(async () => { const all = await outbox(to); return all.length - (seen[to] || 0) >= min ? all : null; }, wait || 1500)
    || await outbox(to);
  const fresh = got.slice(seen[to] || 0);
  seen[to] = got.length;
  return fresh.map((o) => o.payload);
}
const bodyOf = (p) => (p.type === 'text' ? p.text.body : p.interactive.body.text);
const idsOf = (p) => {
  if (p.type !== 'interactive') return [];
  if (p.interactive.type === 'button') return p.interactive.action.buttons.map((b) => b.reply.id);
  if (p.interactive.type === 'list') return p.interactive.action.sections.flatMap((s) => s.rows.map((r) => r.id));
  return [];
};
const allText = (ps) => ps.map(bodyOf).join('\n---\n');

// ── Datos ──
const CENTER = { lat: -35.0811, lng: -57.5146 };
await asAdmin(async (db) => {
  await setDoc(doc(db, 'settings', 'global'), { deliveryMinPrice: 1500, deliveryBasePrice: 1500, deliveryPricePerKm: 300, rainMode: 'off', favorPurchaseFee: 800, appUsageFeeRate: 0.05 });
  await setDoc(doc(db, 'settings', 'settings'), { lastOrderId: 100 });
  await setDoc(doc(db, 'users', 'driver1'), { isOnline: true, role: 'delivery', displayName: 'Juan Cadete' });
  await setDoc(doc(db, 'users', 'cliente1'), { phone: '2215550001', displayName: 'Ana Pérez', role: 'user' });
  await setDoc(doc(db, 'users', 'dueno1'), { role: 'comercio', displayName: 'Pepe' });
  await setDoc(doc(db, 'users', 'dueno2'), { role: 'comercio', displayName: 'Otro' });
  await setDoc(doc(db, 'comercios', 'pizza'), { name: 'Pizzería Don Pepe', approvedByAdmin: true, isActive: true, ownerId: 'dueno1', coords: { lat: -35.083, lng: -57.516 }, phone: '2215559999', category: 'Pizzería' });
  await setDoc(doc(db, 'comercios', 'burger'), { name: 'Burger Go', approvedByAdmin: true, isActive: true, ownerId: 'dueno2', coords: { lat: -35.08, lng: -57.51 }, category: 'Hamburguesas' });
  await setDoc(doc(db, 'comercios', 'burger', 'products', 'p1'), { name: 'Hamburguesa', price: 5000, isAvailable: true });
  await setDoc(doc(db, 'comercios', 'cerrado'), { name: 'Heladería Cerrada', approvedByAdmin: true, isActive: true, ownerId: 'dueno2', weeklySchedule: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } });
});

// ═════ 1. Menú ═════
console.log('\n1. Menú');
const A = '5492215551111';
await text(A, 'hola', 'Carla');
let r = await replies(A);
check('responde con el menú en lista', r.length === 1 && r[0].interactive?.type === 'list');
check('el menú tiene las 5 opciones', ['m_compra', 'm_envio', 'm_comercio', 'm_pedidos', 'm_humano'].every((id) => idsOf(r[0]).includes(id)), idsOf(r[0]).join(','));
check('saluda por el nombre', bodyOf(r[0]).includes('Carla'));

// ═════ 2. Mandado de compra ═════
console.log('\n2. Mandado de compra');
await pick(A, 'm_compra');
r = await replies(A);
check('pide qué necesita', bodyOf(r[0]).includes('qué necesitás'));
await text(A, '2 kg de papa y una lavandina');
r = await replies(A);
check('anota y ofrece Listo', idsOf(r[0]).includes('d_done'));
await text(A, 'y un sachet de leche');
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
check('confirmar / cancelar', idsOf(r[0]).includes('c_ok'));
await tap(A, 'c_ok');
r = await replies(A);
check('confirma con número de pedido', /Pedido #101/.test(bodyOf(r[0])), bodyOf(r[0]));
let oA = (await ordersOf(A))[0];
check('pedido creado como compra del bot', oA && oA.source === 'whatsapp_bot' && oA.isFavor === true && oA.favorType === 'compra');
check('compra sale del centro, va a la ubicación', oA.pickupCoords?.lat === CENTER.lat && oA.deliveryCoords?.lat === -35.09);
check('guarda detalle, datos y pago', oA.details.includes('leche') && oA.addressNotes === 'timbre 2B' && oA.paymentMethod === 'efectivo');
check('total = envío + compra + uso de app', oA.total === oA.deliveryCost + oA.purchaseFee + oA.appUsageFee && oA.purchaseFee === 800 && oA.deliveryCost >= 1500, JSON.stringify({ t: oA.total, d: oA.deliveryCost, p: oA.purchaseFee, f: oA.appUsageFee }));
check('cliente sin cuenta: se identifica por el número', oA.userId === A);
check('no queda paso a medias', (await docData(`wa_sessions/${A}`)).step === 'idle');

// ═════ 3. Avisos de estado ═════
console.log('\n3. Avisos de estado');
await asAdmin((db) => updateDoc(doc(db, 'orders', oA.id), { driverId: 'driver1', driverName: 'Juan Cadete', status: 'accepted' }));
r = await replies(A, { wait: 15000 });
check('avisa quién tomó el pedido', allText(r).includes('Juan Cadete'), allText(r));
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
check('"dale" confirma', /Pedido #\d+/.test(bodyOf(r[0])), bodyOf(r[0]));
const oB = (await ordersOf(B))[0];
check('encomienda creada', oB && oB.favorType === 'mandado' && oB.pickupAddress === 'Avenida 9 de Julio 800' && oB.paymentMethod === 'transferencia');
check('número con cuenta en la app: el pedido queda a su nombre', oB.userId === 'cliente1' && oB.userName === 'Ana Pérez');

// Segundo pedido: ofrece la dirección anterior
await pick(B, 'm_compra');
await replies(B);
await text(B, 'pan');
await replies(B);
await tap(B, 'd_done');
r = await replies(B);
check('ofrece la dirección de la vez pasada', idsOf(r[0]).includes('a_last'));
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
check('confirma el pedido', /Pedido #\d+ confirmado/.test(bodyOf(r[0])), bodyOf(r[0]));
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
check('"menú" sale de soporte', r[0].interactive?.type === 'list');

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
await text(G, 'algo'); await replies(G);
await tap(G, 'd_done'); await replies(G);
await loc(G, -35.08, -57.51); await replies(G);
await tap(G, 'n_none'); await replies(G);
await tap(G, 'p_efectivo'); await replies(G);
await tap(G, 'c_ok');
r = await replies(G);
check('sin cadetes conectados: avisa y no crea el pedido', bodyOf(r[0]).includes('no hay cadetes') && (await ordersOf(G)).length === 0);
const verify = await fetch(`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=123`);
check('la verificación de Meta rechaza un token equivocado', verify.status === 403);

console.log(`\n${pass} OK, ${fail} fallos`);
if (fail) { console.log('Fallaron:\n - ' + failures.join('\n - ')); }
await env.cleanup();
process.exit(fail ? 1 : 0);
