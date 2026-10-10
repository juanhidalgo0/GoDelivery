// GoDelivery — Detector de errores de la app (lado servidor)
//
// La app (src/utils/error-reporter.js) manda acá cada error que ve en el celular de un cliente,
// cadete o comercio. Se agrupan por "huella" (mensaje normalizado + dónde saltó) en
// client_errors/{huella}: cuántas veces, a cuántas personas, en qué pantallas, versiones y roles.
// Admin → Errores los muestra. A los admins les llega un push cuando aparece un error nuevo, cuando
// vuelve uno marcado como resuelto y cuando uno se repite mucho (10, 50, 200, 1000 veces).
// Los errores de red (sin conexión) se registran pero no avisan: son del celular, no de la app.

const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const ALERT_AT = [10, 50, 200, 1000, 5000];
const MAX_ALERTS_PER_HOUR = 6;
const MAX_USERS_TRACKED = 100;

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);

// Lo que cambia entre dos apariciones del mismo error (ids, números, textos entre comillas, URLs)
// se reemplaza, para que caigan en el mismo grupo.
function normalizeMessage(msg) {
  return clip(msg, 400)
    .replace(/https?:\/\/\S+/g, "<url>")
    // Textos largos o con espacios (datos); los cortos quedan: 'reading "precio"' ≠ 'reading "total"'
    .replace(/(["'`])([^"'`]{31,}|[^"'`]*\s[^"'`]*)\1/g, "<texto>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/\b[A-Za-z0-9]{20,}\b/g, "<id>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

// Primer renglón útil de la pila, sin línea/columna ni el hash del archivo del build
// (cambian en cada deploy y partirían el mismo error en grupos distintos).
function topFrame(stack) {
  const lines = String(stack || "").split("\n").map((l) => l.trim()).filter((l) => /(\.js|\.mjs)/.test(l));
  const first = lines.find((l) => !/error-reporter|toast[.-]/.test(l)) || "";
  return first
    .replace(/https?:\/\/[^/\s)]+/g, "")
    .replace(/-[A-Za-z0-9_-]{8}\.js/g, ".js")
    .replace(/\?[^:)\s]*/g, "")
    .replace(/:\d+(:\d+)?/g, "")
    .slice(0, 200);
}

// También las pantallas que no cargan porque la app abierta tiene una versión vieja (Safari:
// "Importing a module script failed"): no es un error del código y keep-old-assets.js lo evita.
const NETWORK_RE = /importing a module script failed|dynamically imported module|failed to fetch|load failed|networkerror|network request failed|err_internet_disconnected|err_network|the internet connection appears to be offline|unavailable.*backend|could not reach cloud firestore|client is offline|timeout|timed out|aborted/i;
const IGNORE_RE = /resizeobserver loop|^script error\.?$|navigator\.vibrate|chrome-extension:|moz-extension:|safari-extension:|webkit-masked-url/i;

function isNetworkError(message) { return NETWORK_RE.test(message); }

function fingerprintOf(kind, message, stack) {
  return crypto.createHash("sha1").update(`${kind}|${normalizeMessage(message)}|${topFrame(stack)}`).digest("hex").slice(0, 24);
}

