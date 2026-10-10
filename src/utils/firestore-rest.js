// Arma el pedido "commit" de la API REST de Firestore (sin dependencias, se prueba en
// tests/escritura-nativa.test.mjs contra el emulador con las reglas reales).

const toValue = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v && typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { nullValue: null };
};
const toFields = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)])
);

/**
 * path: 'orders/abc/live/driver'. fields: valores simples (números, textos, mapas).
 * serverTime: campos que llevan la hora del servidor (como serverTimestamp()).
 * merge: campos que se pisan, como updateDoc; sin merge reemplaza el documento, como setDoc.
 */
export function buildCommit(projectId, path, fields, { serverTime = [], merge = null } = {}) {
  const write = { update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: toFields(fields) } };
  if (merge) write.updateMask = { fieldPaths: merge };
  if (serverTime.length) write.updateTransforms = serverTime.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));
  return {
    url: `/v1/projects/${projectId}/databases/(default)/documents:commit`,
    body: { writes: [write] },
  };
}
