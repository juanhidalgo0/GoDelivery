// GoDelivery — Home Page
import { db } from '../firebase.js';
import { collection, getDocs, query, where, orderBy, onSnapshot, doc, getDoc, collectionGroup } from 'firebase/firestore';
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
      
      <!-- Mundial Banner -->
      <div style="background: linear-gradient(135deg, #74ACDF 0%, #ffffff 50%, #74ACDF 100%); border-radius: 20px; padding: 14px 16px; margin: 12px 16px 0; display: flex; align-items: center; gap: 14px; box-shadow: 0 8px 24px rgba(116, 172, 223, 0.25); border: 1.5px solid rgba(255, 255, 255, 0.4); position: relative; overflow: hidden;">
        <div style="position: absolute; right: -15px; bottom: -15px; font-size: 56px; opacity: 0.15; transform: rotate(-15deg); pointer-events: none;">⚽</div>
        <div style="width: 44px; height: 44px; border-radius: 50%; background: #FFD700; display: flex; align-items: center; justify-content: center; font-size: 22px; box-shadow: 0 4px 10px rgba(255,215,0,0.3); border: 2px solid white; flex-shrink:0;">
          🏆
        </div>
        <div style="flex: 1; min-width: 0;">
          <h4 style="font-family: var(--font-display); font-size: 14px; font-weight: 950; color: #1E3A8A; margin: 0; letter-spacing: -0.02em; display: flex; align-items: center; gap: 6px;">
            ¡VAMOS ARGENTINA! 🇦🇷
          </h4>
          <p style="font-size: 11.5px; color: #1E3A8A; font-weight: 800; margin: 2px 0 0; opacity: 0.95; line-height: 1.3;">
            ¿Listos para el partido? Pedí la picada, birra o fernet y no te pierdas ni un segundo. ⚽
          </p>
        </div>
      </div>

      <!-- Quick Services Column Structure (Mandados on Top, Viajes and Market below) -->
      <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 0; margin-bottom: 4px;">
        <!-- Mandados Hero Card (100% width) -->
        <a id="home-mandados-btn" href="javascript:void(0)" class="glow-hover spring-hover scroll-reveal reveal-fade-down" style="background: linear-gradient(135deg, #FF2E55 0%, #E10036 100%); border-radius: 20px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; height: 76px; box-shadow: 0 10px 24px rgba(225, 0, 54, 0.22); text-decoration: none; position: relative; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.15); cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-sizing: border-box; width: 100%;">
          <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 60%); pointer-events: none;"></div>
          <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(255, 255, 255, 0.2); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
            ${icon('package', 20)}
          </div>
          <div style="flex: 1; min-width: 0; text-align: left; z-index: 2; display: flex; flex-direction: column; justify-content: center;">
            <h4 style="font-family: var(--font-display); font-size: 16px; font-weight: 950; color: white; margin: 0; letter-spacing: -0.02em; line-height: 1.15; text-shadow: 0 1px 2px rgba(0,0,0,0.15);">Mandados</h4>
            <span style="font-size: 11.5px; color: #ffffff; font-weight: 850; letter-spacing: -0.01em; margin-top: 2px; display: block; line-height: 1.2;">¿Qué te traemos? Pedí lo que quieras del pueblo</span>
          </div>
          
          <!-- Modern Floating Badge -->
          <span class="badge-pulse-modern" style="position: absolute; top: 10px; right: 14px; background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #000; font-size: 8.5px; font-weight: 900; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.6px; box-shadow: 0 4px 10px rgba(255, 215, 0, 0.35); font-family: var(--font-display); line-height: 1; z-index: 3;">¡Más Pedido!</span>
        </a>

        <!-- Viajes & Market split row -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;">
          <!-- Pedir Viaje Quick Card -->
          <a href="#/viajes" class="glow-hover spring-hover scroll-reveal reveal-fade-right" style="background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%); border-radius: 18px; padding: 10px 8px; display: flex; align-items: center; gap: 6px; height: 68px; box-shadow: 0 8px 20px rgba(37, 99, 235, 0.18); text-decoration: none; position: relative; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.15); cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-sizing: border-box;">
            <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
            <div style="width: 32px; height: 32px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
              ${icon('car', 16)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left; z-index: 2; display: flex; flex-direction: column; justify-content: center;">
              <h4 style="font-family: var(--font-display); font-size: 14px; font-weight: 950; color: white; margin: 0; letter-spacing: -0.02em; line-height: 1.15; text-shadow: 0 1px 2px rgba(0,0,0,0.15);">Viajes</h4>
              <span style="font-size: 10.5px; color: #ffffff; font-weight: 850; letter-spacing: -0.01em; margin-top: 1px; display: block; line-height: 1.2;">Viajá seguro</span>
            </div>
          </a>

          <!-- Marketplace Quick Card -->
          <a href="#/marketplace" class="glow-hover spring-hover scroll-reveal reveal-fade-left" style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 18px; padding: 10px 8px; display: flex; align-items: center; gap: 6px; height: 68px; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.18); text-decoration: none; position: relative; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.15); cursor: pointer; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-sizing: border-box;">
            <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
            <div style="width: 32px; height: 32px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); z-index: 2;">
              ${icon('shop', 16) || icon('tag', 16) || '🏷️'}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left; z-index: 2; display: flex; flex-direction: column; justify-content: center;">
              <h4 style="font-family: var(--font-display); font-size: 14px; font-weight: 950; color: white; margin: 0; letter-spacing: -0.02em; line-height: 1.15; text-shadow: 0 1px 2px rgba(0,0,0,0.15);">Market</h4>
              <span style="font-size: 10.5px; color: #ffffff; font-weight: 850; letter-spacing: -0.01em; margin-top: 1px; display: block; line-height: 1.2;">Compra y venta</span>
            </div>
          </a>
        </div>
      </div>
 
       <!-- Premium Category Grid (Comida & GoMarket) -->
       <div class="category-grid" style="margin-top: 10px; margin-bottom: 14px;">
         <a href="#/category/Comida" class="category-card-large glow-hover spring-hover scroll-reveal reveal-fade-right">
           <div style="position: absolute; top: 12px; left: 12px; background: rgba(225, 29, 72, 0.9); backdrop-filter: blur(4px); color: white; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 900; z-index: 2; box-shadow: var(--shadow-sm); text-transform: uppercase;">
             Tus antojos, rápido
           </div>
           <img src="/images/categories/restaurants.png" alt="Comida" />
           <span class="card-title">Comida</span>
         </a>
         <a href="#/category/GoMarket" id="gomarket-card" class="category-card-large glow-hover spring-hover scroll-reveal reveal-fade-left">
           <div style="position: absolute; top: 12px; left: 12px; background: rgba(13, 148, 136, 0.9); backdrop-filter: blur(4px); color: white; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 900; z-index: 2; box-shadow: var(--shadow-sm); text-transform: uppercase;">
             Tu súper en minutos
           </div>
           <img src="/images/categories/gomarket.png" alt="GoMarket" />
           <span class="card-title">GoMarket</span>
         </a>
       </div>
       
       <!-- Small Categories Slider Section -->
       <div class="categories-slider-wrapper scroll-reveal reveal-fade-up" style="position: relative; margin-top: 2px; display: flex; align-items: center; width: 100%;">
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
       <div id="brands-slider-container" class="scroll-reveal reveal-fade-up" style="margin-top: 2px; margin-bottom: 14px;"></div>
 
       <!-- Random Products Slider -->
       <div id="random-products-slider-container" class="scroll-reveal reveal-fade-up" style="margin-top: 2px; margin-bottom: 14px;"></div>
 
       <!-- Promoted Section -->
      <div id="promoted-section" class="scroll-reveal reveal-fade-up" style="margin-top: 2px; margin-bottom: 14px;"></div>

      <!-- App Only Section -->
      <div id="app-only-section" class="scroll-reveal reveal-fade-up" style="margin-top: 2px; margin-bottom: 14px;"></div>



      <!-- Main Content -->
      <div style="position: absolute; top: -50px; left: -20%; width: 140%; height: 300px; background: radial-gradient(circle at 50% 0%, rgba(225,29,72,0.15), rgba(16,185,129,0.05), transparent 70%); filter: blur(40px); z-index: -1; pointer-events: none;"></div>
      <div class="home-section scroll-reveal reveal-fade-up" style="margin-top: 18px; padding-top: 8px; position: relative;">
        <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px; padding: 0 16px; border-left: 4px solid var(--color-primary); margin-left: 16px; padding-left: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <h2 class="home-section-title" style="font-size:19px; font-weight:900; letter-spacing:-0.03em; color:var(--color-text-primary); margin:0;">
              Todos los comercios
            </h2>
            <a href="#/category/Todos" style="font-size:13px; font-weight:700; color:var(--color-text-primary); text-decoration:none; display:flex; align-items:center; gap:4px; padding:6px 14px; border-radius:20px; background:var(--color-surface); border:1px solid var(--color-border-light); box-shadow:0 2px 8px rgba(0,0,0,0.03); transition:all 0.2s;">Ver todos <span style="opacity:0.6; display:flex;">${icon('chevronRight', 14)}</span></a>
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

      <!-- Want to Join Your Commerce Section -->
      <div id="join-commerce-banner" class="scroll-reveal reveal-scale-up" style="margin: 20px 16px 10px; background: linear-gradient(135deg, var(--color-primary) 0%, #be123c 100%); border-radius: 18px; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; box-shadow: 0 8px 25px rgba(225, 29, 72, 0.18); color: white; cursor: pointer; transition: all 0.2s;">
        <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
          <div style="width: 42px; height: 42px; border-radius: 12px; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
            🏪
          </div>
          <div style="text-align: left;">
            <h4 style="font-family: var(--font-display); font-size: 15px; font-weight: 900; margin: 0 0 2px 0; color: white;">¿Querés sumar tu comercio?</h4>
            <p style="font-size: 11px; margin: 0; color: rgba(255,255,255,0.95); font-weight: 600;">Registrá tu negocio y empezá a recibir pedidos.</p>
          </div>
        </div>
        <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0;">
          ${icon('chevronRight', 16)}
        </div>
      </div>

      <!-- Want to Work with Us Section -->
      <div id="join-team-banner" class="scroll-reveal reveal-scale-up" style="margin: 0 16px 10px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 18px; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; box-shadow: 0 8px 25px rgba(15, 23, 42, 0.15); color: white; cursor: pointer; transition: all 0.2s;">
        <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
          <div style="width: 42px; height: 42px; border-radius: 12px; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
            💼
          </div>
          <div style="text-align: left;">
            <h4 style="font-family: var(--font-display); font-size: 15px; font-weight: 900; margin: 0 0 2px 0; color: white; text-transform: uppercase;">¿Querés trabajar con nosotros?</h4>
            <p style="font-size: 11px; margin: 0; color: rgba(255,255,255,0.9); font-weight: 600;">Sumate al equipo como repartidor, chofer o ambos.</p>
          </div>
        </div>
        <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0;">
          ${icon('chevronRight', 16)}
        </div>
      </div>

      <!-- Suggestion & Bug Report Banner Section -->
      <div id="bug-report-banner" class="scroll-reveal reveal-scale-up" style="margin: 0 16px 20px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 16px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: var(--shadow-xs);">
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

  let onlyInAppProducts = [];

  // Instant render categories, offers, onlyInAppProducts, and commerce lists from LocalStorage cache
  try {
    const rawOffers = localStorage.getItem('gd_cached_offers');
    if (rawOffers) offers = JSON.parse(rawOffers);

    const rawAppOnly = localStorage.getItem('gd_cached_only_in_app');
    if (rawAppOnly) onlyInAppProducts = JSON.parse(rawAppOnly);

    const raw = localStorage.getItem('gd_platform_categories');
    if (raw) {
      categories = JSON.parse(raw);
      if (!categories.some(c => c.name === 'GoMarket')) {
        categories.push({ id: 'gomarket', name: 'GoMarket', icon: 'shoppingBag', order: 0 });
      }
      setTimeout(() => {
        renderCategories(categories, activeCategory);
      }, 50);
    }

    const rawComercios = localStorage.getItem('gd_cached_comercios');
    if (rawComercios) {
      comercios = JSON.parse(rawComercios);
      setTimeout(() => {
        renderBrandsSlider(comercios);
        renderRandomProductsSlider(comercios, offers);
        renderPromotedSection(comercios);
        renderAppOnlySection(onlyInAppProducts, comercios, offers);
        const searchVal = document.getElementById('header-search')?.value || '';
        renderComercios(comercios, activeCategory, searchVal, currentFilters);
      }, 75);
    }
  } catch (e) {}

  try {
    const qAppOnly = query(collectionGroup(db, 'products'), where('onlyInApp', '==', true));
    const [catSnap, offersSnap, appOnlySnap] = await Promise.all([
      getDocsOptimized(query(collection(db, 'platformCategories'), orderBy('order')), 'platformCategories', 3600000),
      getDocsOptimized(query(collection(db, 'offers'), where('active', '==', true)), 'activeOffers', 300000),
      getDocsOptimized(qAppOnly, 'onlyInAppProducts', 300000)
    ]);

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
    
    // Save to LocalStorage cache
    try {
      localStorage.setItem('gd_platform_categories', JSON.stringify(categories));
    } catch (e) {}

    offers = offersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    onlyInAppProducts = appOnlySnap.docs
      .map(docSnap => {
        const pathParts = docSnap.ref.path.split('/');
        const comercioId = pathParts[1];
        return { id: docSnap.id, comercioId, ...docSnap.data() };
      })
      .filter(p => p.isAvailable !== false && !(p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0));

    // Fetch product details for all products in parallel and expand multi-product offers
    const expandedOffers = [];
    await Promise.all(offers.map(async (o) => {
      if (o.productIds && o.productIds.length > 0 && o.comercioId) {
        try {
          const productsData = await Promise.all(o.productIds.map(async (pId) => {
            try {
              const pSnap = await getDoc(doc(db, 'comercios', o.comercioId, 'products', pId));
              if (pSnap.exists()) {
                return { id: pSnap.id, ...pSnap.data() };
              }
            } catch (e) {
              console.warn(`Error loading product details for offer ${o.id}, product ${pId}:`, e);
            }
            return null;
          }));
          
          const validProducts = productsData.filter(Boolean);
          
          validProducts.forEach((p) => {
            expandedOffers.push({
              ...o,
              id: `${o.id}-${p.id}`,
              product: p,
              targetProductId: p.id
            });
          });
        } catch (e) {
          console.warn('Error expanding products for offer:', o.id, e);
          expandedOffers.push(o);
        }
      } else {
        expandedOffers.push(o);
      }
    }));
    offers = expandedOffers;

    try {
      localStorage.setItem('gd_cached_offers', JSON.stringify(offers));
      localStorage.setItem('gd_cached_only_in_app', JSON.stringify(onlyInAppProducts));
    } catch (e) {}

    // Add GoMarket to categories if it exists as a concept
    if (!categories.some(c => c.name === 'GoMarket')) {
      categories.push({ id: 'gomarket', name: 'GoMarket', icon: 'shoppingBag', order: 0 });
    }

    // Set up real-time listener for active and inactive comercios
    unsubComercios = onSnapshot(collection(db, 'comercios'), async (comSnap) => {
      comercios = comSnap.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, ...data };
      });
      try {
        localStorage.setItem('gd_cached_comercios', JSON.stringify(comercios));
      } catch (e) {}

      // Render brands slider
      renderBrandsSlider(comercios);

      // Render random products slider
      renderRandomProductsSlider(comercios, offers);

      // Render promoted section (Ads)
      renderPromotedSection(comercios);

      renderAppOnlySection(onlyInAppProducts, comercios, offers);

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



  // Bug Report button handler
  const reportBugBtn = document.getElementById('report-bug-btn');
  if (reportBugBtn) {
    reportBugBtn.onclick = async () => {
      const user = getState().user;
      if (!user) {
        const { showToast } = await import('../components/toast.js');
        showToast('Iniciá sesión para reportar un error.', 'warning');
        return;
      }
      showBugReportModal();
    };
  }

  // Join Commerce button handler
  const joinCommerceBtn = document.getElementById('join-commerce-banner');
  if (joinCommerceBtn) {
    joinCommerceBtn.addEventListener('click', async () => {
      const user = getState().user;
      if (!user) {
        const { showToast } = await import('../components/toast.js');
        showToast('Iniciá sesión para solicitar la incorporación de tu comercio.', 'warning');
        return;
      }
      showJoinCommerceModal();
    });
  }

  // Join Team button handler
  const joinTeamBtn = document.getElementById('join-team-banner');
  if (joinTeamBtn) {
    joinTeamBtn.addEventListener('click', async () => {
      const user = getState().user;
      if (!user) {
        const { showToast } = await import('../components/toast.js');
        showToast('Iniciá sesión para postularte.', 'warning');
        return;
      }
      showJoinTeamModal();
    });
  }

  // Show welcome beta modal if not shown before
  checkAndShowWelcomeModal();

  // Show app-only product promotion modal if not shown in this session
  checkAndShowAppOnlyPromo();

  // Mandados Home button handler
  const mandadosBtn = document.getElementById('home-mandados-btn');
  if (mandadosBtn) {
    mandadosBtn.onclick = async () => {
      const user = getState().user;
      if (!user) {
        const { showToast } = await import('../components/toast.js');
        showToast('Iniciá sesión para usar el servicio de Mandados.', 'warning');
        return;
      }
      showMandadosOverlayModal();
    };
  }

  // Hide FABs at bottom of page to avoid overlapping the bug report card
  content.addEventListener('scroll', () => {
    const fabBtn = document.getElementById('support-bot-fab-btn');
    const guideFab = document.getElementById('app-guide-fab');
    const isAtBottom = content.scrollHeight - content.scrollTop <= content.clientHeight + 160;
    
    if (isAtBottom) {
      if (fabBtn) fabBtn.classList.add('fab-hidden');
      if (guideFab) guideFab.classList.add('fab-hidden');
    } else {
      if (fabBtn) fabBtn.classList.remove('fab-hidden');
      if (guideFab) guideFab.classList.remove('fab-hidden');
    }
  });

  return {
    cleanup: () => {
      if (unsubComercios) unsubComercios();
    }
  };
}

