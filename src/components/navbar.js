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

  const isOverlayFullscreen = hash.startsWith('/profile') || hash.startsWith('/mi-comercio/') || hash.startsWith('/pedido/') || hash.startsWith('/admin') || hash === '/notifications' || hash.startsWith('/comercio/') || hash === '/viajes' || hash.startsWith('/gofavores') || hash.startsWith('/delivery/');

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
  // When in fullscreen profile overlay, skip navbar DOM rebuild
  if (hash.startsWith('/profile')) {
    return;
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
  `;

  let floatingDriverBtn = document.getElementById('floating-driver-mode-pill');
  const isCartOrCheckout = hashPath.startsWith('/cart') || document.body.classList.contains('modal-open');
  
  if (isDelivery() && sessionStorage.getItem('gd_temp_client_mode') === 'true' && !isCartOrCheckout) {
    if (!floatingDriverBtn) {
      floatingDriverBtn = document.createElement('a');
      floatingDriverBtn.id = 'floating-driver-mode-pill';
      floatingDriverBtn.href = '#/delivery';
      floatingDriverBtn.innerHTML = '🛵 Modo Repartidor';
      floatingDriverBtn.style.cssText = `
        position: fixed;
        bottom: calc(var(--navbar-height, 68px) + 16px + max(env(safe-area-inset-bottom, 0px), 16px));
        right: 16px;
        z-index: 99999;
        background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
        color: white;
        padding: 8px 14px;
        border-radius: 30px;
        box-shadow: 0 8px 24px rgba(225, 29, 72, 0.4);
        font-weight: 900;
        font-size: 11.5px;
        font-family: var(--font-display, sans-serif);
        display: flex;
        align-items: center;
        gap: 6px;
        text-decoration: none;
        cursor: pointer;
        border: 2px solid #ffffff;
      `;
      floatingDriverBtn.onclick = () => {
        sessionStorage.removeItem('gd_temp_client_mode');
        document.body.classList.add('is-delivery-mode');
      };
      document.body.appendChild(floatingDriverBtn);
    } else {
      floatingDriverBtn.style.display = 'flex';
    }
  } else if (floatingDriverBtn) {
    floatingDriverBtn.remove();
  }
}

export function updateGlobalCartFAB() {
  const rawHash = window.location.hash || '#/';
  let btn = document.getElementById('global-cart-fab-btn');
  const count = getCartCount();

  const isModalOpen = document.body.classList.contains('modal-open');
  const isHomePage = rawHash === '#/' || rawHash === '#' || rawHash === '' || rawHash.startsWith('#/?');
  const isCartPage = rawHash.startsWith('#/cart');
  const isChatsPage = rawHash.startsWith('#/mis-chats') || rawHash.startsWith('#/chat') || rawHash.startsWith('#/support');
  const isDeliveryPage = rawHash.startsWith('#/delivery');
  const isComercioOwnerPage = rawHash.startsWith('#/mi-comercio');
  const isOffersPage = rawHash.startsWith('#/offers');
  const isProfilePage = rawHash.startsWith('#/profile');
  const isExcludedPage = isHomePage || isCartPage || isChatsPage || isDeliveryPage || isComercioOwnerPage || isOffersPage || isProfilePage;

  if (count > 0 && !isModalOpen && !isExcludedPage) {
    if (!btn) {
      btn = document.createElement('a');
      btn.id = 'global-cart-fab-btn';
      btn.href = '#/cart';
      btn.title = 'Ver carrito';
      document.body.appendChild(btn);
    } else if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
    }

    const isFullscreenPage = rawHash.startsWith('#/comercio/') || rawHash.startsWith('#/profile/') || rawHash.startsWith('#/mi-comercio/') || rawHash.startsWith('#/pedido/') || rawHash.startsWith('#/admin') || rawHash === '#/notifications' || rawHash === '#/viajes' || rawHash.startsWith('#/gofavores') || rawHash.startsWith('#/delivery');
    const bottomVal = isFullscreenPage ? '24px' : '80px';

    btn.style.cssText = `
      position: fixed !important;
      bottom: calc(${bottomVal} + env(safe-area-inset-bottom, 0px)) !important;
      right: 20px !important;
      z-index: 99999999 !important;
      width: 60px !important;
      height: 60px !important;
      border-radius: 50% !important;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%) !important;
      color: white !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 8px 28px rgba(225, 29, 72, 0.5), 0 2px 8px rgba(0,0,0,0.25) !important;
      border: 2.5px solid #ffffff !important;
      text-decoration: none !important;
      pointer-events: auto !important;
      transform: translateZ(0) !important;
    `;

    btn.innerHTML = `
      ${icon('cart', 28)}
      <span style="position:absolute; top:-4px; right:-4px; background:#10b981; color:white; min-width:24px; height:24px; border-radius:12px; font-size:12px; font-weight:900; display:flex; align-items:center; justify-content:center; padding:0 6px; border:2px solid white; box-shadow:0 3px 8px rgba(0,0,0,0.25); font-family:var(--font-display); line-height:1;">${count}</span>
    `;
  } else {
    if (btn) {
      btn.remove();
    }
  }
}

export function initNavbar() {
  renderNavbar();
  updateGlobalCartFAB();
  subscribe('cart', () => {
    renderNavbar();
    updateGlobalCartFAB();
  });
  subscribe('user', () => renderNavbar());
  subscribe('commercePendingCount', () => renderNavbar());
  subscribe('unreadSupportCount', () => renderNavbar());
  subscribe('totalUnreadChats', () => renderNavbar());
  window.addEventListener('hashchange', () => {
    renderNavbar();
    updateGlobalCartFAB();
  });

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

  // Real-time unread chats listener for all users (order chats + support chat + marketplace chats)
  let unreadUserChatsUnsub = null;
  let unreadUserSupportUnsub = null;
  let unreadMarketplaceChatsUnsub = null;
  subscribe('user', async (user) => {
    if (unreadUserChatsUnsub) { unreadUserChatsUnsub(); unreadUserChatsUnsub = null; }
    if (unreadUserSupportUnsub) { unreadUserSupportUnsub(); unreadUserSupportUnsub = null; }
    if (unreadMarketplaceChatsUnsub) { unreadMarketplaceChatsUnsub(); unreadMarketplaceChatsUnsub = null; }

    if (user) {
      const { collection, query, where, onSnapshot, or } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const { setState: stateSetState } = await import('../state.js');

      let unreadSupport = 0;
      let unreadChats = 0;
      let unreadMarketplace = 0;

      const updateCount = () => {
        const total = unreadSupport + unreadChats + unreadMarketplace;
        stateSetState('totalUnreadChats', total);
        
        // Update badge directly in DOM if rendered
        const badgeEl = document.getElementById('support-chats-badge');
        if (badgeEl) {
          if (total > 0) {
            badgeEl.textContent = total;
            badgeEl.style.display = 'flex';
          } else {
            badgeEl.style.display = 'none';
          }
        } else {
          renderNavbar();
        }
      };

      // 1. Support chat unread: listen to all support chats for user.uid
      const qSupport = query(collection(db, 'support_chats'));
      unreadUserSupportUnsub = onSnapshot(qSupport, (snap) => {
        let count = 0;
        snap.docs.forEach(d => {
          const data = d.data();
          const matchesUser = data.userId === user.uid || d.id === user.uid || (data.messages && data.messages.some(m => m.sender !== 'user' && m.sender !== user.uid));
          if (matchesUser && data.unreadByUser === true) {
            count++;
          }
        });
        unreadSupport = count;
        updateCount();
      }, (err) => console.warn('User support unread listener failed:', err));

      // 2. Order chats unread
      const q = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
      unreadUserChatsUnsub = onSnapshot(q, async (snap) => {
        let count = 0;
        for (const d of snap.docs) {
          const data = d.data();
          const unreadVal = data.unread ? data.unread[user.uid] : 0;
          const isUnread = unreadVal === true || (typeof unreadVal === 'number' && unreadVal > 0);
          if (isUnread && data.orderId) {
            try {
              const { doc: fDoc, getDoc: fGetDoc } = await import('firebase/firestore');
              const oSnap = await fGetDoc(fDoc(db, 'orders', data.orderId));
              if (oSnap.exists()) {
                const oData = oSnap.data();
                if (oData.status === 'completed' || oData.status === 'delivered' || oData.status === 'cancelled') {
                  continue;
                }
                const isActualParty = oData.userId === user.uid ||
                                      oData.driverId === user.uid ||
                                      oData.comercioId === user.uid ||
                                      oData.comercioOwnerId === user.uid;
                if (isActualParty) count++;
              }
            } catch (e) {
              if (isUnread) count++;
            }
          } else if (isUnread) {
            count++;
          }
        }
        unreadChats = count;
        updateCount();
      }, (err) => console.warn('User chats unread listener failed:', err));

      // 3. Marketplace chats unread
      const qMarket = query(
        collection(db, 'marketplace_chats'),
        or(where('buyerId', '==', user.uid), where('sellerId', '==', user.uid))
      );
      unreadMarketplaceChatsUnsub = onSnapshot(qMarket, (snap) => {
        let count = 0;
        snap.docs.forEach(d => {
          const data = d.data();
          if (data.unreadBy && data.unreadBy.includes(user.uid)) {
            count++;
          }
        });
        unreadMarketplace = count;
        updateCount();
      }, (err) => console.warn('Marketplace chats unread listener failed:', err));
    }
  });
}
