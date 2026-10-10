// Envío de mensajes por la API oficial de WhatsApp (Cloud API de Meta).
//
// Configuración en functions/.env (no se sube a git):
//   WHATSAPP_TOKEN            token de acceso del usuario del sistema
//   WHATSAPP_PHONE_NUMBER_ID  id del número (no el número en sí)
//   WHATSAPP_VERIFY_TOKEN     texto cualquiera; el mismo que se carga en Meta al configurar el webhook
//   WHATSAPP_APP_SECRET       secreto de la app de Meta, para verificar la firma de cada webhook
//   WHATSAPP_API_VERSION      opcional (por defecto v23.0)
//
// En el emulador, o con WHATSAPP_DRY_RUN=true, no se manda nada: cada mensaje se guarda en
// wa_outbox para poder probar las conversaciones sin un número real.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");

const cfg = () => ({
  token: process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  appSecret: process.env.WHATSAPP_APP_SECRET || "",
  version: process.env.WHATSAPP_API_VERSION || "v23.0",
});

const isDryRun = () => process.env.WHATSAPP_DRY_RUN === "true" || process.env.FUNCTIONS_EMULATOR === "true";
const isConfigured = () => isDryRun() || (!!cfg().token && !!cfg().phoneNumberId);

// Límites de WhatsApp para mensajes interactivos: si se pasan, Meta rechaza el mensaje entero.
const cut = (s, n) => {
  const t = String(s == null ? "" : s).trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function verifySignature(rawBody, header) {
  const { appSecret } = cfg();
  if (!appSecret) return isDryRun();
  if (!header || !rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSender(db) {
  async function post(to, payload) {
    const body = { messaging_product: "whatsapp", recipient_type: "individual", to: String(to), ...payload };
    if (isDryRun()) {
      await db.collection("wa_outbox").add({ to: String(to), payload: body, createdAt: FieldValue.serverTimestamp(), at: Date.now() });
      return { ok: true, dryRun: true };
    }
    const { token, phoneNumberId, version } = cfg();
    if (!token || !phoneNumberId) {
      logger.warn("[WhatsApp] Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID: no se envía.");
      return { ok: false };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 131047: pasaron más de 24 h desde el último mensaje del cliente; hace falta una plantilla.
        const err = await res.text();
        logger.warn(`[WhatsApp] Envío a ${to} rechazado (${res.status}): ${err.slice(0, 400)}`);
        return { ok: false, status: res.status };
      }
      return { ok: true };
    } catch (err) {
      logger.error(`[WhatsApp] Error enviando a ${to}:`, err);
      return { ok: false };
    }
  }

  // Cada respuesta del bot es uno de estos objetos; send() los traduce al formato de Meta.
  //   { text }
  //   { text, buttons: [{ id, title }] }                     hasta 3
  //   { text, list: { button, rows: [{ id, title, description }] } }   hasta 10
  //   { text, askLocation: true }
  //   { text, link: { title, url } }
  function toPayload(r) {
    const body = { text: cut(r.text, 1024) };
    if (r.buttons && r.buttons.length) {
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body,
          action: { buttons: r.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: cut(b.id, 256), title: cut(b.title, 20) } })) },
        },
      };
    }
    if (r.list && r.list.rows && r.list.rows.length) {
      return {
        type: "interactive",
        interactive: {
          type: "list",
          body,
          action: {
            button: cut(r.list.button || "Ver opciones", 20),
            sections: [{
              title: cut(r.list.section || "Opciones", 24),
              rows: r.list.rows.slice(0, 10).map((row) => ({
                id: cut(row.id, 200),
                title: cut(row.title, 24),
                ...(row.description ? { description: cut(row.description, 72) } : {}),
              })),
            }],
          },
        },
      };
    }
    if (r.askLocation) {
      return { type: "interactive", interactive: { type: "location_request_message", body, action: { name: "send_location" } } };
    }
    if (r.link) {
      return {
        type: "interactive",
        interactive: { type: "cta_url", body, action: { name: "cta_url", parameters: { display_text: cut(r.link.title, 20), url: r.link.url } } },
      };
    }
    return { type: "text", text: { body: String(r.text || "").slice(0, 4096), preview_url: false } };
  }

  async function send(to, replies) {
    for (const r of [].concat(replies || [])) {
      if (!r) continue;
      await post(to, toPayload(r));
    }
  }

  async function markRead(messageId) {
    if (isDryRun() || !messageId) return;
    const { token, phoneNumberId, version } = cfg();
    if (!token || !phoneNumberId) return;
    try {
      await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
      });
    } catch (e) { /* no importa */ }
  }

  // Audios y fotos: Meta los guarda un tiempo corto, así que se copian a Storage para que el
  // cadete o el comercio los puedan abrir después. Devuelve un link o null.
  async function saveMedia(mediaId, mimeType, phone) {
    if (!mediaId) return null;
    if (isDryRun()) return `https://example.invalid/wa-media/${mediaId}`;
    const { token, version } = cfg();
    try {
      const meta = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!meta.ok) return null;
      const { url } = await meta.json();
      const file = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!file.ok) return null;
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = (String(mimeType || "").split("/")[1] || "bin").split(";")[0];
      const { getStorage, getDownloadURL } = require("firebase-admin/storage");
      const ref = getStorage().bucket().file(`wa-media/${phone}/${mediaId}.${ext}`);
      await ref.save(buf, { contentType: mimeType || "application/octet-stream" });
      return await getDownloadURL(ref);
    } catch (err) {
      logger.warn(`[WhatsApp] No se pudo guardar el archivo ${mediaId}:`, err);
      return null;
    }
  }

  return { send, markRead, saveMedia };
}

module.exports = { cfg, isDryRun, isConfigured, verifySignature, createSender, cut };