function checkAndShowWelcomeModal() {
  if (document.getElementById('welcome-beta-modal-overlay')) return;
  const user = getState().user;
  if (!user) return;
  const welcomed = localStorage.getItem('welcome_beta_v1');
  if (welcomed === 'true') return;

  const modalEl = document.createElement('div');
  modalEl.id = 'welcome-beta-modal-overlay';
  modalEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 23, 42, 0.4);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    padding: 24px;
    box-sizing: border-box;
    animation: fadeInWelcome 0.3s ease-out forwards;
  `;

  modalEl.innerHTML = `
    <div style="background: var(--color-surface, #ffffff); max-width: 420px; width: 100%; height: 500px; max-height: 85vh; border-radius: 28px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15); border: 1.5px solid var(--color-border-light, #f1f5f9); overflow: hidden; display: flex; flex-direction: column; box-sizing: border-box; transform: scale(0.9); animation: scaleUpWelcome 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;">
      <!-- Cabecera fija -->
      <div style="text-align: center; padding: 20px 24px 10px 24px; flex-shrink: 0;">
        <div style="font-size: 36px; margin-bottom: 8px; display: inline-block; animation: waveEmoji 2s infinite ease-in-out;">👋</div>
        <h2 style="font-family: var(--font-display, inherit); font-size: 20px; font-weight: 950; color: var(--color-text-primary, #0f172a); margin: 0;">¡Hola, Vecino! Te damos la bienvenida a GO!</h2>
      </div>
      
      <!-- Cuerpo con scroll -->
      <div style="overflow-y: auto; padding: 0 24px 12px 24px; flex-grow: 1; -webkit-overflow-scrolling: touch;">
        <p style="font-size: 13.5px; line-height: 1.6; color: var(--color-text-secondary, #475569); margin: 0; font-weight: 600; text-align: left;">
          Estamos muy felices de traerte una aplicación creada por y para nuestro pueblo, pensada para hacernos el día a día más fácil a todos.<br><br>
          Queremos contarte que actualmente nos encontramos en <strong>Fase Beta (en desarrollo y prueba)</strong>. Esto significa que, aunque le ponemos todo el corazón, de vez en cuando podría surgir algún pequeño error en el sistema.<br><br>
          Si te encontrás con alguno, te agradeceríamos enormemente tu paciencia y que nos lo comentes directamente desde el botón de soporte. Tu feedback es nuestro motor para corregir los detalles, seguir mejorando y <strong>seguir creciendo juntos</strong>.<br><br>
          ¡Gracias por ser parte de la comunidad de GO!
        </p>
      </div>
      
      <!-- Pie de página fijo con el botón -->
      <div style="padding: 12px 24px 24px 24px; flex-shrink: 0; background: var(--color-surface, #ffffff); border-top: 1.5px solid var(--color-border-light, #f1f5f9);">
        <button id="welcome-beta-accept-btn" style="width: 100%; height: 50px; border-radius: 14px; background: linear-gradient(135deg, #FF2E55 0%, #E10036 100%); color: white; border: none; font-size: 14.5px; font-weight: 900; cursor: pointer; box-shadow: 0 6px 16px rgba(225, 0, 54, 0.25); transition: all 0.2s; outline: none;">
          ¡Entendido, vamos a GO!
        </button>
      </div>
    </div>
    
    <style>
      @keyframes fadeInWelcome {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes scaleUpWelcome {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @keyframes waveEmoji {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(-10deg); }
        75% { transform: rotate(10deg); }
      }
      #welcome-beta-accept-btn:active {
        transform: scale(0.96);
        opacity: 0.95;
      }
    </style>
  `;

  document.body.appendChild(modalEl);

  const acceptBtn = modalEl.querySelector('#welcome-beta-accept-btn');
  if (acceptBtn) {
    acceptBtn.onclick = () => {
      localStorage.setItem('welcome_beta_v1', 'true');
      modalEl.style.animation = 'fadeInWelcome 0.2s ease-out reverse forwards';
      setTimeout(() => {
        modalEl.remove();
      }, 200);
    };
  }
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
  const seed = getHourSeed();
  const shuffledBrands = seededShuffle(brands, seed);

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 2px;">
      <h3 style="font-family: var(--font-display); font-size: 15px; font-weight: 950; color: var(--color-text-primary); margin: 0;">Comercios</h3>
      <span style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 600;">Los locales más elegidos por la comunidad</span>
    </div>
    <div style="overflow-x: auto; display: flex; gap: 14px; padding: 6px 16px 12px; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none;">
      ${shuffledBrands.map(brand => {
        const isInactive = brand.isActive === false;
        const href = isInactive ? 'javascript:void(0)' : `#/comercio/${brand.id}`;
        return `
          <a href="${href}" style="flex: 0 0 64px; text-decoration: none; display: flex; flex-direction: column; align-items: center; gap: 6px; ${isInactive ? 'opacity: 0.5; filter: grayscale(1); pointer-events: none;' : ''}">
            <div style="width: 64px; height: 64px; border-radius: 50%; overflow: hidden; background: white; border: 1px solid var(--color-border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;">
              <img src="${brand.logo}" alt="${brand.name}" style="width: 78%; height: 78%; object-fit: contain; border-radius: 50%;" />
            </div>
            <span style="font-size: 10.5px; font-weight: 750; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 68px; text-align: center;">${brand.name}</span>
          </a>
        `;
      }).join('')}
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
    if (c.isActive === false) return false;
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
    <div style="padding: 0 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px; border-left: 4px solid var(--color-primary); margin-left: 16px; padding-left: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <h2 style="font-size: 19px; font-weight: 900; letter-spacing: -0.03em; color: var(--color-text-primary); margin: 0;">
          Recomendados para vos
        </h2>
        <a href="#/category/Recomendados" style="font-size:13px; font-weight:700; color:var(--color-text-primary); text-decoration:none; display:flex; align-items:center; gap:4px; padding:6px 14px; border-radius:20px; background:var(--color-surface); border:1px solid var(--color-border-light); box-shadow:0 2px 8px rgba(0,0,0,0.03); transition:all 0.2s; flex-shrink:0;">Ver todos <span style="opacity:0.6; display:flex;">${icon('chevronRight', 14)}</span></a>
      </div>
      <span style="font-size: 12.5px; color: var(--color-text-tertiary); font-weight: 600; letter-spacing: -0.01em;">Selección exclusiva de locales destacados</span>
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
              <span style="display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 900; color: var(--color-primary); background:var(--color-primary-light); padding:2px 8px; border-radius:6px; letter-spacing: 0.05em;">
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
              <div style="position: absolute; top: 12px; left: 12px; background: ${badgeBg}; color: ${badgeColor}; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 900; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
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

