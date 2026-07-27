// GoDelivery — Notifications Page
import { getState, subscribe, setState } from '../state.js';
import { db } from '../firebase.js';
import { collection, query, limit, getDocs, startAfter, deleteDoc, doc, onSnapshot, orderBy } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { signInWithGoogle } from '../auth.js';
import { initPushNotifications } from '../utils/notifications.js';
import { showToast } from '../components/toast.js';

let loadingMore = false;
let hasMore = true;
let lastDoc = null;
const PAGE_SIZE = 20;
let unsub = null;

function getNotificationStyles() {
  return `
    <style>
      .notifications-page {
        background: var(--color-bg);
        min-height: 100vh;
        padding-bottom: 90px;
        box-sizing: border-box;
      }
      .notifications-container-premium {
        max-width: 650px;
        margin: 0 auto;
        padding: 16px;
        width: 100%;
        box-sizing: border-box;
      }
      .notif-header-section-v6 {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--color-border-light);
      }
      .notif-header-title-v6 {
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 900;
        color: var(--color-text-primary);
        letter-spacing: -0.02em;
        margin: 0;
      }
      .notif-clear-btn-v6 {
        background: rgba(225, 29, 72, 0.05);
        border: 1px solid rgba(225, 29, 72, 0.1);
        color: var(--color-primary);
        font-weight: 850;
        font-size: 11.5px;
        padding: 6px 12px;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .notif-clear-btn-v6:hover {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);
      }
      .notif-card-premium-v6 {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        background: var(--color-surface);
        border: 1.5px solid var(--color-border-light);
        border-radius: 20px;
        margin-bottom: 12px;
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        box-shadow: var(--shadow-sm);
      }
      .notif-card-premium-v6:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: var(--color-primary-light);
      }
      .notif-card-premium-v6.unread {
        background: rgba(225, 29, 72, 0.02);
        border-color: rgba(225, 29, 72, 0.15);
      }
      .notif-card-premium-v6.unread::after {
        content: '';
        position: absolute;
        top: 16px;
        right: 16px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-primary);
        box-shadow: 0 0 10px var(--color-primary);
      }
      .notif-icon-v6 {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      .notif-icon-v6 svg {
        color: white !important;
        fill: none;
      }
      .notif-body-v6 {
        flex: 1;
        min-width: 0;
      }
      .notif-title-row-v6 {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 3px;
      }
      .notif-title-v6 {
        font-family: var(--font-display);
        font-weight: 850;
        font-size: 14.5px;
        color: var(--color-text-primary);
      }
      .notif-time-v6 {
        font-size: 10.5px;
        font-weight: 750;
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
      .notif-desc-v6 {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--color-text-secondary);
        line-height: 1.4;
      }
      .notif-arrow-v6 {
        color: var(--color-text-tertiary);
        opacity: 0.6;
        transition: transform 0.2s;
        display: flex;
        align-items: center;
      }
      .notif-card-premium-v6:hover .notif-arrow-v6 {
        transform: translateX(3px);
        color: var(--color-primary);
        opacity: 1;
      }
      .empty-state-v6 {
        text-align: center;
        padding: 60px 20px;
        opacity: 0.8;
      }
      .empty-state-icon-v6 {
        width: 64px;
        height: 64px;
        background: var(--color-bg-secondary);
        color: var(--color-text-tertiary);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        margin: 0 auto 16px auto;
        box-shadow: var(--shadow-sm);
      }
      .empty-state-v6 h3 {
        font-family: var(--font-display);
        font-weight: 900;
        font-size: 18px;
        color: var(--color-text-primary);
        margin: 0 0 8px 0;
      }
      .empty-state-v6 p {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
        font-weight: 600;
      }
    </style>
  `;
}

export async function renderNotifications(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    ${getNotificationStyles()}
    <div class="notifications-page page-enter">
      <div class="notifications-container-premium">
        <div class="notif-header-section-v6">
          <h2 class="notif-header-title-v6">Historial</h2>
          <button id="notif-clear-all-btn" class="notif-clear-btn-v6" style="display: none;">
            ${icon('trash', 14)} Limpiar todo
          </button>
        </div>
        <div id="notifications-list-full" class="notifications-list-full">
          <div class="initial-loader" style="padding: 60px 0;">
            <div class="spinner-mini"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  startListener();
  renderItems();

  const unsubNotif = subscribe('notifications', () => renderItems());
  const unsubUser = subscribe('user', () => {
    startListener();
    renderItems();
  });

  window.onscroll = () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
      loadMore();
    }
  };

  return {
    cleanup: () => {
      unsubNotif();
      unsubUser();
      window.onscroll = null;
    }
  };
}

function startListener() {
  const user = getState().user;
  if (!user) {
    if (unsub) { unsub(); unsub = null; }
    return;
  }

  if (unsub) return;

  const q = query(
    collection(db, 'users', user.uid, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(PAGE_SIZE)
  );

  unsub = onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length === PAGE_SIZE;
    
    const unreadCount = items.filter(n => n.status === 'unread').length;
    setState({ notifications: items, unreadNotifications: unreadCount });
  }, (err) => {
    console.warn('[NotificationsPage] Error:', err);
  });
}

