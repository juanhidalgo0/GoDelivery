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

  if (comercio && (comercio.name || '').toLowerCase().includes('go!') && (comercio.name || '').toLowerCase().includes('market')) {
    comercio.logo = '/logo.png';
  }

  if (!comercio) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('store', 40)}</div><div class="empty-state-title">Comercio no encontrado</div><button class="btn btn-primary" onclick="location.hash='/#'">Volver</button></div>`;
    return;
  }

  const resolvedComercioId = comercio.id;

  // Proactive fee calculation
  import('./cart.js').then(m => m.calculateAllFees && m.calculateAllFees(resolvedComercioId));

  // Skeleton
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

  // If cache exists, do a zero-ms instant render first!
  if (cachedData) {
    const { categories, products, activeOffers } = cachedData;
    setState('activeOffers', activeOffers);
    setState('currentProducts', products);
    renderPage(comercio, categories, products, activeCategory, activeOffers, activeSort);
    
    // Trigger deep-link product modal if parameter exists in URL
    try {
      const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const targetProductId = urlParams.get('product') || urlParams.get('p');
      if (targetProductId) {
        const targetProd = products.find(p => p.id === targetProductId);
        if (targetProd && targetProd.isAvailable !== false && !(targetProd.stockMode === 'limited' && (targetProd.stockQuantity || 0) <= 0)) {
          const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []));
          setTimeout(() => {
            openProductModal(targetProd, resolvedComercioId, comercio.name, isOpen);
          }, 300);
        }
      }
    } catch (e) {}
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
        q = query(collection(db, 'comercios', resolvedComercioId, 'products'), limit(50));
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
      const cacheStr = JSON.stringify(cachedData);
      const freshStr = JSON.stringify({ comercio, categories, products, activeOffers });
      if (cacheStr === freshStr) {
        shouldRender = false; // No changes, no flashing!
      }
    }

    if (shouldRender) {
      renderPage(comercio, categories, products, activeCategory, activeOffers, activeSort);
    }

    // Deep link product modal trigger (only if it wasn't triggered by cache or cache didn't exist)
    if (!cachedData) {
      try {
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
        const targetProductId = urlParams.get('product') || urlParams.get('p');
        if (targetProductId) {
          const targetProd = products.find(p => p.id === targetProductId);
          if (targetProd && targetProd.isAvailable !== false && !(targetProd.stockMode === 'limited' && (targetProd.stockQuantity || 0) <= 0)) {
            const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []));
            setTimeout(() => {
              openProductModal(targetProd, resolvedComercioId, comercio.name, isOpen);
            }, 300);
          }
        }
      } catch (e) {
        console.warn('Failed parsing deep-link parameters', e);
      }
    }

    // Category filter handler
    document.getElementById('comercio-categories')?.addEventListener('click', async (e) => {
      const pill = e.target.closest('.tab-pill');
      if (!pill) return;
      activeCategory = pill.dataset.catId;

      document.querySelectorAll('#comercio-categories .tab-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      const grid = document.getElementById('comercio-products');
      const hasLoadedCategory = (catId) => {
        if (catId === 'all') return true;
        if (catId === 'discounts') return products.some(p => activeOffers.some(o => o.productIds && o.productIds.includes(p.id)));
        if (catId === 'favorites') return true;
        return products.some(p => p.categoryId === catId);
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
          const catProducts = await loadCategoryProducts(activeCategory);
          catProducts.forEach(cp => {
            if (!products.some(p => p.id === cp.id)) {
              products.push(cp);
            }
          });
          setState('currentProducts', products);
        } catch (err) {
          console.error('Error loading category products:', err);
        }
      }

      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch);
    });

    // Sort filter handler
    document.getElementById('comercio-sort-select')?.addEventListener('change', (e) => {
      activeSort = e.target.value;
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch);
    });

    // Search input handler
    document.getElementById('comercio-product-search')?.addEventListener('input', (e) => {
      activeSearch = e.target.value.trim().toLowerCase();
      const clearBtn = document.getElementById('clear-search-btn');
      if (clearBtn) {
        clearBtn.style.display = activeSearch ? 'flex' : 'none';
      }
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch);
    });

    document.getElementById('clear-search-btn')?.addEventListener('click', () => {
      const input = document.getElementById('comercio-product-search');
      if (input) input.value = '';
      activeSearch = '';
      const clearBtn = document.getElementById('clear-search-btn');
      if (clearBtn) clearBtn.style.display = 'none';
      renderProducts(products, activeCategory, activeOffers, activeSort, activeSearch);
    });

    // Product interaction handler (Delegated to container)
    const productsContainer = document.getElementById('comercio-products');
    if (productsContainer) {
      productsContainer.onclick = (e) => {
        const isOpen = isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : []));
        if (!isOpen) {
          showToast('El comercio está cerrado. No se pueden agregar productos al carrito.', 'warning');
          return;
        }

        const card = e.target.closest('.product-card');
        const addBtn = e.target.closest('.product-card-add');

        if (!card) return;

        const productId = card.dataset.productId;
        const product = products.find(p => p.id === productId);

        if (!product || product.isAvailable === false || (product.stockMode === 'limited' && (product.stockQuantity || 0) <= 0)) return;

        // If quick-add button clicked AND product has no required options/extras
        const hasOptions = product.optionsGroups && product.optionsGroups.length > 0;

        if (addBtn && !hasOptions) {
          e.preventDefault();
          e.stopPropagation();

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
          const originalIcon = addBtn.innerHTML;
          addBtn.innerHTML = icon('check', 18);
          setTimeout(() => {
            addBtn.classList.remove('success');
            addBtn.innerHTML = originalIcon;
          }, 1500);

          renderNavbar();
          updateFAB();
          return;
        }

        // Open modal for anything else (card click or button on complex products)
        openProductModal(product, resolvedComercioId, comercio.name);
      };
    }

  } catch (e) {
    console.error('Error loading comercio:', e);
    content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('alertTriangle', 40)}</div><div class="empty-state-title">Error al cargar</div></div>`;
  }

  // Cart FAB subscription
  const unsub = subscribe('cart', () => updateFAB());
  return { cleanup: unsub };
}

