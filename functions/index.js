const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

setGlobalOptions({ maxInstances: 2, memory: "256Mi", region: "us-central1" });

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

/**
 * Helper: Get all FCM tokens for a user
 */
async function getUserTokens(userId) {
  try {
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
  let targetUrl = data.url || "/#/";
  if (targetUrl.startsWith('#') || targetUrl.startsWith('/#')) {
    targetUrl = "https://godelivery-magdalena.web.app/" + targetUrl.replace(/^\//, "");
  } else if (targetUrl.startsWith('/')) {
    targetUrl = "https://godelivery-magdalena.web.app" + targetUrl;
  }

  const finalTitle = "Go Delivery";
  const finalBody = notification.title ? `${notification.title}\n${notification.body}` : notification.body;

  let totalSuccess = 0;
  let totalFailure = 0;

  for (const chunk of tokenChunks) {
    const message = {
      notification: {
        title: "Go Delivery",
        body: finalBody
      },
      data: {
        ...data,
        title: "Go Delivery",
        body: finalBody,
        icon: "/logo-pwa.png",
        badge: "/badge-icon.png",
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
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            contentAvailable: true,
            mutableContent: true,
            priority: 10
          }
        }
      },
      webpush: {
        headers: {
          Urgency: "high"
        },
        notification: {
          title: "Go Delivery",
          body: finalBody,
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
    const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
    let tokens = [];
    for (const doc of adminsSnap.docs) {
      const userTokens = await getUserTokens(doc.id);
      tokens = tokens.concat(userTokens);
    }
    return [...new Set(tokens)];
  } catch (err) {
    logger.error("Error getting admin tokens:", err);
    return [];
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

      const adminTokens = await getAdminTokens();
      if (adminTokens.length > 0) {
        await sendPush(adminTokens, {
          title: `🔔 Nuevo Pedido #${orderNum}`,
          body: `Se ha registrado una nueva orden: ${orderTypeLabel}`
        }, {
          tag: `new-order-admin-${orderId}`,
          url: `#/admin/orders/${orderId}`,
          type: 'new_order_alert'
        });
      }

      for (const adminDoc of adminsSnap.docs) {
        await db.collection("users").doc(adminDoc.id).collection("notifications").add({
          title: `🔔 Nuevo Pedido #${orderNum}`,
          body: `Se ha registrado una nueva orden de tipo: ${orderTypeLabel}`,
          type: 'system',
          status: 'unread',
          url: `#/admin/orders/${orderId}`,
          createdAt: new Date()
        });
      }
    } catch (err) {
      logger.error("Error notifying admins of new order:", err);
    }

    // 1. If it's a GoFavor order, notify all online drivers immediately
    if (order.isFavor) {
      const driverTokens = await getOnlineDeliveryTokens();
      if (driverTokens.length > 0) {
        let orderType = "go favor";
        if (order.favorType === "compra") {
          orderType = "mandado / compra";
        } else if (order.favorType === "mandado") {
          orderType = "encomienda";
        } else if (order.favorType === "gocash") {
          orderType = "go cash";
        }
        await sendPush(driverTokens, {
          title: `🛵 ¡Nuevo GoFavor Disponible!`,
          body: `Hay un nuevo pedido de tipo ${orderType.toUpperCase()} listo para tomar.`
        }, { tag: `new-favor-${orderId}`, url: "#/delivery" });
      }
      return;
    }

    // 1.5 If it's a Trip order (Go Viaje), notify all online drivers immediately
    if (order.isTrip) {
      const driverTokens = await getOnlineDeliveryTokens();
      if (driverTokens.length > 0) {
        await sendPush(driverTokens, {
          title: `🚗 ¡Nuevo Viaje Disponible!`,
          body: `Hay un nuevo traslado disponible para tomar.`
        }, { tag: `new-trip-${orderId}`, url: "#/delivery" });
      }
      return;
    }

    // 2. Regular commerce owner notification (Only if Cash payment, Mercado Pago waits for confirmation)
    if (order.paymentMethod === 'efectivo') {
      const comercioDoc = await db.collection("comercios").doc(order.comercioId).get();
      if (comercioDoc.exists) {
        const comData = comercioDoc.data();
        const ownerId = comData.ownerId;
        const commerceName = (comData.name || "").toLowerCase();
        const isGoMarket = commerceName.includes("go!") && commerceName.includes("market");

        if (isGoMarket) {
          // If it's GoMarket, notify ALL admins
          const adminTokens = await getAdminTokens();
          await sendPush(adminTokens, {
            title: "🛒 ¡Nuevo Pedido en GoMarket!",
            body: `Recibiste el pedido #${orderNum} de ${order.userName || "un cliente"}.`
          }, { tag: `new-order-${orderId}`, url: `#/mi-comercio/${order.comercioId}/orders` });
        } else {
          // Regular commerce owner notification
          const ownerTokens = await getUserTokens(ownerId);
          await sendPush(ownerTokens, {
            title: "🔔 ¡Nuevo Pedido Recibido!",
            body: `Tenés un nuevo pedido pendiente de confirmación. #${orderNum}`
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
    // Get the chat document to find participants
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) return;
    
    const chatData = chatDoc.data();
    const orderId = chatData.orderId;
    
    // Get the order to find all relevant parties
    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) return;
    
    const order = orderDoc.data();
    const senderName = message.senderName || "Alguien";
    
    // Determine who to notify (everyone except the sender)
    let recipientIds = [];
    
    if (chatData.type === "client-commerce") {
      // If sender is client → notify commerce owner
      // If sender is commerce → notify client
      if (message.senderId === order.userId) {
        // Client sent → notify commerce owner
        const comercioDoc = await db.collection("comercios").doc(order.comercioId).get();
        if (comercioDoc.exists) {
          recipientIds.push(comercioDoc.data().ownerId);
        }
      } else {
        // Commerce sent → notify client
        recipientIds.push(order.userId);
      }
    } else if (chatData.type === "client-delivery") {
      // If sender is client → notify delivery
      // If sender is delivery → notify client
      if (message.senderId === order.userId) {
        if (order.driverId) recipientIds.push(order.driverId);
      } else {
        recipientIds.push(order.userId);
      }
    }

    // Get tokens and send
    for (const recipientId of recipientIds) {
      const tokens = await getUserTokens(recipientId);
      if (tokens.length > 0) {
        await sendPush(tokens, {
          title: `💬 ${senderName}`,
          body: message.text.length > 150 ? message.text.substring(0, 150) + "..." : message.text
        }, {
          tag: `chat-${chatId}`,
          url: `#/pedido/${orderId}`,
          type: "chat_message"
        });
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
      before.total === after.total) {
    return;
  }

  const orderNum = after.orderId || orderId.slice(0, 6);

  try {
    // Server-side Auto-Accept Logic:
    // If a target driver is assigned, the driver changed, there is no driver assigned yet, and the driver has auto-accept enabled:
    if (after.queueTargetDriverId && before.queueTargetDriverId !== after.queueTargetDriverId && !after.driverId) {
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

          // Notify the driver via Push Notification
          const driverTokens = await getUserTokens(driverId);
          await sendPush(driverTokens, {
            title: "⚡ ¡Pedido auto-aceptado!",
            body: `Se aceptó automáticamente el pedido de ${after.comercioName || 'Comercio'}. ¡Toca para ver tu ruta!`
          }, { 
            tag: `auto-accept-${orderId}`, 
            url: `#/delivery`,
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
        const codeStr = after.verificationCode ? ` Tené listo tu código de entrega: ${after.verificationCode}` : "";
        await sendPush(clientTokens, {
          title: "¡Tu repartidor está en la puerta!",
          body: after.isFavor 
            ? `El repartidor llegó con tu favor. ¡Salí a recibirlo!${codeStr}` 
            : `Prepárate para recibir tu pedido. ¡Ya llegó!${codeStr}`
        }, { tag: `order-at-door-${orderId}`, url: `#/pedido/${orderId}` });
      }
    }

    // Status change notifications
    if (before.status !== after.status) {
      switch (after.status) {
        case "confirmed": {
          // Notify client: "👨‍🍳 Preparando tu pedido"
          const clientTokens = await getUserTokens(after.userId);
          await sendPush(clientTokens, {
            title: "✅ Pedido Confirmado",
            body: "👨‍🍳 Preparando tu pedido. ¡Ya casi está!"
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}` });
          break;
        }
        case "ready": {
          // Notify client: "Un delivery está yendo a buscarlo"
          const clientTokens2 = await getUserTokens(after.userId);
          await sendPush(clientTokens2, {
            title: "📦 Pedido Listo",
            body: "🛵 Un delivery está yendo a buscarlo"
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

          // Fallback: Broadcast to all online drivers if no close driver is found
          let orderType = "simple";
          if (after.isFavor) {
            orderType = after.favorType === "compra" ? "gofavor: compra" : "gofavor: mandado";
          } else if (after.isMultiple) {
            orderType = "multiple";
          }

          const driverTokens = await getOnlineDeliveryTokens();
          // Exclude targeted co-pickup tokens from the general broadcast
          const broadcastTokens = driverTokens.filter(t => !coPickupTokens.includes(t));
          if (broadcastTokens.length > 0) {
            await sendPush(broadcastTokens, {
              title: `🛵 ¡Nuevo Pedido Disponible! (${orderType.toUpperCase()})`,
              body: `Hay un nuevo pedido ${orderType.toUpperCase()} listo para retirar en ${after.comercioName || 'el comercio'}.`
            }, { tag: "new-available-order", url: "#/delivery" });
          }
          break;
        }
        case "delivering": {
          // Notify client: "El pedido está en camino" + Delivery Code
          const clientTokens3 = await getUserTokens(after.userId);
          const delCode = after.verificationCode || "----";
          await sendPush(clientTokens3, {
            title: "🛵 ¡Tu pedido está en camino!",
            body: `El repartidor ya lleva tu pedido. Código de entrega: ${delCode}`
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

          // 2. Update driver's debt: increment by appUsageFee and decrement by couponDiscount
          if (after.driverId) {
            const appFee = after.appUsageFee || 0;
            const couponDiscount = after.couponDiscount || 0;
            const driverIncentiveAmount = after.driverIncentiveAmount || 0;
            const netDebtChange = appFee - couponDiscount - driverIncentiveAmount;
            if (netDebtChange !== 0) {
              try {
                await db.collection("users").doc(after.driverId).update({
                  deliveryDebt: admin.firestore.FieldValue.increment(netDebtChange)
                });
                logger.info(`Updated driver ${after.driverId} debt by ${netDebtChange} (AppFee: ${appFee}, Coupon: -${couponDiscount}, Incentive: -${driverIncentiveAmount}).`);
              } catch (err) {
                logger.error(`Error updating driver ${after.driverId} debt:`, err);
              }
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
                
                // Update order with pointsEarned and appliedMultiplier
                batch.update(db.collection("orders").doc(orderId), {
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
                    
                    // Note on order
                    batch.update(db.collection("orders").doc(orderId), {
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
          await sendPush(clientTokens5, {
            title: "❌ Pedido Cancelado",
            body: `Lamentablemente, tu pedido #${orderNum} de ${after.comercioName} fue cancelado.`
          }, { tag: `order-${orderId}`, url: `#/pedido/${orderId}` });
          break;
        }
      }
    }
    
    // Order modification notification (items or total changed)
    if (before.status === after.status && 
        (JSON.stringify(before.items) !== JSON.stringify(after.items) || before.total !== after.total)) {
      const clientTokens = await getUserTokens(after.userId);
      const modifierName = after.isFavor ? "El repartidor" : (after.comercioName || "El comercio");
      await sendPush(clientTokens, {
        title: "📝 Pedido Modificado",
        body: `${modifierName} modificó tu pedido #${orderNum}. Nuevo total: $${after.total}`
      }, { tag: `order-${orderId}-modified`, url: `#/pedido/${orderId}` });
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
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const artOffset = -3;
  return new Date(utc + (3600000 * artOffset));
}

function isScheduleActive(config) {
  if (!config || !config.enabled) return false;
  
  const now = getArgentinaTime();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  try {
    const [startH, startM] = config.start.split(':').map(Number);
    const [endH, endM] = config.end.split(':').map(Number);
    
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (endMinutes < startMinutes) {
      // Overnight schedule, e.g. 23:00 to 06:00
      return currentTime >= startMinutes || currentTime <= endMinutes;
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
exports.createOrder = onRequest({ cors: true }, async (req, res) => {
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
  const { cart, address, addressNotes, deliveryCoords, paymentMethod, redeemedPoints, totalDelivery, bundleId, tip, couponCode, allowReplacement } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "El carrito está vacío" });
  }

  try {
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

      // Fetch current weather status
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

      const userPoints = userData.points || 0;
      if (redeemedPoints > 0 && userPoints < redeemedPoints) {
        throw new Error("Puntos insuficientes para redimir");
      }

      // Calculate GoPoints discount: 1 point = $1
      const calculatedDiscount = redeemedPoints > 0 ? redeemedPoints : 0;

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

          if (isMySubOrder) {
            const scope = couponData.scope || 'products';
            const discountType = couponData.discountType || (couponData.type === 'free_delivery' ? 'percentage' : 'percentage');
            const couponVal = Number(couponData.value || 0);

            if (scope === 'shipping' || couponData.type === 'free_delivery') {
              if (i === 0) {
                const baseDeliveryFee = Math.max(finalDeliveryCost - driverTip, 0);
                if (couponData.type === 'free_delivery') {
                  subCouponDiscount = baseDeliveryFee;
                } else if (discountType === 'percentage') {
                  subCouponDiscount = baseDeliveryFee * (couponVal / 100);
                } else if (discountType === 'fixed') {
                  subCouponDiscount = Math.min(couponVal, baseDeliveryFee);
                }
              }
            } else { // products
              if (discountType === 'percentage') {
                subCouponDiscount = subProductsTotal * (couponVal / 100);
              } else if (discountType === 'fixed') {
                subCouponDiscount = Math.min(couponVal, subProductsTotal);
              }
            }
          }
        }

        const subTotal = Math.max(subProductsTotal + subDeliveryCost + subAppUsageFee - subDiscount - subCouponDiscount, 0);

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

exports.createFavorOrder = onRequest({ cors: true }, async (req, res) => {
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
  const { type, pickupAddress, pickupCoords, deliveryAddress, deliveryCoords, details, deliveryCost, purchaseFee, appUsageFee, extraStopsFee, stopsCount, total, tip, couponCode, couponDiscount, paymentMethod, receiptDeliveryType } = req.body;

  if (!pickupAddress || !deliveryAddress || !details) {
    return res.status(400).json({ error: "Faltan campos obligatorios (direcciones o detalles)" });
  }

  try {
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

      if (secureDeliveryCost > 0) {
        secureDeliveryCost += activeRainSurcharge;
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
        }
      }
      const finalCouponDiscount = Number(couponDiscount) || secureCouponDiscount;

      const secureTotal = Math.max(finalDeliveryCost + finalPurchaseFee + finalAppUsageFee + Number(extraStopsFee || 0) - Number(finalCouponDiscount || 0) + Number(tip || 0), 0);
      let finalTotal = Number(total);
      if (finalTotal < 0.9 * secureTotal) {
         logger.warn(`GoFavor Total fee tampering detected! Client: ${finalTotal}, calculated: ${secureTotal}. Overwriting.`);
         finalTotal = secureTotal;
      }

      // Extract address notes from deliveryAddress if formatted as "Address (Detalle: Notes)"
      let finalDeliveryAddress = deliveryAddress;
      let addressNotesVal = "";
      const matchDetails = deliveryAddress.match(/^(.*?)\s*\(Detalle:\s*(.*?)\)$/i);
      if (matchDetails) {
        finalDeliveryAddress = matchDetails[1].trim();
        addressNotesVal = matchDetails[2].trim();
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
    // 1. Verify user is an Admin
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
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

  // Protect from loop: Only trigger push notifications for direct P2P points transfer, weekly challenge completions, driver/delivery approvals, scheduled trip events, or commerce approvals
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

  // Get token either from Auth header or req.body.idToken
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
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
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
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const snap = await db.collection("users")
      .where("isOnline", "==", true)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      const isDel = (data.isDelivery === true || data.isDelivery === "true" || data.role === "delivery" || data.role === "driver" || data.role === "repartidor" || data.deliveryStatus === "approved");
      if (!isDel) continue;

      // FIX: Check lastActivityAt (updated by heartbeat/actions) instead of lastActiveTime
      const lastActiveTime = data.lastActivityAt ? data.lastActivityAt.toDate() : new Date(0);
      
      if (lastActiveTime < threeHoursAgo) {
        const activeOrdersSnap = await db.collection("orders")
          .where("driverId", "==", doc.id)
          .where("status", "in", ["confirmed", "ready", "delivering"])
          .get();
          
        if (activeOrdersSnap.empty) {
          await doc.ref.update({ isOnline: false });
          const settingsSnap = await db.collection("settings").doc("global").get();
          const msgs = settingsSnap.exists ? settingsSnap.data().pushMessages : {};
          const title = msgs?.disconnect?.title || "Zzz... Sesión pausada";
          const body = msgs?.disconnect?.body || "Te desconectamos porque pasaron 3 horas de inactividad.";
          
          const tokens = await getUserTokens(doc.id);
          if (tokens.length > 0) {
            await sendPush(tokens, { title, body }, { tag: "auto-disconnect", url: "#/delivery" });
          }
          logger.info(`Auto-disconnected driver ${doc.id}`);
        }
      }
    }
  } catch (e) {
    logger.error("Error in autoDisconnectDrivers:", e);
  }
});

exports.cancelUnassignedOrders = onSchedule("*/5 * * * *", async (event) => {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const pendingOrdersSnap = await db.collection("orders")
      .where("status", "==", "pending")
      .where("createdAt", "<=", thirtyMinutesAgo)
      .get();

    for (const doc of pendingOrdersSnap.docs) {
      const order = doc.data();
      
      await doc.ref.update({
        status: "cancelled",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelReason: "No se encontró un repartidor disponible."
      });

      logger.info(`Automatically cancelled unassigned order ${doc.id} (30 minutes expired).`);

      const clientTokens = await getUserTokens(order.userId);
      if (clientTokens.length > 0) {
        await sendPush(clientTokens, {
          title: "❌ Pedido Cancelado",
          body: "Lo sentimos, no encontramos un repartidor disponible para realizar tu pedido en este momento."
        }, { tag: `order-${doc.id}-cancelled`, url: `#/pedido/${doc.id}` });
      }
    }
  } catch (e) {
    logger.error("Error in cancelUnassignedOrders:", e);
  }
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

exports.onOfferCreated = onDocumentCreated("offers/{offerId}", async (event) => {
  const offer = event.data.data();
  if (!offer) return;
  const title = offer.title || "¡Nueva Oferta!";
  const body = offer.description || "Aprovechá esta oferta especial.";
  
  let targetUrl = "#/";
  if (offer.comercioId) {
    if (offer.productIds && offer.productIds.length > 0) {
      targetUrl = `#/comercio/${offer.comercioId}?product=${offer.productIds[0]}`;
    } else {
      targetUrl = `#/comercio/${offer.comercioId}`;
    }
  }

  try {
    const tokensSnap = await db.collectionGroup("fcmTokens").get();
    const tokens = [...new Set(tokensSnap.docs.map(d => d.data().token).filter(Boolean))];
    
    if (tokens.length > 0) {
      await sendPush(tokens, { title, body }, { tag: `offer-${event.params.offerId}`, url: targetUrl });
    }
  } catch (e) {
    logger.error("Error sending offer push:", e);
  }
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
    // Check Night Surcharge
    if (!before.nightSurchargeConfig?.enabled && after.nightSurchargeConfig?.enabled) {
      const title = msgs.night?.title || "🌙 Recargo Nocturno Activo";
      const body = msgs.night?.body || "Comenzó el horario de recargo nocturno.";
      
      const driverDocs = await getAllDeliveryDrivers();
      let allDriverTokens = [];
      for (const doc of driverDocs) {
         const t = await getUserTokens(doc.id);
         allDriverTokens = allDriverTokens.concat(t);
      }
      allDriverTokens = [...new Set(allDriverTokens)];
      
      if (allDriverTokens.length > 0) {
        await sendPush(allDriverTokens, { title, body }, { tag: "night-surcharge", url: "#/delivery" });
      }
    }
    
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
        // No driver assigned → cancel and notify user
        await doc.ref.update({ status: "cancelled", cancelReason: "No se encontró chofer disponible para el viaje programado." });
        
        if (trip.userId) {
          const userTokens = await getUserTokens(trip.userId);
          if (userTokens.length > 0) {
            await sendPush(userTokens, {
              title: "❌ Viaje programado cancelado",
              body: "Lamentablemente no se encontró un chofer disponible para tu viaje. Intentá solicitar uno nuevo."
            }, { tag: "scheduled-trip-cancelled", url: "#/viajes" });
          }

          // Create notification in Firestore for the user
          await db.collection("users").doc(trip.userId).collection("notifications").add({
            title: "❌ Viaje programado cancelado",
            body: "No se encontró chofer disponible para tu viaje programado. Por favor, intentá solicitar uno nuevo.",
            type: "scheduled_trip_cancelled",
            orderId: doc.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false
          });
        }
        logger.info(`Cancelled unassigned scheduled trip ${doc.id}`);
      }
    }

    logger.info(`Scheduled trip check completed. Reminders: ${reminderSnap.size}, Activations: ${activateSnap.size}`);
  } catch (err) {
    logger.error("Error in checkScheduledTrips:", err);
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
        if (lastMessageText.includes("Reporte de Bug") || lastMessageText.includes("🐞") || lastMessageText.includes("[REPORTE DE BUG/ERROR]")) {
          title = `🐞 Bug Report: ${ticketId}`;
        }

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



