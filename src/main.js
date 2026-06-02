// GoDelivery — Main Entry Point
import { registerRoutes, initRouter, routerReady } from './router.js';
import { initAuth, isDelivery, isComercio } from './auth.js';
import { initTheme, loadCart, getState, initSettings } from './state.js';
import { initHeader } from './components/header.js';
import { initNavbar } from './components/navbar.js';
import { initActiveOrderBanner } from './components/active-order-banner.js';
import { initDeliveryMonitor } from './components/delivery-monitor.js';
import { initCommerceMonitor } from './components/commerce-monitor.js';
import { initPushNotifications } from './utils/notifications.js';
import { initChatNotifier } from './components/chat-notifier.js';
import { initNotificationsDrawer } from './components/notifications-drawer.js';
import { clearAllBanners } from './components/banner-manager.js';
import { ensureAppInstalled } from './components/install-lock.js';
import { AudioManager } from './utils/audio-manager.js';
import { db } from './firebase.js';
import { icon } from './utils/icons.js';
import { evictExpiredCache } from './utils/firestore-cache.js';
import { trackUserVisit } from './utils/analytics.js';

// Initialize audio system
AudioManager.init();

// Initialize app
async function init() {
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

          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  // New version available! Force skip waiting
                  console.log('GoDelivery: New version found. Updating...');
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              }
            };
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
  ensureAppInstalled();

  // Run cache eviction sweep
  evictExpiredCache();

  // Theme
  initTheme();

  // Clear any leftover banners
  clearAllBanners();

  // Load saved cart
  loadCart();

  // Load global settings (non-blocking)
  initSettings();

  // Register all routes
  registerRoutes({
    '/': (c) => import('./pages/home.js').then(m => m.renderHome(c)),
    '/comercio/:id': (c) => import('./pages/comercio.js').then(m => m.renderComercio(c)),
    '/cart': (c) => import('./pages/cart.js').then(m => m.renderCart(c)),
    '/profile': (c) => import('./pages/profile.js').then(m => m.renderProfile(c)),
    '/profile/orders': (c) => import('./pages/profile/orders.js').then(m => m.renderProfileOrders(c)),
    '/admin': (c) => import('./pages/admin/dashboard.js').then(m => m.renderAdminDashboard(c)),
    '/admin/users': (c) => import('./pages/admin/users.js').then(m => m.renderAdminUsers(c)),
    '/admin/categories': (c) => import('./pages/admin/categories.js').then(m => m.renderAdminCategories(c)),
    '/admin/comercios': (c) => import('./pages/admin/comercios.js').then(m => m.renderAdminComercios(c)),
    '/admin/reviews': (c) => import('./pages/admin/reviews.js').then(m => m.renderAdminReviews(c)),
    '/admin/support-chats': (c) => import('./pages/admin/support-chats.js').then(m => m.renderAdminSupportChats(c)),
    '/admin/orders': (c) => import('./pages/admin/orders.js').then(m => m.renderAdminOrders(c)),
    '/admin/commissions': (c) => import('./pages/admin/commissions.js').then(m => m.renderAdminCommissions(c)),
    '/admin/settings': (c) => import('./pages/admin/settings.js').then(m => m.renderAdminSettings(c)),
    '/admin/broadcasts': (c) => import('./pages/admin/broadcasts.js').then(m => m.renderAdminBroadcasts(c)),
    '/admin/broadcasts/history': (c) => import('./pages/admin/broadcasts.js').then(m => m.renderAdminBroadcastsHistory(c)),
    '/admin/ads': (c) => import('./pages/admin/ads.js').then(m => m.renderAdminAds(c)),
    '/admin/gomarket': (c) => import('./pages/admin/gomarket.js').then(m => m.renderAdminGoMarket(c)),
    '/admin/offers': (c) => import('./pages/admin/offers.js').then(m => m.renderAdminOffers(c)),
    '/admin/coupons': (c) => import('./pages/admin/coupons.js').then(m => m.renderAdminCoupons(c)),
    '/admin/metrics': (c) => import('./pages/admin/metrics.js').then(m => m.renderAdminMetrics(c)),

    '/mi-comercio': async () => {
      const user = getState().user;
      if (!user) { location.hash = '#/profile'; return; }
      
      const { isAdmin } = await import('./auth.js');
      const { collection, query, where, getDocs } = await import('firebase/firestore');

      if (isAdmin()) {
        const q = query(collection(db, 'comercios'));
        const snap = await getDocs(q);
        const goMarket = snap.docs.find(d => {
          const name = (d.data().name || '').toLowerCase();
          return name.includes('go!') && name.includes('market');
        });
        if (goMarket) {
          location.hash = `#/mi-comercio/${goMarket.id}/orders`;
          return;
        }
      }

      try {
        const q = query(collection(db, 'comercios'), where('ownerId', '==', user.uid));
        const snap = await getDocs(q);
        if (!snap.empty) {
          location.hash = `#/mi-comercio/${snap.docs[0].id}/orders`;
        } else {
          location.hash = '#/profile';
        }
      } catch (err) {
        console.error('Error redirecting to commerce:', err);
        location.hash = '#/profile';
      }
    },
    '/mi-comercio/:id': () => import('./pages/comercio-panel/dashboard.js').then(m => m.renderComercioDashboard()),
    '/mi-comercio/:id/products': () => import('./pages/comercio-panel/products.js').then(m => m.renderComercioProducts()),
    '/mi-comercio/:id/settings': () => import('./pages/comercio-panel/settings.js').then(m => m.renderComercioSettings()),
    '/mi-comercio/:id/orders': () => import('./pages/comercio-panel/orders.js').then(m => m.renderComercioOrders()),
    '/mi-comercio/:id/finances': () => import('./pages/comercio-panel/finances.js').then(m => m.renderComercioFinances()),
    '/mi-comercio/:id/offers': () => import('./pages/comercio-panel/offers.js').then(m => m.renderComercioOffers()),
    '/mi-comercio/:id/metrics': () => import('./pages/comercio-panel/metrics.js').then(m => m.renderComercioMetrics()),
    '/notifications': (c) => import('./pages/notifications.js').then(m => m.renderNotifications(c)),
    '/mp-connect': (c) => import('./pages/mp-connect.js').then(m => m.renderMPConnect(c)),
    '/gofavores': (c) => import('./pages/gofavores.js').then(m => m.renderGoFavores(c)),
    '/category/:id': (c) => {
      const { id } = (window.location.hash.match(/#\/category\/([^/]+)/) || [])[1] ? { id: decodeURIComponent(window.location.hash.split('/').pop()) } : { id: null };
      return import('./pages/category.js').then(m => m.renderCategoryPage(id, c));
    },
    '/delivery': (c) => import('./pages/delivery-panel.js').then(m => m.renderDeliveryPanel(c)),
    '/pedido/:id': (c) => {
      const { id } = (window.location.hash.match(/#\/pedido\/([^/]+)/) || [])[1] ? { id: window.location.hash.split('/').pop() } : { id: null };
      return import('./pages/order-tracking.js').then(m => m.renderOrderTracking(id, c));
    }
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
          loginWall.style.zIndex = '99999';
          document.body.appendChild(loginWall);
        }
        
        loginWall.innerHTML = `
          <div class="login-wall-container" style="position:fixed; inset:0; background:linear-gradient(to bottom, #F9FAFB, #FFFFFF); z-index:10000; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px;">
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
            </div>
          </div>
          <style>
            @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
            @keyframes gd-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            #google-login-btn:active { transform: scale(0.98); background: #F9FAFB; }
          </style>
        `;

        const { signInWithGoogle } = await import('./auth.js');
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
        return;
      }

      // Clear the auth wall if it exists
      const loginWall = document.getElementById('login-wall');
      if (loginWall) {
        loginWall.remove();
      }

      // USER IS LOGGED IN -> Initialize UI
      initHeader();
      trackUserVisit(user.uid).catch(e => console.warn('Telemetry visit tracking failed:', e));
      initNotificationsDrawer();
      initNavbar();
      initActiveOrderBanner();
      initDeliveryMonitor();
      initCommerceMonitor();
      initChatNotifier();
      
      // Initialize floating support chatbot dynamically
      import('./components/support-bot.js').then(m => m.initSupportBot()).catch(err => console.warn('Failed to load support bot:', err));

      const isPreview = window.location.hash.includes('preview=true') || window.location.search.includes('preview=true');

      const header = document.getElementById('app-header');
      const navbar = document.getElementById('app-navbar');
      if (header) header.style.display = isPreview ? 'none' : 'flex';
      if (navbar) navbar.style.display = isPreview ? 'none' : 'flex';

      if (isPreview) {
        let style = document.getElementById('preview-mode-styles');
        if (!style) {
          style = document.createElement('style');
          style.id = 'preview-mode-styles';
          style.innerHTML = `
            #app-header, #app-navbar, .nav-item, #app-overlay, .cart-button, .checkout-button, .add-to-cart-btn, .whatsapp-cart-btn, .comercio-header-back, .product-card-add, #cart-fab-container, [class*="whatsapp"], [class*="cart"], button:has(.lucide-shopping-bag), button:has(.lucide-shopping-cart), .fab {
              display: none !important;
              pointer-events: none !important;
            }
            .product-card {
              pointer-events: none !important;
              cursor: default !important;
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

      // Fetch GoMarket Logo for Banner
      try {
        const { collection, query, getDocs } = await import('firebase/firestore');
        const comSnap = await getDocs(collection(db, 'comercios'));
        const gm = comSnap.docs.find(d => {
          const n = (d.data().name || '').toLowerCase();
          return n.includes('go!') && n.includes('market');
        });
        if (gm && gm.data().logo) {
          import('./state.js').then(m => m.setState('goMarketLogo', gm.data().logo));
        }
      } catch (e) {}

      if (isDelivery()) import('./pages/delivery-panel.js').then(m => m.renderDeliveryPanel());
      if (isComercio() && user) {
        const { collection, query, where, getDocs } = await import('firebase/firestore');
        let comId = null;

        const { isAdmin } = await import('./auth.js');
        if (isAdmin()) {
          const comSnap = await getDocs(collection(db, 'comercios'));
          const gm = comSnap.docs.find(d => {
            const n = (d.data().name || '').toLowerCase();
            return n.includes('go!') && n.includes('market');
          });
          if (gm) {
            comId = gm.id;
            import('./state.js').then(m => m.setState('currentComercio', { id: gm.id, ...gm.data() }));
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

      // Show Onboarding and Notifications if NOT on the Install Lock Screen
      const runStartupFlow = () => {
        if (isPreview) return; // Bypass onboarding, push notifications, and address modals in preview mode

        const triggerReferralModal = () => {
          import('./auth.js').then(m => m.checkAndShowReferralWelcome());
        };

        import('./components/onboarding.js')
          .then(m => {
            m.showOnboarding(() => {
              initPushNotifications();
              if (user && !getState().deliveryAddress) {
                import('./components/address-modal.js').then(m => {
                  m.ensureAddress(() => {
                    triggerReferralModal();
                  });
                });
              } else {
                triggerReferralModal();
              }
            });
          })
          .catch(err => {
            console.error('Onboarding failed to load', err);
            initPushNotifications();
            if (user && !getState().deliveryAddress) {
              import('./components/address-modal.js').then(m => {
                m.ensureAddress(() => {
                  triggerReferralModal();
                });
              });
            } else {
              triggerReferralModal();
            }
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
      routerReady();
      const splash = document.getElementById('splash-screen');
      if (splash) {
        const elapsedTime = Date.now() - startTime;
        const minDuration = 1800; // PedidosYa standard (at least 1.8s to fully appreciate the animations)
        const remainingTime = Math.max(0, minDuration - elapsedTime);
        setTimeout(() => {
          splash.classList.add('fade-out');
        }, remainingTime);
      }
    }
  });
}

// Start
console.log('🚀 Go Delivery v1.3.3 - Ready');
init();
