import { doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.js';
import { AudioManager } from './utils/audio-manager.js';

const listeners = new Map();

const safeJsonParse = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};

const state = {
  user: null,       // Firebase user + Firestore profile
  cart: [],         // { product, comercioId, comercioName, qty, options }
  theme: 'light',   // Locked to light mode
  useDarkBrandTheme: false,
  deliveryAddress: localStorage.getItem('gd-address') || null,
  houseNumber: localStorage.getItem('gd-house-number') || '',
  addressNotes: localStorage.getItem('gd-address-notes') || '',
  deliveryCoords: safeJsonParse('gd-coords', null),
  deliveryCost: 0,  // Legacy global delivery cost
  deliveryBasePrice: 1500,
  deliveryPricePerKm: 300,
  deliveryMinPrice: 1500,
  deliveryExtraStopFee: 500,
  deliveryRainSurcharge: 300, // Default $300 rain surcharge
  deliveryFixedThresholdKm: 0,
  deliveryFixedThresholdPrice: 0,
  deliveryDistanceRules: [],
  tripBasePrice: 1500,
  tripPricePerKm: 300,
  tripMinPrice: 1500,
  isRaining: false,
  rainMode: 'auto',
  weatherData: { isRaining: false },
  dynamicDeliveryFees: safeJsonParse('gd-cached-fees', {}),
  dynamicDistances: safeJsonParse('gd-cached-distances', {}),
  savedAddresses: safeJsonParse('gd-saved-addresses', []),

  canonAmount: 2000,
  bankAlias: 'godelivery.oficial',
  paulosConfig: { enabled: true, promoDeliveryFee: 1200, merchantCoveragePercent: 30 },

  commissionRate: 0.10, // Global commission percentage (default 10%)
  appUsageFeeRate: 0.05, // Global app usage fee for client (default 5%)
  whatsappPayments: '5491123456789', // WhatsApp number for payment proofs

  // GoPoints System
  pointsPerDollar: 0.01, // Earning rate (e.g. 1% of subtotal)
  dollarPerPoint: 1.00,  // Exchange rate (e.g. 1 point = $1)
  referralPoints: 500,   // Points rewarded per referral code
  weeklyChallenges: [
    { id: 'weekly_3', title: 'Desafío Bronce', description: 'Completá 3 pedidos esta semana', target: 3, pointsReward: 5000 },
    { id: 'weekly_5', title: 'Desafío Plata', description: 'Completá 5 pedidos esta semana', target: 5, pointsReward: 7500 },
    { id: 'weekly_10', title: 'Desafío Oro', description: 'Completá 10 pedidos esta semana', target: 10, pointsReward: 10000 }
  ],
  userPoints: 0,
  appliedDiscount: 0,
  redeemedPoints: 0,
  selectedTip: 0,
  appliedCoupon: null, // { code, type, value }

  notifications: [], // List of user notifications
  unreadNotifications: 0, // Count of unread notifications
  loading: true,
  maintenanceMode: false,
  maintenanceMessage: '',
  maintenanceAllowedEmails: [],

  // GoLevels System (Configurable)
  levels: {
    bronce: { id: 'bronce', name: 'Bronce', minOrders: 0, multiplier: 1.0, color: '#CD7F32', icon: 'award', benefits: 'Ganancia base de GoPoints.' },
    plata: { id: 'plata', name: 'Plata', minOrders: 6, multiplier: 1.25, color: '#C0C0C0', icon: 'medal', benefits: 'Ganás un 25% extra de GoPoints en cada compra.' },
    oro: { id: 'oro', name: 'Oro', minOrders: 16, multiplier: 1.5, color: '#FFD700', icon: 'crown', benefits: 'Ganás un 50% extra de GoPoints y acceso a promos exclusivas.' }
  },
  currentComercio: null, // Cached commerce data for panel header
  commercePendingCount: 0, // Track pending orders across commerces for navbar badge

  // Dynamic schedule pricing
  nightSurchargeConfig: { enabled: false, start: '00:00', end: '06:00', type: 'fixed', value: 0 },
  driverIncentiveConfig: { enabled: false, start: '20:00', end: '23:59', type: 'fixed', value: 0 },
  serverTimeOffset: 0,
  canonAmount: 2000,
  bankAlias: 'godelivery.oficial',
  bankOwner: 'GoDelivery S.R.L.',
  maxDebtLimit: 15000,
  debtLimitEnabled: false
};

