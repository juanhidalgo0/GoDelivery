// Envío de mensajes por la API oficial de WhatsApp (Cloud API de Meta).
//
// Configuración en functions/.env (no se sube a git):
//   WHATSAPP_TOKEN            token de acceso del usuario del sistema
//   WHATSAPP_PHONE_NUMBER_ID  id del número (no el número en sí)
//   WHATSAPP_VERIFY_TOKEN     texto cualquiera; el mismo que se carga en Meta al configurar el webhook
//   WHATSAPP_APP_SECRET       secreto de la app de Meta, para verificar la firma de cada webhook
//   WHATSAPP_API_VERSION      opcional (por defecto v23.0)
//   WHATSAPP_FLOW_ID          opcional: formulario nativo de entrega y pago (scripts/wa-flow.mjs)
//   WHATSAPP_FLOW_MODE        "draft" mientras el formulario no se pueda publicar (Meta pide el negocio verificado)
//
// En el emulador, o con WHATSAPP_DRY_RUN=true, no se manda nada: cada mensaje se guarda en
// wa_outbox para poder probar las conversaciones sin un número real.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { FREE_MONTHLY, budgetState } = require("./bot-config");

// El número vinculado desde el panel (wa_secrets/cloud_api, link.js) manda sobre functions/.env
let linked = { at: 0, token: "", phoneNumberId: "" };
const LINKED_TTL_MS = 60 * 1000;

async function refreshLinked(db) {
  if (Date.now() - linked.at < LINKED_TTL_MS) return;
  const snap = await db.collection("wa_secrets").doc("cloud_api").get().catch(() => null);
  const d = snap && snap.exists ? snap.data() : {};
  linked = { at: Date.now(), token: d.token || "", phoneNumberId: d.phoneNumberId || "" };
}
const invalidateLinked = () => { linked = { at: 0, token: "", phoneNumberId: "" }; };

