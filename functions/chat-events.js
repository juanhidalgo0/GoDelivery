// Dos cosas del chat que pasan solo en el servidor:
// - Avisos del pedido dentro de la conversación ("Alejo retiró tu pedido"). Id fijo por evento: no se
//   repiten; van con read: true para no sumar al contador, y orderEvent para no mandar push (de eso ya
//   se ocupa onOrderStatusChange).
// - Alerta al admin por insultos o por querer cobrar por fuera de la app. Solo avisa: no bloquea ni
//   borra nada, y una persona decide mirando la conversación.
const { FieldValue } = require("firebase-admin/firestore");

const first = (name, fallback) => String(name || "").trim().split(/\s+/)[0] || fallback;

function orderChatEvents(before, after) {
  const who = first(after.driverName, "El repartidor");
  const out = [];
  if (after.driverId && before.driverId !== after.driverId) out.push([`ev_accepted_${after.driverId}`, `${who} tomó tu pedido`]);
  if (after.status === "delivering" && before.status !== "delivering") out.push(["ev_delivering", `${who} retiró tu pedido y va en camino`]);
  if (after.isAtDoor && !before.isAtDoor) out.push(["ev_at_door", `${who} llegó a tu puerta`]);
  if (after.status === "completed" && before.status !== "completed") out.push(["ev_completed", "Pedido entregado"]);
  return out;
}

async function writeOrderChatEvents(db, orderId, before, after) {
  // Pedidos del bot: el cliente no tiene la app y el chat no se usa
  if (after.source === "whatsapp_bot" || !after.userId) return 0;
  const events = orderChatEvents(before, after);
  if (!events.length) return 0;
  const chat = db.collection("chats").doc(`${orderId}_client-delivery`);
  await chat.set({ orderId, type: "client-delivery" }, { merge: true });
  await Promise.all(events.map(([id, text]) => chat.collection("messages").doc(id).set({
    senderId: "system", senderName: "GO!", type: "system", text, read: true, orderEvent: true, timestamp: FieldValue.serverTimestamp(),
  })));
  return events.length;
}

const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Cosas claras, para no llenar la bandeja: "boludo" acá es hasta cariñoso y no se marca.
const INSULTS = /\b(pelotud[oa]s?|hij[oa]s? de (re ?)?puta|la concha de|la puta madre|forr[oa]s?|mogolic[oa]s?|cagon(a)?|sorete|te voy a (cagar a trompadas|matar|romper))\b/;
const OFF_APP = /\b(por fuera de la app|fuera de la app|sin (usar )?la app|sin pasar por la app|cancela(lo)? (el pedido|y te)|te cobro (aparte|directo|por fuera)|arreglamos? (por fuera|entre nosotros)|pasame por privado|la proxima (pedime|escribime) (directo|a mi))\b/;

function flagReason(text) {
  const t = norm(text);
  if (INSULTS.test(t)) return "Insultos o amenazas";
  if (OFF_APP.test(t)) return "Querer arreglar por fuera de la app";
  return null;
}

/** Devuelve el motivo si lo anotó en Admin → Errores y auditoría; si no, null. */
async function flagChatMessage(db, { chatId, messageId, message }) {
  if (message.type && message.type !== "text") return null;
  const reason = flagReason(message.text);
  if (!reason) return null;
  const id = `chat_flag_${messageId}`;
  const sample = {
    items: [
      { label: `${message.senderName || "Alguien"}: "${String(message.text).slice(0, 200)}"` },
      { label: `Pedido: ${chatId.split("_")[0]} · Chat: ${chatId.split("_").slice(1).join("_")}` },
    ],
    help: "Lo marcó una búsqueda de palabras: puede ser un error. Mirá la conversación antes de hacer algo. Se abre desde Admin → Pedidos.",
    at: new Date(),
  };
  await db.collection("client_errors").doc(id).set({
    fingerprint: id, kind: "auditoria", check: "chat_flag", severity: "media", network: false,
    message: `Chat para revisar: ${reason}`, normalized: `Chat: ${reason}`, frame: "", affected: 1, count: 1, userCount: 0,
    status: "open", firstSeen: FieldValue.serverTimestamp(), lastSeen: FieldValue.serverTimestamp(), lastCheckedAt: FieldValue.serverTimestamp(), lastSample: sample, firstSample: sample,
  });
  return reason;
}

module.exports = { orderChatEvents, writeOrderChatEvents, flagReason, flagChatMessage };