function renderAppOnlySection(products, comercios, offers = []) {
  const container = document.getElementById('app-only-section');
  if (!container) return;

  const user = getState().user;
  if (!user) {
    container.style.display = 'none';
    return;
  }

  const activeComerciosIds = new Set(comercios.filter(c => c.isActive !== false).map(c => c.id));
  const activeProducts = products.filter(p => activeComerciosIds.has(p.comercioId));

  if (activeProducts.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  // Seeded hourly shuffle for rotating products every 1 hour
  const shuffledProducts = seededShuffle(activeProducts, getHourSeed());

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px; border-left: 4px solid var(--color-primary); margin-left: 16px; padding-left: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <h2 style="font-size: 19px; font-weight: 900; letter-spacing: -0.03em; color: var(--color-text-primary); margin: 0;">
          Disponible sólo en la app
        </h2>
        <a href="#/category/Solo En App" style="font-size:13px; font-weight:700; color:var(--color-text-primary); text-decoration:none; display:flex; align-items:center; gap:4px; padding:6px 14px; border-radius:20px; background:var(--color-surface); border:1px solid var(--color-border-light); box-shadow:0 2px 8px rgba(0,0,0,0.03); transition:all 0.2s; flex-shrink:0;">Ver todos <span style="opacity:0.6; display:flex;">${icon('chevronRight', 14)}</span></a>
      </div>
      <span style="font-size: 12.5px; color: var(--color-text-tertiary); font-weight: 600; letter-spacing: -0.01em;">Aprovechá productos exclusivos de nuestra plataforma móvil</span>
    </div>
    <div style="overflow-x: auto; display: flex; gap: 16px; padding: 0 16px 16px; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none;">
      ${shuffledProducts.map(p => {
        const c = comercios.find(com => com.id === p.comercioId);
        const cName = c ? c.name : 'Comercio';
        const cLogo = c ? c.logo : '/logo.png';
        const pImage = p.image || '/logo.png';
        const targetHref = `#/comercio/${p.comercioId}?product=${p.id}`;

        const offer = offers.find(o => o.active !== false && (o.targetProductId === p.id || (o.productIds && o.productIds.includes(p.id))));
        const discountPercent = (offer && offer.type === 'percentage') ? (offer.value || 0) : 0;
        const discountedPrice = discountPercent > 0 ? p.price * (1 - discountPercent / 100) : p.price;

        return `
          <a href="${targetHref}" class="app-only-nav-card" style="flex: 0 0 240px; text-decoration: none; display: flex; flex-direction: column; gap: 10px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:12px; transition: all 0.2s; box-shadow: var(--shadow-xs);">
            <div style="position: relative; width: 100%; aspect-ratio: 16/10; border-radius: 16px; overflow: hidden; background: var(--color-bg-secondary);">
              <img src="${pImage}" alt="Banner" style="width: 100%; height: 100%; object-fit: cover;" />
              
              <!-- App only Badge Overlay -->
              <div style="position: absolute; top: 10px; left: 10px; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); color: white; padding: 5px 11px; border-radius: 10px; font-size: 10px; font-weight: 900; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 4px; letter-spacing: -0.01em; text-transform: uppercase; line-height: 1;">
                Disponible sólo en la app
              </div>
              ${discountPercent > 0 ? `
                <div style="position: absolute; top: 10px; right: 10px; background: var(--color-primary); color: white; padding: 3px 8px; border-radius: 8px; font-size: 9px; font-weight: 900; box-shadow: var(--shadow-sm); z-index: 2; text-transform: uppercase;">
                  ${discountPercent}% OFF
                </div>
              ` : ''}
            </div>

            <div style="display:flex; align-items:center; gap:10px; padding: 0 4px;">
              <div style="width: 38px; height: 38px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: white; border: 1px solid var(--color-border-light); display:flex; align-items:center; justify-content:center;">
                <img src="${cLogo}" alt="" style="width: 78%; height: 78%; object-fit: contain; border-radius: 50%;" />
              </div>
              <div style="flex:1; min-width:0;">
                <div style="font-weight: 850; font-size: 14px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -0.01em;">${p.name}</div>
                <div style="font-size: 11px; font-weight: 700; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px;">${cName}</div>
                <div style="display: flex; align-items: baseline; gap: 6px; margin-top: 4px;">
                  ${discountPercent > 0 ? `
                    <span style="font-weight: 900; font-size: 15px; color: var(--color-primary);">${formatPrice(discountedPrice)}</span>
                    <span style="font-size: 11px; color: var(--color-text-tertiary); text-decoration: line-through; font-weight: 700;">${formatPrice(p.price)}</span>
                  ` : `
                    <span style="font-weight: 900; font-size: 15px; color: var(--color-primary);">${formatPrice(p.price)}</span>
                  `}
                </div>
              </div>
            </div>
          </a>
        `;
      }).join('')}
    </div>
    <style>
      #app-only-section div::-webkit-scrollbar { display: none; }
      .app-only-nav-card:active { transform: scale(0.97); }
    </style>
  `;

  const slider = container.querySelector('div:nth-child(2)');
  if (slider) {
    if (slider._autoplayCleanup) slider._autoplayCleanup();
    slider._autoplayCleanup = initAutoplay(slider, 5000, 260);
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
  'Bazar': '/images/categories/bazar.png',
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
    c.name !== 'GoMarket' &&
    c.name !== 'Pizzería' &&
    c.name !== 'Pizzeria'
  );

  container.innerHTML = smallCats.map(cat => {
    const cleanName = cat.name.replace('🎁', '').trim();
    const img = CATEGORY_IMAGE_MAP[cleanName];
    
    return `
      <a href="#/category/${cat.name}" class="category-card-small" style="flex: 0 0 110px; height: 140px; text-decoration: none;">
        ${img ? 
          `<img src="${img}" alt="${cleanName}" />` : 
          `<div class="card-icon"><i class="ph-duotone ph-${CATEGORY_PHOSPHOR_MAP[cat.name] || 'package'}"></i></div>`
        }
        <span class="card-title">${cleanName}</span>
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

  // Determine open status for sorting
  const getOpenStatus = (c) => {
    try {
      if (c.isPaused) return 0;
      // Use imported isShopOpen to determine if shop is currently open
      return isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen) ? 1 : 0;
    } catch (e) {
      return 0;
    }
  };

  const hourSeed = Math.floor(Date.now() / 3600000); // Changes every 1 hour

  const getPseudoRandom = (seed, id) => {
    let hash = seed;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0; 
    }
    return hash;
  };

  // Sort by Open Status first, then Pseudo-Random rotation per hour, then ratingAverage as fallback
  filtered.sort((a, b) => {
    const openA = getOpenStatus(a);
    const openB = getOpenStatus(b);
    
    if (openA !== openB) {
      return openB - openA; // Open first
    }

    // Rotate every hour based on shop id
    const rA = getPseudoRandom(hourSeed, a.id);
    const rB = getPseudoRandom(hourSeed, b.id);
    if (rA !== rB) {
      return rB - rA;
    }

    // Fallback to ratings
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
      
      const isInactive = c.isActive === false;
      const isPaused = c.isPaused === true;
      const statusClass = isInactive ? 'inactive' : (isPaused ? 'paused' : (isOpen ? 'open' : 'closed'));
      const statusText = isInactive ? 'Próximamente' : (isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado'));
      const href = (isPaused || isInactive) ? 'javascript:void(0)' : `#/comercio/${c.id}`;

      // Use c.banner properly
      const bannerSrc = c.banner || '';

      return `
        <a href="${href}" class="comercio-card card-interactive ${isPaused ? 'is-paused' : ''} ${isInactive ? 'is-inactive' : ''} scroll-reveal reveal-fade-up reveal-delay-${Math.min(i + 1, 5)}" style="text-decoration:none; display:flex; flex-direction:column; overflow:hidden; border-radius:24px; border:1px solid var(--color-border-light); background:var(--color-surface); box-shadow:var(--shadow-sm); margin-bottom:18px; position:relative; ${isInactive ? 'opacity: 0.75; filter: grayscale(0.85);' : ''}">
          <!-- Floating Favorite Heart Button (Moved out of banner to prevent clipping) -->
          <div class="card-favorite-btn-floating" style="position:absolute; top:120px; right:24px; width:40px; height:40px; border-radius:50%; background:white; display:flex; align-items:center; justify-content:center; border:1px solid var(--color-border-light); box-shadow:0 4px 12px rgba(0,0,0,0.08); color:var(--color-text-secondary); cursor:pointer; z-index:10; ${isInactive ? 'display:none;' : ''}" onclick="event.preventDefault(); event.stopPropagation(); this.querySelector('svg').style.fill = this.querySelector('svg').style.fill ? '' : 'var(--color-primary)'; this.querySelector('svg').style.stroke = this.querySelector('svg').style.fill ? 'var(--color-primary)' : 'currentColor';">
            ${icon('heart', 18)}
          </div>

          <div class="comercio-card-banner" style="position:relative; height:140px; overflow:hidden;">
            ${bannerSrc ? `<img src="${bannerSrc}" alt="${c.name}" loading="lazy" style="width:100%; height:100%; object-fit:cover;" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 40)}</div>`}
            
            <div class="comercio-card-logo-container">
              ${c.logo ? `<img src="${c.logo}" alt="" class="comercio-card-logo" loading="lazy" />` : `<div class="comercio-card-logo" style="display:flex;align-items:center;justify-content:center;background:var(--color-surface);">${categoryIcon(c.category, 20)}</div>`}
            </div>

            <!-- Status Badge on top-left (fixed right:auto !important to prevent stretching) -->
            <div class="comercio-card-badge ${statusClass}" style="position:absolute; top:12px; left:12px; right:auto !important; padding:6px 12px; border-radius:100px; font-size:11px; font-weight:800; color:white; background:${isInactive ? '#64748b' : (isOpen && !isPaused ? '#00B174' : '#3F372B')}; z-index:2; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
              ${statusText === 'Abierto' ? 'Abierto ahora' : statusText.toUpperCase()}
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
      const repeatBadge = `<span style="font-size: 8.5px; font-weight: 900; color: var(--color-primary); background: rgba(225, 29, 72, 0.08); padding: 3px 6px; border-radius: 6px; letter-spacing:0.02em;">Repetido ${o.repeatCount}x</span>`;

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
              <span style="font-size: 9.5px; font-weight: 800; color: var(--color-text-tertiary);">
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
      <h3 style="font-family: var(--font-display); font-size: 15px; font-weight: 900; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; padding-left: 4px;">
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

async function renderRandomProductsSlider(comercios, offers = []) {
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

  // 2. Fetch products in parallel for active shops
  let allProducts = [];
  try {
    const promises = activeShops.map(async (shop) => {
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
    allProducts = results.flat().filter(p => p.isActive !== false && !(p.stockMode === 'limited' && !p.useGlobalFlavors && (p.stockQuantity || 0) <= 0));
  } catch (err) {
    console.error('Error fetching random slider products:', err);
  }

  if (allProducts.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Get top 20 most sold products, then shuffle them
  const top20Prods = allProducts
    .sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))
    .slice(0, 20);
  const shuffledProds = top20Prods.sort(() => 0.5 - Math.random());

  container.innerHTML = `
    <div style="padding: 0 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px; border-left: 4px solid var(--color-primary); margin-left: 16px; padding-left: 10px;">
      <h2 style="font-size: 19px; font-weight: 900; letter-spacing: -0.03em; color: var(--color-text-primary); margin: 0;">
        Productos Destacados
      </h2>
      <span style="font-size: 12.5px; color: var(--color-text-tertiary); font-weight: 600; letter-spacing: -0.01em;">Los artículos más vendidos de tus comercios favoritos</span>
    </div>
    <div class="random-products-slider-wrapper">
      <button id="prod-prev-btn" class="categories-arrow-btn prev-btn" style="display: none; position: absolute; left: 4px; top: calc(50% - 21px); z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        ${icon('chevronLeft', 20)}
      </button>
      <div class="random-products-slider" id="random-products-slider">
        ${shuffledProds.map(p => {
          const offer = offers.find(o => o.active !== false && o.comercioId === p.comercioId && o.productIds && o.productIds.includes(p.id));
          const discountPercent = (offer && offer.type === 'percentage') ? (offer.value || 0) : 0;
          const discountedPrice = discountPercent > 0 ? p.price * (1 - discountPercent / 100) : p.price;
          return `
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
                ${discountPercent > 0 ? `
                  <div style="position: absolute; top: 8px; left: 8px; background: var(--color-primary); color: white; padding: 2px 6px; border-radius: 6px; font-size: 8.5px; font-weight: 900; box-shadow: var(--shadow-sm); z-index: 2;">
                    ${discountPercent}% OFF
                  </div>
                ` : ''}
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 0 4px;">
                <span style="font-weight: 850; font-size: 13.5px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 32px; line-height: 1.2;">${p.name}</span>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                  <div style="display: flex; flex-direction: column; gap: 1px;">
                    ${discountPercent > 0 ? `
                      <span style="font-weight: 950; font-size: 14.5px; color: var(--color-primary);">${formatPrice(discountedPrice)}</span>
                      <span style="font-size: 11px; color: var(--color-text-tertiary); text-decoration: line-through; font-weight: 700;">${formatPrice(p.price)}</span>
                    ` : `
                      <span style="font-weight: 950; font-size: 14.5px; color: var(--color-primary);">${formatPrice(p.price)}</span>
                    `}
                  </div>
                  <span style="background: var(--color-primary-light); color: var(--color-primary); width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px;">
                    ${icon('plus', 10, '', 'var(--color-primary)')}
                  </span>
                </div>
              </div>
            </a>
          `;
        }).join('')}
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

async function showJoinCommerceModal() {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');
  const { db } = await import('../firebase.js');
  const { collection, getDocs, addDoc, query, orderBy } = await import('firebase/firestore');
  const { openCropper } = await import('../utils/cropper.js');
  const user = getState().user;

  let platformCategories = [];
  try {
    const platCatsSnap = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
    platformCategories = platCatsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
    if (!platformCategories.some(c => c.name === 'Comida')) {
      platformCategories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
    }
  } catch (err) {
    console.error('Error fetching categories:', err);
    platformCategories = [{ id: 'comida', name: 'Comida', icon: '🍕' }];
  }

  let comercioCoords = null;
  let croppedLogo = '';
  let croppedBanner = '';

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; overflow-y: auto; max-height: 85dvh; color: var(--color-text-primary); background: var(--color-surface); border-top-left-radius: 28px; border-top-right-radius: 28px; border: 1px solid var(--color-border-light);';

  modalContent.innerHTML = `
    <div style="width: 44px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 16px; flex-shrink: 0; opacity: 0.7;"></div>
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="font-family: var(--font-display); font-size: 22px; font-weight: 900; margin: 0; color: var(--color-primary);">🏪 Sumá tu Comercio</h2>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0; line-height: 1.5; font-weight: 600;">Completá el formulario para solicitar la incorporación de tu negocio.</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Nombre del Comercio *</label>
        <input type="text" id="join-com-name" placeholder="Ej: Pizzería Don Pedro" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" />
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Rubro Principal *</label>
        <select id="join-com-cat" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none; color: var(--color-text-primary); box-sizing: border-box;">
          ${platformCategories.map(c => `<option value="${c.name}">${c.icon || ''} ${c.name}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Descripción / Especialidad *</label>
        <input type="text" id="join-com-desc" placeholder="Ej: Las mejores pizzas al molde de la ciudad" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" />
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Teléfono de Contacto *</label>
        <input type="tel" id="join-com-phone" placeholder="Ej: 2221430102" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" />
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Dirección del Local *</label>
        <div style="display: flex; gap: 10px; position: relative; width: 100%;">
          <div style="position: relative; flex: 1;">
            <input type="text" id="join-com-address" placeholder="Ej: Calle 6 nro 123" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" autocomplete="off" />
            <div id="join-com-address-suggestions" style="position: absolute; top: 100%; left: 0; right: 0; background: var(--color-surface); border: 1.5px solid var(--color-border-light); border-radius: 12px; box-shadow: var(--shadow-lg); z-index: 9999; max-height: 180px; overflow-y: auto; margin-top: 4px; display: none;"></div>
          </div>
          <button type="button" id="join-com-map-btn" style="width: 50px; height: 50px; border-radius: 14px; border: none; background: var(--color-primary); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.2);">
            ${icon('mapPin', 20)}
          </button>
        </div>
        <div id="join-com-address-badge" style="display: none; font-size: 11px; font-weight: 700; color: #0d9488; background: rgba(13,148,136,0.05); border: 1px solid rgba(13,148,136,0.15); border-radius: 8px; padding: 6px 10px; align-items: center; gap: 4px; line-height: 1.3; margin-top: 8px; box-sizing: border-box;">
          ${icon('checkCircle', 12)} Dirección verificada en mapa
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Logo *</label>
          <div style="position: relative; width: 100%; height: 90px; border-radius: 14px; border: 2px dashed var(--color-border-light); display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--color-bg-secondary); cursor: pointer; box-sizing: border-box;">
            <img id="join-com-logo-preview" style="width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; opacity: 0.35;" />
            <span id="join-logo-upload-icon" style="position: relative; z-index: 2; font-size: 20px; color: var(--color-text-tertiary);">${icon('upload', 20)}</span>
            <input type="file" accept="image/*" id="join-com-logo-file" style="position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 3;" />
          </div>
        </div>
        <div class="form-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Banner *</label>
          <div style="position: relative; width: 100%; height: 90px; border-radius: 14px; border: 2px dashed var(--color-border-light); display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--color-bg-secondary); cursor: pointer; box-sizing: border-box;">
            <img id="join-com-banner-preview" style="width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; opacity: 0.12;" />
            <span id="join-banner-upload-icon" style="position: relative; z-index: 2; font-size: 20px; color: var(--color-text-tertiary);">${icon('upload', 20)}</span>
            <input type="file" accept="image/*" id="join-com-banner-file" style="position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 3;" />
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 10px;">
        <button id="join-cancel-btn" style="flex: 1; height: 52px; border-radius: 16px; font-weight: 800; font-size: 14px; color: var(--color-text-secondary); border: 1.5px solid var(--color-border-light); background: transparent; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">Cancelar</button>
        <button id="join-submit-btn" style="flex: 2; height: 52px; border-radius: 16px; font-weight: 900; font-size: 14px; background: var(--color-primary); color: white; border: none; box-shadow: 0 6px 18px rgba(225, 29, 72, 0.25); cursor: pointer; transition: all 0.25s;" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 8px 22px rgba(225, 29, 72, 0.35)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 6px 18px rgba(225, 29, 72, 0.25)';">Enviar Solicitud</button>
      </div>
    </div>
  `;

  const { close } = showModal({ title: '', hideHeader: true, height: 'auto', content: modalContent });

  const nameInput = modalContent.querySelector('#join-com-name');
  const catSelect = modalContent.querySelector('#join-com-cat');
  const descInput = modalContent.querySelector('#join-com-desc');
  const phoneInput = modalContent.querySelector('#join-com-phone');
  const addressInput = modalContent.querySelector('#join-com-address');
  const suggestionsDropdown = modalContent.querySelector('#join-com-address-suggestions');
  const badgeEl = modalContent.querySelector('#join-com-address-badge');
  const mapBtn = modalContent.querySelector('#join-com-map-btn');

  const selectLocation = (coords, address) => {
    comercioCoords = coords;
    if (addressInput) addressInput.value = address;
    if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';

    if (badgeEl) {
      badgeEl.style.display = 'flex';
      badgeEl.innerHTML = `${icon('checkCircle', 12)} Dirección verificada: <span style="font-weight:800; margin-left:4px; color:var(--color-text-primary);">${address}</span>`;
    }
  };

  let debounceTimeout;
  addressInput?.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    const term = e.target.value;
    if (term.trim().length < 3) {
      if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const { searchAddressSuggestions } = await import('../utils/geo.js');
        const suggestions = await searchAddressSuggestions(term);
        if (suggestions.length === 0) {
          if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
          return;
        }

        if (suggestionsDropdown) {
          suggestionsDropdown.innerHTML = suggestions.map(s => `
            <div class="suggestion-item" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${s.address}" style="padding:12px 16px; font-size:13px; font-weight:600; color:var(--color-text-primary); cursor:pointer; border-bottom:1px solid var(--color-border-light);">
              ${s.address}
            </div>
          `).join('');
          suggestionsDropdown.style.display = 'block';

          suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.onclick = () => {
              const lat = parseFloat(item.dataset.lat);
              const lng = parseFloat(item.dataset.lng);
              const addr = item.dataset.addr;
              selectLocation({ lat, lng }, addr);
            };
          });
        }
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }, 400);
  });

  mapBtn?.addEventListener('click', async () => {
    try {
      const { showLocationPicker } = await import('../components/location-modal.js');
      showLocationPicker({
        initialCoords: comercioCoords,
        initialAddress: addressInput ? addressInput.value : '',
        onSelect: ({ coords, address }) => {
          selectLocation(coords, address);
        }
      });
    } catch (err) {
      console.error(err);
      showToast('Error al abrir el mapa', 'danger');
    }
  });

  // Handle Logo
  modalContent.querySelector('#join-com-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 1, circular: true });
        croppedLogo = cropped;
        const preview = modalContent.querySelector('#join-com-logo-preview');
        if (preview) {
          preview.src = cropped;
          preview.style.opacity = '1';
        }
        modalContent.querySelector('#join-logo-upload-icon').style.display = 'none';
      } catch (err) {
        console.error('Error cropping logo:', err);
      }
    }
  });

  // Handle Banner
  modalContent.querySelector('#join-com-banner-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 16/8 });
        croppedBanner = cropped;
        const preview = modalContent.querySelector('#join-com-banner-preview');
        if (preview) {
          preview.src = cropped;
          preview.style.opacity = '1';
        }
        modalContent.querySelector('#join-banner-upload-icon').style.display = 'none';
      } catch (err) {
        console.error('Error cropping banner:', err);
      }
    }
  });

  modalContent.querySelector('#join-cancel-btn').onclick = () => close();

  modalContent.querySelector('#join-submit-btn').onclick = async () => {
    const name = nameInput.value.trim();
    const category = catSelect.value.trim();
    const description = descInput.value.trim();
    const phone = phoneInput.value.trim();
    const address = addressInput.value.trim();

    if (!name || !category || !description || !phone || !address || !comercioCoords || !croppedLogo || !croppedBanner) {
      showToast('Por favor, completa todos los campos (incluyendo mapa, logo y banner).', 'warning');
      return;
    }

    const submitBtn = modalContent.querySelector('#join-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Enviando...';

    try {
      await addDoc(collection(db, 'comercios'), {
        name,
        category,
        description,
        deliveryCost: 0,
        deliveryTime: 30,
        phone,
        address,
        coords: comercioCoords,
        logo: croppedLogo,
        banner: croppedBanner,
        ownerId: user.uid,
        isActive: false, // Visibility deactivated by default
        approvedByAdmin: false, // Awaiting admin approval
        createdAt: new Date()
      });
      showToast('Solicitud enviada con éxito. Aguarda la aprobación del admin.', 'success');
      close();
    } catch (err) {
      console.error('Error submitting commerce request:', err);
      showToast('Error al enviar la solicitud. Intenta nuevamente.', 'danger');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Enviar Solicitud';
    }
  };
}

async function showJoinTeamModal() {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');
  const { db } = await import('../firebase.js');
  const { collection, addDoc } = await import('firebase/firestore');

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; overflow-y: auto; max-height: 85dvh; color: var(--color-text-primary); background: var(--color-surface); border-top-left-radius: 28px; border-top-right-radius: 28px; border: 1px solid var(--color-border-light);';

  let licenseBase64 = '';
  let insuranceBase64 = '';

  modalContent.innerHTML = `
    <div style="width: 44px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 16px; flex-shrink: 0; opacity: 0.7;"></div>
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="font-family: var(--font-display); font-size: 22px; font-weight: 900; color: var(--color-primary); margin: 0;">💼 Sumate al Equipo</h2>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0; line-height: 1.5; font-weight: 600;">Completá el formulario con tus datos para postularte.</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">¿Qué rol te interesa? *</label>
        <select id="join-team-role" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none; color: var(--color-text-primary); box-sizing: border-box;">
          <option value="">Seleccionar rol...</option>
          <option value="delivery">Repartidor (Delivery)</option>
          <option value="driver">Chofer (Moto/Auto)</option>
          <option value="both">Ambos roles</option>
        </select>
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Nombre Completo *</label>
        <input type="text" id="join-team-name" placeholder="Ej: Juan Pérez" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" />
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Teléfono de Contacto *</label>
        <input type="tel" id="join-team-phone" placeholder="Ej: +54 9 11 1234-5678" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" />
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Email de Contacto *</label>
        <input type="email" id="join-team-email" placeholder="Ej: juan.perez@gmail.com" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box;" />
      </div>

      <div id="join-team-vehicle-section" style="display: none; flex-direction: column; gap: 20px; padding: 16px; border: 1.5px dashed var(--color-border-light); border-radius: 16px; background: var(--color-bg-secondary);">
        <div class="form-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Tipo de Vehículo *</label>
          <select id="join-team-vehicle-type" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-surface) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none; color: var(--color-text-primary); box-sizing: border-box;">
          </select>
        </div>

        <div class="form-group" id="join-team-plate-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Patente del Vehículo *</label>
          <input type="text" id="join-team-vehicle-plate" placeholder="Ej: AA123BB o ABC123" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-surface); color: var(--color-text-primary); box-sizing: border-box; text-transform: uppercase;" />
        </div>

        <div class="form-group" id="join-team-model-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Modelo del Vehículo (Marca, Modelo, Año) *</label>
          <input type="text" id="join-team-vehicle-model" placeholder="Ej: Honda Wave 110cc 2021" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-surface); color: var(--color-text-primary); box-sizing: border-box;" />
        </div>

        <div class="form-group" id="join-team-license-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Foto de la Licencia de Conducir *</label>
          <div style="display: flex; gap: 12px; align-items: center;">
            <label style="flex: 1; height: 46px; border-radius: 12px; border: 1.5px dashed var(--color-border); background: var(--color-surface); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s;">
              ${icon('camera', 16)} Seleccionar Foto
              <input type="file" id="join-team-license-file" accept="image/*" style="display: none;" />
            </label>
            <div id="join-team-license-preview" style="width: 46px; height: 46px; border-radius: 10px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); display: none; background-size: cover; background-position: center; flex-shrink: 0;"></div>
          </div>
        </div>

        <div class="form-group" id="join-team-insurance-group">
          <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Foto del Seguro del Vehículo *</label>
          <div style="display: flex; gap: 12px; align-items: center;">
            <label style="flex: 1; height: 46px; border-radius: 12px; border: 1.5px dashed var(--color-border); background: var(--color-surface); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; transition: all 0.2s;">
              ${icon('camera', 16)} Seleccionar Foto
              <input type="file" id="join-team-insurance-file" accept="image/*" style="display: none;" />
            </label>
            <div id="join-team-insurance-preview" style="width: 46px; height: 46px; border-radius: 10px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); display: none; background-size: cover; background-position: center; flex-shrink: 0;"></div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label style="display: block; font-size: 11px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Comentarios / Experiencia Laboral</label>
        <textarea id="join-team-notes" placeholder="Contanos brevemente tu experiencia anterior o algún detalle de interés..." style="width: 100%; height: 100px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 12px 16px; font-weight: 600; font-size: 14px; outline: none; background: var(--color-bg-secondary); color: var(--color-text-primary); box-sizing: border-box; font-family: var(--font-body); resize: none;"></textarea>
      </div>

      <button id="submit-application-btn" style="width: 100%; height: 52px; border-radius: 16px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2); transition: all 0.2s;">
        Enviar Postulación
      </button>
    </div>
  `;

  const roleSelect = modalContent.querySelector('#join-team-role');
  const vehicleSection = modalContent.querySelector('#join-team-vehicle-section');
  const vehicleTypeSelect = modalContent.querySelector('#join-team-vehicle-type');
  const plateGroup = modalContent.querySelector('#join-team-plate-group');
  const modelGroup = modalContent.querySelector('#join-team-model-group');
  const licenseGroup = modalContent.querySelector('#join-team-license-group');
  const insuranceGroup = modalContent.querySelector('#join-team-insurance-group');

  const setupImageUpload = (fileInputId, previewId, onSetBase64) => {
    const input = modalContent.querySelector(`#${fileInputId}`);
    const preview = modalContent.querySelector(`#${previewId}`);
    if (input && preview) {
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const base64 = evt.target.result;
            preview.style.backgroundImage = `url(${base64})`;
            preview.style.display = 'block';
            onSetBase64(base64);
          };
          reader.readAsDataURL(file);
        }
      };
    }
  };

  setupImageUpload('join-team-license-file', 'join-team-license-preview', (base64) => { licenseBase64 = base64; });
  setupImageUpload('join-team-insurance-file', 'join-team-insurance-preview', (base64) => { insuranceBase64 = base64; });

  roleSelect.onchange = () => {
    const role = roleSelect.value;
    if (role === 'delivery') {
      vehicleSection.style.display = 'flex';
      vehicleTypeSelect.innerHTML = `
        <option value="moto">🚴‍♂️ Moto</option>
        <option value="bici">🚲 Bicicleta</option>
        <option value="auto">🚗 Auto</option>
      `;
      toggleVehicleFields();
    } else if (role === 'driver') {
      vehicleSection.style.display = 'flex';
      vehicleTypeSelect.innerHTML = `
        <option value="moto">🚴‍♂️ Moto</option>
        <option value="auto">🚗 Auto</option>
      `;
      toggleVehicleFields();
    } else if (role === 'both') {
      vehicleSection.style.display = 'flex';
      vehicleTypeSelect.innerHTML = `
        <option value="moto">🚴‍♂️ Moto</option>
        <option value="auto">🚗 Auto</option>
        <option value="camioneta">🛻 Camioneta</option>
      `;
      toggleVehicleFields();
    } else {
      vehicleSection.style.display = 'none';
    }
  };

  vehicleTypeSelect.onchange = () => {
    toggleVehicleFields();
  };

  function toggleVehicleFields() {
    const isBici = vehicleTypeSelect.value === 'bici';
    if (isBici) {
      plateGroup.style.display = 'none';
      modelGroup.style.display = 'none';
      licenseGroup.style.display = 'none';
      insuranceGroup.style.display = 'none';
    } else {
      plateGroup.style.display = 'block';
      modelGroup.style.display = 'block';
      licenseGroup.style.display = 'block';
      insuranceGroup.style.display = 'block';
    }
  }

  const submitBtn = modalContent.querySelector('#submit-application-btn');
  submitBtn.onclick = async () => {
    const role = roleSelect.value;
    const name = modalContent.querySelector('#join-team-name').value.trim();
    const phone = modalContent.querySelector('#join-team-phone').value.trim();
    const email = modalContent.querySelector('#join-team-email').value.trim();
    const notes = modalContent.querySelector('#join-team-notes').value.trim();

    if (!role || !name || !phone || !email) {
      showToast('Por favor, completa todos los campos obligatorios (*)', 'warning');
      return;
    }

    let vehicleType = '';
    let vehiclePlate = '';
    let vehicleModel = '';

    if (role !== '') {
      vehicleType = vehicleTypeSelect.value;
      if (vehicleType !== 'bici') {
        vehiclePlate = modalContent.querySelector('#join-team-vehicle-plate').value.trim();
        vehicleModel = modalContent.querySelector('#join-team-vehicle-model').value.trim();
        if (!vehiclePlate || !vehicleModel) {
          showToast('Por favor, completa los datos del vehículo', 'warning');
          return;
        }
        if (!licenseBase64) {
          showToast('Por favor, sube la foto de tu licencia de conducir', 'warning');
          return;
        }
        if (!insuranceBase64) {
          showToast('Por favor, sube la foto del seguro del vehículo', 'warning');
          return;
        }
      }
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-mini" style="border-color: white; border-top-color: transparent;"></span> Enviando...';

    try {
      await addDoc(collection(db, 'job_applications'), {
        userId: getState().user?.uid || '',
        role,
        name,
        phone,
        email,
        notes,
        vehicleType,
        vehiclePlate: vehiclePlate.toUpperCase(),
        vehicleModel,
        licensePhoto: licenseBase64,
        insurancePhoto: insuranceBase64,
        status: 'pending',
        createdAt: new Date()
      });

      showToast('¡Postulación enviada con éxito!', 'success');
      closeModal();
    } catch (e) {
      console.error('[Apply] Error saving application:', e);
      showToast('Error al enviar la postulación. Intentalo de nuevo.', 'danger');
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Enviar Postulación';
    }
  };

  showModal({
    title: 'Trabajar con Nosotros',
    content: modalContent,
    height: 'auto'
  });
}

