import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, query, orderBy,
  serverTimestamp, arrayUnion, increment,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Los chats de pedidos, recorridos como los recorre la app (src/components/chat.js):
// abrir (setDoc merge del chat), leer mensajes, mandar (addDoc + setDoc merge del chat),
// marcar leído y escribir "escribiendo...". Cada parte del pedido, en cada orden posible.
//
//   npx firebase-tools emulators:exec --only firestore --config firebase.e2e.json "node tests/chats.test.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', 'firestore.rules'), 'utf8');

const env = await initializeTestEnvironment({
  projectId: 'godelivery-chats-test',
  firestore: { rules: RULES, host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080) },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/cliente'), { role: 'user', displayName: 'Vecina' });
  await setDoc(doc(db, 'users/cadete'), { role: 'delivery', deliveryStatus: 'approved', displayName: 'Eze' });
  await setDoc(doc(db, 'users/cadete2'), { role: 'delivery', deliveryStatus: 'approved', displayName: 'Otro' });
  await setDoc(doc(db, 'users/dueno'), { role: 'comercio', isComercio: true, displayName: 'Pizzeria' });
  await setDoc(doc(db, 'users/jefe'), { role: 'admin', isAdmin: true });
  await setDoc(doc(db, 'users/vecino'), { role: 'user' });
  await setDoc(doc(db, 'comercios/pizza'), { name: 'La Pizzeria', ownerId: 'dueno' });
  // Pedido sin cadete todavía, con cadete, mandado (sin comercio) y pedido manual del comercio.
  for (const [id, data] of Object.entries({
    sinCadete: { userId: 'cliente', comercioId: 'pizza', status: 'preparing' },
    conCadete: { userId: 'cliente', comercioId: 'pizza', status: 'on_the_way', driverId: 'cadete' },
    mandado:   { userId: 'cliente', status: 'on_the_way', driverId: 'cadete', isFavor: true },
    manual:    { userId: 'dueno', comercioId: 'pizza', status: 'ready', driverId: 'cadete', isManual: true },
  })) await setDoc(doc(db, `orders/${id}`), data);
});

const as = (uid) => env.authenticatedContext(uid).firestore();
let fails = 0;
async function check(name, p) {
  try { await p; console.log('  ok  ', name); } catch (e) { fails++; console.log('  FALLA', name, '→', e.message.split('\n')[0]); }
}

// Lo que hace la app al abrir el chat y al mandar un mensaje.
async function abrir(db, chatId, orderId, type, parts) {
  await setDoc(doc(db, 'chats', chatId), { orderId, type, participants: arrayUnion(...parts), lastActivityAt: serverTimestamp() }, { merge: true });
  await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc')));
  await getDoc(doc(db, 'chats', chatId));
}
async function mandar(db, chatId, orderId, type, uid, everyone) {
  const ref = await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: uid, text: 'hola', type: 'text', timestamp: serverTimestamp(), read: false });
  const updates = { orderId, type, participants: arrayUnion(...everyone), lastMessage: 'hola', lastMessageAt: serverTimestamp(), [`unread.${uid}`]: 0 };
  everyone.filter(p => p !== uid).forEach(p => { updates[`unread.${p}`] = increment(1); });
  await setDoc(doc(db, 'chats', chatId), updates, { merge: true });
  await updateDoc(doc(db, 'chats', chatId), { [`typing.${uid}`]: false });
  return ref;
}
async function leer(db, chatId, msgRef) {
  await updateDoc(doc(db, 'chats', chatId, 'messages', msgRef.id), { read: true });
}

