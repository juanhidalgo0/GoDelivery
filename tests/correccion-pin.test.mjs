// node tests/correccion-pin.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { rejection, profileUpdate, correctPin } = require('../functions/pin-correction.js');

// Pedido 2408 real: pin en una punta de Brenan, entregado en la otra.
const PIN = { lat: -35.0851221, lng: -57.4946806 };
const HOUSE = { lat: -35.079805065659386, lng: -57.525854777715516 };
const NOW = 1793500400000;
const DELIVERED = NOW - 30000;
const order = (extra = {}) => ({
  driverId: 'alexa', userId: 'rocio', status: 'completed', deliveryCoords: PIN,
  deliveredAt: { toMillis: () => DELIVERED }, ...extra
});
const live = (extra = {}) => ({ ...HOUSE, accuracy: 6, fixAt: DELIVERED - 7000, ...extra });

// Caso real
assert.equal(rejection(order(), live(), 'alexa', NOW), null);

// Rechazos
const cases = [
  [null, live(), 'alexa', 'order_not_found'],
  [order(), live(), 'otro', 'not_your_order'],
  [order({ status: 'delivering' }), live(), 'alexa', 'not_delivered'],
  [order({ isTrip: true }), live(), 'alexa', 'not_a_delivery'],
  [order({ userId: null }), live(), 'alexa', 'no_customer_pin'],
  [order({ deliveryPinCorrection: {} }), live(), 'alexa', 'already_corrected'],
  [order(), null, 'alexa', 'no_gps'],
  [order(), live({ accuracy: 80 }), 'alexa', 'gps_not_precise'],
  [order(), live({ fixAt: DELIVERED - 600000 }), 'alexa', 'gps_too_old'],
  [order(), live({ lat: PIN.lat + 0.001, lng: PIN.lng }), 'alexa', 'close_enough'],
];
for (const [o, l, uid, reason] of cases) assert.equal(rejection(o, l, uid, NOW), reason);
assert.equal(rejection(order(), live(), 'alexa', DELIVERED + 31 * 60000), 'too_late');

// Perfil: sólo cambia lo que tenía ese pin
const other = { id: '2', name: 'Trabajo', address: 'Otra 123', coords: { lat: -35.07, lng: -57.51 } };
const up = profileUpdate({
  savedAddresses: [{ id: '1', name: 'Casa', address: 'Doctor Patricio Brenan, Magdalena', notes: 'casa verde oliva', coords: PIN }, other],
  lastAddress: { address: 'Doctor Patricio Brenan, Magdalena', notes: 'casa verde oliva', coords: PIN }
}, PIN, HOUSE);
assert.deepEqual(up.savedAddresses[0].coords, HOUSE);
assert.equal(up.savedAddresses[0].notes, 'casa verde oliva');
assert.deepEqual(up.savedAddresses[1], other);
assert.deepEqual(up.lastAddress.coords, HOUSE);
assert.deepEqual(up.pinCorrection, { from: PIN, to: HOUSE });

const untouched = profileUpdate({ savedAddresses: [other], lastAddress: { coords: other.coords } }, PIN, HOUSE);
assert.equal(untouched.savedAddresses, undefined);
assert.equal(untouched.lastAddress, undefined);

// Transacción completa con una base falsa
const docs = {
  'orders/o1': order(), 'orders/o1/live/driver': live(),
  'users/rocio': { savedAddresses: [{ id: '1', coords: PIN }], lastAddress: { coords: PIN } }
};
const ref = (path) => ({ path, collection: (c) => ({ doc: (id) => ref(`${path}/${c}/${id}`) }) });
const db = {
  collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }),
  runTransaction: (fn) => fn({
    get: async (r) => ({ exists: r.path in docs, data: () => docs[r.path] }),
    update: (r, data) => { docs[r.path] = { ...docs[r.path], ...data }; }
  })
};
assert.deepEqual(await correctPin(db, 'alexa', 'o1', NOW), { corrected: true });
assert.deepEqual(docs['users/rocio'].savedAddresses[0].coords, { lat: HOUSE.lat, lng: HOUSE.lng });
assert.deepEqual(docs['orders/o1'].deliveryPinCorrection.to, { lat: HOUSE.lat, lng: HOUSE.lng });
assert.deepEqual(await correctPin(db, 'alexa', 'o1', NOW), { corrected: false, reason: 'already_corrected' });

console.log('correccion-pin: ok');
