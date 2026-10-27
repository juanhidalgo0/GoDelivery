// GoDelivery — Comercio Detail Page
import { db, auth } from '../firebase.js';
import { doc, getDoc, collection, getDocs, query, orderBy, where, limit, startAfter } from 'firebase/firestore';
import { getRouteParams } from '../router.js';
import { addToCart, getCartCount, subscribe, getState, isProductFavorite, setState, getItemUnitPrice } from '../state.js';
import { getDocsOptimized, withTimeout } from '../utils/firestore-cache.js';
import { safeStorage } from '../utils/safe-storage.js';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { getFooterHTML } from '../components/footer.js';

import { renderNavbar, updateGlobalCartFAB } from '../components/navbar.js';
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape.js';

// Subcategorías y selectores de la tienda: el mismo estilo al dibujar la página y al cambiar de rubro.
// Los selectores van sin el aspecto propio del celular (dejaba doble borde) y con su flechita.
const SUB_PILL_BASE = 'height:34px; padding:0 15px; font-size:13px; border-radius:999px; font-weight:700; cursor:pointer; white-space:nowrap; flex-shrink:0; outline:none; transition:background .15s, color .15s, border-color .15s;';
function subPillStyle(active) {
  return `${SUB_PILL_BASE} border:1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${active ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)'}; color:${active ? 'var(--color-primary)' : 'var(--color-text-secondary)'};`;
}
function subPillHtml(id, label, active) {
  return `<button class="sub-tab-pill ${active ? 'active' : ''}" data-subcat-id="${escapeHtml(id)}" style="${subPillStyle(active)}">${escapeHtml(label)}</button>`;
}
function selectBoxHtml(id, iconName, optionsHtml) {
  return `<label style="position:relative; flex:1; min-width:0; display:flex; align-items:center; height:42px; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:14px; box-shadow:var(--shadow-xs); cursor:pointer;">
    <span style="position:absolute; left:12px; display:flex; color:var(--color-text-tertiary); pointer-events:none;">${icon(iconName, 15)}</span>
    <select id="${id}" style="-webkit-appearance:none; -moz-appearance:none; appearance:none; border:0; outline:0; box-shadow:none; background:transparent; color:var(--color-text); width:100%; height:100%; margin:0; padding:0 32px 0 34px; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-radius:14px;">${optionsHtml}</select>
    <span style="position:absolute; right:11px; display:flex; color:var(--color-text-tertiary); pointer-events:none;">${icon('chevronDown', 16)}</span>
  </label>`;
}
import { openProductModal } from '../components/product-modal.js';
import { createSlug, getStoreUrl } from '../utils/slug.js';
import { getArgentinaTime, hasWeeklySchedule } from '../utils/format.js';
import '../styles/tienda.css';
import { storeInitials } from '../utils/store-initials.js';
import { isSoldByWeight } from '../utils/weight.js';
import { isMarketStore, mountMarket } from './comercio-market.js';
import { closesAtText } from '../utils/commerce-hours.js';

let currentComercio = null;
let currentActiveOrder = null;
const memoryCommerceCache = new Map();

// El menú guardado se muestra aunque sea viejo y se actualiza por detrás (antes se tiraba a las 4 h
// y la tienda quedaba en gris esperando al servidor). Más de una semana ya no vale la pena.
const MENU_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_PRODUCTS = 30;

// Cargas del menú en curso: la precarga (al tocar la tarjeta) y la página usan la misma
const menuLoads = new Map();

// Si la tanda llegó al tope (comercios con miles de productos ocultos, como los de Ventra), se
// piden aparte los que están a la venta: si no, los publicados podían quedar afuera de la tanda
async function withAvailable(comercioId, list, max, catId) {
  if (list.length < max) return list;
  const filters = [where('isAvailable', '==', true), ...(catId ? [where('categoryId', '==', catId)] : [])];
  const snap = await getDocsOptimized(
    query(collection(db, 'comercios', comercioId, 'products'), ...filters, limit(max)),
    `comercio_products_${comercioId}_avail_${catId || 'all'}`,
    2 * 60 * 1000
  ).catch(() => ({ docs: [] }));
  const seen = new Set(list.map(p => p.id));
  return [...list, ...(snap.docs || []).filter(d => !seen.has(d.id)).map(d => ({ id: d.id, ...d.data() }))];
}

