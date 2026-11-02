// GoDelivery — Chat Notification System (Client-Side Real-Time)
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { sendLocalNotification } from '../utils/notifications.js';
import { setBanner, clearBanner } from './banner-manager.js';
import { icon } from '../utils/icons.js';
import { AudioManager } from '../utils/audio-manager.js';
import { isChatParty } from '../utils/chat-access.js';

const MSG_SOUND = '/assets/sounds/message.wav';
let audioUnlocked = false;

let activeListeners = [];
let notifiedMessages = new Set();
let unreadCounts = {};
let startedAt = 0;
let onUnreadChangeCallbacks = [];

export function initChatNotifier() {
  cleanup();
  const user = getState().user;
  if (!user) return;
  startedAt = Date.now();

  // Unlock audio
  document.addEventListener('click', () => {
    if (!audioUnlocked) {
      const a = new Audio(MSG_SOUND);
      a.volume = 0;
      a.play().catch(() => {});
      audioUnlocked = true;
    }
  }, { once: true });

  // The chat screen is a separate download: fetch it now so the first tap doesn't wait for it.
  setTimeout(() => import('./chat.js').catch(() => {}), 3000);

  // The most recent chats. With no order, the limit took any 30: drivers kept listening to chats
  // of old orders, and a new chat could be left out and never notify.
  const chatsQ = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', user.uid),
    orderBy('lastMessageAt', 'desc'),
    limit(15)
  );
  const chatsUnsub = onSnapshot(chatsQ, (snap) => {
    snap.docs.forEach(chatDoc => {
      const chat = { id: chatDoc.id, ...chatDoc.data() };
      listenToChat(chat.id, user.uid, chat);
    });
  }, (err) => console.warn('[ChatNotifier] Chat list listener error:', err?.code || err));
  activeListeners.push(chatsUnsub);
}

