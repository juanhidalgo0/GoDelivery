const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
// Modular import: same objects as admin.firestore.* in production, and they also exist under the
// emulator (where FieldValue comes back undefined), so tests run the real code.
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { applyCompletedOrder, reverseCompletedOrder, blockIfOverDebtLimit, loadDebtPolicy, isOverDebtLimit, importLegacyHistory } = require("./ledger");
const { createReportHandler } = require("./client-errors");
const { runVigilante, sendDailyDigest } = require("./vigilante");
const { runPushAutomations, tokensForAudience } = require("./push-automaticas");
const { isSoldByWeight, weightStepOf, stepPrice } = require("./weight");
const shopper = require("./shopper");
const ventraBridge = require("./ventra-bridge");
const commerceAccess = require("./commerce-access");

setGlobalOptions({ maxInstances: 20, memory: "512Mi", region: "us-central1" });

admin.initializeApp();
const db = admin.firestore();

// Pedido sin aceptar (comercio) o sin repartidor: se cancela solo pasado este tiempo
const ORDER_AUTO_CANCEL_MS = 20 * 60 * 1000;
// Comisión a comercios apagada (decisión del 28-09-2026): los pedidos nuevos guardan commissionAmount 0.
const COMMERCE_COMMISSION_ENABLED = false;
const DRIVER_INACTIVITY_MS = 2 * 60 * 60 * 1000;
const DRIVER_WARNING_GRACE_MS = 15 * 60 * 1000;

function tsToMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

// token -> uid, filled by getUserTokens so sendPush can prune dead tokens
// even when the caller didn't pass the owner explicitly.
const tokenOwners = new Map();

// ═══════════════════════════════════════════════════
// MERCADO PAGO FUNCTIONS (existing)
// ═══════════════════════════════════════════════════

exports.createPreference = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const { orderId, items, deliveryCost, commerceId } = req.body;

    try {
      const commerceDoc = await db.collection("comercios").doc(commerceId).get();
      if (!commerceDoc.exists) throw new Error("Comercio no encontrado");
      
      const commerceData = commerceDoc.data();
      const accessToken = commerceData.mpAccessToken;

      if (!accessToken) {
        throw new Error("Este comercio no tiene configurado Mercado Pago");
      }

      const client = new MercadoPagoConfig({ accessToken: accessToken });
      const preferenceInstance = new Preference(client);

      const response = await preferenceInstance.create({
        body: {
          items: items.map(item => ({
            title: item.name,
            unit_price: Number(item.price),
            quantity: Number(item.qty),
            currency_id: "ARS"
          })),
          shipments: {
            cost: Number(deliveryCost),
            mode: "not_specified"
          },
          external_reference: orderId.toString(),
          notification_url: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/mercadopagoWebhook?comercioId=${commerceId}`,
          back_urls: {
            success: `https://${process.env.GCLOUD_PROJECT}.web.app/#/order-success/${orderId}`,
            failure: `https://${process.env.GCLOUD_PROJECT}.web.app/#/cart`,
            pending: `https://${process.env.GCLOUD_PROJECT}.web.app/#/order-success/${orderId}`
          },
          auto_return: "approved"
        }
      });
      
      const orderSnap = await db.collection("orders").where("orderId", "==", orderId).get();
      if (!orderSnap.empty) {
        await orderSnap.docs[0].ref.update({ mpPreferenceId: response.id });
      }

      res.status(200).json({ 
        id: response.id,
        initPoint: response.init_point
      });

    } catch (error) {
      console.error("MP Preference Error:", error);
      res.status(500).json({ error: error.message });
    }
});

const CLIENT_ID = "5274234275247081";
const CLIENT_SECRET = "qTxbuLwOGJ9TEWxUqJw2Ba4HSkmMlIw2";
const REDIRECT_URI = `https://godelivery-magdalena.web.app/mp-connect`;

exports.mercadopagoConnect = onRequest({ cors: true }, async (req, res) => {
  const { code, comercioId } = req.body;

  if (!code || !comercioId) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  try {
    const response = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_secret: CLIENT_SECRET,
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI
      })
    });

    const data = await response.json();

    if (data.access_token) {
      await db.collection("comercios").doc(comercioId).update({
        mpAccessToken: data.access_token,
        mpRefreshToken: data.refresh_token,
        mpUserId: data.user_id,
        mpConnectedAt: FieldValue.serverTimestamp()
      });

      res.status(200).json({ success: true });
    } else {
      throw new Error(data.message || "Error al obtener el token");
    }
  } catch (error) {
    logger.error("MP Connect Error:", error);
    res.status(500).json({ error: error.message });
  }
});

exports.mercadopagoWebhook = onRequest(async (req, res) => {
  const { query, body } = req;
  const topic = query.topic || query.type || (body && body.type) || (body && body.action && body.action.split('.')[0]);
  const commerceId = query.comercioId;

  if (topic === "payment" && commerceId) {
    const paymentId = query.id || query["data.id"] || (body && body.data && body.data.id) || (body && body.id);
    
    try {
      const commerceDoc = await db.collection("comercios").doc(commerceId).get();
      if (!commerceDoc.exists) throw new Error("Comercio no encontrado");
      const accessToken = commerceDoc.data().mpAccessToken;

      const client = new MercadoPagoConfig({ accessToken: accessToken });
      const paymentInstance = new Payment(client);
      const payment = await paymentInstance.get({ id: paymentId });
      
      if (payment.status === "approved") {
        const orderId = Number(payment.external_reference);
        
        const orderSnap = await db.collection("orders").where("orderId", "==", orderId).get();
        if (!orderSnap.empty) {
          const orderDoc = orderSnap.docs[0];
          const orderData = orderDoc.data();
          
          // IDEMPOTENCY CHECK: skip if already processed/paid
          if (orderData.paymentStatus !== "paid") {
            await orderDoc.ref.update({ 
              status: "pending",
              paymentStatus: "paid",
              mpPaymentId: paymentId
            });
            logger.info(`Webhook: Order ${orderId} marked as PAID and PENDING successfully.`);
          } else {
            logger.info(`Webhook: Order ${orderId} already processed.`);
          }
        }
      }
    } catch (error) {
      logger.error("Webhook processing error:", error);
    }
  }

  res.status(200).send("OK");
});


// ═══════════════════════════════════════════════════
// PUSH NOTIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════

let cachedMaintenance = null;
let lastMaintenanceFetch = 0;

async function getMaintenanceConfig() {
  const now = Date.now();
  if (cachedMaintenance && (now - lastMaintenanceFetch < 10000)) {
    return cachedMaintenance;
  }
  try {
    const globalSnap = await db.collection("settings").doc("global").get();
    if (globalSnap.exists) {
      cachedMaintenance = globalSnap.data();
    } else {
      cachedMaintenance = { maintenanceMode: false, maintenanceAllowedEmails: [] };
    }
  } catch (err) {
    logger.error("Error fetching maintenance settings:", err);
    cachedMaintenance = { maintenanceMode: false, maintenanceAllowedEmails: [] };
  }
  lastMaintenanceFetch = now;
  return cachedMaintenance;
}

/**
 * Helper: Get all FCM tokens for a user (respecting maintenance allowed emails list)
 */
async function getUserTokens(userId) {
  try {
    const mCfg = await getMaintenanceConfig();
    if (mCfg.maintenanceMode === true) {
      const userSnap = await db.collection("users").doc(userId).get();
      if (userSnap.exists) {
        const uData = userSnap.data();
        const email = (uData.email || "").toLowerCase().trim();
        const allowedEmails = (mCfg.maintenanceAllowedEmails || []).map(e => e.toLowerCase().trim());
        const isSuperOwner = email === "juanhidalgobass@gmail.com";
        const isAllowed = isSuperOwner || allowedEmails.includes(email);
        
        if (!isAllowed) {
          logger.info(`Blocking push tokens for user ${userId} (${email}) during maintenance mode.`);
          return [];
        }
      }
    }

    const tokensSnap = await db.collection("users").doc(userId).collection("fcmTokens").get();

    // token -> last-seen ms. Keep the most recently registered ones: old
    // devices/reinstalls leave stale tokens behind and must not push out the
    // fresh token of the device the person is actually holding.
    const seen = new Map();
    const remember = (token, ms) => {
      if (!token || typeof token !== "string") return;
      seen.set(token, Math.max(seen.get(token) || 0, ms || 0));
    };

    tokensSnap.docs.forEach(d => {
      const t = d.data();
      remember(t.token || d.id, tsToMs(t.updatedAt) || tsToMs(t.lastSession));
    });

    const userSnap = await db.collection("users").doc(userId).get();
    if (userSnap.exists) {
      const uData = userSnap.data();
      remember(uData.lastFcmToken, tsToMs(uData.lastFcmTokenUpdatedAt) || Date.now());
      if (Array.isArray(uData.fcmTokens)) uData.fcmTokens.forEach(t => remember(t, 0));
    }

    const tokens = [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([token]) => token);
    tokens.forEach(t => tokenOwners.set(t, userId));
    return tokens;
  } catch (err) {
    logger.warn(`Error getting tokens for user ${userId}:`, err);
    return [];
  }
}

/**
 * Helper: Send push notification to a list of tokens
 */
// FCM requires every value in the `data` payload to be a plain string —
// a stray number/boolean/object from any caller silently kills the ENTIRE
// multicast send (not just that field), so every push type stops working
// until this is coerced defensively here.
function sanitizeFcmData(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'string' ? value : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return out;
}

// Error codes that mean the token is permanently dead — safe to delete.
// NOTE: 'messaging/invalid-argument' is deliberately NOT here: it is also
// returned for a malformed payload, and pruning on it would wipe the valid
// tokens of every recipient of that message.
const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

// Temporary FCM failures: worth one retry so an offer push isn't lost to a blip.
const TRANSIENT_ERROR_CODES = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unavailable',
  'messaging/quota-exceeded',
  'messaging/device-message-rate-exceeded'
]);

// Removes a dead FCM token from Firestore so future sends stop wasting
// quota/time retrying it. Only called when we know which user owns the
// token (single-recipient sends) — safe no-op path otherwise.
async function pruneDeadToken(ownerUid, token) {
  if (!ownerUid || !token) return;
  try {
    await db.collection("users").doc(ownerUid).collection("fcmTokens").doc(token).delete();
    const userRef = db.collection("users").doc(ownerUid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const uData = userSnap.data();
      const updates = {};
      if (uData.lastFcmToken === token) updates.lastFcmToken = FieldValue.delete();
      if (Array.isArray(uData.fcmTokens) && uData.fcmTokens.includes(token)) {
        updates.fcmTokens = FieldValue.arrayRemove(token);
      }
      if (Object.keys(updates).length > 0) await userRef.update(updates);
    }
    logger.info(`[sendPush] Pruned dead token for user ${ownerUid}`);
  } catch (err) {
    logger.warn(`[sendPush] Failed to prune dead token for user ${ownerUid}:`, err);
  }
}

// Copy helpers for push texts: short title that says what happened, body with who and the detail.
const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || "";
const storeOf = (o) => o.comercioName || o.commerceName || "";
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
function kindOf(o) {
  if (o.isTrip) return "viaje";
  if (o.isFavor) return o.favorType === "compra" ? "mandado" : "favor";
  return "pedido";
}
// "Juan · 3 productos · $12.500"
function orderLine(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const count = items.reduce((n, it) => n + (Number(it.quantity || it.qty) || 1), 0);
  return [
    firstName(o.userName) || "Un cliente",
    count > 0 ? `${count} ${count === 1 ? "producto" : "productos"}` : "",
    Number(o.total) > 0 ? money(o.total) : ""
  ].filter(Boolean).join(" · ");
}
function offerTitle(o, earnings) {
  return earnings > 0 ? `Nuevo ${kindOf(o)} · ganás ${money(earnings)}` : `Nuevo ${kindOf(o)} disponible`;
}

// Android notification channels (created on the phone in src/utils/notifications.js):
//   exclusive_offers / order_offers / admin_alerts / store_orders → loud, with the offer sound (res/raw/alert.wav)
//   chat_alerts → chat messages; promos → broadcasts people can mute without missing their orders
//   default ("GoDelivery") → everything else: order updates, account notices
// A channel the phone doesn't have yet falls back to "default" (AndroidManifest).
const LOUD_CHANNELS = new Set(["exclusive_offers", "order_offers", "admin_alerts", "store_orders"]);
const PROMO_TYPES = new Set(["custom_global_push", "automated_push", "giveaway_reminder"]);

function channelFor(data) {
  if (data.channelId) return data.channelId;
  if (PROMO_TYPES.has(data.type)) return "promos";
  if (data.type === "chat_message") return "chat_alerts";
  return "default";
}

async function sendPush(tokens, notification, data = {}, ownerUid = null) {
  if (!tokens || tokens.length === 0) return;
  const channelId = channelFor(data);
  const loud = LOUD_CHANNELS.has(channelId);
  // Same tag = the new notice replaces the previous one of that order instead of piling up.
  const collapseTag = typeof data.tag === "string" && data.tag ? data.tag.slice(0, 64) : null;

  // Split tokens into chunks of 500 (FCM sendEachForMulticast limit)
  const tokenChunks = [];
  for (let i = 0; i < tokens.length; i += 500) {
    tokenChunks.push(tokens.slice(i, i + 500));
  }

  // Ensure absolute HTTPS URL for the deep links to bypass relative SW resolution bugs
  const projectId = process.env.GCLOUD_PROJECT || "godelivery-magdalena";
  const baseUrl = `https://${projectId}.web.app/`;
  let targetUrl = data.url || "/#/";
  if (targetUrl.startsWith('#') || targetUrl.startsWith('/#')) {
    targetUrl = baseUrl + targetUrl.replace(/^\//, "");
  } else if (targetUrl.startsWith('/')) {
    targetUrl = `https://${projectId}.web.app` + targetUrl;
  }

  const displayTitle = notification.title || "Go Delivery";
  const displayBody = notification.body || "";

  let totalSuccess = 0;
  let totalFailure = 0;

  for (const chunk of tokenChunks) {
    const message = {
      notification: {
        title: displayTitle,
        body: displayBody,
        image: notification.image || ""
      },
      data: sanitizeFcmData({
        ...data,
        channelId,
        loud: loud ? "1" : "0",
        title: displayTitle,
        body: displayBody,
        icon: "/logo-pwa.png",
        badge: "/badge-icon.png",
        image: notification.image || "",
        url: targetUrl
      }),
      android: {
        priority: "high",
        ttl: 3600000,
        notification: {
          title: displayTitle,
          body: displayBody,
          channelId,
          priority: loud ? "max" : "high",
          // Android 8+ takes the sound from the channel; these two only matter on older phones.
          sound: loud ? "alert" : "default",
          defaultSound: !loud,
          defaultVibrateTimings: true,
          visibility: "public",
          ...(collapseTag ? { tag: collapseTag } : {})
        }
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
          "apns-topic": "com.godelivery.magdalena",
          ...(collapseTag ? { "apns-collapse-id": collapseTag } : {})
        },
        payload: {
          aps: {
            alert: {
              title: displayTitle,
              body: displayBody
            },
            // alert.wav ships in the iOS app from 1.7.6 (same ping as the offer on screen);
            // older installs don't have it and play the default sound instead.
            sound: loud ? "alert.wav" : "default",
            // No badge: nothing ever cleared it, so the icon stayed at 1 forever.
            "content-available": 1,
            // iOS solo muestra los botones de accion si la categoria del payload coincide con una
            // categoria registrada en el dispositivo (ver registerOrderOfferCategory en
            // AppDelegate.swift). Sin esto, la push llega pero sin "ACEPTAR PEDIDO".
            category: data.category || (data.channelId === "order_offers" ? "ORDER_OFFER" : undefined)
          },
          url: targetUrl,
          ...data
        }
      },
      webpush: {
        headers: {
          Urgency: "high"
        },
        notification: {
          title: displayTitle,
          body: displayBody,
          icon: "https://godelivery-magdalena.web.app/logo-pwa.png",
          badge: "https://godelivery-magdalena.web.app/badge-icon.png",
          vibrate: loud ? [300, 120, 300, 120, 300] : [120, 60, 120],
          // Only what needs an answer stays on screen; order updates go away on their own like any app.
          requireInteraction: loud,
          renotify: Boolean(collapseTag),
          tag: collapseTag || undefined,
          data: {
            ...data,
            url: targetUrl
          }
        },
        fcmOptions: {
          link: targetUrl
        }
      },
      tokens: chunk
    };

    if (data.imageUrl && (data.imageUrl.startsWith("http://") || data.imageUrl.startsWith("https://"))) {
      // Set platform-specific image fields to prevent FCM delivery validation failures on Web/PWA
      message.notification.image = data.imageUrl;
      message.android.notification.image = data.imageUrl;
      message.webpush.notification.image = data.imageUrl;
      message.apns.fcmOptions = {
        imageUrl: data.imageUrl
      };
    }

    const handleResponse = (response, sentTokens) => {
      totalSuccess += response.successCount;
      totalFailure += response.failureCount;
      logger.info(`[sendPush] Multicast result: ${response.successCount} success, ${response.failureCount} failed for target ${displayTitle}`);

      const retryTokens = [];
      response.responses.forEach((r, i) => {
        if (!r.success) {
          const token = sentTokens[i];
          const code = r.error?.code;
          logger.warn(`[sendPush] Token failed (${token.slice(0, 12)}...): ${code} - ${r.error?.message}`);
          const owner = ownerUid || tokenOwners.get(token);
          // invalid-argument también sale si el mensaje está mal armado: solo cuenta como token
          // muerto cuando FCM dice que no es un token válido (tokens APNs de iPhones viejos)
          const notAToken = code === 'messaging/invalid-argument' && /registration token/i.test(r.error?.message || '');
          if (owner && (DEAD_TOKEN_ERROR_CODES.has(code) || notAToken)) {
            pruneDeadToken(owner, token);
          } else if (TRANSIENT_ERROR_CODES.has(code)) {
            retryTokens.push(token);
          }
        }
      });
      return retryTokens;
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      const retryTokens = handleResponse(response, chunk);

      if (retryTokens.length > 0) {
        logger.info(`[sendPush] Retrying ${retryTokens.length} token(s) after transient FCM error.`);
        await new Promise(r => setTimeout(r, 1500));
        try {
          const retryResponse = await admin.messaging().sendEachForMulticast({ ...message, tokens: retryTokens });
          totalFailure -= retryTokens.length;
          handleResponse(retryResponse, retryTokens);
        } catch (retryErr) {
          logger.error("[sendPush] Retry failed:", retryErr);
        }
      }
    } catch (err) {
      logger.error("Error sending chunk of push notifications:", err);
    }
  }

  logger.info(`Push sent total: ${totalSuccess} success, ${totalFailure} failed`);
  return { success: totalSuccess, failure: totalFailure };
}

const CHAT_REPLY_URL = `https://us-central1-${process.env.GCLOUD_PROJECT || "godelivery-magdalena"}.cloudfunctions.net/chatReplyFromPush`;

/** Tokens de Android cuya app ya arma sola el aviso de chat con el cuadro para responder. */
async function getReplyableAndroidTokens(userId) {
  try {
    const snap = await db.collection("users").doc(userId).collection("fcmTokens").where("chatReply", "==", true).get();
    return new Set(snap.docs.filter((d) => d.data().platform === "android-native").map((d) => d.data().token || d.id));
  } catch (e) {
    logger.warn(`Could not read reply tokens for ${userId}:`, e);
    return new Set();
  }
}

/**
 * Aviso de chat solo con datos, para Android con GoMessagingService: la app lo muestra con
 * "Responder". Sin el bloque notification, porque si no Android lo muestra solo y sin el botón.
 * Devuelve cuántos se enviaron.
 */
async function sendReplyablePush(tokens, notification, data, ownerUid) {
  const projectId = process.env.GCLOUD_PROJECT || "godelivery-magdalena";
  const url = `https://${projectId}.web.app/${String(data.url || "#/").replace(/^\//, "")}`;
  try {
    const response = await admin.messaging().sendEachForMulticast({
      data: sanitizeFcmData({ ...data, goReply: "1", title: notification.title || "GO!", body: notification.body || "", url }),
      android: { priority: "high", ttl: 3600000 },
      tokens
    });
    response.responses.forEach((r, i) => {
      if (!r.success && DEAD_TOKEN_ERROR_CODES.has(r.error?.code)) pruneDeadToken(ownerUid, tokens[i]);
    });
    return response.successCount;
  } catch (err) {
    logger.error("Error sending replyable chat push:", err);
    return 0;
  }
}

/** Respuesta escrita en la notificación del chat (GoNativePlugin). Ver functions/chat-reply.js */
exports.chatReplyFromPush = onRequest({ maxInstances: 10 }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Método no permitido"); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const [status, msg] = await require("./chat-reply").postReply(db, { token: body.token, text: body.text });
    res.status(status).json({ ok: status === 200, message: msg });
  } catch (err) {
    logger.error("chatReplyFromPush failed:", err);
    res.status(500).json({ ok: false, message: "Error del servidor" });
  }
});

const isGoMarketName = (name) => {
  const n = String(name || "").toLowerCase();
  return n.includes("go!") && n.includes("market");
};

/**
 * Aviso de pedido al comercio (pedido nuevo, recordatorio, pago aprobado).
 * Antes, si el dueño no tenía ningún dispositivo registrado (nunca dio el permiso o lo
 * rechazó) el aviso no salía y no quedaba rastro: el 10-10-2026 seis comercios estaban así.
 * Ahora queda en el log con el motivo y, con alertAdmins, los admins reciben una push para
 * llamar al comercio (mismo tag por pedido: no se apilan).
 * goMarketToAdmins: GO! Market lo atienden los admins.
 * Devuelve { sent, reason }.
 */
async function notifyCommerceOrder(orderId, order, notification, { alertAdmins = true, goMarketToAdmins = false } = {}) {
  const orderNum = order.orderId || orderId.slice(0, 6);
  const data = { tag: `new-order-${orderId}`, url: `#/mi-comercio/${order.comercioId}/orders`, type: "new_order", channelId: "store_orders" };
  const comercioDoc = await db.collection("comercios").doc(order.comercioId).get();
  if (!comercioDoc.exists) {
    logger.warn(`[StorePush] Pedido ${orderNum}: el comercio ${order.comercioId} no existe.`);
    return { sent: 0, reason: "sin_comercio" };
  }
  const com = comercioDoc.data();
  const adminTokens = await getAdminTokens();

  if (goMarketToAdmins && isGoMarketName(com.name)) {
    await sendPush(adminTokens, notification, data);
    return { sent: adminTokens.length, reason: "gomarket" };
  }

  let ownerId = com.ownerId;
  if (!ownerId) {
    const q = await db.collection("users").where("comercioId", "==", order.comercioId).limit(1).get();
    if (!q.empty) ownerId = q.docs[0].id;
  }
  const ownerTokens = ownerId ? await getUserTokens(ownerId) : [];
  // Los tokens que también son de un admin ya reciben el aviso de admin: no se duplican
  const adminSet = new Set(adminTokens);
  const pure = ownerTokens.filter(t => !adminSet.has(t));

  if (pure.length > 0) {
    logger.info(`[StorePush] Pedido ${orderNum} → ${com.name || order.comercioId} (${pure.length} dispositivos).`);
    await sendPush(pure, notification, data);
    return { sent: pure.length, reason: "ok" };
  }
  if (ownerTokens.length > 0) return { sent: 0, reason: "dueno_admin" }; // el dueño es admin: ya le llegó como admin

  const reason = ownerId ? "sin_dispositivos" : "sin_dueno";
  logger.warn(`[StorePush] Pedido ${orderNum}: ${com.name || order.comercioId} no recibe avisos (${reason}).`);
  if (alertAdmins && adminTokens.length > 0) {
    await sendPush(adminTokens, {
      title: `${com.name || "Un comercio"} no recibe avisos`,
      body: `Entró el pedido #${orderNum} y ${ownerId ? "no tiene avisos activados en ningún dispositivo" : "no tiene dueño cargado"}. Llamalo para que lo acepte.`
    }, { tag: `store-unreachable-${orderId}`, url: `#/admin/orders`, type: "admin_support_alert", channelId: "admin_alerts" });
  }
  return { sent: 0, reason };
}

/**
 * Helper: Get all online delivery tokens
 */
async function getOnlineDeliveryTokens() {
  try {
    const snap = await db.collection("users").where("isOnline", "==", true).get();
    let tokens = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const isDel = (data.isDelivery === true || data.isDelivery === "true" || data.role === "delivery" || data.role === "driver" || data.role === "repartidor") && 
                    (data.deliveryStatus === "approved" || data.tripStatus === "approved");
      if (isDel) {
        const userTokens = await getUserTokens(doc.id);
        tokens = tokens.concat(userTokens);
      }
    }
    return [...new Set(tokens)];
  } catch (err) {
    logger.error("Error getting online delivery tokens:", err);
    return [];
  }
}

/**
 * Helper: Get all admin and support user documents
 */
async function getAllAdminDocs() {
  try {
    // allSettled: if one of the queries fails, the others must still notify support.
    const results = await Promise.allSettled([
      db.collection("users").where("role", "==", "admin").get(),
      db.collection("users").where("isAdmin", "==", true).get(),
      db.collection("users").where("role", "==", "superadmin").get(),
      db.collection("users").where("role", "==", "soporte").get(),
      db.collection("users").where("isSupport", "==", true).get()
    ]);
    const seenIds = new Set();
    const allDocs = [];
    for (const result of results) {
      if (result.status !== "fulfilled") {
        logger.error("[getAllAdminDocs] One admin query failed:", result.reason);
        continue;
      }
      for (const d of result.value.docs) {
        if (!seenIds.has(d.id)) {
          seenIds.add(d.id);
          allDocs.push(d);
        }
      }
    }
    return allDocs;
  } catch (err) {
    logger.error("Error getting all admin docs:", err);
    return [];
  }
}

/**
 * Helper: Get all admin tokens
 */
async function getAdminTokens() {
  try {
    const allAdminDocs = await getAllAdminDocs();
    let tokens = [];
    for (const doc of allAdminDocs) {
      const userTokens = await getUserTokens(doc.id);
      tokens = tokens.concat(userTokens);
      const uData = doc.data();
      if (uData) {
        const extra = [];
        if (uData.lastFcmToken) extra.push(uData.lastFcmToken);
        if (Array.isArray(uData.fcmTokens)) extra.push(...uData.fcmTokens);
        extra.forEach(t => { if (t && !tokenOwners.has(t)) tokenOwners.set(t, doc.id); });
        tokens = tokens.concat(extra);
      }
    }
    return [...new Set(tokens)].filter(Boolean);
  } catch (err) {
    logger.error("Error getting admin tokens:", err);
    return [];
  }
}

/**
 * Helper: Server-side dispatch queue — selects the best eligible driver
 * and atomically assigns them to the order. Used for favor/trip orders on
 * creation and for regular orders when they become 'ready'.
 */