async function showMandadosOverlayModal() {
  const { showModal, closeModal, showConfirm } = await import('../components/modal.js');

  const contentEl = document.createElement('div');
  contentEl.style.cssText = `
    padding: 12px 16px calc(20px + env(safe-area-inset-bottom, 24px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: linear-gradient(to bottom, var(--color-bg), var(--color-bg-secondary));
    box-sizing: border-box;
    width: 100%;
  `;

  contentEl.innerHTML = `
    <!-- Options List -->
    <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
      <!-- Option 1: Encomienda -->
      <div id="modal-favor-mandado-btn" class="gofavores-card card-encomienda glow-hover spring-hover" style="border-radius: 18px; padding: 16px; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); transition: all 0.2s;">
        <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%); pointer-events: none;"></div>
        <div style="text-align: left; z-index: 2; width: 100%;">
          <h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; margin: 0 0 4px; color: #ffffff; letter-spacing: -0.02em;">Encomienda</h3>
          <p style="font-size: 11.5px; color: rgba(255, 255, 255, 0.95); line-height: 1.4; margin: 0 0 10px 0; font-weight: 600;">Buscamos y llevamos lo que necesites donde nos digas.</p>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; box-sizing: border-box;">
            <span style="display: inline-flex; align-items: center; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
              Costo normal de envío
            </span>
            <span id="modal-info-mandado-btn" style="color: #ffffff; font-size: 11.5px; font-weight: 800; text-decoration: underline; cursor: pointer; padding: 2px 6px;">Más info</span>
          </div>
        </div>
      </div>

      <!-- Option 2: Mandado -->
      <div id="modal-favor-compra-btn" class="gofavores-card card-mandado glow-hover spring-hover" style="border-radius: 18px; padding: 16px; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); transition: all 0.2s;">
        <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%); pointer-events: none;"></div>
        <div style="text-align: left; z-index: 2; width: 100%;">
          <h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; margin: 0 0 4px; color: #ffffff; letter-spacing: -0.02em;">Mandado</h3>
          <p style="font-size: 11.5px; color: rgba(255, 255, 255, 0.95); line-height: 1.4; margin: 0 0 10px 0; font-weight: 600;">Compramos lo que necesites en cualquier negocio local.</p>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; box-sizing: border-box;">
            <span style="display: inline-flex; align-items: center; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
              Tarifa de gestión
            </span>
            <span id="modal-info-compra-btn" style="color: #ffffff; font-size: 11.5px; font-weight: 800; text-decoration: underline; cursor: pointer; padding: 2px 6px;">Más info</span>
          </div>
        </div>
      </div>

      <!-- Option 3: Go Cash -->
      <div id="modal-favor-gocash-btn" class="gofavores-card card-gocash glow-hover spring-hover" style="border-radius: 18px; padding: 16px; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.015); transition: all 0.2s;">
        <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 60%); pointer-events: none;"></div>
        <div style="text-align: left; z-index: 2; width: 100%;">
          <h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 900; margin: 0 0 4px; color: #ffffff; letter-spacing: -0.02em;">Go Cash</h3>
          <p style="font-size: 11.5px; color: rgba(255, 255, 255, 0.95); line-height: 1.4; margin: 0 0 10px 0; font-weight: 600;">Cambiá efectivo por transferencia o viceversa.</p>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; box-sizing: border-box;">
            <span style="display: inline-flex; align-items: center; background: rgba(255, 255, 255, 0.2); padding: 3px 8px; border-radius: 6px; color: #ffffff; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid rgba(255, 255, 255, 0.25);">
              Efectivo ↔ Transferencia
            </span>
            <span id="modal-info-gocash-btn" style="color: #ffffff; font-size: 11.5px; font-weight: 800; text-decoration: underline; cursor: pointer; padding: 2px 6px;">Más info</span>
          </div>
        </div>
      </div>
    </div>
    
    <style>
      .card-encomienda { background: linear-gradient(135deg, #059669 0%, #10B981 100%) !important; border-color: rgba(16,185,129,0.3) !important; box-shadow: 0 8px 20px rgba(16,185,129,0.15) !important; }
      .card-mandado { background: linear-gradient(135deg, #E11D48 0%, #F43F5E 100%) !important; border-color: rgba(244,63,94,0.3) !important; box-shadow: 0 8px 20px rgba(244,63,94,0.15) !important; }
      .card-gocash { background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%) !important; border-color: rgba(99,102,241,0.3) !important; box-shadow: 0 8px 20px rgba(99,102,241,0.15) !important; }
      [data-theme="dark"] .card-encomienda { background: linear-gradient(135deg, #064e3b 0%, #047857 100%) !important; }
      [data-theme="dark"] .card-mandado { background: linear-gradient(135deg, #7f1d1d 0%, #E11D48 100%) !important; }
      [data-theme="dark"] .card-gocash { background: linear-gradient(135deg, #312e81 0%, #4338ca 100%) !important; }
      .gofavores-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12) !important; }
      .gofavores-card:active { transform: translateY(0) scale(0.98); }
    </style>
  `;

  showModal({
    title: '<div style="margin-top: 14px; font-weight: 950; font-size: 16.5px; letter-spacing: -0.02em;">Mandados (Servicios Especiales)</div>',
    height: 'auto',
    content: contentEl,
    onOpen: async () => {
      let goFav;
      try {
        goFav = await import('./gofavores.js');
      } catch (err) {
        console.error('Failed to load gofavores module, reloading to get latest build...', err);
        const { showToast } = await import('../components/toast.js');
        showToast('Actualizando aplicación...', 'info');
        setTimeout(() => { window.location.reload(); }, 600);
        return;
      }
      const { showMandadoForm, showCompraForm, showGoCashForm, showServiceInfoModal } = goFav;
      const { getState } = await import('../state.js');

      const checkPhoneAndOpen = (openFn) => {
        const u = getState().user || {};
        if (!u.phone || u.phone.trim() === '') {
          showConfirm({
            title: '📱 Teléfono Requerido',
            message: 'Para realizar un favor o mandado es obligatorio configurar un celular de contacto para que el chofer y el soporte se comuniquen.',
            confirmText: 'Configurar ahora',
            cancelText: 'Volver',
            onConfirm: () => {
              sessionStorage.setItem('open-phone-edit', 'true');
              location.hash = '#/profile';
            }
          });
        } else {
          closeModal();
          setTimeout(() => {
            openFn();
          }, 250);
        }
      };

      document.getElementById('modal-favor-mandado-btn').onclick = (e) => {
        if (e.target.id === 'modal-info-mandado-btn') return;
        checkPhoneAndOpen(showMandadoForm);
      };
      document.getElementById('modal-favor-compra-btn').onclick = (e) => {
        if (e.target.id === 'modal-info-compra-btn') return;
        checkPhoneAndOpen(showCompraForm);
      };
      document.getElementById('modal-favor-gocash-btn').onclick = (e) => {
        if (e.target.id === 'modal-info-gocash-btn') return;
        checkPhoneAndOpen(showGoCashForm);
      };

      document.getElementById('modal-info-mandado-btn').onclick = (e) => { e.stopPropagation(); showServiceInfoModal('encomienda'); };
      document.getElementById('modal-info-compra-btn').onclick = (e) => { e.stopPropagation(); showServiceInfoModal('mandado'); };
      document.getElementById('modal-info-gocash-btn').onclick = (e) => { e.stopPropagation(); showServiceInfoModal('gocash'); };
    }
  });
}

