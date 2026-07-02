import { db } from '../firebase.js';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { icon, categoryIcon } from '../utils/icons.js';
import { formatPrice, isShopOpen, formatDeliveryTime } from '../utils/format.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';
import { getFooterHTML } from '../components/footer.js';
import { getState, setState } from '../state.js';


export async function renderCategoryPage(categoryName, content) {
  if (categoryName && categoryName.toLowerCase() === 'gomarket') {
    try {
      const cachedGmId = localStorage.getItem('gd_gomarket_id');
      if (cachedGmId) {
        window.history.replaceState(null, '', `#/comercio/${cachedGmId}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
      }
      const comSnap = await getDocsOptimized(collection(db, 'comercios'), 'gomarket_redirect_comercios', 900000);
      const goMarket = comSnap.docs.find(d => {
        const name = (d.data().name || '').toLowerCase();
        return name.includes('go!') && name.includes('market');
      });
      if (goMarket) {
        localStorage.setItem('gd_gomarket_id', goMarket.id);
        setState('goMarketId', goMarket.id);
        window.history.replaceState(null, '', `#/comercio/${goMarket.id}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
      }
    } catch (e) {
      console.warn('Error redirecting to GoMarket:', e);
    }
  }

  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  // Premium Header (Red)
  content.innerHTML = `
    <div class="category-page page-enter" style="display:flex; flex-direction:column; height: 100%; background: var(--color-bg); overflow: hidden;">
      
      <!-- Search Bar (Now in Content) -->
      <div style="padding: 16px 20px; background: var(--color-bg); z-index: 10; position: relative;">
         <div style="position: relative;">
           <input type="text" id="category-search" placeholder="Buscar en ${categoryName}..." style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border); background: var(--color-surface); padding: 0 44px; color: var(--color-text); font-size: 14px; font-weight: 600; outline: none; transition: all 0.3s; box-shadow: var(--shadow-sm);">
           <div style="position: absolute; left: 14px; top: 14px; color: var(--color-text-tertiary);">${icon('search', 18)}</div>
         </div>
      </div>

      <!-- Commerces/Products Grid List -->
      <div class="comercios-grid" style="flex:1; overflow-y:auto; padding: 20px; -webkit-overflow-scrolling: touch; display: grid; gap: 18px; margin-top: 0;" id="category-comercios-grid">
        <div class="empty-state" style="padding-top: 40px; grid-column: 1/-1;">Cargando comercios de ${categoryName}...</div>
      </div>
    </div>

    <style>
      #category-search::placeholder { color: var(--color-text-tertiary); }
      #category-search:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.12); }
    </style>
  `;

  // Load Data
  try {
    let q;
    if (categoryName === 'Todos') {
      q = query(collection(db, 'comercios'), where('isActive', '==', true));
    } else {
      q = query(collection(db, 'comercios'), where('isActive', '==', true), where('category', '==', categoryName));
    }
    const snap = await getDocsOptimized(q, `category_comercios_${categoryName}`, 900000);
    const comercios = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Apply hourly randomization
    const hourSeed = new Date().getFullYear() + '-' + new Date().getMonth() + '-' + new Date().getDate() + '-' + new Date().getHours();
    const seedHash = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    };
    comercios.sort((a, b) => seedHash(a.id + '-' + hourSeed) - seedHash(b.id + '-' + hourSeed));

    // Fetch all products of these comercios in parallel
    let allProducts = [];
    try {
      const promises = comercios.map(async (c) => {
        const pSnap = await getDocs(collection(db, 'comercios', c.id, 'products'));
        return pSnap.docs.map(d => ({
          id: d.id,
          comercioId: c.id,
          comercioName: c.name,
          ...d.data()
        }));
      });
      const results = await Promise.all(promises);
      allProducts = results.flat().filter(p => p.isActive !== false);
    } catch (err) {
      console.warn('Error fetching products for category:', err);
    }

    const renderList = async (filteredComs, filteredProds, queryStr = '') => {
      const grid = document.getElementById('category-comercios-grid');
      if (!grid) return;

      const state = getState();
      const userCoords = state.deliveryCoords;
      const { getQuickDistance, calculateDynamicFee } = await import('../utils/geo.js');

      // Precalculate distances and fees for comercios synchronously
      const resolvedComs = filteredComs.map((c) => {
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

      // Precalculate delivery fees for product merchants synchronously
      const resolvedProds = filteredProds.map((p) => {
        let deliveryFee = null;
        const ownerComer = comercios.find(c => c.id === p.comercioId);
        if (userCoords && ownerComer && ownerComer.coords) {
          const dist = getQuickDistance(userCoords.lat, userCoords.lng, ownerComer.coords.lat, ownerComer.coords.lng);
          if (dist !== null) {
            deliveryFee = calculateDynamicFee(dist);
          }
        }
        return { product: p, deliveryFee };
      });

      if (!queryStr) {
        // Render only Comercios
        if (resolvedComs.length === 0) {
          grid.innerHTML = `
            <div class="empty-state" style="padding-top: 40px; grid-column: 1/-1;">
              <div class="empty-state-icon" style="color: var(--color-text-tertiary);">${icon('store', 48)}</div>
              <div class="empty-state-title" style="margin-top:16px;">No hay comercios</div>
              <div class="empty-state-text">No hay comercios disponibles en esta categoría.</div>
            </div>
          `;
          return;
        }

        grid.innerHTML = resolvedComs.map(({ comercio: c, distanceKm, deliveryFee }, i) => {
          let isOpen = true;
          try {
            isOpen = isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen);
          } catch (e) {}
          
          const isPaused = c.isPaused === true;
          const statusClass = isPaused ? 'paused' : (isOpen ? 'open' : 'closed');
          const statusText = isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
          const href = isPaused ? 'javascript:void(0)' : `#/comercio/${c.id}`;
          const bannerSrc = c.banner || '';

          return `
            <a href="${href}" class="comercio-card card-interactive ${isPaused ? 'is-paused' : ''} page-enter stagger-${Math.min(i+1, 6)}" style="text-decoration:none; display:flex; flex-direction:column; overflow:hidden; border-radius:24px; border:1px solid var(--color-border-light); background:var(--color-surface); box-shadow:var(--shadow-sm); margin-bottom: 18px; position:relative;">
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
        }).join('') + `<div style="grid-column: 1/-1;">${getFooterHTML()}</div>`;
      } else {
        // Render search results
        let html = '';

        if (resolvedComs.length > 0) {
          html += `
            <div style="grid-column: 1/-1; margin-top: 10px;">
              <h3 style="font-family: var(--font-display); font-weight: 900; font-size: 16px; margin: 0 0 12px 0; color: var(--color-text-primary); display: flex; align-items: center; gap: 8px;">
                ${icon('store', 18)} Comercios Encontrados (${resolvedComs.length})
              </h3>
            </div>
          `;
          html += resolvedComs.map(({ comercio: c, distanceKm, deliveryFee }, i) => {
            let isOpen = true;
            try {
              isOpen = isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []), c.daysOpen);
            } catch (e) {}
            
            const isPaused = c.isPaused === true;
            const statusClass = isPaused ? 'paused' : (isOpen ? 'open' : 'closed');
            const statusText = isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');
            const href = isPaused ? 'javascript:void(0)' : `#/comercio/${c.id}`;
            const bannerSrc = c.banner || '';

            return `
              <a href="${href}" class="comercio-card card-interactive ${isPaused ? 'is-paused' : ''} page-enter stagger-${Math.min(i+1, 6)}" style="text-decoration:none; display:flex; flex-direction:column; overflow:hidden; border-radius:24px; border:1px solid var(--color-border-light); background:var(--color-surface); box-shadow:var(--shadow-sm); margin-bottom: 18px; position:relative;">
                <!-- Floating Favorite Heart Button (Moved out of banner to prevent clipping) -->
                <div class="card-favorite-btn-floating" style="position:absolute; top:120px; right:24px; width:40px; height:40px; border-radius:50%; background:white; display:flex; align-items:center; justify-content:center; border:1px solid var(--color-border-light); box-shadow:0 4px 12px rgba(0,0,0,0.08); color:var(--color-text-secondary); cursor:pointer; z-index:10;" onclick="event.preventDefault(); event.stopPropagation(); this.querySelector('svg').style.fill = this.querySelector('svg').style.fill ? '' : 'var(--color-primary)'; this.querySelector('svg').style.stroke = this.querySelector('svg').style.fill ? 'var(--color-primary)' : 'currentColor';">
                  ${icon('heart', 18)}
                </div>

                <div class="comercio-card-banner" style="position:relative; height:140px; overflow:hidden;">
                  ${bannerSrc ? `<img src="${bannerSrc}" alt="${c.name}" loading="lazy" style="width:100%; height:100%; object-fit:cover;" />` : `<div style="width:100%;height:100%;background:var(--color-primary-light);display:flex;align-items:center;justify-content:center;color:var(--color-primary);">${icon('store', 40)}</div>`}
                  
                  <div class="comercio-card-logo-container">
                    ${c.logo ? `<img src="${c.logo}" alt="" class="comercio-card-logo" loading="lazy" />` : `<div class="comercio-card-logo" style="display:flex;align-items:center;justify-content:center;background:var(--color-surface);">${categoryIcon(c.category, 20)}</div>`}
                  </div>

                  <!-- Status Badge on top-left -->
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
        }

        if (resolvedProds.length > 0) {
          html += `
            <div style="grid-column: 1/-1; margin-top: 24px;">
              <h3 style="font-family: var(--font-display); font-weight: 900; font-size: 16px; margin: 0 0 12px 0; color: var(--color-text-primary); display: flex; align-items: center; gap: 8px;">
                ${icon('package', 18)} Productos Encontrados (${resolvedProds.length})
              </h3>
            </div>
          `;
          html += resolvedProds.map(({ product: p, deliveryFee }, i) => {
            const isOutOfStock = p.useGlobalFlavors ? false : (p.stockMode === 'limited' && (p.stockQuantity || 0) <= 0);
            const isUnavailable = p.isAvailable === false || isOutOfStock;

            return `
              <a href="#/comercio/${p.comercioId}?product=${p.id}" class="product-card card-interactive page-enter stagger-${Math.min(i+1, 6)} ${isUnavailable ? 'product-unavailable' : ''}" 
                   style="position:relative; display:flex; justify-content:space-between; gap:16px; padding:16px; background:var(--color-surface); border-radius:20px; border:1px solid var(--color-border-light); box-shadow:var(--shadow-xs); transition:all 0.2s ease; text-decoration: none; grid-column: 1/-1;">
                
                <!-- Left side: Text Details -->
                <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; min-width:0; text-align: left;">
                  <div>
                    <div style="font-family:var(--font-display); font-size:15px; font-weight:800; color:var(--color-text); margin-bottom:2px; line-height:1.2;">${p.name}</div>
                    <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:700; margin-bottom:6px;">En <strong>${p.comercioName}</strong></div>
                    ${p.description ? `<div style="font-size:12px; color:var(--color-text-secondary); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:8px;">${p.description}</div>` : ''}
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text);">${formatPrice(p.price)}</span>
                    ${deliveryFee !== null ? `
                      <span style="font-size:10.5px; font-weight:800; color:#10b981; background:rgba(16,185,129,0.08); padding:3px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:2px;">
                        🛵 Envío: $${deliveryFee}
                      </span>
                    ` : ''}
                  </div>
                </div>
          
                <!-- Right side: Image -->
                <div style="position:relative; width:90px; height:90px; flex-shrink:0;">
                  <img src="${p.image || '/logo.png'}" alt="${p.name}" style="width:100%; height:100%; border-radius:14px; object-fit:cover; border:1px solid var(--color-border-light); background:white;" loading="lazy" />
                </div>
              </a>
            `;
          }).join('');
        }

        if (resolvedComs.length === 0 && resolvedProds.length === 0) {
          html = `
            <div class="empty-state" style="padding-top: 40px; grid-column: 1/-1;">
              <div class="empty-state-icon" style="color: var(--color-text-tertiary);">${icon('search', 48)}</div>
              <div class="empty-state-title" style="margin-top:16px;">Sin resultados</div>
              <div class="empty-state-text">No se encontraron comercios ni productos para "${queryStr}"</div>
            </div>
          `;
        }

        grid.innerHTML = html + `<div style="grid-column: 1/-1;">${getFooterHTML()}</div>`;
      }
    };

    renderList(comercios, [], '');

    // Search input handler
    document.getElementById('category-search').oninput = (e) => {
      const s = e.target.value.toLowerCase().trim();
      if (!s) {
        renderList(comercios, [], '');
        return;
      }
      const filteredComs = comercios.filter(c => 
        c.name.toLowerCase().includes(s) || (c.description || '').toLowerCase().includes(s)
      );
      const filteredProds = allProducts.filter(p => 
        p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s)
      );
      renderList(filteredComs, filteredProds, s);
    };

  } catch (err) {
    console.error(err);
  }
}
