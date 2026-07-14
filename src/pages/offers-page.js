import { db } from '../firebase.js';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { getState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';
import { openProductModal } from '../components/product-modal.js';
import { isShopOpen } from '../utils/format.js';

let allOffersWithProducts = [];
let allCategories = [];
let activeCategory = 'all';
let searchQuery = '';

export async function renderOffersPage(container) {
  if (!container) container = document.getElementById('app-content');

  // Load from cache first for instant layout rendering
  try {
    const cachedCats = localStorage.getItem('gd_cached_offers_categories');
    const cachedOffers = localStorage.getItem('gd_cached_offers_products');
    if (cachedCats) allCategories = JSON.parse(cachedCats);
    if (cachedOffers) allOffersWithProducts = JSON.parse(cachedOffers);
  } catch (e) {
    console.warn('Error reading offers page cache:', e);
  }
  
  // Calculate padding dynamically for iOS/Android native
  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative 
    ? 'var(--status-bar-height, 24px)' 
    : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  container.innerHTML = `
    <div class="offers-page" style="display:flex; flex-direction:column; height:100dvh; overflow:hidden; background:var(--color-bg);">
      <!-- Premium Fixed Header -->
      <div style="width:100%; padding-top: ${topPadding}; background: var(--color-primary); position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1); flex-shrink: 0;">
        <div style="display:flex; align-items:center; gap:12px; padding: 12px 16px 20px 16px; color:white; position:relative; overflow:hidden;">
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          
          <a href="#/" style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.15); color:white; text-decoration:none; position:relative; z-index:2;">
            ${icon('chevronLeft', 24)}
          </a>
          <div>
            <h1 style="font-family:var(--font-display); font-weight:800; font-size:18px; margin:0; line-height:1.2; letter-spacing:-0.01em;">Ofertas y Descuentos</h1>
            <p style="font-size:10px; color:rgba(255,255,255,0.85); font-weight:700; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.5px;">Ahorrá con las mejores promos</p>
          </div>
        </div>
      </div>

      <!-- Filters & Search Area -->
      <div style="padding: 16px 16px 8px 16px; display:flex; flex-direction:column; gap:12px; border-bottom:1px solid var(--color-border-light); flex-shrink: 0; background:var(--color-bg);">
        <!-- Search bar -->
        <div style="position:relative;">
          <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); display:flex; align-items:center;">
            ${icon('search', 18)}
          </span>
          <input type="text" id="offers-search-input" placeholder="Buscar entre las ofertas..." style="width:100%; height:48px; border-radius:16px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px 0 44px; font-weight:700; font-size:14px; color:var(--color-text); outline:none; box-sizing:border-box;" />
        </div>

        <!-- Categories Pill Filter -->
        <div id="offers-categories-pills" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; -webkit-overflow-scrolling:touch; scrollbar-width:none;">
          <!-- Loaded dynamically -->
        </div>
      </div>

      <!-- Scrollable Offers Grid -->
      <div style="flex:1; overflow-y:auto; padding:16px; -webkit-overflow-scrolling:touch;" id="offers-page-scrollable">
        <div id="offers-grid-container" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:16px; max-width:1200px; margin:0 auto; padding-bottom:30px;">
          <!-- Loaded dynamically -->
        </div>
      </div>
    </div>
  `;

  // Bind search event
  const searchInput = document.getElementById('offers-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderFilteredOffers();
    });
  }

  // Load everything
  if (allOffersWithProducts.length > 0) {
    renderCategoriesPills();
    renderFilteredOffers();
    loadPageData(true);
  } else {
    loadPageData(false);
  }
}

