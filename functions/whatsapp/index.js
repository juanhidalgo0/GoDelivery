// Bot de WhatsApp con la API oficial de Meta. index.js de functions solo conecta estas piezas
// con sus triggers; acá no hay nada que dependa de Express ni de un servidor aparte.
const logger = require("firebase-functions/logger");
const { cfg, isConfigured, refreshLinked, verifySignature, createSender } = require("./cloud-api");
const { createBotConfig } = require("./bot-config");
const { createLink } = require("./link");
const { createOrders, nationalPhone } = require("./orders");
const { createComercios } = require("./comercios");
const { createBot } = require("./bot");
const { createNotify } = require("./notify");
const { createTracking } = require("./tracking");
const { createUnderstand } = require("./understand");
const { ensureWaUser } = require("./wa-users");

// Si el dueño contesta a mano desde la app WhatsApp Business (coexistencia), el bot se calla
// en esa charla este tiempo desde la última respuesta manual.
const HUMAN_PAUSE_MS = 30 * 60 * 1000;
// Mensajes que llegan muy tarde (Meta reintenta después de una caída) no se contestan
const MAX_MESSAGE_AGE_MS = 15 * 60 * 1000;

function createWhatsApp({ db, helpers, push }) {
  const config = createBotConfig(db);
  // Al acercarse al tope o llegar, avisa a los admins: desde ahí los clientes los atiende una persona
  async function onBudgetAlert(level, { budgetArs }) {
    if (!push || !push.getAdminTokens) return;
    const tope = `$${Math.round(budgetArs).toLocaleString("es-AR")}`;
    await push.sendPush(await push.getAdminTokens(), level === "capped"
      ? { title: "🛑 El bot de WhatsApp se pausó", body: `Llegó al tope de ${tope} del mes. Contestá a los clientes desde el celular o subí el tope.` }
      : { title: "⚠️ El bot de WhatsApp está cerca del tope", body: `Ya gastó el 80% de los ${tope} del mes.` },
    { url: "#/admin/whatsapp-bot", type: "wa_budget" });
  }
  const sender = createSender(db, { config, onBudgetAlert });
  const link = createLink(db);
  const orders = createOrders(db, helpers);
  const comercios = createComercios(db);
  const understand = createUnderstand({ db });
  const bot = createBot({ db, orders, comercios, sender, understand, giveaways: helpers.giveaways || null, ensureWaUser, formId: () => formId(), config });
  const notify = createNotify({ db, sender, orders, push });
  const tracking = createTracking(db);

  let settingsCache = { at: 0, enabled: true, form: true };
  // Interruptores en settings/whatsapp_bot, para cambiarlos sin deployar:
  //   { enabled: false } apaga el bot · { form: false } vuelve a preguntar entrega y pago por el chat
  async function botSettings() {
    const ttl = process.env.FUNCTIONS_EMULATOR === "true" ? 0 : 60000;
    if (Date.now() - settingsCache.at < ttl) return settingsCache;
    const snap = await db.collection("settings").doc("whatsapp_bot").get().catch(() => null);
    const d = snap && snap.exists ? snap.data() : {};
    settingsCache = { at: Date.now(), enabled: d.enabled !== false, form: d.form !== false };
    return settingsCache;
  }
  const botEnabled = async () => (await botSettings()).enabled;
  // El formulario nativo necesita su id (WHATSAPP_FLOW_ID, scripts/wa-flow.mjs)
  const formId = async () => (process.env.WHATSAPP_FLOW_ID && (await botSettings()).form ? process.env.WHATSAPP_FLOW_ID : null);

  // Modo prueba (wa_config/test_mode, solo lo lee el admin): el bot contesta únicamente a los
  // números de la lista. Al resto no lo lee ni lo guarda, así se puede probar en un número que ya
  // usa gente (el personal del dueño) sin que el bot le conteste a todos. Sin leer la lista no se
  // contesta: mejor perder un mensaje que contestarle a un contacto personal.
  async function allowedSender(waId) {
    let t;
    try {
      const snap = await db.collection("wa_config").doc("test_mode").get();
      t = snap.exists ? snap.data() : null;
    } catch (err) {
      logger.error("[WhatsApp] No se pudo leer el modo prueba:", err);
      return false;
    }
    if (!t || t.enabled !== true) return true;
    const me = nationalPhone(waId);
    return (t.numbers || []).some((n) => String((n && n.phone) || n).replace(/\D/g, "").slice(-10) === me);
  }

  // Mensaje de Meta → { kind, text, id, title, location, media }
  async function parse(m, waId) {
    switch (m.type) {
      case "text": return { kind: "text", text: (m.text && m.text.body) || "" };
      case "interactive": {
        const r = m.interactive && (m.interactive.button_reply || m.interactive.list_reply);
        if (r) return { kind: "reply", id: r.id, title: r.title };
        // Formulario nativo enviado: los campos vienen como JSON en response_json
        const nfm = m.interactive && m.interactive.nfm_reply;
        if (nfm) {
          try { return { kind: "form", data: JSON.parse(nfm.response_json || "{}") }; } catch (e) { return { kind: "other" }; }
        }
        return { kind: "other" };
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
        const saved = await sender.saveMedia(part.id, part.mime_type, waId);
        return { kind: "media", text: part.caption || "", media: { type, url: saved && saved.url, path: (saved && saved.path) || null, mime: part.mime_type || "" } };
      }
      default: return { kind: "other" };
    }
  }

  async function onIncoming(m, contacts) {
    const waId = String(m.from || "").replace(/\D/g, "");
    if (!waId) return;
    // Antes que nada: en modo prueba, de un número fuera de la lista no queda ni rastro
    if (!(await allowedSender(waId))) return;
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
    // Tope alcanzado: ni "leído" ni "escribiendo…", el mensaje queda para que lo vea una persona
    if ((await sender.budget()).capped) return;

    sender.markRead(m.id, { typing: true });
    const contact = (contacts || []).find((c) => c.wa_id === m.from) || (contacts || [])[0] || {};
    const name = (contact.profile && contact.profile.name) || "";
    const msg = await parse(m, waId);
    if (msg.kind === "other") {
      await sender.send(waId, [{ text: "Por ahora entiendo texto, audios, fotos y ubicaciones 🙂 Escribí *menú* para ver las opciones." }]);
      return;
    }
    await bot.handle({ waId, name, msg, msgId: m.id, national: nationalPhone(waId) });
  }

  // Coexistencia: lo que el dueño manda desde la app del celular llega como "eco"
  async function onEcho(e) {
    const to = String(e.to || "").replace(/\D/g, "");
    if (!to || !(await allowedSender(to))) return;
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
    await refreshLinked(db);
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

  return { webhook, notify, tracking, link };
}

module.exports = { createWhatsApp };