export function getUserLevel(orderCount = 0) {
  const levels = state.levels;
  // Sort levels by minOrders descending to find the highest qualified
  const sorted = Object.values(levels).sort((a, b) => b.minOrders - a.minOrders);
  for (const lvl of sorted) {
    if (orderCount >= lvl.minOrders) return lvl;
  }
  return levels.bronce;
}

export async function initSettings() {
  try {
    // Sync time offset with server clock via Cloud Function
    try {
      const start = Date.now();
      const res = await fetch('https://us-central1-godelivery-magdalena.cloudfunctions.net/getServerTime');
      if (res.ok) {
        const data = await res.json();
        if (data && data.serverTime) {
          const latency = Math.floor((Date.now() - start) / 2);
          const adjustedServerTime = data.serverTime + latency;
          const offset = adjustedServerTime - Date.now();
          state.serverTimeOffset = offset;
          console.log(`[Time Sync] Server offset calculated: ${offset}ms (latency: ${latency}ms)`);
        }
      }
    } catch (timeErr) {
      console.warn('[Time Sync] Failed to sync server clock:', timeErr);
    }

    // Listen to settings/global in real-time
    onSnapshot(doc(db, 'settings', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        state.deliveryCost = data.deliveryCost || 0;
        state.deliveryBasePrice = data.deliveryBasePrice !== undefined ? data.deliveryBasePrice : 1500;
        state.deliveryPricePerKm = data.deliveryPricePerKm !== undefined ? data.deliveryPricePerKm : 300;
        state.deliveryMinPrice = data.deliveryMinPrice !== undefined ? data.deliveryMinPrice : 1500;
        state.deliveryExtraStopFee = data.deliveryExtraStopFee !== undefined ? data.deliveryExtraStopFee : 500;
        state.deliveryRainSurcharge = data.deliveryRainSurcharge !== undefined ? data.deliveryRainSurcharge : 300;
        state.deliveryFixedThresholdKm = data.deliveryFixedThresholdKm !== undefined ? data.deliveryFixedThresholdKm : 0;
        state.deliveryFixedThresholdPrice = data.deliveryFixedThresholdPrice !== undefined ? data.deliveryFixedThresholdPrice : 0;
        state.deliveryDistanceRules = data.deliveryDistanceRules || [];
        state.tripBasePrice = data.tripBasePrice !== undefined ? data.tripBasePrice : 1500;
        state.tripPricePerKm = data.tripPricePerKm !== undefined ? data.tripPricePerKm : 300;
        state.tripMinPrice = data.tripMinPrice !== undefined ? data.tripMinPrice : 1500;
        state.commissionRate = data.commissionRate !== undefined ? data.commissionRate : 0.10;
        state.appUsageFeeRate = data.appUsageFeeRate !== undefined ? data.appUsageFeeRate : 0.05;
        state.whatsappPayments = data.whatsappPayments || '5491123456789';
        state.pointsPerDollar = data.pointsPerDollar !== undefined ? data.pointsPerDollar : 0.01;
        state.dollarPerPoint = data.dollarPerPoint !== undefined ? data.dollarPerPoint : 1.00;
        state.referralPoints = data.referralPoints !== undefined ? data.referralPoints : 500;
        state.weeklyChallenges = data.weeklyChallenges || state.weeklyChallenges;
        state.nightSurchargeConfig = data.nightSurchargeConfig || { enabled: false, start: '00:00', end: '06:00', type: 'fixed', value: 0 };
        state.driverIncentiveConfig = data.driverIncentiveConfig || { enabled: false, start: '20:00', end: '23:59', type: 'fixed', value: 0 };
        state.rainMode = data.rainMode || 'auto';
        updateRainStatus();
        state.useDarkBrandTheme = data.useDarkBrandTheme || false;
        state.favorPurchaseFee = data.favorPurchaseFee !== undefined ? data.favorPurchaseFee : 800;
        state.servicePaymentErrandFee = data.servicePaymentErrandFee !== undefined ? data.servicePaymentErrandFee : 2000;
        state.maintenanceMode = data.maintenanceMode !== undefined ? data.maintenanceMode : false;
        state.maintenanceMessage = data.maintenanceMessage || 'La aplicación se encuentra en mantenimiento temporal para realizar mejoras. Volvemos en unos minutos.';
        state.maintenanceAllowedEmails = data.maintenanceAllowedEmails || [];
        state.servicesAppFeeConfig = data.servicesAppFeeConfig || {
          gofavor: { type: 'percentage', value: 1.2 },
          gocash: { type: 'percentage', value: 1.2 },
          goviaje: { type: 'percentage', value: 1.2 }
        };
        state.canonAmount = data.canonAmount !== undefined ? data.canonAmount : 2000;
        state.bankAlias = data.bankAlias || 'godelivery.oficial';
        state.bankOwner = data.bankOwner || 'GoDelivery S.R.L.';
        state.maxDebtLimit = data.maxDebtLimit !== undefined ? data.maxDebtLimit : 15000;
        state.debtLimitEnabled = data.debtLimitEnabled !== undefined ? data.debtLimitEnabled : false;

        // Dynamically apply brand theme
        const primaryColor = state.useDarkBrandTheme ? '#0F172A' : '#E11D48';
        if (state.useDarkBrandTheme) {
          document.documentElement.style.setProperty('--color-primary', '#0F172A');
          document.documentElement.style.setProperty('--color-primary-hover', '#1E293B');
          document.documentElement.style.setProperty('--color-primary-dark', '#020617');
          document.documentElement.style.setProperty('--color-primary-light', 'rgba(15, 23, 42, 0.1)');
          document.documentElement.style.setProperty('--color-primary-lighter', 'rgba(15, 23, 42, 0.05)');
          document.documentElement.style.setProperty('--color-primary-rgb', '15, 23, 42');
        } else {
          document.documentElement.style.setProperty('--color-primary', '#E11D48');
          document.documentElement.style.setProperty('--color-primary-hover', '#BE123C');
          document.documentElement.style.setProperty('--color-primary-dark', '#9F1239');
          document.documentElement.style.setProperty('--color-primary-light', 'rgba(225, 29, 72, 0.1)');
          document.documentElement.style.setProperty('--color-primary-lighter', 'rgba(225, 29, 72, 0.05)');
          document.documentElement.style.setProperty('--color-primary-rgb', '225, 29, 72');
        }

        // Update HTML meta theme-color for mobile web browsers
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
          metaTheme.setAttribute('content', primaryColor);
        }

        // Update native mobile status bar color if running under Capacitor
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
          try {
            const StatusBar = window.Capacitor.Plugins.StatusBar;
            StatusBar.setBackgroundColor({ color: primaryColor }).catch(() => {});
            StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
          } catch (e) {
            console.warn('Failed to set native status bar:', e);
          }
        }

        updateRainStatus();

        const keys = [
          'deliveryCost', 'deliveryBasePrice', 'deliveryPricePerKm', 'deliveryMinPrice',
          'deliveryExtraStopFee', 'deliveryRainSurcharge', 'deliveryFixedThresholdKm', 'deliveryFixedThresholdPrice', 'deliveryDistanceRules',
          'tripBasePrice', 'tripPricePerKm',
          'tripMinPrice', 'commissionRate', 'appUsageFeeRate', 'pointsPerDollar',
          'dollarPerPoint', 'referralPoints', 'weeklyChallenges', 'whatsappPayments',
          'useDarkBrandTheme', 'canonAmount', 'bankAlias', 'maintenanceMode', 'maintenanceMessage', 'maintenanceAllowedEmails'
        ];
        keys.forEach(k => notify(k));
      }
    });

    // Listen to settings/paulos_config in real-time
    onSnapshot(doc(db, 'settings', 'paulos_config'), (snap) => {
      state.paulosConfig = snap.exists() ? snap.data() : { enabled: true, promoDeliveryFee: 1200, merchantCoveragePercent: 30 };
      notify('paulosConfig');
    });

    // Listen to settings/weather in real-time
    onSnapshot(doc(db, 'settings', 'weather'), (snap) => {
      state.weatherData = snap.exists() ? snap.data() : { isRaining: false };
      updateRainStatus();
    });

    // Load dynamic levels
    const levelsSnap = await getDoc(doc(db, 'settings', 'levels'));
    if (levelsSnap.exists()) {
      state.levels = levelsSnap.data();
      notify('levels');
    }
  } catch (e) {
    console.error('Error loading global settings:', e);
  }
}

