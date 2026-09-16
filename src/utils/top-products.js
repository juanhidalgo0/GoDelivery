// GoDelivery — Ranking mensual de productos más vendidos.
//
// El ranking vive en `settings/topProducts` (lectura pública, escritura sólo admin)
// y se calcula a partir de los pedidos ENTREGADOS del mes calendario en hora
// argentina. Los pedidos anteriores al 15-09-2026 no guardaban `productId` en sus
// items, así que en esos casos se matchea por nombre dentro del mismo comercio.

import { db } from '../firebase.js';
import {
  collection, doc, getDoc, getDocs, query, where, limit, setDoc, Timestamp,
} from 'firebase/firestore';

export const TOP_PRODUCTS_DOC = ['settings', 'topProducts'];

const DELIVERED_STATUSES = ['completed', 'delivered', 'entregado'];
const TOP_SIZE = 12;
// Con menos productos distintos vendidos, el mes todavía no es representativo
// y se usa el ranking del mes anterior.
export const MIN_PRODUCTS_FOR_RANKING = 4;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // como mucho, una vez por hora

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// "YYYY-MM" del momento dado, en hora de Buenos Aires.
export function monthKey(date = new Date()) {
  return date.toLocaleDateString('fr-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
}

export function previousMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function monthName(key) {
  return MONTH_NAMES[Number(key.split('-')[1]) - 1] || '';
}

// Inicio y fin del mes en UTC. Argentina es UTC-3 todo el año (sin horario de verano).
function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 3, 0, 0));
  return { start, end };
}

const normalizeName = (name) => String(name || '').trim().toLowerCase();

// Agrupa las unidades vendidas por producto. Función pura: se puede probar sin Firestore.
export function aggregateSales(orders) {
  const byKey = new Map();
  for (const order of orders) {
    if (!DELIVERED_STATUSES.includes(order.status)) continue;
    if (order.isFavor || order.isTrip) continue;
    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      const comercioId = item.comercioId || order.comercioId;
      if (!comercioId) continue;
      const name = String(item.name || '').trim();
      const key = item.productId
        ? `${comercioId}::id::${item.productId}`
        : `${comercioId}::name::${normalizeName(name)}`;
      if (!item.productId && !name) continue;
      const qty = Number(item.qty || item.quantity || 1) || 1;
      const entry = byKey.get(key) || { comercioId, productId: item.productId || null, name, qty: 0 };
      entry.qty += qty;
      if (!entry.name && name) entry.name = name;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

// Une las entradas que resultaron ser el mismo producto (una con id, otra por nombre).
function mergeByProductId(entries) {
  const merged = new Map();
  for (const e of entries) {
    if (!e.productId) continue;
    const key = `${e.comercioId}::${e.productId}`;
    const prev = merged.get(key);
    if (prev) prev.qty += e.qty;
    else merged.set(key, { ...e });
  }
  return [...merged.values()].sort((a, b) => b.qty - a.qty);
}

async function fetchDeliveredOrdersOfMonth(key) {
  const { start, end } = monthRange(key);
  // Sólo filtro por fecha (índice de campo simple, siempre disponible);
  // el estado se filtra en memoria para no depender de un índice compuesto.
  const snap = await getDocs(query(
    collection(db, 'orders'),
    where('createdAt', '>=', Timestamp.fromDate(start)),
    where('createdAt', '<', Timestamp.fromDate(end)),
  ));
  return snap.docs.map(d => d.data());
}

// Resuelve el productId de las ventas que sólo tienen nombre.
async function resolveProductIds(entries) {
  const nameCache = new Map();
  for (const e of entries) {
    if (e.productId || !e.name) continue;
    const cacheKey = `${e.comercioId}::${normalizeName(e.name)}`;
    if (!nameCache.has(cacheKey)) {
      let resolved = null;
      try {
        const snap = await getDocs(query(
          collection(db, 'comercios', e.comercioId, 'products'),
          where('name', '==', e.name),
          limit(1),
        ));
        if (!snap.empty) resolved = snap.docs[0].id;
      } catch (err) {
        resolved = null;
      }
      nameCache.set(cacheKey, resolved);
    }
    e.productId = nameCache.get(cacheKey);
  }
  return entries;
}

async function rankMonth(key) {
  const orders = await fetchDeliveredOrdersOfMonth(key);
  const entries = await resolveProductIds(aggregateSales(orders));
  const ranked = mergeByProductId(entries);
  const deliveredOrders = orders.filter(o => DELIVERED_STATUSES.includes(o.status) && !o.isFavor && !o.isTrip).length;
  return { ranked, deliveredOrders };
}

// Recalcula el ranking y lo guarda. Requiere permisos de admin.
export async function recomputeTopProducts() {
  const current = monthKey();
  let month = current;
  let { ranked, deliveredOrders } = await rankMonth(current);

  if (ranked.length < MIN_PRODUCTS_FOR_RANKING) {
    const prev = previousMonthKey(current);
    const prevResult = await rankMonth(prev);
    if (prevResult.ranked.length > ranked.length) {
      month = prev;
      ranked = prevResult.ranked;
      deliveredOrders = prevResult.deliveredOrders;
    }
  }

  const data = {
    month,
    computedForMonth: current,
    updatedAt: new Date().toISOString(),
    deliveredOrders,
    items: ranked.slice(0, TOP_SIZE).map(({ comercioId, productId, name, qty }) => ({
      comercioId, productId, name, qty,
    })),
  };
  await setDoc(doc(db, ...TOP_PRODUCTS_DOC), data);
  return data;
}

export async function readTopProducts() {
  const snap = await getDoc(doc(db, ...TOP_PRODUCTS_DOC));
  return snap.exists() ? snap.data() : null;
}

// ¿Hay que recalcular? Si nunca se calculó, si cambió el mes o si pasó más de una hora.
export function isTopProductsStale(data, now = new Date()) {
  if (!data || !data.updatedAt) return true;
  if (data.computedForMonth !== monthKey(now)) return true;
  return now.getTime() - new Date(data.updatedAt).getTime() > REFRESH_INTERVAL_MS;
}

// ¿El ranking guardado sirve para mostrarlo hoy? Sólo el del mes actual o el anterior.
export function isTopProductsUsable(data, now = new Date()) {
  if (!data || !Array.isArray(data.items) || data.items.length < MIN_PRODUCTS_FOR_RANKING) return false;
  const current = monthKey(now);
  return data.month === current || data.month === previousMonthKey(current);
}
