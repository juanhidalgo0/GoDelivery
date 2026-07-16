// GoDelivery — Cart Page
import { getState, setState, getCartByComercio, getCartTotal, getCartCount, updateCartQty, removeFromCart, clearCart, subscribe, setDeliveryAddress } from '../state.js';
import { formatPrice, calculateScheduleSurcharge } from '../utils/format.js';
import { showToast } from '../components/toast.js';
window.showToast = showToast; // Global access for inline modal events
import { showModal, closeModal, showConfirm } from '../components/modal.js';
import { isLoggedIn } from '../auth.js';
import { renderNavbar } from '../components/navbar.js';
import { icon } from '../utils/icons.js';
import { db, auth } from '../firebase.js';
import { collection, serverTimestamp, runTransaction, doc, addDoc, getDoc, increment, query, where, getDocs, onSnapshot, limit, getDocsFromServer } from 'firebase/firestore';
import { isRainingInMagdalena } from '../utils/weather.js';
import { AudioManager } from '../utils/audio-manager.js';
import { ConfettiCelebrator } from '../utils/confetti.js';

let currentCartStep = 1;
let isSubmitting = false;
let selectedPaymentMethod = null;
let selectedIsScheduled = false;
let selectedSchedDate = '';
let selectedSchedTime = '';

function escapeHtmlAttr(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;');
}