async function loadPageData(silent = false) {
  const gridContainer = document.getElementById('offers-grid-container');
  if (!gridContainer) return;

  if (!silent) {
    gridContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:50px; color:var(--color-text-secondary); display:flex; flex-direction:column; align-items:center; gap:12px;">
        <div style="border: 3px solid var(--color-border-light); border-top: 3px solid var(--color-primary); border-radius: 50%; width: 28px; height: 28px; animation: spin 0.8s linear infinite;"></div>
        <span style="font-size:13px; font-weight:750;">Buscando las mejores ofertas...</span>
      </div>
    `;
  }

  try {
    const { collectionGroup } = await import('firebase/firestore');

    // 1. Fetch categories, comercios, active offers, and ALL products in parallel!
    const [catSnap, comSnap, offersSnap, productsSnap] = await Promise.all([
      getDocs(collection(db, 'platformCategories')),
      getDocs(query(collection(db, 'comercios'))),
      getDocs(query(collection(db, 'offers'), where('active', '==', true))),
      getDocs(collectionGroup(db, 'products'))
    ]);

    allCategories = catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(c => c.isActive !== false);
    if (!allCategories.some(c => c.name === 'Comida')) {
      const existingComidas = allCategories.find(c => c.name === 'Comidas');
      if (existingComidas) {
        existingComidas.name = 'Comida';
      } else {
        allCategories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
      }
    }
    allCategories.sort((a, b) => (a.order || 0) - (b.order || 0));

    // Render categories pills immediately
    renderCategoriesPills();

    const comercios = comSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const activeComercios = comercios.filter(c => c.isActive !== false);
    const activeComerciosMap = new Map(activeComercios.map(c => [c.id, c]));

    const rawOffers = offersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Filter offers for active merchants
    const validOffers = rawOffers.filter(o => activeComerciosMap.has(o.comercioId));

    // Create lookup map for products: key = `${comercioId}:${productId}`
    const productsMap = new Map(productsSnap.docs.map(docSnap => {
      const pathParts = docSnap.ref.path.split('/');
      const comercioId = pathParts[1];
      return [`${comercioId}:${docSnap.id}`, { id: docSnap.id, comercioId, ...docSnap.data() }];
    }));

    // 4. Resolve details for each product in-memory (0 network overhead!)
    allOffersWithProducts = [];
    
    validOffers.forEach(o => {
      const parentCom = activeComerciosMap.get(o.comercioId);
      
      if (o.productIds && o.productIds.length > 0) {
        o.productIds.forEach(pId => {
          const product = productsMap.get(`${o.comercioId}:${pId}`);
          if (product && product.isAvailable !== false) {
            const isOutOfStock = product.stockMode === 'limited' && (product.stockQuantity || 0) <= 0;
            if (!isOutOfStock) {
              allOffersWithProducts.push({
                offerId: o.id,
                type: o.type,
                value: o.value,
                comercioId: o.comercioId,
                comercioName: parentCom.name || 'Comercio',
                comercioLogo: parentCom.logo || '',
                comercioCategory: parentCom.category || '',
                comercioOpen: isShopOpen(parentCom.schedules || (parentCom.schedule ? [parentCom.schedule] : []), parentCom.daysOpen),
                product: product
              });
            }
          }
        });
      } else if (o.product) {
        // Direct product payload
        const isOutOfStock = o.product.stockMode === 'limited' && (o.product.stockQuantity || 0) <= 0;
        if (o.product.isAvailable !== false && !isOutOfStock) {
          allOffersWithProducts.push({
            offerId: o.id,
            type: o.type,
            value: o.value,
            comercioId: o.comercioId,
            comercioName: parentCom.name || 'Comercio',
            comercioLogo: parentCom.logo || '',
            comercioCategory: parentCom.category || '',
            comercioOpen: isShopOpen(parentCom.schedules || (parentCom.schedule ? [parentCom.schedule] : []), parentCom.daysOpen),
            product: { id: o.targetProductId || 'unknown', ...o.product }
          });
        }
      }
    });

    // Random shuffle for absolute fairness
    allOffersWithProducts.sort(() => Math.random() - 0.5);

    renderFilteredOffers();

    // Cache results for next instant load
    try {
      localStorage.setItem('gd_cached_offers_categories', JSON.stringify(allCategories));
      localStorage.setItem('gd_cached_offers_products', JSON.stringify(allOffersWithProducts));
    } catch (e) {
      console.warn('Error writing offers cache:', e);
    }

  } catch (err) {
    console.error('Error loading offers page:', err);
    if (gridContainer) {
      gridContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-danger); font-weight:700;">
          Error al cargar los productos en oferta.
        </div>
      `;
    }
  }
}

function renderCategoriesPills() {
  const container = document.getElementById('offers-categories-pills');
  if (!container) return;

  container.innerHTML = `
    <button class="offers-tab-pill ${activeCategory === 'all' ? 'active' : ''}" data-cat="all" style="height:36px; padding:0 16px; border-radius:18px; border:none; background:${activeCategory === 'all' ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${activeCategory === 'all' ? 'white' : 'var(--color-text-secondary)'}; font-weight:800; font-size:12.5px; cursor:pointer; flex-shrink:0; transition:all 0.2s;">Todos</button>
    ${allCategories.map(c => {
      const isActive = activeCategory === c.name;
      return `
        <button class="offers-tab-pill ${isActive ? 'active' : ''}" data-cat="${c.name}" style="height:36px; padding:0 16px; border-radius:18px; border:none; background:${isActive ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${isActive ? 'white' : 'var(--color-text-secondary)'}; font-weight:800; font-size:12.5px; cursor:pointer; flex-shrink:0; transition:all 0.2s; display:flex; align-items:center; gap:6px;">
          <span>${c.icon || '🏷️'}</span>
          <span>${c.name}</span>
        </button>
      `;
    }).join('')}
  `;

  // Bind clicks
  container.querySelectorAll('.offers-tab-pill').forEach(btn => {
    btn.onclick = () => {
      activeCategory = btn.dataset.cat;
      renderCategoriesPills();
      renderFilteredOffers();
    };
  });
}

