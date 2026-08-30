const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

setGlobalOptions({ maxInstances: 1, memory: "256Mi", region: "us-central1" });

admin.initializeApp();
const db = admin.firestore();

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
        mpConnectedAt: admin.firestore.FieldValue.serverTimestamp()
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

exports.createDeliveryCanonPreference = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const { driverId, dateStr } = req.body; // dateStr: YYYY-MM-DD
  if (!driverId || !dateStr) {
    return res.status(400).json({ error: "Faltan parámetros requeridos (driverId, dateStr)" });
  }

  try {
    // Read global canon settings from system config or default to $2000
    const configDoc = await db.collection("system_config").doc("canon_config").get();
    const configData = configDoc.exists ? configDoc.data() : {};
    const canonAmount = configData.canonAmount || 2000;
    const mpAccessToken = configData.mpAccessToken || process.env.MP_ACCESS_TOKEN || "APP_USR-7809623696860010-051512-42171c77bb506b3a2bbbb695123d463e-242686767";

    const driverDoc = await db.collection("users").doc(driverId).get();
    const driverData = driverDoc.exists ? driverDoc.data() : {};
    const driverName = driverData.name || driverData.displayName || "Repartidor GO";

    const client = new MercadoPagoConfig({ accessToken: mpAccessToken });
    const preferenceInstance = new Preference(client);

    const externalRef = `CANON_${driverId}_${dateStr}`;

    const response = await preferenceInstance.create({
      body: {
        items: [{
          title: `Canon Diario Repartidor GO! (${dateStr})`,
          unit_price: Number(canonAmount),
          quantity: 1,
          currency_id: "ARS"
        }],
        external_reference: externalRef,
        notification_url: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/mercadopagoWebhook?type=delivery_canon`,
        back_urls: {
          success: `https://${process.env.GCLOUD_PROJECT}.web.app/#/delivery?canon_status=success`,
          failure: `https://${process.env.GCLOUD_PROJECT}.web.app/#/delivery?canon_status=failure`,
          pending: `https://${process.env.GCLOUD_PROJECT}.web.app/#/delivery?canon_status=pending`
        },
        auto_return: "approved"
      }
    });

    res.status(200).json({
      id: response.id,
      init_point: response.init_point,
      sandbox_init_point: response.sandbox_init_point
    });
  } catch (err) {
    logger.error("Error generating delivery canon preference:", err);
    res.status(500).json({ error: err.message });
  }
});

exports.mercadopagoWebhook = onRequest(async (req, res) => {
  const { query, body } = req;
  const topic = query.topic || query.type || (body && body.type) || (body && body.action && body.action.split('.')[0]);
  const commerceId = query.comercioId;
  const isCanon = query.type === "delivery_canon" || (body && body.data && body.data.id && !commerceId);

  if (topic === "payment" && isCanon) {
    const paymentId = query.id || query["data.id"] || (body && body.data && body.data.id) || (body && body.id);
    try {
      const configDoc = await db.collection("system_config").doc("canon_config").get();
      const configData = configDoc.exists ? configDoc.data() : {};
      const mpAccessToken = configData.mpAccessToken || process.env.MP_ACCESS_TOKEN || "APP_USR-7809623696860010-051512-42171c77bb506b3a2bbbb695123d463e-242686767";

      const client = new MercadoPagoConfig({ accessToken: mpAccessToken });
      const paymentInstance = new Payment(client);
      const payment = await paymentInstance.get({ id: paymentId });

      if (payment.status === "approved" && payment.external_reference && payment.external_reference.startsWith("CANON_")) {
        const parts = payment.external_reference.split("_");
        const driverId = parts[1];
        const dateStr = parts[2];

        if (driverId && dateStr) {
          const canonDocRef = db.collection("delivery_canon_payments").doc(`${driverId}_${dateStr}`);
          await canonDocRef.set({
            driverId: driverId,
            dateStr: dateStr,
            amount: payment.transaction_amount || 2000,
            status: "approved",
            mpPaymentId: paymentId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          logger.info(`Webhook: Delivery Canon for driver ${driverId} on ${dateStr} marked as APPROVED.`);

          // Notify driver that their day is active and ready
          const dTokens = await getUserTokens(driverId);
          if (dTokens.length > 0) {
            await sendPush(dTokens, {
              title: "✅ ¡Jornada Habilitada!",
              body: "Se acreditó tu pago de canon diario. Ya podés ponerte ONLINE para recibir ofertas de pedidos."
            }, { tag: `canon-approved-${dateStr}`, url: "#/delivery" });
          }
        }
      }
    } catch (err) {
      logger.error("Error processing delivery canon webhook:", err);
    }
  } else if (topic === "payment" && commerceId) {
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
    return tokensSnap.docs.map(d => d.data().token).filter(Boolean);
  } catch (err) {
    logger.warn(`Error getting tokens for user ${userId}:`, err);
    return [];
  }
}

/**
 * Helper: Send push notification to a list of tokens
 */
async function sendPush(tokens, notification, data = {}) {
  if (!tokens || tokens.length === 0) return;

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
      data: {
        ...data,
        title: displayTitle,
        body: displayBody,
        icon: "/logo-pwa.png",
        badge: "/badge-icon.png",
        image: notification.image || "",
        url: targetUrl
      },
      android: {
        priority: "high",
        ttl: 3600000,
        notification: {
          priority: "max",
          sound: "default",
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: "public"
        }
      },
      apns: {
        headers: {
          "apns-priority": "10"
        },
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            contentAvailable: true,
            mutableContent: true
          }
        }
      },
      webpush: {
        headers: {
          Urgency: "high"
        },
        notification: {
          title: "Go Delivery",
          body: displayBody,
          icon: "https://godelivery-magdalena.web.app/logo-pwa.png",
          badge: "https://godelivery-magdalena.web.app/badge-icon.png",
          vibrate: [200, 100, 200, 100, 200],
          requireInteraction: true,
          tag: data.tag || undefined,
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

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      totalSuccess += response.successCount;
      totalFailure += response.failureCount;
      
      // Clean up invalid tokens
      if (response.failureCount > 0) {
        const tokensToDelete = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.error(`[FCM Error] Failed to send to token index ${idx} (${chunk[idx].substring(0, 10)}...):`, resp.error);
            const errorCode = resp.error?.code;
            if (errorCode === "messaging/invalid-registration-token" || 
                errorCode === "messaging/registration-token-not-registered") {
              tokensToDelete.push(chunk[idx]);
            }
          }
        });

        if (tokensToDelete.length > 0) {
          logger.info(`Cleaning up ${tokensToDelete.length} invalid tokens`);
          
          // Chunk tokensToDelete into groups of 30 for parallel search and destroy
          const chunks = [];
          for (let i = 0; i < tokensToDelete.length; i += 30) {
            chunks.push(tokensToDelete.slice(i, i + 30));
          }

          await Promise.all(chunks.map(async (c) => {
            try {
              const snap = await db.collectionGroup("fcmTokens").where("token", "in", c).get();
              if (!snap.empty) {
                const batch = db.batch();
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
              }
            } catch (err) {
              logger.error("Error deleting fcmToken chunk:", err);
            }
          }));
        }
      }
    } catch (err) {
      logger.error("Error sending chunk of push notifications:", err);
    }
  }

  logger.info(`Push sent total: ${totalSuccess} success, ${totalFailure} failed`);
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
 * Helper: Get all admin tokens
 */
