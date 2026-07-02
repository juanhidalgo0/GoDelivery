// GoDelivery — Service Worker for Firebase Cloud Messaging & PWA Caching
// Powered by Firebase Cloud Messaging for robust, native background delivery.


importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Register custom push listener at the very top to intercept ALL pushes before the Firebase SDK
self.addEventListener('push', (event) => {
  console.log('[SW] Push event intercepted:', event);
  
  if (!event.data) return;
  
  // Stop Firebase SDK from displaying standard background notification
  event.stopImmediatePropagation();
  
  event.waitUntil((async () => {
    try {
      let payload = {};
      try {
        payload = event.data.json() || {};
      } catch (e) {
        try {
          payload = { notification: { body: event.data.text() } };
        } catch (inner) {
          payload = {};
        }
      }
      console.log('[SW] Decrypted push payload:', payload);
      
      const fcmData = payload.data || {};
      const fcmNotification = payload.notification || {};
      const nestedFcmMsg = fcmData.FCM_MSG || {};
      const nestedData = nestedFcmMsg.data || {};
      const nestedNotification = nestedFcmMsg.notification || {};
      
      const title = fcmData.title || fcmNotification.title || nestedData.title || nestedNotification.title || 'Go Delivery';
      const body = fcmData.body || fcmNotification.body || nestedData.body || nestedNotification.body || '';
      
      // URLs
      let targetUrl = fcmData.url || nestedData.url || (payload.data && payload.data.url) || '/#/';
      if (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
        targetUrl = targetUrl.replace(/^https?:\/\/[^\/]+/, 'https://godelivery-magdalena.web.app');
      }
      if (targetUrl.startsWith('#') || targetUrl.startsWith('/#')) {
        targetUrl = "https://godelivery-magdalena.web.app/" + targetUrl.replace(/^\//, "");
      }
      
      const tag = fcmData.tag || nestedData.tag || fcmNotification.tag || `godelivery-${Date.now()}`;
      const imageUrl = fcmData.imageUrl || fcmNotification.image || fcmData.image || nestedData.imageUrl || nestedNotification.image || null;
      
      // Check if this push payload contains a root/nested notification definition
      const hasNotification = !!(fcmNotification.title || fcmNotification.body || nestedNotification.title || nestedNotification.body);
      
      // Retrieve active window clients to check if the app is in the foreground
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const isForeground = windowClients.some(client => client.focused || client.visibilityState === 'visible');
      
      console.log(`[SW] hasNotification: ${hasNotification}, isForeground: ${isForeground}`);
      
      // 1. Broadcast PUSH_RECEIVED to open window clients for real-time in-app synchronization / foreground toasts
      for (const client of windowClients) {
        client.postMessage({
          type: 'PUSH_RECEIVED',
          title: title,
          body: body,
          url: targetUrl,
          tag: tag
        });
      }
      // 2. Display native notification ONLY if app is in the background
      if (!isForeground) {
        const options = {
          body: body,
          icon: 'https://godelivery-magdalena.web.app/logo-pwa.png',
          badge: 'https://godelivery-magdalena.web.app/badge-icon.svg',
          vibrate: [300, 100, 300, 100, 300], // Indispensable for Heads-up on Android
          requireInteraction: true, // High importance
          renotify: true, // Forces wakeup/vibration even on same tag
          silent: false, // Explicitly loud for Android heads-up
          tag: tag,
          data: {
            url: targetUrl,
            broadcastId: fcmData.broadcastId || nestedData.broadcastId || '',
            imageUrl: imageUrl,
            payload: payload
          }
        };
        
        if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          options.image = imageUrl;
        }
        
        console.log('[SW] Displaying premium background heads-up notification:', options);
        await self.registration.showNotification(title, options);
      } else {
        console.log('[SW] Suppressing native notification since PWA is in foreground.');
      }
    } catch (err) {
      console.error('[SW] Error custom parsing/rendering push:', err);
      // Fallback: ALWAYS show a notification to satisfy browser requirements and prevent silent swallows on locked screens
      try {
        console.log('[SW] Displaying fallback notification due to parsing error');
        await self.registration.showNotification("Go Delivery", {
          body: "Tenés novedades en tu pedido. Entrá a la app para ver los detalles.",
          icon: 'https://godelivery-magdalena.web.app/logo-pwa.png',
          badge: 'https://godelivery-magdalena.web.app/badge-icon.svg',
          vibrate: [300, 100, 300],
          requireInteraction: true,
          data: { url: 'https://godelivery-magdalena.web.app/#/' }
        });
      } catch (innerErr) {
        console.error('[SW] Critical error displaying fallback notification:', innerErr);
      }
    }
  })());
}, true); // Use useCapture = true to capture event before Firebase SDK listener