function renderFilteredOffers() {
  const container = document.getElementById('offers-grid-container');
  if (!container) return;

  let filtered = allOffersWithProducts;

  // 1. Category Filter
  if (activeCategory !== 'all') {
    filtered = filtered.filter(item => item.comercioCategory === activeCategory);
  }

  // 2. Search query filter
  if (searchQuery) {
    filtered = filtered.filter(item => 
      (item.product.name || '').toLowerCase().includes(searchQuery) ||
      (item.product.description || '').toLowerCase().includes(searchQuery) ||
      (item.comercioName || '').toLowerCase().includes(searchQuery)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:60px 20px; border: 1.5px dashed var(--color-border); border-radius: 20px; background:var(--color-surface); opacity:0.75;">
        <div style="font-size:44px; margin-bottom:12px;">🏷️</div>
        <h3 style="font-family:var(--font-display); font-weight:800; margin:0; font-size:16px;">Sin ofertas encontradas</h3>
        <p style="font-size:12px; color:var(--color-text-tertiary); margin:8px 0 0;">Probá cambiando el filtro o término de búsqueda.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const p = item.product;
    const isPercent = item.type === 'percentage';
    const discPercent = isPercent ? (item.value || 0) : 0;
    const promoPrice = isPercent ? p.price * (1 - discPercent / 100) : p.price;
    const isOutOfStock = p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0;
    const isUnavailable = !item.comercioOpen || isOutOfStock;

    return `
      <div class="product-card card-interactive ${isUnavailable ? 'product-unavailable' : ''}" 
           data-id="${p.id}" 
           data-com-id="${item.comercioId}" 
           data-com-name="${item.comercioName}"
           data-open="${item.comercioOpen}"
           style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:24px; overflow:hidden; display:flex; flex-direction:column; box-shadow:var(--shadow-sm); cursor:pointer; transition:all 0.2s;">
        
        <!-- Image & Discount Badge -->
        <div style="position:relative; width:100%; height:160px; background:#f1f5f9; overflow:hidden;">
          <img src="${p.image || '/logo.png'}" alt="${p.name}" style="width:100%; height:100%; object-fit:contain; background:#ffffff; opacity:${isUnavailable ? '0.6' : '1'};" />
          
          <div style="position:absolute; top:12px; left:12px; background:var(--color-primary); color:white; font-weight:900; font-size:11px; padding:4px 10px; border-radius:10px; box-shadow:0 4px 10px rgba(225,29,72,0.25); text-transform:uppercase; font-family:var(--font-display);">
            ${isPercent ? `${item.value}% OFF` : '2x1'}
          </div>

          <!-- Merchant Tag overlay -->
          <div style="position:absolute; bottom:12px; left:12px; right:12px; background:rgba(225, 29, 72, 0.78); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); padding:6px 10px; border-radius:12px; display:flex; align-items:center; gap:8px; border:1px solid rgba(255, 255, 255, 0.15); box-shadow:0 4px 12px rgba(225, 29, 72, 0.15);">
            ${item.comercioLogo ? `<img src="${item.comercioLogo}" style="width:20px; height:20px; border-radius:50%; object-fit:cover;" />` : ''}
            <span style="font-size:11px; font-weight:900; color:white; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.comercioName}</span>
          </div>

          ${!item.comercioOpen ? `
            <div style="position:absolute; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; color:white; font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; font-family:var(--font-display);">Cerrado</div>
          ` : (isOutOfStock ? `
            <div style="position:absolute; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; color:white; font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; font-family:var(--font-display);">Sin Stock</div>
          ` : '')}
        </div>

        <!-- Product description -->
        <div style="padding:14px; display:flex; flex-direction:column; justify-content:space-between; flex:1; text-align:left;">
          <div>
            <h4 style="font-family:var(--font-display); font-size:14.5px; font-weight:800; color:var(--color-text); margin:0; line-height:1.25;">${p.name}</h4>
            ${p.description ? `<p style="font-size:11.5px; color:var(--color-text-secondary); margin:6px 0 0; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${p.description}</p>` : ''}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; border-top:1px solid var(--color-border-light); padding-top:12px;">
            <div style="display:flex; align-items:baseline; gap:6px;">
              <span style="font-family:var(--font-display); font-size:17px; font-weight:900; color:var(--color-primary);">${formatPrice(promoPrice)}</span>
              <span style="font-size:12px; color:var(--color-text-tertiary); text-decoration:line-through; font-weight:700;">${formatPrice(p.price)}</span>
            </div>
            
            <button class="offers-add-btn" style="width:32px; height:32px; border-radius:50%; border:none; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 4px 10px rgba(225,29,72,0.2);">
              ${icon('plus', 16)}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind click event to open details modal
  container.querySelectorAll('.product-card').forEach(card => {
    card.onclick = async (e) => {
      if (card.classList.contains('product-unavailable')) return;

      const pId = card.dataset.id;
      const comId = card.dataset.comId;
      const comName = card.dataset.comName;
      const isOpen = card.dataset.open === 'true';

      const matchedOffer = allOffersWithProducts.find(item => item.product.id === pId && item.comercioId === comId);
      if (!matchedOffer) return;

      openProductModal(matchedOffer.product, comId, comName, isOpen);
    };
  });
}
