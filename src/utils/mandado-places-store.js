// Lectura y aprendizaje de los lugares de los mandados (Firestore). La lógica está en mandado-places.js.
//
// - loadMandadoPlaces(): comercios adheridos + lugares aprendidos, con caché local de 6 h
//   (unas pocas decenas de documentos; no se leen en cada pantalla).
// - learnMandadoPlace(): cuando el repartidor termina de comprar en un comercio, se guarda dónde
//   estaba. Con varias visitas el punto se afina solo (ver clusterCenter).
import { db } from '../firebase.js';
import { collection, getDocs, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { withTimeout } from './firestore-cache.js';
import {
  setPlaces, getPlaces, upsertPlace, placeFromComercio, placeSlug, placeCategory, nearestCategoryOf,
  resolvePlaceByName, clusterCenter, inPlaceBounds, toLatLng,
} from './mandado-places.js';

const CACHE_KEY = 'go_mandado_places_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SAMPLES = 8;
let loading = null;
let loadedAt = 0;

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return c && Array.isArray(c.places) ? c : null;
  } catch { return null; }
}

function writeCache(list) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), places: list })); } catch { /* sin espacio: se vuelve a leer */ }
}

/** Carga el catálogo (si hace falta) y lo deja en mandado-places. Nunca rechaza. */
export function loadMandadoPlaces({ force = false } = {}) {
  if (!force && getPlaces().length && Date.now() - loadedAt < CACHE_TTL_MS) return Promise.resolve(getPlaces());
  if (!force) {
    const cached = readCache();
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      loadedAt = cached.at;
      setPlaces(cached.places);
      return Promise.resolve(getPlaces());
    }
  }
  if (loading) return loading;
  loading = (async () => {
    const [comSnap, learnedSnap] = await Promise.all([
      withTimeout(getDocs(collection(db, 'comercios')), 9000, 'mandado_places_comercios').catch(() => null),
      withTimeout(getDocs(collection(db, 'mandadoPlaces')), 9000, 'mandado_places').catch(() => null),
    ]);
    if (!comSnap && !learnedSnap) {
      const cached = readCache();
      if (cached) setPlaces(cached.places);
      return getPlaces();
    }
    const list = [];
    comSnap?.docs.forEach(d => {
      const c = d.data();
      if (c.isActive === false) return;
      const p = placeFromComercio({ id: d.id, ...c });
      if (p) list.push(p);
    });
    learnedSnap?.docs.forEach(d => {
      const x = d.data();
      if (x.hidden === true || !toLatLng(x)) return;
      list.push({ name: x.name, slug: d.id, lat: x.lat, lng: x.lng, category: x.category || placeCategory(x.name), address: x.address || '', source: 'aprendido', visits: x.visits || 0, verified: x.verified === true });
    });
    loadedAt = Date.now();
    writeCache(list);
    setPlaces(list);
    return getPlaces();
  })().catch(err => {
    console.warn('[mandado-places] no se pudo cargar:', err?.message || err);
    return getPlaces();
  }).finally(() => { loading = null; });
  return loading;
}

// Nombres que no identifican un comercio
const GENERIC_NAMES = /^(comercio|local|kiosco \/ comercio|kiosco|negocio|tienda|varios|m[uú]ltiples comercios.*)$/i;

/**
 * Guarda dónde está un comercio a partir de la ubicación del repartidor al terminar de comprar.
 * No hace nada con los comercios adheridos (ya tienen su dirección), con "el más cercano",
 * con GPS impreciso o fuera de la zona. Nunca rechaza: si falla, el mandado sigue igual.
 */
export async function learnMandadoPlace({ name, position, accuracy = null, uid = null }) {
  try {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const pos = toLatLng(position);
    if (!clean || clean.length < 3 || GENERIC_NAMES.test(clean) || nearestCategoryOf(clean)) return false;
    if (!pos || !inPlaceBounds(pos)) return false;
    if (typeof accuracy === 'number' && accuracy > 80) return false;
    const known = resolvePlaceByName(clean);
    if (known && known.source === 'comercio') return false;

    // Se suma al lugar que ya se conoce con ese nombre (aunque esté escrito distinto)
    const slug = known && known.source === 'aprendido' ? known.slug : placeSlug(clean);
    if (!slug) return false;
    const ref = doc(db, 'mandadoPlaces', slug);
    const saved = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists() ? snap.data() : null;
      const samples = [...(Array.isArray(prev?.samples) ? prev.samples : []), { lat: Math.round(pos.lat * 1e6) / 1e6, lng: Math.round(pos.lng * 1e6) / 1e6, at: Date.now() }].slice(-MAX_SAMPLES);
      const center = prev?.verified ? { lat: prev.lat, lng: prev.lng } : clusterCenter(samples);
      const data = {
        name: prev?.name || clean,
        slug,
        category: prev?.category || placeCategory(clean) || null,
        lat: center.lat,
        lng: center.lng,
        samples,
        visits: (Number(prev?.visits) || 0) + 1,
        verified: prev?.verified === true,
        lastDriverUid: uid,
        updatedAt: serverTimestamp(),
      };
      if (!prev) data.createdAt = serverTimestamp();
      tx.set(ref, data, { merge: true });
      return data;
    });
    upsertPlace({ name: saved.name, slug, lat: saved.lat, lng: saved.lng, category: saved.category, source: 'aprendido', visits: saved.visits, verified: saved.verified });
    writeCache(getPlaces());
    return true;
  } catch (err) {
    console.warn('[mandado-places] no se pudo guardar el lugar:', err?.message || err);
    return false;
  }
}

// ── Comercios ya hechos de cada mandado (en este teléfono) ─────────────────────
// Con varios comercios, el repartidor avisa "terminé acá" y la parada pasa al siguiente.
const VISITED_KEY = 'go_mandado_visited_v1';
const VISITED_TTL_MS = 24 * 60 * 60 * 1000;

function readVisited() {
  try {
    const all = JSON.parse(localStorage.getItem(VISITED_KEY) || '{}');
    return all && typeof all === 'object' ? all : {};
  } catch { return {}; }
}

export function getVisitedStores(orderId) {
  const e = orderId ? readVisited()[orderId] : null;
  return e && Array.isArray(e.done) ? e.done : [];
}

export function markStoreVisited(orderId, index) {
  if (!orderId || typeof index !== 'number') return;
  const all = readVisited();
  const now = Date.now();
  Object.keys(all).forEach(k => { if (!all[k] || now - (all[k].at || 0) > VISITED_TTL_MS) delete all[k]; });
  const done = new Set(all[orderId]?.done || []);
  done.add(index);
  all[orderId] = { done: [...done], at: now };
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(all)); } catch { /* sin espacio */ }
}