function updateRainStatus() {
  const rainMode = state.rainMode || 'auto';
  let isRaining = false;
  if (rainMode === 'on') {
    isRaining = true;
  } else if (rainMode === 'off') {
    isRaining = false;
  } else {
    isRaining = state.weatherData ? state.weatherData.isRaining : false;
  }

  if (state.isRaining !== isRaining) {
    state.isRaining = isRaining;
    notify('isRaining');
  }
}

export function getState() {

  return state;
}

export function setState(keyOrObj, value) {
  if (typeof keyOrObj === 'object' && keyOrObj !== null) {
    Object.keys(keyOrObj).forEach(key => {
      state[key] = keyOrObj[key];
      notify(key);
    });
  } else {
    state[keyOrObj] = value;
    notify(keyOrObj);
  }
}

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}

function notify(key) {
  if (listeners.has(key)) {
    listeners.get(key).forEach(fn => fn(state[key]));
  }
}

function triggerStockToast(msg, type = 'warning') {
  import('./components/toast.js')
    .then(({ showToast }) => showToast(msg, type))
    .catch(err => console.error('Error importing showToast:', err));
}

// ── Cart helpers ──
export function addToCart(product, comercioId, comercioName, qty = 1, options = [], notes = '') {
  // Ensure options is an array
  const safeOptions = Array.isArray(options) ? options : [];
  const cleanNotes = typeof notes === 'string' ? notes.trim() : '';

  // Sort options to ensure comparison works regardless of selection order
  const sortedOptions = [...safeOptions].sort((a, b) => {
    const aStr = (a.groupName || '') + (a.name || '');
    const bStr = (b.groupName || '') + (b.name || '');
    return aStr.localeCompare(bStr);
  });

  const cartItemId = `${product.id}-${JSON.stringify(sortedOptions)}-${cleanNotes}`;

  // Enforce limited stock checks
  if (product.stockMode === 'limited' && !product.useGlobalFlavors) {
    const stockQty = typeof product.stockQuantity === 'number' ? product.stockQuantity : 0;
    const currentCartQty = state.cart
      .filter(item => item.product.id === product.id)
      .reduce((sum, item) => sum + item.qty, 0);

    if (currentCartQty + qty > stockQty) {
      const maxAddable = stockQty - currentCartQty;
      if (maxAddable <= 0) {
        triggerStockToast(`No hay más stock disponible para "${product.name}" (${stockQty} max)`);
        return;
      }
      qty = maxAddable;
      triggerStockToast(`Cantidad limitada al stock disponible (${stockQty} unidades)`);
    }
  }

  const existing = state.cart.find(item =>
    item.product.id === product.id &&
    item.comercioId === comercioId &&
    item.cartItemId === cartItemId
  );

  if (existing) {
    existing.qty += qty;
    if (cleanNotes) existing.notes = cleanNotes;
  } else {
    state.cart.push({
      cartItemId,
      product,
      comercioId,
      comercioName,
      qty,
      options: sortedOptions,
      notes: cleanNotes
    });
  }
  try {
    AudioManager.playSynthPop();
  } catch (e) {
    console.warn('Could not play pop:', e);
  }
  saveCart();
  notify('cart');
}

