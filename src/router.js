import { isAdmin, isSuperAdmin, isComercio, isDelivery, isLoggedIn } from './auth.js';
import { getState, subscribe } from './state.js';
import { clearActiveListeners } from './utils/cleanup.js';

let routes = {};
let currentCleanup = null;

export function registerRoutes(routeMap) {
  routes = routeMap;
}

export function navigate(path) {
  window.location.hash = path;
}

const getMainRoutes = () => {
  const list = {
    '/': 'page-home',
    '/mi-comercio': 'page-commerce',
    '/mi-comercio/:id/orders': 'page-commerce',
    '/delivery': 'page-delivery',
    '/cart': 'page-cart',
    '/profile': 'page-profile',
    '/profile/orders': 'page-profile',
    '/profile/appearance': 'page-profile',
    '/mis-chats': 'page-mis-chats'
  };
  if (!isDelivery()) delete list['/delivery'];
  if (!isComercio() && !isAdmin()) {
    delete list['/mi-comercio'];
    delete list['/mi-comercio/:id/orders'];
  }
  return list;
};

export function getRouteParams() {
  const fullHash = window.location.hash.slice(1) || '/';
  const hash = fullHash.split('?')[0]; // Ignore query params for matching
  const params = {};
  
  // Match dynamic routes like /comercio/:id
  for (const pattern of Object.keys(routes)) {
    const regex = patternToRegex(pattern);
    const match = hash.match(regex);
    if (match) {
      const paramNames = (pattern.match(/:(\w+)/g) || []).map(p => p.slice(1));
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      params._pattern = pattern;
      params._path = hash;
      break;
    }
  }
  return params;
}

function patternToRegex(pattern) {
  const regexStr = '^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$';
  return new RegExp(regexStr);
}

function matchRoute(hash) {
  for (const pattern of Object.keys(routes)) {
    const regex = patternToRegex(pattern);
    if (regex.test(hash)) {
      return { pattern, handler: routes[pattern] };
    }
  }
  return null;
}

let isProgrammaticScroll = false;
let isRouting = false;

