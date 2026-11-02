// "Compra el repartidor": pedidos a comercios que no confirman (kioscos con catálogo de Ventra).
// El pedido va directo a los repartidores; el repartidor compra en el mostrador, marca qué
// encontró, qué faltaba y qué reemplazó, y carga el total del ticket. El pedido se recalcula
// con lo que realmente llevó (mismas cuentas que createOrder y applyWeights).
//
// La app repite estas cuentas en src/utils/shopper.js para mostrarlas: si cambia una, cambia la otra.

// missing: no había (se agota 24 h) · removed: lo sacó el cliente (sigue a la venta)
const SHOP_STATUSES = ["found", "missing", "removed", "replaced"];
// Lo que puede agregar el repartidor si el cliente cambia el pedido
const MAX_ADDED_ITEMS = 50;
const MAX_ADDED_QTY = 99;
// Un producto que el repartidor no encontró queda "agotado" en la app este tiempo.
const MISSING_HIDE_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Por peso (carnicería, verdulería): en el pedido qty cuenta pasos de weightStep gramos y price es
// el precio de un paso. El repartidor carga cuánto le cobraron y se cobra eso (src/utils/weight.js).
const isWeighed = (item) => !!item && item.soldByWeight === true;
const weightStep = (item) => [100, 250, 500, 1000].includes(Number(item.weightStep)) ? Number(item.weightStep) : 250;
const perKgOf = (item) => Number(item.pricePerKg) || (Number(item.orderedPrice ?? item.price) || 0) * 1000 / weightStep(item);

const isShopperCommerce = (c) => !!c && c.fulfillmentMode === "shopper";
// Pagado antes de que el repartidor compre (no existe hoy en el carrito). Ojo: "mercadopago" en
// el carrito es TRANSFERENCIA al alias del repartidor al recibir, así que sí se acepta.
const isOnlinePayment = (method) => /tarjeta|card|online|prepago|mp_checkout/i.test(String(method || ""));

/**
 * results: { [índice del renglón]: { status: 'found'|'missing'|'removed'|'replaced', qty?, replacementName?, replacementPrice? } }
 * Un renglón sin resultado cuenta como encontrado completo. ticketTotal: lo que dice el ticket del
 * local (opcional); si viene, manda el ticket sea cual sea: el físico va con el pedido.
 * added: [{ name, price, qty }] productos que el cliente sumó por fuera de la app.
 */
