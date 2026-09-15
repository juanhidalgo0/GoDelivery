// GoDelivery — Dynamic MapLibre GL Lazy Loader
/**
 * Loads MapLibre GL asynchronously only when a map is actually rendered on screen.
 * This removes ~1 MB of map vendor bundle from the critical initial startup path.
 */

let maplibrePromise = null;
let isCssLoaded = false;

function ensureMaplibreCss() {
  if (isCssLoaded || typeof document === 'undefined') return;
  if (!document.getElementById('maplibre-gl-css')) {
    const link = document.createElement('link');
    link.id = 'maplibre-gl-css';
    link.rel = 'stylesheet';
    link.href = '/assets/maplibre-gl.css';
    link.onerror = () => {
      // Graceful fallback to CDN only if local file cannot be read
      link.href = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.6.0/dist/maplibre-gl.css';
    };
    document.head.appendChild(link);
  }
  isCssLoaded = true;
}

export async function getMapLibre() {
  ensureMaplibreCss();

  if (!maplibrePromise) {
    maplibrePromise = (async () => {
      const mod = await import('maplibre-gl');
      const maplibregl = mod.default || mod;

      // Configure Worker URL safely using local self-hosted worker first
      try {
        if (typeof maplibregl.setWorkerUrl === 'function') {
          maplibregl.setWorkerUrl('/assets/maplibre-gl-worker.mjs');
        }
      } catch (e) {
        console.warn('[MapLoader] Worker URL setting notice:', e);
      }

      if (typeof window !== 'undefined') {
        window.maplibregl = maplibregl;
      }

      return maplibregl;
    })();
  }

  return maplibrePromise;
}