firebase.initializeApp({
  apiKey: "AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA",
  authDomain: "godelivery-magdalena.firebaseapp.com",
  projectId: "godelivery-magdalena",
  storageBucket: "godelivery-magdalena.firebasestorage.app",
  messagingSenderId: "848164656125",
  appId: "1:848164656125:web:eef2314205f5d8f887ff94",
});

const messaging = firebase.messaging();

// PWA: Cache Configuration (Bump version to force update)
const CACHE_NAME = 'godelivery-v1.4.17';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo-pwa.png',
  '/logo-brand.jpg',
  '/badge-icon.svg',
  '/icons.svg',
];

// Install: Pre-cache App Shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v1.4.17 (Fresh PWA safe deep links)...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Skip Waiting via Message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v1.4.17...');
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map(k => k !== CACHE_NAME && caches.delete(k))
    )).then(() => self.clients.claim())
  );
});
// Fetch: Stale-While-Revalidate Strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET, external API calls, Firebase/Google APIs, firestore, Vite Dev Server paths, and Chrome extensions
  if (
    request.method !== 'GET' || 
    url.origin !== self.location.origin ||
    url.origin.includes('firebase') || 
    url.origin.includes('firestore') || 
    url.origin.includes('google') ||
    url.protocol === 'chrome-extension:' ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  // STRATEGY: Network-First for index.html (ensure latest version)
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(
      fetch(request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        });
      }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // STRATEGY: Stale-While-Revalidate for other assets
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchedResponse = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // If network fails, we return the cached response (even if undefined)
          return cachedResponse;
        });

        // Return cached version immediately if available, otherwise wait for network
        return cachedResponse || fetchedResponse;
      });
    })
  );
});



// Rich images and robust click tracking is handled by priority push interceptor at top


// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Track CTR (Click-Through Rate) in background if broadcastId is present
  const broadcastId = event.notification.data?.broadcastId 
                   || event.notification.data?.FCM_MSG?.data?.broadcastId;
  if (broadcastId) {
    event.waitUntil(
      fetch(`https://trackbroadcastclick-mkje4ndb5a-uc.a.run.app/?broadcastId=${broadcastId}`, {
        method: 'POST',
        mode: 'no-cors'
      }).catch(err => console.error('[SW] Click track failed:', err))
    );
  }

  // Handle specific action buttons
  if (event.action === 'close') {
    return;
  }

  // Robust URL extraction checking various potential FCM payload locations
  let urlToOpen = event.notification.data?.url 
               || event.notification.data?.FCM_MSG?.notification?.data?.url
               || event.notification.data?.FCM_MSG?.data?.url
               || '/';
  
  if (urlToOpen.includes('localhost') || urlToOpen.includes('127.0.0.1')) {
    urlToOpen = urlToOpen.replace(/^https?:\/\/[^\/]+/, 'https://godelivery-magdalena.web.app');
  }
  
  // Extract hash route (e.g. "pedido/XXXX" or "profile")
  let hashRoute = '';
  const hashMatch = urlToOpen.match(/#\/(.*)$/);
  if (hashMatch) {
    hashRoute = hashMatch[1];
  }

  // Create PWA-friendly launch URL using ?redirect parameter matching PWA start_url scope
  const launchUrl = hashRoute 
    ? self.location.origin + '/?redirect=' + encodeURIComponent(hashRoute)
    : self.location.origin + '/';

  // Ensure absolute URL fallback for messages
  if (urlToOpen.startsWith('#') || urlToOpen.startsWith('/#')) {
     urlToOpen = self.location.origin + '/' + urlToOpen.replace(/^\//, '');
  } else if (urlToOpen === '/') {
     urlToOpen = self.location.origin + '/#/';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
      // Look for any existing window of the app
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          try {
            if ('focus' in client) {
              await client.focus();
            }
            // Seamlessly notify main thread to navigate to hash route (bypasses OS navigate restrictions)
            client.postMessage({ type: 'NAVIGATE', url: urlToOpen });
            return;
          } catch (e) {
            console.error('[SW] Failed to focus or postMessage, falling back to openWindow:', e);
          }
        }
      }
      // If no window is open (or focus failed), open a new one using PWA-safe redirect query
      return clients.openWindow(launchUrl);
    })
  );
});

