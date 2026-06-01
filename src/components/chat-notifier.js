// GoDelivery — Chat Notification System (Client-Side Real-Time)
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { sendLocalNotification } from '../utils/notifications.js';
import { setBanner, clearBanner } from './banner-manager.js';
import { icon } from '../utils/icons.js';

const MSG_SOUND = '/assets/sounds/message.mp3';
let audioUnlocked = false;

let activeListeners = [];
let notifiedMessages = new Set();
let unreadCounts = {};
let onUnreadChangeCallbacks = [];

export function initChatNotifier() {
  cleanup();
  const user = getState().user;
  if (!user) return;

  // Unlock audio
  document.addEventListener('click', () => {
    if (!audioUnlocked) {
      const a = new Audio(MSG_SOUND);
      a.volume = 0;
      a.play().catch(() => {});
      audioUnlocked = true;
    }
  }, { once: true });

  // 1. Listen as Client
  const ordersQ = query(collection(db, 'orders'), where('userId', '==', user.uid));
  const orderUnsub = onSnapshot(ordersQ, (snap) => {
    snap.docs.forEach(orderDoc => {
      const order = { id: orderDoc.id, ...orderDoc.data() };
      listenToChat(`${order.id}_client-commerce`, user.uid, order.comercioName || 'Comercio', order);
      if (order.driverId) {
        listenToChat(`${order.id}_client-delivery`, user.uid, order.driverName || 'Repartidor', order);
      }
    });
  });
  activeListeners.push(orderUnsub);

  // 2. Listen as Commerce/Delivery
  listenAsCommerceOrDelivery(user);
}

function listenAsCommerceOrDelivery(user) {
  const comerciosQ = query(collection(db, 'comercios'), where('ownerId', '==', user.uid));
  const comercioUnsub = onSnapshot(comerciosQ, (snap) => {
    snap.docs.forEach(comercioDoc => {
      const ordersQ = query(collection(db, 'orders'), where('comercioId', '==', comercioDoc.id));
      const orderUnsub = onSnapshot(ordersQ, (orderSnap) => {
        orderSnap.docs.forEach(orderDoc => {
          const order = { id: orderDoc.id, ...orderDoc.data() };
          listenToChat(`${order.id}_client-commerce`, user.uid, order.userName || 'Cliente', order);
        });
      });
      activeListeners.push(orderUnsub);
    });
  });
  activeListeners.push(comercioUnsub);

  if (user.isDelivery || user.role === 'delivery') {
    const deliveryOrdersQ = query(collection(db, 'orders'), where('driverId', '==', user.uid));
    const deliveryUnsub = onSnapshot(deliveryOrdersQ, (snap) => {
      snap.docs.forEach(orderDoc => {
        const order = { id: orderDoc.id, ...orderDoc.data() };
        listenToChat(`${order.id}_client-delivery`, user.uid, order.userName || 'Cliente', order);
      });
    });
    activeListeners.push(deliveryUnsub);
  }
}

function listenToChat(chatId, userId, otherName, order) {
  if (unreadCounts[chatId] !== undefined) return;
  unreadCounts[chatId] = 0;

  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'desc'), limit(20));
  const unsub = onSnapshot(q, (snap) => {
    let unread = 0;
    snap.docs.forEach(d => {
      const msg = d.data();
      if (msg.senderId !== userId && !msg.read) {
        unread++;
        const msgKey = `${chatId}_${d.id}`;
        if (!notifiedMessages.has(msgKey) && msg.timestamp) {
          const msgTime = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
          const now = new Date();
          if (Math.abs(now - msgTime) < 60000) {
            notifiedMessages.add(msgKey);
            sendLocalNotification(`💬 ${msg.senderName || otherName}`, msg.text, {
              tag: `chat-${chatId}`,
              url: `#/pedido/${order.id}`,
              type: 'chat'
            });
            showGlobalMessageBanner(msg.senderName || otherName, msg.text, order.id, chatId);
          }
        }
      }
    });
    unreadCounts[chatId] = unread;
    notifyUnreadChange();
  });
  activeListeners.push(unsub);
}

function notifyUnreadChange() {
  onUnreadChangeCallbacks.forEach(cb => cb(unreadCounts));
  // Global FAB disabled per user request
}

function updateGlobalFAB() {
  // Disabled
}

function showGlobalMessageBanner(sender, text, orderId, chatId) {
  if (window.location.hash.includes(orderId) && window.location.hash.includes('chat')) return;
  
  setBanner('message', {
    duration: 10000,
    html: `
      <div class="active-message-banner" style="
        background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
        padding: 14px 24px 14px 32px; color: white;
        border: none;
      ">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:14px; font-weight:800; color:#ff4d4d; letter-spacing: -0.01em;">${sender}</div>
            <div style="font-size:13px; opacity:0.9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top: 2px;">${text}</div>
          </div>
          <div data-action="view-chat" style="
            background: rgba(255,255,255,0.1); 
            padding: 8px 16px; border-radius: 12px; 
            font-size: 11px; font-weight: 800; 
            text-transform:uppercase; letter-spacing:0.05em;
            border: 1px solid rgba(255,255,255,0.2);
            backdrop-filter: blur(5px);
          ">Ver chat</div>
        </div>
        <div style="position:absolute; bottom:0; left:0; height:3px; background:var(--color-primary); width:100%; transform-origin:left; animation: banner-timer 10.1s linear forwards;"></div>
      </div>
    `,
    onClick: async (e) => {
      clearBanner('message');
      
      // Instant open chat using cached order data
      const { openChat } = await import('../components/chat.js');
      openChat({
        orderId: orderId,
        type: chatId.includes('commerce') ? 'client-commerce' : 'client-delivery',
        otherName: sender,
        orderNum: orderId.slice(0, 6).toUpperCase(),
        senderDisplayName: sender
      });
    }
  });
}

export function getUnreadCount(orderId, type) {
  return unreadCounts[`${orderId}_${type}`] || 0;
}

export function getTotalUnread() {
  return Object.values(unreadCounts).reduce((sum, c) => sum + c, 0);
}

export function onUnreadChange(callback) {
  onUnreadChangeCallbacks.push(callback);
  return () => { onUnreadChangeCallbacks = onUnreadChangeCallbacks.filter(c => c !== callback); };
}

export function cleanup() {
  activeListeners.forEach(unsub => unsub());
  activeListeners = [];
  unreadCounts = {};
  notifiedMessages.clear();
  clearBanner('message');
}