export async function renderCart(content) {
  if (!content) content = document.getElementById('page-cart') || document.getElementById('app-content');
  if (!content) return;

  currentCartStep = 1; // Reset to step 1 when page loads
  selectedPaymentMethod = null; // Reset to null on page load
  setDeliveryAddress('', '', null, ''); // Clear default address to force user choice

  // Start calculating dynamic fees in background
  calculateAllFees();

  const isPreview = window.location.hash.includes('preview=true') || window.location.search.includes('preview=true');

  // Weather status is loaded dynamically in real-time in state.js
  if (isPreview) {
    setState('isRaining', false);
  }

  if (!isPreview) {
    try {
      const oSnap = await getDocs(query(collection(db, 'offers'), where('active', '==', true)));
      setState({ activeOffers: oSnap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (e) {
      console.error('Error loading offers', e);
    }
  }

  renderCartContent(content);

  const unsubCart = subscribe('cart', () => {
    calculateAllFees();
    renderCartContent(content);
    renderNavbar();
  });
  const unsubUser = subscribe('user', () => renderCartContent(content));
  const unsubDollarPerPoint = subscribe('dollarPerPoint', () => renderCartContent(content));
  const unsubPointsPerDollar = subscribe('pointsPerDollar', () => renderCartContent(content));
  const unsubTip = subscribe('selectedTip', () => renderCartContent(content));
  const unsubAppliedDiscount = subscribe('appliedDiscount', () => renderCartContent(content));
  const unsubRedeemedPoints = subscribe('redeemedPoints', () => renderCartContent(content));
  const unsubAppliedCoupon = subscribe('appliedCoupon', () => renderCartContent(content));
  const unsubDistances = subscribe('dynamicDistances', () => renderCartContent(content));
  const unsubFees = subscribe('dynamicDeliveryFees', () => renderCartContent(content));
  const unsubAddress = subscribe('deliveryAddress', async () => {
    setState({ dynamicDeliveryFees: {}, dynamicDistances: {} });
    await calculateAllFees();
    renderCartContent(content);
  });

  content.addEventListener('click', handleCartClick);

  return {
    cleanup: () => {
      content.removeEventListener('click', handleCartClick);
      unsubCart();
      unsubUser();
      unsubDollarPerPoint();
      unsubPointsPerDollar();
      unsubTip();
      unsubAppliedDiscount();
      unsubRedeemedPoints();
      unsubAppliedCoupon();
      unsubDistances();
      unsubFees();
      unsubAddress();
    }
  };
}

export async function calculateAllFees(proactiveCommerceId = null) {
  const state = getState();
  const cart = state.cart;

  // 1. Identify unique comercios to calculate
  const commerceIdsInCart = cart.map(item => item.comercioId);
  const comercioIds = [...new Set(proactiveCommerceId ? [...commerceIdsInCart, proactiveCommerceId] : commerceIdsInCart)];

  if (comercioIds.length === 0) return;

  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const { doc, getDoc } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');
  const { setState } = await import('../state.js');

  // 1. Ensure user coords
  let userCoords = state.deliveryCoords;
  if (!userCoords && state.deliveryAddress) {
    userCoords = await geocodeAddress(state.deliveryAddress);
    if (userCoords) {
      // Save for future use (optimistic)
      localStorage.setItem('gd-coords', JSON.stringify(userCoords));
      state.deliveryCoords = userCoords;
    }
  }

  if (!userCoords) return;

  const newFees = {};
  const newDistances = {};

  let changed = false;

  for (const cid of comercioIds) {

    try {
      const cSnap = await getDoc(doc(db, 'comercios', cid));
      if (cSnap.exists()) {
        const cData = cSnap.data();
        const cCoords = cData.coords;

        if (cCoords) {
          const dist = await getDistance(userCoords.lat, userCoords.lng, cCoords.lat, cCoords.lng);
          newDistances[cid] = dist;
          newFees[cid] = calculateDynamicFee(dist);
          changed = true;
        } else if (cData.address) {
          const geocoded = await geocodeAddress(cData.address);
          if (geocoded) {
            const dist = await getDistance(userCoords.lat, userCoords.lng, geocoded.lat, geocoded.lng);
            newDistances[cid] = dist;
            newFees[cid] = calculateDynamicFee(dist);
            changed = true;
          }
        }
      }
    } catch (err) {
      console.error('Error calculating fee for', cid, err);
    }
  }

  if (changed) {
    setState('dynamicDeliveryFees', newFees);
    if (Object.keys(newDistances).length > 0) {
      const mergedDistances = { ...state.dynamicDistances, ...newDistances };
      setState('dynamicDistances', mergedDistances);

      // Persist across reloads to avoid $0 flicker
      localStorage.setItem('gd-cached-fees', JSON.stringify(newFees));
      localStorage.setItem('gd-cached-distances', JSON.stringify(mergedDistances));
    }
  }
}

function renderCartContent(content) {
  const cart = getState().cart;
  const total = getCartTotal();
  const count = getCartCount();

  if (cart.length === 0) {
    content.innerHTML = `
      <div class="cart-page" style="height:100%; display:flex; align-items:center; justify-content:center; padding:20px; background:var(--color-bg-page);">
        <div class="empty-state-professional" style="text-align:center; max-width:320px; width:100%; animation:fadeInUp 0.6s ease-out;">
          <div style="position:relative; width:120px; height:120px; margin:0 auto 32px; display:flex; align-items:center; justify-content:center;">
            <div style="position:absolute; inset:0; background:var(--color-primary); opacity:0.08; border-radius:40px; transform:rotate(-10deg); transition:all 0.5s;"></div>
            <div style="position:absolute; inset:0; background:var(--color-primary); opacity:0.05; border-radius:40px; transform:rotate(10deg); transition:all 0.5s;"></div>
            <div style="width:80px; height:80px; background:white; border-radius:28px; display:flex; align-items:center; justify-content:center; box-shadow:0 15px 35px rgba(0,0,0,0.08); z-index:1; color:var(--color-primary);">
              ${icon('cart', 40)}
            </div>
            <div style="position:absolute; -right:5px; -top:5px; width:40px; height:40px; background:var(--color-bg-page); border-radius:50%; display:flex; align-items:center; justify-content:center; z-index:2;">
              <div style="width:28px; height:28px; background:#FF9500; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 4px 10px rgba(255,149,0,0.3);">
                ${icon('plus', 14)}
              </div>
            </div>
          </div>
          
          <h2 style="font-size:24px; font-weight:900; color:var(--color-text-primary); margin-bottom:12px; letter-spacing:-0.5px;">Tu carrito está vacío</h2>
          <p style="font-size:15px; color:var(--color-text-tertiary); line-height:1.6; margin-bottom:40px; opacity:0.8;">
            Parece que aún no has agregado nada. ¡Explora los mejores comercios de tu zona y haz tu pedido!
          </p>
          
          <a href="#/" class="btn btn-primary" style="height:56px; padding:0 32px; border-radius:18px; font-weight:900; font-size:14px; text-transform:uppercase; letter-spacing:0.05em; display:inline-flex; align-items:center; gap:12px; box-shadow:0 12px 25px rgba(var(--color-primary-rgb), 0.3); transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); width:100%;">
            ${icon('search', 18)} EXPLORAR COMERCIOS
          </a>
        </div>
      </div>
      <style>
        @keyframes fadeInUp {
          from { opacity:0; transform:translateY(20px); }
          to { opacity:1; transform:translateY(0); }
        }
      </style>
    `;
    return;
  }

  const grouped = getCartByComercio();

  const stepHeaderOrProducts = currentCartStep === 1 ? `
        <!-- Zona de Productos (Scrollable) -->
        <div class="cart-scroll-area">
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4); margin-top:var(--space-2);">
            <h1 class="cart-page-title" style="margin:0; display:flex; align-items:center; gap:var(--space-2); font-size:22px;">
              ${icon('cart', 22)} Mi Carrito 
              <span style="font-size:12px;color:var(--color-text-secondary);font-weight:normal;opacity:0.7;margin-left:4px;">(${count} items)</span>
            </h1>
            
            <button class="btn btn-ghost" style="color:var(--color-danger); opacity:0.8; font-size:10px; padding:var(--space-2); height:auto; display:flex; align-items:center; gap:4px; font-weight:700; background:rgba(239, 68, 68, 0.05); border-radius:8px;" id="clear-cart-btn">
              ${icon('trash', 12)} VACIAR
            </button>
          </div>
          
          ${Object.entries(grouped).map(([comercioId, group]) => `
            <div class="comercio-group" style="margin-bottom:var(--space-5); background:var(--color-bg-card); border-radius:var(--radius-xl); border:1px solid var(--color-border-light); overflow:hidden; box-shadow:var(--shadow-md);">
              <div style="padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--color-border-light); background:var(--color-bg-secondary); display:flex; justify-content:space-between; align-items:center;">
                <h3 style="font-family:var(--font-display);font-size:14px;font-weight:800;margin:0;display:flex;align-items:center;gap:var(--space-2); color:var(--color-text-primary);">
                  ${icon('store', 18)} ${group.comercioName}
                </h3>
                <div style="display:flex; align-items:center; gap:8px;">
                  ${getState().dynamicDeliveryFees[comercioId] !== undefined ? `
                    <span style="font-size:10px; color:var(--color-text-tertiary); font-weight:600; background:var(--color-bg-secondary); padding:2px 8px; border-radius:6px; border:1px solid var(--color-border-light);">
                      ${getState().dynamicDistances?.[comercioId] ? `${getState().dynamicDistances[comercioId].toFixed(1)} km` : 'Calculando...'}
                    </span>
                  ` : ''}
                  <span class="badge badge-primary" style="font-size:10px;">${group.items.length} productos</span>
                </div>
              </div>
              
              ${group.items.map(item => {
                const basePrice = (item.product.price || 0) + (item.options || []).reduce((os, o) => os + (o.price * (o.qty || 1) || 0), 0);
                const activeOffers = getState().activeOffers || [];
                const offer = activeOffers.find(o => o.active && o.comercioId === comercioId && o.productIds && o.productIds.includes(item.product.id));

                let originalTotal = basePrice * item.qty;
                let finalTotal = originalTotal;
                let offerBadge = '';

                if (offer) {
                  if (offer.type === '2x1') {
                    const paidQty = Math.ceil(item.qty / 2);
                    finalTotal = basePrice * paidQty;
                    offerBadge = `<span style="background:var(--color-secondary-light); color:var(--color-secondary); font-size:9px; font-weight:800; padding:2px 6px; border-radius:6px; margin-left:6px;">2x1</span>`;
                  } else if (offer.type === 'percentage') {
                    finalTotal = originalTotal * ((100 - offer.value) / 100);
                    offerBadge = `<span style="background:var(--color-secondary-light); color:var(--color-secondary); font-size:9px; font-weight:800; padding:2px 6px; border-radius:6px; margin-left:6px;">${offer.value}% OFF</span>`;
                  }
                }

                return `
                  <div class="cart-item" data-cart-item-id="${escapeHtmlAttr(item.cartItemId)}" data-comercio-id="${comercioId}" style="display:flex; align-items:center; gap:var(--space-3); position:relative; padding-bottom:var(--space-3); border-bottom:1px solid var(--color-border-light);">
                    <img src="${item.product.image || '/logo.png'}" alt="${item.product.name}" style="width:50px; height:50px; border-radius:var(--radius-md); object-fit:cover; flex-shrink:0; background:var(--color-bg-secondary);" />
                    <div style="flex:1; min-width:0;">
                      <div style="font-weight:700; font-size:14px; color:var(--color-text-primary); display:flex; align-items:center; gap:4px;">
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.product.name}</span>
                        ${offerBadge}
                      </div>
                      <div style="display:flex; align-items:center; gap:var(--space-2);">
                        <span style="color:var(--color-primary); font-weight:800; font-size:13px;">${formatPrice(finalTotal)}</span>
                        ${finalTotal !== originalTotal ? `<span style="font-size:11px; color:var(--color-text-tertiary); font-weight:500; text-decoration:line-through;">${formatPrice(originalTotal)}</span>` : ''}
                        ${item.qty > 1 ? `<span style="font-size:11px; color:var(--color-text-tertiary); font-weight:500;">(${item.qty} x ${formatPrice(basePrice)})</span>` : ''}
                      </div>
                      ${item.options && item.options.length > 0 ? `
                        <div style="font-size:10px; color:var(--color-text-secondary); margin-top:4px; opacity:0.8; line-height:1.2;">
                          ${item.options.map(o => `${o.qty > 1 ? `${o.qty}x ` : ''}${o.name}`).join(', ')}
                        </div>
                      ` : ''}
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <div class="qty-controls" style="background:var(--color-bg-secondary); border-radius:var(--radius-md); border:1px solid var(--color-border-light); padding:2px; display:flex; align-items:center;">
                        <button class="qty-btn cart-qty-btn" data-action="minus" data-id="${escapeHtmlAttr(item.cartItemId)}" data-cid="${comercioId}" style="width:24px; height:24px; font-size:14px;">−</button>
                        <span class="qty-value" style="font-size:13px; min-width:24px; text-align:center; color:var(--color-text-primary);">${item.qty}</span>
                        <button class="qty-btn cart-qty-btn" data-action="plus" data-id="${escapeHtmlAttr(item.cartItemId)}" data-cid="${comercioId}" style="width:24px; height:24px; font-size:14px;">+</button>
                      </div>
                      <button class="cart-item-remove" data-id="${escapeHtmlAttr(item.cartItemId)}" data-cid="${comercioId}" style="background:rgba(239,68,68,0.08); border:none; color:var(--color-danger); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer;" title="Eliminar producto">
                        ${icon('trash', 14)}
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `).join('')}
        </div>
  ` : `
        <!-- Paso 2 Header y Botones de Beneficios (Scrollable) -->
        <div class="cart-scroll-area">
          <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px; margin-top:12px; background:var(--color-bg-card); border-radius:18px; border:1px solid var(--color-border-light); padding:16px; box-shadow:var(--shadow-xs);">
            <button class="btn btn-ghost" id="cart-back-step-btn" style="padding:0; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); cursor:pointer; color:var(--color-text-primary);">
              ${icon('back', 20)}
            </button>
            <div>
              <h2 style="font-family:var(--font-display); font-size:17px; font-weight:900; margin:0; color:var(--color-text-primary); text-align:left;">Beneficios y Propina</h2>
              <p style="font-size:12px; color:var(--color-text-secondary); margin:4px 0 0 0; opacity:0.8; text-align:left;">Paso 2 de 2: Personalizá tu orden</p>
            </div>
          </div>

          <!-- Compact Tipping, GoPoints, and Coupon (Step 2 Top) -->
          ${(() => {
            const state = getState();
            const selectedTip = state.selectedTip || 0;
            const appliedDiscount = state.appliedDiscount || 0;
            const userPoints = state.user?.points || 0;
            const appliedCoupon = state.appliedCoupon;

            return `
              <div style="display:flex; flex-direction:column; gap:16px; margin-bottom:24px;">
                <!-- Tip Pill -->
                <button id="cart-open-tip-btn" style="display:flex; align-items:center; justify-content:space-between; padding:16px; background:var(--color-bg-card); border:1.5px solid ${selectedTip > 0 ? '#10b981' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
                  <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                    <div style="width:36px; height:36px; background:${selectedTip > 0 ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'var(--color-surface-hover)'}; color:${selectedTip > 0 ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                      ${icon('dollarSign', 18)}
                    </div>
                    <div style="min-width:0;">
                      <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Propina al Repartidor</div>
                      <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                        ${selectedTip > 0 ? `Propina aplicada: ${formatPrice(selectedTip)}` : 'Apoyar repartidor'}
                      </div>
                    </div>
                  </div>
                  <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
                    ${selectedTip > 0 ? icon('checkCircle', 16, '', '#10b981') : icon('chevronRight', 16)}
                  </div>
                </button>

                <!-- GoPoints Pill -->
                <button id="cart-open-gopoints-btn" style="display:flex; align-items:center; justify-content:space-between; padding:16px; background:var(--color-bg-card); border:1.5px solid ${appliedDiscount > 0 ? '#f59e0b' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
                  <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                    <div style="width:36px; height:36px; background:${appliedDiscount > 0 ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'var(--color-surface-hover)'}; color:${appliedDiscount > 0 ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                      ${icon('goPointsLogo', 20)}
                    </div>
                    <div style="min-width:0;">
                      <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Canjear GoPoints</div>
                      <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                        ${appliedDiscount > 0 ? `Descuento: -${formatPrice(appliedDiscount)}` : `Disponibles: ${userPoints} pts`}
                      </div>
                    </div>
                  </div>
                  <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
                    ${appliedDiscount > 0 ? icon('checkCircle', 16, '', '#f59e0b') : icon('chevronRight', 16)}
                  </div>
                </button>

                <!-- Coupon Pill -->
                <button id="cart-open-coupon-btn" style="display:flex; align-items:center; justify-content:space-between; padding:16px; background:var(--color-bg-card); border:1.5px solid ${appliedCoupon ? '#a855f7' : 'var(--color-border-light)'}; border-radius:18px; cursor:pointer; transition:all 0.2s; outline:none; text-align:left; width:100%; box-sizing:border-box; box-shadow: var(--shadow-sm);">
                  <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                    <div style="width:36px; height:36px; background:${appliedCoupon ? 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)' : 'var(--color-surface-hover)'}; color:${appliedCoupon ? 'white' : 'var(--color-text-secondary)'}; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                      ${icon('tag', 18)}
                    </div>
                    <div style="min-width:0;">
                      <div style="font-size:12px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.5px;">Cupón de Descuento</div>
                      <div style="font-size:11px; color:var(--color-text-secondary); opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                        ${appliedCoupon ? `${appliedCoupon.code} - ${appliedCoupon.scope === 'shipping' ? (appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.value}% En envío` : `$${appliedCoupon.value} En envío`) : (appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.value}% OFF` : `$${appliedCoupon.value} OFF`)}` : 'Ingresar cupón'}
                      </div>
                    </div>
                  </div>
                  <div style="font-size:12px; color:var(--color-text-secondary); display:flex; align-items:center; flex-shrink:0; margin-left:4px;">
                    ${appliedCoupon ? icon('checkCircle', 16, '', '#a855f7') : icon('chevronRight', 16)}
                  </div>
                </button>
              </div>
            `;
          })()}
        </div>
  `;

  content.innerHTML = `
      <div class="cart-container">
        ${stepHeaderOrProducts}
        
        <!-- Consolidated Checkout Dashboard (Fixed Bottom) -->
        ${(() => {
          const commerceEntries = Object.entries(grouped);
          if (commerceEntries.length === 0) return '';

          const isMulti = commerceEntries.length > 1;
          const totalProducts = getCartTotal();

          const dynamicFees = getState().dynamicDeliveryFees;
          const commerceIds = Object.keys(grouped);
          const allFeesReady = commerceIds.every(cid => dynamicFees[cid] !== undefined);

          const selectedTip = getState().selectedTip || 0;
          const individualFees = commerceIds.map(cid => dynamicFees[cid]);
          const maxIndividualFee = allFeesReady ? Math.max(...individualFees, 0) : null;
          const extraStopsFee = (allFeesReady && individualFees.length > 1) ? (individualFees.length - 1) * (getState().deliveryExtraStopFee || 500) : 0;
          const rainSurcharge = getState().isRaining ? (getState().deliveryRainSurcharge || 300) : 0;
          
          let baseDeliveryFeeCalc = null;
          let nightSurcharge = null;
          let totalDelivery = null;

          if (allFeesReady) {
            baseDeliveryFeeCalc = maxIndividualFee + extraStopsFee + rainSurcharge;
            nightSurcharge = calculateScheduleSurcharge(getState().nightSurchargeConfig, baseDeliveryFeeCalc);
            totalDelivery = baseDeliveryFeeCalc + nightSurcharge + selectedTip;
          }

          const appUsageFee = totalProducts * (getState().appUsageFeeRate || 0.05);
          const discount = getState().appliedDiscount || 0;
          
          const appliedCoupon = getState().appliedCoupon;
          let couponDiscount = 0;
          if (appliedCoupon && allFeesReady) {
            const scope = appliedCoupon.scope || 'products';
            const discountType = appliedCoupon.discountType || (appliedCoupon.type === 'free_delivery' ? 'percentage' : 'percentage');
            const couponVal = Number(appliedCoupon.value || 0);

            if (scope === 'shipping' || appliedCoupon.type === 'free_delivery') {
              const feeForCoupon = baseDeliveryFeeCalc + (nightSurcharge || 0);
              if (appliedCoupon.type === 'free_delivery') {
                couponDiscount = feeForCoupon || 0;
              } else if (discountType === 'percentage') {
                couponDiscount = feeForCoupon * (couponVal / 100);
              } else if (discountType === 'fixed') {
                couponDiscount = Math.min(couponVal, feeForCoupon);
              }
            } else { // products
              let targetProductsTotal = totalProducts;
              if (appliedCoupon.ownerId && appliedCoupon.ownerId !== 'admin') {
                const merchantId = appliedCoupon.ownerId;
                const cart = getState().cart || [];
                targetProductsTotal = cart
                  .filter(item => item.comercioId === merchantId)
                  .reduce((sum, item) => {
                    const basePrice = (item.product.price || 0) + (item.options || []).reduce((s, opt) => s + (opt.price * (opt.qty || 1) || 0), 0);
                    const activeOffers = getState().activeOffers || [];
                    const offer = activeOffers.find(o => o.active && o.comercioId === item.comercioId && o.productIds && o.productIds.includes(item.product.id));
                    if (offer) {
                      if (offer.type === '2x1') {
                        const paidQty = Math.ceil(item.qty / 2);
                        return sum + basePrice * paidQty;
                      } else if (offer.type === 'percentage') {
                        const disc = (100 - (offer.value || 0)) / 100;
                        return sum + basePrice * item.qty * disc;
                      }
                    }
                    return sum + basePrice * item.qty;
                  }, 0);
              } else if (appliedCoupon.comercioIds && Array.isArray(appliedCoupon.comercioIds) && appliedCoupon.comercioIds.length > 0) {
                const cart = getState().cart || [];
                targetProductsTotal = cart
                  .filter(item => appliedCoupon.comercioIds.includes(item.comercioId))
                  .reduce((sum, item) => {
                    const basePrice = (item.product.price || 0) + (item.options || []).reduce((s, opt) => s + (opt.price * (opt.qty || 1) || 0), 0);
                    const activeOffers = getState().activeOffers || [];
                    const offer = activeOffers.find(o => o.active && o.comercioId === item.comercioId && o.productIds && o.productIds.includes(item.product.id));
                    if (offer) {
                      if (offer.type === '2x1') {
                        const paidQty = Math.ceil(item.qty / 2);
                        return sum + basePrice * paidQty;
                      } else if (offer.type === 'percentage') {
                        const disc = (100 - (offer.value || 0)) / 100;
                        return sum + basePrice * item.qty * disc;
                      }
                    }
                    return sum + basePrice * item.qty;
                  }, 0);
              }

              if (discountType === 'percentage') {
                couponDiscount = targetProductsTotal * (couponVal / 100);
              } else if (discountType === 'fixed') {
                couponDiscount = Math.min(couponVal, targetProductsTotal);
              }
            }
          }

          const grandTotal = allFeesReady ? Math.max(totalProducts + totalDelivery + appUsageFee - discount - couponDiscount, 0) : null;

          return `
            <div class="cart-fixed-footer">
              
              ${currentCartStep === 2 ? `
              <!-- Payment Method Selection Card -->
              <div style="display: flex; gap: 10px; margin-bottom: 12px; width: 100%;">
                <label class="payment-option" style="flex: 1; margin: 0;">
                  <input type="radio" name="payment-method" value="efectivo" ${selectedPaymentMethod === 'efectivo' ? 'checked' : ''} style="display:none;">
                  <div class="pm-card-v4 pm-cash" style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 800; font-size: 13px;">
                    <span class="pm-label">EFECTIVO</span>
                    <div class="pm-dot"></div>
                  </div>
                </label>
                
                <label class="payment-option" style="flex: 1; margin: 0;">
                  <input type="radio" name="payment-method" value="mercadopago" ${selectedPaymentMethod === 'mercadopago' ? 'checked' : ''} style="display:none;">
                  <div class="pm-card-v4 pm-mp" style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 800; font-size: 13px;">
                    <span class="pm-label">TRANSFERENCIA</span>
                    <div class="pm-dot"></div>
                  </div>
                </label>
              </div>
              ` : ''}

              <div style="background:var(--color-bg-secondary); padding:var(--space-3); border-radius:var(--radius-lg); margin-bottom:var(--space-4); border:1px solid var(--color-border-light);">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:var(--color-text-secondary); font-size:12px;">
                  <span>Subtotal ${isMulti ? `(${commerceEntries.length} comercios)` : ''}</span>
                  <span style="color:var(--color-text-primary); font-weight:600;">${formatPrice(totalProducts)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:var(--color-text-secondary); font-size:12px; align-items:center;">
                  <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                    <span>Envío ${isMulti ? '(Múltiple)' : ''}</span>
                    <button id="show-fee-details" style="background:none; border:none; padding:0; color:var(--color-primary); cursor:pointer; display:flex; align-items:center; opacity:0.8; margin-right:4px;">${icon('info', 14)}</button>
                    ${getState().isRaining ? `
                      <span class="rain-badge-pulsing" style="background:rgba(0,158,227,0.08); color:#009EE3; font-size:10px; font-weight:900; padding:2px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; border:1px solid rgba(0,158,227,0.15); animation: pulse 2s infinite;">
                        ${icon('cloudRain', 11)} +${formatPrice(getState().deliveryRainSurcharge || 300)} Lluvia
                      </span>
                    ` : ''}
                    ${nightSurcharge > 0 ? `
                      <span class="night-badge-pulsing" style="background:rgba(163,11,17,0.08); color:#a30b11; font-size:10px; font-weight:900; padding:2px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; border:1px solid rgba(163,11,17,0.15); animation: pulse 2s infinite;">
                        ${icon('moon', 11)} +${formatPrice(nightSurcharge)} Nocturno
                      </span>
                    ` : ''}
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    ${!isMulti && Object.values(getState().dynamicDistances || {})[0] ? `
                      <span style="font-size:10px; opacity:0.6; font-weight:600;">(${Object.values(getState().dynamicDistances)[0].toFixed(1)} km)</span>
                    ` : ''}
                    <span style="color:var(--color-success); font-weight:700;">${allFeesReady ? (totalDelivery > 0 ? `${formatPrice(totalDelivery)}${selectedTip > 0 ? ` (incluye ${formatPrice(selectedTip)} propina)` : ''}` : '¡Gratis!') : 'Calculando...'}</span>
                  </div>
                </div>
                <div style="display:flex; justify-content:space-between; color:var(--color-text-tertiary); font-size:11px; opacity:0.8; margin-bottom:4px;">
                  <span>Tarifa de servicio</span>
                  <span>${formatPrice(appUsageFee)}</span>
                </div>
                ${getState().appliedDiscount ? `
                  <div style="display:flex; justify-content:space-between; color:var(--color-success); font-size:12px; font-weight:700; margin-top:4px; padding-top:4px; border-top:1px dashed var(--color-border-light);">
                    <span>Descuento GoPoints</span>
                    <span>- ${formatPrice(getState().appliedDiscount)}</span>
                  </div>
                ` : ''}
                ${getState().appliedCoupon ? `
                  <div style="display:flex; justify-content:space-between; color:#a855f7; font-size:12px; font-weight:700; margin-top:4px; padding-top:4px; border-top:1px dashed var(--color-border-light);">
                    <span>Cupón (${getState().appliedCoupon.code})</span>
                    <span>- ${formatPrice(couponDiscount)}</span>
                  </div>
                ` : ''}
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4); padding:0 var(--space-2);">

                <div style="display:flex; flex-direction:column;">
                  <span style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Total a pagar</span>
                  <span style="font-size:24px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.03em;">${allFeesReady ? formatPrice(grandTotal) : '---'}</span>
                </div>
                
                <button class="btn btn-primary checkout-btn" 
                        id="global-checkout-btn"
                        ${!allFeesReady ? 'disabled' : ''}
                        style="height:54px; width:180px; border-radius:16px; font-size:14px; font-weight:900; text-transform:uppercase; letter-spacing:0.02em; display:flex; align-items:center; justify-content:center; gap:var(--space-2); background:${!allFeesReady ? 'var(--color-text-tertiary)' : 'var(--color-primary)'}; box-shadow: ${!allFeesReady ? 'none' : '0 12px 24px rgba(var(--color-primary-rgb), 0.3)'}; border:none; opacity: ${!allFeesReady ? 0.6 : 1}; pointer-events: ${!allFeesReady ? 'none' : 'auto'};">
                  ${currentCartStep === 1 ? `${icon('arrowRight', 18)} SIGUIENTE` : `${icon('check', 18)} ${isMulti ? 'PEDIDO MÚLTIPLE' : 'CONFIRMAR'}`}
                </button>
              </div>
            </div>
          `;
        })()}
      </div>

      <style>
        @keyframes pulse {
          0% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
          100% { opacity: 0.6; transform: scale(1); }
        }
        .payment-option { cursor: pointer; width: 100%; }
        
        .pm-card-v4 {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border-light);
          padding: 16px 12px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          cursor: pointer;
        }

        .pm-label {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          color: var(--color-text-secondary);
          transition: all 0.3s;
          text-align: center;
        }

        .pm-dot {
          position: absolute;
          bottom: 8px;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: white;
          opacity: 0;
          transform: translateY(4px);
          transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        /* Active Cash */
        .payment-option input:checked + .pm-cash {
          background: #22C55E;
          border-color: #22C55E;
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(34, 197, 94, 0.3);
        }
        .payment-option input:checked + .pm-cash .pm-label { color: white; }
        .payment-option input:checked + .pm-cash .pm-dot { 
          opacity: 1; 
          transform: translateY(0); 
        }

        /* Active MP */
        .payment-option input:checked + .pm-mp {
          background: #009EE3;
          border-color: #009EE3;
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(0, 158, 227, 0.3);
        }
        .payment-option input:checked + .pm-mp .pm-label { color: white; }
        .payment-option input:checked + .pm-mp .pm-dot { 
          opacity: 1; 
          transform: translateY(0); 
        }

        /* Dark Mode */
        [data-theme="dark"] .pm-card-v4 {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
        }
        [data-theme="dark"] .pm-label {
          color: rgba(255,255,255,0.5);
        }

        /* Quantity Selector Redesign */
        .qty-controls {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .qty-btn {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          border: none;
          background: var(--color-surface-hover);
          color: var(--color-text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 14px;
          font-weight: 700;
          transition: all 0.2s ease;
        }

        .qty-btn:hover { background: var(--color-primary-light); color: var(--color-primary); }
        .qty-btn:active { transform: scale(0.9); }

        .qty-value {
          font-size: 14px;
          font-weight: 800;
          color: var(--color-text-primary);
          min-width: 20px;
          text-align: center;
        }
      </style>
    </div>
  `;

  content.querySelectorAll('input[name="payment-method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedPaymentMethod = e.target.value;
      const btn = document.getElementById('global-checkout-btn');
      if (!btn) return;
      const isMulti = Object.keys(getCartByComercio()).length > 1;

      if (e.target.value === 'mercadopago') {
        if (currentCartStep === 1) {
          btn.innerHTML = `${icon('arrowRight', 18)} SIGUIENTE`;
        } else {
          btn.innerHTML = `${icon('creditCard', 20)} ${isMulti ? 'PEDIDO MÚLTIPLE' : 'CONFIRMAR'}`;
        }
        btn.style.background = '#009ee3';
        btn.style.boxShadow = '0 10px 20px -5px rgba(0, 158, 227, 0.3)';
      } else {
        if (currentCartStep === 1) {
          btn.innerHTML = `${icon('arrowRight', 18)} SIGUIENTE`;
        } else {
          btn.innerHTML = `${icon('check', 20)} ${isMulti ? 'PEDIDO MÚLTIPLE' : 'CONFIRMAR'}`;
        }
        btn.style.background = 'var(--color-primary)';
        btn.style.boxShadow = '0 10px 20px -5px rgba(var(--color-primary-rgb), 0.3)';
      }
    });
  });

  // Open Tipping Modal trigger
  content.querySelector('#cart-open-tip-btn')?.addEventListener('click', () => {
    openTipModal();
  });

  // Open GoPoints Modal trigger
  content.querySelector('#cart-open-gopoints-btn')?.addEventListener('click', () => {
    openGoPointsModal();
  });

  // Open Coupon Modal trigger
  content.querySelector('#cart-open-coupon-btn')?.addEventListener('click', () => {
    openCouponModal();
  });

  document.getElementById('show-fee-details')?.addEventListener('click', () => {
    showFeeDetails();
  });
}

function showFeeDetails() {
  const state = getState();
  const grouped = getCartByComercio();
  const isMulti = Object.keys(grouped).length > 1;
  const dynamicFees = state.dynamicDeliveryFees;
  const dynamicDistances = state.dynamicDistances || {};

  const { showModal } = import('../components/modal.js');

  let html = `
    <div style="padding:4px;">
      <p style="font-size:13px; color:var(--color-text-secondary); margin-bottom:20px; line-height:1.5;">
        Calculamos el costo de envío basándonos en la distancia real recorrida y la cantidad de comercios.
      </p>
      
      <div style="background:var(--color-bg-secondary); border-radius:16px; padding:16px; border:1px solid var(--color-border-light);">
  `;

  if (isMulti) {
    const individualFees = Object.keys(grouped).map(cid => ({
      name: grouped[cid].comercioName,
      fee: dynamicFees[cid] || state.deliveryCost,
      dist: dynamicDistances[cid] || 0
    }));

    const maxItem = individualFees.reduce((prev, current) => (prev.fee > current.fee) ? prev : current);
    const othersCount = individualFees.length - 1;
    const extraFee = othersCount * (state.deliveryExtraStopFee || 500);

    html += `
      <div style="margin-bottom:12px; padding-bottom:12px; border-bottom:1px dashed var(--color-border-light);">
        <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">LOGICA DE PEDIDO MULTIPLE</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:13px;">
          <span>Envío más largo (${maxItem.name})</span>
          <span style="font-weight:700;">${formatPrice(maxItem.fee)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px;">
          <span>${othersCount} paradas extra ($${state.deliveryExtraStopFee || 500} c/u)</span>
          <span style="font-weight:700; color:var(--color-success);">+ ${formatPrice(extraFee)}</span>
        </div>
      </div>
    `;
  } else {
    const cid = Object.keys(grouped)[0];
    const dist = dynamicDistances[cid] || 0;
    const kmPrice = dist * state.deliveryPricePerKm;
    const totalRaw = state.deliveryBasePrice + kmPrice;
    const minPrice = state.deliveryMinPrice || 1500;
    
    const minAdjustment = Math.max(0, minPrice - totalRaw);
    const beforeRound = Math.max(minPrice, totalRaw);
    const rounded = Math.ceil(beforeRound / 10) * 10;
    const roundingAdjustment = rounded - beforeRound;

    html += `
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
        <span>Costo Base</span>
        <span style="font-weight:600;">${formatPrice(state.deliveryBasePrice)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
        <span>Distancia (${dist.toFixed(1)} km x ${formatPrice(state.deliveryPricePerKm)})</span>
        <span style="font-weight:600;">+ ${formatPrice(kmPrice)}</span>
      </div>
    `;

    if (minAdjustment > 0) {
      html += `
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; color:var(--color-success); font-weight:600;">
          <span>Ajuste Costo Mínimo</span>
          <span>+ ${formatPrice(minAdjustment)}</span>
        </div>
      `;
    }

    if (roundingAdjustment > 0) {
      html += `
        <div style="display:flex; justify-content:space-between; margin-bottom:12px; font-size:13px; color:var(--color-text-tertiary);">
          <span>Ajuste de Redondeo</span>
          <span>+ ${formatPrice(roundingAdjustment)}</span>
        </div>
      `;
    }
  }

  // Calculate base total for surcharges
  let baseDeliveryFeeCalc = 0;
  if (isMulti) {
    const individualFees = Object.keys(grouped).map(cid => dynamicFees[cid] || state.deliveryCost);
    const maxFee = Math.max(...individualFees);
    const othersCount = individualFees.length - 1;
    baseDeliveryFeeCalc = maxFee + (othersCount * (state.deliveryExtraStopFee || 500));
  } else {
    const cid = Object.keys(grouped)[0];
    const dist = dynamicDistances[cid] || 0;
    baseDeliveryFeeCalc = dynamicFees[cid] || Math.ceil(Math.max(state.deliveryMinPrice || 1500, state.deliveryBasePrice + (dist * state.deliveryPricePerKm)) / 10) * 10;
  }

  const nightSurcharge = calculateScheduleSurcharge(state.nightSurchargeConfig, baseDeliveryFeeCalc);
  if (nightSurcharge > 0) {
    html += `
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; padding-top:12px; border-top:1px dashed var(--color-border-light);">
        <span style="display:flex; align-items:center; gap:6px;">${icon('moon', 14)} Recargo Nocturno</span>
        <span style="font-weight:700; color:#a30b11;">+ ${formatPrice(nightSurcharge)}</span>
      </div>
    `;
  }

  if (state.isRaining) {
    const rainSurcharge = state.deliveryRainSurcharge || 300;
    html += `
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; padding-top:${nightSurcharge > 0 ? '0' : '12px'}; border-top:${nightSurcharge > 0 ? 'none' : '1px dashed var(--color-border-light)'};">
        <span style="display:flex; align-items:center; gap:6px;">${icon('cloudRain', 14)} Recargo por Lluvia</span>
        <span style="font-weight:700; color:#009EE3;">+ ${formatPrice(rainSurcharge)}</span>
      </div>
    `;
  }

  const finalBreakdownTotal = baseDeliveryFeeCalc + nightSurcharge + (state.isRaining ? (state.deliveryRainSurcharge || 300) : 0);
  html += `
      <div style="display:flex; justify-content:space-between; margin-top:12px; padding-top:12px; font-size:15px; font-weight:900; color:var(--color-text-primary); border-top:2px solid var(--color-border-light);">
        <span>Total del Envío</span>
        <span>${formatPrice(finalBreakdownTotal)}</span>
      </div>
  `;

  html += `
      </div>
      
      <div style="margin-top:20px; font-size:11px; color:var(--color-text-tertiary); font-style:italic;">
        * Los precios están basados en la configuración global de logística y ruteo en tiempo real.
      </div>
    </div>
  `;

  import('../components/modal.js').then(m => {
    m.showModal({
      title: 'Detalle del Envío',
      content: html
    });
  });
}

function openTipModal() {
  const state = getState();
  const selectedTip = state.selectedTip || 0;
  const presetTips = [300, 500, 700];
  const isCustom = selectedTip > 0 && !presetTips.includes(selectedTip);

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

  modalContent.innerHTML = `
    <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
    
    <div style="text-align: center;">
      <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);">
        ${icon('dollarSign', 28)}
      </div>
      <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
        Propina al Repartidor
      </h2>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
        El 100% de la propina va directamente al repartidor para apoyar su valioso servicio y dedicación.
      </p>
    </div>

    <div style="display:flex; flex-direction:column; gap:16px; margin-top:8px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; width:100%;">
        ${presetTips.map(amount => {
          const isActive = selectedTip === amount;
          return `
            <button class="tip-modal-preset-btn ${isActive ? 'active' : ''}" 
                    data-amount="${amount}"
                    style="flex:1; min-width:80px; height:46px; border-radius:12px; border:2px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${isActive ? 'var(--color-primary-light)' : 'var(--color-bg-secondary)'}; color:${isActive ? 'var(--color-primary)' : 'var(--color-text-primary)'}; font-size:14px; font-weight:800; cursor:pointer; transition:all 0.2s;">
              + ${formatPrice(amount)}
            </button>
          `;
        }).join('')}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Otro Monto (Opcional)</label>
        <div style="position:relative; display:flex; align-items:center;">
          <span style="position:absolute; left:16px; font-size:16px; font-weight:800; color:var(--color-text-secondary);">$</span>
          <input type="number" id="tip-modal-custom-input" 
                 min="1" 
                 placeholder="Ingresa otro valor" 
                 value="${isCustom ? selectedTip : ''}"
                 style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 16px 0 32px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s;" />
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 12px; margin-top: 12px;">
      ${selectedTip > 0 ? `
        <button id="tip-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding:0;">
          ${icon('trash', 16)} Eliminar
        </button>
      ` : ''}
      <button id="tip-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
        ${icon('check', 16)} APLICAR PROPINA
      </button>
    </div>
  `;

  const { close } = showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent
  });

  const customInput = modalContent.querySelector('#tip-modal-custom-input');

  // Highlight active preset chip on click, clear custom input if click preset
  modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(btn => {
    btn.onclick = () => {
      modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--color-border-light)';
        b.style.backgroundColor = 'var(--color-bg-secondary)';
        b.style.color = 'var(--color-text-primary)';
      });
      btn.classList.add('active');
      btn.style.borderColor = 'var(--color-primary)';
      btn.style.backgroundColor = 'var(--color-primary-light)';
      btn.style.color = 'var(--color-primary)';
      
      if (customInput) customInput.value = '';
    };
  });

  // Clear presets if custom input has input
  if (customInput) {
    customInput.oninput = () => {
      modalContent.querySelectorAll('.tip-modal-preset-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--color-border-light)';
        b.style.backgroundColor = 'var(--color-bg-secondary)';
        b.style.color = 'var(--color-text-primary)';
      });
    };
  }

  // Handle Confirm
  const confirmBtn = modalContent.querySelector('#tip-modal-confirm-btn');
  confirmBtn.onclick = () => {
    let finalAmount = 0;
    const activePreset = modalContent.querySelector('.tip-modal-preset-btn.active');
    
    if (activePreset) {
      finalAmount = parseInt(activePreset.dataset.amount, 10);
    } else if (customInput) {
      const valStr = customInput.value.trim();
      if (valStr) {
        finalAmount = parseInt(valStr, 10);
        if (isNaN(finalAmount) || finalAmount <= 0) {
          showToast('Por favor ingresá un monto de propina válido.', 'warning');
          return;
        }
      }
    }

    setState('selectedTip', finalAmount);
    if (finalAmount > 0) {
      showToast(`Propina de ${formatPrice(finalAmount)} agregada.`, 'success');
    } else {
      showToast('Propina eliminada.', 'info');
    }
    close();
  };

  // Handle Clear
  const clearBtn = modalContent.querySelector('#tip-modal-clear-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      setState('selectedTip', 0);
      showToast('Propina eliminada.', 'info');
      close();
    };
  }
}

function openGoPointsModal() {
  const state = getState();
  const userPoints = state.user?.points || 0;
  const dollarPerPoint = state.dollarPerPoint || 1;
  const appliedDiscount = state.appliedDiscount || 0;
  const redeemedPoints = state.redeemedPoints || 0;

  // Calculate maximum redeemable points
  const grouped = getCartByComercio();
  const totalProducts = getCartTotal();
  const dynamicFees = state.dynamicDeliveryFees || {};
  const commerceIds = Object.keys(grouped);
  const allFeesReady = commerceIds.every(cid => dynamicFees[cid] !== undefined);

  const selectedTip = state.selectedTip || 0;
  let totalDelivery = 0;
  let nightSurcharge = 0;
  if (allFeesReady) {
    const individualFees = commerceIds.map(cid => dynamicFees[cid]);
    const maxIndividualFee = Math.max(...individualFees, 0);
    const extraStopsFee = (individualFees.length > 1) ? (individualFees.length - 1) * (state.deliveryExtraStopFee || 500) : 0;
    const rainSurcharge = state.isRaining ? (state.deliveryRainSurcharge || 300) : 0;
    const baseDeliveryFee = maxIndividualFee + extraStopsFee + rainSurcharge;
    nightSurcharge = calculateScheduleSurcharge(state.nightSurchargeConfig, baseDeliveryFee);
    totalDelivery = baseDeliveryFee + nightSurcharge + selectedTip;
  }
  const appUsageFee = totalProducts * (state.appUsageFeeRate || 0.05);

  const preDiscountTotal = totalProducts + totalDelivery + appUsageFee;
  const maxPointsToRedeem = Math.min(userPoints, Math.floor(preDiscountTotal / dollarPerPoint));

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

  modalContent.innerHTML = `
    <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
    
    <div style="text-align: center;">
      <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(245, 158, 11, 0.35);">
        ${icon('goPointsLogo', 30)}
      </div>
      <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
        Canjear GoPoints
      </h2>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
        Canjeá tus puntos acumulados por descuentos directos en este pedido.
      </p>
    </div>

    <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--color-text-secondary);">
        <span>Tus puntos disponibles:</span>
        <span style="font-weight:800; color:var(--color-text-primary);">${userPoints} pts (${formatPrice(userPoints * dollarPerPoint)})</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--color-text-secondary);">
        <span>Tipo de cambio:</span>
        <span style="font-weight:700; color:var(--color-text-primary);">1 pt = ${formatPrice(dollarPerPoint)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--color-text-secondary);">
        <span>Canje máximo permitido:</span>
        <span style="font-weight:800; color:var(--color-primary);">${maxPointsToRedeem} pts (${formatPrice(maxPointsToRedeem * dollarPerPoint)})</span>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Puntos a canjear</label>
      <div style="position:relative; display:flex; align-items:center; width:100%;">
        <input type="number" id="gopoints-modal-input" 
               min="1" 
               max="${maxPointsToRedeem}" 
               placeholder="Ej. 100" 
               value="${redeemedPoints > 0 ? redeemedPoints : ''}"
               style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 100px 0 16px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s;" />
        <button id="gopoints-modal-max-btn" 
                style="position:absolute; right:8px; top:50%; transform:translateY(-50%); background:var(--color-primary-light); border:none; color:var(--color-primary); font-size:11px; font-weight:900; padding:8px 14px; border-radius:10px; cursor:pointer; transition:all 0.2s;">
          MÁXIMO
        </button>
      </div>
      <div id="gopoints-modal-error" style="display:none; color:var(--color-danger); font-size:12px; font-weight:700; padding-left:4px; margin-top: 4px;"></div>
    </div>

    <div style="display: flex; gap: 12px; margin-top: 12px;">
      ${appliedDiscount > 0 ? `
        <button id="gopoints-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0;">
          ${icon('trash', 16)} Quitar
        </button>
      ` : ''}
      <button id="gopoints-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
        ${icon('check', 16)} APLICAR DESCUENTO
      </button>
    </div>
  `;

  const { close } = showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent
  });

  const input = modalContent.querySelector('#gopoints-modal-input');
  const errorMsg = modalContent.querySelector('#gopoints-modal-error');
  const maxBtn = modalContent.querySelector('#gopoints-modal-max-btn');
  const confirmBtn = modalContent.querySelector('#gopoints-modal-confirm-btn');
  const clearBtn = modalContent.querySelector('#gopoints-modal-clear-btn');

  if (maxBtn && input) {
    maxBtn.onclick = () => {
      input.value = maxPointsToRedeem;
      if (errorMsg) errorMsg.style.display = 'none';
    };
  }

  if (input) {
    input.oninput = () => {
      if (errorMsg) errorMsg.style.display = 'none';
    };
  }

  confirmBtn.onclick = () => {
    const valStr = input.value.trim();
    if (!valStr) {
      errorMsg.textContent = 'Por favor ingresá una cantidad de puntos.';
      errorMsg.style.display = 'block';
      return;
    }

    const points = parseInt(valStr, 10);
    if (isNaN(points) || points <= 0) {
      errorMsg.textContent = 'Ingresá un número de puntos válido mayor a 0.';
      errorMsg.style.display = 'block';
      return;
    }

    if (points > userPoints) {
      errorMsg.textContent = `No tenés suficientes puntos. Tu saldo actual es de ${userPoints} pts.`;
      errorMsg.style.display = 'block';
      return;
    }

    if (points > maxPointsToRedeem) {
      errorMsg.textContent = `El canje máximo para este pedido es de ${maxPointsToRedeem} pts.`;
      errorMsg.style.display = 'block';
      return;
    }

    errorMsg.style.display = 'none';
    const discountValue = points * dollarPerPoint;
    setState('appliedDiscount', discountValue);
    setState('redeemedPoints', points);
    showToast(`¡Descuento de ${formatPrice(discountValue)} aplicado!`, 'success');
    close();
  };

  if (clearBtn) {
    clearBtn.onclick = () => {
      setState('appliedDiscount', 0);
      setState('redeemedPoints', 0);
      showToast('Descuento de GoPoints removido.', 'info');
      close();
    };
  }
}

function openCouponModal() {
  const state = getState();
  const appliedCoupon = state.appliedCoupon;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

  modalContent.innerHTML = `
    <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
    
    <div style="text-align: center;">
      <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(168, 85, 247, 0.35);">
        ${icon('tag', 26)}
      </div>
      <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
        Ingresar Cupón
      </h2>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; padding: 0 10px;">
        Ingresá un código promocional para obtener envíos gratis o descuentos en tus comercios favoritos.
      </p>
    </div>

    ${appliedCoupon ? `
      <div style="background: rgba(168, 85, 247, 0.05); border: 1.5px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 14px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 11px; font-weight: 900; color: #a855f7; text-transform: uppercase; letter-spacing: 0.5px;">CUPÓN ACTIVO</div>
          <div style="font-size: 14px; font-weight: 800; color: var(--color-text-primary); margin-top: 2px;">
            ${appliedCoupon.code} <span style="font-size: 12px; font-weight: 600; color: var(--color-text-secondary); opacity: 0.85;">(${appliedCoupon.type === 'free_delivery' ? 'Envío Gratis' : `${appliedCoupon.value}% OFF`})</span>
          </div>
        </div>
        <div style="width: 24px; height: 24px; color: #a855f7; display: flex; align-items: center; justify-content: center;">
          ${icon('checkCircle', 18)}
        </div>
      </div>
    ` : ''}

    <div style="display:flex; flex-direction:column; gap:8px;">
      <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Código del Cupón</label>
      <div style="position:relative; display:flex; align-items:center; width:100%;">
        <input type="text" id="coupon-modal-input" 
               placeholder="Ej. GODEL-XYZ" 
               value="${appliedCoupon ? appliedCoupon.code : ''}"
               style="width:100%; height:50px; border-radius:14px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); padding:0 16px; font-size:15px; font-weight:800; color:var(--color-text-primary); outline:none; transition:all 0.2s; text-transform: uppercase;" />
      </div>
      <div id="coupon-modal-error" style="display:none; color:var(--color-danger); font-size:12px; font-weight:700; padding-left:4px; margin-top: 4px;"></div>
    </div>

    <div style="display: flex; gap: 12px; margin-top: 12px;">
      ${appliedCoupon ? `
        <button id="coupon-modal-clear-btn" class="btn btn-ghost" style="height: 52px; flex: 1; border-radius: 14px; font-weight: 800; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0;">
          ${icon('trash', 16)} Quitar
        </button>
      ` : ''}
      <button id="coupon-modal-confirm-btn" class="btn btn-primary" style="height: 52px; flex: 2; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); border: none; box-shadow: 0 8px 20px rgba(168, 85, 247, 0.25);">
        ${icon('check', 16)} APLICAR CUPÓN
      </button>
    </div>
  `;

  const { close } = showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent
  });

  const input = modalContent.querySelector('#coupon-modal-input');
  const errorMsg = modalContent.querySelector('#coupon-modal-error');
  const confirmBtn = modalContent.querySelector('#coupon-modal-confirm-btn');
  const clearBtn = modalContent.querySelector('#coupon-modal-clear-btn');

  if (input) {
    input.oninput = () => {
      if (errorMsg) errorMsg.style.display = 'none';
      input.value = input.value.toUpperCase();
    };
  }

  confirmBtn.onclick = async () => {
    const valStr = input.value.trim().toUpperCase();
    if (!valStr) {
      errorMsg.textContent = 'Por favor ingresá un código de cupón.';
      errorMsg.style.display = 'block';
      return;
    }

    if (!auth.currentUser) {
      errorMsg.textContent = 'Debes iniciar sesión para validar cupones.';
      errorMsg.style.display = 'block';
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `${icon('loader', 16, 'animate-spin')} VALIDANDO...`;
    if (clearBtn) clearBtn.disabled = true;
    if (input) input.disabled = true;

    try {
      // 1. Fetch coupon doc from Firestore
      const couponRef = doc(db, 'coupons', valStr);
      const couponSnap = await getDoc(couponRef);

      if (!couponSnap.exists()) {
        throw new Error('El cupón ingresado no existe.');
      }

      const cData = couponSnap.data();

      // 2. Validate coupon properties
      if (cData.active !== true) {
        throw new Error('El cupón ingresado no está activo.');
      }

      if (typeof cData.remaining === 'number' && cData.remaining <= 0) {
        throw new Error('Este cupón ya no tiene usos disponibles.');
      }

      if (cData.expirationDate) {
        const expDate = new Date(cData.expirationDate + 'T23:59:59-03:00');
        if (Date.now() > expDate.getTime()) {
          throw new Error('Este cupón ha expirado.');
        }
      }

      // Validate merchant coupon limits: cart must contain at least one item from the merchant
      if (cData.ownerId && cData.ownerId !== 'admin') {
        const cart = getState().cart || [];
        const hasMerchantItems = cart.some(item => item.comercioId === cData.ownerId);
        if (!hasMerchantItems) {
          throw new Error(`Este cupón es exclusivo para productos del comercio ${cData.comercioName || 'propietario'}.`);
        }
      } else if (cData.comercioIds && Array.isArray(cData.comercioIds) && cData.comercioIds.length > 0) {
        const cart = getState().cart || [];
        const hasMerchantItems = cart.some(item => cData.comercioIds.includes(item.comercioId));
        if (!hasMerchantItems) {
          throw new Error('Este cupón no es válido para los productos en tu carrito.');
        }
      }

      // Validate order/subtotal limit for fixed discounts
      const isFixed = cData.discountType === 'fixed' || (cData.type !== 'percentage' && cData.type !== 'free_delivery');
      if (isFixed) {
        const couponVal = Number(cData.value || 0);
        let applicableTotal = 0;
        const scope = cData.scope || 'products';

        if (scope === 'shipping') {
          const state = getState();
          const cart = state.cart || [];
          const grouped = {};
          cart.forEach(item => {
            if (!grouped[item.comercioId]) grouped[item.comercioId] = [];
            grouped[item.comercioId].push(item);
          });
          const commerceIds = Object.keys(grouped);
          const dynamicFees = state.dynamicDeliveryFees || {};
          const allFeesReady = commerceIds.every(cid => dynamicFees[cid] !== undefined);
          
          let baseDeliveryFeeCalc = 0;
          let nightSurcharge = 0;
          if (allFeesReady) {
            const individualFees = commerceIds.map(cid => dynamicFees[cid]);
            const maxIndividualFee = Math.max(...individualFees, 0);
            const extraStopsFee = (individualFees.length > 1) ? (individualFees.length - 1) * (state.deliveryExtraStopFee || 500) : 0;
            const rainSurcharge = state.isRaining ? (state.deliveryRainSurcharge || 300) : 0;
            baseDeliveryFeeCalc = maxIndividualFee + extraStopsFee + rainSurcharge;
            nightSurcharge = calculateScheduleSurcharge(state.nightSurchargeConfig, baseDeliveryFeeCalc);
          }
          applicableTotal = baseDeliveryFeeCalc + nightSurcharge;
        } else {
          const totalProducts = getCartTotal();
          let targetProductsTotal = totalProducts;
          if (cData.ownerId && cData.ownerId !== 'admin') {
            const merchantId = cData.ownerId;
            const cart = getState().cart || [];
            targetProductsTotal = cart
              .filter(item => item.comercioId === merchantId)
              .reduce((sum, item) => {
                const basePrice = (item.product.price || 0) + (item.options || []).reduce((s, opt) => s + (opt.price * (opt.qty || 1) || 0), 0);
                const activeOffers = getState().activeOffers || [];
                const offer = activeOffers.find(o => o.active && o.comercioId === item.comercioId && o.productIds && o.productIds.includes(item.product.id));
                if (offer) {
                  if (offer.type === '2x1') {
                    const paidQty = Math.ceil(item.qty / 2);
                    return sum + basePrice * paidQty;
                  } else if (offer.type === 'percentage') {
                    const disc = (100 - (offer.value || 0)) / 100;
                    return sum + basePrice * item.qty * disc;
                  }
                }
                return sum + basePrice * item.qty;
              }, 0);
          } else if (cData.comercioIds && Array.isArray(cData.comercioIds) && cData.comercioIds.length > 0) {
            const cart = getState().cart || [];
            targetProductsTotal = cart
              .filter(item => cData.comercioIds.includes(item.comercioId))
              .reduce((sum, item) => {
                const basePrice = (item.product.price || 0) + (item.options || []).reduce((s, opt) => s + (opt.price * (opt.qty || 1) || 0), 0);
                const activeOffers = getState().activeOffers || [];
                const offer = activeOffers.find(o => o.active && o.comercioId === item.comercioId && o.productIds && o.productIds.includes(item.product.id));
                if (offer) {
                  if (offer.type === '2x1') {
                    const paidQty = Math.ceil(item.qty / 2);
                    return sum + basePrice * paidQty;
                  } else if (offer.type === 'percentage') {
                    const disc = (100 - (offer.value || 0)) / 100;
                    return sum + basePrice * item.qty * disc;
                  }
                }
                return sum + basePrice * item.qty;
              }, 0);
          }
          applicableTotal = targetProductsTotal;
        }

        if (applicableTotal < couponVal) {
          throw new Error(`El total de tu pedido es menor al valor del cupón (${formatPrice(couponVal)}).`);
        }
      }

      // 3. Client-side check for double redemption to provide fast UX
      const redemptionRef = doc(db, 'coupons', valStr, 'redemptions', auth.currentUser.uid);
      const redemptionSnap = await getDoc(redemptionRef);
      if (redemptionSnap.exists()) {
        throw new Error('Ya has utilizado este cupón anteriormente.');
      }

      // 4. Save to state and notify
      setState('appliedCoupon', {
        code: valStr,
        type: cData.type,
        value: cData.value,
        ownerId: cData.ownerId || 'admin',
        comercioIds: cData.comercioIds || [],
        scope: cData.scope || 'products',
        discountType: cData.discountType || (cData.type === 'free_delivery' ? 'percentage' : 'percentage'),
        absorbedBy: cData.absorbedBy || 'platform',
        comercioName: cData.comercioName || '',
        expirationDate: cData.expirationDate || null
      });

      showToast(`¡Cupón ${valStr} aplicado con éxito!`, 'success');
      close();
    } catch (err) {
      console.error('Error validating coupon:', err);
      errorMsg.textContent = err.message || 'Error al validar el cupón.';
      errorMsg.style.display = 'block';

      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `${icon('check', 16)} APLICAR CUPÓN`;
      if (clearBtn) clearBtn.disabled = false;
      if (input) input.disabled = false;
    }
  };

  if (clearBtn) {
    clearBtn.onclick = () => {
      setState('appliedCoupon', null);
      showToast('Cupón removido.', 'info');
      close();
    };
  }
}

async function checkOnlineDrivers() {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const q = query(
      collection(db, 'users'), 
      where('isOnline', '==', true)
    );
    const snap = await getDocsFromServer(q);
    
    console.log('Driver Verification: Found', snap.size, 'online users');
    
    const hasDelivery = snap.docs.some(d => {
      const data = d.data();
      const isDel = data.isDelivery === true || data.isDelivery === 'true' || data.role === 'delivery';
      
      let lastAct = null;
      if (data.lastActivityAt) {
        if (typeof data.lastActivityAt.toDate === 'function') {
          lastAct = data.lastActivityAt.toDate();
        } else {
          lastAct = new Date(data.lastActivityAt);
        }
      }
      const isActive = lastAct && lastAct >= tenMinutesAgo;
      
      console.log(`- Driver ${d.id}: isDelivery=${data.isDelivery}, role=${data.role}, lastActivity=${lastAct} -> isDel=${isDel}, isActive=${isActive}`);
      return isDel && isActive;
    });
    return hasDelivery;
  } catch (err) {
    console.warn('Error verifying drivers, assuming offline:', err);
    return false;
  }
}

async function openCheckoutConfirmationModal() {
  if (!selectedPaymentMethod) {
    const { showToast } = await import('../components/toast.js');
    showToast('Por favor, selecciona un método de pago', 'warning');
    isSubmitting = false;
    return;
  }

  // Query online drivers in real-time before presenting the modal
  const hasDelivery = await checkOnlineDrivers();
  if (!hasDelivery) {
    isSubmitting = false;
    const { showModal } = await import('../components/modal.js');
    const { close: closeAlert } = showModal({
      title: '',
      hideHeader: true,
      height: 'auto',
      content: `
        <div style="padding: 24px 20px; text-align: center; font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px; color: var(--color-text-primary);">
          <div style="font-size: 44px; margin-bottom: 4px;">🛵</div>
          <h4 style="font-family: var(--font-display); font-size: 18px; font-weight: 900; margin: 0; line-height: 1.3; color: var(--color-danger);">Sin repartidores disponibles</h4>
          <p style="font-size: 13.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; opacity: 0.95;">
            No es posible realizar tu pedido en este momento porque no hay repartidores conectados en la zona. Por favor, intenta de nuevo más tarde.
          </p>
          <button id="no-drivers-close-btn" class="btn btn-primary" style="height: 50px; width: 100%; border-radius: 14px; font-weight: 900; font-size: 14px; background: var(--color-primary); border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.25);">
            ENTENDIDO
          </button>
        </div>
      `
    });
    
    setTimeout(() => {
      const btn = document.getElementById('no-drivers-close-btn');
      if (btn) btn.onclick = () => closeAlert();
    }, 50);
    return;
  }

  const state = getState();
  const address = state.deliveryAddress;
  const user = state.user;
  const paymentMethod = selectedPaymentMethod;

  const grouped = getCartByComercio();
  const commerceEntries = Object.entries(grouped);
  const isMultiOrder = commerceEntries.length > 1;

  // Using module-level selectedIsScheduled, selectedSchedDate, selectedSchedTime

  // Recalculate fees and pricing exactly matching cart UI
  const totalProducts = getCartTotal();
  const dynamicFees = state.dynamicDeliveryFees || {};
  
  const selectedTip = state.selectedTip || 0;
  const individualFees = Object.keys(grouped).map(cid => dynamicFees[cid] !== undefined ? dynamicFees[cid] : (state.deliveryCost || state.deliveryMinPrice || 0));
  const maxIndividualFee = Math.max(...individualFees, 0);
  const extraStopsFee = (individualFees.length > 1) ? (individualFees.length - 1) * (state.deliveryExtraStopFee || 500) : 0;
  const rainSurcharge = state.isRaining ? (state.deliveryRainSurcharge || 300) : 0;
  const baseDeliveryFee = maxIndividualFee + extraStopsFee + rainSurcharge;
  const nightSurcharge = calculateScheduleSurcharge(state.nightSurchargeConfig, baseDeliveryFee);
  const driverIncentive = calculateScheduleSurcharge(state.driverIncentiveConfig, baseDeliveryFee);
  const totalDelivery = baseDeliveryFee + nightSurcharge + selectedTip;

  const appUsageFee = totalProducts * (state.appUsageFeeRate || 0.05);
  const discount = state.appliedDiscount || 0;

  const appliedCoupon = state.appliedCoupon;
  let couponDiscount = 0;
  if (appliedCoupon) {
    const scope = appliedCoupon.scope || 'products';
    const discountType = appliedCoupon.discountType || (appliedCoupon.type === 'free_delivery' ? 'percentage' : 'percentage');
    const couponVal = Number(appliedCoupon.value || 0);

    if (scope === 'shipping' || appliedCoupon.type === 'free_delivery') {
      const feeForCoupon = baseDeliveryFee + (nightSurcharge || 0);
      if (appliedCoupon.type === 'free_delivery') {
        couponDiscount = feeForCoupon || 0;
      } else if (discountType === 'percentage') {
        couponDiscount = feeForCoupon * (couponVal / 100);
      } else if (discountType === 'fixed') {
        couponDiscount = Math.min(couponVal, feeForCoupon);
      }
    } else { // products
      let targetProductsTotal = totalProducts;
      if (appliedCoupon.ownerId && appliedCoupon.ownerId !== 'admin') {
        const merchantId = appliedCoupon.ownerId;
        const cart = getState().cart || [];
        targetProductsTotal = cart
          .filter(item => item.comercioId === merchantId)
          .reduce((sum, item) => {
            const basePrice = (item.product.price || 0) + (item.options || []).reduce((s, opt) => s + (opt.price * (opt.qty || 1) || 0), 0);
            const activeOffers = getState().activeOffers || [];
            const offer = activeOffers.find(o => o.active && o.comercioId === item.comercioId && o.productIds && o.productIds.includes(item.product.id));
            if (offer) {
              if (offer.type === '2x1') {
                const paidQty = Math.ceil(item.qty / 2);
                return sum + basePrice * paidQty;
              } else if (offer.type === 'percentage') {
                const disc = (100 - (offer.value || 0)) / 100;
                return sum + basePrice * item.qty * disc;
              }
            }
            return sum + basePrice * item.qty;
          }, 0);
      }

      if (discountType === 'percentage') {
        couponDiscount = targetProductsTotal * (couponVal / 100);
      } else if (discountType === 'fixed') {
        couponDiscount = Math.min(couponVal, targetProductsTotal);
      }
    }
  }

  const grandTotal = Math.max(totalProducts + totalDelivery + appUsageFee - discount - couponDiscount, 0);

  const commerceNames = commerceEntries.map(([_, g]) => g.comercioName).join(', ');

  const modalContent = document.createElement('div');
  modalContent.className = 'confirm-order-modal-container';
  modalContent.style.cssText = `
    --confirm-padding: 16px 16px 20px;
    --confirm-gap: 12px;
    --confirm-card-padding: 10px 12px;
    --confirm-card-gap: 6px;
    --confirm-title-size: 1.2rem;
    --confirm-subtitle-size: 11px;
    --confirm-text-size: 12px;
    --confirm-label-size: 10px;
    --confirm-total-label: 13px;
    --confirm-total-val: 18px;
    --confirm-btn-height: 44px;
    --confirm-btn-font: 13px;
    
    padding: var(--confirm-padding);
    background: var(--color-bg);
    border-top-left-radius: 28px;
    border-top-right-radius: 28px;
    display: flex;
    flex-direction: column;
    gap: var(--confirm-gap);
    max-height: 82dvh;
    overflow: hidden;
    box-sizing: border-box;
  `;

  modalContent.innerHTML = `
    <style>
      .confirm-order-modal-container {
        --confirm-padding: 16px 16px 20px;
        --confirm-gap: 12px;
        --confirm-card-padding: 10px 12px;
        --confirm-card-gap: 6px;
        --confirm-title-size: 1.2rem;
        --confirm-subtitle-size: 11px;
        --confirm-text-size: 12px;
        --confirm-label-size: 10px;
        --confirm-total-label: 13px;
        --confirm-total-val: 18px;
        --confirm-btn-height: 44px;
        --confirm-btn-font: 13px;
      }
      @media (max-height: 740px) {
        .confirm-order-modal-container {
          --confirm-padding: 10px 12px 14px !important;
          --confirm-gap: 8px !important;
          --confirm-card-padding: 8px 10px !important;
          --confirm-card-gap: 4px !important;
          --confirm-title-size: 1.05rem !important;
          --confirm-subtitle-size: 10px !important;
          --confirm-text-size: 11px !important;
          --confirm-label-size: 9px !important;
          --confirm-total-label: 12px !important;
          --confirm-total-val: 16px !important;
          --confirm-btn-height: 38px !important;
          --confirm-btn-font: 12px !important;
        }
      }
      @media (max-height: 600px) {
        .confirm-order-modal-container {
          --confirm-padding: 6px 8px 10px !important;
          --confirm-gap: 6px !important;
          --confirm-card-padding: 6px 8px !important;
          --confirm-card-gap: 3px !important;
          --confirm-title-size: 0.95rem !important;
          --confirm-subtitle-size: 9px !important;
          --confirm-text-size: 10px !important;
          --confirm-label-size: 8px !important;
          --confirm-total-label: 11px !important;
          --confirm-total-val: 14px !important;
          --confirm-btn-height: 32px !important;
          --confirm-btn-font: 11px !important;
        }
      }
      /* Premium custom toggle switch */
      .confirm-switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 28px;
        flex-shrink: 0;
      }
      .confirm-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .confirm-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--color-border);
        transition: .3s;
        border-radius: 34px;
        border: 2px solid transparent;
      }
      .confirm-slider:before {
        position: absolute;
        content: "";
        height: 20px;
        width: 20px;
        left: 2px;
        bottom: 2px;
        background-color: white;
        transition: .3s;
        border-radius: 50%;
        box-shadow: 0 2px 5px rgba(0,0,0,0.25);
      }
      .confirm-switch input:checked + .confirm-slider {
        background-color: var(--color-primary) !important;
      }
      .confirm-switch input:checked + .confirm-slider:before {
        transform: translateX(20px);
      }
    </style>

    <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 4px; flex-shrink: 0;"></div>
    
    <div style="text-align: center; flex-shrink: 0;">
      <h2 style="font-family: var(--font-display); font-size: var(--confirm-title-size); font-weight: 900; color: var(--color-text-primary); margin: 0 0 2px 0;">
        ${isMultiOrder ? '¿Confirmar Pedido Múltiple?' : '¿Confirmar Pedido?'}
      </h2>
      <p style="font-size: var(--confirm-subtitle-size); color: var(--color-text-secondary); margin: 0;">
        Por favor, verifica los detalles antes de continuar
      </p>
    </div>

    <div class="confirm-modal-scrollable-body" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--confirm-gap); padding-right: 4px; margin-bottom: 4px;">
      <!-- DIRECCIÓN DE ENTREGA (Interactive Address Card) -->
      <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 14px; padding: var(--confirm-card-padding); display: flex; flex-direction: column; gap: var(--confirm-card-gap); transition: all 0.2s; flex-shrink: 0;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: var(--confirm-label-size); font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
          ${icon('mapPin', 12)} Dirección de entrega
        </span>
        <button id="confirm-change-address-btn" style="background: var(--color-primary-light); border: none; color: var(--color-primary); font-size: var(--confirm-btn-font); font-weight: 800; padding: 4px 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 3px; transition: all 0.2s;">
          ${icon('edit', 10)} Cambiar
        </button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div id="confirm-address-text" style="font-weight: 800; font-size: var(--confirm-text-size); color: var(--color-text-primary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">
          ${address || '<span style="color: var(--color-danger);">⚠️ Elegir dirección de entrega...</span>'}
        </div>
        ${state.addressNotes ? `
          <div id="confirm-address-notes" style="font-size: var(--confirm-subtitle-size); color: var(--color-text-tertiary); font-weight: 500; display: flex; align-items: center; gap: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">
            ${icon('info', 10)} ${state.addressNotes}
          </div>
        ` : ''}
      </div>
      
      <!-- Saved Addresses Quick Selector -->
      ${(state.savedAddresses && state.savedAddresses.length > 0) ? `
        <div style="display: flex; gap: 8px; overflow-x: auto; padding: 4px 0; margin-top: 4px; scrollbar-width: none; -ms-overflow-style: none;">
          ${state.savedAddresses.map(addr => {
            const isCurrent = addr.address === address;
            return `
              <button class="quick-addr-chip" data-id="${addr.id}" style="flex-shrink: 0; padding: 6px 12px; border-radius: 10px; font-size: 11px; font-weight: 800; border: 1.5px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border-light)'}; background: ${isCurrent ? 'var(--color-primary-light)' : 'var(--color-bg)'}; color: ${isCurrent ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; cursor: pointer; transition: all 0.2s; white-space: nowrap;">
                ${addr.name}
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}
    </div>

    <!-- OPCIÓN DE REEMPLAZO DE PRODUCTOS (Reemplazar producto) -->
    <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 14px; padding: var(--confirm-card-padding); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-shrink: 0;">
      <div style="display: flex; flex-direction: column; gap: 2px; flex: 1;">
        <span style="font-size: var(--confirm-label-size); font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
          🔄 ¿Reemplazar producto?
        </span>
        <span style="font-size: var(--confirm-subtitle-size); color: var(--color-text-secondary); font-weight: 600; line-height: 1.3;">
          Si algún producto no está disponible, autorizo a reemplazarlo por uno similar.
        </span>
      </div>
      <label class="confirm-switch">
        <input type="checkbox" id="confirm-allow-replacement" checked>
        <span class="confirm-slider"></span>
      </label>
    </div>

    <!-- PROGRAMACIÓN DE ENTREGA -->
    <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 14px; padding: var(--confirm-card-padding); display: flex; flex-direction: column; gap: var(--confirm-card-gap); flex-shrink: 0;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: var(--confirm-label-size); font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
          📅 ¿Cuándo querés recibirlo?
        </span>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 4px;">
        <button type="button" id="sched-now-btn" style="flex: 1; height: 38px; border-radius: 10px; font-size: 11px; font-weight: 800; border: 1.5px solid ${selectedIsScheduled ? 'var(--color-border-light)' : 'var(--color-primary)'}; background: ${selectedIsScheduled ? 'var(--color-bg)' : 'var(--color-primary-light)'}; color: ${selectedIsScheduled ? 'var(--color-text-secondary)' : 'var(--color-primary)'}; cursor: pointer; transition: all 0.2s;">
          Entregar ahora
        </button>
        <button type="button" id="sched-later-btn" style="flex: 1; height: 38px; border-radius: 10px; font-size: 11px; font-weight: 800; border: 1.5px solid ${selectedIsScheduled ? 'var(--color-primary)' : 'var(--color-border-light)'}; background: ${selectedIsScheduled ? 'var(--color-primary-light)' : 'var(--color-bg)'}; color: ${selectedIsScheduled ? 'var(--color-primary)' : 'var(--color-text-secondary)'}; cursor: pointer; transition: all 0.2s;">
          Programar más tarde
        </button>
      </div>
      
      <!-- CONTROLES DE FECHA Y HORA -->
      <div id="sched-selectors-container" style="display: ${selectedIsScheduled ? 'flex' : 'none'}; flex-direction: column; gap: 10px; margin-top: 6px; padding-top: 10px; border-top: 1px dashed var(--color-border-light);">
        <div style="display: flex; gap: 8px;">
          <div style="flex: 1.2; display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 9px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Día</label>
            <select id="sched-date-select" style="height: 38px; border-radius: 8px; border: 1.5px solid var(--color-border-light); padding: 0 8px; font-size: 12px; font-weight: 700; color: var(--color-text-primary); background: var(--color-surface); outline: none;">
            </select>
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 9px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Hora</label>
            <select id="sched-time-select" style="height: 38px; border-radius: 8px; border: 1.5px solid var(--color-border-light); padding: 0 8px; font-size: 12px; font-weight: 700; color: var(--color-text-primary); background: var(--color-surface); outline: none;">
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- RESUMEN DE PAGO -->
    <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 14px; padding: var(--confirm-card-padding); display: flex; flex-direction: column; gap: var(--confirm-card-gap); flex-shrink: 0;">
      <span style="font-size: var(--confirm-label-size); font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
        ${icon('creditCard', 12)} Resumen del pedido
      </span>
      
      <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: var(--color-text-secondary);">
        <span>Comercio(s)</span>
        <span style="font-weight: 700; color: var(--color-text-primary); max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">
          ${commerceNames}
        </span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: var(--color-text-secondary);">
        <span>Método de pago</span>
        <span style="font-weight: 800; color: ${paymentMethod === 'mercadopago' ? '#009EE3' : '#22C55E'}; text-transform: uppercase;">
          ${paymentMethod === 'mercadopago' ? 'Transferencia' : 'Efectivo'}
        </span>
      </div>

      <div style="height: 1px; background: var(--color-border-light); margin: 2px 0;"></div>

      <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: var(--color-text-secondary);">
        <span>Productos</span>
        <span style="font-weight: 600; color: var(--color-text-primary);">${formatPrice(totalProducts)}</span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: var(--color-text-secondary); align-items: center;">
        <span style="display: flex; align-items: center; gap: 3px;">
          Costo de Envío
          ${state.isRaining ? `
            <span style="background: rgba(0, 158, 227, 0.08); color: #009EE3; font-size: 8px; font-weight: 800; padding: 1px 3px; border-radius: 4px; border: 1px solid rgba(0, 158, 227, 0.15);">
              ${icon('cloudRain', 8)} Lluvia
            </span>
          ` : ''}
          ${nightSurcharge > 0 ? `
            <span style="background: rgba(163, 11, 17, 0.08); color: #a30b11; font-size: 8px; font-weight: 800; padding: 1px 3px; border-radius: 4px; border: 1px solid rgba(163, 11, 17, 0.15);">
              ${icon('moon', 8)} Nocturno
            </span>
          ` : ''}
        </span>
        <span style="font-weight: 600; color: var(--color-text-primary); text-align: right;">
          ${totalDelivery > 0 ? `${formatPrice(totalDelivery)}${selectedTip > 0 ? ` (${formatPrice(selectedTip)} prop.)` : ''}` : '¡Gratis!'}
        </span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: var(--color-text-secondary);">
        <span>Tarifa de servicio</span>
        <span style="font-weight: 600; color: var(--color-text-primary);">${formatPrice(appUsageFee)}</span>
      </div>

      ${discount > 0 ? `
        <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: var(--color-success); font-weight: 700;">
          <span>Descuento GoPoints</span>
          <span>- ${formatPrice(discount)}</span>
        </div>
      ` : ''}

      ${appliedCoupon ? `
        <div style="display: flex; justify-content: space-between; font-size: var(--confirm-text-size); color: #a855f7; font-weight: 700; align-items: center; background: rgba(168, 85, 247, 0.06); padding: 6px 8px; border-radius: 8px; border: 1px dashed rgba(168, 85, 247, 0.25); margin: 0;">
          <span style="display: flex; align-items: center; gap: 4px;">
            ${icon('tag', 12)} Cupón (${appliedCoupon.code})
          </span>
          <span style="font-weight: 800;">- ${formatPrice(couponDiscount)}</span>
        </div>
      ` : ''}

      <div style="height: 1px; background: var(--color-border-light); margin: 2px 0;"></div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: var(--confirm-total-label); font-weight: 900; color: var(--color-text-primary);">Total final</span>
        <span style="font-size: var(--confirm-total-val); font-weight: 900; color: var(--color-primary); letter-spacing: -0.02em;">
          ${formatPrice(grandTotal)}
        </span>
      </div>
    </div>

    </div>

    <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--color-border-light); width: 100%; flex-shrink: 0; background: var(--color-bg); z-index: 10;">
      <button id="confirm-cancel-btn" class="btn btn-ghost" style="flex: 1; height: var(--confirm-btn-height); border-radius: 12px; font-weight: 800; font-size: var(--confirm-btn-font); color: var(--color-text-secondary); background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); margin: 0; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
        Cancelar
      </button>
      <button id="confirm-submit-btn" class="btn btn-primary" style="flex: 1.8; height: var(--confirm-btn-height); border-radius: 12px; font-weight: 900; font-size: var(--confirm-btn-font); background: var(--color-primary); border: none; color: white; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 6px 16px rgba(var(--color-primary-rgb), 0.2); margin: 0; transition: all 0.2s; cursor: pointer; opacity: 1;">
        ${icon('check', 16)} CONFIRMAR Y PEDIR
      </button>
    </div>
  `;

  const { close } = showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent,
    onClose: () => {
      isSubmitting = false;
    }
  });

  // Handle Cancel
  const cancelBtn = modalContent.querySelector('#confirm-cancel-btn');
  cancelBtn.onclick = () => {
    close();
    isSubmitting = false;
  };

  // Scheduling Listeners
  const nowBtn = modalContent.querySelector('#sched-now-btn');
  const laterBtn = modalContent.querySelector('#sched-later-btn');
  const schedContainer = modalContent.querySelector('#sched-selectors-container');

  const populateSchedulingOptions = () => {
    const dateSelect = modalContent.querySelector('#sched-date-select');
    const timeSelect = modalContent.querySelector('#sched-time-select');
    if (!dateSelect || !timeSelect) return;

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const formatDateVal = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    dateSelect.innerHTML = `
      <option value="${formatDateVal(today)}">Hoy (${today.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })})</option>
      <option value="${formatDateVal(tomorrow)}">Mañana (${tomorrow.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })})</option>
    `;

    const updateTimes = () => {
      const isToday = dateSelect.value === formatDateVal(today);
      let startHour = 0;
      let startMinute = 0;

      if (isToday) {
        const minTime = new Date(Date.now() + 45 * 60 * 1000);
        startHour = minTime.getHours();
        startMinute = Math.ceil(minTime.getMinutes() / 15) * 15;
        if (startMinute >= 60) {
          startHour += 1;
          startMinute = 0;
        }
      }

      let optionsHTML = '';
      for (let h = startHour; h < 24; h++) {
        const mStart = (h === startHour) ? startMinute : 0;
        for (let m = mStart; m < 60; m += 15) {
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          optionsHTML += `<option value="${hh}:${mm}">${hh}:${mm} hs</option>`;
        }
      }
      if (!optionsHTML) {
        optionsHTML = `<option value="">Sin horarios disponibles</option>`;
      }
      timeSelect.innerHTML = optionsHTML;
    };

    dateSelect.onchange = updateTimes;
    updateTimes();
  };

  if (nowBtn && laterBtn) {
    nowBtn.onclick = () => {
      selectedIsScheduled = false;
      nowBtn.style.borderColor = 'var(--color-primary)';
      nowBtn.style.background = 'var(--color-primary-light)';
      nowBtn.style.color = 'var(--color-primary)';
      laterBtn.style.borderColor = 'var(--color-border-light)';
      laterBtn.style.background = 'var(--color-bg)';
      laterBtn.style.color = 'var(--color-text-secondary)';
      schedContainer.style.display = 'none';
    };

    laterBtn.onclick = () => {
      selectedIsScheduled = true;
      laterBtn.style.borderColor = 'var(--color-primary)';
      laterBtn.style.background = 'var(--color-primary-light)';
      laterBtn.style.color = 'var(--color-primary)';
      nowBtn.style.borderColor = 'var(--color-border-light)';
      nowBtn.style.background = 'var(--color-bg)';
      nowBtn.style.color = 'var(--color-text-secondary)';
      schedContainer.style.display = 'flex';
      populateSchedulingOptions();
    };
  }

  if (selectedIsScheduled) {
    populateSchedulingOptions();
  }

  // Handle Saved Addresses Quick Selector
  const quickAddrChips = modalContent.querySelectorAll('.quick-addr-chip');
  quickAddrChips.forEach(chip => {
    chip.onclick = async () => {
      const addrId = chip.getAttribute('data-id');
      const saved = state.savedAddresses.find(a => a.id === addrId);
      if (saved) {
        close();
        
        // Show loading blocker overlay
        const loadingBlocker = showModal({
          title: '',
          hideHeader: true,
          height: 'auto',
          content: (() => {
            const el = document.createElement('div');
            el.style.cssText = 'padding: 32px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: var(--color-bg); border-radius: 20px;';
            el.innerHTML = `
              <div class="animate-spin" style="width: 48px; height: 48px; border: 4px solid var(--color-primary); border-top-color: transparent; border-radius: 50%; display: inline-block;"></div>
              <span style="font-weight: 800; font-size: 16px; color: var(--color-text-primary);">Recalculando tarifas de envío...</span>
              <span style="font-size: 12px; color: var(--color-text-tertiary);">Por favor, aguardá un instante</span>
            `;
            return el;
          })()
        });

        // Set pointer-events to none on overlay to block closing during recalculation
        const overlayEl = document.getElementById(`${loadingBlocker.id}-overlay`);
        if (overlayEl) {
          overlayEl.style.pointerEvents = 'none';
        }

        try {
          // Set delivery address in state
          setDeliveryAddress(saved.address, saved.notes || '', saved.coords || null);
          
          // Clear cached fees to force recalculation for the new address
          setState({ dynamicDeliveryFees: {}, dynamicDistances: {} });
          
          // Recalculate all shipping fees for the new address
          await calculateAllFees();
        } catch (e) {
          console.error("Error recalculating fees for quick saved address:", e);
        } finally {
          // Close the loading blocker modal
          if (loadingBlocker && typeof loadingBlocker.close === 'function') {
            loadingBlocker.close();
          }
        }
        
        // Re-open this confirmation modal recursively!
        openCheckoutConfirmationModal();
      }
    };
  });

  // Handle Change Address
  const changeAddressBtn = modalContent.querySelector('#confirm-change-address-btn');
  changeAddressBtn.onclick = () => {
    // Close the confirmation modal first
    close();
    
    // Open the address picker
    import('../components/address-modal.js').then(m => {
      m.showAddressPrompt(async () => {
        // Show loading blocker overlay
        const loadingBlocker = showModal({
          title: '',
          hideHeader: true,
          height: 'auto',
          content: (() => {
            const el = document.createElement('div');
            el.style.cssText = 'padding: 32px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: var(--color-bg); border-radius: 20px;';
            el.innerHTML = `
              <div class="animate-spin" style="width: 48px; height: 48px; border: 4px solid var(--color-primary); border-top-color: transparent; border-radius: 50%; display: inline-block;"></div>
              <span style="font-weight: 800; font-size: 16px; color: var(--color-text-primary);">Recalculando tarifas de envío...</span>
              <span style="font-size: 12px; color: var(--color-text-tertiary);">Por favor, aguardá un instante</span>
            `;
            return el;
          })()
        });

        // Set pointer-events to none on overlay to block closing during recalculation
        const overlayEl = document.getElementById(`${loadingBlocker.id}-overlay`);
        if (overlayEl) {
          overlayEl.style.pointerEvents = 'none';
        }

        try {
          // Clear cached fees to force recalculation for the new address
          setState({ dynamicDeliveryFees: {}, dynamicDistances: {} });
          
          // Recalculate all shipping fees for the new address
          await calculateAllFees();
        } catch (e) {
          console.error("Error recalculating fees:", e);
        } finally {
          // Close the loading blocker modal
          if (loadingBlocker && typeof loadingBlocker.close === 'function') {
            loadingBlocker.close();
          }
        }
        
        // Re-open this confirmation modal recursively!
        openCheckoutConfirmationModal();
      }, { skipDetails: true });
    });
  };



  // Handle Submit Order
  const submitBtn = modalContent.querySelector('#confirm-submit-btn');
  submitBtn.onclick = async () => {
    if (!hasDelivery) {
      showToast('No es posible confirmar el pedido sin repartidores online', 'error');
      return;
    }
    if (!getState().deliveryAddress) {
      showToast('Por favor selecciona una dirección de entrega.', 'warning');
      return;
    }
    const finalAddressNotes = getState().addressNotes || '';
    if (!finalAddressNotes.trim()) {
      showToast('La referencia de ubicación es obligatoria.', 'warning');
      close();
      import('../components/address-modal.js').then(m => m.showAddressPrompt(() => {
        openCheckoutConfirmationModal();
      }, { skipDetails: true }));
      return;
    }
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    changeAddressBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = `${icon('loader', 18, 'animate-spin')} PROCESANDO...`;

    try {
      const bundleId = `BNDL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      const { redeemedPoints } = getState();
      const idToken = await auth.currentUser.getIdToken();
      
      // Fetch latest coordinates and address from state to ensure no race condition
      const finalAddress = getState().deliveryAddress;
      const finalCoords = getState().deliveryCoords;

      const allowReplacementEl = modalContent.querySelector('#confirm-allow-replacement');
      const allowReplacement = allowReplacementEl ? allowReplacementEl.checked : true;

      let schedDateVal = null;
      let schedTimeVal = null;
      if (selectedIsScheduled) {
        const dateSelect = modalContent.querySelector('#sched-date-select');
        const timeSelect = modalContent.querySelector('#sched-time-select');
        schedDateVal = dateSelect ? dateSelect.value : '';
        schedTimeVal = timeSelect ? timeSelect.value : '';

        if (!schedDateVal || !schedTimeVal || schedTimeVal === 'Sin horarios disponibles') {
          showToast('Por favor selecciona una fecha y hora válidas para programar.', 'warning');
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          changeAddressBtn.disabled = false;
          submitBtn.innerHTML = originalText;
          return;
        }
      }

      const response = await fetch('https://us-central1-godelivery-magdalena.cloudfunctions.net/createOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          cart: getState().cart,
          address: finalAddress,
          addressNotes: getState().addressNotes || '',
          deliveryCoords: finalCoords || null,
          paymentMethod,
          redeemedPoints,
          totalDelivery,
          tip: selectedTip,
          bundleId,
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          allowReplacement,
          isScheduled: selectedIsScheduled,
          scheduledDate: schedDateVal,
          scheduledTime: schedTimeVal,
          nightSurcharge: nightSurcharge || 0,
          driverIncentive: driverIncentive || 0
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al procesar el pedido en el servidor');
      }

      const resData = await response.json();
      const result = resData.orders; // Returns [{ docId, orderId, commerceId, total }]

      // Save last address to Firestore
      if (auth.currentUser) {
        const { doc, updateDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase.js');
        const userRef = doc(db, 'users', auth.currentUser.uid);
        try {
          await updateDoc(userRef, {
            lastAddress: {
              address: finalAddress,
              notes: finalAddressNotes || '',
              coords: finalCoords || null
            }
          });
        } catch (err) {
          console.error('Error saving lastAddress to user profile:', err);
        }
      }

      if (finalAddressNotes) {
        const { doc, updateDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase.js');
        for (const createdOrder of result) {
          try {
            await updateDoc(doc(db, 'orders', createdOrder.docId), {
              addressNotes: finalAddressNotes
            });
          } catch (updateErr) {
            console.error('Error updating addressNotes on order:', updateErr);
          }
        }
      }

      // Close confirm modal
      close();

      clearCart();
      setState('appliedDiscount', 0);
      setState('redeemedPoints', 0);
      isSubmitting = false;

      try {
        ConfettiCelebrator.launch();
        AudioManager.playSynthChime();
      } catch (e) {
        console.warn('Celebration failed:', e);
      }

      showToast('¡Pedido realizado con éxito!', 'success');
      
      // Delay redirection (2000ms) so the user can enjoy the gorgeous confetti rain and success chime
      setTimeout(() => {
        location.hash = `#/pedido/${result[0].docId}`;
      }, 2000);

    } catch (err) {
      isSubmitting = false;
      console.error('Error processing order:', err);
      
      // Close confirmation modal
      close();
      
      AudioManager.hapticError();
      
      // Show Premium Connection Error Dialog
      const { showModal: showErrorModal } = await import('../components/modal.js');
      const { close: closeError } = showErrorModal({
        title: '',
        hideHeader: true,
        height: 'auto',
        content: `
          <div style="padding: 24px 20px; text-align: center; font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px; color: var(--color-text-primary);">
            <div style="font-size: 40px; margin-bottom: 8px;">📶</div>
            <h4 style="font-family: var(--font-display); font-size: 18px; font-weight: 900; margin: 0; line-height: 1.3;">⚠️ Error de Conexión</h4>
            <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; opacity: 0.9;">
              No pudimos enviar tu pedido al servidor debido a un problema de conexión. Por favor, verifica tu internet e intentalo nuevamente.
            </p>
            <button id="error-retry-btn" class="btn btn-primary" style="height: 56px; border-radius: 16px; font-weight: 900; font-size: 16px; background: var(--color-primary); border: none; color: white; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.25); cursor: pointer;">
              INTENTAR DE NUEVO
            </button>
            <button id="error-cancel-btn" class="btn btn-ghost" style="height: 48px; border-radius: 16px; font-weight: 800; font-size: 14px; color: var(--color-text-secondary); background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); cursor: pointer;">
              Cerrar
            </button>
          </div>
        `
      });

      const errorRetryBtn = document.getElementById('error-retry-btn');
      if (errorRetryBtn) {
        errorRetryBtn.onclick = () => {
          closeError();
          AudioManager.hapticLight();
          openCheckoutConfirmationModal();
        };
      }

      const errorCancelBtn = document.getElementById('error-cancel-btn');
      if (errorCancelBtn) {
        errorCancelBtn.onclick = () => {
          closeError();
          AudioManager.hapticLight();
        };
      }
    }
  };
}

