// Vincular el número de WhatsApp desde Admin → Bot WhatsApp → Ajustes.
//
//   connect (code)   lo que devuelve el registro de Meta (Embedded Signup): así entra el número de
//                    siempre en coexistencia, escaneando un QR desde WhatsApp Business.
//   connect (token)  token permanente + id del número, cargados a mano.
//   status           pregunta a Meta cómo está el número.
//   disconnect       borra la credencial: vuelve a lo que haya en functions/.env.
//
// El token queda en wa_secrets/cloud_api, que ninguna regla deja leer: solo lo usa el servidor. En
// wa_config/link queda lo que muestra el panel. Al vincular se prende el modo prueba, para que el bot
// no le conteste a todos los clientes hasta que el admin lo decida.
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { cfg, isDryRun, invalidateLinked } = require("./cloud-api");

const FIELDS = "display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,is_on_biz_app";
const ID_RE = /^\d{5,30}$/;

class LinkError extends Error {}

function createLink(db) {
  async function graph(path, token, options = {}) {
    const res = await fetch(`https://graph.facebook.com/${cfg().version}/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = body.error && body.error.code;
      logger.warn(`[WhatsApp] Meta rechazó ${path.split("?")[0]} (${res.status}, código ${code})`);
      throw new LinkError(`Meta respondió: ${(body.error && body.error.message) || `error ${res.status}`}`);
    }
    return body;
  }

  const phoneInfo = (phoneNumberId, token) => graph(`${phoneNumberId}?fields=${FIELDS}`, token);

  // El código del registro de Meta se cambia por un token del negocio
  async function exchangeCode(code) {
    const appId = process.env.WHATSAPP_APP_ID;
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!appId || !secret) throw new LinkError("Falta WHATSAPP_APP_ID o WHATSAPP_APP_SECRET en el servidor.");
    const q = new URLSearchParams({ client_id: appId, client_secret: secret, code });
    const res = await fetch(`https://graph.facebook.com/${cfg().version}/oauth/access_token?${q}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new LinkError("Meta no aceptó el registro. Probá vincular de nuevo.");
    return body.access_token;
  }

  function publicStatus(info, { phoneNumberId, wabaId, via }) {
    return {
      connected: true,
      via,
      phoneNumberId,
      wabaId: wabaId || null,
      display: info.display_phone_number || "",
      name: info.verified_name || "",
      quality: info.quality_rating || "",
      coexistence: info.is_on_biz_app === true,
      checkedAtMs: Date.now(),
    };
  }

  async function connect({ code, token, phoneNumberId, wabaId }) {
    if (!ID_RE.test(String(phoneNumberId || ""))) throw new LinkError("El id del número no es válido.");
    if (wabaId && !ID_RE.test(String(wabaId))) throw new LinkError("El id de la cuenta de WhatsApp no es válido.");
    const via = code ? "meta" : "manual";
    const finalToken = code ? await exchangeCode(String(code)) : String(token || "").trim();
    if (!finalToken) throw new LinkError("Falta el token.");

    if (isDryRun()) {
      const status = publicStatus({ display_phone_number: "+54 221 555-0000", verified_name: "Prueba", quality_rating: "GREEN" }, { phoneNumberId, wabaId, via });
      return save(finalToken, status);
    }
    const info = await phoneInfo(phoneNumberId, finalToken);
    // Sin esto Meta no le manda al webhook los mensajes de esta cuenta
    if (wabaId) await graph(`${wabaId}/subscribed_apps`, finalToken, { method: "POST" });
    return save(finalToken, publicStatus(info, { phoneNumberId, wabaId, via }));
  }

  async function save(token, status) {
    const batch = db.batch();
    batch.set(db.collection("wa_secrets").doc("cloud_api"), {
      token, phoneNumberId: status.phoneNumberId, wabaId: status.wabaId, updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection("wa_config").doc("link"), status);
    batch.set(db.collection("wa_config").doc("test_mode"), { enabled: true }, { merge: true });
    await batch.commit();
    invalidateLinked();
    return status;
  }

  async function status() {
    const c = cfg();
    if (isDryRun() || !c.token || !c.phoneNumberId) {
      const snap = await db.collection("wa_config").doc("link").get();
      return snap.exists ? snap.data() : { connected: false };
    }
    const secret = await db.collection("wa_secrets").doc("cloud_api").get();
    const info = await phoneInfo(c.phoneNumberId, c.token);
    const s = publicStatus(info, {
      phoneNumberId: c.phoneNumberId,
      wabaId: secret.exists ? secret.data().wabaId : null,
      via: secret.exists ? "guardado" : "env",
    });
    await db.collection("wa_config").doc("link").set(s);
    return s;
  }

  async function disconnect() {
    await db.collection("wa_secrets").doc("cloud_api").delete();
    await db.collection("wa_config").doc("link").set({ connected: false, checkedAtMs: Date.now() });
    invalidateLinked();
    return { connected: false };
  }

  // POST { idToken, action, ... } desde el panel, solo administradores
  async function handle(req, res, { verifyIdToken }) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    let decoded;
    try {
      decoded = await verifyIdToken(String((req.body && req.body.idToken) || ""));
    } catch (err) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }
    const caller = await db.collection("users").doc(decoded.uid).get();
    const u = caller.exists ? caller.data() : {};
    if (!(decoded.email === "kioscopaulos7@gmail.com" || u.role === "admin" || u.isAdmin === true)) {
      return res.status(403).json({ error: "Solo administradores" });
    }
    const { action, code, token, phoneNumberId, wabaId } = req.body;
    try {
      if (action === "connect") return res.json(await connect({ code, token, phoneNumberId, wabaId }));
      if (action === "status") return res.json(await status());
      if (action === "disconnect") return res.json(await disconnect());
      return res.status(400).json({ error: "Acción desconocida" });
    } catch (err) {
      if (err instanceof LinkError) return res.status(400).json({ error: err.message });
      logger.error("[WhatsApp] Error al vincular:", err);
      return res.status(500).json({ error: "No se pudo completar. Probá de nuevo." });
    }
  }

  return { handle, connect, status, disconnect };
}

module.exports = { createLink };
