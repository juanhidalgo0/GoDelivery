// GoDelivery — Home Page
import { db } from '../firebase.js';
import { collection, getDocs, query, where, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { formatPrice, isShopOpen, formatDeliveryTime } from '../utils/format.js';
import { getFooterHTML } from '../components/footer.js';
import { isAdmin, isSuperAdmin, isComercio, isLoggedIn } from '../auth.js';
import { icon, categoryIcon, CATEGORY_ICON_MAP, CATEGORY_PHOSPHOR_MAP } from '../utils/icons.js';
import { getState, subscribe } from '../state.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';



export async function renderHome(content) {
  if (!content) content = document.getElementById('page-home') || document.getElementById('app-content');
  if (!content) return;

  const loggedIn = isLoggedIn();

  content.innerHTML = `
    <div class="home-page" style="padding-top: 8px; position: relative; overflow: hidden;">
      <!-- Ambient Background Blobs (Soft Glows) -->
      <div class="home-blob home-blob-1"></div>
      <div class="home-blob home-blob-2"></div>
           <!-- Quick Services Row (GoFavor & Pedir Viaje) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px 16px 0; margin-bottom: 4px;">
        <!-- GoFavor Quick Card -->
        <a href="#/gofavores" class="glow-hover spring-hover" style="background: linear-gradient(135deg, #FF2E55 0%, #E10036 100%); border-radius: 18px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; height: 68px; box-shadow: 0 8px 20px rgba(225, 0, 54, 0.18); text-decoration: none; position: relative; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.15); cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-sizing: border-box;">
          <!-- Ambient light reflection -->
          <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
          <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
            ${icon('package', 18)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left; z-index: 2; display: flex; flex-direction: column; justify-content: center;">
            <h4 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 950; color: white; margin: 0; letter-spacing: -0.02em; line-height: 1.15; text-shadow: 0 1px 2px rgba(0,0,0,0.12);">GoFavor</h4>
            <span style="font-size: 9.5px; color: rgba(255, 255, 255, 0.9); font-weight: 800; letter-spacing: -0.01em; margin-top: 1px; display: block; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">Mandados y envíos</span>
          </div>
        </a>

        <!-- Pedir Viaje Quick Card -->
        <a href="#/viajes" class="glow-hover spring-hover" style="background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%); border-radius: 18px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; height: 68px; box-shadow: 0 8px 20px rgba(37, 99, 235, 0.18); text-decoration: none; position: relative; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.15); cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-sizing: border-box;">
          <!-- Ambient light reflection -->
          <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
          <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
            ${icon('car', 18)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left; z-index: 2; display: flex; flex-direction: column; justify-content: center;">
            <h4 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 950; color: white; margin: 0; letter-spacing: -0.02em; line-height: 1.15; text-shadow: 0 1px 2px rgba(0,0,0,0.12);">Pedir Viaje</h4>
            <span style="font-size: 9.5px; color: rgba(255, 255, 255, 0.9); font-weight: 800; letter-spacing: -0.01em; margin-top: 1px; display: block; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">Viajá seguro y cómodo</span>
          </div>
        </a>
      </div>
 
       <!-- Premium Category Grid (Comida & GoMarket) -->
       <div class="category-grid" style="margin-top: 10px; margin-bottom: 14px;">
         <a href="#/category/Comida" class="category-card-large glow-hover spring-hover">
           <div style="position: absolute; top: 12px; left: 12px; background: rgba(225, 29, 72, 0.9); backdrop-filter: blur(4px); color: white; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 900; z-index: 2; box-shadow: var(--shadow-sm); text-transform: uppercase;">
             Tus antojos, rápido
           </div>
           <img src="/images/categories/restaurants.png" alt="Comida" />
           <span class="card-title">Comida</span>
         </a>
         <a href="#/category/GoMarket" id="gomarket-card" class="category-card-large glow-hover spring-hover">
           <div style="position: absolute; top: 12px; left: 12px; background: rgba(13, 148, 136, 0.9); backdrop-filter: blur(4px); color: white; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 900; z-index: 2; box-shadow: var(--shadow-sm); text-transform: uppercase;">
             Tu súper en minutos
           </div>
           <img src="/images/categories/gomarket.png" alt="GoMarket" />
           <span class="card-title">GoMarket</span>
         </a>
       </div>
       
       <!-- Small Categories Slider Section -->
       <div class="categories-slider-wrapper" style="position: relative; margin-top: 2px; display: flex; align-items: center; width: 100%;">
         <button id="cat-prev-btn" class="categories-arrow-btn prev-btn" style="display: none; position: absolute; left: 4px; z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
           ${icon('chevronLeft', 20)}
         </button>
         <div class="category-row-small" id="categories-row-small" style="flex: 1; display: flex; gap: 12px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; -ms-overflow-style: none; padding: 6px 16px 12px;">
           <div class="category-card-small skeleton" style="min-width:110px; height:140px;"></div>
           <div class="category-card-small skeleton" style="min-width:110px; height:140px;"></div>
           <div class="category-card-small skeleton" style="min-width:110px; height:140px;"></div>
           <div class="category-card-small skeleton" style="min-width:110px; height:140px;"></div>
           <div class="category-card-small skeleton" style="min-width:110px; height:140px;"></div>
           <div class="category-card-small skeleton" style="min-width:110px; height:140px;"></div>
         </div>
         <button id="cat-next-btn" class="categories-arrow-btn next-btn" style="display: none; position: absolute; right: 4px; z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
           ${icon('chevronRight', 20)}
         </button>
       </div>
 
       <!-- Brands Slider -->
       <div id="brands-slider-container" style="margin-top: 2px; margin-bottom: 14px;"></div>
 
       <!-- Random Products Slider -->
       <div id="random-products-slider-container" style="margin-top: 2px; margin-bottom: 14px;"></div>
 
       <!-- Promoted Section -->
      <div id="promoted-section" style="margin-top: 2px; margin-bottom: 14px;"></div>

      <!-- Offers Section -->
      <div id="offers-section" style="margin-top: 2px; margin-bottom: 14px;"></div>



      <!-- Main Content -->
      <div class="home-section" style="margin-top: 18px; padding-top: 8px;">
        <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; padding: 0 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <h2 class="home-section-title" style="display:flex; align-items:center; gap:10px; font-size:16px; font-weight:950; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-primary); margin:0;">
              <span style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:10px; background:rgba(225, 29, 72, 0.08); color:var(--color-primary);">${icon('store', 16)}</span> Todos los comercios
            </h2>
            <a href="#/category/Todos" style="font-size:12px; font-weight:800; color:var(--color-primary); text-decoration:none; display:flex; align-items:center; gap:4px; padding:4px 8px; border-radius:8px; background:rgba(225,29,72,0.05); transition:all 0.2s;">Ver todos &rarr;</a>
          </div>
          
          <!-- Interactive Filter Pills Row (PedidosYa Style) -->
          <div class="filter-pills-row" style="display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; padding-bottom: 4px; -webkit-overflow-scrolling: touch;">
            <button id="filter-btn-open" class="filter-pill-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; font-size: 12px; font-weight: 800; border: 1.5px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s; white-space: nowrap; outline: none;">
              🟢 Abiertos ahora
            </button>
            <button id="filter-btn-shipping" class="filter-pill-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; font-size: 12px; font-weight: 800; border: 1.5px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s; white-space: nowrap; outline: none;">
              🛵 Envío Gratis
            </button>
            <button id="filter-btn-rating" class="filter-pill-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; font-size: 12px; font-weight: 800; border: 1.5px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s; white-space: nowrap; outline: none;">
              ★ Más valorados (+4.5)
            </button>
          </div>
        </div>
        
        <div class="comercios-slider-wrapper">
          <button id="com-prev-btn" class="categories-arrow-btn prev-btn" style="display: none; position: absolute; left: 4px; top: calc(50% - 21px); z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            ${icon('chevronLeft', 20)}
          </button>
          <div class="comercios-slider" id="comercios-grid">
            ${renderSkeletonCards(4)}
          </div>
          <button id="com-next-btn" class="categories-arrow-btn next-btn" style="display: none; position: absolute; right: 4px; top: calc(50% - 21px); z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            ${icon('chevronRight', 20)}
          </button>
        </div>
      </div>

      <!-- Suggestion & Bug Report Banner Section -->
      <div id="bug-report-banner" style="margin: 12px 16px 0; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 16px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: var(--shadow-xs);">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
          <span style="color: var(--color-primary); display: flex; flex-shrink: 0;">${icon('info', 16)}</span>
          <span style="font-size: 11.5px; font-weight: 750; color: var(--color-text-secondary); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">¿Sugerencias o algún error en la app?</span>
        </div>
        <button id="report-bug-btn" style="height: 28px; border-radius: 8px; font-size: 11px; font-weight: 900; padding: 0 10px; background: rgba(225, 29, 72, 0.08); color: var(--color-primary); display: flex; align-items: center; gap: 4px; border: none; cursor: pointer; transition: all 0.2s; white-space: nowrap; flex-shrink: 0;">
          ${icon('send', 10, '', 'var(--color-primary)')} Reportar
        </button>
      </div>
      
      ${getFooterHTML()}
    </div>
  `;

  // Filters state
  const currentFilters = { openOnly: false, freeShippingOnly: false, topRatedOnly: false };

  // Load data
  let categories = [];
  let comercios = [];
  let offers = [];
  let activeCategory = 'Todos';
  let unsubComercios = null;

  try {
    // Load platform categories (TTL = 1 hour / 3600000 ms)
    const catSnap = await getDocsOptimized(query(collection(db, 'platformCategories'), orderBy('order')), 'platformCategories', 3600000);
    categories = catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(c => c.isActive !== false);

    // Ensure "Comida" is always available even if not in DB
    if (!categories.some(c => c.name === 'Comida')) {
      const existingComidas = categories.find(c => c.name === 'Comidas');
      if (existingComidas) {
        existingComidas.name = 'Comida';
      } else {
        categories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
      }
    }

    // Load active offers (TTL = 5 minutes / 300000 ms)
    const offersSnap = await getDocsOptimized(query(collection(db, 'offers'), where('active', '==', true)), 'activeOffers', 300000);
    offers = offersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Fetch product details for offers in parallel
    offers = await Promise.all(offers.map(async (o) => {
      if (o.productIds && o.productIds.length > 0) {
        try {
          const pSnap = await getDoc(doc(db, 'comercios', o.comercioId, 'products', o.productIds[0]));
          if (pSnap.exists()) {
            o.product = { id: pSnap.id, ...pSnap.data() };
          }
        } catch (e) {
          console.warn('Error loading product details for offer:', o.id, e);
        }
      }
      return o;
    }));

    // Add GoMarket to categories if it exists as a concept
    if (!categories.some(c => c.name === 'GoMarket')) {
      categories.push({ id: 'gomarket', name: 'GoMarket', icon: 'shoppingBag', order: 0 });
    }

    // Set up real-time listener for active comercios
    unsubComercios = onSnapshot(query(collection(db, 'comercios'), where('isActive', '==', true)), async (comSnap) => {
      comercios = comSnap.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, ...data };
      });

      // Render brands slider
      renderBrandsSlider(comercios);

      // Render random products slider
      renderRandomProductsSlider(comercios);

      // Render promoted section (Ads)
      renderPromotedSection(comercios);

      renderOffersSection(offers, comercios);

      // Render categories
      renderCategories(categories, activeCategory);
      
      // Render list of comercios
      const searchVal = document.getElementById('header-search')?.value || '';
      renderComercios(comercios, activeCategory, searchVal, currentFilters);

      // Dynamic link and banner for GoMarket
      try {
        const goMarket = comercios.find(c => {
          const n = (c.name || '').toLowerCase();
          return n.includes('go!') && n.includes('market');
        });
        if (goMarket) {
          const goMarketCard = content.querySelector('#gomarket-card');
          if (goMarketCard) {
            goMarketCard.href = `#/comercio/${goMarket.id}`;
          }
        }
      } catch (err) {
        console.warn('Error linking GoMarket:', err);
      }
    });

  } catch (e) {
    console.error('Error loading home data:', e);
    // Use default categories as fallback
    if (categories.length === 0) {
      const defaultNames = ['Súper', 'Farmacia', 'Kiosco', 'Almacén', 'Carnicería', 'Verdulería', 'Librería', 'Ferretería', 'Mascotas'];
      categories = defaultNames.map((name, i) => ({ id: name, name, icon: '', order: i }));
    }
    renderCategories(categories, activeCategory);
  }



  // Dynamic link for GoMarket
  try {
    const goMarket = comercios.find(c => {
      const n = (c.name || '').toLowerCase();
      return n.includes('go!') && n.includes('market');
    });
    if (goMarket) {
      const goMarketCard = content.querySelector('#gomarket-card');
      if (goMarketCard) {
        goMarketCard.href = `#/comercio/${goMarket.id}`;
      }
    }
  } catch (err) {
    console.warn('Error linking GoMarket:', err);
  }



  // Search handler (Global Header Search)
  const searchInput = document.getElementById('header-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderComercios(comercios, activeCategory, e.target.value, currentFilters);
    });
  }

  // Interactive Filter Pills Handler
  const filterOpenBtn = document.getElementById('filter-btn-open');
  const filterShippingBtn = document.getElementById('filter-btn-shipping');
  const filterRatingBtn = document.getElementById('filter-btn-rating');

  const updateFilterStyles = () => {
    if (filterOpenBtn) {
      filterOpenBtn.style.background = currentFilters.openOnly ? 'var(--color-primary)' : 'var(--color-surface)';
      filterOpenBtn.style.color = currentFilters.openOnly ? 'white' : 'var(--color-text-secondary)';
      filterOpenBtn.style.borderColor = currentFilters.openOnly ? 'var(--color-primary)' : 'var(--color-border)';
    }
    if (filterShippingBtn) {
      filterShippingBtn.style.background = currentFilters.freeShippingOnly ? 'var(--color-primary)' : 'var(--color-surface)';
      filterShippingBtn.style.color = currentFilters.freeShippingOnly ? 'white' : 'var(--color-text-secondary)';
      filterShippingBtn.style.borderColor = currentFilters.freeShippingOnly ? 'var(--color-primary)' : 'var(--color-border)';
    }
    if (filterRatingBtn) {
      filterRatingBtn.style.background = currentFilters.topRatedOnly ? 'var(--color-primary)' : 'var(--color-surface)';
      filterRatingBtn.style.color = currentFilters.topRatedOnly ? 'white' : 'var(--color-text-secondary)';
      filterRatingBtn.style.borderColor = currentFilters.topRatedOnly ? 'var(--color-primary)' : 'var(--color-border)';
    }
  };

  if (filterOpenBtn) {
    filterOpenBtn.onclick = (e) => {
      e.preventDefault();
      currentFilters.openOnly = !currentFilters.openOnly;
      updateFilterStyles();
      renderComercios(comercios, activeCategory, searchInput?.value || '', currentFilters);
    };
  }
  if (filterShippingBtn) {
    filterShippingBtn.onclick = (e) => {
      e.preventDefault();
      currentFilters.freeShippingOnly = !currentFilters.freeShippingOnly;
      updateFilterStyles();
      renderComercios(comercios, activeCategory, searchInput?.value || '', currentFilters);
    };
  }
  if (filterRatingBtn) {
    filterRatingBtn.onclick = (e) => {
      e.preventDefault();
      currentFilters.topRatedOnly = !currentFilters.topRatedOnly;
      updateFilterStyles();
      renderComercios(comercios, activeCategory, searchInput?.value || '', currentFilters);
    };
  }

  // Bug Report button handler
  const reportBugBtn = document.getElementById('report-bug-btn');
  if (reportBugBtn) {
    reportBugBtn.addEventListener('click', async () => {
      const user = getState().user;
      if (!user) {
        const { showToast } = await import('../components/toast.js');
        showToast('Iniciá sesión para reportar un error.', 'warning');
        return;
      }
      showBugReportModal();
    });
  }

  return {
    cleanup: () => {
      if (unsubComercios) unsubComercios();
    }
  };
}

