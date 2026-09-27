// SOLO DESARROLLO: Firestore en memoria para las vistas previas (vite.preview.config.js).
// Implementa lo que usa la app: doc/collection/query, lecturas, escrituras y onSnapshot en vivo.
// Nada sale de la PC.

const store = (window.__mockDb = window.__mockDb || new Map()); // path -> data
const docSubs = new Map();   // path -> Set(cb)
const querySubs = new Set(); // { q, cb }

const now = () => Date.now();
export class Timestamp {
  constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  static now() { return new Timestamp(now()); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(ms); }
}

const SENTINEL = Symbol('sentinel');
export const serverTimestamp = () => ({ [SENTINEL]: 'ts' });
export const increment = (n) => ({ [SENTINEL]: 'inc', n });
export const arrayUnion = (...v) => ({ [SENTINEL]: 'union', v });
export const arrayRemove = (...v) => ({ [SENTINEL]: 'remove', v });
export const deleteField = () => ({ [SENTINEL]: 'delete' });

function resolve(prev, val) {
  if (val && typeof val === 'object' && val[SENTINEL]) {
    switch (val[SENTINEL]) {
      case 'ts': return Timestamp.now();
      case 'inc': return (Number(prev) || 0) + val.n;
      case 'union': return [...new Set([...(prev || []), ...val.v])];
      case 'remove': return (prev || []).filter(x => !val.v.includes(x));
      case 'delete': return undefined;
    }
  }
  if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Timestamp) && !(val instanceof Date)) {
    const out = { ...(prev && typeof prev === 'object' ? prev : {}) };
    for (const [k, v] of Object.entries(val)) { const r = resolve(out[k], v); if (r === undefined) delete out[k]; else out[k] = r; }
    return out;
  }
  return val;
}

const join = (parts) => parts.filter(Boolean).join('/');
const newId = () => Math.random().toString(36).slice(2, 12);

// ── Referencias ──
export function getFirestore() { return { type: 'mock-db' }; }
export function initializeFirestore() { return { type: 'mock-db' }; }
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const clearIndexedDbPersistence = async () => {};
export const connectFirestoreEmulator = () => {};

export function doc(base, ...segs) {
  let path;
  if (base && base.type === 'collection') path = join([base.path, ...(segs.length ? segs : [newId()])]);
  else path = join(segs);
  const parts = path.split('/');
  return { type: 'doc', path, id: parts[parts.length - 1], parent: { type: 'collection', path: parts.slice(0, -1).join('/') } };
}
export function collection(base, ...segs) {
  const path = base && base.path ? join([base.path, ...segs]) : join(segs);
  return { type: 'collection', path, id: path.split('/').pop() };
}
export function collectionGroup(_db, id) { return { type: 'group', id }; }
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export const startAfter = () => ({ kind: 'noop' });
export const or = (...filters) => ({ kind: 'or', filters });
export function query(ref, ...cons) { return { type: 'query', ref, cons }; }

// ── Lecturas ──
const get = (obj, field) => field.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const cmp = (a, b) => { const x = a?.toMillis ? a.toMillis() : a, y = b?.toMillis ? b.toMillis() : b; return x < y ? -1 : x > y ? 1 : 0; };
function matches(data, f) {
  if (f.kind === 'or') return f.filters.some(g => matches(data, g));
  if (f.kind !== 'where') return true;
  const v = get(data, f.field);
  switch (f.op) {
    case '==': return v === f.value;
    case '!=': return v !== f.value;
    case 'in': return f.value.includes(v);
    case 'not-in': return !f.value.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(f.value);
    case 'array-contains-any': return Array.isArray(v) && v.some(x => f.value.includes(x));
    case '>': return cmp(v, f.value) > 0;
    case '>=': return cmp(v, f.value) >= 0;
    case '<': return cmp(v, f.value) < 0;
    case '<=': return cmp(v, f.value) <= 0;
    default: return true;
  }
}

function snapOf(path) {
  const data = store.get(path);
  const parts = path.split('/');
  return { id: parts[parts.length - 1], ref: doc(null, path), exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredCloneSafe(data)), get: (f) => get(data, f), metadata: { hasPendingWrites: false, fromCache: false } };
}
function structuredCloneSafe(d) { return d; }

