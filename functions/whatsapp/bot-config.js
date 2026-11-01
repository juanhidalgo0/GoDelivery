// Lo que el admin cambia sin publicar (Admin → Bot WhatsApp → Ajustes), en wa_config/bot.
//   short            camino corto: pide todo en un solo mensaje (la mitad de mensajes)
//   banner           imagen del primer saludo del día (es un mensaje más que se cobra)
//   greeting         saludo del menú; {nombre} es el nombre del cliente
//   askCompra, askEnvio, askComercio   qué pide en cada camino; {comercio} en el último
//   hiddenOptions    opciones del menú que no se muestran (ids m_*)
//   budgetArs        tope de gasto por mes; al llegar el bot deja de contestar
//   pricePerMessage  lo que cobra Meta por mensaje pasado el cupo gratis
const DEFAULTS = {
  short: true,
  banner: false,
  greeting: "",
  askCompra: "🛒 *Contame todo en un solo mensaje:*\n• Qué querés y en qué comercio\n• Dirección de entrega\n• Efectivo o transferencia\n\n_Ej: 2 cocas de Paulos, calle 12 n° 345, efectivo_",
  askEnvio: "📦 *Contame todo en un solo mensaje:*\n• Qué hay que llevar\n• Retiro: de dónde\n• Entrega: adónde\n• Efectivo o transferencia\n\n_Ej: unas llaves, retiro: calle 9 n° 120, entrega: calle 20 n° 88, efectivo_",
  askComercio: "✍️ *Contame todo en un solo mensaje para {comercio}:*\n• Qué querés\n• Dirección de entrega\n• Efectivo o transferencia\n\n_Ej: una muzza grande, calle 12 n° 345, efectivo_",
  hiddenOptions: [],
  budgetArs: 100000,
  pricePerMessage: 37.68,
};

const FREE_MONTHLY = 1000;
const NEAR_RATIO = 0.8;

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === "true";

function createBotConfig(db) {
  let cache = { at: 0, value: null };
  async function get() {
    if (cache.value && !isEmulator() && Date.now() - cache.at < 60000) return cache.value;
    const snap = await db.collection("wa_config").doc("bot").get().catch(() => null);
    const d = snap && snap.exists ? snap.data() : {};
    const value = { ...DEFAULTS, ...d };
    // Un texto borrado en el panel vuelve al de siempre: WhatsApp rechaza los mensajes vacíos
    for (const key of ["askCompra", "askEnvio", "askComercio"]) if (!String(value[key] || "").trim()) value[key] = DEFAULTS[key];
    value.budgetArs = Math.max(0, Number(value.budgetArs) || 0);
    value.pricePerMessage = Math.max(0, Number(value.pricePerMessage) || 0);
    value.hiddenOptions = Array.isArray(value.hiddenOptions) ? value.hiddenOptions : [];
    cache = { at: Date.now(), value };
    return value;
  }
  return { get };
}

// Gasto del mes según los mensajes enviados. Es lo que calcula GO!: la factura real la hace Meta.
function budgetState(config, sent) {
  const paid = Math.max(0, (Number(sent) || 0) - FREE_MONTHLY);
  const spentArs = paid * config.pricePerMessage;
  // Sin cupo gratis restante y con tope en 0 no se paga nada: se corta justo al terminar lo gratis
  const capped = (Number(sent) || 0) >= FREE_MONTHLY && spentArs >= config.budgetArs;
  const near = !capped && config.budgetArs > 0 && spentArs >= config.budgetArs * NEAR_RATIO;
  return { spentArs, capped, near };
}

// "2 cocas de Paulos, calle 12 n° 345, efectivo" → { what, address, pickup, pay }
// Lo que no reconoce queda en `what`, que el cadete lee tal cual: nunca se pierde nada de lo escrito.
const LABEL_DELIVERY = /^(?:direcci[oó]n(?: de entrega)?|entrega|entregar en|llevar(?:lo|la)? a|enviar(?:lo|la)? a|mandar(?:lo|la)? a|a mi casa|mi casa|vivo en)\s*[:\-]?\s+(.+)$/i;
const LABEL_PICKUP = /^(?:retiro|retirar(?:lo|la)?(?: en| de)?|buscar(?:lo|la)?(?: en| a)?|desde)\s*[:\-]?\s+(.+)$/i;
// Direcciones de Magdalena: "calle 12 n° 345", "12 e/ 5 y 6", "av. San Martín 450", "barrio X casa 3"
const LOOKS_LIKE_ADDRESS = /\b(?:calle|av\.?|avenida|diagonal|diag\.?|ruta|barrio|bv\.?|boulevard|pasaje)\b.*\d|\b\d+\s*(?:e\/|entre|n°|nro\.?|n[uú]mero|#)\s*\d+/i;
const PAY_PART = /^(?:(?:pago|pagar|pago con|pago en|pagar con|pagar en|con|en|por)\s+)*(efectivo|transferencia|transfer|transf)\.?$/i;

function parseQuick(raw) {
  const parts = String(raw || "").split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  const r = { what: "", address: "", pickup: "", pay: "" };
  const what = [];
  let lastWasAddress = "";
  for (const part of parts) {
    const pay = part.match(PAY_PART);
    if (pay) { r.pay = pay[1].toLowerCase().startsWith("t") ? "transferencia" : "efectivo"; lastWasAddress = ""; continue; }
    const pickup = part.match(LABEL_PICKUP);
    if (pickup) { r.pickup = pickup[1].trim(); lastWasAddress = "pickup"; continue; }
    const delivery = part.match(LABEL_DELIVERY);
    if (delivery) { r.address = delivery[1].trim(); lastWasAddress = "address"; continue; }
    if (!r.address && LOOKS_LIKE_ADDRESS.test(part)) { r.address = part; lastWasAddress = "address"; continue; }
    // "calle 12, n° 345": el número separado por coma sigue siendo la dirección
    if (lastWasAddress && /^(?:n°|nro\.?|n[uú]mero|#)?\s*\d+\w?$/i.test(part)) { r[lastWasAddress === "pickup" ? "pickup" : "address"] += ` ${part}`; continue; }
    lastWasAddress = "";
    what.push(part);
  }
  r.what = what.join(", ");
  return r;
}

module.exports = { DEFAULTS, FREE_MONTHLY, createBotConfig, budgetState, parseQuick };
