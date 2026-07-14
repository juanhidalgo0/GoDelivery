// GoDelivery — Header Component
import { getState, subscribe, setDeliveryAddress, setState } from '../state.js';
import { isLoggedIn, isComercio, isDelivery } from '../auth.js';
import { icon } from '../utils/icons.js';
import { showAddressPrompt } from './address-modal.js';
import { initSearchSuggestions } from './search-suggestions.js';
import { showModal, closeModal } from './modal.js';
import { db } from '../firebase.js';
import { collection, query, limit, onSnapshot, orderBy, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { isIOS } from './install-prompt.js';
import { showToast } from './toast.js';

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

export function renderHeader() {
  const header = document.getElementById('app-header');
  if (!header) return;

  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = isIOS();
  const topPadding = isNative 
    ? 'var(--status-bar-height, 24px)' 
    : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  const hash = window.location.hash || '#/';
  const isHome = hash === '#/' || hash === '#' || hash === '';
  const isSubPage = (hash.startsWith('#/profile') && !hash.startsWith('#/profile/publications') && !hash.startsWith('#/profile/orders')) || hash.startsWith('#/notifications') || hash.startsWith('#/gofavores') || hash.startsWith('#/category') || hash.startsWith('#/cart') || hash.startsWith('#/admin/support-chats');
  const slider = document.getElementById('app-slider');

  if (!isHome && !isSubPage) {
    header.style.display = 'none';
    document.body.classList.add('header-hidden');
    if (slider) slider.style.height = 'calc(100dvh - var(--navbar-height))';
    return;
  }

  // Restore header
  document.body.classList.remove('header-hidden');
  header.style.display = 'block';
  header.style.opacity = '1';
  header.style.visibility = 'visible';
  header.style.zIndex = '2000';
  if (slider) slider.style.height = '';

  const address = getState().deliveryAddress;
  let displayAddress = address || 'Seleccionar dirección';
  if (displayAddress.includes(',')) {
    displayAddress = displayAddress.split(',')[0];
  }
  
  const unreadCount = getState().unreadNotifications || 0;

  const isOwner = isComercio();
  const isRider = isDelivery();

  // Load and filter notifications for dropdown
  const notifications = getState().notifications || [];
  const filteredNotifs = notifications.filter(n => {
    const type = n.type || '';
    const title = n.title || '';
    if (type.startsWith('order') || type === 'chat_message') return false;
    if (title.includes('Pedido') || title.includes('💬')) return false;
    return true;
  }).slice(0, 5);

  const desktopHeaderHTML = `
    <div class="desktop-header-container">
      <div class="desktop-header-content">
        <div class="desktop-header-left">
          <a href="#/" class="desktop-logo">
            <img src="/logo-brand.jpg" class="desktop-logo-img" alt="GoDelivery" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover;" />
            <span class="desktop-brand-name">GoDelivery</span>
          </a>
          
          <div class="desktop-address-box-wrapper" style="position: relative;">
            <div id="desktop-location-selector" class="desktop-address-box">
              <span class="desktop-address-label">Enviar a</span>
              <div class="desktop-address-value-row">
                <span class="desktop-address-value">${address || 'Seleccionar dirección'}</span>
                <span class="desktop-address-arrow">${icon('chevronDown', 14)}</span>
              </div>
            </div>
            
            <div class="desktop-address-dropdown">
              <div class="addr-dropdown-header">
                <span>Tus Direcciones</span>
              </div>
              <div class="addr-dropdown-list">
                ${(getState().savedAddresses || []).map(addr => `
                  <div class="addr-dropdown-item" data-id="${addr.id}">
                    <span class="addr-icon">${icon(addr.name.toLowerCase().includes('casa') ? 'home' : (addr.name.toLowerCase().includes('trabajo') || addr.name.toLowerCase().includes('oficina') ? 'store' : 'mapPin'), 14)}</span>
                    <div class="addr-info">
                      <span class="addr-name">${addr.name}</span>
                      <span class="addr-detail">${addr.address}</span>
                    </div>
                  </div>
                `).join('')}
                <div class="addr-dropdown-item add-new-trigger" style="border-top: 1px solid rgba(255, 255, 255, 0.06); color: var(--color-primary-light);">
                  <span class="addr-icon" style="color: #FFFFFF !important;">${icon('plus', 14)}</span>
                  <div class="addr-info">
                    <span class="addr-name" style="font-weight: 800;">Nueva Dirección</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="desktop-header-center">
          <div class="desktop-search-bar">
            <input type="text" id="desktop-search-input" placeholder="Buscar locales, platos o productos..." autocomplete="off" />
            <button id="desktop-search-button" class="desktop-search-btn">
              ${icon('search', 18)}
            </button>
          </div>
        </div>

        <div class="desktop-header-right">
          <!-- Notification Dropdown -->
          <div class="desktop-notifications-box" style="position:relative;">
            <button class="desktop-header-action-btn" title="Notificaciones" style="position:relative; background:none; border:none; color:white; cursor:pointer;">
              ${icon('bell', 22)}
              ${unreadCount > 0 ? `<span class="desktop-notif-dot"></span>` : ''}
            </button>
            
            <div class="desktop-notifications-dropdown">
              <div class="notif-dropdown-header">
                <span class="notif-title">Notificaciones</span>
                ${unreadCount > 0 ? `<button id="desktop-mark-all-read-btn" class="mark-all-read-btn">Marcar leídas</button>` : ''}
              </div>
              <div class="notif-dropdown-list">
                ${filteredNotifs.length === 0 ? `
                  <div class="notif-dropdown-empty">
                    ${icon('bell', 24)}
                    <span>Todo al día</span>
                  </div>
                ` : filteredNotifs.map(n => {
                  const isUnread = n.status === 'unread';
                  const clickable = isNotifClickable(n);
                  return `
                    <div class="notif-dropdown-item-card ${isUnread ? 'unread' : ''}" 
                      data-id="${n.id}" data-url="${n.url || ''}" data-clickable="${clickable}"
                      style="${!clickable ? 'cursor: default; opacity: 0.85;' : 'cursor: pointer;'}">
                      <div class="notif-item-dot"></div>
                      <div class="notif-item-body">
                        <div class="notif-item-title-row">
                          <span class="title">${n.title || 'Aviso'}</span>
                          <span class="time">${formatNotifTime(n.createdAt)}</span>
                        </div>
                        <p class="text">${n.body || ''}</p>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
              <a href="#/notifications" class="notif-dropdown-view-all">Ver todas</a>
            </div>
          </div>
          
          <div class="desktop-profile-box">
            <span class="desktop-profile-icon">${icon('user', 20)}</span>
            <span class="desktop-profile-label">Mi Perfil</span>
            <span class="desktop-profile-arrow">${icon('chevronDown', 12)}</span>
            
            <div class="desktop-profile-dropdown">
              <a href="#/profile" class="desktop-dropdown-item">${icon('user', 14)} Editar Perfil</a>
              <a href="#/profile/orders" class="desktop-dropdown-item">${icon('package', 14)} Mis Pedidos</a>
              <a href="#/cart" class="desktop-dropdown-item">${icon('cart', 14)} Mi Carrito</a>
              ${isOwner ? `<a href="#/mi-comercio" class="desktop-dropdown-item">${icon('store', 14)} Mi Comercio</a>` : ''}
              ${isRider ? `<a href="#/delivery" class="desktop-dropdown-item">${icon('bike', 14)} Repartidor</a>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (isHome) {
    if (window.innerWidth < 1024) {
      header.style.setProperty('background', 'var(--color-primary)', 'important');
      header.style.setProperty('border-bottom-left-radius', '28px', 'important');
      header.style.setProperty('border-bottom-right-radius', '28px', 'important');
      header.style.setProperty('box-shadow', '0 10px 30px rgba(var(--color-primary-rgb), 0.3)', 'important');
      header.style.setProperty('border', 'none', 'important');
      header.style.setProperty('backdrop-filter', 'none', 'important');
      header.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      header.style.setProperty('margin', '0', 'important');
      header.style.setProperty('padding', '0', 'important');
      header.style.setProperty('position', 'sticky', 'important');
      header.style.setProperty('top', '0', 'important');
      header.style.setProperty('z-index', '2000', 'important');
      header.style.setProperty('overflow', 'visible', 'important');
    } else {
      header.style.removeProperty('background');
      header.style.removeProperty('border-bottom-left-radius');
      header.style.removeProperty('border-bottom-right-radius');
      header.style.removeProperty('box-shadow');
      header.style.removeProperty('border');
      header.style.removeProperty('backdrop-filter');
      header.style.removeProperty('-webkit-backdrop-filter');
      header.style.removeProperty('margin');
      header.style.removeProperty('padding');
      header.style.removeProperty('position');
      header.style.removeProperty('top');
      header.style.removeProperty('z-index');
      header.style.removeProperty('overflow');
    }

    header.innerHTML = `
      ${desktopHeaderHTML}
      <div class="mobile-header-only" style="width:100%; padding-top: ${topPadding};">
        <!-- Decorative Circles (clipped using dedicated wrapper to prevent clipping search dropdown) -->
        <div style="position: absolute; inset: 0; overflow: hidden; border-bottom-left-radius: 28px; border-bottom-right-radius: 28px; pointer-events: none; z-index: 1;">
          <div style="position: absolute; top: -30px; right: -30px; width: 120px; height: 120px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          <div style="position: absolute; bottom: -10px; left: 100px; width: 50px; height: 50px; background: rgba(255,255,255,0.04); border-radius: 50%;"></div>
        </div>

        <div class="header-top" style="height: 48px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 2;">
          <!-- Address Selector -->
          <div id="header-location-selector" style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <span style="font-weight: 700; font-size: 14px; color: white; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${displayAddress}
            </span>
            <span style="color: white; display: flex; opacity: 0.8;">${icon('chevronDown', 14)}</span>
          </div>

          <!-- Action Buttons -->
          <div style="display: flex; align-items: center;">
            <a href="#/notifications" style="color: white; display: flex; position: relative; background: rgba(255,255,255,0.2); width: 38px; height: 38px; border-radius: 50%; align-items: center; justify-content: center; backdrop-filter: blur(8px);">
              ${icon('bell', 20)}
              ${(getState().unreadNotifications || 0) > 0 ? `
                <span style="position: absolute; top: -2px; right: -2px; background: #FF4757; width: 12px; height: 12px; border: 2px solid var(--color-primary); border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></span>
              ` : ''}
            </a>
            <a href="#/profile" style="color: white; display: flex; background: rgba(255,255,255,0.2); width: 38px; height: 38px; border-radius: 50%; align-items: center; justify-content: center; backdrop-filter: blur(8px); margin-left: 12px;">
              ${icon('user', 20)}
            </a>
            <button id="header-search-expand-btn" class="header-action-btn" style="color: white; background: rgba(255,255,255,0.2); border: none; height: 38px; width: 0px; margin-left: 0px; opacity: 0; transform: scale(0.5); border-radius: 50%; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); cursor:pointer; overflow: hidden; padding: 0;">
              <div style="min-width: 38px; display: flex; align-items: center; justify-content: center;">
                ${icon('search', 18)}
              </div>
            </button>
          </div>
        </div>

        <!-- Search Bar -->
        <div id="header-search-container" style="padding: 0 16px 16px 16px; margin-top: 2px; position: relative; z-index: 2; overflow: hidden; height: 62px; opacity: 1; transform: translateY(0); will-change: height, opacity, transform;">
          <div style="background: white; border-radius: 14px; height: 46px; display: flex; align-items: center; padding: 0 4px 0 16px; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <input type="text" id="header-search" placeholder="Locales, platos y productos" autocomplete="off" style="color: #333; font-weight: 600; font-size: 14px; border: none; background: transparent; width: 100%; outline: none;" />
            <div style="background: var(--color-primary); width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; cursor: pointer;">
              ${icon('search', 18)}
            </div>
          </div>
        </div>
      </div>
      
      <style>
        @media (min-width: 1024px) {
          .mobile-header-only { display: none !important; }
        }
      </style>
    `;

    // Re-bind location selector
    const locationBtn = document.getElementById('header-location-selector');
    if (locationBtn) {
      locationBtn.addEventListener('click', () => {
        showAddressPrompt(null, { mode: 'pick' });
      });
    }
    
    // Dynamic Scroll Compression Effect
    const searchContainer = document.getElementById('header-search-container');
    const searchExpandBtn = document.getElementById('header-search-expand-btn');
    
    if (searchContainer && searchExpandBtn) {
      if (window._headerScrollHandler) {
        window.removeEventListener('scroll', window._headerScrollHandler, { capture: true });
      }

      window._headerScrollHandler = (e) => {
        // Only run on mobile and on home page
        const h = window.location.hash;
        if ((h !== '#/' && h !== '#' && h !== '') || window.innerWidth >= 1024) return;
        
        const target = e.target;
        const isPanel = target.classList && target.classList.contains('slide-panel');
        const isDocument = target === document || target === window;
        if (!isPanel && !isDocument) return;

        let scrollTop = isPanel ? target.scrollTop : (window.scrollY || document.documentElement.scrollTop);
        
        // Calculate progress (0 to 1) over 120px of scroll for a slower, longer animation
        let progress = Math.min(Math.max(scrollTop / 120, 0), 1);
        
        // Use requestAnimationFrame for smooth progressive rendering
        requestAnimationFrame(() => {
          // Progressively compress search container
          searchContainer.style.height = (62 * (1 - progress)) + 'px';
          searchContainer.style.opacity = 1 - Math.pow(progress, 1.5);
          searchContainer.style.paddingBottom = (16 * (1 - progress)) + 'px';
          searchContainer.style.transform = `translateY(${-10 * progress}px)`;
          searchContainer.style.pointerEvents = progress > 0.5 ? 'none' : 'auto';

          // Progressively expand search button on the right, pushing others
          searchExpandBtn.style.width = (38 * progress) + 'px';
          searchExpandBtn.style.marginLeft = (12 * progress) + 'px';
          searchExpandBtn.style.opacity = progress;
          searchExpandBtn.style.transform = `scale(${0.5 + (0.5 * progress)})`;
          searchExpandBtn.style.pointerEvents = progress > 0.8 ? 'auto' : 'none';
        });
      };

      window.addEventListener('scroll', window._headerScrollHandler, { capture: true, passive: true });
      
      // Expand Button Logic (scroll to top and focus)
      searchExpandBtn.addEventListener('click', () => {
        const activePanels = document.querySelectorAll('.slide-panel.active, .slide-panel');
        activePanels.forEach(p => {
          if (p.scrollTop > 0) {
            p.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => document.getElementById('header-search')?.focus(), 400);
      });
    }
    initSearchSuggestions();

  } else {
    if (window.innerWidth < 1024) {
      header.style.setProperty('background', 'var(--color-primary)', 'important');
      header.style.setProperty('border-bottom-left-radius', '28px', 'important');
      header.style.setProperty('border-bottom-right-radius', '28px', 'important');
      header.style.setProperty('box-shadow', '0 10px 30px rgba(var(--color-primary-rgb), 0.3)', 'important');
      header.style.setProperty('border', 'none', 'important');
      header.style.setProperty('backdrop-filter', 'none', 'important');
      header.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      header.style.setProperty('margin', '0', 'important');
      header.style.setProperty('padding', '0', 'important');
      header.style.setProperty('position', 'sticky', 'important');
      header.style.setProperty('top', '0', 'important');
      header.style.setProperty('z-index', '2000', 'important');
      header.style.setProperty('overflow', 'visible', 'important');
    } else {
      header.style.removeProperty('background');
      header.style.removeProperty('border-bottom-left-radius');
      header.style.removeProperty('border-bottom-right-radius');
      header.style.removeProperty('box-shadow');
      header.style.removeProperty('border');
      header.style.removeProperty('backdrop-filter');
      header.style.removeProperty('-webkit-backdrop-filter');
      header.style.removeProperty('margin');
      header.style.removeProperty('padding');
      header.style.removeProperty('position');
      header.style.removeProperty('top');
      header.style.removeProperty('z-index');
      header.style.removeProperty('overflow');
    }

    // SUB-PAGE HEADER: Dynamic Title + Gradient + Circles
    let title = 'Notificaciones';
    if (hash.startsWith('#/profile/orders')) title = 'Mis Pedidos';
    else if (hash.startsWith('#/profile')) title = 'Mi Perfil';
    else if (hash.startsWith('#/gofavores')) title = 'Mandados';
    else if (hash.startsWith('#/category')) {
       title = decodeURIComponent(hash.split('/').pop());
    } else if (hash.startsWith('#/cart')) title = 'Mi Carrito';
    else if (hash.startsWith('#/admin/support-chats')) title = 'Mesa de Ayuda';

    header.innerHTML = `
      ${desktopHeaderHTML}
      <div class="mobile-header-only" style="width:100%; padding-top: ${topPadding};">
        <div class="header-nav-sub" style="display: flex; align-items: center; padding: 12px 16px 20px 16px; position: relative; overflow: hidden; margin: 0; border: none;">
          <!-- Decorative Circles -->
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          
          <div style="background: none; border: none; color: white; display: flex; align-items: center; gap: 12px; padding: 0; position: relative; z-index: 2;">
            ${(hash === '#/profile' || hash.startsWith('#/profile/orders') || hash.startsWith('#/cart') || hash.startsWith('#/admin/support-chats')) ? '' : `
              <button onclick="(() => {
                const oldHash = window.location.hash;
                window.history.back();
                setTimeout(() => {
                  if (window.location.hash === oldHash) {
                    window.location.hash = '#/';
                  }
                }, 100);
              })()" style="background: none; border: none; color: white; cursor: pointer; padding: 0; display: flex;">
                ${icon('chevronLeft', 28)}
              </button>
            `}
            <span style="font-weight: 800; font-size: 20px; letter-spacing: -0.02em;">${title}</span>
          </div>
        </div>
      </div>
      
      <style>
        @media (min-width: 1024px) {
          .mobile-header-only { display: none !important; }
        }
      </style>
    `;
  }

  // Desktop Header event bindings
  const destLocationBtn = document.getElementById('desktop-location-selector');
  if (destLocationBtn) {
    destLocationBtn.onclick = (e) => {
      e.stopPropagation();
      const wrapper = destLocationBtn.closest('.desktop-address-box-wrapper');
      if (wrapper) wrapper.classList.toggle('active');
    };
  }

  // Bind clicks on address dropdown items
  const addrDropdownItems = header.querySelectorAll('.desktop-address-dropdown .addr-dropdown-item');
  addrDropdownItems.forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const wrapper = item.closest('.desktop-address-box-wrapper');
      if (wrapper) wrapper.classList.remove('active');

      if (item.classList.contains('add-new-trigger')) {
        setTimeout(() => {
          showAddressPrompt();
        }, 150);
        return;
      }

      const id = item.dataset.id;
      const saved = getState().savedAddresses || [];
      const addr = saved.find(a => a.id === id);
      if (addr) {
        setDeliveryAddress(addr.address, addr.notes || '', addr.coords, '');
      }
    };
  });

  // Global click outside to dismiss address selector
  document.addEventListener('click', () => {
    const wrappers = document.querySelectorAll('.desktop-address-box-wrapper');
    wrappers.forEach(w => w.classList.remove('active'));
  }, { once: false });

  const destSearchInput = document.getElementById('desktop-search-input');
  const destSearchBtn = document.getElementById('desktop-search-button');
  
  const handleDesktopSearchSubmit = () => {
    const val = (destSearchInput ? destSearchInput.value : '').trim();
    if (val) {
      window.location.hash = `#/category/Comida?q=${encodeURIComponent(val)}`;
    }
  };

  if (destSearchInput) {
    destSearchInput.onkeydown = (e) => {
      if (e.key === 'Enter') handleDesktopSearchSubmit();
    };
  }
  if (destSearchBtn) {
    destSearchBtn.onclick = () => handleDesktopSearchSubmit();
  }

  // Bind click on dropdown notification items
  const notifItems = header.querySelectorAll('.notif-dropdown-item-card');
  notifItems.forEach(item => {
    item.onclick = async (e) => {
      e.stopPropagation();
      const id = item.dataset.id;
      const url = item.dataset.url;
      const clickable = item.dataset.clickable === 'true';
      const user = getState().user;
      if (user) {
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'notifications', id));
        } catch (err) {}
      }
      
      if (!clickable) return;

      if (url) {
        // Validate route exists in orders/chats if it contains order ID
        const orderMatch = url.match(/#\/pedido\/([^/]+)/);
        if (orderMatch && orderMatch[1]) {
          const orderId = orderMatch[1];
          try {
            const { getDoc, doc } = await import('firebase/firestore');
            const oDoc = await getDoc(doc(db, 'orders', orderId));
            if (!oDoc.exists()) {
              showToast('El pedido no existe o fue eliminado', 'error');
              return;
            }
            const orderData = oDoc.data();
            const status = orderData.status;
            if (status === 'completed' || status === 'cancelled' || status === 'entregado' || status === 'cancelado') {
              showToast('Este pedido ya ha sido finalizado', 'info');
              return;
            }
          } catch (err) {
            console.error('[HeaderNotifications] Failed to verify order existence:', err);
            return;
          }
        }
        window.location.hash = url;
      }
    };
  });

  // Bind mark all as read button
  const markAllBtn = header.querySelector('#desktop-mark-all-read-btn');
  if (markAllBtn) {
    markAllBtn.onclick = async (e) => {
      e.stopPropagation();
      const user = getState().user;
      if (!user) return;
      
      const unreads = filteredNotifs.filter(n => n.status === 'unread');
      for (const n of unreads) {
        try {
          await updateDoc(doc(db, 'users', user.uid, 'notifications', n.id), { status: 'read' });
        } catch (err) {}
      }
    };
  }

  // Dynamically set --header-height based on actual rendered header height
  requestAnimationFrame(() => {
    const hdr = document.getElementById('app-header');
    if (hdr && hdr.offsetHeight > 0) {
      document.documentElement.style.setProperty('--header-height', `${hdr.offsetHeight}px`);
    }
  });
}

