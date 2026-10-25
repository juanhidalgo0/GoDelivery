// Puente Ventra ↔ GoDelivery (ventraBridge). Reemplaza la conexión vieja, que guardaba la clave
// de administrador de todo GoDelivery en la PC del comercio.
//
// Vincular: un admin de GO genera un código para un comercio (ventra_links/{código}, vence en
// 48 h); el dueño lo pega en Ventra y la PC recibe una clave propia del comercio. Esa clave solo
// sirve para ese comercio: publicar su catálogo, leer sus pedidos y su estado.
//
//   ventra_links/{código}   { comercioId, createdBy, createdAt, expiresAt, usedAt }
//   ventra_keys/{sha256}    { comercioId }            (solo servidor)
//   ventra_stores/{comercio} { keyHash, linkedAt, lastCatalogAt, lastOrdersAt } (solo servidor)
//
// Productos publicados por Ventra: source 'ventra' y ventraId (el id del producto en la caja).
// Los que ya estaban (conexión vieja) se reconocen por código de barras y se reutilizan.

const crypto = require("crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { applyShopping, isShopperCommerce, MISSING_HIDE_MS } = require("./shopper");

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const LINK_CODE = /^[A-Z0-9]{8}$/;
const MAX_UPSERTS = 200;
const ORDER_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
const PANEL_CODE_MS = 2 * 60 * 1000;
/** La cuenta de GO con la que la caja entra al panel de su comercio (solo a ese) */
const panelUid = (comercioId) => `ventra_${comercioId}`;

class BridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** El comercio de una clave de Ventra (header x-ventra-key) */
async function storeOf(db, key) {
  if (!key || String(key).length < 32) throw new BridgeError(401, "Comercio no vinculado");
  const snap = await db.collection("ventra_keys").doc(sha256(key)).get();
  if (!snap.exists) throw new BridgeError(401, "Comercio no vinculado");
  const comercioId = snap.data().comercioId;
  const cSnap = await db.collection("comercios").doc(comercioId).get();
  if (!cSnap.exists) throw new BridgeError(404, "El comercio ya no existe en GO");
  return { comercioId, comercio: cSnap.data() };
}

function storeSummary(comercioId, c) {
  return {
    comercioId,
    name: c.name || "",
    fulfillmentMode: c.fulfillmentMode || "store",
    isActive: c.isActive !== false,
    isPaused: c.isPaused === true,
    approved: c.approvedByAdmin !== false,
  };
}

async function link(db, body) {
  const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!LINK_CODE.test(code)) throw new BridgeError(400, "El código tiene 8 letras y números");
  const ref = db.collection("ventra_links").doc(code);
  const key = crypto.randomBytes(24).toString("hex");
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new BridgeError(404, "Código no encontrado. Pedile uno nuevo a GO.");
    const l = snap.data();
    if (l.usedAt) throw new BridgeError(409, "Ese código ya se usó. Pedile uno nuevo a GO.");
    const exp = l.expiresAt && l.expiresAt.toMillis ? l.expiresAt.toMillis() : 0;
    if (exp && exp < Date.now()) throw new BridgeError(410, "El código venció. Pedile uno nuevo a GO.");
    const cRef = db.collection("comercios").doc(l.comercioId);
    const cSnap = await tx.get(cRef);
    if (!cSnap.exists) throw new BridgeError(404, "El comercio ya no existe en GO");
    const storeRef = db.collection("ventra_stores").doc(l.comercioId);
    const prev = await tx.get(storeRef);
    // Una sola PC/cuenta vinculada por comercio: la clave anterior deja de servir
    if (prev.exists && prev.data().keyHash) tx.delete(db.collection("ventra_keys").doc(prev.data().keyHash));
    const hash = sha256(key);
    tx.set(db.collection("ventra_keys").doc(hash), { comercioId: l.comercioId, createdAt: FieldValue.serverTimestamp() });
    tx.set(storeRef, { keyHash: hash, linkedAt: FieldValue.serverTimestamp(), ventraStoreName: String(body.storeName || "").slice(0, 120) }, { merge: true });
    tx.update(ref, { usedAt: FieldValue.serverTimestamp() });
    tx.update(cRef, { ventraLinked: true, ventraLinkedAt: FieldValue.serverTimestamp() });
    return { comercioId: l.comercioId, comercio: cSnap.data() };
  });
  return { key, store: storeSummary(result.comercioId, result.comercio) };
}

