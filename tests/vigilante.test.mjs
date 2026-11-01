// Vigilante (functions/vigilante.js): auditoría de datos + errores del servidor + resumen diario.
//
//   npx firebase-tools emulators:exec --only firestore --project demo-godelivery "node tests/vigilante.test.mjs"
//
// Siembra un caso por cada revisión (y uno sano al lado), corre el vigilante de verdad contra el
// emulador con avisos y registros de Cloud Logging simulados, y revisa la bandeja (client_errors),
// los avisos, el estado en system/vigilante, que se resuelva solo, que se reabra y las reglas.

import { createRequire } from 'module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8') },
});

// El código del servidor, con su firebase-admin, apuntando al emulador
const requireFn = createRequire(path.join(HERE, '..', 'functions', 'package.json'));
const admin = requireFn('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { getFirestore, Timestamp, FieldValue } = requireFn('firebase-admin/firestore');
const db = getFirestore();
const { runVigilante, sendDailyDigest } = requireFn('./vigilante.js');

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}
async function throws(fn) { try { await fn(); return false; } catch { return true; } }

const MIN = 60000;
const now = Date.now();
const at = (msAgo) => Timestamp.fromMillis(now - msAgo);

// Avisos y registros simulados
let pushes = [];
let logEntries = [];
let logsFail = null;
const deps = {
  getAdminTokens: async () => ['token-admin'],
  sendPush: async (tokens, n, data) => { pushes.push({ ...n, url: data?.url }); },
  getLogEntries: async ({ filter }) => {
    if (logsFail) throw new Error(logsFail);
    const after = /timestamp>"([^"]+)"/.exec(filter)?.[1];
    const until = /timestamp<="([^"]+)"/.exec(filter)?.[1];
    return [logEntries.filter((e) => (!after || e.metadata.timestamp > after) && (!until || e.metadata.timestamp <= until))];
  },
};
const logEntry = (minAgo, service, data) => ({ metadata: { timestamp: new Date(now - minAgo * MIN).toISOString(), resource: { type: 'cloud_run_revision', labels: { service_name: service } } }, data });

const finding = async (id) => { const s = await db.doc(`client_errors/${id}`).get(); return s.exists ? s.data() : null; };
const audit = (id) => finding(`audit_${id}`);
const resetAlertBudget = () => db.doc('system/client_errors_alerts').delete();

await env.clearFirestore();

