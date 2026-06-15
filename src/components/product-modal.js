// GoDelivery — Product Detail Modal Component
import { showModal, closeModal } from './modal.js';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';
import { addToCart, isProductFavorite, toggleProductFavorite, getState } from '../state.js';
import { showToast } from './toast.js';
import { renderNavbar } from './navbar.js';

/**
 * Opens a modal to customize and add a product to the cart
 */
export function openProductModal(product, comercioId, comercioName, isCommerceOpen = true) {
  const modalContent = document.createElement('div');
  modalContent.className = 'product-detail-modal-v2';
  
  // Local state for the modal
  let qty = (!isCommerceOpen || (product.stockMode === 'limited' && typeof product.stockQuantity === 'number' && product.stockQuantity <= 0)) ? 0 : 1;
  const selectedOptions = []; // Array of { groupName, name, price, qty }
  let flavorSearchQuery = '';
  let commerceLogo = '';

  import('firebase/firestore').then(async ({ doc, getDoc }) => {
    try {
      const { db } = await import('../firebase.js');
      const snap = await getDoc(doc(db, 'comercios', comercioId));
      if (snap.exists()) {
        commerceLogo = snap.data().logo || '';
        render();
      }
    } catch (e) {
      console.error('Error fetching commerce logo:', e);
    }
  });

  // Initial selection of required single-choice groups
  if (product.optionsGroups) {
    product.optionsGroups.forEach(group => {
      if (group.required && !group.multi && group.options && group.options.length > 0) {
        selectedOptions.push({
          groupName: group.name,
          name: group.options[0].name,
          price: group.options[0].price || 0,
          qty: 1
        });
      }
    });
  }

  // Load global flavors if checked
  let flavorsLoading = product.useGlobalFlavors === true;
  let globalFlavorsGroup = null;

  if (product.useGlobalFlavors) {
    import('firebase/firestore').then(async ({ doc, getDoc }) => {
      try {
        const { db } = await import('../firebase.js');
        
        let productCategoryName = '';
        if (product.categoryId) {
          try {
            const catSnap = await getDoc(doc(db, 'comercios', comercioId, 'categories', product.categoryId));
            if (catSnap.exists()) {
              productCategoryName = (catSnap.data().name || '').toLowerCase();
            }
          } catch (e) {
            console.error('Error fetching category name for flavor filtering:', e);
          }
        }

        const snap = await getDoc(doc(db, 'comercios', comercioId));
        if (snap.exists()) {
          const data = snap.data();
          const rawList = data.sabores || [];
          
          const productNameLower = (product.name || '').toLowerCase();
          const isPizza = productCategoryName.includes('pizza') || productNameLower.includes('pizza');
          const isEmpanada = productCategoryName.includes('empanada') || productNameLower.includes('empanada');

          let filteredRawList = rawList.filter(f => f.isAvailable === true);

          if (isPizza) {
            filteredRawList = filteredRawList.filter(f => (f.category || '').toLowerCase().includes('pizza'));
          } else if (isEmpanada) {
            filteredRawList = filteredRawList.filter(f => (f.category || '').toLowerCase().includes('empanada'));
          }

          const list = filteredRawList.map(f => ({ name: f.name, category: f.category || 'Otros' }));
          
          globalFlavorsGroup = {
            name: 'Seleccioná tus sabores',
            multi: true,
            required: true,
            maxSelections: product.maxSelections || 4,
            options: list.sort((a, b) => a.name.localeCompare(b.name))
          };
        }
      } catch (err) {
        console.error('Error fetching global flavors:', err);
      } finally {
        flavorsLoading = false;
        render();
      }
    });
  }

  const render = () => {
    const scrollEl = modalContent.querySelector('.pm-content');
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;

    const activeId = document.activeElement ? document.activeElement.id : null;
    const start = document.activeElement ? document.activeElement.selectionStart : null;
    const end = document.activeElement ? document.activeElement.selectionEnd : null;

    const activeOffers = getState().activeOffers || [];
    const offer = activeOffers.find(o => o.active && o.comercioId === comercioId && o.productIds && o.productIds.includes(product.id));

    const discountPercent = (offer && offer.type === 'percentage') ? (offer.value || 0) : 0;
    const baseDiscountedPrice = discountPercent > 0 ? product.price * (1 - discountPercent / 100) : product.price;

    const allProducts = getState().currentProducts || [];
    const combos = product.frequentCombos || {};

    const suggested = allProducts
      .filter(p => p.id !== product.id && p.isAvailable !== false)
      .sort((a, b) => {
        const comboA = combos[a.id] || 0;
        const comboB = combos[b.id] || 0;
        if (comboB !== comboA) {
          return comboB - comboA; // Prioritize highest purchase co-occurrence count!
        }
        // Fallback: prioritize same category
        const catA = a.categoryId === product.categoryId ? 1 : 0;
        const catB = b.categoryId === product.categoryId ? 1 : 0;
        if (catB !== catA) return catB - catA;
        
        return (a.order || 0) - (b.order || 0);
      })
      .slice(0, 4);

    const baseOptionsGroups = product.optionsGroups || [];
    const optionsGroups = globalFlavorsGroup ? [globalFlavorsGroup, ...baseOptionsGroups] : baseOptionsGroups;
    const optionsPrice = selectedOptions.reduce((s, o) => s + (o.price * o.qty || 0), 0);
    const unitPrice = baseDiscountedPrice + optionsPrice;
    const totalPrice = unitPrice * qty;

    const originalUnitPrice = (product.price || 0) + optionsPrice;
    const originalTotalPrice = originalUnitPrice * qty;

    const isFav = isProductFavorite(product.id);

    const isLimited = product.stockMode === 'limited';
    const stockQty = typeof product.stockQuantity === 'number' ? product.stockQuantity : 0;
    const stockThresh = typeof product.stockThreshold === 'number' ? product.stockThreshold : 0;
    const isOutOfStock = isLimited && stockQty <= 0;

    let stockBadgeHTML = '';
    if (isLimited) {
      if (stockQty <= 0) {
        stockBadgeHTML = `
          <div>
            <div class="pm-stock-badge agotado" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; background: rgba(225, 29, 72, 0.08); color: var(--color-primary); font-size: 11px; font-weight: 850; border: 1.5px solid rgba(225, 29, 72, 0.18); margin-top: 8px; font-family: var(--font-display);">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary); display: inline-block;"></span>
              Agotado
            </div>
          </div>
        `;
      } else if (stockQty <= stockThresh) {
        stockBadgeHTML = `
          <div>
            <div class="pm-stock-badge bajo" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; background: rgba(249, 115, 22, 0.08); color: #f97316; font-size: 11px; font-weight: 850; border: 1.5px solid rgba(249, 115, 22, 0.18); margin-top: 8px; font-family: var(--font-display);">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: #f97316; display: inline-block; animation: pulse 1.5s infinite;"></span>
              Stock Bajo: ${stockQty}
            </div>
          </div>
        `;
      } else {
        stockBadgeHTML = `
          <div>
            <div class="pm-stock-badge ok" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; background: rgba(16, 185, 129, 0.08); color: #10b981; font-size: 11px; font-weight: 850; border: 1.5px solid rgba(16, 185, 129, 0.18); margin-top: 8px; font-family: var(--font-display);">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
              Stock: ${stockQty}
            </div>
          </div>
        `;
      }
    }

    let missingRequired = false;
    let missingRequiredFlavors = false;
    for (const group of optionsGroups) {
      if (group.required) {
        const selectedCount = selectedOptions.filter(o => o.groupName === group.name).reduce((sum, o) => sum + (o.qty || 1), 0);
        if (selectedCount === 0) {
          missingRequired = true;
          if (group.name === 'Seleccioná tus sabores' || group.name === 'Elegí tu sabor' || group.name.toLowerCase().includes('sabor')) {
            missingRequiredFlavors = true;
          }
        }
      }
    }

    const isAddDisabled = !isCommerceOpen || isOutOfStock || missingRequired;
    let btnText = '';
    if (!isCommerceOpen) {
      btnText = '<span>Cerrado</span>';
    } else if (isOutOfStock) {
      btnText = '<span>Sin Stock</span>';
    } else if (missingRequired) {
      btnText = missingRequiredFlavors ? '<span>Elegir sabores</span>' : '<span>Elegir opciones</span>';
    } else {
      btnText = `
        <span>Agregar</span>
        <strong style="display: inline-flex; align-items: center; gap: 6px;">
          ${offer && offer.type === 'percentage' ? `
            <span style="font-size: 11px; font-weight: 500; opacity: 0.7; text-decoration: line-through; margin-right: 4px;">${formatPrice(originalTotalPrice)}</span>
          ` : ''}
          <span>${formatPrice(totalPrice)}</span>
        </strong>
      `;
    }

    modalContent.innerHTML = `
      <button class="pm-close-btn" id="pm-modal-close">${icon('close', 20)}</button>

      ${product.image ? `
        <div class="pm-banner">
          <img src="${product.image}" alt="${product.name}" />
          <div class="pm-banner-overlay"></div>
          <button class="pm-heart-btn" id="pm-modal-heart" title="Me gusta">${icon('heart', 20, isFav ? 'fav-active' : '')}</button>
          <button class="pm-zoom-btn" id="pm-modal-zoom" title="Ampliar imagen">${icon('search', 18)}</button>
          
          ${commerceLogo ? `
            <div style="position: absolute; bottom: 12px; left: 12px; width: 80px; height: 80px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 100; background: white; overflow: hidden; display: flex; align-items: center; justify-content: center;">
              <img src="${commerceLogo}" alt="${comercioName}" style="width: 100%; height: 100%; object-fit: cover;" />
            </div>
          ` : ''}
          
          ${offer ? `
            <div class="pm-discount-tag" style="position: absolute; top: 16px; left: 64px; height: 36px; padding: 0 16px; border-radius: 18px; background: var(--color-primary); color: white; font-weight: 900; font-size: 12px; z-index: 100; box-shadow: 0 4px 15px rgba(225,29,72,0.3); display: flex; align-items: center; justify-content: center; gap: 6px; border: 1.5px solid rgba(255,255,255,0.25); font-family: var(--font-display); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);">
              ${icon('tag', 14)} ${offer.type === 'percentage' ? `${offer.value}% OFF` : '2x1'}
            </div>
          ` : ''}
        </div>
      ` : `
        <div style="padding-top: 50px; position: relative;">
          <button class="pm-heart-btn" id="pm-modal-heart" style="position: absolute; top: 16px; left: 16px;" title="Me gusta">${icon('heart', 20, isFav ? 'fav-active' : '')}</button>
        </div>
      `}

      <div class="pm-info-section" style="padding: 12px 16px; display: flex; flex-direction: column; gap: 4px;">
        ${offer && !product.image ? `
          <div class="pm-discount-tag" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 14px; background: var(--color-primary); color: white; font-weight: 900; font-size: 11px; margin-bottom: 4px; box-shadow: 0 4px 10px rgba(225,29,72,0.2); border: 1.5px solid rgba(255,255,255,0.2); font-family: var(--font-display);">
            ${icon('tag', 12)} ${offer.type === 'percentage' ? `${offer.value}% OFF` : '2x1'}
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; width: 100%;">
          <h2 style="font-size: 20px; margin: 0; line-height: 1.25; flex: 1;">${product.name}</h2>
          ${offer ? `
            <div style="display:flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; text-align: right;">
              <span style="font-family:var(--font-display); font-size:20px; font-weight:900; color:var(--color-primary);">${formatPrice(baseDiscountedPrice)}</span>
              <span style="font-size:12px; color:var(--color-text-tertiary); text-decoration:line-through; font-weight:700; line-height:1;">${formatPrice(product.price)}</span>
            </div>
          ` : `
            <div class="price" style="font-size: 20px; font-weight: 900; color: var(--color-primary); flex-shrink: 0; margin: 0;">${formatPrice(product.price)}</div>
          `}
        </div>
        ${product.description ? `<p style="font-size: 12px; color: var(--color-text-secondary); line-height: 1.4; margin: 0;">${product.description}</p>` : ''}
        ${stockBadgeHTML ? `<div style="margin-top: 2px;">${stockBadgeHTML.replace('margin-top: 8px;', 'margin-top: 2px;').replace('padding: 4px 12px;', 'padding: 3px 10px;')}</div>` : ''}
      </div>

      <div class="pm-content" style="padding-bottom: 24px;">
        ${flavorsLoading ? `
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; gap:12px;">
            <div style="border: 3px solid var(--color-border-light); border-top: 3px solid var(--color-primary); border-radius: 50%; width: 28px; height: 28px; animation: spin 0.8s linear infinite;"></div>
            <span style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary);">Cargando sabores de helado...</span>
          </div>
          <style>
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        ` : ''}

        ${optionsGroups.length > 0 ? optionsGroups.map((group, groupIdx) => {
          const currentCount = selectedOptions.filter(o => o.groupName === group.name).reduce((sum, o) => sum + (o.qty || 1), 0);
          
          let countBadgeHtml = '';
          if (group.multi && group.maxSelections) {
            countBadgeHtml = `
              <span style="font-weight:900; color:var(--color-primary); background:rgba(225,29,72,0.08); padding:4px 10px; border-radius:8px; font-size:12.5px; font-family:var(--font-display); border: 1px solid rgba(225,29,72,0.15); margin-left: auto; flex-shrink: 0;">
                ${currentCount}/${group.maxSelections}
              </span>
            `;
          }

          return `
            <div class="pm-group" data-group-idx="${groupIdx}">
              <div class="pm-group-header" style="display:flex; flex-direction:row; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--color-border-light); margin-bottom:0; gap:8px;">
                <div class="pm-group-title" style="margin:0; font-family:var(--font-display); font-size:14px; font-weight:850; color:var(--color-text-primary); display:flex; align-items:center; gap:8px; flex:1;">
                  <span>${group.name}</span>
                  ${group.required ? '<span class="pm-required-badge" style="font-size:8px; font-weight:900; background:rgba(225,29,72,0.08); color:var(--color-primary); padding:2px 6px; border-radius:4px; text-transform:uppercase; border:1px solid rgba(225,29,72,0.15); flex-shrink:0;">Obligatorio</span>' : ''}
                </div>
                ${countBadgeHtml}
              </div>
              <div class="pm-options-list" style="border-top:none; ${group.name === 'Seleccioná tus sabores' ? 'display:flex; flex-direction:column; gap:0; padding:0;' : ''}">
                ${(() => {
                  if (group.name === 'Seleccioná tus sabores') {
                    const searchBarHtml = `
                      <div style="padding: 4px 16px 12px 16px; border-bottom: 1.5px solid var(--color-border-light);">
                        <div style="position:relative; width: 100%; display:flex; align-items:center; background:var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius:12px; padding:0 12px; height:40px; transition: all 0.2s;">
                          <span style="color:var(--color-text-tertiary); display:flex; align-items:center; justify-content:center; margin-right:8px;">${icon('search', 15)}</span>
                          <input type="text" id="flavor-search-input" value="${flavorSearchQuery}" placeholder="Buscar sabores..." style="flex:1; border:none; background:transparent; font-size:12.5px; font-weight:600; color:var(--color-text); outline:none;" />
                          ${flavorSearchQuery ? `<button id="clear-flavor-search-btn" style="background:none; border:none; color:var(--color-text-tertiary); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:4px;">${icon('xCircle', 14)}</button>` : ''}
                        </div>
                      </div>
                    `;

                    // Filtered options
                    const q = flavorSearchQuery.toLowerCase().trim();
                    const filteredOptions = q 
                      ? group.options.filter(opt => opt.name.toLowerCase().includes(q))
                      : group.options;

                    const cats = {};
                    filteredOptions.forEach(opt => {
                      const c = opt.category || 'Otros';
                      if (!cats[c]) cats[c] = [];
                      cats[c].push(opt);
                    });

                    const listHtml = filteredOptions.length === 0 
                      ? `<div style="text-align:center; padding:24px 16px; color:var(--color-text-tertiary); font-size:12px; font-weight:600; font-style:italic;">No se encontraron sabores para "${flavorSearchQuery}"</div>`
                      : Object.keys(cats).sort().map(catName => {
                        const items = cats[catName];
                        return `
                          <div class="sabor-category-group" style="text-align: left; padding: 0 16px; margin-top: 12px;">
                            <div style="font-size: 11px; font-weight: 800; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 4px; border-bottom: 1px dashed var(--color-border-light); margin-bottom: 8px;">${catName}</div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                              ${items.map(opt => {
                                const optIdx = group.options.indexOf(opt);
                                const selection = selectedOptions.find(o => o.groupName === group.name && o.name === opt.name);
                                const isSelected = !!selection;

                                let isLimitReached = false;
                                if (group.multi && group.maxSelections && !isSelected) {
                                    if (currentCount >= group.maxSelections) {
                                      isLimitReached = true;
                                    }
                                }

                                return `
                                  <div class="pm-option ${isSelected ? 'selected' : ''}" data-group-idx="${groupIdx}" data-opt-idx="${optIdx}" style="${isLimitReached ? 'opacity: 0.4; cursor: not-allowed; pointer-events: none;' : ''}">
                                    <div class="pm-option-main">
                                      <div class="pm-check ${group.multi ? 'multi' : 'single'} ${isSelected ? 'checked' : ''}">
                                        ${isSelected ? icon('check', 12) : ''}
                                      </div>
                                      <div class="pm-option-text">
                                        <div class="pm-option-name">${opt.name}</div>
                                      </div>
                                    </div>
                                    
                                    ${isSelected && group.maxSelections > 1 ? `
                                      <div class="pm-qty-stepper">
                                        <button class="pm-qty-btn minus" data-gidx="${groupIdx}" data-oidx="${optIdx}">${icon('minus', 12)}</button>
                                        <span class="pm-qty-val">${selection.qty}</span>
                                        <button class="pm-qty-btn plus" data-gidx="${groupIdx}" data-oidx="${optIdx}">${icon('plus', 12)}</button>
                                      </div>
                                    ` : ''}
                                  </div>
                                `;
                              }).join('')}
                            </div>
                          </div>
                        `;
                      }).join('');

                    return searchBarHtml + `<div style="display:flex; flex-direction:column; gap:16px; padding:16px 0;">${listHtml}</div>`;
                  }

                  // Normal options list mapping
                  return group.options.map((opt, optIdx) => {
                    const selection = selectedOptions.find(o => o.groupName === group.name && o.name === opt.name);
                    const isSelected = !!selection;
                    const canHaveMultiple = (opt.maxQty || 1) > 1;

                    let isLimitReached = false;
                    if (group.multi && group.maxSelections && !isSelected) {
                      if (currentCount >= group.maxSelections) {
                        isLimitReached = true;
                      }
                    }

                  return `
                    <div class="pm-option ${isSelected ? 'selected' : ''}" data-group-idx="${groupIdx}" data-opt-idx="${optIdx}" style="${isLimitReached ? 'opacity: 0.4; cursor: not-allowed; pointer-events: none;' : ''}">
                      <div class="pm-option-main">
                        <div class="pm-check ${group.multi ? 'multi' : 'single'} ${isSelected ? 'checked' : ''}">
                          ${isSelected ? icon('check', 12) : ''}
                        </div>
                        <div class="pm-option-text">
                          <div class="pm-option-name">${opt.name}</div>
                          ${opt.price ? `<div class="pm-option-price">+ ${formatPrice(opt.price)}</div>` : ''}
                        </div>
                      </div>
                      
                      ${isSelected && canHaveMultiple ? `
                        <div class="pm-qty-stepper">
                          <button class="pm-qty-btn minus" data-gidx="${groupIdx}" data-oidx="${optIdx}">${icon('minus', 12)}</button>
                          <span class="pm-qty-val">${selection.qty}</span>
                          <button class="pm-qty-btn plus" data-gidx="${groupIdx}" data-oidx="${optIdx}">${icon('plus', 12)}</button>
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')
              })()}
              </div>
            </div>
          `;
        }).join('') : ''}

        <!-- Sugeridos / Similares Section -->
        ${suggested.length > 0 ? `
          <div class="pm-suggested-section" style="margin-top: 24px; padding: 0 4px;">
            <h3 style="font-family: var(--font-display); font-size: 13px; font-weight: 850; color: var(--color-text); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              Otras personas lo combinan con:
            </h3>
            <div class="pm-suggested-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${suggested.map(item => {
                const hasItemOffer = activeOffers.find(o => o.active && o.productIds && o.productIds.includes(item.id));
                const itemDiscountPercent = (hasItemOffer && hasItemOffer.type === 'percentage') ? (hasItemOffer.value || 0) : 0;
                const itemFinalPrice = itemDiscountPercent > 0 ? item.price * (1 - itemDiscountPercent / 100) : item.price;
                
                return `
                  <div class="pm-suggested-row" data-suggested-id="${item.id}" style="display: flex; align-items: center; justify-content: space-between; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 12px; padding: 8px 10px; cursor: pointer; transition: all 0.2s; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                      <div style="position: relative; width: 40px; height: 40px; border-radius: 8px; overflow: hidden; background: #f8fafc; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.03);">
                        <img src="${item.image || '/logo.png'}" alt="${item.name}" style="width: 100%; height: 100%; object-fit: cover;" />
                        ${hasItemOffer ? `
                          <div style="position: absolute; top: 0; left: 0; background: var(--color-primary); color: white; font-size: 7px; font-weight: 900; padding: 1px 3px; border-radius: 0 0 4px 0; font-family: var(--font-display);">${hasItemOffer.type === 'percentage' ? `${hasItemOffer.value}%` : '2x1'}</div>
                        ` : ''}
                      </div>
                      <div style="font-size: 12px; font-weight: 750; color: var(--color-text); line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">
                        ${item.name}
                      </div>
                    </div>
                    <div style="font-size: 12px; font-weight: 900; color: var(--color-primary); text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end;">
                      <span>${formatPrice(itemFinalPrice)}</span>
                      ${hasItemOffer ? `
                        <span style="font-size: 9.5px; color: var(--color-text-tertiary); text-decoration: line-through; font-weight: 700;">${formatPrice(item.price)}</span>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="pm-footer">
        <div class="pm-qty-main" style="${(!isCommerceOpen || isOutOfStock) ? 'opacity: 0.5; pointer-events: none;' : ''}">
          <button class="pm-main-qty-btn" id="pm-qty-minus">${icon('minus', 18)}</button>
          <span class="pm-main-qty-val">${qty}</span>
          <button class="pm-main-qty-btn" id="pm-qty-plus">${icon('plus', 18)}</button>
        </div>
        <button class="pm-add-btn" id="pm-add-btn" ${isAddDisabled ? 'disabled style="background: #cbd5e1; color: #94a3b8; cursor: not-allowed; justify-content: center; width: 100%; display: flex; border: none; box-shadow: none;"' : 'style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"'}>
          ${btnText}
        </button>
      </div>
    `;

    // Event Listeners
    modalContent.querySelectorAll('.pm-option').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.pm-qty-stepper')) return;

        const gIdx = parseInt(item.dataset.groupIdx);
        const oIdx = parseInt(item.dataset.optIdx);
        const group = optionsGroups[gIdx];
        const opt = group.options[oIdx];

        const existingIdx = selectedOptions.findIndex(o => o.groupName === group.name && o.name === opt.name);

        if (group.multi) {
          if (existingIdx > -1) {
            selectedOptions.splice(existingIdx, 1);
          } else {
            if (group.maxSelections) {
              const currentCount = selectedOptions.filter(o => o.groupName === group.name).reduce((sum, o) => sum + (o.qty || 1), 0);
              if (currentCount >= group.maxSelections) {
                showToast(`Elegiste el máximo de ${group.maxSelections} ${group.maxSelections === 1 ? 'sabor/opción' : 'sabores/opciones'}`, 'warning');
                return;
              }
            }
            selectedOptions.push({ groupName: group.name, name: opt.name, price: opt.price || 0, qty: 1 });
          }
        } else {
          // Single choice
          const otherIdx = selectedOptions.findIndex(o => o.groupName === group.name);
          if (otherIdx > -1) selectedOptions.splice(otherIdx, 1);
          selectedOptions.push({ groupName: group.name, name: opt.name, price: opt.price || 0, qty: 1 });
        }
        render();
      };
    });

    // Steppers inside options
    modalContent.querySelectorAll('.pm-qty-btn.minus').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const gIdx = btn.dataset.gidx;
        const oIdx = btn.dataset.oidx;
        const group = optionsGroups[gIdx];
        const opt = group.options[oIdx];
        const selection = selectedOptions.find(o => o.groupName === group.name && o.name === opt.name);
        if (selection && selection.qty > 1) {
          selection.qty--;
          render();
        } else if (selection && selection.qty === 1) {
          const idx = selectedOptions.indexOf(selection);
          selectedOptions.splice(idx, 1);
          render();
        }
      };
    });

    modalContent.querySelectorAll('.pm-qty-btn.plus').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const gIdx = btn.dataset.gidx;
        const oIdx = btn.dataset.oidx;
        const group = optionsGroups[gIdx];
        const opt = group.options[oIdx];
        const selection = selectedOptions.find(o => o.groupName === group.name && o.name === opt.name);
        
        if (group.maxSelections) {
          const currentCount = selectedOptions.filter(o => o.groupName === group.name).reduce((sum, o) => sum + (o.qty || 1), 0);
          if (currentCount >= group.maxSelections) {
            showToast(`Elegiste el máximo de ${group.maxSelections} ${group.maxSelections === 1 ? 'sabor/opción' : 'sabores/opciones'}`, 'warning');
            return;
          }
        }

        if (selection && selection.qty < (opt.maxQty || 99)) {
          selection.qty++;
          render();
        }
      };
    });

    // Main qty
    modalContent.querySelector('#pm-qty-minus').onclick = () => {
      if (qty > 1) { qty--; render(); }
    };
    modalContent.querySelector('#pm-qty-plus').onclick = () => {
      if (isLimited && qty >= stockQty) {
        showToast(`Solo quedan ${stockQty} unidades en stock`, 'warning');
        return;
      }
      if (qty < 99) { qty++; render(); }
    };

    // Add to cart
    modalContent.querySelector('#pm-add-btn').onclick = () => {
      if (isAddDisabled) {
        if (missingRequired) {
          showToast(missingRequiredFlavors ? 'Por favor elegí los sabores antes de agregar al carrito.' : 'Por favor completá las opciones obligatorias.', 'warning');
        }
        return;
      }
      if (!isCommerceOpen) {
        showToast('El comercio está cerrado. No puedes agregar productos.', 'warning');
        return;
      }
      if (isOutOfStock) return;

      addToCart(product, comercioId, comercioName, qty, selectedOptions);
      closeModal();
      renderNavbar();
      showToast(`${qty} x ${product.name} al carrito`, 'success');
    };

    // Close button
    modalContent.querySelector('#pm-modal-close').onclick = closeModal;

    // Heart (Favorite) button
    modalContent.querySelector('#pm-modal-heart').onclick = async (e) => {
      e.stopPropagation();
      const heartBtn = modalContent.querySelector('#pm-modal-heart');
      const newState = await toggleProductFavorite(product.id);
      heartBtn.innerHTML = icon('heart', 20, newState ? 'fav-active' : '');

      // Tactile popping animation
      heartBtn.style.transform = 'scale(1.3)';
      setTimeout(() => heartBtn.style.transform = 'scale(1)', 150);

      if (newState) {
        showToast('Agregado a tus favoritos ❤️', 'success');
      } else {
        showToast('Eliminado de tus favoritos', 'info');
      }
    };

    // Zoom (Full Screen) button
    const zoomBtn = modalContent.querySelector('#pm-modal-zoom');
    if (zoomBtn) {
      zoomBtn.onclick = (e) => {
        e.stopPropagation();

        const viewer = document.createElement('div');
        viewer.className = 'pm-image-viewer';
        viewer.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.95);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.25s ease;
        `;

        viewer.innerHTML = `
          <button style="position: absolute; top: 20px; right: 20px; width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,0.15); color: white; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; z-index: 2100;">
            ${icon('close', 24)}
          </button>
          <img src="${product.image}" alt="${product.name}" style="max-width: 95%; max-height: 85%; object-fit: contain; border-radius: 12px; transform: scale(0.9); transition: transform 0.25s ease; box-shadow: 0 10px 40px rgba(0,0,0,0.5);" />
        `;

        document.body.appendChild(viewer);

        // Trigger scale pop transitions
        setTimeout(() => {
          viewer.style.opacity = '1';
          viewer.querySelector('img').style.transform = 'scale(1)';
        }, 10);

        const closeViewer = () => {
          viewer.style.opacity = '0';
          viewer.querySelector('img').style.transform = 'scale(0.9)';
          setTimeout(() => viewer.remove(), 250);
        };

        viewer.onclick = closeViewer;
        viewer.querySelector('button').onclick = closeViewer;
      };
    }

    // Flavor Search Listeners
    const flavorSearch = modalContent.querySelector('#flavor-search-input');
    if (flavorSearch) {
      flavorSearch.oninput = (e) => {
        flavorSearchQuery = e.target.value;
        render();
      };
    }
    const clearFlavorSearch = modalContent.querySelector('#clear-flavor-search-btn');
    if (clearFlavorSearch) {
      clearFlavorSearch.onclick = () => {
        flavorSearchQuery = '';
        render();
      };
    }

    // Suggested product clicks
    modalContent.querySelectorAll('.pm-suggested-row').forEach(row => {
      row.onclick = (e) => {
        e.stopPropagation();
        const suggestedId = row.dataset.suggestedId;
        const targetProduct = allProducts.find(p => p.id === suggestedId);
        if (targetProduct) {
          closeModal();
          setTimeout(() => {
            openProductModal(targetProduct, comercioId, comercioName);
          }, 150);
        }
      };
    });

    const newScrollEl = modalContent.querySelector('.pm-content');
    if (newScrollEl) {
      newScrollEl.scrollTop = scrollTop;
    }

    // Restore focus and cursor selection
    if (activeId) {
      const activeEl = modalContent.querySelector(`#${activeId}`);
      if (activeEl) {
        activeEl.focus();
        if (start !== null && end !== null && activeEl.setSelectionRange) {
          try {
            activeEl.setSelectionRange(start, end);
          } catch (e) {}
        }
      }
    }
  };

  render();

  showModal({
    title: '',
    hideHeader: true,
    content: modalContent,
  });
}