function renderPage(comercio, categories, products, activeCategory, activeOffers = [], activeSort = 'default') {
  const content = document.getElementById('app-content');

  const hasDiscounts = activeOffers.length > 0;

  content.innerHTML = `
    <div class="comercio-page">
      <div class="comercio-header">
        ${comercio.banner ? `<img src="${comercio.banner}" alt="${comercio.name}" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 60)}</div>`}
        <div class="comercio-header-overlay"></div>
        <button class="comercio-header-back" onclick="history.back()">${icon('back', 20)}</button>
      </div>
      
      <div class="comercio-info">
        <div class="comercio-info-card">
          <div class="comercio-info-top">
            ${comercio.logo
      ? `<img src="${comercio.logo}" alt="" class="comercio-detail-logo" />`
      : `<div class="comercio-detail-logo" style="display:flex;align-items:center;justify-content:center;background:var(--color-primary-light);">${icon('store', 28)}</div>`
    }
            <div class="comercio-info-text">
              <h1>${comercio.name}</h1>
              <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;">
                <span class="badge badge-primary comercio-category-badge">${comercio.category || 'Comercio'}</span>
                <span class="badge ${isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : [])) ? 'badge-success' : 'badge-danger'}">
                  ${isShopOpen(comercio.schedules || (comercio.schedule ? [comercio.schedule] : [])) ? 'Abierto' : 'Cerrado'}
                </span>
                <button id="rate-comercio-btn" style="background:rgba(255,193,7,0.1); border:1px solid rgba(255,193,7,0.3); border-radius:10px; padding:3px 8px; display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:800; color:#FFC107; cursor:pointer; transition:all 0.2s; outline:none;">
                  ⭐ ${comercio.ratingAverage !== undefined && comercio.ratingAverage > 0 ? `${comercio.ratingAverage.toFixed(1)} (${comercio.ratingCount || 0})` : 'Puntuar'}
                </button>
              </div>
            </div>

          </div>
          ${comercio.description ? `<p class="comercio-description">${comercio.description}</p>` : ''}
          <div class="comercio-info-meta">
            ${comercio.address ? `
              <div class="meta-row">
                <span class="meta-icon">${icon('mapPin', 16)}</span>
                <span class="meta-text">${comercio.address}</span>
              </div>
            ` : ''}
            
            ${(comercio.schedules && comercio.schedules.length > 0) || comercio.schedule ? `
              <div class="meta-row">
                <span class="meta-icon">${icon('clock', 16)}</span>
                <span class="meta-text">
                  ${comercio.schedules && comercio.schedules.length > 0
        ? comercio.schedules.map(s => `${s.open} - ${s.close}`).join(', ')
        : `${comercio.schedule.open} - ${comercio.schedule.close}`
      }
                </span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>


      <div class="comercio-products">
        <!-- Search bar -->
        <div class="comercio-search-container" style="padding: 0 var(--space-4); margin-bottom: var(--space-3);">
          <div style="position:relative; width: 100%; display:flex; align-items:center; background:var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius:16px; padding:0 16px; height:46px; box-shadow:var(--shadow-xs); transition: all 0.2s;">
            <span style="color:var(--color-text-tertiary); display:flex; align-items:center; justify-content:center; margin-right:10px;">${icon('search', 18)}</span>
            <input type="text" id="comercio-product-search" placeholder="Buscar productos..." style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none;" />
            <button id="clear-search-btn" style="background:none; border:none; color:var(--color-text-tertiary); display:none; align-items:center; justify-content:center; cursor:pointer; padding:4px;">${icon('xCircle', 16)}</button>
          </div>
        </div>

        <div class="tab-pills" id="comercio-categories" style="margin-bottom:var(--space-3); padding-left: var(--space-4); padding-right: var(--space-4);">
          <button class="tab-pill active" data-cat-id="all">Todos</button>
          <button class="tab-pill" data-cat-id="favorites" style="display:inline-flex; align-items:center; gap:6px;">
            <span style="display:inline-flex; align-items:center; transform:translateY(0.5px);">${icon('heart', 12, 'fav-active')}</span> Favoritos
          </button>
          ${hasDiscounts ? `
            <button class="tab-pill" data-cat-id="discounts" style="display:inline-flex; align-items:center; gap:6px;">
              <span style="display:inline-flex; align-items:center; transform:translateY(0.5px); color:var(--color-primary);">${icon('tag', 12)}</span> Descuentos
            </button>
          ` : ''}
          ${categories.map(c => `<button class="tab-pill" data-cat-id="${c.id}">${c.name}</button>`).join('')}
        </div>

        <div class="comercio-sort-container" style="padding: 0 var(--space-4); margin-bottom: var(--space-3); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border-light); padding-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px;">
            <span style="color: var(--color-text-tertiary); display: inline-flex;">${icon('sliders', 14)}</span> Ordenar por:
          </div>
          <select id="comercio-sort-select" style="border: 1px solid var(--color-border-light); background: var(--color-surface); color: var(--color-text); border-radius: 12px; padding: 6px 12px; font-size: 12px; font-weight: 700; outline: none; cursor: pointer; box-shadow: var(--shadow-xs); transition: all 0.2s;">
            <option value="default" ${activeSort === 'default' ? 'selected' : ''}>Recomendados</option>
            <option value="price-asc" ${activeSort === 'price-asc' ? 'selected' : ''}>Menor precio</option>
            <option value="price-desc" ${activeSort === 'price-desc' ? 'selected' : ''}>Mayor precio</option>
            <option value="sales-desc" ${activeSort === 'sales-desc' ? 'selected' : ''}>Más vendido</option>
            <option value="sales-asc" ${activeSort === 'sales-asc' ? 'selected' : ''}>Menos vendido</option>
          </select>
        </div>

        <div class="products-grid" id="comercio-products">
        </div>
      </div>

      <!-- Cart FAB -->
      <div id="cart-fab-container"></div>
      
      ${getFooterHTML()}
    </div>
  `;

  renderProducts(products, activeCategory, activeOffers, activeSort);
  updateFAB();

  // Bind rating button click
  document.getElementById('rate-comercio-btn')?.addEventListener('click', () => {
    openRatingModal(comercio);
  });
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

function renderProducts(products, categoryId, activeOffers = [], sortBy = 'default', searchQuery = '') {
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
    filtered = products.filter(p => p.categoryId === categoryId);
  }

  // Search filter
  if (searchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery));
  }

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
    return batch.map((p, i) => {
      const offer = activeOffers.find(o => o.productIds && o.productIds.includes(p.id));
      const isOutOfStock = p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0;
      const isUnavailable = p.isAvailable === false || isOutOfStock;

      return `
        <div class="product-card card-interactive page-enter stagger-${Math.min(i + 1, 6)} ${isUnavailable ? 'product-unavailable' : ''}" 
             data-product-id="${p.id}"
             style="position:relative; display:flex; justify-content:space-between; gap:16px; padding:16px; background:var(--color-surface); border-radius:20px; border:1px solid var(--color-border-light); box-shadow:var(--shadow-xs); transition:all 0.2s ease;">
          
          <!-- Left side: Text Details -->
          <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; min-width:0;">
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:800; color:var(--color-text); margin-bottom:4px; line-height:1.2;">${p.name}</div>
              ${p.description ? `<div style="font-size:12px; color:var(--color-text-secondary); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:8px;">${p.description}</div>` : ''}
            </div>
            <div>
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
            
            ${!isUnavailable ? `
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
      <a href="#/cart" class="fab" title="Ver carrito">
        ${icon('cart', 26)}
        <span class="fab-badge">${count}</span>
      </a>
    `;
  } else {
    container.innerHTML = '';
  }
}
