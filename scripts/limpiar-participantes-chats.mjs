// Saca de chats/{id}.participants a quien no es parte de ese chat, para que deje de verlo en su
// lista. No toca mensajes ni pedidos. Sin --aplicar sólo cuenta:
//   node scripts/limpiar-participantes-chats.mjs
//   node scripts/limpiar-participantes-chats.mjs --aplicar
import { createRequire } from 'module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { chatParties, chatTypeOf } = require('../functions/chat-access.js');
admin.initializeApp({ projectId: 'godelivery-magdalena' });
const db = admin.firestore();
const aplicar = process.argv.includes('--aplicar');

const orders = new Map();
const comercios = new Map();
const cached = async (map, col, id) => {
  if (!map.has(id)) map.set(id, (await db.collection(col).doc(id).get()).data() || null);
  return map.get(id);
};

const chats = await db.collection('chats').get();
let cambiados = 0, sacados = 0;
for (const c of chats.docs) {
  const d = c.data();
  if (!d.orderId || !Array.isArray(d.participants)) continue;
  const order = await cached(orders, 'orders', d.orderId);
  if (!order) continue; // sin pedido no se sabe quién es parte: se deja como está
  const comercio = order.comercioId ? await cached(comercios, 'comercios', order.comercioId) : null;
  const parties = chatParties(chatTypeOf(c.id, d), order, comercio);
  if (!parties) continue;
  const quedan = d.participants.filter((p) => parties.includes(p));
  if (quedan.length === d.participants.length) continue;
  cambiados++;
  sacados += d.participants.length - quedan.length;
  if (aplicar) await c.ref.update({ participants: quedan });
}
console.log(`${chats.size} chats, ${cambiados} con gente de más, ${sacados} participantes ${aplicar ? 'sacados' : 'a sacar (simulación)'}`);
process.exit(0);
