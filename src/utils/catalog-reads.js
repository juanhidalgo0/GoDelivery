// Leer productos sin bajar catálogos enteros.
//
// Kiosco Paulos tiene casi 6.000 productos (los comercios de Ventra y los que arma el repartidor
// pueden tener miles): bajarlos para un buscador o una lista cuesta miles de lecturas por persona.
// Los catálogos chicos (restaurantes, decenas de productos) se siguen bajando enteros; en los
// grandes se pide a la base solo lo que coincide con la palabra buscada (searchKeys, como la tienda).
import { db } from '../firebase.js';
import { collection, query, where, limit, orderBy, documentId } from 'firebase/firestore';
import { getDocsOptimized } from './firestore-cache.js';
import { searchTokens } from './search-keys.js';

/** Catálogo grande: Ventra o "lo compra el repartidor" (los únicos que llegan a miles). */
export function isBigCatalog(comercio) {
  return !!comercio && (comercio.ventraLinked === true || comercio.fulfillmentMode === 'shopper');
}

/** Todos los productos de los comercios chicos (los grandes se saltean). */
export async function loadSmallCatalogs(comercios, cacheTag = 'small', ttlMs = 30 * 60 * 1000) {
  const small = comercios.filter((c) => !isBigCatalog(c));
  const lists = await Promise.all(small.map(async (c) => {
    const snap = await getDocsOptimized(collection(db, 'comercios', c.id, 'products'), `catalog_${cacheTag}_${c.id}`, ttlMs, 15000);
    return (snap.docs || []).map((d) => ({ id: d.id, comercioId: c.id, comercioName: c.name, ...d.data() }));
  }));
  return lists.flat();
}

/** La palabra más larga buscada, recortada como las searchKeys (de 2 a 10 letras). */
export function searchKeyOf(text) {
  const key = searchTokens(text).filter((t) => t.length >= 2).sort((a, b) => b.length - a.length)[0];
  return key ? key.slice(0, 10) : '';
}

/** Productos de los catálogos grandes que tienen la palabra buscada (hasta n por comercio). */
export async function searchBigCatalogs(comercios, text, n = 20) {
  const key = searchKeyOf(text);
  if (!key) return [];
  const big = comercios.filter(isBigCatalog);
  const lists = await Promise.all(big.map(async (c) => {
    const snap = await getDocsOptimized(
      query(collection(db, 'comercios', c.id, 'products'), where('searchKeys', 'array-contains', key), limit(n)),
      `catalog_search_${c.id}_${key}`, 5 * 60 * 1000);
    return (snap.docs || []).map((d) => ({ id: d.id, comercioId: c.id, comercioName: c.name, ...d.data() }));
  }));
  return lists.flat();
}

/** Los más vendidos de los catálogos grandes (para listas como "Destacados"). */
export async function topOfBigCatalogs(comercios, n = 24) {
  const big = comercios.filter(isBigCatalog);
  const lists = await Promise.all(big.map(async (c) => {
    const snap = await getDocsOptimized(
      query(collection(db, 'comercios', c.id, 'products'), orderBy('popularity', 'desc'), limit(n)),
      `catalog_top_${c.id}_${n}`, 30 * 60 * 1000);
    return (snap.docs || []).map((d) => ({ id: d.id, comercioId: c.id, comercioName: c.name, ...d.data() }));
  }));
  return lists.flat();
}

/** Productos puntuales de un comercio por id (de a 30, el máximo de "in"). */
export async function productsByIds(comercioId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const out = [];
  for (let i = 0; i < unique.length; i += 30) {
    const part = unique.slice(i, i + 30);
    const snap = await getDocsOptimized(
      query(collection(db, 'comercios', comercioId, 'products'), where(documentId(), 'in', part)),
      `catalog_ids_${comercioId}_${part.join(',').slice(0, 120)}`, 5 * 60 * 1000);
    (snap.docs || []).forEach((d) => out.push({ id: d.id, comercioId, ...d.data() }));
  }
  return out;
}
