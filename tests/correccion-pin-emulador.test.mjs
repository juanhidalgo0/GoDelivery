// correctDeliveryPin de punta a punta contra el emulador (token real, base real, función real).
//   FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:exec --config firebase.emulators-auth.json --only functions,firestore,auth --project demo-godelivery "node tests/correccion-pin-emulador.test.mjs"
import assert from 'node:assert/strict';
import { createRequire } from 'module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-godelivery';
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const URL_FN = `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${PROJECT}/us-central1/correctDeliveryPin`;

const signUp = async (email) => {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'prueba123', returnSecureToken: true })
  });
  const j = await res.json();
  return { uid: j.localId, token: j.idToken };
};
const call = async (token, orderId) => {
  const res = await fetch(URL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ orderId })
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const PIN = { lat: -35.0851221, lng: -57.4946806 };
const HOUSE = { lat: -35.0798, lng: -57.5258 };
const alexa = await signUp('alexa@prueba.test');
const otro = await signUp('otro@prueba.test');
const uid = 'rocio';
const other = { id: '2', name: 'Trabajo', address: 'Otra 123', coords: { lat: -35.07, lng: -57.51 } };
await db.doc(`users/${uid}`).set({
  savedAddresses: [{ id: '1', name: 'Casa', address: 'Doctor Patricio Brenan, Magdalena', notes: 'casa verde oliva', coords: PIN }, other],
  lastAddress: { address: 'Doctor Patricio Brenan, Magdalena', notes: 'casa verde oliva', coords: PIN }
});
const now = Date.now();
await db.doc('orders/p1').set({
  driverId: alexa.uid, userId: uid, status: 'completed', deliveryCoords: PIN,
  deliveredAt: admin.firestore.Timestamp.fromMillis(now - 20000)
});
await db.doc('orders/p1/live/driver').set({ ...HOUSE, accuracy: 6, fixAt: now - 27000 });

assert.equal((await call(null, 'p1')).status, 401);
assert.equal((await call(alexa.token, 'a/b')).status, 400);
assert.deepEqual((await call(otro.token, 'p1')).body, { corrected: false, reason: 'not_your_order' });
assert.equal((await db.doc(`users/${uid}`).get()).data().savedAddresses[0].coords.lat, PIN.lat);

assert.deepEqual((await call(alexa.token, 'p1')).body, { corrected: true });
const u = (await db.doc(`users/${uid}`).get()).data();
assert.deepEqual(u.savedAddresses[0].coords, HOUSE);
assert.equal(u.savedAddresses[0].notes, 'casa verde oliva');
assert.deepEqual(u.savedAddresses[1], other);
assert.deepEqual(u.lastAddress.coords, HOUSE);
assert.deepEqual(u.pinCorrection, { from: PIN, to: HOUSE });
assert.equal((await db.doc('orders/p1').get()).data().deliveryPinCorrection.by, alexa.uid);
assert.deepEqual((await call(alexa.token, 'p1')).body, { corrected: false, reason: 'already_corrected' });

console.log('correccion-pin-emulador: ok');
process.exit(0);
