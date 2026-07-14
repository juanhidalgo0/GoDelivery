// GoDelivery — Comercio Detail Page
import { db } from '../firebase.js';
import { doc, getDoc, collection, getDocs, query, orderBy, where, limit, startAfter } from 'firebase/firestore';
import { getRouteParams } from '../router.js';
import { addToCart, getCartCount, subscribe, getState, isProductFavorite, setState } from '../state.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { getFooterHTML } from '../components/footer.js';

import { renderNavbar } from '../components/navbar.js';
import { icon } from '../utils/icons.js';
import { openProductModal } from '../components/product-modal.js';

let currentComercio = null;

export async function renderComercio(content) {
  if (!content) content = document.getElementById('app-content');
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('alertTriangle', 40)}</div><div class="empty-state-title">Comercio no encontrado</div></div>`;
    return;
  }

  // Resolve actual commerce ID (allowing matching by name/subdomain or fallback to the first commerce document)
  let comercio = null;
  try {
    const { doc, getDoc, collection, getDocs, query, limit } = await import('firebase/firestore');
    const docRef = doc(db, 'comercios', comercioId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      comercio = { id: snap.id, ...snap.data() };
    } else {
      const q = query(collection(db, 'comercios'), limit(5));
      const allComSnap = await getDocs(q);
      if (!allComSnap.empty) {
        let matchedDoc = allComSnap.docs.find(d => {
          const name = (d.data().name || '').toLowerCase();
          const sub = (d.data().subdomain || '').toLowerCase();
          const target = comercioId.toLowerCase();
          return name.includes(target) || target.includes(name) || sub === target;
        });
        if (!matchedDoc) {
          matchedDoc = allComSnap.docs[0];
        }
        comercio = { id: matchedDoc.id, ...matchedDoc.data() };
        console.log(`[Preview Fallback] Resolved commerce '${comercioId}' to '${comercio.id}'`);
      }
    }
  } catch (err) {
    console.error('Error resolving commerce document:', err);
  }



  if (!comercio) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('store', 40)}</div><div class="empty-state-title">Comercio no encontrado</div><button class="btn btn-primary" onclick="location.hash='/#'">Volver</button></div>`;
    return;
  }

  currentComercio = comercio;
  const resolvedComercioId = comercio.id;
  let unsubComercios = null;

  try {
    const { onSnapshot, doc: firestoreDoc } = await import('firebase/firestore');
    const docRef = firestoreDoc(db, 'comercios', resolvedComercioId);
    unsubComercios = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const freshData = snap.data();
        comercio = { id: snap.id, ...freshData };
        
        // Update DOM elements in real time
        const logoImg = document.querySelector('.comercio-detail-logo');
        if (logoImg) {
          if (logoImg.tagName === 'IMG') {
            logoImg.src = comercio.logo || '/logo.png';
          }
        }
        const bannerImg = document.querySelector('.comercio-header img');
        if (bannerImg && bannerImg.tagName === 'IMG') {
          bannerImg.src = comercio.banner || '/logo.png';
        }
        const nameEl = document.querySelector('.comercio-info-text h1');
        if (nameEl) {
          nameEl.textContent = comercio.name;
        }
        const descEl = document.querySelector('.comercio-description');
        if (descEl) {
          descEl.textContent = comercio.description || '';
        }

        // Update local storage cache
        try {
          const rawCache = localStorage.getItem(`gd_comercio_cache_${resolvedComercioId}`);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            parsed.data.comercio = comercio;
            localStorage.setItem(`gd_comercio_cache_${resolvedComercioId}`, JSON.stringify(parsed));
          }
        } catch (e) {}
        
        currentComercio = comercio;
      }
    });
  } catch (err) {
    console.warn('Error setting up real-time listener for commerce details:', err);
  }

  // Proactive fee calculation
  import('./cart.js').then(m => m.calculateAllFees && m.calculateAllFees(resolvedComercioId));

  let cachedData = null;
  try {
    const rawCache = localStorage.getItem(`gd_comercio_cache_${resolvedComercioId}`);
    if (rawCache) {
      const parsed = JSON.parse(rawCache);
      if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < 14400000)) {
        cachedData = parsed.data;
      } else {
        console.log('[Cache] Menu cache expired (4 hours limit) or invalid');
      }
    }
  } catch (err) {
    console.warn('Error reading local cache:', err);
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
    renderPage(comercio, categories, products, activeCategory, activeOffers, activeSort, activeBrand, activeSubCategory);
    
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
    const [catsSnap, offersSnap] = await Promise.all([
      getDocsOptimized(
        query(collection(db, 'comercios', resolvedComercioId, 'categories'), orderBy('order')),
        `comercio_categories_${resolvedComercioId}`,
        15 * 60 * 1000 // 15 minutes TTL
      ),
      getDocsOptimized(
        query(collection(db, 'offers'), where('comercioId', '==', resolvedComercioId), where('active', '==', true)),
        `comercio_offers_${resolvedComercioId}`,
        5 * 60 * 1000 // 5 minutes TTL
      )
    ]);

    const categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
    const activeOffers = offersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let products = [];

    // Helper to load products for a specific category dynamically
    const loadCategoryProducts = async (catId) => {
      let q;
      let cacheKey = `comercio_products_${resolvedComercioId}_cat_${catId}`;
      if (catId === 'all') {
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), limit(10000));
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
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), where('categoryId', '==', catId));
      }

      const prodsSnap = await getDocsOptimized(q, cacheKey, 15 * 60 * 1000);
      return prodsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    };

    // Load initial products for current active category (which is activeCategory, typically 'all')
    const initialProducts = await loadCategoryProducts(activeCategory);
    products = initialProducts;

    // Store in localStorage for next instant load
    try {
      localStorage.setItem(`gd_comercio_cache_${resolvedComercioId}`, JSON.stringify({
        timestamp: Date.now(),
        data: { comercio, categories, products, activeOffers }
      }));
    } catch (err) {
      console.warn('Error saving to local cache:', err);
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
      renderPage(comercio, categories, products, activeCategory, activeOffers, activeSort, activeBrand, activeSubCategory);
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
    document.getElementById('comercio-categories')?.addEventListener('click', async (e) => {
      const pill = e.target.closest('.tab-pill');
      if (!pill) return;
      activeCategory = pill.dataset.catId;
      activeSubCategory = 'all'; // Reset subcategory when main category changes

      document.querySelectorAll('#comercio-categories .tab-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      // Smoothly scroll the pill to the left position (like "Todos")
      if (pill.parentElement) {
        const container = pill.parentElement;
        container.scrollTo({ left: pill.offsetLeft - 16, behavior: 'smooth' });
      }

      // Update subcategories container dynamically
      const subCats = categories.filter(c => c.parentCategoryId === activeCategory);
      const subContainer = document.getElementById('comercio-subcategories-container');
      const subGrid = document.getElementById('comercio-subcategories');
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

      const grid = document.getElementById('comercio-products');
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
          // Also load products for any subcategories
          for (const sub of subCats) {
            const subProducts = await loadCategoryProducts(sub.id);
            subProducts.forEach(cp => {
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
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories);
    });

    // Subcategory filter handler (delegated click event)
    document.getElementById('app-content')?.addEventListener('click', async (e) => {
      const subPill = e.target.closest('.sub-tab-pill');
      if (!subPill) return;
      activeSubCategory = subPill.dataset.subcatId;

      document.querySelectorAll('.sub-tab-pill').forEach(p => p.classList.remove('active'));
      subPill.classList.add('active');
      
      // Smoothly scroll the sub-pill to the left position
      if (subPill.parentElement) {
        const container = subPill.parentElement;
        container.scrollTo({ left: subPill.offsetLeft, behavior: 'smooth' });
      }
      
      document.querySelectorAll('.sub-tab-pill').forEach(p => {
        const isActive = p.dataset.subcatId === activeSubCategory;
        p.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-border-light)';
        p.style.background = isActive ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)';
        p.style.color = isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)';
      });

      // Update brands dropdown dynamically
      activeBrand = updateBrandDropdown(products, activeCategory, activeSubCategory, categories, activeBrand, activeOffers);

      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories);
    });

    // Brand filter handler
    document.getElementById('app-content')?.addEventListener('change', (e) => {
      if (e.target.id === 'comercio-brand-select') {
        activeBrand = e.target.value;
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
        smoothScrollToProductsTop();
        renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories);
      }
    });

    // Sort filter handler
    document.getElementById('comercio-sort-select')?.addEventListener('change', (e) => {
      activeSort = e.target.value;
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      smoothScrollToProductsTop();
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories);
    });

    // Search input handler
    document.getElementById('comercio-product-search')?.addEventListener('input', (e) => {
      activeSearch = e.target.value.trim().toLowerCase();
      const clearBtn = document.getElementById('clear-search-btn');
      if (clearBtn) {
        clearBtn.style.display = activeSearch ? 'flex' : 'none';
      }
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories);
    });

    document.getElementById('clear-search-btn')?.addEventListener('click', () => {
      const input = document.getElementById('comercio-product-search');
      if (input) input.value = '';
      activeSearch = '';
      const clearBtn = document.getElementById('clear-search-btn');
      if (clearBtn) clearBtn.style.display = 'none';
      const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch, resolvedComercioId, isOpen, activeBrand, activeSubCategory, categories);
    });

    // Product interaction handler (Delegated to container)
    const productsContainer = document.getElementById('comercio-products');
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
          updateFAB();
          return;
        }

        // Open modal for anything else (card click or button on complex products)
        openProductModal(product, resolvedComercioId, comercio.name, isOpen);
      };
    }

  } catch (e) {
    console.error('Error loading comercio:', e);
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('alertTriangle', 40)}</div><div class="empty-state-title">Error al cargar</div></div>`;
  }

  // Cart FAB subscription
  const unsub = subscribe('cart', () => updateFAB());
  return {
    cleanup: () => {
      unsub();
      if (unsubComercios) unsubComercios();
    }
  };
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

function renderPage(comercio, categories, products, activeCategory, activeOffers = [], activeSort = 'default', activeBrand = 'all', activeSubCategory = 'all') {
  const content = document.getElementById('app-content');

  const hasDiscounts = activeOffers.length > 0;

  // Render subcategories if any exist for the active category
  const subCats = categories.filter(c => c.parentCategoryId === activeCategory);

  content.innerHTML = `
    <div class="comercio-page">
      <!-- Minimal Sticky Navbar -->
      <div id="comercio-navbar" style="position: sticky; top: 0; z-index: 100; height: calc(56px + env(safe-area-inset-top, 0px)); display: flex; align-items: flex-end; padding: 0 16px 10px 16px; box-sizing: border-box; transition: background 0.3s, box-shadow 0.3s; background: transparent;">
        <button class="comercio-header-back" id="comercio-nav-back" onclick="location.hash = '#/'" style="position: relative; top: 0; left: 0; margin: 0; z-index: 10; border: none; background: rgba(255,255,255,0.8); backdrop-filter: blur(4px); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; transition: background 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.1); color: #000;">${icon('back', 20)}</button>
        <div id="comercio-nav-title" style="display: flex; align-items: center; gap: 10px; margin-left: 14px; opacity: 0; transition: opacity 0.3s, transform 0.3s; transform: translateY(4px); overflow: hidden; flex: 1; height: 36px;">
          ${comercio.logo 
            ? `<img src="${comercio.logo}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--color-surface); flex-shrink: 0;" />`
            : `<div style="width: 28px; height: 28px; border-radius: 50%; background: var(--color-primary-light); color: var(--color-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1.5px solid var(--color-surface);">${icon('store', 14)}</div>`
          }
          <div style="font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text); font-weight: 700; line-height: normal; transform: translateY(-1px);">${comercio.name}</div>
        </div>
      </div>

      <!-- Banner Layer -->
      <div class="comercio-header" style="position: relative; height: 50vw; max-height: 250px; margin-top: calc(-56px - env(safe-area-inset-top, 0px)); overflow: hidden;">
        ${comercio.banner ? `<img id="comercio-banner-img" src="${comercio.banner}" alt="${comercio.name}" style="width: 100%; height: 100%; object-fit: cover; will-change: transform;" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 60)}</div>`}
        <div class="comercio-header-overlay" style="position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%);"></div>
      </div>
    
      <!-- Info Card Layer -->
      <div class="comercio-info" style="position: relative; z-index: 2; margin-top: -40px; padding: 0 16px;">
        <div class="comercio-info-card" style="background: var(--color-surface); border-radius: 24px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); position: relative;">
          ${(() => {
            const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
            return `
              <div style="position: absolute; top: -16px; right: 24px; font-size: 11px; font-weight: 900; padding: 6px 14px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px; background: ${isOpen ? '#10b981' : '#64748b'}; color: white; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: white; display: inline-block; ${isOpen ? 'animation: pulse 1.8s infinite;' : ''}"></span>
                ${isOpen ? 'Abierto' : 'Cerrado'}
              </div>
            `;
          })()}
          
          <div style="display: flex; align-items: center; gap: 16px;">
            ${comercio.logo
              ? `<img src="${comercio.logo}" alt="" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 4px solid var(--color-surface); margin-top: -48px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); background: white;" />`
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
        <div id="comercio-sticky-filters" style="position: sticky; top: 56px; z-index: 90; background: var(--color-bg); padding-top: 8px; padding-bottom: 8px;">
        <!-- Search bar -->
        <div class="comercio-search-container scroll-reveal reveal-fade-up reveal-delay-1" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); margin-top: 12px;">
          <div style="position:relative; width: 100%; display:flex; align-items:center; background:var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius:16px; padding:0 16px; height:46px; box-shadow:var(--shadow-xs); transition: all 0.2s;">
            <span style="color:var(--color-text-tertiary); display:flex; align-items:center; justify-content:center; margin-right:10px;">${icon('search', 18)}</span>
            <input type="text" id="comercio-product-search" placeholder="Buscar productos..." style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none;" />
            <button id="clear-search-btn" style="background:none; border:none; color:var(--color-text-tertiary); display:none; align-items:center; justify-content:center; cursor:pointer; padding:4px;">${icon('xCircle', 16)}</button>
          </div>
        </div>

        <div class="tab-pills scroll-reveal reveal-fade-up reveal-delay-2" id="comercio-categories" style="margin-bottom:var(--space-3); padding-left: var(--space-4); padding-right: var(--space-4); position: relative;">
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
        <div id="comercio-subcategories-container" class="scroll-reveal reveal-fade-up reveal-delay-2" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); display: ${subCats.length > 0 ? 'block' : 'none'};">
          <div class="tab-pills sub-tab-pills" id="comercio-subcategories" style="display: flex; gap: var(--space-2); overflow-x: auto; padding: 4px 0 var(--space-2) 0; border-bottom: none; position: relative;">
            <button class="sub-tab-pill ${activeSubCategory === 'all' ? 'active' : ''}" data-subcat-id="all" style="padding: 6px 14px; font-size: 11.5px; border-radius: 12px; border: 1.5px solid ${activeSubCategory === 'all' ? 'var(--color-primary)' : 'var(--color-border-light)'}; background: ${activeSubCategory === 'all' ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)'}; color: ${activeSubCategory === 'all' ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; box-shadow: var(--shadow-xs); outline: none;">Ver Todo</button>
            ${subCats.map(sub => `
              <button class="sub-tab-pill ${activeSubCategory === sub.id ? 'active' : ''}" data-subcat-id="${sub.id}" style="padding: 6px 14px; font-size: 11.5px; border-radius: 12px; border: 1.5px solid ${activeSubCategory === sub.id ? 'var(--color-primary)' : 'var(--color-border-light)'}; background: ${activeSubCategory === sub.id ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)'}; color: ${activeSubCategory === sub.id ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all 0.2s; box-shadow: var(--shadow-xs); outline: none;">${sub.name}</button>
            `).join('')}
          </div>
        </div>

        <div class="comercio-sort-container scroll-reveal reveal-fade-up reveal-delay-3" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); display: flex; flex-direction: row; gap: 8px; border-bottom: 1px solid var(--color-border-light); padding-bottom: 12px;">
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

      <!-- Cart FAB -->
      <div id="cart-fab-container"></div>
      
      ${getFooterHTML()}
    </div>
  `;

  const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []), comercio.daysOpen);
  renderProducts(products, activeCategory, activeOffers, activeSort, '', comercio.id, isOpen, activeBrand, activeSubCategory, categories);
  updateFAB();

  // Bind rating button click
  document.getElementById('rate-comercio-btn')?.addEventListener('click', () => {
    openRatingModal(comercio);
  });

  // Modern, flicker-free sticky navbar logic
  const navbar = document.getElementById('comercio-navbar');
  const navTitle = document.getElementById('comercio-nav-title');
  const navBack = document.getElementById('comercio-nav-back');
  const bannerImg = document.getElementById('comercio-banner-img');
  
  if (navbar) {
    if (window._comercioScrollHandler) {
      window.removeEventListener('scroll', window._comercioScrollHandler, { capture: true });
    }

    window._comercioScrollHandler = (e) => {
      if (!window.location.hash.startsWith('#/comercio/')) return;
      const target = e.target;
      const isPanel = target.classList && (target.classList.contains('slide-panel') || target.classList.contains('slide-overlay'));
      const isDocument = target === document || target === window;
      if (!isPanel && !isDocument) return;

      let scrollTop = isPanel ? target.scrollTop : (window.scrollY || document.documentElement.scrollTop);
      
      // Parallax effect on banner image
      if (bannerImg && scrollTop < 300) {
        bannerImg.style.transform = `translateY(${scrollTop * 0.4}px)`;
      }

      // Navbar fade in
      if (scrollTop > 100) {
        navbar.style.background = 'var(--color-primary)';
        navbar.style.boxShadow = '0 6px 20px rgba(225, 29, 72, 0.2)';
        if (navTitle) {
          navTitle.style.opacity = '1';
          navTitle.style.transform = 'translateY(0)';
          const textEl = navTitle.querySelector('div');
          if (textEl) textEl.style.color = '#ffffff';
        }
        if (navBack) {
          navBack.style.background = 'rgba(255, 255, 255, 0.2)';
          navBack.style.boxShadow = 'none';
          navBack.style.color = '#ffffff';
        }
      } else {
        navbar.style.background = 'transparent';
        navbar.style.boxShadow = 'none';
        if (navTitle) {
          navTitle.style.opacity = '0';
          navTitle.style.transform = 'translateY(4px)';
        }
        if (navBack) {
          navBack.style.background = 'rgba(255, 255, 255, 0.8)';
          navBack.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
          navBack.style.color = '#000000';
        }
      }
    };

    window.addEventListener('scroll', window._comercioScrollHandler, { passive: true, capture: true });
    // Trigger once to set initial state
    window._comercioScrollHandler({ target: document });
  }
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

function renderProducts(products, categoryId, activeOffers = [], sortBy = 'default', searchQuery = '', comercioId = '', isOpen = true, activeBrand = 'all', activeSubCategory = 'all', categories = []) {
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
  displayedCount = 20;

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
        <div class="product-card card-interactive scroll-reveal reveal-fade-up reveal-delay-${Math.min(i + 1, 5)} ${isUnavailable ? 'product-unavailable' : ''}" 
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
            <img src="${p.image || '/logo.png'}" alt="${p.name}" style="width:100%; height:100%; border-radius:14px; object-fit:cover; border:1px solid var(--color-border-light); background:white;" loading="lazy" />
            
            ${offer ? `
              <div style="position:absolute; top:6px; left:6px; background:var(--color-primary); color:white; font-size:9px; font-weight:900; padding:3px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:0.02em; box-shadow:0 3px 8px rgba(225,29,72,0.35); z-index:10; border: 1px solid rgba(255,255,255,0.15); font-family:var(--font-display);">${offer.type === 'percentage' ? `${offer.value}% OFF` : '2x1'}</div>
            ` : ''}
            
            ${!isOpen ? `
              <div style="position:absolute; bottom:6px; right:6px; background:var(--color-text-tertiary); color:white; font-size:9.5px; font-weight:850; padding:4px 10px; border-radius:12px; text-transform:uppercase; letter-spacing:0.05em; z-index:10; border: 1.5px solid white;">Cerrado</div>
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
    }, { threshold: 0.1 });

    infiniteScrollObserver.observe(sentinel);
  };

  setupSentinel();
}

function updateFAB() {
  const container = document.getElementById('cart-fab-container');
  if (!container) return;
  const count = getCartCount();

  if (count > 0) {
    container.innerHTML = `
      <a href="#/cart" class="fab" title="Ver carrito" style="bottom: calc(var(--navbar-height) + 20px + env(safe-area-inset-bottom, 0px)) !important; right: 16px !important;">
        ${icon('cart', 26)}
        <span class="fab-badge">${count}</span>
      </a>
    `;
  } else {
    container.innerHTML = '';
  }
}