async function serverSideDispatch(orderId, order) {
  try {
    // Guard: Takeaway orders should NEVER be dispatched to delivery drivers
    if (order.deliveryType === 'takeaway' || order.deliveryType === 'retiro') {
      logger.info(`[ServerDispatch] Order ${orderId} is Takeaway / Retiro en el local. Skipping driver dispatch.`);
      return;
    }

    // Guard: Regular commerce orders must ONLY be dispatched when they are 'ready'
    if (!order.isFavor && !order.isTrip && !order.isShopper && order.status !== 'ready') {
      logger.info(`[ServerDispatch] Order ${orderId} is a commerce order with status '${order.status}'. Skipping dispatch until 'ready'.`);
      return;
    }

    logger.info(`[ServerDispatch] Running dispatch for order ${orderId} (isFavor=${!!order.isFavor}, isTrip=${!!order.isTrip}, status=${order.status})`);

    // 1. Get commerce own-delivery emails
    let ownEmails = [];
    if (order.comercioId) {
      const comSnap = await db.collection("comercios").doc(order.comercioId).get();
      if (comSnap.exists) ownEmails = comSnap.data().ownDeliveries || [];
    }
    const isOwnDeliveryOrder = ownEmails.length > 0;

    // 2. Fetch eligible drivers
    let allDrivers = [];
    const isDriverUser = (data) => {
      const role = data.role || "";
      const isDel = data.isDelivery === true || data.isDelivery === "true" || role === "delivery" || role === "driver" || role === "repartidor" || role === "chofer" || role === "admin";
      return isDel;
    };

    if (isOwnDeliveryOrder) {
      const ownEmailsLower = ownEmails.map(e => e.trim().toLowerCase());
      const chunks = [];
      for (let i = 0; i < ownEmailsLower.length; i += 30) chunks.push(ownEmailsLower.slice(i, i + 30));
      for (const chunk of chunks) {
        const snap = await db.collection("users").where("email", "in", chunk).get();
        snap.docs.forEach(d => { if (isDriverUser(d.data())) allDrivers.push({ id: d.id, ...d.data() }); });
      }
    } else {
      const snap = await db.collection("users").where("isOnline", "==", true).get();
      snap.docs.forEach(d => { if (isDriverUser(d.data())) allDrivers.push({ id: d.id, ...d.data() }); });
    }

    if (allDrivers.length === 0) {
      logger.info(`[ServerDispatch] No online drivers found for order ${orderId}. Order remains active until drivers connect or manual cancellation.`);
      return;
    }

    // 3. Get active orders to enforce simultaneous-order caps
    const activeOrdersSnap = await db.collection("orders")
      .where("status", "in", ["accepted", "confirmed", "preparing", "ready", "picked_up", "at_door", "delivering"])
      .get();
    const activeByDriver = {};
    activeOrdersSnap.docs.forEach(docSnap => {
      const ord = docSnap.data();
      if (ord.driverId) {
        if (!activeByDriver[ord.driverId]) activeByDriver[ord.driverId] = [];
        activeByDriver[ord.driverId].push({ id: docSnap.id, ...ord });
      }
    });

    const canTake = (driverId, comercioId) => {
      const active = activeByDriver[driverId] || [];
      if (active.length === 0) return true;
      const allSame = active.every(x => x.comercioId && x.comercioId === active[0].comercioId);
      const isSame = active[0]?.comercioId && active[0].comercioId === comercioId;
      if (active.length >= 2) return allSame && isSame && active.length + 1 <= 3;
      if (active.length === 1) return isSame ? active.length + 1 <= 3 : active.length + 1 <= 2;
      return false;
    };

    const now = Date.now();
    const rejected = order.queueRejectedDrivers || [];
    const debtPolicy = isOwnDeliveryOrder ? { enabled: false } : await loadDebtPolicy(db);

    let eligible = allDrivers.filter(d => {
      if (!canTake(d.id, order.comercioId)) return false;
      // Above the debt limit: finishes what they have, but gets nothing new until they pay.
      if (isOverDebtLimit(d, debtPolicy)) return false;
      if (d.cooldownUntil) {
        const coolMs = d.cooldownUntil.toMillis ? d.cooldownUntil.toMillis() : new Date(d.cooldownUntil).getTime();
        if (coolMs > now) return false;
      }
      // DeliveryMode filter
      const mode = d.deliveryMode || "both";
      if (mode === "trip" && !order.isTrip) return false;
      if (mode === "delivery" && order.isTrip) return false;
      // Trip vehicle type filter
      if (order.isTrip) {
        const isApproved = d.tripStatus === "approved" || d.role === "chofer";
        if (!isApproved) return false;
        const reqType = (order.tripType || "auto").toLowerCase();
        // Sin vehículo cargado cuenta como moto: desde el 09-10-2026 los viajes son solo en moto
        const drvType = (d.tripVehicleType || d.vehicleType || "moto").toLowerCase();
        if (reqType !== drvType) return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      logger.warn(`[ServerDispatch] No eligible drivers for order ${orderId}. Leaving in public queue.`);
      return;
    }

    // Strict rule: A driver can NEVER receive the same order twice in a row if there is at least one other eligible driver.
    const lastOfferedDriverId = rejected[rejected.length - 1];
    if (lastOfferedDriverId && eligible.length > 1) {
      eligible = eligible.filter(d => d.id !== lastOfferedDriverId);
    }

    // 4. Sort: co-pickup first → fewest rejections → longest waiting time since last rejection or delivery
    const coPickupDriver = eligible.find(d =>
      activeOrdersSnap.docs.some(docSnap => {
        const ord = docSnap.data();
        return ord.driverId === d.id && ord.comercioId === order.comercioId && !ord.pickedUpAt;
      })
    );
    const fourHoursAgoMs = Date.now() - (4 * 60 * 60 * 1000);

    eligible.sort((a, b) => {
      const ra = rejected.filter(id => id === a.id).length;
      const rb = rejected.filter(id => id === b.id).length;
      if (ra !== rb) return ra - rb;
      
      // Calculate Active Orders weight (+10 per active order in progress) + Recent completed in last 4 hours
      const activeA = (activeByDriver[a.id] || []).length;
      const activeB = (activeByDriver[b.id] || []).length;

      const getRecentCompletedCount = (drv) => {
        const times = drv.recentCompletedTimes || [];
        if (!Array.isArray(times) || times.length === 0) {
          return drv.completedOrdersToday || 0;
        }
        return times.filter(t => typeof t === 'number' && t >= fourHoursAgoMs).length;
      };

      const scoreA = (activeA * 10) + getRecentCompletedCount(a);
      const scoreB = (activeB * 10) + getRecentCompletedCount(b);

      if (scoreA !== scoreB) return scoreA - scoreB;

      // If rejections count is equal, sort by the last rejection index in the array
      // (a smaller index means they rejected/missed it longer ago, so they get it next)
      const idxA = rejected.lastIndexOf(a.id);
      const idxB = rejected.lastIndexOf(b.id);
      if (idxA !== idxB) return idxA - idxB;
      
      // Fallback to lastDeliveryAt round-robin
      const timeA = a.lastDeliveryAt ? (a.lastDeliveryAt.toMillis ? a.lastDeliveryAt.toMillis() : new Date(a.lastDeliveryAt).getTime()) : 0;
      const timeB = b.lastDeliveryAt ? (b.lastDeliveryAt.toMillis ? b.lastDeliveryAt.toMillis() : new Date(b.lastDeliveryAt).getTime()) : 0;
      return timeA - timeB;
    });

    const targetDirectUid = order.directDriverUid || order.queueTargetDriverId;
    let chosen = null;
    if (targetDirectUid && targetDirectUid !== 'rotation' && !rejected.includes(targetDirectUid)) {
      chosen = eligible.find(d => d.id === targetDirectUid);
      if (!chosen) {
        const directSnap = await db.collection("users").doc(targetDirectUid).get();
        if (directSnap.exists) {
          chosen = { id: directSnap.id, ...directSnap.data() };
        }
      }
      // A driver above the debt limit can't take it anyway: offer it to the rest instead.
      if (chosen && isOverDebtLimit(chosen, debtPolicy)) chosen = null;
    }
    if (!chosen) {
      chosen = coPickupDriver || eligible[0];
    }

    const isOnlyDriver = allDrivers.length === 1;

    let assigned = false;
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(db.collection("orders").doc(orderId));
      if (!freshSnap.exists) return;
      const freshOrder = freshSnap.data();
      if (freshOrder.driverId || freshOrder.queueTargetDriverId) return; // already claimed
      
      tx.update(db.collection("orders").doc(orderId), {
        queueTargetDriverId: chosen.id,
        queueTargetDriverName: chosen.displayName || chosen.name || "Repartidor",
        queueOfferedAt: FieldValue.serverTimestamp(),
        // This function sends the offer push itself; onOrderStatusChange must not send a second one.
        queueOfferedBy: "server",
        queueRejectedDrivers: rejected,
        isPermanentOffer: isOnlyDriver ? true : null
      });
      assigned = true;
    });

    if (assigned) {
      logger.info(`[ServerDispatch] ✅ Order ${orderId} → driver ${chosen.id} (${chosen.displayName || chosen.name})`);
      
      // Notify the chosen target driver via Push Notification & In-App Notification (even if rotated back to them)
      try {
        const originStr = order.comercioName || order.pickupAddress || (order.isFavor ? (order.favorTypeLabel || "Favor") : "Retiro");
        const destStr = order.destinationAddress || order.address || order.deliveryAddress || "Dirección de entrega";
        const earnings = Math.round(order.driverEarnings || order.shippingFee || order.deliveryFee || order.shippingCost || 0);

        const pushTitle = offerTitle(order, earnings);
        const pushBody = `${originStr} → ${destStr}. Tenés 60 s para aceptar.`;

        await db.collection("users").doc(chosen.id).collection("notifications").add({
          type: "new_exclusive_offer",
          title: pushTitle,
          body: pushBody,
          status: "unread",
          url: `#/delivery?takeOrderId=${orderId}`,
          orderId: orderId,
          createdAt: FieldValue.serverTimestamp()
        });

        const targetTokens = await getUserTokens(chosen.id);
        if (targetTokens.length > 0) {
          await sendPush(targetTokens, {
            title: pushTitle,
            body: pushBody
          }, { 
            tag: `exclusive-offer-${orderId}-${Date.now()}`, 
            url: `#/delivery?takeOrderId=${orderId}`,
            type: "exclusive_offer",
            orderId: orderId,
            takeOrderId: orderId,
            sound: "alert.mp3",
            channelId: "exclusive_offers"
          });
          logger.info(`[ServerDispatch] Sent FCM push to target driver ${chosen.id}`);
        } else {
          // The offer is live but only reaches the driver if their app happens to be open.
          logger.warn(`[ServerDispatch] Driver ${chosen.id} (${chosen.displayName || chosen.name}) has NO push token: offer for ${orderId} sent in-app only.`);
        }
      } catch (pushErr) {
        logger.error(`[ServerDispatch] Error sending push to target driver ${chosen.id}:`, pushErr);
      }
    } else {
      logger.info(`[ServerDispatch] Order ${orderId} already claimed — skipping.`);
    }
  } catch (err) {
    logger.error(`[ServerDispatch] Error dispatching order ${orderId}:`, err);
  }
}

/**
 * Trigger: New order created → Notify Client and Commerce
 */
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const order = event.data.data();
  const orderId = event.params.orderId;
  if (!order) return;

  const orderNum = order.orderId || orderId.slice(0, 6);

  try {
    // 0. El comercio primero: es quien tiene que reaccionar. Antes salía después de avisar a
    //    todos los admins (push + un doc por admin), 2-3 s más tarde.
    if (!order.isFavor && !order.isTrip && !order.isShopper && order.comercioId) {
      try {
        await notifyCommerceOrder(orderId, order, {
          title: `Nuevo pedido #${orderNum}`,
          body: `${orderLine(order)}. Confirmalo para que empiecen a prepararlo.`
        });
      } catch (err) {
        logger.error(`[StorePush] Pedido ${orderNum}: no se pudo avisar al comercio:`, err);
      }
    }

    // 1. Notify ALL admins of ANY new order
    try {
      const allAdminDocs = await getAllAdminDocs();
      let orderTypeLabel = 'Pedido general';
      if (order.isFavor) {
        const favorTypes = {
          compra: 'Favor de Compra 🛒',
          pagodeservicios: 'Pago de Servicios ⚡',
          gocash: 'Go Cash 💵',
          encomienda: 'Encomienda 📦'
        };
        orderTypeLabel = favorTypes[order.favorType] || 'Favor especial 🌟';
      } else if (order.isTrip) {
        orderTypeLabel = 'Viaje solicitado 🚴';
      } else {
        orderTypeLabel = `Compra en ${order.comercioName || 'Tienda'} 🏪`;
      }

      const adminTokens = await getAdminTokens();

      if (adminTokens.length > 0) {
        await sendPush(adminTokens, {
          title: `Nuevo pedido #${orderNum}`,
          body: `${orderTypeLabel} · ${order.userName || "Cliente"}`
        }, {
          tag: `admin-new-order-${orderId}`,
          url: `#/admin/orders`,
          type: 'admin_support_alert',
          channelId: 'admin_alerts'
        });
      }

      for (const adminDoc of allAdminDocs) {
        await db.collection("users").doc(adminDoc.id).collection("notifications").add({
          title: `Nuevo pedido #${orderNum}`,
          body: `${orderTypeLabel} · ${order.userName || "Cliente"}`,
          type: 'admin_support_alert',
          status: 'unread',
          url: `#/admin/orders`,
          createdAt: new Date()
        });
      }
    } catch (err) {
      logger.error("Error notifying admins of new order:", err);
    }

    // 1. GoFavor and GoViaje orders are dispatched immediately
    //    server-side so only the targeted driver receives the exclusive offer push.
    //    "Compra el repartidor" también: el comercio no confirma.
    if (order.isShopper) {
      await Promise.allSettled((order.items || []).filter(item => item.productId).map(item =>
        db.collection("comercios").doc(order.comercioId).collection("products").doc(item.productId)
          .update({ salesCount: FieldValue.increment(item.qty || 1) })));
    }
    if (order.isFavor || order.isTrip || order.isShopper) {
      // Small delay to let Firestore settle before running dispatch
      await new Promise(r => setTimeout(r, 1500));
      await serverSideDispatch(orderId, order);
      return;
    }

    // (El aviso al comercio salió al principio: ver paso 0.)

    // 3. Denormalize per-product sales count so the home "más pedidos" section
    //    can read a single sorted query instead of one query per product.
    if (Array.isArray(order.items) && order.items.length > 0 && order.comercioId) {
      const results = await Promise.allSettled(
        order.items
          .filter(item => item.productId)
          .map(item =>
            db.collection("comercios").doc(order.comercioId)
              .collection("products").doc(item.productId)
              .update({ salesCount: FieldValue.increment(item.qty || 1) })
          )
      );
      results.forEach((r, idx) => {
        if (r.status === "rejected") {
          logger.error(`Error incrementing salesCount for item ${idx} in order ${orderId}:`, r.reason);
        }
      });
    }
  } catch (err) {
    logger.error("Error in onOrderCreated:", err);
  }
});

/**
 * Trigger: New chat message → Notify the other participant
 */
