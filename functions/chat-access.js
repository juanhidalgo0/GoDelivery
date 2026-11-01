// Quién participa de cada chat de un pedido. Cada tipo es de dos partes, y sale del pedido:
// `participants` puede tener de más (admins que auditaron, cadetes reasignados, quien abrió el
// chat desde una notificación que no le correspondía).

function shopIds(order, comercio) {
  return [order.comercioId, order.comercioOwnerId, comercio && comercio.ownerId, ...((comercio && comercio.managerIds) || [])];
}

/** Lista de ids del chat, o null si el tipo no es de un chat de pedido. */
function chatParties(type, order, comercio) {
  let parties;
  if (type === "client-delivery") parties = [order.userId, order.driverId];
  else if (type === "client-commerce") parties = [order.userId, ...shopIds(order, comercio)];
  else if (type === "commerce-delivery") parties = [order.driverId, ...shopIds(order, comercio)];
  else return null;
  return [...new Set(parties.filter(Boolean))];
}

const chatTypeOf = (chatId, chatData) => (chatData && chatData.type) || String(chatId).split("_").slice(1).join("_");

module.exports = { chatParties, chatTypeOf };