function formatNotifTime(ts) {
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

let lastUnreadCount = -1;
let globalNotifUnsub = null;

export function initHeader() {
  renderHeader();

  const startGlobalNotifListener = (user) => {
    if (globalNotifUnsub) { globalNotifUnsub(); globalNotifUnsub = null; }
    if (!user) return;
    
    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    globalNotifUnsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unreadCount = items.filter(n => n.status === 'unread').length;
      setState({ notifications: items, unreadNotifications: unreadCount });
    }, (err) => {
      console.warn('[GlobalNotifications] Error:', err);
    });
  };

  const user = getState().user;
  if (user) startGlobalNotifListener(user);

  const unsub1 = subscribe('user', (newUser) => {
    startGlobalNotifListener(newUser);
    renderHeader();
  });
  const unsub2 = subscribe('deliveryAddress', () => renderHeader());
  const unsub3 = subscribe('unreadNotifications', (count) => {
    if (count !== lastUnreadCount) {
      const increased = count > lastUnreadCount;
      lastUnreadCount = count;
      renderHeader();

      // If count increased, trigger bell animation
      if (increased) {
        const trigger = document.getElementById('notifications-trigger');
        if (trigger) {
          trigger.classList.add('new-notification');
          setTimeout(() => trigger.classList.remove('new-notification'), 1000);
        }
      }
    }
  });
  const unsubNotifs = subscribe('notifications', () => renderHeader());

  window.addEventListener('hashchange', () => renderHeader());
}

