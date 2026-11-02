// "Compra el repartidor": lo que el repartidor va marcando en la lista mientras compra queda
// guardado en el celular, así puede cerrar la lista (o se le traba la app) y seguir donde estaba.
// Se borra cuando la compra se carga en el servidor.

const KEY = 'go_shopper_marks_';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadShopperMarks(orderId, itemsCount) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY + orderId) || 'null');
    if (!saved || !Array.isArray(saved.state) || saved.state.length !== itemsCount) return null;
    if (Date.now() - (Number(saved.at) || 0) > MAX_AGE_MS) return null;
    return saved;
  } catch (e) {
    return null;
  }
}

export function saveShopperMarks(orderId, state, ticket, added = [], photo = '') {
  try { localStorage.setItem(KEY + orderId, JSON.stringify({ state, ticket, added, photo, at: Date.now() })); } catch (e) { /* sin almacenamiento */ }
}

export function clearShopperMarks(orderId) {
  try { localStorage.removeItem(KEY + orderId); } catch (e) { /* sin almacenamiento */ }
}

export function hasShopperMarks(orderId) {
  try { return !!localStorage.getItem(KEY + orderId); } catch (e) { return false; }
}
