// Bot de WhatsApp con la API oficial de Meta. index.js de functions solo conecta estas piezas
// con sus triggers; acá no hay nada que dependa de Express ni de un servidor aparte.
const logger = require("firebase-functions/logger");
const { cfg, isConfigured, verifySignature, createSender } = require("./cloud-api");
const { createOrders, nationalPhone } = require("./orders");
const { createComercios } = require("./comercios");
const { createBot } = require("./bot");
const { createNotify } = require("./notify");

// Si el dueño contesta a mano desde la app WhatsApp Business (coexistencia), el bot se calla
// en esa charla este tiempo desde la última respuesta manual.
const HUMAN_PAUSE_MS = 30 * 60 * 1000;
// Mensajes que llegan muy tarde (Meta reintenta después de una caída) no se contestan
const MAX_MESSAGE_AGE_MS = 15 * 60 * 1000;

function createWhatsApp({ db, helpers, push }) {
  const sender = createSender(db);
  const orders = createOrders(db, helpers);
  const comercios = createComercios(db);
  const bot = createBot({ db, orders, comercios, sender });
  const notify = createNotify({ db, sender, orders, push });

  let settingsCache = { at: 0, enabled: true };
  // Interruptor general en settings/whatsapp_bot { enabled: false } para apagarlo sin deployar
  async function botEnabled() {
    if (Date.now() - settingsCache.at < 60000) return settingsCache.enabled;
    const snap = await db.collection("settings").doc("whatsapp_bot").get().catch(() => null);
    settingsCache = { at: Date.now(), enabled: !(snap && snap.exists && snap.data().enabled === false) };
    return settingsCache.enabled;
  }

  // Mensaje de Meta → { kind, text, id, title, location, media }
  async function parse(m, waId) {
    switch (m.type) {
      case "text": return { kind: "text", text: (m.text && m.text.body) || "" };
      case "interactive": {
        const r = m.interactive && (m.interactive.button_reply || m.interactive.list_reply);
        return r ? { kind: "reply", id: r.id, title: r.title } : { kind: "other" };
      }
      case "button": return { kind: "text", text: (m.button && m.button.text) || "" };
      case "location": {
        const l = m.location || {};
        return { kind: "location", location: { lat: l.latitude, lng: l.longitude, name: l.name || "", address: l.address || "" } };
      }
      case "audio":
      case "voice":
      case "image":
      case "document":
      case "video": {
        const part = m[m.type] || {};
        const type = m.type === "voice" ? "audio" : m.type;
        const url = await sender.saveMedia(part.id, part.mime_type, waId);
        return { kind: "media", text: part.caption || "", media: { type, url, mime: part.mime_type || "" } };
      }
      default: return { kind: "other" };
    }
  }

  async function onIncoming(m, contacts) {
    const waId = String(m.from || "").replace(/\D/g, "");
    if (!waId) return;
    // Meta reintenta los webhooks: cada mensaje se atiende una sola vez
    try {
      await db.collection("wa_inbound").doc(m.id).create({ at: Date.now(), from: waId });
    } catch (e) {
      return;
    }
    const sentAt = Number(m.timestamp) * 1000;
    if (sentAt && Date.now() - sentAt > MAX_MESSAGE_AGE_MS) return;

    const session = await db.collection("wa_sessions").doc(waId).get();
    if (session.exists && (session.data().humanUntil || 0) > Date.now()) return;
    if (!(await botEnabled())) return;

    sender.markRead(m.id);
    const contact = (contacts || []).find((c) => c.wa_id === m.from) || (contacts || [])[0] || {};
    const name = (contact.profile && contact.profile.name) || "";
    const msg = await parse(m, waId);
    if (msg.kind === "other") {
      await sender.send(waId, [{ text: "Por ahora entiendo texto, audios, fotos y ubicaciones 🙂 Escribí *menú* para ver las opciones." }]);
      return;
    }
    await bot.handle({ waId, name, msg, national: nationalPhone(waId) });
  }

  // Coexistencia: lo que el dueño manda desde la app del celular llega como "eco"
  async function onEcho(e) {
    const to = String(e.to || "").replace(/\D/g, "");
    if (!to) return;
    await db.collection("wa_sessions").doc(to).set({ humanUntil: Date.now() + HUMAN_PAUSE_MS }, { merge: true });
  }

  async function webhook(req, res) {
    if (req.method === "GET") {
      const ok = req.query["hub.mode"] === "subscribe" && cfg().verifyToken && req.query["hub.verify_token"] === cfg().verifyToken;
      return ok ? res.status(200).send(String(req.query["hub.challenge"] || "")) : res.sendStatus(403);
    }
    if (req.method !== "POST") return res.sendStatus(405);
    if (!verifySignature(req.rawBody, req.get("x-hub-signature-256"))) {
      logger.warn("[WhatsApp] Webhook con firma inválida");
      return res.sendStatus(401);
    }
    if (!isConfigured()) {
      logger.warn("[WhatsApp] Llegó un mensaje pero el bot no está configurado (functions/.env)");
      return res.sendStatus(200);
    }
    try {
      for (const entry of (req.body && req.body.entry) || []) {
        for (const change of entry.changes || []) {
          const v = change.value || {};
          if (change.field === "smb_message_echoes") {
            for (const e of v.message_echoes || []) await onEcho(e);
            continue;
          }
          for (const m of v.messages || []) await onIncoming(m, v.contacts);
        }
      }
    } catch (err) {
      // Siempre 200: si no, Meta reintenta en ráfaga lo mismo que falló
      logger.error("[WhatsApp] Error procesando webhook:", err);
    }
    return res.sendStatus(200);
  }

  return { webhook, notify };
}

module.exports = { createWhatsApp };