exports.onNewChatMessage = onDocumentCreated("chats/{chatId}/messages/{messageId}", async (event) => {
  const message = event.data.data();
  const chatId = event.params.chatId;
  
  if (!message || !message.senderId || message.orderEvent) return;

  try {
    // El doc del chat lo crea la app sin esperar: si el mensaje llega antes, igual hay que avisar
    const chatDoc = await db.collection("chats").doc(chatId).get();
    const chatData = chatDoc.exists ? chatDoc.data() : {};
    const orderId = chatData.orderId || chatId.split("_")[0];
    const senderName = message.senderName || "Mensaje nuevo";
    
    // Each chat notifies only its two sides. This used to notify everyone in the order, so the
    // driver got the customer's messages to the shop (and could open that chat from the push).
    const { chatParties, chatTypeOf } = require("./chat-access");
    let recipientIds = null;
    if (orderId) {
      try {
        const orderDoc = await db.collection("orders").doc(orderId).get();
        if (orderDoc.exists) {
          const order = orderDoc.data();
          const comercioDoc = order.comercioId ? await db.collection("comercios").doc(order.comercioId).get() : null;
          recipientIds = chatParties(chatTypeOf(chatId, chatData), order, comercioDoc && comercioDoc.exists ? comercioDoc.data() : null);
        }
      } catch (e) {
        logger.warn("Error reading order for chat push:", e);
      }
    }
    // Without the order there is no way to tell who belongs: better no push than one to the wrong person.
    if (!recipientIds) return;

    // 3. Filter out sender and duplicates
    recipientIds = [...new Set(recipientIds)].filter(id => id && String(id) !== String(message.senderId));

    // Por tipo primero: una versión vieja de la app crea la foto con el texto "Subiendo imagen..."
    const msgBody = message.type === "image" ? "📷 Foto"
      : message.type === "audio" ? "🎤 Mensaje de voz"
      : message.text
        ? (message.text.length > 150 ? message.text.substring(0, 150) + "..." : message.text)
        : "Nuevo mensaje";

    // Qué se pudo enviar a cada uno: sin esto no hay forma de medir si los avisos llegan
    const delivery = {};
// 4. Send Push Notification to all recipients
    for (const recipientId of recipientIds) {
      const tokens = await getUserTokens(recipientId);
      delivery[recipientId] = { tokens: tokens.length, sent: 0 };
      if (tokens.length > 0) {
        // Pase para responder desde la notificación (functions/chat-reply.js)
        const replyToken = await require("./chat-reply").makeReplyToken(db, { chatId, uid: recipientId })
          .catch((e) => { logger.warn("Could not make chat reply token:", e); return ""; });
        const chatData = {
          tag: `chat-${chatId}`,
          url: `#/mis-chats?chatId=${chatId}`,
          type: "chat_message",
          sound: "chat.mp3",
          channelId: "chat_alerts",
          chatId: chatId,
          orderId: orderId || "",
          ...(replyToken ? { category: "GO_CHAT", replyToken, replyUrl: CHAT_REPLY_URL } : {})
        };
        // Android con la app nueva arma el aviso él mismo, con el cuadro para responder
        const replyable = replyToken ? await getReplyableAndroidTokens(recipientId) : new Set();
        const plain = tokens.filter((t) => !replyable.has(t));
        const own = tokens.filter((t) => replyable.has(t));
        const pushed = plain.length ? await sendPush(plain, { title: senderName, body: msgBody }, chatData) : null;
        const pushedOwn = own.length ? await sendReplyablePush(own, { title: senderName, body: msgBody }, chatData, recipientId) : 0;
        delivery[recipientId].sent = (pushed ? pushed.success : 0) + pushedOwn;
      }

      // Also add in-app notification doc for the recipient
      try {
        await db.collection("users").doc(recipientId).collection("notifications").add({
          type: "chat_message",
          title: senderName,
          body: msgBody,
          status: "unread",
          url: `#/mis-chats?chatId=${chatId}`,
          chatId: chatId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (nErr) {
        logger.error(`Error writing chat notification doc for ${recipientId}:`, nErr);
      }
    }
    const { REMIND_AFTER_MS } = require("./chat-reminders");
    const canRemind = Object.values(delivery).some((d) => d.tokens > 0);
    await event.data.ref.update({
      delivery,
      ...(canRemind ? { remindAt: admin.firestore.Timestamp.fromMillis(Date.now() + REMIND_AFTER_MS) } : {}),
    }).catch((e) => logger.warn("Could not save chat delivery:", e));

    // Insultos o querer arreglar por fuera de la app: al admin, para que mire
    const flagged = await require("./chat-events").flagChatMessage(db, { chatId, messageId: event.params.messageId, message })
      .catch((e) => { logger.warn("Could not flag chat message:", e); return null; });
    if (flagged) {
      const adminTokens = await getAdminTokens();
      if (adminTokens.length) await sendPush(adminTokens, { title: "Chat para revisar", body: flagged }, { tag: `chat-flag-${chatId}`, url: "#/admin/errores", channelId: "admin_alerts" });
    }

    // Texto del audio, para leerlo sin escucharlo. Hasta 60 s: lo que admite el pedido directo.
    if (message.type === "audio" && message.audioUrl && Number(message.duration) > 0 && Number(message.duration) < 60) {
      const res = await fetch(message.audioUrl);
      const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      const { transcribeAudio } = require("./speech-to-text");
      const out = bytes && await transcribeAudio(bytes, { logger, label: "Chat" });
      if (out) {
        db.collection("wa_ai_log").add({ at: FieldValue.serverTimestamp(), kind: "chat_audio", seconds: out.seconds }).catch(() => {});
        if (out.text) await event.data.ref.update({ transcript: out.text.slice(0, 2000) });
      }
    }
  } catch (err) {
    logger.error("Error in onNewChatMessage:", err);
  }
});

/** Mensajes sin leer: se recuerda una vez (ver functions/chat-reminders.js) */
exports.chatUnreadReminder = onSchedule({ schedule: "every 1 minutes", timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const { runChatReminders } = require("./chat-reminders");
  await runChatReminders({ db, getUserTokens, sendPush, logger });
});

/** Reacción nueva: se le avisa a quien escribió el mensaje */
exports.onChatReaction = onDocumentUpdated("chats/{chatId}/messages/{messageId}", async (event) => {
  const before = event.data.before.data().reactions || {};
  const after = event.data.after.data();
  const reactions = after.reactions || {};
  const changed = Object.keys(reactions).filter((uid) => reactions[uid] && reactions[uid] !== before[uid] && String(uid) !== String(after.senderId));
  if (!changed.length || !after.senderId) return;
  try {
    const tokens = await getUserTokens(after.senderId);
    if (!tokens.length) return;
    const chatId = event.params.chatId;
    for (const uid of changed) {
      const who = await db.collection("users").doc(uid).get();
      const name = who.exists ? firstName(who.data().displayName || who.data().name) : "";
      await sendPush(tokens, {
        title: `${name || "Alguien"} reaccionó ${reactions[uid]}`,
        body: after.type === "image" ? "A tu foto" : after.type === "audio" ? "A tu mensaje de voz" : String(after.text || "A tu mensaje").slice(0, 100),
      }, { tag: `chat-${chatId}`, url: `#/mis-chats?chatId=${chatId}`, type: "chat_message", channelId: "chat_alerts", chatId, orderId: chatId.split("_")[0] });
    }
  } catch (err) {
    logger.error("Error in onChatReaction:", err);
  }
});

/**
 * Trigger: Nuevo chat de Marketplace creado (Comprador inicia contacto) → Notificar a Vendedor
 */
exports.onNewMarketplaceChat = onDocumentCreated("marketplace_chats/{chatId}", async (event) => {
  const chat = event.data.data();
  if (!chat) return;

  try {
    const sellerTokens = await getUserTokens(chat.sellerId);
    if (sellerTokens.length > 0) {
      await sendPush(sellerTokens, {
        title: `${firstName(chat.buyerName) || "Alguien"} te escribió por tu publicación`,
        body: `Quiere consultarte por "${chat.productTitle}".`
      }, { tag: `market-chat-new-${event.params.chatId}`, url: `#/marketplace/chat/${event.params.chatId}` });
    }
  } catch (err) {
    logger.error("Error in onNewMarketplaceChat:", err);
  }
});

/**
 * Trigger: Nuevo mensaje en chat de Marketplace → Notificar al participante receptor
 */
exports.onNewMarketplaceMessage = onDocumentCreated("marketplace_chats/{chatId}/messages/{messageId}", async (event) => {
  const message = event.data.data();
  const chatId = event.params.chatId;
  if (!message || !message.senderId) return;

  try {
    const chatDoc = await db.collection("marketplace_chats").doc(chatId).get();
    if (!chatDoc.exists) return;
    const chatData = chatDoc.data();

    // El destinatario es el participante que NO envió el mensaje
    const recipientId = message.senderId === chatData.buyerId ? chatData.sellerId : chatData.buyerId;
    const recipientTokens = await getUserTokens(recipientId);

    if (recipientTokens.length > 0) {
      await sendPush(recipientTokens, {
        title: message.senderName || "Nuevo mensaje",
        body: message.text.length > 150 ? message.text.substring(0, 150) + "..." : message.text
      }, { tag: `market-msg-${chatId}`, url: `#/marketplace/chat/${chatId}` });
    }
  } catch (err) {
    logger.error("Error in onNewMarketplaceMessage:", err);
  }
});

/**
 * Trigger: Venta de producto en Marketplace (status == 'sold') → Notificar a las partes implicadas
 */
exports.onMarketplaceProductUpdated = onDocumentUpdated("marketplace_products/{productId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;

  // Si el estado cambia a 'sold' y se registró un comprador
  if (before.status !== "sold" && after.status === "sold" && after.buyerId) {
    try {
      // Notificar al vendedor sobre la confirmación de la compra
      const sellerTokens = await getUserTokens(after.sellerId);
      if (sellerTokens.length > 0) {
        await sendPush(sellerTokens, {
          title: "¡Vendiste! 🎉",
          body: `${after.buyerName || "El comprador"} confirmó la compra de "${after.title}".`
        }, { tag: `market-sold-${event.params.productId}`, url: "#/profile/publications" });
      }
    } catch (err) {
      logger.error("Error in onMarketplaceProductUpdated:", err);
    }
  }
});


/**
 * Trigger: Order status change → Notify relevant parties
 */
exports.onOrderStatusChange = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const orderId = event.params.orderId;

  if (!before || !after) return;

  await require("./chat-events").writeOrderChatEvents(db, orderId, before, after)
    .catch((e) => logger.warn("Could not write order event to chat:", e));

  // Only trigger on important changes
  if (before.status === after.status && 
      before.paymentStatus === after.paymentStatus &&
      before.driverId === after.driverId &&
      before.isAtDoor === after.isAtDoor &&
      before.queueTargetDriverId === after.queueTargetDriverId &&
      JSON.stringify(before.items) === JSON.stringify(after.items) &&
      before.total === after.total &&
      JSON.stringify(before.storePrices || {}) === JSON.stringify(after.storePrices || {}) &&
      before.subtotal === after.subtotal) {
    return;
  }

  const orderNum = after.orderId || orderId.slice(0, 6);

  // Reasignado: el cadete anterior deja de ver estos chats en su lista
  if (before.driverId && before.driverId !== after.driverId) {
    for (const type of ["client-delivery", "commerce-delivery"]) {
      db.collection("chats").doc(`${orderId}_${type}`)
        .update({ participants: FieldValue.arrayRemove(before.driverId) })
        .catch(() => {}); // el chat puede no existir
    }
  }

  // Pedidos que entraron por WhatsApp: el mismo aviso le llega al cliente por ahí
  if (after.waPhone) {
    try {
      await wa().notify.onOrderChange(before, after);
    } catch (err) {
      logger.error(`[WhatsApp] Error avisando el pedido ${orderId}:`, err);
    }
  }

  try {
    // 00. Queue rotation trigger: if the target driver is released (from exclusive to null)
    // and the order is still active/unassigned, re-run dispatch.
    // Commerce orders ONLY re-dispatch if they are in 'ready' status.
    const isDispatchableStatus = (after.isFavor || after.isTrip || after.isShopper) 
      ? ['pending', 'confirmed', 'preparing', 'ready'].includes(after.status)
      : (after.status === 'ready');

    if (before.queueTargetDriverId && !after.queueTargetDriverId && !after.driverId && isDispatchableStatus) {
      logger.info(`[ServerDispatch] Queue target released to null for order ${orderId}. Re-running serverSideDispatch.`);
      await serverSideDispatch(orderId, after);
    }

    const bOfferedMs = before.queueOfferedAt ? (before.queueOfferedAt.toMillis ? before.queueOfferedAt.toMillis() : new Date(before.queueOfferedAt).getTime()) : 0;
    const aOfferedMs = after.queueOfferedAt ? (after.queueOfferedAt.toMillis ? after.queueOfferedAt.toMillis() : new Date(after.queueOfferedAt).getTime()) : 0;
    const isTargetAssignedOrRefreshed = after.queueTargetDriverId && (
      before.queueTargetDriverId !== after.queueTargetDriverId ||
      (aOfferedMs > 0 && aOfferedMs !== bOfferedMs)
    );

    if (isTargetAssignedOrRefreshed && !after.driverId) {
      const driverId = after.queueTargetDriverId;
      const driverDoc = await db.collection("users").doc(driverId).get();
      if (driverDoc.exists) {
        const dData = driverDoc.data();
        if (dData.autoAcceptEnabled === true) {
          logger.info(`[Auto-Accept Server-Side] Driver ${driverId} has auto-accept enabled. Automatically assigning order ${orderId}`);
          
          const estTime = after.isTrip ? 10 : 35; // Default estimation
          
          await db.collection("orders").doc(orderId).update({
            driverId: driverId,
            driverName: dData.displayName || dData.name || 'Repartidor',
            driverPhoto: dData.photoURL || '',
            driverPhone: dData.phone || '',
            driverDeliveryId: dData.deliveryId || '',
            // Mismos respaldos que la app al aceptar a mano: los perfiles viejos guardaban el alias en otros campos
            driverAlias: (dData.transferAlias || dData.driverAlias || dData.alias || '').trim(),
            driverVehicleModel: dData.vehicleModel || dData.deliveryVehicleModel || '',
            driverVehicleColor: dData.vehicleColor || '',
            driverVehiclePatent: dData.vehicleDetails || dData.patente || dData.vehiclePlate || dData.deliveryVehiclePlate || '',
            status: (after.isFavor || after.isTrip) ? 'confirmed' : (after.isShopper ? 'accepted' : after.status),
            acceptedAt: FieldValue.serverTimestamp(),
            estimatedDeliveryTime: estTime
          });

          // Reset driver missed offers count to prevent auto-offline disconnect
          await db.collection("users").doc(driverId).update({
            missedOffersCount: 0
          });

          // Fetch the customer's photo URL from their user profile
          let customerPhoto = "";
          // Pedidos cargados a mano no tienen cliente con cuenta: no hay foto que buscar
          if (after.userId) try {
            const customerDoc = await db.collection("users").doc(after.userId).get();
            if (customerDoc.exists) {
              customerPhoto = customerDoc.data().photoURL || "";
            }
          } catch (cErr) {
            logger.error("Error fetching customer photo:", cErr);
          }

          // Notify the driver via Push Notification
          const driverTokens = await getUserTokens(driverId);
          await sendPush(driverTokens, {
            title: "Pedido aceptado automáticamente",
            body: `${storeOf(after) || after.userName || "Nuevo pedido"} → ${after.deliveryAddress || after.address || "cliente"}. Tocá para ver la ruta.`,
            image: customerPhoto
          }, { 
            tag: `auto-accept-${orderId}`, 
            url: `#/delivery`,
            type: "auto_accept",
            sound: "cash.mp3",
            channelId: "auto_accept_alerts",
            click_action: 'FLUTTER_NOTIFICATION_CLICK'
          }, driverId);

          // Create notification document in Firestore for the driver
          await db.collection("users").doc(driverId).collection("notifications").add({
            type: "auto_accept",
            title: "Pedido aceptado automáticamente",
            body: `${storeOf(after) || after.userName || "Nuevo pedido"} → ${after.deliveryAddress || after.address || "cliente"}.`,
            status: "unread",
            url: "#/delivery",
            createdAt: new Date()
          });

          return; // Stop execution of the current invocation as document update will trigger a new event
        } else if (after.queueOfferedBy !== "server") {
          // Standard Exclusive Offer Push Notification (offers made by serverSideDispatch already pushed)
          try {
            const driverTokens = await getUserTokens(driverId);
            const offerEarnings = Math.round(after.driverEarnings || after.shippingFee || after.deliveryFee || after.shippingCost || 0);
            const pushTitle = offerTitle(after, offerEarnings);
            const pushBody = `${storeOf(after) || after.pickupAddress || "Retiro"} → ${after.destinationAddress || after.address || after.deliveryAddress || "cliente"}. Tocá para aceptar.`;

            if (driverTokens.length > 0) {
              await sendPush(driverTokens, {
                title: pushTitle,
                body: pushBody
              }, { 
                tag: `exclusive-offer-${orderId}-${Date.now()}`, 
                url: `#/delivery?takeOrderId=${orderId}`,
                type: "new_exclusive_offer",
                orderId: orderId,
                takeOrderId: orderId,
                sound: "cash.mp3",
                channelId: "exclusive_offers",
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
              }, driverId);
              logger.info(`[onOrderUpdated] Sent FCM exclusive offer push to driver ${driverId}`);
            }

            // Also add it to their Firestore notifications list so they see it in the app drawer
            await db.collection("users").doc(driverId).collection("notifications").add({
              type: "new_exclusive_offer",
              title: pushTitle,
              body: pushBody,
              status: "unread",
              url: `#/delivery?takeOrderId=${orderId}`,
              orderId: orderId,
              createdAt: new Date()
            });
          } catch (err) {
            logger.error("[FCM Error] Failed to send exclusive offer notification:", err);
          }
        }
      }
    }
    // Payment Status Change Notification (For Commerce - Now unifies as the single 'Nuevo Pedido Recibido' alert for MP)
    if (before.paymentStatus !== after.paymentStatus && after.paymentStatus === "paid" && after.comercioId && !after.isFavor && !after.isTrip) {
      try {
        await notifyCommerceOrder(orderId, after, {
          title: `Nuevo pedido #${orderNum}`,
          body: `${orderLine(after)}. Pagado con Mercado Pago, confirmalo para empezar.`
        }, { goMarketToAdmins: true });
      } catch (err) {
        logger.error(`[StorePush] Pago aprobado del pedido ${orderNum}: no se pudo avisar al comercio:`, err);
      }
    }
    
    // Notification for delivery driver at door
    if (before.isAtDoor !== after.isAtDoor && after.isAtDoor === true) {
      if (after.userId) {
        const clientTokens = await getUserTokens(after.userId);
        const rider = firstName(after.driverName) || "Tu repartidor";
        await sendPush(clientTokens, {
          title: "Tu repartidor llegó 📍",
          body: after.verificationCode
            ? `${rider} te espera en la puerta. Código de entrega: ${after.verificationCode}`
            : `${rider} te espera en la puerta.`
        }, { 
          tag: `order-active-${orderId}`, 
          persistent: "true", 
          ongoing: true, 
          requireInteraction: true,
          url: `#/pedido/${orderId}` 
        });
      }
    }

    // Admin assigned the order straight to a driver ("Liberar y Asignar"): the driver
    // didn't accept anything, so without this push they never find out.
    // Keyed on adminAssignedAt changing (not a flag) so a later normal acceptance of the
    // same order by another driver doesn't re-send it.
    if (after.driverId && tsToMs(after.adminAssignedAt) && tsToMs(after.adminAssignedAt) !== tsToMs(before.adminAssignedAt)) {
      try {
        const driverTokens = await getUserTokens(after.driverId);
        const assignTitle = "🚨 ¡Pedido asignado!";
        const assignBody = `Se te asignó el pedido #${orderNum}${after.comercioName ? ` de ${after.comercioName}` : ""}. Tocá para verlo.`;
        if (driverTokens.length > 0) {
          await sendPush(driverTokens, { title: assignTitle, body: assignBody }, {
            tag: `direct-assign-${orderId}`,
            url: "#/delivery",
            type: "direct_assignment",
            orderId: orderId,
            sound: "cash.mp3",
            channelId: "exclusive_offers"
          }, after.driverId);
          logger.info(`[DirectAssign] Push sent to driver ${after.driverId} for order ${orderId}`);
        } else {
          logger.warn(`[DirectAssign] Driver ${after.driverId} has no push tokens (order ${orderId}).`);
        }
      } catch (err) {
        logger.error(`[DirectAssign] Push failed for order ${orderId}:`, err);
      }
    }

    // Driver Assignment Notification (Fires ONCE when a driver accepts an unassigned order/favor/trip)
    if (!before.driverId && after.driverId && after.userId) {
      const clientTokens = await getUserTokens(after.userId);
      const driverName = after.driverName || "un repartidor";
      const title = after.isTrip ? "🚕 Chofer Asignado" : "🛵 Repartidor Asignado";
      // El código de entrega va desde el primer aviso: si se pierde el de "en camino" (app abierta,
      // notificación descartada), el cliente igual lo tiene. Los viajes y encomiendas no lo usan.
      // La app crea las encomiendas con favorType "mandado" (las compras son "compra")
      const isEncomiendaOrder = after.favorType === "encomienda" || after.serviceType === "encomienda" || after.isEncomienda === true ||
        (after.favorType === "mandado" && !(Array.isArray(after.mandadoStops) && after.mandadoStops.length));
      const codeLine = after.verificationCode && !after.isTrip && !isEncomiendaOrder
        ? ` Tu código de entrega es ${after.verificationCode}.`
        : "";
      const body = ((after.isFavor || after.isTrip)
        ? `Tu servicio fue asignado a ${driverName} y está en camino.`
        : `Tu pedido fue asignado a ${driverName}.`) + codeLine;

      await sendPush(clientTokens, {
        title,
        body
      }, { 
        tag: `order-active-${orderId}`, 
        persistent: "true", 
        ongoing: true, 
        requireInteraction: true,
        url: `#/pedido/${orderId}` 
      });
    }

    // A completed order that changes status again (cancelled afterwards, fixed by the admin)
    // gives its fee back to the driver.
    if (before.status === "completed" && after.status !== "completed") {
      try {
        await reverseCompletedOrder({ orderId, newStatus: after.status });
      } catch (err) {
        logger.error(`Error reversing order ${orderId} in the driver's account:`, err);
      }
    }

    // Status change notifications (ONLY when the order status itself changes, not just queue rotation)
    if (before.status !== after.status) {
      switch (after.status) {
        case "confirmed": {
          // Notify client: differentiate between normal commerce orders vs GoFavores / Mandados
          const clientTokens = await getUserTokens(after.userId);
          if (!after.isFavor && !after.isTrip) {
            const prepMin = Number(after.preparationTimeMinutes);
            await sendPush(clientTokens, {
              title: storeOf(after) ? `${storeOf(after)} aceptó tu pedido` : "Tu pedido fue aceptado",
              body: prepMin > 0
                ? `Lo están preparando. Estará listo en unos ${prepMin} min.`
                : "Lo están preparando. Te avisamos cuando salga."
            }, {
              tag: `order-${orderId}`, 
              persistent: "true", 
              ongoing: true, 
              requireInteraction: true,
              url: `#/pedido/${orderId}` 
            });
          }
          break;
        }
        case "ready": {
          // If the order has a targeted driver (exclusive queue offer), do NOT broadcast to all drivers
          if (after.queueTargetDriverId) {
            logger.info(`[FCM] Order ${orderId} has exclusive target driver ${after.queueTargetDriverId}. Skipping general broadcast.`);
            break;
          }

          // ── SERVER-SIDE DISPATCH (via shared helper) ──────────────────────
          await serverSideDispatch(orderId, after);
          // ─────────────────────────────────────────────────────────────────


          // Notify client: "Un delivery está yendo a buscarlo"
          const clientTokens2 = await getUserTokens(after.userId);
          // Con productos por peso, el aviso de "listo" trae el total que quedó al pesar
          const weighedLine = after.hasWeighedItems && after.weighPending === false
            ? `Ya lo pesaron: total final $${money(after.total)}. `
            : "";
          await sendPush(clientTokens2, {
            title: "Tu pedido está listo",
            body: weighedLine + (storeOf(after) ? `${storeOf(after)} ya lo tiene. Estamos asignando un repartidor.` : "Estamos asignando un repartidor.")
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}` });

          // Manual Assignment only: Geohash & Distance Auto-Assignment algorithm is disabled.
          // Delivery drivers always claim orders manually from their panel.

          // Targeted Co-pickup Scan
          const coPickupDrivers = new Set();
          const coPickupTokens = [];

          try {
            // Find active orders (confirmed or ready) from the same commerce that have a driver assigned
            if (!after.comercioId) throw Object.assign(new Error("sin comercio"), { skip: true });
            const assignedOrdersSnap = await db.collection("orders")
              .where("comercioId", "==", after.comercioId)
              .where("status", "in", ["confirmed", "ready"])
              .get();

            for (const orderDoc of assignedOrdersSnap.docs) {
              const oData = orderDoc.data();
              if (oData.driverId && !coPickupDrivers.has(oData.driverId)) {
                // Verify driver is online and has space (exactly 1 active simple order)
                const driverDoc = await db.collection("users").doc(oData.driverId).get();
                if (driverDoc.exists) {
                  const dData = driverDoc.data();
                  const isOnline = dData.isOnline === true;
                  const isDel = dData.isDelivery === true || dData.isDelivery === "true" || dData.role === "delivery";
                  
                  if (isOnline && isDel) {
                    const activeOrdersCountSnap = await db.collection("orders")
                      .where("driverId", "==", oData.driverId)
                      .where("status", "in", ["confirmed", "ready", "delivering"])
                      .get();

                    if (activeOrdersCountSnap.size === 1) {
                      coPickupDrivers.add(oData.driverId);
                      const userTokens = await getUserTokens(oData.driverId);
                      coPickupTokens.push(...userTokens);

                      // Send targeted push with tag 'co-pickup-${orderId}' as requested
                      await sendPush(userTokens, {
                        title: `Otro pedido listo en ${after.comercioName || "el comercio"}`,
                        body: "Ya estás yendo para ahí: sumalo a tu ruta y retirá los dos juntos."
                      }, { tag: `co-pickup-${orderId}`, url: "#/delivery" });
                    }
                  }
                }
              }
            }
          } catch (err) {
            if (!err.skip) logger.error("Error in co-pickup targeted scan:", err);
          }

          break;
        }

        case "delivering": {
          // Notify client: "El pedido está en camino" + Delivery Code
          const clientTokens3 = await getUserTokens(after.userId);
          const delCode = after.verificationCode || "----";
          await sendPush(clientTokens3, {
            title: "Tu pedido está en camino 🛵",
            body: [
              `${firstName(after.driverName) || "Tu repartidor"} lo lleva${storeOf(after) ? ` desde ${storeOf(after)}` : ""}.`,
              after.verificationCode ? `Código de entrega: ${delCode}` : ""
            ].filter(Boolean).join(" ")
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}`, persistent: "true" });
          break;
        }
        case "completed": {
          // 1. Notify client: "Pedido entregado"
          const clientTokens4 = await getUserTokens(after.userId);
          await sendPush(clientTokens4, {
            title: "Pedido entregado",
            body: "¡Que lo disfrutes! Tocá para calificar la entrega."
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}`, persistent: "true" });

           if (after.driverId) {
            // Driver's account: the order's net fee and, on the Nth order of the day, the daily
            // fee (functions/ledger.js). Idempotent, so a retried trigger never charges twice.
            try {
              await applyCompletedOrder({ orderId, order: after, eventId: event.id });
            } catch (err) {
              logger.error(`Error booking order ${orderId} to driver ${after.driverId}:`, err);
            }

            // Immediately check for any unassigned orders that were stuck because all drivers were busy
            try {
              const pendingUnassignedSnap = await db.collection("orders")
                .where("status", "in", ["pending", "confirmed", "ready"])
                .get();

              for (const pendingDoc of pendingUnassignedSnap.docs) {
                const pData = pendingDoc.data();
                if (!pData.driverId && !pData.queueTargetDriverId) {
                  logger.info(`[Auto-Redispatch] Driver ${after.driverId} completed order ${orderId}. Re-running dispatch for waiting order ${pendingDoc.id}`);
                  await serverSideDispatch(pendingDoc.id, pData);
                }
              }
            } catch (rErr) {
              logger.error("Error running auto-redispatch on order completion:", rErr);
            }
          }

          // 3. Process Customer loyalty points, completedOrdersCount, referral system and challenges
          if (after.userId) {
            try {
              const customerRef = db.collection("users").doc(after.userId);
              const customerSnap = await customerRef.get();
              
              if (customerSnap.exists) {
                const customerData = customerSnap.data();
                const currentCount = customerData.completedOrdersCount || 0;
                const nextOrderCount = currentCount + 1;
                
                // Fetch settings/global to get pointsPerDollar and referralPoints settings
                const globalSnap = await db.collection("settings").doc("global").get();
                const globalData = globalSnap.exists ? globalSnap.data() : {};
                
                const pointsPerDollar = globalData.pointsPerDollar !== undefined ? Number(globalData.pointsPerDollar) : 0.01;
                const referralPoints = globalData.referralPoints !== undefined ? Number(globalData.referralPoints) : 500;
                
                // Determine multiplier
                let multiplier = 1.0;
                if (currentCount >= 16) {
                  multiplier = 1.5;
                } else if (currentCount >= 6) {
                  multiplier = 1.25;
                }
                
                // Calculate standard points earned from order subtotal (or total)
                const baseAmount = after.subtotal || after.total || 0;
                const pointsEarned = Math.floor(baseAmount * pointsPerDollar * multiplier);
                
                logger.info(`[Points] Customer ${after.userId} earned ${pointsEarned} points (Multiplier: ${multiplier}x, Base: ${baseAmount}, Rate: ${pointsPerDollar})`);
                
                // Create a batch for transactional consistency
                const batch = db.batch();
                
                // Update customer points and completedOrdersCount
                batch.update(customerRef, {
                  points: FieldValue.increment(pointsEarned),
                  completedOrdersCount: FieldValue.increment(1)
                });
                
                // Update order with pointsEarned and appliedMultiplier (separate update to avoid re-triggering status notifications)
                await db.collection("orders").doc(orderId).update({
                  pointsEarned: pointsEarned,
                  appliedMultiplier: multiplier
                });
                
                // Log standard points transaction
                if (pointsEarned > 0) {
                  const ptsTransRef = db.collection("points_transactions").doc();
                  batch.set(ptsTransRef, {
                    userId: after.userId,
                    type: "purchase_points",
                    points: pointsEarned,
                    description: `Puntos ganados por tu compra en ${after.comercioName || "Comercio"}.`,
                    createdAt: FieldValue.serverTimestamp()
                  });
                }
                
                // Process Referral welcome bonus
                if (nextOrderCount === 1 && customerData.referredBy && !customerData.referredRewardGranted) {
                  const refCode = customerData.referredBy;
                  const referrerSnap = await db.collection("users").where("referralCode", "==", refCode).limit(1).get();
                  
                  if (!referrerSnap.empty) {
                    const referrerDoc = referrerSnap.docs[0];
                    const referrerUid = referrerDoc.id;
                    
                    logger.info(`[Referral] Rewarding first-order bonus of ${referralPoints} pts to referrer ${referrerUid} and customer ${after.userId}`);
                    
                    // Reward referrer
                    batch.update(db.collection("users").doc(referrerUid), {
                      points: FieldValue.increment(referralPoints)
                    });
                    
                    // Reward customer
                    batch.update(customerRef, {
                      points: FieldValue.increment(referralPoints),
                      referredRewardGranted: true
                    });
                    
                    // Note on order (separate update, not in batch, to avoid re-triggering status change handler)
                    await db.collection("orders").doc(orderId).update({
                      referredRewardGranted: true,
                      referralBonusAmount: referralPoints
                    });
                    
                    // Log transactions
                    const refTransRef = db.collection("points_transactions").doc();
                    batch.set(refTransRef, {
                      userId: referrerUid,
                      type: "referral_bonus",
                      points: referralPoints,
                      description: "¡Tu amigo completó su primer pedido! Bono de referido concedido.",
                      createdAt: FieldValue.serverTimestamp()
                    });
                    
                    const custTransRef = db.collection("points_transactions").doc();
                    batch.set(custTransRef, {
                      userId: after.userId,
                      type: "referred_welcome",
                      points: referralPoints,
                      description: "¡Bono de bienvenida por usar el código de referido de un amigo!",
                      createdAt: FieldValue.serverTimestamp()
                    });
                  }
                }
                
                // Process Weekly challenges
                const getWeekIdentifier = (date) => {
                  const d = date ? new Date(date) : new Date();
                  d.setHours(0,0,0,0);
                  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
                  const yearStart = new Date(d.getFullYear(), 0, 1);
                  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
                  return `${d.getFullYear()}-W${weekNo}`;
                };

                const currentWeek = getWeekIdentifier(new Date());
                let challengesDocs = [];
                const challengesSnap = await customerRef.collection("challenges").get();
                
                if (challengesSnap.empty) {
                  const configuredChallenges = globalData.weeklyChallenges || [
                    { id: 'weekly_3', title: 'Desafío Bronce', description: 'Completá 3 pedidos esta semana', target: 3, pointsReward: 150 },
                    { id: 'weekly_5', title: 'Desafío Plata', description: 'Completá 5 pedidos esta semana', target: 5, pointsReward: 300 },
                    { id: 'weekly_10', title: 'Desafío Oro', description: 'Completá 10 pedidos esta semana', target: 10, pointsReward: 600 }
                  ];
                  for (const ch of configuredChallenges) {
                    const defaultChallenge = {
                      id: ch.id,
                      title: ch.title,
                      description: ch.description || `Completá ${ch.target} pedidos esta semana`,
                      target: Number(ch.target),
                      progress: 0,
                      pointsReward: Number(ch.pointsReward),
                      completed: false,
                      weekIdentifier: currentWeek
                    };
                    batch.set(customerRef.collection("challenges").doc(ch.id), defaultChallenge);
                    challengesDocs.push({ id: ch.id, data: () => defaultChallenge });
                  }
                } else {
                  challengesDocs = challengesSnap.docs;
                }

                challengesDocs.forEach(cDoc => {
                  const challenge = cDoc.data ? cDoc.data() : cDoc;
                  
                  let progress = challenge.progress || 0;
                  let completed = challenge.completed || false;
                  
                  if (challenge.weekIdentifier !== currentWeek) {
                    progress = 0;
                    completed = false;
                  }

                  if (!completed) {
                    const currentProgress = progress + 1;
                    const isCompleted = currentProgress >= challenge.target;
                    
                    const updateData = {
                      progress: currentProgress,
                      weekIdentifier: currentWeek,
                      completed: isCompleted
                    };

                    if (isCompleted) {
                      updateData.completedAt = FieldValue.serverTimestamp();
                      
                      logger.info(`[Challenges] Challenge ${challenge.id} completed by ${after.userId}. Awarding ${challenge.pointsReward} pts.`);

                      // Award challenge points
                      batch.update(customerRef, {
                        points: FieldValue.increment(challenge.pointsReward)
                      });

                      // Log challenge transaction
                      const challengeTransRef = db.collection("points_transactions").doc();
                      batch.set(challengeTransRef, {
                        userId: after.userId,
                        type: "challenge_completion",
                        points: challenge.pointsReward,
                        description: `Completaste el desafío semanal: ${challenge.title}`,
                        createdAt: FieldValue.serverTimestamp()
                      });
                    }

                    batch.update(customerRef.collection("challenges").doc(challenge.id), updateData);
                  }
                });
                
                await batch.commit();
              }
            } catch (err) {
              logger.error(`Error processing loyalty points and count for customer ${after.userId}:`, err);
            }
          }
          break;
        }
        case "cancelled": {
          // Notify client: "Pedido cancelado"
          const clientTokens5 = await getUserTokens(after.userId);
          let cancelMsg = "Si tenés dudas, escribinos desde Ayuda en la app.";
          
          if (after.cancelReason && after.cancelReason.toLowerCase().includes("repartidor")) {
            cancelMsg = "No había repartidores disponibles en tu zona. Probá de nuevo en un rato.";
          } else if (after.cancelReason) {
            cancelMsg = `Motivo: ${after.cancelReason}`;
          }

          if (after.cancelledBy === "system" && after.cancelReason && after.cancelReason.toLowerCase().includes("comercio no acept")) {
            cancelMsg = `${after.comercioName || "El comercio"} no confirmó tu pedido a tiempo, así que lo cancelamos. No se te cobra nada.`;
          }

          await sendPush(clientTokens5, {
            title: "Tu pedido fue cancelado",
            body: cancelMsg
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}` });

          // Al comercio también, salvo que lo haya cancelado él mismo: que sepa qué pasó y por qué
          if (after.comercioId && !after.isFavor && !after.isTrip && after.cancelledBy !== "comercio") {
            try {
              const comSnap = await db.collection("comercios").doc(after.comercioId).get();
              const ownerId = comSnap.exists ? comSnap.data().ownerId : null;
              if (ownerId) {
                const byWho = after.cancelledBy === "system" ? "Se canceló automáticamente" : (after.cancelledBy === "client" || after.cancelledBy === "cliente" ? "El cliente lo canceló" : "Fue cancelado");
                const reason = after.cancelReason ? ` Motivo: ${after.cancelReason}` : "";
                await sendPush(await getUserTokens(ownerId), {
                  title: `Pedido #${after.orderId || ""} cancelado`,
                  body: `${byWho}.${reason}`
                }, { tag: `order-cancel-${orderId}`, url: `#/mi-comercio/${after.comercioId}/orders`, channelId: "store_orders" });
              }
            } catch (e) {
              logger.warn(`[Cancel] No se pudo avisar al comercio del pedido ${orderId}:`, e);
            }
          }

          // Restore stock for cancelled orders
          try {
            if (Array.isArray(after.items) && after.items.length > 0) {
              const batch = db.batch();
              let hasStockRestoration = false;
              for (const item of after.items) {
                if (item.product && item.product.id && item.product.stockMode === 'limited') {
                  const cId = item.product.comercioId || after.comercioId || after.commerceId;
                  if (cId) {
                    const pRef = db.collection("comercios").doc(cId).collection("products").doc(item.product.id);
                    batch.update(pRef, { stockQuantity: FieldValue.increment(item.qty || 1) });
                    hasStockRestoration = true;
                  }
                }
              }
              if (hasStockRestoration) {
                await batch.commit();
                logger.info(`Stock restored successfully for cancelled order ${orderId}`);
              }
            }
          } catch (err) {
            logger.error(`Error restoring stock for cancelled order ${orderId}:`, err);
          }
          break;
        }
      }
    }
    
    // Single consolidated order modification notification (items or total changed)
    if (before.status === after.status && 
        (JSON.stringify(before.items) !== JSON.stringify(after.items) || before.total !== after.total || before.subtotal !== after.subtotal)) {
      const clientTokens = await getUserTokens(after.userId);
      if (clientTokens.length > 0) {
        const modifierName = after.isFavor ? "El repartidor" : (after.comercioName || "El comercio");
        const formatPrice = (val) => `$${Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        await sendPush(clientTokens, {
          title: "Actualizaron tu pedido",
          body: `${modifierName} cambió el pedido #${orderNum}. Nuevo total: ${formatPrice(after.total)}`
        }, { 
          tag: `order-${orderId}`, 
          persistent: "true", 
          ongoing: true, 
          requireInteraction: true,
          url: `#/pedido/${orderId}` 
        });
      }
    }

    // Sorteo: chances por pedido entregado. La app cierra los pedidos con 'completed';
    // 'delivered' solo lo escribe la entrega sin conexión. Repetir no suma dos veces (orderIds).
    const GIVEAWAY_DONE = ['completed', 'delivered'];
    if (GIVEAWAY_DONE.includes(after.status) && !GIVEAWAY_DONE.includes(before.status)) {
      try {
        await grantGiveawayOrderChances(orderId, after, orderNum);
      } catch (gErr) {
        logger.error('[Giveaway] Error adding order chances:', gErr);
      }
    }

  } catch (err) {
    logger.error("Error in onOrderStatusChange:", err);
  }
});

/**
 * Helper: Distance calculation (Haversine)
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Lluvia en Magdalena. Dos fuentes:
 *  - Open-Meteo en el pueblo mismo (modelo, cada 15 min). Se usa `precipitation`
 *    (lluvia + chaparrones): en tormenta casi todo viene como `showers`.
 *  - METAR del aeropuerto de La Plata (SADL, ~40 km): observación real, pero a veces
 *    pasa horas sin reportar, así que sólo cuenta si tiene menos de 90 min.
 * checkWeatherPeriodic es el único que escribe settings/weather; los pedidos lo leen.
 */