function runQuery(q) {
  const ref = q.type === 'query' ? q.ref : q;
  const cons = q.type === 'query' ? q.cons : [];
  let paths = [...store.keys()].filter(p => {
    const parts = p.split('/');
    if (ref.type === 'group') return parts.length >= 2 && parts[parts.length - 2] === ref.id;
    return parts.slice(0, -1).join('/') === ref.path;
  });
  paths = paths.filter(p => cons.every(c => matches(store.get(p), c)));
  const ob = cons.find(c => c.kind === 'orderBy');
  if (ob) paths.sort((a, b) => cmp(get(store.get(a), ob.field), get(store.get(b), ob.field)) * (ob.dir === 'desc' ? -1 : 1));
  const lim = cons.find(c => c.kind === 'limit');
  if (lim) paths = paths.slice(0, lim.n);
  const docs = paths.map(snapOf);
  return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn), docChanges: () => docs.map(d => ({ type: 'added', doc: d })), metadata: { hasPendingWrites: false, fromCache: false } };
}

export async function getDoc(ref) { return snapOf(ref.path); }
export const getDocFromServer = getDoc;
export const getDocFromCache = getDoc;
export async function getDocs(q) { return runQuery(q); }
export const getDocsFromServer = getDocs;
export const getDocsFromCache = getDocs;
export async function getCountFromServer(q) { const r = runQuery(q); return { data: () => ({ count: r.size }) }; }

// ── Escrituras ──
function notify(path) {
  (docSubs.get(path) || new Set()).forEach(cb => { try { cb(snapOf(path)); } catch (e) { console.error(e); } });
  querySubs.forEach(({ q, cb }) => { try { cb(runQuery(q)); } catch (e) { console.error(e); } });
}
function write(path, data, merge) {
  const prev = merge ? store.get(path) : undefined;
  store.set(path, resolve(prev, data));
  setTimeout(() => notify(path), 0);
}
export async function setDoc(ref, data, opts = {}) { write(ref.path, data, opts.merge === true); }
export async function updateDoc(ref, data) {
  const flat = {};
  for (const [k, v] of Object.entries(data)) {
    const keys = k.split('.');
    let o = flat;
    keys.forEach((kk, i) => { if (i === keys.length - 1) o[kk] = v; else o = (o[kk] = o[kk] || {}); });
  }
  write(ref.path, flat, true);
}
export async function addDoc(colRef, data) { const ref = doc(colRef); write(ref.path, data, false); return ref; }
export async function deleteDoc(ref) { store.delete(ref.path); setTimeout(() => notify(ref.path), 0); }
export function writeBatch() {
  const ops = [];
  return {
    set: (r, d, o) => ops.push(() => setDoc(r, d, o)),
    update: (r, d) => ops.push(() => updateDoc(r, d)),
    delete: (r) => ops.push(() => deleteDoc(r)),
    commit: async () => { for (const op of ops) await op(); },
  };
}
export async function runTransaction(_db, fn) {
  const tx = {
    get: (r) => getDoc(r),
    set: (r, d, o) => { setDoc(r, d, o); return tx; },
    update: (r, d) => { updateDoc(r, d); return tx; },
    delete: (r) => { deleteDoc(r); return tx; },
  };
  return fn(tx);
}

// ── En vivo ──
export function onSnapshot(ref, a, b) {
  const cb = typeof a === 'function' ? a : (a && a.next) || (() => {});
  void b;
  if (ref.type === 'doc') {
    if (!docSubs.has(ref.path)) docSubs.set(ref.path, new Set());
    docSubs.get(ref.path).add(cb);
    setTimeout(() => cb(snapOf(ref.path)), 0);
    return () => docSubs.get(ref.path)?.delete(cb);
  }
  const sub = { q: ref, cb };
  querySubs.add(sub);
  setTimeout(() => cb(runQuery(ref)), 0);
  return () => querySubs.delete(sub);
}

// Para las vistas previas: escribir directo
export const mockDb = {
  set: (path, data) => write(path, data, false),
  merge: (path, data) => write(path, data, true),
  get: (path) => store.get(path),
};
