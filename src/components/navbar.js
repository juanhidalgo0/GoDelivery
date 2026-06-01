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
  if (overlay) overlay.classList.remove('panel-fullscreen');

  const hashPath = hash.split('?')[0];

  navbar.innerHTML = `
    <div class="bottom-nav" style="background: var(--footer-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border-top: 1px solid var(--footer-border); box-shadow: 0 -8px 30px rgba(15, 23, 42, 0.05);">
      <a href="#/" class="nav-item ${hashPath === '/' ? 'active' : ''}">
        <span class="nav-item-icon">${icon('home', 24)}</span>
        <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Inicio</span>
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
      ${isAdmin() ? `
        <a href="#/admin/support-chats" class="nav-item ${hashPath.startsWith('/admin/support-chats') ? 'active' : ''}">
          <span class="nav-item-icon">
            ${icon('chatBubble', 24)}
            <span id="support-chats-badge" style="display:none; background: var(--color-primary); border: 2px solid var(--color-surface);" class="nav-item-badge"></span>
          </span>
          <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Soporte</span>
        </a>
      ` : ''}
      <a href="#/profile/orders" class="nav-item ${hashPath === '/profile/orders' ? 'active' : ''}">
        <span class="nav-item-icon">${icon('package', 24, '', hashPath === '/profile/orders' ? 'var(--color-primary)' : 'var(--footer-item-inactive)')}</span>
        <span style="font-size: 11px; font-weight: 800; margin-top: 2px;">Pedidos</span>
      </a>
    </div>
  `;
}

export function initNavbar() {
  renderNavbar();
  subscribe('cart', () => renderNavbar());
  subscribe('user', () => renderNavbar());
  subscribe('commercePendingCount', () => renderNavbar());
  window.addEventListener('hashchange', () => renderNavbar());

  // Real-time unread support chats listener for admins
  let unreadUnsub = null;
  subscribe('user', async (user) => {
    if (unreadUnsub) { unreadUnsub(); unreadUnsub = null; }
    if (user && isAdmin()) {
      const { collection, query, where, onSnapshot } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const q = query(collection(db, 'support_chats'), where('unreadByAdmin', '==', true));
      unreadUnsub = onSnapshot(q, (snap) => {
        const badge = document.getElementById('support-chats-badge');
        if (badge) {
          const count = snap.size;
          if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'block';
          } else {
            badge.style.display = 'none';
          }
        }
      }, (err) => console.warn('Unread chats listener failed:', err));
    }
  });
}