function loadMenu(comercioId) {
  const running = menuLoads.get(comercioId);
  if (running) return running;
  // getDocsOptimized nunca falla: ante un error devuelve una respuesta vacía marcada con error
  const catsP = getDocsOptimized(
    query(collection(db, 'comercios', comercioId, 'categories'), orderBy('order')),
    `comercio_categories_${comercioId}`,
    2 * 60 * 1000
  );
  const offersP = getDocsOptimized(
    query(collection(db, 'offers'), where('comercioId', '==', comercioId), where('active', '==', true)),
    `comercio_offers_${comercioId}`,
    5 * 60 * 1000
  );
  const prodsP = getDocsOptimized(
    // 100 silently hid the rest of bigger menus. 2 min cache instead of 15 so a product the
    // commerce just paused or ran out of doesn't keep showing as available.
    query(collection(db, 'comercios', comercioId, 'products'), limit(400)),
    `comercio_products_${comercioId}_cat_all`,
    2 * 60 * 1000
  );
  const entry = { catsP, offersP, result: null };
  entry.full = (async () => {
    const [catsSnap, offersSnap, prodSnap] = await Promise.all([catsP, offersP, prodsP]);
    const categories = (catsSnap.docs || []).map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
    const activeOffers = (offersSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
    const products = await withAvailable(comercioId, (prodSnap.docs || []).map(d => ({ id: d.id, ...d.data() })), 400, null);
    const snaps = [catsSnap, offersSnap, prodSnap];
    entry.result = {
      categories, activeOffers, products,
      hadLoadError: snaps.some(s => s?.error),
      // El motivo va en el mensaje: si es un timeout o falta de red, el detector lo marca como red
      reasons: [...new Set(snaps.map(s => s?.reason).filter(Boolean))].join(' | ')
    };
    return entry.result;
  })();
  menuLoads.set(comercioId, entry);
  // Pasado un rato se vuelve a pedir (lo pausado o agotado tiene que llegar)
  entry.full.finally(() => setTimeout(() => { if (menuLoads.get(comercioId) === entry) menuLoads.delete(comercioId); }, 30000));
  return entry;
}

/** Empieza a cargar la tienda antes de entrar (al apoyar el dedo en la tarjeta). */
export function prefetchComercio(comercioId) {
  if (!comercioId || memoryCommerceCache.has(comercioId) || menuLoads.has(comercioId)) return;
  loadMenu(comercioId);
}

const productSkeletonHtml = () => Array(4).fill(`
  <div class="product-card skeleton-card" style="display:flex; justify-content:space-between; gap:16px; padding:16px;">
    <div style="flex:1;">
      <div class="skeleton skeleton-title" style="width:80%; height:16px; margin-bottom:8px;"></div>
      <div class="skeleton skeleton-text" style="width:40%; height:12px;"></div>
    </div>
    <div class="skeleton" style="width:110px; height:110px; border-radius:14px;"></div>
  </div>
`).join('');

export async function renderComercio(content, isDirectMode = false) {
  if (!content) {
    content = document.getElementById('overlay-render-target') || document.getElementById('app-content');
  }
  // Marca de esta visita: lo que llega tarde de otra tienda no se dibuja encima
  const renderToken = {};
  content._comercioRender = renderToken;
  // ¿Sigue en pantalla esta visita? (otra tienda reemplaza el contenido o lo saca del documento)
  const stillHere = () => content.isConnected && content._comercioRender === renderToken;
  const params = getRouteParams();
  let comercioId = params.id;
  if (!comercioId) {
    const rawHash = window.location.hash.split('?')[0];
    const cleanHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    const parts = cleanHash.split('/').filter(Boolean);
    if (parts.length >= 2) {
      comercioId = parts[1];
    }
  }

  const isDirect = isDirectMode || window.location.hash.startsWith('#/tienda/') || window.location.hash.includes('direct=true') || document.body.classList.contains('is-direct-store-mode') || document.documentElement.classList.contains('is-direct-store-mode');
  if (isDirect) {
    document.documentElement.classList.add('is-direct-store-mode');
    document.body.classList.add('is-direct-store-mode');
  }

  if (!comercioId) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('alertTriangle', 40)}</div><div class="empty-state-title">Comercio no encontrado</div></div>`;
    return;
  }

  // Resolve actual commerce ID (allowing matching by slug, ID, subdomain, or name)
  let comercio = null;
  const cleanTarget = decodeURIComponent(comercioId || '').toLowerCase().trim();

  // 1. Check in-memory fast cache
  if (memoryCommerceCache.has(comercioId)) {
    comercio = memoryCommerceCache.get(comercioId)?.comercio || null;
  }
  if (!comercio && memoryCommerceCache.has(cleanTarget)) {
    comercio = memoryCommerceCache.get(cleanTarget)?.comercio || null;
  }

  // 2. Check localStorage global comercios cache
  if (!comercio) {
    try {
      const cachedComerciosRaw = localStorage.getItem('gd_cached_comercios');
      if (cachedComerciosRaw) {
        const list = JSON.parse(cachedComerciosRaw);
        comercio = list.find(c => 
          c.id === comercioId || 
          (c.slug && c.slug.toLowerCase() === cleanTarget) ||
          (c.subdomain && c.subdomain.toLowerCase() === cleanTarget) ||
          (c.name && (c.name.toLowerCase() === cleanTarget || createSlug(c.name) === cleanTarget))
        );
      }
    } catch (e) {
      console.warn('Error matching commerce from cache:', e);
    }
  }

  // 3. Check individual store cache or dedicated slug cache
  if (!comercio) {
    try {
      const singleCached = localStorage.getItem(`gd_comercio_cache_${comercioId}`) || localStorage.getItem(`gd_comercio_slug_${cleanTarget}`);
      if (singleCached) {
        const parsed = JSON.parse(singleCached);
        if (parsed?.data?.comercio || parsed?.comercio) {
          comercio = parsed.data?.comercio || parsed.comercio;
        }
      }
    } catch (e) {}
  }

  // 4. Parallel Firestore lookup (Fast 1-trip resolution), bounded by a
  // timeout so a slow connection shows the retry screen instead of hanging.
  if (!comercio) {
    try {
      const docRef = doc(db, 'comercios', comercioId);
      const slugQuery = query(collection(db, 'comercios'), where('slug', '==', cleanTarget), limit(1));

      const [snap, slugSnap] = await withTimeout(
        Promise.all([
          getDoc(docRef).catch(() => null),
          getDocs(slugQuery).catch(() => null)
        ]),
        8000,
        `resolve_comercio_${comercioId}`
      );

      if (snap && snap.exists()) {
        comercio = { id: snap.id, ...snap.data() };
      } else if (slugSnap && !slugSnap.empty) {
        const matchedDoc = slugSnap.docs[0];
        comercio = { id: matchedDoc.id, ...matchedDoc.data() };
      } else {
        // Last-resort fallback: id/slug matched nothing directly (e.g. name
        // used as target, or casing mismatch). Use the cached/optimized
        // comercios list instead of a raw full-collection getDocs so repeat
        // misses don't re-scan the whole collection on every load.
        const allComSnap = await getDocsOptimized(
          collection(db, 'comercios'),
          'all_comercios_fallback',
          15 * 60 * 1000,
          8000
        );
        if (!allComSnap.empty) {
          const matchedDoc = allComSnap.docs.find(d => {
            const data = d.data();
            const name = (data.name || '').toLowerCase();
            const slug = (data.slug || createSlug(data.name || '')).toLowerCase();
            const sub = (data.subdomain || '').toLowerCase();
            return d.id === comercioId || slug === cleanTarget || name === cleanTarget || sub === cleanTarget || name.includes(cleanTarget);
          });
          if (matchedDoc) {
            comercio = { id: matchedDoc.id, ...matchedDoc.data() };
          }
        }
      }
    } catch (err) {
      console.error('Error resolving commerce document:', err);
    }
  }

  if (comercio) {
    try {
      safeStorage.setItem(`gd_comercio_slug_${cleanTarget}`, JSON.stringify({ comercio }));
    } catch (e) {}
  }

  if (!comercio) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('store', 40)}</div><div class="empty-state-title">Comercio no encontrado</div><button class="btn btn-primary" onclick="location.hash='/#'">Volver</button></div>`;
    return;
  }

  currentComercio = comercio;
  const resolvedComercioId = comercio.id;
  // Kioscos, almacenes y comercios de Ventra: tienda tipo mercado (comercio-market.js)
  const isMarket = isMarketStore(comercio);
  // En la app, restaurantes y demás también usan esa tienda (con los platos en lista). El catálogo online de un
  // restaurante (#/tienda/) sigue con su diseño propio.
  const useStore = isMarket || !isDirect;
  const storeCtx = (data) => ({ comercio, ...data, products: [...(data.products || [])], isDirect, comercioId: resolvedComercioId, onRate: (c) => openRatingModal(c) });
  let marketView = null;
  // La ficha del producto lo usa para explicar quién pesa (el comercio o el repartidor)
  setState('currentComercioMode', { id: comercio.id, fulfillmentMode: comercio.fulfillmentMode || null, category: comercio.category || '' });
  try {
    safeStorage.setItem('gd_last_visited_comercio', JSON.stringify({ id: comercio.id, name: comercio.name || 'Comercio' }));
  } catch (e) {}

  let unsubComercios = null;

  try {
    const { onSnapshot, doc: firestoreDoc } = await import('firebase/firestore');
    const docRef = firestoreDoc(db, 'comercios', resolvedComercioId);
    unsubComercios = onSnapshot(docRef, (snap) => {
      // Si ya se salió de esta tienda (o se fue antes de que terminara de cargar y nadie llamó al cleanup), se
      // apaga sola: si no, cada cambio de este comercio pisaba el banner y el nombre de la tienda que esté abierta
      if (!stillHere()) { if (unsubComercios) unsubComercios(); return; }
      if (snap.exists()) {
        const prevPaused = currentComercio?.isPaused;
        const freshData = snap.data();
        comercio = { id: snap.id, ...freshData };
        
        // Update DOM elements in real time (solo los de esta tienda)
        const logoImg = content.querySelector('.comercio-detail-logo');
        if (logoImg && logoImg.tagName === 'IMG') logoImg.src = comercio.logo || '/logo.png';
        const bannerImg = content.querySelector('#comercio-banner-img') || content.querySelector('.comercio-header img');
        if (bannerImg && bannerImg.tagName === 'IMG' && comercio.banner) bannerImg.src = comercio.banner;
        const nameEl = content.querySelector('.comercio-info-text h1');
        if (nameEl) nameEl.textContent = comercio.name;
        const descEl = content.querySelector('.comercio-description');
        if (descEl) descEl.textContent = comercio.description || '';

        // Real-time isPaused update: update badge + pause banner + product buttons
        if (freshData.isPaused !== prevPaused) {
          // Update open/closed badge
          const statusBadge = content.querySelector('#comercio-status-badge');
          if (statusBadge) {
            const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
            const badgeText = comercio.isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
            const dotColor = comercio.isPaused ? '#f59e0b' : (isOpen ? '#22c55e' : '#8d8a86');
            if (statusBadge.classList.contains('tnd-fact')) {
              // Catálogo online: la etiqueta toma su color por clase
              statusBadge.className = `tnd-fact ${comercio.isPaused ? 'is-paused' : (isOpen ? 'is-open' : 'is-closed')}`;
              statusBadge.innerHTML = `<span class="tnd-dot"></span>${comercio.isPaused ? 'Pausado por un rato' : statusLine(comercio, isOpen)}`;
            } else {
              statusBadge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;"></span> ${badgeText}`;
            }
          }
          // Show/hide paused banner
          const pauseBanner = content.querySelector('#comercio-pause-banner');
          if (pauseBanner) pauseBanner.style.display = comercio.isPaused ? 'flex' : 'none';
          // Disable/enable all add-to-cart buttons
          content.querySelectorAll('.product-card-add').forEach(btn => {
            btn.style.display = comercio.isPaused ? 'none' : '';
          });
          // Show/hide paused pill on product cards
          content.querySelectorAll('.product-paused-pill').forEach(el => {
            el.style.display = comercio.isPaused ? '' : 'none';
          });
        }

        // Update local storage cache
        try {
          const rawCache = localStorage.getItem(`gd_comercio_cache_${resolvedComercioId}`);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            parsed.data.comercio = comercio;
            safeStorage.setItem(`gd_comercio_cache_${resolvedComercioId}`, JSON.stringify(parsed));
          }
        } catch (e) {}
        
        currentComercio = comercio;
      }
    });
  } catch (err) {
    console.warn('Error setting up real-time listener for commerce details:', err);
  }

  let unsubActiveOrders = null;
  const currentUser = getState().user;
  if (currentUser) {
    try {
      const { collection, query, where, onSnapshot } = await import('firebase/firestore');
      const qOrders = query(
        collection(db, 'orders'),
        where('userId', '==', currentUser.uid),
        where('status', 'in', ['pending', 'confirmed', 'accepted', 'preparing', 'ready', 'picked_up', 'at_door', 'delivering'])
      );
      unsubActiveOrders = onSnapshot(qOrders, (snap) => {
        if (!stillHere()) { if (unsubActiveOrders) unsubActiveOrders(); return; }
        const activeOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (new Date(a.createdAt || 0).getTime());
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (new Date(b.createdAt || 0).getTime());
            return timeB - timeA;
          });
        
        const relevantOrder = activeOrders.find(o => o.comercioId === resolvedComercioId) || activeOrders[0] || null;
        updateComercioActiveOrderUI(relevantOrder, resolvedComercioId, isDirectMode);
      }, (err) => {
        console.warn('Active order listener error in comercio:', err);
      });
    } catch (e) {
      console.warn('Error setting up active order listener:', e);
    }
  }

  // Proactive fee calculation
  import('./cart.js').then(m => m.calculateAllFees && m.calculateAllFees(resolvedComercioId));

  const menuLoad = loadMenu(resolvedComercioId);
  // La precarga ya terminó: se dibuja con eso, sin pasar por el gris
  let cachedData = memoryCommerceCache.get(resolvedComercioId)
    || (menuLoad.result && !menuLoad.result.hadLoadError ? { comercio, ...menuLoad.result } : null);
  if (!cachedData) {
    try {
      const rawCache = localStorage.getItem(`gd_comercio_cache_${resolvedComercioId}`);
      if (rawCache) {
        const parsed = JSON.parse(rawCache);
        if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < MENU_CACHE_MAX_AGE_MS)) {
          cachedData = parsed.data;
          memoryCommerceCache.set(resolvedComercioId, cachedData);
        }
      }
    } catch (err) {
      console.warn('Error reading local cache:', err);
    }
  }

  let activeCategory = 'all';
  let activeSort = 'default';
  let activeSearch = '';
  let activeBrand = 'all';
  let activeSubCategory = 'all';
  let deepLinkOpened = false;

  // If cache exists, do a zero-ms instant render first!
  if (cachedData) {
    const { categories, products, activeOffers } = cachedData;
    setState('activeOffers', activeOffers);
    setState('currentProducts', products);
    if (useStore) marketView = mountMarket(content, storeCtx({ categories, products, activeOffers }));
    else renderPage(content, comercio, categories, products, activeCategory, activeOffers, activeSort, activeBrand, activeSubCategory, isDirect);
    
    // Trigger deep-link product modal if parameter exists in URL
    try {
      const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const targetProductId = urlParams.get('product') || urlParams.get('p');
      if (targetProductId && !deepLinkOpened) {
        const targetProd = products.find(p => p.id === targetProductId);
        if (targetProd && targetProd.isAvailable !== false && !(targetProd.stockMode === 'limited' && (targetProd.stockQuantity || 0) <= 0)) {
          const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
          deepLinkOpened = true;
          setTimeout(() => {
            openProductModal(targetProd, resolvedComercioId, comercio.name, isOpen);
          }, 300);
        }
      }
    } catch (e) {}
  } else if (isMarket) {
    // Primera vez: la cabecera ya está (viene del inicio) y el mercado trae solo sus más vendidos
    marketView = mountMarket(content, storeCtx({ categories: [], products: [], activeOffers: [] }));
  } else if (useStore) {
    // Restaurante, primera vez: tarjeta y barra al instante, el menú en gris hasta que llega una tanda
    marketView = mountMarket(content, storeCtx({ categories: [], products: [], activeOffers: [] }));
    Promise.all([
      menuLoad.catsP,
      menuLoad.offersP,
      withTimeout(getDocs(query(collection(db, 'comercios', resolvedComercioId, 'products'), where('isAvailable', '==', true), limit(PREVIEW_PRODUCTS))), 8000, 'comercio_preview')
    ]).then(([catsSnap, offersSnap, prevSnap]) => {
      if (menuLoad.result || !stillHere() || !marketView) return;
      marketView.update({
        categories: (catsSnap.docs || []).map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false),
        products: prevSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        activeOffers: (offersSnap.docs || []).map(d => ({ id: d.id, ...d.data() }))
      });
    }).catch(() => {});
  } else {
    // Primera vez: cabecera al instante y gris solo donde van los productos
    const paintPartial = (categories, products, activeOffers) => {
      renderPage(content, comercio, categories, products, activeCategory, activeOffers, activeSort, activeBrand, activeSubCategory, isDirect);
      const grid = content.querySelector('#comercio-products');
      if (grid && !products.length) grid.innerHTML = productSkeletonHtml();
    };
    paintPartial([], [], []);
    // Una tanda chica para llenar la pantalla mientras llega el menú entero
    Promise.all([
      menuLoad.catsP,
      menuLoad.offersP,
      withTimeout(getDocs(query(collection(db, 'comercios', resolvedComercioId, 'products'), where('isAvailable', '==', true), limit(PREVIEW_PRODUCTS))), 8000, 'comercio_preview')
    ]).then(([catsSnap, offersSnap, prevSnap]) => {
      if (menuLoad.result || content._comercioRender !== renderToken) return;
      paintPartial(
        (catsSnap.docs || []).map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false),
        prevSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        (offersSnap.docs || []).map(d => ({ id: d.id, ...d.data() }))
      );
    }).catch(() => {});
  }

  try {
    const menu = await menuLoad.full;
    const { categories, activeOffers, hadLoadError } = menu;
    // Copia propia: las categorías que se abren después le suman productos
    let products = [...menu.products];

    if (hadLoadError && products.length === 0 && categories.length === 0 && !cachedData) {
      throw new Error(`Failed to load comercio menu data (categories/products query error)${menu.reasons ? `: ${menu.reasons}` : ''}`);
    }
    const loadCategoryProducts = async (catId) => {
      let q;
      let cacheKey = `comercio_products_${resolvedComercioId}_cat_${catId}`;
      if (catId === 'all') {
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), limit(400));
      } else if (catId === 'discounts') {
        const productIds = [];
        activeOffers.forEach(o => {
          if (o.productIds) productIds.push(...o.productIds);
        });
        if (productIds.length > 0) {
          q = query(collection(db, 'comercios', resolvedComercioId, 'products'), where('__name__', 'in', productIds.slice(0, 30)));
        } else {
          return [];
        }
      } else if (catId === 'favorites') {
        const favoriteIds = getState().favorites || [];
        if (favoriteIds.length > 0) {
          q = query(collection(db, 'comercios', resolvedComercioId, 'products'), where('__name__', 'in', favoriteIds.slice(0, 30)));
        } else {
          return [];
        }
      } else {
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), where('categoryId', '==', catId), limit(300));
      }

      try {
        const prodsSnap = await getDocsOptimized(q, cacheKey, 2 * 60 * 1000);
        const list = (prodsSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        if (catId === 'all') return withAvailable(resolvedComercioId, list, 400, null);
        if (catId !== 'discounts' && catId !== 'favorites') return withAvailable(resolvedComercioId, list, 300, catId);
        return list;
      } catch (err) {
        try {
          const directSnap = await getDocs(q);
          return (directSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
          return [];
        }
      }
    };

    // Store in memory & localStorage for next instant load. Con un error de red no se pisa lo
    // guardado: el menú guardado ahora dura una semana y quedaría vacío todo ese tiempo
    const cachePayload = { comercio, categories, products, activeOffers };
    if (!hadLoadError) {
      memoryCommerceCache.set(resolvedComercioId, cachePayload);
      safeStorage.setItem(`gd_comercio_cache_${resolvedComercioId}`, JSON.stringify({
        timestamp: Date.now(),
        data: cachePayload
      }));
    }

    setState('activeOffers', activeOffers);
    setState('currentProducts', products);

    // If cache was already rendered, only re-render if data has changed (prevent flashing)
    let shouldRender = true;
    if (cachedData) {
      const getCacheFingerprint = (data) => {
        const c = data.comercio || {};
        const pList = data.products || [];
        const catList = data.categories || [];
        return JSON.stringify({
          comercioId: c.id,
          comercioName: c.name,
          comercioOpen: isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen, c.weeklySchedule),
          categoriesLength: catList.length,
          categoriesIds: catList.map(cat => cat.id).join(','),
          productsLength: pList.length,
          productsFingerprint: pList.map(p => `${p.id}:${p.price}:${p.isAvailable !== false}:${p.name}`).join(',')
        });
      };
      if (getCacheFingerprint(cachedData) === getCacheFingerprint({ comercio, categories, products, activeOffers })) {
        shouldRender = false; // No visual changes, no flashing!
      }
    }

    if (useStore) {
      // Sin productos también: así el menú deja el gris y dice que no hay nada
      if (marketView) { if (shouldRender || !products.length) marketView.update({ comercio, categories, products, activeOffers }); }
      else marketView = mountMarket(content, storeCtx({ categories, products, activeOffers }));
    } else if (shouldRender) {
      renderPage(content, comercio, categories, products, activeCategory, activeOffers, activeSort, activeBrand, activeSubCategory, isDirect);
    }

    // Deep link product modal trigger
    try {
      const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const targetProductId = urlParams.get('product') || urlParams.get('p');
      if (targetProductId && !deepLinkOpened) {
        let targetProd = products.find(p => p.id === targetProductId);
        if (!targetProd) {
          const { doc: firestoreDoc, getDoc } = await import('firebase/firestore');
          const pSnap = await getDoc(firestoreDoc(db, 'comercios', resolvedComercioId, 'products', targetProductId));
          if (pSnap.exists()) {
            targetProd = { id: pSnap.id, ...pSnap.data() };
          }
        }
        if (targetProd && targetProd.isAvailable !== false && !(targetProd.stockMode === 'limited' && (targetProd.stockQuantity || 0) <= 0)) {
          const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
          deepLinkOpened = true;
          setTimeout(() => {
            openProductModal(targetProd, resolvedComercioId, comercio.name, isOpen);
          }, 350);
        }
      }
    } catch (e) {
      console.warn('Failed parsing deep-link parameters or loading target product', e);
    }

    // Helper for smooth scrolling when filtering prevents layout snapping
    const smoothScrollToProductsTop = () => {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      if (scrollY > 120) {
        const currentHeight = document.body.offsetHeight;
        document.body.style.minHeight = `${currentHeight}px`;
        window.scrollTo({ top: 120, behavior: 'smooth' });
        setTimeout(() => {
          document.body.style.minHeight = '';
        }, 500);
      }
    };

    // Category filter handler
    const catContainer = content.querySelector('#comercio-categories') || document.getElementById('comercio-categories');
    catContainer?.addEventListener('click', async (e) => {
      const pill = e.target.closest('.tab-pill');
      if (!pill) return;
      activeCategory = pill.dataset.catId;
      activeSubCategory = 'all'; // Reset subcategory when main category changes

      (content.querySelectorAll('#comercio-categories .tab-pill') || document.querySelectorAll('#comercio-categories .tab-pill')).forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      // Smoothly scroll the pill to the left position (like "Todos")
      if (pill.parentElement) {
        const container = pill.parentElement;
        container.scrollTo({ left: pill.offsetLeft - 16, behavior: 'smooth' });
      }

      // Update subcategories container dynamically
      const subCats = categories.filter(c => c.parentCategoryId === activeCategory);
      const subContainer = content.querySelector('#comercio-subcategories-container') || document.getElementById('comercio-subcategories-container');
      const subGrid = content.querySelector('#comercio-subcategories') || document.getElementById('comercio-subcategories');
      if (subContainer && subGrid) {
        if (subCats.length > 0) {
          subContainer.style.display = 'block';
          subGrid.innerHTML = subPillHtml('all', 'Todo', true) + subCats.map(sub => subPillHtml(sub.id, sub.name, false)).join('');
        } else {
          subContainer.style.display = 'none';
          subGrid.innerHTML = '';
        }
      }

      const grid = content.querySelector('#comercio-products') || document.getElementById('comercio-products');
      const hasLoadedCategory = (catId) => {
        if (catId === 'all') return true;
        if (catId === 'discounts') return products.some(p => activeOffers.some(o => o.productIds && o.productIds.includes(p.id)));
        if (catId === 'favorites') return true;
        // If loaded any product in main category or its subcategories
        const allowedIds = [catId, ...categories.filter(c => c.parentCategoryId === catId).map(c => c.id)];
        return products.some(p => allowedIds.includes(p.categoryId));
      };

      if (!hasLoadedCategory(activeCategory)) {
        if (grid) {
          grid.innerHTML = Array(4).fill(`
            <div class="product-card skeleton-card" style="display:flex; justify-content:space-between; gap:16px; padding:16px;">
              <div style="flex:1;">
                <div class="skeleton skeleton-title" style="width:80%; height:16px; margin-bottom:8px;"></div>
                <div class="skeleton skeleton-text" style="width:40%; height:12px;"></div>
              </div>
              <div class="skeleton" style="width:110px; height:110px; border-radius:14px;"></div>
            </div>
          `).join('');
        }
        try {
          // Load products for main category
          const catProducts = await loadCategoryProducts(activeCategory);
          catProducts.forEach(cp => {
            if (!products.some(p => p.id === cp.id)) {
              products.push(cp);
            }
          });
          // Also load products for any subcategories concurrently in parallel
          if (subCats.length > 0) {
            const subResults = await Promise.all(subCats.map(sub => loadCategoryProducts(sub.id)));
            subResults.flat().forEach(cp => {
              if (!products.some(p => p.id === cp.id)) {
                products.push(cp);
              }
            });
          }
          setState('currentProducts', products);
        } catch (err) {
          console.error('Error loading category products:', err);
        }
      }

      // Update brands dropdown dynamically
      activeBrand = updateBrandDropdown(products, activeCategory, activeSubCategory, categories, activeBrand, activeOffers);

      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

    // Subcategory filter handler (delegated click event)
    content.addEventListener('click', async (e) => {
      const subPill = e.target.closest('.sub-tab-pill');
      if (!subPill) return;
      activeSubCategory = subPill.dataset.subcatId;

      content.querySelectorAll('.sub-tab-pill').forEach(p => p.classList.remove('active'));
      subPill.classList.add('active');
      
      // Smoothly scroll the sub-pill to the left position
      if (subPill.parentElement) {
        const container = subPill.parentElement;
        container.scrollTo({ left: subPill.offsetLeft, behavior: 'smooth' });
      }
      
      content.querySelectorAll('.sub-tab-pill').forEach(p => {
        p.setAttribute('style', subPillStyle(p.dataset.subcatId === activeSubCategory));
      });

      // Update brands dropdown dynamically
      activeBrand = updateBrandDropdown(products, activeCategory, activeSubCategory, categories, activeBrand, activeOffers);

      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

    // Brand filter handler
    content.addEventListener('change', (e) => {
      if (e.target.id === 'comercio-brand-select') {
        activeBrand = e.target.value;
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
        smoothScrollToProductsTop();
        renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
      }
    });

    // Sort filter handler
    const sortSelect = content.querySelector('#comercio-sort-select') || document.getElementById('comercio-sort-select');
    sortSelect?.addEventListener('change', (e) => {
      activeSort = e.target.value;
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

    // Con catálogos grandes (los de Ventra tienen miles) la primera tanda trae solo una parte: al
    // buscar se piden una vez todos los que están a la venta, si no la búsqueda no encuentra el resto
    let allAvailableLoad = null;
    const loadAllAvailable = () => {
      if (products.length < 400) return Promise.resolve();
      if (!allAvailableLoad) {
        allAvailableLoad = getDocsOptimized(
          query(collection(db, 'comercios', resolvedComercioId, 'products'), where('isAvailable', '==', true)),
          `comercio_products_${resolvedComercioId}_avail_every`,
          2 * 60 * 1000
        ).then((snap) => {
          const seen = new Set(products.map(p => p.id));
          (snap.docs || []).forEach(d => { if (!seen.has(d.id)) products.push({ id: d.id, ...d.data() }); });
          setState('currentProducts', products);
        }).catch(() => { allAvailableLoad = null; });
      }
      return allAvailableLoad;
    };

    // Search input handler
    let comercioSearchDebounceTimer = null;
    const searchInput = content.querySelector('#comercio-product-search') || document.getElementById('comercio-product-search');
    searchInput?.addEventListener('input', (e) => {
      activeSearch = e.target.value.trim().toLowerCase();
      const clearBtn = content.querySelector('#clear-search-btn') || document.getElementById('clear-search-btn');
      if (clearBtn) {
        clearBtn.style.display = activeSearch ? 'flex' : 'none';
      }
      if (comercioSearchDebounceTimer) clearTimeout(comercioSearchDebounceTimer);
      comercioSearchDebounceTimer = setTimeout(async () => {
        if (activeSearch) await loadAllAvailable();
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
        renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
      }, 120);
    });

    const clearSearchBtn = content.querySelector('#clear-search-btn') || document.getElementById('clear-search-btn');
    clearSearchBtn?.addEventListener('click', () => {
      const input = content.querySelector('#comercio-product-search') || document.getElementById('comercio-product-search');
      if (input) input.value = '';
      activeSearch = '';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

    // Product interaction handler (Delegated to container)
    const productsContainer = content.querySelector('#comercio-products') || document.getElementById('comercio-products');
    if (productsContainer) {
      productsContainer.onclick = (e) => {
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);

        const card = e.target.closest('.product-card');
        const addBtn = e.target.closest('.product-card-add');

        if (!card) return;

        const productId = card.dataset.productId;
        const product = products.find(p => p.id === productId);

        if (!product || card.classList.contains('product-unavailable')) return;

        // If quick-add button clicked AND product has no required options/extras
        // Por peso también abre la ficha: ahí se elige cuánto
        const hasOptions = (product.optionsGroups && product.optionsGroups.length > 0) || product.useGlobalFlavors === true || isSoldByWeight(product);

        if (addBtn && !hasOptions) {
          e.preventDefault();
          e.stopPropagation();

          if (!isOpen) {
            showToast('El comercio está cerrado. No se pueden agregar productos al carrito.', 'warning');
            return;
          }

          if (currentComercio?.isPaused) {
            showToast('Este comercio está cerrado temporalmente. Volvé a intentar más tarde.', 'warning');
            return;
          }

          // Haptic feedback
          if (navigator.vibrate) navigator.vibrate(15);

          // Flying animation
          const btnRect = addBtn.getBoundingClientRect();
          const fab = document.querySelector('.fab');
          const targetRect = fab ? fab.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight - 80 };

          const flyer = document.createElement('div');
          flyer.className = 'flying-dot';
          flyer.style.left = `${btnRect.left + btnRect.width / 2}px`;
          flyer.style.top = `${btnRect.top + btnRect.height / 2}px`;
          flyer.innerHTML = icon('plus', 12);
          document.body.appendChild(flyer);

          setTimeout(() => {
            flyer.style.left = `${targetRect.left + targetRect.width / 2}px`;
            flyer.style.top = `${targetRect.top + targetRect.height / 2}px`;
            flyer.style.transform = 'scale(0.2) rotate(360deg)';
            flyer.style.opacity = '0';
          }, 10);

          setTimeout(() => flyer.remove(), 800);

          addToCart(product, resolvedComercioId, comercio.name, 1);
          showToast(`${product.name} agregado`, 'success');

          addBtn.classList.add('success');
          if (addBtn._successTimeout) {
            clearTimeout(addBtn._successTimeout);
          }
          addBtn.innerHTML = icon('check', 18);
          addBtn._successTimeout = setTimeout(() => {
            addBtn.classList.remove('success');
            addBtn.innerHTML = icon('plus', 16);
            delete addBtn._successTimeout;
          }, 1500);

          renderNavbar();
          if (isDirect) {
            updateDirectCartBar(resolvedComercioId);
          } else {
            updateGlobalCartFAB();
          }
          return;
        }

        // Open modal for anything else (card click or button on complex products)
        openProductModal(product, resolvedComercioId, comercio.name, isOpen);
      };
    }

  } catch (e) {
    console.error('Error loading comercio:', e);
    content.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px; text-align: center;">
        <div class="empty-state-icon" style="margin-bottom: 12px;">${icon('alertTriangle', 40)}</div>
        <div class="empty-state-title" style="font-size: 18px; font-weight: 800; margin-bottom: 8px;">No se pudo cargar el catálogo</div>
        <p style="color: var(--color-text-secondary); font-size: 13px; max-width: 280px; margin: 0 auto 20px;">Hubo una interrupción al conectar con la tienda. Tocá el botón para reintentar.</p>
        <button class="btn btn-primary" onclick="window.location.reload()" style="padding: 10px 24px; border-radius: 12px; font-weight: 800;">Reintentar</button>
      </div>
    `;
  }

  // Cart subscription (Direct bar or global FAB)
  const unsub = subscribe('cart', () => {
    if (isDirect) {
      updateDirectCartBar(resolvedComercioId);
    } else {
      updateGlobalCartFAB();
    }
  });

  return {
    cleanup: () => {
      unsub();
      if (marketView) marketView.cleanup();
      if (unsubComercios) unsubComercios();
      if (unsubActiveOrders) unsubActiveOrders();
      if (window._comercioScrollHandler) {
        window.removeEventListener('scroll', window._comercioScrollHandler, { capture: true });
      }
      const bar = document.getElementById('direct-store-cart-bar');
      if (bar) bar.remove();
      const topBanner = document.getElementById('comercio-active-order-card');
      if (topBanner) topBanner.remove();
      const navOrderBtn = document.getElementById('comercio-nav-live-order-btn');
      if (navOrderBtn) navOrderBtn.remove();
    }
  };
}

export function updateComercioActiveOrderUI(order, comercioId, isDirect) {
  currentActiveOrder = order;
  
  // 1. Top Active Order Banner inside .comercio-info
  const infoContainer = document.querySelector('.comercio-info');
  let topBanner = document.getElementById('comercio-active-order-card');
  
  if (order && !['completed', 'cancelled', 'delivered'].includes(order.status)) {
    let color1 = '#10b981', color2 = '#059669', statusIcon = '🛵', statusText = '¡Pedido en camino a tu domicilio!', textColor = '#059669';
    switch (order.status) {
      case 'pending':
        color1 = '#f59e0b'; color2 = '#d97706'; statusIcon = '⏳'; statusText = 'Esperando confirmación del comercio'; textColor = '#d97706';
        break;
      case 'confirmed':
        color1 = '#0284c7'; color2 = '#0369a1'; statusIcon = '👨‍🍳'; statusText = 'Comercio preparando tu pedido'; textColor = '#0369a1';
        break;
      case 'ready':
        color1 = '#7c3aed'; color2 = '#5b21b6'; statusIcon = '📦'; statusText = '¡Pedido listo para retiro/envío!'; textColor = '#5b21b6';
        break;
      case 'delivering':
        color1 = '#10b981'; color2 = '#059669'; statusIcon = '🛵'; statusText = '¡Pedido en camino a tu domicilio!'; textColor = '#059669';
        break;
    }

    if (!topBanner && infoContainer) {
      topBanner = document.createElement('div');
      topBanner.id = 'comercio-active-order-card';
      infoContainer.appendChild(topBanner);
    }

    if (topBanner) {
      topBanner.style.cssText = `
        margin-top: 14px;
        background: linear-gradient(135deg, ${color1} 0%, ${color2} 100%);
        border-radius: 20px;
        padding: 16px 18px;
        color: white;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 10px 25px rgba(0,0,0,0.18);
        cursor: pointer;
        border: 1.5px solid rgba(255,255,255,0.25);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      `;
      topBanner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
          <div style="width: 44px; height: 44px; border-radius: 14px; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">
            ${statusIcon}
          </div>
          <div style="min-width: 0;">
            <div style="font-size: 10.5px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.95;">
              🟢 Pedido en Curso #${order.orderId || order.id.slice(0, 6)}
            </div>
            <div style="font-size: 14px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
              ${statusText} ${order.verificationCode ? `• Cód: ${order.verificationCode}` : ''}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 5px; background: white; color: ${textColor}; padding: 8px 14px; border-radius: 12px; font-weight: 900; font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); flex-shrink: 0; margin-left: 8px;">
          <span>SEGUIR</span> 📍
        </div>
      `;
      topBanner.onclick = () => {
        window.location.hash = `#/pedido/${order.id}`;
      };
    }

    // 2. Top Sticky Navbar live tracking button
    const navbar = document.getElementById('comercio-navbar');
    if (navbar) {
      let navOrderBtn = document.getElementById('comercio-nav-live-order-btn');
      if (!navOrderBtn) {
        navOrderBtn = document.createElement('button');
        navOrderBtn.id = 'comercio-nav-live-order-btn';
        navbar.appendChild(navOrderBtn);
      }
      navOrderBtn.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, ${color1} 0%, ${color2} 100%);
        color: white;
        border: none;
        padding: 7px 13px;
        border-radius: 100px;
        font-size: 11px;
        font-weight: 850;
        cursor: pointer;
        box-shadow: 0 3px 10px rgba(0,0,0,0.2);
        flex-shrink: 0;
        z-index: 10;
        margin-left: 6px;
      `;
      navOrderBtn.innerHTML = `<span>📍</span> <span>Seguir Pedido</span>`;
      navOrderBtn.onclick = () => {
        window.location.hash = `#/pedido/${order.id}`;
      };
    }
  } else {
    if (topBanner) topBanner.remove();
    const navOrderBtn = document.getElementById('comercio-nav-live-order-btn');
    if (navOrderBtn) navOrderBtn.remove();
  }

  // 3. Update bottom floating bar in direct mode
  if (isDirect) {
    updateDirectCartBar(comercioId, order);
  }
}

function updateDirectCartBar(comercioId, activeOrder = currentActiveOrder) {
  let bar = document.getElementById('direct-store-cart-bar');
  const cart = getState().cart || [];
  const storeItems = cart.filter(item => item.comercioId === comercioId);

  if (storeItems.length > 0) {
    const totalCount = storeItems.reduce((s, i) => s + i.qty, 0);
    const totalPrice = storeItems.reduce((s, item) => {
      const base = getItemUnitPrice(item);
      return s + (base * item.qty);
    }, 0);

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'direct-store-cart-bar';
      document.body.appendChild(bar);
    } else if (bar.parentElement !== document.body) {
      document.body.appendChild(bar);
    }

    bar.style.cssText = `
      position: fixed !important;
      bottom: calc(16px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px))) !important;
      left: 0 !important;
      right: 0 !important;
      margin: 0 auto !important;
      width: calc(100% - 32px) !important;
      max-width: 560px !important;
      z-index: 99999999 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      background: #0b0b0c !important;
      color: white !important;
      padding: 10px 10px 10px 16px !important;
      border-radius: 20px !important;
      box-shadow: 0 12px 30px rgba(11, 11, 12, 0.35) !important;
      cursor: pointer !important;
      font-family: var(--font-body, system-ui) !important;
      box-sizing: border-box !important;
      transform: translateZ(0) !important;
      pointer-events: auto !important;
    `;

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="background: rgba(255,255,255,0.12); width: 40px; height: 40px; border-radius: 12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; position:relative;">${icon('shoppingBag', 20)}<span style="position:absolute; top:-5px; right:-5px; min-width:20px; height:20px; padding:0 5px; border-radius:10px; background:#e11d48; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center;">${totalCount}</span></div>
        <div style="min-width:0;">
          <div id="direct-cart-bar-items" style="font-size: 12px; font-weight: 600; opacity: 0.7;">${totalCount} ${totalCount === 1 ? 'producto' : 'productos'}</div>
          <div id="direct-cart-bar-total" style="font-size: 17px; font-weight: 800; font-family: var(--go-font, inherit);">$${formatPrice(totalPrice).replace('$', '')}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px; font-weight: 700; font-size: 14px; background: #e11d48; padding: 12px 16px; border-radius: 14px; flex-shrink:0;">
        Ver pedido ${icon('chevronRight', 16)}
      </div>
    `;

    bar.onclick = () => {
      const storeSlug = currentComercio?.slug || comercioId;
      location.hash = `#/tienda/${storeSlug}/cart`;
    };
  } else if (activeOrder && !['completed', 'cancelled', 'delivered'].includes(activeOrder.status)) {
    let color1 = '#10b981', color2 = '#059669', statusIcon = '🛵', statusText = '¡Pedido en camino!';
    switch (activeOrder.status) {
      case 'pending': color1 = '#f59e0b'; color2 = '#d97706'; statusIcon = '⏳'; statusText = 'Buscando repartidor'; break;
      case 'confirmed': color1 = '#0284c7'; color2 = '#0369a1'; statusIcon = '👨‍🍳'; statusText = 'Preparando pedido'; break;
      case 'ready': color1 = '#7c3aed'; color2 = '#5b21b6'; statusIcon = '📦'; statusText = '¡Pedido listo!'; break;
      case 'delivering': color1 = '#10b981'; color2 = '#059669'; statusIcon = '🛵'; statusText = '¡Pedido en camino!'; break;
    }

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'direct-store-cart-bar';
      document.body.appendChild(bar);
    } else if (bar.parentElement !== document.body) {
      document.body.appendChild(bar);
    }

    bar.style.cssText = `
      position: fixed !important;
      bottom: calc(16px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px))) !important;
      left: 16px !important;
      right: 16px !important;
      z-index: 99999999 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      background: linear-gradient(135deg, ${color1} 0%, ${color2} 100%) !important;
      color: white !important;
      padding: 14px 20px !important;
      border-radius: 20px !important;
      box-shadow: 0 10px 30px rgba(0,0,0, 0.35), 0 2px 8px rgba(0,0,0,0.15) !important;
      cursor: pointer !important;
      font-family: var(--font-body, system-ui) !important;
      box-sizing: border-box !important;
      transform: translateZ(0) !important;
      pointer-events: auto !important;
    `;

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="background: rgba(255,255,255,0.22); width: 40px; height: 40px; border-radius: 12px; display:flex; align-items:center; justify-content:center; font-size: 20px; flex-shrink:0;">${statusIcon}</div>
        <div style="min-width:0;">
          <div style="font-size: 11px; font-weight: 800; opacity: 0.95; text-transform: uppercase; letter-spacing: 0.5px;">PEDIDO #${activeOrder.orderId || activeOrder.id.slice(0,6)}</div>
          <div style="font-size: 15px; font-weight: 900; font-family: var(--font-display, inherit); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${statusText}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px; font-weight: 900; font-size: 13px; background: white; color: ${color2}; padding: 9px 16px; border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); flex-shrink:0;">
        Seguir en Vivo 📍
      </div>
    `;

    bar.onclick = () => {
      window.location.hash = `#/pedido/${activeOrder.id}`;
    };
  } else if (bar) {
    bar.remove();
  }
}