console.log('cliente ↔ cadete: el cliente escribe antes de que haya cadete');
{
  const c = as('cliente'), k = as('cadete');
  await check('cliente abre el chat sin cadete', abrir(c, 'sinCadete_client-delivery', 'sinCadete', 'client-delivery', ['cliente']));
  await check('cliente manda', mandar(c, 'sinCadete_client-delivery', 'sinCadete', 'client-delivery', 'cliente', ['cliente', 'pizza']));
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'orders/sinCadete'), { driverId: 'cadete', status: 'on_the_way' }));
  await check('cadete (recién asignado) abre', abrir(k, 'sinCadete_client-delivery', 'sinCadete', 'client-delivery', ['cadete', 'cliente']));
  let m; await check('cadete manda', (async () => { m = await mandar(k, 'sinCadete_client-delivery', 'sinCadete', 'client-delivery', 'cadete', ['cliente', 'cadete', 'pizza']); })());
  await check('cliente marca leído', m ? leer(c, 'sinCadete_client-delivery', m) : Promise.reject(new Error('sin mensaje')));
}

console.log('cliente ↔ cadete: el cadete escribe primero');
{
  const c = as('cliente'), k = as('cadete');
  await check('cadete abre', abrir(k, 'conCadete_client-delivery', 'conCadete', 'client-delivery', ['cadete', 'cliente']));
  let m; await check('cadete manda', (async () => { m = await mandar(k, 'conCadete_client-delivery', 'conCadete', 'client-delivery', 'cadete', ['cliente', 'cadete', 'pizza']); })());
  await check('cliente abre y lee', abrir(c, 'conCadete_client-delivery', 'conCadete', 'client-delivery', ['cliente', 'cadete']));
  await check('cliente marca leído', m ? leer(c, 'conCadete_client-delivery', m) : Promise.reject(new Error('sin mensaje')));
  await check('cliente contesta', mandar(c, 'conCadete_client-delivery', 'conCadete', 'client-delivery', 'cliente', ['cliente', 'cadete', 'pizza']));
}

console.log('cliente ↔ cadete: el cadete manda antes de que exista el chat (doble toque rápido)');
{
  const k = as('cadete');
  await check('cadete manda sin abrir', mandar(k, 'mandado_client-delivery', 'mandado', 'client-delivery', 'cadete', ['cliente', 'cadete']));
  await check('cliente abre el mandado', abrir(as('cliente'), 'mandado_client-delivery', 'mandado', 'client-delivery', ['cliente', 'cadete']));
}

console.log('pedido reasignado a otro cadete');
{
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'orders/conCadete'), { driverId: 'cadete2' }));
  const k2 = as('cadete2');
  await check('el cadete nuevo abre', abrir(k2, 'conCadete_client-delivery', 'conCadete', 'client-delivery', ['cadete2', 'cliente']));
  await check('el cadete nuevo manda', mandar(k2, 'conCadete_client-delivery', 'conCadete', 'client-delivery', 'cadete2', ['cliente', 'cadete2', 'pizza']));
}

console.log('cliente ↔ comercio');
{
  const c = as('cliente'), d = as('dueno');
  await check('cliente abre', abrir(c, 'sinCadete_client-commerce', 'sinCadete', 'client-commerce', ['cliente', 'pizza']));
  await check('cliente manda', mandar(c, 'sinCadete_client-commerce', 'sinCadete', 'client-commerce', 'cliente', ['cliente', 'cadete', 'pizza']));
  await check('comercio abre', abrir(d, 'sinCadete_client-commerce', 'sinCadete', 'client-commerce', ['dueno', 'cliente']));
  await check('comercio contesta', mandar(d, 'sinCadete_client-commerce', 'sinCadete', 'client-commerce', 'dueno', ['cliente', 'cadete', 'pizza']));
}

console.log('comercio ↔ cadete (pedido manual)');
{
  const d = as('dueno'), k = as('cadete');
  await check('comercio abre', abrir(d, 'manual_commerce-delivery', 'manual', 'commerce-delivery', ['dueno', 'cadete']));
  await check('comercio manda', mandar(d, 'manual_commerce-delivery', 'manual', 'commerce-delivery', 'dueno', ['dueno', 'cadete', 'pizza']));
  await check('cadete abre', abrir(k, 'manual_commerce-delivery', 'manual', 'commerce-delivery', ['cadete', 'pizza']));
  await check('cadete contesta', mandar(k, 'manual_commerce-delivery', 'manual', 'commerce-delivery', 'cadete', ['dueno', 'cadete', 'pizza']));
}

