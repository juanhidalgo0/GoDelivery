// GoDelivery — Vigilante: auditoría automática de la app (lado servidor)
//
// Corre solo cada 15 minutos (runVigilante) y una vez por día a la mañana (runDailyVigilante).
// Todo lo que encuentra cae en la misma bandeja que los errores de la app (client_errors, Admin →
// Errores), con su propio tipo, así hay un único lugar donde mirar:
//
//   kind "auditoria": revisiones de los datos (pedidos trabados, totales que no cuadran, cuenta del
//     cadete descuadrada, ofertas que no rotan, puntos negativos…). Un grupo por revisión, con los
//     casos de ahora. Si en una pasada ya no hay casos, se marca resuelto solo; si vuelve, se reabre.
//   kind "servidor": errores de las Cloud Functions, leídos de Cloud Logging (logger.error, caídas,
//     timeouts, falta de memoria). Se agrupan igual que los de la app.
//
// Los avisos push los manda alertAdmins (functions/client-errors.js), con el mismo tope por hora.
// El estado de cada pasada queda en system/vigilante (Admin → Errores lo muestra arriba).

const crypto = require("crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { alertAdmins, normalizeMessage, clip, ALERT_AT } = require("./client-errors");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// Estados de un pedido que todavía no terminó (los que escriben la app, el panel y el servidor)
const ACTIVE = ["pending", "confirmed", "accepted", "preparing", "ready", "picked_up", "at_door", "delivering", "in_transit", "on_way"];
const IN_ROUTE = ["picked_up", "at_door", "delivering", "in_transit", "on_way"];
const DONE = ["completed", "delivered"];
const MAX_ITEMS = 25;
const LOGS_PAGE = 500;
// Errores de log que no son de la app (la plataforma los anota y se arreglan solos)
const LOG_NOISE_RE = /^(Default STARTUP TCP probe|Ready condition status changed)/i;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

function tsToMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (t.seconds !== undefined) return t.seconds * 1000;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function ago(ms, now) {
  const m = Math.round((now - ms) / MIN);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

function orderLabel(o) {
  const what = o.isTrip ? "Viaje" : (o.isFavor ? "Mandado" : (o.comercioName || "Pedido"));
  return `#${o.orderId || o.id.slice(0, 6)} · ${what}`;
}

// Hora programada de un pedido (los programados pueden estar abiertos mucho antes de salir)
function scheduledMs(o) {
  const direct = tsToMs(o.scheduledFor) || tsToMs(o.scheduledAt);
  if (direct) return direct;
  if (o.scheduledDate && o.scheduledTime) {
    const ms = new Date(`${o.scheduledDate}T${o.scheduledTime}:00-03:00`).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

const isTakeaway = (o) => o.deliveryType === "takeaway" || o.deliveryType === "retiro";

// ---------------------------------------------------------------- datos (se leen una vez por pasada)

function makeContext(db, now, deps) {
  const memo = new Map();
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
  const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    db,
    now,
    deps,
    activeOrders: () => once("active", async () => docs(await db.collection("orders").where("status", "in", ACTIVE).get())),
    recentOrders: () => once("recent", async () => docs(await db.collection("orders").where("createdAt", ">=", Timestamp.fromMillis(now - 26 * HOUR)).get())),
    onlineDrivers: () => once("online", async () => docs(await db.collection("users").where("isOnline", "==", true).get())),
    ledgerDrivers: () => once("ledger", async () => docs(await db.collection("users").where("ledgerOpened", "==", true).get())),
  };
}

// ---------------------------------------------------------------- revisiones
//
// Cada revisión devuelve { items: [{ id, label }], detail? }. Sin items = todo bien.
// severity "alta" avisa por push cuando aparece; "media" sólo queda en la bandeja.

const CHECKS = [
  {
    id: "pedidos_sin_cancelar",
    severity: "alta",
    title: "Pedidos sin repartidor que no se cancelaron solos",
    help: "cancelUnassignedOrders cancela a los 20 min los pedidos que nadie tomó. Si esto aparece, esa función no está corriendo o falla.",
    async run(ctx) {
      const items = [];
      for (const o of await ctx.activeOrders()) {
        if (o.driverId || !["pending", "confirmed", "preparing", "ready"].includes(o.status)) continue;
        const isService = o.isFavor === true || o.isTrip === true;
        let ref = 0;
        if (isService || o.status === "pending") ref = tsToMs(o.createdAt);
        else if (o.status === "ready" && !isTakeaway(o)) ref = tsToMs(o.readyAt) || tsToMs(o.updatedAt) || tsToMs(o.createdAt);
        if (ref && ctx.now - ref > 30 * MIN) items.push({ id: o.id, label: `${orderLabel(o)} · ${o.status} ${ago(ref, ctx.now)}` });
      }
      return { items };
    },
  },
  {
    id: "pedidos_trabados",
    severity: "alta",
    title: "Pedidos abiertos hace más de 3 horas",
    help: "Un pedido que no se entregó ni se canceló en 3 horas casi siempre quedó colgado (cadete que no deslizó, estado que no avanzó).",
    async run(ctx) {
      const items = [];
      for (const o of await ctx.activeOrders()) {
        const ref = Math.max(tsToMs(o.createdAt), scheduledMs(o));
        if (ref && ctx.now - ref > 3 * HOUR) items.push({ id: o.id, label: `${orderLabel(o)} · ${o.status}${o.driverName ? ` · ${o.driverName}` : ""} · ${ago(ref, ctx.now)}` });
      }
      return { items };
    },
  },
  {
    id: "ofertas_trabadas",
    severity: "alta",
    title: "Ofertas a cadetes que no rotan",
    help: "Una oferta dura 60 s y rotateExpiredOffers la pasa al siguiente cadete. Más de 5 min con la misma oferta = la rotación no anda.",
    async run(ctx) {
      const items = [];
      for (const o of await ctx.activeOrders()) {
        if (o.driverId || !o.queueTargetDriverId || o.isPermanentOffer || o.isOwnDeliveryOrder) continue;
        const at = tsToMs(o.queueOfferedAt);
        if (at && ctx.now - at > 5 * MIN) items.push({ id: o.id, label: `${orderLabel(o)} · ofrecido ${ago(at, ctx.now)}` });
      }
      return { items };
    },
  },
  {
    id: "totales_descuadrados",
    severity: "alta",
    title: "Pedidos cuyo total no coincide con sus partes",
    help: "Total = productos + envío (con propina y recargos) + tarifa de servicio − GoPoints − cupón. Si no da, se le cobró mal al cliente.",
    async run(ctx) {
      const items = [];
      for (const o of await ctx.recentOrders()) {
        if (o.status === "cancelled") continue;
        const total = Number(o.total ?? o.totalAmount);
        if (!Number.isFinite(total) || total < 0) {
          items.push({ id: o.id, label: `${orderLabel(o)} · total inválido (${clip(o.total, 20)})` });
          continue;
        }
        // Mandados y viajes se arman distinto (y el cadete carga la compra después): sólo comercios
        if (o.isFavor || o.isTrip || o.isFixedPrice || typeof o.subtotal !== "number") continue;
        const expected = Math.max(0, o.subtotal + Number(o.deliveryCost || 0) + Number(o.appUsageFee || 0)
          - Number(o.discountAmount || 0) - Number(o.couponDiscount || 0));
        if (Math.abs(expected - total) > 1) {
          items.push({ id: o.id, label: `${orderLabel(o)} · total ${money(total)}, debería ser ${money(expected)}${o.isModified ? " (modificado por el comercio)" : ""}` });
        }
      }
      return { items };
    },
  },
  {
    id: "pedidos_sin_asiento",
    severity: "alta",
    title: "Pedidos entregados que no se anotaron en la cuenta del cadete",
    help: "Al completarse, onOrderStatusChange anota la tarifa en driver_ledger. Si falta el renglón, el cadete no paga esa tarifa ni recibe su cupón/GoPoints.",
    async run(ctx) {
      const items = [];
      for (const o of await ctx.recentOrders()) {
        if (o.status !== "completed" || !o.driverId || o.ledgerEntryId) continue;
        const doneAt = tsToMs(o.completedAt) || tsToMs(o.deliveredAt) || tsToMs(o.updatedAt);
        if (doneAt && ctx.now - doneAt > 10 * MIN) items.push({ id: o.id, label: `${orderLabel(o)} · ${o.driverName || o.driverId} · entregado ${ago(doneAt, ctx.now)}` });
      }
      return { items };
    },
  },
  {
    id: "saldo_cadete_descuadrado",
    severity: "alta",
    title: "Saldo de cadete distinto de su último movimiento",
    help: "users.deliveryDebt tiene que ser igual al saldo del último renglón de driver_ledger. Si no, algo escribió el saldo sin renglón.",
    async run(ctx) {
      const drivers = (await ctx.ledgerDrivers()).filter((u) => u.ledgerLastEntryId);
      if (!drivers.length) return { items: [] };
      const refs = drivers.map((u) => ctx.db.collection("driver_ledger").doc(u.ledgerLastEntryId));
      const entries = await ctx.db.getAll(...refs);
      const suspects = drivers.filter((u, i) => !entries[i].exists || round2(entries[i].data().balanceAfter) !== round2(u.deliveryDebt));
      const items = [];
      // Confirmación dentro de una transacción: un pedido que se completó entre las dos lecturas no cuenta
      for (const u of suspects) {
        const confirmed = await ctx.db.runTransaction(async (tx) => {
          const userSnap = await tx.get(ctx.db.collection("users").doc(u.id));
          const fresh = userSnap.data() || {};
          if (!fresh.ledgerLastEntryId) return null;
          const entrySnap = await tx.get(ctx.db.collection("driver_ledger").doc(fresh.ledgerLastEntryId));
          const balance = entrySnap.exists ? round2(entrySnap.data().balanceAfter) : null;
          return balance === round2(fresh.deliveryDebt) ? null : { debt: fresh.deliveryDebt, balance };
        });
        if (confirmed) items.push({ id: u.id, label: `${u.displayName || u.name || u.id} · saldo ${money(confirmed.debt)}, último renglón ${confirmed.balance == null ? "no existe" : money(confirmed.balance)}` });
      }
      return { items };
    },
  },
  {
    id: "rastreo_cortado",
    severity: "media",
    title: "Pedidos en camino sin ubicación del cadete hace más de 10 min",
    help: "Con un pedido en camino el celular manda la ubicación cada pocos segundos. Si se corta, el cliente ve el mapa congelado (suele ser iPhone con la PWA y la pantalla apagada).",
    async run(ctx) {
      const items = [];
      for (const o of await ctx.activeOrders()) {
        if (!IN_ROUTE.includes(o.status) || !o.driverId) continue;
        const loc = tsToMs(o.driverLocation?.updatedAt);
        const started = tsToMs(o.pickedUpAt) || tsToMs(o.updatedAt);
        const last = Math.max(loc, started);
        if (last && ctx.now - last > 10 * MIN) items.push({ id: o.id, label: `${orderLabel(o)} · ${o.driverName || o.driverId} · última ubicación ${loc ? ago(loc, ctx.now) : "nunca"}` });
      }
      return { items };
    },
  },
  {
    id: "cadetes_sin_push",
    severity: "media",
    title: "Cadetes en línea que no pueden recibir notificaciones",
    help: "No tienen ningún token de push: no les llegan las ofertas con la app cerrada. Que cierren sesión y vuelvan a entrar, o que actualicen la app.",
    async run(ctx) {
      const items = [];
      for (const u of await ctx.onlineDrivers()) {
        if (u.role === "admin" || u.isAdmin === true) continue;
        if (u.lastFcmToken || (Array.isArray(u.fcmTokens) && u.fcmTokens.length)) continue;
        const sub = await ctx.db.collection("users").doc(u.id).collection("fcmTokens").limit(1).get();
        if (sub.empty) items.push({ id: u.id, label: `${u.displayName || u.name || u.id}${u.phone ? ` · ${u.phone}` : ""}` });
      }
      return { items };
    },
  },
  {
    id: "comercios_sin_avisos",
    severity: "media",
    title: "Comercios a los que no les llegan los avisos de pedidos",
    help: "El dueño no tiene ningún dispositivo registrado para notificaciones, o el último es de hace más de 30 días. Sus pedidos entran sin sonar si no está mirando el panel. Que abra el panel en su celular: la franja de arriba le pide el permiso.",
    async run(ctx) {
      const items = [];
      const comercios = (await ctx.db.collection("comercios").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
      for (const c of comercios) {
        if (c.isActive === false || c.active === false || c.deleted === true) continue;
        const name = String(c.name || "").toLowerCase();
        if (name.includes("go!") && name.includes("market")) continue; // lo atienden los admins
        let ownerId = c.ownerId;
        if (!ownerId) {
          const q = await ctx.db.collection("users").where("comercioId", "==", c.id).limit(1).get();
          ownerId = q.empty ? null : q.docs[0].id;
        }
        const label = c.name || c.id;
        if (!ownerId) { items.push({ id: c.id, label: `${label} · sin dueño cargado` }); continue; }
        const owner = (await ctx.db.collection("users").doc(ownerId).get()).data() || {};
        if (owner.role === "admin" || owner.isAdmin === true) continue; // le llega como admin
        const tokens = await ctx.db.collection("users").doc(ownerId).collection("fcmTokens").get();
        let newest = tsToMs(owner.lastFcmToken ? owner.lastFcmTokenUpdatedAt : null);
        tokens.docs.forEach((d) => { const t = d.data(); newest = Math.max(newest, tsToMs(t.updatedAt) || tsToMs(t.lastSession)); });
        const hasAny = !tokens.empty || Boolean(owner.lastFcmToken);
        if (!hasAny) items.push({ id: c.id, label: `${label} · sin ningún dispositivo${owner.phone ? ` · ${owner.phone}` : ""}` });
        else if (newest && ctx.now - newest > 30 * 24 * HOUR) items.push({ id: c.id, label: `${label} · último dispositivo ${ago(newest, ctx.now)}${owner.phone ? ` · ${owner.phone}` : ""}` });
      }
      return { items };
    },
  },
  {
    id: "cadete_desconectado_con_pedido",
    severity: "media",
    title: "Pedidos en curso con el cadete desconectado",
    help: "El cadete tiene el pedido pero figura fuera de línea (se desconectó, se le cerró la app o lo desconectó el sistema). El pedido puede quedar sin entregar.",
    async run(ctx) {
      // Los programados que salen en más de 30 min todavía no necesitan al cadete conectado
      const withDriver = (await ctx.activeOrders()).filter((o) => o.driverId && o.status !== "pending" && !(scheduledMs(o) > ctx.now + 30 * MIN));
      const ids = [...new Set(withDriver.map((o) => o.driverId))];
      if (!ids.length) return { items: [] };
      const snaps = await ctx.db.getAll(...ids.map((id) => ctx.db.collection("users").doc(id)));
      const offline = new Map(snaps.filter((d) => d.exists && d.data().isOnline !== true && !["admin"].includes(d.data().role)).map((d) => [d.id, d.data()]));
      const items = withDriver.filter((o) => offline.has(o.driverId)).map((o) => {
        const u = offline.get(o.driverId);
        return { id: o.id, label: `${orderLabel(o)} · ${o.status} · ${u.displayName || u.name || o.driverId}${u.disconnectedReason ? ` (${u.disconnectedReason})` : ""}` };
      });
      return { items };
    },
  },
  {
    id: "clima_sin_actualizar",
    severity: "media",
    title: "El chequeo de lluvia no se está actualizando",
    help: "checkWeatherPeriodic actualiza settings/weather cada 10 minutos. Si se frena, el recargo por lluvia queda prendido o apagado como estaba.",
    async run(ctx) {
      const w = (await ctx.db.collection("settings").doc("weather").get()).data();
      const at = tsToMs(w?.checkedAt);
      if (!w || !at) return { items: [] };
      return { items: ctx.now - at > 40 * MIN ? [{ id: "weather", label: `Última actualización ${ago(at, ctx.now)}${w.lastError ? ` · último error: ${clip(w.lastError, 120)}` : ""}` }] : [] };
    },
  },
  {
    id: "reinicios_app",
    severity: "media",
    title: "Muchos reinicios de la app en las últimas 24 h",
    help: "Recargas que pidió la app o cierres con la app en pantalla (Admin → Reinicios tiene el detalle). Más de 10 en un día suele ser un error que fuerza la recarga.",
    async run(ctx) {
      const snap = await ctx.db.collection("app_restarts").where("createdAt", ">=", Timestamp.fromMillis(ctx.now - 24 * HOUR)).get();
      // La recarga por versión nueva es la actualización normal después de publicar: no cuenta
      // (cada publicación sumaba una por persona y disparaba el aviso, 16-10-2026).
      const isUpdate = (r) => /^versión nueva/i.test(String(r.reason || ""));
      const bad = snap.docs.map((d) => d.data()).filter((r) => (r.kind === "la app recargó" && !isUpdate(r)) || (r.kind === "reinicio sin aviso" && r.wasVisible === true));
      if (bad.length < 10) return { items: [] };
      const groups = new Map();
      bad.forEach((r) => { const k = `${r.kind}: ${clip(r.reason, 90)}`; groups.set(k, (groups.get(k) || 0) + 1); });
      return { items: [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ id: k, label: `${n}× ${k}` })) };
    },
  },
  {
    id: "puntos_negativos",
    severity: "alta",
    title: "Clientes con GoPoints negativos",
    help: "Un canje que descontó dos veces o una devolución mal hecha.",
    async run(ctx) {
      const snap = await ctx.db.collection("users").where("points", "<", 0).limit(MAX_ITEMS).get();
      return { items: snap.docs.map((d) => ({ id: d.id, label: `${d.data().displayName || d.data().name || d.id} · ${d.data().points} puntos` })) };
    },
  },
  {
    id: "cupones_pasados",
    severity: "media",
    title: "Cupones con usos restantes negativos",
    help: "Se usaron más veces de las permitidas (dos pedidos al mismo tiempo con el último uso).",
    async run(ctx) {
      const snap = await ctx.db.collection("coupons").where("remaining", "<", 0).limit(MAX_ITEMS).get();
      return { items: snap.docs.map((d) => ({ id: d.id, label: `${d.id} · ${d.data().remaining} usos restantes` })) };
    },
  },
];

// Una vez por día: la suma de todos los renglones de cada cadete tiene que dar su saldo.
const DAILY_CHECKS = [
  {
    id: "libro_cadete_no_suma",
    severity: "alta",
    title: "Cuenta de cadete cuya suma de movimientos no da el saldo",
    help: "Suma de todos los renglones de driver_ledger ≠ users.deliveryDebt. Se revisa una vez por día.",
    async run(ctx) {
      const snap = await ctx.db.collection("driver_ledger").select("driverId", "amount").get();
      const sums = new Map();
      snap.docs.forEach((d) => { const e = d.data(); sums.set(e.driverId, round2((sums.get(e.driverId) || 0) + round2(e.amount))); });
      const items = [];
      for (const u of await ctx.ledgerDrivers()) {
        const sum = sums.get(u.id) || 0;
        if (Math.abs(sum - round2(u.deliveryDebt)) > 0.01) items.push({ id: u.id, label: `${u.displayName || u.name || u.id} · suma ${money(sum)}, saldo ${money(u.deliveryDebt)}` });
      }
      return { items };
    },
  },
];

// ---------------------------------------------------------------- bandeja (client_errors)

async function recordAudit(db, check, result, now) {
  const fingerprint = `audit_${check.id}`;
  const ref = db.collection("client_errors").doc(fingerprint);
  const items = result.items || [];
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : null;
    if (!items.length) {
      if (prev && prev.status === "open") {
        tx.update(ref, { status: "resolved", statusBy: "vigilante", statusAt: FieldValue.serverTimestamp(), note: "Se normalizó solo", affected: 0, lastCheckedAt: FieldValue.serverTimestamp() });
      } else if (prev) {
        tx.update(ref, { affected: 0, lastCheckedAt: FieldValue.serverTimestamp() });
      }
      return null;
    }
    const message = `${check.title} (${items.length})`;
    const sample = { items: items.slice(0, MAX_ITEMS), help: check.help, at: new Date(now) };
    const update = {
      fingerprint, kind: "auditoria", check: check.id, severity: check.severity, network: false,
      message, normalized: check.title, frame: "", affected: items.length,
      count: (prev?.count || 0) + 1, userCount: 0,
      lastSeen: FieldValue.serverTimestamp(), lastCheckedAt: FieldValue.serverTimestamp(), lastSample: sample,
    };
    if (!prev) {
      tx.set(ref, { ...update, status: "open", firstSeen: FieldValue.serverTimestamp(), firstSample: sample });
      return check.severity === "alta" ? "nuevo" : null;
    }
    if (prev.status === "resolved") {
      tx.update(ref, { ...update, status: "open", reopenedAt: FieldValue.serverTimestamp(), reopenCount: FieldValue.increment(1), note: null });
      return check.severity === "alta" ? "volvio" : null;
    }
    tx.update(ref, update);
    return null;
  });
}