function getProductBrand(p) {
  if (p.marca) return p.marca.trim();
  if (p.brand) return p.brand.trim();
  return getBrandFromName(p.name);
}

function getBrandFromName(name) {
  if (!name) return 'Otras';
  const cleanName = name.trim();
  const words = cleanName.split(/\s+/);
  if (words.length === 0) return 'Otras';
  const twoWordPrefixes = ['LUCKY', 'PHILIP', 'LA', 'EL', 'SAN', 'SOL', 'COCA', 'PEPSI', 'BAGLEY', 'TERMA', 'DON', 'REY', 'DEL'];
  const firstWordUpper = words[0].toUpperCase();
  if (words.length > 1 && twoWordPrefixes.includes(firstWordUpper)) {
    return `${words[0]} ${words[1]}`;
  }
  return words[0];
}

function getUniqueBrandsForCategory(products, categoryId, activeSubCategory, categories, activeOffers = []) {
  let catProducts = products;
  if (categoryId === 'discounts') {
    catProducts = products.filter(p => activeOffers.some(o => o.productIds && o.productIds.includes(p.id)));
  } else if (categoryId === 'favorites') {
    catProducts = products.filter(p => isProductFavorite(p.id));
  } else if (categoryId && categoryId !== 'all') {
    const subCategories = categories.filter(c => c.parentCategoryId === categoryId);
    if (activeSubCategory === 'all') {
      const allowedCategoryIds = [categoryId, ...subCategories.map(c => c.id)];
      catProducts = products.filter(p => allowedCategoryIds.includes(p.categoryId));
    } else {
      catProducts = products.filter(p => p.categoryId === activeSubCategory);
    }
  }

  const brands = new Set();
  catProducts.forEach(p => {
    const brand = getProductBrand(p);
    if (brand && brand !== 'Otras') {
      brands.add(brand);
    }
  });
  return Array.from(brands).sort();
}

