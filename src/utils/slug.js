// GoDelivery — Slug Utility for clean store links

export function getPublicBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (
      !origin.includes('localhost') && 
      !origin.includes('127.0.0.1') && 
      !origin.includes('192.168.') && 
      !origin.includes('capacitor://') && 
      !origin.startsWith('file:')
    ) {
      return origin;
    }
  }
  return 'https://godelivery-magdalena.web.app';
}

export function createSlug(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function getStoreUrl(comercioOrId, customOrigin = null) {
  const origin = customOrigin || getPublicBaseUrl();
  let slugOrId = '';
  if (typeof comercioOrId === 'string') {
    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem('gd_cached_comercios');
        if (cached) {
          const list = JSON.parse(cached);
          const found = list.find(c => c.id === comercioOrId || (c.slug && c.slug.toLowerCase() === comercioOrId.toLowerCase()));
          if (found) {
            slugOrId = found.slug || createSlug(found.name) || found.id;
          }
        }
        if (!slugOrId) {
          const lastVisited = JSON.parse(localStorage.getItem('gd_last_visited_comercio') || 'null');
          if (lastVisited && (lastVisited.id === comercioOrId || (lastVisited.slug && lastVisited.slug.toLowerCase() === comercioOrId.toLowerCase()))) {
            slugOrId = lastVisited.slug || createSlug(lastVisited.name) || lastVisited.id;
          }
        }
      }
    } catch (e) {}
    if (!slugOrId) slugOrId = comercioOrId;
  } else if (comercioOrId && typeof comercioOrId === 'object') {
    slugOrId = comercioOrId.slug || createSlug(comercioOrId.name) || comercioOrId.id;
  }
  return `${origin}/#/tienda/${slugOrId}`;
}
