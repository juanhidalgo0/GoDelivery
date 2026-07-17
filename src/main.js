// GoDelivery — Main Entry Point
import { registerRoutes, initRouter, routerReady } from './router.js';
import { initAuth, isDelivery, isComercio } from './auth.js';
import { initTheme, loadCart, getState, initSettings } from './state.js';
import { initPushNotifications } from './utils/notifications.js';
import { AudioManager } from './utils/audio-manager.js';
import { db } from './firebase.js';
import { icon } from './utils/icons.js';
import { initScrollAnimations } from './utils/scroll-animations.js';

// Initialize audio system
AudioManager.init();

async function init() {
  // Restore last route hash on startup to handle Android activity destruction recovery
  try {
    const lastHash = localStorage.getItem('gd_last_hash');
    if (lastHash && lastHash !== '#/' && lastHash !== '#') {
      window.location.hash = lastHash;
    }
    window.addEventListener('hashchange', () => {
      const h = window.location.hash;
      if (h && !h.includes('reset') && !h.includes('login')) {
        localStorage.setItem('gd_last_hash', h);
      }
    });
  } catch (e) {}

  if (window.Capacitor) {
    document.body.classList.add('platform-capacitor');
    
    // Hide native splash screen immediately to transition to the animated HTML splash / login wall
    import('@capacitor/splash-screen').then(({ SplashScreen }) => {
      SplashScreen.hide();
    }).catch(err => console.warn('GoDelivery: Failed to hide native splash screen:', err));
    
    // Check for App Updates in Play Store (Android)
    import('@capawesome/capacitor-app-update').then(async ({ AppUpdate }) => {
      try {
        const result = await AppUpdate.getAppUpdateInfo();
        if (result.updateAvailability === 2) { // 2 = UPDATE_AVAILABLE
          console.log('[Version] Mandatory update found on Play Store. Forcing update...');
          await AppUpdate.performImmediateUpdate();
        }
      } catch (err) {
        console.warn('GoDelivery: Failed to check for Play Store updates:', err);
      }
    }).catch(err => console.warn('Failed to load AppUpdate plugin:', err));

    import('@capacitor/app').then(({ App }) => {
      App.addListener('backButton', () => {
        const hash = window.location.hash || '#/';
        const isHome = hash === '#/' || hash === '#' || hash === '' || hash === '#/profile' || hash === '#/notifications' || hash === '#/cart' || hash === '#/gofavores';
        
        // Close modal first if any is open
        const openModal = document.querySelector('.modal-container-v2') || document.querySelector('.modal-container');
        if (openModal) {
          import('./components/modal.js').then(m => m.closeModal());
          return;
        }

        if (!isHome) {
          window.history.back();
        } else {
          App.exitApp();
        }
      });
    }).catch(err => console.warn('Failed to load Capacitor App plugin:', err));
  }
  // Seed Database: Pizzería category and Dany's Pizza categories
  try {
    const runOnceKey = 'gd_seed_remove_pizzeria_2026_07_11';
    if (!localStorage.getItem(runOnceKey)) {
      const { doc, deleteDoc, collection, getDocs, query, updateDoc } = await import('firebase/firestore');
      
      // 1. Delete Pizzería category from platformCategories
      await deleteDoc(doc(db, 'platformCategories', 'pizzeria'));
      
      // 2. Find Dany's Pizza and clean up its categories
      const comQuery = query(collection(db, 'comercios'));
      const comSnap = await getDocs(comQuery);
      for (const d of comSnap.docs) {
        const cData = d.data();
        if (cData.name && cData.name.toLowerCase().includes("dany's pizza")) {
          await updateDoc(doc(db, 'comercios', d.id), {
            category: 'Comida',
            categories: ['Comida']
          });
          console.log("Updated Dany's Pizza to Comida!");
        }
      }
      
      localStorage.setItem(runOnceKey, 'true');
      console.log("Pizzería category deleted and Dany's Pizza cleaned up!");
    }
  } catch (err) {
    console.error('Error removing Pizzería category:', err);
  }

  // Force-update check against version.json
  try {
    const vRes = await fetch('/version.json?cb=' + Date.now());
    if (vRes.ok) {
      const vData = await vRes.json();
      const currentVer = localStorage.getItem('gd_app_version');
      if (currentVer && currentVer !== String(vData.version)) {
        console.log('[Version] New version detected:', vData.version, '. Clearing app caches and reloading...');
        
        // Clear Firestore cache
        try {
          const { terminate, clearIndexedDbPersistence } = await import('firebase/firestore');
          const { db: firestoreDb } = await import('./firebase.js');
          await terminate(firestoreDb);
          await clearIndexedDbPersistence(firestoreDb);
          console.log('[Version] Firestore IndexedDb cache cleared successfully.');
        } catch (dbErr) {
          console.warn('[Version] Failed to clear Firestore IndexedDb:', dbErr);
        }

        // Unregister service workers
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) {
            await r.unregister();
          }
        }
        
        // Clear all caches
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        }

        // Update version in localStorage (do NOT clear localStorage/sessionStorage to preserve session and state)
        localStorage.setItem('gd_app_version', String(vData.version));
        
        // Force reload bypassing HTTP cache
        window.location.reload();
        return;
      } else if (!currentVer) {
        localStorage.setItem('gd_app_version', String(vData.version));
      }
    }
  } catch (err) {
    console.warn('[Version] Check failed:', err);
  }

  // Capture referral code from URL (?ref=GO-REF-XXXX)
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode && refCode.startsWith('GO-REF-')) {
    sessionStorage.setItem('gd-referred-by', refCode);
    console.log('[Auth] Captured referral code from URL:', refCode);
  }

  const startTime = Date.now();
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/firebase-messaging-sw.js')
        .then(reg => {
          console.log('GoDelivery: Service Worker registered');
          
          // Check for updates every time the app opens
          reg.update();

          // If there's already a waiting worker, skip waiting immediately
          if (reg.waiting) {
            console.log('GoDelivery: Found waiting Service Worker. Updating...');
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    // New version available! Force skip waiting
                    console.log('GoDelivery: New version found. Updating...');
                    installingWorker.postMessage({ type: 'SKIP_WAITING' });
                  }
                }
              };
            }
          };
        })
        .catch(err => console.error('GoDelivery: SW registration failed', err));
    });

    // Handle the controller change (activation of the new SW)
    let refreshing = false;
    const hasExistingController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasExistingController && !refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    // Listen for navigation messages from Service Worker (e.g. background notification clicks)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'NAVIGATE' && event.data.url) {
        console.log('GoDelivery: SW navigation message received:', event.data.url);
        const match = event.data.url.match(/#\/.*$/);
        if (match) {
          window.location.hash = match[0];
        } else {
          window.location.hash = '#/';
        }
      }
    });
  }

  // Import PWA logic to start listening for prompt
  import('./components/install-prompt.js');

  // Enforce App Installation
  import('./components/install-lock.js').then(m => m.ensureAppInstalled());

  // Run cache eviction sweep
  import('./utils/firestore-cache.js').then(m => m.evictExpiredCache());

  // Theme
  initTheme();

  // Scroll animations
  initScrollAnimations();

  // Clear any leftover banners
  import('./components/banner-manager.js').then(m => m.clearAllBanners());

  // Load saved cart
  loadCart();

  // Load global settings (non-blocking)
  initSettings();

  async function ensureAdminOwnership(comercioId) {
    const user = getState().user;
    if (!user) return;
    const { isAdmin } = await import('./auth.js');
    if (isAdmin()) {
      try {
        const { doc, getDoc, updateDoc } = await import('firebase/firestore');
        const { db } = await import('./firebase.js');
        const snap = await getDoc(doc(db, 'comercios', comercioId));
        if (snap.exists()) {
          const data = snap.data();
          const name = (data.name || '').toLowerCase();
          if (name.includes('go!') && name.includes('market')) {
            if (data.ownerId !== user.uid) {
              console.log(`[Admin Ownership Sync] Syncing ownerId for Go Market (${comercioId}) to admin ${user.uid}`);
              // Fire and forget so it doesn't block loading
              updateDoc(doc(db, 'comercios', comercioId), { ownerId: user.uid })
                .then(() => console.log('[Admin Ownership Sync] Result: Success'))
                .catch(err => console.warn('[Admin Ownership Sync] Update Failed:', err));
            }
          }
        }
      } catch (err) {
        console.warn('[Admin Ownership Sync] Failed:', err);
      }
    }
  }

  async function checkCommerceAccessPin(comercioId, container) {
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('./firebase.js');
    const { isAdmin } = await import('./auth.js');
    
    // Admins bypass PIN check
    if (isAdmin()) {
      return true;
    }
    
    try {
      const snap = await getDoc(doc(db, 'comercios', comercioId));
      if (!snap.exists()) return true;
      const data = snap.data();
      const pin = data.pin;
      
      console.log(`[PIN Check] id: ${comercioId}, pin in DB: "${pin}", session auth: "${sessionStorage.getItem('gd-comercio-auth-' + comercioId)}"`);

      if (!pin || pin.trim() === '') {
        return true;
      }
      
      if (sessionStorage.getItem('gd-comercio-auth-' + comercioId) === 'true') {
        return true;
      }
      
      showPinLockScreen(comercioId, data.name, data.logo, pin, container);
      return false;
    } catch (e) {
      console.error('Error checking commerce pin:', e);
      return true;
    }
  }

  function showPinLockScreen(comercioId, commerceName, logoUrl, correctPin, container) {
    const content = container || document.getElementById('app-content');
    if (!content) return;
    
    const style = document.createElement('style');
    style.id = 'pin-screen-styles';
    style.innerHTML = `
      .pin-dot {
        width: 14px;
        height: 14px;
        border: 2px solid var(--color-primary);
        border-radius: 50%;
        transition: all 0.2s;
      }
      .pin-dot.filled {
        background: var(--color-primary);
        transform: scale(1.15);
        box-shadow: 0 0 10px rgba(var(--color-primary-rgb), 0.5);
      }
      .pin-key {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: 1px solid var(--color-border-light);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: 22px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s;
        -webkit-user-select: none;
        user-select: none;
      }
      .pin-key:active {
        background: var(--color-primary-light);
        color: var(--color-primary);
        border-color: var(--color-primary);
        transform: scale(0.92);
      }
      @keyframes pin-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-8px); }
        40%, 80% { transform: translateX(8px); }
      }
      .pin-shake-anim {
        animation: pin-shake 0.3s ease-in-out;
      }
    `;
    document.getElementById('pin-screen-styles')?.remove();
    document.head.appendChild(style);
    
    content.innerHTML = `
      <div style="width:100%; min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; background:var(--color-bg-page); box-sizing:border-box; position:relative; z-index: 99999;">
        <div style="position: absolute; top: 20px; left: 20px;">
          <button id="pin-back-btn" class="btn btn-ghost" style="display:flex; align-items:center; gap:8px; font-weight:800; font-size:13px; color:var(--color-text-secondary); background:var(--color-bg-secondary); border-radius:12px; padding:8px 16px; border:1px solid var(--color-border-light);">
            ${icon('chevronLeft', 16)} VOLVER
          </button>
        </div>

        <div style="text-align:center; max-width:320px; width:100%; display:flex; flex-direction:column; align-items:center; gap:24px;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
            <img src="${logoUrl || '/logo.png'}" alt="${commerceName}" style="width:80px; height:80px; border-radius:50%; object-fit:cover; border:3px solid var(--color-primary); box-shadow:0 8px 24px rgba(var(--color-primary-rgb), 0.25);" />
            <h2 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:var(--color-text-primary); margin:0;">${commerceName}</h2>
            <p style="font-size:12px; color:var(--color-text-secondary); margin:0; line-height:1.4; font-weight:650;">Panel protegido. Ingresá el PIN numérico de acceso.</p>
          </div>

          <div id="pin-dots" style="display:flex; gap:16px; justify-content:center; height:20px;">
            <div class="pin-dot"></div>
            <div class="pin-dot"></div>
            <div class="pin-dot"></div>
            <div class="pin-dot"></div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; justify-items:center; margin-top:12px;">
            <div class="pin-key" data-val="1">1</div>
            <div class="pin-key" data-val="2">2</div>
            <div class="pin-key" data-val="3">3</div>
            <div class="pin-key" data-val="4">4</div>
            <div class="pin-key" data-val="5">5</div>
            <div class="pin-key" data-val="6">6</div>
            <div class="pin-key" data-val="7">7</div>
            <div class="pin-key" data-val="8">8</div>
            <div class="pin-key" data-val="9">9</div>
            <div class="pin-key" data-val="delete" style="font-size:14px; border:none; background:transparent; display:flex; align-items:center; justify-content:center;">${icon('delete', 22)}</div>
            <div class="pin-key" data-val="0">0</div>
            <div class="pin-key" data-val="clear" style="font-size:11px; font-weight:900; border:none; background:transparent; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-tertiary); display:flex; align-items:center; justify-content:center;">Limpiar</div>
          </div>
        </div>
      </div>
    `;
    
    let currentInput = '';
    const dots = content.querySelectorAll('.pin-dot');
    const dotsContainer = content.querySelector('#pin-dots');
    
    const updateDots = () => {
      dots.forEach((dot, idx) => {
        if (idx < currentInput.length) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      });
    };
    
    const handleKey = (val) => {
      if (val === 'delete') {
        currentInput = currentInput.slice(0, -1);
        try { AudioManager.hapticLight(); } catch(e){}
      } else if (val === 'clear') {
        currentInput = '';
        try { AudioManager.hapticLight(); } catch(e){}
      } else {
        if (currentInput.length < 4) {
          currentInput += val;
          try { AudioManager.hapticLight(); } catch(e){}
        }
      }
      
      updateDots();
      
      if (currentInput.length === 4) {
        setTimeout(() => {
          if (currentInput === correctPin) {
            sessionStorage.setItem('gd-comercio-auth-' + comercioId, 'true');
            showToast('Acceso concedido', 'success');
            try { AudioManager.playSynthPop(); } catch(e){}
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          } else {
            dotsContainer.classList.add('pin-shake-anim');
            showToast('PIN incorrecto', 'error');
            try { AudioManager.hapticLight(); } catch(e){}
            setTimeout(() => {
              dotsContainer.classList.remove('pin-shake-anim');
              currentInput = '';
              updateDots();
            }, 350);
          }
        }, 150);
      }
    };
    
    content.querySelectorAll('.pin-key').forEach(key => {
      key.onclick = () => handleKey(key.dataset.val);
    });
    
    content.querySelector('#pin-back-btn').onclick = () => {
      location.hash = '#/profile';
    };
  }

  async function wrapCommerceRoute(comercioId, container, renderFn) {
    if (comercioId) {
      await ensureAdminOwnership(comercioId);
      const accessGranted = await checkCommerceAccessPin(comercioId, container);
      if (!accessGranted) {
        return;
      }
    }
    return renderFn();
  }


  // Register all routes
  registerRoutes({
    '/': (c) => import('./pages/home.js').then(m => m.renderHome(c)),
    '/comercio/:id': (c) => import('./pages/comercio.js').then(m => m.renderComercio(c)),
    '/cart': (c) => import('./pages/cart.js').then(m => m.renderCart(c)),
    '/mis-chats': (c) => import('./pages/mis-chats.js').then(m => m.renderMisChats(c)),
    '/profile': (c) => import('./pages/profile.js').then(m => m.renderProfile(c)),
    '/profile/orders': (c) => import('./pages/profile/orders.js').then(m => m.renderProfileOrders(c)),
    '/admin': (c) => import('./pages/admin/dashboard.js').then(m => m.renderAdminDashboard(c)),
    '/admin/users': (c) => import('./pages/admin/users.js').then(m => m.renderAdminUsers(c)),
    '/admin/categories': (c) => import('./pages/admin/categories.js').then(m => m.renderAdminCategories(c)),
    '/admin/comercios': (c) => import('./pages/admin/comercios.js').then(m => m.renderAdminComercios(c)),
    '/admin/solicitudes-comercios': (c) => import('./pages/admin/solicitudes-comercios.js').then(m => m.renderAdminCommerceRequests(c)),
    '/admin/solicitudes-empleo': (c) => import('./pages/admin/solicitudes-empleo.js').then(m => m.renderAdminJobApplications(c)),
    '/admin/reviews': (c) => import('./pages/admin/reviews.js').then(m => m.renderAdminReviews(c)),
    '/admin/support-chats': (c) => import('./pages/admin/support-chats.js').then(m => m.renderAdminSupportChats(c)),
    '/admin/orders': (c) => import('./pages/admin/orders.js').then(m => m.renderAdminOrders(c)),
    '/admin/commissions': (c) => import('./pages/admin/commissions.js').then(m => m.renderAdminCommissions(c)),
    '/admin/settings': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminSettings(c)),
    '/admin/settings/logistics': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminLogisticsSettings(c)),
    '/admin/settings/economy': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminEconomySettings(c)),
    '/admin/settings/dynamic': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminDynamicSettings(c)),
    '/admin/settings/gopoints': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminGoPointsSettings(c)),
    '/admin/settings/push': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminPushSettings(c)),
    '/admin/settings/maintenance': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminMaintenanceSettings(c)),
    '/admin/broadcasts': (c) => import('./pages/admin/broadcasts.js').then(m => m.renderAdminBroadcasts(c)),
    '/admin/broadcasts/history': (c) => import('./pages/admin/broadcasts.js').then(m => m.renderAdminBroadcastsHistory(c)),
    '/admin/ads': (c) => import('./pages/admin/ads.js').then(m => m.renderAdminAds(c)),
    '/admin/gomarket': (c) => import('./pages/admin/gomarket.js').then(m => m.renderAdminGoMarket(c)),
    '/admin/offers': (c) => import('./pages/admin/offers.js').then(m => m.renderAdminOffers(c)),
    '/admin/coupons': (c) => import('./pages/admin/coupons.js').then(m => m.renderAdminCoupons(c)),
    '/admin/metrics': (c) => import('./pages/admin/metrics.js').then(m => m.renderAdminMetrics(c)),
    '/admin/metrics/services': (c) => import('./pages/admin/services-metrics.js').then(m => m.renderServicesMetrics(c)),
    '/admin/metrics/breakdown': (c) => import('./pages/admin/metrics-breakdown.js').then(m => m.renderAdminMetricsBreakdown(c)),

    '/mi-comercio': async () => {
      const user = getState().user;
      if (!user) { location.hash = '#/profile'; return; }
      
      const { isAdmin } = await import('./auth.js');
      const { collection, query, where, getDocs } = await import('firebase/firestore');

      try {
        // 1. Priorizar el comercio del cual el usuario es dueño directo
        const q = query(collection(db, 'comercios'), where('ownerId', '==', user.uid));
        const snap = await getDocs(q);
        if (!snap.empty) {
          location.hash = `#/mi-comercio/${snap.docs[0].id}/orders`;
          return;
        }

        // 2. Si no es dueño de ningún comercio pero es Admin, redirigir a Go! Market
        if (isAdmin()) {
          const allSnap = await getDocs(collection(db, 'comercios'));
          const goMarket = allSnap.docs.find(d => {
            const name = (d.data().name || '').toLowerCase();
            return name.includes('go!') && name.includes('market');
          });
          if (goMarket) {
            location.hash = `#/mi-comercio/${goMarket.id}/orders`;
            return;
          }
        }

        location.hash = '#/profile';
      } catch (err) {
        console.error('Error redirecting to commerce:', err);
        location.hash = '#/profile';
      }
    },
    '/mi-comercio/:id': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/dashboard.js').then(m => m.renderComercioDashboard(c)));
    },
    '/mi-comercio/:id/products': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/products.js').then(m => m.renderComercioProducts(c)));
    },
    '/mi-comercio/:id/sabores': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/sabores.js').then(m => m.renderComercioSabores(c)));
    },
    '/mi-comercio/:id/settings': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/settings.js').then(m => m.renderComercioSettings(c)));
    },
    '/mi-comercio/:id/orders': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      if (id) {
        await ensureAdminOwnership(id);
        sessionStorage.removeItem('gd-comercio-auth-' + id);
      }
      return import('./pages/comercio-panel/orders.js').then(m => m.renderComercioOrders(id));
    },
    '/mi-comercio/:id/finances': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/finances.js').then(m => m.renderComercioFinances(c)));
    },
    '/mi-comercio/:id/offers': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/offers.js').then(m => m.renderComercioOffers(c)));
    },
    '/mi-comercio/:id/metrics': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/metrics.js').then(m => m.renderComercioMetrics(c)));
    },
    '/mi-comercio/:id/coupons': async (c) => {
      const id = window.location.hash.split('/')[2]?.split('?')[0];
      return wrapCommerceRoute(id, c, () => import('./pages/comercio-panel/coupons.js').then(m => m.renderComercioCoupons(c)));
    },
    '/notifications': (c) => import('./pages/notifications.js').then(m => m.renderNotifications(c)),
    '/offers': (c) => import('./pages/offers-page.js').then(m => m.renderOffersPage(c)),
    '/mp-connect': (c) => import('./pages/mp-connect.js').then(m => m.renderMPConnect(c)),
    '/gofavores': (c) => import('./pages/gofavores.js').then(m => m.renderGoFavores(c)),
    '/viajes': (c) => import('./pages/viajes.js').then(m => m.renderViajes(c)),
    '/category/:id': (c) => {
      const { id } = (window.location.hash.match(/#\/category\/([^/]+)/) || [])[1] ? { id: decodeURIComponent(window.location.hash.split('/').pop()) } : { id: null };
      if (id && id.toLowerCase() === 'gomarket') {
        const cachedGmId = localStorage.getItem('gd_gomarket_id') || getState().goMarketId;
        if (cachedGmId) {
          window.history.replaceState(null, '', `#/comercio/${cachedGmId}`);
          import('./components/header.js').then(m => m.renderHeader());
          return import('./pages/comercio.js').then(m => m.renderComercio(c));
        }
      }
      return import('./pages/category.js').then(m => m.renderCategoryPage(id, c));
    },
    '/delivery': (c) => import('./pages/delivery-panel.js').then(m => m.renderDeliveryPanel(c)),
    '/delivery/history': (c) => import('./pages/delivery-panel.js').then(m => m.renderDeliveryHistory(c)),
    '/delivery/finances': (c) => import('./pages/delivery-panel.js').then(m => m.renderDeliveryFinances(c)),
    '/delivery/config': (c) => import('./pages/delivery-panel.js').then(m => m.renderDeliveryConfig(c)),
    '/pedido/:id': (c) => {
      const { id } = (window.location.hash.match(/#\/pedido\/([^/]+)/) || [])[1] ? { id: window.location.hash.split('/').pop() } : { id: null };
      return import('./pages/order-tracking.js').then(m => m.renderOrderTracking(id, c));
    },
    '/marketplace': (c) => import('./pages/marketplace.js').then(m => m.renderMarketplace(c)),
    '/marketplace/publish': (c) => import('./pages/marketplace-publish.js').then(m => m.renderPublishProduct(c)),
    '/marketplace/product/:id': (c) => {
      const parts = window.location.hash.split('/');
      const id = parts[parts.length - 1]?.split('?')[0];
      return import('./pages/marketplace-detail.js').then(m => m.renderProductDetail(id, c));
    },
    '/marketplace/chat/:id': (c) => {
      const parts = window.location.hash.split('/');
      const id = parts[parts.length - 1]?.split('?')[0];
      return import('./pages/marketplace-chat.js').then(m => m.renderMarketplaceChat(id, c));
    },
    '/profile/publications': (c) => import('./pages/marketplace-manage.js').then(m => m.renderMyPublications(c)),
    '/admin/marketplace': (c) => import('./pages/admin/marketplace.js').then(m => m.renderAdminMarketplace(c))
  });

  // Handle startup redirect query parameter (from PWA push notification clicks)
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  if (redirect) {
    window.location.hash = `#/${redirect}`;
    // Clean up query param from URL bar
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }

  // Init router
  initRouter();

  // Init auth
  initAuth(async (user) => {
    try {
      if (!user) {
        // AUTH WALL
        const header = document.getElementById('app-header');
        const navbar = document.getElementById('app-navbar');
        if (header) header.style.display = 'none';
        if (navbar) navbar.style.display = 'none';
        
        let loginWall = document.getElementById('login-wall');
        if (!loginWall) {
          loginWall = document.createElement('div');
          loginWall.id = 'login-wall';
          loginWall.style.position = 'fixed';
          loginWall.style.inset = '0';
          loginWall.style.zIndex = '1500';
          document.body.appendChild(loginWall);
        }
        
        loginWall.innerHTML = `
          <div class="login-wall-container" style="position:fixed; inset:0; background:linear-gradient(to bottom, #F9FAFB, #FFFFFF); z-index:1500; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px;">
            <div class="login-card" style="max-width:400px; width:100%; background:white; padding:40px 32px; border-radius:32px; box-shadow:0 20px 50px rgba(0,0,0,0.08); text-align:center; animation: fadeInUp 0.6s cubic-bezier(0.23, 1, 0.32, 1);">
              <div style="margin-bottom:24px;">
                <img src="/logo-brand.jpg" alt="GoDelivery" style="width:100px; height:100px; border-radius:50%; box-shadow:0 12px 30px rgba(0,0,0,0.1); border: 4px solid white;" />
              </div>
              
              <h1 style="font-family:var(--font-display); font-size:2.2rem; font-weight:900; color:#111827; margin:0 0 12px;">¡Bienvenido!</h1>
              <p style="font-size:16px; color:#6B7280; font-weight:500; line-height:1.5; margin:0 0 32px; padding:0 10px;">Iniciá sesión para empezar a pedir lo que más te gusta</p>
              
              <button id="google-login-btn" style="width:100%; height:56px; background:white; border:1px solid #E5E7EB; border-radius:100px; display:flex; align-items:center; justify-content:center; gap:12px; cursor:pointer; transition: all 0.2s ease;">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span style="font-weight:700; color:#374151; font-size:15px;">Continuar con Google</span>
              </button>

              <button id="apple-login-btn" style="width:100%; height:56px; background:black; border:none; border-radius:100px; display:flex; align-items:center; justify-content:center; gap:12px; cursor:pointer; transition: all 0.2s ease; margin-top: 12px;">
                <svg width="18" height="22" viewBox="0 0 18 22" fill="white">
                  <path d="M15.22 10.95c.04-2.73 2.23-4.04 2.33-4.11-1.27-1.86-3.25-2.11-3.95-2.16-1.68-.17-3.29.99-4.14.99-.86 0-2.19-.97-3.62-.94-1.88.03-3.61 1.1-4.57 2.76-1.95 3.37-.5 8.35 1.39 11.08.93 1.33 2.01 2.82 3.44 2.77 1.38-.05 1.9-.89 3.57-.89 1.66 0 2.14.89 3.58.86 1.46-.02 2.41-1.35 3.33-2.69 1.07-1.56 1.51-3.07 1.53-3.15-.03-.02-2.95-1.13-2.98-4.51zM11.95 2.81c.75-.91 1.25-2.18 1.11-3.44-1.08.04-2.39.72-3.17 1.63-.68.78-1.28 2.07-1.12 3.31 1.2.09 2.43-.59 3.18-1.5z"/>
                </svg>
                <span style="font-weight:700; color:white; font-size:15px;">Continuar con Apple</span>
              </button>

              <div style="margin-top: 24px; text-align: center;">
                <button id="reviewer-login-btn" style="background: none; border: none; color: #6B7280; font-size: 12px; font-weight: 700; text-decoration: underline; cursor: pointer; opacity: 0.8;">
                  Acceso de prueba (Revisores)
                </button>
              </div>
            </div>
          </div>
          <style>
            @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
            @keyframes gd-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            #google-login-btn:active { transform: scale(0.98); background: #F9FAFB; }
            #apple-login-btn:active { transform: scale(0.98); opacity: 0.9; }
          </style>
        `;

        const { signInWithGoogle, signInWithApple } = await import('./auth.js');
        
        const reviewerBtn = document.getElementById('reviewer-login-btn');
        reviewerBtn?.addEventListener('click', () => {
          const modalEl = document.createElement('div');
          modalEl.style.cssText = 'padding: 24px 24px calc(24px + env(safe-area-inset-bottom, 16px)) 24px; display: flex; flex-direction: column; gap: 16px; background: var(--color-bg);';
          modalEl.innerHTML = `
            <h3 style="font-family: var(--font-display); font-size: 18px; font-weight: 900; margin: 0; color: var(--color-text-primary);">Acceso de Prueba</h3>
            <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0;">Ingresá las credenciales proporcionadas para revisar la aplicación.</p>
            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
              <input type="email" id="test-email" placeholder="Correo electrónico" style="height: 48px; border-radius: 14px; border: 1.5px solid var(--color-border); padding: 0 16px; font-size: 14px; outline: none; background: var(--color-bg-card); color: var(--color-text-primary);" />
              <input type="password" id="test-password" placeholder="Contraseña" style="height: 48px; border-radius: 14px; border: 1.5px solid var(--color-border); padding: 0 16px; font-size: 14px; outline: none; background: var(--color-bg-card); color: var(--color-text-primary);" />
            </div>
            <button id="btn-submit-test-login" style="margin-top: 16px; height: 50px; border-radius: 16px; background: var(--color-primary); color: white; border: none; font-weight: 850; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.2);">
              Iniciar Sesión
            </button>
          `;
          
          import('./components/modal.js').then(m => {
            m.showModal({
              title: '',
              content: modalEl,
              height: 'auto',
              hideHeader: true,
              onOpen: () => {
                modalEl.querySelector('#btn-submit-test-login').onclick = async () => {
                  const email = modalEl.querySelector('#test-email').value.trim();
                  const password = modalEl.querySelector('#test-password').value.trim();
                  if (!email || !password) return;
                  
                  modalEl.querySelector('#btn-submit-test-login').disabled = true;
                  modalEl.querySelector('#btn-submit-test-login').textContent = 'Iniciando...';
                  
                  const { signInWithTestAccount } = await import('./auth.js');
                  const success = await signInWithTestAccount(email, password);
                  if (success) {
                    m.closeModal();
                    loginWall?.remove();
                  } else {
                    modalEl.querySelector('#btn-submit-test-login').disabled = false;
                    modalEl.querySelector('#btn-submit-test-login').textContent = 'Iniciar Sesión';
                  }
                };
              }
            });
          });
        });

        const loginBtn = document.getElementById('google-login-btn');
        loginBtn?.addEventListener('click', () => {
          loginBtn.disabled = true;
          loginBtn.style.opacity = '0.7';
          loginBtn.style.cursor = 'not-allowed';
          loginBtn.innerHTML = `
            <div style="border: 3px solid #E5E7EB; border-top: 3px solid #E11D48; border-radius: 50%; width: 20px; height: 20px; animation: gd-spin 1s linear infinite;"></div>
            <span style="font-weight:700; color:#374151; font-size:15px;">Iniciando sesión...</span>
          `;
          
          signInWithGoogle().then((user) => {
            if (user) {
              // Clean up the URL query params so ref code is not persisted in address bar
              const url = new URL(window.location.href);
              url.searchParams.delete('ref');
              window.history.replaceState({}, '', url.pathname + url.search + url.hash);
            } else {
              // Restore button state if login fails or is cancelled
              loginBtn.disabled = false;
              loginBtn.style.opacity = '1';
              loginBtn.style.cursor = 'pointer';
              loginBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span style="font-weight:700; color:#374151; font-size:15px;">Continuar con Google</span>
              `;
            }
          });
        });

        const appleLoginBtn = document.getElementById('apple-login-btn');
        appleLoginBtn?.addEventListener('click', () => {
          appleLoginBtn.disabled = true;
          appleLoginBtn.style.opacity = '0.7';
          appleLoginBtn.style.cursor = 'not-allowed';
          appleLoginBtn.innerHTML = `
            <div style="border: 3px solid #E5E7EB; border-top: 3px solid #111827; border-radius: 50%; width: 20px; height: 20px; animation: gd-spin 1s linear infinite;"></div>
            <span style="font-weight:700; color:white; font-size:15px;">Iniciando sesión...</span>
          `;
          
          signInWithApple().then((user) => {
            if (user) {
              const url = new URL(window.location.href);
              url.searchParams.delete('ref');
              window.history.replaceState({}, '', url.pathname + url.search + url.hash);
            } else {
              appleLoginBtn.disabled = false;
              appleLoginBtn.style.opacity = '1';
              appleLoginBtn.style.cursor = 'pointer';
              appleLoginBtn.innerHTML = `
                <svg width="18" height="22" viewBox="0 0 18 22" fill="white">
                  <path d="M15.22 10.95c.04-2.73 2.23-4.04 2.33-4.11-1.27-1.86-3.25-2.11-3.95-2.16-1.68-.17-3.29.99-4.14.99-.86 0-2.19-.97-3.62-.94-1.88.03-3.61 1.1-4.57 2.76-1.95 3.37-.5 8.35 1.39 11.08.93 1.33 2.01 2.82 3.44 2.77 1.38-.05 1.9-.89 3.57-.89 1.66 0 2.14.89 3.58.86 1.46-.02 2.41-1.35 3.33-2.69 1.07-1.56 1.51-3.07 1.53-3.15-.03-.02-2.95-1.13-2.98-4.51zM11.95 2.81c.75-.91 1.25-2.18 1.11-3.44-1.08.04-2.39.72-3.17 1.63-.68.78-1.28 2.07-1.12 3.31 1.2.09 2.43-.59 3.18-1.5z"/>
                </svg>
                <span style="font-weight:700; color:white; font-size:15px;">Continuar con Apple</span>
              `;
            }
          });
        });
        return;
      }

      // Clear the auth wall if it exists
      const loginWall = document.getElementById('login-wall');
      if (loginWall) {
        loginWall.remove();
        
        // Show the splash screen after Google Sign-In
        const splash = document.getElementById('splash-screen');
        if (splash) {
          splash.classList.remove('fade-out');
          document.getElementById('app')?.classList.remove('ready');
          
          // Force CSS animations to replay by cloning and replacing the element
          const newSplash = splash.cloneNode(true);
          splash.parentNode.replaceChild(newSplash, splash);
          
          setTimeout(() => {
            newSplash.classList.add('fade-out');
            document.getElementById('app')?.classList.add('ready');
          }, 2400);
        }
      }

      const isPreview = window.location.hash.includes('preview=true') || window.location.search.includes('preview=true');

      // USER IS LOGGED IN -> Initialize UI
      import('./components/header.js').then(m => m.initHeader());
      if (!isPreview) {
        import('./utils/analytics.js').then(m => m.trackUserVisit(user.uid)).catch(e => console.warn('Telemetry visit tracking failed:', e));
        import('./components/notifications-drawer.js').then(m => m.initNotificationsDrawer());
        import('./components/navbar.js').then(m => m.initNavbar());
        import('./components/active-order-banner.js').then(m => m.initActiveOrderBanner());
        import('./components/delivery-monitor.js').then(m => m.initDeliveryMonitor());
        import('./components/commerce-monitor.js').then(m => m.initCommerceMonitor());
        import('./components/chat-notifier.js').then(m => m.initChatNotifier());
        
        // Initialize floating support chatbot dynamically
        import('./components/support-bot.js').then(m => m.initSupportBot()).catch(err => console.warn('Failed to load support bot:', err));

        // Check for pending notification deep-link redirection
        const pendingUrl = localStorage.getItem('gd_pending_notification_url');
        if (pendingUrl) {
          localStorage.removeItem('gd_pending_notification_url');
          console.log('[Push] Redirecting to pending notification URL:', pendingUrl);
          window.location.hash = pendingUrl;
        }
      }

      const header = document.getElementById('app-header');
      const navbar = document.getElementById('app-navbar');
      if (header) header.style.display = isPreview ? 'none' : 'flex';
      if (navbar) navbar.style.display = isPreview ? 'none' : 'flex';

      if (isPreview) {
        document.documentElement.classList.add('preview-mode');
        document.body.classList.add('preview-mode');
        let style = document.getElementById('preview-mode-styles');
        if (!style) {
          style = document.createElement('style');
          style.id = 'preview-mode-styles';
          style.innerHTML = `
            #app-header, #app-navbar, .nav-item, .cart-button, .checkout-button, .add-to-cart-btn, .whatsapp-cart-btn, .comercio-header-back, .product-card-add, #cart-fab-container, [class*="whatsapp"], [class*="cart"], button:has(.lucide-shopping-bag), button:has(.lucide-shopping-cart), .fab {
              display: none !important;
              pointer-events: none !important;
            }
            .product-card {
              cursor: pointer !important;
            }
            body {
              padding-top: 0 !important;
              padding-bottom: 0 !important;
            }
          `;
          document.head.appendChild(style);
        }
      }

      import('./utils/background-tracking.js').then(m => m.initGlobalTracking()).catch(e => console.warn('Tracking failed', e));
      import('./pages/home.js').then(m => m.renderHome()).catch(e => console.warn('Home pre-render failed', e));

      // Fetch GoMarket Logo for Banner and Auto-Sync new Assets in Firestore
      try {
        const { collection, query, getDocs, doc, updateDoc } = await import('firebase/firestore');
        const comSnap = await getDocs(collection(db, 'comercios'));
        const gm = comSnap.docs.find(d => {
          const n = (d.data().name || '').toLowerCase();
          return n.includes('go!') && n.includes('market');
        });
        if (gm) {
          const data = gm.data();
          localStorage.setItem('gd_gomarket_id', gm.id);
          import('./state.js').then(m => m.setState('goMarketId', gm.id));
          if (data.logo) {
            import('./state.js').then(m => m.setState('goMarketLogo', data.logo));
          }
          if (data.banner) {
            import('./state.js').then(m => m.setState('goMarketBanner', data.banner));
          }
        }
      } catch (e) {
        console.error('Error auto-syncing GoMarket assets:', e);
      }

      if (isDelivery() && !isPreview) import('./pages/delivery-panel.js').then(m => m.renderDeliveryPanel());
      if (isComercio() && user && !isPreview) {
        const { collection, query, where, getDocs, doc, getDoc, updateDoc } = await import('firebase/firestore');
        
        // Upgrade database role to admin first to satisfy rules
        const { isAdmin } = await import('./auth.js');
        if (isAdmin()) {
          try {
            const userRef = doc(db, 'users', user.uid);
            const uSnap = await getDoc(userRef);
            if (uSnap.exists() && uSnap.data().role !== 'admin') {
              await updateDoc(userRef, { role: 'admin' });
              user.role = 'admin';
              console.log('[Auth] Database role updated to admin');
            }
          } catch (e) {
            console.warn('Failed to auto-promote database role:', e);
          }
        }

        let comId = null;

        if (isAdmin()) {
          const comSnap = await getDocs(collection(db, 'comercios'));
          const gm = comSnap.docs.find(d => {
            const n = (d.data().name || '').toLowerCase();
            return n.includes('go!') && n.includes('market');
          });
          if (gm) {
            comId = gm.id;
            import('./state.js').then(m => m.setState('currentComercio', { id: gm.id, ...gm.data() }));
            
            // Sync GoMarket ownerId with current admin user to satisfy Firestore rules
            const gmData = gm.data();
            if (gmData.ownerId !== user.uid) {
              import('firebase/firestore').then(async ({ doc, updateDoc }) => {
                try {
                  await updateDoc(doc(db, 'comercios', gm.id), { ownerId: user.uid });
                  console.log('[Auth] Synced GoMarket ownerId with Admin UID:', user.uid);
                } catch (err) {
                  console.warn('Failed to sync GoMarket ownerId locally, trying Cloud Function...', err);
                  try {
                    const res = await fetch(`https://us-central1-godelivery-magdalena.cloudfunctions.net/setCommerceOwner?comercioId=${gm.id}&ownerId=${user.uid}`);
                    const text = await res.text();
                    console.log('[Auth] Cloud Function owner sync result:', text);
                  } catch (fetchErr) {
                    console.warn('[Auth] Cloud Function owner sync failed:', fetchErr);
                  }
                }
              });
            }
          }
        } else {
          const q = query(collection(db, 'comercios'), where('ownerId', '==', user.uid));
          const snap = await getDocs(q);
          if (!snap.empty) {
            comId = snap.docs[0].id;
            import('./state.js').then(m => m.setState('currentComercio', { id: snap.docs[0].id, ...snap.docs[0].data() }));
          }
        }

        if (comId) {
          import('./pages/comercio-panel/orders.js').then(m => m.renderComercioOrders(comId));
        }
      }

      import('./pages/cart.js').then(m => m.renderCart());
      import('./pages/profile.js').then(m => m.renderProfile());

      if (isPreview) {
        routerReady();
      }

      // Show Onboarding and Notifications if NOT on the Install Lock Screen
      const runStartupFlow = () => {
        if (isPreview) return; // Bypass onboarding, push notifications, and address modals in preview mode

        const triggerReferralModal = () => {
          import('./auth.js').then(m => m.checkAndShowReferralWelcome());
        };

        const continueAfterGuide = () => {
              initPushNotifications();
              checkAppUpdate();
              if (user && !getState().deliveryAddress) {
                import('./components/address-modal.js').then(m => {
                  m.ensureAddress(() => {
                    triggerReferralModal();
                  });
                });
              } else {
                triggerReferralModal();
              }
        };

        import('./components/onboarding.js')
          .then(m => {
            m.showOnboarding(() => {
              // After onboarding, show the interactive app guide
              import('./components/app-guide.js').then(g => {
                g.showAppGuide(() => {
                  continueAfterGuide();
                });
              }).catch(err => {
                console.warn('App guide failed to load', err);
                continueAfterGuide();
              });
            });
          })
          .catch(err => {
            console.error('Onboarding failed to load', err);
            import('./components/app-guide.js').then(g => {
              g.showAppGuide(() => {
                continueAfterGuide();
              });
            }).catch(() => {
              continueAfterGuide();
            });
          });
      };

      if (document.getElementById('pwa-lock-screen')) {
        window.addEventListener('pwa-lock-dismissed', runStartupFlow, { once: true });
      } else {
        runStartupFlow();
      }

      // Proactive Geolocation Pre-fetch & Geofencing check
      if (!isPreview && navigator.geolocation && navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then((res) => {
          if (res.state === 'granted') {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                
                import('./state.js').then(stateMod => {
                  const state = stateMod.getState();
                  const savedCoords = state.deliveryCoords;
                  const savedAddress = state.deliveryAddress;
                  
                  // Geofencing: Check if user is >500 meters away from configured address
                  if (savedAddress && savedCoords && savedCoords.lat && savedCoords.lng) {
                    const R = 6371e3; // metres
                    const phi1 = currentCoords.lat * Math.PI/180;
                    const phi2 = savedCoords.lat * Math.PI/180;
                    const deltaPhi = (savedCoords.lat - currentCoords.lat) * Math.PI/180;
                    const deltaLambda = (savedCoords.lng - currentCoords.longitude) * Math.PI/180;

                    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
                              Math.cos(phi1) * Math.cos(phi2) *
                              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    const distance = R * c; // in metres

                    if (distance > 500) {
                      showFloatingGeofenceBanner();
                    }
                  }
                });
              },
              null,
              { enableHighAccuracy: false, maximumAge: 300000 }
            );
          }
        }).catch(() => {});
      }

      function showFloatingGeofenceBanner() {
        if (document.getElementById('floating-geofence-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'floating-geofence-banner';
        banner.style.cssText = `
          position: fixed;
          bottom: calc(var(--navbar-height, 60px) + 16px + env(safe-area-inset-bottom, 0px));
          left: 16px;
          right: 16px;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.4);
          border-radius: 20px;
          padding: 14px 16px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
          z-index: 1800;
          display: flex;
          align-items: center;
          gap: 12px;
          transform: translateY(150%);
          transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        `;
        
        if (document.documentElement.getAttribute('data-theme') === 'dark') {
          banner.style.background = 'rgba(30, 41, 59, 0.95)';
          banner.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        }

        banner.innerHTML = `
          <div style="
            width: 40px; 
            height: 40px; 
            border-radius: 50%; 
            background: rgba(227, 27, 35, 0.1); 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            flex-shrink: 0;
            position: relative;
          ">
            <div style="
              position: absolute;
              width: 100%;
              height: 100%;
              border-radius: 50%;
              background: rgba(227, 27, 35, 0.2);
              animation: geoPulseEffect 2s infinite ease-out;
            "></div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary, #E31B23)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </div>
          
          <div style="flex: 1; min-width: 0; cursor: pointer;" id="floating-geofence-action">
            <div style="font-weight: 800; font-size: 13.5px; color: var(--color-text, #0F172A); margin-bottom: 2px;">¿Estás en un lugar nuevo?</div>
            <div style="font-size: 11.5px; color: var(--color-text-secondary, #64748B); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Toca para actualizar tu dirección de entrega</div>
          </div>
          
          <button id="floating-geofence-close" style="
            background: none; 
            border: none; 
            color: var(--color-text-secondary, #64748B); 
            cursor: pointer; 
            padding: 4px; 
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
          ">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        `;

        document.body.appendChild(banner);

        if (!document.getElementById('geofence-pulse-style')) {
          const style = document.createElement('style');
          style.id = 'geofence-pulse-style';
          style.innerHTML = `
            @keyframes geoPulseEffect {
              0% { transform: scale(0.9); opacity: 1; }
              100% { transform: scale(1.6); opacity: 0; }
            }
          `;
          document.head.appendChild(style);
        }

        requestAnimationFrame(() => {
          banner.style.transform = 'translateY(0)';
        });

        const dismiss = () => {
          banner.style.transform = 'translateY(150%)';
          setTimeout(() => banner.remove(), 500);
        };

        banner.querySelector('#floating-geofence-close').onclick = (e) => {
          e.stopPropagation();
          dismiss();
        };

        banner.querySelector('#floating-geofence-action').onclick = () => {
          dismiss();
          import('./components/address-modal.js').then(m => {
            m.showAddressPrompt();
          });
        };
      }

    } catch (err) {
      console.error('GoDelivery: Error during initialization', err);
    } finally {
      // Run update check in the background without blocking the startup flow
      checkAppUpdate().catch(err => console.warn('GoDelivery: Update check failed', err));

      routerReady();
      const splash = document.getElementById('splash-screen');
      if (splash) {
        const elapsedTime = Date.now() - startTime;
        const minDuration = 250; // Minimal display time for smooth fading animation
        const remainingTime = Math.max(0, minDuration - elapsedTime);
        setTimeout(() => {
          splash.classList.add('fade-out');
          document.getElementById('app')?.classList.add('ready');
        }, remainingTime);
      }
    }
  });
}