function updateBrandDropdown(products, categoryId, activeSubCategory, categories, activeBrand, activeOffers = []) {
  const select = document.getElementById('comercio-brand-select');
  if (!select) return activeBrand;
  const brands = getUniqueBrandsForCategory(products, categoryId, activeSubCategory, categories, activeOffers);
  
  let targetBrand = 'all';
  if (brands.includes(activeBrand)) {
    targetBrand = activeBrand;
  }
  
  select.innerHTML = `
    <option value="all" ${targetBrand === 'all' ? 'selected' : ''}>Marcas</option>
    ${brands.map(brand => `<option value="${brand}" ${targetBrand === brand ? 'selected' : ''}>${brand}</option>`).join('')}
  `;
  
  return targetBrand;
}

function renderPage(targetContent, comercio, categories, products, activeCategory, activeOffers = [], activeSort = 'default', activeBrand = 'all', activeSubCategory = 'all', isDirect = false) {
  const content = targetContent || document.getElementById('overlay-render-target') || document.getElementById('app-content');
  if (!content) return;

  const hasDiscounts = activeOffers.length > 0;

  // Render subcategories if any exist for the active category
  const subCats = categories.filter(c => c.parentCategoryId === activeCategory);

  const cleanPhone = (comercio.whatsapp || comercio.phone || '').replace(/\D/g, '');

  content.innerHTML = isDirect ? directStoreHTML(comercio, categories, activeCategory, activeSubCategory, hasDiscounts) : `
    <div class="comercio-page" style="${isDirect ? 'padding-bottom: 120px;' : ''}">
      <!-- Minimal Sticky Navbar -->
      <div id="comercio-navbar" style="position: sticky; top: 0; z-index: 100; height: calc(56px + max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))); display: flex; align-items: center; justify-content: space-between; padding: calc(max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))) 16px 0 16px; box-sizing: border-box; transition: background 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease; background: transparent; border-bottom: 1px solid transparent;">
        <div style="display: flex; align-items: center; min-width: 0; flex: 1;">
          ${isDirect ? `
            <div id="comercio-direct-badge" style="background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 100px; padding: 6px 12px; font-size: 11.5px; font-weight: 850; color: var(--color-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.08); display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(225,29,72,0.15); flex-shrink: 0; transition: opacity 0.2s ease, transform 0.2s ease;">
              <span>🛍️</span> Tienda Oficial
            </div>
          ` : `
            <button class="comercio-header-back" id="comercio-nav-back" style="position: relative; top: 0; left: 0; margin: 0; z-index: 10; border: none; background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 6px rgba(0,0,0,0.1); color: var(--color-text);">${icon('back', 20)}</button>
          `}
          <div id="comercio-nav-title" style="display: flex; align-items: center; gap: 10px; margin-left: ${isDirect ? '10px' : '14px'}; opacity: 0; transition: opacity 0.2s ease, transform 0.2s ease; transform: translateY(4px); overflow: hidden; flex: 1; height: 36px;">
            ${comercio.logo 
              ? `<img src="${comercio.logo}" alt="" loading="lazy" decoding="async" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--color-border-light); flex-shrink: 0;" />`
              : `<div style="width: 28px; height: 28px; border-radius: 50%; background: var(--color-primary-light); color: var(--color-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1.5px solid var(--color-border-light);">${icon('store', 14)}</div>`
            }
            <div style="font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text); font-weight: 800; line-height: normal;">${comercio.name}</div>
          </div>
        </div>
        ${(cleanPhone) ? `
          <a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent(`¡Hola ${comercio.name}! Te escribo desde tu catálogo online.`)}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; background: #25D366; color: white; padding: 7px 14px; border-radius: 100px; font-size: 11.5px; font-weight: 850; text-decoration: none; box-shadow: 0 3px 10px rgba(37,211,102,0.35); flex-shrink: 0; z-index: 10; margin-left: 8px;">
            ${icon('messageCircle', 14)} <span>WhatsApp</span>
          </a>
        ` : ''}
      </div>

      <!-- Banner Layer -->
      <div class="comercio-header" style="position: relative; height: 50vw; max-height: 250px; margin-top: calc(-56px - max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))); overflow: hidden;">
        ${comercio.banner ? `<img id="comercio-banner-img" src="${comercio.banner}" alt="${comercio.name}" fetchpriority="high" decoding="async" style="width: 100%; height: 100%; object-fit: cover; will-change: transform;" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 60)}</div>`}
        <div class="comercio-header-overlay" style="position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%);"></div>
      </div>
    
      <!-- Info Card Layer -->
      <div class="comercio-info" style="position: relative; z-index: 2; margin-top: -40px; padding: 0 16px;">
        <div class="comercio-info-card" style="background: var(--color-surface); border-radius: 24px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); position: relative;">
          ${(() => {
            const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
            const isPausedNow = comercio.isPaused === true;
            const badgeText = isPausedNow ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
            const dotColor = isPausedNow ? '#f59e0b' : (isOpen ? '#22c55e' : '#8d8a86');
            return `
              <div id="comercio-status-badge" style="position: absolute; top: -14px; right: 20px; font-size: 11px; font-weight: 700; height: 28px; padding: 0 12px; border-radius: 14px; text-transform: uppercase; letter-spacing: 0.08em; display: flex; align-items: center; gap: 6px; background: var(--go-ink); color: white;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; display: inline-block;"></span>
                ${badgeText}
              </div>
            `;
          })()}
          
          <div style="display: flex; align-items: center; gap: 14px;">
            ${comercio.logo
              ? `<img src="${escapeHtml(comercio.logo)}" alt="" fetchpriority="high" decoding="async" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 4px solid var(--color-surface); margin-top: -48px; box-shadow: 0 2px 8px rgba(11,11,12,0.12); background: white; flex-shrink: 0;" />`
              : `<div style="width: 72px; height: 72px; border-radius: 50%; border: 4px solid var(--color-surface); margin-top: -48px; display:flex;align-items:center;justify-content:center;background:var(--go-paper-2); box-shadow: 0 2px 8px rgba(11,11,12,0.12); flex-shrink: 0;">${icon('store', 28)}</div>`
            }
            <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0; padding-top: 4px;">
              <span class="go-eyebrow">${escapeHtml(comercio.category || 'Comercio')}</span>
              <h1 id="comercio-main-title" style="margin: 4px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--go-font); font-size: 24px; font-weight: 800; letter-spacing: -0.01em; color: var(--color-text);">${escapeHtml(comercio.name)}</h1>
              <span class="go-bar" style="margin-top: 8px;"></span>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button id="rate-comercio-btn" style="height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--go-line); background: var(--color-surface); display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 13px; font-weight: 700; color: var(--color-text); cursor: pointer;">
              ${icon('star', 14, '', '#f59e0b')} ${comercio.ratingAverage !== undefined && comercio.ratingAverage > 0 ? `${comercio.ratingAverage.toFixed(1)} <span style="color: var(--go-text-2); font-weight: 500;">(${comercio.ratingCount || 0})</span>` : 'Puntuar'}
            </button>
          </div>
          
          <div style="margin-top: 16px;">
            ${comercio.description ? `<p style="margin: 0 0 12px 0; color: var(--color-text-secondary); font-size: 14px; line-height: 1.5;">${escapeHtml(comercio.description)}</p>` : ''}
            <div style="padding-top: 12px; border-top: 1px solid var(--color-border-light); color: var(--color-text-secondary); font-size: 13px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              ${comercio.address ? `
              <span style="display: inline-flex; align-items: center; color: var(--go-text);">${icon('mapPin', 14)}</span>
              <span style="font-weight: 600;">${escapeHtml(comercio.address.split(',')[0])}</span>
              <span style="color: var(--color-border); margin: 0 4px;">•</span>
              ` : ''}
              <span style="display: inline-flex; align-items: center; color: var(--go-text);">${icon('clock', 14)}</span>
              <span style="font-weight: 700;">
                ${comercio.schedules && comercio.schedules.length > 0
                  ? comercio.schedules.map(s => `${s.open} - ${s.close}`).join(', ')
                  : (comercio.schedule ? `${comercio.schedule.open} - ${comercio.schedule.close}` : '19:00 - 23:30')
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="comercio-products" style="min-height: 100vh; padding-top: 16px;">
        <div id="comercio-sticky-filters" style="position: sticky; top: calc(56px + max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))); z-index: 90; background: var(--color-bg); padding-top: 8px; padding-bottom: 8px;">
        <!-- Search bar -->
        <div class="comercio-search-container" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); margin-top: 12px;">
          <div style="position:relative; width: 100%; display:flex; align-items:center; background:var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius:16px; padding:0 16px; height:46px; box-shadow:var(--shadow-xs); transition: all 0.2s;">
            <span style="color:var(--color-text-tertiary); display:flex; align-items:center; justify-content:center; margin-right:10px;">${icon('search', 18)}</span>
            <input type="text" id="comercio-product-search" placeholder="Buscar productos..." style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none;" />
            <button id="clear-search-btn" style="background:none; border:none; color:var(--color-text-tertiary); display:none; align-items:center; justify-content:center; cursor:pointer; padding:4px;">${icon('xCircle', 16)}</button>
          </div>
        </div>

        <div class="tab-pills" id="comercio-categories" style="margin-bottom:var(--space-3); padding-left: var(--space-4); padding-right: var(--space-4); position: relative;">
          <button class="tab-pill ${activeCategory === 'all' ? 'active' : ''}" data-cat-id="all">Todos</button>
          <button class="tab-pill ${activeCategory === 'favorites' ? 'active' : ''}" data-cat-id="favorites" style="display:inline-flex; align-items:center; gap:6px;">
            <span style="display:inline-flex; align-items:center; transform:translateY(0.5px);">${icon('heart', 12, 'fav-active')}</span> Favoritos
          </button>
          ${hasDiscounts ? `
            <button class="tab-pill ${activeCategory === 'discounts' ? 'active' : ''}" data-cat-id="discounts" style="display:inline-flex; align-items:center; gap:6px;">
              <span style="display:inline-flex; align-items:center; transform:translateY(0.5px); color:var(--color-primary);">${icon('tag', 12)}</span> Descuentos
            </button>
          ` : ''}
          ${categories.filter(c => !c.parentCategoryId).map(c => `<button class="tab-pill ${activeCategory === c.id ? 'active' : ''}" data-cat-id="${c.id}">${c.name}</button>`).join('')}
        </div>

        <!-- Subcategories container -->
        <div id="comercio-subcategories-container" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); display: ${subCats.length > 0 ? 'block' : 'none'};">
          <div class="tab-pills sub-tab-pills" id="comercio-subcategories" style="display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 4px 0; border-bottom: none; position: relative; scrollbar-width: none;">
            ${subPillHtml('all', 'Todo', activeSubCategory === 'all')}${subCats.map(sub => subPillHtml(sub.id, sub.name, activeSubCategory === sub.id)).join('')}
          </div>
        </div>

        <div class="comercio-sort-container" style="padding: 0 var(--space-4) 12px; margin-bottom: var(--space-3); display: flex; gap: 8px; border-bottom: 1px solid var(--color-border-light);">
          ${selectBoxHtml('comercio-sort-select', 'filter', `
              <option value="default" ${activeSort === 'default' ? 'selected' : ''}>Recomendados</option>
              <option value="price-asc" ${activeSort === 'price-asc' ? 'selected' : ''}>Menor precio</option>
              <option value="price-desc" ${activeSort === 'price-desc' ? 'selected' : ''}>Mayor precio</option>
              <option value="sales-desc" ${activeSort === 'sales-desc' ? 'selected' : ''}>Más vendido</option>
              <option value="sales-asc" ${activeSort === 'sales-asc' ? 'selected' : ''}>Menos vendido</option>`)}
          ${selectBoxHtml('comercio-brand-select', 'tag', `
              <option value="all" ${activeBrand === 'all' ? 'selected' : ''}>Marcas</option>
              ${getUniqueBrandsForCategory(products, activeCategory, activeSubCategory, categories, activeOffers).map(brand => `<option value="${brand}" ${activeBrand === brand ? 'selected' : ''}>${brand}</option>`).join('')}`)}
        </div>
        </div>
        <div class="products-grid" id="comercio-products">
        </div>
      </div>

      <!-- Paused Banner (shown only when commerce is paused) -->
      <div id="comercio-pause-banner" style="display:${comercio.isPaused ? 'flex' : 'none'}; margin: 0 16px 16px; padding: 16px 18px; background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(234,88,12,0.08)); border: 1.5px solid rgba(245,158,11,0.35); border-radius: 18px; align-items: center; gap: 14px;">
        <span style="font-size: 26px; flex-shrink:0;">🔒</span>
        <div>
          <div style="font-size: 14px; font-weight: 900; color: #92400e;">Comercio cerrado temporalmente</div>
          <div style="font-size: 12px; color: #b45309; font-weight: 600; margin-top: 3px;">Este comercio pausó sus ventas. Volvé a intentar más tarde.</div>
        </div>
      </div>

      ${isDirect ? '' : getFooterHTML()}
    </div>
  `;

  const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
  const isPausedNow = comercio.isPaused === true;
  renderProducts(products, activeCategory, activeOffers, activeSort, '', comercio.id, isOpen, activeBrand, activeSubCategory, categories, isPausedNow);
  
  updateComercioActiveOrderUI(currentActiveOrder, comercio.id, isDirect);
  if (isDirect) {
    initCatalogCategoryScroll(content);
    updateDirectCartBar(comercio.id, currentActiveOrder);
  } else {
    updateGlobalCartFAB();
  }

  // Bind rating button click
  document.getElementById('rate-comercio-btn')?.addEventListener('click', () => {
    openRatingModal(comercio);
  });
  ['tnd-share', 'tnd-share-top'].forEach(id => document.getElementById(id)?.addEventListener('click', () => shareStoreLink(comercio)));
  // A button, not a link: a global rule hides every google.com/maps link on desktop (map credits)
  document.getElementById('tnd-directions')?.addEventListener('click', (e) => window.open(e.currentTarget.dataset.url, '_blank', 'noopener'));

  // Modern, flicker-free sticky navbar logic
  const navbar = document.getElementById('comercio-navbar');
  const navTitle = document.getElementById('comercio-nav-title');
  const navBack = document.getElementById('comercio-nav-back');
  const directBadge = document.getElementById('comercio-direct-badge');
  const bannerImg = document.getElementById('comercio-banner-img');

  if (navBack) {
    navBack.onclick = (e) => {
      e.preventDefault();
      const fallbackToCategory = () => {
        const lastCat = sessionStorage.getItem('gd_last_category') || comercio.category;
        window.location.hash = lastCat ? `#/category/${encodeURIComponent(lastCat)}` : '#/';
      };

      if (window.history.length > 1) {
        // Detect whether history.back() actually navigated us away via the
        // real 'hashchange' event instead of guessing after a fixed delay.
        // The old code compared the hash again after a blind 150ms timeout;
        // on a slow render (previous page re-fetching data) back() could
        // still be in flight past that point, so the fallback below fired
        // as a false positive and *overwrote* the hash with the category
        // page — creating a bogus forward history entry that sat on top of
        // wherever the user actually came from. Pressing back again then
        // landed back on the product, in an infinite back/forward loop.
        let settled = false;
        const onHashChange = () => { settled = true; };
        window.addEventListener('hashchange', onHashChange, { once: true });
        window.history.back();
        setTimeout(() => {
          window.removeEventListener('hashchange', onHashChange);
          if (!settled) fallbackToCategory();
        }, 600);
      } else {
        fallbackToCategory();
      }
    };
  }
  
  if (navbar) {
    if (window._comercioScrollHandler) {
      window.removeEventListener('scroll', window._comercioScrollHandler, { capture: true });
    }

    window._comercioScrollHandler = (e) => {
      if (!window.location.hash.startsWith('#/comercio/') && !window.location.hash.startsWith('#/tienda/')) return;
      
      const overlay = document.querySelector('.slide-overlay.active') || document.getElementById('app-overlay') || document.querySelector('.slide-panel.active');
      let scrollTop = 0;
      if (overlay && overlay.scrollTop > 0) {
        scrollTop = overlay.scrollTop;
      } else if (e?.target && e.target.scrollTop > 0) {
        scrollTop = e.target.scrollTop;
      } else {
        scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      }
      
      // Parallax effect on banner image
      if (bannerImg && scrollTop < 300) {
        bannerImg.style.transform = `translateY(${scrollTop * 0.35}px)`;
      }

      // Navbar fade in / solid surface on scroll
      if (scrollTop > 45) {
        navbar.style.background = 'var(--color-surface)';
        navbar.style.backdropFilter = 'blur(16px)';
        navbar.style.webkitBackdropFilter = 'blur(16px)';
        navbar.style.borderBottom = '1px solid var(--color-border-light)';
        navbar.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.06)';

        if (navTitle) {
          navTitle.style.opacity = '1';
          navTitle.style.transform = 'translateY(0)';
        }

        if (directBadge) {
          directBadge.style.opacity = '0';
          directBadge.style.transform = 'scale(0.85)';
          directBadge.style.display = 'none';
        }

        if (navBack) {
          navBack.style.background = 'var(--color-bg-secondary)';
          navBack.style.boxShadow = 'none';
          navBack.style.color = 'var(--color-text)';
        }
      } else {
        navbar.style.background = 'transparent';
        navbar.style.backdropFilter = 'none';
        navbar.style.webkitBackdropFilter = 'none';
        navbar.style.borderBottom = '1px solid transparent';
        navbar.style.boxShadow = 'none';

        if (navTitle) {
          navTitle.style.opacity = '0';
          navTitle.style.transform = 'translateY(4px)';
        }

        if (directBadge) {
          directBadge.style.display = 'inline-flex';
          directBadge.style.opacity = '1';
          directBadge.style.transform = 'scale(1)';
        }

        if (navBack) {
          navBack.style.background = 'rgba(255, 255, 255, 0.85)';
          navBack.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
          navBack.style.color = 'var(--color-text)';
        }
      }
    };

    window.addEventListener('scroll', window._comercioScrollHandler, { passive: true, capture: true });
    // Trigger once to set initial state
    window._comercioScrollHandler({ target: document });
  }

  return {
    cleanup: () => {
      if (window._comercioScrollHandler) {
        window.removeEventListener('scroll', window._comercioScrollHandler, { capture: true });
      }
      if (unsubComercios) {
        unsubComercios();
      }
    }
  };
}