async function handleCartClick(e) {
  // Quantity buttons
  const qtyBtn = e.target.closest('.cart-qty-btn');
  if (qtyBtn) {
    e.stopPropagation();
    e.preventDefault();
    const id = qtyBtn.dataset.id;
    const cid = qtyBtn.dataset.cid;
    const action = qtyBtn.dataset.action;
    const item = getState().cart.find(i => i.cartItemId === id && i.comercioId === cid);
    if (item) {
      const newQty = action === 'plus' ? item.qty + 1 : item.qty - 1;
      updateCartQty(id, cid, newQty);
    }
    return;
  }

  // Remove button
  const removeBtn = e.target.closest('.cart-item-remove');
  if (removeBtn) {
    e.stopPropagation();
    e.preventDefault();
    const id = removeBtn.dataset.id;
    const cid = removeBtn.dataset.cid;
    removeFromCart(id, cid);
    showToast('Producto eliminado', 'info');
    return;
  }

  // Back step button
  if (e.target.closest('#cart-back-step-btn')) {
    e.stopPropagation();
    e.preventDefault();
    currentCartStep = 1;
    renderCartContent(document.getElementById('page-cart') || document.getElementById('app-content'));
    return;
  }

  // Checkout button
  const checkoutBtn = e.target.closest('.checkout-btn');
  if (checkoutBtn) {
    e.stopPropagation();
    e.preventDefault();
    
    // Ignore click events on disabled buttons to prevent double processing or weird bubbling on custom pointer configurations
    if (checkoutBtn.disabled || checkoutBtn.getAttribute('disabled') !== null) {
      return;
    }

    if (isSubmitting) return;

    const address = getState().deliveryAddress;
    const user = getState().user;

    if (!user) {
      showToast('Debes iniciar sesión para hacer un pedido', 'warning');
      return;
    }

    if (!address) {
      import('../components/address-modal.js').then(m => m.showAddressPrompt(() => {
        checkoutBtn.click();
      }, { skipDetails: true }));
      return;
    }

    const notes = getState().addressNotes;
    if (!notes || notes.trim() === '') {
      showToast('La referencia de ubicación es obligatoria.', 'warning');
      import('../components/address-modal.js').then(m => m.showAddressPrompt(() => {
        checkoutBtn.click();
      }, { skipDetails: true }));
      return;
    }

    if (!user.phone || user.phone.trim() === '' || !user.phoneVerified) {
      const { showConfirm } = await import('../components/modal.js');
      const isUnverified = user.phone && user.phone.trim() !== '' && !user.phoneVerified;
      showConfirm({
        title: isUnverified ? '📱 Verificar Teléfono' : '📱 Teléfono Requerido',
        message: isUnverified ? 
          'Para realizar tu pedido debes verificar tu número telefónico primero.' : 
          'Para realizar un pedido en la plataforma es obligatorio configurar y verificar un celular de contacto para que el comercio y el repartidor se comuniquen.',
        confirmText: isUnverified ? 'Verificar ahora' : 'Configurar ahora',
        cancelText: 'Volver',
        onConfirm: () => {
          sessionStorage.setItem('open-phone-edit', 'true');
          location.hash = '#/profile';
        }
      });
      return;
    }

    if (currentCartStep === 1) {
      currentCartStep = 2;
      renderCartContent(document.getElementById('page-cart') || document.getElementById('app-content'));
      return;
    }

    const paymentMethod = selectedPaymentMethod;
    
    // Check for online delivery drivers ON CLICK (Very robust)
    isSubmitting = true;
    checkoutBtn.disabled = true;
    const originalHTML = checkoutBtn.innerHTML;
    checkoutBtn.innerHTML = `${icon('loader', 18, 'animate-spin')} VERIFICANDO...`;

    try {
      selectedIsScheduled = false;
      selectedSchedDate = '';
      selectedSchedTime = '';
      await openCheckoutConfirmationModal();
    } catch (err) {
      console.error('Error opening confirmation modal:', err);
    } finally {
      checkoutBtn.disabled = false;
      checkoutBtn.innerHTML = originalHTML;
    }
  }

  // Clear cart
  if (e.target.closest('#clear-cart-btn')) {
    e.stopPropagation();
    e.preventDefault();
    showConfirm({
      title: 'Vaciar carrito',
      message: '¿Estás seguro de que querés vaciar todo el carrito?',
      confirmText: 'Vaciar',
      danger: true,
      onConfirm: () => {
        clearCart();
        showToast('Carrito vaciado', 'info');
      }
    });
  }
}
