// GoDelivery — Unified Map Configuration & Styles
// Pristine Native MapTiler Vector Styles — 100% Original High Definition

export const MAPTILER_API_KEY = 'u1h0m5baFTL3T6fqRlib';

export const MAPTILER_VOYAGER = `https://api.maptiler.com/maps/voyager-v2/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_STREETS = `https://api.maptiler.com/maps/voyager-v2/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_OLED_DARK = `https://api.maptiler.com/maps/darkmatter/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_MINIMAL_LIGHT = `https://api.maptiler.com/maps/voyager-v2/style.json?key=${MAPTILER_API_KEY}`;
export const MAPTILER_DARK = MAPTILER_OLED_DARK;

export const OPENFREEMAP_DARK = MAPTILER_OLED_DARK;
export const OPENFREEMAP_LIGHT = MAPTILER_VOYAGER;

export const DEFAULT_MAP_STYLE = MAPTILER_OLED_DARK;
export const OSM_MAP_STYLE = MAPTILER_VOYAGER;

export async function getDeepOledDarkStyle() {
  return MAPTILER_OLED_DARK;
}

export const GOOGLE_MAPS_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    'google-maps-raster': {
      type: 'raster',
      tiles: [
        'https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'
      ],
      tileSize: 256,
      attribution: '&copy; Google Maps'
    }
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#f1f5f9'
      }
    },
    {
      id: 'google-maps-layer',
      type: 'raster',
      source: 'google-maps-raster',
      minzoom: 0,
      maxzoom: 22
    }
  ]
};

export function getAppMapStyle(isDark = false) {
  if (typeof document !== 'undefined') {
    const isExplicitLight = document.documentElement.classList.contains('driver-light-mode') ||
                            document.body.classList.contains('driver-light-mode');
    if (isExplicitLight) return MAPTILER_VOYAGER;

    const isDocDark = document.documentElement.getAttribute('data-theme') === 'dark' || 
                      document.documentElement.classList.contains('driver-dark-mode') ||
                      document.body.classList.contains('driver-dark-mode') ||
                      document.body.classList.contains('is-delivery-mode');
    if (isDocDark || isDark) return MAPTILER_OLED_DARK;
  }
  return isDark ? MAPTILER_OLED_DARK : MAPTILER_VOYAGER;
}


