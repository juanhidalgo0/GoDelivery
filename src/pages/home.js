// GoDelivery — Home Page
import { db } from '../firebase.js';
import { collection, getDocs, query, where, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { getFooterHTML } from '../components/footer.js';
import { isAdmin, isSuperAdmin, isComercio, isLoggedIn } from '../auth.js';
import { icon, categoryIcon, CATEGORY_ICON_MAP, CATEGORY_PHOSPHOR_MAP } from '../utils/icons.js';
import { getState, subscribe } from '../state.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';



export async function renderHome(content) {
  if (!content) content = document.getElementById('page-home') || document.getElementById('app-content');
  if (!content) return;

  const loggedIn = isLoggedIn();

  // Show skeleton first
  content.innerHTML = `
    <div class="home-page" style="padding-top: 8px; position: relative; overflow: hidden;">
      <!-- Ambient Background Blobs (Soft Glows) -->
      <div class="home-blob home-blob-1"></div>
      <div class="home-blob home-blob-2"></div>
      
      <!-- Premium Category Grid (Restaurantes & GoMarket) -->
      <div class="category-grid" style="margin-top: 16px; margin-bottom: 24px;">
        <a href="#/category/Comida" class="category-card-large">
          <img src="/images/categories/restaurants.png" alt="Restaurantes" />
          <span class="card-title">Restaurantes</span>
        </a>
        <a href="#/category/GoMarket" class="category-card-large">
          <img src="/images/categories/gomarket.png" alt="GoMarket" />
          <span class="card-title">GoMarket</span>
        </a>
        
        <!-- GoFavor Premium Card for Desktop -->
        <a href="#/gofavores" class="category-card-large gofavor-card-desktop" style="display: none; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); flex-direction: column; justify-content: center; align-items: center; padding: 20px !important; text-align: center; gap: 8px; border: 1px solid rgba(255,255,255,0.15) !important; text-decoration: none; position: relative; overflow: hidden; border-radius: 24px;">
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          <div style="position: absolute; bottom: -10px; left: -10px; width: 40px; height: 40px; background: rgba(255,255,255,0.04); border-radius: 50%;"></div>
          
          <div style="width: 52px; height: 52px; border-radius: 50%; background: black; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 6px 16px rgba(0,0,0,0.3); border: 2px solid rgba(255,255,255,0.25); overflow: hidden; z-index: 2;">
            <img src="${getState().goMarketLogo || '/logo.png'}" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
          
          <div style="z-index: 2;">
            <span style="background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 8px; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-bottom: 4px; color: white;">Servicio Oficial</span>
            <h3 style="font-family: var(--font-display); font-size: 21px; font-weight: 950; margin: 0; color: white; letter-spacing: -0.02em; line-height: 1.1;">GoFavor</h3>
            <p style="font-size: 11.5px; font-weight: 700; color: rgba(255,255,255,0.9); margin: 2px 0 0; line-height: 1.2;">¿Necesitás algo más? <br/>Pedilo acá y nosotros vamos.</p>
          </div>
        </a>
      </div>

      <!-- Recurrent Orders (1-Click Repeat) Section -->
      <div id="recurrent-orders-section" style="margin-top: 12px; margin-bottom: 24px; padding: 0 16px; display: none;"></div>

      <!-- Small Categories Slider Section -->
      <div class="categories-slider-wrapper" style="position: relative; margin-top: 10px; display: flex; align-items: center; width: 100%;">
        <button id="cat-prev-btn" class="categories-arrow-btn prev-btn" style="display: none; position: absolute; left: 4px; z-index: 10; width: 42px; height: 42px; border-radius: 50%; background: var(--color-surface); border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
          ${icon('chevronLeft', 20)}
        </button>
        <div class="category-row-small" id="categories-row-small" style="flex: 1; display: flex; gap: 12px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; -ms-overflow-style: none; padding: 12px 4px;">
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
      <div id="brands-slider-container" style="margin-top: 12px; margin-bottom: 24px;"></div>

      <!-- Promoted Section -->
      <div id="promoted-section" style="margin-top: 12px; margin-bottom: 24px;"></div>

      <!-- Offers Section -->
      <div id="offers-section" style="margin-top: 12px; margin-bottom: 24px;"></div>

      <!-- GoFavor Banner (Red Edition - Mobile Only) -->
      <a href="#/gofavores" class="gofavor-banner-mobile" style="margin: 20px 16px; padding: 26px; border-radius: 32px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: white; display: flex; align-items: center; gap: 20px; box-shadow: 0 12px 35px rgba(var(--color-primary-rgb), 0.3); position: relative; overflow: hidden; cursor: pointer; text-decoration:none; border: 1px solid rgba(255,255,255,0.1);">
        <div style="position: absolute; top: -40px; right: -40px; width: 140px; height: 140px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
        <div style="position: absolute; bottom: -20px; left: 100px; width: 60px; height: 60px; background: rgba(255,255,255,0.04); border-radius: 50%;"></div>
        
        <div style="width: 68px; height: 68px; border-radius: 50%; background: black; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 8px 25px rgba(0,0,0,0.25); border: 2px solid rgba(255,255,255,0.2); overflow: hidden;">
          <img src="${getState().goMarketLogo || '/logo.png'}" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
        
        <div style="flex: 1; position: relative; z-index: 2;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 5px;">
            <span style="background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 10px; font-size: 10.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em;">Servicio Oficial</span>
          </div>
          <h3 style="font-family: var(--font-display); font-size: 26px; font-weight: 950; margin: 0; letter-spacing: -0.04em;">GoFavor</h3>
          <p style="font-size: 14.5px; font-weight: 700; opacity: 0.95; margin: 2px 0 0; line-height: 1.3; letter-spacing: -0.01em;">¿Necesitás algo más? <br/>Pedilo acá y nosotros vamos.</p>
        </div>
        
        <div style="width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          ${icon('zap', 22)}
        </div>
      </a>

      <!-- Main Content -->
      <div class="home-section" style="margin-top: 24px;">
        <h2 class="home-section-title" style="display:flex; align-items:center; gap:8px; font-size:15px; font-weight:900; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-tertiary); margin-bottom:16px; padding:0 16px;">
          ${icon('store', 16)} Todos los comercios
        </h2>
        <div class="comercios-grid" id="comercios-grid" style="padding: 0 16px;">
          ${renderSkeletonCards(4)}
        </div>
      </div>
      
      ${getFooterHTML()}
    </div>
  `;

  // Load data
  let categories = [];
  let comercios = [];
  let activeCategory = 'Todos';

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

    // Load active comercios (TTL = 15 minutes / 900000 ms)
    const comSnap = await getDocsOptimized(query(collection(db, 'comercios'), where('isActive', '==', true)), 'activeComercios', 900000);
    comercios = comSnap.docs.map(doc => {
      const data = doc.data();
      const name = (data.name || '').toLowerCase();
      if (name.includes('go!') && name.includes('market')) {
        return { id: doc.id, ...data, logo: '/logo.png' };
      }
      return { id: doc.id, ...data };
    });

    // Render brands slider
    renderBrandsSlider(comercios);

    // Render promoted section (Ads)
    await renderPromotedSection(comercios);

    // Load active offers (TTL = 5 minutes / 300000 ms)
    const offersSnap = await getDocsOptimized(query(collection(db, 'offers'), where('active', '==', true)), 'activeOffers', 300000);
    let offers = offersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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

    if (offers.length === 0 && comercios.length > 0) {
      offers = [
        {
          id: 'mock-offer-1',
          comercioId: comercios[0].id,
          comercioName: comercios[0].name,
          title: '¡Promo especial de bienvenida!',
          type: 'percentage',
          value: 15,
          banner: comercios[0].banner || comercios[0].logo,
          productIds: [],
          active: true
        }
      ];
    }
    renderOffersSection(offers, comercios);

    // Add GoMarket to categories if it exists as a concept
    if (!categories.some(c => c.name === 'GoMarket')) {
      categories.push({ id: 'gomarket', name: 'GoMarket', icon: 'shoppingBag', order: 0 });
    }

  } catch (e) {
    console.error('Error loading home data:', e);
    // Use default categories as fallback
    if (categories.length === 0) {
      const defaultNames = ['Súper', 'Farmacia', 'Kiosco', 'Almacén', 'Carnicería', 'Verdulería', 'Librería', 'Ferretería', 'Mascotas'];
      categories = defaultNames.map((name, i) => ({ id: name, name, icon: '', order: i }));
    }
  }

  // Render categories
  renderCategories(categories, activeCategory);
  renderComercios(comercios, activeCategory, '');

  // Render recurrent orders if logged in
  const user = getState().user;
  const recurrentContainer = document.getElementById('recurrent-orders-section');
  if (recurrentContainer) {
    renderRecurrentOrders(user, recurrentContainer);
  }

  // Dynamic link for GoMarket
  try {
    const goMarket = comercios.find(c => {
      const n = (c.name || '').toLowerCase();
      return n.includes('go!') && n.includes('market');
    });
    if (goMarket) {
      content.querySelectorAll('a[href="#/category/GoMarket"]').forEach(link => {
        link.href = `#/comercio/${goMarket.id}`;
      });
    }
  } catch (err) {
    console.warn('Error linking GoMarket:', err);
  }



  // Search handler (Global Header Search)
  const searchInput = document.getElementById('header-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderComercios(comercios, activeCategory, e.target.value);
    });
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

  container.innerHTML = `
    <div style="overflow-x: auto; display: flex; gap: 14px; padding: 4px 16px; -webkit-overflow-scrolling: touch;">
      ${brands.map(brand => `
        <a href="#/comercio/${brand.id}" style="flex: 0 0 64px; text-decoration: none; display: flex; flex-direction: column; align-items: center; gap: 6px;">
          <div style="width: 64px; height: 64px; border-radius: 50%; overflow: hidden; background: white; border: 1px solid var(--color-border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; transition: transform 0.2s ease;">
            <img src="${brand.logo}" alt="${brand.name}" style="width: 78%; height: 78%; object-fit: contain; border-radius: 50%;" />
          </div>
        </a>
      `).join('')}
    </div>
    <style>
      #brands-slider-container div::-webkit-scrollbar { display: none; }
      #brands-slider-container div a div:active { transform: scale(0.92); }
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

  // Add custom ads
  activeCustomAds.forEach(ad => {
    unifiedPromoted.push({
      id: ad.id,
      isCustom: true,
      name: ad.title || 'Anuncio Especial',
      banner: ad.banner,
      label: ad.label || 'Oficial',
      link: ad.link || '',
      logo: '/logo.png',
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
    <h2 class="home-section-title" style="padding: 0 16px; margin-bottom: 12px; font-size: 20px; font-weight: 800; color: var(--color-text-primary);">Descubrí estas opciones</h2>
    <div style="overflow-x: auto; display: flex; gap: 16px; padding: 0 16px 16px; -webkit-overflow-scrolling: touch;">
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
    <h2 class="home-section-title" style="padding: 0 16px; margin-bottom: 12px; font-size: 20px; font-weight: 800; color: var(--color-text-primary);">Ofertas y Promociones</h2>
    <div style="overflow-x: auto; display: flex; gap: 16px; padding: 0 16px 16px; -webkit-overflow-scrolling: touch;">
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

function renderComercios(comercios, category, search) {
  const grid = document.getElementById('comercios-grid');
  if (!grid) return;

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
        <div class="empty-state-text">${search ? 'Probá con otra búsqueda' : 'Aún no hay comercios en esta categoría'}</div>
      </div>
    `;
    return;
  }

  try {
    grid.innerHTML = filtered.map((c, i) => {
      let isOpen = true;
      try {
        isOpen = isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []));
      } catch (e) {
        console.warn('Error checking isShopOpen for', c.name, e);
      }
      
      const isPaused = c.isPaused === true;
      const statusClass = isPaused ? 'paused' : (isOpen ? 'open' : 'closed');
      const statusText = isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
      const href = isPaused ? 'javascript:void(0)' : `#/comercio/${c.id}`;

      return `
        <a href="${href}" class="comercio-card card-interactive ${isPaused ? 'is-paused' : ''} page-enter stagger-${Math.min(i + 1, 6)}">
          <div class="comercio-card-banner">
            ${c.banner ? `<img src="${c.banner}" alt="${c.name}" loading="lazy" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 40)}</div>`}
            <div class="comercio-card-badge ${statusClass}">
              ${statusText}
            </div>
            <div class="comercio-card-logo-container">
              ${c.logo ? `<img src="${c.logo}" alt="" class="comercio-card-logo" loading="lazy" />` : `<div class="comercio-card-logo" style="display:flex;align-items:center;justify-content:center;background:var(--color-surface);">${categoryIcon(c.category, 20)}</div>`}
            </div>
          </div>
          <div class="comercio-card-body">
            <div class="comercio-card-name">${c.name}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 2px;">
              <div class="comercio-card-category">${c.category || 'Comercio'}</div>
              <div style="font-size:12px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; gap:3px;">
                ⭐ ${c.ratingAverage !== undefined && c.ratingAverage > 0 ? c.ratingAverage.toFixed(1) : 'Nuevo'} 
                ${c.ratingCount ? `<span style="font-size:10px; color:var(--color-text-tertiary); font-weight:600;">(${c.ratingCount})</span>` : ''}
              </div>
            </div>
            <div class="comercio-card-footer">
              <span class="comercio-card-schedule">
                ${icon('clock', 12)} 
                ${(() => {
                  const scheds = c.schedules || (c.schedule ? [c.schedule] : []);
                  if (scheds.length === 0) return 'Sin horario';
                  return scheds.map(s => `${s.open}-${s.close}`).join(', ');
                })()}
              </span>
              ${c.address ? `<span style="font-size:var(--font-xs);color:var(--color-text-tertiary);display:flex;align-items:center;gap:2px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${icon('mapPin', 12)} ${c.address}</span>` : ''}
            </div>
          </div>
        </a>
      `;
    }).join('');
  } catch (err) {
    console.error('Error rendering comercios:', err);
    grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--color-text-tertiary);">Error al cargar comercios</p>';
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
  if (!user) {
    container.style.display = 'none';
    return;
  }

  try {
    const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
    const q = query(
      collection(db, 'orders'),
      where('userId', '==', user.uid),
      where('status', '==', 'completed'),
      orderBy('createdAt', 'desc'),
      limit(3)
    );

    const snap = await getDocs(q);
    if (snap.empty) {
      container.style.display = 'none';
      return;
    }

    const orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const cardsHtml = orders.map(o => {
      const dateStr = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '';
      const itemsSummary = (o.items || []).map(item => `${item.qty}x ${item.product?.name || item.name || 'Producto'}`).join(', ');
      
      return `
        <div class="recurrent-order-card" style="
          min-width: 250px;
          max-width: 280px;
          background: var(--color-surface);
          border: 1.5px solid var(--color-border-light);
          border-radius: 20px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          scroll-snap-align: start;
          box-shadow: var(--shadow-sm);
          position: relative;
          overflow: hidden;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">
              Fav. del ${dateStr}
            </span>
            <span style="font-size: 12px; font-weight: 900; color: var(--color-success);">
              ${formatPrice(o.total || 0)}
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 2px;">
            <h4 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 900; color: var(--color-text-primary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${o.comercioName || 'Comercio'}
            </h4>
            <p style="font-size: 11.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.3; height: 30px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">
              ${itemsSummary}
            </p>
          </div>

          <button class="btn btn-primary repeat-1-click-btn" data-order-id="${o.id}" style="
            height: 34px;
            font-size: 11.5px;
            font-weight: 900;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            border: none;
            color: white;
            background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
            box-shadow: 0 4px 10px rgba(var(--color-primary-rgb), 0.2);
            cursor: pointer;
            margin-top: 4px;
          ">
            ${icon('zap', 13)} Repetir 1-Click
          </button>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <h3 style="font-family: var(--font-display); font-size: 14.5px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 0 0 10px 0; display: flex; align-items: center; gap: 6px;">
        ${icon('history', 15)} ¿Querés repetir tu favorito?
      </h3>
      <div style="
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding-bottom: 8px;
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
        const selectedOrder = orders.find(ord => ord.id === oId);
        if (!selectedOrder) return;

        const { clearCart, addToCart, setState } = await import('../state.js');
        const { showToast } = await import('../components/toast.js');
        const { AudioManager } = await import('../utils/audio-manager.js');

        AudioManager.hapticLight();
        
        // 1. Clear cart
        clearCart();

        // 2. Add all products to cart safely
        selectedOrder.items.forEach(item => {
          if (item.product) {
            addToCart(item.product, selectedOrder.comercioId, selectedOrder.comercioName, item.qty, item.options);
          } else {
            const fallbackProd = {
              id: item.productId || item.id || 'fallback-id',
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
      };
    });

  } catch (error) {
    console.error('Error rendering recurrent orders:', error);
    container.style.display = 'none';
  }
}