const MAGDALENA_COORDS = { lat: -35.0811, lng: -57.5146 };
// Llovizna moderada/densa, lluvia, chaparrones y tormentas (95/96/99). 51 y 56 (llovizna
// débil) quedan afuera solos: sólo cuentan si La Plata también reporta llovizna o lluvia.
const RAIN_WEATHER_CODES = new Set([53, 55, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const RAIN_MIN_MM_15MIN = 0.2;
const METAR_MAX_AGE_MIN = 90;
// Para apagar el recargo hacen falta dos revisiones seguidas sin lluvia (20 min), así
// no se prende y apaga en cada claro de una tormenta.
const RAIN_OFF_AFTER_DRY_CHECKS = 2;
// Si la revisión programada dejó de correr, los pedidos consultan en vivo.
const RAIN_STATE_STALE_MS = 40 * 60 * 1000;
const RAIN_PUSH_MIN_GAP_MS = 90 * 60 * 1000;

async function fetchJsonWithTimeout(url, ms = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readOpenMeteoMagdalena() {
  const d = await fetchJsonWithTimeout(
    `https://api.open-meteo.com/v1/forecast?latitude=${MAGDALENA_COORDS.lat}&longitude=${MAGDALENA_COORDS.lng}&current=precipitation,rain,showers,weather_code`
  );
  const c = d?.current;
  if (!c || c.weather_code === undefined) throw new Error("respuesta sin 'current'");
  const mm = Number(c.precipitation) || 0;
  const code = Number(c.weather_code) || 0;
  return {
    mm,
    code,
    time: c.time || null,
    wet: mm >= RAIN_MIN_MM_15MIN || RAIN_WEATHER_CODES.has(code),
    light: mm > 0 || code === 51 || code === 56,
  };
}

// Códigos METAR: RA lluvia, SH chaparrón, GR/GS granizo, DZ llovizna, TS tormenta.
// "-" = débil, "+" = fuerte, "VC..." = en las cercanías (no sobre el aeropuerto).
function parseMetarWeather(wxString) {
  const tokens = String(wxString || "").split(/\s+/).filter((t) => t && !t.startsWith("VC"));
  const wet = tokens.some((t) => /RA|SH|GR|GS/.test(t) || /^\+?DZ/.test(t));
  const light = tokens.some((t) => t.includes("DZ"));
  return { wet, light };
}

async function readMetarLaPlata() {
  const list = await fetchJsonWithTimeout("https://aviationweather.gov/api/data/metar?ids=SADL&format=json&hours=3");
  const latest = (Array.isArray(list) ? list : []).sort((a, b) => b.obsTime - a.obsTime)[0];
  if (!latest) return null;
  const ageMin = Math.round((Date.now() / 1000 - latest.obsTime) / 60);
  if (ageMin > METAR_MAX_AGE_MIN) return null;
  return { wx: latest.wxString || "", ageMin, ...parseMetarWeather(latest.wxString) };
}

/**
 * Consulta las dos fuentes y dice si llueve ahora. `unknown` = ninguna respondió;
 * en ese caso quien llama mantiene el estado anterior (nunca apaga por un error).
 */
async function detectRainInMagdalena() {
  const [om, metar] = await Promise.allSettled([readOpenMeteoMagdalena(), readMetarLaPlata()]);
  const omData = om.status === "fulfilled" ? om.value : null;
  const metarData = metar.status === "fulfilled" ? metar.value : null;
  const errors = [];
  if (om.status === "rejected") errors.push(`open-meteo: ${om.reason?.message || om.reason}`);
  if (metar.status === "rejected") errors.push(`metar: ${metar.reason?.message || metar.reason}`);

  const unknown = !omData && !metarData;
  const wet = !unknown && Boolean(
    omData?.wet || metarData?.wet || (omData?.light && metarData?.light)
  );
  const result = { wet, unknown, openMeteo: omData, metar: metarData, errors };
  logger.info(`[Lluvia] ${unknown ? "SIN DATOS" : wet ? "LLUEVE" : "no llueve"}`, {
    openMeteo: omData, metar: metarData, errors,
  });
  return result;
}

/**
 * Lo que vale para cobrar en modo automático. Lee lo que dejó la revisión programada;
 * si está viejo (la revisión dejó de correr), consulta en vivo sin escribir nada.
 */
async function resolveAutoRain(weatherData) {
  const stamp = weatherData?.checkedAt || weatherData?.updatedAt;
  const checkedMs = stamp?.toDate ? stamp.toDate().getTime() : 0;
  const previous = weatherData?.isRaining === true;
  if (Date.now() - checkedMs < RAIN_STATE_STALE_MS) return previous;
  logger.warn("[Lluvia] settings/weather desactualizado; consulto en vivo", { checkedMs });
  const live = await detectRainInMagdalena();
  return live.unknown ? previous : live.wet;
}

function getArgentinaTime() {
  const now = new Date();
  try {
    const options = { timeZone: 'America/Argentina/Buenos_Aires', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    const map = {};
    parts.forEach(p => { if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10); });
    const hours = (map.hour || 0) % 24;
    const minutes = map.minute || 0;
    const day = map.day || 1;
    const month = (map.month || 1) - 1;
    const year = map.year || 2026;
    return new Date(year, month, day, hours, minutes, map.second || 0);
  } catch (e) {
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * -3));
  }
}

function isScheduleActive(config) {
  if (!config || !config.enabled) return false;
  
  const now = getArgentinaTime();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  try {
    const [startH, startM] = (config.start || '00:00').split(':').map(Number);
    const [endH, endM] = (config.end || '06:00').split(':').map(Number);
    
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (endMinutes < startMinutes) {
      // Overnight schedule, e.g. 23:00 to 06:00
      return currentTime >= startMinutes || currentTime <= endMinutes;
    } else if (startMinutes === endMinutes) {
      return true;
    } else {
      // Normal schedule, e.g. 12:00 to 15:00
      return currentTime >= startMinutes && currentTime <= endMinutes;
    }
  } catch (e) {
    return false;
  }
}

function calculateScheduleSurcharge(config, baseValue) {
  if (!config || !config.enabled) return 0;
  
  try {
    const isActive = isScheduleActive(config);
    if (isActive) {
      if (config.type === 'fixed') return config.value;
      if (config.type === 'percentage') return baseValue * (config.value / 100);
    }
  } catch (e) {
    logger.error('Error calculating schedule surcharge:', e);
  }
  return 0;
}


// ═══════════════════════════════════════════════════
// BACKEND-DRIVEN CHECKOUT & ORDER CREATION (Pilar 1)
// ═══════════════════════════════════════════════════
// Makes order creation safe to retry. If the connection drops after the server created the
// order, the app used to show "Error de conexión" and the retry created a SECOND order. The app
// now sends a clientRequestId that stays the same across retries of one checkout; the first
// successful response is stored and replayed to any retry with that id.
function withOrderIdempotency(handler) {
  return async (req, res) => {
    const requestId = req.body && req.body.clientRequestId;
    const authHeader = req.headers.authorization || "";
    if (req.method !== "POST" || typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId) || !authHeader.startsWith("Bearer ")) {
      return handler(req, res);
    }

    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1])).uid;
    } catch (err) {
      return handler(req, res); // the handler answers 401
    }

    const ref = db.collection("orderRequests").doc(`${uid}_${requestId}`);
    try {
      await ref.create({ uid, status: "processing", createdAt: FieldValue.serverTimestamp() });
    } catch (err) {
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : null;
      if (data && data.status === "done" && data.response) {
        logger.info(`[Idempotency] Replaying stored response for request ${requestId} (uid ${uid}).`);
        return res.status(200).json(data.response);
      }
      const startedMs = data && data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0;
      if (data && data.status === "processing" && Date.now() - startedMs < 2 * 60 * 1000) {
        return res.status(409).json({ error: "Tu pedido ya se está procesando. Esperá unos segundos.", inProgress: true });
      }
      // A stale claim (the instance died mid-request): take it over.
      await ref.set({ uid, status: "processing", createdAt: FieldValue.serverTimestamp() });
    }

    let statusCode = 200;
    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);
    res.status = (code) => { statusCode = code; return originalStatus(code); };
    res.json = (body) => {
      const settle = statusCode >= 200 && statusCode < 300
        ? ref.set({ status: "done", response: body, finishedAt: FieldValue.serverTimestamp() }, { merge: true })
        : ref.delete();
      // Awaited before answering: on Cloud Run the CPU is throttled once the response is sent.
      return settle.catch(e => logger.warn("[Idempotency] Could not settle request:", e)).then(() => originalJson(body));
    };

    try {
      await handler(req, res);
    } catch (err) {
      await ref.delete().catch(() => {});
      throw err;
    }
  };
}

// Shipping fee for a commerce order. Must stay identical to calculateDynamicFee() +
// getQuickDistance() in src/utils/geo.js: the server used a cheaper formula (no road factor,
// no distance tiers, other defaults), so the price the customer saw was never really checked.
function computeDeliveryFee(straightKm, settings) {
  const distanceKm = straightKm * 1.25; // road correction factor, as in the app

  const rules = Array.isArray(settings.deliveryDistanceRules) ? settings.deliveryDistanceRules : [];
  const tier = [...rules].sort((a, b) => b.limitKm - a.limitKm).find(r => distanceKm >= r.limitKm);
  if (tier) return Math.ceil(tier.price / 10) * 10;

  const fixedKm = Number(settings.deliveryFixedThresholdKm) || 0;
  const fixedPrice = Number(settings.deliveryFixedThresholdPrice) || 0;
  if (fixedKm > 0 && fixedPrice > 0 && distanceKm >= fixedKm) return Math.ceil(fixedPrice / 10) * 10;

  const base = Number(settings.deliveryBasePrice) || 1500;
  const perKm = Number(settings.deliveryPricePerKm) || 300;
  const min = Number(settings.deliveryMinPrice) || 1500;
  return Math.ceil(Math.max(min, base + distanceKm * perKm) / 10) * 10;
}

// Encomiendas: with their own rate on (Admin → Tarifas de Logística) they skip the general prices
// and the distance tiers. Must stay identical to calculateEncomiendaFee() in src/utils/geo.js.
function computeEncomiendaFee(straightKm, settings) {
  const rate = settings.encomiendaPricing;
  if (!rate || !rate.enabled) return computeDeliveryFee(straightKm, settings);
  const distanceKm = straightKm * 1.25; // road correction factor, as in the app
  const calculated = (Number(rate.basePrice) || 0) + distanceKm * (Number(rate.pricePerKm) || 0);
  return Math.ceil(Math.max(Number(rate.minPrice) || 0, calculated) / 10) * 10;
}

// Encomienda without coordinates: the minimum of the rate in use.
function encomiendaMinFee(settings) {
  const rate = settings.encomiendaPricing;
  if (rate && rate.enabled) return Math.ceil((Number(rate.minPrice) || Number(rate.basePrice) || 0) / 10) * 10;
  return Number(settings.deliveryMinPrice) || 1500;
}

// A tip only ever adds to the total: negative or absurd values from the app are dropped.
function sanitizeTip(tip) {
  const value = Math.round(Number(tip) || 0);
  return value > 0 && value <= 1000000 ? value : 0;
}

// Unit price of a cart line computed from the product as stored, never from prices sent by
// the app (those could be edited, even negative). Mirrors getItemUnitPrice() in
// src/state.js: an option in 'replace' mode sets the base, the rest add on top. Options
// that aren't in the product's own groups (shared flavors) carry no price.
// Transferencia: en la app se elige "mercadopago" (se muestra como Transferencia)
const isTransferPayment = (method) => /mercadopago|transfer/i.test(String(method || ""));
/** Precio con el recargo por transferencia del producto (p. ej. cigarrillos +10% en los kioscos), redondeado al peso */
function withTransferSurcharge(price, pData, method) {
  const pct = Number(pData && pData.transferSurcharge) || 0;
  return isTransferPayment(method) && pct > 0 ? Math.round(price * (1 + pct / 100)) : price;
}

function secureUnitPrice(pData, clientOptions) {
  const options = Array.isArray(clientOptions) ? clientOptions : [];
  const groups = Array.isArray(pData.optionsGroups) ? pData.optionsGroups : [];
  const norm = (v) => String(v || "").trim().toLowerCase();

  const resolved = options.map(o => {
    const group = groups.find(g => norm(g.name) === norm(o && o.groupName));
    const stored = group && Array.isArray(group.options)
      ? group.options.find(opt => norm(opt.name) === norm(o && o.name))
      : null;
    return {
      price: stored ? Math.max(0, Number(stored.price) || 0) : 0,
      qty: Math.min(99, Math.max(1, Number(o && o.qty) || 1)),
      replace: Boolean(group && group.priceMode === "replace" && stored)
    };
  });

  const replaceOption = resolved.find(o => o.replace);
  const base = replaceOption ? replaceOption.price : (Number(pData.price) || 0);
  const extras = resolved.reduce((sum, o) => (o === replaceOption ? sum : sum + o.price * o.qty), 0);
  // Por peso: base y opciones son por kilo, y la unidad del carrito es un paso (functions/weight.js)
  return isSoldByWeight(pData) ? stepPrice(base + extras, pData) : base + extras;
}

exports.createOrder = onRequest({ cors: true, maxInstances: 15, minInstances: 1 }, withOrderIdempotency(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const token = authHeader.split("Bearer ")[1];
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  const uid = decodedToken.uid;
  const { cart, address, addressNotes, deliveryCoords, paymentMethod, redeemedPoints, totalDelivery, bundleId, tip, couponCode, allowReplacement, isScheduled, scheduledDate, scheduledTime, deliveryType, source, isDirectOrder, guestName, guestPhone } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "El carrito está vacío" });
  }

  const isTakeaway = deliveryType === 'takeaway' || deliveryType === 'retiro';

  try {
    // Verify online delivery drivers availability (only required for home delivery)
    if (!isTakeaway) {
      const onlineDriversSnap = await db.collection("users")
        .where("isOnline", "==", true)
        .get();

      const hasOnlineDriver = onlineDriversSnap.docs.some(doc => {
        const d = doc.data();
        const role = (d.role || "").toLowerCase();
        return d.isDelivery === true || d.isDelivery === "true" || ["delivery", "driver", "repartidor", "chofer"].includes(role);
      });

      if (!hasOnlineDriver) {
        return res.status(400).json({ error: "No es posible realizar tu pedido en este momento porque no hay repartidores conectados en la zona." });
      }
    }

    // Fetch active offers for the cart's commerce IDs (done before transaction to prevent Firestore errors)
    const commerceIds = [...new Set(cart.map(item => item.comercioId))];
    let activeOffers = [];
    try {
      // Bulletproof: Fetch all active offers to avoid composite index errors, then filter in memory
      const offersQuerySnap = await db.collection("offers")
        .where("active", "==", true)
        .get();
      const allActiveOffers = offersQuerySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      activeOffers = allActiveOffers.filter(o => o.comercioId && commerceIds.includes(o.comercioId));
      logger.info(`Fetched ${activeOffers.length} active offers for commerce IDs: ${commerceIds.join(", ")}`);
    } catch (err) {
      logger.error("Error fetching active offers for checkout:", err);
    }

    // Lluvia en modo automático: lo que dejó checkWeatherPeriodic (fuera de la transacción
    // porque puede tener que consultar en vivo).
    const weatherDocSnap = await db.collection("settings").doc("weather").get();
    const autoIsRaining = await resolveAutoRain(weatherDocSnap.exists ? weatherDocSnap.data() : {});

    // Start transactional order creation
    const result = await db.runTransaction(async (transaction) => {
      // 1. Fetch user data to verify points
      const userRef = db.collection("users").doc(uid);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("Usuario no encontrado");
      const userData = userSnap.data();

      // Enforce phone requirements
      if (!userData.phone || userData.phone.trim() === "") {
        throw new Error("El celular de contacto es obligatorio");
      }
      if (userData.phoneVerified !== true) {
        throw new Error("El número de teléfono no ha sido verificado");
      }

      // Fetch global settings for deliveryCost, deliveryRainSurcharge, etc.
      const globalSettingsSnap = await transaction.get(db.collection("settings").doc("global"));
      const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : {};

      const rainMode = globalSettings.rainMode || "auto";
      let isRaining = false;
      if (rainMode === "on") {
        isRaining = true;
      } else if (rainMode === "off") {
        isRaining = false;
      } else {
        isRaining = autoIsRaining;
      }

      const baseRainSurcharge = globalSettings.deliveryRainSurcharge !== undefined ? globalSettings.deliveryRainSurcharge : 300;
      const activeRainSurcharge = isRaining ? baseRainSurcharge : 0;

      const userPoints = userData.points || 0;
      if (redeemedPoints > 0 && userPoints < redeemedPoints) {
        throw new Error("Puntos insuficientes para redimir");
      }

      // Calculate GoPoints discount: convert points to currency using dollarPerPoint exchange rate
      const dollarPerPoint = globalSettings.dollarPerPoint !== undefined ? Number(globalSettings.dollarPerPoint) : 1.00;
      const calculatedDiscount = redeemedPoints > 0 ? redeemedPoints * dollarPerPoint : 0;

      // Validate Coupon securely inside transaction
      let couponData = null;
      let couponRef = null;
      if (couponCode) {
        const cleanCouponCode = couponCode.toUpperCase().trim();
        couponRef = db.collection("coupons").doc(cleanCouponCode);
        const couponSnap = await transaction.get(couponRef);
        if (!couponSnap.exists) {
          throw new Error("El cupón ingresado no existe.");
        }
        couponData = couponSnap.data();
        if (couponData.active !== true) {
          throw new Error("El cupón ingresado no está activo.");
        }
        if (typeof couponData.remaining === 'number' && couponData.remaining <= 0) {
          throw new Error("Este cupón ya no tiene usos disponibles.");
        }
        if (couponData.expirationDate) {
          const expDate = new Date(couponData.expirationDate + "T23:59:59-03:00");
          if (Date.now() > expDate.getTime()) {
            throw new Error("Este cupón ha expirado.");
          }
        }

        // Single-use per user check!
        const redemptionRef = couponRef.collection("redemptions").doc(uid);
        const redemptionSnap = await transaction.get(redemptionRef);
        if (redemptionSnap.exists) {
          throw new Error("Ya has utilizado este cupón anteriormente.");
        }

        // Validate merchant coupon: cart must contain at least one item from this merchant
        if (couponData.ownerId && couponData.ownerId !== 'admin') {
          const merchantId = couponData.ownerId;
          const hasMerchantItems = cart.some(item => item.comercioId === merchantId);
          if (!hasMerchantItems) {
            throw new Error(`Este cupón es exclusivo para productos de ${couponData.comercioName || 'este comercio'}.`);
          }
        }
      }

      // 2. Fetch app settings to get lastOrderId
      const settingsRef = db.collection("settings").doc("settings");
      const settingsSnap = await transaction.get(settingsRef);
      let lastId = settingsSnap.exists && settingsSnap.data().lastOrderId ? settingsSnap.data().lastOrderId : 0;

      // Group items by commerce
      const grouped = {};
      cart.forEach(item => {
        const cId = item.comercioId;
        if (!grouped[cId]) {
          grouped[cId] = {
            comercioName: item.comercioName,
            items: []
          };
        }
        grouped[cId].items.push(item);
      });

      const commerceEntries = Object.entries(grouped);
      const isBundle = commerceEntries.length > 1;
      const sharedVerificationCode = Math.floor(1000 + Math.random() * 9000).toString();

      // Read commerce and product docs for validation
      const commerceDataMap = {};
      const productDocsMap = {};

      for (const [cId, g] of commerceEntries) {
        const cSnap = await transaction.get(db.collection("comercios").doc(cId));
        if (!cSnap.exists) throw new Error(`Comercio ${g.comercioName} no encontrado`);
        commerceDataMap[cId] = cSnap.data() || {};

        for (const item of g.items) {
          const prodRef = db.collection("comercios").doc(cId).collection("products").doc(item.product.id);
          const pSnap = await transaction.get(prodRef);
          if (!pSnap.exists) throw new Error(`Producto ${item.product.name} no encontrado`);
          productDocsMap[prodRef.path] = pSnap;
        }
      }

      // Lo pausado o agotado no entra en ningún comercio: la tienda muestra el menú guardado en el
      // teléfono mientras se actualiza, así que un producto recién pausado puede llegar al carrito
      for (const [cId, g] of commerceEntries) {
        for (const item of g.items) {
          const pData = productDocsMap[db.collection("comercios").doc(cId).collection("products").doc(item.product.id).path].data();
          if (pData.isAvailable === false) throw new Error(`"${pData.name}" no está disponible ahora en ${g.comercioName}.`);
        }
      }

      // "Compra el repartidor": el pedido se paga al recibirlo (efectivo o transferencia)
      for (const [cId, g] of commerceEntries) {
        const cData = commerceDataMap[cId];
        if (!shopper.isShopperCommerce(cData)) continue;
        if (shopper.isOnlinePayment(paymentMethod)) {
          throw new Error(`En ${g.comercioName} el pedido lo compra el repartidor: pagalo en efectivo o por transferencia al recibirlo.`);
        }
      }

      // --- STOCK VALIDATION AND ATOMIC DECREMENT ---
      const productStockDecrements = {};
      for (const [cId, g] of commerceEntries) {
        for (const item of g.items) {
          const prodRef = db.collection("comercios").doc(cId).collection("products").doc(item.product.id);
          const path = prodRef.path;
          productStockDecrements[path] = (productStockDecrements[path] || 0) + item.qty;
        }
      }

      for (const [path, reqQty] of Object.entries(productStockDecrements)) {
        const pSnap = productDocsMap[path];
        const pData = pSnap.data();
        // Por peso no lleva stock: qty son pasos de 250 g, no unidades
        if (pData.stockMode === 'limited' && !isSoldByWeight(pData)) {
          const stockQty = typeof pData.stockQuantity === 'number' ? pData.stockQuantity : 0;
          if (stockQty < reqQty) {
            throw new Error(`Stock insuficiente para "${pData.name}". Disponible: ${stockQty}, Solicitado: ${reqQty}`);
          }
          const prodRef = db.doc(path);
          transaction.update(prodRef, {
            stockQuantity: FieldValue.increment(-reqQty)
          });
        }
      }
      // ---------------------------------------------

      // --- SECURE SHIPPING FEE VALIDATION ---
      const extraStopFeeVal = Number(globalSettings.deliveryExtraStopFee) || 500;

      const individualFees = [];
      const clientLat = deliveryCoords && (deliveryCoords.lat !== undefined ? deliveryCoords.lat : deliveryCoords.latitude);
      const clientLng = deliveryCoords && (deliveryCoords.lng !== undefined ? deliveryCoords.lng : deliveryCoords.longitude);

      if (clientLat !== undefined && clientLng !== undefined) {
        for (const [cId, g] of commerceEntries) {
          const cData = commerceDataMap[cId];
          if (cData && cData.coords) {
            const cLat = cData.coords.lat !== undefined ? cData.coords.lat : cData.coords.latitude;
            const cLng = cData.coords.lng !== undefined ? cData.coords.lng : cData.coords.longitude;
            if (cLat !== undefined && cLng !== undefined) {
              individualFees.push(computeDeliveryFee(getDistance(clientLat, clientLng, cLat, cLng), globalSettings));
            }
          }
        }
      }

      let calculatedDeliveryFee = 0;
      let activeNightSurcharge = 0;
      let activeDriverIncentive = 0;
      let driverTip = 0;
      let totalCalculatedDelivery = 0;
      let finalDeliveryCost = 0;

      if (!isTakeaway) {
        if (individualFees.length > 0) {
          const maxIndividualFee = Math.max(...individualFees);
          calculatedDeliveryFee = maxIndividualFee + (commerceEntries.length - 1) * extraStopFeeVal + activeRainSurcharge;
        } else {
          calculatedDeliveryFee = (Number(globalSettings.deliveryMinPrice) || 1500) + (commerceEntries.length - 1) * extraStopFeeVal + activeRainSurcharge;
        }
        activeNightSurcharge = calculateScheduleSurcharge(globalSettings.nightSurchargeConfig, calculatedDeliveryFee);
        activeDriverIncentive = calculateScheduleSurcharge(globalSettings.driverIncentiveConfig, calculatedDeliveryFee);

        driverTip = sanitizeTip(tip);
        totalCalculatedDelivery = calculatedDeliveryFee + driverTip + activeNightSurcharge;

        finalDeliveryCost = Number(totalDelivery || 0);
        // Same formula as the app now, so only rounding can differ: 3% margin, not 10%.
        if (finalDeliveryCost < 0.97 * totalCalculatedDelivery) {
          logger.warn(`Shipping fee tampering detected! Client sent totalDelivery: ${finalDeliveryCost}, calculated: ${totalCalculatedDelivery}. Overwriting.`);
          finalDeliveryCost = totalCalculatedDelivery;
        }
      }
      // --------------------------------------

      const createdOrders = [];
      const appUsageFeeRate = globalSettings.appUsageFeeRate !== undefined ? globalSettings.appUsageFeeRate : 0.05;
      let remainingCouponDiscount = couponData ? Number(couponData.value || 0) : 0;

      // Calculate and create orders
      for (let i = 0; i < commerceEntries.length; i++) {
        const [cId, g] = commerceEntries[i];
        lastId++;

        const cData = commerceDataMap[cId];
        const pDocs = g.items.map(item => productDocsMap[db.collection("comercios").doc(cId).collection("products").doc(item.product.id).path]);

        // Securely calculate products subtotal applying active offers
        const subProductsTotal = g.items.reduce((s, item, idx) => {
          const pSnap = pDocs[idx];
          const pData = pSnap.data();
          const basePrice = withTransferSurcharge(secureUnitPrice(pData, item.options), pData, paymentMethod);

          const offer = activeOffers.find(o => 
            o.active && 
            o.comercioId === cId && 
            o.productIds && 
            o.productIds.includes(item.product.id)
          );

          let finalItemTotal = basePrice * item.qty;
          if (offer) {
            if (offer.type === '2x1') {
              const paidQty = Math.ceil(item.qty / 2);
              finalItemTotal = basePrice * paidQty;
            } else if (offer.type === 'percentage') {
              finalItemTotal = (basePrice * item.qty) * ((100 - (offer.value || 0)) / 100);
            }
          }

          return s + finalItemTotal;
        }, 0);

        // Mismo redondeo que muestra la app (a $10 hacia arriba), para que el total cobrado coincida
        const subAppUsageFee = Math.ceil((subProductsTotal * appUsageFeeRate) / 10) * 10;
        // Por ahora los comercios usan GO! gratis: ningún pedido genera comisión.
        // Para volver a cobrar, poner COMMERCE_COMMISSION_ENABLED en true.
        const commerceCommissionRate = !COMMERCE_COMMISSION_ENABLED ? 0
          : (cData.commissionRate !== undefined && cData.commissionRate !== null ? cData.commissionRate : 0.10);
        const subCommission = subProductsTotal * commerceCommissionRate;

        // Bundle specifics
        const subDeliveryCost = i === 0 ? finalDeliveryCost : 0;
        const subDiscount = i === 0 ? calculatedDiscount : 0;

        let subCouponDiscount = 0;
        if (couponData) {
          const isMerchantCoupon = couponData.ownerId && couponData.ownerId !== 'admin';
          const isMySubOrder = !isMerchantCoupon || (cId === couponData.ownerId);

          if (isMySubOrder && remainingCouponDiscount > 0) {
            const scope = couponData.scope || 'products';
            const discountType = couponData.discountType || (couponData.type === 'free_delivery' ? 'percentage' : 'percentage');

            if (scope === 'shipping' || couponData.type === 'free_delivery') {
              if (i === 0) {
                const baseDeliveryFee = Math.max(finalDeliveryCost - driverTip, 0);
                if (couponData.type === 'free_delivery') {
                  subCouponDiscount = baseDeliveryFee;
                } else if (discountType === 'percentage') {
                  subCouponDiscount = baseDeliveryFee * (remainingCouponDiscount / 100);
                } else if (discountType === 'fixed') {
                  subCouponDiscount = Math.min(remainingCouponDiscount, baseDeliveryFee);
                }
              }
            } else { // products
              if (discountType === 'percentage') {
                subCouponDiscount = subProductsTotal * (remainingCouponDiscount / 100);
              } else if (discountType === 'fixed') {
                if (couponData.ownerId === 'admin') {
                  subCouponDiscount = Math.min(remainingCouponDiscount, subProductsTotal + subDeliveryCost);
                } else {
                  subCouponDiscount = Math.min(remainingCouponDiscount, subProductsTotal);
                }
              }
            }
            if (discountType === 'fixed') {
              remainingCouponDiscount -= subCouponDiscount;
            }
          }
        }

        // In whole pesos: percentage surcharges and discounts left totals like 1263.1999999.
        const subTotal = Math.round(Math.max(subProductsTotal + subDeliveryCost + subAppUsageFee - subDiscount - subCouponDiscount, 0));
        const hasWeighedItems = pDocs.some(pSnap => isSoldByWeight(pSnap.data()));
        const productsCouponPercent = couponData && subCouponDiscount > 0 && (couponData.scope || 'products') === 'products' &&
          couponData.type !== 'free_delivery' && (couponData.discountType || 'percentage') === 'percentage'
          ? Number(couponData.value) || 0 : 0;

        let scheduledForObj = null;
        if (isScheduled && scheduledDate && scheduledTime) {
          const dtStr = `${scheduledDate}T${scheduledTime}:00`;
          const parsed = new Date(dtStr);
          if (!isNaN(parsed.getTime())) {
            scheduledForObj = Timestamp.fromDate(parsed);
          }
        }

        const orderRef = db.collection("orders").doc();
        const orderData = {
          orderId: lastId,
          bundleId: isBundle ? bundleId : null,
          isBundle,
          bundleIndex: i,
          bundleCount: commerceEntries.length,
          comercioId: cId,
          comercioName: g.comercioName,
          comercioCoords: cData.coords || null,
          userId: uid,
          userName: userData.displayName || "Cliente",
          userPhone: userData.phone || "",
          deliveryAddress: address,
          addressNotes: addressNotes || '',
          deliveryCoords: deliveryCoords || null,
          verificationCode: sharedVerificationCode,
          allowReplacement: allowReplacement === true || allowReplacement === 'true',
          isScheduled: isScheduled === true || isScheduled === 'true',
          scheduledDate: scheduledDate || null,
          scheduledTime: scheduledTime || null,
          scheduledFor: scheduledForObj,
          items: g.items.map((item, idx) => {
            const pSnap = pDocs[idx];
            const pData = pSnap.data();
            const basePrice = withTransferSurcharge(secureUnitPrice(pData, item.options), pData, paymentMethod);

            const offer = activeOffers.find(o => 
              o.active && 
              o.comercioId === cId && 
              o.productIds && 
              o.productIds.includes(item.product.id)
            );

            let finalUnitPrice = basePrice;
            if (offer) {
              if (offer.type === '2x1') {
                const paidQty = Math.ceil(item.qty / 2);
                finalUnitPrice = (basePrice * paidQty) / item.qty;
              } else if (offer.type === 'percentage') {
                finalUnitPrice = basePrice * ((100 - (offer.value || 0)) / 100);
              }
            }

            const line = {
              comercioId: cId,
              comercioName: g.comercioName,
              productId: pSnap.id,
              name: pData.name,
              price: finalUnitPrice,
              qty: item.qty,
              options: item.options || [],
              notes: item.notes || ''
            };
            // Producto publicado desde Ventra: la caja lo reconoce al cobrarle al repartidor
            if (pData.ventraId) line.ventraId = pData.ventraId;
            // Recargo por transferencia del comercio (ya incluido en el precio): para mostrarlo en el pedido
            if (isTransferPayment(paymentMethod) && Number(pData.transferSurcharge) > 0) line.transferSurcharge = Number(pData.transferSurcharge);
            if (pData.barcode) line.barcode = pData.barcode;
            if (pData.image && /^https?:\/\//.test(pData.image)) line.image = pData.image;
            // Por peso: el precio es estimado hasta que el comercio pesa (src/utils/weight.js applyWeights)
            if (isSoldByWeight(pData)) {
              const step = weightStepOf(pData);
              Object.assign(line, { soldByWeight: true, weightStep: step, grams: item.qty * step, pricePerKg: finalUnitPrice * 1000 / step });
            }
            return line;
          }),
          subtotal: subProductsTotal,
          deliveryCost: subDeliveryCost,
          tip: i === 0 ? sanitizeTip(tip) : 0,
          isRaining: isRaining,
          rainSurcharge: i === 0 ? activeRainSurcharge : 0,
          nightSurcharge: i === 0 ? activeNightSurcharge : 0,
          driverIncentiveAmount: i === 0 ? activeDriverIncentive : 0,
          appUsageFee: subAppUsageFee,
          discountAmount: subDiscount,
          pointsRedeemed: i === 0 ? redeemedPoints : 0,
          couponCode: couponData ? couponCode.toUpperCase().trim() : null,
          couponDiscount: subCouponDiscount,
          couponAbsorbedBy: couponData ? (couponData.absorbedBy || 'platform') : null,
          total: subTotal,
          commissionAmount: subCommission,
          // Con productos por peso el total es estimado: el comercio lo cierra al pesar.
          // Guardamos cómo se calcularon servicio y cupón para recalcularlos igual.
          ...(hasWeighedItems ? {
            hasWeighedItems: true,
            weighPending: true,
            appUsageFeeRate,
            couponProductsPercent: productsCouponPercent
          } : {}),
          // Lo compra el repartidor en el mostrador: va directo a los repartidores, sin que el
          // comercio confirme, y el total se cierra con lo que realmente llevó (shopper.js)
          ...(shopper.isShopperCommerce(cData) && !isTakeaway ? {
            isShopper: true,
            shopPending: true,
            appUsageFeeRate,
            couponProductsPercent: productsCouponPercent,
            estimatedSubtotal: subProductsTotal,
            estimatedTotal: subTotal,
          } : {}),
          deliveryType: isTakeaway ? 'takeaway' : 'delivery',
          source: source || (isDirectOrder ? 'catalogo_whatsapp' : 'app'),
          isDirectOrder: isDirectOrder === true || source === 'catalogo_whatsapp' || source === 'direct_store',
          guestName: guestName || null,
          guestPhone: guestPhone || null,
          status: 'pending',
          paymentMethod,
          // Lo que suman los recargos por transferencia (cigarrillos en los kioscos de Ventra)
          transferSurchargeTotal: isTransferPayment(paymentMethod) ? g.items.reduce((t, item, idx) => {
            const pData = pDocs[idx].data();
            const base = secureUnitPrice(pData, item.options);
            return t + (withTransferSurcharge(base, pData, paymentMethod) - base) * item.qty;
          }, 0) : 0,
          paymentStatus: 'pending',
          createdAt: FieldValue.serverTimestamp()
        };

        transaction.set(orderRef, orderData);
        createdOrders.push({ docId: orderRef.id, orderId: lastId, commerceId: cId, total: subTotal, isShopper: orderData.isShopper === true });

        // Update direct catalog stats on commerce document
        if (orderData.isDirectOrder) {
          try {
            const commerceDocRef = db.collection("comercios").doc(cId);
            transaction.update(commerceDocRef, {
              directOrdersCount: FieldValue.increment(1),
              directSalesTotal: FieldValue.increment(subTotal)
            });
          } catch (statErr) {
            logger.warn("Could not increment direct stats for commerce:", statErr);
          }
        }

        // Combination tracking updates
        const itemProductIds = g.items.map(item => item.product.id);
        if (itemProductIds.length > 1) {
          for (const item of g.items) {
            const prodRef = db.collection("comercios").doc(cId).collection("products").doc(item.product.id);
            const pSnap = productDocsMap[prodRef.path];
            if (pSnap && pSnap.exists) {
              const pData = pSnap.data();
              const combos = pData.frequentCombos || {};
              
              itemProductIds.forEach(otherId => {
                if (otherId !== item.product.id) {
                  combos[otherId] = (combos[otherId] || 0) + 1;
                }
              });

              transaction.update(prodRef, { frequentCombos: combos });
            }
          }
        }
      }

      // Deduct redeemed points from user
      if (redeemedPoints > 0) {
        transaction.update(userRef, {
          points: FieldValue.increment(-redeemedPoints)
        });
      }

      // Decrement coupon remaining count and record redemption (Single-Use)
      if (couponData && couponRef) {
        transaction.update(couponRef, {
          remaining: FieldValue.increment(-1),
          usedCount: FieldValue.increment(1)
        });

        const redemptionRef = couponRef.collection("redemptions").doc(uid);
        transaction.set(redemptionRef, {
          userId: uid,
          usedAt: FieldValue.serverTimestamp()
        });
      }

      transaction.set(settingsRef, { lastOrderId: lastId }, { merge: true });
      return createdOrders;
    });

    // Notify all comercios (los de "compra el repartidor" no tienen que hacer nada: lo ven en su caja)
    for (const order of result) {
      if (order.isShopper) continue;
      await db.collection("notifications").add({
        comercioId: order.commerceId,
        orderId: order.docId,
        title: `Nuevo pedido #${order.orderId}`,
        message: `Pedido #${order.orderId} de ${decodedToken.name || "Cliente"}`,
        type: "new_order",
        status: "unread",
        pushNotify: true,
        createdAt: FieldValue.serverTimestamp()
      });
    }

    res.status(200).json({ success: true, orders: result });
  } catch (error) {
    logger.error("Create Order Error:", error);
    res.status(500).json({ error: error.message });
  }
}));