async function getAdminTokens() {
  try {
    // Query both role:'admin' AND isAdmin:true to cover all admin variants
    const [byRoleSnap, byFlagSnap] = await Promise.all([
      db.collection("users").where("role", "==", "admin").get(),
      db.collection("users").where("isAdmin", "==", true).get()
    ]);
    const seenIds = new Set();
    const allAdminDocs = [];
    for (const snap of [byRoleSnap, byFlagSnap]) {
      for (const d of snap.docs) {
        if (!seenIds.has(d.id)) {
          seenIds.add(d.id);
          allAdminDocs.push(d);
        }
      }
    }
    let tokens = [];
    for (const doc of allAdminDocs) {
      const userTokens = await getUserTokens(doc.id);
      tokens = tokens.concat(userTokens);
      // Fallback: If fcmTokens subcollection is empty, check root document mirrored token
      if (userTokens.length === 0) {
        const uData = doc.data();
        if (uData && uData.lastFcmToken) {
          tokens.push(uData.lastFcmToken);
        }
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
    // Auto-cancellation disabled completely per user directive.
    // Orders must ONLY be cancelled manually.

    // Guard: Regular commerce orders must ONLY be dispatched when they are 'ready'
    if (!order.isFavor && !order.isTrip && order.status !== 'ready') {
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

    let eligible = allDrivers.filter(d => {
      if (!canTake(d.id, order.comercioId)) return false;
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
        const drvType = (d.tripVehicleType || d.vehicleType || "").toLowerCase();
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
        queueOfferedAt: admin.firestore.FieldValue.serverTimestamp(),
        queueRejectedDrivers: rejected,
        isPermanentOffer: isOnlyDriver ? true : null
      });
      assigned = true;
    });

    if (assigned) {
      logger.info(`[ServerDispatch] ✅ Order ${orderId} → driver ${chosen.id} (${chosen.displayName || chosen.name})`);
      
      // Notify the chosen target driver via Push Notification & In-App Notification (even if rotated back to them)
      try {
        const orderTypeStr = order.isFavor 
          ? (order.favorType === "compra" ? "GOMANDADO 🛒" : "GOFAVOR 📦")
          : (order.isTrip ? "GOTAXI 🚕" : "PEDIDO 🛍️");

        const originStr = order.comercioName || (order.isTrip ? "Pasajero" : (order.isFavor ? (order.favorTypeLabel || "Favor") : "Comercio"));
        const destStr = order.destinationAddress || order.address || order.deliveryAddress || "Dirección de entrega";
        const earnings = Math.round(order.driverEarnings || order.shippingFee || order.deliveryFee || order.shippingCost || 0);
        const earningsBadge = earnings > 0 ? `$${earnings.toLocaleString('es-AR')} Ganancia` : 'Disponible';

        const pushTitle = `🚨 ¡OFERTA: ${earningsBadge}! (${orderTypeStr})`;
        const pushBody = `📍 Retiro: ${originStr}\n🏁 Entrega: ${destStr}\n¡Tenés 60s para aceptar!`;

        await db.collection("users").doc(chosen.id).collection("notifications").add({
          type: "new_exclusive_offer",
          title: pushTitle,
          body: pushBody,
          status: "unread",
          url: "#/delivery",
          orderId: orderId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const targetTokens = await getUserTokens(chosen.id);
        if (targetTokens.length > 0) {
          await sendPush(targetTokens, {
            title: pushTitle,
            body: pushBody
          }, { 
            tag: `exclusive-offer-${orderId}-${Date.now()}`, 
            url: "#/delivery",
            type: "exclusive_offer",
            orderId: orderId,
            sound: "alert.mp3",
            channelId: "exclusive_offers"
          });
          logger.info(`[ServerDispatch] Sent FCM push to target driver ${chosen.id}`);
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
    // 0. Notify ALL admins of ANY new order
    try {
      const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
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

      const targetDriverUid = order.queueTargetDriverId || order.driverId;
      let adminTokens = await getAdminTokens();
      if (targetDriverUid) {
        try {
          const driverDoc = await db.collection("users").doc(targetDriverUid).get();
          if (driverDoc.exists) {
            const dData = driverDoc.data();
            const driverTokens = [
              ...(Array.isArray(dData.fcmTokens) ? dData.fcmTokens : []),
              dData.lastFcmToken
            ].filter(Boolean);
            const driverTokenSet = new Set(driverTokens);
            adminTokens = adminTokens.filter(t => !driverTokenSet.has(t));
          }
        } catch (e) {
          logger.warn("Could not filter target driver tokens from admin alert:", e);
        }
      }

      if (adminTokens.length > 0) {
        await sendPush(adminTokens, {
          title: `🚨 [SOPORTE GO] ¡Nuevo Pedido #${orderNum}!`,
          body: `${orderTypeLabel} — Ingresó al sistema (${order.userName || 'Cliente'}). Tap para auditarlo.`
        }, {
          tag: `admin-new-order-${orderId}`,
          url: `#/admin/orders`,
          type: 'admin_support_alert',
          sound: 'alert.mp3',
          channelId: 'admin_alerts'
        });
      }

      for (const adminDoc of adminsSnap.docs) {
        await db.collection("users").doc(adminDoc.id).collection("notifications").add({
          title: `🚨 [SOPORTE] Nuevo Pedido #${orderNum}`,
          body: `Se ha registrado una nueva orden de tipo: ${orderTypeLabel}`,
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
    if (order.isFavor || order.isTrip) {
      // Small delay to let Firestore settle before running dispatch
      await new Promise(r => setTimeout(r, 1500));
      await serverSideDispatch(orderId, order);
      return;
    }

    // 2. Regular commerce owner notification (Only sent to the actual commerce owner, NOT admins)
    const comercioDoc = await db.collection("comercios").doc(order.comercioId).get();
    if (comercioDoc.exists) {
      const comData = comercioDoc.data();
      let ownerId = comData.ownerId;
      if (!ownerId) {
        const ownerQuerySnap = await db.collection("users").where("comercioId", "==", order.comercioId).get();
        if (!ownerQuerySnap.empty) {
          ownerId = ownerQuerySnap.docs[0].id;
        }
      }

      if (ownerId) {
        const ownerTokens = await getUserTokens(ownerId);
        const adminTokens = await getAdminTokens();
        const adminTokenSet = new Set(adminTokens);
        // Exclude admin tokens so admins only receive their single admin audit alert (#/admin/orders)
        const pureOwnerTokens = ownerTokens.filter(t => !adminTokenSet.has(t));

        if (pureOwnerTokens.length > 0) {
          logger.info(`[FCM] Sending new order push to commerce owner ${ownerId} (${pureOwnerTokens.length} tokens).`);
          await sendPush(pureOwnerTokens, {
            title: "🔔 ¡Nuevo Pedido Recibido!",
            body: `Tenés un nuevo pedido pendiente de confirmación. #${orderNum}`,
            sound: "default"
          }, { tag: `new-order-${orderId}`, url: `#/mi-comercio/${order.comercioId}/orders` });
        }
      }
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
  
  if (!message || !message.senderId) return;

  try {
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return;
    
    const chatData = chatDoc.data();
    const orderId = chatData.orderId;
    const senderName = message.senderName || "Mensaje nuevo";
    
    let recipientIds = [];
    
    // 1. Collect participants from chat document
    if (Array.isArray(chatData.participants)) {
      recipientIds.push(...chatData.participants);
    }
    if (chatData.userId) recipientIds.push(chatData.userId);
    if (chatData.driverId) recipientIds.push(chatData.driverId);
    if (chatData.commerceId) recipientIds.push(chatData.commerceId);

    // 2. Collect participants from order document if available
    if (orderId) {
      try {
        const orderDoc = await db.collection("orders").doc(orderId).get();
        if (orderDoc.exists) {
          const order = orderDoc.data();
          if (order.userId) recipientIds.push(order.userId);
          if (order.driverId) recipientIds.push(order.driverId);
          if (order.comercioId) {
            const comercioDoc = await db.collection("comercios").doc(order.comercioId).get();
            if (comercioDoc.exists && comercioDoc.data().ownerId) {
              recipientIds.push(comercioDoc.data().ownerId);
            }
          }
        }
      } catch (e) {
        logger.warn("Error reading order for chat push:", e);
      }
    }

    // 3. Filter out sender and duplicates
    recipientIds = [...new Set(recipientIds)].filter(id => id && String(id) !== String(message.senderId));

    const msgBody = message.text 
      ? (message.text.length > 150 ? message.text.substring(0, 150) + "..." : message.text)
      : (message.audioUrl ? "🎤 Mensaje de voz" : (message.imageUrl ? "📷 Imagen adjunta" : "Nuevo mensaje"));

    // 4. Send Push Notification to all recipients
    for (const recipientId of recipientIds) {
      const tokens = await getUserTokens(recipientId);
      if (tokens.length > 0) {
        await sendPush(tokens, {
          title: `💬 ${senderName}`,
          body: msgBody
        }, {
          tag: `chat-${chatId}`,
          url: `#/mis-chats?chatId=${chatId}`,
          type: "chat_message",
          sound: "chat.mp3",
          channelId: "chat_alerts",
          chatId: chatId,
          orderId: orderId || ""
        });
      }

      // Also add in-app notification doc for the recipient
      try {
        await db.collection("users").doc(recipientId).collection("notifications").add({
          type: "chat_message",
          title: `💬 ${senderName}`,
          body: msgBody,
          status: "unread",
          url: `#/mis-chats?chatId=${chatId}`,
          chatId: chatId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (nErr) {
        logger.error(`Error writing chat notification doc for ${recipientId}:`, nErr);
      }
    }
  } catch (err) {
    logger.error("Error in onNewChatMessage:", err);
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
        title: "💬 Interés en tu producto",
        body: `${chat.buyerName} quiere contactarte por "${chat.productTitle}".`
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
        title: `💬 Mensaje de ${message.senderName}`,
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
          title: "🎉 ¡Venta Confirmada!",
          body: `${after.buyerName} ha confirmado la compra de tu producto "${after.title}".`
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

  try {
    // 00. Queue rotation trigger: if the target driver is released (from exclusive to null)
    // and the order is still active/unassigned, re-run dispatch.
    // Commerce orders ONLY re-dispatch if they are in 'ready' status.
    const isDispatchableStatus = (after.isFavor || after.isTrip) 
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
            driverAlias: dData.transferAlias || '',
            driverVehicleModel: dData.vehicleModel || '',
            driverVehicleColor: dData.vehicleColor || '',
            driverVehiclePatent: dData.vehicleDetails || dData.patente || '',
            status: (after.isFavor || after.isTrip) ? 'confirmed' : after.status,
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            estimatedDeliveryTime: estTime
          });

          // Reset driver missed offers count to prevent auto-offline disconnect
          await db.collection("users").doc(driverId).update({
            missedOffersCount: 0
          });

          // Fetch the customer's photo URL from their user profile
          let customerPhoto = "";
          try {
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
            title: "⚡ ¡Pedido auto-aceptado!",
            body: `Se aceptó automáticamente el pedido de ${after.userName || 'Cliente'}. ¡Toca para ver tu ruta!`,
            image: customerPhoto
          }, { 
            tag: `auto-accept-${orderId}`, 
            url: `#/delivery`,
            type: "auto_accept",
            sound: "cash.mp3",
            channelId: "auto_accept_alerts",
            click_action: 'FLUTTER_NOTIFICATION_CLICK'
          });

          // Create notification document in Firestore for the driver
          await db.collection("users").doc(driverId).collection("notifications").add({
            type: "auto_accept",
            title: "⚡ ¡Pedido auto-aceptado!",
            body: `Se aceptó automáticamente el pedido de ${after.comercioName || 'Comercio'}.`,
            status: "unread",
            url: "#/delivery",
            createdAt: new Date()
          });

          return; // Stop execution of the current invocation as document update will trigger a new event
        } else {
          // Standard Exclusive Offer Push Notification
          try {
            const driverTokens = await getUserTokens(driverId);
            const orderTypeStr = after.isFavor 
              ? (after.favorType === "compra" ? "GOMANDADO 🛒" : "GOFAVOR 📦")
              : (after.isTrip ? "GOTAXI 🚕" : "PEDIDO 🛍️");

            const pushTitle = `🛵 ¡Nueva Oferta Exclusiva! (${orderTypeStr})`;
            const pushBody = `Tenés un nuevo pedido disponible de ${after.comercioName || after.userName || 'Cliente'}. ¡Toca para aceptar!`;

            if (driverTokens.length > 0) {
              await sendPush(driverTokens, {
                title: pushTitle,
                body: pushBody
              }, { 
                tag: `exclusive-offer-${orderId}-${Date.now()}`, 
                url: "#/delivery",
                type: "new_exclusive_offer",
                orderId: orderId,
                sound: "cash.mp3",
                channelId: "exclusive_offers",
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
              });
              logger.info(`[onOrderUpdated] Sent FCM exclusive offer push to driver ${driverId}`);
            }

            // Also add it to their Firestore notifications list so they see it in the app drawer
            await db.collection("users").doc(driverId).collection("notifications").add({
              type: "new_exclusive_offer",
              title: pushTitle,
              body: pushBody,
              status: "unread",
              url: "#/delivery",
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
    if (before.paymentStatus !== after.paymentStatus && after.paymentStatus === "paid") {
       const comercioDoc = await db.collection("comercios").doc(after.comercioId).get();
       if (comercioDoc.exists) {
         const comData = comercioDoc.data();
         const ownerId = comData.ownerId;
         const commerceName = (comData.name || "").toLowerCase();
         const isGoMarket = commerceName.includes("go!") && commerceName.includes("market");

         if (isGoMarket) {
           // Notify ALL admins for GoMarket
           const adminTokens = await getAdminTokens();
           await sendPush(adminTokens, {
             title: "🛒 ¡Nuevo Pedido en GoMarket!",
             body: `Recibiste el pedido #${orderNum} de ${after.userName || "un cliente"}.`
           }, { tag: `new-order-${orderId}`, url: `#/mi-comercio/${after.comercioId}/orders` });
         } else {
           // Regular commerce owner notification
           const ownerTokens = await getUserTokens(ownerId);
           await sendPush(ownerTokens, {
             title: "🔔 ¡Nuevo Pedido Recibido!",
             body: `Tenés un nuevo pedido pendiente de confirmación. #${orderNum}`
           }, { tag: `new-order-${orderId}`, url: `#/mi-comercio/${after.comercioId}/orders` });
         }
       }
    }
    
    // Notification for delivery driver at door
    if (before.isAtDoor !== after.isAtDoor && after.isAtDoor === true) {
      if (after.userId) {
        const clientTokens = await getUserTokens(after.userId);
        const codePrefix = after.verificationCode ? `[Código: ${after.verificationCode}] ` : "";
        await sendPush(clientTokens, {
          title: `${codePrefix}¡Tu repartidor está en la puerta!`,
          body: after.isFavor 
            ? `Código: ${after.verificationCode || '----'} - El repartidor llegó con tu favor. ¡Salí a recibirlo!` 
            : `Código: ${after.verificationCode || '----'} - Prepárate para recibir tu pedido. ¡Ya llegó!`
        }, { 
          tag: `order-active-${orderId}`, 
          persistent: "true", 
          ongoing: true, 
          requireInteraction: true,
          url: `#/pedido/${orderId}` 
        });
      }
    }

    // Driver Assignment Notification (Fires ONCE when a driver accepts an unassigned order/favor/trip)
    if (!before.driverId && after.driverId && after.userId) {
      const clientTokens = await getUserTokens(after.userId);
      const driverName = after.driverName || "un repartidor";
      const title = after.isTrip ? "🚕 Chofer Asignado" : "🛵 Repartidor Asignado";
      const body = (after.isFavor || after.isTrip)
        ? `Tu servicio fue asignado a ${driverName} y está en camino.`
        : `Tu pedido fue asignado a ${driverName}.`;

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

    // Status change notifications (ONLY when the order status itself changes, not just queue rotation)
    if (before.status !== after.status) {
      switch (after.status) {
        case "confirmed": {
          // Notify client: differentiate between normal commerce orders vs GoFavores / Mandados
          const clientTokens = await getUserTokens(after.userId);
          if (!after.isFavor && !after.isTrip) {
            await sendPush(clientTokens, {
              title: "✅ Pedido Confirmado",
              body: "👨‍🍳 Preparando tu pedido. ¡Ya casi está!"
            }, { 
              tag: `order-active-${orderId}`, 
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
          await sendPush(clientTokens2, {
            title: "📦 Pedido Listo",
            body: "🛵 Tu pedido está listo. Buscando un repartidor..."
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}` });

          // Manual Assignment only: Geohash & Distance Auto-Assignment algorithm is disabled.
          // Delivery drivers always claim orders manually from their panel.

          // Targeted Co-pickup Scan
          const coPickupDrivers = new Set();
          const coPickupTokens = [];

          try {
            // Find active orders (confirmed or ready) from the same commerce that have a driver assigned
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
                        title: "🛵 ¡Co-Retiro Optimizado!",
                        body: `Hay otro pedido listo en ${after.comercioName || 'el comercio'}. ¡Sumalo a tu ruta!`
                      }, { tag: `co-pickup-${orderId}`, url: "#/delivery" });
                    }
                  }
                }
              }
            }
          } catch (err) {
            logger.error("Error in co-pickup targeted scan:", err);
          }

          break;
        }

        case "delivering": {
          // Notify client: "El pedido está en camino" + Delivery Code
          const clientTokens3 = await getUserTokens(after.userId);
          const delCode = after.verificationCode || "----";
          await sendPush(clientTokens3, {
            title: `[Código: ${delCode}] 🛵 ¡Tu pedido está en camino!`,
            body: `Código: ${delCode} - El repartidor ya lleva tu pedido.`
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}`, persistent: "true" });
          break;
        }
        case "completed": {
          // 1. Notify client: "Pedido entregado"
          const clientTokens4 = await getUserTokens(after.userId);
          await sendPush(clientTokens4, {
            title: "🎉 ¡Pedido Entregado!",
            body: "El repartidor ya entregó tu pedido. ¡Que lo disfrutes!"
          }, { tag: `order-${orderId}-delivered`, url: `#/pedido/${orderId}`, persistent: "true" });

           if (after.driverId) {
            const appFee = after.appUsageFee || 0;
            const couponDiscount = after.couponDiscount || 0;
            const driverIncentiveAmount = after.driverIncentiveAmount || 0;
            const netDebtChange = appFee - couponDiscount - driverIncentiveAmount;

            const date = new Date();
            const argOffset = -3 * 60; // Argentina offset in minutes (UTC-3)
            const localDate = new Date(date.getTime() + (argOffset + date.getTimezoneOffset()) * 60 * 1000);
            const todayStr = localDate.toISOString().split('T')[0];

            let todayCount = 0;
            try {
              const driverRef = db.collection("users").doc(after.driverId);
              await db.runTransaction(async (transaction) => {
                const driverSnap = await transaction.get(driverRef);
                if (!driverSnap.exists) return;
                const dData = driverSnap.data();

                const lastDate = dData.lastDeliveryDateStr || "";
                let tempCount = dData.completedOrdersToday || 0;

                if (lastDate !== todayStr) {
                  tempCount = 1;
                } else {
                  tempCount += 1;
                }
                todayCount = tempCount;

                const driverUpdates = {
                  lastDeliveryAt: admin.firestore.FieldValue.serverTimestamp(),
                  lastDeliveryDateStr: todayStr,
                  completedOrdersToday: todayCount,
                  completedOrdersCount: admin.firestore.FieldValue.increment(1),
                  recentCompletedTimes: admin.firestore.FieldValue.arrayUnion(Date.now())
                };
                if (netDebtChange !== 0) {
                  driverUpdates.deliveryDebt = admin.firestore.FieldValue.increment(netDebtChange);
                }

                transaction.update(driverRef, driverUpdates);
              });
              logger.info(`Updated driver ${after.driverId} on completion: todayCount=${todayCount} (debt change: ${netDebtChange}).`);
            } catch (err) {
              logger.error(`Error updating driver ${after.driverId} on completion transaction:`, err);
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
                  points: admin.firestore.FieldValue.increment(pointsEarned),
                  completedOrdersCount: admin.firestore.FieldValue.increment(1)
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
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
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
                      points: admin.firestore.FieldValue.increment(referralPoints)
                    });
                    
                    // Reward customer
                    batch.update(customerRef, {
                      points: admin.firestore.FieldValue.increment(referralPoints),
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
                      createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    const custTransRef = db.collection("points_transactions").doc();
                    batch.set(custTransRef, {
                      userId: after.userId,
                      type: "referred_welcome",
                      points: referralPoints,
                      description: "¡Bono de bienvenida por usar el código de referido de un amigo!",
                      createdAt: admin.firestore.FieldValue.serverTimestamp()
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
                      updateData.completedAt = admin.firestore.FieldValue.serverTimestamp();
                      
                      logger.info(`[Challenges] Challenge ${challenge.id} completed by ${after.userId}. Awarding ${challenge.pointsReward} pts.`);

                      // Award challenge points
                      batch.update(customerRef, {
                        points: admin.firestore.FieldValue.increment(challenge.pointsReward)
                      });

                      // Log challenge transaction
                      const challengeTransRef = db.collection("points_transactions").doc();
                      batch.set(challengeTransRef, {
                        userId: after.userId,
                        type: "challenge_completion",
                        points: challenge.pointsReward,
                        description: `Completaste el desafío semanal: ${challenge.title}`,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
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
          let cancelMsg = "Lamentablemente, tu pedido fue cancelado.";
          
          if (after.cancelReason && after.cancelReason.toLowerCase().includes("repartidor")) {
            cancelMsg = "Lamentablemente, tu pedido fue cancelado por falta de repartidores disponibles en tu zona.";
          } else if (after.cancelReason) {
            cancelMsg = `Lamentablemente, tu pedido fue cancelado. Motivo: ${after.cancelReason}`;
          }

          await sendPush(clientTokens5, {
            title: "❌ Pedido Cancelado",
            body: cancelMsg
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}` });

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
                    batch.update(pRef, { stockQuantity: admin.firestore.FieldValue.increment(item.qty || 1) });
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
          title: "📝 Pedido Modificado",
          body: `${modifierName} actualizó tu pedido #${orderNum}. Nuevo total: ${formatPrice(after.total)}`
        }, { 
          tag: `order-active-${orderId}`, 
          persistent: "true", 
          ongoing: true, 
          requireInteraction: true,
          url: `#/pedido/${orderId}` 
        });
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
 * Helper: Check if it is raining in Magdalena via Open-Meteo API (Node 18+ Native Fetch)
 */
async function checkIfRainingInMagdalena() {
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=-35.0811&longitude=-57.5146&current=rain,weather_code"
    );
    if (!res.ok) {
      logger.warn("Open-Meteo response not OK in Cloud Function");
      return false;
    }
    const data = await res.json();
    const rain = data?.current?.rain || 0;
    const code = data?.current?.weather_code || 0;
    // Exclude very light drizzle (51, 56) to prevent false positives
    const rainCodes = [53, 55, 57, 61, 63, 65, 66, 67, 80, 81, 82];
    const isRaining = rain >= 0.5 || rainCodes.includes(code);
    logger.info(`[Backend Weather] Rain: ${rain}mm, Weather Code: ${code}. Raining: ${isRaining}`);
    return isRaining;
  } catch (err) {
    logger.error("Error fetching weather in Cloud Function:", err);
    return false;
  }
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
exports.createOrder = onRequest({ cors: true, maxInstances: 15 }, async (req, res) => {
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
  const { cart, address, addressNotes, deliveryCoords, paymentMethod, redeemedPoints, totalDelivery, bundleId, tip, couponCode, allowReplacement, isScheduled, scheduledDate, scheduledTime } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "El carrito está vacío" });
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

    // Fetch current weather status outside transaction
    const weatherDocSnap = await db.collection("settings").doc("weather").get();
    const weatherData = weatherDocSnap.exists ? weatherDocSnap.data() : {};
    let isRainingFromApi = false;
    let needsWeatherUpdate = false;
    const lastUpdated = weatherData.updatedAt ? weatherData.updatedAt.toDate().getTime() : 0;
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    if (!weatherData || !weatherData.updatedAt || lastUpdated < thirtyMinutesAgo) {
      try {
        isRainingFromApi = await checkIfRainingInMagdalena();
        needsWeatherUpdate = true;
      } catch (err) {
        logger.warn("Weather API check failed:", err);
      }
    }

    if (needsWeatherUpdate) {
      await db.collection("settings").doc("weather").set({
        isRaining: isRainingFromApi,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
    }

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
        if (needsWeatherUpdate) {
          isRaining = isRainingFromApi;
        } else {
          isRaining = weatherData.isRaining || false;
        }
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
        if (pData.stockMode === 'limited') {
          const stockQty = typeof pData.stockQuantity === 'number' ? pData.stockQuantity : 0;
          if (stockQty < reqQty) {
            throw new Error(`Stock insuficiente para "${pData.name}". Disponible: ${stockQty}, Solicitado: ${reqQty}`);
          }
          const prodRef = db.doc(path);
          transaction.update(prodRef, {
            stockQuantity: admin.firestore.FieldValue.increment(-reqQty)
          });
        }
      }
      // ---------------------------------------------

      // --- SECURE SHIPPING FEE VALIDATION ---
      const basePriceVal = globalSettings.deliveryBasePrice !== undefined ? Number(globalSettings.deliveryBasePrice) : 350;
      const pricePerKmVal = globalSettings.deliveryPricePerKm !== undefined ? Number(globalSettings.deliveryPricePerKm) : 120;
      const minPriceVal = globalSettings.deliveryMinPrice !== undefined ? Number(globalSettings.deliveryMinPrice) : 400;
      const extraStopFeeVal = globalSettings.deliveryExtraStopFee !== undefined ? Number(globalSettings.deliveryExtraStopFee) : 200;

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
              const distance = getDistance(clientLat, clientLng, cLat, cLng);
              let rawFee = basePriceVal + (distance * pricePerKmVal);
              if (rawFee < minPriceVal) {
                rawFee = minPriceVal;
              }
              const roundedFee = Math.ceil(rawFee / 10) * 10;
              individualFees.push(roundedFee);
            }
          }
        }
      }

      let calculatedDeliveryFee = 0;
      if (individualFees.length > 0) {
        const maxIndividualFee = Math.max(...individualFees);
        calculatedDeliveryFee = maxIndividualFee + (commerceEntries.length - 1) * extraStopFeeVal + activeRainSurcharge;
      } else {
        calculatedDeliveryFee = minPriceVal + (commerceEntries.length - 1) * extraStopFeeVal + activeRainSurcharge;
      }
      const activeNightSurcharge = calculateScheduleSurcharge(globalSettings.nightSurchargeConfig, calculatedDeliveryFee);
      const activeDriverIncentive = calculateScheduleSurcharge(globalSettings.driverIncentiveConfig, calculatedDeliveryFee);

      const driverTip = Number(tip || 0);
      const totalCalculatedDelivery = calculatedDeliveryFee + driverTip + activeNightSurcharge;

      let finalDeliveryCost = Number(totalDelivery || 0);
      if (finalDeliveryCost < 0.9 * totalCalculatedDelivery) {
        logger.warn(`Shipping fee tampering detected! Client sent totalDelivery: ${finalDeliveryCost}, calculated: ${totalCalculatedDelivery}. Overwriting.`);
        finalDeliveryCost = totalCalculatedDelivery;
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
          const basePrice = (pData.price || 0) + (item.options || []).reduce((os, o) => os + (o.price * (o.qty || 1) || 0), 0);

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

        const subAppUsageFee = subProductsTotal * appUsageFeeRate;
        const commerceCommissionRate = cData.commissionRate !== undefined && cData.commissionRate !== null 
          ? cData.commissionRate 
          : 0.10;
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

        const subTotal = Math.max(subProductsTotal + subDeliveryCost + subAppUsageFee - subDiscount - subCouponDiscount, 0);

        let scheduledForObj = null;
        if (isScheduled && scheduledDate && scheduledTime) {
          const dtStr = `${scheduledDate}T${scheduledTime}:00`;
          const parsed = new Date(dtStr);
          if (!isNaN(parsed.getTime())) {
            scheduledForObj = admin.firestore.Timestamp.fromDate(parsed);
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
            const basePrice = (pData.price || 0) + (item.options || []).reduce((os, o) => os + (o.price * (o.qty || 1) || 0), 0);

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

            return {
              comercioId: cId,
              comercioName: g.comercioName,
              name: pData.name,
              price: finalUnitPrice,
              qty: item.qty,
              options: item.options || []
            };
          }),
          subtotal: subProductsTotal,
          deliveryCost: subDeliveryCost,
          tip: i === 0 ? Number(tip || 0) : 0,
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
          status: 'pending',
          paymentMethod,
          paymentStatus: 'pending',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        transaction.set(orderRef, orderData);
        createdOrders.push({ docId: orderRef.id, orderId: lastId, commerceId: cId, total: subTotal });

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
          points: admin.firestore.FieldValue.increment(-redeemedPoints)
        });
      }

      // Decrement coupon remaining count and record redemption (Single-Use)
      if (couponData && couponRef) {
        transaction.update(couponRef, {
          remaining: admin.firestore.FieldValue.increment(-1),
          usedCount: admin.firestore.FieldValue.increment(1)
        });

        const redemptionRef = couponRef.collection("redemptions").doc(uid);
        transaction.set(redemptionRef, {
          userId: uid,
          usedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      transaction.set(settingsRef, { lastOrderId: lastId }, { merge: true });
      return createdOrders;
    });

    // Notify all comercios
    for (const order of result) {
      await db.collection("notifications").add({
        comercioId: order.commerceId,
        orderId: order.docId,
        title: "¡Nuevo Pedido!",
        message: `Pedido #${order.orderId} de ${decodedToken.name || "Cliente"}`,
        type: "new_order",
        status: "unread",
        pushNotify: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.status(200).json({ success: true, orders: result });
  } catch (error) {
    logger.error("Create Order Error:", error);
    res.status(500).json({ error: error.message });
  }
});

exports.createFavorOrder = onRequest({ cors: true, maxInstances: 15 }, async (req, res) => {
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
        const lastUpdated = weatherData.updatedAt ? weatherData.updatedAt.toDate().getTime() : 0;
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
        if (!weatherData || !weatherData.updatedAt || lastUpdated < thirtyMinutesAgo) {
          isRaining = await checkIfRainingInMagdalena();
          transaction.set(db.collection("settings").doc("weather"), {
            isRaining,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else {
          isRaining = weatherData.isRaining || false;
        }
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

      const orderRef = db.collection("orders").doc();
      const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();

      // Secure fee validation for GoFavor
      const pLat = pickupCoords && (pickupCoords.lat !== undefined ? pickupCoords.lat : pickupCoords.latitude);
      const pLng = pickupCoords && (pickupCoords.lng !== undefined ? pickupCoords.lng : pickupCoords.longitude);
      const dLat = deliveryCoords && (deliveryCoords.lat !== undefined ? deliveryCoords.lat : deliveryCoords.latitude);
      const dLng = deliveryCoords && (deliveryCoords.lng !== undefined ? deliveryCoords.lng : deliveryCoords.longitude);

      let secureDeliveryCost = 0;
      if (type === 'pagodeservicios' && receiptDeliveryType === 'digital') {
         secureDeliveryCost = 0;
      } else if (pLat !== undefined && pLng !== undefined && dLat !== undefined && dLng !== undefined) {
         const distance = getDistance(pLat, pLng, dLat, dLng);
         const basePriceVal = globalSettings.deliveryBasePrice !== undefined ? Number(globalSettings.deliveryBasePrice) : 350;
         const pricePerKmVal = globalSettings.deliveryPricePerKm !== undefined ? Number(globalSettings.deliveryPricePerKm) : 120;
         const minPriceVal = globalSettings.deliveryMinPrice !== undefined ? Number(globalSettings.deliveryMinPrice) : 400;
         
         let rawFee = basePriceVal + (distance * pricePerKmVal);
         if (rawFee < minPriceVal) {
           rawFee = minPriceVal;
         }
         secureDeliveryCost = Math.ceil(rawFee / 10) * 10;
      } else {
         const minPriceVal = globalSettings.deliveryMinPrice !== undefined ? Number(globalSettings.deliveryMinPrice) : 400;
         secureDeliveryCost = minPriceVal;
      }

      const activeNightSurcharge = calculateScheduleSurcharge(globalSettings.nightSurchargeConfig, secureDeliveryCost);

      if (secureDeliveryCost > 0) {
        secureDeliveryCost += activeRainSurcharge + activeNightSurcharge;
      }

      let finalDeliveryCost = Number(deliveryCost);
      if (finalDeliveryCost < 0.9 * secureDeliveryCost) {
        logger.warn(`GoFavor Delivery fee tampering detected! Client: ${finalDeliveryCost}, calculated: ${secureDeliveryCost}. Overwriting.`);
        finalDeliveryCost = secureDeliveryCost;
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

      const appUsageFeeRate = globalSettings.appUsageFeeRate !== undefined ? Number(globalSettings.appUsageFeeRate) : 0.05;
      const subtotalVal = finalDeliveryCost + finalPurchaseFee;
      const secureAppUsageFee = Math.ceil((subtotalVal * appUsageFeeRate) / 10) * 10;

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
          if (couponData.type === 'free_delivery') {
            secureCouponDiscount = finalDeliveryCost;
          } else if (discountType === 'percentage') {
            secureCouponDiscount = finalDeliveryCost * (couponVal / 100);
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

      const finalCouponDiscount = Number(couponDiscount || 0);
      if (couponData && Math.abs(finalCouponDiscount - secureCouponDiscount) > 10) {
        logger.warn(`GoFavor Coupon discount tampering detected! Client: ${finalCouponDiscount}, calculated: ${secureCouponDiscount}. Overwriting.`);
      }

      const rawTotal = subtotalVal + finalAppUsageFee + Number(extraStopsFee || 0) + Number(tip || 0) - finalCouponDiscount;
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
        deliveryCost: finalDeliveryCost,
        isRaining: isRaining,
        rainSurcharge: activeRainSurcharge,
        nightSurcharge: activeNightSurcharge,
        purchaseFee: finalPurchaseFee,
        appUsageFee: finalAppUsageFee,
        extraStopsFee: Number(extraStopsFee || 0),
        stopsCount: Number(stopsCount || 1),
        total: finalTotal,
        status: 'pending',
        paymentMethod: paymentMethod || 'efectivo',
        paymentStatus: 'pending',
        verificationCode,
        tip: Number(tip || 0),
        couponCode: couponCode || null,
        couponDiscount: finalCouponDiscount,
        directDriverUid: directDriverUid && directDriverUid !== 'rotation' ? directDriverUid : null,
        queueTargetDriverId: initialTargetDriverId,
        queueTargetDriverName: initialTargetDriverName,
        queueOfferedAt: initialTargetDriverId ? admin.firestore.FieldValue.serverTimestamp() : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.set(orderRef, orderData);
      
      // Decrement coupon remaining count and record redemption (Single-Use)
      if (couponData && couponRef) {
        transaction.update(couponRef, {
          remaining: admin.firestore.FieldValue.increment(-1),
          usedCount: admin.firestore.FieldValue.increment(1)
        });

        const redemptionRef = couponRef.collection("redemptions").doc(uid);
        transaction.set(redemptionRef, {
          userId: uid,
          usedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      transaction.set(settingsRef, { lastOrderId: lastId }, { merge: true });
      return { docId: orderRef.id, orderId: lastId };
    });

    // Notify available drivers via notifications collection
    await db.collection("notifications").add({
      title: "¡Nuevo Favor Disponible!",
      message: `Hay un nuevo ${type} disponible`,
      type: "new_favor",
      status: "unread",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ success: true, orderId: result.docId, orderNum: result.orderId });
  } catch (error) {
    logger.error("Create Favor Order Error:", error);
    res.status(500).json({ error: error.message });
  }
});

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
        scheduledAt: admin.firestore.Timestamp.fromDate(scheduledDate),
        sentCount: 0,
        clicks: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ success: true, scheduled: true, broadcastId: broadcastRef.id });
    }

    // 2. Fetch target devices' tokens in matching segments (Instant direct delivery, bypassing topic delay)
    let targetTokens = [];
    try {
      if (targetAudience === "all") {
        const tokensSnap = await db.collectionGroup("fcmTokens").get();
        targetTokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
      } else {
        const roleQueryVal = targetAudience === "clients" ? "client" :
                             targetAudience === "drivers" ? "driver" : "commerce";
        
        let usersSnap;
        if (targetAudience === "clients") {
          usersSnap = await db.collection("users").where("role", "in", ["client", "admin"]).get();
        } else if (targetAudience === "drivers") {
          usersSnap = await db.collection("users").where("role", "in", ["driver", "delivery"]).get();
        } else {
          usersSnap = await db.collection("users").where("role", "in", ["commerce", "comercio"]).get();
        }

        const userIds = usersSnap.docs.map(d => d.id);
        if (userIds.length > 0) {
          for (const uId of userIds) {
            const tSnap = await db.collection("users").doc(uId).collection("fcmTokens").get();
            tSnap.docs.forEach(d => {
              if (d.data().token) {
                targetTokens.push(d.data().token);
              }
            });
          }
        }
      }
    } catch (cErr) {
      logger.warn("Target devices tokens query failed:", cErr);
    }

    // Deduplicate to avoid sending multiples to same device
    targetTokens = [...new Set(targetTokens)];
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
      createdAt: admin.firestore.FieldValue.serverTimestamp()
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
      clicks: admin.firestore.FieldValue.increment(1)
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
      'settlements', 'delivery_transactions', 'deliverySessions',
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
      lastResetAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 4. Update all users: blanquear saldos, deudas, ratings
    const usersSnap = await db.collection('users').get();
    const userChunks = chunkArray(usersSnap.docs, 500);
    for (const chunk of userChunks) {
      const batch = db.batch();
      chunk.forEach(uDoc => {
        const updateData = {
          deliveryDebt: 0,
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

exports.autoDisconnectDrivers = onSchedule("*/10 * * * *", async (event) => {
  // Desconexión automática deshabilitada: Los repartidores nunca se desconectan por inactividad.
  logger.info("[autoDisconnectDrivers] Desconexión automática deshabilitada por configuración.");
});

exports.cancelUnassignedOrders = onSchedule("*/5 * * * *", async (event) => {
  logger.info("Automatic cancellation of unassigned orders is disabled per user directive.");
  return;
});

exports.checkWeatherPeriodic = onSchedule("*/15 * * * *", async (event) => {
  try {
    const settingsSnap = await db.collection("settings").doc("global").get();
    const globalSettings = settingsSnap.exists ? settingsSnap.data() : {};
    const rainMode = globalSettings.rainMode || "auto";

    let isRaining = false;
    if (rainMode === "on") {
      isRaining = true;
    } else if (rainMode === "off") {
      isRaining = false;
    } else {
      isRaining = await checkIfRainingInMagdalena();
    }

    const weatherRef = db.collection("settings").doc("weather");
    const weatherSnap = await weatherRef.get();
    const wasRaining = weatherSnap.exists ? weatherSnap.data().isRaining : false;

    if (isRaining !== wasRaining) {
      await weatherRef.set({ isRaining, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      
      if (isRaining) {
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
        lastNotifiedStart: admin.firestore.FieldValue.serverTimestamp()
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
        lastNotifiedEnd: admin.firestore.FieldValue.serverTimestamp()
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
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    
    // Window: trips scheduled between now and 2h10m from now (to catch within each 10-min cycle)
    const twoHoursFromNow = new admin.firestore.Timestamp(
      Math.floor((nowMs + 2 * 60 * 60 * 1000) / 1000), 0
    );
    const twoHoursTenFromNow = new admin.firestore.Timestamp(
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
          title: "⏰ Recordatorio: Viaje en 2 horas",
          body: `Tenés un viaje programado a las ${timeStr}. Destino: ${trip.deliveryAddress || "sin dirección"}.`
        }, { tag: "scheduled-trip-reminder", url: "#/delivery" });
      }

      // Also notify the passenger
      if (trip.userId) {
        const userTokens = await getUserTokens(trip.userId);
        if (userTokens.length > 0) {
          await sendPush(userTokens, {
            title: "🚗 Tu viaje programado es en 2 horas",
            body: `Preparate: tu viaje hacia ${trip.deliveryAddress || "tu destino"} comienza pronto.`
          }, { tag: "scheduled-trip-passenger-reminder", url: `#/pedido/${doc.id}` });
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
            title: "🚗 ¡Tu viaje programado comienza AHORA!",
            body: `Dirigite a buscar al pasajero en: ${trip.pickupAddress || "la dirección indicada"}.`
          }, { tag: "scheduled-trip-start", url: "#/delivery" });
        }
        logger.info(`Activated scheduled trip ${doc.id} (has driver ${trip.driverId})`);
      } else {
        // No driver assigned yet → notify user to re-search or wait, but do NOT cancel automatically
        logger.info(`Scheduled trip ${doc.id} reached time without assigned driver. Leaving active.`);
        if (trip.userId) {
          const userTokens = await getUserTokens(trip.userId);
          if (userTokens.length > 0) {
            await sendPush(userTokens, {
              title: "🚗 Recordatorio de viaje programado",
              body: "Tu viaje programado está activo y buscando chofer."
            }, { tag: "scheduled-trip-reminder", url: "#/viajes" });
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
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    
    // Queremos activar pedidos que esten en 'preparing' y cuyo scheduledFor sea <= dentro de 5 minutos
    const fiveMinsFromNow = new admin.firestore.Timestamp(
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
      batch.update(doc.ref, { 
        status: "ready", 
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
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
          title: "🏷️ Nueva publicación pendiente",
          body: `El producto "${product.title}" requiere aprobación de moderación.`
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
exports.processScheduledBroadcasts = onSchedule("*/1 * * * *", async (event) => {
  const now = admin.firestore.Timestamp.now();
  try {
    const snap = await db.collection("broadcasts")
      .where("status", "==", "scheduled")
      .where("scheduledAt", "<=", now)
      .get();

    if (snap.empty) return;

    logger.info(`Found ${snap.size} scheduled push campaigns to process.`);

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
        if (targetAudience === "all") {
          const tokensSnap = await db.collectionGroup("fcmTokens").get();
          targetTokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
        } else {
          let usersSnap;
          if (targetAudience === "clients") {
            usersSnap = await db.collection("users").where("role", "in", ["client", "admin"]).get();
          } else if (targetAudience === "drivers") {
            usersSnap = await db.collection("users").where("role", "in", ["driver", "delivery"]).get();
          } else {
            usersSnap = await db.collection("users").where("role", "in", ["commerce", "comercio"]).get();
          }

          const userIds = usersSnap.docs.map(d => d.id);
          if (userIds.length > 0) {
            for (const uId of userIds) {
              const tSnap = await db.collection("users").doc(uId).collection("fcmTokens").get();
              tSnap.docs.forEach(d => {
                if (d.data().token) {
                  targetTokens.push(d.data().token);
                }
              });
            }
          }
        }
      } catch (tokenErr) {
        logger.error(`Error querying tokens for scheduled campaign ${campaignId}:`, tokenErr);
      }

      targetTokens = [...new Set(targetTokens)];
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
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    logger.error("Error in processScheduledBroadcasts:", err);
  }
});

/**
 * Trigger: Support chat written → Notify Admins of new tickets and bug reports
 */
exports.onSupportChatWritten = onDocumentWritten("support_chats/{userId}", async (event) => {
  const data = event.data.after.data();
  const previousData = event.data.before ? event.data.before.data() : null;

  if (!data) return;

  const ticketId = data.ticketId;
  const userName = data.userName || "Usuario";
  const lastMessageText = data.lastMessageText || "";
  const unreadByAdmin = data.unreadByAdmin === true;
  const unreadByUser = data.unreadByUser === true;

  // 1. Notify Admin on new message from user
  const isNewlyUnread = unreadByAdmin && (!previousData || previousData.unreadByAdmin !== true);

  if (isNewlyUnread && ticketId) {
    try {
      const adminTokens = await getAdminTokens();
      if (adminTokens.length > 0) {
        logger.info(`Sending new support ticket push notification for ${ticketId} to ${adminTokens.length} admins.`);
        
        let title = `Soporte: Nuevo Ticket ${ticketId}`;
await sendPush(adminTokens, {
          title: title,
          body: `${userName}: ${lastMessageText}`
        }, {
          url: `/#/admin/support-chats?userId=${event.params.userId}`, // Redirect admin to their support chats page
          type: "new_support_ticket",
          ticketId: ticketId
        });
      }
    } catch (err) {
      logger.error(`Error sending push for support chat of user ${event.params.userId}:`, err);
    }
  }

  // 2. Notify User on response from admin
  const isNewlyUnreadByUser = unreadByUser && (!previousData || previousData.unreadByUser !== true);

  if (isNewlyUnreadByUser) {
    try {
      const targetTokens = [];
      const targetUserId = data.userId || event.params.userId;
      const tSnap = await db.collection("users").doc(targetUserId).collection("fcmTokens").get();
      tSnap.docs.forEach(d => {
        if (d.data().token) {
          targetTokens.push(d.data().token);
        }
      });

      if (targetTokens.length > 0) {
        logger.info(`Sending support chat response push notification to user ${event.params.userId}.`);
        await sendPush(targetTokens, {
          title: "Soporte Técnico GO! Delivery",
          body: lastMessageText || "Tienes un nuevo mensaje del administrador."
        }, {
          url: "/#/mis-chats", // Redirect user to their support chats page
          type: "support_message"
        });
      }
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
  const OFFER_TIMEOUT_MS = 28 * 1000; // Strict 28-second limit for server rotation
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
exports.onDriverDisconnected = onDocumentUpdated("users/{userId}", async (event) => {
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

    const driverName = after.displayName || after.name || "Repartidor";
    logger.info(`[DriverDisconnect] ${driverName} (${userId}) went offline. Sending push notification.`);

    // 1. Write in-app notification so it appears in the drawer
    await db.collection("users").doc(userId).collection("notifications").add({
      title: "🔴 Sesión finalizada",
      body: "Tu sesión de repartidor fue cerrada. Volvé a conectarte desde el Panel de Repartidor.",
      type: "driver_disconnected",
      url: "#/delivery-panel",
      status: "unread",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Send push notification to the driver's FCM tokens
    const tokens = await getUserTokens(userId);
    if (tokens.length > 0) {
      await sendPush(tokens, {
        title: "🔴 Sesión finalizada",
        body: "Tu sesión de repartidor fue cerrada. Tocá para volver a conectarte."
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

