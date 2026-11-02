// Comprobantes compartidos desde otra app (Mercado Pago, una billetera) al chat del pedido en curso.
// Solo en la app de Android desde la versión que trae el plugin GoShare (android/.../GoSharePlugin.java):
// en las instaladas antes esto no hace nada, porque el JS llega por Hosting y el plugin no.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase.js';
import { getState } from '../state.js';

const ACTIVE = ['pending', 'confirmed', 'preparing', 'ready', 'accepted', 'delivering'];
let listening = false;

let shareProxy = null;
export function goSharePlugin() {
  if (!Capacitor.isPluginAvailable('GoShare')) return null;
  if (!shareProxy) shareProxy = registerPlugin('GoShare');
  return shareProxy;
}

function toFile({ base64, name, type }) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name || 'comprobante', { type: type || 'application/octet-stream' });
}

async function activeOrders(uid) {
  const read = (field) => getDocs(query(collection(db, 'orders'), where(field, '==', uid), where('status', 'in', ACTIVE)))
    .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    .catch(() => []);
  const [mine, driving] = await Promise.all([read('userId'), read('driverId')]);
  const seen = new Set();
  return [...mine, ...driving].filter(o => !seen.has(o.id) && seen.add(o.id) && o.source !== 'whatsapp_bot');
}

export async function sendToOrderChat(order, file, user) {
  const { openChat } = await import('../components/chat.js');
  const iAmClient = order.userId === user.uid;
  const toDriver = Boolean(order.driverId);
  await openChat({
    orderId: order.id,
    type: toDriver ? 'client-delivery' : 'client-commerce',
    otherName: iAmClient ? (toDriver ? (order.driverName || 'Repartidor') : (order.comercioName || 'Comercio')) : (order.userName || 'Cliente'),
    orderNum: order.orderId,
    senderDisplayName: user.displayName || (iAmClient ? 'Cliente' : 'Repartidor'),
    sharedFile: file,
  });
}

async function chooseOrder(orders) {
  const { showModal, closeModal } = await import('../components/modal.js');
  return new Promise((resolve) => {
    showModal({
      title: '¿A qué pedido lo mandás?',
      height: 'auto',
      content: `<div class="chat-more-sheet">${orders.map((o, i) => `<button class="chat-more-option" data-share-order="${i}">Pedido #${Number(o.orderId) || ''}</button>`).join('')}</div>`,
      onClose: () => resolve(null),
      onOpen: () => {
        document.querySelectorAll('[data-share-order]').forEach((b) => {
          b.onclick = () => { resolve(orders[Number(b.dataset.shareOrder)]); closeModal(); };
        });
      },
    });
  });
}

async function handleShared(plugin) {
  const { showToast } = await import('../components/toast.js');
  let data;
  try {
    data = await plugin.getSharedFile();
  } catch (e) {
    showToast('No pudimos abrir ese archivo.', 'error');
    return;
  }
  if (data.tooLarge) { showToast('El archivo es muy grande: máximo 15 MB.', 'warning'); return; }
  if (!data.base64) return;
  const type = String(data.type || '');
  if (!type.startsWith('image/') && type !== 'application/pdf') {
    showToast('Solo se pueden mandar fotos o PDF.', 'warning');
    return;
  }
  const user = getState().user;
  if (!user) return;
  const orders = await activeOrders(user.uid);
  if (!orders.length) { showToast('No tenés un pedido en curso para mandarlo.', 'info'); return; }
  const order = orders.length === 1 ? orders[0] : await chooseOrder(orders);
  if (order) await sendToOrderChat(order, toFile(data), user);
}

/** Una vez con la sesión lista: toma lo que ya estaba esperando y lo que llegue después. */
export function initShareReceiver() {
  const plugin = goSharePlugin();
  if (!plugin || listening) return;
  listening = true;
  plugin.addListener('shared', () => handleShared(plugin));
  handleShared(plugin);
}
