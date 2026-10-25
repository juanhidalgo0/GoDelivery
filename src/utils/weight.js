// Venta por peso (carnicerías, verdulerías): el producto guarda el precio por kilo y de a
// cuántos gramos se elige (weightStep). En el carrito y en el pedido `qty` cuenta pasos:
// 4 pasos de 250 g = 1 kg. Así todas las cuentas de precio × cantidad siguen valiendo.
//
// El total del pedido es estimado hasta que el comercio pesa: al marcar "Listo" carga el
// peso real de cada corte y el pedido se recalcula (applyWeights). Si un corte se va más de
// WEIGHT_TOLERANCE de lo pedido, el comercio tiene que haberlo hablado con el cliente.
//
// El servidor repite estas cuentas en functions/weight.js: si cambia una, cambia la otra.

export const WEIGHT_STEPS = [100, 250, 500, 1000];
export const DEFAULT_WEIGHT_STEP = 250;
export const WEIGHT_TOLERANCE = 0.10;

export const isSoldByWeight = (product) => product?.soldByWeight === true;

export function weightStepOf(product) {
  const step = Number(product?.weightStep);
  return WEIGHT_STEPS.includes(step) ? step : DEFAULT_WEIGHT_STEP;
}

// Precio de un paso a partir del precio por kilo (con opciones ya sumadas).
export const stepPrice = (perKg, product) => (Number(perKg) || 0) * weightStepOf(product) / 1000;

// Cuántos pasos son 1 kg (o el paso mínimo si el paso es más grande que eso).
export const defaultSteps = (product) => Math.max(1, Math.round(1000 / weightStepOf(product)));

// 250 → "250 g" · 1000 → "1 kg" · 1500 → "1,5 kg" · 1085 → "1,085 kg"
export function formatWeight(grams) {
  const g = Math.round(Number(grams) || 0);
  if (g < 1000) return `${g} g`;
  return `${(g / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg`;
}

// "1,085" · "1.085" · "1085 g" · "0,9 kg" → gramos. Un número sin unidad mayor a 20 se toma
// como gramos (nadie pide 20 kg de un corte; la balanza marca 1,085).
export function parseWeightInput(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const isGrams = /g$/.test(s) && !/kg$/.test(s);
  const n = Number(s.replace(/kg$|g$/, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const grams = isGrams || n > 20 ? n : n * 1000;
  return Math.round(grams);
}

// Línea de un pedido: ¿es por peso y cuánto se pidió?
export const isWeighedItem = (item) => item?.soldByWeight === true;
export const orderedGrams = (item) => Number(item?.grams) || (Number(item?.qty) || 0) * weightStepOf(item);
export const toleranceRange = (item) => {
  const g = orderedGrams(item);
  return { min: Math.round(g * (1 - WEIGHT_TOLERANCE)), max: Math.round(g * (1 + WEIGHT_TOLERANCE)) };
};

// Precio por kilo que paga el cliente en esa línea (ya con la oferta aplicada).
export const itemPricePerKg = (item) => Number(item?.pricePerKg) || (Number(item?.price) || 0) * 1000 / weightStepOf(item);

// Cuánto se lleva el cliente en una línea: lo pesado si ya se pesó, si no lo pedido.
export function itemWeightLabel(item) {
  if (!isWeighedItem(item)) return '';
  return Number(item.actualGrams) > 0 ? formatWeight(item.actualGrams) : formatWeight(orderedGrams(item));
}

export const orderHasWeighedItems = (order) => Array.isArray(order?.items) && order.items.some(isWeighedItem);

// Recalcula el pedido con el peso real de cada línea por peso. gramsByIndex: { [índice]: gramos }.
// Devuelve los campos a guardar en el pedido y las líneas que se fueron del tope.
// Mismas cuentas que createOrder: total = productos + envío + servicio − GoPoints − cupón.
export function applyWeights(order, gramsByIndex) {
  const items = Array.isArray(order.items) ? order.items : [];
  let delta = 0;
  const outOfRange = [];
  const missing = [];

  const nextItems = items.map((item, idx) => {
    if (!isWeighedItem(item)) return item;
    const grams = Math.round(Number(gramsByIndex?.[idx]) || 0);
    if (!(grams > 0)) { missing.push(idx); return item; }
    const qty = Number(item.qty) || 1;
    const before = (Number(item.price) || 0) * qty;
    const line = Math.round(itemPricePerKg(item) * grams / 1000);
    delta += line - before;
    const { min, max } = toleranceRange(item);
    if (grams < min || grams > max) outOfRange.push(idx);
    return {
      ...item,
      grams: orderedGrams(item),
      pricePerKg: itemPricePerKg(item),
      orderedPrice: item.orderedPrice ?? item.price,
      actualGrams: grams,
      price: line / qty,
    };
  });

  const subtotal = Math.max(0, (Number(order.subtotal) || 0) + delta);
  const rate = Number(order.appUsageFeeRate);
  const appUsageFee = Number.isFinite(rate) && rate >= 0
    ? Math.ceil((subtotal * rate) / 10) * 10
    : Number(order.appUsageFee) || 0;
  const deliveryCost = Number(order.deliveryCost) || 0;
  const pct = Number(order.couponProductsPercent);
  const couponDiscount = pct > 0
    ? subtotal * (pct / 100)
    : Math.min(Number(order.couponDiscount) || 0, subtotal + deliveryCost);
  const points = Number(order.discountAmount) || 0;
  const total = Math.max(subtotal + deliveryCost + appUsageFee - points - couponDiscount, 0);

  const patch = {
    items: nextItems,
    subtotal,
    appUsageFee,
    couponDiscount,
    total,
    estimatedSubtotal: order.estimatedSubtotal ?? order.subtotal ?? 0,
    estimatedTotal: order.estimatedTotal ?? order.total ?? 0,
    weighPending: false,
  };
  // "Modificar" del panel guarda una copia del total con este nombre.
  if (order.totalAmount !== undefined) patch.totalAmount = total;
  return { missing, outOfRange, patch };
}
