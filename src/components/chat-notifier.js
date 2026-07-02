// GoDelivery — Chat Notification System (Client-Side Real-Time)
import { db } from '../firebase.js';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { sendLocalNotification } from '../utils/notifications.js';
import { setBanner, clearBanner } from './banner-manager.js';
import { icon } from '../utils/icons.js';
import { AudioManager } from '../utils/audio-manager.js';

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
  const ordersQ = query(collection(db, 'orders'), where('userId', '==', user.uid), where('status', 'in', ['pending', 'accepted', 'preparing', 'ready', 'delivering']));
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
      // Only listen to active orders to prevent memory leak
      const ordersQ = query(
        collection(db, 'orders'), 
        where('comercioId', '==', comercioDoc.id),
        where('status', 'in', ['pending', 'accepted', 'preparing', 'ready', 'delivering'])
      );
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
    const deliveryOrdersQ = query(
      collection(db, 'orders'), 
      where('driverId', '==', user.uid),
      where('status', 'in', ['pending', 'accepted', 'preparing', 'ready', 'delivering'])
    );
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
            
            // Play sound alert
            try {
              AudioManager.playSynthMessageReceive();
            } catch (soundErr) {
              console.warn('AudioManager sound play failed:', soundErr);
            }

            const isCommerceOrDelivery = order.userId !== userId;
            const clickUrl = isCommerceOrDelivery 
              ? (order.driverId === userId ? `#/delivery-panel` : `#/comercio-panel/orders?id=${order.comercioId}`)
              : `#/pedido/${order.id}`;

            sendLocalNotification(`💬 ${msg.senderName || otherName}`, msg.text, {
              tag: `chat-${chatId}`,
              url: clickUrl,
              type: 'chat'
            });
            showGlobalMessageBanner(msg.senderName || otherName, msg.text, order.id, chatId, isCommerceOrDelivery, order);
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
      bottom: calc(var(--navbar-height, 60px) + 20px + env(safe-area-inset-bottom, 0px));
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
      const isCommerce = activeChatId.includes('commerce');
      const parts = activeChatId.split('_');
      const orderId = parts[0];
      const { openChat } = await import('../components/chat.js');
      
      let otherPartyName = 'Chat';
      let myDisplayName = 'Usuario';
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (snap.exists()) {
        const orderData = snap.data();
        const userId = getState().user?.uid;
        const isCommerceOrDelivery = orderData.userId !== userId;

        if (isCommerceOrDelivery) {
          otherPartyName = orderData.userName || 'Cliente';
          myDisplayName = orderData.driverId === userId ? 'Repartidor' : 'Comercio';
        } else {
          otherPartyName = isCommerce ? (orderData.comercioName || 'Comercio') : (orderData.driverName || 'Repartidor');
          myDisplayName = 'Cliente';
        }
      }

      openChat({
        orderId: orderId,
        type: isCommerce ? 'client-commerce' : 'client-delivery',
        otherName: otherPartyName,
        orderNum: orderId.slice(0, 6).toUpperCase(),
        senderDisplayName: myDisplayName
      });
    }
  };
}

function showGlobalMessageBanner(sender, text, orderId, chatId, isCommerceOrDelivery = false, order = null) {
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
      let myDisplayName = 'Usuario';
      if (isCommerceOrDelivery && order) {
        myDisplayName = order.driverId === getState().user.uid ? 'Repartidor' : 'Comercio';
      } else {
        myDisplayName = 'Cliente';
      }

      openChat({
        orderId: orderId,
        type: chatId.includes('commerce') ? 'client-commerce' : 'client-delivery',
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