// Claves de mapas de Firestore: sin puntos ni caracteres raros y cortas.
const mapKey = (v) => clip(v || "?", 60).replace(/[.~*/[\]`#$]/g, "_") || "?";

// Avisos a los admins con tope por hora, así un deploy con muchos errores no los inunda.
async function takeAlertSlot(db) {
  const ref = db.collection("system").doc("client_errors_alerts");
  const hour = new Date().toISOString().slice(0, 13);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const sent = d.hour === hour ? (d.sent || 0) : 0;
    if (sent >= MAX_ALERTS_PER_HOUR) return false;
    tx.set(ref, { hour, sent: sent + 1 });
    return true;
  });
}

/**
 * Registra un error. `report` viene de la app; `uid` sólo si el token se verificó.
 * Devuelve { fingerprint, alert } (alert: null o el motivo del aviso), sin mandar el aviso.
 */
async function recordClientError(report, uid) {
  const db = getFirestore();
  const message = clip(report.message, 500).trim();
  if (!message || IGNORE_RE.test(message)) return { ignored: true };
  const kind = ["error", "promesa", "capturado", "toast"].includes(report.kind) ? report.kind : "error";
  const stack = clip(report.stack, 2000);
  const fingerprint = fingerprintOf(kind, message, stack);
  const network = isNetworkError(message);
  const role = clip(report.role || (uid ? "user" : "invitado"), 20);
  const sample = {
    message,
    stack,
    route: clip(report.route, 120),
    platform: clip(report.platform, 40),
    version: clip(report.version, 30),
    ua: clip(report.ua, 200),
    uid: uid || null,
    userName: clip(report.userName, 60),
    role,
    at: new Date(),
  };
  const ref = db.collection("client_errors").doc(fingerprint);

  const alert = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : null;
    const count = (prev?.count || 0) + 1;
    const users = new Set(prev?.users || []);
    if (uid && users.size < MAX_USERS_TRACKED) users.add(uid);
    const wasResolved = prev?.status === "resolved";
    const ignored = prev?.status === "ignored";

    const update = {
      fingerprint,
      kind,
      network,
      message,
      normalized: normalizeMessage(message),
      frame: topFrame(stack),
      count,
      users: [...users],
      userCount: users.size,
      lastSeen: FieldValue.serverTimestamp(),
      lastSample: sample,
      [`routes.${mapKey(sample.route)}`]: FieldValue.increment(1),
      [`roles.${mapKey(role)}`]: FieldValue.increment(1),
      [`versions.${mapKey(sample.version)}`]: FieldValue.increment(1),
      [`platforms.${mapKey(sample.platform)}`]: FieldValue.increment(1),
    };
    if (!prev) {
      tx.set(ref, { firstSeen: FieldValue.serverTimestamp(), firstSample: sample, status: "open" });
      tx.update(ref, update);
    } else {
      if (wasResolved) { update.status = "open"; update.reopenedAt = FieldValue.serverTimestamp(); update.reopenCount = FieldValue.increment(1); }
      tx.update(ref, update);
    }

    // Errores de red y mensajes al usuario no avisan solos (se ven en la bandeja y en el resumen)
    if (network || ignored || kind === "toast") return null;
    if (!prev) return kind === "capturado" ? null : "nuevo";
    if (wasResolved) return "volvio";
    if (ALERT_AT.includes(count)) return "repetido";
    return null;
  });

  return { fingerprint, alert, network };
}

const ALERT_TITLES = {
  error: { nuevo: "🐞 Error nuevo en la app", volvio: "🔁 Volvió un error que estaba resuelto", repetido: "⚠️ Un error de la app se está repitiendo" },
  servidor: { nuevo: "🛑 Error nuevo en el servidor", volvio: "🔁 Volvió un error del servidor", repetido: "⚠️ Un error del servidor se está repitiendo" },
  auditoria: { nuevo: "🔎 El vigilante encontró un problema", volvio: "🔁 Volvió un problema que se había normalizado", repetido: "⚠️ Un problema sigue creciendo" },
};

async function alertAdmins({ fingerprint, alert }, { getAdminTokens, sendPush }) {
  if (!alert) return;
  const db = getFirestore();
  if (!(await takeAlertSlot(db))) return;
  const d = (await db.collection("client_errors").doc(fingerprint).get()).data() || {};
  const titles = ALERT_TITLES[d.kind] || ALERT_TITLES.error;
  let body;
  if (d.kind === "auditoria") {
    body = clip(d.message, 160);
  } else {
    const where = d.kind === "servidor"
      ? clip(d.lastSample?.service, 60)
      : [d.lastSample?.route, d.lastSample?.role].filter(Boolean).join(" · ");
    const times = alert === "repetido" ? ` (${d.count} veces${d.kind === "servidor" ? "" : `, ${d.userCount || 0} personas`})` : "";
    body = `${clip(d.message, 120)}${times}${where ? ` — ${where}` : ""}`;
  }
  const tokens = await getAdminTokens();
  await sendPush(tokens, { title: titles[alert] || titles.nuevo, body }, { url: `#/admin/errores?e=${fingerprint}`, tag: `client-error-${fingerprint}` });
}

// Tope simple por IP dentro de cada instancia: una app rota en un loop no llena la base.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip) || { start: now, n: 0 };
  if (now - h.start > 60000) { h.start = now; h.n = 0; }
  h.n += 1;
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > 30;
}

function createReportHandler({ admin, getAdminTokens, sendPush }) {
  return async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    if (rateLimited(ip)) return res.status(429).json({ ok: false });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const reports = (Array.isArray(body?.errors) ? body.errors : [body]).filter((r) => r && typeof r === "object").slice(0, 10);
    let uid = null;
    if (body?.idToken) {
      try { uid = (await admin.auth().verifyIdToken(String(body.idToken))).uid; } catch (e) { uid = null; }
    }
    try {
      for (const r of reports) {
        const out = await recordClientError(r, uid);
        if (out.alert) await alertAdmins(out, { getAdminTokens, sendPush }).catch((err) => logger.warn("[ClientErrors] aviso falló:", err));
      }
      return res.json({ ok: true });
    } catch (err) {
      logger.error("[ClientErrors] no se pudo registrar:", err);
      return res.status(500).json({ ok: false });
    }
  };
}

module.exports = { createReportHandler, recordClientError, alertAdmins, takeAlertSlot, fingerprintOf, normalizeMessage, topFrame, isNetworkError, mapKey, clip, ALERT_AT };
