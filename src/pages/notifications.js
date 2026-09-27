// GoDelivery — Notifications Page
import { getState, subscribe, setState } from '../state.js';
import { db } from '../firebase.js';
import { collection, query, limit, getDocs, startAfter, deleteDoc, doc, onSnapshot, orderBy } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { signInWithGoogle } from '../auth.js';
import { initPushNotifications } from '../utils/notifications.js';
import { showToast } from '../components/toast.js';
import { showConfirm } from '../components/modal.js';
import { escapeHtml } from '../utils/escape.js';

let loadingMore = false;
let hasMore = true;
let lastDoc = null;
const PAGE_SIZE = 20;
let unsub = null;

export async function renderNotifications(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const askPermission = typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted';
  content.innerHTML = `
    <div class="go-service-page notifications-page">
      <header class="go-service-header go-page-header" style="padding-top: calc(14px + max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px)));">
        <div class="go-service-row">
          <button type="button" class="go-icon-btn" id="notif-back-btn" aria-label="Volver">${icon('chevronLeft', 20)}</button>
          <div class="go-service-titles">
            <span class="go-eyebrow go-service-eyebrow">Tu actividad</span>
            <h1 class="go-title go-service-title">Notificaciones</h1>
            <span class="go-bar go-service-bar"></span>
          </div>
          <div class="go-service-actions">
            <button type="button" id="notif-clear-all-btn" class="go-icon-btn" aria-label="Borrar todas" style="display: none;">${icon('trash', 17)}</button>
          </div>
        </div>
      </header>
      <div class="go-service-scroll" id="notif-scroll">
        ${askPermission ? `
          <div id="notif-permission-banner" class="go-notif-permission">
            <span class="go-notif-permission-icon">${icon('bell', 18)}</span>
            <span class="go-notif-permission-text"><strong>Avisos desactivados</strong><small>Activalos para saber cuándo sale y llega tu pedido.</small></span>
            <button type="button" id="enable-notifs-btn">Activar</button>
          </div>
        ` : ''}
        <div id="notifications-list-full" class="go-notif-list is-first">
          ${[0, 1, 2, 3].map(() => '<div class="go-notif-skeleton"></div>').join('')}
        </div>
      </div>
    </div>
  `;

  document.getElementById('notif-back-btn')?.addEventListener('click', () => {
    if (window.safeGoBack) window.safeGoBack('#/');
    else window.location.hash = '#/';
  });

  startListener();
  renderItems();

  const enableBtn = document.getElementById('enable-notifs-btn');
  if (enableBtn) {
    enableBtn.onclick = async () => {
      const { requestWebPushPermission } = await import('../utils/notifications.js');
      const perm = await requestWebPushPermission();
      if (perm === 'granted') {
        showToast('Listo, te vamos a avisar.', 'success');
        document.getElementById('notif-permission-banner')?.remove();
      } else {
        showToast('No se pudieron activar. Revisá los permisos del navegador.', 'warning');
      }
    };
  }

  const unsubNotif = subscribe('notifications', () => renderItems());
  // The user object changes often (points, heartbeat...). Only a different account matters here.
  let lastUid = getState().user?.uid || null;
  const unsubUser = subscribe('user', (u) => {
    const uid = u?.uid || null;
    if (uid === lastUid) return;
    lastUid = uid;
    if (unsub) { unsub(); unsub = null; }
    startListener();
    renderItems();
  });

  // Infinite scroll lives on the page's own scroller (it opens as a full-screen layer).
  const scroller = document.getElementById('notif-scroll');
  const onScroll = () => {
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 400) loadMore();
  };
  scroller?.addEventListener('scroll', onScroll, { passive: true });

  return {
    cleanup: () => {
      unsubNotif();
      unsubUser();
      scroller?.removeEventListener('scroll', onScroll);
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

// Order statuses already looked up, so a re-render never waits on the network again.
const orderStatusCache = new Map();
let renderSeq = 0;

async function renderItems() {
  const list = document.getElementById('notifications-list-full');
  if (!list) return;
  const seq = ++renderSeq;

  const user = getState().user;
  const notifications = (getState().notifications || []).filter(n => n.title && n.body);

  const clearBtn = document.getElementById('notif-clear-all-btn');
  if (clearBtn) {
    clearBtn.style.display = (user && notifications.length > 0) ? 'inline-flex' : 'none';
    clearBtn.onclick = () => {
      showConfirm({
        title: '¿Borrar todas?',
        message: 'Se van a borrar todas tus notificaciones. No se puede deshacer.',
        confirmText: 'Borrar todas',
        danger: true,
        onConfirm: async () => {
          const { writeBatch, collection, getDocs, doc } = await import('firebase/firestore');
          const batch = writeBatch(db);
          const snap = await getDocs(collection(db, 'users', user.uid, 'notifications'));
          snap.docs.forEach(d => batch.delete(doc(db, 'users', user.uid, 'notifications', d.id)));
          await batch.commit();
          showToast('Notificaciones borradas', 'success');
        }
      });
    };
  }

  const paint = (html) => {
    if (seq !== renderSeq) return false; // a newer render is on its way
    if (list.dataset.sig === html) return false; // nothing changed: no flash
    list.dataset.sig = html;
    list.innerHTML = html;
    // Cards animate in only the first time the list appears.
    setTimeout(() => list.classList.remove('is-first'), 600);
    return true;
  };

  if (!user) {
    paint(`
      <div class="go-notif-empty">
        <span>${icon('lock', 24)}</span>
        <h3 class="go-title">Iniciá sesión</h3>
        <p>Entrá con tu cuenta para ver tus notificaciones.</p>
        <button type="button" id="notif-login-btn">Iniciar sesión</button>
      </div>`) && (document.getElementById('notif-login-btn').onclick = signInWithGoogle);
    return;
  }

  if (notifications.length === 0 && !loadingMore) {
    paint(`
      <div class="go-notif-empty">
        <span>${icon('bell', 24)}</span>
        <h3 class="go-title">Todo al día</h3>
        <p>Cuando pase algo con tus pedidos, te avisamos acá.</p>
      </div>`);
    return;
  }

  // Same message twice within two minutes is one notification.
  const unique = [];
  const seen = new Set();
  notifications.forEach(n => {
    const timeKey = n.createdAt?.seconds ? Math.floor(n.createdAt.seconds / 120) : 0;
    const key = `${n.title}_${n.body}_${timeKey}`;
    if (!seen.has(key)) { unique.push(n); seen.add(key); }
  });

  const orderIdOf = (n) => (n.url && n.url.includes('/pedido/')) ? (n.url.match(/#\/pedido\/([^/?]+)/) || [])[1] : null;
  const missing = [...new Set(unique.map(orderIdOf).filter(id => id && !orderStatusCache.has(id)))];
  if (missing.length) {
    const { getDoc, doc } = await import('firebase/firestore');
    await Promise.all(missing.map(async (orderId) => {
      try {
        const oSnap = await getDoc(doc(db, 'orders', orderId));
        orderStatusCache.set(orderId, oSnap.exists() ? oSnap.data().status : 'deleted');
      } catch (e) {
        orderStatusCache.set(orderId, 'error');
      }
    }));
  }

  const html = unique.map((n, index) => {
    let clickable = isNotifClickable(n);
    const oStatus = orderStatusCache.get(orderIdOf(n));
    if (['deleted', 'completed', 'cancelled', 'entregado', 'cancelado'].includes(oStatus)) clickable = false;
    return `
      <div class="go-notif ${n.status === 'unread' ? 'is-unread' : ''} ${clickable ? '' : 'is-static'}"
        data-id="${escapeHtml(n.id)}" data-url="${escapeHtml(n.url || '')}" data-clickable="${clickable}" style="--i: ${Math.min(index, 8)};">
        ${getNotificationIconV6(n.type)}
        <div class="go-notif-body">
          <div class="go-notif-top">
            <span class="go-notif-title">${escapeHtml(n.title || 'Aviso')}</span>
            <span class="go-notif-time">${formatTime(n.createdAt)}</span>
          </div>
          <div class="go-notif-text">${escapeHtml(n.body || '')}</div>
        </div>
        ${clickable ? `<span class="go-notif-chev">${icon('chevronRight', 16)}</span>` : ''}
      </div>`;
  }).join('');

  const loader = loadingMore ? '<div class="go-notif-more"><div class="spinner-mini"></div></div>' : '';
  const footer = (!hasMore && notifications.length > 0) ? '<div class="go-notif-end">No hay más notificaciones</div>' : '';
  if (!paint(html + loader + footer)) return;

  list.querySelectorAll('.go-notif').forEach(item => {
    item.onclick = async () => {
      const id = item.dataset.id;
      const url = item.dataset.url;
      const clickable = item.dataset.clickable === 'true';
      item.classList.remove('is-unread');
      try {
        const { updateDoc, doc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'notifications', id), { status: 'read' });
      } catch (e) {}

      if (!clickable || !url) return;
      if (url.includes('chatId=')) {
        const matchChat = url.match(/chatId=([^&]+)/);
        if (matchChat && matchChat[1]) {
          try {
            const { getDoc, doc } = await import('firebase/firestore');
            const chatSnap = await getDoc(doc(db, 'chats', matchChat[1]));
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
                  otherName,
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
  let iconName = 'bell';
  let tone = '';
  if (type === 'new_chat_message' || type === 'chat_message') iconName = 'chatBubble';
  else if (type === 'order_completed' || type === 'completed' || type === 'delivered') iconName = 'checkCircle';
  else if (type === 'order_cancelled' || type === 'cancelled') { iconName = 'xCircle'; tone = 'is-alert'; }
  else if (type?.startsWith('order') || type === 'order') iconName = 'shoppingBag';
  return `<span class="go-notif-icon ${tone}">${icon(iconName, 19)}</span>`;
}

function formatTime(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : (typeof ts.seconds === 'number' ? new Date(ts.seconds * 1000) : new Date(ts));
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}