function renderBrandsSlider(comercios) {
  const container = document.getElementById('brands-slider-container');
  if (!container) return;

  // Filter only comercios that have a logo and are distinct by name
  const brands = [];
  const names = new Set();
  
  comercios.forEach(c => {
    if (c.logo && !names.has(c.name)) {
      brands.push(c);
      names.add(c.name);
    }
  });

  if (brands.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Shuffle brands randomly every hour using deterministic seed
  const hourSeed = new Date().getFullYear() + '-' + new Date().getMonth() + '-' + new Date().getDate() + '-' + new Date().getHours();
  const seedHash = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  };
  brands.sort((a, b) => seedHash(a.id + '-' + hourSeed) - seedHash(b.id + '-' + hourSeed));

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 2px;">
      <h3 style="font-family: var(--font-display); font-size: 15px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-primary); margin: 0;">Marcas destacadas</h3>
      <span style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 600;">Los locales más elegidos por la comunidad</span>
    </div>
    <div style="overflow-x: auto; display: flex; gap: 14px; padding: 6px 16px 12px; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none;">
      ${brands.map(brand => `
        <a href="#/comercio/${brand.id}" style="flex: 0 0 64px; text-decoration: none; display: flex; flex-direction: column; align-items: center; gap: 6px;">
          <div style="width: 64px; height: 64px; border-radius: 50%; overflow: hidden; background: white; border: 1px solid var(--color-border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;">
            <img src="${brand.logo}" alt="${brand.name}" style="width: 78%; height: 78%; object-fit: contain; border-radius: 50%;" />
          </div>
          <span style="font-size: 10.5px; font-weight: 750; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 68px; text-align: center;">${brand.name}</span>
        </a>
      `).join('')}
    </div>
    <style>
      #brands-slider-container div::-webkit-scrollbar { display: none; }
      #brands-slider-container div a:active { transform: scale(0.92); }
    </style>
  `;
}

async function renderPromotedSection(comercios) {
  const container = document.getElementById('promoted-section');
  if (!container) return;

  const now = new Date();

  // 1. Fetch active custom ads in parallel (TTL = 5 minutes / 300000 ms)
  let customAds = [];
  try {
    const customAdsSnap = await getDocsOptimized(query(collection(db, 'customAds'), where('active', '==', true)), 'activeCustomAds', 300000);
    customAds = customAdsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error('Error fetching custom ads:', e);
  }

  // 2. Filter shop promotions
  let shopPromotions = comercios.filter(c => {
    if (!c.promotion || !c.promotion.active) return false;
    if (c.promotion.isPaid === false) return false;

    const start = c.promotion.startDate?.toDate ? c.promotion.startDate.toDate() : (c.promotion.startDate ? new Date(c.promotion.startDate) : null);
    const end = c.promotion.endDate?.toDate ? c.promotion.endDate.toDate() : (c.promotion.endDate ? new Date(c.promotion.endDate) : null);

    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  });

  // 3. Filter custom ads
  let activeCustomAds = customAds.filter(ad => {
    const start = ad.startDate?.toDate ? ad.startDate.toDate() : (ad.startDate ? new Date(ad.startDate) : null);
    const end = ad.endDate?.toDate ? ad.endDate.toDate() : (ad.endDate ? new Date(ad.endDate) : null);

    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  });

  // 4. Normalize both lists into a unified standardized format
  let unifiedPromoted = [];

  // Add shop promotions
  shopPromotions.forEach(p => {
    unifiedPromoted.push({
      id: p.id,
      isCustom: false,
      name: p.name,
      banner: p.promotion.banner || p.banner,
      label: p.promotion.label || 'Anuncio',
      link: `#/comercio/${p.id}`,
      logo: p.logo,
      rating: p.rating || '4.8',
      deliveryTime: p.deliveryTime || '20-35 min',
      deliveryFee: p.deliveryFee || 0,
      isPriority: p.promotion.isPriority === true
    });
  });

  // Find GoMarket logo dynamically from Firestore
  const gmCom = comercios.find(c => {
    const n = (c.name || '').toLowerCase();
    return n.includes('go!') && n.includes('market');
  });
  const gmLogo = gmCom ? gmCom.logo : '/logo.png';

  // Add custom ads
  activeCustomAds.forEach(ad => {
    unifiedPromoted.push({
      id: ad.id,
      isCustom: true,
      name: ad.title || 'Anuncio Especial',
      banner: ad.banner,
      label: ad.label || 'Oficial',
      link: ad.link || '',
      logo: gmLogo,
      rating: null,
      deliveryTime: null,
      deliveryFee: null,
      isPriority: ad.isPriority === true
    });
  });

  // MOCK DATA for visual confirmation if completely empty and shops exist
  if (unifiedPromoted.length === 0 && comercios.length > 0) {
    const fallbackComer = comercios[0];
    unifiedPromoted.push({
      id: fallbackComer.id,
      isCustom: false,
      name: fallbackComer.name,
      banner: fallbackComer.banner,
      label: 'Promoción Especial',
      link: `#/comercio/${fallbackComer.id}`,
      logo: fallbackComer.logo,
      rating: fallbackComer.rating || '4.8',
      deliveryTime: fallbackComer.deliveryTime || '20-35 min',
      deliveryFee: fallbackComer.deliveryFee || 0,
      isPriority: false
    });
  }

  if (unifiedPromoted.length === 0) {
    container.style.display = 'none';
    return;
  }

  // 5. Partition by priority
  const priorityAds = unifiedPromoted.filter(ad => ad.isPriority);
  const normalAds = unifiedPromoted.filter(ad => !ad.isPriority);

  // 6. Seeded hourly shuffle for absolute fairness in each tier
  const seed = getHourSeed();
  const shuffledPriority = seededShuffle(priorityAds, seed);
  const shuffledNormal = seededShuffle(normalAds, seed);

  // 7. Combine lists (Priority always first!)
  const finalPromoted = [...shuffledPriority, ...shuffledNormal];

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 2px;">
      <h2 style="font-family: var(--font-display); font-size: 16px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-primary); margin: 0; display: flex; align-items: center; gap: 10px;">
        <span style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:10px; background:rgba(245, 158, 11, 0.08); color:#f59e0b;">${icon('star', 16)}</span> Recomendados para vos
      </h2>
      <span style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 600; margin-left: 38px;">Selección exclusiva de locales destacados</span>
    </div>
    <div style="overflow-x: auto; display: flex; gap: 16px; padding: 0 16px 16px; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none;">
      ${finalPromoted.map(p => {
        const isCustom = p.isCustom;
        const targetHref = p.link || 'javascript:void(0)';
        
        let footerHtml = '';
        if (!isCustom) {
          footerHtml = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              <span style="font-weight: 800; font-size: 15px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</span>
              <span style="display: flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 800; color: var(--color-text-primary);">
                ${icon('star', 12)} ${p.rating || '4.8'}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-tertiary); margin-top: 3px;">
              <span style="display: flex; align-items: center; gap: 4px;">${icon('clock', 12)} ${p.deliveryTime || '20-35 min'}</span>
              <span>•</span>
              <span style="display: flex; align-items: center; gap: 4px;">${icon('bike', 12)} ${formatPrice(p.deliveryFee || 0)}</span>
            </div>
          `;
        } else {
          // Premium clean look for custom ads
          footerHtml = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              <span style="font-weight: 800; font-size: 15px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</span>
              <span style="display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 900; color: var(--color-primary); background:var(--color-primary-light); padding:2px 8px; border-radius:6px; text-transform: uppercase; letter-spacing: 0.05em;">
                Oficial
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-tertiary); margin-top: 3px;">
              <span style="display: flex; align-items: center; gap: 4px; font-weight: 800; color: var(--color-text-secondary);">
                Promoción Exclusiva
              </span>
            </div>
          `;
        }

        // Custom badges for priority
        const badgeBg = p.isPriority ? 'var(--color-warning)' : 'rgba(255, 235, 0, 0.95)';
        const badgeColor = '#1a1a1a';
        const priorityBorder = p.isPriority ? 'border: 2px solid var(--color-warning);' : 'border: 1px solid var(--color-border-light);';

        return `
          <a href="${targetHref}" ${p.link && p.link.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''} style="flex: 0 0 280px; text-decoration: none; display: flex; flex-direction: column; gap: 12px;">
            <div style="position: relative; width: 100%; aspect-ratio: 16/9; border-radius: 20px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.08); background: var(--color-surface); ${priorityBorder}">
              <img src="${p.banner}" alt="${p.name}" style="width: 100%; height: 100%; object-fit: cover;" />
              <div style="position: absolute; top: 12px; left: 12px; background: ${badgeBg}; color: ${badgeColor}; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 900; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-transform: uppercase;">
                ${p.label}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; padding: 0 4px;">
              <div style="width: 46px; height: 46px; border-radius: 50%; overflow: hidden; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.03); background: white; border: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: center;">
                <img src="${p.logo || '/logo.png'}" alt="" style="width: 78%; height: 78%; object-fit: contain; border-radius: 50%;" />
              </div>
              <div style="flex: 1; min-width: 0;">
                ${footerHtml}
              </div>
            </div>
          </a>
        `;
      }).join('')}
    </div>
    <style>
      #promoted-section div::-webkit-scrollbar { display: none; }
      #promoted-section div a:active { transform: scale(0.98); transition: transform 0.2s; }
    </style>
  `;

  const slider = container.querySelector('div:nth-child(2)');
  if (slider) {
    if (slider._autoplayCleanup) slider._autoplayCleanup();
    slider._autoplayCleanup = initAutoplay(slider, 5000, 300);
  }
}

function renderOffersSection(offers, comercios) {
  const container = document.getElementById('offers-section');
  if (!container) return;

  if (offers.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Seeded hourly shuffle for absolute fairness
  const shuffledOffers = seededShuffle(offers, getHourSeed());

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 2px;">
      <h2 style="font-family: var(--font-display); font-size: 16px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-primary); margin: 0; display: flex; align-items: center; gap: 10px;">
        <span style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:10px; background:rgba(16, 185, 129, 0.08); color:#10b981;">${icon('tag', 16)}</span> Ofertas y promociones
      </h2>
      <span style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 600; margin-left: 38px;">Ahorrá hoy con los mejores descuentos de la zona</span>
    </div>
    <div style="overflow-x: auto; display: flex; gap: 16px; padding: 0 16px 16px; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none;">
      ${shuffledOffers.map(o => {
        const c = comercios.find(com => com.id === o.comercioId);
        if (!c) return '';
        
        let targetHref = `#/comercio/${o.comercioId}`;
        if (o.productIds && o.productIds.length > 0) {
          targetHref = `#/comercio/${o.comercioId}?product=${o.productIds[0]}`;
        }
        let pricingHtml = '';
        
        if (o.product) {
          const origPrice = o.product.price;
          if (o.type === 'percentage') {
            const promoPrice = origPrice * (1 - o.value / 100);
            pricingHtml = `
              <div style="display:flex; align-items:center; gap:6px; margin-top:5px;">
                <span style="font-weight: 900; font-size: 15px; color: var(--color-primary);">${formatPrice(promoPrice)}</span>
                <span style="text-decoration: line-through; color: var(--color-text-tertiary); font-size: 11px; font-weight: 700;">${formatPrice(origPrice)}</span>
              </div>
            `;
          } else if (o.type === '2x1') {
            pricingHtml = `
              <div style="display:flex; align-items:center; gap:6px; margin-top:5px;">
                <span style="font-weight: 900; font-size: 13px; color: #e31b23; background: rgba(227,27,35,0.08); padding: 2px 6px; border-radius: 6px;">2x1</span>
                <span style="color: var(--color-text-tertiary); font-size: 11px; font-weight: 700;">Llevás 2 Pagás 1</span>
              </div>
            `;
          }
        }

        const badgeBg = o.type === '2x1' ? 'linear-gradient(135deg, #e31b23, #ff4d4d)' : 'linear-gradient(135deg, #ffeb00, #ffc700)';
        const badgeColor = o.type === '2x1' ? '#ffffff' : '#111111';
        const badgeText = o.type === '2x1' ? '2x1' : `${o.value}% OFF`;

        return `
          <a href="${targetHref}" class="offer-nav-card" style="flex: 0 0 240px; text-decoration: none; display: flex; flex-direction: column; gap: 10px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:12px; transition: all 0.2s; box-shadow: var(--shadow-xs);">
            <div style="position: relative; width: 100%; aspect-ratio: 16/10; border-radius: 16px; overflow: hidden; background: var(--color-bg-secondary);">
              <img src="${o.banner || c.banner || c.logo}" alt="Banner" style="width: 100%; height: 100%; object-fit: cover;" />
              
              <!-- Dynamic Promo Badge Overlay -->
              <div style="position: absolute; top: 10px; left: 10px; background: ${badgeBg}; color: ${badgeColor}; padding: 5px 11px; border-radius: 10px; font-size: 11px; font-weight: 900; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 4px; letter-spacing: -0.01em;">
                ${badgeText}
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:10px; padding: 0 4px;">
              <div style="width: 38px; height: 38px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: white; border: 1px solid var(--color-border-light); display:flex; align-items:center; justify-content:center;">
                <img src="${c.logo}" alt="" style="width: 78%; height: 78%; object-fit: contain; border-radius: 50%;" />
              </div>
              <div style="flex:1; min-width:0;">
                <div style="font-weight: 850; font-size: 14px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -0.01em;">${c.name}</div>
                <div style="font-size: 11px; font-weight: 700; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px;">${o.title}</div>
                ${pricingHtml}
              </div>
            </div>
          </a>
        `;
      }).join('')}
    </div>
    <style>
      #offers-section div::-webkit-scrollbar { display: none; }
      .offer-nav-card:active { transform: scale(0.97); }
    </style>
  `;

  const slider = container.querySelector('div:nth-child(2)');
  if (slider) {
    if (slider._autoplayCleanup) slider._autoplayCleanup();
    slider._autoplayCleanup = initAutoplay(slider, 4500, 260);
  }
}

const CATEGORY_IMAGE_MAP = {
  'Restaurante': '/images/categories/restaurants.png',
  'GoMarket': '/images/categories/gomarket.png',
  'Súper': '/images/categories/supermarket.png',
  'Supermercado': '/images/categories/supermarket.png',
  'Pollería': '/images/categories/polleria.png',
  'Polleria': '/images/categories/polleria.png',
  'Carnicería': '/images/categories/carniceria.png',
  'Carniceria': '/images/categories/carniceria.png',
  'Verdulería': '/images/categories/verduleria.png',
  'Verduleria': '/images/categories/verduleria.png',
  'Farmacia': '/images/categories/farmacia.png',
  'Kiosco': '/images/categories/kiosco.png',
  'Almacén': '/images/categories/almacen.png',
  'Almacen': '/images/categories/almacen.png',
  'Librería': '/images/categories/libreria.png',
  'Libreria': '/images/categories/libreria.png',
  'Mascotas': '/images/categories/mascotas.png',
  'Helados': '/images/categories/helados.png',
  'Heladería': '/images/categories/heladeria.png',
  'Heladeria': '/images/categories/heladeria.png',
  'Fiambrería': '/images/categories/fiambreria.png',
  'Fiambreria': '/images/categories/fiambreria.png',
  'Comida': '/images/categories/restaurants.png',
};

function renderCategories(categories, active) {
  const container = document.getElementById('categories-row-small');
  if (!container) return;

  // Filter out Todos, Comida, Restaurante, Restaurantes, and GoMarket from small categories
  const smallCats = categories.filter(c => 
    c.name !== 'Todos' &&
    c.name !== 'Comida' &&
    c.name !== 'Restaurante' &&
    c.name !== 'Restaurantes' &&
    c.name !== 'GoMarket'
  );

  container.innerHTML = smallCats.map(cat => {
    const img = CATEGORY_IMAGE_MAP[cat.name];
    
    return `
      <a href="#/category/${cat.name}" class="category-card-small" style="flex: 0 0 110px; height: 140px; text-decoration: none;">
        ${img ? 
          `<img src="${img}" alt="${cat.name}" />` : 
          `<div class="card-icon"><i class="ph-duotone ph-${CATEGORY_PHOSPHOR_MAP[cat.name] || 'package'}"></i></div>`
        }
        <span class="card-title">${cat.name}</span>
      </a>
    `;
  }).join('');

  // Arrows logic for smooth sliding and dynamic visibility
  const prevBtn = document.getElementById('cat-prev-btn');
  const nextBtn = document.getElementById('cat-next-btn');
  if (prevBtn && nextBtn) {
    const updateArrowsVisibility = () => {
      if (container.scrollLeft > 5) {
        prevBtn.style.display = 'flex';
      } else {
        prevBtn.style.display = 'none';
      }
      if (container.scrollLeft + container.clientWidth < container.scrollWidth - 5) {
        nextBtn.style.display = 'flex';
      } else {
        nextBtn.style.display = 'none';
      }
    };

    container.addEventListener('scroll', updateArrowsVisibility);
    // Call it initially with setTimeout to wait for layout
    setTimeout(updateArrowsVisibility, 200);
    window.addEventListener('resize', updateArrowsVisibility);

    prevBtn.onclick = () => {
      container.scrollBy({ left: -300, behavior: 'smooth' });
    };
    nextBtn.onclick = () => {
      container.scrollBy({ left: 300, behavior: 'smooth' });
    };
  }
}

async function renderComercios(comercios, category, search, filters) {
  const grid = document.getElementById('comercios-grid');
  if (!grid) return;

  const state = getState();
  const userCoords = state.deliveryCoords;
  const { getQuickDistance, calculateDynamicFee } = await import('../utils/geo.js');

  let filtered = comercios.filter(c => {
    const isGoMarket = (c.name || '').toLowerCase().includes('go!') && (c.name || '').toLowerCase().includes('market');
    return !isGoMarket;
  });

  if (category && category !== 'Todos') {
    filtered = filtered.filter(c => c.category === category);
  }

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.category || '').toLowerCase().includes(s)
    );
  }

  if (filters) {
    if (filters.openOnly) {
      filtered = filtered.filter(c => {
        try {
          return isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen) && !c.isPaused;
        } catch (e) {
          return false;
        }
      });
    }
    if (filters.topRatedOnly) {
      filtered = filtered.filter(c => (c.ratingAverage || 0) >= 4.5);
    }
    if (filters.freeShippingOnly) {
      filtered = filtered.filter(c => {
        if (userCoords && c.coords) {
          const distanceKm = getQuickDistance(userCoords.lat, userCoords.lng, c.coords.lat, c.coords.lng);
          if (distanceKm !== null) {
            const fee = calculateDynamicFee(distanceKm);
            return fee === 0;
          }
        }
        return true;
      });
    }
  }

  // Sort by ratingAverage descending, then ratingCount descending as fallback
  filtered.sort((a, b) => {
    const ratingA = a.ratingAverage !== undefined ? Number(a.ratingAverage) : 0;
    const ratingB = b.ratingAverage !== undefined ? Number(b.ratingAverage) : 0;
    if (ratingB !== ratingA) {
      return ratingB - ratingA;
    }
    const countA = a.ratingCount !== undefined ? Number(a.ratingCount) : 0;
    const countB = b.ratingCount !== undefined ? Number(b.ratingCount) : 0;
    return countB - countA;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <div class="empty-state-icon">${icon('store', 40)}</div>
        <div class="empty-state-title">No hay comercios</div>
        <div class="empty-state-text">${search ? 'Probá con otra búsqueda o filtros' : 'Aún no hay comercios en esta categoría con estos filtros'}</div>
      </div>
    `;
    return;
  }

  try {
    const state = getState();
    const userCoords = state.deliveryCoords;
    const { getQuickDistance, calculateDynamicFee } = await import('../utils/geo.js');

    // Synchronously calculate distances and fees
    const resolvedCards = filtered.map((c) => {
      let distanceKm = null;
      let deliveryFee = null;

      if (userCoords && c.coords) {
        distanceKm = getQuickDistance(userCoords.lat, userCoords.lng, c.coords.lat, c.coords.lng);
        if (distanceKm !== null) {
          deliveryFee = calculateDynamicFee(distanceKm);
        }
      }

      return { comercio: c, distanceKm, deliveryFee };
    });

    grid.innerHTML = resolvedCards.map(({ comercio: c, distanceKm, deliveryFee }, i) => {
      let isOpen = true;
      try {
        isOpen = isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen);
      } catch (e) {
        console.warn('Error checking isShopOpen for', c.name, e);
      }
      
      const isPaused = c.isPaused === true;
      const statusClass = isPaused ? 'paused' : (isOpen ? 'open' : 'closed');
      const statusText = isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
      const href = isPaused ? 'javascript:void(0)' : `#/comercio/${c.id}`;

      // Use c.banner properly
      const bannerSrc = c.banner || '';

      return `
        <a href="${href}" class="comercio-card card-interactive ${isPaused ? 'is-paused' : ''} page-enter stagger-${Math.min(i + 1, 6)}" style="text-decoration:none; display:flex; flex-direction:column; overflow:hidden; border-radius:24px; border:1px solid var(--color-border-light); background:var(--color-surface); box-shadow:var(--shadow-sm); margin-bottom:18px; position:relative;">
          <!-- Floating Favorite Heart Button (Moved out of banner to prevent clipping) -->
          <div class="card-favorite-btn-floating" style="position:absolute; top:120px; right:24px; width:40px; height:40px; border-radius:50%; background:white; display:flex; align-items:center; justify-content:center; border:1px solid var(--color-border-light); box-shadow:0 4px 12px rgba(0,0,0,0.08); color:var(--color-text-secondary); cursor:pointer; z-index:10;" onclick="event.preventDefault(); event.stopPropagation(); this.querySelector('svg').style.fill = this.querySelector('svg').style.fill ? '' : 'var(--color-primary)'; this.querySelector('svg').style.stroke = this.querySelector('svg').style.fill ? 'var(--color-primary)' : 'currentColor';">
            ${icon('heart', 18)}
          </div>

          <div class="comercio-card-banner" style="position:relative; height:140px; overflow:hidden;">
            ${bannerSrc ? `<img src="${bannerSrc}" alt="${c.name}" loading="lazy" style="width:100%; height:100%; object-fit:cover;" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 40)}</div>`}
            
            <div class="comercio-card-logo-container">
              ${c.logo ? `<img src="${c.logo}" alt="" class="comercio-card-logo" loading="lazy" />` : `<div class="comercio-card-logo" style="display:flex;align-items:center;justify-content:center;background:var(--color-surface);">${categoryIcon(c.category, 20)}</div>`}
            </div>

            <!-- Status Badge on top-left (fixed right:auto !important to prevent stretching) -->
            <div class="comercio-card-badge ${statusClass}" style="position:absolute; top:12px; left:12px; right:auto !important; padding:6px 12px; border-radius:100px; font-size:11px; font-weight:800; color:white; background:${isOpen && !isPaused ? '#00B174' : '#3F372B'}; z-index:2; box-shadow:0 4px 12px rgba(0,0,0,0.15); text-transform:none; letter-spacing:normal;">
              ${statusText === 'Abierto' ? 'Abierto ahora' : statusText}
            </div>
            
            <!-- Rating Box on top-right -->
            <div style="position:absolute; top:12px; right:12px; background:white; padding:6px 12px; border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.08); z-index:2; border:1px solid rgba(0,0,0,0.03);">
              <div style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; gap:3.5px; line-height:1.2;">
                <span style="color:#f59e0b; font-size:13px;">★</span>
                <span>${c.ratingAverage !== undefined && c.ratingAverage > 0 ? c.ratingAverage.toFixed(1) : 'Nuevo'}</span>
              </div>
              ${c.ratingCount ? `<span style="font-size:9.5px; color:var(--color-text-tertiary); font-weight:700; margin-top:1px;">(${c.ratingCount})</span>` : ''}
            </div>
          </div>
          
          <div class="comercio-card-body" style="padding: 16px; padding-top: 18px; display:flex; flex-direction:column; gap:2px; text-align:left; position:relative;">
            <!-- Title -->
            <div class="comercio-card-name" style="font-family:var(--font-display); font-size:18px; font-weight:800; color:var(--color-text-primary); margin:0; line-height:1.2;">${c.name}</div>
            
            <!-- Category & Distance -->
            <div style="font-size:13px; color:var(--color-text-secondary); font-weight:600; display:flex; align-items:center; gap:5px; margin-top:2px;">
              <span>${c.category || 'Comercio'}</span>
              ${distanceKm !== null ? `<span>•</span> <span>${distanceKm.toFixed(1)} km</span>` : ''}
            </div>
            
            <!-- Bottom Row: Separate Bordered Pills & Arrow Button in a Single Row -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; gap:8px; width:100%;">
              <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none;">
                <!-- Pill 1: Shipping dynamic cost -->
                <span style="display:inline-flex; align-items:center; gap:5.5px; background:white; border:1px solid var(--color-border-light); border-radius:100px; padding:6px 12px; font-size:12.5px; font-weight:700; color:var(--color-primary); white-space:nowrap; flex-shrink:0;">
                  ${icon('bike', 15, '', 'var(--color-primary)')}
                  <span>${deliveryFee !== null ? `Envío $${deliveryFee}` : 'Envío gratis'}</span>
                </span>
                
                <!-- Pill 2: Duration -->
                <span style="display:inline-flex; align-items:center; gap:5.5px; background:white; border:1px solid var(--color-border-light); border-radius:100px; padding:6px 12px; font-size:12.5px; font-weight:700; color:var(--color-text-secondary); white-space:nowrap; flex-shrink:0;">
                  ${icon('clock', 14)}
                  <span>
                    ${(() => {
                      const scheds = c.schedules || (c.schedule ? [c.schedule] : []);
                      if (scheds.length === 0) return 'Sin horario';
                      if (isOpen && !isPaused) {
                        return formatDeliveryTime(distanceKm, c.averagePrepTime);
                      }
                      return scheds.map(s => `${s.open}-${s.close}`).join(', ');
                    })()}
                  </span>
                </span>
              </div>
              
              <!-- Ver Comercio Button with Arrow -->
              <span style="background:var(--color-primary); color:white; width:36px; height:36px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; border:none; flex-shrink:0; transition:all 0.2s; box-shadow:0 4px 12px rgba(225, 29, 72, 0.15);">
                ${icon('chevronRight', 16, '', 'white')}
              </span>
            </div>
          </div>
        </a>
      `;
    }).join('');

    // Comercios slider navigation arrows logic
    const prevBtn = document.getElementById('com-prev-btn');
    const nextBtn = document.getElementById('com-next-btn');
    if (prevBtn && nextBtn) {
      const updateArrows = () => {
        if (grid.scrollLeft > 5) {
          prevBtn.style.display = 'flex';
        } else {
          prevBtn.style.display = 'none';
        }
        if (grid.scrollLeft + grid.clientWidth < grid.scrollWidth - 5) {
          nextBtn.style.display = 'flex';
        } else {
          nextBtn.style.display = 'none';
        }
      };
      grid.addEventListener('scroll', updateArrows);
      setTimeout(updateArrows, 200);
      prevBtn.onclick = () => {
        grid.scrollBy({ left: -320, behavior: 'smooth' });
      };
      nextBtn.onclick = () => {
        grid.scrollBy({ left: 320, behavior: 'smooth' });
      };
      
      if (grid._autoplayCleanup) {
        grid._autoplayCleanup();
      }
      grid._autoplayCleanup = initAutoplay(grid, 4000, 320);
    }
  } catch (err) {
    console.error('Error rendering comercios:', err);
    grid.innerHTML = '<p style="text-align:center; padding:20px; color:var(--color-text-tertiary);">Error al cargar comercios</p>';
  }
}

