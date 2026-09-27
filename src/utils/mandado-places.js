// Lugares de los mandados: dónde queda cada comercio que el cliente escribe a mano.
//
// El cliente escribe "Farmacia del Pueblo" sin dirección. Para que el repartidor tenga a dónde ir
// (mapa, orden inteligente de paradas, botón de navegar) se cruzan dos fuentes:
//   1. los comercios adheridos a GoDelivery (tienen coordenadas cargadas), y
//   2. los lugares aprendidos: cada vez que un repartidor termina de comprar, se guarda dónde
//      estaba (colección mandadoPlaces, ver mandado-places-store.js).
// Este módulo es lógica pura (sin Firebase) para poder probarla sola y usarla al dibujar.

/** Centro de Magdalena: los formularios lo mandan como "retiro" cuando no hay uno real. */
export const TOWN_CENTER = { lat: -35.0811, lng: -57.5146 };

/** Zona donde tiene sentido un lugar (Magdalena y alrededores). */
export const PLACE_BOUNDS = { minLat: -35.6, maxLat: -34.6, minLng: -58.1, maxLng: -57.0 };

// ── Nombres ──────────────────────────────────────────────────────────────────

/** "Farmacia “Pasteur”" → "farmacia pasteur" (sin tildes, comillas ni signos). */
export function normalizePlaceName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Id del documento en mandadoPlaces. */
export function placeSlug(name) {
  return normalizePlaceName(name).replace(/ /g, '-').slice(0, 80);
}

// Rubros que se reconocen en el nombre (para "el más cercano" y para agrupar)
const CATEGORY_RULES = [
  ['farmacia', /\bfarmac/, 'farmacia'],
  ['supermercado', /\b(super|supermercado|autoservicio|hipermercado)\b/, 'supermercado'],
  ['kiosco', /\b(maxi ?)?kiosco|\bdrugstore\b/, 'kiosco'],
  ['almacen', /\b(almacen|despensa)\b/, 'almacén'],
  ['verduleria', /\b(verduler|fruter)/, 'verdulería'],
  ['carniceria', /\bcarnicer/, 'carnicería'],
  ['polleria', /\bpoller/, 'pollería'],
  ['panaderia', /\b(panader|confiter)/, 'panadería'],
  ['fiambreria', /\bfiambrer/, 'fiambrería'],
  ['ferreteria', /\bferreter/, 'ferretería'],
  ['libreria', /\blibrer/, 'librería'],
  ['dietetica', /\bdietetic/, 'dietética'],
  ['veterinaria', /\b(veterinar|forrajer|pet ?shop)/, 'veterinaria'],
  ['rotiseria', /\brotiser/, 'rotisería'],
  ['heladeria', /\bhelader/, 'heladería'],
  ['bebidas', /\b(vinoteca|bebidas|distribuidora)\b/, 'vinoteca'],
  ['pagos', /\b(pago ?facil|rapipago|cobro ?express)\b/, 'Pago Fácil / Rapipago'],
];

export function placeCategory(name) {
  const n = normalizePlaceName(name);
  if (!n) return null;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(n)) return cat;
  return null;
}

export function categoryLabel(cat) {
  const rule = CATEGORY_RULES.find(r => r[0] === cat);
  return rule ? rule[2] : 'comercio';
}

/** Rubro de un comercio adherido (usa sus categorías si el nombre no lo dice). */
function comercioCategory(c) {
  const byName = placeCategory(c.name);
  if (byName) return byName;
  const cats = [].concat(c.categories || [], c.category || []).join(' ');
  return placeCategory(cats);
}

/** Texto que se guarda cuando el cliente elige "cualquiera, el más cercano". */
export function nearestLabel(cat) {
  return `Cualquier ${categoryLabel(cat)} (la más cercana)`;
}

/**
 * ¿El cliente pidió "cualquier farmacia", "la farmacia más cercana"...? Devuelve el rubro o null.
 * Solo cuenta si el nombre no dice cuál (un nombre propio gana).
 */
