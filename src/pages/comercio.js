// GoDelivery — Comercio Detail Page
import { db, auth } from '../firebase.js';
import { doc, getDoc, collection, getDocs, query, orderBy, where, limit, startAfter } from 'firebase/firestore';
import { getRouteParams } from '../router.js';
import { addToCart, getCartCount, subscribe, getState, isProductFavorite, setState } from '../state.js';
import { getDocsOptimized, withTimeout } from '../utils/firestore-cache.js';
import { safeStorage } from '../utils/safe-storage.js';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { getFooterHTML } from '../components/footer.js';

import { renderNavbar, updateGlobalCartFAB } from '../components/navbar.js';
import { icon } from '../utils/icons.js';
import { openProductModal } from '../components/product-modal.js';
import { createSlug, getStoreUrl } from '../utils/slug.js';

let currentComercio = null;
let currentActiveOrder = null;
const memoryCommerceCache = new Map();

export async function renderComercio(content, isDirectMode = false) {
  if (!content) {
    content = document.getElementById('overlay-render-target') || document.getElementById('app-content');
  }
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
  try {
    safeStorage.setItem('gd_last_visited_comercio', JSON.stringify({ id: comercio.id, name: comercio.name || 'Comercio' }));
  } catch (e) {}

  let unsubComercios = null;

  try {
    const { onSnapshot, doc: firestoreDoc } = await import('firebase/firestore');
    const docRef = firestoreDoc(db, 'comercios', resolvedComercioId);
    unsubComercios = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const prevPaused = currentComercio?.isPaused;
        const freshData = snap.data();
        comercio = { id: snap.id, ...freshData };
        
        // Update DOM elements in real time
        const logoImg = document.querySelector('.comercio-detail-logo');
        if (logoImg && logoImg.tagName === 'IMG') logoImg.src = comercio.logo || '/logo.png';
        const bannerImg = document.querySelector('.comercio-header img');
        if (bannerImg && bannerImg.tagName === 'IMG') bannerImg.src = comercio.banner || '/logo.png';
        const nameEl = document.querySelector('.comercio-info-text h1');
        if (nameEl) nameEl.textContent = comercio.name;
        const descEl = document.querySelector('.comercio-description');
        if (descEl) descEl.textContent = comercio.description || '';

        // Real-time isPaused update: update badge + pause banner + product buttons
        if (freshData.isPaused !== prevPaused) {
          // Update open/closed badge
          const statusBadge = document.getElementById('comercio-status-badge');
          if (statusBadge) {
            const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
            const badgeText = comercio.isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
            const badgeBg = comercio.isPaused ? '#f59e0b' : (isOpen ? '#10b981' : '#64748b');
            statusBadge.style.background = badgeBg;
            statusBadge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:white;display:inline-block;${!comercio.isPaused && isOpen ? 'animation:pulse 1.8s infinite;' : ''}"></span> ${badgeText}`;
          }
          // Show/hide paused banner
          const pauseBanner = document.getElementById('comercio-pause-banner');
          if (pauseBanner) pauseBanner.style.display = comercio.isPaused ? 'flex' : 'none';
          // Disable/enable all add-to-cart buttons
          document.querySelectorAll('.product-card-add').forEach(btn => {
            btn.style.display = comercio.isPaused ? 'none' : '';
          });
          // Show/hide paused pill on product cards
          document.querySelectorAll('.product-paused-pill').forEach(el => {
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
        where('status', 'in', ['pending', 'confirmed', 'ready', 'delivering'])
      );
      unsubActiveOrders = onSnapshot(qOrders, (snap) => {
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

  let cachedData = memoryCommerceCache.get(resolvedComercioId) || null;
  if (!cachedData) {
    try {
      const rawCache = localStorage.getItem(`gd_comercio_cache_${resolvedComercioId}`);
      if (rawCache) {
        const parsed = JSON.parse(rawCache);
        if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < 14400000)) {
          cachedData = parsed.data;
          memoryCommerceCache.set(resolvedComercioId, cachedData);
        } else {
          console.log('[Cache] Menu cache expired (4 hours limit) or invalid');
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
    renderPage(content, comercio, categories, products, activeCategory, activeOffers, activeSort, activeBrand, activeSubCategory, isDirect);
    
    // Trigger deep-link product modal if parameter exists in URL
    try {
      const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const targetProductId = urlParams.get('product') || urlParams.get('p');
      if (targetProductId && !deepLinkOpened) {
        const targetProd = products.find(p => p.id === targetProductId);
        if (targetProd && targetProd.isAvailable !== false && !(targetProd.stockMode === 'limited' && (targetProd.stockQuantity || 0) <= 0)) {
          const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
          deepLinkOpened = true;
          setTimeout(() => {
            openProductModal(targetProd, resolvedComercioId, comercio.name, isOpen);
          }, 300);
        }
      }
    } catch (e) {}
  } else {
    // Skeleton (only if no cache)
    content.innerHTML = `
      <div class="comercio-page">
        <div class="comercio-header skeleton" style="height:200px;"></div>
        <div class="comercio-info">
          <div class="comercio-info-card">
            <div style="display:flex; gap:16px; align-items:center; margin-bottom:16px;">
              <div class="skeleton skeleton-circle" style="width:64px; height:64px;"></div>
              <div style="flex:1;">
                <div class="skeleton skeleton-title" style="width:60%; height:24px;"></div>
                <div class="skeleton skeleton-text" style="width:30%; height:16px;"></div>
              </div>
            </div>
            <div class="skeleton skeleton-text" style="width:100%; height:14px; margin-bottom:8px;"></div>
            <div class="skeleton skeleton-text" style="width:80%; height:14px;"></div>
          </div>
        </div>
        <div class="comercio-products">
          <div class="products-grid" style="padding:16px;">
            ${Array(4).fill(`
              <div class="product-card skeleton-card">
                <div class="skeleton" style="width:100%; aspect-ratio:1; border-radius:12px;"></div>
                <div class="product-card-info">
                  <div class="skeleton skeleton-title" style="width:80%; height:16px; margin-top:8px;"></div>
                  <div class="skeleton skeleton-text" style="width:40%; height:12px; margin-top:8px;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  try {
    let catsSnap = null;
    let offersSnap = null;
    let initialProdSnap = null;

    const [catsRes, offersRes, prodsRes] = await Promise.allSettled([
      getDocsOptimized(
        query(collection(db, 'comercios', resolvedComercioId, 'categories'), orderBy('order')),
        `comercio_categories_${resolvedComercioId}`,
        15 * 60 * 1000
      ),
      getDocsOptimized(
        query(collection(db, 'offers'), where('comercioId', '==', resolvedComercioId), where('active', '==', true)),
        `comercio_offers_${resolvedComercioId}`,
        5 * 60 * 1000
      ),
      getDocsOptimized(
        query(collection(db, 'comercios', resolvedComercioId, 'products'), limit(100)),
        `comercio_products_${resolvedComercioId}_cat_all`,
        15 * 60 * 1000
      )
    ]);

    // getDocsOptimized already retries via cache internally and never throws
    // (it resolves to an { error: true } empty snapshot on failure), so a
    // second sequential getDocs() here would only double the wait time for
    // no benefit. We just track whether any of them errored, to inform the
    // user instead of silently rendering an empty menu.
    catsSnap = catsRes.status === 'fulfilled' ? catsRes.value : { docs: [], error: true };
    offersSnap = offersRes.status === 'fulfilled' ? offersRes.value : { docs: [], error: true };
    initialProdSnap = prodsRes.status === 'fulfilled' ? prodsRes.value : { docs: [], error: true };

    const hadLoadError = Boolean(catsSnap?.error || offersSnap?.error || initialProdSnap?.error);

    const categories = (catsSnap.docs || []).map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
    const activeOffers = (offersSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
    let products = (initialProdSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));

    if (hadLoadError && products.length === 0 && categories.length === 0 && !cachedData) {
      throw new Error('Failed to load comercio menu data (categories/products query error)');
    }

    // Helper to load products for a specific category dynamically
    const loadCategoryProducts = async (catId) => {
      let q;
      let cacheKey = `comercio_products_${resolvedComercioId}_cat_${catId}`;
      if (catId === 'all') {
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), limit(100));
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
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), where('categoryId', '==', catId), limit(100));
      }

      try {
        const prodsSnap = await getDocsOptimized(q, cacheKey, 15 * 60 * 1000);
        return (prodsSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
        try {
          const directSnap = await getDocs(q);
          return (directSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
          return [];
        }
      }
    };

    // Store in memory & localStorage for next instant load
    const cachePayload = { comercio, categories, products, activeOffers };
    memoryCommerceCache.set(resolvedComercioId, cachePayload);
    safeStorage.setItem(`gd_comercio_cache_${resolvedComercioId}`, JSON.stringify({
      timestamp: Date.now(),
      data: cachePayload
    }));

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
          comercioOpen: isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen),
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

    if (shouldRender) {
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
          const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
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
          subGrid.innerHTML = `
            <button class="sub-tab-pill active" data-subcat-id="all" style="padding: 6px 14px; font-size: 11.5px; border-radius: 12px; border: 1.5px solid var(--color-primary); background: rgba(var(--color-primary-rgb), 0.1); color: var(--color-primary); font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; box-shadow: var(--shadow-xs); outline: none;">Ver Todo</button>
            ${subCats.map(sub => `
              <button class="sub-tab-pill" data-subcat-id="${sub.id}" style="padding: 6px 14px; font-size: 11.5px; border-radius: 12px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); color: var(--color-text-secondary); font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; box-shadow: var(--shadow-xs); outline: none;">${sub.name}</button>
            `).join('')}
          `;
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

      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
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
        const isActive = p.dataset.subcatId === activeSubCategory;
        p.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-border-light)';
        p.style.background = isActive ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)';
        p.style.color = isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)';
      });

      // Update brands dropdown dynamically
      activeBrand = updateBrandDropdown(products, activeCategory, activeSubCategory, categories, activeBrand, activeOffers);

      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

    // Brand filter handler
    content.addEventListener('change', (e) => {
      if (e.target.id === 'comercio-brand-select') {
        activeBrand = e.target.value;
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
        smoothScrollToProductsTop();
        renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
      }
    });

    // Sort filter handler
    const sortSelect = content.querySelector('#comercio-sort-select') || document.getElementById('comercio-sort-select');
    sortSelect?.addEventListener('change', (e) => {
      activeSort = e.target.value;
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

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
      comercioSearchDebounceTimer = setTimeout(() => {
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
        renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
      }, 120);
    });

    const clearSearchBtn = content.querySelector('#clear-search-btn') || document.getElementById('clear-search-btn');
    clearSearchBtn?.addEventListener('click', () => {
      const input = content.querySelector('#comercio-product-search') || document.getElementById('comercio-product-search');
      if (input) input.value = '';
      activeSearch = '';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories, currentComercio?.isPaused === true);
    });

    // Product interaction handler (Delegated to container)
    const productsContainer = content.querySelector('#comercio-products') || document.getElementById('comercio-products');
    if (productsContainer) {
      productsContainer.onclick = (e) => {
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);

        const card = e.target.closest('.product-card');
        const addBtn = e.target.closest('.product-card-add');

        if (!card) return;

        const productId = card.dataset.productId;
        const product = products.find(p => p.id === productId);

        if (!product || card.classList.contains('product-unavailable')) return;

        // If quick-add button clicked AND product has no required options/extras
        const hasOptions = (product.optionsGroups && product.optionsGroups.length > 0) || product.useGlobalFlavors === true;

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
      const base = (item.product.price || 0) + (item.options || []).reduce((os, o) => os + (o.price * (o.qty || 1) || 0), 0);
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
      bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
      left: 16px !important;
      right: 16px !important;
      z-index: 99999999 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%) !important;
      color: white !important;
      padding: 14px 20px !important;
      border-radius: 20px !important;
      box-shadow: 0 10px 30px rgba(225, 29, 72, 0.45), 0 2px 8px rgba(0,0,0,0.15) !important;
      cursor: pointer !important;
      font-family: var(--font-body, system-ui) !important;
      box-sizing: border-box !important;
      transform: translateZ(0) !important;
      pointer-events: auto !important;
    `;

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="background: rgba(255,255,255,0.22); width: 40px; height: 40px; border-radius: 12px; display:flex; align-items:center; justify-content:center; font-size: 20px; flex-shrink:0;">🛍️</div>
        <div style="min-width:0;">
          <div id="direct-cart-bar-items" style="font-size: 11px; font-weight: 800; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">${totalCount} ${totalCount === 1 ? 'PRODUCTO' : 'PRODUCTOS'}</div>
          <div id="direct-cart-bar-total" style="font-size: 17px; font-weight: 900; font-family: var(--font-display, inherit);">$${formatPrice(totalPrice).replace('$', '')}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px; font-weight: 900; font-size: 13.5px; background: rgba(255,255,255,0.22); padding: 9px 16px; border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); flex-shrink:0;">
        Ver Mi Pedido ${icon('chevronRight', 16)}
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
      bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
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
    <option value="all" ${targetBrand === 'all' ? 'selected' : ''}>Todas las marcas</option>
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

  content.innerHTML = `
    <div class="comercio-page" style="${isDirect ? 'padding-bottom: 120px;' : ''}">
      <!-- Minimal Sticky Navbar -->
      <div id="comercio-navbar" style="position: sticky; top: 0; z-index: 100; height: calc(56px + env(safe-area-inset-top, 0px)); display: flex; align-items: center; justify-content: space-between; padding: calc(env(safe-area-inset-top, 0px)) 16px 0 16px; box-sizing: border-box; transition: background 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease; background: transparent; border-bottom: 1px solid transparent;">
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
      <div class="comercio-header" style="position: relative; height: 50vw; max-height: 250px; margin-top: calc(-56px - env(safe-area-inset-top, 0px)); overflow: hidden;">
        ${comercio.banner ? `<img id="comercio-banner-img" src="${comercio.banner}" alt="${comercio.name}" loading="lazy" decoding="async" style="width: 100%; height: 100%; object-fit: cover; will-change: transform;" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 60)}</div>`}
        <div class="comercio-header-overlay" style="position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%);"></div>
      </div>
    
      <!-- Info Card Layer -->
      <div class="comercio-info" style="position: relative; z-index: 2; margin-top: -40px; padding: 0 16px;">
        <div class="comercio-info-card" style="background: var(--color-surface); border-radius: 24px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); position: relative;">
          ${(() => {
            const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
            const isPausedNow = comercio.isPaused === true;
            const badgeText = isPausedNow ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
            const badgeBg = isPausedNow ? '#f59e0b' : (isOpen ? '#10b981' : '#64748b');
            return `
              <div id="comercio-status-badge" style="position: absolute; top: -16px; right: 24px; font-size: 11px; font-weight: 900; padding: 6px 14px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px; background: ${badgeBg}; color: white; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: white; display: inline-block; ${!isPausedNow && isOpen ? 'animation: pulse 1.8s infinite;' : ''}"></span>
                ${badgeText}
              </div>
            `;
          })()}
          
          <div style="display: flex; align-items: center; gap: 16px;">
            ${comercio.logo
              ? `<img src="${comercio.logo}" alt="" loading="lazy" decoding="async" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 4px solid var(--color-surface); margin-top: -48px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); background: white;" />`
              : `<div style="width: 72px; height: 72px; border-radius: 50%; border: 4px solid var(--color-surface); margin-top: -48px; display:flex;align-items:center;justify-content:center;background:var(--color-primary-light); box-shadow: 0 4px 12px rgba(0,0,0,0.1);">${icon('store', 28)}</div>`
            }
            <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0; padding-top: 8px;">
              <h1 id="comercio-main-title" style="margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 24px; font-weight: 800; color: var(--color-text);">${comercio.name}</h1>
              <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;margin-top:6px;">
                <span style="font-size: 11px; font-weight: 850; color: white; background: var(--color-primary); padding: 4px 12px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.03em;">${comercio.category || 'Comercio'}</span>
                <button id="rate-comercio-btn" style="background: #f59e0b; border: none; border-radius: 8px; padding: 4px 12px; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 850; color: white; cursor: pointer; text-transform: uppercase; box-shadow: 0 2px 6px rgba(245,158,11,0.2);">
                  ⭐ ${comercio.ratingAverage !== undefined && comercio.ratingAverage > 0 ? `${comercio.ratingAverage.toFixed(1)} (${comercio.ratingCount || 0})` : 'Puntuar'}
                </button>
              </div>
            </div>
          </div>
          
          <div style="margin-top: 16px;">
            ${comercio.description ? `<p style="margin: 0 0 12px 0; color: var(--color-text-secondary); font-size: 14px; line-height: 1.5;">${comercio.description}</p>` : ''}
            <div style="padding-top: 12px; border-top: 1px solid var(--color-border-light); color: var(--color-text-secondary); font-size: 13px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              ${comercio.address ? `
              <span style="display: inline-flex; align-items: center; color: var(--color-primary);">${icon('mapPin', 14)}</span>
              <span style="font-weight: 600;">${comercio.address.split(',')[0]}</span>
              <span style="color: var(--color-border); margin: 0 4px;">•</span>
              ` : ''}
              <span style="display: inline-flex; align-items: center; color: var(--color-primary);">${icon('clock', 14)}</span>
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
        <div id="comercio-sticky-filters" style="position: sticky; top: calc(56px + env(safe-area-inset-top, 0px)); z-index: 90; background: var(--color-bg); padding-top: 8px; padding-bottom: 8px;">
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
          <div class="tab-pills sub-tab-pills" id="comercio-subcategories" style="display: flex; gap: var(--space-2); overflow-x: auto; padding: 4px 0 var(--space-2) 0; border-bottom: none; position: relative;">
            <button class="sub-tab-pill ${activeSubCategory === 'all' ? 'active' : ''}" data-subcat-id="all" style="padding: 6px 14px; font-size: 11.5px; border-radius: 12px; border: 1.5px solid ${activeSubCategory === 'all' ? 'var(--color-primary)' : 'var(--color-border-light)'}; background: ${activeSubCategory === 'all' ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)'}; color: ${activeSubCategory === 'all' ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; box-shadow: var(--shadow-xs); outline: none;">Ver Todo</button>
            ${subCats.map(sub => `
              <button class="sub-tab-pill ${activeSubCategory === sub.id ? 'active' : ''}" data-subcat-id="${sub.id}" style="padding: 6px 14px; font-size: 11.5px; border-radius: 12px; border: 1.5px solid ${activeSubCategory === sub.id ? 'var(--color-primary)' : 'var(--color-border-light)'}; background: ${activeSubCategory === sub.id ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)'}; color: ${activeSubCategory === sub.id ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; box-shadow: var(--shadow-xs); outline: none;">${sub.name}</button>
            `).join('')}
          </div>
        </div>

        <div class="comercio-sort-container" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); display: flex; flex-direction: row; gap: 8px; border-bottom: 1px solid var(--color-border-light); padding-bottom: 12px;">
          <div style="flex: 1; display: flex; align-items: center; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 10px; padding-left: 8px; box-shadow: var(--shadow-xs); overflow: hidden;">
            <span style="color: var(--color-text-tertiary); display: flex; align-items: center; flex-shrink: 0;">${icon('sliders', 14)}</span>
            <select id="comercio-sort-select" style="flex: 1; border: none; background: transparent; color: var(--color-text); padding: 8px 6px; font-size: 11.5px; font-weight: 700; outline: none; cursor: pointer; width: 100%; text-overflow: ellipsis;">
              <option value="default" ${activeSort === 'default' ? 'selected' : ''}>Recomendados</option>
              <option value="price-asc" ${activeSort === 'price-asc' ? 'selected' : ''}>Menor precio</option>
              <option value="price-desc" ${activeSort === 'price-desc' ? 'selected' : ''}>Mayor precio</option>
              <option value="sales-desc" ${activeSort === 'sales-desc' ? 'selected' : ''}>Más vendido</option>
              <option value="sales-asc" ${activeSort === 'sales-asc' ? 'selected' : ''}>Menos vendido</option>
            </select>
          </div>

          <div style="flex: 1; display: flex; align-items: center; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 10px; padding-left: 8px; box-shadow: var(--shadow-xs); overflow: hidden;">
            <span style="color: var(--color-text-tertiary); display: flex; align-items: center; flex-shrink: 0;">${icon('tag', 14)}</span>
            <select id="comercio-brand-select" style="flex: 1; border: none; background: transparent; color: var(--color-text); padding: 8px 6px; font-size: 11.5px; font-weight: 700; outline: none; cursor: pointer; width: 100%; text-overflow: ellipsis;">
              <option value="all" ${activeBrand === 'all' ? 'selected' : ''}>Todas las marcas</option>
              ${getUniqueBrandsForCategory(products, activeCategory, activeSubCategory, categories, activeOffers).map(brand => `<option value="${brand}" ${activeBrand === brand ? 'selected' : ''}>${brand}</option>`).join('')}
            </select>
          </div>
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

  const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
  const isPausedNow = comercio.isPaused === true;
  renderProducts(products, activeCategory, activeOffers, activeSort, '', comercio.id, isOpen, activeBrand, activeSubCategory, categories, isPausedNow);
  
  updateComercioActiveOrderUI(currentActiveOrder, comercio.id, isDirect);
  if (isDirect) {
    updateDirectCartBar(comercio.id, currentActiveOrder);
  } else {
    updateGlobalCartFAB();
  }

  // Bind rating button click
  document.getElementById('rate-comercio-btn')?.addEventListener('click', () => {
    openRatingModal(comercio);
  });

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

async function openRatingModal(comercio) {
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

      // Recalculate
      const reviewsSnap = await getDocs(query(collection(db, 'reviews'), where('comercioId', '==', comercio.id)));
      const reviews = reviewsSnap.docs.map(d => d.data());
      const ratingCount = reviews.length;
      const ratingAverage = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / ratingCount;

      await updateDoc(doc(db, 'comercios', comercio.id), {
        ratingAverage,
        ratingCount
      });

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

  allFilteredProducts = filtered;
  displayedCount = 100;

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
                  <span style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-primary);">${formatPrice(offer.type === 'percentage' ? p.price * (1 - (offer.value || 0) / 100) : p.price)}</span>
                  <span style="font-size:12px; color:var(--color-text-tertiary); text-decoration:line-through; font-weight:700;">${formatPrice(p.price)}</span>
                </div>
              ` : `
                <span style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text);">${formatPrice(p.price)}</span>
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
              <div style="position:absolute; bottom:6px; right:6px; background:${isPaused ? '#f59e0b' : 'var(--color-text-tertiary)'}; color:white; font-size:9.5px; font-weight:850; padding:4px 10px; border-radius:12px; text-transform:uppercase; letter-spacing:0.05em; z-index:10; border: 1.5px solid white;">${isPaused ? 'Pausado' : 'Cerrado'}</div>
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