function renderSkeletonCards(count) {
  return Array(count).fill(`
    <div class="comercio-card skeleton-card">
      <div class="comercio-card-banner skeleton" style="height: 120px;"></div>
      <div class="comercio-card-body">
        <div class="skeleton skeleton-title" style="width: 70%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
        <div class="comercio-card-footer" style="margin-top: 8px;">
          <div class="skeleton skeleton-text" style="width: 50%; height: 10px;"></div>
        </div>
      </div>
    </div>
  `).join('');
}

// Seeded hourly random shuffle utilities
function createSeededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function seededShuffle(arr, seed) {
  const rand = createSeededRandom(seed);
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const getHourSeed = () => {
  const d = new Date();
  return d.getFullYear() * 1000000 + (d.getMonth() + 1) * 10000 + d.getDate() * 100 + d.getHours();
};

async function renderRecurrentOrders(user, container) {
  const isPreview = window.location.hash.includes('preview=true') || window.location.search.includes('preview=true');
  if (!user || isPreview) {
    container.style.display = 'none';
    return;
  }

  try {
    const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');
    const q = query(
      collection(db, 'orders'),
      where('userId', '==', user.uid),
      where('status', '==', 'completed'),
      orderBy('createdAt', 'desc')
    );

    const snap = await getDocs(q);
    if (snap.empty) {
      container.style.display = 'none';
      return;
    }

    const allOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Group completed orders by commerce and items signature to identify unique favorite orders
    const groups = {};
    allOrders.forEach(o => {
      const itemsKey = (o.items || [])
        .map(i => `${i.productId || i.id || ''}:${i.qty}`)
        .sort()
        .join('|');
      const groupKey = `${o.comercioId}_${itemsKey}`;

      if (!groups[groupKey]) {
        groups[groupKey] = {
          count: 0,
          latestOrder: o
        };
      }
      groups[groupKey].count++;
    });

    // Filter groups repeating at least 3 times, sort by popularity desc, then by date desc
    const recurrentOrders = Object.values(groups)
      .filter(g => g.count >= 3)
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        const dateA = a.latestOrder.createdAt?.seconds || 0;
        const dateB = b.latestOrder.createdAt?.seconds || 0;
        return dateB - dateA;
      })
      .slice(0, 3)
      .map(g => ({
        ...g.latestOrder,
        repeatCount: g.count
      }));

    if (recurrentOrders.length === 0) {
      container.style.display = 'none';
      return;
    }
    
    const cardsHtml = recurrentOrders.map(o => {
      const dateStr = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '';
      const itemsSummary = (o.items || []).map(item => `${item.qty}x ${item.product?.name || item.name || 'Producto'}`).join(', ');
      const repeatBadge = `<span style="font-size: 8.5px; font-weight: 900; color: var(--color-primary); background: rgba(225, 29, 72, 0.08); padding: 3px 6px; border-radius: 6px; text-transform: uppercase; letter-spacing:0.02em;">Repetido ${o.repeatCount}x</span>`;

      return `
        <div class="recurrent-order-card card-interactive glow-hover" style="
          min-width: 250px;
          max-width: 280px;
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: 24px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          scroll-snap-align: start;
          box-shadow: var(--shadow-sm);
          position: relative;
          overflow: hidden;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="display:flex; align-items:center; gap:6px;">
              ${repeatBadge}
              <span style="font-size: 9.5px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">
                ${dateStr}
              </span>
            </div>
            <span style="font-size: 13px; font-weight: 950; color: var(--color-success); background: var(--color-success-light); padding: 2px 8px; border-radius: 8px;">
              ${formatPrice(o.subtotal || 0)}
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <h4 style="font-family: var(--font-display); font-size: 15px; font-weight: 950; color: var(--color-text-primary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em;">
              ${o.comercioName || 'Comercio'}
            </h4>
            <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; height: 32px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; font-weight: 550;">
              ${itemsSummary}
            </p>
          </div>

          <button class="btn btn-primary repeat-1-click-btn" data-order-id="${o.id}" style="
            height: 38px;
            font-size: 12.5px;
            font-weight: 950;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            border: none;
            color: white;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.25);
            cursor: pointer;
            margin-top: 4px;
            transition: all 0.2s;
          ">
            ${icon('zap', 14)} Repetir 1-Click
          </button>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <h3 style="font-family: var(--font-display); font-size: 15px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; padding-left: 4px;">
        <span style="display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 8px; background: rgba(225, 29, 72, 0.08); color: var(--color-primary);">${icon('history', 15)}</span> ¿Querés repetir tu favorito?
      </h3>
      <div style="
        display: flex;
        gap: 14px;
        overflow-x: auto;
        padding: 4px 4px 12px;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        -ms-overflow-style: none;
      ">
        ${cardsHtml}
      </div>
    `;

    // Hide scrollbar for Webkit
    const styleId = 'recurrent-scrollbar-hide-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .recurrent-order-card::-webkit-scrollbar { display: none !important; }
      `;
      document.head.appendChild(style);
    }

    container.style.display = 'block';

    // Click handler
    container.querySelectorAll('.repeat-1-click-btn').forEach(btn => {
      btn.onclick = async () => {
        const oId = btn.getAttribute('data-order-id');
        const selectedOrder = recurrentOrders.find(ord => ord.id === oId);
        if (!selectedOrder) return;

        // Visual feedback / Loading state
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="ph-duotone ph-spinner animate-spin"></i> Cargando...`;

        try {
          const { clearCart, addToCart, setState } = await import('../state.js');
          const { showToast } = await import('../components/toast.js');
          const { AudioManager } = await import('../utils/audio-manager.js');
          const { getDocs, collection } = await import('firebase/firestore');

          AudioManager.hapticLight();
          
          // Fetch products from the commerce to resolve correct IDs (backward compatibility)
          const productsSnap = await getDocs(collection(db, 'comercios', selectedOrder.comercioId, 'products'));
          const commerceProducts = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

          // 1. Clear cart
          clearCart();

          // 2. Add all products to cart safely resolving IDs
          selectedOrder.items.forEach(item => {
            let resolvedProduct = null;
            const itemId = item.productId || item.id;
            
            if (itemId) {
              resolvedProduct = commerceProducts.find(p => p.id === itemId);
            }
            if (!resolvedProduct && item.name) {
              resolvedProduct = commerceProducts.find(p => (p.name || '').toLowerCase().trim() === (item.name || '').toLowerCase().trim());
            }

            if (resolvedProduct) {
              addToCart(resolvedProduct, selectedOrder.comercioId, selectedOrder.comercioName, item.qty, item.options);
            } else if (item.product) {
              addToCart(item.product, selectedOrder.comercioId, selectedOrder.comercioName, item.qty, item.options);
            } else {
              const fallbackProd = {
                id: itemId || 'fallback-id',
                name: item.name || 'Producto',
                price: item.price || 0
              };
              addToCart(fallbackProd, selectedOrder.comercioId, selectedOrder.comercioName, item.qty, item.options);
            }
          });

          // 3. Set address
          if (selectedOrder.deliveryAddress) {
            setState('deliveryAddress', selectedOrder.deliveryAddress);
          }
          if (selectedOrder.deliveryCoords) {
            setState('deliveryCoords', selectedOrder.deliveryCoords);
          }

          showToast('¡Carrito cargado con tu favorito!', 'success');
          
          // 4. Redirect
          setTimeout(() => {
            window.location.hash = '#/cart';
          }, 300);
        } catch (err) {
          console.error('Error loading recurrent order items:', err);
          const { showToast } = await import('../components/toast.js');
          showToast('Error al cargar los productos favoritos.', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      };
    });

  } catch (error) {
    console.error('Error rendering recurrent orders:', error);
    container.style.display = 'none';
  }
}

