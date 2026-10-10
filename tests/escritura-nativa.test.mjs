// Ubicación del repartidor por la red nativa (src/utils/firestore-rest.js): que el pedido REST
// pase las reglas reales igual que el SDK y deje los documentos como los deja el SDK.
//
//   firebase emulators:exec --only firestore --project demo-godelivery "node tests/escritura-nativa.test.mjs"
//
// Usa el emulador de Firestore de FIRESTORE_EMULATOR_HOST (por defecto 127.0.0.1:8080).

import { buildCommit } from '../src/utils/firestore-rest.js';

const HOST = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}`;
const PROJECT = 'demo-godelivery';
const DOCS = `${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log('  OK   ' + label + (detail ? `  (${detail})` : '')); }
  else { fail++; console.log('  FALLO ' + label + (detail ? '  → ' + detail : '')); }
}

// El emulador acepta tokens sin firmar: así se escribe "como" un usuario y se evalúan las reglas
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (uid) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now, iat: now, exp: now + 3600,
    sub: uid, user_id: uid, firebase: { sign_in_provider: 'custom', identities: {} },
  })}.`;
};

async function commitAs(uid, path, fields, opts) {
  const { url, body } = buildCommit(PROJECT, path, fields, opts);
  const res = await fetch(`${HOST}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uid === 'owner' ? 'owner' : tokenFor(uid)}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const read = async (path) => (await fetch(`${DOCS}/${path}`, { headers: { Authorization: 'Bearer owner' } })).json();

// Datos de partida (como administrador del emulador, sin reglas)
await fetch(`${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await commitAs('owner', 'users/d1', { role: 'delivery', displayName: 'Repartidor', isOnline: true });
await commitAs('owner', 'users/d2', { role: 'delivery', displayName: 'Otro', isOnline: true });
await commitAs('owner', 'orders/o1', { driverId: 'd1', userId: 'c1', status: 'accepted', total: 1000 });

console.log('\n=========== UBICACIÓN POR LA RED NATIVA ===========');

const live = { lat: -35.08, lng: -57.51, heading: 90, speed: 7.5, fixAt: Date.now(), accuracy: 4.2 };
let r = await commitAs('d1', 'orders/o1/live/driver', live, { serverTime: ['updatedAt'] });
check('el repartidor asignado escribe live/driver', r.status === 200, r.status !== 200 ? JSON.stringify(r.body).slice(0, 200) : '');
let d = await read('orders/o1/live/driver');
check('live/driver: fixAt queda como número entero', d.fields?.fixAt?.integerValue === String(live.fixAt));
check('live/driver: updatedAt con la hora del servidor', !!d.fields?.updatedAt?.timestampValue);
check('live/driver: lat, lng, speed, accuracy', d.fields?.lat?.doubleValue === live.lat && d.fields?.speed?.doubleValue === 7.5 && d.fields?.accuracy?.doubleValue === 4.2);

// Quieto: velocidad 0 y rumbo 0 viajan como enteros; las reglas piden "number", no "float"
r = await commitAs('d1', 'orders/o1/live/driver', { ...live, speed: 0, heading: 0 }, { serverTime: ['updatedAt'] });
check('parado (velocidad y rumbo 0) también pasa las reglas', r.status === 200, r.status !== 200 ? JSON.stringify(r.body).slice(0, 200) : '');

r = await commitAs('d1', 'orders/o1', { driverLocation: { lat: -35.08, lng: -57.51 } }, { merge: ['driverLocation'], serverTime: ['driverLocation.updatedAt'] });
check('el repartidor actualiza driverLocation del pedido', r.status === 200, r.status !== 200 ? JSON.stringify(r.body).slice(0, 200) : '');
d = await read('orders/o1');
check('el pedido conserva el resto de los campos', d.fields?.status?.stringValue === 'accepted' && d.fields?.total?.integerValue === '1000');
const dl = d.fields?.driverLocation?.mapValue?.fields;
check('driverLocation queda con lat, lng y updatedAt', !!(dl?.lat && dl?.lng && dl?.updatedAt?.timestampValue));

r = await commitAs('d1', 'users/d1', { currentLocation: { lat: -35.08, lng: -57.51 } }, { merge: ['currentLocation'], serverTime: ['currentLocation.updatedAt'] });
check('el repartidor actualiza su currentLocation', r.status === 200, r.status !== 200 ? JSON.stringify(r.body).slice(0, 200) : '');
d = await read('users/d1');
check('el perfil conserva el resto de los campos', d.fields?.role?.stringValue === 'delivery' && d.fields?.isOnline?.booleanValue === true);

console.log('\n=========== LO QUE LAS REGLAS TIENEN QUE FRENAR ===========');
r = await commitAs('d2', 'orders/o1/live/driver', live, { serverTime: ['updatedAt'] });
check('otro repartidor no puede escribir la ubicación del pedido', r.status === 403, `respondió ${r.status}`);
r = await commitAs('d1', 'orders/o1/live/driver', { ...live, extra: 1 }, { serverTime: ['updatedAt'] });
check('un campo de más se rechaza', r.status === 403, `respondió ${r.status}`);

console.log(`\n${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