// ---------------------------------------------------------------- datos sembrados
const o = (id, data) => db.doc(`orders/${id}`).set({ orderId: id.toUpperCase(), comercioName: 'Pizzería', ...data });
await Promise.all([
  // pedidos_sin_cancelar: comercio que no aceptó hace 40 min (y uno de 10 min, que todavía no)
  o('sincancelar', { status: 'pending', createdAt: at(40 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  o('reciente', { status: 'pending', createdAt: at(10 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  // pedidos_trabados + rastreo_cortado: en camino hace 4 h, sin ubicación hace 30 min
  o('trabado', { status: 'delivering', driverId: 'cadete1', driverName: 'Martín', createdAt: at(240 * MIN), pickedUpAt: at(200 * MIN), driverLocation: { lat: 1, lng: 1, updatedAt: at(30 * MIN) }, subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  // programado: creado hace 5 h para dentro de 1 h → no está trabado
  o('programado', { status: 'confirmed', driverId: 'cadete1', createdAt: at(300 * MIN), isScheduled: true, scheduledFor: Timestamp.fromMillis(now + 60 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  // en camino con ubicación fresca → sin rastreo cortado
  o('encamino', { status: 'delivering', driverId: 'cadete2', createdAt: at(30 * MIN), pickedUpAt: at(20 * MIN), driverLocation: { lat: 1, lng: 1, updatedAt: at(1 * MIN) }, subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  // ofertas_trabadas: la misma oferta hace 8 min (y una permanente, que no cuenta)
  o('oferta', { status: 'ready', readyAt: at(9 * MIN), createdAt: at(15 * MIN), queueTargetDriverId: 'cadete2', queueOfferedAt: at(8 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  o('permanente', { status: 'ready', readyAt: at(9 * MIN), createdAt: at(15 * MIN), queueTargetDriverId: 'cadete2', queueOfferedAt: at(8 * MIN), isPermanentOffer: true, subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  // totales_descuadrados: 1000 + 500 + 50 − 100 (GoPoints) = 1450, cobró 1500
  o('malcobrado', { status: 'completed', driverId: 'cadete2', ledgerEntryId: 'x', createdAt: at(60 * MIN), completedAt: at(30 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, discountAmount: 100, total: 1500 }),
  o('biencobrado', { status: 'completed', driverId: 'cadete2', ledgerEntryId: 'y', createdAt: at(60 * MIN), completedAt: at(30 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, discountAmount: 100, couponDiscount: 200, total: 1250 }),
  o('mandado', { status: 'completed', isFavor: true, driverId: 'cadete2', ledgerEntryId: 'z', createdAt: at(60 * MIN), completedAt: at(30 * MIN), subtotal: 0, deliveryCost: 2300, total: 9800 }),
  o('totalroto', { status: 'pending', createdAt: at(5 * MIN), subtotal: 1000, total: 'NaN' }),
  // pedidos_sin_asiento: entregado hace 20 min sin renglón (y uno de hace 2 min, que puede estar en camino)
  o('sinasiento', { status: 'completed', driverId: 'cadete1', createdAt: at(60 * MIN), completedAt: at(20 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  o('recienentregado', { status: 'completed', driverId: 'cadete1', createdAt: at(30 * MIN), completedAt: at(2 * MIN), subtotal: 1000, deliveryCost: 500, appUsageFee: 50, total: 1550 }),
  // cancelado viejo: no cuenta para nada
  o('cancelado', { status: 'cancelled', createdAt: at(300 * MIN), subtotal: 1000, total: 99 }),
]);
await Promise.all([
  // saldo_cadete_descuadrado: saldo 500, último renglón dice 400
  db.doc('users/descuadrado').set({ role: 'delivery', displayName: 'Cadete Descuadrado', ledgerOpened: true, deliveryDebt: 500, ledgerLastEntryId: 'e_desc' }),
  db.doc('driver_ledger/e_desc').set({ driverId: 'descuadrado', amount: 400, balanceAfter: 400 }),
  db.doc('users/cuadrado').set({ role: 'delivery', displayName: 'Cadete Bien', ledgerOpened: true, deliveryDebt: 300, ledgerLastEntryId: 'e_ok2' }),
  db.doc('driver_ledger/e_ok1').set({ driverId: 'cuadrado', amount: 200, balanceAfter: 200 }),
  db.doc('driver_ledger/e_ok2').set({ driverId: 'cuadrado', amount: 100, balanceAfter: 300 }),
  // cadetes_sin_push: en línea sin ningún token (los otros dos tienen, de dos formas distintas)
  db.doc('users/sintoken').set({ role: 'delivery', isOnline: true, displayName: 'Cadete Mudo', phone: '2221000000' }),
  db.doc('users/contoken').set({ role: 'delivery', isOnline: true, displayName: 'Cadete A', lastFcmToken: 'abc' }),
  db.doc('users/consub').set({ role: 'delivery', isOnline: true, displayName: 'Cadete B' }),
  db.doc('users/consub/fcmTokens/t1').set({ token: 't1' }),
  // comercios_sin_avisos: sin dispositivos, con el último de hace 45 días y sin dueño (3).
  // No cuentan: el que tiene uno nuevo, GO! Market (lo atienden los admins), uno inactivo y el de un admin.
  db.doc('comercios/mudo').set({ name: 'Pizza Muda', ownerId: 'duenomudo' }),
  db.doc('users/duenomudo').set({ role: 'comercio', displayName: 'Dueño Mudo', phone: '2221999999' }),
  db.doc('comercios/viejo').set({ name: 'Rotisería Vieja', ownerId: 'duenoviejo' }),
  db.doc('users/duenoviejo').set({ role: 'comercio' }),
  db.doc('users/duenoviejo/fcmTokens/tv').set({ token: 'tv', updatedAt: at(45 * 24 * 60 * MIN) }),
  db.doc('comercios/sindueno').set({ name: 'Local Huérfano' }),
  db.doc('comercios/avisado').set({ name: 'Heladería Avisada', ownerId: 'duenoavisado' }),
  db.doc('users/duenoavisado').set({ role: 'comercio' }),
  db.doc('users/duenoavisado/fcmTokens/ta').set({ token: 'ta', updatedAt: at(2 * 24 * 60 * MIN) }),
  db.doc('comercios/gomarket').set({ name: 'GO! MARKET', ownerId: 'duenomudo' }),
  db.doc('comercios/cerrado').set({ name: 'Cerrado Para Siempre', isActive: false }),
  db.doc('comercios/deladmin').set({ name: 'Local del Jefe', ownerId: 'jefe' }),
  // puntos_negativos y cupones_pasados
  db.doc('users/negativo').set({ role: 'user', displayName: 'Cliente Raro', points: -50 }),
  db.doc('users/positivo').set({ role: 'user', points: 30 }),
  db.doc('coupons/PASADO').set({ active: true, remaining: -1 }),
  db.doc('coupons/BIEN').set({ active: true, remaining: 3 }),
  // cadete_desconectado_con_pedido: cadete1 tiene el pedido trabado y está fuera de línea
  db.doc('users/cadete1').set({ role: 'delivery', isOnline: false, displayName: 'Martín', disconnectedReason: 'debt_limit' }),
  db.doc('users/cadete2').set({ role: 'delivery', isOnline: true, displayName: 'Ana', lastFcmToken: 'x' }),
  // clima_sin_actualizar: el chequeo de lluvia no corre hace 2 h
  db.doc('settings/weather').set({ isRaining: false, checkedAt: at(120 * MIN), lastError: 'openMeteo: timeout' }),
  // reinicios_app: 12 recargas de la app en el día (y 5 manuales y 6 por versión nueva, que no cuentan)
  ...Array.from({ length: 12 }, (_, i) => db.collection('app_restarts').add({ kind: 'la app recargó', reason: i < 9 ? 'Firestore roto (ca9)' : 'no cargó el mapa de seguimiento', createdAt: at((i + 1) * 30 * MIN) })),
  ...Array.from({ length: 6 }, (_, i) => db.collection('app_restarts').add({ kind: 'la app recargó', reason: 'versión nueva de la app', createdAt: at((i + 1) * 20 * MIN) })),
  ...Array.from({ length: 5 }, (_, i) => db.collection('app_restarts').add({ kind: 'recarga manual', reason: 'botón', createdAt: at(10 * MIN) })),
  // reglas: admin y cliente
  db.doc('users/jefe').set({ role: 'admin', isAdmin: true }),
  db.doc('users/cliente').set({ role: 'user' }),
]);

// Registros del servidor: el mismo error con ids distintos (1 grupo), otro distinto y ruido
logEntries = [
  logEntry(10, 'onorderstatuschange', { message: '[Ledger] order AbCdEfGhIjKlMnOpQrSt failed:\nTypeError: Cannot read properties of undefined (reading \'appUsageFee\')\n    at applyCompletedOrder (/workspace/ledger.js:175:20)' }),
  logEntry(9, 'onorderstatuschange', { message: '[Ledger] order ZyXwVuTsRqPoNmLkJiHg failed:\nTypeError: Cannot read properties of undefined (reading \'appUsageFee\')\n    at applyCompletedOrder (/workspace/ledger.js:175:20)' }),
  logEntry(8, 'createorder', 'Error: 4 DEADLINE_EXCEEDED: Deadline exceeded'),
  logEntry(7, 'createorder', { message: 'Default STARTUP TCP probe succeeded after 1 attempt' }),
  logEntry(1, 'createorder', 'Error: muy reciente (todavía no se procesa)'),
];

console.log('=========== PRIMERA PASADA (línea de base, sin avisos) ===========');
let out = await runVigilante(deps);
check('primera pasada: no manda avisos (línea de base)', pushes.length === 0, JSON.stringify(pushes.map((p) => p.title)));

const expectAffected = {
  pedidos_sin_cancelar: 1, pedidos_trabados: 1, ofertas_trabadas: 1, totales_descuadrados: 2, pedidos_sin_asiento: 1,
  saldo_cadete_descuadrado: 1, rastreo_cortado: 1, cadetes_sin_push: 1, puntos_negativos: 1, cupones_pasados: 1,
  cadete_desconectado_con_pedido: 1, clima_sin_actualizar: 1, reinicios_app: 2, comercios_sin_avisos: 3,
};
for (const [id, n] of Object.entries(expectAffected)) {
  const f = await audit(id);
  check(`${id}: ${n} caso(s)`, f?.status === 'open' && f?.affected === n && f?.kind === 'auditoria', JSON.stringify({ affected: f?.affected, items: f?.lastSample?.items?.map((i) => i.label) }));
}
const tot = await audit('totales_descuadrados');
check('el total mal cobrado dice cuánto debía ser', tot.lastSample.items.some((i) => i.id === 'malcobrado' && /1\.450/.test(i.label)), JSON.stringify(tot.lastSample.items));
check('el mandado no se compara (se arma distinto)', !tot.lastSample.items.some((i) => i.id === 'mandado'));
check('cadete desconectado: dice el motivo, y el programado para más tarde no cuenta', (await audit('cadete_desconectado_con_pedido')).lastSample.items[0].label.includes('debt_limit'));
check('reinicios: agrupados por motivo, el más repetido primero', /^9× la app recargó: Firestore roto/.test((await audit('reinicios_app')).lastSample.items[0].label), JSON.stringify((await audit('reinicios_app')).lastSample.items));
check('reinicios: la recarga por versión nueva no cuenta', !(await audit('reinicios_app')).lastSample.items.some((i) => /versión nueva/.test(i.label)));
{
  const sa = (await audit('comercios_sin_avisos')).lastSample.items;
  const lbl = (id) => sa.find((i) => i.id === id)?.label || '';
  check('comercios sin avisos: dice por qué (y el teléfono para llamarlo)', /sin ningún dispositivo · 2221999999/.test(lbl('mudo')) && /último dispositivo hace 45 días/.test(lbl('viejo')) && /sin dueño/.test(lbl('sindueno')), JSON.stringify(sa));
  check('comercios sin avisos: no cuenta GO! Market, ni inactivos, ni de admins, ni con dispositivo nuevo', !sa.some((i) => ['gomarket', 'cerrado', 'deladmin', 'avisado'].includes(i.id)));
}
check('cada hallazgo explica qué revisar', typeof tot.lastSample.help === 'string' && tot.lastSample.help.length > 20);

const srv = (await db.collection('client_errors').where('kind', '==', 'servidor').get()).docs.map((d) => d.data());
check('errores del servidor: el mismo error con ids distintos es un solo grupo', srv.length === 2 && srv.some((e) => e.count === 2 && e.frame === 'onorderstatuschange'), JSON.stringify(srv.map((e) => [e.frame, e.count, e.message])));
check('...con el renglón del error en el mensaje', srv.some((e) => /TypeError/.test(e.message)));
check('el ruido de la plataforma no se guarda', !srv.some((e) => /STARTUP TCP/.test(e.message)));
check('lo de hace menos de 2 min queda para la pasada siguiente', !srv.some((e) => /muy reciente/.test(e.message)));

let state = (await db.doc('system/vigilante').get()).data();
check('system/vigilante guarda la pasada y cada revisión', !!state.lastRunAt && Object.keys(state.checks).length === 14 && state.checks.puntos_negativos.ok === false && state.logs.entries === 4, JSON.stringify({ n: Object.keys(state.checks || {}).length, logs: state.logs }));

console.log('=========== SEGUNDA PASADA ===========');
pushes = [];
logEntries.push(logEntry(0.5, 'createorder', 'Error: otra cosa'));
out = await runVigilante(deps);
const srvAfter = (await db.collection('client_errors').where('kind', '==', 'servidor').get()).docs.map((d) => d.data());
check('no cuenta dos veces los registros ya leídos', srvAfter.find((e) => e.frame === 'onorderstatuschange').count === 2);
check('sin cambios no avisa de nuevo', pushes.length === 0, JSON.stringify(pushes.map((p) => p.title)));
check('cuenta en cuántas revisiones apareció', (await audit('puntos_negativos')).count === 2);

console.log('=========== SE NORMALIZA SOLO Y VUELVE ===========');
await db.doc('users/negativo').update({ points: 0 });
await runVigilante(deps);
let neg = await audit('puntos_negativos');
check('cuando se arregla, el vigilante lo marca resuelto solo', neg.status === 'resolved' && neg.statusBy === 'vigilante' && neg.affected === 0, JSON.stringify({ s: neg.status, by: neg.statusBy }));

pushes = [];
await resetAlertBudget();
await db.doc('users/negativo').update({ points: -10 });
await runVigilante(deps);
neg = await audit('puntos_negativos');
check('si vuelve a pasar se reabre', neg.status === 'open' && neg.reopenCount === 1);
check('...y avisa que volvió (es de severidad alta)', pushes.some((p) => /Volvió un problema/.test(p.title) && p.url === '#/admin/errores?e=audit_puntos_negativos'), JSON.stringify(pushes));

pushes = [];
await db.doc('coupons/PASADO').update({ remaining: 0 });
await runVigilante(deps);
await db.doc('coupons/PASADO').update({ remaining: -2 });
await runVigilante(deps);
check('un aviso de severidad media se reabre pero no manda push', (await audit('cupones_pasados')).status === 'open' && !pushes.some((p) => /cupon/i.test(p.body)), JSON.stringify(pushes));

await db.doc('client_errors/audit_pedidos_trabados').update({ status: 'ignored' });
await runVigilante(deps);
check('uno ignorado sigue ignorado aunque siga apareciendo', (await audit('pedidos_trabados')).status === 'ignored');

console.log('=========== PROBLEMA NUEVO Y ERRORES DEL SERVIDOR ===========');
pushes = [];
await resetAlertBudget();
await o('nuevotrabado', { status: 'pending', createdAt: at(50 * MIN), subtotal: 1, total: 1 });
await db.doc('client_errors/audit_pedidos_sin_cancelar').delete();
await runVigilante(deps);
check('un problema nuevo de severidad alta avisa', pushes.some((p) => /El vigilante encontró un problema/.test(p.title) && /no se cancelaron solos \(2\)/.test(p.body)), JSON.stringify(pushes));

pushes = [];
await resetAlertBudget();
const base = Date.now();
for (let i = 0; i < 12; i++) logEntries.push({ metadata: { timestamp: new Date(base - 3 * MIN + i).toISOString(), resource: { type: 'cloud_run_revision', labels: { service_name: 'rotateexpiredoffers' } } }, data: { message: `[RotateOffers] Error en el pedido ${1000 + i}: Error: 9 FAILED_PRECONDITION` } });
await runVigilante(deps);
const rot = (await db.collection('client_errors').where('frame', '==', 'rotateexpiredoffers').get()).docs.map((d) => d.data());
check('12 errores iguales del servidor = 1 grupo con 12', rot.length === 1 && rot[0].count === 12, JSON.stringify(rot.map((e) => e.count)));
check('error nuevo del servidor → aviso con el nombre de la función', pushes.some((p) => /Error nuevo en el servidor/.test(p.title) && /rotateexpiredoffers/.test(p.body)), JSON.stringify(pushes));

// Resuelto, y el vigilante (atrasado) recién lee registros de ANTES de que lo resolvieran: no se
// reabre ni avisa (así volvía "Error fetching customer photo", 13-10-2026)
pushes = [];
await resetAlertBudget();
const rotRef = db.doc(`client_errors/${rot[0].fingerprint}`);
await rotRef.update({ status: 'resolved', statusBy: 'admin', statusAt: new Date() });
logEntries.push({ metadata: { timestamp: new Date(base - 3 * MIN + 500).toISOString(), resource: { type: 'cloud_run_revision', labels: { service_name: 'rotateexpiredoffers' } } }, data: { message: '[RotateOffers] Error en el pedido 2000: Error: 9 FAILED_PRECONDITION' } });
await runVigilante(deps);
const rotAfter = (await rotRef.get()).data();
check('registros viejos de un error ya resuelto no lo reabren', rotAfter.status === 'resolved' && !pushes.some((p) => /rotateexpiredoffers/.test(p.body)), JSON.stringify({ status: rotAfter.status, pushes }));
check('…pero se cuentan', rotAfter.count === 13, String(rotAfter.count));
check('"última vez" es la hora del registro, no la de la pasada', rotAfter.lastSeen.toMillis() <= base, String(rotAfter.lastSeen.toMillis() - base));

console.log('=========== EL VIGILANTE NO PUEDE LEER LOS REGISTROS ===========');
pushes = [];
await resetAlertBudget();
logsFail = '7 PERMISSION_DENIED: logging.logEntries.list';
await runVigilante(deps);
let blind = await audit('vigilante_sin_registros');
check('si no puede leer los registros lo deja anotado (no queda ciego en silencio)', blind?.status === 'open' && /Logs Viewer/.test(blind.lastSample.help));
check('...y avisa', pushes.some((p) => /no puede leer/.test(p.body)), JSON.stringify(pushes));
state = (await db.doc('system/vigilante').get()).data();
check('...y el estado lo muestra', /PERMISSION_DENIED/.test(state.logs.error || ''));
check('las revisiones de datos siguen corriendo igual', state.checks.pedidos_sin_cancelar.ok === false);
logsFail = null;
await runVigilante(deps);
blind = await audit('vigilante_sin_registros');
check('cuando vuelve a poder, se resuelve solo', blind.status === 'resolved' && blind.statusBy === 'vigilante');

console.log('=========== REVISIÓN DIARIA Y RESUMEN ===========');
await db.doc('users/cuadrado').update({ deliveryDebt: 300 });
await db.doc('driver_ledger/e_extra').set({ driverId: 'cuadrado', amount: 50, balanceAfter: 350 });
await runVigilante(deps, { daily: true });
const book = await audit('libro_cadete_no_suma');
check('diaria: la suma de los renglones que no da el saldo aparece', book?.affected === 2 && book.lastSample.items.some((i) => i.id === 'cuadrado' && /350/.test(i.label)), JSON.stringify(book?.lastSample?.items));
state = (await db.doc('system/vigilante').get()).data();
check('...queda aparte en el estado (no se mezcla con las de cada 15 min)', !!state.lastDailyAt && state.dailyChecks.libro_cadete_no_suma.ok === false && !state.checks.libro_cadete_no_suma);

pushes = [];
const digest = await sendDailyDigest(deps);
check('el resumen de la mañana cuenta lo abierto', digest.open > 0 && pushes.length === 1 && /Vigilante: \d+ cosas abiertas/.test(pushes[0].title) && /Auditoría \d+/.test(pushes[0].body), JSON.stringify(pushes));

console.log('=========== UNA REVISIÓN QUE FALLA NO FRENA LAS DEMÁS ===========');
await db.doc('users/descuadrado').update({ ledgerLastEntryId: '' });
await db.doc('orders/roto').set({ status: 'delivering', driverId: 'x', createdAt: 'no-es-fecha' });
out = await runVigilante(deps);
check('la pasada termina aunque haya datos raros', Object.keys(out.checks).length === 14 && Object.values(out.checks).every((c) => c.ok !== undefined));

console.log('=========== REGLAS ===========');
const jefe = env.authenticatedContext('jefe').firestore();
const cliente = env.authenticatedContext('cliente').firestore();
check('el admin ve el estado del vigilante', !(await throws(() => getDoc(doc(jefe, 'system/vigilante')))));
check('un cliente no', await throws(() => getDoc(doc(cliente, 'system/vigilante'))));
check('un cliente no ve los hallazgos', await throws(() => getDoc(doc(cliente, 'client_errors/audit_puntos_negativos'))));

console.log('================================================');
console.log(`  PASARON: ${pass}   |   FALLARON: ${fail}`);
console.log('================================================');
await env.cleanup();
process.exit(fail ? 1 : 0);