function showAddressSelector() {
  const saved = getState().savedAddresses || [];
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); top: var(--space-5); border-top-left-radius: 28px; border-top-right-radius: 28px;';
  
  modalContent.innerHTML = `
    <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 20px;"></div>
    <h2 style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; color: var(--color-text-primary); margin-bottom: 24px; text-align: center;">Elige tu dirección</h2>
    
    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
      ${saved.map(addr => `
        <div class="addr-select-item" data-id="${addr.id}" style="padding: 16px; background: var(--color-bg-secondary); border-radius: 18px; display: flex; align-items: center; gap: 14px; cursor: pointer; border: 1.5px solid transparent; transition: all 0.2s; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;">
            <div style="color: var(--color-primary); flex-shrink: 0;">${icon(addr.name.toLowerCase().includes('casa') ? 'home' : (addr.name.toLowerCase().includes('trabajo') || addr.name.toLowerCase().includes('oficina') ? 'store' : 'mapPin'), 20)}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 800; font-size: 15px; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${addr.name}</div>
              <div style="font-size: 13px; color: var(--color-text-tertiary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${addr.address}</div>
            </div>
          </div>
          <!-- Edit button with stopPropagation -->
          <button class="addr-edit-btn" data-id="${addr.id}" style="background: none; border: none; padding: 8px; color: var(--color-text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s; flex-shrink: 0;">
            ${icon('edit', 18)}
          </button>
        </div>
      `).join('')}
      
      <div id="add-new-addr-btn" style="padding: 16px; background: var(--color-surface); border: 1.5px dashed var(--color-border); border-radius: 18px; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: all 0.2s;">
        <div style="color: var(--color-primary);">${icon('plus', 20)}</div>
        <div style="font-weight: 800; font-size: 15px; color: var(--color-text-primary);">Agregar una nueva dirección</div>
      </div>
    </div>

    <style>
      .addr-select-item {
        border: 1.5px solid transparent !important;
      }
      .addr-select-item:hover {
        border-color: var(--color-primary-light) !important;
        background: var(--color-bg-secondary) !important;
        opacity: 0.95;
      }
      .addr-edit-btn {
        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      }
      .addr-edit-btn:hover {
        background: var(--color-border-light) !important;
        color: var(--color-primary) !important;
        transform: scale(1.15) rotate(5deg);
      }
      #add-new-addr-btn {
        transition: all 0.2s ease-in-out !important;
      }
      #add-new-addr-btn:hover {
        background: var(--color-bg-secondary) !important;
        border-color: var(--color-primary) !important;
        transform: translateY(-1px);
      }
    </style>
  `;
  
  showModal({ title: '', hideHeader: true, height: 'auto', content: modalContent });

  // Handle selections
  modalContent.querySelectorAll('.addr-select-item').forEach(item => {
    item.onclick = () => {
      const id = item.dataset.id;
      const addr = saved.find(a => a.id === id);
      if (addr) {
        setDeliveryAddress(addr.address, addr.notes || '', addr.coords, '');
        closeModal();
      }
    };
  });

  // Handle edits
  modalContent.querySelectorAll('.addr-edit-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation(); // Avoid triggering selection
      const id = btn.dataset.id;
      const addr = saved.find(a => a.id === id);
      if (addr) {
        closeModal();
        setTimeout(() => {
          showAddressPrompt(null, { editAddress: addr });
        }, 350);
      }
    };
  });

  const addBtn = modalContent.querySelector('#add-new-addr-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      closeModal();
      setTimeout(() => {
        showAddressPrompt();
      }, 350);
    };
  }
}
