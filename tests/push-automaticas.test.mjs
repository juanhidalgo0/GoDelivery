// Pushes automáticas (functions/push-automaticas.js).
//
//   npx firebase-tools emulators:exec --only firestore --project demo-godelivery "node tests/push-automaticas.test.mjs"
//
// Corre runPushAutomations de verdad contra el emulador, con un sendPush simulado y la hora fija:
// a quién le llega, que no se repita el mensaje, los frenos (repartidores, comercios abiertos,
// campaña manual, tope por día) y que las de la versión vieja se reemplacen.

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
const requireFn = createRequire(path.join(HERE, '..', 'functions', 'package.json'));
const admin = requireFn('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const { getFirestore, Timestamp } = requireFn('firebase-admin/firestore');
const db = getFirestore();
const A = requireFn('./push-automaticas.js');

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}

// Hora argentina (UTC-3) → Date
const ar = (iso) => new Date(new Date(iso + 'Z').getTime() + 3 * 3600e3);

async function clear(col) {
  const snap = await db.collection(col).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

// ---------------------------------------------------------------- funciones sueltas

console.log('\nHora y horarios');
{
  const c = A.argClock(ar('2026-10-16T20:35:00'));
  check('argClock: viernes 20:35', c.day === 5 && c.minutes === 20 * 60 + 35 && c.date === '2026-10-16', JSON.stringify(c));
  const late = A.argClock(ar('2026-10-17T00:10:00'));
  check('argClock: pasada la medianoche ya es sábado', late.day === 6 && late.date === '2026-10-17', JSON.stringify(late));

  const auto = { days: [5], time: '20:30' };
  check('isDue dentro de la ventana', A.isDue(auto, A.argClock(ar('2026-10-16T20:45:00'))));
  check('isDue antes de la hora: no', !A.isDue(auto, A.argClock(ar('2026-10-16T20:29:00'))));
  check('isDue pasada la ventana: no', !A.isDue(auto, A.argClock(ar(`2026-10-16T20:${30 + A.WINDOW_MIN}:00`))));
  check('isDue otro día: no', !A.isDue(auto, A.argClock(ar('2026-10-17T20:35:00'))));

  const fri2035 = A.argClock(ar('2026-10-16T20:35:00'));
  const sat0030 = A.argClock(ar('2026-10-17T00:30:00'));
  check('isOpenAt turno normal', A.isOpenAt({ schedules: [{ open: '19:30', close: '23:30' }] }, fri2035));
  check('isOpenAt turno que pasa la medianoche', A.isOpenAt({ schedules: [{ open: '21:00', close: '02:00' }] }, sat0030));
  check('isOpenAt día que no abre', !A.isOpenAt({ schedules: [{ open: '19:30', close: '23:30' }], daysOpen: [0, 4, 6] }, fri2035));
  check('isOpenAt sin horario cargado cuenta como cerrado', !A.isOpenAt({}, fri2035));
  check('isOpenAt horario semanal (turno del viernes que sigue el sábado)',
    A.isOpenAt({ weeklySchedule: { 5: [{ open: '19:00', close: '01:00' }], 6: [] } }, sat0030));
}

console.log('\nElección del mensaje');
{
  const clock = A.argClock(ar('2026-10-16T20:35:00'));
  const banca = { id: 'banca', name: 'La Banca', category: 'Comida', logo: 'x', schedules: [{ open: '19:30', close: '23:30' }] };
  const open = A.openComercios([
    banca,
    { id: 'sinfoto', name: 'Sin Foto', category: 'Comida', schedules: [{ open: '00:00', close: '23:59' }] },
    { id: 'esca', name: 'ESCABIADOS', category: 'Comida', logo: 'x', schedules: [{ open: '00:00', close: '23:59' }] },
    { id: 'pausa', name: 'Pausado', category: 'Comida', logo: 'x', isPaused: true, schedules: [{ open: '00:00', close: '23:59' }] },
  ], clock);
  check('Solo se nombran comercios con foto, sin pausa y que no sean ESCABIADO', open.length === 1 && open[0].id === 'banca', open.map((c) => c.id).join());

  // Rotación: tirando de a uno, no se repite ninguno de los últimos ~60%
  const auto = A.DEFAULTS.find((d) => d.id === 'cena_finde');
  let recent = [];
  const seen = [];
  let repeatedTooSoon = false;
  for (let i = 0; i < 40; i++) {
    const pick = A.pickVariant(auto, { open, raining: false, recentKeys: recent });
    const key = A.variantKey(pick.variant);
    const dry = auto.variants.filter((v) => !v.lluvia).length;
    if (recent.slice(0, Math.floor(dry * 0.6)).includes(key)) repeatedTooSoon = true;
    if (pick.variant.lluvia) repeatedTooSoon = true;
    seen.push(key);
    recent = [key, ...recent.filter((k) => k !== key)].slice(0, 12);
  }
  check('40 envíos seguidos: nunca repite uno reciente ni usa los de lluvia sin lluvia', !repeatedTooSoon);
  check('Recorre todos los mensajes', new Set(seen).size === auto.variants.filter((v) => !v.lluvia).length, `${new Set(seen).size}`);

  const rainy = A.pickVariant(auto, { open, raining: true, recentKeys: [] });
  check('Si llueve usa un mensaje de lluvia', rainy.variant.lluvia === true);

  const noShops = A.pickVariant(auto, { open: [], raining: false, recentKeys: [] });
  check('Sin comercios abiertos del rubro no elige nada', noShops === null);

  const withName = { categories: ['Comida'], variants: [{ title: 'Hoy pinta {comercio}', body: 'Es {dia}' }] };
  const p = A.pickVariant(withName, { open, raining: false, recentKeys: [] });
  check('{comercio} trae un comercio abierto', p.comercio?.id === 'banca');
  check('fillText reemplaza y pone mayúscula', A.fillText('{dia} pinta {comercio}', { comercio: banca, clock }) === 'Viernes pinta La Banca');

  const mandados = A.DEFAULTS.find((d) => d.id === 'mandados_manana');
  check('Mandados sale aunque no haya ningún comercio abierto', A.pickVariant(mandados, { open: [], raining: false, recentKeys: [] }) !== null);

  check('Públicos: user → clientes, delivery → repartidores, comercio → comercios, sin rol → clientes',
    A.audienceOf({ role: 'user' }) === 'clients' && A.audienceOf({ role: 'delivery' }) === 'drivers' &&
    A.audienceOf({ role: 'comercio' }) === 'stores' && A.audienceOf(null) === 'clients' && A.audienceOf({ role: 'admin' }) === 'clients');
}

// ---------------------------------------------------------------- contra el emulador

await Promise.all(['automated_broadcasts', 'broadcasts', 'comercios', 'settings'].map(clear));
for (const u of (await db.collection('users').get()).docs) await db.recursiveDelete(u.ref);

async function addUser(id, role, tokens) {
  await db.collection('users').doc(id).set(role ? { role } : { name: id });
  for (const t of tokens) await db.collection('users').doc(id).collection('fcmTokens').doc(t).set({ token: t });
}
await addUser('cliente1', 'user', ['tok-c1a', 'tok-c1b']);
await addUser('cliente2', 'user', ['tok-c2']);
await addUser('sinrol', null, ['tok-sinrol']);
await addUser('admin1', 'admin', ['tok-admin']);
await addUser('cadete', 'delivery', ['tok-cadete']);
await addUser('local', 'comercio', ['tok-local']);

await db.collection('comercios').doc('banca').set({ name: 'La Banca', category: 'Comida', logo: 'x', isActive: true, schedules: [{ open: '19:30', close: '23:30' }] });
await db.collection('comercios').doc('lumael').set({ name: 'Lumael', category: 'Heladeria', logo: 'x', isActive: true, schedules: [{ open: '13:00', close: '23:50' }] });
await db.collection('settings').doc('driverAvailability').set({ onlineCount: 2 });
await db.collection('settings').doc('global').set({ rainMode: 'off' });

// Una de la versión vieja, prendida (nunca llegó a salir)
await db.collection('automated_broadcasts').doc('lunch_daily').set({ enabled: true, days: [5], time: '20:30', title: 'Vieja', body: 'Vieja' });

let calls = [];
const sendPush = async (tokens, notification, data) => { calls.push({ tokens, notification, data }); };
const run = (iso) => A.runPushAutomations({ db, sendPush, now: ar(iso) });
const auto = async (id) => (await db.collection('automated_broadcasts').doc(id).get()).data();

console.log('\nFábrica');
await run('2026-10-16T15:00:00');
{
  const snap = await db.collection('automated_broadcasts').get();
  const ids = snap.docs.map((d) => d.id).sort();
  check('Crea las de fábrica', A.DEFAULTS.every((d) => ids.includes(d.id)), ids.join());
  check('Borra las de la versión vieja', !ids.includes('lunch_daily'));
  check('No mandó nada fuera de horario', calls.length === 0);
}

console.log('\nTokens');
{
  const clients = (await A.tokensForAudience(db, 'clients')).sort();
  check('Clientes: role user, admin y sin rol (no cadetes ni comercios)',
    JSON.stringify(clients) === JSON.stringify(['tok-admin', 'tok-c1a', 'tok-c1b', 'tok-c2', 'tok-sinrol']), clients.join());
  const drivers = await A.tokensForAudience(db, 'drivers');
  check('Repartidores', drivers.length === 1 && drivers[0] === 'tok-cadete');
  const me = await A.tokensForAudience(db, 'me', { uid: 'cliente1' });
  check('"me" = solo mis celulares', me.length === 2);
  const owners = new Map();
  await A.tokensForAudience(db, 'clients', { owners });
  check('Anota de quién es cada token (para borrar los muertos)', owners.get('tok-c2') === 'cliente2' && owners.get('tok-sinrol') === 'sinrol');
}

console.log('\nViernes 20:35: cena');
calls = [];
let out = await run('2026-10-16T20:35:00');
{
  check('Sale una sola (cena_finde)', out.length === 1 && out[0].id === 'cena_finde' && out[0].status === 'sent', JSON.stringify(out));
  check('A los 5 celulares de clientes', calls.length === 1 && calls[0].tokens.length === 5);
  check('Con broadcastId para medir clics', !!calls[0]?.data.broadcastId && calls[0].data.type === 'automated_push');
  const b = await db.collection('broadcasts').doc(out[0].broadcastId).get();
  check('Queda en el historial como automática', b.exists && b.data().isAutomated === true && b.data().sentCount === 5);
  const a = await auto('cena_finde');
  check('Guarda el día, el mensaje usado y el resultado', a.lastSentDate === '2026-10-16' && a.recentKeys.length === 1 && a.lastResult.status === 'sent');
  check('No quedan llaves sin reemplazar', !/\{|\}/.test(out[0].title + out[0].body), out[0].title + ' / ' + out[0].body);
  if (out[0].url.startsWith('/#/comercio/')) check('Si nombra un comercio, lleva a su página', out[0].url === '/#/comercio/banca');
}
calls = [];
out = await run('2026-10-16T20:36:00');
check('Al minuto siguiente no se repite', calls.length === 0 && out.length === 0);

console.log('\nFrenos');
// Sábado 10:30 mandados sin repartidores
await db.collection('settings').doc('driverAvailability').set({ onlineCount: 0 });
calls = [];
out = await run('2026-10-17T10:31:00');
check('Sin repartidores no sale', calls.length === 0 && out[0]?.status === 'skipped');
check('Y queda anotado por qué', (await auto('mandados_manana')).lastResult.text === 'No había repartidores conectados');
// Se conecta uno dentro de la ventana
await db.collection('settings').doc('driverAvailability').set({ onlineCount: 1 });
calls = [];
out = await run('2026-10-17T10:40:00');
check('Si se conecta uno dentro de la ventana, sale', calls.length === 1 && out[0]?.id === 'mandados_manana' && out[0].url === '/#/mandados');

// Sábado 20:30 cena: hay 10 h de diferencia → sale (2 por día)
calls = [];
out = await run('2026-10-17T20:31:00');
check('Segunda del día, 10 h después: sale', calls.length === 1 && out[0]?.id === 'cena_finde');

// Domingo: campaña manual hace 2 h → la de las 20:00 no sale
await db.collection('broadcasts').add({ title: 'Manual', body: 'x', status: 'sent', createdAt: Timestamp.fromDate(ar('2026-10-18T18:00:00')) });
calls = [];
out = await run('2026-10-18T20:01:00');
check('Con una campaña manual hace 2 h no sale', calls.length === 0 && out[0]?.status === 'skipped', JSON.stringify(out));

// Martes: cena sin comercios de comida abiertos
await db.collection('comercios').doc('banca').update({ isPaused: true });
calls = [];
out = await run('2026-10-20T20:31:00');
check('Sin comida abierta no sale', calls.length === 0 && /No había comercios abiertos/.test(out[0]?.text || ''), JSON.stringify(out));
await db.collection('comercios').doc('banca').update({ isPaused: false });

// Tope de 2 por día y separación de 6 h: miércoles, dos a la misma hora
await db.collection('automated_broadcasts').doc('merienda').update({ enabled: true, days: [3], time: '18:30' });
calls = [];
out = await run('2026-10-21T18:31:00');
check('Dos a la misma hora: sale una y la otra espera 6 h', calls.length === 1 && out.filter((o) => o.status === 'sent').length === 1
  && /hace menos de 6 h/.test(out.find((o) => o.status === 'skipped')?.text || ''), JSON.stringify(out));

console.log('\nLluvia');
await db.collection('settings').doc('global').set({ rainMode: 'on' });
calls = [];
out = await run('2026-10-23T20:31:00');
check('Si llueve sale un mensaje de lluvia', calls.length === 1 && /lluvia|Llueve|☔|🌧️/i.test(out[0].title + out[0].body), out[0]?.title);
await db.collection('settings').doc('global').set({ rainMode: 'off' });

console.log('\nVarias semanas: no repite');
{
  const titles = [];
  for (let week = 0; week < 8; week++) {
    const day = new Date(Date.UTC(2026, 9, 30 + week * 7)); // viernes
    const iso = day.toISOString().slice(0, 10);
    calls = [];
    await run(`${iso}T20:31:00`);
    if (calls[0]) titles.push(calls[0].notification.title.replace(/La Banca/g, '{comercio}'));
  }
  let consecutive = false;
  for (let i = 1; i < titles.length; i++) if (titles[i] === titles[i - 1]) consecutive = true;
  check('8 viernes seguidos: salen todos', titles.length === 8, String(titles.length));
  check('Ningún viernes repite el mensaje del anterior', !consecutive, titles.join(' | '));
  check('Al menos 6 mensajes distintos en 8 semanas', new Set(titles).size >= 6, String(new Set(titles).size));
}

console.log(`\n${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