// ---- Catálogo online (#/tienda/<slug>) ------------------------------------------------------
// La página que el comercio comparte (WhatsApp, QR, redes). Estilos en styles/tienda.css. Usa los
// mismos ids que la vista de la app para que la búsqueda, las categorías y el carrito funcionen igual.

/** Turnos de hoy [{open, close}] (null si no hay horario cargado). */
function todaySlots(comercio) {
  const day = getArgentinaTime().getDay();
  if (hasWeeklySchedule(comercio.weeklySchedule)) return Array.isArray(comercio.weeklySchedule[String(day)]) ? comercio.weeklySchedule[String(day)].filter(s => s && s.open && s.close) : [];
  if (Array.isArray(comercio.daysOpen) && comercio.daysOpen.length && !comercio.daysOpen.includes(day)) return [];
  if (Array.isArray(comercio.schedules) && comercio.schedules.length) return comercio.schedules.filter(s => s && s.open && s.close);
  if (comercio.schedule?.open) return [comercio.schedule];
  return null;
}

/** "Abierto · hasta 23:30" / "Cerrado · abre 19:30" / "Cerrado hoy" / "Abierto" */
function statusLine(comercio, isOpen) {
  const slots = todaySlots(comercio);
  const now = getArgentinaTime();
  const t = now.getHours() * 60 + now.getMinutes();
  const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  if (isOpen) {
    if (!slots) return 'Abierto ahora';
    // Sigue de corrido aunque cruce días: "hasta el lunes 02:00", no "hasta 23:59"
    const until = closesAtText(comercio);
    return until ? `Abierto · hasta ${until.replace(/^las /, '')}` : 'Abierto las 24 horas';
  }
  if (!slots) return 'Cerrado ahora';
  const next = slots.map(s => s.open).filter(o => mins(o) > t).sort((a, b) => mins(a) - mins(b))[0];
  return next ? `Cerrado · abre ${next}` : 'Cerrado por hoy';
}

