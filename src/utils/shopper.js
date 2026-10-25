// Copia de functions/shopper.js para mostrar en la app lo que el servidor va a calcular
// ("compra el repartidor"). Si cambia una cuenta allá, cambia acá: tests/compra-repartidor.test.mjs
// compara las dos.

export const SHOP_STATUSES = ["found", "missing", "replaced"];
// El ticket puede diferir un poco de la suma (redondeos, una promo del local); más que esto
// es un error de carga y se pide revisarlo.
export const TICKET_TOLERANCE = 0.2;
export const TICKET_TOLERANCE_MIN = 500;
// Un producto que el repartidor no encontró queda "agotado" en la app este tiempo.
export const MISSING_HIDE_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const isShopperCommerce = (c) => !!c && c.fulfillmentMode === "shopper";
// Pagado antes de que el repartidor compre (no existe hoy en el carrito). Ojo: "mercadopago" en
// el carrito es TRANSFERENCIA al alias del repartidor al recibir, así que sí se acepta.
export const isOnlinePayment = (method) => /tarjeta|card|online|prepago|mp_checkout/i.test(String(method || ""));

/**
 * results: { [índice del renglón]: { status: 'found'|'missing'|'replaced', qty?, replacementName?, replacementPrice? } }
 * Un renglón sin resultado cuenta como encontrado completo. ticketTotal: lo que dice el ticket del
 * local (opcional); si viene y está cerca de la suma, manda el ticket.
 */
export function applyShopping(order, results = {}, ticketTotal = null) {
  const items = Array.isArray(order.items) ? order.items : [];
  const errors = [];
  const missing = [];
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
    // Encontrado: puede llevar menos de lo pedido (si había menos, el resto falta)
    const qty = Math.max(0, Math.min(orderedQty, Math.round(Number(r.qty ?? orderedQty))));
    if (qty === 0) {
      missing.push(idx);
      return { ...base, shopStatus: "missing", qty: 0, price: unit, replacement: null };
    }
    computed += unit * qty;
    return { ...base, shopStatus: qty < orderedQty ? "partial" : "found", qty, price: unit, replacement: null };
  });

  computed = round2(computed);
  let subtotal = computed;
  const ticket = Number(ticketTotal);
  if (ticketTotal !== null && ticketTotal !== undefined && ticketTotal !== "") {
    if (!(ticket > 0)) errors.push("El total del ticket no es válido.");
    else if (Math.abs(ticket - computed) > Math.max(computed * TICKET_TOLERANCE, TICKET_TOLERANCE_MIN)) {
      errors.push(`El ticket ($${Math.round(ticket)}) no coincide con lo marcado ($${Math.round(computed)}). Revisá las cantidades.`);
    } else subtotal = round2(ticket);
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
    items: nextItems,
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
    shopReplacedCount: replaced.length,
  };
  if (order.totalAmount !== undefined) patch.totalAmount = total;
  const allMissing = items.length > 0 && missing.length === items.length;
  return { patch, missing, replaced, errors, allMissing };
}
