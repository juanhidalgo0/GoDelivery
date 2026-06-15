// GoDelivery — Premium Notification Drawer (Robust & Professional)
import { getState, subscribe, setState } from '../state.js';
import { db } from '../firebase.js';
import { collection, query, limit, getDocs, startAfter, updateDoc, doc, onSnapshot, orderBy } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { signInWithGoogle } from '../auth.js';

let loadingMore = false;
let hasMore = true;
let lastDoc = null;
const PAGE_SIZE = 15;
let unsub = null;

/**
 * Ensures the drawer structure is present and sync is active.
 */
export function initNotificationsDrawer() {
  const container = document.getElementById('notifications-drawer-container');
  if (!container) return;

  if (!container.querySelector('.notifications-drawer')) {
    container.innerHTML = `
      <div class="notifications-drawer">
        <div class="notifications-header">
          <h2 id="notifications-title">Notificaciones</h2>
          <button id="close-notifications-btn">
            ${icon('chevronRight', 24)}
          </button>
        </div>
        <div class="notifications-list" id="notifications-scroll-area">
          <div class="initial-loader">
            <div class="spinner-mini"></div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#close-notifications-btn').onclick = closeNotificationsDrawer;

    const scrollArea = container.querySelector('#notifications-scroll-area');
    scrollArea.onscroll = () => {
      if (scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 100) {
        loadMore();
      }
    };

    // Swipe logic
    let startX = 0;
    let currentX = 0;
    const panel = container.querySelector('.notifications-drawer');
    panel.ontouchstart = (e) => { startX = e.touches[0].clientX; currentX = startX; panel.style.transition = 'none'; };
    panel.ontouchmove = (e) => { currentX = e.touches[0].clientX; const diff = currentX - startX; if (diff > 0) panel.style.transform = `translateX(${diff}px)`; };
    panel.ontouchend = () => { panel.style.transition = ''; const diff = currentX - startX; if (diff > 100) closeNotificationsDrawer(); else panel.style.transform = ''; };

    subscribe('notifications', renderItems);
    subscribe('user', () => {
      startListener();
      renderItems();
    });
  }

  startListener();
  renderItems();
}

function startListener() {
  const isPreview = window.location.hash.includes('preview=true') || window.location.search.includes('preview=true');
  if (isPreview) return;

  const user = getState().user;

  if (!user) {
    if (unsub) {
      unsub();
      unsub = null;
    }
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
    console.warn('[Notifications] Falling back due to index error:', err);
    onSnapshot(query(collection(db, 'users', user.uid, 'notifications'), limit(PAGE_SIZE)), (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      const unreadCount = items.filter(n => n.status === 'unread').length;
      setState({ notifications: items, unreadNotifications: unreadCount });
    });
  });
}

function renderItems() {
  const scrollArea = document.getElementById('notifications-scroll-area');
  if (!scrollArea) return;

  let notifications = getState().notifications || [];
  notifications = notifications.filter(n => {
    const type = n.type || '';
    const title = n.title || '';
    if (type.startsWith('order') || type === 'chat_message') return false;
    if (title.includes('Pedido') || title.includes('💬')) return false;
    return true;
  });

  if (!getState().user) {
    scrollArea.innerHTML = `
      <div class="empty-state-mini">
        <img src="/logo-brand.jpg" class="empty-brand-logo" alt="GoDelivery" />
        <p class="empty-title">Acceso restringido</p>
        <p class="empty-text">Inicia sesión para ver tus alertas de pedidos y mensajes.</p>
        <button class="btn btn-google" id="drawer-login-btn" style="width: 100%; margin-top: 20px;">
          <svg width="20" height="20" viewBox="0 0 24 24" style="margin-right: 10px;"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1zM12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23zM5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62zM12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continuar con Google
        </button>
      </div>
    `;
    scrollArea.querySelector('#drawer-login-btn').onclick = async () => {
      const btn = scrollArea.querySelector('#drawer-login-btn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner-mini" style="width:20px;height:20px;border-width:2px;"></div>';
      await signInWithGoogle();
    };
    return;
  }

  if (notifications.length === 0 && !loadingMore) {
    scrollArea.innerHTML = `
      <div class="empty-state-mini">
        <img src="/logo-brand.jpg" class="empty-brand-logo" alt="GoDelivery" />
        <p class="empty-title">Sin notificaciones</p>
        <p class="empty-text">Por el momento no tienes ninguna novedad. ¡Te avisaremos cuando algo ocurra!</p>
      </div>
    `;
    return;
  }

  const html = notifications.map((n, index) => `
    <div class="notification-item ${n.status === 'unread' ? 'unread' : ''}" 
      data-id="${n.id}" data-url="${n.url || ''}"
      style="animation: slideUpSubtle 0.4s ease forwards ${index * 0.02}s;">

      <div class="notification-icon-box" style="background: ${getNotificationColor(n.type)}; border: 1px solid ${getIconColor(n.type)}20;">
        ${getNotificationIcon(n.type)}
      </div>

      <div class="notification-content">
        <div class="notification-title">${n.title || 'Aviso'}</div>
        <div class="notification-body">${n.body || ''}</div>
        <div class="notification-time">${formatTime(n.createdAt)}</div>
      </div>
    </div>
  `).join('');

  const loader = loadingMore ? '<div class="scroll-loader"><div class="spinner-mini"></div></div>' : '';
  const footer = (!hasMore && notifications.length > 0) ? '<div class="end-of-list">Fin del historial</div>' : '';

  scrollArea.innerHTML = html + loader + footer;

  scrollArea.querySelectorAll('.notification-item').forEach(item => {
    item.onclick = async () => {
      const id = item.dataset.id;
      const url = item.dataset.url;
      const user = getState().user;
      try {
        if (user) {
          await updateDoc(doc(db, 'users', user.uid, 'notifications', id), { status: 'read' });
        }
      } catch (e) { }
      if (url) {
        // Validate route exists in orders/chats if it contains order ID
        const orderMatch = url.match(/#\/pedido\/([^/]+)/);
        if (orderMatch && orderMatch[1]) {
          const orderId = orderMatch[1];
          try {
            const { getDoc, doc } = await import('firebase/firestore');
            const oDoc = await getDoc(doc(db, 'orders', orderId));
            if (!oDoc.exists()) {
              console.warn('[NotificationsDrawer] Order does not exist. Skipping navigation.');
              return;
            }
          } catch (err) {
            console.error('[NotificationsDrawer] Failed to verify order existence:', err);
            return;
          }
        }
        closeNotificationsDrawer();
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
    console.error('Error loading more:', e);
  } finally {
    loadingMore = false;
    renderItems();
  }
}

export function openNotificationsDrawer() {
  const container = document.getElementById('notifications-drawer-container');
  if (container) {
    initNotificationsDrawer();
    container.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

export function closeNotificationsDrawer() {
  const container = document.getElementById('notifications-drawer-container');
  if (container) {
    const panel = container.querySelector('.notifications-drawer');
    if (panel) {
      panel.style.transform = '';
      panel.style.transition = '';
    }
    container.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function getNotificationColor(type) {
  const colors = {
    order: 'rgba(245, 158, 11, 0.15)',
    order_pending: 'rgba(245, 158, 11, 0.15)',
    order_confirmed: 'rgba(59, 130, 246, 0.15)',
    order_ready: 'rgba(139, 92, 246, 0.15)',
    order_delivering: 'rgba(234, 179, 8, 0.15)',
    order_completed: 'rgba(34, 197, 94, 0.15)',
    order_cancelled: 'rgba(239, 68, 68, 0.15)',
    chat_message: 'rgba(236, 72, 153, 0.15)'
  };
  return colors[type] || 'rgba(var(--color-primary-rgb), 0.1)';
}

function getNotificationIcon(type) {
  const color = getIconColor(type);
  if (type === 'chat_message') return icon('chatBubble', 20, '', color);
  if (type === 'order' || type?.startsWith('order')) return icon('shoppingBag', 20, '', color);
  return icon('bell', 20, '', color);
}

function getIconColor(type) {
  const colors = {
    order: '#f59e0b',
    order_pending: '#f59e0b',
    order_confirmed: '#3b82f6',
    order_ready: '#8b5cf6',
    order_delivering: '#eab308',
    order_completed: '#22c55e',
    order_cancelled: '#ef4444',
    chat_message: '#ec4899'
  };
  return colors[type] || 'var(--color-primary)';
}

function formatTime(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'AHORA';
  if (mins < 60) return `HACE ${mins}M`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `HACE ${hrs}H`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `HACE ${days}D`;
  return date.toLocaleDateString();
}