export function updateCartQty(cartItemId, comercioId, qty) {
  const item = state.cart.find(
    i => i.cartItemId === cartItemId && i.comercioId === comercioId
  );
  if (item) {
    if (qty <= 0) {
      state.cart = state.cart.filter(i => !(i.cartItemId === cartItemId && i.comercioId === comercioId));
    } else {
      // Enforce limited stock checks
      const product = item.product;
      if (product && product.stockMode === 'limited' && !product.useGlobalFlavors) {
        const stockQty = typeof product.stockQuantity === 'number' ? product.stockQuantity : 0;
        const otherCartQty = state.cart
          .filter(i => i.product.id === product.id && i.cartItemId !== cartItemId)
          .reduce((sum, i) => sum + i.qty, 0);

        if (otherCartQty + qty > stockQty) {
          const maxAllowedQty = stockQty - otherCartQty;
          if (maxAllowedQty <= 0) {
            state.cart = state.cart.filter(i => !(i.cartItemId === cartItemId && i.comercioId === comercioId));
            triggerStockToast(`Sin stock disponible para "${product.name}"`);
            saveCart();
            notify('cart');
            return;
          }
          qty = maxAllowedQty;
          triggerStockToast(`Cantidad limitada al stock disponible (${stockQty} unidades)`);
        }
      }
      const isIncrease = qty > item.qty;
      item.qty = qty;
      if (isIncrease) {
        try {
          AudioManager.playSynthPop();
        } catch (e) {}
      }
    }
    saveCart();
    notify('cart');
  }
}

