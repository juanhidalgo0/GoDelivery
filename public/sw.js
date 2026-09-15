const CACHE_NAME = 'godelivery-v1.5.3'; // Force update

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete old caches
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-GET, external APIs, and specific domains
  if (request.method !== 'GET' || 
      url.origin !== self.location.origin ||
      url.origin.includes('firestore') || 
      url.origin.includes('firebase') ||
      url.origin.includes('google') ||
      url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/') ||
      url.pathname.includes('version.json')) {
    return;
  }

  // Network-First for HTML/root
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(
      fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Cache-First for Vite hashed bundles (/assets/*)
  if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.woff2') || url.pathname.endsWith('.woff')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return cached;
        }
      })
    );
    return;
  }

  // Stale-While-Revalidate for other static assets
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchedResponse = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchedResponse;
      });
    })
  );
});