exports.createFavorOrder = onRequest({ cors: true, maxInstances: 15, minInstances: 1 }, withOrderIdempotency(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const token = authHeader.split("Bearer ")[1];
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  const uid = decodedToken.uid;
  const { type, pickupAddress, pickupCoords, deliveryAddress, deliveryCoords, details, deliveryCost, purchaseFee, appUsageFee, extraStopsFee, stopsCount, total, tip, couponCode, couponDiscount, paymentMethod, receiptDeliveryType, directDriverUid } = req.body;

  if (!pickupAddress || !deliveryAddress || !details) {
    return res.status(400).json({ error: "Faltan campos obligatorios (direcciones o detalles)" });
  }
  // "Pago de servicios" was retired (30-09-2026). Old app versions may still offer it.
  if (type === "pagodeservicios") {
    return res.status(400).json({ error: "El pago de servicios ya no está disponible. Podés pedir un Mandado." });
  }

  try {
    // Verify online delivery drivers availability
    const onlineDriversSnap = await db.collection("users")
      .where("isOnline", "==", true)
      .get();

    const hasOnlineDriver = onlineDriversSnap.docs.some(doc => {
      const d = doc.data();
      const role = (d.role || "").toLowerCase();
      return d.isDelivery === true || d.isDelivery === "true" || ["delivery", "driver", "repartidor", "chofer"].includes(role);
    });

    if (!hasOnlineDriver) {
      return res.status(400).json({ error: "No es posible realizar tu pedido en este momento porque no hay repartidores conectados en la zona." });
    }

    const result = await db.runTransaction(async (transaction) => {
      // 1. Fetch user data
      const userRef = db.collection("users").doc(uid);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("Usuario no encontrado");
      const userData = userSnap.data();

      // 2. Fetch settings to get lastOrderId
      const settingsRef = db.collection("settings").doc("settings");
      const settingsSnap = await transaction.get(settingsRef);
      let lastId = settingsSnap.exists && settingsSnap.data().lastOrderId ? settingsSnap.data().lastOrderId : 0;
      lastId++;

      // Fetch global settings to securely recalculate fees
      const globalSettingsSnap = await transaction.get(db.collection("settings").doc("global"));
      const globalSettings = globalSettingsSnap.exists ? globalSettingsSnap.data() : {};

      const weatherSnap = await transaction.get(db.collection("settings").doc("weather"));
      const weatherData = weatherSnap.exists ? weatherSnap.data() : {};

      const rainMode = globalSettings.rainMode || "auto";
      let isRaining = false;
      if (rainMode === "on") {
        isRaining = true;
      } else if (rainMode === "off") {
        isRaining = false;
      } else {
        isRaining = await resolveAutoRain(weatherData);
      }

      const baseRainSurcharge = globalSettings.deliveryRainSurcharge !== undefined ? globalSettings.deliveryRainSurcharge : 300;
      const activeRainSurcharge = isRaining ? baseRainSurcharge : 0;

      // Validate Coupon securely inside transaction
      let couponData = null;
      let couponRef = null;
      if (couponCode) {
        const cleanCouponCode = couponCode.toUpperCase().trim();
        couponRef = db.collection("coupons").doc(cleanCouponCode);
        const couponSnap = await transaction.get(couponRef);
        if (!couponSnap.exists) {
          throw new Error("El cupón ingresado no existe.");
        }
        couponData = couponSnap.data();
        if (couponData.active !== true) {
          throw new Error("El cupón ingresado no está activo.");
        }
        if (typeof couponData.remaining === 'number' && couponData.remaining <= 0) {
          throw new Error("Este cupón ya no tiene usos disponibles.");
        }
        if (couponData.expirationDate) {
          const expDate = new Date(couponData.expirationDate + "T23:59:59-03:00");
          if (Date.now() > expDate.getTime()) {
            throw new Error("Este cupón ha expirado.");
          }
        }

        // Single-use per user check!
        const redemptionRef = couponRef.collection("redemptions").doc(uid);
        const redemptionSnap = await transaction.get(redemptionRef);
        if (redemptionSnap.exists) {
          throw new Error("Ya has utilizado este cupón anteriormente.");
        }
      }

      // Banner de mandados con envío bonificado (banners_mandados): el descuento lo valida acá el
      // servidor (activo, con descuento y dentro del tope del día) y el uso se cuenta en el banner.
      // Antes el servidor lo ignoraba: la app mostraba el descuento y se cobraba el precio entero.
      const originBannerId = typeof req.body.originBannerId === "string" && /^[\w-]{1,64}$/.test(req.body.originBannerId) ? req.body.originBannerId : null;
      const bannerRef = originBannerId ? db.collection("banners_mandados").doc(originBannerId) : null;
      const bannerSnap = bannerRef ? await transaction.get(bannerRef) : null;
      const bannerDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
      let bannerEligible = 0;
      if (bannerSnap && bannerSnap.exists) {
        const b = bannerSnap.data();
        const usedToday = Number((b.stats && b.stats.discountedByDay && b.stats.discountedByDay[bannerDayKey]) || 0);
        const dayLimit = Number(b.discountLimitPerDay || 0);
        if (b.status === "active" && b.hasDiscount && Number(b.discountAmount) > 0 && (!dayLimit || usedToday < dayLimit)) {
          bannerEligible = Number(b.discountAmount);
        }
      }

      const orderRef = db.collection("orders").doc();
      const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();

      // Secure fee validation for GoFavor
      const pLat = pickupCoords && (pickupCoords.lat !== undefined ? pickupCoords.lat : pickupCoords.latitude);
      const pLng = pickupCoords && (pickupCoords.lng !== undefined ? pickupCoords.lng : pickupCoords.longitude);
      const dLat = deliveryCoords && (deliveryCoords.lat !== undefined ? deliveryCoords.lat : deliveryCoords.latitude);
      const dLng = deliveryCoords && (deliveryCoords.lng !== undefined ? deliveryCoords.lng : deliveryCoords.longitude);

      // The app creates encomiendas with type "mandado" and no stops (purchases are "compra")
      const isEncomienda = type === 'mandado' && !(Array.isArray(req.body.mandadoStops) && req.body.mandadoStops.length);

      let secureDeliveryCost = 0;
      if (type === 'pagodeservicios' && receiptDeliveryType === 'digital') {
         secureDeliveryCost = 0;
      } else if (pLat !== undefined && pLng !== undefined && dLat !== undefined && dLng !== undefined) {
         // Mandados have no real pickup point: the app sends the town center as pickupCoords,
         // so this is center -> customer, with the same formula the app shows.
         const straightKm = getDistance(pLat, pLng, dLat, dLng);
         secureDeliveryCost = isEncomienda ? computeEncomiendaFee(straightKm, globalSettings) : computeDeliveryFee(straightKm, globalSettings);
      } else {
         secureDeliveryCost = isEncomienda ? encomiendaMinFee(globalSettings) : Number(globalSettings.deliveryMinPrice) || 1500;
      }

      const activeNightSurcharge = calculateScheduleSurcharge(globalSettings.nightSurchargeConfig, secureDeliveryCost);

      // The app sends the BASE fee and shows rain and night surcharges on top of it. Validate the
      // base, then always add both, so the charge matches what the customer saw. (Comparing the
      // base against base+surcharges overwrote some orders and let others skip the surcharges.)
      let finalDeliveryCost = Math.max(0, Number(deliveryCost) || 0);
      if (finalDeliveryCost < 0.97 * secureDeliveryCost) {
        logger.warn(`GoFavor Delivery fee tampering detected! Client: ${finalDeliveryCost}, calculated: ${secureDeliveryCost}. Overwriting.`);
        finalDeliveryCost = secureDeliveryCost;
      }
      const validatedBaseFee = finalDeliveryCost;
      if (finalDeliveryCost > 0) {
        finalDeliveryCost += activeRainSurcharge + activeNightSurcharge;
      }

      const securePurchaseFee = type === 'compra' 
        ? (globalSettings.favorPurchaseFee !== undefined ? Number(globalSettings.favorPurchaseFee) : 800)
        : (type === 'pagodeservicios' ? (globalSettings.servicePaymentErrandFee !== undefined ? Number(globalSettings.servicePaymentErrandFee) : 2000) : 0);

      let finalPurchaseFee = Number(purchaseFee || 0);
      if ((type === 'compra' || type === 'pagodeservicios') && finalPurchaseFee < 0.9 * securePurchaseFee) {
        logger.warn(`GoFavor Purchase fee tampering detected! Client: ${finalPurchaseFee}, calculated: ${securePurchaseFee}. Overwriting.`);
        finalPurchaseFee = securePurchaseFee;
      } else if (type !== 'compra' && type !== 'pagodeservicios') {
        finalPurchaseFee = 0;
      }

      const subtotalVal = finalDeliveryCost + finalPurchaseFee;
      // Same fee config the app shows for services (servicesAppFeeConfig, 1.2% by default), not
      // the 5% commerce rate: that one overwrote the fee shown to the customer with a higher
      // one. Computed on the base fee, the smallest base any form uses, so it's a true floor.
      const feeConfigs = globalSettings.servicesAppFeeConfig || {};
      const feeConfig = (req.body.isGoCash === true ? feeConfigs.gocash : feeConfigs.gofavor) || { type: "percentage", value: 1.2 };
      const secureAppUsageFee = feeConfig.type === "fixed"
        ? Number(feeConfig.value) || 0
        : Math.ceil((validatedBaseFee * ((Number(feeConfig.value) || 0) / 100)) / 10) * 10;

      let finalAppUsageFee = Number(appUsageFee || 0);
      if (finalAppUsageFee < 0.9 * secureAppUsageFee) {
        logger.warn(`GoFavor App usage fee tampering detected! Client: ${finalAppUsageFee}, calculated: ${secureAppUsageFee}. Overwriting.`);
        finalAppUsageFee = secureAppUsageFee;
      }

      let secureCouponDiscount = 0;
      if (couponData) {
        const scope = couponData.scope || 'shipping';
        const discountType = couponData.discountType || 'fixed';
        const couponVal = Number(couponData.value || 0);

        if (scope === 'shipping' || couponData.type === 'free_delivery') {
          // Shipping coupons apply to the base fee, as in the app (not to rain/night surcharges).
          if (couponData.type === 'free_delivery') {
            secureCouponDiscount = validatedBaseFee;
          } else if (discountType === 'percentage') {
            secureCouponDiscount = Math.floor(validatedBaseFee * (couponVal / 100));
          } else {
            secureCouponDiscount = couponVal;
          }
        } else if (scope === 'global') {
          if (discountType === 'percentage') {
            secureCouponDiscount = subtotalVal * (couponVal / 100);
          } else {
            secureCouponDiscount = couponVal;
          }
        }
        if (secureCouponDiscount > subtotalVal) secureCouponDiscount = subtotalVal;
      }

      // La app manda en couponDiscount el cupón más el banner: el banner se valida aparte
      let finalCouponDiscount = Math.max(0, Number(couponDiscount || 0) - bannerEligible);
      if (couponData && Math.abs(finalCouponDiscount - secureCouponDiscount) > 10) {
        logger.warn(`GoFavor Coupon discount tampering detected! Client: ${finalCouponDiscount}, calculated: ${secureCouponDiscount}. Overwriting.`);
        finalCouponDiscount = secureCouponDiscount;
      } else if (!couponData) {
        finalCouponDiscount = 0;
      }

      // Tip and extra stops came straight from the app and could be negative, lowering the
      // total. Extra stops are recomputed like the app does; the tip can only add.
      const secureStopsCount = Math.min(10, Math.max(1, Math.floor(Number(stopsCount) || 1)));
      const extraStopUnitFee = globalSettings.deliveryExtraStopFee !== undefined ? Number(globalSettings.deliveryExtraStopFee) : 500;
      const secureExtraStopsFee = (secureStopsCount - 1) * extraStopUnitFee;
      const secureTip = sanitizeTip(tip);
      const bannerDiscount = Math.min(bannerEligible, Math.max(0, subtotalVal - finalCouponDiscount));
      const rawTotal = subtotalVal + finalAppUsageFee + secureExtraStopsFee + secureTip - finalCouponDiscount - bannerDiscount;
      const finalTotal = Math.max(0, Math.ceil(rawTotal));

      // Extract address notes from deliveryAddress if formatted as "Address (Detalle: Notes)"
      let finalDeliveryAddress = deliveryAddress;
      let addressNotesVal = "";
      const matchDetails = deliveryAddress.match(/^(.*?)\s*\(Detalle:\s*(.*?)\)$/i);
      if (matchDetails) {
        finalDeliveryAddress = matchDetails[1].trim();
        addressNotesVal = matchDetails[2].trim();
      }

      // Direct driver assignment handling
      let initialTargetDriverId = null;
      let initialTargetDriverName = null;
      if (directDriverUid && directDriverUid !== 'rotation') {
        const directDriverSnap = await transaction.get(db.collection("users").doc(directDriverUid));
        if (directDriverSnap.exists) {
          const dData = directDriverSnap.data();
          initialTargetDriverId = directDriverUid;
          initialTargetDriverName = dData.displayName || dData.name || "Repartidor";
        }
      }

      // Comercios del mandado tal como los eligió el cliente (con ubicación si eligió uno conocido).
      // Solo sirven para guiar al repartidor: el precio sigue calculándose desde el centro.
      const cleanStops = Array.isArray(req.body.mandadoStops) ? req.body.mandadoStops.slice(0, 10).map(st => {
        const store = String((st && st.store) || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (!store) return null;
        const out = { store, items: String((st && st.items) || "").trim().slice(0, 600) };
        const lat = Number(st && st.lat), lng = Number(st && st.lng);
        if (isFinite(lat) && isFinite(lng) && lat > -35.6 && lat < -34.6 && lng > -58.1 && lng < -57.0) {
          out.lat = Math.round(lat * 1e6) / 1e6;
          out.lng = Math.round(lng * 1e6) / 1e6;
        }
        if (st && typeof st.nearest === "string" && /^[a-z]{3,20}$/.test(st.nearest)) out.nearest = st.nearest;
        return out;
      }).filter(Boolean) : [];

      const orderData = {
        orderId: lastId,
        isFavor: true,
        favorType: type,
        userId: uid,
        userName: userData.displayName || userData.name || "Cliente",
        userPhone: userData.phone || "",
        pickupAddress: pickupAddress,
        pickupCoords: pickupCoords || null,
        deliveryAddress: finalDeliveryAddress,
        deliveryCoords: deliveryCoords || null,
        addressNotes: addressNotesVal,
        details: details,
        ...(cleanStops.length ? { mandadoStops: cleanStops } : {}),
        // Go Cash: el monto a cambiar y el sentido (antes no se guardaban y el repartidor veía
        // el costo del envío como si fuera el efectivo a llevar)
        ...(type === "gocash" ? {
          isGoCash: true,
          goCashAmount: Math.min(70000, Math.max(0, Math.round(Number(req.body.goCashAmount) || 0))),
          goCashType: req.body.goCashType === "transfer_to_cash" ? "transfer_to_cash" : "cash_to_transfer",
        } : {}),
        deliveryCost: finalDeliveryCost,
        isRaining: isRaining,
        rainSurcharge: activeRainSurcharge,
        nightSurcharge: activeNightSurcharge,
        purchaseFee: finalPurchaseFee,
        appUsageFee: finalAppUsageFee,
        extraStopsFee: secureExtraStopsFee,
        stopsCount: secureStopsCount,
        total: finalTotal,
        status: 'pending',
        paymentMethod: paymentMethod || 'efectivo',
        paymentStatus: 'pending',
        verificationCode,
        tip: secureTip,
        couponCode: couponCode || null,
        // El banner lo absorbe GO como un cupón (la cuenta del cadete acredita couponDiscount)
        couponDiscount: finalCouponDiscount + bannerDiscount,
        ...(originBannerId ? { originBannerId, bannerDiscount } : {}),
        directDriverUid: directDriverUid && directDriverUid !== 'rotation' ? directDriverUid : null,
        queueTargetDriverId: initialTargetDriverId,
        queueTargetDriverName: initialTargetDriverName,
        queueOfferedAt: initialTargetDriverId ? FieldValue.serverTimestamp() : null,
        createdAt: FieldValue.serverTimestamp()
      };

      transaction.set(orderRef, orderData);

      if (bannerRef && bannerSnap.exists) {
        transaction.update(bannerRef, {
          "stats.conversions": FieldValue.increment(1),
          [`stats.conversionsByDay.${bannerDayKey}`]: FieldValue.increment(1),
          ...(bannerDiscount > 0 ? { [`stats.discountedByDay.${bannerDayKey}`]: FieldValue.increment(1) } : {}),
        });
      }
      
      // Decrement coupon remaining count and record redemption (Single-Use)
      if (couponData && couponRef) {
        transaction.update(couponRef, {
          remaining: FieldValue.increment(-1),
          usedCount: FieldValue.increment(1)
        });

        const redemptionRef = couponRef.collection("redemptions").doc(uid);
        transaction.set(redemptionRef, {
          userId: uid,
          usedAt: FieldValue.serverTimestamp()
        });
      }

      transaction.set(settingsRef, { lastOrderId: lastId }, { merge: true });
      return { docId: orderRef.id, orderId: lastId };
    });

    // Notify available drivers via notifications collection
    await db.collection("notifications").add({
      title: "Nuevo favor disponible",
      message: `Hay un nuevo ${type} disponible`,
      type: "new_favor",
      status: "unread",
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(200).json({ success: true, orderId: result.docId, orderNum: result.orderId });
  } catch (error) {
    logger.error("Create Favor Order Error:", error);
    res.status(500).json({ error: error.message });
  }
}));

/**
 * Endpoint: Send customized, segmented push notifications to devices via Pub/Sub Topics (Admin only)
 */
exports.sendGlobalPush = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const token = authHeader.split("Bearer ")[1];
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  const uid = decodedToken.uid;
  try {
    const ADMIN_EMAILS = ['kioscopaulos7@gmail.com'];
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const callerEmail = decodedToken.email || '';
    const isAdminUser = ADMIN_EMAILS.includes(callerEmail) || (userData && (userData.role === 'admin' || userData.isAdmin === true));
    if (!isAdminUser) {
      return res.status(403).json({ error: "No tenés permisos para realizar esta acción" });
    }

    const { title, body, url, audience, imageUrl, scheduledAt } = req.body;
    if (!body) {
      return res.status(400).json({ error: "El cuerpo de la notificación es obligatorio" });
    }

    const targetAudience = audience || "all";

    // "me" = solo los dispositivos de quien manda (botón "Probar en mi móvil"): no queda en el historial
    if (targetAudience === "me") {
      const myTokens = await tokensForAudience(db, "me", { uid, owners: tokenOwners });
      if (myTokens.length > 0) {
        await sendPush(myTokens, { title: title || "Go Delivery", body }, { url: url || "/#/", type: "custom_global_push", imageUrl: imageUrl || "" });
      }
      return res.status(200).json({ success: true, sentCount: myTokens.length });
    }

    // Check if scheduled
    let isScheduled = false;
    let scheduledDate = null;
    if (scheduledAt) {
      scheduledDate = new Date(scheduledAt);
      if (scheduledDate > new Date()) {
        isScheduled = true;
      }
    }

    if (isScheduled) {
      // 1. Create a scheduled broadcast campaign record in Firestore
      const broadcastRef = await db.collection("broadcasts").add({
        title: title || "Go Delivery",
        body: body,
        imageUrl: imageUrl || "",
        url: url || "/#/",
        targetAudience: targetAudience,
        status: "scheduled",
        scheduledAt: Timestamp.fromDate(scheduledDate),
        sentCount: 0,
        clicks: 0,
        createdAt: FieldValue.serverTimestamp()
      });

      return res.status(200).json({ success: true, scheduled: true, broadcastId: broadcastRef.id });
    }

    // 2. Fetch target devices' tokens in matching segments (Instant direct delivery, bypassing topic delay)
    let targetTokens = [];
    try {
      targetTokens = await tokensForAudience(db, targetAudience, { owners: tokenOwners });
    } catch (cErr) {
      logger.warn("Target devices tokens query failed:", cErr);
    }
    const sentCount = targetTokens.length;

    // 3. Create a broadcast record in Firestore for real-time Campaign Analytics (CTR tracking)
    const broadcastRef = await db.collection("broadcasts").add({
      title: title || "Go Delivery",
      body: body,
      imageUrl: imageUrl || "",
      url: url || "/#/",
      targetAudience: targetAudience,
      status: "sent",
      sentCount: sentCount || 0,
      clicks: 0,
      createdAt: FieldValue.serverTimestamp()
    });

    // 4. Send to devices directly using the robust sendPush multicast utility (instant arrival!)
    if (targetTokens.length > 0) {
      await sendPush(targetTokens, {
        title: title || "Go Delivery",
        body: body
      }, {
        url: url || "/#/",
        type: "custom_global_push",
        broadcastId: broadcastRef.id,
        imageUrl: imageUrl || ""
      });
      logger.info(`Global push sent successfully directly to ${targetTokens.length} devices.`);
    }

    res.status(200).json({ success: true, sentCount: sentCount || 0, broadcastId: broadcastRef.id });
  } catch (error) {
    logger.error("Send Global Push Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint: Increment analytics clicks (CTR) from Service Worker in background
 */
exports.trackBroadcastClick = onRequest({ cors: true }, async (req, res) => {
  const { broadcastId } = req.query;
  if (!broadcastId) {
    return res.status(400).json({ error: "broadcastId is required" });
  }

  try {
    await db.collection("broadcasts").doc(broadcastId).update({
      clicks: FieldValue.increment(1)
    });
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error("Error tracking broadcast click:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger: Automatically subscribe client PWA FCM tokens to Pub/Sub Topics based on role when registered
 */
exports.onFCMTokenRegistered = onDocumentCreated("users/{userId}/fcmTokens/{token}", async (event) => {
  const token = event.params.token;
  const userId = event.params.userId;

  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) return;

    const userData = userDoc.data();
    const role = (userData.role || "client").toString().toLowerCase();

    // 1. All devices subscribe to the global channel
    await admin.messaging().subscribeToTopic(token, "global_broadcast");
    logger.info(`[Pub/Sub] Subscribed token to global_broadcast: ${token}`);

    // 2. Role-specific subscriptions
    if (role === "admin" || role === "client") {
      await admin.messaging().subscribeToTopic(token, "clients_broadcast");
      logger.info(`[Pub/Sub] Subscribed token to clients_broadcast: ${token}`);
    } else if (role === "driver" || role === "repartidor" || role === "delivery" || userData.isDelivery === true || userData.deliveryStatus === "approved") {
      await admin.messaging().subscribeToTopic(token, "drivers_broadcast");
      logger.info(`[Pub/Sub] Subscribed token to drivers_broadcast: ${token}`);
    } else if (role === "commerce" || role === "comercio") {
      await admin.messaging().subscribeToTopic(token, "stores_broadcast");
      logger.info(`[Pub/Sub] Subscribed token to stores_broadcast: ${token}`);
    }
  } catch (err) {
    logger.error("Error in onFCMTokenRegistered trigger:", err);
  }

  try {
    await grantGiveawayAppChances(userId);
  } catch (err) {
    logger.error("[Giveaway] Error granting app chances:", err);
  }
});

/**
 * Trigger: Automatically send dynamic FCM Push Notifications to devices when P2P points are gifted or a challenge is completed.
 */
exports.onNotificationCreated = onDocumentCreated("users/{userId}/notifications/{notificationId}", async (event) => {
  const notification = event.data.data();
  const userId = event.params.userId;
  if (!notification) return;

  // Protect from loop: Only trigger push notifications for direct P2P points transfer, weekly challenge completions, driver/delivery approvals, scheduled trip events, or commerce approvals.
  // IMPORTANT: Do NOT add 'system', 'order_taken', 'trip_taken', or 'push_mirror' here — those are written by the client when it receives a push, which would cause an infinite loop.
  if (
    notification.type !== 'points_received' && 
    notification.type !== 'challenge_completion' && 
    notification.type !== 'driver_approved' && 
    notification.type !== 'delivery_approved' &&
    notification.type !== 'scheduled_trip_accepted' &&
    notification.type !== 'scheduled_trip_cancelled' &&
    notification.type !== 'commerce_approved' &&
    notification.type !== 'commerce_rejected'
  ) {
    return;
  }

  try {
    const tokens = await getUserTokens(userId);
    if (tokens.length > 0) {
      await sendPush(tokens, {
        title: notification.title || "Go Delivery",
        body: notification.body || ""
      }, {
        tag: `notif-${event.params.notificationId}`,
        url: notification.url || "/#/",
        type: notification.type
      });
      logger.info(`Push notification sent successfully to user ${userId} for dynamic alert: ${notification.title}`);
    }
  } catch (err) {
    logger.error("Error in onNotificationCreated push trigger:", err);
  }
});

/**
 * Endpoint: Admin-only test push to one user. Reports, per stored token, whether FCM
 * accepted it and when/where it was registered, so an admin can tell whether the
 * token belongs to the phone the person is holding right now.
 */
// Detector de errores: la app manda acá los errores que ve (src/utils/error-reporter.js);
// se agrupan en client_errors y avisan a los admins (ver functions/client-errors.js).
exports.reportClientError = onRequest({ cors: true, maxInstances: 5, memory: "256Mi" },
  createReportHandler({ admin, getAdminTokens, sendPush }));

// Vigilante: audita los datos y lee los errores del servidor cada 15 minutos; a la mañana hace
// además la revisión pesada y manda el resumen del día (ver functions/vigilante.js).
exports.vigilante = onSchedule({ schedule: "every 15 minutes", timeoutSeconds: 300, maxInstances: 1 }, async () => {
  await runVigilante({ getAdminTokens, sendPush });
});

exports.vigilanteDiario = onSchedule({ schedule: "0 9 * * *", timeZone: "America/Argentina/Buenos_Aires", timeoutSeconds: 540, maxInstances: 1 }, async () => {
  await runVigilante({ getAdminTokens, sendPush }, { daily: true });
  await sendDailyDigest({ getAdminTokens, sendPush });
});

// "Revisar ahora" desde Admin → Errores (sólo admins).
exports.runVigilanteNow = onRequest({ cors: true, timeoutSeconds: 300, maxInstances: 2 }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(String(req.body?.idToken || ""));
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  const callerSnap = await db.collection("users").doc(decoded.uid).get();
  const caller = callerSnap.exists ? callerSnap.data() : {};
  const isAdminUser = decoded.email === "kioscopaulos7@gmail.com" || caller.role === "admin" || caller.isAdmin === true;
  if (!isAdminUser) return res.status(403).json({ error: "Sólo para administradores" });
  try {
    const out = await runVigilante({ getAdminTokens, sendPush }, { daily: req.body?.full === true });
    const problems = Object.values(out.checks).filter((c) => c.ok === false).length;
    return res.json({ ok: true, problems, logs: out.logs });
  } catch (err) {
    logger.error("[Vigilante] revisión manual falló:", err);
    return res.status(500).json({ error: "La revisión falló" });
  }
});

exports.adminTestPush = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const idToken = req.body?.idToken;
  const targetUid = req.body?.targetUid;
  if (!idToken || !targetUid) return res.status(400).json({ error: "Faltan datos" });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  try {
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    const caller = callerSnap.exists ? callerSnap.data() : {};
    const isAdminUser = decoded.email === "kioscopaulos7@gmail.com" || caller.role === "admin" || caller.isAdmin === true;
    if (!isAdminUser) return res.status(403).json({ error: "No tenés permisos para realizar esta acción" });

    const [tokensSnap, userSnap] = await Promise.all([
      db.collection("users").doc(targetUid).collection("fcmTokens").get(),
      db.collection("users").doc(targetUid).get()
    ]);
    const info = new Map();
    tokensSnap.docs.forEach(d => {
      const t = d.data();
      const token = t.token || d.id;
      info.set(token, { platform: t.platform || "", updatedAtMs: tsToMs(t.updatedAt) || tsToMs(t.lastSession) });
    });
    if (userSnap.exists) {
      const u = userSnap.data();
      if (u.lastFcmToken && !info.has(u.lastFcmToken)) {
        info.set(u.lastFcmToken, { platform: "", updatedAtMs: tsToMs(u.lastFcmTokenUpdatedAt) });
      }
      (Array.isArray(u.fcmTokens) ? u.fcmTokens : []).forEach(t => {
        if (t && !info.has(t)) info.set(t, { platform: "", updatedAtMs: 0 });
      });
    }

    const results = [];
    for (const [token, meta] of info.entries()) {
      try {
        await admin.messaging().send({
          token,
          notification: { title: "🔔 Prueba de notificación", body: "Si ves esto, las notificaciones de GoDelivery te funcionan en este teléfono." },
          data: { type: "test_push", url: `https://${process.env.GCLOUD_PROJECT || "godelivery-magdalena"}.web.app/#/delivery` },
          android: { priority: "high", notification: { channelId: "exclusive_offers", sound: "default", priority: "max" } },
          apns: { headers: { "apns-priority": "10", "apns-push-type": "alert", "apns-topic": "com.godelivery.magdalena" }, payload: { aps: { sound: "default" } } }
        });
        results.push({ ...meta, tail: token.slice(-8), ok: true });
      } catch (err) {
        results.push({ ...meta, tail: token.slice(-8), ok: false, error: err.code || err.message });
        if (DEAD_TOKEN_ERROR_CODES.has(err.code)) await pruneDeadToken(targetUid, token);
      }
    }

    results.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
    logger.info(`[adminTestPush] ${decoded.uid} tested ${targetUid}: ${JSON.stringify(results)}`);
    return res.json({ tokens: results });
  } catch (err) {
    logger.error("[adminTestPush] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint: Perform a complete platform data reset (Admin only)
 */
exports.adminHardReset = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split("Bearer ")[1];
  } else if (req.body && req.body.idToken) {
    token = req.body.idToken;
  }

  if (!token) {
    return res.status(401).json({ error: "No autorizado" });
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  const uid = decodedToken.uid;
  try {
    // 1. Verify user is an Admin
    const ADMIN_EMAILS_RESET = ['kioscopaulos7@gmail.com'];
    const userDoc2 = await db.collection("users").doc(uid).get();
    const userData2 = userDoc2.exists ? userDoc2.data() : null;
    const callerEmail2 = decodedToken.email || '';
    const isAdminUser2 = ADMIN_EMAILS_RESET.includes(callerEmail2) || (userData2 && (userData2.role === 'admin' || userData2.isAdmin === true));
    if (!isAdminUser2) {
      return res.status(403).json({ error: "No tenés permisos para realizar esta acción" });
    }

    const { keepPoints, keepAds, keepOffers } = req.body;

    // 2. Auxiliary/transactional collections cleared always
    const collectionsToClear = [
      'orders', 'chats', 'support_chats', 'notifications', 'commissions',
      'settlements', 'delivery_transactions', 'deliverySessions', 'driver_ledger',
      'delivery_debt_settlements', 'delivery_canon_payments', 'delivery_settlement_proofs',
      'visits', 'broadcasts', 'reviews'
    ];

    if (!keepAds) {
      collectionsToClear.push('ads', 'customAds');
    }

    if (!keepOffers) {
      collectionsToClear.push('offers', 'coupons');
    }

    // Perform deletions
    for (const colName of collectionsToClear) {
      await deleteCollection(db.collection(colName));
    }

    // 3. Clear global reset counters/settings
    await db.collection('settings').doc('global').set({
      lastOrderId: 0,
      lastResetAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // 4. Update all users: blanquear saldos, deudas, ratings
    const usersSnap = await db.collection('users').get();
    const userChunks = chunkArray(usersSnap.docs, 500);
    for (const chunk of userChunks) {
      const batch = db.batch();
      chunk.forEach(uDoc => {
        const updateData = {
          deliveryDebt: 0,
          // Accounts start over too (driver_ledger is cleared above): next entry opens at $0.
          ledgerOpened: false,
          ledgerSeq: 0,
          ledgerLastEntryId: null,
          commerceBalance: 0,
          completedOrdersCount: 0,
          ratings: [] // Clear driver ratings list
        };
        if (!keepPoints) {
          updateData.points = 0;
        }
        batch.update(uDoc.ref, updateData);
      });
      await batch.commit();
    }

    // 5. Update all comercios: reset ratings and reviewsCount to default
    const comerciosSnap = await db.collection('comercios').get();
    const comercioChunks = chunkArray(comerciosSnap.docs, 500);
    for (const chunk of comercioChunks) {
      const batch = db.batch();
      chunk.forEach(cDoc => {
        batch.update(cDoc.ref, {
          rating: 4.8,
          reviewsCount: 0
        });
      });
      await batch.commit();
    }

    return res.status(200).json({ success: true, message: "Reseteo Nuclear completado correctamente" });

  } catch (error) {
    logger.error("Error in adminHardReset:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Helper functions for deletion and chunking
async function deleteCollection(collectionRef) {
  const query = collectionRef.limit(500);
  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve, reject);
  });
}

async function deleteQueryBatch(query, resolve, reject) {
  try {
    const snapshot = await query.get();
    if (snapshot.size === 0) {
      resolve();
      return;
    }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    process.nextTick(() => {
      deleteQueryBatch(query, resolve, reject);
    });
  } catch (error) {
    reject(error);
  }
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ═══════════════════════════════════════════════════
// NEW CRON JOBS & PUSH TRIGGERS
// ═══════════════════════════════════════════════════

// Helper to get all delivery drivers reliably (handles all role names and status fields)
async function getAllDeliveryDrivers() {
  const snaps = await Promise.all([
    db.collection("users").where("role", "in", ["delivery", "driver", "repartidor"]).get(),
    db.collection("users").where("isDelivery", "==", true).get(),
    db.collection("users").where("deliveryStatus", "==", "approved").get()
  ]);
  const driversMap = new Map();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      driversMap.set(doc.id, doc);
    }
  }
  return Array.from(driversMap.values());
}

// After 2 hours without activity, online drivers get a reminder push; if they
// don't answer it within 15 minutes, they are disconnected. "Activity" is the
// same clock the driver panel shows as the live timer: connecting, accepting an
// order or renewing the session (lastTripAcceptedAt). The heartbeat
// (lastActivityAt) only proves the app is open, so it is just a fallback for old
// profiles. Tapping the push opens #/delivery?action=renew_session, which resets
// lastTripAcceptedAt and clears inactivityWarningSentAt. Drivers with an order
// in progress are never reminded nor disconnected.
exports.autoDisconnectDrivers = onSchedule("*/5 * * * *", async () => {
  try {
    const now = Date.now();
    const snap = await db.collection("users").where("isOnline", "==", true).get();

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (!isDeliveryDoc(data)) continue;

      const lastActivityMs = tsToMs(data.lastTripAcceptedAt) || tsToMs(data.lastActivityAt);
      const lastWarningMs = tsToMs(data.inactivityWarningSentAt);
      // A warning newer than the last activity means the driver hasn't answered it yet.
      const warningPending = lastWarningMs > lastActivityMs;

      if (warningPending) {
        if (now - lastWarningMs < DRIVER_WARNING_GRACE_MS) continue;
      } else if (now - lastActivityMs < DRIVER_INACTIVITY_MS) {
        continue;
      }

      const activeOrdersSnap = await db.collection("orders")
        .where("driverId", "==", docSnap.id)
        .where("status", "in", ["accepted", "confirmed", "preparing", "ready", "picked_up", "at_door", "delivering"])
        .limit(1)
        .get();
      if (!activeOrdersSnap.empty) continue;

      if (warningPending) {
        await docSnap.ref.update({
          isOnline: false,
          currentSessionId: null,
          inactivityWarningSentAt: null,
          disconnectedReason: "inactivity",
          autoDisconnectedAt: FieldValue.serverTimestamp()
        });

        if (data.currentSessionId) {
          try {
            await db.collection("deliverySessions").doc(data.currentSessionId).update({
              endTime: FieldValue.serverTimestamp()
            });
          } catch (sessErr) {
            logger.warn(`[autoDisconnectDrivers] Could not close session ${data.currentSessionId}:`, sessErr.message);
          }
        }

        logger.info(`[autoDisconnectDrivers] Disconnected driver ${docSnap.id}: inactivity reminder unanswered.`);
        continue;
      }

      // Mark first so a failed push doesn't make every 5-minute run retry it.
      await docSnap.ref.update({
        inactivityWarningSentAt: FieldValue.serverTimestamp()
      });

      const title = "⏰ ¿Seguís conectado?";
      const body = "Pasaron 2 horas sin actividad. Tocá acá en los próximos 15 minutos para seguir en línea, o te desconectaremos.";
      const url = "#/delivery?action=renew_session";

      try {
        const tokens = await getUserTokens(docSnap.id);
        if (tokens.length > 0) {
          await sendPush(tokens, { title, body }, {
            tag: `inactivity-${docSnap.id}`,
            url,
            type: "inactivity_warning",
            channelId: "default"
          }, docSnap.id);
        }
      } catch (pushErr) {
        logger.warn(`[autoDisconnectDrivers] Push failed for ${docSnap.id}:`, pushErr.message);
      }

      try {
        await docSnap.ref.collection("notifications").add({
          type: "inactivity_warning",
          title,
          body,
          url,
          status: "unread",
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (notifErr) {
        logger.warn(`[autoDisconnectDrivers] In-app notification failed for ${docSnap.id}:`, notifErr.message);
      }

      logger.info(`[autoDisconnectDrivers] Sent inactivity reminder to driver ${docSnap.id}.`);
    }
  } catch (err) {
    logger.error("[autoDisconnectDrivers] Error:", err);
  }
});

// Cancels orders nobody picked up within 10 minutes:
//  - commerce orders the commerce never accepted (status pending)
//  - GoFavor / GoViaje orders no driver took (counted from creation)
//  - commerce orders ready for delivery that no driver took (counted from ready)
// Takeaway orders never need a driver, and scheduled trips (status "scheduled")
// are outside the statuses queried, so neither is touched by the driver rule.
exports.cancelUnassignedOrders = onSchedule("every 1 minutes", async () => {
  try {
    const now = Date.now();
    const snap = await db.collection("orders")
      .where("status", "in", ["pending", "confirmed", "preparing", "ready"])
      .get();

    for (const docSnap of snap.docs) {
      const o = docSnap.data();
      if (o.driverId) continue;

      const createdMs = tsToMs(o.createdAt);
      const isService = o.isFavor === true || o.isTrip === true || o.isShopper === true;
      const isTakeaway = o.deliveryType === "takeaway" || o.deliveryType === "retiro";

      let referenceMs = 0;
      let cancelReason = "";

      if (isService) {
        referenceMs = createdMs;
        cancelReason = "Ningún repartidor tomó el pedido en 20 minutos.";
      } else if (o.status === "pending") {
        referenceMs = createdMs;
        cancelReason = "El comercio no aceptó el pedido en 20 minutos.";
      } else if (o.status === "ready" && !isTakeaway) {
        referenceMs = tsToMs(o.readyAt) || tsToMs(o.updatedAt) || createdMs;
        cancelReason = "Ningún repartidor tomó el pedido en 20 minutos.";
      } else {
        continue;
      }

      if (!referenceMs || now - referenceMs < ORDER_AUTO_CANCEL_MS) continue;

      try {
        const orderRef = docSnap.ref;
        const cancelled = await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(orderRef);
          if (!freshSnap.exists) return false;
          const fresh = freshSnap.data();
          // Someone may have accepted / advanced the order since the query ran.
          if (fresh.driverId || fresh.status !== o.status) return false;

          tx.update(orderRef, {
            status: "cancelled",
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: "system",
            cancelReason,
            queueTargetDriverId: null,
            queueOfferedAt: null
          });

          if (fresh.pointsRedeemed > 0 && fresh.userId) {
            tx.update(db.collection("users").doc(fresh.userId), {
              points: FieldValue.increment(fresh.pointsRedeemed)
            });
          }
          return true;
        });

        if (cancelled) {
          logger.info(`[AutoCancel] Order ${docSnap.id} cancelled: ${cancelReason}`);
        }
      } catch (orderErr) {
        logger.error(`[AutoCancel] Error cancelling order ${docSnap.id}:`, orderErr);
      }
    }
  } catch (err) {
    logger.error("[AutoCancel] Error:", err);
  }
});

// Pedido de comercio sin aceptar: con el celular bloqueado la app no puede hacer sonar su
// alarma (iOS suspende el JS al rato), así que el aviso se repite por push cada 2 minutos
// mientras siga pendiente, hasta 8 veces. Mismo tag que el aviso original: reemplaza la
// notificación en vez de apilar otra, pero vuelve a sonar. El registro va aparte
// (storeOrderReminders) para no disparar los triggers de orders.
const STORE_REMINDER_EVERY_MS = 2 * 60 * 1000;
const STORE_REMINDER_MAX = 8;
exports.remindPendingStoreOrders = onSchedule({ schedule: "every 2 minutes", maxInstances: 1, timeoutSeconds: 120 }, async () => {
  const now = Date.now();
  const snap = await db.collection("orders").where("status", "==", "pending").get();

  for (const docSnap of snap.docs) {
    const o = docSnap.data();
    if (!o.comercioId || o.isFavor || o.isTrip || o.isShopper || o.isScheduled) continue;
    const age = now - tsToMs(o.createdAt);
    if (!(age >= STORE_REMINDER_EVERY_MS - 15000) || age > 40 * 60 * 1000) continue;

    try {
      const remRef = db.collection("storeOrderReminders").doc(docSnap.id);
      const rem = (await remRef.get()).data() || {};
      const count = rem.count || 0;
      if (count >= STORE_REMINDER_MAX) continue;
      if (rem.lastAt && now - tsToMs(rem.lastAt) < STORE_REMINDER_EVERY_MS - 15000) continue;

      await remRef.set({ count: count + 1, lastAt: new Date(), comercioId: o.comercioId }, { merge: true });

      const orderNum = o.orderId || docSnap.id.slice(0, 6);
      const minutes = Math.max(1, Math.round(age / 60000));
      // Comercio sin dispositivos: los admins ya recibieron el aviso al entrar el pedido; se
      // les repite solo en el primer recordatorio (sigue sin aceptar a los 2 minutos)
      const result = await notifyCommerceOrder(docSnap.id, o, {
        title: `Pedido #${orderNum} sin aceptar`,
        body: `Entró hace ${minutes} min. ${orderLine(o)}. Aceptalo o rechazalo.`
      }, { goMarketToAdmins: true, alertAdmins: count === 0 });
      if (result.sent === 0 && result.reason !== "dueno_admin") {
        await remRef.set({ unreachable: result.reason }, { merge: true });
      }
    } catch (err) {
      logger.error(`[StoreReminder] ${docSnap.id}:`, err);
    }
  }
});

// settings/weather.isRaining es siempre lo que detecta el modo automático (también con el
// modo manual puesto, así al volver a "Automático" ya está al día). El modo manual se
// aplica al leer, en el cliente (state.js) y al crear pedidos.
exports.checkWeatherPeriodic = onSchedule("*/10 * * * *", async (event) => {
  try {
    const settingsSnap = await db.collection("settings").doc("global").get();
    const globalSettings = settingsSnap.exists ? settingsSnap.data() : {};
    const rainMode = globalSettings.rainMode || "auto";

    const weatherRef = db.collection("settings").doc("weather");
    const weatherSnap = await weatherRef.get();
    const prev = weatherSnap.exists ? weatherSnap.data() : {};
    const wasRaining = prev.isRaining === true;

    const detection = await detectRainInMagdalena();
    let isRaining = wasRaining;
    let dryChecks = Number(prev.dryChecks) || 0;
    if (!detection.unknown) {
      if (detection.wet) {
        isRaining = true;
        dryChecks = 0;
      } else {
        dryChecks += 1;
        isRaining = wasRaining && dryChecks < RAIN_OFF_AFTER_DRY_CHECKS;
      }
    }

    const update = {
      isRaining,
      dryChecks,
      checkedAt: FieldValue.serverTimestamp(),
      sources: { openMeteo: detection.openMeteo, metarLaPlata: detection.metar },
      lastError: detection.errors.length ? detection.errors.join(" | ") : null,
    };
    if (isRaining !== wasRaining) update.updatedAt = FieldValue.serverTimestamp();

    const charging = rainMode === "on" ? true : rainMode === "off" ? false : isRaining;
    // Docs de antes de este cambio no tienen chargingRain: se toma isRaining para no
    // repetir el aviso a los cadetes en la primera corrida.
    const wasCharging = prev.chargingRain === undefined ? wasRaining : prev.chargingRain === true;
    update.chargingRain = charging;
    const lastPushMs = prev.lastRainPushAt?.toDate ? prev.lastRainPushAt.toDate().getTime() : 0;
    const shouldPush = charging && !wasCharging && Date.now() - lastPushMs > RAIN_PUSH_MIN_GAP_MS;
    if (shouldPush) update.lastRainPushAt = FieldValue.serverTimestamp();

    await weatherRef.set(update, { merge: true });

    if (isRaining !== wasRaining) {
      logger.info(`[Lluvia] cambio de estado automático: ${wasRaining} -> ${isRaining}`);
    }

    if (shouldPush) {
      const msgs = globalSettings.pushMessages || {};
      const title = msgs?.rain?.title || "🌧 ¡Empezó a llover!";
      const body = msgs?.rain?.body || "El recargo por lluvia está activo. ¡Conducí con cuidado!";

      // Notify all deliveries
      const driverDocs = await getAllDeliveryDrivers();
      let allDriverTokens = [];
      for (const doc of driverDocs) {
        const t = await getUserTokens(doc.id);
        allDriverTokens = allDriverTokens.concat(t);
      }
      allDriverTokens = [...new Set(allDriverTokens)];

      if (allDriverTokens.length > 0) {
        await sendPush(allDriverTokens, { title, body }, { tag: "rain-surcharge", url: "#/delivery" });
      }
    }
  } catch (e) {
    logger.error("Error in checkWeatherPeriodic:", e);
  }
});

exports.checkNightSurchargeSchedule = onSchedule("*/5 * * * *", async (event) => {
  try {
    const settingsSnap = await db.collection("settings").doc("global").get();
    if (!settingsSnap.exists) return;
    
    const globalSettings = settingsSnap.data();
    const config = globalSettings.nightSurchargeConfig;
    if (!config || !config.enabled) {
      await db.collection("settings").doc("night_surcharge_state").set({
        isActive: false,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    const isCurrentlyActive = isScheduleActive(config);
    const stateRef = db.collection("settings").doc("night_surcharge_state");
    const stateSnap = await stateRef.get();
    const wasActive = stateSnap.exists ? !!stateSnap.data().isActive : false;

    const startStr = config.start || "00:00";
    const endStr = config.end || "06:00";
    const msgs = globalSettings.pushMessages || {};

    if (isCurrentlyActive && !wasActive) {
      // Night Surcharge START window reached!
      await stateRef.set({
        isActive: true,
        lastNotifiedStart: FieldValue.serverTimestamp()
      }, { merge: true });

      const title = msgs.night?.title || "🌙 ¡Comenzó el Recargo Nocturno!";
      const body = msgs.night?.body || `El recargo nocturno de entregas ya está activo (${startStr} a ${endStr} hs). Se aplica una tarifa adicional a los envíos.`;

      const driverDocs = await getAllDeliveryDrivers();
      let allDriverTokens = [];
      for (const doc of driverDocs) {
         const t = await getUserTokens(doc.id);
         allDriverTokens = allDriverTokens.concat(t);
      }
      allDriverTokens = [...new Set(allDriverTokens)];

      if (allDriverTokens.length > 0) {
        await sendPush(allDriverTokens, { title, body }, { tag: "night-surcharge-start", url: "#/delivery" });
        logger.info(`Night Surcharge START push sent (${startStr} to ${endStr}) to ${allDriverTokens.length} drivers.`);
      }
    } else if (!isCurrentlyActive && wasActive) {
      // Night Surcharge END window reached!
      await stateRef.set({
        isActive: false,
        lastNotifiedEnd: FieldValue.serverTimestamp()
      }, { merge: true });

      const title = "☀️ ¡Finalizó el Recargo Nocturno!";
      const body = `El horario de recargo nocturno (${startStr} a ${endStr} hs) ha finalizado. Las tarifas han vuelto al valor habitual.`;

      const driverDocs = await getAllDeliveryDrivers();
      let allDriverTokens = [];
      for (const doc of driverDocs) {
         const t = await getUserTokens(doc.id);
         allDriverTokens = allDriverTokens.concat(t);
      }
      allDriverTokens = [...new Set(allDriverTokens)];

      if (allDriverTokens.length > 0) {
        await sendPush(allDriverTokens, { title, body }, { tag: "night-surcharge-end", url: "#/delivery" });
        logger.info(`Night Surcharge END push sent (${startStr} to ${endStr}) to ${allDriverTokens.length} drivers.`);
      }
    }
  } catch (e) {
    logger.error("Error in checkNightSurchargeSchedule:", e);
  }
});

exports.onOfferCreated = onDocumentCreated("offers/{offerId}", async (event) => {
  // Push notification on offer creation disabled per user request
  return;
});

exports.onAdCreated = onDocumentCreated("ads/{adId}", async (event) => {
  const ad = event.data.data();
  if (!ad) return;
  const title = ad.title || "¡Nueva Publicidad!";
  const body = ad.body || "Mirá lo que hay de nuevo para vos.";
  try {
    const tokensSnap = await db.collectionGroup("fcmTokens").get();
    const tokens = [...new Set(tokensSnap.docs.map(d => d.data().token).filter(Boolean))];
    
    if (tokens.length > 0) {
      await sendPush(tokens, { title, body }, { tag: `ad-${event.params.adId}`, url: "#/" });
    }
  } catch (e) {
    logger.error("Error sending ad push:", e);
  }
});

exports.onSettingsUpdated = onDocumentUpdated("settings/global", async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const msgs = after.pushMessages || {};
  
  try {
    // Note: Night Surcharge push is handled automatically by checkNightSurchargeSchedule per active schedule hours (00:00 to 06:00 hs).
    
    // Check Driver Incentive
    if (!before.driverIncentiveConfig?.enabled && after.driverIncentiveConfig?.enabled) {
      const title = msgs.incentive?.title || "🚀 ¡Incentivo Activo!";
      const body = msgs.incentive?.body || "Salí a repartir ahora y ganá un extra por cada pedido.";
      
      const driverDocs = await getAllDeliveryDrivers();
      let allDriverTokens = [];
      for (const doc of driverDocs) {
         const t = await getUserTokens(doc.id);
         allDriverTokens = allDriverTokens.concat(t);
      }
      allDriverTokens = [...new Set(allDriverTokens)];
      
      if (allDriverTokens.length > 0) {
        await sendPush(allDriverTokens, { title, body }, { tag: "incentive-surcharge", url: "#/delivery" });
      }
    }
  } catch (e) {
    logger.error("Error sending settings push:", e);
  }
});


// ═══════════════════════════════════════════════════
// SCHEDULED TRIPS - Periodic Checker (every 10 min)
// ═══════════════════════════════════════════════════
exports.checkScheduledTrips = onSchedule({
  schedule: "every 10 minutes",
  timeZone: "America/Argentina/Buenos_Aires",
  memory: "256Mi"
}, async (event) => {
  try {
    const now = Timestamp.now();
    const nowMs = now.toMillis();
    
    // Window: trips scheduled between now and 2h10m from now (to catch within each 10-min cycle)
    const twoHoursFromNow = new Timestamp(
      Math.floor((nowMs + 2 * 60 * 60 * 1000) / 1000), 0
    );
    const twoHoursTenFromNow = new Timestamp(
      Math.floor((nowMs + 2 * 60 * 60 * 1000 + 10 * 60 * 1000) / 1000), 0
    );

    // 1. Send 2-hour reminders to assigned drivers
    const reminderSnap = await db.collection("orders")
      .where("status", "==", "scheduled")
      .where("isTrip", "==", true)
      .where("scheduledFor", ">=", twoHoursFromNow)
      .where("scheduledFor", "<=", twoHoursTenFromNow)
      .get();

    for (const doc of reminderSnap.docs) {
      const trip = doc.data();
      if (!trip.driverId) continue;
      if (trip._reminderSent) continue; // Already sent

      const tokens = await getUserTokens(trip.driverId);
      if (tokens.length > 0) {
        const scheduledTime = trip.scheduledFor.toDate();
        const timeStr = scheduledTime.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
        
        await sendPush(tokens, {
          title: `Viaje programado a las ${timeStr}`,
          body: `Faltan 2 horas. Destino: ${trip.deliveryAddress || "sin dirección"}.`
        }, { tag: `scheduled-trip-reminder-${doc.id}`, url: "#/delivery" });
      }

      // Also notify the passenger
      if (trip.userId) {
        const userTokens = await getUserTokens(trip.userId);
        if (userTokens.length > 0) {
          await sendPush(userTokens, {
            title: "Tu viaje es en 2 horas",
            body: `Te vamos a buscar para ir a ${trip.deliveryAddress || "tu destino"}.`
          }, { tag: `scheduled-trip-passenger-reminder-${doc.id}`, url: `#/pedido/${doc.id}` });
        }
      }

      // Mark as reminded to avoid duplicate sends
      await doc.ref.update({ _reminderSent: true });
      logger.info(`Sent 2h reminder for scheduled trip ${doc.id}`);
    }

    // 2. Activate trips whose scheduled time has arrived (convert to 'ready')
    const activateSnap = await db.collection("orders")
      .where("status", "==", "scheduled")
      .where("isTrip", "==", true)
      .where("scheduledFor", "<=", now)
      .get();

    for (const doc of activateSnap.docs) {
      const trip = doc.data();
      
      if (trip.driverId) {
        // Has an assigned driver → set status to 'ready' so the driver can start
        await doc.ref.update({ status: "ready" });
        
        const tokens = await getUserTokens(trip.driverId);
        if (tokens.length > 0) {
          await sendPush(tokens, {
            title: "Es hora de tu viaje programado",
            body: `Buscá al pasajero en ${trip.pickupAddress || "la dirección indicada"}.`
          }, { tag: `scheduled-trip-start-${doc.id}`, url: "#/delivery" });
        }
        logger.info(`Activated scheduled trip ${doc.id} (has driver ${trip.driverId})`);
      } else {
        // No driver assigned yet → notify user to re-search or wait, but do NOT cancel automatically
        logger.info(`Scheduled trip ${doc.id} reached time without assigned driver. Leaving active.`);
        if (trip.userId) {
          const userTokens = await getUserTokens(trip.userId);
          if (userTokens.length > 0) {
            await sendPush(userTokens, {
              title: "Estamos buscando tu chofer",
              body: "Tu viaje programado ya está activo. Te avisamos apenas lo tome alguien."
            }, { tag: `scheduled-trip-reminder-${doc.id}`, url: "#/viajes" });
          }
        }
      }
    }

    logger.info(`Scheduled trip check completed. Reminders: ${reminderSnap.size}, Activations: ${activateSnap.size}`);
  } catch (err) {
    logger.error("Error in checkScheduledTrips:", err);
  }
});

// ═══════════════════════════════════════════════════
// SCHEDULED COMMERCE ORDERS - Periodic Checker (every 1 min)
// ═══════════════════════════════════════════════════
exports.checkScheduledCommerceOrders = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "America/Argentina/Buenos_Aires",
  memory: "256Mi"
}, async (event) => {
  try {
    const now = Timestamp.now();
    const nowMs = now.toMillis();
    
    // Queremos activar pedidos que esten en 'preparing' y cuyo scheduledFor sea <= dentro de 5 minutos
    const fiveMinsFromNow = new Timestamp(
      Math.floor((nowMs + 5 * 60 * 1000) / 1000), 0
    );

    const scheduledOrdersSnap = await db.collection("orders")
      .where("status", "==", "preparing")
      .where("isScheduled", "==", true)
      .where("scheduledFor", "<=", fiveMinsFromNow)
      .get();

    if (scheduledOrdersSnap.empty) return;

    const batch = db.batch();
    let activatedCount = 0;

    for (const doc of scheduledOrdersSnap.docs) {
      // Con productos por peso lo pasa a "Listo" el comercio, cuando carga lo que pesó
      if (doc.data().weighPending === true) continue;
      batch.update(doc.ref, { 
        status: "ready", 
        updatedAt: FieldValue.serverTimestamp() 
      });
      activatedCount++;
    }

    if (activatedCount > 0) {
      await batch.commit();
      logger.info(`checkScheduledCommerceOrders: Activated ${activatedCount} scheduled orders to 'ready'.`);
    }

  } catch (err) {
    logger.error("Error in checkScheduledCommerceOrders:", err);
  }
});

/**
 * Trigger: Nuevo producto creado en el Marketplace → Notificar a Administradores
 */
exports.onMarketplaceProductCreated = onDocumentCreated("marketplace_products/{productId}", async (event) => {
  const product = event.data.data();
  if (!product) return;

  // Solo notificar si se crea en estado pendiente
  if (product.status === "pending") {
    try {
      const adminTokens = await getAdminTokens();
      if (adminTokens.length > 0) {
        await sendPush(adminTokens, {
          title: "Publicación para revisar",
          body: `"${product.title}" espera tu aprobación.`
        }, { tag: `moderation-product-${event.params.productId}`, url: "#/admin/marketplace" });
      }
      logger.info(`Admin notification push sent for pending product ${event.params.productId}`);
    } catch (err) {
      logger.error("Error sending marketplace moderation push notification:", err);
    }
  }
});

/**
 * Scheduled task: Check for scheduled push broadcasts and deliver them (runs every 1 minute)
 */
exports.processScheduledBroadcasts = onSchedule({ schedule: "*/1 * * * *", maxInstances: 1, timeoutSeconds: 300 }, async () => {
  try {
    const snap = await db.collection("broadcasts")
      .where("status", "==", "scheduled")
      .where("scheduledAt", "<=", Timestamp.now())
      .get();

    if (!snap.empty) logger.info(`Found ${snap.size} scheduled push campaigns to process.`);

    for (const doc of snap.docs) {
      const campaign = doc.data();
      const campaignId = doc.id;

      // 1. Instantly mark as sending to prevent double-runs
      await db.collection("broadcasts").doc(campaignId).update({
        status: "sending"
      });

      const { title, body, url, targetAudience, imageUrl } = campaign;

      // 2. Fetch target tokens
      let targetTokens = [];
      try {
        targetTokens = await tokensForAudience(db, targetAudience || "all", { owners: tokenOwners });
      } catch (tokenErr) {
        logger.error(`Error querying tokens for scheduled campaign ${campaignId}:`, tokenErr);
      }
      const sentCount = targetTokens.length;

      // 3. Send the campaign
      if (targetTokens.length > 0) {
        try {
          await sendPush(targetTokens, {
            title: title || "Go Delivery",
            body: body
          }, {
            url: url || "/#/",
            type: "custom_global_push",
            broadcastId: campaignId,
            imageUrl: imageUrl || ""
          });
          logger.info(`Scheduled campaign ${campaignId} sent successfully to ${sentCount} devices.`);
        } catch (sendErr) {
          logger.error(`Error sending push for scheduled campaign ${campaignId}:`, sendErr);
        }
      }

      // 4. Mark as completed
      await db.collection("broadcasts").doc(campaignId).update({
        status: "sent",
        sentCount: sentCount || 0,
        sentAt: FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    logger.error("Error in processScheduledBroadcasts:", err);
  }

  // Pushes automáticas (functions/push-automaticas.js). Antes estaban después de un "return" que
  // cortaba cuando no había campañas programadas, así que nunca salía ninguna.
  try {
    await runPushAutomations({ db, sendPush, tokenOwners });
  } catch (err) {
    logger.error("[Push automáticas] Error:", err);
  }
});

/**
 * Trigger: reseña creada, cambiada o borrada → promedio de estrellas del comercio.
 * Antes lo recalculaba la app del cliente, pero ratingAverage/ratingCount solo los escribe el
 * admin (firestore.rules): la reseña se guardaba, el promedio nunca cambiaba y el cliente veía
 * "Error al enviar calificación" (Admin → Errores, 11-10-2026).
 */
exports.onReviewWritten = onDocumentWritten("reviews/{reviewId}", async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const ids = new Set([before?.comercioId, after?.comercioId].filter(id => typeof id === "string" && id));
  for (const comercioId of ids) {
    try {
      const snap = await db.collection("reviews").where("comercioId", "==", comercioId).get();
      const ratings = snap.docs.map(d => Number(d.data().rating)).filter(r => r >= 1 && r <= 5);
      const ratingCount = ratings.length;
      const ratingAverage = ratingCount ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratingCount) * 100) / 100 : 0;
      await db.collection("comercios").doc(comercioId).set({ ratingAverage, ratingCount }, { merge: true });
    } catch (err) {
      logger.error(`[Reseñas] No se pudo recalcular el promedio de ${comercioId}:`, err);
    }
  }
});

/**
 * Trigger: Support chat written → Notify Admins of new tickets and bug reports
 */
exports.onSupportChatWritten = onDocumentWritten("support_chats/{userId}", async (event) => {
  const data = event.data.after ? event.data.after.data() : null;
  const previousData = event.data.before ? event.data.before.data() : null;

  if (!data) return;

  // Charlas de WhatsApp: lo que responde el equipo se le manda al cliente por ahí
  if (data.source === "whatsapp_bot" || data.isWhatsAppBot === true) {
    try {
      await wa().notify.onSupportChat(event.params.userId, previousData, data);
    } catch (err) {
      logger.error(`[WhatsApp] Error reenviando soporte a ${event.params.userId}:`, err);
    }
  }

  const ticketId = data.ticketId || data.orderId || event.params.userId;
  const userName = data.userName || data.clientName || "Usuario";
  const lastMessageText = data.lastMessageText || (data.messages && data.messages.length > 0 ? (data.messages[data.messages.length - 1].text || "Mensaje") : "Mensaje");
  const unreadByAdmin = data.unreadByAdmin === true;
  const unreadByUser = data.unreadByUser === true;

  const prevMsgCount = (previousData && Array.isArray(previousData.messages)) ? previousData.messages.length : 0;
  const currMsgCount = (Array.isArray(data.messages)) ? data.messages.length : 0;
  const lastMsg = (Array.isArray(data.messages) && data.messages.length > 0) ? data.messages[data.messages.length - 1] : null;
  const lastMsgIsFromUser = !lastMsg || (lastMsg.sender !== "admin" && lastMsg.sender !== "support" && lastMsg.sender !== "system");

  // 1. Notify Admin on new message from user/client
  const isNewlyUnread = (unreadByAdmin && (!previousData || previousData.unreadByAdmin !== true)) ||
                        (unreadByAdmin && currMsgCount > prevMsgCount && lastMsgIsFromUser);

  if (isNewlyUnread) {
    try {
      const adminDocs = await getAllAdminDocs();
      const adminTokens = await getAdminTokens();
      
      const title = `Soporte: Mensaje de ${userName}`;
      const body = lastMessageText.length > 120 ? lastMessageText.substring(0, 117) + "..." : lastMessageText;
      const url = `/#/admin/support-chats?userId=${event.params.userId}`;

      // Push notifications to admin devices
      if (adminTokens.length > 0) {
        logger.info(`Sending support ticket push notification to ${adminTokens.length} admins.`);
        await sendPush(adminTokens, {
          title: title,
          body: body
        }, {
          url: url,
          type: "new_support_ticket",
          ticketId: String(ticketId || "")
        });
      }

      // In-app notifications for all admins
      const notifPromises = adminDocs.map(adminDoc => {
        return db.collection("users").doc(adminDoc.id).collection("notifications").add({
          title: title,
          body: body,
          type: "support_message",
          url: url,
          ticketId: String(ticketId || ""),
          userId: event.params.userId,
          status: "unread",
          createdAt: FieldValue.serverTimestamp()
        }).catch(e => logger.warn(`Could not add in-app notif for admin ${adminDoc.id}:`, e));
      });
      await Promise.all(notifPromises);
    } catch (err) {
      logger.error(`Error sending push/in-app notif for support chat of user ${event.params.userId}:`, err);
    }
  }

  // 2. Notify User on response from admin
  const isNewlyUnreadByUser = (unreadByUser && (!previousData || previousData.unreadByUser !== true)) ||
                              (unreadByUser && currMsgCount > prevMsgCount && !lastMsgIsFromUser);

  if (isNewlyUnreadByUser) {
    try {
      const targetUserId = data.userId || event.params.userId;
      const targetTokens = await getUserTokens(targetUserId);

      const title = "Soporte Técnico GO! Delivery";
      const body = lastMessageText || "Tienes una nueva respuesta del administrador.";
      const url = "/#/mis-chats";

      if (targetTokens.length > 0) {
        logger.info(`Sending support chat response push notification to user ${targetUserId}.`);
        await sendPush(targetTokens, {
          title: title,
          body: body
        }, {
          url: url,
          type: "support_message"
        });
      }

      // In-app notification for the user
      await db.collection("users").doc(targetUserId).collection("notifications").add({
        title: title,
        body: body,
        type: "support_message",
        url: url,
        status: "unread",
        createdAt: FieldValue.serverTimestamp()
      }).catch(e => logger.warn(`Could not add in-app notif for user ${targetUserId}:`, e));
    } catch (err) {
      logger.error(`Error sending push response to user ${event.params.userId}:`, err);
    }
  }
});

exports.getServerTime = onRequest({ cors: true }, (req, res) => {
  res.status(200).json({ serverTime: Date.now() });
});

/**
 * Scheduler: Rotate expired queue offers every minute.
 *
 * When a driver is offered an order, they have 30 seconds to accept.
 * On Android, setInterval is frozen when the screen locks, so client-side
 * rotation never fires. This function runs server-side every minute and
 * rotates any order whose offer has been sitting for >35 seconds without
 * being accepted, ensuring the next driver always gets the offer even
 * if all apps are in background or closed.
 */
async function processExpiredAndUnassignedOffers() {
  const OFFER_TIMEOUT_MS = 60 * 1000; // 60-second limit for driver offer acceptance
  const now = Date.now();
  const cutoff = new Date(now - OFFER_TIMEOUT_MS);

  try {
    const pendingSnap = await db.collection("orders")
      .where("status", "in", ["pending", "confirmed", "preparing", "ready"])
      .get();

    const expiredOrders = [];
    const unassignedOrders = [];

    pendingSnap.docs.forEach(docSnap => {
      const o = docSnap.data();
      if (o.driverId) return; // Already accepted

      if (!o.queueTargetDriverId) {
        // Regular commerce orders must be ready before offering
        if (o.isFavor || o.isTrip || o.status === "ready") {
          unassignedOrders.push(docSnap);
        }
        return;
      }
      
      if (!o.queueOfferedAt) {
        expiredOrders.push(docSnap);
        return;
      }
      
      const offeredAt = o.queueOfferedAt.toDate ? o.queueOfferedAt.toDate() : new Date(o.queueOfferedAt);
      if (offeredAt.getTime() <= cutoff.getTime()) {
        expiredOrders.push(docSnap);
      }
    });

    // Dispatch unassigned orders
    for (const docSnap of unassignedOrders) {
      logger.info(`[RotateOffers] Dispatching unassigned active order ${docSnap.id}`);
      await serverSideDispatch(docSnap.id, docSnap.data());
    }

    if (expiredOrders.length === 0) {
      logger.info("[RotateOffers] No expired offers found.");
      return;
    }

    logger.info(`[RotateOffers] Found ${expiredOrders.length} expired offer(s). Rotating...`);

    for (const docSnap of expiredOrders) {
      const orderId = docSnap.id;
      const order = docSnap.data();
      const prevDriverId = order.queueTargetDriverId;

      logger.info(`[RotateOffers] Rotating order ${orderId} (was offered to ${prevDriverId})`);

      try {
        const rejected = [...(order.queueRejectedDrivers || []), prevDriverId];
        const updatedOrder = {
          ...order,
          queueRejectedDrivers: rejected,
          queueTargetDriverId: null,
          queueOfferedAt: null
        };

        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(db.collection("orders").doc(orderId));
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data();
          if (fresh.driverId || fresh.queueTargetDriverId !== prevDriverId) return;
          tx.update(db.collection("orders").doc(orderId), {
            queueTargetDriverId: null,
            queueOfferedAt: null,
            queueRejectedDrivers: rejected
          });
        });

        await serverSideDispatch(orderId, updatedOrder);
      } catch (orderErr) {
        logger.error(`[RotateOffers] Error rotating order ${orderId}:`, orderErr);
      }
    }
  } catch (err) {
    logger.error("[RotateOffers] Error processing offers:", err);
  }
}

exports.rotateExpiredOffers = onSchedule("every 1 minutes", async () => {
  logger.info("[RotateOffers] Starting background rotation pass (T+0s)...");
  await processExpiredAndUnassignedOffers();
  
  // Wait 30 seconds for mid-minute pass to guarantee 30s rotation cycle
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  logger.info("[RotateOffers] Starting background rotation pass (T+30s)...");
  await processExpiredAndUnassignedOffers();
});



// ═══════════════════════════════════════════════════
// DRIVER DISCONNECT NOTIFICATION
// Fires whenever a user document changes.
// If a delivery driver transitions from isOnline: true → isOnline: false,
// send them a push notification letting them know they were disconnected.
// This covers ALL disconnect scenarios: admin action, inactivity auto-logout,
// session expiry, app crash, etc.
// ═══════════════════════════════════════════════════
// Los disparadores de users/{userId} corren con CADA cambio de cualquier perfil (ubicación de los
// repartidores cada minuto, actividad, tokens…). Con 1 evento por instancia y tope 20 se quedaban sin
// instancias y descartaban eventos ("no available instance", 79 veces el 13-10-2026). Casi todos terminan
// enseguida: una instancia atiende muchos a la vez (la concurrencia pide cpu 1).
const USERS_TRIGGER_OPTS = { document: "users/{userId}", cpu: 1, concurrency: 80, maxInstances: 20 };

exports.onDriverDisconnected = onDocumentUpdated(USERS_TRIGGER_OPTS, async (event) => {
  try {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    const userId = event.params.userId;

    // Only care about delivery users
    const isDelivery = after.role === "delivery" || after.isDelivery === true;
    if (!isDelivery) return null;

    // Only fire when isOnline flips from true → false
    const wasOnline = before.isOnline === true;
    const nowOffline = after.isOnline === false || after.isOnline === null || after.isOnline === undefined;
    if (!wasOnline || !nowOffline) return null;

    const byInactivity = after.disconnectedReason === "inactivity";
    const byDebtLimit = after.disconnectedReason === "debt_limit";
    const driverName = after.displayName || after.name || "Repartidor";
    logger.info(`[DriverDisconnect] ${driverName} (${userId}) went offline (reason=${after.disconnectedReason || "unknown"}). Sending push notification.`);

    const notifBody = byDebtLimit
      ? "No pudiste conectarte porque tu saldo supera el tope de deuda. Pagá desde Mi cuenta → Pagar y volvé a conectarte."
      : byInactivity
        ? "Te desconectamos porque no respondiste el aviso de inactividad. Volvé a conectarte desde el Panel de Repartidor cuando quieras."
        : "Tu sesión de repartidor fue cerrada. Volvé a conectarte desde el Panel de Repartidor.";

    // 1. Write in-app notification so it appears in the drawer
    await db.collection("users").doc(userId).collection("notifications").add({
      title: byDebtLimit ? "⛔ Tope de deuda superado" : "🔴 Sesión finalizada",
      body: notifBody,
      type: "driver_disconnected",
      url: "#/delivery-panel",
      status: "unread",
      createdAt: FieldValue.serverTimestamp()
    });

    // 2. Send push notification to the driver's FCM tokens
    const tokens = await getUserTokens(userId);
    if (tokens.length > 0) {
      await sendPush(tokens, {
        title: byDebtLimit ? "⛔ Tope de deuda superado" : "🔴 Sesión finalizada",
        body: byDebtLimit
          ? "Tu saldo supera el tope de deuda. Pagá desde Mi cuenta para volver a conectarte."
          : byInactivity
            ? "Te desconectamos por 2 horas sin actividad. Tocá para volver a conectarte."
            : "Tu sesión de repartidor fue cerrada. Tocá para volver a conectarte."
      }, {
        type: "driver_disconnected",
        url: "#/delivery-panel",
        tag: `driver-disconnected-${userId}`
      });
      logger.info(`[DriverDisconnect] Push sent to ${tokens.length} token(s) for driver ${userId}.`);
    } else {
      logger.warn(`[DriverDisconnect] No FCM tokens found for driver ${userId}. In-app notification written only.`);
    }

    return null;
  } catch (err) {
    logger.error("[DriverDisconnect] Error:", err);
    return null;
  }
});

// ═══════════════════════════════════════════════════
// Mantiene settings/driverAvailability.onlineCount actualizado cada vez que
// un cadete cambia su estado online. Las reglas de Firestore sólo dejan
// "list" sobre users/ a staff, así que el cliente (rol "user") no puede
// contar cadetes online por su cuenta; este contador se lee con un simple
// "get", permitido para cualquier logueado.
// ═══════════════════════════════════════════════════
function isDeliveryDoc(data) {
  if (!data) return false;
  const role = (data.role || "").toLowerCase();
  return data.isDelivery === true || data.isDelivery === "true" || ["delivery", "driver", "repartidor", "chofer"].includes(role);
}

async function recomputeDriverAvailability() {
  const snap = await db.collection("users").where("isOnline", "==", true).get();
  const onlineCount = snap.docs.filter((d) => isDeliveryDoc(d.data())).length;

  await db.collection("settings").doc("driverAvailability").set({
    onlineCount,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return onlineCount;
}

exports.onDriverOnlineStatusChanged = onDocumentWritten(USERS_TRIGGER_OPTS, async (event) => {
  try {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;

    const wasOnline = isDeliveryDoc(before) && before.isOnline === true;
    const isOnline = isDeliveryDoc(after) && after.isOnline === true;

    // Sólo recalcular si efectivamente cambió el estado online de un cadete.
    if (wasOnline === isOnline) return null;

    await recomputeDriverAvailability();
    // Clientes de WhatsApp que pidieron "Avisame" cuando no había cadetes
    if (isOnline) await wa().notify.onDriverOnline().catch((err) => logger.error("[WhatsApp] Error avisando cadete conectado:", err));
    return null;
  } catch (err) {
    logger.error("[DriverAvailability] Error updating counter:", err);
    return null;
  }
});

// La cuota diaria ya no se cobra al conectarse: se suma al completar el pedido N° del día
// (settings/global.canonMinOrders), en functions/ledger.js.

// HISTORIA ANTERIOR: el admin crea system_jobs/{id} con type "import_driver_history" (botón en
// Repartidores → Configuración) y acá se trae al estado de cuenta de cada cadete lo que el sistema
// anterior registró. Es idempotente: un cadete ya importado se saltea.
exports.onSystemJob = onDocumentCreated({ document: "system_jobs/{jobId}", timeoutSeconds: 540, memory: "1GiB" }, async (event) => {
  const job = event.data.data();
  if (!job || job.type !== "import_driver_history") return null;
  const jobRef = event.data.ref;
  await jobRef.update({ status: "running", startedAt: FieldValue.serverTimestamp() });
  try {
    let ids = job.driverId ? [job.driverId] : [];
    if (!job.driverId) {
      const [byFlag, byRole] = await Promise.all([
        db.collection("users").where("isDelivery", "==", true).get(),
        db.collection("users").where("role", "in", ["delivery", "chofer", "driver", "repartidor"]).get()
      ]);
      ids = [...new Set([...byFlag.docs, ...byRole.docs].map((d) => d.id))];
    }
    const results = [];
    for (const id of ids) {
      try {
        results.push(await importLegacyHistory(id));
      } catch (err) {
        logger.error(`[HistoryImport] ${id} failed:`, err);
        results.push({ driverId: id, status: "error", error: err.message });
      }
    }
    const imported = results.filter((r) => r.status === "imported");
    await jobRef.update({
      status: "done",
      finishedAt: FieldValue.serverTimestamp(),
      drivers: ids.length,
      imported: imported.length,
      lines: imported.reduce((s, r) => s + (r.lines || 0), 0),
      errors: results.filter((r) => r.status === "error").map((r) => `${r.driverId}: ${r.error}`).slice(0, 20)
    });
    logger.info(`[HistoryImport] ${imported.length}/${ids.length} drivers imported`);
  } catch (err) {
    logger.error("[HistoryImport] job failed:", err);
    await jobRef.update({ status: "error", error: err.message, finishedAt: FieldValue.serverTimestamp() });
  }
  return null;
});

// TOPE DE DEUDA: un cadete que se conecta con el saldo por encima del tope vuelve a quedar
// desconectado (disconnectedReason "debt_limit"). Vive acá y no sólo en la app para que no se
// pueda saltear con una versión vieja o conectándolo desde otro lado.
exports.enforceDebtLimitOnConnect = onDocumentUpdated(USERS_TRIGGER_OPTS, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.isOnline === true || after.isOnline !== true || !isDeliveryDoc(after)) return null;
  try {
    await blockIfOverDebtLimit(event.params.userId);
  } catch (err) {
    logger.error(`[DebtLimit] Error checking ${event.params.userId}:`, err);
  }
  return null;
});

// Red de seguridad: recalcula el contador cada 5 minutos por si algún
// cambio de estado no disparó el trigger de arriba (o para poblarlo la
// primera vez después de un deploy, sin esperar al próximo cambio real).
exports.recomputeDriverAvailabilityPeriodic = onSchedule("*/5 * * * *", async () => {
  try {
    const onlineCount = await recomputeDriverAvailability();
    logger.info(`[DriverAvailability] Recomputed periodically: ${onlineCount} online.`);
  } catch (err) {
    logger.error("[DriverAvailability] Error in periodic recompute:", err);
  }
});

// --- GIVEAWAY FUNCTIONS ---
//
// Ciclo de vida de un sorteo (giveaways/{id}):
//   status: draft -> active -> ended -> drawing -> drawn
//   active: true/false = visible en /sorteo (lo prende y apaga el admin)
// Las chances solo las escribe el servidor: la regla de Firestore no deja
// que un cliente cree ni toque su entry.

const crypto = require("crypto");

const GIVEAWAY_ADMIN_EMAILS = ['kioscopaulos7@gmail.com'];
const GIVEAWAY_DEFAULT_RULES = { registration: 1, appInstalled: 2, referral: 2, order: 5 };
const GIVEAWAY_URL = '#/sorteo';
// Si un sorteo quedó en 'drawing' más de esto (la función murió a mitad), se puede volver a tomar.
const GIVEAWAY_DRAW_STALE_MS = 5 * 60 * 1000;

class GiveawayError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function giveawayRules(g) {
  const rules = { ...GIVEAWAY_DEFAULT_RULES };
  for (const [k, v] of Object.entries(g.chanceRules || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) rules[k] = Math.floor(n);
  }
  return rules;
}

function isGiveawayOpen(g, now = Date.now()) {
  if (g.active !== true || g.status !== 'active') return false;
  const endsMs = tsToMs(g.endsAt);
  return !endsMs || endsMs > now;
}

// Mismo criterio que isDelivery() de la app: hay repartidores con role 'client'
// que solo se distinguen por la marca de repartidor aprobado.
function isGiveawayDriver(r, userData = {}) {
  return ['driver', 'delivery', 'chofer', 'repartidor'].includes(r)
    || userData.isDelivery === true || userData.isDelivery === 'true'
    || userData.deliveryStatus === 'approved' || userData.tripStatus === 'approved';
}

// El equipo nunca participa: un sorteo público que gana alguien de adentro se ve mal.
function isGiveawayStaff(r, userData = {}) {
  const email = String(userData.email || '').toLowerCase().trim();
  return ['admin', 'superadmin'].includes(r) || userData.isAdmin === true
    || GIVEAWAY_ADMIN_EMAILS.includes(email) || email === 'juanhidalgobass@gmail.com';
}

function giveawayAudienceAllows(audience, role, userData = {}) {
  const r = (role || '').toString().toLowerCase();
  if (isGiveawayStaff(r, userData)) return false;
  if (!audience || audience === 'all') return true;
  if (audience === 'clients') return (!r || ['user', 'client'].includes(r)) && !isGiveawayDriver(r, userData);
  if (audience === 'drivers') return isGiveawayDriver(r, userData);
  if (audience === 'stores') return ['comercio', 'commerce'].includes(r);
  return true;
}

// Nombre que se muestra en el ranking público: nombre + inicial del apellido.
// Nunca el email (el ranking lo puede leer cualquiera).
function giveawayPublicName(authUser, userData = {}) {
  const raw = String(userData.displayName || userData.name || authUser?.displayName || '').trim();
  if (!raw || raw.includes('@')) return 'Vecino/a';
  const parts = raw.split(/\s+/).filter(Boolean);
  const name = parts.length > 1 ? `${parts[0]} ${parts[1][0].toUpperCase()}.` : parts[0];
  return name.slice(0, 32);
}

function newReferralCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GO-';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

async function isGiveawayAdmin(decodedToken) {
  if (GIVEAWAY_ADMIN_EMAILS.includes(decodedToken.email || '')) return true;
  const snap = await db.collection('users').doc(decodedToken.uid).get();
  const u = snap.exists ? snap.data() : {};
  return ['admin', 'superadmin'].includes(u.role) || u.isAdmin === true;
}

async function verifyBearer(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) throw new GiveawayError(401, 'unauthorized');
  try {
    return await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch (e) {
    throw new GiveawayError(401, 'unauthorized');
  }
}

/**
 * Anota a un usuario en el sorteo. Idempotente: si ya estaba, devuelve su entry.
 * El referido se acredita en la misma transacción que crea la entry, así un
 * doble click o dos pestañas no le suman dos veces al que invitó.
 */
async function createGiveawayEntry(giveawayRef, giveaway, uid, { referredBy = '' } = {}) {
  const entryRef = giveawayRef.collection('entries').doc(uid);
  const existing = await entryRef.get();
  if (existing.exists) return { created: false, entry: existing.data() };

  const [authUser, userDoc, fcmTokens] = await Promise.all([
    admin.auth().getUser(uid).catch(() => null),
    db.collection('users').doc(uid).get(),
    db.collection('users').doc(uid).collection('fcmTokens').limit(1).get()
  ]);
  const userData = userDoc.exists ? userDoc.data() : {};
  if (!giveawayAudienceAllows(giveaway.targetAudience, userData.role, { email: authUser?.email, ...userData })) {
    throw new GiveawayError(403, 'not_eligible');
  }

  const rules = giveawayRules(giveaway);
  const nowIso = new Date().toISOString();
  const breakdown = [];
  let chances = 0;
  if (rules.registration > 0) {
    chances += rules.registration;
    breakdown.push({ type: 'registration', label: 'Te anotaste', detail: 'Por sumarte al sorteo', amount: rules.registration, createdAt: nowIso });
  }
  const hasApp = !fcmTokens.empty || !!userData.lastFcmToken;
  if (hasApp && rules.appInstalled > 0) {
    chances += rules.appInstalled;
    breakdown.push({ type: 'app_installed', label: 'Notificaciones activas', detail: 'Por tener la app con avisos', amount: rules.appInstalled, createdAt: nowIso });
  }

  let referrerRef = null;
  const code = String(referredBy || '').trim().toUpperCase().slice(0, 20);
  if (code && rules.referral > 0) {
    const q = await giveawayRef.collection('entries').where('referralCode', '==', code).limit(1).get();
    if (!q.empty && q.docs[0].id !== uid) referrerRef = q.docs[0].ref;
  }

  const publicName = giveawayPublicName(authUser, userData);
  const entry = {
    userId: uid,
    userName: publicName,
    photoURL: authUser?.photoURL || '',
    chances,
    referralCode: newReferralCode(),
    referredBy: referrerRef ? code : '',
    referrals: 0,
    appBonus: hasApp && rules.appInstalled > 0,
    orderIds: [],
    breakdown,
    joinedAt: FieldValue.serverTimestamp()
  };

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(entryRef);
    if (snap.exists) return { created: false, entry: snap.data() };
    let totalDelta = chances;
    tx.set(entryRef, entry);
    if (referrerRef) {
      tx.update(referrerRef, {
        chances: FieldValue.increment(rules.referral),
        referrals: FieldValue.increment(1),
        breakdown: FieldValue.arrayUnion({
          type: 'referral', label: 'Invitaste a un vecino', detail: publicName,
          amount: rules.referral, createdAt: nowIso, refUid: uid
        })
      });
      totalDelta += rules.referral;
    }
    tx.update(giveawayRef, {
      totalParticipants: FieldValue.increment(1),
      totalChances: FieldValue.increment(totalDelta)
    });
    return { created: true, entry };
  });

  if (result.created && referrerRef) {
    await notifyGiveawayChances(referrerRef.id, giveawayRef.id,
      `🎟️ ¡Sumaste ${rules.referral} ${rules.referral === 1 ? 'chance' : 'chances'} en el sorteo!`,
      `${publicName} se anotó con tu código. ¡Seguí invitando vecinos!`);
  }
  return result;
}

/**
 * Avisa (campanita + push) que el usuario sumó chances. Nunca tira error:
 * un aviso que falla no puede deshacer ni frenar las chances ya acreditadas.
 */
async function notifyGiveawayChances(uid, giveawayId, title, body) {
  try {
    await db.collection('users').doc(uid).collection('notifications').add({
      title, body, type: 'giveaway_chances', status: 'unread', url: GIVEAWAY_URL,
      createdAt: FieldValue.serverTimestamp()
    });
    const tokens = await getUserTokens(uid);
    if (tokens.length) {
      await sendPush(tokens, { title, body }, { url: GIVEAWAY_URL, type: 'giveaway_chances', giveawayId }, uid);
    }
  } catch (e) {
    logger.warn(`[Giveaway] Could not notify chances to ${uid}:`, e);
  }
}

/** Suma chances por un pedido entregado. Anota solo al cliente si todavía no estaba. */
async function grantGiveawayOrderChances(orderId, order, orderNum) {
  const uid = order.userId;
  if (!uid) return;
  const snap = await db.collection('giveaways').where('status', '==', 'active').get();
  for (const gDoc of snap.docs) {
    const giveaway = gDoc.data();
    if (!isGiveawayOpen(giveaway)) continue;
    const rules = giveawayRules(giveaway);
    if (rules.order <= 0) continue;
    let joined;
    try {
      joined = await createGiveawayEntry(gDoc.ref, giveaway, uid);
    } catch (e) {
      if (e instanceof GiveawayError && e.code === 'not_eligible') continue;
      throw e;
    }
    const entryRef = gDoc.ref.collection('entries').doc(uid);
    const added = await db.runTransaction(async (tx) => {
      const s = await tx.get(entryRef);
      if (!s.exists || (s.data().orderIds || []).includes(orderId)) return false;
      tx.update(entryRef, {
        chances: FieldValue.increment(rules.order),
        orderIds: FieldValue.arrayUnion(orderId),
        // Sin detalle de productos ni comercio: las entries son de lectura pública.
        breakdown: FieldValue.arrayUnion({
          type: 'order', label: `Pedido #${orderNum || orderId.slice(0, 6)}`, detail: 'Pedido entregado',
          amount: rules.order, createdAt: new Date().toISOString(), orderId
        })
      });
      tx.update(gDoc.ref, { totalChances: FieldValue.increment(rules.order) });
      return true;
    });
    if (added) {
      logger.info(`[Giveaway] +${rules.order} chances to ${uid} for order ${orderId} (${gDoc.id})`);
      // Si el pedido lo anotó recién, se cuentan también las chances de anotarse.
      const total = rules.order + (joined?.created ? Number(joined.entry?.chances) || 0 : 0);
      await notifyGiveawayChances(uid, gDoc.id,
        `🎟️ ¡Sumaste ${total} ${total === 1 ? 'chance' : 'chances'} en el sorteo!`,
        joined?.created
          ? `Tu pedido #${orderNum || orderId.slice(0, 6)} te anotó en el sorteo. ¡Cada pedido suma más!`
          : `Por tu pedido #${orderNum || orderId.slice(0, 6)}. ¡Cada pedido suma más!`);
    }
  }
}

/** Suma las chances de "notificaciones activas" a quien ya estaba anotado y recién activa la app. */
async function grantGiveawayAppChances(uid) {
  const snap = await db.collection('giveaways').where('status', '==', 'active').get();
  for (const gDoc of snap.docs) {
    const giveaway = gDoc.data();
    if (!isGiveawayOpen(giveaway)) continue;
    const rules = giveawayRules(giveaway);
    if (rules.appInstalled <= 0) continue;
    const entryRef = gDoc.ref.collection('entries').doc(uid);
    const added = await db.runTransaction(async (tx) => {
      const s = await tx.get(entryRef);
      if (!s.exists || s.data().appBonus) return false;
      tx.update(entryRef, {
        chances: FieldValue.increment(rules.appInstalled),
        appBonus: true,
        breakdown: FieldValue.arrayUnion({
          type: 'app_installed', label: 'Notificaciones activas', detail: 'Por tener la app con avisos',
          amount: rules.appInstalled, createdAt: new Date().toISOString()
        })
      });
      tx.update(gDoc.ref, { totalChances: FieldValue.increment(rules.appInstalled) });
      return true;
    });
    if (added) {
      await notifyGiveawayChances(uid, gDoc.id,
        `🎟️ ¡Sumaste ${rules.appInstalled} ${rules.appInstalled === 1 ? 'chance' : 'chances'} en el sorteo!`,
        'Por activar las notificaciones de la app.');
    }
  }
}

/** Elige ganadores ponderando por chances, sin repetir persona. */
function pickGiveawayWinners(entries, prizes) {
  let pool = entries
    .map(e => ({ ...e, weight: Math.max(0, Math.floor(Number(e.chances) || 0)) }))
    .filter(e => e.userId && e.weight > 0);
  const sortedPrizes = [...prizes].sort((a, b) => (a.position || 0) - (b.position || 0));
  const winners = [];
  for (const prize of sortedPrizes) {
    if (!pool.length) break;
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let ticket = crypto.randomInt(total);
    let idx = 0;
    while (ticket >= pool[idx].weight) { ticket -= pool[idx].weight; idx++; }
    const w = pool[idx];
    pool = pool.filter((_, i) => i !== idx);
    winners.push({
      position: prize.position,
      userId: w.userId,
      userName: w.userName || 'Vecino/a',
      photoURL: w.photoURL || '',
      chances: w.weight,
      prizeAmount: prize.amount || '',
      prizeDescription: prize.description || '',
      prizePoints: Math.max(0, Math.floor(Number(prize.points) || 0)),
      prizePesos: Math.max(0, Math.floor(Number(prize.pesosValue) || 0))
    });
  }
  return winners;
}

/**
 * Realiza el sorteo. El paso a 'drawing' va en una transacción para que el
 * cron (sorteo automático) y el botón del admin nunca sorteen dos veces.
 */
async function performGiveawayDraw(giveawayId, { redraw = false, by = 'system' } = {}) {
  const ref = db.collection('giveaways').doc(giveawayId);
  const before = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new GiveawayError(404, 'not_found');
    const d = s.data();
    const drawingStale = d.status === 'drawing' && Date.now() - tsToMs(d.drawStartedAt) > GIVEAWAY_DRAW_STALE_MS;
    if (d.status === 'drawing' && !drawingStale) throw new GiveawayError(409, 'draw_in_progress', 'El sorteo ya se está realizando');
    if (d.status === 'drawn' && !redraw) throw new GiveawayError(409, 'already_drawn', 'Este sorteo ya se realizó');
    tx.update(ref, { status: 'drawing', drawStartedAt: FieldValue.serverTimestamp(), drawError: FieldValue.delete() });
    return d;
  });
  const previousStatus = before.status === 'drawing' ? 'ended' : before.status;

  let winners;
  let entriesCount = 0;
  let totalChances = 0;
  try {
    const entriesSnap = await ref.collection('entries').get();
    let entries = entriesSnap.docs.map(d => ({ ...d.data(), userId: d.data().userId || d.id }));
    // El público se vuelve a mirar al sortear: quien se anotó antes de que el
    // admin lo restringiera (o se volvió repartidor después) no puede ganar,
    // y el equipo (admins) queda afuera siempre.
    if (entries.length) {
      const userRefs = entries.map(e => db.collection('users').doc(e.userId));
      const users = new Map();
      for (let i = 0; i < userRefs.length; i += 300) {
        const snaps = await db.getAll(...userRefs.slice(i, i + 300));
        snaps.forEach(u => users.set(u.id, u.exists ? u.data() : {}));
      }
      const eligible = entries.filter(e => {
        const u = users.get(e.userId) || {};
        return giveawayAudienceAllows(before.targetAudience, u.role, u);
      });
      if (eligible.length !== entries.length) {
        logger.info(`[Giveaway] ${giveawayId}: ${entries.length - eligible.length} entries out of audience '${before.targetAudience}' left out of the draw`);
      }
      entries = eligible;
    }
    entriesCount = entries.length;
    totalChances = entries.reduce((s, e) => s + Math.max(0, Number(e.chances) || 0), 0);
    if (!(before.prizes || []).length) throw new GiveawayError(400, 'no_prizes', 'El sorteo no tiene premios cargados');
    if (!entriesCount || !totalChances) throw new GiveawayError(400, 'no_entries', 'No hay participantes');
    winners = pickGiveawayWinners(entries, before.prizes);
    await ref.update({
      status: 'drawn',
      drawnAt: FieldValue.serverTimestamp(),
      drawnBy: by,
      winners,
      participantsAtDraw: entriesCount,
      chancesAtDraw: totalChances,
      // El contador real, por si algún increment se perdió.
      totalParticipants: entriesCount,
      totalChances
    });
  } catch (err) {
    await ref.update({
      status: previousStatus === 'drawn' ? 'drawn' : 'ended',
      drawError: err.code || 'error'
    }).catch(() => {});
    throw err;
  }

  logger.info(`[Giveaway] ${giveawayId} drawn by ${by}: ${winners.map(w => w.userId).join(', ')}`);

  // Premios en Puntos GO: se acreditan solos. Si el premio vino solo en pesos
  // (sorteos viejos), se convierte con el valor del punto de settings/global.
  let dollarPerPoint = 1;
  try {
    const g = await db.collection('settings').doc('global').get();
    const v = Number(g.data()?.dollarPerPoint);
    if (Number.isFinite(v) && v > 0) dollarPerPoint = v;
  } catch (e) {
    logger.warn('[Giveaway] Could not read dollarPerPoint, using 1:', e);
  }

  for (const w of winners) {
    let credited = 0;
    const points = w.prizePoints || (w.prizePesos ? Math.round(w.prizePesos / dollarPerPoint) : 0);
    if (points > 0) {
      try {
        credited = await creditGiveawayPrize(giveawayId, before.title, w, points);
      } catch (e) {
        logger.error(`[Giveaway] Could not credit ${points} pts to winner ${w.userId}:`, e);
      }
    }
    try {
      const title = '🎉 ¡Ganaste el sorteo de GoDelivery!';
      const pesos = Math.round(points * dollarPerPoint);
      const body = credited
        ? `Te llevaste el ${w.position}° premio: te acreditamos ${credited.toLocaleString('es-AR')} Puntos GO ($${pesos.toLocaleString('es-AR')}). Ya los podés usar en tu próximo pedido.`
        : `Te llevaste el ${w.position}° premio: ${w.prizeAmount}. Te vamos a contactar para acreditarlo.`;
      await db.collection('users').doc(w.userId).collection('notifications').add({
        title, body, type: 'giveaway_winner', status: 'unread', url: GIVEAWAY_URL,
        createdAt: FieldValue.serverTimestamp()
      });
      const tokens = await getUserTokens(w.userId);
      if (tokens.length) {
        await sendPush(tokens, { title, body }, { url: GIVEAWAY_URL, type: 'giveaway_winner', giveawayId }, w.userId);
      }
    } catch (e) {
      logger.warn(`[Giveaway] Could not notify winner ${w.userId}:`, e);
    }
  }
  return winners;
}

/**
 * Acredita los Puntos GO de un premio. El id del movimiento es fijo por
 * sorteo + ganador, así un reintento o un "volver a sortear" que repite
 * ganador nunca le paga dos veces. Devuelve los puntos que tiene acreditados
 * por este sorteo (los de antes, si ya se le habían pagado).
 */
async function creditGiveawayPrize(giveawayId, giveawayTitle, winner, points) {
  const userRef = db.collection('users').doc(winner.userId);
  const txRef = db.collection('points_transactions').doc(`giveaway_${giveawayId}_${winner.userId}`);
  const done = await db.runTransaction(async (tx) => {
    const [prev, user] = await Promise.all([tx.get(txRef), tx.get(userRef)]);
    if (prev.exists) return { points: Number(prev.data().points) || 0, isNew: false };
    if (!user.exists) return { points: 0, isNew: false };
    tx.update(userRef, { points: FieldValue.increment(points) });
    tx.set(txRef, {
      userId: winner.userId,
      type: 'giveaway_prize',
      points,
      description: `${winner.position}° premio del sorteo ${giveawayTitle || 'GoDelivery'}`,
      giveawayId,
      createdAt: FieldValue.serverTimestamp()
    });
    return { points, isNew: true };
  });
  if (done.isNew) {
    await db.collection('giveaways').doc(giveawayId).update({
      [`credited.${winner.userId}`]: points
    }).catch(() => {});
    logger.info(`[Giveaway] Credited ${points} pts to ${winner.userId} (${giveawayId})`);
  }
  return done.points;
}

async function collectGiveawayAudienceTokens(audience) {
  const tokensSnap = await db.collectionGroup('fcmTokens').get();
  let docs = tokensSnap.docs;
  if (audience && audience !== 'all') {
    const roles = audience === 'clients' ? ['client', 'user', 'admin']
      : audience === 'drivers' ? ['driver', 'delivery', 'repartidor', 'chofer']
      : ['commerce', 'comercio'];
    const [usersSnap, adminsSnap] = await Promise.all([
      db.collection('users').where('role', 'in', roles).get(),
      // Los admins siempre ven los avisos del sorteo, tengan el rol que tengan (un admin que
      // también reparte tiene rol "delivery" y no le llegaba nada de un sorteo "para clientes")
      db.collection('users').where('isAdmin', '==', true).get(),
    ]);
    const allowed = new Set(usersSnap.docs
      .filter(d => giveawayAudienceAllows(audience, d.data().role, d.data()))
      .map(d => d.id));
    adminsSnap.docs.forEach(d => allowed.add(d.id));
    docs = docs.filter(d => allowed.has(d.ref.parent.parent?.id));
  }
  const tokens = [];
  for (const d of docs) {
    const t = d.data().token || d.id;
    if (typeof t !== 'string' || t.length <= 20) continue;
    // Dueño de cada token: así sendPush borra los que FCM da por muertos. Antes no se sabía de
    // quién eran y no se limpiaban nunca (11-10-2026: 335 de 829 fallaron en cada aviso).
    const owner = d.ref.parent.parent?.id;
    if (owner) tokenOwners.set(t, owner);
    tokens.push(t);
  }
  return [...new Set(tokens)];
}

async function sendGiveawayReminder(giveawayId, giveaway, title, body) {
  const tokens = await collectGiveawayAudienceTokens(giveaway.targetAudience);
  if (!tokens.length) return 0;
  await sendPush(tokens, { title, body }, {
    url: GIVEAWAY_URL, type: 'giveaway_reminder', giveawayId, tag: `giveaway-${giveawayId}`
  });
  return tokens.length;
}

// Reclama un aviso marcándolo antes de mandarlo: si el envío falla a medias
// es preferible perder un aviso que repetirlo a toda la base cada minuto.
async function claimGiveawayReminder(ref, key, endsMs) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.data() || {};
    if (d.status !== 'active' || tsToMs(d.endsAt) !== endsMs) return false;
    if ((d.notifications || {})[key] === endsMs) return false;
    tx.update(ref, { [`notifications.${key}`]: endsMs });
    return true;
  });
}