async function runChecks(db, checks, now, deps) {
  const ctx = makeContext(db, now, deps);
  const results = {};
  for (const check of checks) {
    const started = Date.now();
    try {
      const result = await check.run(ctx);
      const alert = await recordAudit(db, check, result, now);
      if (alert && !deps.quiet) await alertAdmins({ fingerprint: `audit_${check.id}`, alert }, deps).catch((err) => logger.warn("[Vigilante] aviso falló:", err));
      results[check.id] = { title: check.title, severity: check.severity, ok: !result.items.length, affected: result.items.length, ms: Date.now() - started };
    } catch (err) {
      // Que una revisión falle no frena las demás; el error de log lo levanta la pasada siguiente
      logger.error(`[Vigilante] la revisión ${check.id} falló:`, err);
      results[check.id] = { title: check.title, severity: check.severity, ok: null, error: clip(err?.message || err, 200), ms: Date.now() - started };
    }
  }
  return results;
}

// ---------------------------------------------------------------- errores del servidor (Cloud Logging)

function logMessageOf(entry) {
  const data = entry.data;
  let text = "";
  if (typeof data === "string") text = data;
  else if (data && typeof data === "object") {
    text = data.message || data.textPayload || (data.error && (data.error.message || data.error)) || "";
    if (!text && data.status && data.status.message) text = data.status.message;
    if (!text) { try { text = JSON.stringify(data).slice(0, 400); } catch (e) { text = ""; } }
  }
  return String(text || "");
}

