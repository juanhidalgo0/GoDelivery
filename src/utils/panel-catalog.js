// Catálogo completo para el panel del comercio, sin volver a bajarlo cada vez.
//
// El panel (Productos, Métricas, Categorías, Modificar pedido, Ofertas) necesita todos los
// productos, pero Kiosco Paulos tiene casi 6.000: bajarlos en cada pantalla son miles de lecturas.
// Con catálogos grandes se baja entero una vez por dispositivo y después solo lo que cambió
// (updatedAt), tomando el resto de la copia local de Firestore. Un conteo (1 lectura cada 1.000)
// confirma que la copia local tiene los mismos productos que la base; si no coincide, o pasó
// más de un día, se baja todo de nuevo (el stock que cambian los pedidos no marca updatedAt).
import { db } from '../firebase.js';
import { collection, getDocs, getDocsFromCache, getCountFromServer, query, where, Timestamp } from 'firebase/firestore';

const BIG = 300;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const metaKey = (id) => `gd_panel_catalog_${id}`;

const readMeta = (id) => { try { return JSON.parse(localStorage.getItem(metaKey(id)) || 'null'); } catch { return null; } };
const writeMeta = (id, meta) => { try { localStorage.setItem(metaKey(id), JSON.stringify(meta)); } catch { /* sin espacio: la próxima baja todo */ } };

const toItem = (d) => ({ id: d.id, ...d.data() });
const millisOf = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);
const newest = (items) => items.reduce((m, p) => Math.max(m, millisOf(p.updatedAt)), 0);

async function loadAll(comercioId) {
  const snap = await getDocs(collection(db, 'comercios', comercioId, 'products'));
  const items = snap.docs.map(toItem);
  if (items.length >= BIG) writeMeta(comercioId, { at: Date.now(), mark: newest(items) });
  else try { localStorage.removeItem(metaKey(comercioId)); } catch { /* nada */ }
  return items;
}

/** Todos los productos del comercio, como objetos { id, ...datos }. */
export async function loadPanelCatalog(comercioId) {
  const col = collection(db, 'comercios', comercioId, 'products');
  const meta = readMeta(comercioId);
  if (!meta || Date.now() - meta.at > MAX_AGE_MS) return loadAll(comercioId);
  try {
    const cached = await getDocsFromCache(col);
    if (cached.size < BIG) return loadAll(comercioId);
    const [countSnap, changed] = await Promise.all([
      getCountFromServer(col),
      getDocs(query(col, where('updatedAt', '>=', Timestamp.fromMillis(meta.mark || 0)))),
    ]);
    const byId = new Map(cached.docs.map((d) => [d.id, toItem(d)]));
    changed.docs.forEach((d) => byId.set(d.id, toItem(d)));
    if (byId.size !== countSnap.data().count) return loadAll(comercioId);
    const items = [...byId.values()];
    writeMeta(comercioId, { at: meta.at, mark: Math.max(meta.mark || 0, newest(changed.docs.map(toItem))) });
    return items;
  } catch {
    return loadAll(comercioId);
  }
}
