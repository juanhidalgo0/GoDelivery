// Responder un chat desde la notificación, sin abrir la app (GoNativePlugin en Android y iOS).
// La app no está abierta y no tiene la sesión de Firebase: cada push de chat lleva un pase firmado
// que dice quién puede responder y en qué chat. El pase vence a los 7 días y solo sirve para
// mandar texto a ese chat.
const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { chatParties, chatTypeOf } = require("./chat-access");

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 1000;
const SECRET_DOC = "wa_secrets/chat_reply";

let secretCache = null;
async function getSecret(db) {
  if (secretCache) return secretCache;
  const ref = db.doc(SECRET_DOC);
  // La primera vez se crea; si dos instancias llegan juntas, gana una y la otra la lee
  const key = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().key) return snap.data().key;
    const fresh = crypto.randomBytes(32).toString("hex");
    tx.set(ref, { key: fresh, createdAt: FieldValue.serverTimestamp() });
    return fresh;
  });
  secretCache = key;
  return key;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sign = (key, body) => b64url(crypto.createHmac("sha256", key).update(body).digest());

async function makeReplyToken(db, { chatId, uid, now = Date.now() }) {
  const body = b64url(JSON.stringify({ c: chatId, u: uid, e: now + TTL_MS }));
  return `${body}.${sign(await getSecret(db), body)}`;
}

/** { chatId, uid } si el pase es válido, si no null. */
async function readReplyToken(db, token, now = Date.now()) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = sign(await getSecret(db), body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
  if (!data || typeof data.c !== "string" || typeof data.u !== "string" || !(data.e > now)) return null;
  return { chatId: data.c, uid: data.u };
}

const senderNameFor = (uid, order, user) => {
  const name = (user && (user.displayName || user.name)) || "";
  if (uid === order.userId) return name || "Cliente";
  if (uid === order.driverId) return name || "Repartidor";
  return "Comercio";
};

/**
 * Escribe la respuesta como un mensaje más del chat. Devuelve [status, mensaje]. El aviso al otro
 * lo manda onNewChatMessage, como con cualquier mensaje.
 */
async function postReply(db, { token, text }) {
  const clean = String(text || "").trim().slice(0, MAX_TEXT);
  if (!clean) return [400, "Mensaje vacío"];
  const pass = await readReplyToken(db, token);
  if (!pass) return [403, "Pase vencido o inválido"];
  const { chatId, uid } = pass;

  const chatRef = db.collection("chats").doc(chatId);
  const chatSnap = await chatRef.get();
  const chatData = chatSnap.exists ? chatSnap.data() : {};
  const orderId = chatData.orderId || chatId.split("_")[0];
  const orderSnap = await db.collection("orders").doc(orderId).get();
  if (!orderSnap.exists) return [404, "El pedido ya no existe"];
  const order = orderSnap.data();
  const comercioSnap = order.comercioId ? await db.collection("comercios").doc(order.comercioId).get() : null;
  const parties = chatParties(chatTypeOf(chatId, chatData), order, comercioSnap && comercioSnap.exists ? comercioSnap.data() : null);
  // Si al cadete le sacaron el pedido después del aviso, ya no es parte del chat
  if (!parties || !parties.includes(uid)) return [403, "Ya no sos parte de este chat"];
  // Lo mismo que muestra la app: con el pedido entregado o cancelado el chat queda de solo lectura
  if (order.status === "completed" || order.status === "cancelled") return [409, "El chat está cerrado"];

  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : {};
  await chatRef.collection("messages").add({
    senderId: uid,
    senderName: senderNameFor(uid, order, user),
    senderPhoto: user.photoURL || user.profilePhoto || null,
    text: clean,
    type: "text",
    read: false,
    fromNotification: true,
    timestamp: FieldValue.serverTimestamp(),
  });
  const unread = { [uid]: 0 };
  parties.filter((p) => p !== uid).forEach((p) => { unread[p] = FieldValue.increment(1); });
  await chatRef.set({
    orderId,
    type: chatTypeOf(chatId, chatData),
    participants: FieldValue.arrayUnion(...parties),
    lastMessage: clean,
    lastMessageAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
    unread,
  }, { merge: true });
  return [200, "ok"];
}

module.exports = { makeReplyToken, readReplyToken, postReply, senderNameFor, TTL_MS };