function listenToChat(chatId, userId, chatData) {
  if (unreadCounts[chatId] !== undefined) return;

  // Do not spawn subcollection listeners for closed/completed chats
  if (chatData.status === 'completed' || chatData.status === 'closed' || chatData.isClosed === true || chatData.closed === true) {
    unreadCounts[chatId] = 0;
    return;
  }

  unreadCounts[chatId] = 0;

  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'desc'), limit(15));
  let isInitialLoad = true;
  const unsub = onSnapshot(q, async (snap) => {
    let unread = 0;

    // Resolve otherName and order details dynamically
    let otherName = 'Mensaje';
    let order = null;
    // Ignore chats of completed, delivered or cancelled orders
    if (chatData.status === 'completed' || chatData.status === 'closed' || chatData.isClosed === true || chatData.closed === true) {
      unreadCounts[chatId] = 0;
      notifyUnreadChange();
      return;
    }

    if (chatData.orderId) {
      try {
        const orderSnap = await getDoc(doc(db, 'orders', chatData.orderId));
        if (orderSnap.exists()) {
          order = { id: orderSnap.id, ...orderSnap.data() };
          
          // If order is completed, delivered or cancelled, do NOT count as unread
          // Finished, or not this person's chat (an admin auditing, a driver reassigned): nothing
          // to count and nothing to keep listening to.
          const finished = order.status === 'completed' || order.status === 'delivered' || order.status === 'cancelled';
          if (finished || !isChatParty(chatData.type || splitChatId(chatId).type, order, getState().user)) {
            unsub();
            unreadCounts[chatId] = 0;
            notifyUnreadChange();
            return;
          }

          if (chatData.type === 'client-commerce') {
            otherName = userId === order.userId ? (order.comercioName || 'Comercio') : (order.userName || 'Cliente');
          } else if (chatData.type === 'client-delivery') {
            otherName = userId === order.userId ? (order.driverName || 'Repartidor') : (order.userName || 'Cliente');
          } else if (chatData.type === 'commerce-delivery') {
            otherName = userId === order.comercioId ? (order.driverName || 'Repartidor') : (order.comercioName || 'Comercio');
          }
        }
      } catch (err) {
        console.warn('Error resolving order for notifier:', err);
      }
    } else if (chatData.isMarketplace) {
      otherName = userId === chatData.buyerId ? chatData.sellerName : chatData.buyerName;
    } else {
      otherName = 'Soporte';
    }

    // Se cuenta por cada mensaje. Antes se miraba chat.unread del momento en que empezó la escucha:
    // quien ya había abierto el chat tenía 0 ahí para siempre y no recibía sonido, cartel ni contador.
    {
      snap.docs.forEach(d => {
        const msg = d.data();
        if (msg.senderId !== userId && !msg.read) {
          unread++;
          const msgKey = `${chatId}_${d.id}`;
          if (!notifiedMessages.has(msgKey)) {
            // El primer mensaje de un chat llega en la primera lectura: también es nuevo si es de
            // después de abrir la app (antes ese no avisaba nunca).
            const sentAt = msg.timestamp?.toMillis?.() || 0;
            const chatOnScreen = !!document.getElementById(`chat-messages-${chatId}`);
            if ((!isInitialLoad || sentAt > startedAt) && !chatOnScreen) {
              notifiedMessages.add(msgKey);

              // Play sound alert
              try {
                AudioManager.playSynthMessageReceive();
              } catch (soundErr) {
                console.warn('AudioManager sound play failed:', soundErr);
              }

              const clickUrl = order 
                ? (order.userId !== userId 
                    ? (order.driverId === userId ? `#/delivery-panel?chatOrder=${order.id}` : `#/mi-comercio/${order.comercioId}/orders?chatOrder=${order.id}`)
                    : `#/pedido/${order.id}`)
                : `#/mis-chats`;

              sendLocalNotification(`💬 ${msg.senderName || otherName}`, chatPreview(msg), {
                tag: `chat-${chatId}`,
                url: clickUrl,
                type: 'chat'
              });
              showGlobalMessageBanner(escapeBanner(msg.senderName || otherName), escapeBanner(chatPreview(msg)), chatData.orderId || '', chatId, order ? (order.userId !== userId) : false, order);
            } else {
              notifiedMessages.add(msgKey);
            }
          }
        }
      });
    }

    isInitialLoad = false;
    unreadCounts[chatId] = unread;
    notifyUnreadChange();
  }, (err) => console.warn('[ChatNotifier] Messages listener error:', chatId, err?.code || err));
  activeListeners.push(unsub);
}

const chatPreview = (msg) => (msg.type === 'image' ? '📷 Foto' : msg.type === 'audio' ? '🎤 Mensaje de voz' : msg.text);
const escapeBanner = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Chat ids are `${orderId}_${type}`; the type decides which conversation opens.
function splitChatId(chatId) {
  const [orderId, ...rest] = String(chatId).split('_');
  return { orderId, type: rest.join('_') || 'client-delivery' };
}

function otherNameFor(type, order, userId) {
  if (type === 'client-commerce') return userId === order.userId ? (order.comercioName || 'Comercio') : (order.userName || 'Cliente');
  if (type === 'commerce-delivery') return userId === order.driverId ? (order.comercioName || 'Comercio') : (order.driverName || 'Repartidor');
  return userId === order.userId ? (order.driverName || 'Repartidor') : (order.userName || 'Cliente');
}

function notifyUnreadChange() {
  onUnreadChangeCallbacks.forEach(cb => cb(unreadCounts));
  updateGlobalFAB();
}