function applyShopping(order, results = {}, ticketTotal = null, added = []) {
  const items = Array.isArray(order.items) ? order.items : [];
  const errors = [];
  const missing = [];
  const removed = [];
  const replaced = [];
  let computed = 0;

  const nextItems = items.map((item, idx) => {
    const r = results[idx] || results[String(idx)] || { status: "found" };
    const status = SHOP_STATUSES.includes(r.status) ? r.status : "found";
    const orderedQty = Number(item.orderedQty ?? item.qty) || 1;
    const unit = Number(item.orderedPrice ?? item.price) || 0;
    const base = { ...item, orderedQty, orderedPrice: unit };
    if (status === "missing") {
      missing.push(idx);
      return { ...base, shopStatus: "missing", qty: 0, price: unit, replacement: null };
    }
    if (status === "removed") {
      removed.push(idx);
      return { ...base, shopStatus: "removed", qty: 0, price: unit, replacement: null };
    }
    if (status === "replaced") {
      if (order.allowReplacement !== true) errors.push(`El cliente no aceptó reemplazos (${item.name}).`);
      const name = String(r.replacementName || "").trim().slice(0, 120);
      const price = Number(r.replacementPrice);
      const qty = Math.max(1, Math.min(orderedQty, Math.round(Number(r.qty) || orderedQty)));
      if (!name || !(price > 0)) errors.push(`Falta el nombre o el precio del reemplazo de ${item.name}.`);
      replaced.push(idx);
      computed += price * qty;
      return { ...base, shopStatus: "replaced", qty, price: round2(price), replacement: { name, price: round2(price) } };
    }
    // Por peso: el repartidor carga lo que le cobraron en el local (puede variar un poco de lo
    // pedido); los gramos se calculan con el precio por kilo, solo para mostrarle al cliente
    if (isWeighed(item)) {
      const paid = round2(Number(r.paid) || 0);
      if (!(paid > 0)) errors.push(`Cargá cuánto te cobraron por ${item.name}.`);
      const perKg = perKgOf(item);
      const line = paid > 0 ? paid : unit * orderedQty;
      computed += line;
      return {
        ...base, shopStatus: "found", qty: orderedQty, price: round2(line / orderedQty), replacement: null,
        pricePerKg: perKg, grams: Number(item.grams) || orderedQty * weightStep(item),
        actualGrams: paid > 0 && perKg > 0 ? Math.round(paid * 1000 / perKg) : null, paidByWeight: paid > 0 ? paid : null,
      };
    }
    // Encontrado: puede llevar menos de lo pedido (si había menos, el resto falta) o más, si el cliente lo pidió
    const qty = Math.max(0, Math.min(Math.max(orderedQty, MAX_ADDED_QTY), Math.round(Number(r.qty ?? orderedQty))));
    if (qty === 0) {
      missing.push(idx);
      return { ...base, shopStatus: "missing", qty: 0, price: unit, replacement: null };
    }
    computed += unit * qty;
    return { ...base, shopStatus: qty < orderedQty ? "partial" : qty > orderedQty ? "increased" : "found", qty, price: unit, replacement: null };
  });

  const addedItems = (Array.isArray(added) ? added : []).slice(0, MAX_ADDED_ITEMS).map((a) => {
    // Lo escribe el repartidor y se muestra en varias pantallas: sin marcas de HTML
    const name = String(a?.name || "").replace(/[<>]/g, "").trim().slice(0, 120);
    const price = Number(a?.price);
    const qty = Math.max(1, Math.min(MAX_ADDED_QTY, Math.round(Number(a?.qty) || 1)));
    if (!name || !(price > 0)) errors.push("Falta el nombre o el precio de un producto agregado.");
    computed += (price > 0 ? price : 0) * qty;
    return {
      comercioId: order.comercioId || null, comercioName: order.comercioName || null, name, qty, price: round2(price) || 0,
      orderedQty: 0, orderedPrice: 0, options: [], notes: "", shopStatus: "added", replacement: null,
    };
  });

  computed = round2(computed);
  let subtotal = computed;
  const ticket = Number(ticketTotal);
  if (ticketTotal !== null && ticketTotal !== undefined && ticketTotal !== "") {
    if (!(ticket > 0)) errors.push("El total del ticket no es válido.");
    else subtotal = round2(ticket);
  }

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
  const total = Math.max(round2(subtotal + deliveryCost + appUsageFee - points - couponDiscount), 0);

  const patch = {
    items: [...nextItems, ...addedItems],
    subtotal,
    appUsageFee,
    couponDiscount,
    total,
    estimatedSubtotal: order.estimatedSubtotal ?? order.subtotal ?? 0,
    estimatedTotal: order.estimatedTotal ?? order.total ?? 0,
    shopPending: false,
    shopComputedTotal: computed,
    shopTicketTotal: ticket > 0 ? round2(ticket) : null,
    shopMissingCount: missing.length,
    shopRemovedCount: removed.length,
    shopReplacedCount: replaced.length,
    shopAddedCount: addedItems.length,
    // Lo por peso ya quedó pesado (lo cargó el repartidor)
    ...(items.some(isWeighed) ? { weighPending: false } : {}),
  };
  if (order.totalAmount !== undefined) patch.totalAmount = total;
  // No queda nada para llevar: el pedido se cancela
  const allMissing = items.length > 0 && missing.length + removed.length === items.length && addedItems.length === 0;
  return { patch, missing, removed, replaced, errors, allMissing };
}

module.exports = {
  SHOP_STATUSES, MAX_ADDED_ITEMS, MAX_ADDED_QTY, MISSING_HIDE_MS,
  isShopperCommerce, isOnlinePayment, applyShopping,
};