/** Horario de hoy para mostrar: "Hoy 19:00 – 23:30", o null si no hay horario cargado. */
function todayHoursText(comercio) {
  const day = getArgentinaTime().getDay();
  let slots = null;
  if (hasWeeklySchedule(comercio.weeklySchedule)) {
    slots = Array.isArray(comercio.weeklySchedule[String(day)]) ? comercio.weeklySchedule[String(day)] : [];
  } else if (Array.isArray(comercio.daysOpen) && comercio.daysOpen.length && !comercio.daysOpen.includes(day)) {
    slots = [];
  } else if (Array.isArray(comercio.schedules) && comercio.schedules.length) {
    slots = comercio.schedules;
  } else if (comercio.schedule?.open) {
    slots = [comercio.schedule];
  }
  if (!slots) return null;
  const valid = slots.filter(s => s && s.open && s.close);
  if (!valid.length) return 'Hoy no abre';
  return 'Hoy ' + valid.map(s => `${s.open} – ${s.close}`).join(' y ');
}

function directStoreHTML(comercio, categories, activeCategory, activeSubCategory, hasDiscounts) {
  const esc = escapeHtml;
  const name = comercio.name || 'Comercio';
  const initials = storeInitials(name);
  const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen, comercio.weeklySchedule);
  const isPaused = comercio.isPaused === true;
  const hours = todayHoursText(comercio);
  const cleanPhone = (comercio.whatsapp || comercio.phone || '').replace(/\D/g, '');
  const waPhone = cleanPhone ? (cleanPhone.startsWith('54') ? cleanPhone : `549${cleanPhone}`) : '';
  const addressShort = comercio.address ? String(comercio.address).split(',')[0] : '';
  const mapsUrl = comercio.coords?.lat
    ? `https://www.google.com/maps/search/?api=1&query=${comercio.coords.lat},${comercio.coords.lng}`
    : (comercio.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(comercio.address)}` : '');
  const rating = comercio.ratingAverage > 0 ? `${comercio.ratingAverage.toFixed(1)} <span style="opacity:.6;font-weight:500">(${comercio.ratingCount || 0})</span>` : 'Calificar';
  const subCats = categories.filter(c => c.parentCategoryId === activeCategory);
  const statusClass = isPaused ? 'is-paused' : (isOpen ? 'is-open' : 'is-closed');
  const statusText = isPaused ? 'Pausado por un rato' : statusLine(comercio, isOpen);
  const subPill = (id, label, active) => `<button class="sub-tab-pill ${active ? 'active' : ''}" data-subcat-id="${esc(id)}" style="border:1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${active ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)'}; color:${active ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; cursor:pointer; white-space:nowrap;">${esc(label)}</button>`;

  return `
    <div class="comercio-page tnd">
      <div id="comercio-navbar" class="tnd-top">
        <div id="comercio-nav-title" class="tnd-top-title">
          ${comercio.logo ? `<img src="${esc(comercio.logo)}" alt="" />` : `<div class="tnd-top-ph"></div>`}
          <span>${esc(name)}</span>
        </div>
        <button id="tnd-share-top" class="tnd-icon-btn" aria-label="Compartir">${icon('share', 18)}</button>
      </div>

      <div class="tnd-hero">
        ${comercio.banner
          ? `<img id="comercio-banner-img" src="${esc(comercio.banner)}" alt="" decoding="async" /><div class="tnd-hero-shade"></div>`
          : `<div class="tnd-hero-ph"><b>${esc(initials)}</b></div>`}
      </div>

      <div class="tnd-wrap">
        <section class="tnd-head comercio-info-card">
          <div class="tnd-head-row">
            ${comercio.logo
              ? `<img class="tnd-logo comercio-detail-logo" src="${esc(comercio.logo)}" alt="${esc(name)}" />`
              : `<div class="tnd-logo tnd-logo-ph">${esc(initials)}</div>`}
            <div class="comercio-info-text" style="min-width:0">
              <h1 class="tnd-name">${esc(name)}</h1>
              <div class="tnd-sub">${esc([comercio.category, addressShort].filter(Boolean).join(' · '))}</div>
            </div>
          </div>
          ${comercio.description ? `<p class="tnd-desc comercio-description">${esc(comercio.description)}</p>` : ''}

          <div class="tnd-facts">
            <span id="comercio-status-badge" class="tnd-fact ${statusClass}"><span class="tnd-dot"></span>${statusText}</span>
            <span class="tnd-fact">${icon('bike', 14)}Envío o retiro</span>
            <button id="rate-comercio-btn" class="tnd-fact">${icon('star', 14, '', '#f59e0b')}${rating}</button>
          </div>

          <div class="tnd-actions">
            ${waPhone ? `<a class="tnd-btn is-wa" href="https://wa.me/${waPhone}?text=${encodeURIComponent(`¡Hola ${name}! Te escribo desde tu catálogo online.`)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp', 17)}WhatsApp</a>` : ''}
            ${mapsUrl ? `<button type="button" id="tnd-directions" class="tnd-btn" data-url="${esc(mapsUrl)}">${icon('mapPin', 16)}Cómo llegar</button>` : ''}
            ${!waPhone || !mapsUrl ? `<button id="tnd-share" class="tnd-btn">${icon('share', 16)}Compartir</button>` : ''}
          </div>

          <div id="comercio-pause-banner" class="tnd-notice" style="display:${isPaused ? 'flex' : 'none'}">
            ${icon('pause', 18)}<span>El comercio pausó los pedidos por un rato. Podés mirar el catálogo y volver a pedir en unos minutos.</span>
          </div>
          ${!isPaused && !isOpen ? `<div class="tnd-notice is-closed">${icon('clock', 18)}<span>Podés mirar el catálogo ahora y hacer tu pedido cuando abra.${hours && hours !== 'Hoy no abre' ? ` Horario: ${esc(hours.replace(/^Hoy /, 'hoy '))}.` : ''}</span></div>` : ''}
        </section>

        <div id="comercio-sticky-filters" class="tnd-filters">
          <label class="tnd-search">
            ${icon('search', 18)}
            <input type="search" id="comercio-product-search" placeholder="Buscar en ${esc(name)}" autocomplete="off" enterkeyhint="search" />
            <button id="clear-search-btn" type="button" aria-label="Borrar búsqueda">${icon('xCircle', 18)}</button>
          </label>
          <div class="tnd-cats tab-pills" id="comercio-categories">
            <button class="tab-pill ${activeCategory === 'all' ? 'active' : ''}" data-cat-id="all">Todo</button>
            ${hasDiscounts ? `<button class="tab-pill ${activeCategory === 'discounts' ? 'active' : ''}" data-cat-id="discounts">${icon('tag', 13)}Ofertas</button>` : ''}
            ${categories.filter(c => !c.parentCategoryId).map(c => `<button class="tab-pill ${activeCategory === c.id ? 'active' : ''}" data-cat-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
          </div>
          <div id="comercio-subcategories-container" class="tnd-subcats" style="display:${subCats.length ? 'block' : 'none'}">
            <div class="tab-pills sub-tab-pills" id="comercio-subcategories">
              ${subCats.length ? subPill('all', 'Ver todo', activeSubCategory === 'all') + subCats.map(sc => subPill(sc.id, sc.name, activeSubCategory === sc.id)).join('') : ''}
            </div>
          </div>
        </div>

        <div class="tnd-products" id="comercio-products"></div>

        <footer class="tnd-foot">
          <a href="https://godelivery-magdalena.web.app/descargar.html" target="_blank" rel="noopener noreferrer"><span class="tnd-go">GO!</span>Pedidos online con GO! Delivery</a>
          <span>Magdalena · pedí a domicilio o retirá en el local</span>
        </footer>
      </div>
    </div>`;
}

/**
 * Catálogo online: tocar una categoría desplaza suave hasta su sección (no filtra ni salta), y al
 * bajar con el dedo se marca sola la categoría que se está viendo. Solo cuando la lista está
 * agrupada ("Todo", sin búsqueda); si no, sigue el filtro de siempre.
 */
function initCatalogCategoryScroll(root) {
  const pills = root.querySelector('#comercio-categories');
  const products = root.querySelector('#comercio-products');
  if (!pills || !products) return;
  // Looked up when used: right after rendering the content isn't laid out yet and nothing scrolls
  const getScroller = () => {
    for (let el = products.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement || document.documentElement;
  };
  // Where the filters' bottom edge sits once they're stuck (at the top of the page they are
  // still lower, and measuring them there sent the first jump past the section)
  const stickyBottom = () => {
    const f = root.querySelector('#comercio-sticky-filters');
    if (!f) return 0;
    const scroller = getScroller();
    const scrollerTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    return scrollerTop + (parseFloat(getComputedStyle(f).top) || 0) + f.offsetHeight;
  };
  const sections = () => [...products.querySelectorAll('.tnd-section[data-section-id]')];
  let programmaticUntil = 0;

  const setActive = (id, scrollPill = true) => {
    pills.querySelectorAll('.tab-pill').forEach(p => p.classList.toggle('active', p.dataset.catId === id));
    const pill = pills.querySelector(`.tab-pill[data-cat-id="${CSS.escape(id)}"]`);
    if (pill && scrollPill) pills.scrollTo({ left: Math.max(0, pill.offsetLeft - 16), behavior: 'smooth' });
  };

  const scrollToY = (scroller, y) => {
    programmaticUntil = Date.now() + 900;
    scroller.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  };

  pills.addEventListener('click', (e) => {
    const pill = e.target.closest('.tab-pill');
    if (!pill) return;
    const id = pill.dataset.catId;
    const list = sections();
    if (!list.length) return; // filtrado o búsqueda: lo maneja el filtro de siempre
    const target = id === 'all' ? list[0] : list.find(sct => sct.dataset.sectionId === id);
    if (!target) return; // "Ofertas" u otra vista que no es una sección
    e.stopPropagation(); // capture: el filtro de comercio.js no llega a correr
    setActive(id);
    const scroller = getScroller();
    const top = target.getBoundingClientRect().top - stickyBottom() - 10;
    scrollToY(scroller, scroller.scrollTop + top);
  }, true);

  // Al bajar: se marca la sección que está debajo de los filtros
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    setTimeout(() => {
      ticking = false;
      if (!root.isConnected || Date.now() < programmaticUntil) return;
      const list = sections();
      if (!list.length) return;
      const line = stickyBottom() + 24;
      let current = null;
      for (const sct of list) { if (sct.getBoundingClientRect().top <= line) current = sct; }
      const id = current ? current.dataset.sectionId : 'all';
      const active = pills.querySelector('.tab-pill.active')?.dataset.catId;
      if (id !== active && id !== '__otros') setActive(id);
    }, 80);
  };
  // Capture on window catches the scroll of whatever element scrolls the page
  if (window._catalogScrollSpy) window.removeEventListener('scroll', window._catalogScrollSpy, true);
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window._catalogScrollSpy = onScroll;
}

/** Comparte el link del catálogo (menú nativo del celular o, si no hay, copia el link). */
async function shareStoreLink(comercio) {
  const url = getStoreUrl(comercio);
  const text = `Mirá el catálogo de ${comercio.name} y pedí online`;
  try {
    if (navigator.share) { await navigator.share({ title: comercio.name, text, url }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); showToast('Link copiado', 'success'); }
  catch (e) { showToast(url, 'info'); }
}

/** Una tarjeta de producto del catálogo online. */
function directProductCard(p, offer, isOpen, isPaused, isUnavailable) {
  const esc = escapeHtml;
  const offerPrice = offer ? (offer.type === 'percentage' ? p.price * (1 - (offer.value || 0) / 100) : p.price) : null;
  const was = offer ? p.price : (Number(p.originalPrice) > Number(p.price) ? Number(p.originalPrice) : null);
  const price = offerPrice ?? p.price;
  const tag = offer ? (offer.type === 'percentage' ? `${offer.value}% OFF` : '2x1') : (was ? `${Math.round((1 - p.price / was) * 100)}% OFF` : '');
  const state = isPaused ? 'Pausado' : (!isOpen ? 'Cerrado' : (isUnavailable ? 'Agotado' : ''));
  const action = state ? `<span class="tnd-p-state">${state}</span>` : `<button class="product-card-add" data-product-id="${esc(p.id)}" aria-label="Agregar ${esc(p.name)}">${icon('plus', 16)}</button>`;
  return `
    <article class="product-card ${isUnavailable ? 'product-unavailable' : ''} ${p.image ? '' : 'tnd-p-noimg'}" data-product-id="${esc(p.id)}">
      <div class="tnd-p-info">
        <div class="tnd-p-name">${esc(p.name)}</div>
        ${p.description ? `<div class="tnd-p-desc">${esc(p.description)}</div>` : ''}
        <div class="tnd-p-foot">
          <span class="tnd-p-price ${tag ? 'is-offer' : ''}">${formatPrice(price)}${isSoldByWeight(p) ? ' /kg' : ''}</span>
          ${was ? `<span class="tnd-p-was">${formatPrice(was)}</span>` : ''}
          ${tag ? `<span class="tnd-p-tag">${tag}</span>` : ''}
          ${p.image ? '' : action}
        </div>
      </div>
      ${p.image ? `<div class="tnd-p-media"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" />${action}</div>` : ''}
    </article>`;
}

export async function openRatingModal(comercio) {
  const user = getState().user;
  if (!user) {
    showToast('Debes iniciar sesión para calificar este comercio', 'warning');
    return;
  }

  const { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp, updateDoc } = await import('firebase/firestore');

  // Check if user already reviewed
  const reviewId = `${comercio.id}_${user.uid}`;
  const existingReviewSnap = await getDoc(doc(db, 'reviews', reviewId));
  let existingReview = existingReviewSnap.exists() ? existingReviewSnap.data() : null;

  let selectedStars = existingReview ? existingReview.rating : 5;

  const modalContent = document.createElement('div');
  modalContent.style.padding = '24px 20px 32px';
  modalContent.style.textAlign = 'center';

  const renderStars = () => {
    return [1,2,3,4,5].map(star => {
      const active = star <= selectedStars;
      return `<span class="rating-modal-star" data-star="${star}" style="font-size: 38px; cursor: pointer; color: ${active ? '#FFC107' : '#D1D5DB'}; margin: 0 6px; transition: color 0.2s; display: inline-block;">★</span>`;
    }).join('');
  };

  modalContent.innerHTML = `
    <h2 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; margin-bottom: 6px; color: var(--color-text-primary);">¿Qué te pareció?</h2>
    <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 20px 0;">Calificá tu experiencia en ${comercio.name}</p>
    
    <div id="stars-selector-container" style="margin-bottom: 24px; display: flex; justify-content: center; align-items: center; min-height: 48px;">
      ${renderStars()}
    </div>

    <div style="text-align: left; margin-bottom: 24px;">
      <label style="display:block; font-size:11px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Dejá tu opinión / reseña (Opcional)</label>
      <textarea id="review-comment" placeholder="Ej: Excelente servicio, los productos llegaron rápido y la atención fue increíble..." style="width: 100%; height: 90px; border-radius: 14px; border: 1.5px solid var(--color-border); padding: 12px; font-size: 13px; font-weight: 600; outline: none; background: var(--color-bg); color: var(--color-text-primary); resize: none; font-family: inherit;">${existingReview ? existingReview.comment : ''}</textarea>
    </div>

    <button id="submit-review-btn" class="btn btn-primary btn-block" style="height: 52px; border-radius: 16px; font-weight: 900; font-size: 15px; background: #FFC107; border: none; color: black; box-shadow: 0 8px 20px rgba(255, 193, 7, 0.25); cursor: pointer; transition: all 0.2s;">
      Enviar Calificación
    </button>
  `;

  const { showModal, closeModal } = await import('../components/modal.js');
  showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent
  });

  const bindStarClicks = () => {
    modalContent.querySelectorAll('.rating-modal-star').forEach(starEl => {
      starEl.onclick = () => {
        selectedStars = parseInt(starEl.dataset.star);
        const container = modalContent.querySelector('#stars-selector-container');
        if (container) {
          container.innerHTML = renderStars();
          bindStarClicks();
        }
      };
    });
  };
  bindStarClicks();

  // Submit click
  modalContent.querySelector('#submit-review-btn').onclick = async () => {
    const btn = modalContent.querySelector('#submit-review-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin" style="display:inline-block; margin-right:8px; width: 14px; height: 14px; border: 2px solid black; border-top-color: transparent; border-radius: 50%;"></span> ENVIANDO...`;

    const comment = modalContent.querySelector('#review-comment').value;

    try {
      await setDoc(doc(db, 'reviews', reviewId), {
        userId: user.uid,
        userName: user.displayName || 'Cliente',
        comercioId: comercio.id,
        comercioName: comercio.name,
        rating: selectedStars,
        comment: comment.trim(),
        createdAt: serverTimestamp()
      });

      // El promedio del comercio lo recalcula el servidor (onReviewWritten): la app del cliente
      // no puede escribirlo y antes eso hacía fallar todo el envío.

      showToast('¡Muchas gracias por tu calificación!', 'success');
      closeModal();
      
      // Reactive reload page data
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      console.error('Error submitting review:', err);
      showToast('Error al enviar calificación', 'error');
      btn.disabled = false;
      btn.innerText = 'Enviar Calificación';
    }
  };
}

let allFilteredProducts = [];
let displayedCount = 20;
let infiniteScrollObserver = null;

function renderProducts(products, categoryId, activeOffers = [], sortBy = 'default', searchQuery = '', comercioId = '', isOpen = true, activeBrand = 'all', activeSubCategory = 'all', categories = [], isPaused = false) {
  const grid = document.getElementById('comercio-products');
  if (!grid) return;

  // Clean up any existing observer
  if (infiniteScrollObserver) {
    infiniteScrollObserver.disconnect();
    infiniteScrollObserver = null;
  }

  // Helpers for sorting calculations
  const getProductEffectivePrice = (p) => {
    const offer = activeOffers.find(o => o.productIds && o.productIds.includes(p.id));
    if (offer && offer.type === 'percentage') {
      return p.price * (1 - (offer.value || 0) / 100);
    }
    return p.price;
  };

  const getSalesCount = (p) => {
    if (typeof p.salesCount === 'number') return p.salesCount;
    const hash = p.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return hash % 100;
  };

  let filtered = products;
  if (categoryId === 'discounts') {
    filtered = products.filter(p => activeOffers.some(o => o.productIds && o.productIds.includes(p.id)));
  } else if (categoryId === 'favorites') {
    filtered = products.filter(p => isProductFavorite(p.id));
  } else if (categoryId && categoryId !== 'all') {
    const subCategories = categories.filter(c => c.parentCategoryId === categoryId);
    if (activeSubCategory === 'all') {
      const allowedCategoryIds = [categoryId, ...subCategories.map(c => c.id)];
      filtered = products.filter(p => allowedCategoryIds.includes(p.categoryId));
    } else {
      filtered = products.filter(p => p.categoryId === activeSubCategory);
    }
  }

  // Brand filter
  if (activeBrand && activeBrand !== 'all') {
    filtered = filtered.filter(p => getProductBrand(p) === activeBrand);
  }

  // Search filter (Name, Barcode, or Category)
  if (searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(p => {
      if ((p.name || '').toLowerCase().includes(q)) return true;
      if (p.barcode && String(p.barcode).toLowerCase().includes(q)) return true;
      if (p.categoryId) {
        const cat = categories.find(c => c.id === p.categoryId);
        if (cat && (cat.name || '').toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }

  // Filter out products that are unavailable or out of stock for customer view
  filtered = filtered.filter(p => {
    if (p.isAvailable === false) return false;
    let isOutOfStock = p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0;
    if (p.useGlobalFlavors && currentComercio) {
      const activeFlavors = (p.allowedFlavors && p.allowedFlavors.length > 0)
        ? (currentComercio.sabores || []).filter(s => p.allowedFlavors.includes(s.name))
        : (currentComercio.sabores || []);
      const hasInfinite = activeFlavors.some(s => !s.isAvailable || s.stock === undefined || s.stock === null || s.stock === '');
      if (hasInfinite) {
        isOutOfStock = false;
      } else {
        const totalQty = activeFlavors.reduce((acc, s) => acc + (s.stock || 0), 0);
        isOutOfStock = totalQty <= 0;
      }
    }
    return !isOutOfStock;
  });

  // Sort
  if (sortBy === 'price-asc') {
    filtered.sort((a, b) => getProductEffectivePrice(a) - getProductEffectivePrice(b));
  } else if (sortBy === 'price-desc') {
    filtered.sort((a, b) => getProductEffectivePrice(b) - getProductEffectivePrice(a));
  } else if (sortBy === 'sales-desc') {
    filtered.sort((a, b) => getSalesCount(b) - getSalesCount(a));
  } else if (sortBy === 'sales-asc') {
    filtered.sort((a, b) => getSalesCount(a) - getSalesCount(b));
  } else {
    filtered.sort((a, b) => {
      const isAUnavailable = a.isAvailable === false || (a.stockMode === 'limited' && (a.stockQuantity || 0) <= 0);
      const isBUnavailable = b.isAvailable === false || (b.stockMode === 'limited' && (b.stockQuantity || 0) <= 0);
      if (isAUnavailable && !isBUnavailable) return 1;
      if (!isAUnavailable && isBUnavailable) return -1;
      return (a.order || 0) - (b.order || 0);
    });
  }

  if (filtered.length === 0 && grid.classList.contains('tnd-products')) {
    grid.innerHTML = searchQuery
      ? `<div class="tnd-empty"><b>No encontramos "${escapeHtml(searchQuery)}"</b>Probá con otra palabra o mirá todas las categorías.</div>`
      : `<div class="tnd-empty"><b>${categoryId === 'discounts' ? 'Hoy no hay ofertas' : 'Todavía no hay productos acá'}</b>Mirá las otras categorías del catálogo.</div>`;
    return;
  }

  if (filtered.length === 0) {
    if (categoryId === 'favorites') {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1; padding: 40px 20px;">
          <div class="empty-state-icon" style="color: #ef4444; background: rgba(239,68,68,0.08); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
            ${icon('heart', 28, 'fav-active')}
          </div>
          <div class="empty-state-title" style="font-size: 16px; font-weight: 800; color: var(--color-text); margin-bottom: 6px;">Aún no tienes favoritos</div>
          <div class="empty-state-text" style="font-size: 13px; color: var(--color-text-secondary); max-width: 240px; margin: 0 auto; line-height: 1.5;">
            Marcá con un corazón los productos que más te gustan de este comercio para tenerlos siempre a mano.
          </div>
        </div>
      `;
      return;
    }

    if (categoryId === 'discounts') {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1; padding: 40px 20px;">
          <div class="empty-state-icon" style="color: var(--color-primary); background: rgba(225,29,72,0.08); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
            ${icon('tag', 28)}
          </div>
          <div class="empty-state-title" style="font-size: 16px; font-weight: 800; color: var(--color-text); margin-bottom: 6px;">Sin descuentos hoy</div>
          <div class="empty-state-text" style="font-size: 13px; color: var(--color-text-secondary); max-width: 240px; margin: 0 auto; line-height: 1.5;">
            Este comercio no tiene ofertas activas en este momento. ¡Volvé más tarde!
          </div>
        </div>
      `;
      return;
    }

    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">${icon('package', 40)}</div>
        <div class="empty-state-title">Sin productos</div>
        <div class="empty-state-text">Este comercio aún no cargó productos en esta categoría</div>
      </div>
    `;
    return;
  }

  // Catálogo online: tarjetas propias y, en "Todo" sin búsqueda, agrupado por categoría
  if (grid.classList.contains('tnd-products')) {
    const stockOut = (p) => p.isAvailable === false || (p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0);
    const card = (p) => directProductCard(p, activeOffers.find(o => o.productIds && o.productIds.includes(p.id)), isOpen, isPaused, stockOut(p));
    if (categoryId === 'all' && !searchQuery && sortBy === 'default') {
      const tops = categories.filter(c => !c.parentCategoryId);
      const topOf = (catId) => {
        const c = categories.find(x => x.id === catId);
        return c?.parentCategoryId || catId;
      };
      const groups = tops.map(c => ({ id: c.id, name: c.name, items: filtered.filter(p => topOf(p.categoryId) === c.id) }));
      const known = new Set(tops.map(c => c.id));
      const others = filtered.filter(p => !known.has(topOf(p.categoryId)));
      if (others.length) groups.push({ id: '__otros', name: groups.length ? 'Otros' : 'Productos', items: others });
      grid.innerHTML = groups.filter(g => g.items.length).map(g => `
        <section class="tnd-section" data-section-id="${escapeHtml(g.id)}">
          <h2 class="tnd-section-title">${escapeHtml(g.name)} <small>${g.items.length}</small></h2>
          <div class="tnd-grid">${g.items.map(card).join('')}</div>
        </section>`).join('');
    } else {
      grid.innerHTML = `<div class="tnd-section"><div class="tnd-grid">${filtered.map(card).join('')}</div></div>`;
    }
    return;
  }

  allFilteredProducts = filtered;
  // Lo que entra en pantalla y un poco más: el resto se suma al bajar
  displayedCount = 30;

  const renderBatch = (startIndex, count) => {
    const batch = allFilteredProducts.slice(startIndex, startIndex + count);
    
    // Read dynamic fee for current merchant
    const dynamicFees = getState().dynamicDeliveryFees || {};
    const deliveryFee = dynamicFees[comercioId];

    return batch.map((p, i) => {
      const offer = activeOffers.find(o => o.productIds && o.productIds.includes(p.id));
      
      let isOutOfStock = p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0;
      if (p.useGlobalFlavors && currentComercio) {
        const activeFlavors = (p.allowedFlavors && p.allowedFlavors.length > 0)
          ? (currentComercio.sabores || []).filter(s => p.allowedFlavors.includes(s.name))
          : (currentComercio.sabores || []);
          
        // Note: s.isAvailable means "is stock limited?". So !s.isAvailable means infinite stock.
        const hasInfinite = activeFlavors.some(s => !s.isAvailable || s.stock === undefined || s.stock === null || s.stock === '');
        if (hasInfinite) {
          isOutOfStock = false;
        } else {
          const totalQty = activeFlavors.reduce((acc, s) => acc + (s.stock || 0), 0);
          isOutOfStock = totalQty <= 0;
        }
      }
      
      const isUnavailable = p.isAvailable === false || isOutOfStock;

      return `
        <div class="product-card card-interactive ${isUnavailable ? 'product-unavailable' : ''}" 
             data-product-id="${p.id}"
             style="position:relative; display:flex; justify-content:space-between; gap:16px; padding:16px; background:var(--color-surface); border-radius:20px; border:1px solid var(--color-border-light); box-shadow:var(--shadow-xs); transition:all 0.2s ease;">
          
          <!-- Left side: Text Details -->
          <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; min-width:0; text-align:left;">
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:800; color:var(--color-text); margin-bottom:4px; line-height:1.2; overflow-wrap: break-word; word-break: break-word; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span>${p.name}</span>
                ${p.onlyInApp ? `<span style="font-family:var(--font-sans); font-size:9px; font-weight:900; background:rgba(126, 34, 206, 0.08); color:#7e22ce; padding:2px 6px; border-radius:6px; border:1px solid rgba(126, 34, 206, 0.15); display:inline-flex; align-items:center; gap:2px; text-transform:uppercase; vertical-align:middle;">📱 Disponible sólo en la app</span>` : ''}
              </div>
              ${p.description ? `<div style="font-size:12px; color:var(--color-text-secondary); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:8px;">${p.description}</div>` : ''}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              ${offer ? `
                <div style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;">
                  <span style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-primary);">${formatPrice(offer.type === 'percentage' ? p.price * (1 - (offer.value || 0) / 100) : p.price)}${isSoldByWeight(p) ? ' /kg' : ''}</span>
                  <span style="font-size:12px; color:var(--color-text-tertiary); text-decoration:line-through; font-weight:700;">${formatPrice(p.price)}</span>
                </div>
              ` : `
                <span style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text);">${formatPrice(p.price)}${isSoldByWeight(p) ? ' /kg' : ''}</span>
              `}
            </div>
          </div>
    
          <!-- Right side: Image & Floating Button -->
          <div style="position:relative; width:110px; height:110px; flex-shrink:0;">
            <img src="${p.image || '/logo.png'}" alt="${p.name}" style="width:100%; height:100%; border-radius:14px; object-fit:cover; border:1px solid var(--color-border-light); background:white;" loading="lazy" decoding="async" />
            
            ${offer ? `
              <div style="position:absolute; top:6px; left:6px; background:var(--color-primary); color:white; font-size:9px; font-weight:900; padding:3px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:0.02em; box-shadow:0 3px 8px rgba(225,29,72,0.35); z-index:10; border: 1px solid rgba(255,255,255,0.15); font-family:var(--font-display);">${offer.type === 'percentage' ? `${offer.value}% OFF` : '2x1'}</div>
            ` : ''}
            
            ${(!isOpen || isPaused) ? `
              <div style="position:absolute; bottom:6px; right:6px; background:rgba(11,11,12,0.82); color:white; font-size:10px; font-weight:700; padding:4px 9px; border-radius:10px; text-transform:uppercase; letter-spacing:0.08em; z-index:10;">${isPaused ? 'Pausado' : 'Cerrado'}</div>
            ` : !isUnavailable ? `
              <button class="product-card-add" data-product-id="${p.id}" title="Agregar al carrito" style="position:absolute; bottom:-6px; right:-6px; width:32px; height:32px; border-radius:50%; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; border:2px solid var(--color-surface); box-shadow:0 4px 10px rgba(0,0,0,0.15); cursor:pointer; transition:all 0.2s ease; border:2px solid white;">
                ${icon('plus', 16)}
              </button>
            ` : `
              <div style="position:absolute; top:4px; right:4px; background:rgba(0,0,0,0.6); color:white; font-size:9px; font-weight:800; padding:2px 6px; border-radius:10px; text-transform:uppercase; letter-spacing:0.05em; z-index:10;">Agotado</div>
            `}
          </div>
    
        </div>
      `;
    }).join('');
  };

  // Render initial batch
  grid.innerHTML = renderBatch(0, displayedCount);

  // Setup sentinel and IntersectionObserver for pagination
  const setupSentinel = () => {
    if (displayedCount >= allFilteredProducts.length) return;

    const sentinel = document.createElement('div');
    sentinel.id = 'infinite-scroll-sentinel';
    sentinel.style.cssText = 'grid-column: 1/-1; height: 80px; display: flex; align-items: center; justify-content: center;';
    sentinel.innerHTML = `
      <div style="width: 24px; height: 24px; border: 3px solid var(--color-border-light); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    `;
    grid.appendChild(sentinel);

    infiniteScrollObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        infiniteScrollObserver.disconnect();
        
        // Remove sentinel
        const sent = document.getElementById('infinite-scroll-sentinel');
        if (sent) sent.remove();

        const prevCount = displayedCount;
        displayedCount = Math.min(displayedCount + 20, allFilteredProducts.length);

        // Parse and append batch directly to DOM
        const temp = document.createElement('div');
        temp.innerHTML = renderBatch(prevCount, displayedCount - prevCount);
        
        while (temp.firstChild) {
          grid.appendChild(temp.firstChild);
        }

        setupSentinel();
      }
    }, { threshold: 0.05, rootMargin: '400px' });

    infiniteScrollObserver.observe(sentinel);
  };

  setupSentinel();
}
