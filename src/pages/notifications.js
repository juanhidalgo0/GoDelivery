// GoDelivery — Notifications Page
import { getState, subscribe, setState } from '../state.js';
import { db } from '../firebase.js';
import { collection, query, limit, getDocs, startAfter, updateDoc, doc, onSnapshot, orderBy } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { signInWithGoogle } from '../auth.js';

let loadingMore = false;
let hasMore = true;
let lastDoc = null;
const PAGE_SIZE = 20;
let unsub = null;

export async function renderNotifications(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="notifications-page page-enter" style="background: var(--color-bg); min-height: 100vh; padding-top: 10px;">
      <div class="notifications-container-premium" style="padding: 0 16px;">
        <div id="notifications-list-full" class="notifications-list-full">
          <div class="initial-loader">
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

function renderItems() {
  const list = document.getElementById('notifications-list-full');
  if (!list) return;

  let notifications = getState().notifications || [];
  const user = getState().user;

  notifications = notifications.filter(n => {
    const type = n.type || '';
    const title = n.title || '';
    if (type.startsWith('order') || type === 'chat_message') return false;
    if (title.includes('Pedido') || title.includes('💬')) return false;
    return true;
  });

  if (!user) {
    list.innerHTML = `
      <div class="empty-state-rigorous">
        <div class="empty-state-icon-box">${icon('lock', 48)}</div>
        <h3>Acceso restringido</h3>
        <p>Inicia sesión con tu cuenta de Google para ver tus notificaciones personales.</p>
        <button class="btn btn-primary btn-lg" id="notif-login-btn">
          Iniciar sesión
        </button>
      </div>
    `;
    document.getElementById('notif-login-btn').onclick = signInWithGoogle;
    return;
  }

  if (notifications.length === 0 && !loadingMore) {
    list.innerHTML = `
      <div class="empty-state-rigorous">
        <div class="empty-state-icon-box">${icon('bell', 48)}</div>
        <h3>Todo al día</h3>
        <p>No tienes notificaciones por el momento. Te avisaremos cuando ocurra algo importante.</p>
      </div>
    `;
    return;
  }

  // Deduplication logic
  const uniqueNotifications = [];
  const seenKeys = new Set();

  notifications.forEach(n => {
    // Key based on title, body and rough time (within 2 mins)
    const timeKey = n.createdAt?.seconds ? Math.floor(n.createdAt.seconds / 120) : Math.floor(Date.now() / 120000);
    const key = `${n.title}_${n.body}_${timeKey}`;
    
    if (!seenKeys.has(key)) {
      uniqueNotifications.push(n);
      seenKeys.add(key);
    }
  });

  const html = uniqueNotifications.map((n, index) => `
    <div class="notif-card-premium ${n.status === 'unread' ? 'unread' : ''}" 
      data-id="${n.id}" data-url="${n.url || ''}"
      style="animation: fadeInUp 0.5s ease forwards ${index * 0.05}s;">
      
      <div class="notif-status-indicator"></div>
      
      <div class="notif-icon-v5" style="background: ${getNotificationColor(n.type)};">
        ${getNotificationIcon(n.type)}
      </div>

      <div class="notif-body-v5">
        <div class="notif-header-row">
          <span class="notif-title-v5">${n.title || 'Aviso'}</span>
          <span class="notif-time-v5">${formatTime(n.createdAt)}</span>
        </div>
        <div class="notif-text-v5">${n.body || ''}</div>
      </div>
      
      ${n.url ? `<div class="notif-arrow-v5">${icon('chevronRight', 18)}</div>` : ''}
    </div>
  `).join('');

  const loader = loadingMore ? '<div class="scroll-loader-v5"><div class="spinner-mini"></div></div>' : '';
  const footer = (!hasMore && notifications.length > 0) ? '<div class="end-list-v5">Eso es todo por ahora</div>' : '';

  list.innerHTML = html + loader + footer;

  list.querySelectorAll('.notif-card-premium').forEach(item => {
    item.onclick = async () => {
      const id = item.dataset.id;
      const url = item.dataset.url;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'notifications', id), { status: 'read' });
      } catch (e) {}
      if (url) window.location.hash = url;
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

function getNotificationColor(type) {
  const colors = {
    order: 'var(--color-warning-light)',
    chat_message: 'rgba(236, 72, 153, 0.1)',
    order_completed: 'var(--color-success-light)',
    order_cancelled: 'var(--color-danger-light)'
  };
  return colors[type] || 'var(--color-primary-light)';
}

function getNotificationIcon(type) {
  const colors = {
    order: '#f59e0b',
    chat_message: '#ec4899',
    order_completed: '#10b981',
    order_cancelled: '#ef4444'
  };
  const color = colors[type] || 'var(--color-primary)';
  if (type === 'chat_message') return icon('chatBubble', 20, '', color);
  if (type === 'order' || type?.startsWith('order')) return icon('shoppingBag', 20, '', color);
  return icon('bell', 20, '', color);
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
