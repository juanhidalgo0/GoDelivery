// Who belongs in each order chat (the same as isChatParty in firestore.rules, which is what
// really enforces it; this only avoids opening or listing what the rules would reject).
// Orders don't carry managers' uids, so anyone with a shop account counts as the shop here.
export function isChatParty(type, order, user) {
  if (!order || !user) return false;
  const uid = user.uid;
  const isShop = uid === order.comercioId || uid === order.comercioOwnerId ||
    (!!order.comercioId && (user.role === 'comercio' || user.role === 'commerce' || user.isComercio === true || user.comercioId === order.comercioId));
  if (type === 'client-delivery') return uid === order.userId || uid === order.driverId;
  if (type === 'client-commerce') return uid === order.userId || isShop;
  if (type === 'commerce-delivery') return uid === order.driverId || isShop;
  return false;
}