async function checkAppUpdate() {
  if (!window.Capacitor) {
    console.log('[VersionCheck] Browser environment - skipping App Store / Play Store update check.');
    return false;
  }

  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
    if (settingsDoc.exists()) {
      const settings = settingsDoc.data();
      const minVersion = settings.minAndroidVersionCode || 0;
      
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      const localVersion = parseInt(info.build, 10) || 0;
      
      console.log(`[VersionCheck] Local Version Code: ${localVersion}, Required Minimum: ${minVersion}`);
      
      if (localVersion < minVersion) {
        const storeUrl = settings.playStoreUrl || 'https://play.google.com/store/apps/details?id=com.godelivery.magdalena';
        console.log(`[VersionCheck] Version outdated. Displaying floating update banner pointing to: ${storeUrl}`);
        showUpdateFloatingBanner(storeUrl);
        return false; // Do not block app load
      } else {
        console.log('[VersionCheck] App is up to date.');
      }
    } else {
      console.warn('[VersionCheck] Global settings document not found in Firestore.');
    }
  } catch (err) {
    console.warn('[VersionCheck] Update check failed:', err);
  }
  return false;
}

function showUpdateFloatingBanner(storeUrl) {
  if (document.getElementById('pwa-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: calc(var(--navbar-height, 60px) + 16px + env(safe-area-inset-bottom, 0px));
    left: 16px;
    right: 16px;
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 18px;
    box-shadow: 0 10px 25px rgba(225, 29, 72, 0.35);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    z-index: 9999;
    animation: slideUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
      <span style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: rgba(255,255,255,0.2); border-radius: 10px; flex-shrink: 0;">
        ${icon('download', 18, '', '#ffffff')}
      </span>
      <div style="display: flex; flex-direction: column; min-width: 0;">
        <span style="font-size: 13.5px; font-weight: 800; letter-spacing: -0.02em;">¡Nueva versión disponible!</span>
        <span style="font-size: 11px; opacity: 0.9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Actualizá para recibir las últimas mejoras</span>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <a href="#" id="update-app-btn" style="background: white; color: var(--color-primary); padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 900; text-decoration: none; display: inline-flex; align-items: center; box-shadow: var(--shadow-sm); height: 28px; box-sizing: border-box;">
        Actualizar
      </a>
      <button id="close-update-banner" style="background: none; border: none; color: white; opacity: 0.7; cursor: pointer; padding: 4px; display: flex; align-items: center;">
        ${icon('close', 14, '', '#ffffff')}
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  const updateBtn = document.getElementById('update-app-btn');
  if (updateBtn) {
    updateBtn.onclick = (e) => {
      e.preventDefault();
      console.log(`[VersionCheck] Redirecting user to store URL: ${storeUrl}`);
      if (window.Capacitor) {
        window.open(storeUrl, '_system');
      } else {
        window.open(storeUrl, '_blank');
      }
    };
  }

  const closeBtn = document.getElementById('close-update-banner');
  if (closeBtn) {
    closeBtn.onclick = () => {
      banner.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => banner.remove(), 300);
      sessionStorage.setItem('update_banner_dismissed', 'true');
    };
  }
}

// Start
console.log('🚀 Go Delivery v1.3.4 - Ready');
init();