async function tickGiveaway(doc, now) {
  const g = doc.data();
  const endsMs = tsToMs(g.endsAt);

  if (g.status === 'active') {
    if (!endsMs) return;
    const remainingMin = (endsMs - now) / 60000;

    if (remainingMin <= 0) {
      await doc.ref.update({ status: 'ended', endedAt: FieldValue.serverTimestamp() });
      logger.info(`[Giveaway] ${doc.id} ended`);
      if (g.autoDraw === true) await performGiveawayDraw(doc.id, { by: 'auto' });
      return;
    }
    if (g.active !== true) return; // oculto: no se avisa

    // Las marcas guardan el endsAt para el que se mandó cada aviso:
    // si el admin mueve la fecha, los avisos vuelven a salir para la nueva.
    const sent = g.notifications || {};
    if (remainingMin <= 10 && sent.tenMinutesFor !== endsMs) {
      if (await claimGiveawayReminder(doc.ref, 'tenMinutesFor', endsMs)) {
        const mins = Math.max(1, Math.round(remainingMin));
        const count = await sendGiveawayReminder(doc.id, g,
          `🔥 ¡${mins === 1 ? 'Falta 1 minuto' : `Faltan ${mins} minutos`} para el sorteo!`,
          'Entrá ahora y miralo en vivo. ¡Puede ser tu día!');
        logger.info(`[Giveaway] 10m reminder for ${doc.id} sent to ${count} devices`);
      }
    } else if (remainingMin <= 60 && remainingMin > 15 && sent.oneHourFor !== endsMs) {
      if (await claimGiveawayReminder(doc.ref, 'oneHourFor', endsMs)) {
        const mins = Math.round(remainingMin);
        const count = await sendGiveawayReminder(doc.id, g,
          mins >= 55 ? '⏰ ¡Falta 1 hora para el sorteo!' : `⏰ ¡Faltan ${mins} minutos para el sorteo!`,
          'Todavía podés sumar chances: hacé un pedido o invitá a un vecino.');
        logger.info(`[Giveaway] 1h reminder for ${doc.id} sent to ${count} devices`);
      }
    }
    return;
  }

  if (g.status === 'ended' && g.autoDraw === true && !g.drawError) {
    await performGiveawayDraw(doc.id, { by: 'auto' });
    return;
  }

  // Un sorteo que quedó colgado en 'drawing' (la función murió a mitad).
  if (g.status === 'drawing' && now - tsToMs(g.drawStartedAt) > GIVEAWAY_DRAW_STALE_MS) {
    await doc.ref.update({ status: 'ended', drawError: 'stale' });
  }
}