export function nearestCategoryOf(name) {
  const n = normalizePlaceName(name);
  if (!n) return null;
  const cat = placeCategory(n);
  if (!cat) return null;
  if (/\b(cualquier|cualquiera|la mas cercana|el mas cercano|mas cercan[ao]|cercan[ao]|la que (este|haya) abierta|abierta|de turno)\b/.test(n)) return cat;
  // Solo el rubro ("farmacia", "un kiosco"): no hay un comercio concreto, sirve el más cercano
  const rest = n.replace(/\b(un|una|el|la|de|del|algun|alguna)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const rule = CATEGORY_RULES.find(r => r[0] === cat);
  return rule && rest.split(' ').every(w => rule[1].test(w)) ? cat : null;
}

// ── Coordenadas ──────────────────────────────────────────────────────────────

export function toLatLng(c) {
  if (!c) return null;
  if (Array.isArray(c) && c.length >= 2) {
    const lng = Number(c[0]), lat = Number(c[1]);
    return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
  }
  const lat = Number(c.lat ?? c.latitude), lng = Number(c.lng ?? c.longitude);
  return isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

/** km por calle (línea recta × 1,3). */
export function placeKm(a, b) {
  const p = toLatLng(a), q = toLatLng(b);
  if (!p || !q) return null;
  const R = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(q.lat - p.lat), dLng = toRad(q.lng - p.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(p.lat)) * Math.cos(toRad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.3;
}

function metersBetween(a, b) {
  return (placeKm(a, b) / 1.3) * 1000;
}

/** El "retiro" que mandan los formularios cuando no hay uno real (centro del pueblo). */
export function isPlaceholderCoords(c) {
  const p = toLatLng(c);
  return Boolean(p) && Math.abs(p.lat - TOWN_CENTER.lat) < 0.00005 && Math.abs(p.lng - TOWN_CENTER.lng) < 0.00005;
}

export function inPlaceBounds(c) {
  const p = toLatLng(c);
  return Boolean(p) && p.lat >= PLACE_BOUNDS.minLat && p.lat <= PLACE_BOUNDS.maxLat && p.lng >= PLACE_BOUNDS.minLng && p.lng <= PLACE_BOUNDS.maxLng;
}

/**
 * Ubicación a partir de las visitas de los repartidores: se toma el grupo más grande de
 * visitas a menos de 120 m entre sí y se promedia (una visita mal marcada no mueve el punto).
 */
export function clusterCenter(samples = []) {
  const pts = samples.map(toLatLng).filter(Boolean);
  if (!pts.length) return null;
  let best = null;
  pts.forEach((p, i) => {
    const group = pts.filter(q => metersBetween(p, q) <= 120);
    if (!best || group.length > best.length || (group.length === best.length && i > best.idx)) best = Object.assign(group, { idx: i });
  });
  const lat = best.reduce((s, p) => s + p.lat, 0) / best.length;
  const lng = best.reduce((s, p) => s + p.lng, 0) / best.length;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, support: best.length };
}

/**
 * Qué tan confiable es un lugar aprendido:
 * - conflict: las visitas no coinciden (ningún grupo tiene mayoría) → "a revisar", la app no lo usa;
 * - trusted: confirmado por el admin o al menos dos visitas que coinciden;
 * - si no, es "aproximado" (una sola visita): se usa para el repartidor pero no se sugiere al cliente.
 */
export function placeConfidence(samples = [], verified = false) {
  const n = Array.isArray(samples) ? samples.filter(s => toLatLng(s)).length : 0;
  if (verified) return { support: n, conflict: false, trusted: true };
  const c = clusterCenter(samples);
  const support = c ? c.support : 0;
  const conflict = n >= 2 && support * 2 <= n;
  return { support, conflict, trusted: !conflict && support >= 2 };
}

// ── Catálogo en memoria (lo llena mandado-places-store.js) ─────────────────────

let places = [];
const listeners = new Set();

/** Reemplaza el catálogo: [{ name, slug, lat, lng, category, source: 'comercio'|'aprendido', ... }] */
export function setPlaces(list) {
  places = Array.isArray(list) ? list.filter(p => p && toLatLng(p)) : [];
  listeners.forEach(fn => { try { fn(places); } catch (e) { /* un oyente roto no frena a los demás */ } });
}

export function getPlaces() {
  return places;
}

/** Agrega o actualiza un lugar sin esperar a recargar todo (después de aprender uno). */
export function upsertPlace(p) {
  if (!p || !p.slug || !toLatLng(p)) return;
  const i = places.findIndex(x => x.slug === p.slug && x.source === p.source);
  const next = places.slice();
  if (i >= 0) next[i] = { ...next[i], ...p }; else next.push(p);
  setPlaces(next);
}

export function onPlacesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Pasa un comercio adherido al formato de lugar. */
export function placeFromComercio(c) {
  const ll = toLatLng(c.coords || c.coordinates || c.location);
  if (!ll || !c.name) return null;
  return { name: c.name, slug: placeSlug(c.name), lat: ll.lat, lng: ll.lng, category: comercioCategory(c), address: c.address || '', source: 'comercio', comercioId: c.id || null, verified: true, trusted: true };
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────

const rankOf = (p) => (p.source === 'comercio' ? 1000 : 0) + (p.verified ? 500 : 0) + (p.trusted ? 200 : 0) + (Number(p.visits) || 0);
const isTrusted = (p) => p.source === 'comercio' || p.trusted === true;

/**
 * El lugar al que se refiere un nombre escrito a mano, o null si no hay uno claro.
 * Coincide si el nombre es el mismo, o si uno contiene al otro y lo que sobra no es solo el rubro
 * ("Pasteur" ↔ "Farmacia Pasteur" sí; "Farmacia" ↔ "Farmacia Pasteur" no).
 */
export function resolvePlaceByName(name, list = places) {
  const n = normalizePlaceName(name);
  if (n.length < 3 || nearestCategoryOf(name)) return null;
  const exact = list.filter(p => normalizePlaceName(p.name) === n);
  if (exact.length) return exact.sort((a, b) => rankOf(b) - rankOf(a))[0];

  const core = (s) => s.split(' ').filter(w => !CATEGORY_RULES.some(r => r[1].test(w)) && !/^(el|la|los|las|de|del)$/.test(w)).join(' ');
  const nCore = core(n);
  if (nCore.length < 4) return null;
  const matches = list.filter(p => {
    const pCore = core(normalizePlaceName(p.name));
    if (pCore.length < 4) return false;
    return pCore === nCore || (` ${pCore} `).includes(` ${nCore} `) || (` ${nCore} `).includes(` ${pCore} `);
  });
  if (!matches.length) return null;
  matches.sort((a, b) => rankOf(b) - rankOf(a));
  // Si hay varios lugares distintos con ese nombre (dos sucursales), no se adivina
  const far = matches.some(p => metersBetween(p, matches[0]) > 250);
  return far ? null : matches[0];
}

/**
 * El comercio del rubro que menos desvía: repartidor → comercio → cliente.
 * Sin repartidor, el más cercano al cliente.
 */
export function nearestPlace(category, from, to, list = places) {
  // Solo lugares seguros: mandar al repartidor a un punto dudoso es peor que dejarlo elegir
  const pool = list.filter(p => p.category === category && isTrusted(p));
  if (!pool.length) return null;
  let best = null, bestKm = Infinity;
  for (const p of pool) {
    const km = (from ? (placeKm(from, p) ?? 0) : 0) + (to ? (placeKm(p, to) ?? 0) : 0);
    if (km < bestKm) { best = p; bestKm = km; }
  }
  return best;
}

/** Sugerencias mientras el cliente escribe el comercio (comercios adheridos primero). */
export function suggestPlaces(text, list = places, max = 5) {
  const q = normalizePlaceName(text);
  if (q.length < 2) return [];
  const seen = new Set();
  const scored = [];
  for (const p of list) {
    if (!isTrusted(p)) continue; // al cliente solo se le sugieren lugares seguros
    const n = normalizePlaceName(p.name);
    const key = `${n}|${Math.round(p.lat * 1000)}|${Math.round(p.lng * 1000)}`;
    if (seen.has(key)) continue;
    let score = -1;
    if (n.startsWith(q)) score = 3;
    else if (n.split(' ').some(w => w.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 1;
    if (score < 0) continue;
    seen.add(key);
    scored.push({ p, score: score * 10000 + rankOf(p) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.p);
}

// ── Paradas de un mandado ────────────────────────────────────────────────────

function cleanStoreName(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/^[\s·:\-–]+|[\s·:\-–]+$/g, '').trim();
}

/**
 * Los comercios de un mandado, en el orden en que los cargó el cliente:
 * [{ index, store, items, coords?, nearest? }]
 * Lee el campo nuevo mandadoStops; si no está, lo que cargó el repartidor (stopsPurchases) o el texto.
 */
export function mandadoStoresOf(order = {}) {
  if (Array.isArray(order.mandadoStops) && order.mandadoStops.length) {
    return order.mandadoStops.map((s, index) => ({
      index,
      store: cleanStoreName(s.store || s.name) || 'Comercio',
      items: String(s.items || '').trim(),
      coords: toLatLng(s.coords || s),
      nearest: s.nearest || nearestCategoryOf(s.store || s.name),
    }));
  }
  const raw = String(order.details || order.description || order.itemsText || order.notes || '').replace(/\*\*/g, '').replace(/\r/g, '');
  const stores = [];
  // Formato de la app: "🏪 1. Comercio: X\n📦 Pedido: Y\n\n🏪 2. Comercio: Z ..."
  const re = /(?:🏪\s*)?(\d+)\.\s*Comercio\s*:\s*/gi;
  const marks = [];
  let m;
  while ((m = re.exec(raw)) !== null) marks.push({ at: m.index, end: re.lastIndex });
  marks.forEach((mk, i) => {
    let seg = raw.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : raw.length);
    seg = seg.split('🔄')[0];
    const pm = seg.match(/(?:📦\s*)?(?:\d+\.\s*)?(?:Pedido|Detalle|Compra)\s*:\s*([\s\S]*)$/i);
    const store = cleanStoreName((pm ? seg.slice(0, pm.index) : seg.split('\n')[0]).replace(/📦.*$/s, ''));
    const items = pm ? pm[1].replace(/\s+/g, ' ').trim() : '';
    if (store) stores.push({ index: stores.length, store, items, coords: null, nearest: nearestCategoryOf(store) });
  });
  if (!stores.length && Array.isArray(order.stopsPurchases) && order.stopsPurchases.length) {
    order.stopsPurchases.forEach((sp, index) => stores.push({ index, store: cleanStoreName(sp.store) || 'Comercio', items: sp.items || '', coords: null, nearest: nearestCategoryOf(sp.store) }));
  }
  if (!stores.length) {
    // Texto libre: "Comercio: X · Pedido: Y" o solo el nombre
    const one = raw.replace(/\s+/g, ' ').match(/(?:Comercio|Lugar|Local)\s*:\s*(.+?)(?:\s*📦|\s*(?:Pedido|Detalle|Compra)\s*:|$)/i);
    const name = cleanStoreName(one ? one[1] : (order.storeName || order.comercioName || String(order.pickupAddress || '').replace(/^Comercio:\s*/i, '')));
    const itemsM = raw.replace(/\s+/g, ' ').match(/(?:Pedido|Detalle|Compra)\s*:\s*(.+)$/i);
    if (name && !/^m[uú]ltiples comercios/i.test(name)) stores.push({ index: 0, store: name, items: itemsM ? itemsM[1].trim() : '', coords: null, nearest: nearestCategoryOf(name) });
  }
  return stores;
}

/**
 * Dónde queda cada comercio del mandado: primero lo que trae el pedido, después un lugar conocido
 * con ese nombre y, si el cliente pidió "el más cercano", el del rubro que menos desvía.
 * Agrega { coords, placeName, resolvedBy: 'pedido'|'comercio'|'aprendido'|'cercano'|null }.
 */
export function resolveMandadoStores(order, driverPos = null, list = places) {
  const dest = toLatLng(order.deliveryCoords || order.destinationCoords || order.addressCoords);
  return mandadoStoresOf(order).map(s => {
    if (s.coords && inPlaceBounds(s.coords) && !isPlaceholderCoords(s.coords)) return { ...s, placeName: s.store, resolvedBy: 'pedido' };
    if (s.nearest) {
      const p = nearestPlace(s.nearest, toLatLng(driverPos), dest, list);
      return p ? { ...s, coords: toLatLng(p), placeName: p.name, placeAddress: p.address || '', resolvedBy: 'cercano' } : { ...s, coords: null, placeName: null, resolvedBy: null };
    }
    const p = resolvePlaceByName(s.store, list);
    return p ? { ...s, coords: toLatLng(p), placeName: p.name, placeAddress: p.address || '', resolvedBy: p.source, approx: !isTrusted(p) } : { ...s, coords: null, placeName: null, resolvedBy: null };
  });
}

/**
 * Plan de compra: qué comercios faltan y cuál toca ahora. Con todos ubicados (hasta 5) se elige
 * el orden que menos recorre, terminando cerca del cliente; si falta alguno, el orden del cliente.
 * visited: índices de los comercios ya hechos.
 */
export function mandadoShoppingPlan(order, driverPos = null, visited = [], list = places) {
  const stores = resolveMandadoStores(order, driverPos, list);
  const done = new Set(visited);
  let pending = stores.filter(s => !done.has(s.index));
  const start = toLatLng(driverPos);
  const dest = toLatLng(order.deliveryCoords || order.destinationCoords || order.addressCoords);
  if (start && pending.length > 1 && pending.length <= 5 && pending.every(s => s.coords)) {
    let best = null, bestKm = Infinity;
    const permute = (rest, seq, pos, km) => {
      if (km >= bestKm) return;
      if (!rest.length) {
        const total = km + (dest ? placeKm(pos, dest) : 0);
        if (total < bestKm) { bestKm = total; best = seq; }
        return;
      }
      rest.forEach((s, i) => permute(rest.filter((_, j) => j !== i), [...seq, s], s.coords, km + placeKm(pos, s.coords)));
    };
    permute(pending, [], start, 0);
    if (best) pending = best;
  }
  // Si ya se hicieron todos, la parada sigue siendo el último (falta deslizar "ya compré")
  const current = pending[0] || stores[stores.length - 1] || null;
  return { stores, pending, current, total: stores.length, doneCount: stores.length - pending.length };
}

/** Texto para buscar el comercio en Google Maps cuando no se sabe dónde queda. */
export function placeSearchQuery(store) {
  const cat = store && store.nearest;
  if (cat) return `${categoryLabel(cat)} cerca, Magdalena, Buenos Aires`;
  return `${(store && (store.placeName || store.store)) || 'comercio'}, Magdalena, Buenos Aires`;
}
