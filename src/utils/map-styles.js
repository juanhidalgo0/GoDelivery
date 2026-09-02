// GoDelivery — Unified Map Configuration & Styles
// Pristine Native MapTiler Vector Styles — 100% Original High Definition
import * as maplibregl from 'maplibre-gl';

// Configure Web Worker safely for Vite/Production with verified JS MIME-type
try {
  if (typeof maplibregl.setWorkerUrl === 'function') {
    maplibregl.setWorkerUrl('https://cdn.jsdelivr.net/npm/maplibre-gl@6.6.0/dist/maplibre-gl-worker.mjs');
  }
} catch(e) {}

export const MAPTILER_API_KEY = 'u1h0m5baFTL3T6fqRlib';

export const MAPTILER_STREETS = `https://api.maptiler.com/maps/base-v4/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_OLED_DARK = `https://api.maptiler.com/maps/base-v4-dark/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_MINIMAL_LIGHT = `https://api.maptiler.com/maps/base-v4/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_VOYAGER = `https://api.maptiler.com/maps/voyager-v2/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_DARK = MAPTILER_OLED_DARK;

export const OPENFREEMAP_DARK = MAPTILER_OLED_DARK;
export const OPENFREEMAP_LIGHT = MAPTILER_STREETS;

export const DEFAULT_MAP_STYLE = MAPTILER_OLED_DARK;
export const OSM_MAP_STYLE = MAPTILER_STREETS;

export async function getDeepOledDarkStyle() {
  return MAPTILER_OLED_DARK;
}

export function getAppMapStyle(isDark = false) {
  if (typeof document !== 'undefined') {
    const isExplicitLight = document.documentElement.classList.contains('driver-light-mode') ||
                            document.body.classList.contains('driver-light-mode');
    if (isExplicitLight) return OPENFREEMAP_LIGHT;

    const isDocDark = document.documentElement.getAttribute('data-theme') === 'dark' || 
                      document.documentElement.classList.contains('driver-dark-mode') ||
                      document.body.classList.contains('driver-dark-mode') ||
                      document.body.classList.contains('is-delivery-mode');
    if (isDocDark || isDark) return MAPTILER_OLED_DARK;
  }
  return isDark ? MAPTILER_OLED_DARK : OPENFREEMAP_LIGHT;
}