export function removeFromCart(cartItemId, comercioId) {
  state.cart = state.cart.filter(
    i => !(i.cartItemId === cartItemId && i.comercioId === comercioId)
  );
  saveCart();
  notify('cart');
}

export function clearCart() {
  state.cart = [];
  state.selectedTip = 0;
  state.appliedCoupon = null;
  saveCart();
  notify('cart');
  notify('selectedTip');
  notify('appliedCoupon');
}

export function getCartTotal() {
  const activeOffers = state.activeOffers || [];
  return state.cart.reduce((sum, item) => {
    const basePrice = (item.product.price || 0) + (item.options || []).reduce((s, opt) => s + (opt.price * (opt.qty || 1) || 0), 0);
    
    // Find active offer
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

export function getCartCount() {
  return state.cart.reduce((sum, item) => sum + item.qty, 0);
}

export function getCartByComercio() {
  const grouped = {};
  state.cart.forEach(item => {
    if (!grouped[item.comercioId]) {
      grouped[item.comercioId] = {
        comercioName: item.comercioName,
        deliveryCost: state.deliveryCost, // Use global cost
        items: []
      };
    }
    grouped[item.comercioId].items.push(item);
  });
  return grouped;
}



function saveCart() {
  try {
    localStorage.setItem('gd-cart', JSON.stringify(state.cart));
  } catch (e) { /* ignore */ }
}

export function loadCart() {
  try {
    const saved = localStorage.getItem('gd-cart');
    if (saved) {
      state.cart = JSON.parse(saved);
      notify('cart');
    }
  } catch (e) { /* ignore */ }
}

// ── Theme (Removed) ──
export function initTheme() {
  document.documentElement.setAttribute('data-theme', 'light');
}

export function setDeliveryAddress(address, notes = '', coords = null, houseNumber = '') {
  state.deliveryAddress = address;
  state.addressNotes = notes;
  state.deliveryCoords = coords;
  state.houseNumber = houseNumber;

  if (address) {
    localStorage.setItem('gd-address', address);
    localStorage.setItem('gd-address-notes', notes);
    localStorage.setItem('gd-house-number', houseNumber);
    if (coords) localStorage.setItem('gd-coords', JSON.stringify(coords));
  } else {
    localStorage.removeItem('gd-address');
    localStorage.removeItem('gd-address-notes');
    localStorage.removeItem('gd-house-number');
    localStorage.removeItem('gd-coords');
  }
  notify('deliveryAddress');
  notify('addressNotes');
  notify('deliveryCoords');
  notify('houseNumber');

  // Sync to Firestore if logged in
  if (address && state.user && state.user.uid) {
    const userRef = doc(db, 'users', state.user.uid);
    updateDoc(userRef, {
      lastAddress: {
        address,
        notes,
        coords,
        houseNumber
      }
    }).catch(err => console.error('Error saving lastAddress to user profile:', err));
  }
}

export async function saveUserAddress(name, address, notes, coords) {
  const newAddr = {
    id: Date.now().toString(),
    name,
    address,
    notes,
    coords
  };
  state.savedAddresses.push(newAddr);
  localStorage.setItem('gd-saved-addresses', JSON.stringify(state.savedAddresses));
  notify('savedAddresses');

  // Sync to Firestore
  if (state.user && state.user.uid) {
    const userRef = doc(db, 'users', state.user.uid);
    try {
      await updateDoc(userRef, { savedAddresses: state.savedAddresses });
    } catch (e) {
      console.error('Error syncing savedAddresses:', e);
    }
  }
}

export async function updateUserAddress(id, name, address, notes, coords) {
  state.savedAddresses = state.savedAddresses.map(a => {
    if (a.id === id) {
      return { id, name, address, notes, coords };
    }
    return a;
  });
  localStorage.setItem('gd-saved-addresses', JSON.stringify(state.savedAddresses));
  notify('savedAddresses');

  // Sync to Firestore
  if (state.user && state.user.uid) {
    const userRef = doc(db, 'users', state.user.uid);
    try {
      await updateDoc(userRef, { savedAddresses: state.savedAddresses });
    } catch (e) {
      console.error('Error syncing updated savedAddresses:', e);
    }
  }
}

export async function removeSavedAddress(id) {
  state.savedAddresses = state.savedAddresses.filter(a => a.id !== id);
  localStorage.setItem('gd-saved-addresses', JSON.stringify(state.savedAddresses));
  notify('savedAddresses');

  // Sync to Firestore
  if (state.user && state.user.uid) {
    const userRef = doc(db, 'users', state.user.uid);
    try {
      await updateDoc(userRef, { savedAddresses: state.savedAddresses });
    } catch (e) {
      console.error('Error syncing removed savedAddresses:', e);
    }
  }
}

// ── Favorites Helpers ──
export function isProductFavorite(productId) {
  try {
    const favs = JSON.parse(localStorage.getItem('gd-favorites') || '[]');
    return favs.includes(productId);
  } catch (e) {
    return false;
  }
}

export async function toggleProductFavorite(productId) {
  try {
    let favs = JSON.parse(localStorage.getItem('gd-favorites') || '[]');
    const isFav = favs.includes(productId);

    if (isFav) {
      favs = favs.filter(id => id !== productId);
    } else {
      favs.push(productId);
    }
    try {
      localStorage.setItem('gd-favorites', JSON.stringify(favs));
    } catch (e) {
      console.warn('[Storage] QuotaExceeded writing favorites in state.js', e);
    }

    const currentUser = state.user;
    if (currentUser && currentUser.uid) {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        favorites: isFav ? arrayRemove(productId) : arrayUnion(productId)
      });
      currentUser.favorites = favs;
      notify('user');
    }
    return !isFav;
  } catch (e) {
    console.error('Failed to toggle favorite:', e);
    return false;
  }
}

export function clearUserState() {
  // 1. Clear Memory State
  state.user = null;
  state.cart = [];
  state.deliveryAddress = null;
  state.houseNumber = '';
  state.addressNotes = '';
  state.deliveryCoords = null;
  state.dynamicDeliveryFees = {};
  state.dynamicDistances = {};
  state.savedAddresses = [];
  state.appliedDiscount = 0;
  state.redeemedPoints = 0;
  state.selectedTip = 0;
  state.appliedCoupon = null;
  state.notifications = [];
  state.unreadNotifications = 0;

  // 2. Clear Persistent Local Storage
  const keysToClear = [
    'gd-cart',
    'gd-address',
    'gd-address-notes',
    'gd-house-number',
    'gd-coords',
    'gd-saved-addresses',
    'gd-cached-fees',
    'gd-cached-distances',
    'gd-favorites'
  ];
  keysToClear.forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  });

  // 3. Notify Listeners
  notify('user');
  notify('cart');
  notify('deliveryAddress');
  notify('houseNumber');
  notify('addressNotes');
  notify('deliveryCoords');
  notify('dynamicDeliveryFees');
  notify('dynamicDistances');
  notify('savedAddresses');
  notify('appliedDiscount');
  notify('redeemedPoints');
  notify('selectedTip');
  notify('appliedCoupon');
  notify('notifications');
}

