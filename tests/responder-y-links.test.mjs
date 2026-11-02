// Responder un chat desde la notificación (functions/chat-reply.js) y links que abren la app
// (src/utils/app-links.js). Sin emuladores:
//
//   node tests/responder-y-links.test.mjs

import { createRequire } from 'module';
import assert from 'assert';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { makeReplyToken, readReplyToken, postReply, senderNameFor, TTL_MS } = require('./chat-reply.js');

// Firestore mínimo: alcanza para el secreto y para un pedido con su chat
function fakeDb(docs = {}) {
  const store = new Map(Object.entries(docs));
  const added = [];
  const ref = (path) => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (v, opts) => { store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...v } : v); },
    collection: (name) => col(`${path}/${name}`),
  });
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id}`),
    add: async (v) => { added.push({ path, v }); return ref(`${path}/x`); },
  });
  return {
    store, added,
    doc: ref,
    collection: col,
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v) => r.set(v) }),
  };
}

let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`✓ ${name}`); };

await test('el pase se lee y dice quién y en qué chat', async () => {
  const db = fakeDb();
  const token = await makeReplyToken(db, { chatId: 'o1_client-delivery', uid: 'cli' });
  assert.deepStrictEqual(await readReplyToken(db, token), { chatId: 'o1_client-delivery', uid: 'cli' });
});

await test('un pase tocado, vencido o de otro secreto no sirve', async () => {
  const db = fakeDb();
  const token = await makeReplyToken(db, { chatId: 'o1_client-delivery', uid: 'cli' });
  const [body, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ c: 'o1_client-delivery', u: 'otro', e: Date.now() + 1e6 })).toString('base64url');
  assert.strictEqual(await readReplyToken(db, `${forged}.${mac}`), null);
  assert.strictEqual(await readReplyToken(db, `${body}.x${mac.slice(1)}`), null);
  assert.strictEqual(await readReplyToken(db, token, Date.now() + TTL_MS + 1000), null);
  assert.strictEqual(await readReplyToken(db, ''), null);
});

await test('el nombre de quien responde sale como en la app', () => {
  const order = { userId: 'cli', driverId: 'cad' };
  assert.strictEqual(senderNameFor('cli', order, {}), 'Cliente');
  assert.strictEqual(senderNameFor('cad', order, { displayName: 'Alejo' }), 'Alejo');
  assert.strictEqual(senderNameFor('dueño', order, { displayName: 'Ana' }), 'Comercio');
});

const orderDocs = (status) => ({
  'orders/o1': { userId: 'cli', driverId: 'cad', status },
  'users/cad': { displayName: 'Alejo' },
});

await test('la respuesta queda como un mensaje del chat y suma sin leer al otro', async () => {
  const db = fakeDb(orderDocs('delivering'));
  const token = await makeReplyToken(db, { chatId: 'o1_client-delivery', uid: 'cad' });
  assert.deepStrictEqual(await postReply(db, { token, text: '  Ya llego  ' }), [200, 'ok']);
  assert.strictEqual(db.added.length, 1);
  assert.strictEqual(db.added[0].path, 'chats/o1_client-delivery/messages');
  assert.strictEqual(db.added[0].v.text, 'Ya llego');
  assert.strictEqual(db.added[0].v.senderId, 'cad');
  assert.strictEqual(db.added[0].v.senderName, 'Alejo');
  assert.strictEqual(db.store.get('chats/o1_client-delivery').lastMessage, 'Ya llego');
});

await test('sin respuesta si el pedido terminó, si ya no es del chat o si está vacía', async () => {
  const done = fakeDb(orderDocs('completed'));
  assert.strictEqual((await postReply(done, { token: await makeReplyToken(done, { chatId: 'o1_client-delivery', uid: 'cad' }), text: 'hola' }))[0], 409);

  const reassigned = fakeDb(orderDocs('delivering'));
  const old = await makeReplyToken(reassigned, { chatId: 'o1_client-delivery', uid: 'otroCadete' });
  assert.strictEqual((await postReply(reassigned, { token: old, text: 'hola' }))[0], 403);

  // Al cadete no le llegan los mensajes del chat cliente–comercio, y tampoco puede escribir ahí
  const otherChat = await makeReplyToken(reassigned, { chatId: 'o1_client-commerce', uid: 'cad' });
  assert.strictEqual((await postReply(reassigned, { token: otherChat, text: 'hola' }))[0], 403);

  assert.strictEqual((await postReply(reassigned, { token: old, text: '   ' }))[0], 400);
  assert.strictEqual(reassigned.added.length + done.added.length, 0);
});

const { hashFromAppLink } = await import('../src/utils/app-links.js');

await test('los links de GO! abren la pantalla del #', () => {
  assert.strictEqual(hashFromAppLink('https://godelivery-magdalena.web.app/#/tienda/lumal'), '#/tienda/lumal');
  assert.strictEqual(hashFromAppLink('https://godelivery-magdalena.web.app/#/mis-chats?chatId=o1_client-delivery'), '#/mis-chats?chatId=o1_client-delivery');
  assert.strictEqual(hashFromAppLink('https://godelivery-magdalena.web.app/'), '#/');
});

await test('otros links no mueven la app', () => {
  assert.strictEqual(hashFromAppLink('https://godelivery-magdalena.web.app/descargar.html'), null);
  assert.strictEqual(hashFromAppLink('https://otro-sitio.com/#/tienda/x'), null);
  assert.strictEqual(hashFromAppLink('http://godelivery-magdalena.web.app/#/tienda/x'), null);
  assert.strictEqual(hashFromAppLink('no es un link'), null);
});

console.log(`\n${passed} pruebas OK`);
