// Conversación del bot de WhatsApp: menú, preguntas guiadas y botones. La IA (understand.js, Claude
// Haiku) solo se usa cuando las reglas no alcanzan para entender un pedido escrito de corrido o un audio.
//
// Tres caminos para cualquier pedido, según lo que GO! sabe del lugar:
//   compra / envío  → mandado: el cadete lee el texto tal cual (no hace falta entenderlo)
//   comercio        → con catálogo: link a su tienda; o pedido escrito que el comercio cotiza
// El estado de cada conversación vive en wa_sessions/{waId}.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { norm, storeUrl } = require("./comercios");
const { TOWN_CENTER } = require("./orders");
const { trackingUrl } = require("./tracking");
const { APP_URL } = require("./comercios");
const { DEFAULTS, parseQuick } = require("./bot-config");

// Banner de bienvenida (public/wa-banner.jpg, scripts/make-wa-banner.py): una vez por día por cliente
const BANNER_URL = `${APP_URL}/wa-banner.jpg`;
const FOOTER = "GO! Delivery · Magdalena";
const argDay = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;      // un pedido a medio armar se olvida a las 2 h
const SUPPORT_TTL_MS = 12 * 60 * 60 * 1000;
const COMERCIO_RECHECK_MS = 24 * 60 * 60 * 1000;

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const short = (s, n = 300) => { const t = String(s || "").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const PAY_LABEL = { efectivo: "💵 Efectivo", transferencia: "🏦 Transferencia" };
// Propina del formulario: las de la app (300/500/700) o "Otro monto" con el número que quiera el
// cliente. Va entera al cadete; se redondea a pesos y se ignora si no es un monto razonable.
const MAX_TIP = 100000;
function tipOf(r) {
  const raw = r.tip === "other" ? String(r.tip_other || "").replace(/[^\d.,]/g, "").replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : r.tip;
  const n = Math.round(Number(raw) || 0);
  return n > 0 && n <= MAX_TIP ? n : 0;
}

const MENU_WORDS = new Set(["menu", "inicio", "hola", "holaa", "buenas", "buen dia", "buenos dias", "buenas tardes", "buenas noches", "volver", "empezar", "opciones", "ayuda"]);
const CANCEL_WORDS = new Set(["cancelar", "cancela", "anular", "salir"]);
// Lo que la gente escribe en vez de tocar el botón
const YES_WORDS = new Set(["si", "confirmar", "confirmo", "dale", "ok", "listo", "de una"]);
const DONE_WORDS = new Set(["listo", "ya", "ya esta", "eso es todo", "eso", "nada mas", "nada mas gracias", "es todo"]);
const NO_NOTES_WORDS = new Set(["no", "sin datos", "nada", "ninguno", "no gracias"]);

const STATUS_LABEL = {
  pending: (o) => (o.isFavor ? "Buscando cadete 🔎" : "Esperando que el comercio lo acepte"),
  confirmed: (o) => (o.isFavor ? "Buscando cadete 🔎" : "En preparación 👨‍🍳"),
  preparing: () => "En preparación 👨‍🍳",
  ready: () => "Listo, buscando cadete 🔎",
  accepted: (o) => `Cadete asignado${o.driverName ? `: ${o.driverName}` : ""} 🛵`,
  delivering: () => "En camino 🛵",
};

function createBot({ db, orders, comercios, sender, understand, giveaways, ensureWaUser, formId, config }) {
  const sessions = db.collection("wa_sessions");

  async function loadSession(waId) {
    const snap = await sessions.doc(waId).get();
    const s = snap.exists ? snap.data() : {};
    s.step = s.step || "idle";
    s.data = s.data || {};
    const age = Date.now() - (s.updatedAtMs || 0);
    if (s.step === "support" ? age > SUPPORT_TTL_MS : (s.step !== "idle" && s.step !== "k_waiting" && s.step !== "k_quoted" && age > SESSION_TTL_MS)) {
      s.step = "idle";
      s.data = {};
    }
    return s;
  }

  async function saveSession(waId, s) {
    await sessions.doc(waId).set({ ...s, updatedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() });
  }

  // ¿El que escribe es un comercio? Se guarda un día en la sesión para no buscarlo en cada mensaje.
  async function senderComercio(waId, s, national) {
    if (s.comercioCheckedAt && Date.now() - s.comercioCheckedAt < COMERCIO_RECHECK_MS) return s.comercio || null;
    const c = await comercios.byPhone(national).catch(() => null);
    s.comercio = c ? { id: c.id, name: c.name || "Tu local" } : null;
    s.comercioCheckedAt = Date.now();
    return s.comercio;
  }

  // ───────────────────────── Mensajes ─────────────────────────

  // Bienvenida con 3 botones (sin tener que abrir una lista). Los mandados son lo más pedido.
  function menuSections(s = {}) {
    return [
      ...(s.comercio ? [{ title: "Tu local", rows: [{ id: "m_cadete", title: "🛵 Cadete para mi local", desc: `Pedí un cadete para ${s.comercio.name}` }] }] : []),
      {
        title: "Pedir",
        rows: [
          { id: "m_compra", title: "🛒 Comprar algo", desc: "Te lo compramos y te lo llevamos" },
          { id: "m_envio", title: "📦 Llevar o traer algo", desc: "Paquetes, llaves, documentos" },
          { id: "m_comercio", title: "🍔 Pedir a un comercio", desc: "Comida, kiosco, farmacia y más" },
          ...(s.lastOrder ? [{ id: "m_repeat", title: "🔁 Repetir mi pedido", desc: "El mismo de la última vez" }] : []),
        ],
      },
      { title: "Mi cuenta", rows: [
        { id: "m_pedidos", title: "📋 Mis pedidos", desc: "Cómo va lo que pediste" },
        { id: "m_puntos", title: "🎁 Puntos y sorteos", desc: "Tus GoPoints y los sorteos abiertos" },
      ] },
      { title: "Ayuda", rows: [{ id: "m_humano", title: "🙋 Hablar con alguien", desc: "Te atiende una persona del equipo" }] },
    ];
  }

  // El menú es un solo desplegable "Ver opciones"; el primer saludo del día va con el banner de GO!
  function menu(name, s) {
    const first = name ? String(name).split(" ")[0] : "";
    const hi = first ? `¡Hola ${first}! 👋` : "¡Hola! 👋";
    const custom = s && s.cfg && s.cfg.greeting ? s.cfg.greeting.replace(/\{nombre\}/g, first).replace(/ +/g, " ").trim() : "";
    return {
      isMenu: true,
      greeting: `${hi} Soy el asistente de *GO! Delivery*.`,
      text: `${custom || `${hi} ¿Qué necesitás hoy?`}\n\n_Podés escribirme el pedido de una (ej: una coca de Paulos y pan de La Unión) o mandarme un audio._`,
      footer: FOOTER,
      list: { button: "Ver opciones", sections: menuSections(s) },
    };
  }

  function moreMenu(s) {
    const rows = [
      { id: "m_compra", title: "🛒 Comprar algo", description: "Un cadete te compra lo que necesites y te lo lleva" },
      { id: "m_envio", title: "📦 Llevar o traer algo", description: "Paquetes, llaves, documentos, de un lugar a otro" },
      ...(s.lastOrder ? [{ id: "m_repeat", title: "🔁 Repetir mi pedido", description: "El mismo que pediste la última vez" }] : []),
      { id: "m_comercio", title: "🍔 Pedir a un comercio", description: "Comida, kiosco, farmacia y más" },
      { id: "m_pedidos", title: "📋 Mis pedidos", description: "Cómo va lo que pediste" },
      { id: "m_puntos", title: "🎁 Puntos y sorteos", description: "Tus GoPoints y los sorteos abiertos" },
      { id: "m_humano", title: "🙋 Hablar con alguien", description: "Te atiende una persona del equipo" },
    ];
    if (s.comercio) rows.unshift({ id: "m_cadete", title: "🛵 Cadete para mi local", description: `Pedí un cadete para ${s.comercio.name}` });
    return { text: "¿Qué necesitás?", list: { button: "Ver opciones", section: "Opciones", rows } };
  }

  // Un aviso con el menú a mano: "Ver menú" abre directamente las opciones
  const menuButton = (text) => ({ text, list: { button: "Ver menú", sections: menuSections() } });

  function askDetails(flow, comercioName) {
    if (flow === "envio") {
      return { text: "📦 *¿Qué hay que llevar?*\nContame qué es y cualquier detalle (tamaño, si es frágil, a quién se entrega)." };
    }
    if (flow === "comercio") {
      return { text: `✍️ *Escribí tu pedido para ${comercioName}.*\nPoné todo lo que quieras: cantidades, gustos, aclaraciones. También podés mandar un audio o una foto.` };
    }
    return askStore(0);
  }

  // ── Compras: comercio por comercio, como la app (mandadoStops). El cadete ve en su panel el nombre
  // de cada comercio (y lo ubica en el mapa si lo conoce) y qué comprar en cada uno.
  const MAX_STOPS = 5;
  function askStore(n) {
    return n === 0
      ? { text: "🛒 *¿En qué comercio te compramos?*\nEscribí el nombre (ej: _Kiosco de 7 y 50_, _Farmacia Pasteur_).\nSi te da igual dónde, escribí *el más cercano* y qué tipo de negocio (ej: _farmacia más cercana_)." }
      : { text: `🏪 *¿En qué otro comercio?* (es la parada ${n + 1})\nEscribí el nombre.` };
  }
  const askItems = (store) => ({ text: `🛒 *¿Qué te compramos en ${store}?*\nEscribí la lista con cantidades, o mandá un audio o una foto.` });
  const itemsAck = (s) => ({
    text: "Anotado ✍️\nSi falta algo de este comercio, escribilo. Cuando termines, abrí *Seguir*.",
    listLabel: "Seguir",
    buttons: [
      { id: "d_done", title: "✅ Listo, eso es todo", desc: "Seguimos con la entrega" },
      ...(s.data.stops.length < MAX_STOPS ? [{ id: "c_more", title: "🏪 Agregar otro comercio", desc: "Algo de otro lugar" }] : []),
      { id: "x_cancel", title: "❌ Cancelar" },
    ],
  });
  const stopsText = (stops) => stops.map((st, i) =>
    `${stops.length > 1 ? `${i + 1}. ` : ""}*${st.store}*: ${short(st.items || ((st.media || []).length ? "(en el audio/foto)" : "—"), 200)}`).join("\n");

  const detailsAck = () => ({
    text: "Anotado ✍️\nSi querés agregar algo más, escribilo. Cuando termines, abrí *Seguir*.",
    listLabel: "Seguir",
    buttons: [{ id: "d_done", title: "✅ Listo, eso es todo", desc: "Seguimos con el pedido" }, { id: "x_cancel", title: "❌ Cancelar" }],
  });

  const askLocation = (what) => ({
    text: `📍 *${what}*\nMandá la ubicación con el botón 👇 o escribí la dirección (calle, número y entre calles).`,
    askLocation: true,
  });

  const addressesOf = (s) => (Array.isArray(s.addresses) && s.addresses.length ? s.addresses
    : (s.lastAddress && s.lastAddress.address ? [s.lastAddress] : []));

  // Las últimas 3 direcciones usadas, la más reciente primero
  function rememberAddress(s, place, notes) {
    if (!place || !place.address) return;
    const a = { address: place.address, coords: place.coords || null, notes: notes || "" };
    const key = norm(a.address);
    s.addresses = [a, ...addressesOf(s).filter((x) => norm(x.address) !== key)].slice(0, 3);
    s.lastAddress = s.addresses[0];
  }

  // Con el formulario nativo (WhatsApp Flows) la entrega, los datos, el pago y la propina se cargan
  // en una sola pantalla. Igual se puede contestar por el chat: el paso sigue siendo "delivery".
  function askDelivery(s) {
    if (s.formId && s.data && s.data.flow) return deliveryForm(s);
    const list = addressesOf(s);
    if (list.length === 1) {
      return {
        text: `📍 ¿Lo llevamos a *${short(list[0].address, 120)}*?`,
        buttons: [{ id: "a_last", title: "Sí, ahí" }, { id: "a_new", title: "Otra dirección" }],
        asButtons: true,
      };
    }
    if (list.length > 1) {
      return {
        text: "📍 ¿Adónde lo llevamos?",
        list: {
          button: "Elegir dirección",
          section: "Tus direcciones",
          rows: [
            ...list.map((a, i) => ({ id: `a_${i}`, title: short(a.address, 24), description: short(a.notes ? `${a.address} · ${a.notes}` : a.address, 72) })),
            { id: "a_new", title: "📍 Otra dirección", description: "Mandá la ubicación o escribila" },
          ],
        },
      };
    }
    return askLocation("¿Adónde lo llevamos?");
  }

  // Resumen para el formulario, con el markdown de WhatsApp Flows (**negrita**). Lo que escribió el
  // cliente va sin asteriscos ni guiones bajos para que no rompa el formato.
  const plain = (t, n = 160) => short(String(t || "").replace(/[*_~`#]/g, "").replace(/\s+/g, " "), n);
  function formSummary(d) {
    const what = (t) => plain(t) || "(en el audio/foto)";
    if (d.flow === "compra" && (d.stops || []).length) {
      return d.stops.map((st) => `**${plain(st.store, 60)}**: ${what(st.items)}`).join("\n");
    }
    if (d.flow === "envio") return `**Qué llevamos**: ${what(d.details)}${d.pickup ? `\n**Retiro**: ${plain(d.pickup.address, 120)}` : ""}`;
    if (d.flow === "comercio") return `**${plain(d.comercio && d.comercio.name, 60)}**: ${what(d.details)}`;
    return what(d.details);
  }

  function deliveryForm(s) {
    const token = crypto.randomBytes(8).toString("hex");
    s.data.formToken = token;
    const addresses = [
      ...addressesOf(s).map((a, i) => ({ id: `a_${i}`, title: short(a.address, 30), description: short(a.notes || a.address, 300) })),
      { id: "gps", title: "📍 Mandar mi ubicación", description: "Te la pido por el chat (envío exacto)" },
      { id: "new", title: "✍️ Escribir otra", description: "Calle, número y entre calles" },
    ];
    return {
      header: "📍 Entrega y pago",
      text: "Tocá *Completar pedido* y cargá todo en una sola pantalla: adónde lo llevamos, cómo pagás y la propina.\n_Si preferís, escribí la dirección o mandá la ubicación por acá._",
      footer: FOOTER,
      flow: {
        id: s.formId,
        token,
        cta: "Completar pedido",
        screen: "PEDIDO",
        // Viene elegida la última dirección usada (o "mandar mi ubicación", que da el envío exacto)
        data: { summary: short(formSummary(s.data), 600), addresses, init_address: addresses[0].id, show_tip: s.data.flow !== "comercio" },
      },
    };
  }

  // Volvió el formulario: { flow_token, address: a_N | gps | new, new_address, notes, pay, tip, tip_other }
  async function onForm(msg, s, out) {
    const r = msg.data || {};
    if (!s.data || !s.data.formToken || r.flow_token !== s.data.formToken) {
      // Uno viejo: si hay un pedido armándose, se le manda el vigente
      if (s.step === "delivery" && s.data && s.data.formToken) {
        out.push({ text: "Ese formulario es de antes. Completá este 👇" });
        out.push(askDelivery(s));
        return;
      }
      out.push(menuButton("Ese formulario es de un pedido que ya no está en curso. Escribí *menú* para empezar otro."));
      return;
    }
    const d = s.data;
    d.pay = PAY_LABEL[r.pay] ? r.pay : "efectivo";
    d.tip = d.flow !== "comercio" ? tipOf(r) : 0;
    let notes = String(r.notes || "").trim().slice(0, 200);
    const list = addressesOf(s);
    const saved = /^a_\d$/.test(r.address || "") ? list[Number(r.address.slice(2))] : null;
    const typed = String(r.new_address || "").trim();
    d.editing = false;
    if (saved) {
      d.delivery = { address: saved.address, coords: saved.coords || null };
      notes = notes || saved.notes || "";
    } else if (r.address === "new" && typed.length >= 4 && /\d/.test(typed)) {
      d.delivery = { address: typed.slice(0, 200), coords: null };
    } else {
      // Eligió mandar la ubicación, o escribió una calle sin altura y sin punto el cadete no sabe
      // adónde ir: falta solo eso y después va el resumen
      d.notes = notes;
      d.gpsPending = true;
      if (typed.length >= 4) d.vagueAsked = true;
      s.step = "delivery";
      out.push(askLocation(typed.length >= 4 ? "Esa dirección no tiene altura. Mandame la ubicación de entrega" : "Mandame la ubicación de entrega"));
      return;
    }
    d.notes = notes;
    s.step = "confirm";
    out.push(await summary(s));
  }

  const askNotes = () => ({
    text: "¿Algún dato para encontrarte? (piso, depto, timbre, color de la casa)\nEscribilo o tocá *Sin datos*.",
    buttons: [{ id: "n_none", title: "Sin datos" }],
  });

  const askPay = () => ({
    text: "💳 ¿Cómo vas a pagar?",
    listLabel: "Elegir",
    buttons: [{ id: "p_efectivo", title: "💵 Efectivo", desc: "Le pagás al cadete al recibir" }, { id: "p_transferencia", title: "🏦 Transferencia", desc: "Al alias del cadete, al recibir" }],
  });

  // Compra: el mismo texto que arma la app ("🏪 1. Comercio: X / 📦 Pedido: Y"), que el panel sabe leer
  const fullDetails = (d) => (d.flow === "compra" && (d.stops || []).length
    ? d.stops.map((st, i) => `🏪 ${i + 1}. Comercio: ${st.store}\n📦 Pedido: ${st.items || "(ver audio/foto)"}`).join("\n\n")
    : [d.store ? `En ${d.store}:` : "", d.details || ""].filter(Boolean).join(" "));

  async function summary(s) {
    const d = s.data;
    const where = `${d.delivery.address}${d.notes ? ` (${d.notes})` : ""}`;
    const what = short(fullDetails(d));
    const media = (d.media || []).length ? `\n📎 ${d.media.length} archivo${d.media.length > 1 ? "s" : ""} adjunto${d.media.length > 1 ? "s" : ""}` : "";
    if (d.flow === "comercio") {
      const c = await comercios.get(d.comercio.id);
      const q = await orders.quoteCommerce({ comercio: c, deliveryCoords: d.delivery.coords, productsTotal: 0 });
      return {
        text: `🧾 *Tu pedido*\n\n🏪 ${d.comercio.name}\n📝 ${what}${media}\n📍 ${where}\n💳 ${PAY_LABEL[d.pay]}\n\n` +
          `Le preguntamos a *${d.comercio.name}* si lo tiene y cuánto sale. Después vos confirmás.\n` +
          `Envío ${q.exactDistance ? "" : "aprox. "}${money(q.deliveryCost)}`,
        buttons: [{ id: "c_ok", title: "📨 Consultar precio", desc: "Le preguntamos al comercio" }, { id: "e_edit", title: "✏️ Editar algo", desc: "Lista, dirección, datos o pago" }, { id: "x_cancel", title: "❌ Cancelar" }],
        listLabel: "Confirmar o editar",
        footer: FOOTER,
      };
    }
    const type = d.flow === "envio" ? "mandado" : "compra";
    const q = await orders.quoteFavor({ type, pickupCoords: d.flow === "envio" ? d.pickup && d.pickup.coords : TOWN_CENTER, deliveryCoords: d.delivery.coords, stopsCount: type === "compra" ? Math.max(1, (d.stops || []).length) : 1 });
    const lines = [`Envío: ${money(q.deliveryCost)}${q.isRaining ? " (incluye lluvia 🌧️)" : ""}`];
    if (q.purchaseFee) lines.push(`Servicio de compra: ${money(q.purchaseFee)}`);
    if (q.appUsageFee) lines.push(`Uso de la app: ${money(q.appUsageFee)}`);
    const pickup = d.flow === "envio" ? `\n🏁 Retiro: ${short(d.pickup.address, 120)}` : "";
    if (q.extraStopsFee) lines.push(`Paradas extra (${(d.stops || []).length - 1}): ${money(q.extraStopsFee)}`);
    if (d.tip) lines.push(`Propina para el cadete: ${money(d.tip)}`);
    const whatLine = d.flow === "compra" && (d.stops || []).length ? `🛒 *Compras*\n${stopsText(d.stops)}` : `${d.flow === "envio" ? "📦" : "🛒"} ${what}`;
    return {
      text: `🧾 *Resumen*\n\n${whatLine}${media}${pickup}\n📍 Entrega: ${where}\n💳 ${PAY_LABEL[d.pay]}\n\n` +
        `${lines.join("\n")}\n*Total: ${money(q.total + (d.tip || 0))}*` +
        (type === "compra" ? "\n_+ lo que salga la compra, que le pagás al cadete contra ticket._" : "") +
        (q.exactDistance ? "" : "\n_El envío es estimado porque no mandaste la ubicación exacta._"),
      buttons: [{ id: "c_ok", title: "✅ Confirmar pedido", desc: "Se lo mandamos a los cadetes" }, { id: "e_edit", title: "✏️ Editar algo", desc: "Lista, dirección, datos o pago" }, { id: "x_cancel", title: "❌ Cancelar" }],
      listLabel: "Confirmar o editar",
      footer: FOOTER,
    };
  }

  function editMenu(s) {
    const d = s.data;
    const rows = [
      { id: "e_items", title: d.flow === "compra" ? "🛒 Lista y comercios" : d.flow === "envio" ? "📦 Qué hay que llevar" : "📝 El pedido", description: "Volver a escribirlo" },
      ...(d.flow === "envio" ? [{ id: "e_pickup", title: "🏁 Dónde retirar" }] : []),
      { id: "e_delivery", title: "📍 Dirección de entrega" },
      { id: "e_notes", title: "🏠 Datos para encontrarte" },
      { id: "e_pay", title: "💳 Forma de pago" },
    ];
    return { text: "✏️ ¿Qué querés cambiar?", list: { button: "Elegir", section: "Cambiar", rows } };
  }

  // Después de un paso: si se estaba editando el resumen, se vuelve al resumen; si no, al paso siguiente
  async function next(s, out, fn) {
    if (s.data.editing && s.data.delivery && s.data.pay) {
      s.data.editing = false;
      s.step = "confirm";
      out.push(await summary(s));
      return;
    }
    return fn();
  }

  // ───────────────────────── Entrada ─────────────────────────

  // msg: { kind: text|reply|location|media|other, text, id, location: {lat,lng,address,name}, media: {type,url} }
  async function handle({ waId, name, msg, msgId, national }) {
    const s = await loadSession(waId);
    await senderComercio(waId, s, national);
    s.cfg = config ? await config.get() : DEFAULTS;
    // Camino corto: entrega y pago salen del mismo mensaje, sin formulario aparte
    s.formId = formId && !s.cfg.short ? await formId() : null;
    const out = [];
    try {
      await route({ waId, name, msg, s, out });
    } catch (err) {
      logger.error(`[WhatsApp] Error atendiendo a ${waId}:`, err);
      out.push(menuButton("😕 Uy, algo falló de nuestro lado. Probá de nuevo en un ratito o escribí *menú*."));
      s.step = "idle"; s.data = {};
    }
    s.lastName = name || s.lastName || null;
    const say = (m) => (m.kind === "text" ? m.text : m.kind === "reply" ? `[${m.title || m.id}]` : m.kind === "location" ? "📍 Ubicación"
      : m.kind === "form" ? "📝 Formulario de entrega y pago" : m.kind === "media" ? `${m.media && m.media.type === "audio" ? "🎤 Audio" : "📷 Archivo"}${m.text ? `: ${m.text}` : ""}` : "(mensaje)");
    const now = Date.now();
    s.log = [...(s.log || []), { at: now, dir: "in", text: short(say(msg), 500) },
      ...out.map((o) => ({ at: now, dir: "out", text: short(o.text || "", 500) }))].slice(-30);
    // Primer menú del día: el banner va arriba y el saludo pasa a ser su texto
    const first = out.find((o) => o && o.isMenu);
    if (first && s.cfg.banner && s.bannerDay !== argDay()) {
      s.bannerDay = argDay();
      out.splice(out.indexOf(first), 0, { image: BANNER_URL, caption: `${first.greeting}\nCompramos, llevamos y traemos lo que necesites en Magdalena 🛵` });
    }
    out.forEach((o) => { if (o && o.react) o.reactTo = msgId; });
    hideOptions(out, s.cfg.hiddenOptions);
    delete s.formId;
    delete s.cfg;
    await saveSession(waId, s);
    await sender.send(waId, out);
  }

  // Opciones que el admin sacó del menú (Admin → Bot → Ajustes), en todos los menús que salen
  function hideOptions(out, hidden) {
    if (!hidden || !hidden.length) return;
    const keep = (rows) => rows.filter((row) => !hidden.includes(row.id));
    out.forEach((o) => {
      if (!o || !o.list) return;
      if (o.list.rows) o.list.rows = keep(o.list.rows);
      if (o.list.sections) o.list.sections = o.list.sections.map((sec) => ({ ...sec, rows: keep(sec.rows) }));
    });
  }

  // ── Camino corto: todo en un solo mensaje. Solo se repregunta lo que falta, de a un mensaje. ──
  function startQuick(s, flow, extra = {}) {
    s.step = "quick";
    s.data = { quick: true, flow, details: "", media: [], ...(flow === "compra" ? { stops: [] } : {}), ...extra };
    if (flow === "envio") return { text: s.cfg.askEnvio };
    if (flow === "comercio") return { text: s.cfg.askComercio.replace(/\{comercio\}/g, extra.comercio.name) };
    return { text: s.cfg.askCompra };
  }

  async function onQuick(waId, msg, s, out) {
    const d = s.data;
    let text = msg.kind === "text" ? msg.text : "";
    if (msg.kind === "location") {
      const place = readPlace(msg);
      if (place) d.delivery = place;
    }
    if (msg.kind === "media" && msg.media) {
      d.media = [...(d.media || []), msg.media].slice(0, 6);
      text = msg.text || "";
      // Un audio se escucha para sacar la dirección y el pago; si no se puede, va igual al cadete
      if (msg.media.type === "audio" && msg.media.path && understand) {
        const bytes = await sender.readMedia(msg.media.path);
        const parsed = bytes ? await understand.order(waId, { media: { type: "audio", bytes, mime: msg.media.mime } }).catch(() => null) : null;
        if (parsed && parsed.heard) text = parsed.heard;
      }
    }
    if (text.trim()) {
      const p = parseQuick(text);
      if (p.pay) d.pay = p.pay;
      // Sin altura no queda como dirección: quickNext se la pide con la ubicación
      if (p.address && /\d/.test(p.address)) d.delivery = { address: p.address.slice(0, 200), coords: null };
      else if (p.address) d.vagueAsked = true;
      if (p.pickup) d.pickup = { address: p.pickup.slice(0, 200), coords: null };
      if (p.what) d.details = [d.details, p.what].filter(Boolean).join("\n").slice(0, 2000);
    }
    // Si dijo en qué comercio, cada uno queda como parada; si no, el cadete lee el texto tal cual
    if (d.flow === "compra" && d.details && understand && !(d.stops || []).length) {
      const parsed = await understand.order(waId, { text: d.details }, { useAI: false }).catch(() => null);
      if (parsed && parsed.stops.length) d.stops = parsed.stops.map((st, i) => ({ store: st.store, items: st.items, media: i === 0 ? d.media : [] }));
    }
    return quickNext(s, out);
  }

  // Sigue por lo primero que falte; con todo, el resumen
  async function quickNext(s, out) {
    const d = s.data;
    s.step = "quick";
    if (!d.details && !(d.media || []).length) {
      out.push({ text: "Todavía no me dijiste qué necesitás 🙂 Escribilo o mandá un audio." });
      return;
    }
    if (d.flow === "envio" && !d.pickup) { s.step = "pickup"; out.push(askLocation("¿Dónde lo retiramos?")); return; }
    if (!d.delivery) { s.step = "delivery"; out.push(askDelivery(s)); return; }
    if (!d.pay) { s.step = "pay"; out.push(askPay()); return; }
    d.editing = false;
    s.step = "confirm";
    out.push(await summary(s));
  }

  function startFlow(s, flow, extra = {}) {
    s.step = "details";
    s.data = { flow, details: "", media: [], ...extra };
  }

  // Compra: arranca pidiendo el comercio (o directo la lista si ya se sabe dónde)
  function startCompra(s, store, extra = {}) {
    s.data = { flow: "compra", stops: store ? [{ store, items: "", media: [] }] : [], media: [], ...extra };
    s.step = store ? "c_items" : "c_store";
  }

  async function route({ waId, name, msg, s, out }) {
    const t = msg.kind === "text" ? norm(msg.text) : "";
    let id = msg.kind === "reply" ? msg.id : "";
    if (!id && t) {
      if ((s.step === "details" || s.step === "c_items") && DONE_WORDS.has(t)) id = "d_done";
      else if (s.step === "c_items" && (t === "otro" || t === "otro comercio" || t === "otro lugar")) id = "c_more";
      else if (s.step === "confirm" && YES_WORDS.has(t)) id = "c_ok";
      else if (s.step === "notes" && NO_NOTES_WORDS.has(t)) id = "n_none";
      else if (s.step === "pay" && t.includes("efectivo")) id = "p_efectivo";
      else if (s.step === "pay" && t.includes("transfer")) id = "p_transferencia";
      else if (s.step === "delivery" && s.lastAddress && YES_WORDS.has(t)) id = "a_last";
      else if (s.step === "c_parsed" && YES_WORDS.has(t)) id = "p_ok";
    }

    // Soporte: todo lo que escribe va a la persona, salvo que pida volver al menú.
    if (s.step === "support") {
      if (!(t === "menu" || t === "salir" || id === "go_menu")) { await saveSupport(waId, name, msg); return; }
      s.step = "idle"; s.data = {};
      out.push(menu(name, s));
      return;
    }

    // Botones que sirven en cualquier momento (también los de mensajes viejos)
    if (id.startsWith("q_ok:")) return quoteAccept(waId, id.slice(5), s, out);
    if (id.startsWith("q_no:")) return quoteDecline(id.slice(5), s, out);
    if (id.startsWith("qm:")) return quoteToMandado(id.slice(3), s, out);
    if (id.startsWith("oc:")) return cancelOrder(waId, id.slice(3), s, out);
    if (id.startsWith("k:")) return pickComercio(id.slice(2), s, out);
    if (id.startsWith("gw:")) return joinGiveaway(waId, name, id.slice(3), out);
    if (msg.kind === "form") return onForm(msg, s, out);

    if (id === "go_menu" || MENU_WORDS.has(t)) {
      if (s.step === "k_waiting" && s.data.quoteId) {
        out.push({ text: `⏳ Seguimos esperando la respuesta de *${s.data.comercio && s.data.comercio.name}*. Te aviso apenas conteste.` });
      }
      if (s.step !== "k_waiting" && s.step !== "k_quoted") { s.step = "idle"; s.data = {}; }
      out.push(menu(name, s));
      return;
    }
    if (id === "x_cancel" || CANCEL_WORDS.has(t)) return cancelFlow(s, out);

    switch (id) {
      case "m_compra": {
        // Viene de "no encontré ese comercio": se recuerda dónde comprar
        const store = s.data && s.data.suggested;
        if (s.cfg.short) {
          out.push(startQuick(s, "compra", store ? { store } : {}));
          return;
        }
        startCompra(s, store || null);
        out.push(store ? askItems(store) : askStore(0));
        return;
      }
      case "m_envio":
        if (s.cfg.short) { out.push(startQuick(s, "envio")); return; }
        startFlow(s, "envio"); out.push(askDetails("envio")); return;
      case "m_more": out.push(moreMenu(s)); return;
      case "m_repeat": return repeatLast(name, s, out);
      case "m_puntos": return showPoints(waId, name, out);
      case "w_yes":
        await db.collection("wa_waitlist").doc(waId).set({ at: Date.now(), until: Date.now() + 2 * 60 * 60 * 1000 });
        out.push({ text: "👍 Listo, te aviso por acá apenas se conecte un cadete. Tu pedido queda guardado." });
        return;
      case "e_edit":
        if (!s.data.delivery) { out.push(menu(name, s)); return; }
        out.push(editMenu(s));
        return;
      case "e_items":
      case "e_pickup":
      case "e_delivery":
      case "e_notes":
      case "e_pay":
        return editStep(id, s, out);
      case "m_comercio": return listComercios(s, out);
      case "m_pedidos": return myOrders(waId, out);
      case "m_humano": return startSupport(waId, name, s, out);
      case "m_cadete": return askCadete(s, out);
      case "cd_ok": return createCadete(waId, s, out);
      case "k_other": s.step = "k_search"; s.data = {}; out.push({ text: "🔎 Escribí el nombre del comercio." }); return;
      case "k_menu": return sendStoreLink(s, out);
      case "k_write":
        if (s.cfg.short) { out.push(startQuick(s, "comercio", { comercio: s.data.comercio })); return; }
        startFlow(s, "comercio", { comercio: s.data.comercio }); out.push(askDetails("comercio", s.data.comercio.name)); return;
      default: break;
    }

    switch (s.step) {
      case "quick": return onQuick(waId, msg, s, out);
      case "details": return onDetails(msg, id, s, out);
      case "c_store": return onStore(waId, msg, s, out);
      case "c_items": return onItems(msg, id, s, out);
      case "c_parsed": return onParsed(waId, msg, id, s, out);
      case "pickup": return onPickup(msg, s, out);
      case "delivery": return onDelivery(msg, id, s, out);
      case "notes": return onNotes(msg, id, s, out);
      case "pay": return onPay(id, s, out);
      case "confirm": return onConfirm(waId, name, id, s, out);
      case "k_pick":
      case "k_search": return onComercioText(msg, s, out);
      case "k_mode":
        // Escribió el pedido directamente en vez de elegir un botón
        if (s.cfg.short) { startQuick(s, "comercio", { comercio: s.data.comercio }); return onQuick(waId, msg, s, out); }
        startFlow(s, "comercio", { comercio: s.data.comercio });
        return onDetails(msg, "", s, out);
      case "k_waiting":
        out.push({ text: `⏳ Seguimos esperando a *${s.data.comercio && s.data.comercio.name}*. Si no querés esperar, escribí *cancelar*.` });
        return;
      case "k_quoted":
        out.push({ text: "Tocá *Confirmar* o *No, gracias* en el mensaje de arriba 👆 (o escribí *cancelar*)." });
        return;
      default:
        return onIdle(waId, name, msg, s, out);
    }
  }

  // ───────────────────────── Pasos ─────────────────────────

  async function onDetails(msg, id, s, out) {
    if (id === "d_done") {
      if (!s.data.details && !(s.data.media || []).length) {
        out.push({ text: "Todavía no me dijiste qué necesitás 🙂 Escribilo o mandá un audio." });
        return;
      }
      return next(s, out, () => {
        if (s.data.flow === "envio") { s.step = "pickup"; out.push(askLocation("¿Dónde lo retiramos?")); return; }
        s.step = "delivery";
        out.push(askDelivery(s));
      });
    }
    if (msg.kind === "text" && msg.text.trim()) {
      s.data.details = [s.data.details, msg.text.trim()].filter(Boolean).join("\n").slice(0, 2000);
      out.push(detailsAck());
      return;
    }
    if (msg.kind === "media") {
      s.data.media = [...(s.data.media || []), msg.media].slice(0, 6);
      if (msg.text) s.data.details = [s.data.details, msg.text.trim()].filter(Boolean).join("\n").slice(0, 2000);
      out.push(detailsAck());
      return;
    }
    out.push(askDetails(s.data.flow, s.data.comercio && s.data.comercio.name));
  }

  async function onStore(waId, msg, s, out) {
    if (msg.kind === "media" && msg.media) {
      // Un audio o una foto con todo el pedido: se intenta entender; si no, igual va al cadete
      const bytes = msg.media.path ? await sender.readMedia(msg.media.path) : null;
      const parsed = bytes && understand ? await understand.order(waId, { text: msg.text, media: { type: msg.media.type, bytes, mime: msg.media.mime } }).catch(() => null) : null;
      if (parsed && parsed.stops.length) return offerParsed(s, out, parsed, msg.media);
      s.data.pendingMedia = [...(s.data.pendingMedia || []), msg.media].slice(0, 4);
      s.data.media = [...(s.data.media || []), msg.media].slice(0, 6);
      out.push({ text: `${msg.media.type === "audio" ? "🎤 No llegué a entender bien el audio" : "📷 Recibí la foto"}, igual se la paso al cadete.\n¿En qué comercio te compramos?` });
      return;
    }
    const text = msg.kind === "text" ? msg.text.replace(/\s+/g, " ").trim() : "";
    if (text.length < 2) { out.push({ text: "Primero decime el *nombre del comercio* ✍️ (después me pasás la lista)." }); return; }
    // ¿Escribió todo el pedido junto ("una coca de paulos y pan de la unión")?
    if (understand && !understand.looksLikeStoreName(text)) {
      const parsed = await understand.order(waId, { text }).catch(() => null);
      if (parsed && parsed.stops.length) return offerParsed(s, out, parsed, null);
    }
    const store = text.slice(0, 80);
    const pending = s.data.pendingMedia || [];
    delete s.data.pendingMedia;
    s.data.stops.push({ store, items: "", media: pending });
    s.step = "c_items";
    out.push(pending.length ? itemsAck(s) : askItems(store));
  }

  // "Entendí esto: …" — el cliente confirma o lo hace de a uno
  function offerParsed(s, out, parsed, media) {
    const stops = parsed.stops.map((st) => ({ store: st.store, items: st.items, media: [] }));
    if (media) { stops[0].media = [media]; s.data.media = [...(s.data.media || []), media].slice(0, 6); }
    s.data.flow = "compra";
    s.data.parsed = { stops, heard: parsed.heard || null };
    s.step = "c_parsed";
    out.push({
      text: `${parsed.via === "ia" ? "🧠" : "📝"} *Entendí esto:*\n${stopsText(stops)}` +
        (parsed.heard ? `\n\n🎤 _"${short(parsed.heard, 220)}"_` : "") + "\n\n¿Está bien?",
      listLabel: "¿Está bien?",
      buttons: [{ id: "p_ok", title: "✅ Sí, está bien", desc: "Seguimos con la entrega" }, { id: "p_fix", title: "✏️ Corregir", desc: "Lo armamos de a un comercio" }, { id: "x_cancel", title: "❌ Cancelar" }],
    });
  }

  async function onParsed(waId, msg, id, s, out) {
    if (id === "p_ok" && s.data.parsed) {
      s.data.stops = s.data.parsed.stops;
      delete s.data.parsed;
      return next(s, out, () => { s.step = "delivery"; out.push(askDelivery(s)); });
    }
    if (id === "p_fix") {
      delete s.data.parsed;
      s.data.stops = [];
      s.step = "c_store";
      out.push({ text: "Dale, vamos de a uno 👍" });
      out.push(askStore(0));
      return;
    }
    // Lo volvió a escribir distinto
    if (msg.kind === "text" && msg.text.trim() && understand) {
      const parsed = await understand.order(waId, { text: msg.text }).catch(() => null);
      if (parsed && parsed.stops.length) return offerParsed(s, out, parsed, null);
    }
    out.push({ text: "Abrí *¿Está bien?* en el mensaje de arriba 👆 y elegí *Sí, está bien* o *Corregir*." });
  }

  // Sin nada en curso: si escribe el pedido de una, se arma solo (en texto, solo con reglas: un
  // "hola, ¿tienen delivery en Magdalena?" no gasta IA). Un audio sí se escucha.
  const ORDERISH = /^(un|una|unos|unas|dos|tres|cuatro|cinco|seis|siete|ocho|diez|doce|medio|media|\d)/i;
  async function onIdle(waId, name, msg, s, out) {
    if (understand && msg.kind === "text" && msg.text.trim().length >= 8) {
      const parsed = await understand.order(waId, { text: msg.text }, { useAI: false }).catch(() => null);
      if (parsed && parsed.stops.length && parsed.stops.every((st) => ORDERISH.test(st.items) || /\d/.test(st.items))) {
        startCompra(s, null, s.cfg.short ? { quick: true } : {});
        return offerParsed(s, out, parsed, null);
      }
    }
    if (understand && msg.kind === "media" && msg.media && msg.media.type === "audio" && msg.media.path) {
      const bytes = await sender.readMedia(msg.media.path);
      const parsed = bytes ? await understand.order(waId, { media: { type: "audio", bytes, mime: msg.media.mime } }).catch(() => null) : null;
      if (parsed && parsed.stops.length) {
        startCompra(s, null, s.cfg.short ? { quick: true } : {});
        return offerParsed(s, out, parsed, msg.media);
      }
    }
    out.push(menu(name, s));
  }

  async function onItems(msg, id, s, out) {
    const cur = s.data.stops[s.data.stops.length - 1];
    const empty = (st) => !st.items && !(st.media || []).length;
    if (id === "d_done" || id === "c_more") {
      if (empty(cur)) { out.push({ text: `Todavía no me dijiste qué comprar en *${cur.store}* 🙂 Escribilo o mandá un audio.` }); return; }
      if (id === "c_more") {
        if (s.data.stops.length >= MAX_STOPS) { out.push({ text: `Hasta ${MAX_STOPS} comercios por pedido. Tocá *Listo* para seguir.`, buttons: [{ id: "d_done", title: "✅ Listo" }] }); return; }
        s.step = "c_store";
        out.push(askStore(s.data.stops.length));
        return;
      }
      return next(s, out, () => { s.step = "delivery"; out.push(askDelivery(s)); });
    }
    if (msg.kind === "text" && msg.text.trim()) {
      cur.items = [cur.items, msg.text.trim()].filter(Boolean).join("\n").slice(0, 600);
      out.push(itemsAck(s));
      return;
    }
    if (msg.kind === "media") {
      cur.media = [...(cur.media || []), msg.media].slice(0, 4);
      s.data.media = [...(s.data.media || []), msg.media].slice(0, 6);
      if (msg.text) cur.items = [cur.items, msg.text.trim()].filter(Boolean).join("\n").slice(0, 600);
      out.push(itemsAck(s));
      return;
    }
    out.push(askItems(cur.store));
  }

  function readPlace(msg) {
    if (msg.kind === "location" && msg.location) {
      const l = msg.location;
      return {
        address: [l.name, l.address].filter(Boolean).join(", ") || "Ubicación enviada por WhatsApp",
        coords: { lat: Number(l.lat), lng: Number(l.lng) },
      };
    }
    if (msg.kind === "text" && msg.text.trim().length >= 4) return { address: msg.text.trim().slice(0, 200), coords: null };
    return null;
  }

  async function onPickup(msg, s, out) {
    const place = readPlace(msg);
    if (!place) { out.push(askLocation("¿Dónde lo retiramos?")); return; }
    s.data.pickup = place;
    if (s.data.quick && !s.data.editing) return quickNext(s, out);
    return next(s, out, () => { s.step = "delivery"; out.push(askDelivery(s)); });
  }

  async function onDelivery(msg, id, s, out) {
    const list = addressesOf(s);
    const pick = id === "a_last" ? 0 : (/^a_\d$/.test(id) ? Number(id.slice(2)) : -1);
    if (pick >= 0 && list[pick]) {
      s.data.delivery = { address: list[pick].address, coords: list[pick].coords || null };
      s.data.notes = list[pick].notes || "";
      if (s.data.quick && !s.data.editing) return quickNext(s, out);
      return next(s, out, () => { s.step = "pay"; out.push(askPay()); });
    }
    if (id === "a_new") { out.push(askLocation("¿Adónde lo llevamos?")); return; }
    const place = readPlace(msg);
    if (!place) { out.push(s.formId && !s.data.gpsPending ? askDelivery(s) : askLocation("¿Adónde lo llevamos?")); return; }
    // Sin altura ni punto: se pide la ubicación una vez. Si vuelve a escribir se acepta, para no
    // dejarlo trabado (barrios y casas sin número); el cadete ve "ubicación aproximada".
    if (!place.coords && !/\d/.test(place.address) && !s.data.vagueAsked) {
      s.data.vagueAsked = true;
      out.push(askLocation("Esa dirección no tiene altura. Mandame la ubicación de entrega, o escribí calle y número"));
      return;
    }
    delete s.data.vagueAsked;
    s.data.delivery = place;
    if (s.data.gpsPending && s.data.pay) {
      delete s.data.gpsPending;
      s.step = "confirm";
      out.push(await summary(s));
      return;
    }
    // En el camino corto los datos para encontrarlo van con la dirección: una pregunta menos
    if (s.data.quick && !s.data.editing) return quickNext(s, out);
    s.step = "notes";
    out.push(askNotes());
  }

  async function onNotes(msg, id, s, out) {
    if (id === "n_none") s.data.notes = "";
    else if (msg.kind === "text" && msg.text.trim()) s.data.notes = msg.text.trim().slice(0, 200);
    else { out.push(askNotes()); return; }
    return next(s, out, () => { s.step = "pay"; out.push(askPay()); });
  }

  async function onPay(id, s, out) {
    if (id !== "p_efectivo" && id !== "p_transferencia") { out.push(askPay()); return; }
    s.data.pay = id.slice(2);
    s.step = "confirm";
    out.push(await summary(s));
  }

  async function onConfirm(waId, name, id, s, out) {
    if (id !== "c_ok") { out.push(await summary(s)); return; }
    const d = s.data;
    if (!(await orders.hasOnlineDriver())) {
      out.push({
        text: "😕 En este momento no hay cadetes conectados.\n¿Te aviso por acá apenas se conecte uno? Tu pedido queda guardado.",
        listLabel: "¿Qué hacemos?",
        buttons: [{ id: "w_yes", title: "🔔 Avisame", desc: "Te escribo apenas haya un cadete" }, { id: "x_cancel", title: "❌ Cancelar el pedido" }],
      });
      return;
    }
    const customer = await orders.resolveCustomer(waId, name);
    rememberAddress(s, d.delivery, d.notes);

    if (d.flow === "comercio") {
      const c = await comercios.get(d.comercio.id);
      if (!c || !comercios.isAvailable(c)) {
        out.push({
          text: `😕 *${d.comercio.name}* cerró recién. ¿Querés que un cadete te lo consiga en otro lado?`,
          buttons: [{ id: "m_compra", title: "🛒 Pedir mandado" }, { id: "go_menu", title: "Ver menú" }],
        });
        s.step = "idle"; s.data = {};
        return;
      }
      const q = await orders.createQuote({
        waId, customer, comercio: c, details: d.details, media: d.media,
        deliveryAddress: d.delivery.address, deliveryCoords: d.delivery.coords, addressNotes: d.notes, paymentMethod: d.pay,
      });
      s.step = "k_waiting";
      s.data = { quoteId: q.id, comercio: d.comercio };
      out.push({ text: `📨 Le preguntamos a *${d.comercio.name}*.\nApenas responda te aviso por acá con el precio (suele tardar unos minutos).` });
      return;
    }

    const res = await orders.createFavor({
      waId, customer, type: d.flow === "envio" ? "mandado" : "compra", details: fullDetails(d), media: d.media, stops: d.flow === "compra" ? d.stops : null,
      pickupAddress: d.pickup && d.pickup.address, pickupCoords: d.pickup && d.pickup.coords,
      deliveryAddress: d.delivery.address, deliveryCoords: d.delivery.coords, addressNotes: d.notes, paymentMethod: d.pay, tip: d.tip || 0,
    });
    // Para "Repetir pedido" (sin la parte de edición)
    s.lastOrder = { flow: d.flow, stops: d.stops || null, details: d.details || "", media: d.media || [], pickup: d.pickup || null, delivery: d.delivery, notes: d.notes || "", pay: d.pay, tip: d.tip || 0, at: Date.now() };
    db.collection("wa_waitlist").doc(waId).delete().catch(() => {});
    s.step = "idle"; s.data = {};
    // Es el último mensaje del pedido: el seguimiento (cadete, mapa, llegada) se ve en el link
    out.push({
      header: `✅ Pedido #${res.orderNum} confirmado`,
      text: `Ya lo están viendo los cadetes.\n\nTotal: *${money(res.total)}*` +
        (d.flow === "compra" ? " + la compra" : "") +
        "\n\nTocá *Seguir en vivo* para ver quién lo toma, dónde está el cadete y cuándo llega. Mientras nadie lo tome, desde ahí podés cancelarlo.\n_Si el cadete necesita algo, te escribe por acá._",
      footer: FOOTER,
      link: { title: "📍 Seguir en vivo", url: trackingUrl(res.trackingToken) },
    });
  }

  function cancelFlow(s, out) {
    if (s.step === "k_waiting" && s.data.quoteId) {
      db.collection("wa_quotes").doc(s.data.quoteId).update({ status: "cancelled", cancelledAt: FieldValue.serverTimestamp() }).catch(() => {});
    }
    if (s.step === "k_quoted" && s.data.quoteId) {
      db.collection("wa_quotes").doc(s.data.quoteId).update({ status: "declined", declinedAt: FieldValue.serverTimestamp() }).catch(() => {});
    }
    s.step = "idle"; s.data = {};
    out.push(menuButton("Listo, cancelado 👍 Escribí *menú* cuando quieras."));
  }

  // ───────────────────────── Comercios ─────────────────────────

  async function listComercios(s, out) {
    const open = await comercios.listOpen();
    s.step = "k_pick"; s.data = {};
    if (!open.length) {
      out.push({
        text: "😕 Ahora no hay comercios abiertos en la app. ¿Querés que un cadete te compre en algún lugar?",
        buttons: [{ id: "m_compra", title: "🛒 Pedir mandado" }, { id: "go_menu", title: "Ver menú" }],
      });
      s.step = "idle";
      return;
    }
    const rows = open.slice(0, 9).map((c) => ({ id: `k:${c.id}`, title: c.name, description: c.category || "" }));
    rows.push({ id: "k_other", title: "🔎 Otro comercio", description: "Escribí el nombre" });
    out.push({
      text: `🍔 *¿A qué comercio le pedimos?*\nElegí de la lista o escribí el nombre.${open.length > 9 ? `\n_Hay ${open.length} abiertos: si no ves el tuyo, escribí el nombre._` : ""}`,
      list: { button: "Ver comercios", section: "Abiertos ahora", rows },
    });
  }

  async function onComercioText(msg, s, out) {
    if (msg.kind !== "text" || !msg.text.trim()) { out.push({ text: "🔎 Escribí el nombre del comercio." }); return; }
    const found = await comercios.search(msg.text);
    if (found.length === 1) return pickComercio(found[0].id, s, out);
    if (found.length > 1) {
      out.push({
        text: "Encontré varios. ¿Cuál es?",
        list: { button: "Elegir", section: "Comercios", rows: found.slice(0, 10).map((c) => ({ id: `k:${c.id}`, title: c.name, description: comercios.isAvailable(c) ? (c.category || "") : "Cerrado ahora" })) },
      });
      return;
    }
    const place = msg.text.trim().slice(0, 80);
    s.data = { suggested: place };
    out.push({
      text: `No encontré *${place}* en GO!. Igual un cadete te lo puede comprar ahí 🛵`,
      buttons: [{ id: "m_compra", title: "🛒 Pedir mandado" }, { id: "k_other", title: "🔎 Buscar otro" }],
    });
  }

  async function pickComercio(cid, s, out) {
    const c = await comercios.get(cid);
    if (!c) { out.push(menuButton("No encontré ese comercio.")); return; }
    if (!comercios.isAvailable(c)) {
      s.step = "idle"; s.data = {};
      out.push({
        text: `😕 *${c.name}* está cerrado ahora. ¿Querés que un cadete te consiga lo que necesitás en otro lado?`,
        buttons: [{ id: "m_compra", title: "🛒 Pedir mandado" }, { id: "m_comercio", title: "Ver abiertos" }],
      });
      return;
    }
    s.data = { comercio: { id: c.id, name: c.name } };
    if (await comercios.hasCatalog(c.id)) {
      s.step = "k_mode";
      out.push({
        text: `🏪 *${c.name}* tiene su menú en GO!. ¿Cómo querés pedir?`,
        buttons: [{ id: "k_menu", title: "📖 Ver menú" }, { id: "k_write", title: "✍️ Escribir pedido" }],
        asButtons: true,
      });
      return;
    }
    if (s.cfg.short) { out.push(startQuick(s, "comercio", { comercio: s.data.comercio })); return; }
    startFlow(s, "comercio", { comercio: s.data.comercio });
    out.push(askDetails("comercio", c.name));
  }

  async function sendStoreLink(s, out) {
    const ref = s.data.comercio;
    const c = ref && (await comercios.get(ref.id));
    s.step = "idle"; s.data = {};
    if (!c) { out.push(menu(null, s)); return; }
    out.push({ text: `📖 Abrí el menú de *${c.name}*, elegí y pedí desde ahí. La primera vez te pide iniciar sesión.`, link: { title: "Ver menú", url: storeUrl(c) } });
  }

  // ───────────────────────── Cotizaciones ─────────────────────────

  async function quoteAccept(waId, quoteId, s, out) {
    const qSnap = await db.collection("wa_quotes").doc(quoteId).get();
    if (!qSnap.exists || qSnap.data().waPhone !== waId) { out.push(menuButton("No encontré ese pedido.")); return; }
    if (!(await orders.hasOnlineDriver())) {
      out.push({
        text: "😕 Justo ahora no hay cadetes conectados para llevarlo. Probá confirmar en unos minutos.",
        buttons: [{ id: `q_ok:${quoteId}`, title: "✅ Confirmar" }, { id: `q_no:${quoteId}`, title: "No, gracias" }],
        asButtons: true,
      });
      return;
    }
    const res = await orders.createOrderFromQuote(quoteId);
    s.step = "idle"; s.data = {};
    if (res.already) {
      out.push(menuButton(res.status === "accepted" ? `Ese pedido ya está confirmado (#${res.orderNum}) 👍` : "Esa cotización ya no está disponible. Si querés, pedilo de nuevo desde el menú."));
      return;
    }
    const qd = qSnap.data();
    if (qd.deliveryAddress) rememberAddress(s, { address: qd.deliveryAddress, coords: qd.deliveryCoords || null }, qd.addressNotes || "");
    out.push({
      header: `✅ Pedido #${res.orderNum} confirmado`,
      text: `*${qd.comercioName}* ya lo está preparando${qd.prepMinutes ? ` (unos ${qd.prepMinutes} min)` : ""}.\n\nTotal: *${money(res.total)}*` +
        (res.trackingToken ? "\n\nTocá *Seguir en vivo* para ver cuándo sale, dónde está el cadete y cuándo llega." : ""),
      footer: FOOTER,
      ...(res.trackingToken ? { link: { title: "📍 Seguir en vivo", url: trackingUrl(res.trackingToken) } } : {}),
    });
  }

  async function quoteDecline(quoteId, s, out) {
    const ref = db.collection("wa_quotes").doc(quoteId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().status === "quoted") tx.update(ref, { status: "declined", declinedAt: FieldValue.serverTimestamp() });
    });
    s.step = "idle"; s.data = {};
    out.push(menuButton("Listo, no se hizo el pedido 👍"));
  }

  // El comercio no pudo: lo mismo pasa a ser un mandado con todo lo que ya contó el cliente.
  async function quoteToMandado(quoteId, s, out) {
    const snap = await db.collection("wa_quotes").doc(quoteId).get();
    if (!snap.exists) { startCompra(s, null); out.push(askStore(0)); return; }
    const q = snap.data();
    const store = q.comercioName || "El comercio";
    startCompra(s, store, {
      delivery: { address: q.deliveryAddress, coords: q.deliveryCoords || null },
      notes: q.addressNotes || "",
      pay: q.paymentMethod || "efectivo",
    });
    s.data.stops[0].items = String(q.requestText || "").slice(0, 600);
    s.data.stops[0].media = (q.media || []).slice(0, 4);
    s.data.media = q.media || [];
    if (!s.data.stops[0].items && !s.data.media.length) { out.push(askItems(store)); return; }
    s.step = "confirm";
    out.push({ text: "🛒 Perfecto, un cadete te lo consigue. Te muestro cómo queda:" });
    out.push(await summary(s));
  }

  // ───────────────────────── Mis pedidos ─────────────────────────

  async function myOrders(waId, out) {
    const [oSnap, qSnap] = await Promise.all([
      db.collection("orders").where("waPhone", "==", waId).get(),
      db.collection("wa_quotes").where("waPhone", "==", waId).get(),
    ]);
    const active = oSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => !["completed", "cancelled"].includes(o.status))
      .sort((a, b) => (b.orderId || 0) - (a.orderId || 0)).slice(0, 5);
    const waiting = qSnap.docs.map((d) => d.data()).filter((q) => q.status === "waiting" || q.status === "quoted");
    if (!active.length && !waiting.length) {
      out.push(menuButton("No tenés pedidos en curso 🙂"));
      return;
    }
    const lines = active.map((o) => {
      const label = o.isAtDoor ? "El cadete está en la puerta 📍" : (STATUS_LABEL[o.status] || (() => o.status))(o);
      const what = o.comercioName ? ` · ${o.comercioName}` : (o.isFavor ? " · Mandado" : "");
      return `*#${o.orderId}*${what}\n${label}`;
    });
    waiting.forEach((q) => lines.push(`*${q.comercioName}*\n${q.status === "waiting" ? "Esperando que responda el precio ⏳" : "Te mandó el precio, falta que confirmes"}`));
    const cancellable = active.filter((o) => o.status === "pending" && !o.driverId).slice(0, 2);
    const buttons = cancellable.map((o) => ({ id: `oc:${o.id}`, title: `❌ Cancelar #${o.orderId}`, desc: "Todavía nadie lo tomó" }));
    buttons.push({ id: "go_menu", title: "🏠 Ver menú" });
    out.push({ header: "📋 Tus pedidos en curso", text: lines.join("\n\n"), buttons, listLabel: "Opciones", footer: FOOTER });
    active.filter((o) => o.trackingToken).slice(0, 3).forEach((o) => {
      out.push({ text: `*#${o.orderId}*${o.comercioName ? ` · ${o.comercioName}` : ""}`, link: { title: "📍 Seguir en vivo", url: trackingUrl(o.trackingToken) } });
    });
  }

  async function cancelOrder(waId, orderDocId, s, out) {
    const ref = db.collection("orders").doc(orderDocId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().waPhone !== waId) return { ok: false, why: "missing" };
      const o = snap.data();
      if (o.status !== "pending" || o.driverId) return { ok: false, why: "late", num: o.orderId };
      tx.update(ref, {
        status: "cancelled", cancelledBy: "cliente", cancelReason: "Cancelado por el cliente desde WhatsApp", cancelledAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, num: o.orderId };
    });
    if (result.ok) out.push(menuButton(`Listo, cancelé el pedido #${result.num} 👍`));
    else if (result.why === "late") out.push(menuButton(`El pedido #${result.num} ya está en marcha y no se puede cancelar desde acá. Si necesitás, elegí *Hablar con alguien* en el menú.`));
    else out.push(menuButton("No encontré ese pedido."));
  }

  // ───────────────────────── Cadete para comercios ─────────────────────────

  function askCadete(s, out) {
    if (!s.comercio) { out.push(menu(null, s)); return; }
    out.push({
      text: `🛵 ¿Pedimos un cadete para *${s.comercio.name}*?\nVa al local y coordina en el mostrador cuántos envíos lleva.`,
      buttons: [{ id: "cd_ok", title: "✅ Sí, pedir" }, { id: "x_cancel", title: "No" }],
      asButtons: true,
    });
  }

  async function createCadete(waId, s, out) {
    if (!s.comercio) { out.push(menu(null, s)); return; }
    if (!(await orders.hasOnlineDriver())) { out.push(menuButton("😕 En este momento no hay cadetes conectados. Probá en unos minutos.")); return; }
    const c = await comercios.get(s.comercio.id);
    if (!c) { out.push(menuButton("No encontré tu comercio.")); return; }
    const res = await orders.createCadeteria({ waId, comercio: c });
    s.step = "idle"; s.data = {};
    out.push({ text: `🛵 *Cadete pedido para ${c.name}* (#${res.orderNum}).\nYa lo están viendo los cadetes; el que lo tome va para tu local.` });
  }

  // ───────────────────────── Soporte ─────────────────────────

  async function startSupport(waId, name, s, out) {
    s.step = "support"; s.data = {};
    await db.collection("support_chats").doc(waId).set({
      userId: waId,
      userName: name || "Cliente WhatsApp",
      userPhone: waId,
      source: "whatsapp_bot",
      isWhatsAppBot: true,
      humanRequested: true,
      status: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    out.push({ text: "🙋 Te paso con una persona del equipo. Escribí tu consulta y te respondemos por acá.\n_Para volver al menú escribí *menú*._" });
  }

  async function saveSupport(waId, name, msg) {
    let text = msg.text || "";
    if (msg.kind === "media" && msg.media) text = [text, `${msg.media.type === "audio" ? "🎤 Audio" : "📷 Archivo"}: ${msg.media.url || "(no se pudo guardar)"}`].filter(Boolean).join("\n");
    if (msg.kind === "location" && msg.location) text = `📍 Ubicación: https://maps.google.com/?q=${msg.location.lat},${msg.location.lng}`;
    if (msg.kind === "reply") text = msg.title || msg.id;
    if (!text) return;
    await db.collection("support_chats").doc(waId).set({
      userId: waId,
      userName: name || "Cliente WhatsApp",
      userPhone: waId,
      source: "whatsapp_bot",
      isWhatsAppBot: true,
      humanRequested: true,
      status: "pending",
      lastMessage: text,
      lastMessageText: text,
      lastMessageTime: FieldValue.serverTimestamp(),
      unreadByAdmin: true,
      unreadByUser: false,
      updatedAt: FieldValue.serverTimestamp(),
      messages: FieldValue.arrayUnion({ sender: "user", senderName: name || "", text, timestamp: Date.now() }),
    }, { merge: true });
  }

  // ── Editar el resumen ──
  function editStep(id, s, out) {
    if (!s.data.delivery) { out.push(menuButton("Ese pedido ya no está. Escribí *menú* para empezar uno.")); return; }
    s.data.editing = true;
    if (id === "e_items") {
      s.data.media = [];
      if (s.data.flow === "compra") { s.data.stops = []; s.step = "c_store"; out.push(askStore(0)); return; }
      s.data.details = "";
      s.step = "details";
      out.push(askDetails(s.data.flow, s.data.comercio && s.data.comercio.name));
      return;
    }
    if (id === "e_pickup") { s.step = "pickup"; out.push(askLocation("¿Dónde lo retiramos?")); return; }
    if (id === "e_delivery") { s.step = "delivery"; out.push(askDelivery(s)); return; }
    if (id === "e_notes") { s.step = "notes"; out.push(askNotes()); return; }
    s.step = "pay";
    out.push(askPay());
  }

  // ── Repetir el último pedido ──
  async function repeatLast(name, s, out) {
    if (!s.lastOrder || !s.lastOrder.delivery) { out.push(menu(name, s)); return; }
    const { at, ...last } = s.lastOrder;
    s.data = JSON.parse(JSON.stringify(last));
    s.step = "confirm";
    out.push({ text: "🔁 Te armé el mismo pedido de la última vez. Revisalo y confirmá (o tocá *Editar*):" });
    out.push(await summary(s));
  }

  // ── GoPoints y sorteos ──
  async function showPoints(waId, name, out) {
    const customer = await orders.resolveCustomer(waId, name);
    const u = await db.collection("users").doc(customer.userId).get().catch(() => null);
    const points = u && u.exists ? Number(u.data().points) || 0 : 0;
    const open = giveaways ? await giveaways.listOpen().catch(() => []) : [];
    let text = `🎁 *Tus GoPoints: ${points.toLocaleString("es-AR")}*\n_Sumás puntos con cada pedido entregado${customer.linked ? " (los de la app y los de acá van a la misma cuenta)" : ""}._`;
    const buttons = [];
    if (open.length) {
      text += "\n\n🎟️ *Sorteos abiertos*";
      for (const [i, g] of open.slice(0, 2).entries()) {
        const mine = await giveaways.entryOf(g.id, customer.userId).catch(() => null);
        text += `\n${i + 1}. *${g.title || "Sorteo"}*${g.subtitle ? ` — ${short(g.subtitle, 120)}` : ""}`;
        if (mine) text += `\n   ✅ Ya estás anotado (${mine.chances || 1} chance${(mine.chances || 1) > 1 ? "s" : ""})`;
        else buttons.push({ id: `gw:${g.id}`, title: open.length > 1 ? `🎟️ Anotarme al ${i + 1}` : "🎟️ Anotarme" });
      }
    } else {
      text += "\n\nAhora no hay sorteos abiertos. Te avisamos cuando haya uno 😉";
    }
    buttons.push({ id: "go_menu", title: "Ver menú" });
    out.push({ text, buttons: buttons.slice(0, 3) });
  }

  async function joinGiveaway(waId, name, giveawayId, out) {
    if (!giveaways) { out.push(menuButton("Ahora no se puede anotar en sorteos.")); return; }
    const customer = await orders.resolveCustomer(waId, name);
    if (!customer.linked && ensureWaUser) {
      await ensureWaUser(db, { userId: customer.userId, userName: customer.userName, userPhone: customer.phone, waPhone: waId });
    }
    const r = await giveaways.join(giveawayId, customer.userId);
    if (r.error === "closed" || r.error === "not_found") { out.push(menuButton("Ese sorteo ya cerró 😕")); return; }
    if (r.error === "not_eligible") { out.push(menuButton("Este sorteo no está abierto para tu cuenta.")); return; }
    if (r.error) { out.push(menuButton("😕 No te pude anotar. Probá de nuevo en un rato.")); return; }
    const chances = (r.entry && r.entry.chances) || 1;
    out.push(menuButton(r.created
      ? `🎉 ¡Listo! Ya estás participando en *${r.title || "el sorteo"}* con ${chances} chance${chances > 1 ? "s" : ""}.\nCada pedido entregado te suma más.`
      : `✅ Ya estabas anotado en *${r.title || "el sorteo"}* (${chances} chance${chances > 1 ? "s" : ""}).`));
  }

  return { handle, loadSession, saveSession, money };
}

module.exports = { createBot, money, FOOTER };