function isNotifClickable(n) {
  if (!n.url || n.url === '' || n.url === '#') return false;
  if (n.url.includes('/pedido/')) {
    const type = n.type || '';
    if (type === 'order_completed' || type === 'order_cancelled') return false;
    const text = ((n.title || '') + ' ' + (n.body || '')).toLowerCase();
    if (text.includes('entregado') || text.includes('entregó') || text.includes('cancelado') || text.includes('canceló') || text.includes('disfrutes')) {
      return false;
    }
  }
  return true;
}

async function renderItems() {
  const list = document.getElementById('notifications-list-full');
  if (!list) return;

  let notifications = getState().notifications || [];
  const user = getState().user;

  notifications = notifications.filter(n => {
    if (!n.title || !n.body) return false;
    return true;
  });

  const clearBtn = document.getElementById('notif-clear-all-btn');
  if (clearBtn) {
    clearBtn.style.display = (user && notifications.length > 0) ? 'flex' : 'none';
    clearBtn.onclick = async () => {
      const confirmClear = confirm('¿Estás seguro que deseas borrar todas las notificaciones?');
      if (!confirmClear) return;
      try {
        const { writeBatch, collection, getDocs, doc } = await import('firebase/firestore');
        const batch = writeBatch(db);
        const snap = await getDocs(collection(db, 'users', user.uid, 'notifications'));
        snap.docs.forEach(d => {
          batch.delete(doc(db, 'users', user.uid, 'notifications', d.id));
        });
        await batch.commit();
        showToast('Notificaciones borradas', 'success');
      } catch (e) {
        console.error(e);
        showToast('Error al vaciar notificaciones', 'error');
      }
    };
  }

  if (!user) {
    list.innerHTML = `
      <div class="empty-state-v6">
        <div class="empty-state-icon-v6">${icon('lock', 24)}</div>
        <h3>Acceso restringido</h3>
        <p>Inicia sesión con tu cuenta de Google para ver tus notificaciones personales.</p>
        <button class="btn btn-primary btn-lg" id="notif-login-btn" style="margin-top: 16px;">
          Iniciar sesión
        </button>
      </div>
    `;
    document.getElementById('notif-login-btn').onclick = signInWithGoogle;
    return;
  }

  if (notifications.length === 0 && !loadingMore) {
    list.innerHTML = `
      <div class="empty-state-v6">
        <div class="empty-state-icon-v6">${icon('bell', 24)}</div>
        <h3>Todo al día</h3>
        <p>No tienes notificaciones por el momento.</p>
      </div>
    `;
    return;
  }

  // Deduplication logic
  const uniqueNotifications = [];
  const seenKeys = new Set();

  notifications.forEach(n => {
    const timeKey = n.createdAt?.seconds ? Math.floor(n.createdAt.seconds / 120) : Math.floor(Date.now() / 120000);
    const key = `${n.title}_${n.body}_${timeKey}`;
    
    if (!seenKeys.has(key)) {
      uniqueNotifications.push(n);
      seenKeys.add(key);
    }
  });

  // Fetch referred order statuses to check if they exist or are finalized
  const orderStatuses = {};
  const orderIdsToCheck = [];
  uniqueNotifications.forEach(n => {
    if (n.url && n.url.includes('/pedido/')) {
      const match = n.url.match(/#\/pedido\/([^/]+)/);
      if (match && match[1]) {
        orderIdsToCheck.push(match[1]);
      }
    }
  });

  if (orderIdsToCheck.length > 0) {
    const { getDoc, doc } = await import('firebase/firestore');
    await Promise.all(orderIdsToCheck.map(async (orderId) => {
      try {
        const oSnap = await getDoc(doc(db, 'orders', orderId));
        if (oSnap.exists()) {
          orderStatuses[orderId] = oSnap.data().status;
        } else {
          orderStatuses[orderId] = 'deleted';
        }
      } catch (e) {
        orderStatuses[orderId] = 'error';
      }
    }));
  }

  const html = uniqueNotifications.map((n, index) => {
    let clickable = isNotifClickable(n);
    
    // Disable if the order is deleted or completed
    if (n.url && n.url.includes('/pedido/')) {
      const match = n.url.match(/#\/pedido\/([^/]+)/);
      if (match && match[1]) {
        const oStatus = orderStatuses[match[1]];
        if (oStatus === 'deleted' || oStatus === 'completed' || oStatus === 'cancelled' || oStatus === 'entregado' || oStatus === 'cancelado') {
          clickable = false;
        }
      }
    }

    return `
      <div class="notif-card-premium-v6 ${n.status === 'unread' ? 'unread' : ''}" 
        data-id="${n.id}" data-url="${n.url || ''}" data-clickable="${clickable}"
        style="animation: fadeInUp 0.4s ease forwards ${index * 0.03}s; ${!clickable ? 'cursor: default; opacity: 0.55;' : 'cursor: pointer;'}">
        
        ${getNotificationIconV6(n.type)}
        
        <div class="notif-body-v6">
          <div class="notif-title-row-v6">
            <span class="notif-title-v6">${n.title || 'Aviso'}</span>
            <span class="notif-time-v6">${formatTime(n.createdAt)}</span>
          </div>
          <div class="notif-desc-v6">${n.body || ''}</div>
        </div>
        
        ${clickable ? `<div class="notif-arrow-v6">${icon('chevronRight', 18)}</div>` : ''}
      </div>
    `;
  }).join('');

  const loader = loadingMore ? '<div class="scroll-loader-v5" style="text-align: center; padding: 20px;"><div class="spinner-mini"></div></div>' : '';
  const footer = (!hasMore && notifications.length > 0) ? '<div class="end-list-v5" style="text-align: center; font-size: 11px; font-weight: 700; color: var(--color-text-tertiary); margin-top: 24px;">Eso es todo por ahora</div>' : '';

  list.innerHTML = html + loader + footer;

  list.querySelectorAll('.notif-card-premium-v6').forEach(item => {
    item.onclick = async () => {
      const id = item.dataset.id;
      const url = item.dataset.url;
      const clickable = item.dataset.clickable === 'true';
      
      // Update status to read instead of deleting!
      try {
        const { updateDoc, doc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'notifications', id), { status: 'read' });
      } catch (e) {}
      
      if (!clickable) return;
      if (url) {
        if (url.includes('chatId=')) {
          const matchChat = url.match(/chatId=([^&]+)/);
          if (matchChat && matchChat[1]) {
            const targetChatId = matchChat[1];
            try {
              const { getDoc, doc } = await import('firebase/firestore');
              const chatSnap = await getDoc(doc(db, 'chats', targetChatId));
              if (chatSnap.exists()) {
                const chatData = chatSnap.data();
                const orderSnap = await getDoc(doc(db, 'orders', chatData.orderId));
                if (orderSnap.exists()) {
                  const order = orderSnap.data();
                  let otherName = 'Comercio';
                  if (user.uid === order.userId) {
                    otherName = chatData.type === 'client-commerce' ? (order.comercioName || 'Comercio') : (order.driverName || 'Repartidor');
                  } else if (order.comercioId && user.uid === order.comercioId || (order.comercioOwnerId && user.uid === order.comercioOwnerId)) {
                    otherName = chatData.type === 'client-commerce' ? (order.userName || 'Cliente') : (order.driverName || 'Repartidor');
                  } else if (user.uid === order.driverId) {
                    otherName = chatData.type === 'client-delivery' ? (order.userName || 'Cliente') : (order.comercioName || 'Comercio');
                  }
                  
                  const { openChat } = await import('../components/chat.js');
                  openChat({
                    orderId: chatData.orderId,
                    type: chatData.type,
                    otherName: otherName,
                    orderNum: order.orderId || chatData.orderId.slice(0, 6).toUpperCase(),
                    senderDisplayName: user.displayName || 'Usuario'
                  });
                  return;
                }
              }
            } catch (e) {
              console.error('Failed to open chat from notification:', e);
            }
          }
        }
        window.location.hash = url;
      }
    };
  });
}

async function loadMore() {
  if (loadingMore || !hasMore || !lastDoc) return;
  const user = getState().user;
  if (!user) return;

  loadingMore = true;
  renderItems();

  try {
    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      startAfter(lastDoc),
      limit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    const newItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length === PAGE_SIZE;
    const current = getState().notifications || [];
    setState({ notifications: [...current, ...newItems] });
  } catch (e) {
    console.error('Error loading more notifications:', e);
  } finally {
    loadingMore = false;
    renderItems();
  }
}

function getNotificationIconV6(type) {
  let gradient = 'linear-gradient(135deg, #3b82f6, #1d4ed8)'; // Default blue
  let iconName = 'bell';

  if (type === 'new_chat_message' || type === 'chat_message') {
    gradient = 'linear-gradient(135deg, #ec4899, #8b5cf6)'; // Pink-Purple
    iconName = 'chatBubble';
  } else if (type === 'order_completed' || type === 'completed' || type === 'delivered') {
    gradient = 'linear-gradient(135deg, #10b981, #059669)'; // Emerald
    iconName = 'checkCircle';
  } else if (type === 'order_cancelled' || type === 'cancelled') {
    gradient = 'linear-gradient(135deg, #f43f5e, #e11d48)'; // Red-rose
    iconName = 'xCircle';
  } else if (type?.startsWith('order') || type === 'order') {
    gradient = 'linear-gradient(135deg, #f59e0b, #d97706)'; // Orange-Amber
    iconName = 'shoppingBag';
  }

  return `<div class="notif-icon-v6" style="background: ${gradient};">${icon(iconName, 20, '', '#ffffff')}</div>`;
}

function formatTime(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}
