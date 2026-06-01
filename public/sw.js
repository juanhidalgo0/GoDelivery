const CACHE_NAME = 'godelivery-v1.0.2'; // Change this only when you want to force a full cache clear

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
  // Ignore non-GET requests and specific domains
  if (event.request.method !== 'GET' || 
      event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('firebase') ||
      event.request.url.includes('google')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If it's a valid response, return it
        if (response && response.status === 200) return response;
        return response;
      })
      .catch(() => {
        // If network fails, try cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          // If not in cache and network failed, just let it fail naturally
          // without throwing "Failed to convert value to Response"
        });
      })
  );
});
