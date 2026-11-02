// Recordatorio de chat: si un mensaje sigue sin leer a los 2 minutos, se avisa una vez más.
// onNewChatMessage deja remindAt en el mensaje (solo si la otra parte tiene dónde recibir el aviso).
const { Timestamp, FieldValue } = require("firebase-admin/firestore");
const { chatParties, chatTypeOf } = require("./chat-access");

const REMIND_AFTER_MS = 2 * 60 * 1000;
const FINISHED = ["completed", "delivered", "cancelled"];

async function runChatReminders({ db, getUserTokens, sendPush, logger, now = Date.now() }) {
  const due = await db.collectionGroup("messages").where("remindAt", "<=", Timestamp.fromMillis(now)).limit(40).get();
  let sent = 0;
  for (const doc of due.docs) {
    const msg = doc.data();
    try {
      // Primero se saca: un error no lo repite cada minuto
      await doc.ref.update({ remindAt: FieldValue.delete() });
      if (msg.read) continue;
      const chatId = doc.ref.parent.parent.id;
      const orderSnap = await db.collection("orders").doc(chatId.split("_")[0]).get();
      if (!orderSnap.exists || FINISHED.includes(orderSnap.data().status)) continue;
      const order = orderSnap.data();
      const comercio = order.comercioId ? await db.collection("comercios").doc(order.comercioId).get() : null;
      const parties = chatParties(chatTypeOf(chatId), order, comercio && comercio.exists ? comercio.data() : null) || [];
      for (const uid of parties.filter((p) => String(p) !== String(msg.senderId))) {
        const tokens = await getUserTokens(uid);
        if (!tokens.length) continue;
        await sendPush(tokens, {
          title: `${msg.senderName || "Te escribieron"} sigue esperando`,
          body: "Tenés un mensaje sin leer sobre tu pedido.",
        }, {
          tag: `chat-${chatId}`,
          url: `#/mis-chats?chatId=${chatId}`,
          type: "chat_message",
          channelId: "chat_alerts",
          chatId,
          orderId: chatId.split("_")[0],
        });
        sent++;
      }
    } catch (err) {
      logger.warn("[chatReminders]", err && err.message ? err.message : err);
    }
  }
  return { due: due.size, sent };
}

module.exports = { runChatReminders, REMIND_AFTER_MS };