function serviceOf(entry) {
  const labels = entry.metadata?.resource?.labels || {};
  return labels.function_name || labels.service_name || labels.configuration_name || entry.metadata?.resource?.type || "?";
}

// Primer renglón con el mensaje y, si hay, el renglón del error ("TypeError: …")
function headline(text) {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || "";
  const errLine = lines.slice(1).find((l) => /^(\w*Error|FirebaseError|Error)\b|^\w+Error:/.test(l));
  return clip(errLine && !first.includes(errLine) ? `${first} ${errLine}` : first, 400);
}

let loggingClient = null;
function logging() {
  if (!loggingClient) {
    const { Logging } = require("@google-cloud/logging");
    loggingClient = new Logging();
  }
  return loggingClient;
}

async function ingestServerErrors(db, now, deps, state) {
  const since = state.logsCursor ? new Date(state.logsCursor) : new Date(now - 20 * MIN);
  // Los registros pueden tardar en aparecer: se procesa hasta 2 min antes de ahora y lo último
  // queda para la pasada siguiente, así no se pierde nada que llegue tarde.
  // De a tramos de 30 min: atrasado varias horas, una sola consulta superaba el tiempo de la API
  // de registros ("Total timeout … exceeded 60000", 14-10-2026) y no avanzaba nunca
  const until = new Date(Math.min(now - 2 * MIN, since.getTime() + 30 * MIN));
  if (until <= since) return { cursor: state.logsCursor, entries: 0, groups: 0, more: false };
  const filter = [
    "severity>=ERROR",
    `timestamp>"${since.toISOString()}"`,
    `timestamp<="${until.toISOString()}"`,
    '(resource.type="cloud_run_revision" OR resource.type="cloud_function")',
  ].join(" AND ");
  const [entries] = await (deps.getLogEntries || ((opts) => logging().getEntries(opts)))({ filter, orderBy: "timestamp asc", pageSize: LOGS_PAGE, autoPaginate: false, gaxOptions: { timeout: 120000 } });
  const groups = new Map();
  let cursor = state.logsCursor || since.toISOString();
  for (const entry of entries || []) {
    const ts = entry.metadata?.timestamp;
    const iso = ts ? new Date(typeof ts === "object" && ts.seconds ? Number(ts.seconds) * 1000 + Math.floor((ts.nanos || 0) / 1e6) : ts).toISOString() : null;
    if (iso && iso > cursor) cursor = iso;
    const text = logMessageOf(entry);
    const service = serviceOf(entry);
    if (!text || LOG_NOISE_RE.test(text)) continue;
    const head = headline(text);
    const fp = "srv_" + crypto.createHash("sha1").update(`${service}|${normalizeMessage(head)}`).digest("hex").slice(0, 20);
    const g = groups.get(fp) || { n: 0, service, head, text, at: iso };
    g.n += 1;
    g.text = text; g.at = iso || g.at;
    groups.set(fp, g);
  }
  const alerts = [];
  for (const [fingerprint, g] of groups) {
    const ref = db.collection("client_errors").doc(fingerprint);
    const alert = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? snap.data() : null;
      const before = prev?.count || 0;
      const count = before + g.n;
      const sample = { service: g.service, stack: clip(g.text, 2000), at: g.at ? new Date(g.at) : new Date(now), route: "", role: "servidor", platform: "Cloud Functions" };
      // "Última vez" = cuándo pasó el error (la hora del registro), no cuándo se leyó: si el
      // vigilante se atrasa leyendo, antes los errores viejos parecían de recién.
      const happenedMs = g.at ? Date.parse(g.at) : now;
      const prevLastMs = prev?.lastSeen?.toMillis ? prev.lastSeen.toMillis() : 0;
      const update = {
        fingerprint, kind: "servidor", network: false, message: g.head, normalized: normalizeMessage(g.head), frame: g.service,
        count, userCount: 0, lastSeen: Timestamp.fromMillis(Math.max(happenedMs, prevLastMs)), lastSample: sample,
        [`routes.${g.service.replace(/[.~*/[\]`#$]/g, "_").slice(0, 60) || "?"}`]: FieldValue.increment(g.n),
      };
      if (!prev) {
        tx.set(ref, { fingerprint, status: "open", firstSeen: Timestamp.fromMillis(happenedMs), firstSample: sample });
        tx.update(ref, update);
        return "nuevo";
      }
      // Resuelto y lo que llega es de ANTES de marcarlo resuelto (el vigilante se puso al día con
      // registros viejos): se cuenta, pero no se reabre ni se avisa. Así volvía "customer photo".
      const resolvedMs = prev.statusAt?.toMillis ? prev.statusAt.toMillis() : 0;
      if (prev.status === "resolved" && resolvedMs && happenedMs <= resolvedMs) {
        tx.update(ref, { count, [`routes.${g.service.replace(/[.~*/[\]`#$]/g, "_").slice(0, 60) || "?"}`]: FieldValue.increment(g.n) });
        return null;
      }
      if (prev.status === "resolved") {
        tx.update(ref, { ...update, status: "open", reopenedAt: FieldValue.serverTimestamp(), reopenCount: FieldValue.increment(1) });
        return "volvio";
      }
      tx.update(ref, update);
      if (prev.status === "ignored") return null;
      return ALERT_AT.some((t) => before < t && count >= t) ? "repetido" : null;
    });
    if (alert) alerts.push({ fingerprint, alert });
  }
  if (!deps.quiet) for (const a of alerts) await alertAdmins(a, deps).catch((err) => logger.warn("[Vigilante] aviso falló:", err));
  const truncated = (entries || []).length >= LOGS_PAGE;
  const behind = until.getTime() < now - 2 * MIN;
  // Atrasado y con el tramo leído entero: la marca va hasta el final del tramo (si no, un tramo
  // sin errores la dejaba quieta y no avanzaba nunca). Al día se deja como estaba, para levantar
  // en la pasada siguiente los registros que llegan con demora.
  if (!truncated && behind) cursor = until.toISOString();
  return { cursor, entries: (entries || []).length, groups: groups.size, more: truncated || behind };
}

// ---------------------------------------------------------------- pasadas

async function runVigilante(deps = {}, { daily = false } = {}) {
  const db = getFirestore();
  const now = Date.now();
  const stateRef = db.collection("system").doc("vigilante");
  const state = (await stateRef.get()).data() || {};
  // La primera pasada es la línea de base: lo que ya estaba mal queda en la bandeja y en el resumen
  // de la mañana, sin una ráfaga de avisos de golpe.
  deps = { ...deps, quiet: deps.quiet ?? !state.lastRunAt };

  const checks = await runChecks(db, daily ? [...CHECKS, ...DAILY_CHECKS] : CHECKS, now, deps);

  let logs = null;
  try {
    // En el emulador no hay Cloud Logging (las pruebas inyectan deps.getLogEntries)
    if (process.env.FUNCTIONS_EMULATOR === "true" && !deps.getLogEntries) {
      logs = { skipped: true, entries: 0, groups: 0 };
    } else {
      // Atrasado: hasta 6 tramos de 30 min por pasada para ponerse al día
      let cur = { ...state };
      logs = { entries: 0, groups: 0, more: false };
      for (let i = 0; i < 6; i++) {
        const r = await ingestServerErrors(db, now, deps, cur);
        logs = { cursor: r.cursor, entries: logs.entries + r.entries, groups: logs.groups + r.groups, more: r.more };
        if (!r.more || r.cursor === cur.logsCursor) break;
        cur = { ...cur, logsCursor: r.cursor };
      }
    }
  } catch (err) {
    const msg = clip(err?.message || err, 300);
    logger.error("[Vigilante] no se pudieron leer los registros del servidor:", err);
    // El vigilante mismo deja constancia en la bandeja, así no queda ciego sin que nadie lo sepa
    await recordAudit(db, { id: "vigilante_sin_registros", severity: "alta", title: "El vigilante no puede leer los errores del servidor", help: `Cloud Logging respondió: ${msg}. La cuenta de servicio de las funciones necesita el rol "Logs Viewer".` }, { items: [{ id: "logging", label: msg }] }, now)
      .then((alert) => alert && !deps.quiet && alertAdmins({ fingerprint: "audit_vigilante_sin_registros", alert }, deps))
      .catch(() => {});
    logs = { error: msg };
  }
  if (logs && !logs.error) {
    await recordAudit(db, { id: "vigilante_sin_registros", severity: "alta", title: "", help: "" }, { items: [] }, now).catch(() => {});
  }

  const summary = {
    lastRunAt: FieldValue.serverTimestamp(),
    lastRunMs: Date.now() - now,
    checks,
    logs: logs ? { entries: logs.entries || 0, groups: logs.groups || 0, error: logs.error || null, more: !!logs.more, skipped: !!logs.skipped } : null,
    ...(logs && logs.cursor ? { logsCursor: logs.cursor } : {}),
    ...(daily ? { lastDailyAt: FieldValue.serverTimestamp(), dailyChecks: Object.fromEntries(DAILY_CHECKS.map((c) => [c.id, checks[c.id]])) } : {}),
  };
  // Las diarias no pisan el resumen de las de cada 15 min
  if (daily) DAILY_CHECKS.forEach((c) => delete summary.checks[c.id]);
  await stateRef.set(summary, { merge: true });
  logger.info(`[Vigilante] ${daily ? "diaria" : "pasada"} en ${Date.now() - now} ms: ${Object.entries(checks).filter(([, r]) => r.ok === false).map(([id, r]) => `${id}=${r.affected}`).join(", ") || "todo OK"}; logs ${JSON.stringify(summary.logs)}`);
  return { checks, logs };
}

// Resumen de la mañana: qué quedó abierto y qué apareció en las últimas 24 h.
async function sendDailyDigest(deps) {
  const db = getFirestore();
  const now = Date.now();
  const open = (await db.collection("client_errors").where("status", "==", "open").get()).docs.map((d) => d.data()).filter((e) => !e.network);
  const fresh = open.filter((e) => tsToMs(e.firstSeen) > now - 24 * HOUR);
  const byKind = (k) => open.filter((e) => (e.kind === k) || (k === "app" && !["servidor", "auditoria"].includes(e.kind))).length;
  const title = open.length ? `🩺 Vigilante: ${open.length} ${open.length === 1 ? "cosa abierta" : "cosas abiertas"}` : "🩺 Vigilante: todo en orden";
  const body = open.length
    ? `App ${byKind("app")} · Servidor ${byKind("servidor")} · Auditoría ${byKind("auditoria")}${fresh.length ? ` · ${fresh.length} nuevas en 24 h` : ""}. Tocá para verlas.`
    : "Sin errores abiertos en la app, el servidor ni los datos.";
  const tokens = await deps.getAdminTokens();
  await deps.sendPush(tokens, { title, body }, { url: "#/admin/errores", tag: "vigilante-diario" });
  return { open: open.length, fresh: fresh.length };
}

module.exports = { runVigilante, sendDailyDigest, CHECKS, DAILY_CHECKS, headline };
