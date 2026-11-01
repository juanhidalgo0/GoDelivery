// Pedidos que nacen en WhatsApp. Usan las mismas reglas de precio que createFavorOrder y
// createOrder (index.js), con las mismas funciones: el bot no tiene tarifas propias.
const logger = require("firebase-functions/logger");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { newTrackingToken } = require("./tracking");
const { ensureWaUser } = require("./wa-users");

// Mismo centro que usa la app para las compras (src/utils/mandado-places.js TOWN_CENTER)
const TOWN_CENTER = { lat: -35.0811, lng: -57.5146 };

// 5492211234567 -> 2211234567, el formato en que se guarda users.phone
function nationalPhone(waId) {
  const d = String(waId || "").replace(/\D/g, "");
  if (d.startsWith("549") && d.length === 13) return d.slice(3);
  if (d.startsWith("54") && d.length === 12) return d.slice(2);
  return d.slice(-10);
}

const coordsOf = (c) => {
  if (!c) return null;
  const lat = c.lat !== undefined ? c.lat : c.latitude;
  const lng = c.lng !== undefined ? c.lng : c.longitude;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null;
};

function createOrders(db, h) {
  // h: { computeDeliveryFee, computeEncomiendaFee, encomiendaMinFee, getDistance, calculateScheduleSurcharge, resolveAutoRain, commissionEnabled }

  async function hasOnlineDriver() {
    const snap = await db.collection("users").where("isOnline", "==", true).get();
    return snap.docs.some((doc) => {
      const d = doc.data();
      const role = (d.role || "").toLowerCase();
      return d.isDelivery === true || d.isDelivery === "true" || ["delivery", "driver", "repartidor", "chofer"].includes(role);
    });
  }

  // Si el número ya tiene cuenta en la app, el pedido queda en su historial y le llegan los avisos
  // de la app también. Si no, se identifica por el número, como hacía el bot anterior.
  async function resolveCustomer(waId, profileName) {
    const phone = nationalPhone(waId);
    try {
      const snap = await db.collection("users").where("phone", "==", phone).limit(1).get();
      if (!snap.empty) {
        const u = snap.docs[0].data();
        return { userId: snap.docs[0].id, userName: u.displayName || u.name || profileName || "Cliente", phone, linked: true };
      }
    } catch (err) {
      logger.warn("[WhatsApp] No se pudo buscar el usuario por teléfono:", err);
    }
    return { userId: String(waId), userName: profileName || "Cliente WhatsApp", phone, linked: false };
  }

  async function loadPricingContext() {
    const [gSnap, wSnap] = await Promise.all([
      db.collection("settings").doc("global").get(),
      db.collection("settings").doc("weather").get(),
    ]);
    const gs = gSnap.exists ? gSnap.data() : {};
    const rainMode = gs.rainMode || "auto";
    const isRaining = rainMode === "on" ? true : rainMode === "off" ? false : await h.resolveAutoRain(wSnap.exists ? wSnap.data() : {});
    const rain = isRaining ? (gs.deliveryRainSurcharge !== undefined ? Number(gs.deliveryRainSurcharge) : 300) : 0;
    return { gs, isRaining, rain };
  }

  // Mandado (compra o encomienda): mismas cuentas que la parte segura de createFavorOrder.
  // stopsCount: comercios de una compra; cada uno después del primero suma deliveryExtraStopFee (como createFavorOrder)
  async function quoteFavor({ type, pickupCoords, deliveryCoords, stopsCount = 1 }) {
    const { gs, isRaining, rain } = await loadPricingContext();
    const p = coordsOf(pickupCoords), d = coordsOf(deliveryCoords);
    // Encomienda ("mandado" para el bot): su tarifa propia, si está activa
    const isEncomienda = type === "mandado";
    const base = p && d
      ? (isEncomienda ? h.computeEncomiendaFee : h.computeDeliveryFee)(h.getDistance(p.lat, p.lng, d.lat, d.lng), gs)
      : (isEncomienda ? h.encomiendaMinFee(gs) : (Number(gs.deliveryMinPrice) || 1500));
    const night = h.calculateScheduleSurcharge(gs.nightSurchargeConfig, base);
    const deliveryCost = base > 0 ? base + rain + night : 0;
    const purchaseFee = type === "compra" ? (gs.favorPurchaseFee !== undefined ? Number(gs.favorPurchaseFee) : 800) : 0;
    const feeCfg = (gs.servicesAppFeeConfig || {}).gofavor || { type: "percentage", value: 1.2 };
    const appUsageFee = feeCfg.type === "fixed"
      ? Number(feeCfg.value) || 0
      : Math.ceil((base * ((Number(feeCfg.value) || 0) / 100)) / 10) * 10;
    const stops = Math.min(10, Math.max(1, Math.floor(Number(stopsCount) || 1)));
    const extraStopsFee = (stops - 1) * (gs.deliveryExtraStopFee !== undefined ? Number(gs.deliveryExtraStopFee) : 500);
    const total = Math.max(0, Math.ceil(deliveryCost + purchaseFee + extraStopsFee + appUsageFee));
    return { baseFee: base, deliveryCost, isRaining, rainSurcharge: rain, nightSurcharge: night, purchaseFee, extraStopsFee, stopsCount: stops, appUsageFee, total, exactDistance: !!(p && d) };
  }

  // Pedido a comercio con precio que puso el comercio: mismas cuentas que createOrder para un
  // solo comercio, sin cupones ni puntos.
  async function quoteCommerce({ comercio, deliveryCoords, productsTotal }) {
    const { gs, isRaining, rain } = await loadPricingContext();
    const c = coordsOf(comercio && comercio.coords), d = coordsOf(deliveryCoords);
    const fee = c && d ? h.computeDeliveryFee(h.getDistance(d.lat, d.lng, c.lat, c.lng), gs) : (Number(gs.deliveryMinPrice) || 1500);
    const deliveryFee = fee + rain;
    const night = h.calculateScheduleSurcharge(gs.nightSurchargeConfig, deliveryFee);
    const incentive = h.calculateScheduleSurcharge(gs.driverIncentiveConfig, deliveryFee);
    const deliveryCost = deliveryFee + night;
    const products = Math.max(0, Math.round(Number(productsTotal) || 0));
    const rate = gs.appUsageFeeRate !== undefined ? gs.appUsageFeeRate : 0.05;
    const appUsageFee = Math.ceil((products * rate) / 10) * 10;
    const commissionRate = !h.commissionEnabled ? 0
      : (comercio && comercio.commissionRate !== undefined && comercio.commissionRate !== null ? comercio.commissionRate : 0.10);
    return {
      subtotal: products, deliveryCost, isRaining, rainSurcharge: rain, nightSurcharge: night,
      driverIncentiveAmount: incentive, appUsageFee, commissionAmount: products * commissionRate,
      total: Math.max(0, products + deliveryCost + appUsageFee), exactDistance: !!(c && d),
    };
  }

  async function nextOrderNumber(tx) {
    const ref = db.collection("settings").doc("settings");
    const snap = await tx.get(ref);
    const n = (snap.exists && snap.data().lastOrderId ? snap.data().lastOrderId : 0) + 1;
    return { ref, n };
  }

  function mediaLines(media) {
    return (media || []).filter((m) => m && m.url)
      .map((m) => `${m.type === "audio" ? "🎤 Audio" : m.type === "image" ? "📷 Foto" : "📎 Archivo"}: ${m.url}`).join("\n");
  }

  // f: { waId, customer, type, details, media, pickupAddress, pickupCoords, deliveryAddress, deliveryCoords, addressNotes, paymentMethod, tip }
  // f.stops (compras): [{ store, items, media }] → mandadoStops, el mismo formato que la app
  async function createFavor(f) {
    const pickupCoords = f.type === "compra" ? TOWN_CENTER : coordsOf(f.pickupCoords);
    const stops = f.type === "compra" && Array.isArray(f.stops)
      ? f.stops.filter((st) => st && String(st.store || "").trim()).slice(0, 10).map((st) => ({
        store: String(st.store).replace(/\s+/g, " ").trim().slice(0, 80),
        items: [String(st.items || "").trim(), mediaLines(st.media)].filter(Boolean).join("\n").slice(0, 600),
      }))
      : [];
    const q = await quoteFavor({ type: f.type, pickupCoords, deliveryCoords: f.deliveryCoords, stopsCount: stops.length || 1 });
    // Propina del formulario: como en la app, va entera al cadete y solo puede sumar
    const tip = Math.round(Number(f.tip) || 0);
    const safeTip = tip > 0 && tip <= 100000 ? tip : 0;
    const details = [String(f.details || "").trim(), mediaLines(f.media)].filter(Boolean).join("\n\n") || "Pedido por WhatsApp";
    const orderRef = db.collection("orders").doc();
    const trackingToken = newTrackingToken();
    await ensureWaUser(db, { userId: f.customer.userId, userName: f.customer.userName, userPhone: f.customer.phone, waPhone: f.waId });
    const orderNum = await db.runTransaction(async (tx) => {
      const { ref, n } = await nextOrderNumber(tx);
      tx.set(orderRef, {
        orderId: n,
        trackingToken,
        isFavor: true,
        favorType: f.type,
        source: "whatsapp_bot",
        waPhone: String(f.waId),
        userId: f.customer.userId,
        userName: f.customer.userName,
        userPhone: f.customer.phone,
        pickupAddress: f.type === "compra"
          ? (stops.length > 1 ? `Múltiples comercios (${stops.length} comercios)` : stops.length ? `Comercio: ${stops[0].store}` : "Donde indique el pedido")
          : (f.pickupAddress || "A coordinar"),
        ...(stops.length ? { mandadoStops: stops, storeName: stops[0].store } : {}),
        pickupCoords: pickupCoords || null,
        deliveryAddress: f.deliveryAddress || "A coordinar",
        deliveryCoords: coordsOf(f.deliveryCoords),
        addressNotes: f.addressNotes || "",
        details,
        waMedia: (f.media || []).filter((m) => m && m.url),
        deliveryCost: q.deliveryCost,
        isRaining: q.isRaining,
        rainSurcharge: q.rainSurcharge,
        nightSurcharge: q.nightSurcharge,
        purchaseFee: q.purchaseFee,
        appUsageFee: q.appUsageFee,
        extraStopsFee: q.extraStopsFee || 0,
        stopsCount: q.stopsCount || 1,
        total: q.total + safeTip,
        status: "pending",
        paymentMethod: f.paymentMethod || "efectivo",
        paymentStatus: "pending",
        tip: safeTip,
        couponCode: null,
        couponDiscount: 0,
        directDriverUid: null,
        queueTargetDriverId: null,
        queueTargetDriverName: null,
        queueOfferedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(ref, { lastOrderId: n }, { merge: true });
      return n;
    });
    await db.collection("notifications").add({
      title: "Nuevo favor disponible", message: `Hay un nuevo ${f.type} disponible`, type: "new_favor", status: "unread", createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    return { id: orderRef.id, orderNum, quote: q, total: q.total + safeTip, trackingToken };
  }

  // El comercio escribe al bot pidiendo un cadete: mismo pedido que armaba el bot anterior.
  async function createCadeteria({ waId, comercio }) {
    const { gs } = await loadPricingContext();
    const base = Math.max(Number(gs.deliveryMinPrice) || 1500, Number(gs.deliveryBasePrice) || 1400);
    const orderRef = db.collection("orders").doc();
    const orderNum = await db.runTransaction(async (tx) => {
      const { ref, n } = await nextOrderNumber(tx);
      tx.set(orderRef, {
        orderId: n,
        source: "whatsapp_bot",
        waPhone: String(waId),
        isFavor: true,
        isCommerceCadeteria: true,
        orderType: "cadeteria",
        favorType: "cadeteria",
        status: "pending",
        comercioId: comercio.id,
        comercioName: comercio.name || "Comercio",
        comercioAddress: comercio.address || comercio.name || "",
        comercioCoords: coordsOf(comercio.coords),
        userId: String(waId),
        userName: comercio.name || "Comercio",
        userPhone: nationalPhone(waId),
        pickupAddress: comercio.address || comercio.name || "",
        pickupCoords: coordsOf(comercio.coords),
        dropoffAddress: "Según los tickets del local",
        deliveryAddress: "Según los tickets del local",
        details: `Cadete para ${comercio.name || "el comercio"}. El repartidor coordina en el mostrador cuántos paquetes lleva.`,
        stopsCount: 1,
        deliveryCost: base,
        total: base,
        paymentMethod: "efectivo",
        paymentStatus: "pending",
        noCodeRequired: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(ref, { lastOrderId: n }, { merge: true });
      return n;
    });
    return { id: orderRef.id, orderNum };
  }

  // Pedido escrito a un comercio: queda esperando que el comercio diga si lo tiene y cuánto sale.
  async function createQuote(f) {
    const ref = db.collection("wa_quotes").doc();
    await ref.set({
      status: "waiting",
      waPhone: String(f.waId),
      userId: f.customer.userId,
      customerName: f.customer.userName,
      customerPhone: f.customer.phone,
      comercioId: f.comercio.id,
      comercioName: f.comercio.name || "Comercio",
      requestText: String(f.details || "").trim(),
      media: (f.media || []).filter((m) => m && m.url),
      deliveryAddress: f.deliveryAddress || "",
      deliveryCoords: coordsOf(f.deliveryCoords),
      addressNotes: f.addressNotes || "",
      paymentMethod: f.paymentMethod || "efectivo",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    });
    return { id: ref.id };
  }

  // El cliente aceptó el precio: el pedido entra ya aceptado por el comercio (status confirmed),
  // así sigue el camino de siempre: el comercio lo marca listo y ahí se busca cadete.
  async function createOrderFromQuote(quoteId) {
    const quoteRef = db.collection("wa_quotes").doc(quoteId);
    const orderRef = db.collection("orders").doc();
    const trackingToken = newTrackingToken();
    const res = await db.runTransaction(async (tx) => {
      const qSnap = await tx.get(quoteRef);
      if (!qSnap.exists) throw new Error("quote_missing");
      const qd = qSnap.data();
      // Sin pricing todavía: el precio se está calculando (el cliente tocó un botón viejo)
      if (qd.status !== "quoted" || !qd.pricing) return { already: true, status: qd.status, orderId: qd.orderId || null, orderNum: qd.orderNum || null, trackingToken: qd.trackingToken || null };
      const cSnap = await tx.get(db.collection("comercios").doc(qd.comercioId));
      const comercio = cSnap.exists ? { id: cSnap.id, ...cSnap.data() } : { id: qd.comercioId, name: qd.comercioName };
      const p = qd.pricing || {};
      const { ref, n } = await nextOrderNumber(tx);
      const prep = Math.max(5, Math.min(120, Number(qd.prepMinutes) || 20));
      const note = [qd.requestText, mediaLines(qd.media), qd.commerceNote ? `Comercio: ${qd.commerceNote}` : ""].filter(Boolean).join("\n");
      tx.set(orderRef, {
        orderId: n,
        trackingToken,
        isBundle: false,
        bundleIndex: 0,
        bundleCount: 1,
        comercioId: comercio.id,
        comercioName: comercio.name || qd.comercioName,
        comercioCoords: coordsOf(comercio.coords),
        userId: qd.userId,
        userName: qd.customerName,
        userPhone: qd.customerPhone,
        waPhone: qd.waPhone,
        waQuoteId: quoteId,
        deliveryAddress: qd.deliveryAddress || "A coordinar",
        addressNotes: qd.addressNotes || "",
        deliveryCoords: qd.deliveryCoords || null,
        items: [{ comercioId: comercio.id, comercioName: comercio.name || qd.comercioName, productId: null, name: "Pedido por WhatsApp", price: p.subtotal || 0, qty: 1, options: [], notes: note }],
        subtotal: p.subtotal || 0,
        deliveryCost: p.deliveryCost || 0,
        tip: 0,
        isRaining: !!p.isRaining,
        rainSurcharge: p.rainSurcharge || 0,
        nightSurcharge: p.nightSurcharge || 0,
        driverIncentiveAmount: p.driverIncentiveAmount || 0,
        appUsageFee: p.appUsageFee || 0,
        discountAmount: 0,
        pointsRedeemed: 0,
        couponCode: null,
        couponDiscount: 0,
        total: p.total || 0,
        commissionAmount: p.commissionAmount || 0,
        deliveryType: "delivery",
        source: "whatsapp_bot",
        isDirectOrder: false,
        status: "confirmed",
        confirmedAt: FieldValue.serverTimestamp(),
        preparationTimeMinutes: prep,
        estimatedReadyAt: Timestamp.fromMillis(Date.now() + prep * 60000),
        paymentMethod: qd.paymentMethod || "efectivo",
        paymentStatus: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(ref, { lastOrderId: n }, { merge: true });
      tx.update(quoteRef, { status: "accepted", orderId: orderRef.id, orderNum: n, trackingToken, acceptedAt: FieldValue.serverTimestamp() });
      return { id: orderRef.id, orderNum: n, total: p.total || 0, trackingToken };
    });
    if (!res.already) {
      const q = (await quoteRef.get()).data() || {};
      await ensureWaUser(db, { userId: q.userId, userName: q.customerName, userPhone: q.customerPhone, waPhone: q.waPhone }).catch(() => {});
    }
    return res;
  }

  return { hasOnlineDriver, resolveCustomer, quoteFavor, quoteCommerce, createFavor, createCadeteria, createQuote, createOrderFromQuote, coordsOf };
}

module.exports = { createOrders, nationalPhone, TOWN_CENTER };