async function unlink(db, { comercioId }) {
  const storeRef = db.collection("ventra_stores").doc(comercioId);
  const s = await storeRef.get();
  const batch = db.batch();
  if (s.exists && s.data().keyHash) batch.delete(db.collection("ventra_keys").doc(s.data().keyHash));
  batch.delete(storeRef);
  // La caja deja de entrar al panel del comercio
  batch.update(db.collection("comercios").doc(comercioId), { ventraLinked: false, managerIds: FieldValue.arrayRemove(panelUid(comercioId)) });
  await batch.commit();
  await getAuth().revokeRefreshTokens(panelUid(comercioId)).catch(() => {});
  return { ok: true };
}

/**
 * La caja pide entrar al panel de su comercio en GO (logo, portada, datos, horarios y todo lo
 * demás del modo comercio). La cuenta de la caja tiene acceso solo a ese comercio (managerIds,
 * como un empleado). Devuelve un código de un solo uso que vence en 2 minutos: la caja abre la
 * app con ese código y la app lo cambia por la sesión (panelLogin). Así no viaja ninguna clave.
 */
async function panelLink(db, { comercioId, comercio }) {
  const uid = panelUid(comercioId);
  const auth = getAuth();
  const displayName = clean(`Caja Ventra · ${comercio.name || "Comercio"}`, 80);
  try {
    await auth.getUser(uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    await auth.createUser({ uid, displayName });
  }
  await db.collection("users").doc(uid).set({
    displayName, email: "", role: "comercio", isComercio: true, ventraPanel: true, comercioId,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  if (!(comercio.managerIds || []).includes(uid)) {
    await db.collection("comercios").doc(comercioId).update({ managerIds: FieldValue.arrayUnion(uid) });
  }
  const code = crypto.randomBytes(18).toString("base64url");
  await db.collection("ventra_panel_codes").doc(sha256(code)).set({
    comercioId, uid, expiresAt: Timestamp.fromMillis(Date.now() + PANEL_CODE_MS), createdAt: FieldValue.serverTimestamp(),
  });
  return { code, comercioId, expiresInMs: PANEL_CODE_MS };
}

/** La app cambia el código de un solo uso por una sesión de la cuenta de la caja */
async function panelLogin(db, body) {
  const code = String(body.code || "");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(code)) throw new BridgeError(400, "Link inválido");
  const ref = db.collection("ventra_panel_codes").doc(sha256(code));
  const data = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new BridgeError(404, "El link ya se usó o no existe. Abrilo de nuevo desde Ventra.");
    const d = snap.data();
    tx.delete(ref);
    if (ms(d.expiresAt) < Date.now()) throw new BridgeError(410, "El link venció. Abrilo de nuevo desde Ventra.");
    return d;
  });
  // Si mientras tanto se desvinculó, la caja ya no entra
  const c = await db.collection("comercios").doc(data.comercioId).get();
  if (!c.exists || !(c.data().managerIds || []).includes(data.uid)) throw new BridgeError(403, "La caja ya no está vinculada con este comercio");
  const token = await getAuth().createCustomToken(data.uid, { ventraPanel: data.comercioId });
  return { token, comercioId: data.comercioId };
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) return null;
  return { mime: m[1] === "image/jpg" ? "image/jpeg" : m[1], buffer };
}

