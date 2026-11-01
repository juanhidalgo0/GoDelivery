// Seguimiento en vivo por link para los pedidos del bot (/en-vivo/{token}).
//
// El cliente de WhatsApp no tiene sesión en la app. Cada pedido del bot lleva un trackingToken al
// azar; la página /en-vivo lo cambia acá por una sesión de Firebase como ese cliente (uid = su
// número, el mismo userId que ya tienen sus pedidos), que vive solo en esa pestaña. Con esa sesión
// la pantalla de seguimiento de la app funciona entera con las reglas de siempre: mapa en vivo,
// chat con el cadete, cancelar y calificar. La página no tiene nada más de la app.
//
// Si el número tiene cuenta en la app, el pedido es de esa cuenta: no se entrega una sesión de una
// cuenta real por un link de WhatsApp, se manda a abrir el pedido en la app (con su login).
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { getAuth } = require("firebase-admin/auth");
const { APP_URL } = require("./comercios");
const { ensureWaUser } = require("./wa-users");

// 24 caracteres al azar (144 bits): el link es la llave, tiene que ser imposible de adivinar
const newTrackingToken = () => crypto.randomBytes(18).toString("base64url");
const trackingUrl = (token) => `${APP_URL}/en-vivo/${token}`;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

// Terminado hace más de esto, el link ya no abre sesión (queda "pedido finalizado")
const AFTER_END_MS = 12 * 60 * 60 * 1000;

const ms = (t) => (t && t.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0));

function createTracking(db) {
  async function orderByToken(token) {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    const snap = await db.collection("orders").where("trackingToken", "==", token).limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // token → { mode: "session", customToken, orderId } | { mode: "app", orderId } | { mode: "ended" } | null
  async function session(token) {
    const order = await orderByToken(token);
    if (!order) return null;
    const ended = ["completed", "cancelled"].includes(order.status);
    const endedAt = ms(order.completedAt || order.deliveredAt || order.cancelledAt || order.updatedAt);
    if (ended && endedAt && Date.now() - endedAt > AFTER_END_MS) return { mode: "ended", orderNum: order.orderId || null, status: order.status };
    const waUid = String(order.waPhone || "");
    if (!waUid || order.userId !== waUid) return { mode: "app", orderId: order.id };
    await ensureWaUser(db, order);
    const customToken = await getAuth().createCustomToken(waUid, { waClient: true });
    return { mode: "session", customToken, orderId: order.id, userName: order.userName || "" };
  }

  // HTTP: POST { token }. Abierto (la llave es el token), con CORS para la página de la app.
  async function handle(req, res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.sendStatus(405);
    const token = String((req.body && req.body.token) || "");
    try {
      const out = await session(token);
      if (!out) return res.status(404).json({ error: "not_found" });
      return res.json(out);
    } catch (err) {
      // Sin permiso para firmar (iam.serviceAccounts.signBlob) la página no puede abrir la sesión
      logger.error("[WhatsApp] No se pudo abrir el seguimiento en vivo:", err);
      return res.status(500).json({ error: "session_failed" });
    }
  }

  return { session, handle, orderByToken };
}

module.exports = { createTracking, newTrackingToken, trackingUrl };