function updateGlobalFAB() {
  const total = getTotalUnread();
  let fab = document.getElementById('chat-global-fab');
  if (total <= 0) {
    if (fab) fab.remove();
    return;
  }

  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'chat-global-fab';
    fab.style.cssText = `
      position: fixed;
      bottom: calc(var(--navbar-height, 60px) + 20px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)));
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #FF4D6D 0%, var(--color-primary) 100%);
      border: 2px solid white;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(227, 27, 35, 0.4);
      z-index: 2000;
      cursor: pointer;
    `;
    
    // Add pulsing border ring style once
    if (!document.getElementById('fab-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'fab-pulse-style';
      style.innerHTML = `
        @keyframes fab-pop { from { transform: scale(0); } to { transform: scale(1); } }
        @keyframes fab-pulse { 0% { box-shadow: 0 0 0 0 rgba(227,27,35,0.4); } 70% { box-shadow: 0 0 0 15px rgba(227,27,35,0); } 100% { box-shadow: 0 0 0 0 rgba(227,27,35,0); } }
        .banner-stack-item.message {
          margin-right: 80px !important;
          margin-bottom: 10px !important;
        }
        .banner-stack-item.message .active-message-banner {
          border-radius: 20px !important;
          box-shadow: -5px 5px 25px rgba(0,0,0,0.35) !important;
          border: 1.5px solid rgba(255, 255, 255, 0.1) !important;
          position: relative !important;
        }
        .banner-stack-item.message .active-message-banner::after {
          content: '' !important;
          position: absolute !important;
          right: -9px !important;
          top: 50% !important;
          transform: translateY(-50%) !important;
          border-width: 10px 0 10px 10px !important;
          border-style: solid !important;
          border-color: transparent transparent transparent #121826 !important;
          display: block !important;
          width: 0 !important;
          z-index: 10 !important;
        }
      `;
      document.head.appendChild(style);
    }
    fab.style.animation = 'fab-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), fab-pulse 2s infinite';
    document.body.appendChild(fab);
  }

  fab.innerHTML = `
    ${icon('chatBubble', 24)}
    <span style="
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ffffff;
      color: var(--color-primary);
      font-size: 11px;
      font-weight: 900;
      border-radius: 10px;
      padding: 2px 7px;
      border: 2px solid var(--color-primary);
      box-shadow: var(--shadow-sm);
      min-width: 20px;
      text-align: center;
    ">${total}</span>
  `;

  fab.onclick = async () => {
    const activeChatId = Object.keys(unreadCounts).find(key => unreadCounts[key] > 0);
    if (activeChatId) {
      const { orderId, type } = splitChatId(activeChatId);
      const { openChat } = await import('../components/chat.js');
      
      let otherPartyName = 'Chat';
      let myDisplayName = 'Usuario';
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (snap.exists()) {
        const orderData = snap.data();
        const userId = getState().user?.uid;
        const isCommerceOrDelivery = orderData.userId !== userId;

        otherPartyName = otherNameFor(type, orderData, userId);
        myDisplayName = !isCommerceOrDelivery ? (getState().user?.displayName || 'Cliente') : (orderData.driverId === userId ? (getState().user?.displayName || 'Repartidor') : 'Comercio');
      }

      openChat({
        orderId: orderId,
        type,
        otherName: otherPartyName,
        orderNum: orderId.slice(0, 6).toUpperCase(),
        senderDisplayName: myDisplayName
      });
    }
  };
}

function showGlobalMessageBanner(sender, text, orderId, chatId, isCommerceOrDelivery = false, order = null) {
  // Only skip if the chat modal for this specific chatId is currently open in the DOM
  const chatContainer = document.querySelector('.chat-container');
  if (chatContainer && document.getElementById(`chat-messages-${chatId}`)) {
    return;
  }
  
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
      let myDisplayName = 'Usuario';
      if (isCommerceOrDelivery && order) {
        myDisplayName = order.driverId === getState().user.uid ? (getState().user?.displayName || 'Repartidor') : 'Comercio';
      } else {
        myDisplayName = getState().user?.displayName || 'Cliente';
      }

      openChat({
        orderId: orderId,
        type: splitChatId(chatId).type,
        otherName: sender,
        orderNum: orderId.slice(0, 6).toUpperCase(),
        senderDisplayName: myDisplayName
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
