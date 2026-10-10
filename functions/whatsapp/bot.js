// Conversación del bot de WhatsApp, sin IA: menú, preguntas guiadas y botones.
//
// Tres caminos para cualquier pedido, según lo que GO! sabe del lugar:
//   compra / envío  → mandado: el cadete lee el texto tal cual (no hace falta entenderlo)
//   comercio        → con catálogo: link a su tienda; o pedido escrito que el comercio cotiza
// El estado de cada conversación vive en wa_sessions/{waId}.
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { norm, storeUrl } = require("./comercios");
const { TOWN_CENTER } = require("./orders");

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;      // un pedido a medio armar se olvida a las 2 h
const SUPPORT_TTL_MS = 12 * 60 * 60 * 1000;
const COMERCIO_RECHECK_MS = 24 * 60 * 60 * 1000;

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const short = (s, n = 300) => { const t = String(s || "").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const PAY_LABEL = { efectivo: "💵 Efectivo", transferencia: "🏦 Transferencia" };

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

function createBot({ db, orders, comercios, sender }) {
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

  function menu(name, s) {
    const rows = [
      { id: "m_compra", title: "🛒 Comprar algo", description: "Un cadete te compra lo que necesites y te lo lleva" },
      { id: "m_envio", title: "📦 Llevar o traer algo", description: "Paquetes, llaves, documentos, de un lugar a otro" },
      { id: "m_comercio", title: "🍔 Pedir a un comercio", description: "Comida, kiosco, farmacia y más" },
      { id: "m_pedidos", title: "📋 Mis pedidos", description: "Cómo va lo que pediste" },
      { id: "m_humano", title: "🙋 Hablar con alguien", description: "Te atiende una persona del equipo" },
    ];
    if (s.comercio) rows.unshift({ id: "m_cadete", title: "🛵 Cadete para mi local", description: `Pedí un cadete para ${s.comercio.name}` });
    const hi = name ? `¡Hola ${String(name).split(" ")[0]}! 👋` : "¡Hola! 👋";
    return {
      text: `${hi} Soy el asistente de *GO! Delivery*.\n¿Qué necesitás?\n\n_Escribí *menú* en cualquier momento para volver acá._`,
      list: { button: "Elegir", section: "¿Qué necesitás?", rows },
    };
  }

  const menuButton = (text) => ({ text, buttons: [{ id: "go_menu", title: "Ver menú" }] });

  function askDetails(flow, comercioName) {
    if (flow === "envio") {
      return { text: "📦 *¿Qué hay que llevar?*\nContame qué es y cualquier detalle (tamaño, si es frágil, a quién se entrega)." };
    }
    if (flow === "comercio") {
      return { text: `✍️ *Escribí tu pedido para ${comercioName}.*\nPoné todo lo que quieras: cantidades, gustos, aclaraciones. También podés mandar un audio o una foto.` };
    }
    return { text: "🛒 *Contame qué necesitás.*\nEscribí la lista y, si querés, de dónde (ej: _2 kg de papa y una lavandina de lo de Pepe_).\nTambién podés mandar un audio o una foto de la lista." };
  }

  const detailsAck = () => ({
    text: "Anotado ✍️\nSi querés agregar algo más, escribilo. Si ya está, tocá *Listo*.",
    buttons: [{ id: "d_done", title: "✅ Listo" }, { id: "x_cancel", title: "Cancelar" }],
  });

  const askLocation = (what) => ({
    text: `📍 *${what}*\nMandá la ubicación con el botón 👇 o escribí la dirección (calle, número y entre calles).`,
    askLocation: true,
  });

  function askDelivery(s) {
    if (s.lastAddress && s.lastAddress.address) {
      return {
        text: `📍 ¿Lo llevamos a *${short(s.lastAddress.address, 120)}*?`,
        buttons: [{ id: "a_last", title: "Sí, ahí" }, { id: "a_new", title: "Otra dirección" }],
      };
    }
    return askLocation("¿Adónde lo llevamos?");
  }

  const askNotes = () => ({
    text: "¿Algún dato para encontrarte? (piso, depto, timbre, color de la casa)\nEscribilo o tocá *Sin datos*.",
    buttons: [{ id: "n_none", title: "Sin datos" }],
  });

  const askPay = () => ({
    text: "💳 ¿Cómo vas a pagar?",
    buttons: [{ id: "p_efectivo", title: "💵 Efectivo" }, { id: "p_transferencia", title: "🏦 Transferencia" }],
  });

  const fullDetails = (d) => [d.store ? `En ${d.store}:` : "", d.details || ""].filter(Boolean).join(" ");

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
        buttons: [{ id: "c_ok", title: "📨 Consultar" }, { id: "x_cancel", title: "❌ Cancelar" }],
      };
    }
    const type = d.flow === "envio" ? "mandado" : "compra";
    const q = await orders.quoteFavor({ type, pickupCoords: d.flow === "envio" ? d.pickup && d.pickup.coords : TOWN_CENTER, deliveryCoords: d.delivery.coords });
    const lines = [`Envío: ${money(q.deliveryCost)}${q.isRaining ? " (incluye lluvia 🌧️)" : ""}`];
    if (q.purchaseFee) lines.push(`Servicio de compra: ${money(q.purchaseFee)}`);
    if (q.appUsageFee) lines.push(`Uso de la app: ${money(q.appUsageFee)}`);
    const pickup = d.flow === "envio" ? `\n🏁 Retiro: ${short(d.pickup.address, 120)}` : "";
    return {
      text: `🧾 *Resumen*\n\n${d.flow === "envio" ? "📦" : "🛒"} ${what}${media}${pickup}\n📍 Entrega: ${where}\n💳 ${PAY_LABEL[d.pay]}\n\n` +
        `${lines.join("\n")}\n*Total: ${money(q.total)}*` +
        (type === "compra" ? "\n_+ lo que salga la compra, que le pagás al cadete contra ticket._" : "") +
        (q.exactDistance ? "" : "\n_El envío es estimado porque no mandaste la ubicación exacta._"),
      buttons: [{ id: "c_ok", title: "✅ Confirmar" }, { id: "x_cancel", title: "❌ Cancelar" }],
    };
  }

  // ───────────────────────── Entrada ─────────────────────────

  // msg: { kind: text|reply|location|media|other, text, id, location: {lat,lng,address,name}, media: {type,url} }
  async function handle({ waId, name, msg, national }) {
    const s = await loadSession(waId);
    await senderComercio(waId, s, national);
    const out = [];
    try {
      await route({ waId, name, msg, s, out });
    } catch (err) {
      logger.error(`[WhatsApp] Error atendiendo a ${waId}:`, err);
      out.push(menuButton("😕 Uy, algo falló de nuestro lado. Probá de nuevo en un ratito o escribí *menú*."));
      s.step = "idle"; s.data = {};
    }
    s.lastName = name || s.lastName || null;
    await saveSession(waId, s);
    await sender.send(waId, out);
  }

  function startFlow(s, flow, extra = {}) {
    s.step = "details";
    s.data = { flow, details: "", media: [], ...extra };
  }

  async function route({ waId, name, msg, s, out }) {
    const t = msg.kind === "text" ? norm(msg.text) : "";
    let id = msg.kind === "reply" ? msg.id : "";
    if (!id && t) {
      if (s.step === "details" && DONE_WORDS.has(t)) id = "d_done";
      else if (s.step === "confirm" && YES_WORDS.has(t)) id = "c_ok";
      else if (s.step === "notes" && NO_NOTES_WORDS.has(t)) id = "n_none";
      else if (s.step === "pay" && t.includes("efectivo")) id = "p_efectivo";
      else if (s.step === "pay" && t.includes("transfer")) id = "p_transferencia";
      else if (s.step === "delivery" && s.lastAddress && YES_WORDS.has(t)) id = "a_last";
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
        startFlow(s, "compra", store ? { store } : {});
        out.push(store ? { text: `🛒 *¿Qué te compramos en ${store}?*
Escribí la lista, o mandá un audio o una foto.` } : askDetails("compra"));
        return;
      }
      case "m_envio": startFlow(s, "envio"); out.push(askDetails("envio")); return;
      case "m_comercio": return listComercios(s, out);
      case "m_pedidos": return myOrders(waId, out);
      case "m_humano": return startSupport(waId, name, s, out);
      case "m_cadete": return askCadete(s, out);
      case "cd_ok": return createCadete(waId, s, out);
      case "k_other": s.step = "k_search"; s.data = {}; out.push({ text: "🔎 Escribí el nombre del comercio." }); return;
      case "k_menu": return sendStoreLink(s, out);
      case "k_write": startFlow(s, "comercio", { comercio: s.data.comercio }); out.push(askDetails("comercio", s.data.comercio.name)); return;
      default: break;
    }

    switch (s.step) {
      case "details": return onDetails(msg, id, s, out);
      case "pickup": return onPickup(msg, s, out);
      case "delivery": return onDelivery(msg, id, s, out);
      case "notes": return onNotes(msg, id, s, out);
      case "pay": return onPay(id, s, out);
      case "confirm": return onConfirm(waId, name, id, s, out);
      case "k_pick":
      case "k_search": return onComercioText(msg, s, out);
      case "k_mode":
        // Escribió el pedido directamente en vez de elegir un botón
        startFlow(s, "comercio", { comercio: s.data.comercio });
        return onDetails(msg, "", s, out);
      case "k_waiting":
        out.push({ text: `⏳ Seguimos esperando a *${s.data.comercio && s.data.comercio.name}*. Si no querés esperar, escribí *cancelar*.` });
        return;
      case "k_quoted":
        out.push({ text: "Tocá *Confirmar* o *No, gracias* en el mensaje de arriba 👆 (o escribí *cancelar*)." });
        return;
      default:
        out.push(menu(name, s));
    }
  }

  // ───────────────────────── Pasos ─────────────────────────

  async function onDetails(msg, id, s, out) {
    if (id === "d_done") {
      if (!s.data.details && !(s.data.media || []).length) {
        out.push({ text: "Todavía no me dijiste qué necesitás 🙂 Escribilo o mandá un audio." });
        return;
      }
      if (s.data.flow === "envio") { s.step = "pickup"; out.push(askLocation("¿Dónde lo retiramos?")); return; }
      s.step = "delivery";
      out.push(askDelivery(s));
      return;
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
    s.step = "delivery";
    out.push(askDelivery(s));
  }

  async function onDelivery(msg, id, s, out) {
    if (id === "a_last" && s.lastAddress) {
      s.data.delivery = { address: s.lastAddress.address, coords: s.lastAddress.coords || null };
      s.data.notes = s.lastAddress.notes || "";
      s.step = "pay";
      out.push(askPay());
      return;
    }
    if (id === "a_new") { out.push(askLocation("¿Adónde lo llevamos?")); return; }
    const place = readPlace(msg);
    if (!place) { out.push(askLocation("¿Adónde lo llevamos?")); return; }
    s.data.delivery = place;
    s.step = "notes";
    out.push(askNotes());
  }

  async function onNotes(msg, id, s, out) {
    if (id === "n_none") s.data.notes = "";
    else if (msg.kind === "text" && msg.text.trim()) s.data.notes = msg.text.trim().slice(0, 200);
    else { out.push(askNotes()); return; }
    s.step = "pay";
    out.push(askPay());
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
      out.push(menuButton("😕 En este momento no hay cadetes conectados. Probá de nuevo en un rato."));
      s.step = "idle"; s.data = {};
      return;
    }
    const customer = await orders.resolveCustomer(waId, name);
    s.lastAddress = { address: d.delivery.address, coords: d.delivery.coords || null, notes: d.notes || "" };

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
      waId, customer, type: d.flow === "envio" ? "mandado" : "compra", details: fullDetails(d), media: d.media,
      pickupAddress: d.pickup && d.pickup.address, pickupCoords: d.pickup && d.pickup.coords,
      deliveryAddress: d.delivery.address, deliveryCoords: d.delivery.coords, addressNotes: d.notes, paymentMethod: d.pay,
    });
    s.step = "idle"; s.data = {};
    out.push({
      text: `✅ *¡Listo! Pedido #${res.orderNum}*\nYa lo están viendo los cadetes. Te aviso por acá cuando alguien lo tome.\n\nTotal: *${money(res.quote.total)}*` +
        (d.flow === "compra" ? " + la compra" : "") + "\n_Si necesitás cancelarlo, entrá a *Mis pedidos* desde el menú._",
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
      });
      return;
    }
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
    if (qd.deliveryAddress) s.lastAddress = { address: qd.deliveryAddress, coords: qd.deliveryCoords || null, notes: qd.addressNotes || "" };
    out.push({ text: `✅ *¡Pedido #${res.orderNum} confirmado!*\n*${qd.comercioName}* ya lo está preparando${qd.prepMinutes ? ` (unos ${qd.prepMinutes} min)` : ""}. Te aviso cuando salga.\n\nTotal: *${money(res.total)}*` });
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
    if (!snap.exists) { startFlow(s, "compra"); out.push(askDetails("compra")); return; }
    const q = snap.data();
    s.data = {
      flow: "compra",
      details: q.requestText ? `${q.requestText}` : "",
      media: q.media || [],
      delivery: { address: q.deliveryAddress, coords: q.deliveryCoords || null },
      notes: q.addressNotes || "",
      pay: q.paymentMethod || "efectivo",
    };
    if (!s.data.details && !s.data.media.length) { s.step = "details"; out.push(askDetails("compra")); return; }
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
    const buttons = cancellable.map((o) => ({ id: `oc:${o.id}`, title: `Cancelar #${o.orderId}` }));
    buttons.push({ id: "go_menu", title: "Ver menú" });
    out.push({ text: `📋 *Tus pedidos en curso*\n\n${lines.join("\n\n")}`, buttons });
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
    });
  }

  async function createCadete(waId, s, out) {
    if (!s.comercio) { out.push(menu(null, s)); return; }
    if (!(await orders.hasOnlineDriver())) { out.push(menuButton("😕 En este momento no hay cadetes conectados. Probá en unos minutos.")); return; }
    const c = await comercios.get(s.comercio.id);
    if (!c) { out.push(menuButton("No encontré tu comercio.")); return; }
    const res = await orders.createCadeteria({ waId, comercio: c });
    s.step = "idle"; s.data = {};
    out.push({ text: `🛵 *Cadete pedido para ${c.name}* (#${res.orderNum}).\nTe aviso cuando alguien lo tome.` });
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

  return { handle, loadSession, saveSession, money };
}

module.exports = { createBot, money };
