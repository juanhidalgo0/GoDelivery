// GoDelivery — Bottom Navigation
import { getState, subscribe, getCartCount } from '../state.js';
import { isAdmin, isComercio, isDelivery } from '../auth.js';
import { icon } from '../utils/icons.js';

let lastCartCount = 0;

export function renderNavbar() {
  const navbar = document.getElementById('app-navbar');
  if (!navbar) return;

  const rawHash = window.location.hash;
  const hash = (rawHash === '' || rawHash === '#/') ? '/' : rawHash.slice(1);
  const cartCount = getCartCount();
  const shouldBounce = cartCount > lastCartCount;
  lastCartCount = cartCount;

  const user = getState().user;

  const isOverlayFullscreen = hash.startsWith('/profile/') || hash.startsWith('/mi-comercio/') || hash.startsWith('/pedido/') || hash.startsWith('/admin') || hash === '/notifications' || hash.startsWith('/comercio/') || hash === '/viajes' || hash.startsWith('/gofavores') || hash.startsWith('/delivery/');

  // Hide on admin/panel pages or tracking
  if (hash.startsWith('/admin') || hash.startsWith('/pedido/')) {
    navbar.innerHTML = '';
    navbar.style.display = 'none';
    const appContent = document.getElementById('app-content');
    if (appContent) {
      appContent.style.paddingBottom = '0';
      appContent.style.minHeight = '100dvh';
    }
    // Make overlay fill full viewport
    const overlay = document.getElementById('app-overlay');
    if (overlay) overlay.classList.add('panel-fullscreen');
    return;
  }

  // Restore navbar visibility on normal pages
  navbar.style.display = '';
  const appContent = document.getElementById('app-content');
  if (appContent) {
    appContent.style.paddingBottom = '';
    appContent.style.minHeight = '';
  }
  const overlay = document.getElementById('app-overlay');
  if (overlay) {
    if (isOverlayFullscreen) {
      overlay.classList.add('panel-fullscreen');
    } else {
      overlay.classList.remove('panel-fullscreen');
    }
  }

  const hashPath = hash.split('?')[0];

  navbar.innerHTML = `
    <div class="bottom-nav" style="background: var(--footer-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border-top: 1px solid var(--footer-border); box-shadow: 0 -8px 30px rgba(15, 23, 42, 0.05);">
      <a href="#/" class="nav-item ${hashPath === '/' ? 'active' : ''}">
        <span class="nav-item-icon">${icon('home', 24)}</span>
        <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Inicio</span>
      </a>
      <a href="#/offers" class="nav-item ${hashPath === '/offers' ? 'active' : ''}">
        <span class="nav-item-icon">${icon('tag', 24)}</span>
        <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Ofertas</span>
      </a>
      ${(isComercio() || isAdmin()) ? `
        <a href="#/mi-comercio" class="nav-item ${hashPath.startsWith('/mi-comercio') ? 'active' : ''}">
          <span class="nav-item-icon">
            ${icon('store', 24)}
            ${getState().commercePendingCount > 0 ? `<span class="nav-item-badge" style="background: var(--color-danger); border: 2px solid var(--color-surface); animation: badgePulse 2s infinite;">${getState().commercePendingCount}</span>` : ''}
          </span>
          <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Comercio</span>
        </a>
      ` : ''}
      ${isDelivery() ? `
        <a href="#/delivery" class="nav-item ${hashPath.startsWith('/delivery') ? 'active' : ''}">
          <span class="nav-item-icon">${icon('bike', 24)}</span>
          <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Delivery</span>
        </a>
      ` : ''}
      <a href="#/cart" class="nav-item ${hashPath === '/cart' ? 'active' : ''}">
        <span class="nav-item-icon">
          ${icon('cart', 24)}
          ${cartCount > 0 ? `<span class="nav-item-badge ${shouldBounce ? 'cart-bounce-active' : ''}" style="background: var(--color-primary); border: 2px solid var(--color-surface);">${cartCount}</span>` : ''}
        </span>
        <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Carrito</span>
      </a>
      <a href="#/mis-chats" class="nav-item ${hashPath.startsWith('/mis-chats') ? 'active' : ''}">
        <span class="nav-item-icon">
          ${icon('chatBubble', 24)}
          ${(getState().totalUnreadChats || 0) > 0 ? `
            <span id="support-chats-badge" style="background: var(--color-primary); border: 2px solid var(--color-surface); animation: badgePulse 2s infinite;" class="nav-item-badge">${getState().totalUnreadChats}</span>
          ` : ''}
        </span>
        <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Mis Chats</span>
      </a>
    </div>
  `;
}

export function initNavbar() {
  renderNavbar();
  subscribe('cart', () => renderNavbar());
  subscribe('user', () => renderNavbar());
  subscribe('commercePendingCount', () => renderNavbar());
  subscribe('unreadSupportCount', () => renderNavbar());
  subscribe('totalUnreadChats', () => renderNavbar());
  window.addEventListener('hashchange', () => renderNavbar());

  // Real-time unread support chats listener for admins
  let unreadUnsub = null;
  subscribe('user', async (user) => {
    if (unreadUnsub) { unreadUnsub(); unreadUnsub = null; }
    if (user && isAdmin()) {
      const { collection, query, where, onSnapshot } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const { setState: stateSetState } = await import('../state.js');
      const q = query(collection(db, 'support_chats'), where('unreadByAdmin', '==', true));
      unreadUnsub = onSnapshot(q, (snap) => {
        stateSetState('unreadSupportCount', snap.size);
      }, (err) => console.warn('Unread chats listener failed:', err));
    }
  });

  // Real-time unread chats listener for all users (order chats + support chat)
  let unreadUserChatsUnsub = null;
  let unreadUserSupportUnsub = null;
  subscribe('user', async (user) => {
    if (unreadUserChatsUnsub) { unreadUserChatsUnsub(); unreadUserChatsUnsub = null; }
    if (unreadUserSupportUnsub) { unreadUserSupportUnsub(); unreadUserSupportUnsub = null; }

    if (user) {
      const { collection, doc, query, where, onSnapshot } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const { setState: stateSetState } = await import('../state.js');

      let unreadSupport = 0;
      let unreadChats = 0;

      const updateCount = () => {
        stateSetState('totalUnreadChats', unreadSupport + unreadChats);
      };

      // 1. Support chat unread
      unreadUserSupportUnsub = onSnapshot(doc(db, 'support_chats', user.uid), (snap) => {
        unreadSupport = (snap.exists() && snap.data().unreadByUser === true) ? 1 : 0;
        updateCount();
      }, (err) => console.warn('User support unread listener failed:', err));

      // 2. Order chats unread
      const q = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
      unreadUserChatsUnsub = onSnapshot(q, (snap) => {
        let count = 0;
        snap.docs.forEach(d => {
          const data = d.data();
          if (data.unread && data.unread[user.uid] === true) {
            count++;
          }
        });
        unreadChats = count;
        updateCount();
      }, (err) => console.warn('User chats unread listener failed:', err));
    }
  });
}