function sendGiveawayError(res, err, fallbackLog) {
  if (err instanceof GiveawayError) {
    return res.status(err.status).send({ error: err.code, message: err.message });
  }
  logger.error(fallbackLog, err);
  return res.status(500).send({ error: 'internal', message: 'Error interno' });
}

exports.joinGiveaway = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const decoded = await verifyBearer(req);
    const { giveawayId, referredBy } = req.body || {};
    if (!giveawayId || typeof giveawayId !== 'string') throw new GiveawayError(400, 'missing_giveaway');

    const giveawayRef = db.collection('giveaways').doc(giveawayId);
    const giveawayDoc = await giveawayRef.get();
    if (!giveawayDoc.exists) throw new GiveawayError(404, 'not_found');
    const giveaway = giveawayDoc.data();

    const existing = await giveawayRef.collection('entries').doc(decoded.uid).get();
    if (existing.exists) return res.status(200).send({ success: true, created: false });
    if (!isGiveawayOpen(giveaway)) throw new GiveawayError(400, 'closed', 'El sorteo ya no recibe participantes');

    const result = await createGiveawayEntry(giveawayRef, giveaway, decoded.uid, { referredBy });
    res.status(200).send({ success: true, created: result.created });
  } catch (err) {
    sendGiveawayError(res, err, 'Error joining giveaway:');
  }
});