const cfg = () => ({
  token: linked.token || process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: linked.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
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

// Celulares argentinos: los mensajes llegan de 549XXXXXXXXXX, pero Meta a veces solo acepta mandarles
// a 54XXXXXXXXXX (sin el 9; pasa con la lista de destinatarios del número de prueba). Si rechaza con
// 131030 (destinatario no permitido), se reintenta sin el 9 y se recuerda qué forma anduvo.
const arWithout9 = (to) => (/^549\d{10}$/.test(to) ? "54" + to.slice(3) : null);
const sendAs = new Map();

// Mensajes del mes (hora argentina): Meta regala 1.000 por número y cobra desde el 1.001.
// Admin → Bot lo muestra (wa_usage/{AAAA-MM}).
const usageMonth = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);

function createSender(db, { config, onBudgetAlert } = {}) {
  // Gasto del mes contra el tope de Admin → Bot → Ajustes
  async function budget() {
    if (!config) return { spentArs: 0, capped: false, near: false };
    const [conf, usage] = await Promise.all([config.get(), db.collection("wa_usage").doc(usageMonth()).get()]);
    const state = budgetState(conf, usage.exists ? usage.data().sent : 0);
    const level = state.capped ? "capped" : state.near ? "near" : null;
    if (level && !(usage.exists && usage.data().alerts && usage.data().alerts[level])) await alertOnce(level, conf, state);
    return state;
  }

  // Un solo aviso por nivel y por mes, aunque lleguen varios mensajes a la vez
  async function alertOnce(level, conf, state) {
    const ref = db.collection("wa_usage").doc(usageMonth());
    try {
      const first = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().alerts && snap.data().alerts[level]) return false;
        tx.set(ref, { alerts: { [level]: Date.now() } }, { merge: true });
        return true;
      });
      if (first && onBudgetAlert) await onBudgetAlert(level, { budgetArs: conf.budgetArs, spentArs: state.spentArs });
    } catch (err) {
      logger.warn("[WhatsApp] No se pudo avisar del tope:", err);
    }
  }

  function countSent(payload) {
    const type = String((payload && payload.type) || "otro").replace(/[^a-z_]/g, "") || "otro";
    db.collection("wa_usage").doc(usageMonth()).set({
      month: usageMonth(), free: FREE_MONTHLY, sent: FieldValue.increment(1),
      byType: { [type]: FieldValue.increment(1) }, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((err) => logger.warn("[WhatsApp] No se pudo contar el mensaje:", err));
  }

  async function attempt(to, payload) {
    const body = { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload };
    const { token, phoneNumberId, version } = cfg();
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const err = await res.text();
    let code = null;
    try { code = JSON.parse(err).error.code; } catch (e) {}
    return { ok: false, status: res.status, code, err };
  }

  async function post(to, payload) {
    to = String(to);
    // El tope manda sobre todo lo que sale, también los avisos y las respuestas de soporte
    if ((await budget()).capped) {
      logger.warn(`[WhatsApp] Tope de gasto alcanzado: no se envía a ${to}.`);
      return { ok: false, capped: true };
    }
    await refreshLinked(db);
    if (isDryRun()) {
      const body = { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload };
      await db.collection("wa_outbox").add({ to, payload: body, createdAt: FieldValue.serverTimestamp(), at: Date.now() });
      countSent(payload);
      return { ok: true, dryRun: true };
    }
    const { token, phoneNumberId } = cfg();
    if (!token || !phoneNumberId) {
      logger.warn("[WhatsApp] Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID: no se envía.");
      return { ok: false };
    }
    try {
      let r = await attempt(sendAs.get(to) || to, payload);
      const alt = arWithout9(to);
      if (!r.ok && r.code === 131030 && alt && sendAs.get(to) !== alt) {
        r = await attempt(alt, payload);
        if (r.ok) sendAs.set(to, alt);
      }
      if (!r.ok) {
        // 131047: pasaron más de 24 h desde el último mensaje del cliente; hace falta una plantilla.
        logger.warn(`[WhatsApp] Envío a ${to} rechazado (${r.status}): ${String(r.err || "").slice(0, 400)}`);
        return { ok: false, status: r.status };
      }
      countSent(payload);
      return { ok: true };
    } catch (err) {
      logger.error(`[WhatsApp] Error enviando a ${to}:`, err);
      return { ok: false };
    }
  }

  // Cada respuesta del bot es uno de estos objetos; send() los traduce al formato de Meta.
  //   { text }
  //   { text, buttons: [{ id, title, desc }] }  1 botón → botón; 2 o más → menú desplegable (lista).
  //                                             asButtons: true los deja como botones (hasta 3).
  //   { text, list: { button, section, rows } } o { text, list: { button, sections: [{ title, rows }] } }
  //   { text, askLocation: true }
  //   { text, link: { title, url } }            botón de link (cta_url)
  //   { image, caption }                        imagen por link
  //   { react: "👍", reactTo }                  reacción al mensaje del cliente
  //   { text, flow: { id, token, cta, screen, data } }  formulario nativo (WhatsApp Flows)
  // Opcionales en los interactivos: header (texto, 60) y footer (60).
  const rowOf = (row) => ({
    id: cut(row.id, 200),
    title: cut(row.title, 24),
    ...(row.description || row.desc ? { description: cut(row.description || row.desc, 72) } : {}),
  });

  function toPayload(r) {
    if (r.react && r.reactTo) return { type: "reaction", reaction: { message_id: r.reactTo, emoji: r.react } };
    if (r.image) return { type: "image", image: { link: r.image, ...(r.caption ? { caption: cut(r.caption, 1024) } : {}) } };
    const body = { text: cut(r.text, 1024) };
    const extra = {
      ...(r.header ? { header: { type: "text", text: cut(r.header, 60) } } : {}),
      ...(r.footer ? { footer: { text: cut(r.footer, 60) } } : {}),
    };
    let list = r.list;
    if (r.buttons && r.buttons.length && (r.buttons.length === 1 || r.asButtons)) {
      return {
        type: "interactive",
        interactive: {
          type: "button",
          ...extra,
          body,
          action: { buttons: r.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: cut(b.id, 256), title: cut(b.title, 20) } })) },
        },
      };
    }
    // Varias opciones: menú desplegable de WhatsApp (se ve más prolijo que una fila de botones)
    if (r.buttons && r.buttons.length > 1) list = { button: r.listLabel || "Ver opciones", section: r.section || "Opciones", rows: r.buttons };
    if (list && ((list.rows && list.rows.length) || (list.sections && list.sections.length))) {
      const sections = list.sections
        ? list.sections.filter((sec) => sec.rows && sec.rows.length).map((sec) => ({ title: cut(sec.title || "Opciones", 24), rows: sec.rows.map(rowOf) }))
        : [{ title: cut(list.section || "Opciones", 24), rows: list.rows.map(rowOf) }];
      // WhatsApp acepta hasta 10 filas en total
      let left = 10;
      const capped = sections.map((sec) => { const rows = sec.rows.slice(0, Math.max(0, left)); left -= rows.length; return { ...sec, rows }; }).filter((sec) => sec.rows.length);
      return {
        type: "interactive",
        interactive: { type: "list", ...extra, body, action: { button: cut(list.button || "Ver opciones", 20), sections: capped } },
      };
    }
    if (r.flow) {
      return {
        type: "interactive",
        interactive: {
          type: "flow",
          ...extra,
          body,
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_id: r.flow.id,
              flow_token: r.flow.token,
              flow_cta: cut(r.flow.cta, 20),
              flow_action: "navigate",
              flow_action_payload: { screen: r.flow.screen, data: r.flow.data },
              ...(process.env.WHATSAPP_FLOW_MODE === "draft" ? { mode: "draft" } : {}),
            },
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
        interactive: { type: "cta_url", ...extra, body, action: { name: "cta_url", parameters: { display_text: cut(r.link.title, 20), url: r.link.url } } },
      };
    }
    return { type: "text", text: { body: String(r.text || "").slice(0, 4096), preview_url: false } };
  }

  async function send(to, replies) {
    for (const r of [].concat(replies || [])) {
      if (!r) continue;
      if (r.react && !r.reactTo) continue;
      await post(to, toPayload(r));
    }
  }

  // Marca el mensaje como leído y muestra "escribiendo…" hasta que llegue la respuesta (máx. 25 s)
  async function markRead(messageId, { typing = false } = {}) {
    if (isDryRun() || !messageId) return;
    const { token, phoneNumberId, version } = cfg();
    if (!token || !phoneNumberId) return;
    try {
      await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, ...(typing ? { typing_indicator: { type: "text" } } : {}) }),
      });
    } catch (e) { /* no importa */ }
  }

  // Audios y fotos: Meta los guarda un tiempo corto, así que se copian a Storage para que el
  // cadete o el comercio los puedan abrir después. Devuelve un link o null.
  // → { url, path } (path: dónde quedó en Storage, para leerlo después: audio → texto, foto → IA)
  async function saveMedia(mediaId, mimeType, phone) {
    if (!mediaId) return null;
    if (isDryRun()) return { url: `https://example.invalid/wa-media/${mediaId}`, path: null };
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
      const path = `wa-media/${phone}/${mediaId}.${ext}`;
      const ref = getStorage().bucket().file(path);
      await ref.save(buf, { contentType: mimeType || "application/octet-stream" });
      return { url: await getDownloadURL(ref), path };
    } catch (err) {
      logger.warn(`[WhatsApp] No se pudo guardar el archivo ${mediaId}:`, err);
      return null;
    }
  }

  // Bytes de un archivo guardado por saveMedia (null si no está)
  async function readMedia(path) {
    if (!path) return null;
    try {
      const { getStorage } = require("firebase-admin/storage");
      const [buf] = await getStorage().bucket().file(path).download();
      return buf;
    } catch (err) {
      logger.warn(`[WhatsApp] No se pudo leer ${path}:`, err);
      return null;
    }
  }

  return { send, markRead, saveMedia, readMedia, budget };
}

module.exports = { FREE_MONTHLY, usageMonth, cfg, refreshLinked, invalidateLinked, isDryRun, isConfigured, verifySignature, createSender, cut };
