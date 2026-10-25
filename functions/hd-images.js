// Fotos grandes para la tienda de GO. Las fotos que manda la caja de Ventra son de 300 px (así no pesa
// la base del kiosco) y en la tienda se veían borrosas. Por código de barras exacto, los supermercados
// online (VTEX) tienen la foto oficial del producto y la sirven del tamaño que se pida: se baja a
// 800 x 800 una sola vez y se guarda en el Storage de GO (imageHd). Gratis y sin IA: las mismas fuentes
// que usa la caja para buscar fotos (apps/backend/.../sync-image.service.ts).
const crypto = require("crypto");

const VTEX_HOSTS = [
  "https://www.carrefour.com.ar", "https://www.jumbo.com.ar", "https://www.disco.com.ar",
  "https://www.veasupermercados.com.ar", "https://diaonline.supermercadosdia.com.ar",
  "https://www.masonline.com.ar", "https://www.farmacity.com",
];
const SIZE = 800;
// Imágenes de "sin foto" que algunos supermercados devuelven en vez de la del producto (md5 en base64)
const PLACEHOLDERS = new Set(["II2I+lU6vOq2ZewYyBjAsg=="]);

/** Código de barras de un producto de verdad (EAN-8, UPC-12, EAN-13, GTIN-14) */
const isEan = (code) => /^\d{8}$|^\d{12,14}$/.test(String(code || ""));

async function getJson(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

/** La foto del ítem con ese código exacto en un supermercado VTEX, ya pedida a 800 x 800 */
async function vtexImage(host, barcode) {
  const data = await getJson(`${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`);
  const product = Array.isArray(data) ? data[0] : null;
  if (!product) return null;
  const item = (product.items || []).find((i) => String(i.ean || "") === barcode);
  const url = item?.images?.[0]?.imageUrl;
  if (!url) return null;
  // .../arquivos/ids/395541/foto.jpg → .../arquivos/ids/395541-800-800/foto.jpg
  return url.replace(/\/ids\/(\d+)(-\d+-\d+)?\//, `/ids/$1-${SIZE}-${SIZE}/`);
}

/** Las fotos grandes que hay para ese código, en orden de supermercado (se usa la primera que sirva) */
async function* hdCandidates(barcode) {
  if (!isEan(barcode)) return;
  for (const host of VTEX_HOSTS) {
    const url = await vtexImage(host, barcode);
    if (url) yield { url, source: new URL(host).hostname.replace(/^www\./, "") };
  }
}

/** La primera foto grande encontrada (sin bajarla). null si ninguna */
async function findHdImage(barcode) {
  for await (const c of hdCandidates(barcode)) return c;
  return null;
}

/** Baja la foto y la guarda en el Storage de GO. Devuelve la URL pública o null si no sirve */
async function storeHdImage(bucket, comercioId, productId, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let buf, type;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    type = (r.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) { return null; } finally { clearTimeout(t); }
  // Menos de 8 KB a 800 px es una imagen vacía; y la genérica de "sin foto" tampoco sirve
  if (buf.length < 8000 || buf.length > 3_000_000) return null;
  if (PLACEHOLDERS.has(crypto.createHash("md5").update(buf).digest("base64"))) return null;
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `comercios/${comercioId}/hd/${String(productId).replace(/[^\w-]/g, "")}.${ext}`;
  const token = crypto.randomUUID();
  await bucket.file(path).save(buf, { metadata: { contentType: type, cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } } });
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : "https://firebasestorage.googleapis.com";
  return `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/**
 * Para un producto: si tiene código de barras, busca y guarda la foto grande. Si un supermercado tiene
 * la foto genérica, prueba el siguiente. Devuelve los campos a guardar (imageHd o solo que se probó).
 */
async function hdFieldsFor(bucket, comercioId, productId, product) {
  const tried = { imageHdTriedAt: Date.now() };
  for await (const c of hdCandidates(product.barcode)) {
    const stored = await storeHdImage(bucket, comercioId, productId, c.url);
    if (stored) return { ...tried, imageHd: stored, imageHdSource: c.source };
  }
  return tried;
}

module.exports = { isEan, findHdImage, storeHdImage, hdFieldsFor, PLACEHOLDERS };
