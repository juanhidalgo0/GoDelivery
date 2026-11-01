import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase.js';
import { showConfirm } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { functionUrl } from '../../utils/functions-url.js';

// Same limits as functions/pin-correction.js, which checks them again.
const MIN_DISTANCE_M = 300;
const MAX_ACCURACY_M = 50;
const MAX_FIX_AGE_MS = 3 * 60 * 1000;

function distanceM(a, b) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return 6371000 * Math.hypot(x, y);
}

async function firstOrderDeliveredFarFromPin(orders) {
  for (const order of orders) {
    if (!order.userId || !order.deliveryCoords || order.isTrip || order.deliveryType === 'takeaway') continue;
    const snap = await getDoc(doc(db, 'orders', order.id, 'live', 'driver'));
    if (!snap.exists()) continue;
    const live = snap.data();
    if (typeof live.accuracy !== 'number' || live.accuracy > MAX_ACCURACY_M) continue;
    if (typeof live.fixAt !== 'number' || Date.now() - live.fixAt > MAX_FIX_AGE_MS) continue;
    const meters = distanceM(order.deliveryCoords, live);
    if (meters >= MIN_DISTANCE_M) return { order, meters };
  }
  return null;
}

async function sendCorrection(orderId) {
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(functionUrl('correctDeliveryPin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (data.corrected) showToast('¡Gracias! El próximo pedido a esa casa ya va al lugar correcto', 'success');
  } catch (err) {
    console.warn('[pin-correction] Could not send the correction:', err);
  }
}

/**
 * Delivered far from the customer's pin: asks whether the house really is here. "done" always runs
 * and this never blocks the next step: without signal or GPS it just moves on.
 */
export async function askPinCorrection(orders, done) {
  let far = null;
  try {
    far = await firstOrderDeliveredFarFromPin(orders);
  } catch (err) {
    console.warn('[pin-correction] Could not read the position:', err);
  }
  if (!far) {
    done();
    return;
  }
  // After the dialog's closing animation, or the next modal would close along with it.
  const next = () => setTimeout(done, 350);
  const meters = Math.round(far.meters / 100) * 100;
  showConfirm({
    title: '¿La casa es acá?',
    message: `Marcaste la entrega a unos ${meters} m del punto que puso el cliente. Si la casa está donde estás ahora, corregimos el punto para los próximos pedidos.`,
    confirmText: 'Sí, es acá',
    cancelText: 'No',
    onConfirm: () => {
      sendCorrection(far.order.id);
      next();
    },
    onCancel: next
  });
}
