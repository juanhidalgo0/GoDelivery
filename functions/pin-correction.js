// El cadete entregó lejos del pin y confirma que la casa está donde él está parado: el pin guardado
// del cliente pasa a ese punto, así el próximo pedido no repite el viaje (pedido 2408, a 2,9 km).
//
// La posición sale de orders/{id}/live/driver, la que manda su GPS durante el pedido: la app no
// elige las coordenadas, y sólo vale una lectura precisa y de cuando marcó entregado.

const MIN_DISTANCE_M = 300;
const MAX_ACCURACY_M = 50;
const MAX_FIX_AGE_MS = 3 * 60 * 1000; // lectura del GPS respecto de la entrega
const MAX_ANSWER_MS = 30 * 60 * 1000; // respuesta del cadete respecto de la entrega

function distanceM(a, b) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return 6371000 * Math.hypot(x, y);
}

const samePoint = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

/** Motivo por el que no se corrige, o null si corresponde. */
function rejection(order, live, uid, now) {
  if (!order) return "order_not_found";
  if (order.driverId !== uid) return "not_your_order";
  if (order.status !== "completed" || !order.deliveredAt) return "not_delivered";
  if (order.isTrip || order.deliveryType === "takeaway") return "not_a_delivery";
  if (!order.userId || !order.deliveryCoords) return "no_customer_pin";
  if (order.deliveryPinCorrection) return "already_corrected";
  const deliveredAt = order.deliveredAt.toMillis();
  if (now - deliveredAt > MAX_ANSWER_MS) return "too_late";
  if (!live || typeof live.lat !== "number" || typeof live.lng !== "number") return "no_gps";
  if (typeof live.accuracy !== "number" || live.accuracy > MAX_ACCURACY_M) return "gps_not_precise";
  if (typeof live.fixAt !== "number" || Math.abs(deliveredAt - live.fixAt) > MAX_FIX_AGE_MS) return "gps_too_old";
  if (distanceM(order.deliveryCoords, live) < MIN_DISTANCE_M) return "close_enough";
  return null;
}

/** Campos a actualizar en el perfil: sólo las direcciones que tienen el pin que usó el pedido. */
function profileUpdate(userData, from, to) {
  const update = { pinCorrection: { from, to } };
  const saved = Array.isArray(userData.savedAddresses) ? userData.savedAddresses : [];
  if (saved.some((a) => samePoint(a.coords, from))) {
    update.savedAddresses = saved.map((a) => (samePoint(a.coords, from) ? { ...a, coords: to } : a));
  }
  if (samePoint(userData.lastAddress && userData.lastAddress.coords, from)) {
    update.lastAddress = { ...userData.lastAddress, coords: to };
  }
  return update;
}

async function correctPin(db, uid, orderId, now = Date.now()) {
  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const [orderSnap, liveSnap] = await Promise.all([tx.get(orderRef), tx.get(orderRef.collection("live").doc("driver"))]);
    const order = orderSnap.exists ? orderSnap.data() : null;
    const live = liveSnap.exists ? liveSnap.data() : null;
    const reason = rejection(order, live, uid, now);
    if (reason) return { corrected: false, reason };

    const userRef = db.collection("users").doc(order.userId);
    const userSnap = await tx.get(userRef);
    const from = { lat: order.deliveryCoords.lat, lng: order.deliveryCoords.lng };
    const to = { lat: live.lat, lng: live.lng };
    if (userSnap.exists) tx.update(userRef, profileUpdate(userSnap.data(), from, to));
    tx.update(orderRef, { deliveryPinCorrection: { from, to, accuracy: live.accuracy, by: uid, at: new Date(now) } });
    return { corrected: true };
  });
}

module.exports = { correctPin, rejection, profileUpdate, distanceM, MIN_DISTANCE_M, MAX_ACCURACY_M };