exports.manualGiveawayDraw = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const decoded = await verifyBearer(req);
    if (!(await isGiveawayAdmin(decoded))) throw new GiveawayError(403, 'forbidden', 'Solo un administrador puede sortear');
    const { giveawayId, redraw } = req.body || {};
    if (!giveawayId || typeof giveawayId !== 'string') throw new GiveawayError(400, 'missing_giveaway');
    const winners = await performGiveawayDraw(giveawayId, { redraw: redraw === true, by: decoded.uid });
    res.status(200).send({ success: true, winners });
  } catch (err) {
    sendGiveawayError(res, err, 'Error drawing giveaway:');
  }
});

exports.checkGiveawayNotifications = onSchedule("*/1 * * * *", async () => {
  const now = Date.now();
  const snap = await db.collection('giveaways').where('status', 'in', ['active', 'ended', 'drawing']).get();
  for (const doc of snap.docs) {
    try {
      await tickGiveaway(doc, now);
    } catch (err) {
      logger.error(`[Giveaway] Error processing ${doc.id}:`, err);
    }
  }
});

// Las funciones de Mango POS viven en su propio codebase: functions-mango/

// ═══════════════════════════════════════════════════
// BOT DE WHATSAPP (API oficial de Meta) — functions/whatsapp/
// ═══════════════════════════════════════════════════
let whatsappBot = null;
function wa() {
  if (!whatsappBot) {
    whatsappBot = require("./whatsapp").createWhatsApp({
      db,
      helpers: {
        computeDeliveryFee, computeEncomiendaFee, encomiendaMinFee, getDistance, calculateScheduleSurcharge, resolveAutoRain, commissionEnabled: COMMERCE_COMMISSION_ENABLED,
        // Sorteos desde el bot: mismas reglas que joinGiveaway (el uid es el del cliente de WhatsApp)
        giveaways: {
          async listOpen() {
            const snap = await db.collection("giveaways").where("status", "==", "active").get();
            return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((g) => isGiveawayOpen(g));
          },
          async entryOf(id, uid) {
            const e = await db.collection("giveaways").doc(id).collection("entries").doc(uid).get();
            return e.exists ? e.data() : null;
          },
          async join(id, uid) {
            const ref = db.collection("giveaways").doc(id);
            const snap = await ref.get();
            if (!snap.exists) return { error: "not_found" };
            const g = snap.data();
            const existing = await ref.collection("entries").doc(uid).get();
            if (existing.exists) return { created: false, entry: existing.data(), title: g.title };
            if (!isGiveawayOpen(g)) return { error: "closed" };
            try {
              const r = await createGiveawayEntry(ref, g, uid, {});
              return { ...r, title: g.title };
            } catch (err) {
              return { error: err.code || "failed" };
            }
          },
        },
      },
      push: { getUserTokens, sendPush, getAdminTokens },
    });
  }
  return whatsappBot;
}

// URL que se carga en Meta como webhook. Atiende la verificación (GET) y los mensajes (POST).
exports.whatsappWebhook = onRequest({ maxInstances: 10, timeoutSeconds: 60 }, (req, res) => wa().webhook(req, res));

// Link de seguimiento en vivo de los pedidos del bot (/en-vivo/{token}): cambia el token del link
// por una sesión del cliente de WhatsApp (functions/whatsapp/tracking.js).
exports.waTrackingSession = onRequest({ maxInstances: 10, timeoutSeconds: 30 }, (req, res) => wa().tracking.handle(req, res));

// Admin → Bot WhatsApp → Ajustes: vincular el número y ver cómo está (functions/whatsapp/link.js)
exports.waBotLink = onRequest({ cors: true, maxInstances: 2, timeoutSeconds: 60 }, (req, res) => wa().link.handle(req, res, { verifyIdToken: (t) => admin.auth().verifyIdToken(t) }));

// Pedido escrito a un comercio: aviso al comercio, precio o rechazo al cliente.
exports.onWhatsAppQuoteWritten = onDocumentWritten("wa_quotes/{quoteId}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  try {
    await wa().notify.onQuoteWritten(event.params.quoteId, before, after);
  } catch (err) {
    logger.error(`[WhatsApp] Error con la consulta ${event.params.quoteId}:`, err);
  }
});

exports.expireWhatsAppQuotes = onSchedule("every 2 minutes", async () => {
  await wa().notify.expireQuotes();
});

// ─── Ventra (sistema de caja) ↔ GoDelivery: ver functions/ventra-bridge.js ───
// La PC del comercio publica su catálogo y lee sus pedidos con una clave propia del comercio
// (se vincula con un código que genera un admin). Nunca con la clave de administrador de GO.
exports.ventraBridge = onRequest({ maxInstances: 10, timeoutSeconds: 120, memory: "512MiB" }, (req, res) =>
  ventraBridge.handle(db, admin.storage(), req, res, logger));

// Las fotos grandes (functions/hd-images.js) las busca el puente al recibir productos (ventra-bridge.js)

// "Compra el repartidor": el repartidor carga lo que encontró, lo que faltó y el ticket
exports.shopperCheckout = onRequest({ cors: true, maxInstances: 15 }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });
  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1])).uid;
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  try {
    return res.status(200).json(await ventraBridge.shopperCheckout(db, uid, req.body || {}));
  } catch (err) {
    if (err instanceof ventraBridge.BridgeError) return res.status(err.status).json({ error: err.message });
    logger.error("[shopperCheckout] error", err);
    return res.status(500).json({ error: "No se pudo guardar la compra" });
  }
});

// Lo que se agotó porque el repartidor no lo encontró vuelve a mostrarse a las 24 h
exports.restoreShopperUnavailable = onSchedule({ schedule: "every 60 minutes", maxInstances: 1 }, async () => {
  const n = await ventraBridge.restoreMissing(db);
  if (n) logger.info(`[shopper] ${n} productos vuelven a estar disponibles`);
});

// El cadete confirma que la casa está donde entregó (ver functions/pin-correction.js)
exports.correctDeliveryPin = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  const orderId = req.body && req.body.orderId;
  if (typeof orderId !== "string" || !orderId || orderId.includes("/")) return res.status(400).json({ error: "Pedido inválido" });
  try {
    return res.status(200).json(await require("./pin-correction").correctPin(db, decoded.uid, orderId));
  } catch (err) {
    logger.error("[correctDeliveryPin] error", err);
    return res.status(500).json({ error: "No se pudo guardar" });
  }
});

// Dueño y correos con acceso a cada comercio (ver functions/commerce-access.js)
exports.comercioAccess =onRequest({ cors: true, maxInstances: 10 }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "No autorizado" });
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  try {
    return res.status(200).json(await commerceAccess.handle({ db, auth: admin.auth(), decoded, body: req.body || {} }));
  } catch (err) {
    if (err instanceof commerceAccess.AccessError) return res.status(err.status).json({ error: err.message });
    logger.error("[comercioAccess] error", err);
    return res.status(500).json({ error: "No se pudo guardar" });
  }
});