async function showBugReportModal() {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');
  
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 22px; display: flex; flex-direction: column; gap: 20px; color: var(--color-text-primary); background: var(--color-surface); border-top-left-radius: 28px; border-top-right-radius: 28px; border: 1px solid var(--color-border-light);';
  
  modalContent.innerHTML = `
    <div style="width: 44px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto; flex-shrink: 0; opacity: 0.7;"></div>
    <div style="text-align: center;">
      <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; margin: 0; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--color-primary);">
        🐞 Encontraste un problema?
      </h3>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 8px 0 0; line-height: 1.5; font-weight: 600; max-width: 320px; margin-left: auto; margin-right: auto;">
        Describí el error detalladamente. Tu reporte llegará al equipo de soporte de GoDelivery al instante.
      </p>
    </div>
    
    <textarea id="bug-desc-input" placeholder="¿Qué error encontraste? ¿Cómo podemos reproducirlo?..." style="width: 100%; height: 130px; padding: 16px; border: 1.5px solid var(--color-border-light); border-radius: 16px; font-size: 14px; font-weight: 600; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); resize: none; font-family: inherit; line-height: 1.5; box-sizing: border-box; transition: all 0.25s;" onfocus="this.style.borderColor='var(--color-primary)'; this.style.boxShadow='0 0 0 3px rgba(225, 29, 72, 0.1)';" onblur="this.style.borderColor='var(--color-border-light)'; this.style.boxShadow='none';"></textarea>
    
    <div>
      <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Captura de pantalla (Opcional)</label>
      <button id="bug-image-btn" style="width: 100%; height: 50px; border: 2px dashed var(--color-border-light); border-radius: 16px; background: var(--color-bg-secondary); color: var(--color-text-secondary); font-weight: 800; font-size: 13.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.25s; box-sizing: border-box;" onmouseover="this.style.borderColor='var(--color-primary)'; this.style.color='var(--color-primary)';" onmouseout="this.style.borderColor='var(--color-border-light)'; this.style.color='var(--color-text-secondary)';">
        ${icon('camera', 18)} Adjuntar Imagen
      </button>
      <input type="file" id="bug-image-input" accept="image/*" style="display: none;" />
      <div id="bug-image-preview-container" style="display: none; margin-top: 10px; position: relative; width: 90px; height: 90px; border-radius: 14px; overflow: hidden; border: 2px solid var(--color-border-light); box-shadow: var(--shadow-sm);">
        <img id="bug-image-preview" style="width: 100%; height: 100%; object-fit: cover;" />
        <button id="bug-image-remove" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; width: 22px; height: 22px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; transition: background 0.2s;" onmouseover="this.style.background='var(--color-danger)'" onmouseout="this.style.background='rgba(0,0,0,0.7)'">×</button>
      </div>
    </div>
    
    <div style="display: flex; gap: 12px; margin-top: 6px;">
      <button id="bug-cancel-btn" style="flex: 1; height: 50px; border-radius: 16px; font-weight: 800; font-size: 14px; color: var(--color-text-secondary); border: 1.5px solid var(--color-border-light); background: transparent; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">Cancelar</button>
      <button id="bug-submit-btn" style="flex: 2; height: 50px; border-radius: 16px; font-weight: 900; font-size: 14px; background: var(--color-primary); color: white; border: none; box-shadow: 0 6px 18px rgba(225, 29, 72, 0.25); cursor: pointer; transition: all 0.25s;" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 8px 22px rgba(225, 29, 72, 0.35)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 6px 18px rgba(225, 29, 72, 0.25)';">Enviar Reporte</button>
    </div>
  `;

  const { close } = showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent
  });

  const bugDescInput = modalContent.querySelector('#bug-desc-input');
  const imageBtn = modalContent.querySelector('#bug-image-btn');
  const imageInput = modalContent.querySelector('#bug-image-input');
  const previewContainer = modalContent.querySelector('#bug-image-preview-container');
  const previewImg = modalContent.querySelector('#bug-image-preview');
  const removeImgBtn = modalContent.querySelector('#bug-image-remove');
  const cancelBtn = modalContent.querySelector('#bug-cancel-btn');
  const submitBtn = modalContent.querySelector('#bug-submit-btn');

  let base64ImageData = null;

  imageBtn.onclick = () => imageInput.click();
  imageInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const { compressImageToBase64 } = await import('../utils/image.js');
        base64ImageData = await compressImageToBase64(file, 800, 0.6);
        previewImg.src = base64ImageData;
        previewContainer.style.display = 'block';
        imageBtn.style.display = 'none';
      } catch (err) {
        console.error('Error compressing bug image:', err);
        showToast('Error al procesar la imagen.', 'error');
      }
    }
  };

  removeImgBtn.onclick = () => {
    base64ImageData = null;
    imageInput.value = '';
    previewContainer.style.display = 'none';
    imageBtn.style.display = 'flex';
  };

  cancelBtn.onclick = () => close();

  submitBtn.onclick = async () => {
    const text = bugDescInput.value.trim();
    if (!text) {
      showToast('Por favor, describí el error antes de enviar.', 'warning');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `Enviando...`;

    try {
      const user = getState().user;
      const ticketNum = Math.floor(100000 + Math.random() * 900000);
      const ticketId = `#TK-${ticketNum}`;
      const bugMsg = `[REPORTE DE BUG/ERROR] ${text}`;

      const newMessage = {
        sender: 'user',
        text: bugMsg,
        timestamp: Date.now()
      };

      if (base64ImageData) {
        newMessage.image = base64ImageData;
        newMessage.text = `📷 Foto enviada: ${bugMsg}`;
      }

      const { doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp } = await import('firebase/firestore');
      const chatRef = doc(db, 'support_chats', user.uid);
      const chatSnap = await getDoc(chatRef);

      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          userId: user.uid,
          userName: user.displayName || 'Usuario',
          email: user.email || '',
          goId: user.goId || '',
          ticketId: ticketId,
          status: 'pending_approval',
          lastMessageText: `🐞 Reporte de Bug: ${text.substring(0, 30)}...`,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false,
          messages: [newMessage]
        });
      } else {
        await updateDoc(chatRef, {
          status: 'pending_approval',
          goId: user.goId || chatSnap.data().goId || '',
          ticketId: ticketId,
          lastMessageText: `🐞 Reporte de Bug: ${text.substring(0, 30)}...`,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false,
          messages: arrayUnion(newMessage)
        });
      }

      showToast('¡Reporte enviado con éxito! Abriendo chat de soporte...', 'success');
      close();

      setTimeout(() => {
        const fabBtn = document.getElementById('support-bot-fab-btn');
        if (fabBtn && !fabBtn.classList.contains('open')) {
          fabBtn.click();
        }
      }, 800);
    } catch (err) {
      console.error('Error submitting bug report:', err);
      showToast('Ocurrió un error al enviar el reporte.', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Enviar Reporte`;
    }
  };
}

async function renderRandomProductsSlider(comercios) {
  const container = document.getElementById('random-products-slider-container');
  if (!container) return;

  if (!comercios || comercios.length === 0) {
    container.style.display = 'none';
    return;
  }

  // 1. Get a set of selected comercios (always include GoMarket, and add up to 4 other random shops)
  const activeShops = comercios.filter(c => c.isActive !== false);
  if (activeShops.length === 0) {
    container.style.display = 'none';
    return;
  }

  const goMarket = activeShops.find(c => {
    const n = (c.name || '').toLowerCase();
    return n.includes('go!') && n.includes('market');
  });

  const selectedShops = [];
  if (goMarket) {
    selectedShops.push(goMarket);
  }

  // Pick remaining shops randomly
  const remainingShops = activeShops.filter(c => c.id !== (goMarket ? goMarket.id : ''));
  const shuffledShops = [...remainingShops].sort(() => 0.5 - Math.random());
  const maxShops = 4;
  for (let i = 0; i < Math.min(shuffledShops.length, maxShops); i++) {
    selectedShops.push(shuffledShops[i]);
  }

  // 2. Fetch products in parallel for selected shops
  let allProducts = [];
  try {
    const promises = selectedShops.map(async (shop) => {
      try {
        const q = query(collection(db, 'comercios', shop.id, 'products'));
        // 5-minute TTL cache
        const pSnap = await getDocsOptimized(q, `products_slider_${shop.id}`, 300000);
        return pSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            comercioId: shop.id,
            comercioName: shop.name,
            comercioLogo: shop.logo || '/logo.png',
            isGoMarket: (shop.name || '').toLowerCase().includes('go!') && (shop.name || '').toLowerCase().includes('market'),
            ...data
          };
        });
      } catch (err) {
        console.warn(`Error loading products for shop ${shop.id} in slider:`, err);
        return [];
      }
    });

    const results = await Promise.all(promises);
    allProducts = results.flat().filter(p => p.isActive !== false && !(p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0));
  } catch (err) {
    console.error('Error fetching random slider products:', err);
  }

  if (allProducts.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Shuffle products and take up to 10
  const shuffledProds = allProducts.sort(() => 0.5 - Math.random()).slice(0, 10);

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 2px;">
      <h2 style="font-family: var(--font-display); font-size: 16px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-primary); margin: 0; display: flex; align-items: center; gap: 10px;">
        <span style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:10px; background:rgba(225, 29, 72, 0.08); color:var(--color-primary);">${icon('sparkles', 16)}</span> Ofertas Imperdibles
      </h2>
      <span style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 600; margin-left: 38px;">Productos seleccionados para vos hoy</span>
    </div>
    <div class="random-products-slider-wrapper">
      <button id="prod-prev-btn" class="categories-arrow-btn prev-btn" style="display: none; position: absolute; left: 4px; top: calc(50% - 21px); z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        ${icon('chevronLeft', 20)}
      </button>
      <div class="random-products-slider" id="random-products-slider">
        ${shuffledProds.map(p => `
          <a href="#/comercio/${p.comercioId}?product=${p.id}" class="random-product-card">
            <div style="position: relative; width: 100%; aspect-ratio: 1; border-radius: 16px; overflow: hidden; background: var(--color-bg-secondary);">
              <img src="${p.image || '/logo.png'}" alt="${p.name}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" />
              <!-- Shop logo badge overlay -->
              <div style="position: absolute; bottom: 8px; left: 8px; display: flex; align-items: center; gap: 4px; background: rgba(255, 255, 255, 0.9); padding: 2px 6px; border-radius: 8px; box-shadow: var(--shadow-sm); border: 1px solid var(--color-border-light); max-width: 90%;">
                <img src="${p.comercioLogo}" style="width: 14px; height: 14px; border-radius: 50%; object-fit: contain;" />
                <span style="font-size: 8px; font-weight: 850; color: #1a1a1a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.comercioName}</span>
              </div>
              ${p.isGoMarket ? `
                <div style="position: absolute; top: 8px; right: 8px; background: rgba(13, 148, 136, 0.9); backdrop-filter: blur(4px); color: white; padding: 2px 6px; border-radius: 6px; font-size: 8.5px; font-weight: 900; box-shadow: var(--shadow-sm); text-transform: uppercase;">
                  GoMarket
                </div>
              ` : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 0 4px;">
              <span style="font-weight: 850; font-size: 13.5px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 32px; line-height: 1.2;">${p.name}</span>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                <span style="font-weight: 950; font-size: 14.5px; color: var(--color-primary);">${formatPrice(p.price)}</span>
                <span style="background: var(--color-primary-light); color: var(--color-primary); width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px;">
                  ${icon('plus', 10, '', 'var(--color-primary)')}
                </span>
              </div>
            </div>
          </a>
        `).join('')}
      </div>
      <button id="prod-prev-btn-next" class="categories-arrow-btn next-btn" style="display: none; position: absolute; right: 4px; top: calc(50% - 21px); z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        ${icon('chevronRight', 20)}
      </button>
    </div>
  `;

  // Arrow controls for random products slider
  const slider = container.querySelector('#random-products-slider');
  const prevBtn = container.querySelector('#prod-prev-btn');
  const nextBtn = container.querySelector('#prod-prev-btn-next');
  if (slider && prevBtn && nextBtn) {
    const updateArrows = () => {
      if (slider.scrollLeft > 5) {
        prevBtn.style.display = 'flex';
      } else {
        prevBtn.style.display = 'none';
      }
      if (slider.scrollLeft + slider.clientWidth < slider.scrollWidth - 5) {
        nextBtn.style.display = 'flex';
      } else {
        nextBtn.style.display = 'none';
      }
    };
    slider.addEventListener('scroll', updateArrows);
    setTimeout(updateArrows, 200);
    prevBtn.onclick = () => {
      slider.scrollBy({ left: -260, behavior: 'smooth' });
    };
    nextBtn.onclick = () => {
      slider.scrollBy({ left: 260, behavior: 'smooth' });
    };

    if (slider._autoplayCleanup) {
      slider._autoplayCleanup();
    }
    slider._autoplayCleanup = initAutoplay(slider, 3500, 260);
  }

  container.style.display = 'block';
}

function initAutoplay(sliderEl, intervalMs = 3500, stepPx = 280) {
  if (!sliderEl) return;
  
  let timerId = null;
  let isInterrupted = false;

  const start = () => {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      if (isInterrupted) return;
      
      const maxScroll = sliderEl.scrollWidth - sliderEl.clientWidth;
      if (sliderEl.scrollLeft >= maxScroll - 5) {
        sliderEl.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        sliderEl.scrollBy({ left: stepPx, behavior: 'smooth' });
      }
    }, intervalMs);
  };

  const stop = () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  sliderEl.addEventListener('mouseenter', () => { isInterrupted = true; });
  sliderEl.addEventListener('mouseleave', () => { isInterrupted = false; });
  sliderEl.addEventListener('touchstart', () => { isInterrupted = true; }, { passive: true });
  sliderEl.addEventListener('touchend', () => {
    setTimeout(() => { isInterrupted = false; }, 2000);
  }, { passive: true });

  start();
  return stop;
}





