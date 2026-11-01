// Avisos que salen solos hacia WhatsApp: cambios de estado de los pedidos del bot, la
// respuesta del comercio a un pedido escrito y las respuestas del equipo de soporte.
//
// Solo llegan si el cliente escribió en las últimas 24 h (regla de WhatsApp). Los pedidos
// nacen en la charla, así que en la práctica siempre es así; si no, Meta rechaza el envío y
// queda en el log.
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { money, FOOTER } = require("./bot");
const { trackingUrl } = require("./tracking");

// Sin respuesta del comercio en este tiempo, se le ofrece al cliente un mandado
const QUOTE_WAIT_MS = 10 * 60 * 1000;
// Precio enviado y el cliente no contestó
const QUOTE_ANSWER_MS = 30 * 60 * 1000;

function createNotify({ db, sender, orders, push }) {
  // push: { getUserTokens, sendPush } de index.js

  async function setSession(waId, step, data) {
    await db.collection("wa_sessions").doc(waId).set({ step, data, updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  // ── Pedidos ──
  // Apagados por defecto: cada aviso es un mensaje que Meta cobra pasados los 1.000 gratis del mes.
  // El cliente sigue todo en el link de la confirmación. Se prenden con settings/whatsapp_bot { notify: true }.
  async function notifyEnabled() {
    const snap = await db.collection("settings").doc("whatsapp_bot").get().catch(() => null);
    return !!(snap && snap.exists && snap.data().notify === true);
  }

  async function onOrderChange(before, after) {
    const to = after.waPhone;
    if (!to) return;
    const changed = (!before.driverId && after.driverId) || before.status !== after.status || (!before.isAtDoor && after.isAtDoor);
    if (!changed || !(await notifyEnabled())) return;
    const num = after.orderId ? `#${after.orderId}` : "";
    const isCadeteria = after.isCommerceCadeteria === true;
    const msgs = [];

    if (!before.driverId && after.driverId) {
      const who = after.driverName || "Un cadete";
      if (isCadeteria) msgs.push(`🛵 *${who}* va para tu local (${num}).`);
      else if (after.isFavor) msgs.push(`🛵 *${who}* tomó tu pedido ${num} y ya se puso en marcha.`);
      else msgs.push(`🛵 *${who}* va a buscar tu pedido ${num} a ${after.comercioName || "el comercio"}.`);
      // El seguimiento va como botón de link, sin la URL larga en el texto
      if (!isCadeteria && after.trackingToken) msgs[msgs.length - 1] = { text: msgs[msgs.length - 1], link: { title: "📍 Ver en el mapa", url: trackingUrl(after.trackingToken) } };
    }
    if (before.status !== after.status) {
      if (after.status === "confirmed" && !after.isFavor && !after.waQuoteId) {
        msgs.push(`👨‍🍳 *${after.comercioName || "El comercio"}* aceptó tu pedido ${num}${after.preparationTimeMinutes ? ` (unos ${after.preparationTimeMinutes} min)` : ""}.`);
      }
      if (after.status === "delivering" && !isCadeteria) msgs.push(`🛵 Tu pedido ${num} va en camino.`);
      if (after.status === "completed") msgs.push(isCadeteria ? `✅ Envío ${num} terminado. ¡Gracias!` : `✅ Pedido ${num} entregado. ¡Gracias por pedir en GO! 💛`);
      if (after.status === "cancelled" && after.cancelledBy === "client") {
        msgs.push(`👍 Cancelaste el pedido ${num}. Escribí *menú* cuando quieras pedir otra cosa.`);
      } else if (after.status === "cancelled" && after.cancelledBy !== "cliente") {
        msgs.push(`❌ Tu pedido ${num} fue cancelado${after.cancelReason ? `: ${after.cancelReason}` : "."}\nSi necesitás ayuda, escribí *menú* y elegí *Hablar con alguien*.`);
      }
    }
    if (!before.isAtDoor && after.isAtDoor) msgs.push(isCadeteria ? `📍 El cadete llegó a tu local.` : `📍 ¡Tu cadete llegó! Salí a recibirlo.`);

    if (msgs.length) await sender.send(to, msgs.map((m) => (typeof m === "string" ? { text: m } : m)));
  }

  // ── Pedido escrito a un comercio ──
  async function onQuoteWritten(id, before, after) {
    if (!after) return;
    const prev = before ? before.status : null;
    if (prev === after.status) return;
    const to = after.waPhone;

    if (!before && after.status === "waiting") return alertComercio(id, after);

    if (prev === "waiting" && after.status === "quoted") {
      const c = await db.collection("comercios").doc(after.comercioId).get();
      const comercio = c.exists ? { id: c.id, ...c.data() } : { id: after.comercioId };
      const p = await orders.quoteCommerce({ comercio, deliveryCoords: after.deliveryCoords, productsTotal: after.price });
      await db.collection("wa_quotes").doc(id).update({ pricing: p, quotedAtMs: Date.now() });
      const lines = [`Productos: ${money(p.subtotal)}`, `Envío: ${money(p.deliveryCost)}${p.isRaining ? " (incluye lluvia 🌧️)" : ""}`];
      if (p.appUsageFee) lines.push(`Uso de la app: ${money(p.appUsageFee)}`);
      await sender.send(to, [{
        text: `🏪 *${after.comercioName}* lo tiene ✅\n\n${lines.join("\n")}\n*Total: ${money(p.total)}*` +
          (after.prepMinutes ? `\nListo en unos ${after.prepMinutes} min.` : "") +
          (after.commerceNote ? `\n\n💬 _${after.commerceNote}_` : "") +
          "\n\n¿Lo confirmamos?",
        buttons: [{ id: `q_ok:${id}`, title: "✅ Confirmar" }, { id: `q_no:${id}`, title: "No, gracias" }],
        asButtons: true,
        footer: FOOTER,
      }]);
      await setSession(to, "k_quoted", { quoteId: id, comercio: { id: after.comercioId, name: after.comercioName } });
      return;
    }

    if (prev === "waiting" && (after.status === "rejected" || after.status === "expired")) {
      const why = after.status === "expired"
        ? "no respondió a tiempo"
        : `no puede tomar tu pedido${after.rejectReason ? ` (${after.rejectReason})` : ""}`;
      await sender.send(to, [{
        text: `😕 *${after.comercioName}* ${why}.\n¿Querés que un cadete te lo consiga en otro lado?`,
        buttons: [{ id: `qm:${id}`, title: "🛒 Sí, mandado" }, { id: "go_menu", title: "Ver menú" }],
      }]);
      await setSession(to, "idle", {});
      return;
    }

    if (prev === "quoted" && after.status === "expired") {
      await sender.send(to, [{ text: `⌛ Se venció el precio de *${after.comercioName}* porque no llegaste a confirmar. Si todavía lo querés, pedilo de nuevo.`, buttons: [{ id: "go_menu", title: "Ver menú" }] }]);
      await setSession(to, "idle", {});
    }
  }

  // Además del aviso en el panel (con alarma), una notificación al celular del dueño.
  async function alertComercio(id, q) {
    try {
      const c = await db.collection("comercios").doc(q.comercioId).get();
      let ownerId = c.exists ? c.data().ownerId : null;
      if (!ownerId) {
        const u = await db.collection("users").where("comercioId", "==", q.comercioId).limit(1).get();
        ownerId = u.empty ? null : u.docs[0].id;
      }
      if (!ownerId) return;
      const tokens = await push.getUserTokens(ownerId);
      await push.sendPush(tokens, {
        title: "📨 Te consultan un pedido",
        body: `${q.customerName || "Un cliente"}: ${String(q.requestText || "Mirá el pedido").slice(0, 110)}`,
      }, { url: `#/mi-comercio/${q.comercioId}/orders`, type: "wa_quote", quoteId: id, persistent: "true" });
    } catch (err) {
      logger.warn(`[WhatsApp] No se pudo avisar al comercio de la consulta ${id}:`, err);
    }
  }

  // Cada pocos minutos: consultas sin respuesta y precios sin confirmar.
  async function expireQuotes() {
    const snap = await db.collection("wa_quotes").where("status", "in", ["waiting", "quoted"]).get();
    const now = Date.now();
    for (const d of snap.docs) {
      const q = d.data();
      const late = q.status === "waiting"
        ? now - (q.createdAtMs || 0) > QUOTE_WAIT_MS
        : now - (q.quotedAtMs || q.createdAtMs || 0) > QUOTE_ANSWER_MS;
      if (!late) continue;
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        if (fresh.exists && fresh.data().status === q.status) tx.update(d.ref, { status: "expired", expiredAt: FieldValue.serverTimestamp() });
      }).catch((err) => logger.warn(`[WhatsApp] No se pudo vencer la consulta ${d.id}:`, err));
    }
  }

  // ── Soporte: lo que contesta el equipo desde el panel le llega al WhatsApp ──
  async function onSupportChat(docId, before, after) {
    if (!after || !(after.source === "whatsapp_bot" || after.isWhatsAppBot === true)) return;
    const prev = Array.isArray(before && before.messages) ? before.messages.length : 0;
    const all = Array.isArray(after.messages) ? after.messages : [];
    const fresh = all.slice(prev).filter((m) => m && ["admin", "support"].includes(m.sender));
    if (!fresh.length) return;
    const to = String(after.userPhone || docId).replace(/\D/g, "");
    const replies = fresh.map((m) => ({
      text: m.text ? `🙋 ${m.text}` : (m.image ? "🙋 Te mandamos una imagen. Para verla, pedí que te la reenvíen por acá." : "🙋 Te mandamos un audio. Para escucharlo, pedí que te lo reenvíen por acá."),
    }));
    await sender.send(to, replies);
    // Mientras el equipo responde, lo que escriba el cliente sigue yendo a soporte
    await db.collection("wa_sessions").doc(to).set({ step: "support", data: {}, updatedAtMs: Date.now() }, { merge: true });
  }

  // Se conectó un cadete: avisa a los que pidieron "Avisame" cuando no había ninguno (wa_waitlist).
  // La sesión sigue en el resumen, así que el botón Confirmar crea el pedido.
  async function onDriverOnline() {
    const snap = await db.collection("wa_waitlist").where("until", ">", Date.now()).get();
    for (const doc of snap.docs) {
      await doc.ref.delete().catch(() => {});
      await sender.send(doc.id, [{
        text: "🛵 ¡Ya hay un cadete conectado! ¿Confirmamos tu pedido?",
        buttons: [{ id: "c_ok", title: "✅ Confirmar" }, { id: "go_menu", title: "Ver menú" }],
        asButtons: true,
      }]);
    }
  }

  return { onOrderChange, onQuoteWritten, expireQuotes, onSupportChat, onDriverOnline };
}

module.exports = { createNotify, QUOTE_WAIT_MS, QUOTE_ANSWER_MS };