async function handleRoute() {
  isRouting = true;
  try {
    const fullHash = window.location.hash.slice(1) || '/';
    const hash = fullHash.split('?')[0]; // Ignore query params for matching
    const slider = document.getElementById('app-slider');
    const overlay = document.getElementById('app-overlay');
    
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    clearActiveListeners();

    if (getState().loading) return;

    const match = matchRoute(hash);
    if (!match) return;

    const { pattern, handler } = match;

    const mainRoutes = getMainRoutes();

    if (mainRoutes[pattern]) {
      overlay.classList.remove('active');
      overlay.classList.remove('panel-fullscreen');
      document.body.classList.remove('overlay-open');
      overlay.innerHTML = '';

      const locationSelector = document.getElementById('header-location-selector');
      if (locationSelector) {
        if (pattern === '/') {
          locationSelector.style.display = 'flex';
          locationSelector.style.opacity = '1';
          locationSelector.style.pointerEvents = 'auto';
        } else {
          locationSelector.style.display = 'none';
          locationSelector.style.opacity = '0';
          locationSelector.style.pointerEvents = 'none';
        }
      }

      const targetId = mainRoutes[pattern];
      const panel = document.getElementById(targetId);
      
      // 1. First, start the animation to the target panel (Immediate visual feedback)
      if (slider) {
        const uniquePanels = [...new Set(Object.values(mainRoutes))];
        const panelId = mainRoutes[pattern];
        const index = uniquePanels.indexOf(panelId);
        const width = slider.clientWidth || window.innerWidth;
        const targetX = index * width;
        
        if (Math.abs(slider.scrollLeft - targetX) > 10) {
          isProgrammaticScroll = true;
          slider.scrollTo({ left: targetX, behavior: 'auto' });
          setTimeout(() => { isProgrammaticScroll = false; }, 100);
        }
        updateUI(index, targetX);
      }

      // 2. Then, update the content
      // 2. Then, update the content
      // 2. Then, update the content
      // 2. Then, update the content
      if (panel) {
        // Pass the panel directly as the container
        panel.innerHTML = ''; // Clear to ensure animation re-triggers
        try {
          const result = await handler(panel);
          
          if (result && result.cleanup) {
            currentCleanup = result.cleanup;
          }
        } catch (err) {
          console.error('Route error (main):', err);
          panel.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; text-align:center;">
              <div style="width:64px; height:64px; background:rgba(227,27,35,0.1); color:#E31B23; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:16px;">
                <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              </div>
              <h3 style="font-family:var(--font-display); font-size:18px; font-weight:800; margin-bottom:8px;">Error al cargar</h3>
              <p style="color:var(--color-text-secondary); font-size:14px; margin-bottom:24px;">Hubo un problema al cargar esta sección. Verificá tu conexión a internet.</p>
              <button onclick="window.location.reload()" style="background:var(--color-primary); color:white; border:none; padding:12px 24px; border-radius:12px; font-weight:700; cursor:pointer;">Recargar página</button>
            </div>
          `;
        }
      }


    } else {
      // Overlay routes (Sub-pages, Modals, etc.)
      overlay.classList.add('active');
      
      // Sub-pages like /profile/* should be full screen (except support-chats)
      if (hash.startsWith('/profile/') || hash.startsWith('/marketplace') || hash.startsWith('/mi-comercio/') || hash.startsWith('/pedido/') || (hash.startsWith('/admin') && !hash.startsWith('/admin/support-chats')) || hash === '/notifications' || hash.startsWith('/comercio/') || hash === '/viajes' || hash.startsWith('/gofavores') || hash.startsWith('/delivery/')) {
        overlay.classList.add('panel-fullscreen');
      } else {
        overlay.classList.remove('panel-fullscreen');
      }

      document.body.classList.add('overlay-open');
      overlay.innerHTML = '<div id="overlay-render-target" style="width:100%; height:100%;"></div>';
      const target = document.getElementById('overlay-render-target');
      target.id = 'app-content';
      
      // Force scroll top for overlay
      overlay.scrollTop = 0;

      try {
        // Pass the overlay target directly
        const result = await handler(target);
        if (result && result.cleanup) {
          const originalCleanup = result.cleanup;
          currentCleanup = () => {
            originalCleanup();
            overlay.innerHTML = '';
          };
        }
      } catch (err) {
        console.error('Route error (overlay):', err);
        target.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:24px; text-align:center; background:var(--color-bg);">
            <div style="width:64px; height:64px; background:rgba(227,27,35,0.08); color:#E31B23; border-radius:24px; display:flex; align-items:center; justify-content:center; margin-bottom:20px; box-shadow:0 8px 20px rgba(227,27,35,0.15);">
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            <h3 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:var(--color-text); margin-bottom:8px; letter-spacing:-0.02em;">Ups, algo salió mal</h3>
            <p style="color:var(--color-text-secondary); font-size:14px; margin-bottom:32px; max-width:320px; line-height:1.5;">Ocurrió un error inesperado al cargar esta pantalla. Por favor, intentá nuevamente.</p>
            <div style="display:flex; gap:12px; width:100%; max-width:320px;">
              <a href="#/" style="flex:1; height:48px; border-radius:14px; background:var(--color-bg-secondary); border:1px solid var(--color-border); color:var(--color-text); font-weight:700; text-decoration:none; display:flex; align-items:center; justify-content:center; font-size:14px;">Ir al Inicio</a>
              <button onclick="window.location.reload()" style="flex:1; height:48px; border-radius:14px; background:var(--color-primary); border:none; color:white; font-weight:700; cursor:pointer; font-size:14px; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.2);">Recargar</button>
            </div>
          </div>
        `;
      }
    }
  } finally {
    isRouting = false;
  }
}

// Helper to update UI based on index
const updateUI = (index, scrollX) => {
  const slider = document.getElementById('app-slider');
  if (!slider) return;
  
  const mainRoutes = getMainRoutes();
  const width = slider.clientWidth || window.innerWidth;
  const uniquePanels = [...new Set(Object.values(mainRoutes))];
  const routesList = Object.keys(mainRoutes);
  // Map index to the first route that uses that panel
  const panelId = uniquePanels[index];
  const firstRoute = routesList.find(r => mainRoutes[r] === panelId);
  const targetHash = '#' + firstRoute;
  
  // Hide/Show panels based on authorization
  ['page-home', 'page-commerce', 'page-delivery', 'page-cart', 'page-profile'].forEach(id => {
    const p = document.getElementById(id);
    if (!p) return;
    if (Object.values(mainRoutes).includes(id)) {
      p.style.display = 'block';
      if (id === panelId) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    } else {
      p.style.display = 'none';
      p.classList.remove('active');
    }
  });

  // 1. Sync Navbar
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const href = item.getAttribute('href') || '';
    const label = item.innerText.toLowerCase();
    
    // Match by href or by label (Home/Cart/Profile/Delivery)
    const isHome = (targetHash === '#/' || targetHash === '#') && (href === '#/' || href === '#' || label.includes('inicio'));
    const isCommerce = targetHash.startsWith('#/mi-comercio') && (href === '#/mi-comercio' || label.includes('comercio'));
    const isCart = targetHash === '#/cart' && (href === '#/cart' || label.includes('carrito'));
    const isProfile = targetHash === '#/profile' && (href === '#/profile' || label.includes('perfil'));
    const isDeliveryNav = targetHash === '#/delivery' && (href === '#/delivery' || label.includes('delivery'));
    
    const isMatch = isHome || isCommerce || isCart || isProfile || isDeliveryNav;
    
    if (isMatch) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // 2. Sync Header (Address)
  const locationSelector = document.getElementById('header-location-selector');
  if (locationSelector) {
    // Hide explicitly if on delivery or if not on home
    if (index === 0 && targetHash === '#/') {
      const progress = scrollX / width;
      const opacity = Math.max(0, 1 - (progress * 3)); // Fade out faster
      locationSelector.style.opacity = opacity;
      locationSelector.style.display = opacity <= 0.05 ? 'none' : 'flex';
      locationSelector.style.pointerEvents = opacity < 0.5 ? 'none' : 'auto';
    } else {
      locationSelector.style.display = 'none';
      locationSelector.style.opacity = '0';
      locationSelector.style.pointerEvents = 'none';
    }
  }

};

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  
  // Rescale horizontal slider on window resize to prevent out-of-bound blank screens
  window.addEventListener('resize', () => {
    const slider = document.getElementById('app-slider');
    if (!slider) return;
    const mainRoutes = getMainRoutes();
    const uniquePanels = [...new Set(Object.values(mainRoutes))];
    const activePanel = document.querySelector('.slide-panel.active');
    if (activePanel) {
      const index = uniquePanels.indexOf(activePanel.id);
      if (index !== -1) {
        const width = slider.clientWidth || window.innerWidth;
        isProgrammaticScroll = true;
        slider.scrollLeft = index * width;
        setTimeout(() => { isProgrammaticScroll = false; }, 100);
      }
    }
  });
  
  const setupSliderSync = () => {
    const slider = document.getElementById('app-slider');
    if (!slider) {
      // If not found yet, try again in a bit (for dynamic rendering)
      setTimeout(setupSliderSync, 100);
      return;
    }

    console.log('Slider sync initialized');

    // Unified Scroll Listener
    let scrollTimeout;
    slider.addEventListener('scroll', () => {
      if (isProgrammaticScroll || isRouting) return;
      
      const width = slider.clientWidth || window.innerWidth;
      const scrollX = slider.scrollLeft;
      const index = Math.round(scrollX / width);
      
      updateUI(index, scrollX);

      // Debounced URL Sync
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const mainRoutes = getMainRoutes();
        const uniquePanels = [...new Set(Object.values(mainRoutes))];
        const targetPanelId = uniquePanels[index];
        
        // Find if current hash already belongs to this panel
        const currentHash = window.location.hash.slice(1).split('?')[0];
        const currentMatch = matchRoute(currentHash);
        const currentPattern = currentMatch ? currentMatch.pattern : null;
        const currentPanelId = currentPattern ? mainRoutes[currentPattern] : null;

        if (currentPanelId !== targetPanelId) {
          const routesList = Object.keys(mainRoutes);
          const firstRouteForPanel = routesList.find(r => mainRoutes[r] === targetPanelId);
          const targetHash = '#' + firstRouteForPanel;

          isProgrammaticScroll = true;
          window.location.hash = targetHash;
          setTimeout(() => { isProgrammaticScroll = false; }, 100);
        }
      }, 150);
    }, { passive: true });
  };

  setupSliderSync();
  handleRoute();
}













// Called after auth is ready
export function routerReady() {
  handleRoute();
}