async function uploadImage(storage, comercioId, ventraId, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const bucket = storage.bucket();
  const token = crypto.randomUUID();
  const ext = parsed.mime === "image/png" ? "png" : parsed.mime === "image/webp" ? "webp" : "jpg";
  const filePath = `comercios/${comercioId}/ventra/${String(ventraId).replace(/[^\w-]/g, "")}_${Date.now()}.${ext}`;
  await bucket.file(filePath).save(parsed.buffer, { metadata: { contentType: parsed.mime, metadata: { firebaseStorageDownloadTokens: token } } });
  // En los emuladores el archivo vive en el emulador de Storage (la simulación muestra las fotos)
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : "https://firebasestorage.googleapis.com";
  return `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

const clean = (s, n) => String(s ?? "").trim().slice(0, n);

/**
 * Productos de Ventra → comercios/{id}/products. upserts: [{ ventraId, barcode, name, description,
 * price, category, image (data: o https), stock (número o null), available }]. syncStock: si es
 * false, todo figura disponible (sin stock). deletes: ventraIds que dejan de publicarse.
 * publishedIds (en la última tanda de una publicación completa): lo de Ventra que no esté ahí se oculta.
 */
async function catalog(db, storage, { comercioId }, body) {
  const upserts = (Array.isArray(body.upserts) ? body.upserts : []).slice(0, MAX_UPSERTS);
  const deletes = (Array.isArray(body.deletes) ? body.deletes : []).map(String).slice(0, 500);
  const syncStock = body.syncStock === true;
  const productsRef = db.collection("comercios").doc(comercioId).collection("products");
  const categoriesRef = db.collection("comercios").doc(comercioId).collection("categories");

  // Productos existentes: por ventraId y, si no, por código de barras (los de la conexión vieja)
  const byVentra = new Map();
  const byBarcode = new Map();
  const ids = [...new Set(upserts.map((u) => clean(u.ventraId, 80)).filter(Boolean).concat(deletes))];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await productsRef.where("ventraId", "in", ids.slice(i, i + 30)).get();
    snap.docs.forEach((d) => byVentra.set(d.data().ventraId, d));
  }
  const codes = [...new Set(upserts.filter((u) => !byVentra.has(clean(u.ventraId, 80))).map((u) => clean(u.barcode, 40)).filter(Boolean))];
  for (let i = 0; i < codes.length; i += 30) {
    const snap = await productsRef.where("barcode", "in", codes.slice(i, i + 30)).get();
    snap.docs.forEach((d) => { if (!d.data().ventraId) byBarcode.set(d.data().barcode, d); });
  }

  // Categorías por nombre (se crean las que falten)
  const catSnap = await categoriesRef.get();
  const catByName = new Map(catSnap.docs.map((d) => [String(d.data().name || "").trim().toLowerCase(), d.id]));
  let nextOrder = catSnap.size;
  const categoryId = async (name) => {
    const n = clean(name, 60);
    if (!n || n.toLowerCase() === "varios") return "";
    const key = n.toLowerCase();
    if (catByName.has(key)) return catByName.get(key);
    const ref = categoriesRef.doc();
    await ref.set({ name: n, order: nextOrder++, isActive: true, source: "ventra", createdAt: FieldValue.serverTimestamp() });
    catByName.set(key, ref.id);
    return ref.id;
  };

  const now = Date.now();
  let written = 0;
  const errors = [];
  let batch = db.batch();
  let pending = 0;
  const flush = async () => { if (pending) { await batch.commit(); batch = db.batch(); pending = 0; } };

  for (const u of upserts) {
    const ventraId = clean(u.ventraId, 80);
    // El nombre de la caja; si el dueño lo cambió desde el panel de GO, queda el suyo (abajo)
    const ventraName = clean(u.name, 120);
    const name = ventraName;
    const price = Number(u.price);
    if (!ventraId || !name || !(price > 0)) { errors.push({ ventraId, error: "Falta nombre o precio" }); continue; }
    const existing = byVentra.get(ventraId) || byBarcode.get(clean(u.barcode, 40));
    const prev = existing ? existing.data() : {};
    const ref = existing ? existing.ref : productsRef.doc();
    let image;
    if (typeof u.image === "string" && u.image.startsWith("data:")) {
      try { image = await uploadImage(storage, comercioId, ventraId, u.image); } catch (e) { errors.push({ ventraId, error: "No se pudo subir la foto" }); }
    } else if (typeof u.image === "string" && /^https:\/\//.test(u.image)) image = u.image;
    // Lo que el repartidor no encontró sigue agotado hasta que vence (aunque Ventra lo vuelva a mandar)
    const hiddenUntil = prev.unavailableUntil && prev.unavailableUntil.toMillis ? prev.unavailableUntil.toMillis() : 0;
    const tempMissing = prev.unavailableReason === "shopper_missing" && hiddenUntil > now;
    const stock = Number(u.stock);
    // Lo que el dueño cambió desde el panel de GO manda: su nombre y si lo ocultó
    const keepName = prev.nameLockedInGo === true && prev.name;
    const hiddenInGo = prev.hiddenInGo === true;
    const data = {
      name: keepName ? prev.name : name,
      ventraName,
      price: Math.round(price * 100) / 100,
      barcode: clean(u.barcode, 40),
      description: clean(u.description, 500),
      categoryId: await categoryId(u.category),
      ventraId,
      source: "ventra",
      isAvailable: u.available === false || hiddenInGo ? false : (tempMissing ? false : (syncStock ? stock > 0 : true)),
      stockMode: syncStock ? "limited" : "unlimited",
      ...(syncStock ? { stockQuantity: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0 } : {}),
      hiddenByVentra: false,
      updatedAt: FieldValue.serverTimestamp(),
      ...(image ? { image } : {}),
      ...(existing ? {} : { optionsGroups: [], order: 0, createdAt: FieldValue.serverTimestamp(), image: image || prev.image || "" }),
    };
    batch.set(ref, data, { merge: true });
    pending++; written++;
    if (pending >= 400) await flush();
  }
  for (const id of deletes) {
    const d = byVentra.get(id);
    if (!d) continue;
    batch.update(d.ref, { isAvailable: false, hiddenByVentra: true, updatedAt: FieldValue.serverTimestamp() });
    pending++;
    if (pending >= 400) await flush();
  }
  await flush();

  // Publicación completa: lo de Ventra que ya no se publica se oculta
  let hidden = 0;
  if (Array.isArray(body.publishedIds)) {
    const keep = new Set(body.publishedIds.map(String));
    const snap = await productsRef.where("source", "==", "ventra").get();
    for (const d of snap.docs) {
      if (keep.has(String(d.data().ventraId)) || d.data().hiddenByVentra === true) continue;
      batch.update(d.ref, { isAvailable: false, hiddenByVentra: true, updatedAt: FieldValue.serverTimestamp() });
      pending++; hidden++;
      if (pending >= 400) await flush();
    }
    await flush();
  }
  await db.collection("ventra_stores").doc(comercioId).set({ lastCatalogAt: FieldValue.serverTimestamp() }, { merge: true });
  return { written, hidden, errors };
}

const ms = (t) => (t && t.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : Number(t) || 0));

/** Pedidos del comercio de los últimos días (la caja los guarda y arma estadísticas) */
/**
 * Pedidos del comercio para la caja. Para no releer todo en cada consulta, la caja manda
 * since (createdAt del último pedido que ya tiene: vienen solo los más nuevos) y openIds
 * (los que todavía no terminaron: se releen por id para ver cómo siguen). Sin since, los
 * últimos 4 días.
 */
async function orders(db, { comercioId }, body) {
  const since = Math.max(Number(body.since) || 0, Date.now() - ORDER_WINDOW_MS);
  const snap = await db.collection("orders")
    .where("comercioId", "==", comercioId)
    .where("createdAt", body.since ? ">" : ">=", Timestamp.fromMillis(since))
    .orderBy("createdAt", "desc")
    .limit(300)
    .get();
  const docs = new Map(snap.docs.map((d) => [d.id, d]));
  const openIds = (Array.isArray(body.openIds) ? body.openIds : []).map(String).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && !docs.has(id)).slice(0, 100);
  if (openIds.length) {
    const more = await db.getAll(...openIds.map((id) => db.collection("orders").doc(id)));
    // Solo pedidos de este comercio: un id ajeno no devuelve nada
    more.forEach((d) => { if (d.exists && d.data().comercioId === comercioId) docs.set(d.id, d); });
  }
  await db.collection("ventra_stores").doc(comercioId).set({ lastOrdersAt: FieldValue.serverTimestamp() }, { merge: true });
  return {
    serverTime: Date.now(),
    orders: [...docs.values()].map((d) => {
      const o = d.data();
      return {
        id: d.id,
        number: o.orderId || null,
        status: o.status,
        isShopper: o.isShopper === true,
        shopPending: o.shopPending === true,
        createdAt: ms(o.createdAt),
        acceptedAt: ms(o.acceptedAt) || null,
        pickedUpAt: ms(o.pickedUpAt) || null,
        completedAt: ms(o.completedAt) || ms(o.deliveredAt) || null,
        cancelledAt: ms(o.cancelledAt) || null,
        cancelReason: o.cancelReason || o.cancellationReason || null,
        // Solo el nombre de pila del cliente: la caja no necesita sus datos
        customer: String(o.userName || "Cliente").split(" ")[0],
        driverName: o.driverName || null,
        paymentMethod: o.paymentMethod || null,
        subtotal: Number(o.subtotal) || 0,
        estimatedSubtotal: Number(o.estimatedSubtotal ?? o.subtotal) || 0,
        total: Number(o.total) || 0,
        deliveryCost: Number(o.deliveryCost) || 0,
        items: (o.items || []).map((it) => ({
          ventraId: it.ventraId || null,
          barcode: it.barcode || null,
          name: it.name,
          qty: Number(it.qty) || 0,
          orderedQty: Number(it.orderedQty ?? it.qty) || 0,
          price: Number(it.price) || 0,
          shopStatus: it.shopStatus || null,
          replacement: it.replacement || null,
        })),
      };
    }),
  };
}

async function handle(db, storage, req, res, logger) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const body = req.body || {};
  try {
    if (body.action === "link") return res.status(200).json(await link(db, body));
    if (body.action === "panelLogin") return res.status(200).json(await panelLogin(db, body));
    const store = await storeOf(db, req.get("x-ventra-key") || body.key);
    switch (body.action) {
      case "status": return res.status(200).json({ store: storeSummary(store.comercioId, store.comercio) });
      case "catalog": return res.status(200).json(await catalog(db, storage, store, body));
      case "orders": return res.status(200).json(await orders(db, store, body));
      case "unlink": return res.status(200).json(await unlink(db, store));
      case "panelLink": return res.status(200).json(await panelLink(db, store));
      default: return res.status(400).json({ error: "Acción inválida" });
    }
  } catch (err) {
    if (err instanceof BridgeError) return res.status(err.status).json({ error: err.message });
    logger.error("[ventraBridge] error", err);
    return res.status(500).json({ error: "Error del puente con Ventra" });
  }
}

/**
 * El repartidor terminó de comprar: renglones encontrados, faltantes y reemplazos + total del
 * ticket. Solo el repartidor del pedido, una vez. Lo que faltó queda agotado 24 h en la app.
 */
async function shopperCheckout(db, uid, body) {
  const orderRef = db.collection("orders").doc(String(body.orderId || ""));
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new BridgeError(404, "Pedido no encontrado");
    const o = snap.data();
    if (o.isShopper !== true) throw new BridgeError(400, "Este pedido lo prepara el comercio");
    if (o.driverId !== uid) throw new BridgeError(403, "El pedido es de otro repartidor");
    if (o.shopPending === false) throw new BridgeError(409, "La compra ya se cargó");
    if (["cancelled", "completed", "delivered"].includes(o.status)) throw new BridgeError(409, "El pedido ya terminó");
    const { patch, missing, errors, allMissing } = applyShopping(o, body.results || {}, body.ticketTotal ?? null);
    if (errors.length) throw new BridgeError(400, errors[0]);
    if (allMissing) {
      tx.update(orderRef, {
        ...patch,
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: "driver_shopper",
        cancelReason: "No había ninguno de los productos en el local.",
        shoppedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.update(orderRef, { ...patch, shoppedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    return { order: o, missing, allMissing, patch };
  });

  // Faltantes: agotados por 24 h en la app (y el comercio lo ve en Ventra)
  const until = Timestamp.fromMillis(Date.now() + MISSING_HIDE_MS);
  const missingItems = out.missing.map((i) => out.order.items[i]).filter((it) => it && it.productId);
  if (missingItems.length) {
    const batch = db.batch();
    for (const it of missingItems) {
      batch.set(db.collection("comercios").doc(out.order.comercioId).collection("products").doc(it.productId), {
        isAvailable: false, unavailableUntil: until, unavailableReason: "shopper_missing", missingReports: FieldValue.increment(1),
      }, { merge: true });
    }
    await batch.commit();
  }
  // Aviso al cliente si cambió algo
  if (out.missing.length || out.patch.shopReplacedCount) {
    const n = out.order.orderId || "";
    const text = out.allMissing
      ? "No había ninguno de los productos: el pedido se canceló sin cargo."
      : `Faltaron ${out.missing.length} producto${out.missing.length === 1 ? "" : "s"}${out.patch.shopReplacedCount ? ` y se reemplazaron ${out.patch.shopReplacedCount}` : ""}. Total final: $${Math.round(out.patch.total)}.`;
    await db.collection("users").doc(out.order.userId).collection("notifications").add({
      title: out.allMissing ? `Pedido #${n} cancelado` : `Tu pedido #${n} cambió`,
      body: text, type: "order_update", status: "unread", url: `#/pedido/${orderRef.id}`, createdAt: new Date(),
    }).catch(() => {});
  }
  return { ok: true, total: out.patch.total, subtotal: out.patch.subtotal, missing: out.missing.length, cancelled: out.allMissing };
}

/** Vuelve a mostrar lo que se agotó por un faltante, una vez vencido el plazo */
async function restoreMissing(db) {
  const shops = await db.collection("comercios").where("fulfillmentMode", "==", "shopper").get();
  let restored = 0;
  const now = Date.now();
  for (const c of shops.docs) {
    const snap = await c.ref.collection("products").where("unavailableReason", "==", "shopper_missing").get();
    const batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      if (ms(d.data().unavailableUntil) > now) continue;
      batch.update(d.ref, { isAvailable: d.data().hiddenByVentra === true ? false : true, unavailableReason: FieldValue.delete(), unavailableUntil: FieldValue.delete() });
      n++;
    }
    if (n) { await batch.commit(); restored += n; }
  }
  return restored;
}

module.exports = { handle, shopperCheckout, restoreMissing, BridgeError, storeSummary, sha256 };