async function checkAndShowAppOnlyPromo() {
  const user = getState().user;
  if (!user) return;

  const promoShown = sessionStorage.getItem('gd_app_only_promo_shown');
  if (promoShown === 'true') return;

  // Defer if welcome beta, onboarding, or tutorial guides are active or not completed
  const welcomeBetaDone = localStorage.getItem('welcome_beta_v1') === 'true';
  const onboardingDone = localStorage.getItem('gd-onboarding-done') === 'true';
  const appGuideDone = localStorage.getItem('gd-app-guide-seen-v2') === 'true';
  const welcomeActive = document.getElementById('welcome-beta-modal-overlay') 
    || document.getElementById('onboarding-container') 
    || document.getElementById('app-guide-overlay')
    || document.querySelector('.delivery-map-modal-v4');

  if (!welcomeBetaDone || !onboardingDone || !appGuideDone || welcomeActive) {
    setTimeout(checkAndShowAppOnlyPromo, 1000);
    return;
  }

  const renderModal = async (product, offers, comercioId, isFromCache = false) => {
    // If already shown during this session, bypass unless it is the cached trigger
    if (sessionStorage.getItem('gd_app_only_promo_shown') === 'true' && !isFromCache) return;
    sessionStorage.setItem('gd_app_only_promo_shown', 'true');

    const offer = offers.find(o => o.active !== false && (o.targetProductId === product.id || (o.productIds && o.productIds.includes(product.id))));
    const discountPercent = (offer && offer.type === 'percentage') ? (offer.value || 0) : 0;
    const discountedPrice = discountPercent > 0 ? product.price * (1 - discountPercent / 100) : product.price;

    const { doc, getDoc } = await import('firebase/firestore');
    let comercioName = 'Comercio';
    try {
      const comSnap = await getDoc(doc(db, 'comercios', comercioId));
      if (comSnap.exists()) {
        comercioName = comSnap.data().name || 'Comercio';
      }
    } catch (e) {
      console.error(e);
    }

    const overlayId = `app-only-promo-overlay-${Math.random().toString(36).substr(2, 9)}`;
    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(5px);
      -webkit-backdrop-filter: blur(5px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: fadeIn 0.25s ease-out forwards;
    `;

    overlay.innerHTML = `
      <div id="${overlayId}-card" style="
        background: var(--color-bg);
        border-radius: 28px;
        width: 100%;
        max-width: 380px;
        max-height: calc(100dvh - 32px);
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
        display: flex;
        flex-direction: column;
        position: relative;
        animation: zoomIn 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.15) forwards;
      ">
        <button id="${overlayId}-close-btn" style="
          position: absolute;
          top: 16px;
          right: 16px;
          border: none;
          background: rgba(0, 0, 0, 0.05);
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--color-text-secondary);
          z-index: 10;
          transition: all 0.2s;
        ">
          ${icon('close', 18)}
        </button>

        <div style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 24px 20px 20px; gap: 16px; width: 100%; box-sizing: border-box;">
          <div style="font-size: 50px; animation: bouncePromo 2s infinite; line-height: 1;">📱</div>
          
          <div>
            <span style="font-size: 11px; font-weight: 900; color: #7e22ce; background: rgba(126, 34, 206, 0.08); padding: 4px 10px; border-radius: 20px; border: 1.5px solid rgba(126, 34, 206, 0.15); text-transform: uppercase; font-family: var(--font-display);">¡Exclusivo en la App!</span>
            <h2 style="font-family: var(--font-display); font-weight: 850; font-size: 19px; color: var(--color-text-primary); margin: 12px 0 6px;">${product.name}</h2>
            <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;">Disponible de forma exclusiva en nuestra plataforma. ¡Pedilo ahora en <b>${comercioName}</b>!</p>
          </div>

          ${product.image ? `
            <div style="width: 100%; height: 160px; border-radius: 18px; overflow: hidden; border: 1px solid var(--color-border-light); background: #f8fafc; position: relative;">
              <img src="${product.image}" alt="${product.name}" style="width: 100%; height: 100%; object-fit: cover;" />
              ${discountPercent > 0 ? `
                <div style="position: absolute; top: 10px; right: 10px; background: var(--color-primary); color: white; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 900; box-shadow: var(--shadow-sm); z-index: 2; text-transform: uppercase;">
                  ${discountPercent}% OFF
                </div>
              ` : ''}
            </div>
          ` : ''}

          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            ${discountPercent > 0 ? `
              <span style="font-size: 24px; font-weight: 950; color: var(--color-primary); font-family: var(--font-display);">${formatPrice(discountedPrice)}</span>
              <span style="font-size: 14px; color: var(--color-text-tertiary); text-decoration: line-through; font-weight: 700;">${formatPrice(product.price)}</span>
            ` : `
              <span style="font-size: 24px; font-weight: 950; color: var(--color-primary); font-family: var(--font-display);">${formatPrice(product.price)}</span>
            `}
          </div>

          <button id="${overlayId}-action-btn" class="btn btn-primary" style="width: 100%; height: 50px; border-radius: 14px; font-weight: 900; font-size: 13.5px; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(126, 34, 206, 0.25); margin: 0;">
            VER PRODUCTO E IR A LA TIENDA
          </button>
        </div>
      </div>

      <style>
        @keyframes bouncePromo {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoomIn {
          from { transform: scale(0.9) translateY(10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
      </style>
    `;

    document.body.appendChild(overlay);

    window.history.pushState({ isAppOnlyOverlay: overlayId }, '');

    const closeOverlay = () => {
      const el = document.getElementById(overlayId);
      if (el) {
        const card = document.getElementById(`${overlayId}-card`);
        if (card) {
          card.style.transition = 'transform 0.25s ease-in, opacity 0.2s ease-in';
          card.style.transform = 'scale(0.9) translateY(10px)';
          card.style.opacity = '0';
        }
        el.style.transition = 'opacity 0.25s ease-in';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 250);
      }
      window.removeEventListener('popstate', handlePopState);
    };

    const handlePopState = (e) => {
      if (e.state && e.state.isAppOnlyOverlay === overlayId) return;
      closeOverlay();
    };
    window.addEventListener('popstate', handlePopState);

    document.getElementById(`${overlayId}-close-btn`).onclick = () => {
      window.history.back();
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        window.history.back();
      }
    };

    document.getElementById(`${overlayId}-action-btn`).onclick = () => {
      closeOverlay();
      location.hash = `#/comercio/${comercioId}?product=${product.id}`;
    };
  };

  // 1. Render instantly using local cache if available
  let shownFromCache = false;
  try {
    const cachedProductsRaw = localStorage.getItem('gd_cached_only_in_app');
    const cachedOffersRaw = localStorage.getItem('gd_cached_offers');
    if (cachedProductsRaw) {
      const cachedProducts = JSON.parse(cachedProductsRaw);
      const cachedOffers = cachedOffersRaw ? JSON.parse(cachedOffersRaw) : [];
      if (cachedProducts && cachedProducts.length > 0) {
        const randomProduct = cachedProducts[Math.floor(Math.random() * cachedProducts.length)];
        if (randomProduct && randomProduct.comercioId) {
          shownFromCache = true;
          renderModal(randomProduct, cachedOffers, randomProduct.comercioId, true);
        }
      }
    }
  } catch (e) {
    console.warn('Error loading app-only promo from local cache:', e);
  }

  // 2. Query fresh database data in the background and update cache silently
  try {
    const { collectionGroup, getDocs, query, where, collection } = await import('firebase/firestore');
    const qAppOnly = query(collectionGroup(db, 'products'), where('onlyInApp', '==', true));
    
    const [snap, offersSnap] = await Promise.all([
      getDocs(qAppOnly),
      getDocs(query(collection(db, 'offers'), where('active', '==', true)))
    ]);

    const validDocs = snap.docs.filter(d => {
      const data = d.data();
      const isOutOfStock = data.stockMode === 'limited' && (data.stockQuantity || 0) <= 0;
      return data.onlyInApp === true && data.isAvailable !== false && !isOutOfStock;
    });

    if (validDocs.length === 0) return;

    const freshProducts = validDocs.map(docSnap => {
      const pathParts = docSnap.ref.path.split('/');
      const comercioId = pathParts[1];
      return { id: docSnap.id, comercioId, ...docSnap.data() };
    });

    const freshOffers = offersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Overwrite cache silently
    try {
      localStorage.setItem('gd_cached_only_in_app', JSON.stringify(freshProducts));
      localStorage.setItem('gd_cached_offers', JSON.stringify(freshOffers));
    } catch (e) {}

    // If first launch (no cache), render the modal now
    if (!shownFromCache) {
      const randomProduct = freshProducts[Math.floor(Math.random() * freshProducts.length)];
      if (randomProduct && randomProduct.comercioId) {
        renderModal(randomProduct, freshOffers, randomProduct.comercioId, false);
      }
    }
  } catch (err) {
    console.error('Error fetching fresh app-only products:', err);
  }
}