console.log('la app escucha los mensajes ANTES de que exista el doc del chat (primera vez que se abre)');
{
  // openChat arranca la escucha de mensajes y crea el doc del chat después, en segundo plano.
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'orders/nuevo'), { userId: 'cliente', comercioId: 'pizza', status: 'on_the_way', driverId: 'cadete' }));
  await check('cadete escucha mensajes de un chat que todavía no existe', getDocs(query(collection(as('cadete'), 'chats/nuevo_client-delivery/messages'), orderBy('timestamp', 'asc'))));
  await check('cliente escucha mensajes de un chat que todavía no existe', getDocs(query(collection(as('cliente'), 'chats/nuevo_client-commerce/messages'), orderBy('timestamp', 'asc'))));
  await check('comercio escucha mensajes de un chat que todavía no existe', getDocs(collection(as('dueno'), 'chats/nuevo_client-commerce/messages')));
  await check('un vecino ajeno NO escucha un chat que todavía no existe', assertFails(getDocs(collection(as('vecino'), 'chats/nuevo_client-delivery/messages'))));
  await check('cadete lee el doc de un chat que todavía no existe', getDoc(doc(as('cadete'), 'chats/nuevo_client-delivery')));
}

console.log('soporte');
{
  const c = as('cliente'), k = as('cadete'), d = as('dueno');
  // "Ayuda con mi pedido": ticket con el id del pedido; el comercio usa el id del comercio.
  await check('cliente abre el soporte de su pedido (ticket todavía no existe)', getDoc(doc(c, 'support_chats/conCadete')));
  await check('cliente crea el ticket con el primer mensaje', setDoc(doc(c, 'support_chats/conCadete'), { userId: 'cliente', messages: [{ sender: 'user', text: 'hola' }] }));
  await check('cliente vuelve a leer su ticket', getDoc(doc(c, 'support_chats/conCadete')));
  await check('cliente agrega un mensaje', updateDoc(doc(c, 'support_chats/conCadete'), { messages: arrayUnion({ sender: 'user', text: 'sigo' }) }));
  await check('otro NO lee el ticket del cliente', assertFails(getDoc(doc(as('vecino'), 'support_chats/conCadete'))));
  await check('otro NO lista los tickets de soporte', assertFails(getDocs(collection(as('vecino'), 'support_chats'))));
  await check('cadete abre su soporte (driver_<uid>, todavía no existe)', getDoc(doc(k, 'support_chats/driver_cadete')));
  await check('cadete manda el primer mensaje', setDoc(doc(k, 'support_chats/driver_cadete'), { userId: 'cadete', messages: arrayUnion({ sender: 'user', text: 'ayuda' }) }, { merge: true }));
  await check('cadete manda el segundo mensaje', setDoc(doc(k, 'support_chats/driver_cadete'), { userId: 'cadete', messages: arrayUnion({ sender: 'user', text: 'otra' }) }, { merge: true }));
  await check('comercio abre el soporte del comercio (todavía no existe)', getDoc(doc(d, 'support_chats/pizza')));
  await check('admin contesta', updateDoc(doc(as('jefe'), 'support_chats/driver_cadete'), { messages: arrayUnion({ sender: 'admin', text: 'ok' }) }));
  await check('otro NO escribe en el ticket del cadete', assertFails(updateDoc(doc(as('vecino'), 'support_chats/driver_cadete'), { messages: arrayUnion({ sender: 'user', text: 'x' }) })));
}

console.log('admin y ajenos');
await check('admin lee cualquier chat', getDocs(collection(as('jefe'), 'chats/conCadete_client-delivery/messages')));
await check('un vecino ajeno NO lee', assertFails(getDocs(collection(as('vecino'), 'chats/conCadete_client-delivery/messages'))));
await check('un vecino ajeno NO escribe', assertFails(addDoc(collection(as('vecino'), 'chats/conCadete_client-delivery/messages'), { senderId: 'vecino', text: 'x' })));

await env.cleanup();
console.log(fails ? `\n${fails} FALLAS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
