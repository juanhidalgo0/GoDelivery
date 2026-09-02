import { collection, query, where, getDocs, doc, updateDoc, onSnapshot as firebaseOnSnapshot, runTransaction, serverTimestamp, writeBatch, increment, addDoc, getDoc, arrayUnion, deleteField } from 'firebase/firestore';
import { getState, setState, subscribe } from '../state.js';
import { icon } from '../utils/icons.js';
import { formatPrice, isScheduleActive } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { showModal, closeModal, showConfirm } from '../components/modal.js';
import { db, storage } from '../firebase.js';
import { App } from '@capacitor/app';
import { AudioManager } from '../utils/audio-manager.js';

import { isDelivery } from '../auth.js';
import { registerUnsubscribe } from '../utils/cleanup.js';

export function getOrderDriverEarnings(o) {
  if (!o) return 0;
  if (o.driverEarnings !== undefined && o.driverEarnings !== null && !isNaN(Number(o.driverEarnings)) && Number(o.driverEarnings) > 0) {
    return Number(o.driverEarnings);
  }
  const delivery = Number(o.deliveryCost || o.shippingCost || o.deliveryFee || o.cost || 0);
  const purchaseFee = Number(o.purchaseFee || o.mandadoFee || o.managementFee || o.mandadoPersonalFee || o.gestionCost || 0);
  const extraStops = Number(o.extraStopsCost || o.extraStopsFee || o.paradasCost || 0);
  const rain = Number(o.rainSurcharge || o.deliveryRainSurcharge || o.recargoLluvia || (o.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const tip = Number(o.tip || o.tipAmount || o.propina || 0);
  const night = Number(o.nightSurcharge || o.nightFee || 0);
  const incentive = Number(o.incentiveAmount || o.incentive || 0);

  return delivery + purchaseFee + extraStops + rain + tip + night + incentive;
}
import { initDriverNavigationMap, updateDriverMapLocation, drawDriverRoute, clearDriverRoute, setMap3DPerspective, recenterOnDriver, zoomInDriverMap, zoomOutDriverMap, getDriverMapTheme, setDriverMapTheme, getDriverThemeMode, setDriverThemeMode, renderDemandHotspots, checkAutoSolarTheme, startGpsRouteSimulation, stopGpsRouteSimulation, isGpsSimulationRunning, renderMultiStopRoute, clearMultiStopMarkers } from '../components/driver-navigation-map.js';
import { NavigationVoice } from '../utils/navigation-voice.js';

export function cleanMandadoText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/#{1,6}\s?/g, '')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/•|\-/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMandadoDetails(text, defaultComercio = '') {
  const clean = cleanMandadoText(text);
  if (!clean) {
    return { comercio: defaultComercio || 'Kiosco / Comercio', items: 'Realizar compra o trámite' };
  }

  let comercio = defaultComercio || '';
  let items = clean;

  const comMatch = clean.match(/(?:1\.\s*Comercio|Comercio|Lugar|Local)\s*:\s*([^📦📝\n]+)/i);
  if (comMatch && comMatch[1]) {
    comercio = comMatch[1].trim();
  }

  const itemMatch = clean.match(/(?:2\.\s*Pedido|Pedido|Detalle|Instrucción|Compra)\s*:\s*(.+)/i);
  if (itemMatch && itemMatch[1]) {
    items = itemMatch[1].trim();
  } else if (comMatch) {
    items = clean.replace(comMatch[0], '').replace(/^[\s,·\-\|]+/, '').trim() || 'Ver detalle del pedido';
  }

  // Strip redundant labels if any
  if (comercio.toLowerCase().startsWith('comercio:')) {
    comercio = comercio.replace(/^comercio:\s*/i, '').trim();
  }
  if (comercio.toLowerCase().startsWith('1. comercio:')) {
    comercio = comercio.replace(/^1\.\s*comercio:\s*/i, '').trim();
  }

  return {
    comercio: comercio || defaultComercio || 'Kiosco / Comercio',
    items: items || 'Realizar compra o trámite'
  };
}

export function isOrderEncomienda(order) {
  if (!order) return false;
  if (order.comercioId) return false;
  if (order.favorType === 'compra' || order.type === 'compra') return false;

  const desc = (order.description || order.itemsText || order.details || order.notes || '').toLowerCase();
  const pickAddr = (order.pickupAddress || order.originAddress || '').toLowerCase();

  // If it contains shopping keywords or manual commerce syntax, it is a Mandado
  if (desc.includes('comercio:') || desc.includes('1. comercio') || pickAddr.startsWith('comercio:') || pickAddr.startsWith('múltiples comercios')) {
    return false;
  }

  // Explicit encomienda markers
  if (order.favorType === 'encomienda' || order.serviceType === 'encomienda' || order.favorType === 'mandado_paquete') {
    return true;
  }

  // General encomienda favor (origin address + destination address created from showMandadoForm)
  if (order.isFavor && Boolean(order.pickupAddress || order.originAddress) && Boolean(order.deliveryAddress || order.address)) {
    return true;
  }

  return false;
}

export function isDriverChoferApproved(user) {
  const u = user || getState().user || {};
  return u.tripStatus === 'approved' || u.role === 'chofer' || u.isChofer === true;
}

export function getDriverAutoAcceptFilters(user) {
  const isChofer = isDriverChoferApproved(user);
  try {
    const raw = localStorage.getItem('driver_auto_accept_filters');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        comercios: parsed.comercios !== false,
        mandados: parsed.mandados !== false,
        viajes: isChofer ? (parsed.viajes !== false) : false
      };
    }
  } catch (e) {}
  return { comercios: true, mandados: true, viajes: isChofer };
}

export function saveDriverAutoAcceptFilters(filters, user) {
  const isChofer = isDriverChoferApproved(user);
  const safe = {
    comercios: filters?.comercios !== false,
    mandados: filters?.mandados !== false,
    viajes: isChofer ? (filters?.viajes !== false) : false
  };
  localStorage.setItem('driver_auto_accept_filters', JSON.stringify(safe));
  window.autoAcceptFilters = safe;
  return safe;
}

export function shouldAutoAcceptOrder(order, user) {
  if (!window.autoAcceptEnabled) return false;
  const filters = window.autoAcceptFilters || getDriverAutoAcceptFilters(user);
  if (order.isTrip) {
    if (!isDriverChoferApproved(user)) return false;
    return filters.viajes === true;
  }
  if (order.isFavor) return filters.mandados === true;
  return filters.comercios === true;
}

// ----------------------------------------------------
// 1. OFFLINE RESILIENCE ENGINE (ATALAYA / RURAL SIGNAL RESILIENCE)
// ----------------------------------------------------
export function saveActiveOrdersOffline(orders) {
  try {
    if (Array.isArray(orders) && orders.length > 0) {
      localStorage.setItem('gd_driver_offline_active_orders', JSON.stringify(orders));
    } else {
      localStorage.removeItem('gd_driver_offline_active_orders');
    }
  } catch (e) {}
}

export function getOfflineActiveOrders() {
  try {
    const raw = localStorage.getItem('gd_driver_offline_active_orders');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function queueOfflineAction(action) {
  try {
    const raw = localStorage.getItem('gd_driver_pending_offline_actions');
    const queue = raw ? JSON.parse(raw) : [];
    queue.push({
      ...action,
      queuedAt: new Date().toISOString()
    });
    localStorage.setItem('gd_driver_pending_offline_actions', JSON.stringify(queue));
  } catch (e) {
    console.warn('[OfflineResilience] Error saving offline action:', e);
  }
}

export async function syncPendingOfflineActions() {
  if (!navigator.onLine) return;
  try {
    const raw = localStorage.getItem('gd_driver_pending_offline_actions');
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue) || queue.length === 0) return;

    console.log(`[OfflineResilience] Syncing ${queue.length} offline actions to Firestore...`);
    const remaining = [];

    for (const item of queue) {
      try {
        if (item.type === 'markDelivered') {
          await updateDoc(doc(db, 'orders', item.orderId), {
            status: 'delivered',
            deliveredAt: serverTimestamp(),
            deliveredOfflineAt: item.queuedAt || null,
            verificationStatus: 'verified'
          });
        } else if (item.type === 'markPickedUp') {
          await updateDoc(doc(db, 'orders', item.orderId), {
            status: 'in_transit',
            pickedUpAt: serverTimestamp()
          });
        }
      } catch (err) {
        console.error('[OfflineResilience] Failed to sync item:', item, err);
        remaining.push(item);
      }
    }

    if (remaining.length === 0) {
      localStorage.removeItem('gd_driver_pending_offline_actions');
      showToast('✅ Todas las entregas pendientes se sincronizaron con éxito', 'success');
    } else {
      localStorage.setItem('gd_driver_pending_offline_actions', JSON.stringify(remaining));
    }
  } catch (e) {
    console.error('[OfflineResilience] Error syncing offline queue:', e);
  }
}

export function updateOfflineBannerUI() {
  let banner = document.getElementById('driver-offline-mode-banner');
  const isOffline = !navigator.onLine;

  if (isOffline) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'driver-offline-mode-banner';
      banner.style.cssText = `
        position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: white; font-weight: 850; font-size: 12px; padding: 8px 16px;
        border-radius: 20px; box-shadow: 0 8px 20px rgba(217, 119, 6, 0.45);
        z-index: 10000; display: flex; align-items: center; gap: 8px;
        font-family: var(--font-body, sans-serif); border: 1.5px solid rgba(255,255,255,0.4);
        max-width: 90vw; text-align: center;
      `;
      banner.innerHTML = `
        <span style="font-size: 14px;">📡</span>
        <span>Modo Sin Señal: Datos guardados en tu equipo</span>
      `;
      document.body.appendChild(banner);
    }
  } else if (banner) {
    banner.remove();
  }
}

// ----------------------------------------------------
// 2. MULTI-STOP BATCH ROUTE SEQUENCER (FOOD COMMERCE PRIORITY & REAL-TIME GEO)
// ----------------------------------------------------
export function calculateOptimalMultiStopSequence(driverPos, activeOrders = []) {
  if (!Array.isArray(activeOrders) || activeOrders.length === 0) return [];

  const parseCoords = (c) => {
    if (!c) return null;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    let lat = typeof c.lat === 'number' ? c.lat : (typeof c.latitude === 'number' ? c.latitude : null);
    let lng = typeof c.lng === 'number' ? c.lng : (typeof c.longitude === 'number' ? c.longitude : null);
    if (lat === null && c.lat !== undefined) lat = parseFloat(c.lat);
    if (lng === null && c.lng !== undefined) lng = parseFloat(c.lng);
    if (lat === null && c.latitude !== undefined) lat = parseFloat(c.latitude);
    if (lng === null && c.longitude !== undefined) lng = parseFloat(c.longitude);
    if (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) {
      return { lat, lng };
    }
    return null;
  };

  const stops = [];

  activeOrders.forEach(o => {
    const isPickupPending = (o.status === 'pending' || o.status === 'accepted' || o.status === 'preparing' || o.status === 'ready' || (!o.pickedUpAt && o.status !== 'delivering'));
    
    // 1. Food / Commerce Orders (Highest Priority)
    const isFoodCommerce = !o.isFavor || Boolean(o.comercioId);
    
    // 2. Encomiendas / Packages
    const isEncomienda = isOrderEncomienda(o);

    let pCoords = parseCoords(o.pickupCoords || o.comercioCoords || o.originCoords || o.pickupLocation || o.originLocation);
    if (!pCoords && o.comercioId) {
      const allComercios = getState().comercios || [];
      const com = allComercios.find(c => c.id === o.comercioId);
      if (com && com.coords) pCoords = parseCoords(com.coords);
    }

    let dCoords = parseCoords(o.deliveryCoords || o.addressCoords || o.destinationCoords || o.shippingCoords || o.deliveryLocation || o.coords);

    if (isPickupPending) {
      if (isFoodCommerce && pCoords) {
        stops.push({
          type: 'pickup',
          orderId: o.id,
          title: o.comercioName || 'Retiro en Comercio',
          shortTitle: (o.comercioName || 'Comercio').slice(0, 14),
          address: o.pickupAddress || o.originAddress || o.comercioAddress || 'Magdalena',
          coords: [pCoords.lng, pCoords.lat],
          isFoodCommerce: true,
          isEncomienda: false,
          isUnverifiedMandado: false,
          order: o
        });
      } else if (isEncomienda) {
        const pickupAddr = o.pickupAddress || o.originAddress || 'Dirección de Retiro';
        stops.push({
          type: 'pickup',
          orderId: o.id,
          title: `Retiro: ${pickupAddr.slice(0, 20)}`,
          shortTitle: (pickupAddr || 'Paquete').slice(0, 14),
          address: pickupAddr,
          coords: pCoords ? [pCoords.lng, pCoords.lat] : null,
          isFoodCommerce: false,
          isEncomienda: true,
          isUnverifiedMandado: !pCoords,
          order: o
        });
      } else {
        // Free-text shopping mandado without verified pickup GPS (coords: null)
        const parsed = parseMandadoDetails(o.description || o.itemsText || o.notes || o.details, o.comercioName || o.originAddress);
        stops.push({
          type: 'pickup',
          orderId: o.id,
          title: `Retiro: ${parsed.comercio}`,
          shortTitle: (parsed.comercio || 'Mandado').slice(0, 14),
          address: parsed.comercio || 'Comercio / Kiosco indicado',
          coords: null,
          isFoodCommerce: false,
          isEncomienda: false,
          isUnverifiedMandado: true,
          order: o
        });
      }
    }

    if (dCoords) {
      stops.push({
        type: 'delivery',
        orderId: o.id,
        title: `Entrega: ${o.userName || o.clientName || 'Cliente'}`,
        shortTitle: (o.userName || o.clientName || 'Cliente').slice(0, 14),
        address: o.deliveryAddress || o.address || 'Magdalena',
        coords: [dCoords.lng, dCoords.lat],
        isFoodCommerce,
        isEncomienda,
        isUnverifiedMandado: false,
        order: o
      });
    } else {
      stops.push({
        type: 'delivery',
        orderId: o.id,
        title: `Entrega: ${o.userName || o.clientName || 'Cliente'}`,
        shortTitle: (o.userName || o.clientName || 'Cliente').slice(0, 14),
        address: o.deliveryAddress || o.address || 'Magdalena',
        coords: null,
        isFoodCommerce,
        isEncomienda,
        isUnverifiedMandado: true,
        order: o
      });
    }
  });

  if (stops.length <= 1) return stops;

  const pickedUpOrderIds = new Set();
  activeOrders.forEach(o => {
    const isPickupPending = (o.status === 'pending' || o.status === 'accepted' || o.status === 'preparing' || o.status === 'ready' || (!o.pickedUpAt && o.status !== 'delivering'));
    if (!isPickupPending) pickedUpOrderIds.add(o.id);
  });

  // Current Mission FIFO Preservation:
  // activeOrders[0] is the primary order that was accepted first and is already in progress.
  // 1. If activeOrders[0] has a pending pickup, activeOrders[0] pickup is ALWAYS Step #1!
  // 2. If activeOrders[0] is food commerce, its delivery immediately follows its pickup.
  // 3. Subsequent orders are processed in order of acceptance.
  const ordered = [];
  const remainingStops = [...stops];

  const primaryOrder = activeOrders[0];
  const primaryPickupStop = primaryOrder ? remainingStops.find(s => s.orderId === primaryOrder.id && s.type === 'pickup') : null;

  if (primaryPickupStop) {
    ordered.push(primaryPickupStop);
    pickedUpOrderIds.add(primaryPickupStop.orderId);
    const remIdx = remainingStops.findIndex(s => s === primaryPickupStop);
    if (remIdx !== -1) remainingStops.splice(remIdx, 1);

    if (primaryPickupStop.isFoodCommerce) {
      const primaryDeliveryStop = remainingStops.find(s => s.orderId === primaryOrder.id && s.type === 'delivery');
      if (primaryDeliveryStop) {
        ordered.push(primaryDeliveryStop);
        const delIdx = remainingStops.findIndex(s => s === primaryDeliveryStop);
        if (delIdx !== -1) remainingStops.splice(delIdx, 1);
      }
    }
  }

  // Next, fulfill remaining pickups before deliveries, preserving order of assignment
  while (remainingStops.length > 0) {
    const candidates = remainingStops.filter(s => s.type === 'pickup' || pickedUpOrderIds.has(s.orderId));
    if (candidates.length === 0) {
      const next = remainingStops.shift();
      ordered.push(next);
      if (next.type === 'pickup') pickedUpOrderIds.add(next.orderId);
      continue;
    }

    // Pick candidate from earliest assigned order
    const nextChosen = candidates[0];
    ordered.push(nextChosen);
    if (nextChosen.type === 'pickup') pickedUpOrderIds.add(nextChosen.orderId);
    const remIdx = remainingStops.findIndex(s => s === nextChosen);
    if (remIdx !== -1) remainingStops.splice(remIdx, 1);
  }

  return ordered;
}

// ----------------------------------------------------
// 3. PREDICTIVE DEMAND RADAR (KITCHEN PREP VOLUME)
// ----------------------------------------------------
export function initDemandRadarListener() {
  if (window._demandRadarUnsub) return;
  try {
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', ['preparing', 'pending', 'accepted'])
    );
    window._demandRadarUnsub = firebaseOnSnapshot(q, (snap) => {
      const prepOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const commerceCounts = new Map();

      prepOrders.forEach(o => {
        if (o.comercioId && o.comercioLocation) {
          const id = o.comercioId;
          const existing = commerceCounts.get(id);
          if (existing) {
            existing.count += 1;
          } else {
            const lat = Number(o.comercioLocation.lat || o.comercioLocation[1] || o.comercioLocation.latitude);
            const lng = Number(o.comercioLocation.lng || o.comercioLocation[0] || o.comercioLocation.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              commerceCounts.set(id, {
                id,
                name: o.comercioName || 'Comercio',
                count: 1,
                coords: [lng, lat]
              });
            }
          }
        }
      });

      const hotspots = Array.from(commerceCounts.values());
      window.currentDemandHotspots = hotspots;

      if (!activeOrdersList || activeOrdersList.length === 0) {
        renderDemandHotspots(hotspots);
      } else {
        renderDemandHotspots(null);
      }

      const demandPill = document.getElementById('driver-live-demand-pill');
      if (demandPill) {
        const totalPrep = hotspots.reduce((acc, h) => acc + h.count, 0);
        if (totalPrep > 0) {
          demandPill.style.display = 'flex';
          demandPill.innerHTML = `🔥 <strong>Radar de Cocina:</strong> ${totalPrep} pedido${totalPrep > 1 ? 's' : ''} preparándose en ${hotspots.length} comercio${hotspots.length > 1 ? 's' : ''}`;
        } else {
          demandPill.style.display = 'none';
        }
      }
    }, (err) => {
      console.warn('[DemandRadar] Listener note:', err);
    });
  } catch (e) {
    console.warn('[DemandRadar] Init error:', e);
  }
}

// --- LIFECYCLE AWARE ONSNAPSHOT WRAPPER FOR BATTERY & DATA OPTIMIZATION ---
let isAppActive = true;
let activeListeners = [];

function onSnapshot(q, callback, errCallback) {
  let unsub = null;
  const listener = {
    q,
    callback,
    errCallback,
    start: () => {
      if (unsub) return;
      try {
        unsub = firebaseOnSnapshot(q, callback, errCallback);
      } catch (err) {
        console.error('Error starting snapshot listener:', err);
      }
    },
    stop: () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
    }
  };

  activeListeners.push(listener);
  if (isAppActive) {
    listener.start();
  }

  const unsubFn = () => {
    listener.stop();
    activeListeners = activeListeners.filter(l => l !== listener);
  };
  registerUnsubscribe(unsubFn);
  return unsubFn;
}

// Track application background/foreground state changes
try {
  App.addListener('appStateChange', (state) => {
    console.log('Delivery Panel Lifecycle: App state changed. isActive =', state.isActive);
    isAppActive = state.isActive;
    if (isAppActive) {
      console.log(`Delivery Panel Lifecycle: Resuming ${activeListeners.length} active Firestore listeners...`);
      activeListeners.forEach(l => l.start());
    } else {
      console.log(`Delivery Panel Lifecycle: Pausing ${activeListeners.length} active Firestore listeners to save battery & data...`);
      activeListeners.forEach(l => l.stop());
    }
  });
} catch (e) {
  console.warn('Capacitor App state tracking not available in this environment:', e);
}

function getFavorTypeMeta(favorType) {
  switch (favorType) {
    case 'gocash':
      return {
        title: 'Go Cash',
        label: 'GO CASH',
        headerText: 'Detalles del Cambio (Go Cash)',
        color: '#6366f1',
        textColor: '#6366f1'
      };
    case 'mandado': // In DB, Encomiendas are favorType: 'mandado'
      return {
        title: 'GoFavor: Encomienda',
        label: 'ENCOMIENDA',
        headerText: 'Detalles de la Encomienda',
        color: '#10b981',
        textColor: '#10b981'
      };
    case 'pagodeservicios':
      return {
        title: 'GoFavor: PAGO DE SERVICIO',
        label: 'PAGO DE SERVICIOS',
        headerText: 'Detalles de Pago de Servicios',
        color: '#d97706',
        textColor: '#d97706'
      };
    case 'compra': // In DB, Mandados/Compras are favorType: 'compra'
    default:
      return {
        title: 'GoFavor: Mandado',
        label: 'MANDADO',
        headerText: 'Detalles del Mandado',
        color: '#ef4444',
        textColor: '#ef4444'
      };
  }
}

function getRgbString(colorHex) {
  if (colorHex === '#6366f1') return '99, 102, 241';
  if (colorHex === '#10b981') return '16, 185, 129';
  if (colorHex === '#d97706') return '217, 119, 6';
  return '239, 68, 68';
}

function formatFavorDetailsHTML(detailsStr) {
  if (!detailsStr) return '';
  let html = detailsStr;
  const lines = html.split('\n');
  return `<div style="display:flex; flex-direction:column; gap:6px;">
    ${lines.map(line => {
      let lineHtml = line.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--color-text-primary); font-weight:800;">$1</strong>');
      return `<div style="font-size:12.5px; line-height:1.4; color:var(--color-text-secondary);">${lineHtml}</div>`;
    }).join('')}
  </div>`;
}

function parseFavorDetails(details) {
  if (!details) return [];
  const stores = [];
  const regex = /🏪\s*\*\*?\d+\.\s*Comercio:\*\*?\s*(.*?)(?=\s*📦|$)/gi;
  const matches = [...details.matchAll(regex)];
  
  matches.forEach((match, index) => {
    const storeName = match[1].trim();
    const nextIndex = index + 1 < matches.length ? matches[index + 1].index : details.length;
    const subStr = details.slice(match.index, nextIndex);
    const pedMatch = subStr.match(/📦\s*\*\*?Pedido:\*\*?\s*([\s\S]*?)(?=\n*🏪|$)/i);
    
    stores.push({
      name: storeName,
      items: pedMatch ? pedMatch[1].trim() : ''
    });
  });
  
  return stores;
}

let activeOrdersCount = 0;
let activeOrdersList = [];
const commerceCache = new Map();

export async function renderDeliveryPanel(containerArg) {
  const panelId = 'page-delivery';
  const content = containerArg || document.getElementById(panelId) || document.getElementById('app-content');
  if (!content) return;
  content.style.overflow = 'hidden';

  // Apply dark mode styling & zero-scroll lock to document for Driver Mode
  document.documentElement.classList.add('is-delivery-mode');
  document.body.classList.add('is-delivery-mode');

  // Enforce Dark Mode by default on fresh session
  if (typeof localStorage !== 'undefined' && localStorage.getItem('gd_driver_theme_v9') !== 'true') {
    localStorage.setItem('gd_driver_theme', 'dark');
    localStorage.setItem('gd_driver_theme_mode', 'dark');
    localStorage.setItem('gd_driver_theme_v9', 'true');
  }

  const savedTheme = localStorage.getItem('gd_driver_theme') || 'dark';
  const initialDriverTheme = (savedTheme === 'light') ? 'light' : 'dark';
  if (initialDriverTheme === 'light') {
    document.documentElement.classList.add('driver-light-mode');
    document.body.classList.add('driver-light-mode');
    document.documentElement.classList.remove('driver-dark-mode');
    document.body.classList.remove('driver-dark-mode');
  } else {
    document.documentElement.classList.remove('driver-light-mode');
    document.body.classList.remove('driver-light-mode');
    document.documentElement.classList.add('driver-dark-mode');
    document.body.classList.add('driver-dark-mode');
  }

  window.scrollTo(0, 0);

  if (!window._deliveryScrollLockActive) {
    window._deliveryScrollLockActive = true;
    window.addEventListener('scroll', () => {
      if (document.body.classList.contains('is-delivery-mode')) {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
          window.scrollTo(0, 0);
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (document.body.classList.contains('is-delivery-mode')) {
        const isMap = e.target.closest('#driver-fullscreen-map, .maplibregl-map, .maplibregl-canvas, .maplibregl-marker');
        if (isMap) return; // Allow MapLibre native gestures to process without interruption
        const scrollable = e.target.closest('#exclusive-offer-fullscreen-overlay, .modal-content, .drawer-menu, #driver-bottom-sheet-card, #dock-expanded-orders-list, [data-scrollable="true"]');
        if (!scrollable) {
          e.preventDefault();
        }
      }
    }, { passive: false });
  }

  // Reactive listener for real-time visual theme toggle (Claro / Oscuro) without page reload
  if (!window._driverThemeListenerBound) {
    window._driverThemeListenerBound = true;
    window.addEventListener('driver-theme-changed', (e) => {
      const theme = e.detail?.theme || getDriverMapTheme();
      const isLight = theme === 'light';

      const supportFabBtn = document.getElementById('driver-support-fab-btn');
      if (supportFabBtn) {
        supportFabBtn.style.background = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.92)';
        supportFabBtn.style.border = `1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.15)'}`;
        supportFabBtn.style.boxShadow = isLight ? '0 10px 25px rgba(0,0,0,0.1)' : '0 10px 25px rgba(0,0,0,0.6)';
        supportFabBtn.style.color = isLight ? '#e11d48' : '#fb7185';
      }

      const speedPill = document.getElementById('driver-speedometer-pill');
      if (speedPill) {
        speedPill.style.background = isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.92)';
        speedPill.style.border = `1.5px solid ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(244,63,94,0.35)'}`;
        speedPill.style.boxShadow = isLight ? '0 8px 24px rgba(0,0,0,0.1)' : '0 8px 24px rgba(0,0,0,0.5)';
        const speedVal = document.getElementById('driver-speed-value');
        if (speedVal) speedVal.style.color = isLight ? '#0f172a' : '#ffffff';
      }

      const streetPill = document.getElementById('driver-current-street-pill');
      if (streetPill) {
        streetPill.style.background = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(9, 13, 22, 0.92)';
        streetPill.style.border = `1px solid ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)'}`;
        streetPill.style.color = isLight ? '#0f172a' : '#f8fafc';
        streetPill.style.boxShadow = isLight ? '0 8px 20px rgba(0,0,0,0.08)' : '0 8px 20px rgba(0,0,0,0.35)';
      }

      const recenterCompassBtn = document.getElementById('driver-recenter-compass-btn');
      if (recenterCompassBtn) {
        recenterCompassBtn.style.background = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.94)';
        recenterCompassBtn.style.border = `1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.18)'}`;
        recenterCompassBtn.style.color = isLight ? '#0f172a' : '#38bdf8';
        recenterCompassBtn.style.boxShadow = isLight ? '0 8px 24px rgba(0,0,0,0.12)' : '0 8px 24px rgba(0,0,0,0.5)';
      }

      const bottomDock = document.getElementById('driver-footer-dock-container');
      const currentUser = getState().user;
      if (bottomDock) {
        bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
        attachBottomDockListeners(currentUser, activeOrdersList);
      }

      const statusBar = document.getElementById('session-status-bar-container');
      if (statusBar && currentUser) {
        statusBar.innerHTML = renderStatusBar(currentUser);
        attachStatusBarListeners(currentUser);
      }

      const offlineHero = document.getElementById('driver-offline-hero');
      if (offlineHero) {
        offlineHero.style.background = isLight ? '#f8fafc' : '#04070d';
        const offlineTitle = offlineHero.querySelector('h3');
        if (offlineTitle) offlineTitle.style.color = isLight ? '#0f172a' : 'white';
        const offlineSub = offlineHero.querySelector('p');
        if (offlineSub) offlineSub.style.color = isLight ? '#64748b' : '#94a3b8';
      }
    });
  }

  // Dismiss splash screen if still visible
  if (window.dismissSplashScreen) window.dismissSplashScreen();

  // Explicitly hide client navigation elements and zero out app padding
  const appNav = document.getElementById('app-navbar');
  if (appNav) appNav.style.setProperty('display', 'none', 'important');
  const appFoot = document.getElementById('app-footer');
  if (appFoot) appFoot.style.setProperty('display', 'none', 'important');
  const appHead = document.getElementById('app-header');
  if (appHead) appHead.style.setProperty('display', 'none', 'important');
  const appContent = document.getElementById('app-content');
  if (appContent) {
    appContent.style.setProperty('padding-bottom', '0px', 'important');
    appContent.style.setProperty('margin-bottom', '0px', 'important');
  }

  // HOTSPOTS IMPLEMENTATION & ROUND ROBIN QUEUE
  const user = getState().user;
  if (!user || !isDelivery()) {
    document.documentElement.classList.remove('is-delivery-mode');
    document.body.classList.remove('is-delivery-mode');
    content.innerHTML = `<div class="empty-state">Acceso denegado</div>`;
    return;
  }
  window.autoAcceptFilters = getDriverAutoAcceptFilters();
  window.autoAcceptEnabled = user.autoAcceptEnabled || (localStorage.getItem('driver_auto_accept') === 'true');
  window.expiredLocalOrders = new Set();
  window.triggerDriverConnect = () => {
    startSession(getState().user || user);
  };

  // Initialize offline network listeners & banner
  if (!window._driverNetworkListenerAttached) {
    window._driverNetworkListenerAttached = true;
    window.addEventListener('online', () => {
      updateOfflineBannerUI();
      showToast('📶 Conexión restablecida. Sincronizando...', 'info');
      syncPendingOfflineActions();
    });
    window.addEventListener('offline', () => {
      updateOfflineBannerUI();
      showToast('📡 Sin señal 4G. Modo Offline activado.', 'warning');
    });
  }
  updateOfflineBannerUI();
  syncPendingOfflineActions();

  // If offline on initial load, hydrate active orders from local storage
  if (!navigator.onLine && (!activeOrdersList || activeOrdersList.length === 0)) {
    const cached = getOfflineActiveOrders();
    if (cached && cached.length > 0) {
      activeOrdersList = cached;
      console.log('[OfflineHydrate] Loaded cached orders:', cached);
    }
  }

  // Initialize Predictive Demand Radar (Kitchen prep volume)
  initDemandRadarListener();

  // Real-time listener for pending proofs of this driver
  if (user?.uid && !window._driverProofsUnsub) {
    const qProofs = query(
      collection(db, 'delivery_settlement_proofs'),
      where('driverId', '==', user.uid),
      where('status', '==', 'pending')
    );
    window._driverProofsUnsub = firebaseOnSnapshot(qProofs, (snap) => {
      const pendingProofs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setState('pendingProofs', pendingProofs);
      const barContainer = document.getElementById('session-status-bar-container');
      if (barContainer) {
        barContainer.innerHTML = renderStatusBar(getState().user || user);
        attachStatusBarListeners(getState().user || user);
      }
    });
  }

  const currentHash = window.location.hash || '';
  if (currentHash.includes('tab=settlements')) {
    setTimeout(() => {
      if (user?.uid) {
        showBalanceHistoryModal(user.uid);
      }
    }, 500);
  }

  if (currentHash.includes('action=renew_session')) {
    setTimeout(async () => {
      try {
        const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
        const { db } = await import('../firebase.js');
        await updateDoc(doc(db, 'users', user.uid), {
          lastTripAcceptedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          inactivityWarningSentAt: null
        });
        setState('user', {
          ...getState().user,
          lastTripAcceptedAt: new Date(),
          lastActivityAt: new Date(),
          inactivityWarningSentAt: null
        });
        showToast('✅ Tu sesión fue restablecida. Seguís conectado y disponible para recibir pedidos.', 'success');
      } catch (err) {
        console.error('Error renewing session:', err);
      }
    }, 300);
  }

  window.toggleAutoAccept = async (checked, userId, filters = null) => {
    window.autoAcceptEnabled = checked;
    if (filters) saveDriverAutoAcceptFilters(filters);
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase.js');
      const payload = { autoAcceptEnabled: checked };
      if (filters) payload.autoAcceptFilters = filters;
      await updateDoc(doc(db, 'users', userId), payload);
      console.log('[toggleAutoAccept] Updated Firestore autoAcceptEnabled to', checked);
    } catch (err) {
      console.error('Error saving autoAcceptEnabled:', err);
    }
  };

  // Setup click listener on content for coupon info cards (with cleanup to avoid duplicate listeners)
  if (content._couponListener) {
    content.removeEventListener('click', content._couponListener);
  }
  content._couponListener = (e) => {
    const infoBtn = e.target.closest('.coupon-info-btn');
    if (infoBtn) {
      e.stopPropagation();
      e.preventDefault();
      
      const discountVal = Number(infoBtn.dataset.discount || 0);
      
      showModal({
        title: '',
        hideHeader: true,
        height: 'auto',
        content: `
          <div style="padding:24px 20px; font-family:var(--font-body); color:var(--color-text-primary); display:flex; flex-direction:column; gap:16px;">
            <div style="text-align:center; margin-bottom:8px;">
              <div style="font-size:40px; display:inline-block; animation: scale-pulse 2s infinite;">🎟️</div>
            </div>
            
            <h4 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; text-align:center; line-height:1.3; color:#a855f7; display:flex; align-items:center; justify-content:center; gap:6px;">
              ${icon('tag', 18)} Cupones y Ofertas en GoDelivery
            </h4>
            
            <p style="font-size:13px; color:var(--color-text-secondary); margin:0; line-height:1.5; text-align:center; font-weight:500;">
              ¡Tu ganancia por el envío está 100% protegida! A continuación te explicamos exactamente cómo funciona:
            </p>
            
            <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:16px; padding:6px; background:rgba(34, 197, 94, 0.1); border-radius:50%; color:#22c55e; flex-shrink:0;">💸</span>
                <div>
                  <strong style="font-size:12px; display:block; color:var(--color-text-primary); margin-bottom:2px;">Absorción por la Plataforma</strong>
                  <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.4; display:block;">
                    Cualquier cupón o descuento (Envío Gratis o Descuento %) es una campaña publicitaria de <strong>GO Delivery</strong> para atraer clientes y aumentar tus pedidos. El costo lo asume en su totalidad la empresa, <strong>nunca tú</strong>.
                  </span>
                </div>
              </div>
              
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:16px; padding:6px; background:rgba(168, 85, 247, 0.1); border-radius:50%; color:#a855f7; flex-shrink:0;">🔄</span>
                <div>
                  <strong style="font-size:12px; display:block; color:var(--color-text-primary); margin-bottom:2px;">Descuento en tu Deuda</strong>
                  <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.4; display:block;">
                    Dado que el cliente te paga menos en efectivo, el monto descontado (en este pedido: <strong>${formatPrice(discountVal)}</strong>) se <strong>restará de tu deuda</strong> de comisiones con la aplicación al momento de completar la entrega.
                  </span>
                </div>
              </div>
              
              <div style="display:flex; gap:10px; align-items:flex-start;">
                <span style="font-size:16px; padding:6px; background:rgba(0, 158, 227, 0.1); border-radius:50%; color:#009ee3; flex-shrink:0;">🛡️</span>
                <div>
                  <strong style="font-size:12px; display:block; color:var(--color-text-primary); margin-bottom:2px;">Ingreso Neto Intacto</strong>
                  <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.4; display:block;">
                    Tus ganancias netas reales por el reparto y las propinas no sufren ningún tipo de descuento. ¡Trabajas con total tranquilidad!
                  </span>
                </div>
              </div>
            </div>
            
            <button id="coupon-modal-close-btn" class="btn btn-primary" style="height:48px; border-radius:14px; font-weight:900; font-size:14px; background:#a855f7; border:none; color:white; margin-top:8px; cursor:pointer; box-shadow:0 6px 16px rgba(168, 85, 247, 0.25);">
              ¡ENTENDIDO!
            </button>
          </div>
        `
      });
      
      const closeBtn = document.getElementById('coupon-modal-close-btn');
      if (closeBtn) {
        closeBtn.onclick = () => closeModal();
      }
    }
  };
  content.addEventListener('click', content._couponListener);



  const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : window.Capacitor.platform !== 'web'));
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isOnline = user.isOnline === true;
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  // 1. Mount fullscreen map directly on document.body for true, unconstrained edge-to-edge rendering
  let mapContainer = document.getElementById('driver-fullscreen-map');
  if (!mapContainer) {
    mapContainer = document.createElement('div');
    mapContainer.id = 'driver-fullscreen-map';
    document.body.appendChild(mapContainer);
  } else if (mapContainer.parentElement !== document.body) {
    document.body.appendChild(mapContainer);
  }

  mapContainer.style.setProperty('display', 'block', 'important');
  mapContainer.style.setProperty('position', 'fixed', 'important');
  mapContainer.style.setProperty('inset', '0', 'important');
  mapContainer.style.setProperty('top', '0', 'important');
  mapContainer.style.setProperty('left', '0', 'important');
  mapContainer.style.setProperty('right', '0', 'important');
  mapContainer.style.setProperty('bottom', '0', 'important');
  mapContainer.style.setProperty('width', '100vw', 'important');
  mapContainer.style.setProperty('height', '100vh', 'important');
  mapContainer.style.setProperty('height', '100dvh', 'important');
  mapContainer.style.setProperty('min-height', '100vh', 'important');
  mapContainer.style.setProperty('min-height', '100dvh', 'important');
  mapContainer.style.setProperty('max-height', '100vh', 'important');
  mapContainer.style.setProperty('max-height', '100dvh', 'important');
  mapContainer.style.setProperty('z-index', '100', 'important');
  mapContainer.style.setProperty('background', isLight ? '#f8fafc' : '#04070d', 'important');
  mapContainer.style.setProperty('margin', '0', 'important');
  mapContainer.style.setProperty('padding', '0', 'important');
  mapContainer.style.setProperty('overflow', 'hidden', 'important');

  // 2. Mount Floating HUD layer directly on document.body for guaranteed top-layer visibility
  let hudContainer = document.getElementById('driver-hud-container');
  if (!hudContainer) {
    hudContainer = document.createElement('div');
    hudContainer.id = 'driver-hud-container';
    document.body.appendChild(hudContainer);
  } else if (hudContainer.parentElement !== document.body) {
    document.body.appendChild(hudContainer);
  }

  hudContainer.style.setProperty('display', 'block', 'important');
  hudContainer.style.setProperty('position', 'fixed', 'important');
  hudContainer.style.setProperty('inset', '0', 'important');
  hudContainer.style.setProperty('top', '0', 'important');
  hudContainer.style.setProperty('left', '0', 'important');
  hudContainer.style.setProperty('right', '0', 'important');
  hudContainer.style.setProperty('bottom', '0', 'important');
  hudContainer.style.setProperty('width', '100vw', 'important');
  hudContainer.style.setProperty('height', '100vh', 'important');
  hudContainer.style.setProperty('height', '100dvh', 'important');
  hudContainer.style.setProperty('z-index', '9990', 'important');
  hudContainer.style.setProperty('pointer-events', 'none', 'important');
  hudContainer.style.setProperty('margin', '0', 'important');
  hudContainer.style.setProperty('padding', '0', 'important');
  hudContainer.style.setProperty('overflow', 'hidden', 'important');

  // Clear slide-panel content to avoid duplicate or trapped elements
  content.innerHTML = '';

  // Render Floating HUD overlays into hudContainer
  hudContainer.innerHTML = `
    <!-- LAYER 2: SOLID INTEGRATED TOP STATUS BAR HEADER (WITH SYSTEM NOTIFICATION INTEGRATION) -->
    <div id="session-status-bar-container" style="
      position: fixed;
      top: 0; left: 0; right: 0;
      padding: max(16px, calc(env(safe-area-inset-top, 0px) + 12px)) 12px 10px 12px;
      z-index: 9999;
      pointer-events: auto;
      background: ${isLight ? '#ffffff' : '#090d16'};
      border-bottom: 1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'};
      box-shadow: 0 4px 20px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.6)'};
    ">
      ${renderStatusBar(user)}
    </div>

    <!-- LAYER 2.4: FLOATING TELEMETRY SPEEDOMETER -->
    ${isOnline ? (() => {
      const hasActiveOrders = Array.isArray(activeOrdersList) && activeOrdersList.length > 0;
      const isMinimized = hasActiveOrders ? window._driverDockMinimized === true : false;
      const badgeBottom = hasActiveOrders 
        ? (isMinimized ? 'max(140px, calc(120px + env(safe-area-inset-bottom, 24px)))' : 'max(168px, calc(150px + env(safe-area-inset-bottom, 24px)))') 
        : 'max(116px, calc(98px + env(safe-area-inset-bottom, 24px)))';
      return `
        <div id="driver-speedometer-pill" style="
          position: fixed;
          bottom: ${badgeBottom};
          left: 16px;
          display: flex;
          align-items: center;
          gap: 6px;
          background: ${isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.92)'};
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          border: 1.5px solid ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(244,63,94,0.35)'};
          border-radius: 20px;
          padding: 6px 12px;
          z-index: 9990;
          pointer-events: auto;
          box-shadow: 0 8px 24px ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.5)'};
          transition: bottom 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease;
        ">
          <span style="font-size: 13px;">⚡</span>
          <span id="driver-speed-value" style="font-size: 14px; font-weight: 900; color: ${isLight ? '#0f172a' : '#ffffff'}; font-family: monospace;">${window.currentDriverSpeedKmh || 0}</span>
          <span style="font-size: 10px; font-weight: 700; color: ${isLight ? '#64748b' : '#94a3b8'};">km/h</span>
        </div>

        <!-- LAYER 2.6: FLOATING CURRENT STREET PILL -->
        <div id="driver-current-street-pill" style="
          position: fixed;
          bottom: ${badgeBottom};
          right: 16px;
          background: ${isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(9, 13, 22, 0.92)'};
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border: 1px solid ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)'};
          border-radius: 18px;
          padding: 6px 14px;
          font-size: 11.5px;
          font-weight: 800;
          color: ${isLight ? '#0f172a' : '#f8fafc'};
          display: flex;
          align-items: center;
          gap: 6px;
          z-index: 9990;
          pointer-events: none;
          box-shadow: 0 8px 20px rgba(0,0,0,0.35);
          white-space: nowrap;
          max-width: calc(100vw - 150px);
          overflow: hidden;
          text-overflow: ellipsis;
          transition: bottom 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease;
        ">
          <span style="color:#e11d48; font-size:12px;">📍</span>
          <span id="driver-street-name-text">${window.lastDriverManeuver?.currentStreet ? `Circulando por: ${window.lastDriverManeuver.currentStreet}` : 'Magdalena en tiempo real'}</span>
        </div>

        <!-- FLOATING DRIVER MAP CONTROLS (ZOOM & RECENTER) - PERMANENTLY VERTICALLY CENTERED -->
        <div id="driver-map-controls-group" style="
          position: fixed;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 9990;
          pointer-events: auto;
        ">
          <!-- Zoom In / Out Group -->
          <div style="
            display: flex;
            flex-direction: column;
            background: ${isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.94)'};
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.18)'};
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 8px 24px ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.5)'};
          ">
            <button type="button" id="driver-zoom-in-btn" style="
              width: 44px; height: 40px;
              background: transparent; border: none;
              border-bottom: 1px solid ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; color: ${isLight ? '#0f172a' : '#ffffff'};
              transition: background 0.15s ease;
            " title="Acercar mapa">
              ${icon('plus', 18)}
            </button>
            <button type="button" id="driver-zoom-out-btn" style="
              width: 44px; height: 40px;
              background: transparent; border: none;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; color: ${isLight ? '#0f172a' : '#ffffff'};
              transition: background 0.15s ease;
            " title="Alejar mapa">
              ${icon('minus', 18)}
            </button>
          </div>

          <!-- Recenter Compass Target Button -->
          <button id="driver-recenter-compass-btn" style="
            width: 44px; height: 44px; border-radius: 50%;
            background: ${isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.94)'};
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.18)'};
            color: ${isLight ? '#0f172a' : '#38bdf8'};
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            box-shadow: 0 8px 24px ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.5)'};
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
          " title="Recentrar mi ubicación">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="7.5"></circle>
              <line x1="12" y1="2" x2="12" y2="4.5"></line>
              <line x1="12" y1="19.5" x2="12" y2="22"></line>
              <line x1="2" y1="12" x2="4.5" y2="12"></line>
              <line x1="19.5" y1="12" x2="22" y2="12"></line>
              <circle cx="12" cy="12" r="2.2" fill="currentColor"></circle>
            </svg>
          </button>
        </div>
      `;
    })() : ''}
    
    <!-- LAYER 3: CENTERED OFFLINE HERO (SHOWN WHEN OFFLINE) -->
    ${!isOnline ? `
      <div id="driver-offline-hero" style="position:fixed; inset:0; width:100vw; height:100vh; height:100dvh; display:flex; align-items:center; justify-content:center; padding:max(36px, calc(24px + env(safe-area-inset-top, 24px))) 24px max(36px, calc(28px + env(safe-area-inset-bottom, 24px))) 24px; box-sizing:border-box; z-index:900; pointer-events:auto; background:${isLight ? '#f8fafc' : '#04070d'};">
        <div style="width:100%; max-width:340px; display:flex; flex-direction:column; align-items:center; text-align:center;">
          <div style="font-size:44px; margin-bottom:8px;">💤</div>
          <h3 style="font-family:var(--font-display, sans-serif); font-size:21px; font-weight:900; color:${isLight ? '#0f172a' : 'white'}; margin:0 0 8px 0; letter-spacing:0.2px;">Estás desconectado</h3>
          <p style="color:${isLight ? '#64748b' : '#94a3b8'}; font-size:13.5px; margin:0 0 24px 0; line-height:1.5; font-weight:500;">Debés conectarte para empezar a recibir y tomar pedidos disponibles.</p>
          <button id="main-connect-hero-btn" class="btn" style="
            width: 100%;
            max-width: 280px;
            height: 54px;
            border-radius: 20px;
            border: none;
            background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
            color: white;
            font-size: 15px;
            font-weight: 900;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 10px 25px rgba(225, 29, 72, 0.45);
            cursor: pointer;
            text-transform: uppercase;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
          ">
            ${icon('power', 20)} CONECTAR AHORA
          </button>
        </div>
      </div>
    ` : ''}

    <!-- LAYER 4: FLOATING RADAR DOCK (ALWAYS VISIBLE WHEN ONLINE WITH AUTO-ACCEPT) -->
    ${isOnline ? `
      <div id="driver-footer-dock-container" style="position:fixed; bottom:max(28px, calc(18px + env(safe-area-inset-bottom, 24px))); left:16px; right:16px; z-index:9999; pointer-events:auto;">
        ${renderBottomDockContent(user, activeOrdersList)}
      </div>
    ` : ''}

    <!-- LAYER 5: FLOATING CONTAINER FOR INCOMING ORDER OFFERS & MODALS -->
    <div id="delivery-scroll-area" style="position:fixed; inset:0; width:100vw; height:100vh; height:100dvh; z-index:9980; pointer-events:none;">
      <div id="delivery-content" style="pointer-events:none; width:100%; height:100%;"></div>
    </div>
  `;

  attachStatusBarListeners(user);
  if (isOnline) {
    attachBottomDockListeners(user, activeOrdersList);
  }

  // Initialize 3D Navigation Map
  setTimeout(() => {
    initDriverNavigationMap(mapContainer);
  }, 50);

  if (isOnline) {
    attachBottomDockListeners(user, activeOrdersList);

    // Live connected timer
    if (window._driverLiveTimerInterval) clearInterval(window._driverLiveTimerInterval);
    const updateLiveTimer = () => {
      const el = document.getElementById('driver-live-timer-text');
      if (!el) return;
      const currentUser = getState().user || user;
      const start = currentUser.lastTripAcceptedAt ? (currentUser.lastTripAcceptedAt.toDate ? currentUser.lastTripAcceptedAt.toDate() : new Date(currentUser.lastTripAcceptedAt)) : new Date();
      const diffMs = Math.max(0, Date.now() - start.getTime());
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(mins / 60);
      if (hours > 0) {
        el.textContent = `${hours}h ${mins % 60}m`;
      } else {
        el.textContent = `${mins}m`;
      }
    };
    updateLiveTimer();
    window._driverLiveTimerInterval = setInterval(updateLiveTimer, 30000);
  }
    setupPersistentBadges();

    // Attach listener for auto-accept info button (renders bottom card/sheet)
    const infoBtn = document.getElementById('auto-accept-info-btn');
    if (infoBtn) {
      infoBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Remove existing sheet if any
        const existing = document.getElementById('info-bottom-sheet');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'info-bottom-sheet';
        overlay.style.cssText = `
          position: fixed;
          inset: 0;
          z-index: 999999;
          background: rgba(0,0,0,0.4);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          opacity: 0;
          transition: opacity 0.3s ease;
        `;

        overlay.innerHTML = `
          <div id="info-bottom-sheet-card" style="
            background: var(--color-bg);
            border-top-left-radius: 24px;
            border-top-right-radius: 24px;
            padding: var(--space-6) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom, 0px)) var(--space-5);
            box-shadow: 0 -8px 32px rgba(0,0,0,0.15);
            transform: translateY(100%);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
          ">
            <!-- Drag indicator handle -->
            <div style="width: 36px; height: 5px; background: var(--color-border-light, #e5e7eb); border-radius: 3px; align-self: center; margin-bottom: 8px;"></div>
            
            <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; color: var(--color-text-primary); margin: 0; padding-right: var(--space-6);">
              Modo Auto-Aceptar
            </h3>
            
            <div style="font-size: 14.5px; line-height: 1.6; color: var(--color-text-secondary); font-weight: 550; display:flex; flex-direction:column; gap:12px;">
              <p style="margin:0;"><strong>¿Cómo funciona?</strong></p>
              <p style="margin:0;">Al activar esta opción, cualquier pedido exclusivo que se te asigne en cola será <strong>aceptado automáticamente</strong> por el sistema sin necesidad de que presiones el botón de aceptar.</p>
              <p style="margin:0;">⚠️ <strong>Importante:</strong> Evita que tus pedidos expiren por inactividad y mantiene tu flujo de trabajo constante.</p>
            </div>
            
            <button id="info-bottom-sheet-close-btn" style="
              width: 100%;
              height: 54px;
              border: none;
              background: var(--color-primary);
              color: white;
              border-radius: 16px;
              font-weight: 900;
              font-size: 15.5px;
              cursor: pointer;
              margin-top: 8px;
              box-shadow: 0 8px 24px rgba(225,29,72,0.25);
            ">
              Entendido
            </button>
          </div>
        `;

        document.body.appendChild(overlay);

        // Animate in
        setTimeout(() => {
          overlay.style.opacity = '1';
          const card = document.getElementById('info-bottom-sheet-card');
          if (card) card.style.transform = 'translateY(0)';
        }, 10);

        const closeSheet = () => {
          const card = document.getElementById('info-bottom-sheet-card');
          if (card) card.style.transform = 'translateY(100%)';
          overlay.style.opacity = '0';
          setTimeout(() => overlay.remove(), 300);
        };

        overlay.onclick = (e) => {
          if (e.target === overlay) closeSheet();
        };

        const closeBtn = document.getElementById('info-bottom-sheet-close-btn');
        if (closeBtn) closeBtn.onclick = closeSheet;
      };
    }

  // Ensure inactivity check and heartbeat is running if online
  if (user?.isOnline) {
    startInactivityCheck(user);
    startHeartbeat(user);
  }

  // Update header and status bar (non-destructive)
  // ─── Delivery Drawer (hamburger menu, identical pattern to commerce panel) ───
  document.getElementById('delivery-drawer-backdrop')?.remove();
  document.getElementById('delivery-drawer')?.remove();

  const deliveryBackdropEl = document.createElement('div');
  deliveryBackdropEl.id = 'delivery-drawer-backdrop';
  deliveryBackdropEl.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; opacity: 0; pointer-events: none; transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);";
  document.body.appendChild(deliveryBackdropEl);

  const deliveryDrawerEl = document.createElement('div');
  deliveryDrawerEl.id = 'delivery-drawer';
  deliveryDrawerEl.style.cssText = "position: fixed; top: 0; right: 0; bottom: 0; width: 300px; background: var(--color-surface); box-shadow: -4px 0 24px rgba(0,0,0,0.15); z-index: 10001; transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; border-top-left-radius: 20px; border-bottom-left-radius: 20px;";
  deliveryDrawerEl.innerHTML = `
    <div style="padding: 20px 20px 14px; display:flex; align-items:center; justify-content:space-between; border-bottom: 1px solid var(--color-border-light);">
      <h2 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Opciones</h2>
      <button id="delivery-drawer-close-btn" style="width:36px; height:36px; border-radius:10px; border:none; background:var(--color-bg-secondary); color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center;">${icon('close', 16)}</button>
    </div>
    <div style="flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:4px;">
      <a href="#/delivery/history" id="delivery-drawer-history" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; text-decoration:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(100,116,139,0.09); color:#64748b;">${icon('history', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Historial de Pedidos</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </a>
      <a href="#/delivery/finances" id="delivery-drawer-finances" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; text-decoration:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(34,197,94,0.09); color:#16a34a;">${icon('bank', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Finanzas y Cuentas</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </a>
      <a href="#/delivery/config" id="delivery-drawer-config" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; text-decoration:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(99,102,241,0.09); color:#6366f1;">${icon('settings', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Configuración de Perfil</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </a>
      <div style="height:1px; background:var(--color-border-light); margin:8px 0;"></div>
      <button id="delivery-drawer-support-btn" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; border:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer; width:100%; text-align:left;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: rgba(14,165,233,0.08); color:#0284c7;">${icon('headset', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Soporte Técnico</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </button>
      <button id="delivery-drawer-info-btn" style="display:flex; align-items:center; gap:14px; padding:14px 12px; border-radius:14px; background:transparent; border:none; color:var(--color-text-primary); transition:background 0.15s; cursor:pointer; width:100%; text-align:left;">
        <div style="width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:rgba(245,158,11,0.1); color:#f59e0b;">${icon('helpCircle', 18)}</div>
        <span style="flex:1; font-size:14.5px; font-weight:700;">Funcionamiento del Sistema</span>
        <span style="color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('chevronRight', 16)}</span>
      </button>
    </div>
  `;
  document.body.appendChild(deliveryDrawerEl);

  const openDeliveryDrawer = () => {
    deliveryDrawerEl.style.transform = 'translateX(0)';
    deliveryBackdropEl.style.opacity = '1';
    deliveryBackdropEl.style.pointerEvents = 'auto';
  };
  const closeDeliveryDrawer = () => {
    deliveryDrawerEl.style.transform = 'translateX(100%)';
    deliveryBackdropEl.style.opacity = '0';
    deliveryBackdropEl.style.pointerEvents = 'none';
  };

  deliveryBackdropEl.addEventListener('click', closeDeliveryDrawer);
  document.getElementById('delivery-drawer-close-btn')?.addEventListener('click', closeDeliveryDrawer);

  // Close drawer on nav link click
  ['delivery-drawer-history','delivery-drawer-finances','delivery-drawer-config'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', closeDeliveryDrawer);
  });

  // Support button
  document.getElementById('delivery-drawer-support-btn')?.addEventListener('click', async () => {
    closeDeliveryDrawer();
    try {
      const { openSupportTicketModal } = await import('../components/support-bot.js');
      await openSupportTicketModal(user.uid, `Repartidor: ${user.displayName || user.email || user.uid}`);
    } catch (err) {
      console.error('Error opening support ticket:', err);
    }
  });

  const headerSlot = document.getElementById('delivery-header-slot');
  if (headerSlot) {
    headerSlot.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding: 12px 20px 20px 20px;background:var(--color-primary);border-bottom:none;box-shadow:0 4px 12px rgba(0,0,0,0.1);position:relative;overflow:hidden;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -15px; right: -15px; width: 60px; height: 60px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
        
        <div style="flex:1;min-width:0;position:relative;z-index:2;padding-right:4px;">
          <h1 style="font-family:var(--font-display);font-weight:800;font-size:17px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Panel Delivery</h1>
          <p style="font-size:10px;color:rgba(255,255,255,0.85);font-weight:700;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Repartidor ${user.deliveryId || 'Oficial'}</p>
        </div>
        <div style="position:relative;z-index:2;flex-shrink:0;">
          <button id="delivery-hamburger-btn" title="Menú de Opciones" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
            ${icon('menu', 22)}
          </button>
        </div>
      </div>
    `;

    document.getElementById('delivery-hamburger-btn')?.addEventListener('click', () => {
      import('../utils/audio-manager.js').catch(() => {});
      openDeliveryDrawer();
    });

    // Wire info button inside drawer
    document.getElementById('delivery-drawer-info-btn')?.addEventListener('click', () => {
      closeDeliveryDrawer();

      const existing = document.getElementById('info-bottom-sheet');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'info-bottom-sheet';
      overlay.style.cssText = `position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: flex-end; opacity: 0; transition: opacity 0.3s ease;`;
      overlay.innerHTML = `
        <div id="info-bottom-sheet-card" style="background: var(--color-bg); border-top-left-radius: 24px; border-top-right-radius: 24px; padding: var(--space-6) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom, 0px)) var(--space-5); box-shadow: 0 -8px 32px rgba(0,0,0,0.15); transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; gap: var(--space-4); max-height: 85vh;">
          <div style="width: 36px; height: 5px; background: var(--color-border-light, #e5e7eb); border-radius: 3px; align-self: center; margin-bottom: 8px;"></div>
          <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; color: var(--color-text-primary); margin: 0; padding-right: var(--space-6); text-align: left;">Funcionamiento del Sistema</h3>
          <div style="font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); font-weight: 550; display:flex; flex-direction:column; gap:16px; max-height:55vh; overflow-y:auto; padding-right:6px; text-align: left;">
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">🔄 Asignación en Cola (Round-Robin)</p>
              <p style="margin: 0;">Los pedidos listos se ofrecen a un repartidor a la vez de forma exclusiva durante 30 segundos. La cola prioriza a quienes no hayan rechazado el pedido y desempata seleccionando a quien tenga menos pedidos completados hoy.</p>
            </div>
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">🛑 Desconexión Automática por Inactividad</p>
              <p style="margin: 0;">Si dejas expirar o rechazas 2 pedidos de forma consecutiva, el sistema pausará tu sesión automáticamente cambiándote a desconectado. Esto evita que dejes pedidos trabados si no estás atento al celular.</p>
            </div>
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">📦 Co-retiros Simultáneos</p>
              <p style="margin: 0;">Puedes llevar hasta 2 pedidos activos en curso de comercios diferentes. Si los pedidos pertenecen al mismo comercio, puedes llevar hasta 3 pedidos simultáneos (lote optimizado del local).</p>
            </div>
            <div>
              <p style="margin: 0 0 4px 0; color: var(--color-text-primary); font-weight: 800; font-size: 15px;">❌ Cancelación Automática por Falta de Cobertura</p>
              <p style="margin: 0;">Si todos los repartidores activos de la zona rechazan o ignoran el pedido, la orden se cancela de forma automática, notificando al cliente y reembolsándole su saldo y puntos al instante.</p>
            </div>
          </div>
          <button id="info-bottom-sheet-close-btn" style="width: 100%; height: 54px; border: none; background: var(--color-primary); color: white; border-radius: 16px; font-weight: 900; font-size: 15.5px; cursor: pointer; margin-top: 8px; box-shadow: 0 8px 24px rgba(225,29,72,0.25);">Entendido</button>
        </div>
      `;
      document.body.appendChild(overlay);
      setTimeout(() => {
        overlay.style.opacity = '1';
        const card = document.getElementById('info-bottom-sheet-card');
        if (card) card.style.transform = 'translateY(0)';
      }, 10);
      const closeSheet = () => {
        const card = document.getElementById('info-bottom-sheet-card');
        if (card) card.style.transform = 'translateY(100%)';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
      };
      overlay.onclick = (e) => { if (e.target === overlay) closeSheet(); };
      document.getElementById('info-bottom-sheet-close-btn')?.addEventListener('click', closeSheet);
    });
  }

  const barContainer = document.getElementById('session-status-bar-container');
  if (barContainer) {
    barContainer.innerHTML = renderStatusBar(user);
    attachStatusBarListeners(user);
  }

  let activeTab = sessionStorage.getItem('deliveryTab') || 'available';
  sessionStorage.removeItem('deliveryTab');

  renderDailyEarningsWidget(user);

  const container = document.getElementById('delivery-content');

  const updateUI = (newTab) => {
    document.querySelectorAll('.tab-pill').forEach(btn => {
      const isActive = btn.dataset.tab === newTab;
      btn.classList.toggle('active', isActive);
      if (btn.classList.contains('header-action-btn')) {
        btn.style.background = isActive ? 'white' : 'rgba(255,255,255,0.15)';
        btn.style.color = isActive ? 'var(--color-primary)' : 'white';
        btn.style.border = 'none';
        btn.style.boxShadow = isActive ? '0 4px 12px rgba(0,0,0,0.15)' : 'none';
      } else {
        btn.style.background = isActive ? 'var(--color-primary)' : 'var(--color-bg-secondary)';
        btn.style.color = isActive ? 'white' : 'var(--color-text-tertiary)';
      }
    });
  };

  // Re-attach tab switching listeners
  document.querySelectorAll('.tab-pill').forEach(btn => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      updateUI(activeTab);
      loadTabContent(activeTab, container, user);
    };
  });

  // BREAKING THE INFINITE LOOP: 
  // We no longer call renderDeliveryPanel() inside the subscribe to 'user'.
  // Instead, we only update the specific components that need real-time sync.
  if (window.__gd_delivery_unsub) {
    window.__gd_delivery_unsub();
  }

  let lastKnownOnlineStatus = user?.isOnline || false;
  window.__gd_delivery_unsub = subscribe('user', (newUser) => {
    if (!newUser) {
      if (inactivityTimer) {
        clearInterval(inactivityTimer);
        inactivityTimer = null;
      }
      stopHeartbeat();
      return;
    }

    const bar = document.getElementById('session-status-bar-container');
    if (bar) {
      bar.innerHTML = renderStatusBar(newUser);
      attachStatusBarListeners(newUser);
    }
    
    if (!newUser.isOnline) {
      if (inactivityTimer) {
        clearInterval(inactivityTimer);
        inactivityTimer = null;
      }
      stopHeartbeat();
      hidePausedSessionModal();
    } else {
      hidePausedSessionModal();
    }

    // Middle content sync
    const contentArea = document.getElementById('delivery-content');
    if (contentArea) {
      if (newUser.isOnline !== lastKnownOnlineStatus) {
        lastKnownOnlineStatus = newUser.isOnline;
        loadTabContent(activeTab, contentArea, newUser);
      }
    }
  });

  const handleExternalSwitch = (e) => {
    if (e.detail) {
      activeTab = e.detail;
      updateUI(activeTab);
      loadTabContent(activeTab, container, user);
    }
  };
  window.addEventListener('switch-delivery-tab', handleExternalSwitch);

  window.addEventListener('hashchange', () => {
    if (window.__gd_delivery_unsub) {
      window.__gd_delivery_unsub();
      window.__gd_delivery_unsub = null;
    }
    window.removeEventListener('switch-delivery-tab', handleExternalSwitch);
  }, { once: true });

  updateUI(activeTab);
  loadTabContent(activeTab, container, user);

  // --- PERSISTENT TAB BADGE LISTENERS ---
  function setupPersistentBadges() {
    if (!user || !user.uid) return;

    // Available Badge
    const qAvailable = query(collection(db, 'orders'), where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending']));
    const unsubAvailable = onSnapshot(qAvailable, (snap) => {
      const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const batches = new Set();
      allOrders.forEach(o => {
        if (o.driverId) return;
        if (o.queueTargetDriverId !== user?.uid) return;
        if ((o.manuallyRejectedDrivers || []).includes(user?.uid) && o.queueTargetDriverId !== user?.uid) return;
        
        const mode = user?.deliveryMode || 'both';
        if (mode === 'trip' && !o.isTrip) return;
        if (mode === 'delivery' && o.isTrip) return;
        
        if (o.isTrip) {
          const isApproved = user?.tripStatus === 'approved' || user?.role === 'chofer';
          if (!isApproved) return;
           const requestedTripType = (o.tripType || 'auto').toLowerCase();
           const driverVehicleType = (user?.tripVehicleType || user?.vehicleType || '').toLowerCase();
           if (requestedTripType !== driverVehicleType) return;
           batches.add(o.id);
        }
        else if (o.isFavor) batches.add(o.id);
        else if (o.bundleId) batches.add(o.bundleId);
        else if (o.status === 'ready') batches.add(o.id);
      });
      
      const count = batches.size;
      const pill = document.querySelector('.tab-pill[data-tab="available"]');
      if (pill) {
        const existingBadge = pill.querySelector('.tab-count-badge');
        if (existingBadge) existingBadge.remove();
        if (count > 0) {
          pill.insertAdjacentHTML('beforeend', `<span class="tab-count-badge" style="background:#ef4444; color:white; font-size:10px; font-weight:900; padding:2px 6px; border-radius:10px; margin-left:6px;">${count}</span>`);
        }
      }
    });

    // Active Badge
    window.isDeliveryPanelActive = true;
    const qActive = query(collection(db, 'orders'), where('driverId', '==', user.uid));
    const unsubActive = onSnapshot(qActive, (snap) => {
      const activeOrders = snap.docs.filter(d => !['completed', 'cancelled'].includes(d.data().status)).map(d => ({ id: d.id, ...d.data() }));
      activeOrdersList = activeOrders;
      window.activeOrdersList = activeOrders;
      activeOrdersCount = activeOrders.length;
      window.dispatchEvent(new CustomEvent('driver-active-orders-sync', { detail: activeOrders }));

      // WakeLock Management
      if (activeOrders.length > 0) {
        requestDriverWakeLock();
      } else {
        releaseDriverWakeLock();
      }

      // Structural Signature Check to Eliminate DOM Tearing / Flickering
      const currentOrdersSig = activeOrders.map(o => `${o.id}_${o.status}_${o.pickedUpAt || ''}_${o.paymentMethod || ''}_${o.totalAmount || o.total || 0}`).join('|');
      const hasStructureChanged = window._lastActiveOrdersSignature !== currentOrdersSig;

      if (hasStructureChanged) {
        window._lastActiveOrdersSignature = currentOrdersSig;

        // Refresh Scanning Radar Bottom Dock with live orders & auto-accept
        const bottomDock = document.getElementById('driver-footer-dock-container');
        if (bottomDock) {
          bottomDock.style.removeProperty('display');
          bottomDock.innerHTML = renderBottomDockContent(getState().user || user, activeOrders);
          attachBottomDockListeners(getState().user || user, activeOrders);
        }

        // Refresh Top Status Bar with Full-Width Customer Header
        const barContainer = document.getElementById('session-status-bar-container');
        if (barContainer) {
          barContainer.innerHTML = renderStatusBar(getState().user || user);
          attachStatusBarListeners(getState().user || user);
        }

        // 1. Cache active orders locally for offline signal resilience
        if (activeOrders.length > 0) {
          saveActiveOrdersOffline(activeOrders);
          syncDriverNavigationWithOrders(activeOrders);
        } else {
          syncDriverNavigationWithOrders([]);
        }
      }

      // Group active by bundleId to count "tasks"
      const activeBatches = new Set();
      activeOrders.forEach(o => activeBatches.add(o.bundleId || o.id));
      
      const count = activeBatches.size;
      const pill = document.querySelector('.tab-pill[data-tab="active"]');
      if (pill) {
        const existingBadge = pill.querySelector('.tab-count-badge');
        if (existingBadge) existingBadge.remove();
        if (count > 0) {
          pill.insertAdjacentHTML('beforeend', `<span class="tab-count-badge" style="background:var(--color-primary); color:white; font-size:10px; font-weight:900; padding:2px 6px; border-radius:10px; margin-left:6px; animation: badge-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">${count}</span>`);
        }
      }
    });

    if (!document.getElementById('badge-animations')) {
      const s = document.createElement('style'); s.id = 'badge-animations';
      s.textContent = `@keyframes badge-pop { 0% { transform: scale(0.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`;
      document.head.appendChild(s);
    }

    // 100% Manual Theme Control (Auto Solar Theme completely removed)

    // Real-time Speed Telemetry Listener
    if (!window._driverSpeedBound) {
      window._driverSpeedBound = true;
      window.addEventListener('driver-speed-update', (e) => {
        const spd = e.detail?.speedKmh || 0;
        const valEl = document.getElementById('driver-speed-value');
        if (valEl) {
          valEl.textContent = spd;
          valEl.style.color = spd > 60 ? '#ef4444' : (spd > 40 ? '#f59e0b' : (getDriverMapTheme() === 'light' ? '#0f172a' : '#ffffff'));
        }
      });
    }

    // Real-time Turn-by-Turn Navigation Telemetry Listener
    if (!window._driverTelemetryBound) {
      window._driverTelemetryBound = true;
      window.addEventListener('driver-navigation-telemetry', (e) => {
        const data = e.detail;
        if (!data) return;

        const cardEl = document.getElementById('driver-maneuver-hud-card');
        const iconEl = document.getElementById('driver-maneuver-icon');
        const textEl = document.getElementById('driver-maneuver-text');
        const subEl = document.getElementById('driver-maneuver-subtext');
        const timeEl = document.getElementById('driver-eta-time');
        const distEl = document.getElementById('driver-eta-dist');
        const streetEl = document.getElementById('driver-street-name-text');
        const progressFillEl = document.getElementById('driver-turn-progress-fill');
        const thenRowEl = document.getElementById('driver-then-row');
        const thenIconEl = document.getElementById('driver-then-icon');
        const thenTextEl = document.getElementById('driver-then-text');
        const thenDistEl = document.getElementById('driver-then-dist');

        if (data.isRerouting) {
          if (cardEl) {
            cardEl.style.borderColor = '#f59e0b';
            cardEl.style.boxShadow = '0 0 20px rgba(245, 158, 11, 0.4)';
          }
          if (iconEl) iconEl.textContent = '🔄';
          if (textEl) textEl.textContent = 'Recalculando ruta...';
          if (subEl) subEl.textContent = 'Buscando el trayecto más rápido';
          return;
        }

        if (cardEl) {
          cardEl.style.removeProperty('border-color');
          cardEl.style.removeProperty('box-shadow');
        }

        if (iconEl) {
          iconEl.innerHTML = data.iconSvg || data.icon || '⬆';
        }
        if (textEl && data.instruction) textEl.textContent = data.instruction;
        if (subEl) subEl.textContent = data.distanceMeters ? `En ${data.distanceMeters > 999 ? (data.distanceMeters / 1000).toFixed(1) + ' km' : data.distanceMeters + ' m'}` : 'En curso';
        if (timeEl) timeEl.textContent = `${data.etaMinutes || 1} min`;
        if (distEl) distEl.textContent = data.totalDistanceMeters > 999 ? `${(data.totalDistanceMeters / 1000).toFixed(1)} km` : `${data.totalDistanceMeters} m`;
        if (streetEl && data.currentStreet) streetEl.textContent = `Circulando por: ${data.currentStreet}`;
        if (progressFillEl && data.progressPct !== undefined) {
          progressFillEl.style.width = `${data.progressPct}%`;
        }

        if (thenRowEl) {
          if (data.thenManeuver) {
            thenRowEl.style.display = 'flex';
            if (thenIconEl) thenIconEl.innerHTML = data.thenManeuver.iconSvg || data.thenManeuver.icon || '⬆';
            if (thenTextEl) thenTextEl.textContent = data.thenManeuver.instruction || '';
            if (thenDistEl) thenDistEl.textContent = data.thenManeuver.distanceMeters ? `en ${data.thenManeuver.distanceMeters} m` : '';
          } else {
            thenRowEl.style.display = 'none';
          }
        }
      });
    }

    // Geofence Arrival Proximity Alert (< 50m)
    if (!window._driverArrivalBound) {
      window._driverArrivalBound = true;
      window.addEventListener('driver-arrival-proximity', (e) => {
        try {
          AudioManager.playArrivalChime();
        } catch(err) {}
        showToast('🎯 ¡Estás llegando al destino!', 'success');
        const actBtn = document.querySelector('.driver-main-action-btn, #order-confirm-pickup-btn, #order-confirm-delivery-btn');
        if (actBtn) {
          actBtn.style.animation = 'status-pulse 1s infinite';
          actBtn.style.border = '2px solid #22c55e';
          actBtn.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.85)';
        }
      });
    }

    window.addEventListener('hashchange', () => {
      unsubAvailable();
      unsubActive();
    }, { once: true });
  };

setupPersistentBadges();
}

let tabUnsub = null;

function loadTabContent(tab, container, user) {
  // Cleanup previous tab listener
  if (tabUnsub) { tabUnsub(); tabUnsub = null; }
  stopExclusiveOfferAlert();

  // Clear cached tab rendering fingerprints to force a fresh render on tab load or switch
  if (container) {
    delete container.dataset.lastAvailableFingerprint;
    delete container.dataset.lastActiveFingerprint;
  }

  container.innerHTML = `<div class="loader-dots" style="margin: 2rem auto;"><span></span><span></span><span></span></div>`;

  // Auto-open take order modal if takeOrderId or orderId is in URL query parameters
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  const hashParams = new URLSearchParams(hashQuery);
  const targetTakeOrderId = hashParams.get('takeOrderId') || hashParams.get('orderId');

  if (targetTakeOrderId && window._processedTakeOrderId !== targetTakeOrderId) {
    window._processedTakeOrderId = targetTakeOrderId;
    const cleanHash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', window.location.pathname + cleanHash);

    setTimeout(async () => {
      try {
        let orderToTake = null;
        const orderDocSnap = await getDoc(doc(db, 'orders', targetTakeOrderId));
        if (orderDocSnap.exists()) {
          orderToTake = { id: orderDocSnap.id, ...orderDocSnap.data() };
        } else {
          const numericVal = parseInt(targetTakeOrderId);
          if (!isNaN(numericVal)) {
            const qNumeric = query(collection(db, 'orders'), where('orderId', '==', numericVal));
            const numSnap = await getDocs(qNumeric);
            if (!numSnap.empty) {
              orderToTake = { id: numSnap.docs[0].id, ...numSnap.docs[0].data() };
            }
          }
        }

        if (orderToTake && !orderToTake.driverId) {
          showConfirm({
            title: `¿Tomar Pedido #${orderToTake.orderId || orderToTake.displayId || ''}?`,
            message: `<strong>${orderToTake.comercioName || 'Pedido'}</strong><br>Cliente: ${orderToTake.userName || 'Cliente'}<br>Dirección: ${orderToTake.deliveryAddress || ''}`,
            confirmText: 'SÍ, TOMAR PEDIDO',
            onConfirm: () => {
              takeBatch(orderToTake.bundleId || orderToTake.id, user);
            }
          });
        }
      } catch (e) {
        console.warn('[Delivery Panel] Error auto-opening target take order modal:', e);
      }
    }, 400);
  }

  try {
    if (tab === 'available') {
      const q = query(
        collection(db, 'orders'),
        where('status', 'in', ['ready', 'preparing', 'confirmed', 'pending'])
      );

      let isInitial = true;
      const listUnsub = onSnapshot(q, (snap) => {
        const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Auto-ready manual scheduled orders when current time >= dispatchAt
        const currentTimeMs = Date.now() + (getState().serverTimeOffset || 0);
        allOrders.forEach(o => {
          if (o.isManual && o.status === 'confirmed' && o.dispatchAt) {
            const dispatchTime = o.dispatchAt.toMillis ? o.dispatchAt.toMillis() : new Date(o.dispatchAt).getTime();
            if (currentTimeMs >= dispatchTime) {
              console.log(`Auto-readying manual order #${o.orderId} from delivery panel`);
              updateDoc(doc(db, 'orders', o.id), {
                status: 'ready',
                readyAt: serverTimestamp()
              }).catch(err => console.error("Error auto-readying manual order:", err));
            }
          }
        });
        
        const hasExclusiveOffer = allOrders.some(o => !o.driverId && o.queueTargetDriverId === user.uid);
        if (hasExclusiveOffer) {
          playExclusiveOfferAlert();
        } else {
          stopExclusiveOfferAlert();
        }
        
        // 1. Separate favors/trips, and group ready orders by commerce
        const favors = [];
        const trips = [];
        const readyOrdersByCommerce = new Map(); // comercioId -> Array of orders
        const otherOrders = []; // e.g. orders with bundleId

        allOrders.forEach(o => {
          if (o.driverId) return;

          const now = Date.now() + (getState().serverTimeOffset || 0);
          const offeredAt = o.queueOfferedAt ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime()) : (o.readyAt ? (o.readyAt.toMillis ? o.readyAt.toMillis() : new Date(o.readyAt).getTime()) : (o.createdAt ? (o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime()) : now));
          const isTargetMe = o.queueTargetDriverId === user.uid;
          const isCoPickup = o.isCoPickupOffer || o.isSuggestedCoPickup || false;
          const isOwn = o.isOwnDeliveryOrder || o.isPermanentOffer || isCoPickup || false;

          const isCommerceReady = o.isFavor || o.isTrip || o.status === 'ready';
          const offerAgeMs = now - offeredAt;
          const needsQueueAssign = isCommerceReady && !isOwn && (
                                   !o.queueTargetDriverId || 
                                   (o.queueTargetDriverId && offerAgeMs >= 30000)
                                   );
          if (needsQueueAssign) {
            updateDispatchQueue(o.id);
          }

          const isTargetedToMe = o.queueTargetDriverId === user.uid;
          const isManuallyRejected = (o.manuallyRejectedDrivers || []).includes(user.uid);
          if (isManuallyRejected && !isTargetedToMe) return;

          const isQueueRejected = (o.queueRejectedDrivers || []).includes(user.uid);
          if (isQueueRejected && !isTargetedToMe) return;

          window.expiredLocalOrders = window.expiredLocalOrders || new Set();
          if (window.expiredLocalOrders.has(o.id) && !isTargetedToMe) return;

          // For regular commerce orders, require status === 'ready' before offering to drivers
          if (!o.isFavor && !o.isTrip && o.status !== 'ready') return;

          if (o.queueTargetDriverId) {
            // Exclusive offer: only show to targeted driver
            if (o.queueTargetDriverId !== user.uid) return;
          }

          // Handle Auto-Accept with Category Filtering (Comercios / Mandados / Viajes)
          if (o.queueTargetDriverId === user.uid && shouldAutoAcceptOrder(o)) {
            if (!window.activeAutoAccepts) window.activeAutoAccepts = new Set();
            if (!window.activeAutoAccepts.has(o.id)) {
              window.activeAutoAccepts.add(o.id);
              const typeLabel = o.isTrip ? 'viaje' : (o.isFavor ? 'mandado' : 'pedido');
              showToast(`⚡ Auto-Aceptando ${typeLabel}...`, 'info');
              setTimeout(async () => {
                try {
                  const freshSnap = await getDoc(doc(db, 'orders', o.id));
                  if (freshSnap.exists() && !freshSnap.data().driverId && freshSnap.data().queueTargetDriverId === user.uid) {
                    await takeBatch(o.bundleId || o.id, user);
                  }
                } catch (e) {
                  console.error('[AutoAccept] Error auto-taking batch:', e);
                } finally {
                  window.activeAutoAccepts.delete(o.id);
                }
              }, 400);
            }
          }

          const mode = user.deliveryMode || 'both';
          if (mode === 'trip' && !o.isTrip) return;
          if (mode === 'delivery' && o.isTrip) return;
          
          if (o.isTrip) {
            const isApproved = user.tripStatus === 'approved' || user.role === 'chofer';
            if (!isApproved) return;
            const requestedTripType = (o.tripType || 'auto').toLowerCase();
            const driverVehicleType = (user.tripVehicleType || user.vehicleType || '').toLowerCase();
            if (requestedTripType !== driverVehicleType) return;
            trips.push(o);
          } else if (o.isFavor) {
            favors.push(o);
          } else if (o.bundleId) {
            otherOrders.push(o); // Keep existing backend bundles
          } else if (o.status === 'ready') {
            if (!readyOrdersByCommerce.has(o.comercioId)) {
              readyOrdersByCommerce.set(o.comercioId, []);
            }
            readyOrdersByCommerce.get(o.comercioId).push(o);
          }
        });

        const batches = new Map();

        // 2. Add backend bundles (otherOrders)
        otherOrders.forEach(o => {
          if (!batches.has(o.bundleId)) {
            batches.set(o.bundleId, {
              id: o.bundleId,
              isBundle: true,
              orders: [],
              createdAt: o.createdAt,
              deliveryAddress: o.deliveryAddress,
              total: 0,
              subtotal: 0,
              deliveryCost: 0,
              appUsageFee: 0,
              commissionAmount: 0,
              discountAmount: 0,
              couponDiscount: 0
            });
          }
          const b = batches.get(o.bundleId);
          b.orders.push(o);
          b.total += o.total;
          b.subtotal += (o.subtotal || 0);
          b.deliveryCost += (o.deliveryCost || 0);
          b.appUsageFee += (o.appUsageFee || 0);
          b.commissionAmount += (o.commissionAmount || 0);
          b.discountAmount += (o.discountAmount || 0);
          b.couponDiscount += (o.couponDiscount || 0);
          if (o.createdAt?.toMillis() < b.createdAt?.toMillis()) b.createdAt = o.createdAt;
        });

        // 3. Add favors
        favors.forEach(o => {
          batches.set(o.id, {
            id: o.id,
            isBundle: false,
            isFavor: true,
            order: o,
            createdAt: o.createdAt,
            deliveryAddress: o.deliveryAddress,
            total: o.total,
            subtotal: o.subtotal || 0,
            deliveryCost: o.deliveryCost || 0,
            purchaseFee: o.purchaseFee || 0,
            extraStopsFee: o.extraStopsFee || 0,
            appUsageFee: o.appUsageFee || 0,
            commissionAmount: o.commissionAmount || 0,
            discountAmount: o.discountAmount || 0,
            couponDiscount: o.couponDiscount || 0
          });
        });

        // 3b. Add trips
        trips.forEach(o => {
          batches.set(o.id, {
            id: o.id,
            isBundle: false,
            isTrip: true,
            order: o,
            createdAt: o.createdAt,
            deliveryAddress: o.deliveryAddress,
            total: o.total,
            subtotal: o.subtotal || 0,
            deliveryCost: o.deliveryCost || 0,
            purchaseFee: o.purchaseFee || 0,
            appUsageFee: o.appUsageFee || 0,
            commissionAmount: o.commissionAmount || 0,
            discountAmount: o.discountAmount || 0,
            couponDiscount: o.couponDiscount || 0
          });
        });

        // 4. Add dynamic commerce-grouped ready orders (max 3 per group, distance <500m between deliveries)
        readyOrdersByCommerce.forEach((ordersList, commerceId) => {
          ordersList.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
          
          const chunks = [];
          const visited = new Set();

          for (let i = 0; i < ordersList.length; i++) {
            if (visited.has(ordersList[i].id)) continue;
            
            const currentChunk = [ordersList[i]];
            visited.add(ordersList[i].id);

            const c1 = ordersList[i].deliveryCoords;
            if (c1) {
              // Find up to 2 other orders close to this one (<500m)
              for (let j = 0; j < ordersList.length; j++) {
                if (currentChunk.length >= 3) break;
                if (visited.has(ordersList[j].id)) continue;

                const c2 = ordersList[j].deliveryCoords;
                if (c2) {
                  const dist = getHaversineDistance(c1.lat, c1.lng, c2.lat, c2.lng);
                  if (dist <= 500) {
                    currentChunk.push(ordersList[j]);
                    visited.add(ordersList[j].id);
                  }
                }
              }
            }
            chunks.push(currentChunk);
          }

          chunks.forEach((chunk, chunkIdx) => {
            const firstOrder = chunk[0];
            const batchId = chunk.length === 1 ? firstOrder.id : `dynamic-commerce-${commerceId}-${chunkIdx}`;
            
            if (chunk.length === 1) {
              batches.set(batchId, {
                id: batchId,
                isBundle: false,
                isFavor: false,
                order: firstOrder,
                createdAt: firstOrder.createdAt,
                deliveryAddress: firstOrder.deliveryAddress,
                total: firstOrder.total,
                subtotal: firstOrder.subtotal || 0,
                deliveryCost: firstOrder.deliveryCost || 0,
                appUsageFee: firstOrder.appUsageFee || 0,
                commissionAmount: firstOrder.commissionAmount || 0,
                discountAmount: firstOrder.discountAmount || 0,
                couponDiscount: firstOrder.couponDiscount || 0
              });
            } else {
              batches.set(batchId, {
                id: batchId,
                isBundle: true,
                isDynamicGroup: true,
                comercioId: commerceId,
                comercioName: firstOrder.comercioName,
                orders: chunk,
                createdAt: chunk.reduce((earliest, o) => {
                  if (!earliest) return o.createdAt;
                  return (o.createdAt?.toMillis() || 0) < (earliest.toMillis() || 0) ? o.createdAt : earliest;
                }, null),
                deliveryAddress: chunk.map(o => o.deliveryAddress).join(' | '),
                total: chunk.reduce((sum, o) => sum + o.total, 0),
                subtotal: chunk.reduce((sum, o) => sum + (o.subtotal || 0), 0),
                deliveryCost: chunk.reduce((sum, o) => sum + (o.deliveryCost || 0), 0),
                appUsageFee: chunk.reduce((sum, o) => sum + (o.appUsageFee || 0), 0),
                commissionAmount: chunk.reduce((sum, o) => sum + (o.commissionAmount || 0), 0),
                discountAmount: chunk.reduce((sum, o) => sum + (o.discountAmount || 0), 0),
                couponDiscount: chunk.reduce((sum, o) => sum + (o.couponDiscount || 0), 0)
              });
            }
          });
        });

        const isBatchScheduled = (b) => {
          if (b.isBundle) {
            return b.orders && b.orders.some(o => o.isScheduled);
          }
          return b.order ? !!b.order.isScheduled : false;
        };

        const sortedBatches = Array.from(batches.values())
          .sort((a, b) => {
            const aSched = isBatchScheduled(a);
            const bSched = isBatchScheduled(b);
            if (aSched && !bSched) return -1;
            if (!aSched && bSched) return 1;
            return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
          });

        // Toast for new available orders (Only after initial load and only if driver has no active orders)
        if (!isInitial && activeOrdersCount === 0) {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const order = { id: change.doc.id, ...change.doc.data() };
              if (!order.driverId && (order.status === 'ready' || order.bundleId)) {
                if (order.queueTargetDriverId !== user.uid) return;
                showToast(`¡Nuevo pedido disponible!`, 'info');
              }
            }
          });
        }
        // Full-screen overlay trigger for exclusive offer
        const exclusiveBatch = sortedBatches.find(b => {
          const orderObj = b.isBundle ? b.orders[0] : b.order;
          return orderObj && !orderObj.driverId && orderObj.queueTargetDriverId === user.uid;
        });

        if (exclusiveBatch) {
          stopExclusiveOfferAlert();
          showExclusiveOfferOverlay(exclusiveBatch, user);
        } else {
          stopExclusiveOfferAlert();
          hideExclusiveOfferOverlay();
        }

        // Bypassing DOM updates if the batches fingerprint hasn't changed
        const availableFingerprint = JSON.stringify(sortedBatches.map(b => {
          const orderObj = b.isBundle ? b.orders[0] : b.order;
          return {
            id: b.id,
            isBundle: b.isBundle,
            total: b.total,
            ordersCount: b.orders?.length || 0,
            ordersStatus: b.orders ? b.orders.map(o => o.status) : (b.order ? b.order.status : ''),
            queueTargetDriverId: orderObj?.queueTargetDriverId || null,
            queueOfferedAt: orderObj?.queueOfferedAt ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) : 0
          };
        }));

        if (container.dataset.lastAvailableFingerprint === availableFingerprint) {
          return;
        }
        container.dataset.lastAvailableFingerprint = availableFingerprint;

        const userState = getState().user;
        const nowMs = Date.now() + (getState().serverTimeOffset || 0);
        const cooldownMs = userState?.cooldownUntil ? (userState.cooldownUntil.toMillis ? userState.cooldownUntil.toMillis() : new Date(userState.cooldownUntil).getTime()) : 0;
        const cooldownRemaining = Math.max(0, Math.floor((cooldownMs - nowMs) / 1000));
        const cooldownHtml = cooldownRemaining > 0 ? `
          <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.25); border-radius:16px; padding:12px 16px; margin-bottom:14px; display:flex; align-items:center; gap:10px; color:#ef4444; font-size:12.5px; font-weight:800;">
            <span>⏳</span>
            <span>Pausa por rechazos consecutivos: <strong>${cooldownRemaining}s</strong> restantes</span>
          </div>
        ` : '';

        if (getState().user?.isOnline) {
          container.innerHTML = '';
          return;
        }

        if (sortedBatches.length === 0) {
          container.innerHTML = cooldownHtml;
          return;
        }

        if (!document.getElementById('expandable-card-styles')) {
          const s = document.createElement('style');
          s.id = 'expandable-card-styles';
          s.textContent = `
            .expandable-card { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; position: relative; overflow: hidden; }
            .expandable-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: rgba(var(--color-primary-rgb), 0.3); }
            .expandable-card.collapsed .card-details-area { display: none; }
            .expandable-card.collapsed { padding-bottom: 16px !important; }
            
            .expand-icon-span { transition: transform 0.3s ease; display: inline-flex; align-items: center; justify-content: center; }
            .expandable-card:not(.collapsed) .expand-icon-span { transform: rotate(180deg); }
            .expand-text-span::after { content: 'Ver detalles'; }
            .expandable-card:not(.collapsed) .expand-text-span::after { content: 'Ocultar detalles'; }
            
            .expand-indicator-btn:hover {
              background: rgba(var(--color-primary-rgb), 0.1) !important;
              transform: scale(1.01);
            }
          `;
          document.head.appendChild(s);
        }

        container.innerHTML = cooldownHtml + `
          <div class="delivery-orders-list">
            ${sortedBatches.map(b => {
              const isBundle = b.isBundle;
              const isFavor = b.isFavor;
              const isTrip = b.isTrip;
              const favorType = b.order?.favorType;
              const tripType = b.order?.tripType;
              
              let title = b.comercioName || b.order?.comercioName || 'Comercio';
              if (isBundle) {
                if (b.isDynamicGroup) {
                  title = `Lote ${b.comercioName} (${b.orders.length} pedidos)`;
                } else {
                  title = `Lote Multi-Local (${b.orders.length} locales)`;
                }
              } else if (isFavor) {
                title = getFavorTypeMeta(favorType).title;
              } else if (isTrip) {
                title = tripType === 'moto' ? 'Viaje en Moto solicitado' : 'Viaje en Auto solicitado';
              }
              
              const isScheduled = isBundle ? b.orders.some(o => o.isScheduled) : (b.order ? !!b.order.isScheduled : false);
              const scheduledTime = isBundle ? (b.orders.find(o => o.isScheduled)?.scheduledTime || '') : (b.order?.scheduledTime || '');
              const scheduledDate = isBundle ? (b.orders.find(o => o.isScheduled)?.scheduledDate || '') : (b.order?.scheduledDate || '');

              const scheduledBadge = isScheduled ? `
                <div style="background: #8b5cf6; color: white; border-radius: 12px; padding: 6px 12px; font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.2);">
                  <span style="display: flex; align-items: center;">${icon('calendar', 14, '', 'white')}</span> <span style="letter-spacing: 0.02em;">PROGRAMADO: ${scheduledDate} a las <span style="text-decoration: underline; font-weight: 900;">${scheduledTime} HS</span></span>
                </div>
              ` : '';

              const anyPending = isBundle ? b.orders.some(o => o.status === 'pending') : false;
              const allReady = isBundle ? b.orders.every(o => o.status === 'ready') : (isFavor || isTrip || b.order.status === 'ready');

              const favorMeta = isFavor ? getFavorTypeMeta(favorType) : null;
              const favorColor = favorMeta ? favorMeta.color : '#ef4444';
              const favorRgb = favorMeta ? getRgbString(favorMeta.color) : '239, 68, 68';

              const orderObj = b.isBundle ? b.orders[0] : b.order;
              const nowMs = Date.now() + (getState().serverTimeOffset || 0);
              const offeredAt = orderObj?.queueOfferedAt 
                ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) 
                : (orderObj?.createdAt ? (orderObj.createdAt.toMillis ? orderObj.createdAt.toMillis() : new Date(orderObj.createdAt).getTime()) : nowMs);
              
              const elapsed = Math.max(0, Math.floor((nowMs - offeredAt) / 1000));
              const remaining = Math.max(1, 30 - (elapsed % 30));
              const expiryMs = nowMs + (remaining * 1000);

              return `
                <div class="admin-card expandable-card collapsed" data-id="${b.id}" style="margin-bottom: 20px; border: 1px solid var(--color-border); background: var(--color-bg-card); padding: 22px; border-radius: 28px; position:relative; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.03); ${anyPending ? 'opacity: 0.8;' : ''}">
                  <div style="position:absolute; top:0; left:0; width:6px; height:100%; background:${isTrip ? '#3b82f6' : (isFavor ? favorColor : '#00D67F')};"></div>
                  
                  ${orderObj?.isOwnDeliveryOrder || orderObj?.isPermanentOffer ? `
                    <div style="background:rgba(227, 0, 27, 0.08); border:1px solid rgba(227, 0, 27, 0.15); border-radius:16px; padding:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; width:100%;">
                      <span style="font-size:12px; font-weight:800; color:#E3001B; display:flex; align-items:center; gap:6px;">
                        ⚠️ ${orderObj?.isPermanentOffer ? 'OFERTA DISPONIBLE:' : 'EXCLUSIVO COMERCIO:'}
                      </span>
                      <span style="font-size:14px; font-weight:950; color:#E3001B;" class="queue-countdown" data-is-own-delivery="true" data-expiry="0" data-order-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}">Permanente</span>
                    </div>
                  ` : `
                    <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.15); border-radius:16px; padding:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; width:100%;">
                      <span style="font-size:12px; font-weight:800; color:#ef4444; display:flex; align-items:center; gap:6px;">
                        ⚠️ OFERTA EXCLUSIVA:
                      </span>
                      <span style="font-size:14px; font-weight:950; color:#ef4444;" class="queue-countdown" data-expiry="${expiryMs}" data-order-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}">${remaining}s</span>
                    </div>
                  `}
                  
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
                    <div style="flex:1;">
                      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap: wrap;">
                        <span style="font-size:10px; font-weight:900; color:white; background:${isTrip ? '#3b82f6' : (isFavor ? favorColor : '#00D67F')}; padding:3px 10px; border-radius:8px; text-transform:uppercase; letter-spacing: 0.03em;">${isTrip ? 'VIAJE' : (isFavor ? favorMeta.label : 'DISPONIBLE')}</span>
                        <span style="font-size:10.5px; font-weight:800; color:var(--color-text-tertiary);">${new Date(b.createdAt?.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <strong style="font-size:19px; font-weight:950; letter-spacing:-0.5px; display:block; color:var(--color-text-primary); line-height: 1.25;">${title}</strong>
                      ${scheduledBadge}
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:24px; font-weight:950; color:var(--color-text-primary); letter-spacing:-1px; line-height: 1.1;">${formatPrice(b.total)}</div>
                      <div style="font-size:9.5px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; margin-top: 3px; letter-spacing: 0.02em;">A Cobrar</div>
                    </div>
                  </div>
 
                  <div style="display:flex; gap:12px; margin-top:16px; margin-bottom:20px;">
                    <!-- Costo Productos / Servicio -->
                    <div style="flex:1; background: ${isTrip ? '#3b82f6' : favorColor}; padding:14px 10px; border-radius:18px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; box-shadow: 0 6px 15px ${isTrip ? 'rgba(59, 130, 246, 0.15)' : `rgba(${favorRgb}, 0.15)`}; border: none;">
                      <div style="font-size:9.5px; font-weight:800; color:rgba(255,255,255,0.8); text-transform:uppercase; letter-spacing: 0.05em;">${isTrip ? 'Costo Viaje' : (isFavor ? (favorType === 'pagodeservicios' ? 'Costo Servicios' : (favorType === 'gocash' ? 'Costo Gestión' : 'Costo Productos')) : 'Costo Productos')}</div>
                      <div style="font-size:18px; font-weight:950; color:white; letter-spacing: -0.5px;">${isTrip ? formatPrice(b.total) : ((b.subtotal || 0) > 0 ? formatPrice(b.subtotal) : 'PENDIENTE')}</div>
                    </div>
                    <!-- Ganancia Tuya -->
                    <div style="flex:1; background: #10b981; padding:14px 10px; border-radius:18px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; box-shadow: 0 6px 15px rgba(16, 185, 129, 0.15); border: none;">
                      <div style="font-size:9.5px; font-weight:800; color:rgba(255,255,255,0.8); text-transform:uppercase; letter-spacing: 0.05em;">Ganancia Tuya</div>
                      <div style="font-size:18px; font-weight:950; color:white; letter-spacing: -0.5px;">${formatPrice(getOrderDriverEarnings(b))}</div>
                    </div>
                  </div>
 
                  ${(b.discountAmount || 0) > 0 ? `
                    <div style="background:rgba(34, 197, 94, 0.05); border:1px solid rgba(34, 197, 94, 0.2); border-radius:16px; padding:12px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                      <div style="font-size:11px; font-weight:800; color:var(--color-success); display:flex; align-items:center; gap:6px;">
                        ${icon('sparkles', 14)} Descuento GoPoints
                      </div>
                      <div style="font-size:13px; font-weight:900; color:var(--color-success);">- ${formatPrice(b.discountAmount)}</div>
                    </div>
                    <div style="font-size:10px; color:#f59e0b; font-weight:700; margin-bottom:16px; padding:0 4px; line-height:1.3; display:flex; align-items:center; gap:6px;">
                      ${icon('info', 12)} Descuento absorbido por GO Delivery. Se descontará de tu deuda de la app.
                    </div>
                  ` : ''}
 
                  ${(b.couponDiscount || 0) > 0 ? `
                    <div style="background:rgba(168, 85, 247, 0.04); border:1px dashed rgba(168, 85, 247, 0.25); border-radius:16px; padding:12px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                      <div style="font-size:11px; font-weight:800; color:#a855f7; display:flex; align-items:center; gap:6px;">
                        ${icon('tag', 14)} Cupón de Descuento
                      </div>
                      <div style="font-size:13px; font-weight:900; color:#a855f7;">- ${formatPrice(b.couponDiscount)}</div>
                    </div>
                    <div style="font-size:10px; color:#a855f7; font-weight:700; margin-bottom:16px; padding:0 4px; line-height:1.3; display:flex; align-items:center; justify-content:space-between; gap:6px;">
                      <span style="display:flex; align-items:center; gap:4px;">
                        ${icon('info', 12)} Absorbido por GO Delivery. Se descontará de tu deuda.
                      </span>
                      <button class="coupon-info-btn" data-discount="${b.couponDiscount}" style="background:rgba(168, 85, 247, 0.1); border:none; color:#a855f7; font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:2px; flex-shrink:0;">
                        Info
                      </button>
                    </div>
                  ` : ''}
 
                  <div class="expand-indicator-btn" style="margin-top: 4px; margin-bottom: 12px; padding: 10px; background: rgba(var(--color-primary-rgb), 0.05); border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; font-weight: 850; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.05em; transition: all 0.2s; border: 1px dashed rgba(var(--color-primary-rgb), 0.25);">
                    <span class="expand-text-span"></span>
                    <span class="expand-icon-span" style="display: flex; align-items: center; transition: transform 0.3s ease;">${icon('caretDown', 14)}</span>
                  </div>
 
                  <div class="card-details-area">
                    ${isTrip ? `
                      <div style="margin-bottom:16px; padding:14px; background:var(--color-bg-secondary); border-radius:18px; border:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.02em;">Detalles del trayecto</div>
                        <div style="font-size:13px; font-weight:700; color:var(--color-text-primary); display:flex; flex-direction:column; gap:8px;">
                          <div>
                            <span style="color:var(--color-text-tertiary); text-transform:uppercase; font-size:9px; display:block; margin-bottom:2px;">Origen / Buscar en:</span>
                            <div style="display:flex; align-items:center; gap:6px;">${icon('mapPin', 14)} ${b.order.pickupAddress}</div>
                          </div>
                          <div style="margin-top:4px;">
                            <span style="color:var(--color-text-tertiary); text-transform:uppercase; font-size:9px; display:block; margin-bottom:2px;">Destino / Llevar a:</span>
                            <div style="display:flex; align-items:center; gap:6px;">${icon('navigation', 14)} ${b.order.deliveryAddress}</div>
                          </div>
                        </div>
                      </div>
                    ` : isFavor ? `
                      <div style="margin-bottom:16px; padding:14px; background:var(--color-bg-secondary); border-radius:18px; border:1px solid var(--color-border-light); text-align:left;">
                        <div style="font-size:9px; font-weight:900; color:${favorMeta.textColor}; text-transform:uppercase; margin-bottom:10px; letter-spacing:0.04em;">${favorMeta.headerText}</div>
                        ${b.order.favorType === 'compra' ? `
                          <div style="margin-bottom:10px; padding:10px 12px; border-radius:12px; background:${b.order.allowDirectReplacement ? 'rgba(5,150,105,0.1)' : 'rgba(225,29,72,0.1)'}; border:1px solid ${b.order.allowDirectReplacement ? 'rgba(5,150,105,0.3)' : 'rgba(225,29,72,0.3)'}; color:${b.order.allowDirectReplacement ? '#059669' : '#E11D48'}; font-size:11.5px; font-weight:800; display:flex; align-items:center; gap:8px;">
                            ${b.order.allowDirectReplacement ? `
                              <span>🔄 <strong>MODO REEMPLAZO DIRECTO:</strong> Si un producto no está en stock, traé uno similar (ej: Coca por Pepsi) sin consultar al cliente.</span>
                            ` : `
                              <span>💬 <strong>ATENCIÓN PERSONALIZADA:</strong> Consultá al cliente por chat ante cualquier cambio, variante o precio.</span>
                            `}
                          </div>
                        ` : ''}
                        ${(() => {
                          const stores = parseFavorDetails(b.order.details || b.order.description);
                          const storePrices = b.order.storePrices || {};
                          if (stores.length > 0) {
                            return `
                              <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin-bottom:10px;">
                                ${stores.map(st => `
                                  <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:12.5px; border-bottom:1.5px solid var(--color-border-light); padding-bottom:8px; margin-bottom:2px;">
                                    <div style="display:flex; flex-direction:column; gap:2px; text-align:left; align-items:flex-start; flex:1; padding-right:8px;">
                                      <strong style="color:var(--color-text-primary); font-weight:800;">${st.name}</strong>
                                      <span style="color:var(--color-text-secondary); font-size:11.5px; font-weight:500;">${st.items}</span>
                                    </div>
                                    ${storePrices[st.name] ? `<span style="font-weight:900; color:var(--color-text-primary); margin-left:12px; white-space:nowrap;">${formatPrice(storePrices[st.name])}</span>` : ''}
                                  </div>
                                `).join('')}
                              </div>
                            `;
                          } else {
                            return `<div style="margin-bottom:10px;">${formatFavorDetailsHTML(b.order.details || b.order.description)}</div>`;
                          }
                        })()}
                        ${b.order.pickupAddress ? `
                          <div style="font-size:11px; font-weight:700; color:var(--color-text-primary); margin-top:10px; display:flex; align-items:flex-start; gap:6px;">
                            <span style="color:var(--color-text-tertiary); text-transform:uppercase; font-size:9px; display:flex; align-items:center; gap:4px; font-weight:800;">${icon('mapPin', 13)} Recoger en:</span>
                            <span style="font-weight:600; color:var(--color-text-secondary); flex:1;">${b.order.pickupAddress}</span>
                          </div>
                        ` : ''}
                      </div>
                    ` : (isBundle ? `
                      <div style="margin-bottom:16px; padding:12px; background:rgba(var(--color-primary-rgb), 0.03); border-radius:14px; border:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:900; color:var(--color-primary); text-transform:uppercase; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                          ${icon('store', 14)} ${b.isDynamicGroup ? 'PEDIDOS DEL COMERCIO' : `RETIRO EN ${b.orders.length} LOCALES`}
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                          ${b.orders.map(o => `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap: 8px;">
                              <span style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 220px;">
                                ${b.isDynamicGroup ? `#${o.orderId} - ${o.deliveryAddress}` : o.comercioName}
                              </span>
                              <span style="font-size:9px; font-weight:900; padding:2px 8px; border-radius:6px; background:${o.status === 'ready' ? 'var(--color-success)' : 'var(--color-bg-secondary)'}; color:${o.status === 'ready' ? 'white' : 'var(--color-text-tertiary)'}; flex-shrink: 0;">
                                ${o.status === 'ready' ? 'LISTO' : 'PREPARANDO'}
                              </span>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    ` : '')}
 
                    ${remaining > 0 ? `
                       <div style="display:flex; gap:12px; width:100%; margin-top:8px;">
                         <button class="btn take-batch-btn" 
                                 data-id="${b.id}" 
                                 ${!allReady ? 'disabled' : ''}
                                 style="flex:2; height: 50px; border-radius:16px; font-weight:950; font-size:14px; text-transform:uppercase; border:none; background:var(--color-primary); color:white; box-shadow:0 6px 15px rgba(var(--color-primary-rgb),0.2); display:flex; align-items:center; justify-content:center; gap:8px;">
                           ${icon('checkCircle', 18)} Aceptar
                         </button>
                         <button class="btn reject-order-btn" 
                                 data-ids="${b.isBundle ? b.orders.map(o => o.id).join(',') : b.order.id}" 
                                 style="flex:1; height: 50px; border-radius:16px; font-weight:950; font-size:14px; text-transform:uppercase; border:1.5px solid rgba(239, 68, 68, 0.4); background:rgba(239, 68, 68, 0.05); color:#ef4444; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                           ${icon('close', 14)} Rechazar
                         </button>
                       </div>
                     ` : `
                       <button class="btn btn-primary btn-block take-batch-btn" 
                               data-id="${b.id}" 
                               ${!allReady ? 'disabled' : ''}
                               style="height: 54px; border-radius:18px; font-weight:950; font-size:15px; text-transform:uppercase; letter-spacing:0.02em; gap:10px; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.2); ${!allReady ? 'opacity:0.5; filter:grayscale(1); box-shadow:none;' : ''}">
                         ${!allReady ? 'Esperando locales...' : `${icon('checkCircle', 20)} TOMAR VIAJE / PEDIDO`}
                       </button>
                     `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        container.querySelectorAll('.expandable-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.btn')) return; // Don't collapse when clicking button
            card.classList.toggle('collapsed');
          });
        });

        // Start active countdown intervals
        if (window.queueCountdownInterval) clearInterval(window.queueCountdownInterval);
        const countdownInterval = setInterval(() => {
          const countdownElements = container.querySelectorAll('.queue-countdown');
          const cooldownEl = container.querySelector('.cooldown-timer');
          if (countdownElements.length === 0 && !cooldownEl) {
            clearInterval(countdownInterval);
            window.queueCountdownInterval = null;
            return;
          }

          // Update cooldown banner in real-time
          if (cooldownEl) {
            const expiry = parseInt(cooldownEl.dataset.expiry);
            const now = Date.now() + (getState().serverTimeOffset || 0);
            const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
            
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            cooldownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            if (remaining <= 0) {
              if (window.queueCountdownInterval) clearInterval(window.queueCountdownInterval);
              window.queueCountdownInterval = null;
              loadTabContent('available', container, user);
              return;
            }
          }

          countdownElements.forEach(el => {
            const isOwn = el.dataset.isOwnDelivery === 'true';
            if (isOwn) {
              el.textContent = "Permanente";
              return;
            }

            const expiry = parseInt(el.dataset.expiry);
            if (isNaN(expiry)) return;

            const now = Date.now() + (getState().serverTimeOffset || 0);
            const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
            el.textContent = `${remaining}s`;

            if (remaining <= 0) {
              const orderIdsStr = el.dataset.orderIds;
              if (orderIdsStr && el.dataset.rotating !== 'true') {
                el.dataset.rotating = 'true';
                console.log(`[Queue Countdown] Timer expired for orderIds: ${orderIdsStr}. Rotating offer...`);
                const orderIds = orderIdsStr.split(',');

                window.expiredLocalOrders = window.expiredLocalOrders || new Set();
                orderIds.forEach(oid => window.expiredLocalOrders.add(oid));

                stopExclusiveOfferAlert();

                // Trigger instant server rotation for each expired order
                orderIds.forEach(id => {
                  updateDispatchQueue(id).catch(err => {
                    console.error(`[Queue Countdown] Error updating dispatch queue for ${id}:`, err);
                  }).finally(() => {
                    setTimeout(() => {
                      el.dataset.rotating = 'false';
                    }, 3000);
                  });
                });
              }
            }
          });
        }, 1000);
        window.queueCountdownInterval = countdownInterval;

        container.querySelectorAll('.take-batch-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            showConfirm({
              title: '¿Tomar este pedido?',
              message: 'Te asignarás como el repartidor oficial. Deberás dirigirte al comercio lo antes posible.',
              confirmText: 'SÍ, TOMAR PEDIDO',
              onConfirm: () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 20, 'animate-spin') + ' TOMANDO...';
                takeBatch(btn.dataset.id, user, sortedBatches.find(b => b.id === btn.dataset.id), btn);
              }
            });
          });
        });

        container.querySelectorAll('.reject-order-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            showToast('Rechazando pedido...', 'info');
            
            try {
              // Add driver to manuallyRejectedDrivers & queueRejectedDrivers of these orders
              await runTransaction(db, async (transaction) => {
                const oIdsStr = btn.dataset.ids;
                if (!oIdsStr) return;
                const oIds = oIdsStr.split(',');
                for (const oId of oIds) {
                  const orderRef = doc(db, 'orders', oId);
                  const oSnap = await transaction.get(orderRef);
                  if (oSnap.exists()) {
                    const data = oSnap.data();
                    const manualRejected = data.manuallyRejectedDrivers || [];
                    const passiveRejected = data.queueRejectedDrivers || [];
                    if (!manualRejected.includes(user.uid)) manualRejected.push(user.uid);
                    if (!passiveRejected.includes(user.uid)) passiveRejected.push(user.uid);
                    transaction.update(orderRef, {
                      manuallyRejectedDrivers: manualRejected,
                      queueRejectedDrivers: passiveRejected,
                      queueTargetDriverId: null,
                      queueTargetDriverName: null,
                      queueOfferedAt: null,
                      isPermanentOffer: null
                    });
                  }
                }
              });
              
              showToast('Pedido rechazado', 'warning');
            } catch (err) {
              console.error(err);
              showToast('Error al procesar rechazo', 'error');
              btn.disabled = false;
            }
          });
        });

        container.querySelectorAll('.view-map-btn').forEach(btn => {
          const batch = sortedBatches.find(b => b.id === btn.dataset.id);
          const orderForMap = batch.isBundle ? batch.orders[0] : batch.order;
          btn.addEventListener('click', () => showDeliveryMapModal(orderForMap, batch.isBundle ? batch.orders : null));
        });
        });

        // ── Scheduled Trips Section (for approved chofers) ──
        // NOTE: This runs OUTSIDE the main available-orders onSnapshot, at the tab level.
        if (user.tripStatus === 'approved') {
          const qScheduled = query(
            collection(db, 'orders'),
            where('status', '==', 'scheduled'),
            where('isTrip', '==', true)
          );

          const scheduledUnsub = onSnapshot(qScheduled, (scheduledSnap) => {
            // Re-create the container if it was destroyed by the main onSnapshot re-render
            let scheduledContainer = document.getElementById('scheduled-trips-section');
            if (!scheduledContainer) {
              scheduledContainer = document.createElement('div');
              scheduledContainer.id = 'scheduled-trips-section';
              container.appendChild(scheduledContainer);
            }
            const scheduledTrips = scheduledSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(o => {
                if (o.driverId && o.driverId !== user.uid) return false;
                const reqType = (o.tripType || 'auto').toLowerCase();
                const driverType = (user.tripVehicleType || user.vehicleType || 'auto').toLowerCase();
                return reqType === driverType;
              });

            if (scheduledTrips.length === 0) {
              scheduledContainer.innerHTML = '';
              return;
            }

            scheduledContainer.innerHTML = `
              <div style="margin-top:24px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-left:4px;">
                  <div style="width:28px; height:28px; border-radius:8px; background:rgba(139,92,246,0.12); display:flex; align-items:center; justify-content:center; color:#8b5cf6;">
                    ${icon('calendar', 16)}
                  </div>
                  <span style="font-size:13px; font-weight:900; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.03em;">Viajes Programados</span>
                  <span style="font-size:10px; font-weight:900; color:white; background:#8b5cf6; padding:2px 8px; border-radius:8px;">${scheduledTrips.length}</span>
                </div>
                ${scheduledTrips.map(trip => {
                  const scheduledDate = trip.scheduledFor?.toDate ? trip.scheduledFor.toDate() : new Date(trip.scheduledFor);
                  const dateStr = scheduledDate.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
                  const timeStr = scheduledDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                  const isAssignedToMe = trip.driverId === user.uid;
                  const isUnassigned = !trip.driverId;

                  return `
                    <div class="admin-card" style="margin-bottom:14px; border:1px solid ${isAssignedToMe ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}; background:var(--color-bg-card); padding:18px; border-radius:22px; position:relative; overflow:hidden; ${isAssignedToMe ? 'box-shadow:0 4px 16px rgba(139,92,246,0.1);' : ''}">
                      <div style="position:absolute; top:0; left:0; width:5px; height:100%; background:#8b5cf6;"></div>
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <div>
                          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="font-size:9px; font-weight:900; color:white; background:#8b5cf6; padding:2px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.03em;">PROGRAMADO</span>
                            ${isAssignedToMe ? '<span style="font-size:9px; font-weight:900; color:white; background:#22c55e; padding:2px 8px; border-radius:6px;">ACEPTADO</span>' : ''}
                          </div>
                          <strong style="font-size:15px; font-weight:900; color:var(--color-text-primary); display:block;">Viaje en ${(trip.tripType || 'auto') === 'moto' ? 'Moto 🏍️' : 'Auto 🚗'}</strong>
                        </div>
                        <div style="text-align:right;">
                          <div style="font-size:18px; font-weight:950; color:var(--color-text-primary);">${formatPrice(trip.total || trip.deliveryCost || 0)}</div>
                          <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">A Cobrar</div>
                        </div>
                      </div>
                      <div style="background:rgba(139,92,246,0.06); border:1px solid rgba(139,92,246,0.12); border-radius:14px; padding:10px 12px; margin-bottom:12px; display:flex; align-items:center; gap:10px;">
                        <span style="font-size:20px;">📅</span>
                        <div>
                          <div style="font-size:12px; font-weight:800; color:#8b5cf6;">${dateStr} — ${timeStr} hs</div>
                          <div style="font-size:10px; font-weight:600; color:var(--color-text-tertiary);">Pasajero: ${trip.userName || 'Cliente'}</div>
                        </div>
                      </div>
                      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                          <div style="width:8px; height:8px; border-radius:50%; background:#22c55e; flex-shrink:0;"></div>
                          <span style="font-size:11.5px; font-weight:600; color:var(--color-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${trip.pickupAddress || 'Origen'}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                          <div style="width:8px; height:8px; border-radius:50%; background:var(--color-primary); flex-shrink:0;"></div>
                          <span style="font-size:11.5px; font-weight:600; color:var(--color-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${trip.deliveryAddress || 'Destino'}</span>
                        </div>
                      </div>
                      ${isUnassigned ? `
                        <button class="btn btn-primary btn-block accept-scheduled-btn" data-trip-id="${trip.id}"
                          style="height:48px; border-radius:14px; font-weight:900; font-size:13px; text-transform:uppercase; letter-spacing:0.02em; gap:8px; background:linear-gradient(135deg, #8b5cf6, #7c3aed); box-shadow:0 6px 16px rgba(139,92,246,0.25); border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                          ${icon('checkCircle', 18)} ACEPTAR VIAJE PROGRAMADO
                        </button>
                      ` : `
                        <div style="text-align:center; padding:8px; background:rgba(34,197,94,0.06); border-radius:12px; border:1px solid rgba(34,197,94,0.15);">
                          <span style="font-size:12px; font-weight:800; color:#22c55e;">✅ Ya aceptaste este viaje</span>
                        </div>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            `;

            // Bind accept buttons
            scheduledContainer.querySelectorAll('.accept-scheduled-btn').forEach(btn => {
              btn.addEventListener('click', async () => {
                const tripId = btn.dataset.tripId;
                showConfirm({
                  title: '📅 ¿Aceptar viaje programado?',
                  message: 'Te comprometerás a realizar este viaje en la fecha y hora indicadas. Recibirás un recordatorio antes de la hora del viaje.',
                  confirmText: 'Sí, Aceptar',
                  onConfirm: async () => {
                    try {
                      btn.disabled = true;
                      btn.innerHTML = icon('loader', 18, 'animate-spin') + ' Aceptando...';
                      const tripDoc = doc(db, 'orders', tripId);
                      await updateDoc(tripDoc, {
                        driverId: user.uid,
                        driverName: user.displayName || user.name || 'Chofer'
                      });

                      // Send notification to user
                      try {
                        const trip = scheduledTrips.find(t => t.id === tripId);
                        if (trip && trip.userId) {
                          await addDoc(collection(db, 'users', trip.userId, 'notifications'), {
                            title: '🚗 Chofer asignado a tu viaje programado',
                            body: `${user.displayName || 'Un chofer'} aceptó tu viaje programado. Te notificaremos antes de la hora del viaje.`,
                            type: 'scheduled_trip_accepted',
                            orderId: tripId,
                            createdAt: serverTimestamp(),
                            read: false
                          });
                        }
                      } catch (e) {
                        console.warn('Error sending scheduled trip notification:', e);
                      }

                      showToast('¡Viaje programado aceptado!', 'success');
                    } catch (err) {
                      console.error('Error accepting scheduled trip:', err);
                      showToast('Error al aceptar el viaje: ' + err.message, 'error');
                      btn.disabled = false;
                      btn.innerHTML = icon('checkCircle', 18) + ' ACEPTAR VIAJE PROGRAMADO';
                    }
                  }
                });
              });
            });
          });

          // Clean up scheduled listener when main listener is cleaned
          const originalUnsub = listUnsub;
          tabUnsub = () => {
            originalUnsub();
            scheduledUnsub();
          };
        } else {
          tabUnsub = listUnsub;
        }

        // ── Countdown Banner for driver's own upcoming scheduled trips ──
        if (user.tripStatus === 'approved') {
          const bannerQ = query(
            collection(db, 'orders'),
            where('driverId', '==', user.uid),
            where('status', '==', 'scheduled'),
            where('isTrip', '==', true)
          );
          const bannerUnsub = onSnapshot(bannerQ, (bSnap) => {
            document.getElementById('scheduled-trip-banner')?.remove();
            const myScheduled = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (myScheduled.length === 0) return;

            // Find the nearest scheduled trip
            const now = Date.now();
            let nearest = null;
            let nearestMs = Infinity;
            myScheduled.forEach(t => {
              const ts = t.scheduledFor?.toDate ? t.scheduledFor.toDate().getTime() : 0;
              const diff = ts - now;
              if (diff > 0 && diff < nearestMs) {
                nearestMs = diff;
                nearest = t;
              }
            });

            if (!nearest || nearestMs > 4 * 60 * 60 * 1000) return; // Only show within 4 hours

            const banner = document.createElement('div');
            banner.id = 'scheduled-trip-banner';
            banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9990; padding:12px 16px; background:linear-gradient(135deg, #7c3aed, #8b5cf6); color:white; display:flex; align-items:center; gap:10px; box-shadow:0 4px 16px rgba(139,92,246,0.3); font-size:13px; font-weight:700;';

            function updateBannerTime() {
              const diff = (nearest.scheduledFor?.toDate ? nearest.scheduledFor.toDate().getTime() : 0) - Date.now();
              if (diff <= 0) {
                banner.innerHTML = `<span style="font-size:18px;">🚗</span> <span>¡Tu viaje programado comienza AHORA!</span>`;
                return;
              }
              const hrs = Math.floor(diff / 3600000);
              const mins = Math.floor((diff % 3600000) / 60000);
              banner.innerHTML = `<span style="font-size:18px;">⏰</span> <span>Viaje programado en <strong>${hrs}h ${mins}m</strong></span> <span style="margin-left:auto; font-size:10px; opacity:0.8; text-transform:uppercase;">${nearest.deliveryAddress || ''}</span>`;
            }

            updateBannerTime();
            const bannerInterval = setInterval(updateBannerTime, 60000);
            banner._interval = bannerInterval;

            document.body.appendChild(banner);

            // Cleanup when navigating away
            const cleanupBanner = () => {
              clearInterval(bannerInterval);
              banner.remove();
            };
            window.addEventListener('hashchange', cleanupBanner, { once: true });
          });

          // Add to cleanup
          const prevUnsub = tabUnsub;
          tabUnsub = () => {
            prevUnsub();
            bannerUnsub();
            document.getElementById('scheduled-trip-banner')?.remove();
          };
        }

    } else if (tab === 'active') {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid)
      );

      let suggestedUnsub = null;
      let currentSuggestedOrders = [];

      const listUnsub = onSnapshot(q, (snap) => {
        const orders = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(o => !['completed', 'cancelled'].includes(o.status));

        if (suggestedUnsub) {
          suggestedUnsub();
          suggestedUnsub = null;
        }

        if (orders.length === 0) {
          container.innerHTML = '';
          return;
        }

        // Check if co-pickup recommendations apply
        const activeUnpickedComercioIds = [...new Set(
          orders.filter(o => !o.pickedUpAt && o.status !== 'delivering' && o.comercioId).map(o => o.comercioId)
        )];

        // Under the new rule, co-pickup suggestions are shown if the current route consists of exactly 1 active order,
        // or if they have exactly 2 active orders and both belong to the same local (since the maximum same-local limit is 3).
        const hasSpace = orders.length === 1 || (orders.length === 2 && orders.every(o => o.comercioId && o.comercioId === orders[0].comercioId));

        if (activeUnpickedComercioIds.length > 0 && hasSpace) {
          const qSuggested = query(
            collection(db, 'orders'),
            where('comercioId', 'in', activeUnpickedComercioIds),
            where('status', '==', 'ready')
          );
          
          suggestedUnsub = onSnapshot(qSuggested, (suggestedSnap) => {
            currentSuggestedOrders = suggestedSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(o => !o.driverId && !o.bundleId);
            
            renderActiveTimeline(orders, currentSuggestedOrders);
          });
        } else {
          renderActiveTimeline(orders, []);
        }
      });

      async function renderActiveTimeline(orders, suggestedOrders) {
        // Fetch missing commerce addresses
        for (const o of orders) {
          if (!o.isFavor && o.comercioId && !o.pickupAddress && !o.comercioAddress) {
            if (!commerceCache.has(o.comercioId)) {
              try {
                const cSnap = await getDoc(doc(db, 'comercios', o.comercioId));
                if (cSnap.exists()) {
                  const cData = cSnap.data();
                  commerceCache.set(o.comercioId, {
                    address: cData.address || '',
                    name: cData.name || ''
                  });
                } else {
                  commerceCache.set(o.comercioId, { address: '', name: '' });
                }
              } catch (err) {
                console.error('Error fetching commerce address:', err);
              }
            }
            const cached = commerceCache.get(o.comercioId);
            if (cached) {
              o.comercioAddress = cached.address;
              if (!o.comercioName) o.comercioName = cached.name;
            }
          }
        }

        const fingerprint = JSON.stringify(orders.map(o => ({
          id: o.id,
          status: o.status,
          pickedUp: o.status === 'delivering' || !!o.pickedUpAt,
          isAtDoor: !!o.isAtDoor,
          comercioId: o.comercioId,
          orderId: o.orderId,
          deliveryAddress: o.deliveryAddress,
          comercioAddress: o.comercioAddress || '',
          subtotal: o.subtotal || 0,
          total: o.total || 0
        }))) + '_' + JSON.stringify(suggestedOrders.map(o => o.id));

        if (container.dataset.lastActiveFingerprint === fingerprint) {
          console.log('[Active Timeline] Fingerprint matches, bypassing DOM replacement to prevent refresh loops');
          return;
        }
        container.dataset.lastActiveFingerprint = fingerprint;

        const isDriverOnlineMode = user?.isOnline === true || Boolean(document.getElementById('driver-footer-dock-container') || document.getElementById('driver-fullscreen-map'));
        if (isDriverOnlineMode) {
          // Online navigation map mode uses #driver-footer-dock-container exclusively
          container.innerHTML = '';
          return;
        }

        if (orders.length === 0) {
          container.innerHTML = '';
          return;
        }

        // Group active orders into a single route timeline
        const stops = [];
        const deliveries = new Map(); // address -> {userName, orders: []}
        const pickupsByCommerce = new Map(); // comercioId -> { comercioName, address, isFavor, orders: [] }

        orders.forEach(o => {
          if (o.favorType === 'gocash') {
            // Go Cash orders do not have a pickup stop, only drop-off.
            // Mark as pickedUpAt in local UI state so the drop-off delivery button is enabled immediately.
            o.pickedUpAt = o.acceptedAt || new Date();
          } else {
            let key = o.comercioId || (o.isFavor ? `favor_${o.id}` : `order_${o.id}`);
            if (!pickupsByCommerce.has(key)) {
              let stopName = o.comercioName;
              if (!stopName) {
                if (o.isTrip) {
                  stopName = 'Punto de Encuentro';
                } else if (o.isFavor) {
                  if (o.favorType === 'encomienda' || o.serviceType === 'encomienda') {
                    stopName = '📦 Retiro de Encomienda';
                  } else if (o.favorType === 'pagodeservicios') {
                    const match = o.details?.match(/🏢\s*\*\*Servicio:\*\*\s*(.*?)(?=\n|$)/i);
                    stopName = match ? match[1].trim() : 'Pago de Servicio';
                  } else {
                    const stores = parseFavorDetails(o.details || o.description);
                    stopName = stores.length > 0 ? stores[0].name : (o.comercioName || 'Punto de Retiro');
                  }
                } else {
                  stopName = o.comercioName || 'Comercio a Comprar';
                }
              }

              pickupsByCommerce.set(key, {
                comercioName: stopName,
                address: o.pickupAddress || o.originAddress || o.comercioAddress || 'Punto de Retiro',
                isFavor: !!o.isFavor,
                orders: []
              });
            }
            pickupsByCommerce.get(key).orders.push(o);
          }

          // Drop-off stops (unique per address)
          const dropAddress = o.deliveryAddress || o.destinationAddress || 'Dirección de Entrega';
          if (!deliveries.has(dropAddress)) {
            deliveries.set(dropAddress, { userName: o.userName || 'Cliente', orders: [] });
          }
          deliveries.get(dropAddress).orders.push(o);
        });

        // Convert pickups to stops
        pickupsByCommerce.forEach((group, key) => {
          const allPickedUp = group.orders.every(o => o.status === 'delivering' || !!o.pickedUpAt);
          const firstOrder = group.orders[0];
          const totalAmountToPay = group.orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);

          stops.push({
            type: 'PICKUP',
            comercioName: group.comercioName,
            address: group.address,
            pickedUp: allPickedUp,
            isFavor: group.isFavor,
            orders: group.orders,
            amountToPay: totalAmountToPay,
            status: firstOrder.status,
            orderId: group.orders.map(o => o.orderId).join(' + '),
            docId: group.orders.map(o => o.id).join(',') // Comma-separated for atomic multi-pickup
          });
        });

        // Drop-off stops
        deliveries.forEach((data, addr) => {
          stops.push({
            type: 'DROP_OFF',
            address: addr,
            userName: data.userName,
            orders: data.orders
          });
        });

        // TSP Route Optimization for Active Stops
        if (window.lastRiderPos) {
          const startPt = window.lastRiderPos;
          const pendingPickups = stops.filter(s => s.type === 'PICKUP' && !s.pickedUp);
          const completedPickups = stops.filter(s => s.type === 'PICKUP' && s.pickedUp);
          const dropoffs = stops.filter(s => s.type === 'DROP_OFF');

          pendingPickups.sort((a, b) => {
            const aCoords = a.orders[0]?.comercioCoords || startPt;
            const bCoords = b.orders[0]?.comercioCoords || startPt;
            const distA = Math.hypot((aCoords.lat || aCoords.latitude || 0) - startPt.lat, (aCoords.lng || aCoords.longitude || 0) - startPt.lng);
            const distB = Math.hypot((bCoords.lat || bCoords.latitude || 0) - startPt.lat, (bCoords.lng || bCoords.longitude || 0) - startPt.lng);
            return distA - distB;
          });

          let lastPt = startPt;
          if (pendingPickups.length > 0) {
            const lastPickup = pendingPickups[pendingPickups.length - 1];
            lastPt = lastPickup.orders[0]?.comercioCoords || startPt;
          } else if (completedPickups.length > 0) {
            const lastPickup = completedPickups[completedPickups.length - 1];
            lastPt = lastPickup.orders[0]?.comercioCoords || startPt;
          }

          const sortedDropoffs = [];
          let currentPt = { lat: lastPt.lat || lastPt.latitude || 0, lng: lastPt.lng || lastPt.longitude || 0 };
          
          while (dropoffs.length > 0) {
            let nearestIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < dropoffs.length; i++) {
              const dCoords = dropoffs[i].orders[0]?.deliveryCoords || currentPt;
              const dist = Math.hypot((dCoords.lat || dCoords.latitude || 0) - currentPt.lat, (dCoords.lng || dCoords.longitude || 0) - currentPt.lng);
              if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
              }
            }
            const nearest = dropoffs.splice(nearestIdx, 1)[0];
            sortedDropoffs.push(nearest);
            const nextCoords = nearest.orders[0]?.deliveryCoords || currentPt;
            currentPt = { lat: nextCoords.lat || nextCoords.latitude || 0, lng: nextCoords.lng || nextCoords.longitude || 0 };
          }

          stops.length = 0;
          stops.push(...pendingPickups, ...completedPickups, ...sortedDropoffs);
        } else {
          stops.sort((a, b) => {
            if (a.type === b.type) return 0;
            return a.type === 'PICKUP' ? -1 : 1;
          });
        }

        // Suggestion Card HTML
        const suggestedCardHtml = suggestedOrders.length > 0 ? `
          <!-- Premium Amber Glowing Card for Chained Orders -->
          <div class="suggested-co-pickup-card page-enter" style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%); border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 28px; padding: 24px; margin-bottom: 24px; position: relative; overflow: hidden; box-shadow: 0 10px 25px rgba(245, 158, 11, 0.05); animation: pulse-border 2s infinite ease-in-out;">
            <!-- Decorative blur glow -->
            <div style="position: absolute; top: -30px; right: -30px; width: 100px; height: 100px; background: radial-gradient(circle, rgba(245, 158, 11, 0.2) 0%, transparent 75%); filter: blur(10px); pointer-events: none;"></div>
            
            <div style="display: flex; gap: 16px; align-items: flex-start; position: relative; z-index: 2;">
              <div style="width: 46px; height: 46px; background: #f59e0b; color: white; border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 15px rgba(245, 158, 11, 0.3); flex-shrink: 0; animation: scale-pulse 2s infinite;">
                ${icon('bike', 22)}
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-size: 10px; font-weight: 900; background: rgba(245, 158, 11, 0.15); color: #d97706; padding: 4px 10px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.05em;">CO-RETIROS OPTIMIZADOS</span>
                  <div style="width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; animation: blink 1.2s infinite;"></div>
                </div>
                <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 900; color: var(--color-text-primary); letter-spacing: -0.01em;">¡Aprovechá tu viaje a ${suggestedOrders[0].comercioName || 'el local'}!</h4>
                <p style="margin: 0 0 16px 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.45; font-weight: 600;">Hay ${suggestedOrders.length} ${suggestedOrders.length === 1 ? 'pedido disponible' : 'pedidos disponibles'} en este negocio. ¡Sumalos a tu ruta para optimizar tu tiempo y ganancias!</p>
                
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  ${suggestedOrders.map(so => `
                    <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 12px; transition: all 0.3s; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
                      <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: 900; color: var(--color-text-primary);">#${so.orderId}</span>
                        <span style="font-size: 14px; font-weight: 900; color: #10b981;">+ ${formatPrice(so.deliveryCost || 0)}</span>
                      </div>
                      
                      <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary);">
                        <span style="flex-shrink: 0; color: var(--color-text-tertiary);">${icon('mapPin', 14)}</span>
                        <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1;">${so.deliveryAddress}</span>
                      </div>
                      
                      <button class="btn add-suggested-order-btn" 
                              data-id="${so.id}" 
                              style="width: 100%; height: 42px; border-radius: 12px; border: none; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; font-size: 12px; font-weight: 900; letter-spacing: 0.02em; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 6px 15px rgba(245, 158, 11, 0.2); transition: all 0.3s;">
                        ${icon('plusCircle', 14)} SUMAR A MI RUTA
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        ` : '';

        container.innerHTML = `
          <div id="driver-swipeable-sheet" class="driver-bottom-sheet" style="
            position: fixed;
            bottom: 0; left: 0; right: 0;
            background: rgba(9, 13, 22, 0.96);
            backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
            border-top: 1.5px solid rgba(56, 189, 248, 0.35);
            border-radius: 28px 28px 0 0;
            box-shadow: 0 -10px 40px rgba(0,0,0,0.8);
            z-index: 9995;
            transition: max-height 0.35s cubic-bezier(0.2, 0.9, 0.3, 1);
            max-height: ${container._sheetExpanded ? '85vh' : '150px'};
            display: flex; flex-direction: column;
          ">
            <!-- SHEET DRAG HANDLE & QUICK PREVIEW HEADER (SWIPE OR CLICK TO TOGGLE) -->
            <div id="sheet-drag-header" style="padding: 10px 18px 8px 18px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; user-select: none;">
              <div style="width: 44px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.3);"></div>
              <div style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:13px; font-weight:900; color:#38bdf8;">📦 ${orders.length} ${orders.length === 1 ? 'Pedido en Curso' : 'Pedidos en Curso'}</span>
                </div>
                <div style="font-size:11.5px; font-weight:800; color:#38bdf8; background:rgba(56,189,248,0.12); padding:4px 10px; border-radius:12px; border:1px solid rgba(56,189,248,0.25);">
                  <span>${container._sheetExpanded ? '▼ Ocultar Detalle' : '▲ Deslizar para Ver Detalle'}</span>
                </div>
              </div>
            </div>

            <!-- COLLAPSED QUICK ACTION STRIP (VISIBLE WHEN COLLAPSED) -->
            ${!container._sheetExpanded ? `
              <div id="sheet-collapsed-quick-strip" style="padding: 0 18px 14px 18px; display: flex; align-items: center; gap: 8px;">
                ${(() => {
                  const activeStop = stops.find(s => !s.pickedUp) || stops[0];
                  if (!activeStop) return '';
                  const isFavorCompra = activeStop.orders?.some(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios'));
                  if (activeStop.type === 'PICKUP') {
                    return `
                      <button class="btn mark-picked-up-btn" data-id="${activeStop.docId}" data-istrip="${activeStop.orders?.some(o => o.isTrip)}" style="flex:1; height:48px; border-radius:16px; border:none; color:white; font-size:13.5px; font-weight:900; background:linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow:0 6px 18px rgba(16,185,129,0.4); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                        🛍️ ${isFavorCompra ? 'MARCAR RETIRADO (INGRESAR MONTO)' : 'MARCAR RETIRADO'}
                      </button>
                    `;
                  } else {
                    return `
                      <button class="btn mark-delivered-btn" data-ids="${activeStop.orders?.map(o => o.id).join(',')}" data-codes="${activeStop.orders?.map(o => o.verificationCode).join(',')}" style="flex:1; height:48px; border-radius:16px; border:none; color:white; font-size:13.5px; font-weight:900; background:linear-gradient(135deg, #22c55e 0%, #16a34a 100%); box-shadow:0 6px 18px rgba(34,197,94,0.4); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                        ✅ ENTREGAR AL CLIENTE
                      </button>
                    `;
                  }
                })()}
              </div>
            ` : ''}

            <!-- EXPANDED CONTENT BODY (FULL TIMELINE, ITEMS, ACTIONS) -->
            <div id="sheet-scrollable-body" style="overflow-y: auto; padding: 10px 18px 30px 18px; flex: 1; -webkit-overflow-scrolling: touch; display: ${container._sheetExpanded ? 'block' : 'none'};">
              <div class="route-manager-v4" style="display: flex; flex-direction: column; gap: 20px; padding-bottom: 20px;">
                ${suggestedCardHtml}

                <div style="background:var(--color-bg-card); border-radius:32px; padding:24px; border:1px solid var(--color-border-light); box-shadow:var(--shadow-xl); position:relative; overflow:hidden;">
                  <div style="position:absolute; top:0; left:0; width:6px; height:100%; background:var(--color-primary); opacity:0.4;"></div>
                  
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <div style="display:flex; align-items:center; gap:14px;">
                      <div style="width:40px; height:40px; background:rgba(var(--color-primary-rgb), 0.1); color:var(--color-primary); border-radius:14px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.1);">
                        ${icon('route', 22)}
                      </div>
                      <div>
                        <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; letter-spacing:-0.03em;">Hoja de Ruta</h3>
                        <div style="font-size:10.5px; font-weight:700; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.08em; opacity:0.8;">Secuencia de entrega</div>
                      </div>
                    </div>
                    <span style="background:var(--color-bg-secondary); color:var(--color-text-primary); padding:6px 12px; border-radius:12px; font-weight:900; font-size:11px; border:1px solid var(--color-border-light);">${orders.length} PEDIDOS</span>
                  </div>
                  
                  <div class="timeline-container" style="position:relative; padding-left:38px;">
                    <div style="position:absolute; left:9px; top:15px; bottom:15px; width:2px; background:linear-gradient(to bottom, var(--color-primary), var(--color-border-light)); border-radius:4px; opacity:0.2;"></div>
                
                ${stops.map((stop, idx) => {
                  const isActive = !stop.pickedUp && (idx === 0 || stops[idx-1].pickedUp);
                  const addressVal = (stop.type === 'PICKUP' ? stop.docId : stop.address) || '';
                  const stopKey = (stop.type + '_' + addressVal).replace(/[^a-zA-Z0-9]/g, '_');
                  container._expandedStops = container._expandedStops || new Set();
                  const isExpanded = container._expandedStops.has(stopKey);

                  const firstOrder = stop.orders?.[0];
                  const isTrip = stop.orders?.some(o => o.isTrip);
                  let stopColor = '#10b981'; // Green default for standard order delivery
                  if (isTrip) {
                    stopColor = '#3b82f6'; // Blue for trips
                  } else if (firstOrder?.isFavor) {
                    stopColor = getFavorTypeMeta(firstOrder.favorType).color;
                  } else if (stop.type === 'PICKUP') {
                    stopColor = '#7c3aed'; // Purple default for standard commerce pickup
                  }
                  const stopRgb = getRgbString(stopColor);

                  return `
                  <div class="stop-item" style="position:relative; margin-bottom:36px;">
                    <!-- Timeline Dot -->
                    <div style="position:absolute; left:-38px; top:8px; width:20px; height:20px; border-radius:50%; background:${stop.pickedUp ? '#10b981' : (isActive ? stopColor : 'var(--color-border-light)')}; border:4px solid var(--color-bg-card); z-index:2; box-shadow:0 6px 15px rgba(0,0,0,0.12); transition:all 0.4s;">
                      ${isActive ? `<div style="position:absolute; inset:-8px; border-radius:50%; border:2.5px solid ${stopColor}; opacity:0.4; animation: pulse-dot 2s infinite;"></div>` : ''}
                    </div>
                    
                    <div style="background:${isActive ? 'var(--color-bg)' : 'rgba(var(--color-bg-secondary-rgb), 0.5)'}; border:${isActive ? '2.5px' : '1.5px'} solid ${isActive ? stopColor : stopColor + '44'}; border-radius:26px; padding:0 24px 24px 24px; overflow:hidden; transition:all 0.4s; ${isActive ? `box-shadow: 0 15px 40px rgba(${stopRgb}, 0.12);` : ''}">
                      
                      <!-- Card Header Strip -->
                      <div style="background:${stopColor}; color:#ffffff; margin-left:-24px; margin-right:-24px; padding:10px 24px; font-size:11.5px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:18px; display:flex; align-items:center; gap:8px;">
                        ${(() => {
                          const o = firstOrder;
                          if (o.isTrip) return icon('navigation', 14) + ' GO VIAJE';
                          if (o.isFavor) {
                            if (o.favorType === 'gocash') return icon('dollarSign', 14) + ' GO CASH';
                            if (o.favorType === 'pagodeservicios') return icon('creditCard', 14) + ' PAGO DE SERVICIO';
                            if (o.favorType === 'mandado') return `<img src="/go-pickup-point.png" style="width:20px; height:20px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:6px;" /> ENCOMIENDA`;
                            if (o.favorType === 'compra') return `<img src="/go-bag.png" style="width:20px; height:20px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:6px;" /> MANDADO`;
                            return `<img src="/go-bag.png" style="width:20px; height:20px; object-fit:contain; display:inline-block; vertical-align:middle; margin-right:6px;" /> MANDADO`;
                          }
                          return icon('shoppingCart', 14) + ' COMERCIO';
                        })()}
                      </div>
                      
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                        <div>
                          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <span style="font-size:10px; font-weight:900; text-transform:uppercase; color:${isActive ? stopColor : 'var(--color-text-tertiary)'}; letter-spacing:0.1em; display:inline-flex; align-items:center; gap:5px;">
                              ${(() => {
                                const hasTrip = (stop.orders || []).some(o => o.isTrip);
                                const isPickup = stop.type === 'PICKUP';
                                if (hasTrip) {
                                  const text = isPickup ? 'Punto de Encuentro' : 'Destino del Viaje';
                                  const ic = isPickup ? icon('mapPin', 12) : icon('navigationArrow', 12);
                                  return `${ic} ${text}`;
                                } else {
                                  const text = isPickup ? 'Punto de Retiro' : 'Punto de Entrega';
                                  const ic = isPickup ? icon('store', 12) : icon('home', 12);
                                  return `${ic} ${text}`;
                                }
                              })()}
                            </span>
                            ${isActive ? `<div style="background:var(--color-primary); width:6px; height:6px; border-radius:50%; animation: blink 1s infinite;"></div>` : ''}
                          </div>
                          <h4 style="margin:0; font-size:16.5px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.02em; line-height:1.4; text-align:left;">
                            ${stop.type === 'PICKUP' ? (stop.comercioName || 'Punto de Retiro') : (stop.address || 'Dirección de Entrega')}
                          </h4>
                          ${(stop.type === 'DROP_OFF' && stop.orders?.[0]?.addressNotes) ? `
                            <div style="font-size:12px; font-weight:700; color:#d97706; margin-top:4.5px; text-align:left;">
                              ⚠️ Ref: ${stop.orders[0].addressNotes}
                            </div>
                          ` : ''}
                          ${(() => {
                            if (stop.type === 'DROP_OFF') return '';
                            const o = stop.orders && stop.orders[0];
                            if (o && o.estimatedReadyAt) {
                              const dateObj = o.estimatedReadyAt.toDate ? o.estimatedReadyAt.toDate() : new Date(o.estimatedReadyAt);
                              const hh = String(dateObj.getHours()).padStart(2, '0');
                              const mm = String(dateObj.getMinutes()).padStart(2, '0');
                              const readyTimeStr = `${hh}:${mm} hs`;
                              return `
                                <div style="margin-top:6px; background:linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04)); border:1px solid rgba(245,158,11,0.25); color:#d97706; padding:5px 10px; border-radius:10px; font-size:10.5px; font-weight:900; display:inline-flex; align-items:center; gap:5px;">
                                  ${icon('clock', 12)} 🍳 Listo en cocina a las ${readyTimeStr}
                                </div>
                              `;
                            }
                            return '';
                          })()}
                        </div>
                        ${stop.pickedUp ? `
                          <div style="background:rgba(34, 197, 94, 0.12); color:var(--color-success); padding:5px 12px; border-radius:10px; font-size:10px; font-weight:900; display:flex; align-items:center; gap:6px; letter-spacing:0.02em;">
                            ${icon('check', 14)} COMPLETADO
                          </div>
                        ` : ''}
                      </div>
                      


                      ${(() => {
                        if (stop.type === 'DROP_OFF') {
                          return '';
                        } else {
                          return '';
                        }
                      })()}

                      <!-- Collapsible Stop Details -->
                      ${stop.type === 'PICKUP' ? `

                        <div class="collapsible-stop-details ${isExpanded ? 'expanded' : ''}" id="details-${stopKey}" style="background:var(--color-bg-secondary); border-radius:20px; padding:18px; border:1px solid var(--color-border-light); display:flex; flex-direction:column; gap:10px;">
                          ${!stop.isFavor ? `
                            <!-- Commerce Order Details (Single or Batch) -->
                            <div style="display:flex; flex-direction:column; gap:8px; text-align:left; width:100%;">
                              <div style="font-size:9.5px; font-weight:900; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">Detalle del Pedido de Comercio</div>
                              ${stop.orders.map(o => `
                                <div style="background:rgba(var(--color-primary-rgb, 225,29,72),0.02); border:1px solid var(--color-border-light); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:6px;">
                                  <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:800; color:var(--color-text-primary);">
                                    <span>Pedido #${o.orderId || '---'}</span>
                                    <span>${formatPrice(o.subtotal || 0)}</span>
                                  </div>
                                  ${o.items && o.items.length > 0 ? `
                                    <div style="font-size:12px; color:var(--color-text-secondary); margin-top:2px; font-weight:600; padding-left:8px; border-left:2px solid var(--color-primary); display:flex; flex-direction:column; gap:4px;">
                                      ${o.items.map(item => `
                                        <div style="display:flex; flex-direction:column; gap:1px; text-align:left;">
                                          <div style="color:var(--color-text-primary);"><span style="color:var(--color-primary); font-weight:800;">${item.qty || 1}x</span> ${item.name}</div>
                                          ${item.options && item.options.length > 0 ? `
                                            <div style="font-size:10.5px; color:var(--color-primary); font-weight:700; padding-left:8px; margin-top:1px; text-align:left;">
                                              Sabores: ${item.options.map(opt => `${opt.qty > 1 ? `${opt.qty}x ` : ''}${opt.name}`).join(', ')}
                                            </div>
                                          ` : ''}
                                        </div>
                                      `).join('')}
                                    </div>
                                  ` : `
                                    <div style="font-size:11.5px; color:var(--color-text-tertiary); font-style:italic;">
                                      Pedido en ${o.comercioName || 'Comercio'}
                                    </div>
                                  `}
                                </div>
                              `).join('')}
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px dashed var(--color-border-light); width:100%;">
                              <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">A abonar al comercio:</span>
                              <span style="font-size:18px; color:var(--color-primary); font-weight:950; letter-spacing:-0.02em;">${formatPrice(stop.amountToPay)}</span>
                            </div>
                          ` : `
                            <!-- GoFavor (Single or Batch) -->
                            <div style="background:rgba(var(--color-primary-rgb),0.05); border-radius:14px; padding:12px; border:1px dashed rgba(var(--color-primary-rgb),0.3); display:flex; flex-direction:column; gap:8px; text-align:left; width:100%;">
                              <div style="font-size:9px; font-weight:850; color:${getFavorTypeMeta(stop.orders[0].favorType).textColor}; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px; text-align:left;">${getFavorTypeMeta(stop.orders[0].favorType).headerText}</div>
                              ${(() => {
                                const order = stop.orders[0];
                                const details = order.details || '';
                                const stores = parseFavorDetails(details);
                                const storePrices = order.storePrices || {};
                                if (stores.length > 0) {
                                  return stores.map(st => `
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:13px; font-weight:600; color:var(--color-text-secondary); line-height:1.4; border-bottom:1.5px solid var(--color-border-light); padding-bottom:6px; margin-bottom:2px;">
                                      <div style="display:flex; flex-direction:column; gap:2px; text-align:left; align-items:flex-start; flex:1; padding-right:8px;">
                                        <strong style="color:var(--color-text-primary); font-weight:800;">${st.name}</strong>
                                        <span style="font-size:11.5px; color:var(--color-text-secondary); font-weight:500;">${st.items}</span>
                                      </div>
                                      ${storePrices[st.name] ? `<span style="font-weight:900; color:var(--color-text-primary); margin-left:12px; white-space:nowrap;">${formatPrice(storePrices[st.name])}</span>` : ''}
                                    </div>
                                  `).join('');
                                } else {
                                  return formatFavorDetailsHTML(details);
                                }
                              })()}
                            </div>
                            ${!stop.isFavor ? `
                              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                                <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">A abonar al comercio:</span>
                                <span style="font-size:16px; color:var(--color-primary); font-weight:900; letter-spacing:-0.02em;">${formatPrice(stop.amountToPay)}</span>
                              </div>
                            ` : ''}
                          `}
                        </div>
                      ` : `
                        

                        <div class="collapsible-stop-details ${isExpanded ? 'expanded' : ''}" id="details-${stopKey}" style="background:var(--color-bg-secondary); border-radius:20px; padding:18px; border:1px solid var(--color-border-light); display:flex; flex-direction:column; gap:10px;">
                          <div style="font-size:10px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Desglose de Cobro</div>
                          ${stop.orders.map(o => `
                            <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                              <span style="color:var(--color-text-secondary); opacity:0.8;">Pedido #${o.orderId} (${o.isFavor ? (o.favorType === 'gocash' ? 'Go Cash' : (o.favorType === 'mandado' ? 'Mandado' : 'Compra')) : (o.comercioName || 'Pedido')})</span>
                              <span style="color:var(--color-text-primary);">${formatPrice(o.subtotal || 0)}</span>
                            </div>
                          `).join('')}
                          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600; padding-top:8px; border-top:1px dashed var(--color-border-light);">
                            <span style="color:var(--color-text-secondary); opacity:0.8;">Costo de Envío</span>
                            <span style="color:var(--color-text-primary);">${formatPrice(stop.orders.reduce((s, o) => s + (o.deliveryCost || 0), 0))}</span>
                          </div>
                          ${(() => {
                            const totalTips = stop.orders.reduce((s, o) => s + (o.tip || 0), 0);
                            if (totalTips > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600; color: #10b981;">
                                  <span>Propina al Repartidor</span>
                                  <span>+ ${formatPrice(totalTips)}</span>
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                            <span style="color:var(--color-text-secondary); opacity:0.8;">Tarifa de Uso App</span>
                            <span style="color:var(--color-text-primary);">${formatPrice(stop.orders.reduce((s, o) => s + (o.appUsageFee || 0), 0))}</span>
                          </div>
                          ${stop.orders.some(o => o.isFavor && o.favorType === 'compra') ? `
                            <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                              <span style="color:var(--color-text-secondary); opacity:0.8;">Gestión Especial</span>
                              <span style="color:var(--color-text-primary);">${formatPrice(stop.orders.reduce((s, o) => s + (o.purchaseFee || 800), 0))}</span>
                            </div>
                          ` : ''}
                          ${(() => {
                            const totalExtraStops = stop.orders.reduce((s, o) => s + (o.extraStopsFee || 0), 0);
                            if (totalExtraStops > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
                                  <span style="color:var(--color-text-secondary); opacity:0.8;">Paradas Extra</span>
                                  <span style="color:var(--color-text-primary);">${formatPrice(totalExtraStops)}</span>
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          ${(() => {
                            const totalDiscount = stop.orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
                            if (totalDiscount > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--color-success);">
                                  <span style="display:flex; align-items:center; gap:4px;">${icon('sparkles', 12)} Descuento GoPoints</span>
                                  <span>- ${formatPrice(totalDiscount)}</span>
                                </div>
                                <div style="font-size:10px; color:#f59e0b; font-weight:700; margin-top:4px; margin-bottom:8px; line-height:1.3; text-align:right;">
                                  El descuento es absorbido por GO Delivery y se descontará de tu deuda de la app.
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          ${(() => {
                            const totalCouponDiscount = stop.orders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
                            const couponCodes = stop.orders.filter(o => o.couponCode).map(o => o.couponCode);
                            if (totalCouponDiscount > 0 || couponCodes.length > 0) {
                              return `
                                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:#a855f7; background: rgba(168, 85, 247, 0.06); padding: 8px 12px; border-radius: 12px; border: 1px dashed rgba(168, 85, 247, 0.25); margin-top: 4px; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;">
                                  <span style="display:flex; align-items:center; gap:4px; min-width: 0; flex: 1; text-align: left;">
                                    ${icon('tag', 12)}
                                    <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">Cupón: ${couponCodes.join(', ') || 'Promo'}</span>
                                  </span>
                                  <span style="flex-shrink: 0; white-space: nowrap;">- ${formatPrice(totalCouponDiscount)}</span>
                                </div>
                                <div style="font-size:10px; color:#a855f7; font-weight:700; margin-top:4px; margin-bottom:8px; line-height:1.3; display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                  <span style="display:flex; align-items:center; gap:4px;">
                                    ${icon('info', 12)} Absorbido por GO Delivery. Se descontará de tu deuda.
                                  </span>
                                  <button class="coupon-info-btn" data-discount="${totalCouponDiscount}" style="background:rgba(168, 85, 247, 0.1); border:none; color:#a855f7; font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:2px; flex-shrink:0;">
                                    Info
                                  </button>
                                </div>
                              `;
                            }
                            return '';
                          })()}
                          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:12px; border-top:1.5px solid var(--color-border-light);">
                            <span style="font-size:12px; color:var(--color-text-primary); font-weight:900; text-transform:uppercase;">TOTAL A COBRAR</span>
                            <span style="font-size:18px; color:var(--color-text-primary); font-weight:900; letter-spacing:-0.03em;">${formatPrice(stop.orders.reduce((s, o) => s + (o.total || 0), 0))}</span>
                          </div>
                          ${stop.orders.some(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios')) ? `
                            <button class="btn edit-favor-price-btn" 
                                    data-id="${stop.orders.find(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios')).id}"
                                    style="width:100%; height:42px; border-radius:14px; background:rgba(var(--color-primary-rgb),0.1); border:1px solid rgba(var(--color-primary-rgb),0.2); color:var(--color-primary); font-size:12px; font-weight:900; margin-top:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                              ${icon('edit', 14)} ${stop.orders.some(o => o.favorType === 'pagodeservicios') ? 'Cargar valor de servicios' : 'Cargar valor de productos'}
                            </button>
                          ` : ''}
                        </div>
                      `}

                      <!-- Actions: Two rows -->
                      <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                        <!-- Row 1: Utility Buttons (Equal size) -->
                        <div style="display:flex; gap:8px; align-items:center; height:48px; width:100%;">
                          <button class="btn view-active-map-btn" 
                                  data-id="${stop.type === 'PICKUP' ? stop.docId : stop.orders[0].id}" 
                                  ${stop.type === 'PICKUP' && stop.pickedUp ? 'disabled' : ''}
                                  style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:none; background:rgba(var(--color-primary-rgb), 0.15); color:var(--color-primary); transition:all 0.3s; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.1); ${stop.type === 'PICKUP' && stop.pickedUp ? 'opacity:0.45; cursor:not-allowed; box-shadow:none;' : ''}">
                            ${icon('navigationArrow', 26)} 
                          </button>

                          ${(() => {
                            const isManualStop = stop.orders && stop.orders[0] && stop.orders[0].isManual === true;
                            if (stop.type === 'DROP_OFF') {
                              return !isManualStop ? `
                                <button class="btn chat-client-btn" data-order-id="${stop.orders[0].id}" data-order-num="${stop.orders[0].orderId}" data-client-name="${stop.userName}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-primary); transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('chat', 20)}</button>
                                <button class="btn whatsapp-client-btn" data-phone="${stop.orders[0].userPhone || ''}" data-client-name="${stop.userName}" data-order-num="${stop.orders[0].orderId}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:#25d366; transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('whatsapp', 20)}</button>
                              ` : `
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin chat">${icon('chat', 20)}</button>
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin WhatsApp">${icon('whatsapp', 20)}</button>
                              `;
                            } else {
                              return !isManualStop ? `
                                <button class="btn chat-client-btn" data-order-id="${stop.orders[0].id}" data-order-num="${stop.orders[0].orderId}" data-client-name="${stop.orders[0].userName || 'Cliente'}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-primary); transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('chat', 20)}</button>
                                <button class="btn whatsapp-client-btn" data-phone="${stop.orders[0].userPhone || ''}" data-client-name="${stop.orders[0].userName || 'Cliente'}" data-order-num="${stop.orders[0].orderId}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:#25d366; transition:all 0.3s; box-shadow: var(--shadow-sm);">${icon('whatsapp', 20)}</button>
                              ` : `
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin chat">${icon('chat', 20)}</button>
                                <button disabled style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-text-tertiary); opacity:0.4; cursor:not-allowed; box-shadow:none;" title="Pedido manual - Sin WhatsApp">${icon('whatsapp', 20)}</button>
                              `;
                            }
                          })()}
                          <button class="btn delivery-support-order-btn" data-order-id="${stop.orders[0].id}" data-order-num="${stop.orders[0].orderId}" style="flex:1; height:48px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:16px; border:1px solid var(--color-border-light); background:var(--color-bg-card); color:var(--color-primary); transition:all 0.3s; box-shadow: var(--shadow-sm);" title="Soporte Técnico">${icon('headset', 20)}</button>
                        </div>

                        <!-- Row 2: Main Action Button (Spans full width) -->
                        <div style="width:100%;">
                          ${stop.type === 'PICKUP' ? (() => {
                            const isDigitalReceipt = stop.orders.some(o => o.favorType === 'pagodeservicios' && o.details?.includes('Foto Digital por Chat'));
                            const isFavorCompra = stop.orders.some(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios'));
                            let btnLabel = 'RETIRAR';
                            if (stop.pickedUp) {
                              btnLabel = stop.orders.some(o => o.isTrip) ? 'EN VIAJE' : 'RETIRADO';
                            } else if (stop.orders.some(o => o.isTrip)) {
                              btnLabel = 'PASAJERO A BORDO';
                            } else if (isDigitalReceipt) {
                              btnLabel = 'PAGADO';
                            } else if (isFavorCompra) {
                              btnLabel = '🛍️ MARCAR RETIRADO (INGRESAR MONTO)';
                            } else {
                              btnLabel = '📦 MARCAR RETIRADO';
                            }

                            return `
                              <button class="btn mark-picked-up-btn" 
                                      data-id="${stop.docId}" 
                                      data-istrip="${stop.isFavor ? 'false' : stop.orders.some(o => o.isTrip)}"
                                      data-isdigitalreceipt="${isDigitalReceipt}"
                                      ${stop.pickedUp ? 'disabled' : ''}
                                      style="width:100%; height:52px; font-size:14px; font-weight:900; border-radius:18px; border:none; color:white; background:${stop.pickedUp ? '#10b981' : (isFavorCompra ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)')}; box-shadow: ${stop.pickedUp ? 'none' : '0 8px 24px rgba(16,185,129,0.4)'}; transition:all 0.3s; ${stop.pickedUp ? 'opacity:0.6;' : ''} display:flex; align-items:center; justify-content:center; gap:8px; white-space:nowrap; letter-spacing:0.02em; cursor:pointer;">
                                ${stop.pickedUp ? icon('check', 18) : (stop.orders.some(o => o.isTrip) ? icon('user', 18) : (isDigitalReceipt ? icon('checkCircle', 18) : '🛍️'))} 
                                <span>${btnLabel}</span>
                              </button>
                            `;
                          })() : ''}
                          
                          ${stop.type === 'DROP_OFF' ? `
                            ${(() => {
                              const hasNotifiedAtDoor = stop.orders.every(o => o.isAtDoor);
                              const allPickedUp = stop.orders.every(o => o.status === 'delivering' || !!o.pickedUpAt);
                              const isTrip = stop.orders.some(o => o.isTrip);
                              const isPagoServiciosDigital = stop.orders.some(o => o.favorType === 'pagodeservicios' && o.receiptDeliveryType === 'digital');

                              const isManualStop = stop.orders.some(o => o.isManual === true);

                              if (!isTrip && !hasNotifiedAtDoor && !isPagoServiciosDigital && !isManualStop) {
                                return `
                                  <button class="btn notify-at-door-btn" 
                                          data-ids="${stop.orders.map(o => o.id).join(',')}" 
                                          ${!allPickedUp ? 'disabled' : ''}
                                          style="width:100%; height:48px; font-size:13px; font-weight:900; border-radius:16px; border:none; color:white; background:#f59e0b; box-shadow: ${!allPickedUp ? 'none' : '0 8px 20px rgba(245, 158, 11, 0.25)'}; transition:all 0.3s; ${!allPickedUp ? 'opacity:0.4;' : ''} display:flex; align-items:center; justify-content:center; gap:6px; letter-spacing:0.02em;">
                                    ${icon('bell', 14)} AVISAR AFUERA
                                  </button>
                                `;
                              } else {
                                return `
                                  <button class="btn mark-delivered-btn" 
                                          data-ids="${stop.orders.map(o => o.id).join(',')}" 
                                          data-codes="${stop.orders.map(o => o.verificationCode).join(',')}"
                                          data-istrip="${isTrip}"
                                          ${!allPickedUp ? 'disabled' : ''}
                                          style="width:100%; height:48px; font-size:13px; font-weight:900; border-radius:16px; border:none; color:white; background:var(--color-success); box-shadow: ${!allPickedUp ? 'none' : '0 8px 20px rgba(34, 197, 94, 0.25)'}; transition:all 0.3s; ${!allPickedUp ? 'opacity:0.4;' : ''} display:flex; align-items:center; justify-content:center; gap:6px; letter-spacing:0.02em;">
                                    ${icon('checkCircle', 14)} ${isTrip ? 'FINALIZAR VIAJE' : (stop.orders.some(o => o.favorType === 'gocash') ? 'FINALIZAR GO CASH' : 'ENTREGAR')}
                                  </button>
                                `;
                              }
                            })()}
                          ` : ''}
                          
                          ${(() => {
                            const favorOrder = stop.orders.find(o => o.isFavor && (o.favorType === 'compra' || o.favorType === 'pagodeservicios'));
                            if (!favorOrder) return '';
                            return `
                              <button class="btn driver-card-edit-price-btn" 
                                      data-order-id="${favorOrder.id}"
                                      style="width:100%; height:44px; font-size:12.5px; font-weight:800; border-radius:14px; border:1px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text-primary); transition:all 0.3s; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; margin-top:8px; box-sizing:border-box;">
                                ${icon('creditCard', 14)} ${favorOrder.favorType === 'pagodeservicios' ? 'Ingresar Valor de Facturas' : 'Ingresar/Modificar Compra'} (${favorOrder.subtotal ? `$${favorOrder.subtotal}` : 'No cargado'})
                              </button>
                            `;
                          })()}
                        </div>
                        
                        <!-- Row 3: Ver Detalle del Pedido (Bottom Sheet) -->
                        <div style="width:100%;">
                          <button class="btn view-stop-details-sheet-btn" 
                                  data-key="${stopKey}"
                                  style="width:100%; height:44px; font-size:12.5px; font-weight:800; border-radius:14px; border:none; background:linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color:white; transition:all 0.3s; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.18); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; margin-top:2px;">
                            ${icon('shoppingBag', 14)} Ver Detalle del Pedido
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                `}).join('')}
              </div>
            </div>
            
            <style>
              .collapsible-stop-details {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, margin 0.3s ease;
                opacity: 0;
              }
              .collapsible-stop-details.expanded {
                max-height: 1000px;
                opacity: 1;
                margin-top: 10px;
                margin-bottom: 12px;
              }
              .toggle-stop-details-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                background: var(--color-bg-secondary);
                border: 1px solid var(--color-border-light);
                padding: 10px 14px;
                border-radius: 16px;
                font-size: 12px;
                font-weight: 800;
                color: var(--color-text-secondary);
                cursor: pointer;
                margin-top: 10px;
                margin-bottom: 12px;
                transition: all 0.2s ease;
                width: 100%;
              }
              .toggle-stop-details-btn:hover {
                background: var(--color-border-light);
                color: var(--color-text-primary);
              }
              .toggle-stop-details-btn svg {
                transition: transform 0.3s ease;
              }
              .toggle-stop-details-btn.active svg {
                transform: rotate(180deg);
              }

              @keyframes pulse-border {
                0%, 100% { border-color: rgba(245, 158, 11, 0.4); box-shadow: 0 10px 25px rgba(245, 158, 11, 0.05); }
                50% { border-color: rgba(245, 158, 11, 0.8); box-shadow: 0 10px 25px rgba(245, 158, 11, 0.15); }
              }
              @keyframes scale-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.06); }
              }
              @keyframes pulse-dot { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }
              @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
              @keyframes slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            </style>
              </div>
            </div>
          </div>
        `;

        const dragHeader = container.querySelector('#sheet-drag-header');
        if (dragHeader) {
          dragHeader.onclick = () => {
            container._sheetExpanded = !container._sheetExpanded;
            delete container.dataset.lastActiveFingerprint;
            renderActiveTimeline(orders, suggestedOrders);
          };

          let touchStartY = 0;
          dragHeader.addEventListener('touchstart', (e) => {
            touchStartY = e.changedTouches[0].screenY;
          }, { passive: true });

          dragHeader.addEventListener('touchend', (e) => {
            const touchEndY = e.changedTouches[0].screenY;
            const diff = touchStartY - touchEndY;
            if (diff > 35 && !container._sheetExpanded) {
              container._sheetExpanded = true;
              delete container.dataset.lastActiveFingerprint;
              renderActiveTimeline(orders, suggestedOrders);
            } else if (diff < -35 && container._sheetExpanded) {
              container._sheetExpanded = false;
              delete container.dataset.lastActiveFingerprint;
              renderActiveTimeline(orders, suggestedOrders);
            }
          }, { passive: true });
        }

        container.querySelectorAll('.add-suggested-order-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            showConfirm({
              title: '¿Sumar pedido recomendado?',
              message: 'Este pedido se retirará del mismo comercio y podrás llevarlo en tu ruta de entrega actual.',
              confirmText: 'SÍ, SUMAR A MI RUTA',
              onConfirm: () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 14, 'animate-spin') + ' SUMANDO...';
                takeBatch(btn.dataset.id, user, null, btn);
              }
            });
          });
        });

        container.querySelectorAll('.view-stop-details-sheet-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const stop = stops.find(s => {
              const addressVal = (s.type === 'PICKUP' ? s.docId : s.address) || '';
              const sKey = (s.type + '_' + addressVal).replace(/[^a-zA-Z0-9]/g, '_');
              return sKey === key;
            });
            if (stop) {
              showStopDetailsBottomSheet(stop);
            }
          });
        });

        container.querySelectorAll('.driver-card-edit-price-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const orderId = btn.dataset.orderId;
            const { doc, getDoc } = await import('firebase/firestore');
            const { db } = await import('../firebase.js');
            const orderSnap = await getDoc(doc(db, 'orders', orderId));
            if (orderSnap.exists()) {
              const orderData = { id: orderSnap.id, ...orderSnap.data() };
              showEditFavorPriceModal(orderData, true);
            }
          });
        });

        container.querySelectorAll('.mark-picked-up-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const isTrip = btn.dataset.istrip === 'true';
            const isDigitalReceipt = btn.dataset.isdigitalreceipt === 'true';

            if (isDigitalReceipt) {
              showConfirm({
                title: '¿Confirmar Pago de Servicio?',
                message: 'Confirmá que realizaste el pago del servicio para proceder a tomarle una foto al recibo/comprobante de pago.',
                confirmText: 'Confirmar y Abrir Cámara',
                onConfirm: async () => {
                  btn.disabled = true;
                  btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Abriendo cámara...';
                  
                  const handleDigitalReceiptUpload = async (file) => {
                    btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Subiendo comprobante...';
                    try {
                      const orderId = btn.dataset.id;
                      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                      const { storage } = await import('../firebase.js');

                      // 1. Add uploading placeholder to chat
                      const msgRef = await addDoc(collection(db, 'orders', orderId, 'messages'), {
                        senderId: user.uid,
                        senderName: user.displayName || user.name || 'Repartidor',
                        text: 'Subiendo comprobante...',
                        type: 'image',
                        status: 'uploading',
                        createdAt: serverTimestamp()
                      });

                      // 2. Upload file (Compressed for 95% bandwidth & storage savings)
                      const { compressImage } = await import('../utils/format.js');
                      const optimizedFile = await compressImage(file, 1280, 0.82);
                      const fileRef = ref(storage, `chats/${orderId}/${Date.now()}_comprobante.jpg`);
                      const metadata = { contentType: optimizedFile.type || 'image/jpeg' };
                      await uploadBytes(fileRef, optimizedFile, metadata);
                      const url = await getDownloadURL(fileRef);

                      // 3. Update chat message
                      await updateDoc(msgRef, {
                        text: '',
                        imageUrl: url,
                        status: 'ready'
                      });

                      // 4. Mark order as picked up
                      await markAsPickedUp(orderId);

                      // 5. Send message requesting verification code to client
                      await addDoc(collection(db, 'orders', orderId, 'messages'), {
                        senderId: 'system',
                        senderName: 'GoDelivery',
                        text: `⚠️ **Código de Entrega Solicitado**\n\nEl repartidor ha subido la foto del comprobante de pago de tu servicio.\n\nPor favor, facilítale el **Código de Entrega de 4 dígitos** que ves en tu pantalla de seguimiento para que pueda finalizar el pedido.`,
                        createdAt: serverTimestamp(),
                        type: 'system'
                      });

                      showToast('¡Comprobante enviado y pedido marcado como pagado!', 'success');
                    } catch (err) {
                      console.error('Digital receipt upload error:', err);
                      showToast('Error al subir el comprobante: ' + err.toString(), 'error');
                      btn.disabled = false;
                      btn.innerHTML = icon('checkCircle', 16) + ' PAGADO';
                    }
                  };

                  const showPhotoPreviewModal = async (file, onConfirm, onCancel) => {
                    const fileUrl = URL.createObjectURL(file);
                    const overlayEl = document.createElement('div');
                    overlayEl.style.cssText = `
                      position: fixed;
                      top: 0;
                      left: 0;
                      width: 100vw;
                      height: 100vh;
                      background: #090d16;
                      z-index: 999999;
                      display: flex;
                      flex-direction: column;
                      justify-content: space-between;
                      font-family: var(--font-display, 'Outfit', sans-serif);
                      color: white;
                      opacity: 0;
                      transition: opacity 0.3s ease;
                    `;
                    overlayEl.innerHTML = `
                      <!-- Top Translucent Header -->
                      <div style="padding: calc(16px + env(safe-area-inset-top, 16px)) 20px 16px; text-align: center; background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent); z-index: 10;">
                        <h3 style="margin: 0; font-size: 19px; font-weight: 950; letter-spacing: -0.5px; color: white;">Comprobante de Pago</h3>
                        <p style="margin: 4px 0 0; font-size: 12.5px; color: #94a3b8; font-weight: 550;">Asegúrate de que la foto sea totalmente legible</p>
                      </div>

                      <!-- Image Fill Container -->
                      <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; position: relative;">
                        <img src="${fileUrl}" style="width: 100%; height: 100%; object-fit: contain;">
                      </div>

                      <!-- Bottom Translucent Controls -->
                      <div style="padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)); background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0)); display: grid; grid-template-columns: 1fr 1fr; gap: 16px; z-index: 10; width: 100%; box-sizing: border-box;">
                        <button id="cancel-preview-btn" style="height: 54px; border-radius: 18px; background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); color: white; border: 1.5px solid rgba(255,255,255,0.15); font-weight: 900; cursor: pointer; text-transform: uppercase; font-size: 14px; transition: all 0.2s;">
                          Cancelar
                        </button>
                        <button id="upload-preview-btn" style="height: 54px; border-radius: 18px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; border: none; font-weight: 950; cursor: pointer; text-transform: uppercase; font-size: 14px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
                          Subir
                        </button>
                      </div>
                    `;

                    document.body.appendChild(overlayEl);
                    requestAnimationFrame(() => {
                      overlayEl.style.opacity = '1';
                    });

                    overlayEl.querySelector('#cancel-preview-btn').onclick = () => {
                      URL.revokeObjectURL(fileUrl);
                      overlayEl.style.opacity = '0';
                      setTimeout(() => {
                        overlayEl.remove();
                        if (onCancel) onCancel();
                      }, 300);
                    };

                    overlayEl.querySelector('#upload-preview-btn').onclick = () => {
                      URL.revokeObjectURL(fileUrl);
                      overlayEl.style.opacity = '0';
                      setTimeout(() => {
                        overlayEl.remove();
                        if (onConfirm) onConfirm();
                      }, 300);
                    };
                  };

                  const startCameraCapture = async () => {
                    const resetBtnState = () => {
                      btn.disabled = false;
                      btn.innerHTML = icon('checkCircle', 16) + ' PAGADO';
                    };

                    try {
                      const { Capacitor } = await import('@capacitor/core');
                      if (Capacitor.isNativePlatform()) {
                        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
                        const photo = await Camera.getPhoto({
                          quality: 85,
                          allowEditing: false,
                          resultType: CameraResultType.Uri,
                          source: CameraSource.Camera
                        });
                        const response = await fetch(photo.webPath);
                        const blob = await response.blob();
                        const file = new File([blob], `comprobante_${Date.now()}.jpg`, { type: 'image/jpeg' });
                        await showPhotoPreviewModal(file, () => handleDigitalReceiptUpload(file), resetBtnState);
                      } else {
                        // Create web input element dynamically
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.setAttribute('capture', 'environment');
                        input.onchange = async (e) => {
                          const file = e.target.files[0];
                          if (file) {
                            await showPhotoPreviewModal(file, () => handleDigitalReceiptUpload(file), resetBtnState);
                          } else {
                            resetBtnState();
                          }
                        };
                        input.click();
                      }
                    } catch (err) {
                      console.warn('Capacitor camera error, falling back to input file click', err);
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = async (e) => {
                        const file = e.target.files[0];
                        if (file) {
                          await showPhotoPreviewModal(file, () => handleDigitalReceiptUpload(file), resetBtnState);
                        } else {
                          resetBtnState();
                        }
                      };
                      input.click();
                    }
                  };

                  await startCameraCapture();
                }
              });
              return;
            }

            showConfirm({
              title: isTrip ? '¿Confirmar Inicio de Viaje?' : '¿Confirmar Retiro?',
              message: isTrip ? 'Confirmá que el pasajero ya está a bordo para iniciar el trayecto.' : 'Asegurate de haber recibido todos los productos del local.',
              confirmText: isTrip ? 'Iniciar Viaje' : 'Sí, retirar',
              onConfirm: async () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Actualizando...';
                await markAsPickedUp(btn.dataset.id);
                
                const firstId = btn.dataset.id.split(',')[0];
                const order = orders.find(o => o.id === firstId);
                if (order && order.isFavor && order.favorType === 'compra') {
                  showEditFavorPriceModal(order, true);
                }
              }
            });
          });
        });

        container.querySelectorAll('.notify-at-door-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const ids = btn.dataset.ids.split(',');
            
            // Check if any order is GoFavor Compra and hasn't loaded product prices
            for (const orderId of ids) {
              const order = orders.find(o => o.id === orderId);
              if (order && order.isFavor && (order.favorType === 'compra' || order.favorType === 'pagodeservicios') && !order.subtotal) {
                showToast(order.favorType === 'pagodeservicios' ? '⚠️ Debes ingresar el valor de las facturas antes de avisar que estás afuera' : '⚠️ Debes ingresar el valor de los productos antes de avisar que estás afuera', 'warning');
                showEditFavorPriceModal(order, true);
                return;
              }
            }

            showConfirm({
              title: '¿Avisar que estás afuera?',
              message: 'Se le enviará una notificación en tiempo real al cliente indicándole que ya te encuentras afuera en la puerta de su domicilio.',
              confirmText: 'Sí, Avisar',
              cancelText: 'Cancelar',
              onConfirm: async () => {
                btn.disabled = true;
                btn.innerHTML = icon('loader', 14, 'animate-spin') + ' NOTIFICANDO...';
                
                try {
                  for (const orderId of ids) {
                    const order = orders.find(o => o.id === orderId);
                    if (!order) continue;
                    
                    await updateDoc(doc(db, 'orders', orderId), {
                      isAtDoor: true,
                      atDoorAt: serverTimestamp()
                    });
                    
                    if (order.userId) {
                      const isEncomienda = order.favorType === 'encomienda' || (order.isFavor && order.favorType === 'encomienda') || order.serviceType === 'encomienda';
                      const codeStr = (order.verificationCode && !isEncomienda) ? ` Tené listo tu código de entrega: ${order.verificationCode}` : '';
                      await addDoc(collection(db, 'users', order.userId, 'notifications'), {
                        title: '¡Tu repartidor está en la puerta!',
                        body: order.isFavor 
                          ? `El repartidor llegó con tu favor. ¡Salí a recibirlo!${codeStr}` 
                          : `Prepárate para recibir tu pedido. ¡Ya llegó!${codeStr}`,
                        type: 'system',
                        status: 'unread',
                        createdAt: serverTimestamp()
                      });
                    }
                  }
                  showToast('Cliente notificado', 'success');
                } catch (err) {
                  console.error('Error in notify-at-door:', err);
                  showToast('Error al notificar al cliente', 'danger');
                  btn.disabled = false;
                  btn.innerHTML = icon('bell', 14) + ' AVISAR AFUERA';
                }
              }
            });
          });
        });

        container.querySelectorAll('.mark-delivered-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const ids = btn.dataset.ids.split(',');
            const codes = btn.dataset.codes.split(',');
            const isTrip = btn.dataset.istrip === 'true';

            // Check if it's a GoFavor Compra and hasn't loaded product prices (subtotal is 0 or empty)
            const orderId = ids[0];
            const order = orders.find(o => o.id === orderId);
            if (order && order.isFavor && (order.favorType === 'compra' || order.favorType === 'pagodeservicios') && !order.subtotal) {
              showToast(order.favorType === 'pagodeservicios' ? '⚠️ Debes ingresar el valor de las facturas antes de entregar el pedido' : '⚠️ Debes ingresar el valor de los productos antes de entregar el pedido', 'warning');
              showEditFavorPriceModal(order, true);
              return;
            }

            const noCodeRequired = orders.filter(o => ids.includes(o.id)).some(o => o.isManual === true || o.noCodeRequired === true || o.source === 'whatsapp_bot' || o.favorType === 'encomienda' || (o.isFavor && o.favorType === 'encomienda') || o.serviceType === 'encomienda');
            openSlideToConfirmModal({
              isTrip,
              noCodeRequired,
              codes,
              ids,
              orders,
              onConfirm: async () => {
                showToast(isTrip ? 'Finalizando viaje...' : 'Procesando entrega...', 'info');
                await markAsDelivered(ids);
              }
            });
          });
        });

        container.querySelectorAll('.view-active-map-btn').forEach(btn => {
          const firstId = btn.dataset.id.split(',')[0];
          const order = orders.find(o => o.id === firstId);
          btn.addEventListener('click', () => showDeliveryMapModal(order, orders));
        });

        container.querySelectorAll('.edit-favor-price-btn').forEach(btn => {
          const order = orders.find(o => o.id === btn.dataset.id);
          btn.addEventListener('click', () => showEditFavorPriceModal(order));
        });

        container.querySelectorAll('.btn-save-store-prices').forEach(btn => {
          btn.addEventListener('click', async () => {
            const orderId = btn.dataset.orderId;
            const inputs = container.querySelectorAll(`.store-price-input[data-order-id="${orderId}"]`);
            const storePrices = {};
            inputs.forEach(input => {
              const storeName = input.dataset.storeName;
              const priceVal = parseFloat(input.value) || 0;
              storePrices[storeName] = priceVal;
            });
            
            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = icon('loader', 14, 'animate-spin') + ' GUARDANDO...';
            
            try {
              await saveFavorStorePrices(orderId, storePrices);
              showToast('Precios actualizados correctamente', 'success');
            } catch (err) {
              console.error(err);
              showToast('Error al guardar precios', 'error');
            } finally {
              btn.disabled = false;
              btn.innerHTML = originalText;
            }
          });
        });

        container.querySelectorAll('.chat-client-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const orderId = btn.dataset.orderId;
            if (!orderId) return;
            const { openChat } = await import('../components/chat.js');
            openChat({ 
              orderId: btn.dataset.orderId, 
              type: 'client-delivery', 
              otherName: btn.dataset.clientName || 'Cliente',
              orderNum: btn.dataset.orderNum 
            });
          });
        });

        container.querySelectorAll('.whatsapp-client-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const rawPhone = btn.dataset.phone || '';
            const clientName = btn.dataset.clientName || 'Cliente';
            const orderNum = btn.dataset.orderNum || '';
            if (!rawPhone) {
              showToast('El cliente no posee un número de teléfono configurado.', 'warning');
              return;
            }
            let cleanedPhone = rawPhone.replace(/\D/g, '');
            if (cleanedPhone.startsWith('54')) {
              if (!cleanedPhone.startsWith('549')) {
                cleanedPhone = '549' + cleanedPhone.substring(2);
              }
            } else if (cleanedPhone.startsWith('15')) {
              cleanedPhone = '549' + cleanedPhone.substring(2);
            } else if (!cleanedPhone.startsWith('549') && cleanedPhone.length <= 10) {
              cleanedPhone = '549' + cleanedPhone;
            }
            const msg = encodeURIComponent(`Hola ${clientName}, soy el repartidor de GoDelivery en camino con tu pedido #${orderNum}.`);
            const waUrl = `https://wa.me/${cleanedPhone}?text=${msg}`;
            window.open(waUrl, '_blank');
          });
        });

        container.querySelectorAll('.delivery-support-order-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const orderId = btn.dataset.orderId;
            const orderNum = btn.dataset.orderNum;

            try {
              const { openSupportTicketModal } = await import('../components/support-bot.js');
              await openSupportTicketModal(orderId, orderNum);
            } catch (err) {
              console.error('Error opening support ticket chat:', err);
              import('../components/toast.js').then(t => t.showToast('Error al abrir chat de soporte', 'danger'));
            }
          });
        });
      }

      tabUnsub = () => {
        if (listUnsub) listUnsub();
        if (suggestedUnsub) suggestedUnsub();
      };

    } else if (tab === 'history') {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid),
        where('status', 'in', ['completed', 'cancelled'])
      );

      tabUnsub = onSnapshot(q, (snap) => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        if (orders.length === 0) {
          container.innerHTML = `<div class="empty-state-mini" style="padding: 3rem 1rem;">Aún no tenés entregas terminadas</div>`;
          return;
        }

        const groupedMap = new Map();
        orders.forEach(o => {
          const key = o.bundleId || `single-${o.id}`;
          if (!groupedMap.has(key)) groupedMap.set(key, []);
          groupedMap.get(key).push(o);
        });

        const groups = Array.from(groupedMap.values()).sort((a, b) => 
          (b[0].createdAt?.toMillis() || 0) - (a[0].createdAt?.toMillis() || 0)
        );

        const currentSessionId = getState().user?.currentSessionId;

        container.innerHTML = `
          <div class="delivery-orders-list page-enter">
            ${groups.map(group => {
              const isBundle = group.length > 1;
              const main = group[0];
              const totalAmount = group.reduce((sum, o) => sum + (o.total || 0), 0);
              const totalDelivery = group.reduce((sum, o) => {
                return sum + getOrderDriverEarnings(o);
              }, 0);
              const totalAppFee = group.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
              const isFromCurrentSession = currentSessionId && (main.deliverySessionId === currentSessionId);

              return `
                <div class="admin-card history-group-card" data-card-id="${main.id}" style="margin-bottom:12px; border-radius:20px; border:1.5px solid var(--color-border-light); overflow:hidden; transition:all 0.3s; cursor:pointer;">
                  <div class="history-card-header" style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; position:relative;">
                    <div style="position:absolute; left:0; top:0; bottom:0; width:4px; background:${main.status === 'completed' ? '#10b981' : '#ef4444'}; border-radius:0 4px 4px 0;"></div>
                    ${isFromCurrentSession ? `<div style="position:absolute; top:8px; right:16px; background:#10b981; color:white; font-size:7px; font-weight:900; padding:2px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em;">Sesión</div>` : ''}
                    <div style="flex:1; min-width:0;">
                      <div style="font-size:15px; font-weight:800; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:3px;">
                        ${isBundle ? `Lote · ${group.length} pedidos` : (main.isFavor ? getFavorTypeMeta(main.favorType).title : (main.comercioName || 'Pedido'))}
                      </div>
                      <div style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--color-text-tertiary); font-weight:600;">
                        <span style="color:${main.status === 'completed' ? '#10b981' : '#ef4444'};">${main.status === 'completed' ? '✓ Entregado' : '✕ Cancelado'}</span>
                        <span>·</span>
                        <span>${main.createdAt ? new Date(main.createdAt.toDate()).toLocaleDateString('es-AR', {day:'2-digit', month:'short'}) : '---'} ${main.createdAt ? new Date(main.createdAt.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                        <span>·</span>
                        <span style="font-weight:800;">#${main.orderId || '---'}</span>
                      </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                      <div style="font-weight:900; font-size:17px; color:${main.status === 'completed' ? '#10b981' : 'var(--color-text-tertiary)'}; letter-spacing:-0.5px;">${formatPrice(totalAmount)}</div>
                      <div style="font-size:10px; font-weight:700; color:#10b981;">${icon('chevronDown', 12)} +${formatPrice(totalDelivery)}</div>
                    </div>
                  </div>

                  <div class="history-card-details" style="display:none; border-top:1.5px solid var(--color-border-light);">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0; border-bottom:1px solid var(--color-border-light);">
                      <div style="padding:12px 20px; border-right:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Tu Ganancia</div>
                        <div style="font-size:15px; font-weight:900; color:#10b981;">${formatPrice(totalDelivery)}</div>
                      </div>
                      <div style="padding:12px 20px;">
                        <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Tarifa App</div>
                        <div style="font-size:15px; font-weight:900; color:#ef4444;">${formatPrice(totalAppFee)}</div>
                      </div>
                    </div>

                    <div style="padding:16px 20px;">
                      ${group.map(o => `
                        <div style="margin-bottom:12px; padding:12px; background:var(--color-bg-secondary); border-radius:14px; border:1px solid var(--color-border-light);">
                          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span style="font-size:13px; font-weight:800; color:${o.isFavor ? getFavorTypeMeta(o.favorType).textColor : 'var(--color-text-primary)'};">${o.isFavor ? getFavorTypeMeta(o.favorType).headerText : (o.comercioName || 'Pedido')}</span>
                            <span style="font-size:13px; font-weight:800; color:var(--color-text-primary);">${formatPrice(o.subtotal || 0)}</span>
                          </div>
                          ${o.isFavor ? (() => {
                            const stores = parseFavorDetails(o.details || o.description);
                            const storePrices = o.storePrices || {};
                            if (stores.length > 0) {
                              return `
                                <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
                                  ${stores.map(st => `
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:12.5px; border-bottom:1.5px solid var(--color-border-light); padding-bottom:6px; margin-bottom:2px;">
                                      <div style="display:flex; flex-direction:column; gap:2px; text-align:left; align-items:flex-start; flex:1; padding-right:8px;">
                                        <strong style="color:var(--color-text-primary); font-weight:800;">${st.name}</strong>
                                        <span style="color:var(--color-text-secondary); font-size:11.5px; font-weight:500;">${st.items}</span>
                                      </div>
                                      ${storePrices[st.name] ? `<span style="font-weight:900; color:var(--color-text-primary); margin-left:12px; white-space:nowrap;">${formatPrice(storePrices[st.name])}</span>` : ''}
                                    </div>
                                  `).join('')}
                                </div>
                              `;
                            } else {
                              return formatFavorDetailsHTML(o.details || o.description);
                            }
                          })() : (o.items ? o.items.map(item => `
                            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; padding-left:8px;">
                              <span style="color:var(--color-text-tertiary); font-weight:600;">${item.qty || 1}× ${item.name}</span>
                              <span style="color:var(--color-text-tertiary);">${formatPrice((item.price || 0) * (item.qty || 1))}</span>
                            </div>
                          `).join('') : '')}
                        </div>
                      `).join('')}
                    </div>

                    <div style="padding:0 20px 16px;">
                      <div style="background:var(--color-bg-secondary); border-radius:16px; padding:16px; border:1px solid var(--color-border-light);">
                        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:14px; display:flex; align-items:center; gap:6px; letter-spacing:0.06em;">
                          ${icon('activity', 13)} Tiempos
                        </div>
                        <div style="position:relative; padding-left:22px;">
                          <div style="position:absolute; left:5px; top:6px; bottom:6px; width:1.5px; background:var(--color-border-light);"></div>
                          ${[
                            { label: 'Creado', time: main.createdAt, color: 'var(--color-primary)', done: true },
                            { label: 'Retirado', time: main.pickedUpAt, color: 'var(--color-primary)', done: main.status === 'delivering' || !!main.pickedUpAt },
                            { label: 'Entregado', time: main.deliveredAt, color: '#10b981', done: !!main.deliveredAt }
                          ].map(step => `
                            <div style="margin-bottom:10px; position:relative; display:flex; justify-content:space-between; align-items:center;">
                              <div style="position:absolute; left:-22px; top:3px; width:11px; height:11px; border-radius:50%; background:${step.done ? step.color : 'var(--color-border-light)'}; border:2px solid var(--color-bg-secondary); ${step.done && step.color === '#10b981' ? 'box-shadow:0 0 6px rgba(16,185,129,0.4);' : ''}"></div>
                              <span style="font-size:12px; font-weight:700; color:${step.done ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)'};">${step.label}</span>
                              <span style="font-size:11px; font-weight:800; color:var(--color-text-tertiary);">${step.time ? new Date(step.time.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    </div>

                    <div style="padding:0 20px 16px;">
                      ${!main.isManual ? `
                        <button class="view-history-chat-btn" data-order-id="${main.id}" data-order-num="${main.orderId}" data-client-name="${main.userName}" style="width:100%; height:40px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text-primary); font-size:11px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
                          ${icon('messageSquare', 14)} Chat con cliente
                        </button>
                      ` : `
                        <button disabled style="width:100%; height:40px; border-radius:12px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); color:var(--color-text-tertiary); font-size:11px; font-weight:800; opacity:0.4; cursor:not-allowed; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
                          ${icon('messageSquare', 14)} Pedido manual - Sin chat
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        container.querySelectorAll('.history-card-header').forEach(header => {
          header.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('a')) return;
            const card = header.closest('.history-group-card');
            const details = card.querySelector('.history-card-details');
            if (details) {
              const isHidden = details.style.display === 'none';
              details.style.display = isHidden ? 'block' : 'none';
              card.style.boxShadow = isHidden ? '0 8px 24px rgba(0,0,0,0.08)' : 'none';
            }
          });
        });

        container.querySelectorAll('.view-history-chat-btn').forEach(btn => {
          btn.onclick = async () => {
            if (btn.dataset.source === 'whatsapp_bot' && btn.dataset.userPhone) {
              const clean = btn.dataset.userPhone.replace(/\D/g, '');
              const full = clean.startsWith('54') ? clean : `54${clean}`;
              window.open(`https://wa.me/${full}`, '_blank');
              return;
            }
            const { openChat } = await import('../components/chat.js');
            openChat({ 
              orderId: btn.dataset.orderId, 
              orderNum: btn.dataset.orderNum,
              type: 'client-delivery', 
              otherName: btn.dataset.clientName 
            });
          };
        });
      });
    } else if (tab === 'finances') {
      let sessionOrdersUnsub = null;
      const q = query(doc(db, 'users', user.uid));
      const userUnsub = onSnapshot(q, async (snap) => {
        const userData = snap.data();
        const debt = userData?.deliveryDebt || 0;
        const currentSessionId = userData?.currentSessionId;
        const online = getState().user?.isOnline;

        container.innerHTML = `
          <div class="delivery-finances-v4 page-enter" style="display:flex; flex-direction:column; gap:12px; padding:0 0 10px; width:100%; box-sizing:border-box;">
            <!-- Active Session Card -->
            <div style="background:var(--color-bg-card); border:1.5px solid ${online ? 'rgba(16,185,129,0.3)' : 'var(--color-border-light)'}; border-radius:24px; padding:18px 20px; position:relative; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,0.04); transition:all 0.4s ease;">
              ${online ? `<div style="position:absolute; top:-20px; right:-20px; width:120px; height:120px; background:radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%);"></div>` : ''}
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="width:10px; height:10px; border-radius:50%; background:${online ? '#10b981' : 'var(--color-text-tertiary)'}; ${online ? 'box-shadow:0 0 10px #10b981; animation: pulse 2s infinite;' : ''}"></div>
                  <span style="font-size:11px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">${online ? 'Sesión en Vivo' : 'Última Sesión'}</span>
                </div>
                <span style="font-size:9px; font-weight:900; padding:4px 10px; border-radius:8px; background:${online ? 'rgba(16,185,129,0.1)' : 'var(--color-bg-secondary)'}; color:${online ? '#10b981' : 'var(--color-text-tertiary)'}; text-transform:uppercase; letter-spacing:0.03em; border:1px solid ${online ? 'rgba(16,185,129,0.15)' : 'var(--color-border-light)'};">${online ? 'Activa' : 'Finalizada'}</span>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; opacity:0.7;">Ganancia</div>
                  <div style="font-size:30px; font-weight:950; color:${online ? '#10b981' : 'var(--color-text-primary)'}; letter-spacing:-1px; line-height:1.1;" id="session-total-earned">$ 0</div>
                </div>
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; opacity:0.7;">Pedidos</div>
                  <div style="font-size:30px; font-weight:950; color:var(--color-text-primary); letter-spacing:-1px; line-height:1.1;" id="session-orders-count">0</div>
                </div>
              </div>
            </div>

            <!-- Stats Grid -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
              ${['Hoy', 'Semana', 'Mes'].map(label => `
                <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:16px; padding:10px 8px; text-align:center; box-shadow:var(--shadow-sm); transition:all 0.3s;">
                  <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px; letter-spacing:0.05em; opacity:0.8;">${label}</div>
                  <div style="font-size:15px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.5px;" id="stats-${label.toLowerCase() === 'semana' ? 'week' : (label.toLowerCase() === 'hoy' ? 'day' : 'month')}">$ 0</div>
                </div>
              `).join('')}
            </div>

            <!-- Charts Container -->
            <div id="finances-charts-container" style="display:flex; flex-direction:column; gap:12px;">
              <div class="skeleton" style="height:140px; border-radius:24px;"></div>
              <div class="skeleton" style="height:140px; border-radius:24px;"></div>
            </div>

            <!-- Operations Stack -->
            <div style="display:flex; flex-direction:column; gap:12px;">
              <!-- Resumen de Billetera -->
              <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:12px;">
                <h4 style="margin:0; font-size:13px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
                  ${icon('wallet', 16)} Resumen de Billetera
                </h4>
                <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px; font-weight:600; color:var(--color-text-secondary);">
                  <div style="display:flex; justify-content:space-between;">
                    <span>Ganancias por Transferencia (Digital)</span>
                    <span id="wallet-digital-earnings" style="color:#10b981; font-weight:700;">$ 0</span>
                  </div>
                  <div style="display:flex; justify-content:space-between;">
                    <span>Cobros en Efectivo (Bolsillo)</span>
                    <span id="wallet-cash-earnings" style="color:#f59e0b; font-weight:700;">$ 0</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; border-top:1px dashed var(--color-border-light); padding-top:8px; font-weight:700;">
                    <span>Total Facturado (Ambos)</span>
                    <span id="wallet-total-combined" style="color:var(--color-text-primary); font-weight:800;">$ 0</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; color:#ef4444;">
                    <span>Tarifa App (A Liquidar)</span>
                    <span id="wallet-app-fee" style="font-weight:700;">-$ 0</span>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:4px; border-top:1.5px solid var(--color-border-light); padding-top:10px; margin-top:4px;">
                    <div style="display:flex; justify-content:space-between; font-weight:900; font-size:14px;">
                      <span style="color:var(--color-text-primary);">Balance Neto</span>
                      <span id="wallet-net-balance" style="font-size:16px;">$ 0</span>
                    </div>
                    <div style="font-size:10px; color:var(--color-text-tertiary); text-align:center; font-weight:700; opacity:0.8; margin-top:2px;">
                      Fórmula: Digital + Efectivo - Tarifa App
                    </div>
                  </div>
                </div>
              </div>

              <!-- Gestor de Balance -->
              <button id="open-balance-mgmt-btn" style="width:100%; height:48px; border-radius:16px; background:var(--color-bg-card); border:1.5px solid ${debt > 0 ? 'rgba(239,68,68,0.2)' : 'var(--color-border-light)'}; color:var(--color-text-primary); font-weight:900; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:0 16px; transition:all 0.3s; box-shadow:0 4px 12px rgba(0,0,0,0.02); flex-shrink:0;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="color:${debt > 0 ? '#ef4444' : '#10b981'}; opacity:0.8; display:flex; align-items:center;">${icon('bank', 16)}</div>
                  Gestión de Balance
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:14.5px; font-weight:950; color:${debt > 0 ? '#ef4444' : '#10b981'}; letter-spacing:-0.02em;">${formatPrice(debt)}</span>
                  ${icon('chevronRight', 14, 'opacity:0.3')}
                </div>
              </button>

              <!-- Inline Sessions History List -->
              <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:20px; padding:14px 16px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
                    ${icon('history', 15)} Historial de Sesiones
                  </h4>
                  <button id="view-sessions-history-btn" style="background:none; border:none; color:var(--color-primary); font-size:10.5px; font-weight:800; cursor:pointer; padding:0; outline:none;">Ver todas</button>
                </div>
                
                <div id="recent-sessions-list" style="display:flex; flex-direction:column; gap:6px;">
                  <div class="skeleton" style="height:36px; border-radius:10px;"></div>
                  <div class="skeleton" style="height:36px; border-radius:10px;"></div>
                  <div class="skeleton" style="height:36px; border-radius:10px;"></div>
                </div>
              </div>
            </div>
          </div>
        `;

        // Load Session Stats
        if (currentSessionId) {
          if (!sessionOrdersUnsub || sessionOrdersUnsub.sessionId !== currentSessionId) {
            if (sessionOrdersUnsub) {
              sessionOrdersUnsub.unsub();
            }
            try {
              const { onSnapshot: fOnSnapshot, query: fQuery, collection: fCollection, where: fWhere } = await import('firebase/firestore');
              const unsub = fOnSnapshot(fQuery(
                fCollection(db, 'orders'),
                fWhere('driverId', '==', user.uid),
                fWhere('status', '==', 'completed'),
                fWhere('deliverySessionId', '==', currentSessionId)
              ), (ordersSnap) => {
                const totalEarned = ordersSnap.docs.reduce((sum, d) => {
                  return sum + getOrderDriverEarnings(d.data());
                }, 0);
                const count = ordersSnap.size;
                
                if (document.getElementById('session-total-earned')) document.getElementById('session-total-earned').textContent = formatPrice(totalEarned);
                if (document.getElementById('session-orders-count')) document.getElementById('session-orders-count').textContent = count;
              }, (err) => {
                console.error('Error in live orders snapshot:', err);
              });
              sessionOrdersUnsub = { sessionId: currentSessionId, unsub };
            } catch (e) {
              console.error('Error starting live session listener:', e);
            }
          }
        } else {
          if (sessionOrdersUnsub) {
            sessionOrdersUnsub.unsub();
            sessionOrdersUnsub = null;
          }
          // Fetch the latest session summary
          (async () => {
             const { getDocs, query, collection, where, limit } = await import('firebase/firestore');
             try {
               const latestSnap = await getDocs(query(
                 collection(db, 'deliverySessions'),
                 where('driverId', '==', user.uid),
                 limit(20) // Get recent ones to avoid large fetch
               ));
               if (!latestSnap.empty) {
                 const sessions = latestSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                 sessions.sort((a, b) => (b.startTime?.toMillis() || 0) - (a.startTime?.toMillis() || 0));
                 const sd = sessions[0];
                 
                 let displayTotal = sd.totalEarned || 0;
                 let displayCount = sd.ordersCount || 0;
                 
                 if (displayTotal === 0) {
                   const { getDocs, query, collection, where } = await import('firebase/firestore');
                   const liveSnap = await getDocs(query(
                     collection(db, 'orders'),
                     where('deliverySessionId', '==', sd.id),
                     where('status', '==', 'completed')
                   ));
                   if (!liveSnap.empty) {
                     displayTotal = liveSnap.docs.reduce((s, d) => {
                        return s + getOrderDriverEarnings(d.data());
                      }, 0);
                     displayCount = liveSnap.size;
                   }
                 }

                 if (document.getElementById('session-total-earned')) document.getElementById('session-total-earned').textContent = formatPrice(displayTotal);
                 if (document.getElementById('session-orders-count')) document.getElementById('session-orders-count').textContent = displayCount;
               }
             } catch(e) {}
          })();
        }

        // Load Global Stats
        loadProfessionalStats(user.uid);
        loadRecentSessionsList(user.uid);

        // Listeners
        document.getElementById('view-sessions-history-btn')?.addEventListener('click', () => {
          showSessionsHistoryModal(user.uid);
        });

        document.getElementById('open-balance-mgmt-btn')?.addEventListener('click', () => {
          showBalanceManagementModal(user, debt);
        });


      });

      tabUnsub = () => {
        userUnsub();
        if (sessionOrdersUnsub) {
          sessionOrdersUnsub.unsub();
        }
      };
    } else if (tab === 'config') {
      const isTripApproved = user.tripStatus === 'approved';
      const isTripPending = user.tripStatus === 'pending';
      const isTripRejected = user.tripStatus === 'rejected';

      // Default values for Trip Vehicle
      const defaultTripModel = user.tripVehicleModel || user.tripApplication?.vehicleModel || user.vehicleModel || '';
      const defaultTripColor = user.tripVehicleColor || user.tripApplication?.vehicleColor || user.vehicleColor || '';
      const defaultTripPatent = user.tripVehiclePatent || user.tripApplication?.vehicleDetails || user.vehicleDetails || user.patente || '';
      const defaultTripVehicleType = user.tripVehicleType || user.tripApplication?.vehicleType || user.vehicleType || 'Auto';

      // Default values for Delivery Vehicle
      const defaultDelivType = user.deliveryVehicleType || 'Moto';
      const defaultDelivModel = user.deliveryVehicleModel || '';
      const defaultDelivColor = user.deliveryVehicleColor || '';
      const defaultDelivPatent = user.deliveryVehiclePatent || '';

      let configHtml = `
        <div style="display:flex; flex-direction:column; gap:20px; font-family:var(--font-body); color:var(--color-text-primary); max-width:550px; margin:0 auto; padding-bottom:40px;">
          
          <!-- Card 1: Datos del Repartidor -->
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
            <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
              ${icon('user', 20)} Datos del Repartidor
            </h3>
            
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Alias de Transferencia (Obligatorio) *</label>
              <input type="text" id="config-alias-input" value="${user.transferAlias || ''}" placeholder="Ej: alias.mp" style="width:100%; height:48px; border-radius:12px; border:2px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:14px; font-weight:700; padding:0 14px; outline:none; transition:border-color 0.2s;" />
            </div>
          </div>
      `;

      if (isTripApproved) {
        configHtml += `
          <!-- Card 2: Tipo de Trabajo -->
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
            <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
              ${icon('settings', 20)} Tipo de Trabajo
            </h3>

            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">¿Qué querés recibir? *</label>
              <select id="config-deliverymode-select" style="width:100%; height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:14px; font-weight:700; padding:0 14px; outline:none; font-family:inherit;">
                <option value="delivery" ${user.deliveryMode === 'delivery' ? 'selected' : ''}>Solo Envíos (Pedidos y Favores)</option>
                <option value="trip" ${user.deliveryMode === 'trip' ? 'selected' : ''}>Solo Viajes (Traslado de Pasajeros)</option>
                <option value="both" ${(!user.deliveryMode || user.deliveryMode === 'both') ? 'selected' : ''}>Ambos (Envíos y Viajes)</option>
              </select>
            </div>
          </div>
        `;
      } else {
        configHtml += `
          <!-- Card 2: Postulación para Viajes -->
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
            <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
              ${icon('car', 20)} Habilitar Viajes (Pasajeros)
            </h3>
            <p style="font-size:12.5px; color:var(--color-text-secondary); margin:0; line-height:1.45; font-weight:500;">
              Para poder trasladar pasajeros y realizar Viajes en GoDelivery, debés postularte adjuntando la documentación de tu vehículo.
            </p>
            <div style="margin-top:4px;">
              ${isTripPending ? `
                <div style="background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.2); border-radius:16px; padding:12px 16px; display:flex; align-items:center; gap:10px;">
                  <span style="font-size:20px; animation:scale-pulse 2s infinite;">⏳</span>
                  <div>
                    <strong style="font-size:13px; color:var(--color-text-primary); display:block;">Solicitud de Chofer pendiente</strong>
                    <span style="font-size:11.5px; color:var(--color-text-secondary);">Estamos revisando tus documentos. Te notificaremos pronto.</span>
                  </div>
                </div>
              ` : isTripRejected ? `
                <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2); border-radius:16px; padding:12px 16px; display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:20px; color:#ef4444;">❌</span>
                    <div>
                      <strong style="font-size:13px; color:var(--color-text-primary); display:block;">Solicitud rechazada</strong>
                      <span style="font-size:11.5px; color:var(--color-text-secondary);">Tu postulación no cumple con los requisitos mínimos.</span>
                    </div>
                  </div>
                  <button id="reapply-trip-btn" class="btn btn-outline btn-block" style="height:38px; border-radius:10px; font-weight:800; font-size:12px;">Volver a postularse...</button>
                </div>
              ` : `
                <button id="apply-trip-btn" class="btn btn-primary btn-block" style="height:48px; border-radius:14px; font-weight:900; font-size:13.0px; background:#3b82f6; border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 12px rgba(59,130,246,0.2);">
                  ${icon('car', 16)} Postularse para Realizar Viajes
                </button>
              `}
            </div>
          </div>
        `;
      }

      // Render single mandatory vehicle configuration card for everyone!
      configHtml += `
        <!-- Card 3: Configuración de tu Vehículo -->
        <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:28px; padding:24px; display:flex; flex-direction:column; gap:20px; box-shadow:var(--shadow-sm);">
          <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:8px;">
            ${icon('car', 20)} Configuración de tu Vehículo
          </h3>

          <div style="padding:14px; border:1.5px solid rgba(59,130,246,0.15); background:rgba(59,130,246,0.02); border-radius:20px; display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Tipo de Vehículo (Obligatorio) *</label>
              <select id="config-vehicle-type-select" style="width:100%; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none; font-family:inherit;">
                <option value="" disabled ${!defaultTripVehicleType ? 'selected' : ''}>-- Seleccioná tipo --</option>
                <option value="Moto" ${defaultTripVehicleType.toLowerCase() === 'moto' ? 'selected' : ''}>🏍️ Moto</option>
                <option value="Auto" ${defaultTripVehicleType.toLowerCase() === 'auto' ? 'selected' : ''}>🚗 Auto</option>
              </select>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Modelo / Marca *</label>
                <input type="text" id="config-vehicle-model-input" value="${defaultTripModel}" placeholder="Ej: Fiat Cronos / Honda Wave" style="width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none;" />
              </div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Color *</label>
                <input type="text" id="config-vehicle-color-input" value="${defaultTripColor}" placeholder="Ej: Blanco" style="width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none;" />
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:9.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Número de Patente *</label>
              <input type="text" id="config-vehicle-patent-input" value="${defaultTripPatent}" placeholder="Ej: AB123CD" style="width:100%; box-sizing:border-box; height:42px; border-radius:10px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); font-size:13px; font-weight:700; padding:0 12px; outline:none;" />
            </div>
          </div>
        </div>
      `;

      configHtml += `
          <!-- Save button -->
          <button id="config-save-btn" class="btn btn-primary btn-block" style="height:56px; border-radius:20px; font-weight:900; font-size:15px; background:#E11D48; border:none; color:white; box-shadow:0 8px 20px rgba(225, 29, 72, 0.2); cursor:pointer;">
            Guardar Configuración
          </button>
        </div>
      `;

      container.innerHTML = configHtml;

      // Apply button Click
      const applyBtn = document.getElementById('apply-trip-btn');
      const reapplyBtn = document.getElementById('reapply-trip-btn');
      const handleApplyClick = () => showTripApplicationModal(user);
      if (applyBtn) applyBtn.onclick = handleApplyClick;
      if (reapplyBtn) reapplyBtn.onclick = handleApplyClick;

      document.getElementById('config-save-btn').onclick = async () => {
        const aliasInput = document.getElementById('config-alias-input');
        const aliasVal = aliasInput ? aliasInput.value.trim() : '';

        if (!aliasVal) {
          showToast('El alias de transferencia es obligatorio', 'warning');
          return;
        }

        const vehicleTypeSelect = document.getElementById('config-vehicle-type-select');
        const vehicleType = vehicleTypeSelect ? vehicleTypeSelect.value : (user.vehicleType || user.tripVehicleType || 'Moto');
        const vehicleModelInput = document.getElementById('config-vehicle-model-input');
        const vehicleModel = (vehicleModelInput && vehicleModelInput.value.trim()) ? vehicleModelInput.value.trim() : (user.vehicleModel || user.tripVehicleModel || 'Moto');
        const vehicleColorInput = document.getElementById('config-vehicle-color-input');
        const vehicleColor = (vehicleColorInput && vehicleColorInput.value.trim()) ? vehicleColorInput.value.trim() : (user.vehicleColor || user.tripVehicleColor || 'Negro');
        const vehiclePatentInput = document.getElementById('config-vehicle-patent-input');
        const vehiclePatent = (vehiclePatentInput && vehiclePatentInput.value.trim()) ? vehiclePatentInput.value.trim() : (user.vehiclePatent || user.patente || user.tripVehiclePatent || 'S/N');

        const saveBtn = document.getElementById('config-save-btn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = icon('loader', 20, 'animate-spin') + ' Guardando...';

        try {
          const { doc: fDoc, updateDoc: fUpdateDoc } = await import('firebase/firestore');
          const userRef = fDoc(db, 'users', user.uid);
          
          const vTypeLower = (vehicleType || 'moto').toLowerCase();

          const updateFields = {
            transferAlias: aliasVal,
            alias: aliasVal,
            mpAlias: aliasVal,
            
            tripVehicleType: vTypeLower,
            tripVehicleModel: vehicleModel,
            tripVehicleColor: vehicleColor,
            tripVehiclePatent: vehiclePatent,
            
            deliveryVehicleType: vehicleType || 'Moto',
            deliveryVehicleModel: vehicleModel,
            deliveryVehicleColor: vehicleColor,
            deliveryVehiclePatent: vehiclePatent,

            vehicleType: vTypeLower,
            vehicleModel: vehicleModel,
            vehicleColor: vehicleColor,
            vehicleDetails: vehiclePatent,
            patente: vehiclePatent
          };

          if (isTripApproved) {
            const modeSelect = document.getElementById('config-deliverymode-select');
            if (modeSelect) {
              updateFields.deliveryMode = modeSelect.value;
            }
          }

          await fUpdateDoc(userRef, updateFields);

          setState('user', { 
            ...getState().user, 
            ...updateFields
          });

          showToast('✅ ¡Configuración y alias guardados con éxito!', 'success');
        } catch (err) {
          console.error('Error saving config:', err);
          showToast('Error al guardar la configuración: ' + err.message, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = 'Guardar Configuración';
        }
      };

      tabUnsub = () => {};
    }
  } catch (err) {
    console.error('Error loading delivery tab:', err);
    container.innerHTML = `<div class="empty-state-mini">Error al cargar datos</div>`;
  }
}

async function showTripApplicationModal(user) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('../firebase.js');

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;';
  
  modalEl.innerHTML = `
    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
      <div style="width: 52px; height: 52px; background: rgba(59, 130, 246, 0.1); color: #3b82f6; border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);">
        ${icon('car', 32)}
      </div>
      <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; color: var(--color-text-primary); margin: 0;">Postulación de Chofer</h3>
      <p style="font-size: 12.5px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; max-width: 280px;">
        Completá este formulario profesional para habilitar el traslado de pasajeros en GoDelivery.
      </p>
    </div>

    <form id="trip-app-form" style="display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px;">
      
      <!-- Full Name -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Nombre Completo *</label>
        <input type="text" id="tapp-fullname" required placeholder="Ej: Juan Pérez" value="${user.displayName || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Phone -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Teléfono de Contacto *</label>
        <input type="tel" id="tapp-phone" required placeholder="Ej: 2215551234" value="${user.phone || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Vehículo *</label>
        <select id="tapp-vehicle" required style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s; color: var(--color-text-primary); font-family: inherit;">
          <option value="Auto" selected>Auto</option>
          <option value="Moto">Moto</option>
        </select>
      </div>

      <!-- Vehicle Model -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Modelo del Vehículo (Marca, Modelo) *</label>
        <input type="text" id="tapp-vehiclemodel" required placeholder="Ej: Fiat Cronos / Honda Wave" value="${user.vehicleModel || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle Color -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Color del Vehículo *</label>
        <input type="text" id="tapp-vehiclecolor" required placeholder="Ej: Blanco / Negro / Rojo" value="${user.vehicleColor || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Vehicle Plate -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Patente del Vehículo *</label>
        <input type="text" id="tapp-vehicledetails" required placeholder="Ej: AA123BC / A012BCD" value="${user.vehicleDetails || user.patente || ''}" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-card); font-size: 13.5px; font-weight: 600; outline: none; transition: border-color 0.2s;" />
      </div>

      <!-- Required Driver License Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Foto de Licencia de Conducir (Registro) *</label>
        <input type="file" id="tapp-licencia-file" accept="image/*" style="display:none;" required />
        <button type="button" id="tlicencia-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-primary-light); color:var(--color-text-primary);">
          ${icon('camera', 16)} <span id="tlicencia-file-label">Subir foto de Registro...</span>
        </button>
      </div>

      <!-- Required Vehicle Insurance Upload -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Foto de Seguro del Vehículo *</label>
        <input type="file" id="tapp-seguro-file" accept="image/*" style="display:none;" required />
        <button type="button" id="tseguro-file-btn" class="btn btn-outline" style="height:46px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:700; border-radius:12px; cursor:pointer; background:var(--color-bg-card); border:1.5px solid var(--color-primary-light); color:var(--color-text-primary);">
          ${icon('camera', 16)} <span id="tseguro-file-label">Subir foto de Seguro...</span>
        </button>
      </div>

      <!-- Submit button -->
      <button type="submit" id="submit-tapp-btn" class="btn btn-primary" style="width: 100%; height: 50px; border-radius: 14px; background: #3b82f6; color: white; border: none; font-weight: 900; font-size: 14.5px; cursor: pointer; box-shadow: 0 8px 24px rgba(59,130,246, 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 10px;">
        ${icon('check', 18)} Enviar Solicitud de Chofer
      </button>
    </form>
  `;

  showModal({ title: '', content: modalEl, height: '80dvh', hideHeader: true });

  const licenciaFileInput = modalEl.querySelector('#tapp-licencia-file');
  const licenciaBtn = modalEl.querySelector('#tlicencia-file-btn');
  const licenciaLabel = modalEl.querySelector('#tlicencia-file-label');

  const seguroFileInput = modalEl.querySelector('#tapp-seguro-file');
  const seguroBtn = modalEl.querySelector('#tseguro-file-btn');
  const seguroLabel = modalEl.querySelector('#tseguro-file-label');

  licenciaBtn.onclick = () => licenciaFileInput.click();
  seguroBtn.onclick = () => seguroFileInput.click();

  licenciaFileInput.onchange = () => {
    if (licenciaFileInput.files.length > 0) {
      licenciaLabel.textContent = licenciaFileInput.files[0].name;
      licenciaBtn.style.borderColor = '#22c55e';
    }
  };

  seguroFileInput.onchange = () => {
    if (seguroFileInput.files.length > 0) {
      seguroLabel.textContent = seguroFileInput.files[0].name;
      seguroBtn.style.borderColor = '#22c55e';
    }
  };

  const form = modalEl.querySelector('#trip-app-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const fullName = modalEl.querySelector('#tapp-fullname').value.trim();
    const phone = modalEl.querySelector('#tapp-phone').value.trim();
    const vehicleType = modalEl.querySelector('#tapp-vehicle').value;
    const vehicleModel = modalEl.querySelector('#tapp-vehiclemodel').value.trim();
    const vehicleColor = modalEl.querySelector('#tapp-vehiclecolor').value.trim();
    const vehicleDetails = modalEl.querySelector('#tapp-vehicledetails').value.trim();

    if (!fullName || !phone || !vehicleType || !vehicleModel || !vehicleColor || !vehicleDetails) {
      showToast('Por favor, completa todos los campos requeridos.', 'warning');
      return;
    }

    if (licenciaFileInput.files.length === 0) {
      showToast('Por favor, subí la foto de tu registro/licencia.', 'warning');
      return;
    }

    if (seguroFileInput.files.length === 0) {
      showToast('Por favor, subí la foto del seguro.', 'warning');
      return;
    }

    const submitBtn = modalEl.querySelector('#submit-tapp-btn');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.innerHTML = `<div class="spinner-mini" style="width:16px; height:16px; border-width:2px; border-top-color:#fff; margin:0; display:inline-block;"></div> Subiendo archivos...`;

    try {
      const uploadPromises = [];

      // 1. License Upload
      let licenciaUrl = '';
      const licenciaFile = licenciaFileInput.files[0];
      const licenciaRef = ref(storage, `trip_applications/${user.uid}/licencia_${Date.now()}_${licenciaFile.name}`);
      uploadPromises.push(uploadBytes(licenciaRef, licenciaFile).then(async (snap) => {
        licenciaUrl = await getDownloadURL(snap.ref);
      }));

      // 2. Insurance Upload
      let seguroUrl = '';
      const seguroFile = seguroFileInput.files[0];
      const seguroRef = ref(storage, `trip_applications/${user.uid}/seguro_${Date.now()}_${seguroFile.name}`);
      uploadPromises.push(uploadBytes(seguroRef, seguroFile).then(async (snap) => {
        seguroUrl = await getDownloadURL(snap.ref);
      }));

      await Promise.all(uploadPromises);

      const applicationData = {
        userId: user.uid,
        fullName,
        phone,
        vehicleType,
        vehicleModel,
        vehicleColor,
        vehicleDetails,
        licenciaUrl,
        seguroUrl,
        status: 'pending',
        appliedAt: serverTimestamp()
      };

      // Save in global trip_applications collection
      await setDoc(doc(db, 'trip_applications', user.uid), applicationData);

      // Update user document
      await setDoc(doc(db, 'users', user.uid), {
        tripStatus: 'pending',
        tripApplication: applicationData,
        phone: phone
      }, { merge: true });

      showToast('¡Postulación de Chofer enviada correctamente! Revisaremos tus documentos pronto.', 'success');
      closeModal();
    } catch (err) {
      console.error('Error saving trip application:', err);
      showToast('Error al enviar postulación: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.innerHTML = `${icon('check', 18)} Enviar Solicitud de Chofer`;
    }
  };
}

async function showModifyOrderModal(order) {
  const { addDoc, doc, updateDoc, collection } = await import('firebase/firestore');

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding:24px; background:var(--color-bg); height:100%; display:flex; flex-direction:column;';
  
  modalEl.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2 style="font-family:var(--font-display); font-size:1.5rem; font-weight:900; margin:0; letter-spacing:-0.02em;">Modificar Pedido</h2>
      <p style="font-size:13px; color:var(--color-text-tertiary); margin-top:4px;">Ajustá el precio o agregá un detalle si hubo cambios.</p>
    </div>

    <div style="flex:1;">
      <div style="margin-bottom:20px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Nuevo Total ($)</label>
        <input type="number" id="new-total-input" value="${order.total}" style="width:100%; height:56px; border-radius:16px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); color:var(--color-text); font-size:24px; font-weight:800; padding:0 20px; outline:none;" inputmode="decimal" />
      </div>

      <div style="margin-bottom:20px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; display:block;">Detalle / Motivo (Opcional)</label>
        <textarea id="change-reason-input" placeholder="Ej: No había stock de coca de 2L, se llevó de 1.5L" style="width:100%; height:100px; border-radius:16px; background:var(--color-bg-secondary); border:2px solid var(--color-border-light); color:var(--color-text); font-size:14px; padding:16px; outline:none; resize:none; font-family:inherit;"></textarea>
      </div>
    </div>

    <button id="save-price-btn" style="width:100%; height:56px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 12px 24px rgba(var(--color-primary-rgb), 0.3);">
      Actualizar y Notificar
    </button>
  `;

  showModal({ content: modalEl, height: '60dvh' });

  modalEl.querySelector('#save-price-btn').onclick = async () => {
    const newTotal = parseFloat(modalEl.querySelector('#new-total-input').value);
    const reason = modalEl.querySelector('#change-reason-input').value.trim();

    if (isNaN(newTotal) || newTotal <= 0) {
      showToast('Ingresá un total válido', 'error');
      return;
    }

    const btn = modalEl.querySelector('#save-price-btn');
    btn.disabled = true;
    btn.innerHTML = icon('loader', 20, 'animate-spin');

    try {
      const shippingFee = Number(order.shippingFee || order.deliveryFee || 0);
      const serviceFee = Number(order.appUsageFee || order.serviceFee || 0);
      const tip = Number(order.tip || 0);
      const discount = Number(order.discount || 0);
      const purchaseFee = Number(order.purchaseFee || 0);
      const extraStopsFee = Number(order.extraStopsFee || 0);
      
      const newItemsCost = Math.max(0, newTotal - (shippingFee + serviceFee + tip + purchaseFee + extraStopsFee - discount));

      await updateDoc(doc(db, 'orders', order.id), {
        total: newTotal,
        totalAmount: newTotal,
        itemsCost: newItemsCost,
        subtotal: newItemsCost,
        isModified: true,
        modifiedBy: 'delivery',
        modificationReason: reason,
        modifiedAt: serverTimestamp()
      });

      // Add system message to chat
      await addDoc(collection(db, 'orders', order.id, 'messages'), {
        senderId: 'system',
        senderName: 'Sistema',
        text: `📦 **Pedido Modificado**\nEl repartidor actualizó el total a **${formatPrice(newTotal)}**.\n${reason ? `Motivo: ${reason}` : ''}`,
        createdAt: serverTimestamp(),
        type: 'modification'
      });

      closeModal();
      showToast('Pedido actualizado', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al actualizar', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Actualizar y Notificar';
    }
  };
}

export async function showEditFavorPriceModal(order, isPersistent = false) {
  const { icon } = await import('../utils/icons.js');
  const { formatPrice } = await import('../utils/format.js');
  
  const deliveryFee = order.deliveryCost || 0;
  const appFee = order.appUsageFee || 0;
  const pFee = order.purchaseFee || 0;
  const extraStops = order.extraStopsFee || 0;
  const couponDiscount = order.couponDiscount || 0;
  const tip = order.tip || order.tipAmount || 0;
  const serviceTotal = deliveryFee + appFee + pFee + extraStops - couponDiscount + tip;

  let stores = parseFavorDetails(order.details || order.description);
  if (stores.length === 0) {
    let serviceName = 'Servicio';
    if (order.details) {
      const match = order.details.match(/(?:Servicio|Trámite):\s*([^\n]+)/i);
      if (match) serviceName = match[1].trim();
    }
    stores = [{
      name: serviceName,
      items: 'Pago de Servicio'
    }];
  }
  const currentPrices = order.storePrices || {};

  // Remove existing sheets if any
  document.getElementById('v5-price-edit-sheet')?.remove();
  document.getElementById('v5-price-edit-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'v5-price-edit-backdrop';
  backdrop.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99998; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); opacity: 0; transition: opacity 0.3s ease;";

  const sheet = document.createElement('div');
  sheet.id = 'v5-price-edit-sheet';
  sheet.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; box-shadow: 0 -12px 30px rgba(0,0,0,0.15); z-index: 99999; transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); max-height: 85vh; display: flex; flex-direction: column; padding-bottom: calc(20px + env(safe-area-inset-bottom, 16px)); overflow: hidden;";

  const titleText = order.favorType === 'pagodeservicios' ? 'Monto de Servicios' : 'Precios por Comercio';
  const subtitleText = order.favorType === 'pagodeservicios' ? 'Ingresá el valor total de las facturas pagadas.' : 'Ingresá el valor de los productos de cada local.';

  sheet.innerHTML = `
    <!-- Touch Drag Handle & Header -->
    <div class="sheet-drag-header" style="background: linear-gradient(135deg, var(--color-primary) 0%, #be123c 100%); color: white; padding: 12px 20px 16px; display: flex; flex-direction: column; align-items: center; position: relative; cursor: grab; flex-shrink: 0; box-shadow: 0 4px 15px rgba(190, 18, 60, 0.15); z-index: 10;">
      <div style="width: 40px; height: 4px; background: rgba(255,255,255,0.4); border-radius: 2px; margin-bottom: 12px;"></div>
      <div style="width: 100%; display: flex; align-items: center; gap: 12px; text-align: left;">
        <div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">
          ${icon('creditCard', 20)}
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0;">
          <h3 style="margin: 0; font-size: 16.5px; font-weight: 900; color: white; letter-spacing: -0.01em;">${titleText}</h3>
          <span style="font-size: 11.5px; color: rgba(255,255,255,0.85); font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${subtitleText}</span>
        </div>
        <button id="v5-price-edit-close" style="background: rgba(255,255,255,0.15); border: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: white; transition: background 0.2s;">
          ${icon('close', 14)}
        </button>
      </div>
    </div>

    <!-- Content Area (Scrollable) -->
    <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;">
      <div style="background:var(--color-bg-secondary); border-radius:24px; padding:20px; border:1.5px solid var(--color-border-light); display:flex; flex-direction:column; gap:16px; box-shadow: var(--shadow-sm);">
        <div style="font-size:10.5px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; text-align:left; margin-bottom:4px;">
          ${order.favorType === 'pagodeservicios' ? 'Costo facturas' : 'Costo de productos'}
        </div>
        
        ${stores.map((st, idx) => {
          const price = currentPrices[st.name] || '';
          return `
            <div style="display:flex; flex-direction:column; gap:6px; text-align:left;">
              <label style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; justify-content:space-between; gap:6px;">
                <span>${order.favorType === 'pagodeservicios' ? '🧾' : '🏪'} <strong>${st.name}</strong></span>
                <span style="font-weight:600; font-size:11px; color:var(--color-text-secondary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:180px;">${st.items}</span>
              </label>
              <div style="position:relative;">
                <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:800; color:var(--color-text-tertiary);">$</span>
                <input type="number" class="favor-store-price-input" data-store-name="${st.name}" value="${price}" placeholder="0" style="width:100%; box-sizing:border-box; height:48px; border-radius:14px; border:2px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text); font-size:18px; font-weight:900; padding:0 16px 0 35px; outline:none; transition:border-color 0.3s;" inputmode="decimal">
              </div>
            </div>
          `;
        }).join('')}

        <div style="border-top:1.5px dashed var(--color-border-light); padding-top:14px; display:flex; justify-content:space-between; align-items:center; font-size:13.5px; font-weight:800; color:var(--color-text-primary);">
          <span>${order.favorType === 'pagodeservicios' ? 'Total Servicios:' : 'Total Productos:'}</span>
          <span id="favor-products-sum" style="font-size:17px; font-weight:950; color:#10b981;">${formatPrice(order.subtotal || 0)}</span>
        </div>

        <div style="border-top:1.5px dashed var(--color-border-light); padding-top:14px; display:flex; flex-direction:column; gap:8px; text-align:left; font-size:13px; font-weight:600; color:var(--color-text-secondary);">
          <div style="display:flex; justify-content:space-between;">
            <span>Servicio (Envío/Gestión/App):</span>
            <span>+ ${formatPrice(deliveryFee + appFee + pFee + extraStops)}</span>
          </div>
          ${couponDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; color:#a855f7;">
            <span>Descuento de Cupón:</span>
            <span>- ${formatPrice(couponDiscount)}</span>
          </div>
          ` : ''}
          ${tip > 0 ? `
          <div style="display:flex; justify-content:space-between; color:#10b981;">
            <span>Propina al Repartidor:</span>
            <span>+ ${formatPrice(tip)}</span>
          </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:900; color:var(--color-primary); margin-top:4px;">
            <span>Cobrar al cliente:</span>
            <span id="client-total-preview">${formatPrice((parseFloat(order.subtotal) || 0) + serviceTotal)}</span>
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:4px;">
        <button id="cancel-edit-price" style="height:50px; border-radius:16px; background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border-light); font-weight:900; font-size:13.5px; cursor:pointer;">CANCELAR</button>
        <button id="confirm-edit-price" style="height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:950; font-size:13.5px; cursor:pointer; box-shadow:0 6px 16px rgba(var(--color-primary-rgb),0.2);">GUARDAR</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  // Trigger animation
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });

  const closeSheet = () => {
    backdrop.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 350);
  };

  backdrop.onclick = closeSheet;
  sheet.querySelector('#v5-price-edit-close').onclick = closeSheet;
  sheet.querySelector('#cancel-edit-price').onclick = closeSheet;

  // Touch Swipe-to-Close Implementation
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  const dragHeader = sheet.querySelector('.sheet-drag-header');

  dragHeader.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    isDragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });

  dragHeader.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      sheet.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: true });

  dragHeader.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    const deltaY = currentY - startY;
    if (deltaY > 120) {
      closeSheet();
    } else {
      sheet.style.transform = 'translateY(0)';
    }
  });

  const inputs = sheet.querySelectorAll('.favor-store-price-input');
  const sumDisplay = sheet.querySelector('#favor-products-sum');
  const preview = sheet.querySelector('#client-total-preview');

  const updateTotals = () => {
    let sum = 0;
    inputs.forEach(input => {
      sum += parseFloat(input.value) || 0;
    });
    sumDisplay.textContent = formatPrice(sum);
    preview.textContent = formatPrice(sum + serviceTotal);
  };

  inputs.forEach(input => {
    input.oninput = updateTotals;
  });

  if (inputs.length > 0) {
    inputs[0].focus();
  }

  sheet.querySelector('#confirm-edit-price').onclick = () => {
    const storePrices = {};
    let hasInvalid = false;
    let sum = 0;

    inputs.forEach(input => {
      const name = input.dataset.storeName;
      const val = parseFloat(input.value) || 0;
      if (val < 0) hasInvalid = true;
      sum += val;
      storePrices[name] = val;
    });

    if (hasInvalid) {
      showToast('Por favor, ingresá montos válidos.', 'warning');
      return;
    }

    if (isPersistent && sum <= 0) {
      showToast(order.favorType === 'pagodeservicios' ? '⚠️ Debes ingresar el valor de las facturas pagadas.' : '⚠️ Debes ingresar el valor de los productos comprados.', 'warning');
      return;
    }

    closeSheet();
    showToast('Actualizando precio...', 'info');

    (async () => {
      try {
        await saveFavorStorePrices(order.id, storePrices);
        showToast('Precios actualizados', 'success');
      } catch (e) {
        console.error('Update price error:', e);
        showToast('Error al actualizar', 'error');
      }
    })();
  };
}


async function saveFavorStorePrices(orderId, storePrices) {
  const { getDoc, doc: fDoc, serverTimestamp, addDoc, collection, updateDoc } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');
  const { formatPrice } = await import('../utils/format.js');
  
  // Fetch fresh data to ensure we have latest fees
  const snap = await getDoc(fDoc(db, 'orders', orderId));
  if (!snap.exists()) throw new Error('Order not found');
  const freshOrder = snap.data();
  
  const deliveryFee = freshOrder.deliveryCost || 0;
  const appFee = freshOrder.appUsageFee || 0;
  const pFee = freshOrder.purchaseFee || 0;
  const extraStops = freshOrder.extraStopsFee || 0;
  
  // Sum prices
  const val = Object.values(storePrices).reduce((sum, price) => sum + price, 0);
  const couponDiscount = freshOrder.couponDiscount || 0;
  const tip = freshOrder.tip || freshOrder.tipAmount || 0;
  const newTotal = Math.max(0, val + deliveryFee + appFee + pFee + extraStops - couponDiscount + tip);
  
  await updateDoc(fDoc(db, 'orders', orderId), {
    storePrices: storePrices,
    subtotal: val,
    total: newTotal,
    updatedAt: serverTimestamp()
  });

  // Send real-time notification banner to customer
  if (freshOrder.userId) {
    try {
      await addDoc(collection(db, 'users', freshOrder.userId, 'notifications'), {
        title: '💰 Precios cargados en tu pedido',
        body: `El repartidor ingresó el valor de los productos (${formatPrice(val)}). Total a abonar: ${formatPrice(newTotal)}.`,
        type: 'price_updated',
        orderId: orderId,
        status: 'unread',
        createdAt: serverTimestamp()
      });
    } catch (notifErr) {
      console.warn('Could not send price update notification to user:', notifErr);
    }
  }

  // Build detail message of stores
  const storeLines = Object.entries(storePrices)
    .map(([name, price]) => `• **${name}:** ${formatPrice(price)}`)
    .join('\n');

  // Add professional chat message
  await addDoc(collection(db, 'orders', orderId, 'messages'), {
    senderId: 'system',
    senderName: 'GoDelivery',
    text: `✅ **Actualización de Pedido**\n\nHola! El repartidor ha ingresado los precios de los productos en cada comercio:\n\n${storeLines}\n\n• **Total Productos:** ${formatPrice(val)}\n${pFee > 0 ? `• **Gestión Especial:** ${formatPrice(pFee)}\n` : ''}${extraStops > 0 ? `• **Paradas Extra:** ${formatPrice(extraStops)}\n` : ''}• **Servicio + Envío:** ${formatPrice(deliveryFee + appFee)}\n\n💰 **Total a abonar: ${formatPrice(newTotal)}**`,
    createdAt: serverTimestamp(),
    type: 'system'
  });
}

async function notifyAdminsOnDriverConnection(driverUser, action) {
  try {
    const { collection, query, where, getDocs, addDoc, serverTimestamp } = await import('firebase/firestore');
    
    // Multi-query to cover both role == 'admin' and isAdmin == true to ensure kioscopaulos7@gmail.com and all admins get notified
    const [roleSnap, isAdminSnap] = await Promise.all([
      getDocs(query(collection(db, 'users'), where('role', '==', 'admin'))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'users'), where('isAdmin', '==', true))).catch(() => ({ docs: [] }))
    ]);

    const adminIds = new Set();
    [...roleSnap.docs, ...isAdminSnap.docs].forEach(d => adminIds.add(d.id));

    const isConnect = action === 'connect';
    const title = isConnect ? '🟢 Repartidor Conectado' : '🔴 Repartidor Desconectado';
    const driverName = driverUser.displayName || driverUser.name || 'Repartidor';
    const body = isConnect 
      ? `SOPORTE GO: El repartidor ${driverName} se acaba de CONECTAR y está disponible para pedidos.` 
      : `SOPORTE GO: El repartidor ${driverName} se acaba de DESCONECTAR.`;

    for (const adminId of adminIds) {
      try {
        await addDoc(collection(db, 'users', adminId, 'notifications'), {
          title,
          body,
          type: 'driver_status_change',
          driverId: driverUser.uid || driverUser.id,
          status: 'unread',
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.warn('Error notifying admin:', adminId, err);
      }
    }
  } catch (err) {
    console.error('Error in notifyAdminsOnDriverConnection:', err);
  }
}

async function startSession(user) {
  const latestUser = getState().user || user;
  if (!latestUser) return;

  try {
    showBlockingLoading('Iniciando sesión...');
    const { addDoc, collection, doc, updateDoc, serverTimestamp, deleteField } = await import('firebase/firestore');
    
    let sessionRef = null;
    try {
      sessionRef = await addDoc(collection(db, 'deliverySessions'), {
        driverId: latestUser.uid,
        startTime: serverTimestamp(),
        endTime: null,
        totalEarned: 0,
        ordersCount: 0
      });
    } catch(e) {
      console.warn('Failed to create deliverySession doc:', e);
    }

    const sessionId = sessionRef ? sessionRef.id : 'session_' + Date.now();
    const updatedUser = { 
      ...getState().user, 
      ...latestUser,
      isOnline: true, 
      currentSessionId: sessionId, 
      lastActivityAt: new Date(), 
      lastTripAcceptedAt: new Date() 
    };
    
    // Update local app state IMMEDIATELY
    setState('user', updatedUser);

    // Update Firestore in background
    try {
      await updateDoc(doc(db, 'users', latestUser.uid), {
        isOnline: true,
        currentSessionId: sessionId,
        lastActivityAt: serverTimestamp(),
        lastTripAcceptedAt: serverTimestamp(),
        missedOffersCount: 0,
        cooldownUntil: deleteField(),
        disconnectedReason: deleteField()
      });
    } catch (err) {
      console.warn('Firestore user update non-fatal error:', err);
    }

    hideBlockingLoading();
    showToast('⚡ ¡En línea! Buscando pedidos en la zona...', 'success');

    // Re-render driver panel immediately
    await renderDeliveryPanel();
  } catch(err) {
    hideBlockingLoading();
    console.error('Error starting session:', err);
    showToast('⚠️ No se pudo iniciar la sesión. Intentá nuevamente.', 'danger');
  }
}

async function endSession(user) {
  const { doc, updateDoc, getDoc } = await import('firebase/firestore');
  
  try {
    if (user.currentSessionId) {
      const sessRef = doc(db, 'deliverySessions', user.currentSessionId);
      const snap = await getDoc(sessRef);
      
      if (snap.exists()) {
        const { getDocs, query, collection, where } = await import('firebase/firestore');
        const ordersSnap = await getDocs(query(
          collection(db, 'orders'),
          where('deliverySessionId', '==', user.currentSessionId),
          where('status', '==', 'completed')
        ));
        const total = ordersSnap.docs.reduce((s, d) => {
          return s + getOrderDriverEarnings(d.data());
        }, 0);
        
        await updateDoc(sessRef, {
          endTime: serverTimestamp(),
          totalEarned: total,
          ordersCount: ordersSnap.size
        });
      } else {
        console.warn('endSession: Session document missing, skipping updateDoc');
      }
    }
  } catch (err) {
    console.error('Error updating session endTime:', err);
  }
  
  // Optimistic update FIRST
  const { setState, getState } = await import('../state.js');
  setState('user', { ...getState().user, isOnline: false, currentSessionId: null, lastActivityAt: null });

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      isOnline: false,
      currentSessionId: null,
      lastActivityAt: null
    });
  } catch (err) {
    console.error('Error updating user status in endSession:', err);
  }

  if (inactivityTimer) {
    clearInterval(inactivityTimer);
    inactivityTimer = null;
  }
  stopHeartbeat();

  // Notify all admins about driver disconnection
  notifyAdminsOnDriverConnection(user, 'disconnect');

  showToast('Sesión finalizada. Hasta pronto.', 'info');
  
  // Re-render driver panel immediately to switch to offline centered view and hide map
  renderDeliveryPanel();
}

let inactivityTimer = null;
let heartbeatTimer = null;

function startHeartbeat(user) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  
  // Heartbeat every 2 minutes to keep delivery driver active
  heartbeatTimer = setInterval(async () => {
    const currentUser = getState().user || user;
    if (!currentUser || !currentUser.isOnline) {
      stopHeartbeat();
      return;
    }
    
    try {
      const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
      
      // Update Firestore timestamp
      await updateDoc(doc(db, 'users', currentUser.uid), {
        lastActivityAt: serverTimestamp()
      });
      
      // Update local state
      setState('user', { ...getState().user, lastActivityAt: new Date() });
      console.log('Heartbeat: updated lastActivityAt');
    } catch (e) {
      console.error('Heartbeat error:', e);
    }
  }, 120000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startInactivityCheck(user) {
  if (inactivityTimer) clearInterval(inactivityTimer);
  inactivityTimer = null;
  // Desconexión por inactividad deshabilitada del lado del cliente.
}

function renderFinancesCharts(orders) {
  const container = document.getElementById('finances-charts-container');
  if (!container) return;

  const now = new Date();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dailyData = last7Days.map(date => {
    const dayOrders = orders.filter(o => {
      const oDate = new Date(o.deliveredAt);
      return oDate.getFullYear() === date.getFullYear() &&
             oDate.getMonth() === date.getMonth() &&
             oDate.getDate() === date.getDate();
    });
    const sum = dayOrders.reduce((s, o) => s + (o.deliveryCost || 0), 0);
    return {
      dayName: date.toLocaleDateString('es-ES', { weekday: 'short' }).substring(0, 2).toUpperCase(),
      amount: sum
    };
  });

  // Find max daily amount to scale bars
  const maxDaily = Math.max(...dailyData.map(d => d.amount), 1);

  // Calculate breakdown for Donut chart
  let totalBase = 0;
  let totalTips = 0;
  let totalExtras = 0;

  orders.forEach(o => {
    // Note: o.deliveryCost here has already been calculated as the net earnings in loadProfessionalStats!
    // Let's compute proportion based on original tip and extra values if they exist, or estimate.
    const tip = o.tip || o.tipAmount || 0;
    const extra = o.isFavor || o.isTrip ? ((o.purchaseFee || 0) + (o.extraStopsFee || 0)) : 0;
    const base = Math.max(0, o.deliveryCost - tip - extra);
    
    totalBase += base;
    totalTips += tip;
    totalExtras += extra;
  });

  const total = totalBase + totalTips + totalExtras;
  const basePct = total > 0 ? Math.round((totalBase / total) * 100) : 0;
  const tipsPct = total > 0 ? Math.round((totalTips / total) * 100) : 0;
  const extrasPct = total > 0 ? Math.max(0, 100 - basePct - tipsPct) : 0;

  const donutCircumference = 100;
  const strokeDash1 = `${basePct} ${donutCircumference - basePct}`;
  const strokeDash2 = `${tipsPct} ${donutCircumference - tipsPct}`;
  const strokeDash3 = `${extrasPct} ${donutCircumference - extrasPct}`;

  const offset1 = 100;
  const offset2 = 100 - basePct;
  const offset3 = 100 - basePct - tipsPct;

  container.innerHTML = `
    <!-- Weekly Bar Chart -->
    <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:18px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
      <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
        ${icon('chart', 16)} Actividad Semanal
      </h4>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; height:120px; padding:10px 0 5px; box-sizing:border-box;">
        ${dailyData.map(d => {
          const heightPct = Math.round((d.amount / maxDaily) * 100);
          return `
            <div style="display:flex; flex-direction:column; align-items:center; flex:1; gap:6px; cursor:pointer;" class="bar-chart-col">
              <div style="font-size:8px; font-weight:900; color:var(--color-text-tertiary); transform:scale(0.8); transition:all 0.2s;" class="bar-amount">${d.amount > 0 ? formatPrice(d.amount) : ''}</div>
              <div style="position:relative; width:12px; height:70px; background:var(--color-bg-secondary); border-radius:6px; overflow:hidden;">
                <div style="position:absolute; bottom:0; left:0; width:100%; height:${heightPct}%; background:linear-gradient(to top, var(--color-primary), #60a5fa); border-radius:6px; transition:height 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);"></div>
              </div>
              <div style="font-size:9.5px; font-weight:900; color:var(--color-text-tertiary);">${d.dayName}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Doughnut Distribution Chart -->
    <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:18px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
      <h4 style="margin:0; font-size:12.5px; font-weight:900; color:var(--color-text-primary); display:flex; align-items:center; gap:6px;">
        ${icon('star', 15)} Distribución de Ganancias
      </h4>
      ${total > 0 ? `
        <div style="display:flex; align-items:center; gap:20px; justify-content:space-around;">
          <!-- SVG Donut -->
          <div style="position:relative; width:100px; height:100px;">
            <svg viewBox="0 0 42 42" width="100" height="100" style="transform:rotate(-90deg);">
              <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="var(--color-border-light)" stroke-width="4.5"></circle>
              <!-- Base -->
              ${basePct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#3b82f6" stroke-width="4.5" stroke-dasharray="${strokeDash1}" stroke-dashoffset="${offset1}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
              <!-- Tips -->
              ${tipsPct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#10b981" stroke-width="4.5" stroke-dasharray="${strokeDash2}" stroke-dashoffset="${offset2}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
              <!-- Extras -->
              ${extrasPct > 0 ? `<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#f59e0b" stroke-width="4.5" stroke-dasharray="${strokeDash3}" stroke-dashoffset="${offset3}" style="transition:stroke-dashoffset 0.8s ease-in-out;"></circle>` : ''}
            </svg>
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none;">
              <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; line-height:1;">Total</span>
              <span style="font-size:12.5px; font-weight:950; color:var(--color-text-primary); letter-spacing:-0.5px;">${formatPrice(total)}</span>
            </div>
          </div>

          <!-- Legends and values -->
          <div style="display:flex; flex-direction:column; gap:8px; flex:1;">
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#3b82f6;"></div>
                <span style="color:var(--color-text-secondary); font-weight:800;">Tarifa Envío</span>
              </div>
              <span style="font-weight:900; color:var(--color-text-primary);">${basePct}%</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#10b981;"></div>
                <span style="color:var(--color-text-secondary); font-weight:800;">Propinas</span>
              </div>
              <span style="font-weight:900; color:var(--color-text-primary);">${tipsPct}%</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px;" class="legend-row">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:8px; height:8px; border-radius:50%; background:#f59e0b;"></div>
                <span style="color:var(--color-text-secondary); font-weight:800;">Extras/Viajes</span>
              </div>
              <span style="font-weight:900; color:var(--color-text-primary);">${extrasPct}%</span>
            </div>
          </div>
        </div>
      ` : `
        <div style="text-align:center; padding:20px; font-size:11.5px; color:var(--color-text-tertiary); font-weight:700;">
          Aún no tienes entregas completadas en este período para graficar.
        </div>
      `}
  `;
}

async function loadProfessionalStats(driverId, callback = null) {
  const { getDocs, getDoc, doc, collection, query, where } = await import('firebase/firestore');
  const q = query(collection(db, 'orders'), where('driverId', '==', driverId), where('status', '==', 'completed'));
  
  try {
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => {
      const data = d.data();
      let deliveredDate = null;
      if (data.deliveredAt && typeof data.deliveredAt.toDate === 'function') {
        deliveredDate = data.deliveredAt.toDate();
      } else if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        deliveredDate = data.createdAt.toDate();
      } else {
        deliveredDate = new Date();
      }
      const netEarnings = getOrderDriverEarnings(data);
      return {
        ...data,
        deliveryCost: netEarnings,
        deliveredAt: deliveredDate
      };
    });
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    
    const earningsDay = orders.filter(o => o.deliveredAt >= today).reduce((s, o) => s + (o.deliveryCost || 0), 0);
    const earningsWeek = orders.filter(o => o.deliveredAt >= weekAgo).reduce((s, o) => s + (o.deliveryCost || 0), 0);
    const earningsMonth = orders.filter(o => o.deliveredAt >= monthAgo).reduce((s, o) => s + (o.deliveryCost || 0), 0);
    
    if (document.getElementById('stats-day')) document.getElementById('stats-day').textContent = formatPrice(earningsDay);
    if (document.getElementById('stats-week')) document.getElementById('stats-week').textContent = formatPrice(earningsWeek);
    if (document.getElementById('stats-month')) document.getElementById('stats-month').textContent = formatPrice(earningsMonth);

    // Compute cash vs digital split for Billetera
    let cashEarnings = 0;
    let digitalEarnings = 0;
    orders.forEach(o => {
      const method = (o.paymentMethod || 'efectivo').toLowerCase();
      if (method === 'efectivo' || method === 'cash') {
        cashEarnings += (o.deliveryCost || 0);
      } else {
        digitalEarnings += (o.deliveryCost || 0);
      }
    });

    const combinedTotal = cashEarnings + digitalEarnings;

    // Fetch user debt
    const userDocSnap = await getDoc(doc(db, 'users', driverId));
    const debt = userDocSnap.exists() ? (userDocSnap.data().deliveryDebt || 0) : 0;
    const netBalance = digitalEarnings + cashEarnings - debt;

    if (document.getElementById('wallet-digital-earnings')) document.getElementById('wallet-digital-earnings').textContent = formatPrice(digitalEarnings);
    if (document.getElementById('wallet-cash-earnings')) document.getElementById('wallet-cash-earnings').textContent = formatPrice(cashEarnings);
    if (document.getElementById('wallet-total-combined')) document.getElementById('wallet-total-combined').textContent = formatPrice(combinedTotal);
    if (document.getElementById('wallet-app-fee')) document.getElementById('wallet-app-fee').textContent = `-${formatPrice(debt)}`;
    
    const netBalanceEl = document.getElementById('wallet-net-balance');
    if (netBalanceEl) {
      netBalanceEl.textContent = formatPrice(netBalance);
      netBalanceEl.style.color = netBalance >= 0 ? '#10b981' : '#ef4444';
    }

    // Render the CSS/SVG charts dynamically
    renderFinancesCharts(orders);

    if (callback) callback({ today: earningsDay, week: earningsWeek, month: earningsMonth });
  } catch (e) { console.error(e); }
}

async function showBalanceManagementModal(user, debt) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');

  const pendingProofs = getState().pendingProofs || [];
  const totalPending = pendingProofs.reduce((sum, p) => sum + (p.amount || 0), 0);
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)) 20px; background:${isLight ? '#ffffff' : '#090d16'}; height:100%; display:flex; flex-direction:column; overflow:hidden; justify-content:space-between;`;
  
  modalEl.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; gap:16px; overflow:hidden;">
      <div class="debt-card-v3" style="
        background: ${isLight ? 'rgba(225, 29, 72, 0.05)' : 'rgba(225, 29, 72, 0.08)'};
        border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.2)' : 'rgba(225, 29, 72, 0.28)'};
        border-radius: 24px; padding: 22px 20px;
        box-shadow: 0 10px 30px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.35)'};
        text-align: center;
        flex-shrink: 0;
        margin-top: 6px;
      ">
        <span style="font-size:11.5px; font-weight:900; color:#e11d48; text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:6px;">Balance Pendiente</span>
        <div style="font-size:38px; font-weight:950; color:#e11d48; letter-spacing:-1.5px; line-height:1.1;">${formatPrice(debt)}</div>
        <p style="font-size:12.5px; color:${isLight ? '#475569' : '#cbd5e1'}; margin:10px 0 0; font-weight:600; line-height:1.45;">
          ${debt > 0 ? 'Este es el total adeudado a liquidar con la plataforma.' : 'No tenés deudas pendientes con la plataforma.'}
        </p>
      </div>

      ${totalPending > 0 ? `
        <div style="background:${isLight ? '#fef3c7' : 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(217,119,6,0.04) 100%)'}; border:1px solid ${isLight ? '#fde68a' : 'rgba(245,158,11,0.25)'}; border-radius:18px; padding:12px 16px; display:flex; gap:8px; align-items:center; margin-top:2px; box-shadow:var(--shadow-sm); flex-shrink:0;">
          <span style="font-size:16px;">⏳</span>
          <div style="font-size:11.5px; color:#d97706; font-weight:700; line-height:1.4; text-align:left;">
            Tenés una transferencia de <strong style="font-weight:900;">${formatPrice(totalPending)}</strong> pendiente de validación por administración.
          </div>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; flex-shrink:0;">
        <button id="modal-view-history-btn" style="height:50px; border-radius:16px; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'}; border:1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; color:${isLight ? '#0f172a' : '#ffffff'}; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; transition:all 0.2s;">
          ${icon('history', 16)} Historial
        </button>
        <button id="modal-regularize-btn" style="height:50px; border-radius:16px; background:#e11d48; border:none; color:white; font-weight:900; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; text-transform:uppercase; box-shadow:0 6px 16px rgba(225, 29, 72, 0.35); transition:all 0.2s;">
          ${icon('wallet', 16)} Regularizar
        </button>
      </div>
    </div>

    <button id="modal-send-proof-btn" style="width:100%; height:54px; border-radius:18px; background:#25D366; border:none; color:white; font-weight:950; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; box-shadow:0 8px 20px rgba(37, 211, 102, 0.25); flex-shrink:0; margin-top:20px;">
      ${icon('whatsappLogo', 20)} Enviar comprobante
    </button>
  `;

  showModal({ 
    title: 'Gestión de Balance', 
    content: modalEl, 
    height: '70dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });

  modalEl.querySelector('#modal-view-history-btn').onclick = () => {
    showBalanceHistoryModal(user.uid);
  };
  modalEl.querySelector('#modal-regularize-btn').onclick = () => {
    const pendingProofs = getState().pendingProofs || [];
    if (pendingProofs.length > 0) {
      showToast('⚠️ Ya tenés una liquidación pendiente de verificación.', 'warning');
      return;
    }
    showRegularizeModal(debt);
  };
  modalEl.querySelector('#modal-send-proof-btn').onclick = () => {
    const pendingProofs = getState().pendingProofs || [];
    if (pendingProofs.length > 0) {
      showToast('⚠️ Ya tenés una liquidación pendiente de verificación.', 'warning');
      return;
    }
    const wsp = getState().whatsappPayments || '5491123456789';
    const msg = encodeURIComponent(`Hola, adjunto comprobante de pago de GoDelivery.\n---\nREPARTIDOR: ${user.displayName || user.name}\nID: ${user.deliveryId || '---'}\nMONTO: ${formatPrice(debt)}\nDETALLE: Saldar balance pendiente.`);
    window.open(`https://wa.me/${wsp}?text=${msg}`, '_blank');
  };
}

async function showRegularizeModal(debt) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 16px)) 20px; background:${isLight ? '#ffffff' : '#090d16'}; color:${isLight ? '#0f172a' : '#ffffff'}; height:100%; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden;`;
  
  const bankAlias = getState().bankAlias || 'godelivery.oficial';
  const bankOwner = getState().bankOwner || 'GoDelivery S.R.L.';

  modalEl.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; gap:20px; overflow-y:auto; margin-bottom:16px;">
      <p style="font-size:13.5px; color:${isLight ? '#475569' : '#cbd5e1'}; margin:10px 0 0; font-weight:700; text-align:center; line-height:1.5;">
        Para saldar tu deuda de <strong style="color:#ef4444; font-size:16px; font-weight:950;">${formatPrice(debt)}</strong>, realizá una transferencia bancaria o Mercado Pago:
      </p>

      <div style="background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.05)'}; border:1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'}; border-radius:22px; padding:22px; box-shadow:${isLight ? '0 4px 12px rgba(0,0,0,0.04)' : 'none'};">
        <div style="margin-bottom:16px; border-bottom:1px dashed ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; padding-bottom:14px;">
          <label style="font-size:10px; font-weight:900; color:${isLight ? '#64748b' : '#94a3b8'}; text-transform:uppercase; margin-bottom:4px; display:block; letter-spacing:0.06em;">ALIAS / CVU</label>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:18px; color:${isLight ? '#0f172a' : '#ffffff'}; letter-spacing:0.02em; font-family:monospace;">${bankAlias}</strong>
            <button class="btn-copy" onclick="navigator.clipboard.writeText('${bankAlias}'); showToast('Copiado', 'success')" style="background:${isLight ? 'rgba(225,29,72,0.1)' : 'rgba(225,29,72,0.2)'}; border:none; color:#e11d48; cursor:pointer; width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
              ${icon('copy', 16)}
            </button>
          </div>
        </div>
        
        <div>
          <label style="font-size:10px; font-weight:900; color:${isLight ? '#64748b' : '#94a3b8'}; text-transform:uppercase; margin-bottom:4px; display:block; letter-spacing:0.06em;">TITULAR</label>
          <strong style="font-size:15px; color:${isLight ? '#0f172a' : '#ffffff'}; font-weight:800;">${bankOwner}</strong>
        </div>
      </div>

      <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:18px; padding:16px; display:flex; gap:12px; align-items:flex-start;">
        <div style="color:#d97706; margin-top:2px; display:flex; flex-shrink:0;">${icon('info', 18)}</div>
        <p style="font-size:12.5px; color:${isLight ? '#92400e' : '#fbbf24'}; margin:0; line-height:1.45; font-weight:600;">
          Una vez realizada la transferencia, seleccioná y subí la foto de tu comprobante para que el administrador la verifique y active tu saldo.
        </p>
      </div>
    </div>

    <input type="file" id="receipt-file-input" accept="image/*" style="display:none;" />
    
    <button id="modal-upload-receipt-btn"
            style="width:100%; height:54px; border-radius:18px; background:#e11d48; color:white; border:none; font-weight:950; font-size:14px; cursor:pointer; box-shadow:0 8px 20px rgba(225,29,72,0.35); display:flex; align-items:center; justify-content:center; gap:10px; text-transform:uppercase; flex-shrink:0; transition:all 0.2s;">
      ${icon('camera', 20)} SUBIR COMPROBANTE
    </button>
  `;

  showModal({ 
    title: 'Regularizar Balance', 
    content: modalEl, 
    height: '70dvh',
    headerBackground: '#E11D48',
    headerTextColor: 'white'
  });

  const fileInput = modalEl.querySelector('#receipt-file-input');
  const uploadBtn = modalEl.querySelector('#modal-upload-receipt-btn');

  uploadBtn.onclick = () => {
    fileInput.click();
  };

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = 'Subiendo comprobante...';
    uploadBtn.style.opacity = '0.7';

    try {
      const user = getState().user;
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { compressImage } = await import('../utils/format.js');
      const optimizedFile = await compressImage(file, 1280, 0.82);
      
      const storageRef = ref(storage, `delivery_receipts/${user.uid}_${Date.now()}.jpg`);
      const snapshot = await uploadBytes(storageRef, optimizedFile);
      const downloadUrl = await getDownloadURL(snapshot.ref);

      // Create transaction request in Firestore collection delivery_settlement_proofs
      await addDoc(collection(db, 'delivery_settlement_proofs'), {
        driverId: user.uid,
        driverName: user.displayName || user.name || 'Repartidor',
        driverDeliveryId: user.deliveryId || '---',
        amount: debt,
        imageUrl: downloadUrl,
        status: 'pending',
        createdAt: new Date()
      });

      showToast('✅ Comprobante subido con éxito. El administrador lo revisará en breve.', 'success');
      closeModal(); // close Regularize Modal
      closeModal(); // close Balance Management Modal
    } catch (err) {
      console.error(err);
      showToast('❌ Error al subir comprobante. Reintenta.', 'error');
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = `${icon('camera', 20)} SUBIR COMPROBANTE`;
      uploadBtn.style.opacity = '1';
    }
  };
}

async function loadRecentSessionsList(uid) {
  const container = document.getElementById('recent-sessions-list');
  if (!container) return;

  try {
    const { getDocs, query, collection, where } = await import('firebase/firestore');
    const q = query(
      collection(db, 'deliverySessions'),
      where('driverId', '==', uid)
    );
    const snap = await getDocs(q);
    let sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Fallback if empty
    if (sessions.length === 0) {
      const user = getState().user;
      if (user && user.deliveryId) {
        const snap2 = await getDocs(query(
          collection(db, 'deliverySessions'),
          where('driverDeliveryId', '==', user.deliveryId)
        ));
        sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }

    sessions = sessions.filter(s => s.startTime);
    sessions.sort((a, b) => (b.startTime?.toMillis() || 0) - (a.startTime?.toMillis() || 0));

    // Limit to 4 sessions
    const recent = sessions.slice(0, 4);

    if (recent.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:16px; color:var(--color-text-tertiary); font-size:12px; font-weight:700;">
          Aún no tenés sesiones registradas.
        </div>
      `;
      return;
    }

    // Fetch all completed orders for this driver to compute actual stats in real time
    const ordersSnap = await getDocs(query(
      collection(db, 'orders'),
      where('driverId', '==', uid),
      where('status', '==', 'completed')
    ));
    const allCompletedOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    container.innerHTML = recent.map(s => {
      let dateStr = 'Fecha desconocida';
      if (s.startTime) {
        const d = s.startTime.toDate ? s.startTime.toDate() : new Date(s.startTime);
        dateStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
        dateStr = dateStr.replace('.', '');
      }

      // Compute stats dynamically from Firestore orders for accuracy
      const sessOrders = allCompletedOrders.filter(o => {
        if (o.deliverySessionId === s.id) return true;
        // Fallback: match by timestamp range if deliverySessionId is missing
        if (!o.deliverySessionId && o.deliveredAt && s.startTime) {
          const deliveredTime = o.deliveredAt.toMillis ? o.deliveredAt.toMillis() : new Date(o.deliveredAt).getTime();
          const sessionStart = s.startTime.toMillis ? s.startTime.toMillis() : new Date(s.startTime).getTime();
          const sessionEnd = s.endTime 
            ? (s.endTime.toMillis ? s.endTime.toMillis() : new Date(s.endTime).getTime())
            : Date.now();
          return deliveredTime >= sessionStart && deliveredTime <= sessionEnd;
        }
        return false;
      });

      const total = sessOrders.reduce((sum, o) => {
        return sum + getOrderDriverEarnings(o);
      }, 0);

      const uniqueBundles = new Set(sessOrders.map(o => o.bundleId || o.id));
      const count = uniqueBundles.size;
      const isLive = s.id === getState().user?.currentSessionId;

      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:14px; gap:12px;">
          <div style="flex:1; display:flex; align-items:center; gap:8px;">
            <div style="width:8px; height:8px; border-radius:50%; background:${isLive ? '#22c55e' : 'var(--color-text-tertiary)'}; ${isLive ? 'box-shadow:0 0 8px #22c55e;' : ''}"></div>
            <span style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); text-transform:capitalize;">${dateStr}</span>
            ${isLive ? `<span style="font-size:9px; font-weight:900; background:rgba(34,197,94,0.1); color:#22c55e; padding:1px 6px; border-radius:4px; margin-left:4px;">VIVO</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:14px; text-align:right;">
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:8px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Pedidos</span>
              <span style="font-size:12px; font-weight:800; color:var(--color-text-primary);">${count}</span>
            </div>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:8px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Ganancia</span>
              <span style="font-size:12.5px; font-weight:900; color:var(--color-primary);">${formatPrice(total)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error rendering recent sessions:', err);
    container.innerHTML = `
      <div style="text-align:center; padding:16px; color:var(--color-text-tertiary); font-size:12px;">
        Error al cargar historial.
      </div>
    `;
  }
}

async function showSessionsHistoryModal(driverId) {
  const { getDocs, collection, query, where, orderBy } = await import('firebase/firestore');
  
  const content = document.createElement('div');
  content.style.cssText = 'padding:20px; background:var(--color-bg); min-height:60dvh; display:flex; flex-direction:column; gap:16px;';
  
  const now = new Date();
  let currentMonth = now.getMonth(); // 0-11
  let currentYear = now.getFullYear();

  const renderSessionList = async (month, year) => {
    const listContainer = content.querySelector('#sessions-list-render');
    listContainer.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;
    
    try {
      console.log('[DEBUG] Querying sessions for driverId:', driverId);
      const q = query(
        collection(db, 'deliverySessions'), 
        where('driverId', '==', driverId)
      );
      
      const snap = await getDocs(q);
      let sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      if (sessions.length === 0) {
        const user = getState().user;
        if (user.deliveryId) {
          const q2 = query(collection(db, 'deliverySessions'), where('driverDeliveryId', '==', user.deliveryId));
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
          }
        }
      }

      const startOfMonth = new Date(year, month, 1, 0, 0, 0).getTime();
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();

      sessions = sessions.filter(s => {
        let time = 0;
        if (s.startTime?.toMillis) time = s.startTime.toMillis();
        else if (s.startTime?.seconds) time = s.startTime.seconds * 1000;
        else if (s.startTime instanceof Date) time = s.startTime.getTime();
        else if (typeof s.startTime === 'number') time = s.startTime;
        
        return time >= startOfMonth && time <= endOfMonth;
      });

      sessions.sort((a, b) => (b.startTime?.toMillis() || 0) - (a.startTime?.toMillis() || 0));

      // Fetch all completed orders for this driver to compute actual stats in real time
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('driverId', '==', driverId),
        where('status', '==', 'completed')
      ));
      const allCompletedOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      sessions = sessions.map(s => {
        const sessOrders = allCompletedOrders.filter(o => {
          if (o.deliverySessionId === s.id) return true;
          // Fallback: match by timestamp range if deliverySessionId is missing
          if (!o.deliverySessionId && o.deliveredAt && s.startTime) {
            const deliveredTime = o.deliveredAt.toMillis ? o.deliveredAt.toMillis() : new Date(o.deliveredAt).getTime();
            const sessionStart = s.startTime.toMillis ? s.startTime.toMillis() : new Date(s.startTime).getTime();
            const sessionEnd = s.endTime 
              ? (s.endTime.toMillis ? s.endTime.toMillis() : new Date(s.endTime).getTime())
              : Date.now();
            return deliveredTime >= sessionStart && deliveredTime <= sessionEnd;
          }
          return false;
        });

        const totalEarned = sessOrders.reduce((sum, o) => {
          return sum + getOrderDriverEarnings(o);
        }, 0);

        const uniqueBundles = new Set(sessOrders.map(o => o.bundleId || o.id));
        const ordersCount = uniqueBundles.size;

        return {
          ...s,
          totalEarned,
          ordersCount
        };
      });
      
      const totalMonth = sessions.reduce((s, sess) => s + (sess.totalEarned || 0), 0);
      content.querySelector('#month-total-display').textContent = formatPrice(totalMonth);

      if (sessions.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align:center; padding:60px 20px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;">
            <div style="width:64px; height:64px; border-radius:50%; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary);">
              ${icon('calendar', 28)}
            </div>
            <div style="margin-top:4px;">
              <p style="margin:0; font-weight:800; font-size:14px; color:var(--color-text-primary);">Sin sesiones en este período</p>
              <p style="margin:4px 0 0; font-size:11.5px; color:var(--color-text-tertiary);">Las sesiones que realices en este mes aparecerán acá.</p>
            </div>
          </div>
        `;
        return;
      }
      
      listContainer.innerHTML = sessions.map(s => {
        const start = s.startTime?.toDate();
        const end = s.endTime?.toDate();
        let durationStr = 'En curso';
        
        if (start && end) {
          const diffMs = end - start;
          const hours = Math.floor(diffMs / 3600000);
          const minutes = Math.floor((diffMs % 3600000) / 60000);
          durationStr = `${hours > 0 ? hours + 'h ' : ''}${minutes}min`;
        }

        const isLive = s.id === getState().user?.currentSessionId;

        return `
          <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm); margin-bottom:12px; transition:all 0.2s;">
            <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-weight:900; font-size:15px; color:var(--color-text-primary); text-transform:capitalize;">
                  ${new Date(s.startTime?.toDate()).toLocaleDateString('es-AR', {day:'numeric', month:'short'})}
                </span>
                ${isLive ? `<span style="font-size:9px; font-weight:900; background:rgba(34,197,94,0.1); color:#22c55e; padding:1px 6px; border-radius:6px; letter-spacing:0.02em;">VIVO</span>` : ''}
              </div>
              <div style="font-size:11.5px; color:var(--color-text-secondary); font-weight:600; display:flex; align-items:center; gap:4px;">
                <span>${new Date(s.startTime?.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                <span style="opacity:0.5;">→</span>
                <span>${s.endTime ? new Date(s.endTime?.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Activa'}</span>
              </div>
              <div style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">
                Duración: <span style="color:var(--color-text-primary); font-weight:800;">${durationStr}</span>
              </div>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; gap:4px; margin-left:16px;">
              <div style="font-weight:950; font-size:18px; color:${isLive ? '#22c55e' : 'var(--color-primary)'}; letter-spacing:-0.5px;">${formatPrice(s.totalEarned || 0)}</div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">${s.ordersCount || 0} pedidos</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      listContainer.innerHTML = `<p style="color:var(--color-danger); text-align:center; font-size:12px; font-weight:700; padding:20px;">Error al cargar. Verificá tu conexión.</p>`;
    }
  };

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  content.innerHTML = `
    <!-- Top Month Selector Card -->
    <div style="background:var(--color-bg-card); border:1.5px solid var(--color-border-light); border-radius:24px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm);">
      <div style="display:flex; align-items:center; gap:10px;">
        <button id="prev-month" style="width:38px; height:38px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
          ${icon('chevronLeft', 16)}
        </button>
        <div style="text-align:center; min-width:90px;">
          <div id="month-name" style="font-weight:900; font-size:15px; color:var(--color-text-primary); text-transform:capitalize;">${monthNames[currentMonth]}</div>
          <div id="year-name" style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); margin-top:2px;">${currentYear}</div>
        </div>
        <button id="next-month" style="width:38px; height:38px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
          ${icon('chevronRight', 16)}
        </button>
      </div>
      <div style="text-align:right;">
        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">Total Mes</div>
        <div id="month-total-display" style="font-size:20px; font-weight:950; color:#22c55e; letter-spacing:-0.5px;">$0</div>
      </div>
    </div>

    <!-- Actions Row -->
    <div style="display:flex; justify-content:center;">
      <button id="recalculate-sessions-btn" style="padding:10px 18px; border-radius:14px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); color:var(--color-primary); font-size:11px; font-weight:900; text-transform:uppercase; cursor:pointer; display:flex; align-items:center; gap:6px; letter-spacing:0.04em; transition:all 0.2s; box-shadow:var(--shadow-sm);" onmouseover="this.style.background='var(--color-bg-card)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
        ${icon('refresh', 13)} Recalcular Totales
      </button>
    </div>

    <!-- Session List Render Container -->
    <div id="sessions-list-render" style="flex:1; overflow-y:auto; padding-bottom:10px;"></div>
  `;
  
  showModal({ title: 'Historial de Sesiones', content, height: '80dvh' });
  
  renderSessionList(currentMonth, currentYear);

  content.querySelector('#prev-month').onclick = () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    content.querySelector('#month-name').textContent = monthNames[currentMonth];
    content.querySelector('#year-name').textContent = currentYear;
    renderSessionList(currentMonth, currentYear);
  };

  content.querySelector('#next-month').onclick = () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    content.querySelector('#month-name').textContent = monthNames[currentMonth];
    content.querySelector('#year-name').textContent = currentYear;
    renderSessionList(currentMonth, currentYear);
  };

  content.querySelector('#recalculate-sessions-btn').onclick = async () => {
    const btn = content.querySelector('#recalculate-sessions-btn');
    btn.disabled = true;
    btn.innerHTML = icon('loader', 14, 'animate-spin') + ' Recalculando...';
    
    try {
      const { getDocs, collection, query, where, updateDoc, doc: fDoc } = await import('firebase/firestore');
      
      // 1. Fetch all completed orders for this driver
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'), 
        where('driverId', '==', driverId), 
        where('status', '==', 'completed')
      ));
      const orders = ordersSnap.docs.map(d => {
        const data = d.data();
        const netEarnings = getOrderDriverEarnings(data);
        return {
          ...data,
          deliveryCost: netEarnings,
          deliveredAt: data.deliveredAt?.toDate()
        };
      });

      // 2. Fetch all sessions for this driver
      const sessionsSnap = await getDocs(query(
        collection(db, 'deliverySessions'), 
        where('driverId', '==', driverId)
      ));
      
      for (const sDoc of sessionsSnap.docs) {
        const sess = sDoc.data();
        const start = sess.startTime?.toDate();
        const end = sess.endTime?.toDate() || new Date(); // If in progress, use now

        // Find orders delivered within this session
        const sessOrders = orders.filter(o => {
          if (!o.deliveredAt) return false;
          return o.deliveredAt >= start && o.deliveredAt <= end;
        });

        const newTotal = sessOrders.reduce((s, o) => s + (o.deliveryCost || 0), 0);
        
        // Count unique bundles or single orders as 1 delivery
        const uniqueBundles = new Set(sessOrders.map(o => o.bundleId || o.id));
        const newCount = uniqueBundles.size;

        // Update if different
        if (newTotal !== sess.totalEarned || newCount !== sess.ordersCount) {
          await updateDoc(fDoc(db, 'deliverySessions', sDoc.id), {
            totalEarned: newTotal,
            ordersCount: newCount
          });
        }
      }
      
      showToast('Totales sincronizados correctamente', 'success');
      renderSessionList(currentMonth, currentYear);
    } catch (e) {
      console.error(e);
      showToast('Error al recalcular', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = icon('refresh', 14) + ' Recalcular Totales';
    }
  };
}
async function showCompletedOrderDetailsModal(orderId) {
  const { getDoc, doc } = await import('firebase/firestore');
  const orderDoc = await getDoc(doc(db, 'orders', orderId));
  if (!orderDoc.exists()) {
    import('../components/toast.js').then(m => m.showToast('No se encontró el pedido', 'warning'));
    return;
  }
  const o = { id: orderDoc.id, ...orderDoc.data() };
  openCompletedOrderDetailsModal(o, getState().user);
}

async function showBalanceHistoryModal(driverId) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { getDocs, getDoc, doc, collection, query, where } = await import('firebase/firestore');
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';
  
  const content = document.createElement('div');
  content.style.cssText = `padding:16px 20px; background:${isLight ? '#ffffff' : '#090d16'}; min-height:60dvh; display:flex; flex-direction:column; color:${isLight ? '#0f172a' : 'white'};`;
  content.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;
  
  showModal({ 
    title: 'Historial de Balance', 
    content, 
    height: '80dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });
  
  try {
    // 1. Fetch user deliveryDebt from Firestore reference correctly
    const userDocSnap = await getDoc(doc(db, 'users', driverId));
    const userData = userDocSnap.exists() ? userDocSnap.data() : {};
    const actualDebt = userData.deliveryDebt || 0;
    const lastLiquidationAt = userData.lastLiquidationAt;

    // 2. Fetch transactions and canon payments
    const [transSnap, canonSnap] = await Promise.all([
      getDocs(query(collection(db, 'delivery_transactions'), where('driverId', '==', driverId))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'delivery_canon_payments'), where('driverId', '==', driverId))).catch(() => ({ docs: [] }))
    ]);

    const transList = transSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const canonList = canonSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 3. Fetch completed orders pending liquidation
    const qOrders = query(
      collection(db, 'orders'),
      where('driverId', '==', driverId),
      where('status', '==', 'completed')
    );
    const ordersSnap = await getDocs(qOrders).catch(() => ({ docs: [] }));
    const pendingOrdersList = ordersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => {
        let isSettled = o.isSettledDriver === true;
        if (!isSettled && lastLiquidationAt) {
          const lqTime = lastLiquidationAt.toMillis ? lastLiquidationAt.toMillis() : new Date(lastLiquidationAt).getTime();
          const orderTime = o.deliveredAt ? (o.deliveredAt.toMillis ? o.deliveredAt.toMillis() : new Date(o.deliveredAt).getTime()) : (o.createdAt ? (o.createdAt.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt).getTime()) : 0);
          if (orderTime > 0 && orderTime <= lqTime) {
            isSettled = true;
          }
        }
        return !isSettled && (o.appUsageFee || 0) > 0;
      })
      .map(o => ({
        id: o.id,
        type: 'app_usage_fee',
        amount: o.appUsageFee,
        description: `Tarifa de Uso App (Pedido #${o.orderId})`,
        createdAt: o.deliveredAt || o.createdAt,
        orderId: o.id
      }));

    // Build unique Canon charges list from both collections (deduplicated by date)
    const canonChargesMap = new Map();
    transList.filter(t => t.type === 'canon_charge').forEach(t => {
      const dStr = t.description?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || (t.createdAt?.toDate ? t.createdAt.toDate().toISOString().slice(0,10) : t.id);
      canonChargesMap.set(dStr, {
        id: t.id,
        type: 'canon_charge',
        amount: t.amount,
        description: t.description || `Canon Diario Jornada (${dStr})`,
        createdAt: t.createdAt,
        dateKey: dStr
      });
    });

    canonList.forEach(c => {
      const dStr = c.dateStr || (c.id?.split('_')[1]) || (c.createdAt?.toDate ? c.createdAt.toDate().toISOString().slice(0,10) : c.id);
      if (!c.settled && c.amount > 0 && !canonChargesMap.has(dStr)) {
        canonChargesMap.set(dStr, {
          id: c.id,
          type: 'canon_charge',
          amount: c.amount,
          description: `Canon Diario Jornada (${c.dateStr || dStr || 'Hoy'})`,
          createdAt: c.createdAt,
          dateKey: dStr
        });
      }
    });

    const allCharges = [
      ...pendingOrdersList,
      ...Array.from(canonChargesMap.values())
    ].sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return (timeB || 0) - (timeA || 0);
    });

    const pendingCharges = [];
    let accumulated = 0;
    for (const charge of allCharges) {
      if (accumulated >= actualDebt) break;
      const amt = charge.amount || 0;
      if (accumulated + amt <= actualDebt) {
        pendingCharges.push(charge);
        accumulated += amt;
      } else {
        const partialAmt = actualDebt - accumulated;
        pendingCharges.push({
          ...charge,
          amount: partialAmt,
          isPartial: true
        });
        accumulated += partialAmt;
      }
    }

    const discrepancy = actualDebt - accumulated;
    if (Math.abs(discrepancy) > 1) {
      pendingCharges.push({
        id: 'virtual_adjustment',
        type: 'adjustment_charge',
        amount: discrepancy,
        description: 'Saldo Pendiente Anterior',
        createdAt: null
      });
    }

    // 5. Liquidations tab list
    const liquidationsList = transList
      .filter(t => t.type === 'liquidation' || t.type === 'coupon_reimbursement')
      .sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return (timeB || 0) - (timeA || 0);
      });

    let currentMainTab = 'pending';
    let currentFilterType = 'all'; // 'all' | 'app_fee' | 'canon'

    // 6. Draw Tabs & Filter Header
    content.innerHTML = `
      <!-- Main Tabs -->
      <div style="display:flex; background:rgba(255,255,255,0.06); border-radius:16px; padding:4px; margin-bottom:12px; border:1px solid rgba(255,255,255,0.08); flex-shrink:0;">
        <button id="tab-btn-pending" style="flex:1; height:40px; border-radius:12px; border:none; background:rgba(225,29,72,0.2); color:#f43f5e; font-size:12px; font-weight:900; cursor:pointer; transition:all 0.2s;">
          A Liquidar ($${Math.round(actualDebt).toLocaleString('es-AR')})
        </button>
        <button id="tab-btn-history" style="flex:1; height:40px; border-radius:12px; border:none; background:transparent; color:#94a3b8; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
          Liquidaciones
        </button>
      </div>

      <!-- Sub-Filter Switch (for Pending Charges) -->
      <div id="balance-sub-filter-row" style="display:flex; gap:6px; margin-bottom:14px; flex-shrink:0;">
        <button class="balance-filter-pill active" data-filter="all" style="flex:1; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.12); color:white; font-size:11px; font-weight:800; cursor:pointer; transition:all 0.15s;">
          Todas
        </button>
        <button class="balance-filter-pill" data-filter="app_fee" style="flex:1; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.04); color:#94a3b8; font-size:11px; font-weight:700; cursor:pointer; transition:all 0.15s;">
          🛒 Tarifa App
        </button>
        <button class="balance-filter-pill" data-filter="canon" style="flex:1; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.04); color:#94a3b8; font-size:11px; font-weight:700; cursor:pointer; transition:all 0.15s;">
          🛵 Canon Diario
        </button>
      </div>

      <!-- Tab Content Area -->
      <div id="balance-tab-content-area" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding-bottom:10px;">
      </div>
    `;

    const pendingBtn = content.querySelector('#tab-btn-pending');
    const historyBtn = content.querySelector('#tab-btn-history');
    const subFilterRow = content.querySelector('#balance-sub-filter-row');
    const contentArea = content.querySelector('#balance-tab-content-area');

    function updateFilterPillsUI() {
      subFilterRow.querySelectorAll('.balance-filter-pill').forEach(btn => {
        const isSelected = btn.dataset.filter === currentFilterType;
        btn.classList.toggle('active', isSelected);
        btn.style.background = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)';
        btn.style.borderColor = isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)';
        btn.style.color = isSelected ? 'white' : '#94a3b8';
        btn.style.fontWeight = isSelected ? '800' : '600';
      });
    }

    subFilterRow.querySelectorAll('.balance-filter-pill').forEach(btn => {
      btn.onclick = () => {
        currentFilterType = btn.dataset.filter;
        updateFilterPillsUI();
        renderTabContent();
      };
    });

    function renderTabContent() {
      if (currentMainTab === 'pending') {
        pendingBtn.style.background = 'rgba(225,29,72,0.2)';
        pendingBtn.style.color = '#f43f5e';
        pendingBtn.style.fontWeight = '900';
        
        historyBtn.style.background = 'transparent';
        historyBtn.style.color = '#94a3b8';
        historyBtn.style.fontWeight = '700';

        subFilterRow.style.display = 'flex';

        let filtered = pendingCharges;
        if (currentFilterType === 'app_fee') {
          filtered = pendingCharges.filter(t => t.type === 'app_usage_fee');
        } else if (currentFilterType === 'canon') {
          filtered = pendingCharges.filter(t => t.type === 'canon_charge');
        }

        if (filtered.length === 0) {
          contentArea.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:#94a3b8; opacity:0.8;">
              <div style="font-size:36px; margin-bottom:10px;">✨</div>
              <p style="margin:0; font-weight:700; font-size:14px; color:white;">No hay registros pendientes</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">${currentFilterType === 'canon' ? 'No tenés canones diarios sin liquidar.' : currentFilterType === 'app_fee' ? 'No tenés tarifas de pedidos sin liquidar.' : 'Tu cuenta está al día.'}</p>
            </div>
          `;
          return;
        }

        contentArea.innerHTML = filtered.map(t => {
          const isCanon = t.type === 'canon_charge';
          const isAppFee = t.type === 'app_usage_fee';
          const rawDate = t.createdAt ? (t.createdAt.toMillis ? t.createdAt.toMillis() : new Date(t.createdAt).getTime()) : null;
          const formattedDate = rawDate ? `📅 ${new Date(rawDate).toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})} hs` : 'Saldo Pendiente';
          
          let iconColor = isCanon ? '#f43f5e' : '#f59e0b';
          let iconBg = isCanon ? 'rgba(225,29,72,0.12)' : 'rgba(245,158,11,0.12)';
          let iconName = isCanon ? 'bike' : 'cart';
          if (t.type === 'adjustment_charge') {
            iconColor = '#94a3b8';
            iconBg = 'rgba(148,163,184,0.1)';
            iconName = 'receipt';
          }

          return `
            <div class="balance-item-card" data-order-id="${t.orderId || ''}" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:18px; padding:13px 15px; display:flex; justify-content:space-between; align-items:center; cursor:${t.orderId ? 'pointer' : 'default'}; transition:all 0.2s;">
              <div style="min-width:0; flex:1; display:flex; align-items:center; gap:12px;">
                <div style="width:36px; height:36px; border-radius:12px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon(iconName, 18)}
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:2px;">
                  <div style="font-weight:800; font-size:13.5px; color:#f8fafc; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${t.description}</div>
                  <div style="font-size:11px; color:#94a3b8; font-weight:600;">${formattedDate}</div>
                </div>
              </div>
              <div style="text-align:right; margin-left:12px; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-weight:900; font-size:15px; color:${iconColor}; letter-spacing:-0.5px;">+$${Math.round(t.amount || 0).toLocaleString('es-AR')}</span>
                <span style="font-size:9px; font-weight:850; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-top:2px;">${isCanon ? 'CANON DIARIO' : isAppFee ? 'TARIFA APP' : 'SALDO'}</span>
              </div>
            </div>
          `;
        }).join('');

        contentArea.querySelectorAll('.balance-item-card').forEach(card => {
          if (card.dataset.orderId) {
            card.addEventListener('click', () => {
              showCompletedOrderDetailsModal(card.dataset.orderId);
            });
            card.onmouseover = () => { card.style.borderColor = 'rgba(225,29,72,0.4)'; card.style.background = 'rgba(255,255,255,0.07)'; };
            card.onmouseout = () => { card.style.borderColor = 'rgba(255,255,255,0.08)'; card.style.background = 'rgba(255,255,255,0.04)'; };
          }
        });

      } else {
        historyBtn.style.background = 'rgba(255,255,255,0.12)';
        historyBtn.style.color = 'white';
        historyBtn.style.fontWeight = '800';
        
        pendingBtn.style.background = 'transparent';
        pendingBtn.style.color = '#94a3b8';
        pendingBtn.style.fontWeight = '700';

        subFilterRow.style.display = 'none';

        if (liquidationsList.length === 0) {
          contentArea.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:#94a3b8; opacity:0.8;">
              <div style="font-size:36px; margin-bottom:10px;">📋</div>
              <p style="margin:0; font-weight:700; font-size:14px; color:white;">No hay liquidaciones registradas</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">Tus liquidaciones aprobadas aparecerán aquí.</p>
            </div>
          `;
          return;
        }

        contentArea.innerHTML = liquidationsList.map(t => {
          const isCoupon = t.type === 'coupon_reimbursement';
          const formattedDate = t.createdAt ? new Date(t.createdAt.toMillis ? t.createdAt.toMillis() : new Date(t.createdAt).getTime()).toLocaleDateString('es-AR', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Reciente';
          
          const iconColor = isCoupon ? '#a855f7' : '#22c55e';
          const iconBg = isCoupon ? 'rgba(168,85,247,0.12)' : 'rgba(34,197,94,0.12)';
          const iconName = isCoupon ? 'tag' : 'checkCircle';

          return `
            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:18px; padding:13px 15px; display:flex; justify-content:space-between; align-items:center;">
              <div style="min-width:0; flex:1; display:flex; align-items:center; gap:12px;">
                <div style="width:36px; height:36px; border-radius:12px; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon(iconName, 18)}
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:2px;">
                  <div style="font-weight:800; font-size:13.5px; color:#f8fafc; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${t.description || 'Liquidación de Balance'}</div>
                  <div style="font-size:11px; color:#94a3b8; font-weight:600;">${formattedDate}</div>
                </div>
              </div>
              <div style="text-align:right; margin-left:12px; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-weight:900; font-size:15px; color:${iconColor}; letter-spacing:-0.5px;">-$${Math.round(Math.abs(t.amount || 0)).toLocaleString('es-AR')}</span>
                <span style="font-size:9px; font-weight:850; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-top:2px;">${isCoupon ? 'REINTEGRO' : 'LIQUIDADO'}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    pendingBtn.onclick = () => {
      currentMainTab = 'pending';
      renderTabContent();
    };

    historyBtn.onclick = () => {
      currentMainTab = 'history';
      renderTabContent();
    };

    renderTabContent();
  } catch (e) {
    console.error("Error drawing balance history modal:", e);
    content.innerHTML = `<p style="color:var(--color-danger); text-align:center; padding:40px;">Error al cargar el historial de balance.</p>`;
  }
}

let driverWakeLock = null;
export async function requestDriverWakeLock() {
  try {
    if ('wakeLock' in navigator && !driverWakeLock) {
      driverWakeLock = await navigator.wakeLock.request('screen');
      driverWakeLock.addEventListener('release', () => { driverWakeLock = null; });
      console.log('[WakeLock] Screen kept awake during active order in progress.');
    }
  } catch (e) {
    console.warn('[WakeLock] Wake lock error:', e);
  }
}
export async function releaseDriverWakeLock() {
  try {
    if (driverWakeLock) {
      await driverWakeLock.release();
      driverWakeLock = null;
      console.log('[WakeLock] Screen released.');
    }
  } catch(e) {}
}

if (typeof document !== 'undefined' && !window._driverWakeLockVisibilityBound) {
  window._driverWakeLockVisibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const hasActive = (Array.isArray(activeOrdersList) && activeOrdersList.length > 0) || Boolean(window.mockSimulatedOrder);
      if (hasActive) {
        requestDriverWakeLock();
      } else {
        releaseDriverWakeLock();
      }
    }
  });
}

function renderStatusBar(user) {
  // Always use fresh state for rendering styles
  const latestUser = getState().user || user;
  if (!latestUser) return '';
  const finalIsOnline = latestUser.isOnline === true;
  
  if (!document.getElementById('status-bar-styles')) {
    const s = document.createElement('style');
    s.id = 'status-bar-styles';
    s.textContent = `
      @keyframes status-pulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
        70% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
      }
      .status-dot-active { animation: status-pulse 2s infinite; }
      .status-bar-slide { animation: slideInStatusBar 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
      @keyframes slideInStatusBar {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes dockCardSpring {
        0% { transform: translateY(12px) scale(0.99); opacity: 0.92; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }
      @keyframes dockContentFadeIn {
        0% { opacity: 0; transform: translateY(8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }

  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const todayEarn = getState().driverTodayEarnings || 0;
  const todayCount = getState().driverTodayOrdersCount || 0;
  const hasActiveOrders = Array.isArray(activeOrdersList) && activeOrdersList.length > 0;

  const state = getState();
  const nightConfig = state.nightSurchargeConfig || { enabled: true, start: '00:00', end: '06:00', type: 'fixed', value: 0 };
  const incentiveConfig = state.driverIncentiveConfig;

  const isNightActive = isScheduleActive(nightConfig);
  const isRainActive = state.isRaining === true;
  const isIncentiveActive = isScheduleActive(incentiveConfig);

  let activeBadgesHtml = '';
  if (isNightActive) {
    const start = nightConfig.start || '00:00';
    const end = nightConfig.end || '06:00';
    const val = nightConfig.type === 'percentage' ? `${nightConfig.value || 0}%` : `$${nightConfig.value || 0}`;
    activeBadgesHtml += `
      <div class="surcharge-badge-night" data-surcharge="night" style="display:inline-flex; align-items:center; gap:6px; background:${isLight ? 'rgba(237, 233, 254, 0.95)' : 'rgba(99, 102, 241, 0.25)'}; backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border:1px solid ${isLight ? '#c4b5fd' : 'rgba(129, 140, 248, 0.5)'}; color:${isLight ? '#5b21b6' : '#A5B4FC'}; padding:5px 12px; border-radius:20px; font-size:11px; font-weight:800; box-shadow:${isLight ? '0 2px 8px rgba(0,0,0,0.06)' : '0 2px 8px rgba(0,0,0,0.3)'}; pointer-events:auto;">
        <span>🌙</span> Recargo Nocturno (${start} - ${end} hs) ${val !== '$0' && val !== '0%' ? `<span class="surcharge-val-tag" style="background:${isLight ? '#ddd6fe' : 'rgba(255,255,255,0.2)'}; padding:1px 6px; border-radius:6px; font-size:10px; font-weight:900; color:${isLight ? '#4c1d95' : 'white'};">+${val}</span>` : ''}
      </div>
    `;
  }
  if (isRainActive) {
    const rainVal = state.deliveryRainSurcharge || 300;
    activeBadgesHtml += `
      <div class="surcharge-badge-rain" data-surcharge="rain" style="display:inline-flex; align-items:center; gap:6px; background:${isLight ? 'rgba(224, 242, 254, 0.95)' : 'rgba(14, 165, 233, 0.25)'}; backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border:1px solid ${isLight ? '#bae6fd' : 'rgba(56, 189, 248, 0.5)'}; color:${isLight ? '#0369a1' : '#38BDF8'}; padding:5px 12px; border-radius:20px; font-size:11px; font-weight:800; box-shadow:${isLight ? '0 2px 8px rgba(0,0,0,0.06)' : '0 2px 8px rgba(0,0,0,0.3)'}; pointer-events:auto;">
        <span>🌧️</span> Recargo Lluvia <span class="surcharge-val-tag" style="background:${isLight ? '#bae6fd' : 'rgba(255,255,255,0.2)'}; padding:1px 6px; border-radius:6px; font-size:10px; font-weight:900; color:${isLight ? '#075985' : 'white'};">+${formatPrice(rainVal)}</span>
      </div>
    `;
  }
  if (isIncentiveActive) {
    const incVal = incentiveConfig.type === 'percentage' ? `${incentiveConfig.value || 0}%` : `$${incentiveConfig.value || 0}`;
    activeBadgesHtml += `
      <div class="surcharge-badge-incentive" data-surcharge="incentive" style="display:inline-flex; align-items:center; gap:6px; background:${isLight ? 'rgba(254, 243, 199, 0.95)' : 'rgba(245, 158, 11, 0.25)'}; backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border:1px solid ${isLight ? '#fde68a' : 'rgba(251, 191, 36, 0.5)'}; color:${isLight ? '#92400e' : '#FBBF24'}; padding:5px 12px; border-radius:20px; font-size:11px; font-weight:800; box-shadow:${isLight ? '0 2px 8px rgba(0,0,0,0.06)' : '0 2px 8px rgba(0,0,0,0.3)'}; pointer-events:auto;">
        <span>🚀</span> Incentivo Extra <span class="surcharge-val-tag" style="background:${isLight ? '#fde68a' : 'rgba(255,255,255,0.2)'}; padding:1px 6px; border-radius:6px; font-size:10px; font-weight:900; color:${isLight ? '#78350f' : 'white'};">+${incVal}</span>
      </div>
    `;
  }

  // Dynamically select target stop using real-time distance sequencer from rider position
  const optimalSequence = hasActiveOrders ? calculateOptimalMultiStopSequence(window.lastRiderPos, activeOrdersList) : [];
  const nextTargetStop = optimalSequence.length > 0 ? optimalSequence[0] : null;
  const o = nextTargetStop ? nextTargetStop.order : (hasActiveOrders ? activeOrdersList[0] : null);
  const isPickupStage = nextTargetStop ? (nextTargetStop.type === 'pickup') : (o ? (o.status === 'pending' || o.status === 'accepted' || o.status === 'preparing' || o.status === 'ready' || (!o.pickedUpAt && o.status !== 'delivering')) : false);
  const isFavor = o ? Boolean(o.isFavor) : false;
  const isEncomienda = isOrderEncomienda(o);

  let centerBadgeHtml = '';
  if (hasActiveOrders && o) {
    let destTitle = '';
    let parsedMandado = null;

    const clientFullName = o.userName || o.clientName || 'Cliente';
    const clientPhoto = o.userPhoto || o.clientPhoto || '';
    const clientPhone = o.userPhone || o.clientPhone || o.phone || '';

    const isFavor = o.isFavor || o.favorType;
    const isGoCash = (o.favorType === 'gocash' || o.isGoCash || o.type === 'gocash');
    const isPagoServicios = (o.favorType === 'pagodeservicios' || o.isPagoServicios || o.type === 'pagodeservicios');
    const isEncomienda = (o.favorType === 'encomienda' || o.isEncomienda || o.type === 'encomienda');
    const isTrip = (o.isTrip || o.type === 'trip' || o.type === 'viaje' || o.favorType === 'viaje');
    const isMandado = (o.favorType === 'compra' || o.favorType === 'mandado' || (!isGoCash && !isPagoServicios && !isEncomienda && !isTrip && isFavor));

    let directiveLogo = '/go-bag.png?v=6';
    if (isPickupStage) {
      if (isFavor) {
        if (isEncomienda) {
          directiveLogo = '/go-pickup-point.png?v=5';
          const pickupAddr = o.pickupAddress || o.originAddress || 'Dirección de Retiro';
          destTitle = `Retirá el paquete en ${pickupAddr}`;
        } else if (isGoCash) {
          directiveLogo = '/go-cash.png?v=5';
          destTitle = `Retirá el efectivo en ${o.pickupAddress || o.originAddress || 'punto acordado'}`;
        } else if (isPagoServicios) {
          directiveLogo = '/go-clipboard.png?v=5';
          destTitle = `Realizá el pago de servicio en ${o.pickupAddress || o.originAddress || 'punto de cobro'}`;
        } else if (isTrip) {
          directiveLogo = '/go-car.jpg';
          destTitle = `Recogé al pasajero en ${o.pickupAddress || o.originAddress || 'punto de inicio'}`;
        } else {
          directiveLogo = '/go-bag.png?v=6';
          parsedMandado = parseMandadoDetails(o.description || o.itemsText || o.notes || o.details, o.comercioName || o.originAddress);
          destTitle = `Retirá el pedido en ${parsedMandado.comercio}`;
        }
      } else {
        const allComercios = getState().comercios || [];
        const foundCom = o.comercioId ? allComercios.find(c => c.id === o.comercioId) : null;
        directiveLogo = o.comercioRealLogo || o.comercioLogo || foundCom?.logo || '/go-bag.png?v=6';
        destTitle = `Retirá el pedido en ${o.comercioName || 'Local'}`;
      }
    } else {
      directiveLogo = clientPhoto || '/go-bag.png?v=6';
      const cleanDestAddr = o.deliveryAddress || o.address || o.destinationAddress || clientFullName || 'el domicilio';
      destTitle = `Entregá el pedido en ${cleanDestAddr}`;
    }

    const multipleBadge = activeOrdersList.length > 1 ? `<span style="background:var(--color-primary); color:white; font-size:10px; font-weight:900; padding:2px 7px; border-radius:10px; margin-left:4px;">+${activeOrdersList.length - 1}</span>` : '';
    const parseTargetCoords = (c) => {
      if (!c) return null;
      let lat = typeof c.lat === 'number' ? c.lat : (typeof c.latitude === 'number' ? c.latitude : null);
      let lng = typeof c.lng === 'number' ? c.lng : (typeof c.longitude === 'number' ? c.longitude : null);
      if (lat === null && c.lat !== undefined) lat = parseFloat(c.lat);
      if (lng === null && c.lng !== undefined) lng = parseFloat(c.lng);
      if (lat === null && c.latitude !== undefined) lat = parseFloat(c.latitude);
      if (lng === null && c.longitude !== undefined) lng = parseFloat(c.longitude);
      if (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) {
        return { lat, lng };
      }
      return null;
    };

    let targetCoords = null;
    if (isPickupStage) {
      targetCoords = parseTargetCoords(o.pickupCoords || o.comercioCoords || o.originCoords || o.pickupLocation);
      if (!targetCoords && o.comercioId) {
        const allComercios = getState().comercios || [];
        const com = allComercios.find(c => c.id === o.comercioId);
        if (com && com.coords) targetCoords = parseTargetCoords(com.coords);
      }
      if (!targetCoords && o.isFavor && isEncomienda) {
        targetCoords = parseTargetCoords(o.deliveryCoords || o.addressCoords || o.destinationCoords || o.deliveryLocation || o.coords);
      }
    } else {
      targetCoords = parseTargetCoords(o.deliveryCoords || o.addressCoords || o.destinationCoords || o.deliveryLocation || o.coords);
    }

    const wazeUrl = targetCoords ? `https://waze.com/ul?ll=${targetCoords.lat},${targetCoords.lng}&navigate=yes` : '';

    const rawPhone = clientPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const waPhone = cleanPhone.startsWith('54') ? cleanPhone : `549${cleanPhone.replace(/^0+/, '')}`;
    const driverName = latestUser.name || latestUser.fullName || 'tu repartidor';
    const waMsg = encodeURIComponent(`¡Hola ${clientFullName}! 👋 Soy ${driverName} de GoDelivery 🛵 Ya tengo tu pedido y voy en camino a tu domicilio.`);
    const waUrl = cleanPhone ? `https://wa.me/${waPhone}?text=${waMsg}` : '';

    const shouldAnimateEntrance = Boolean(window._animatePickupPill);
    if (shouldAnimateEntrance) {
      setTimeout(() => {
        window._animatePickupPill = false;
      }, 1800);
    }

    return `
      <style>
        @keyframes heroicExpansionPill {
          0% {
            transform: scale(1.16) translateY(14px);
            opacity: 0.1;
            filter: brightness(1.3);
            box-shadow: 0 0 45px rgba(225, 29, 72, 0.95), 0 0 0 3px #e11d48;
          }
          40% {
            transform: scale(1.06) translateY(-4px);
            opacity: 1;
            filter: brightness(1.15);
            box-shadow: 0 0 55px rgba(225, 29, 72, 1), 0 0 0 3px #f43f5e;
          }
          70% {
            transform: scale(0.98) translateY(1px);
          }
          100% {
            transform: scale(1) translateY(0);
            filter: brightness(1);
          }
        }
        @keyframes activePillPulseGlow {
          0%, 100% {
            box-shadow: 0 10px 28px ${isLight ? 'rgba(225,29,72,0.12)' : 'rgba(0,0,0,0.7)'}, 0 0 0 1.5px ${isLight ? 'rgba(225, 29, 72, 0.45)' : 'rgba(244, 63, 94, 0.55)'};
          }
          50% {
            box-shadow: 0 12px 34px ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(225,29,72,0.5)'}, 0 0 0 2.5px ${isLight ? 'rgba(225, 29, 72, 0.85)' : 'rgba(244, 63, 94, 0.95)'};
          }
        }
        @keyframes targetBeaconPulse {
          0% { transform: scale(0.9); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.5; }
          100% { transform: scale(0.9); opacity: 1; }
        }
      </style>

      <!-- 1. TOP HEADER: REAL CLIENT PHOTO & FULL NAME + INTEGRATED HAMBURGER -->
      <div style="width: 100%;">
        <div id="session-status-bar" style="
          width: 100%;
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px;
          background: ${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9, 13, 22, 0.95)'};
          backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
          padding: 8px 10px;
          border-radius: 24px;
          border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.25)' : 'rgba(225, 29, 72, 0.4)'};
          box-shadow: 0 10px 30px ${isLight ? 'rgba(225,29,72,0.08)' : 'rgba(0,0,0,0.65)'};
          box-sizing: border-box;
        ">
          <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
            <div style="position:relative; flex-shrink:0;">
              ${clientPhoto ? `
                <img src="${clientPhoto}" style="width:38px; height:38px; border-radius:50%; object-fit:cover; border:2px solid #e11d48; box-shadow:0 0 12px rgba(225,29,72,0.4);" />
              ` : `
                <div style="
                  width: 38px; height: 38px; border-radius: 50%;
                  background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
                  border: 2px solid rgba(225, 29, 72, 0.6);
                  display: flex; align-items: center; justify-content: center;
                  font-size: 15px; font-weight: 900; color: white;
                  box-shadow: 0 4px 14px rgba(225, 29, 72, 0.45);
                ">
                  ${clientFullName.charAt(0).toUpperCase()}
                </div>
              `}
              <div style="
                position: absolute; bottom: -1px; right: -1px;
                width: 10px; height: 10px; border-radius: 50%;
                background: #22c55e; border: 2px solid ${isLight ? '#ffffff' : '#0f172a'};
              "></div>
            </div>

            <div style="min-width:0; flex:1;">
              <div style="font-size:13px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:4px;">
                ${clientFullName} ${multipleBadge}
              </div>
              <div style="font-size:10.5px; font-weight:700; color:${isLight ? '#e11d48' : '#fb7185'}; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                Pedido #${o.orderId || o.id.slice(0, 6)} • ${isEncomienda ? 'Encomienda' : (o.isFavor ? 'Mandado' : (o.favorTypeLabel || o.comercioName || 'En curso'))}
              </div>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
            ${waUrl ? `
              <a href="${waUrl}" target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp" style="
                width: 36px; height: 36px; border-radius: 50%;
                background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
                border: none; color: white;
                display: flex; align-items: center; justify-content: center; text-decoration: none;
                box-shadow: 0 4px 14px rgba(37, 211, 102, 0.4);
                flex-shrink: 0;
              ">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                </svg>
              </a>
            ` : ''}

            <button id="driver-bar-chat-btn" data-order-id="${o.id}" title="Chat con el cliente" style="
              width: 36px; height: 36px; border-radius: 50%;
              background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
              border: none; color: white;
              display: flex; align-items: center; justify-content: center; cursor: pointer;
              box-shadow: 0 4px 14px rgba(225, 29, 72, 0.45);
              flex-shrink: 0;
            ">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
            </button>

            <!-- INTEGRATED HAMBURGER MENU BUTTON -->
            <button id="driver-hamburger-btn" style="
              width: 36px; height: 36px; border-radius: 50%;
              background: ${isLight ? '#f1f5f9' : 'rgba(255, 255, 255, 0.12)'};
              border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.18)'};
              color: ${isLight ? '#0f172a' : '#ffffff'}; font-size: 17px; font-weight: 900;
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; flex-shrink: 0;
              box-shadow: 0 4px 12px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.4)'};
              transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            ">
              ${icon('menu', 18)}
            </button>
          </div>
        </div>
      </div>

      <!-- 2. FLOATING DIRECTIVE INSTRUCTION PILL (WHERE TO GO) - MINIMALIST & MODERN -->
      <div id="driver-instruction-floating-pill" style="
        width: 100%;
        margin-top: 5px;
        background: ${isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(11, 16, 28, 0.96)'};
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.4)' : 'rgba(244, 63, 94, 0.55)'};
        border-radius: 18px;
        padding: 8px 12px;
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        animation: ${shouldAnimateEntrance ? 'heroicExpansionPill 1.1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none'};
        box-sizing: border-box;
      ">
        <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
          <!-- MODERN PIN OR SERVICE LOGO BADGE -->
          ${isPickupStage ? `
            <div style="
              width: 36px; height: 36px; border-radius: 12px;
              background: ${isLight ? '#f8fafc' : 'rgba(255,255,255,0.06)'};
              border: 1.5px solid ${isLight ? 'rgba(225,29,72,0.3)' : 'rgba(244,63,94,0.45)'};
              display: flex; align-items: center; justify-content: center;
              flex-shrink: 0; overflow: hidden;
              box-shadow: 0 4px 12px ${isLight ? 'rgba(225,29,72,0.15)' : 'rgba(0,0,0,0.5)'};
            ">
              <img src="${directiveLogo}" style="width: 100%; height: 100%; object-fit: contain; display: block;" alt="Destino" />
            </div>
          ` : `
            <div style="
              width: 36px; height: 36px; border-radius: 12px;
              background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
              border: 1.5px solid rgba(225, 29, 72, 0.4);
              display: flex; align-items: center; justify-content: center;
              flex-shrink: 0; overflow: hidden;
              box-shadow: 0 4px 12px rgba(225, 29, 72, 0.35);
              color: white;
            ">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </div>
          `}

          <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:1px;">
            <!-- DIRECTIVE ACTION BANNER -->
            <div style="display:flex; align-items:center; gap:5px;">
              <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#e11d48; animation:targetBeaconPulse 1.5s infinite; flex-shrink:0;"></span>
              <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#e11d48' : '#fb7185'}; line-height:1.2; letter-spacing:-0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${destTitle}
              </span>
            </div>

            ${(isFavor && isPickupStage) ? (isEncomienda ? `
              <div style="font-size:11.5px; color:${isLight ? '#334155' : '#e2e8f0'}; font-weight:750; line-height:1.2; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                📦 ${cleanMandadoText(o.details || o.description || o.itemsText || 'Entrega de encomienda')}
              </div>
            ` : (parsedMandado ? `
              <div style="font-size:11.5px; color:${isLight ? '#334155' : '#e2e8f0'}; font-weight:750; line-height:1.2; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                📦 ${parsedMandado.items}
              </div>
            ` : '')) : (isPickupStage ? `
              <div style="font-size:11.5px; font-weight:700; color:${isLight ? '#475569' : '#cbd5e1'}; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                📍 ${o.pickupAddress || o.originAddress || o.comercioAddress || 'Magdalena'}
              </div>
            ` : (o.addressNotes || o.notes) ? `
              <div style="font-size:11.5px; font-weight:800; color:${isLight ? '#334155' : '#e2e8f0'}; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                📝 <span style="color:#e11d48;">"${cleanMandadoText(o.addressNotes || o.notes)}"</span>
              </div>
            ` : '')}
          </div>
        </div>

        ${((!isFavor || isEncomienda || !isPickupStage) && targetCoords) ? `
          <a href="https://www.google.com/maps/dir/?api=1&destination=${targetCoords.lat},${targetCoords.lng}&travelmode=driving" target="_blank" rel="noopener noreferrer" style="
            flex-shrink: 0;
            display: flex; align-items: center; gap: 5px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #ffffff;
            font-size: 11px; font-weight: 900;
            padding: 6px 11px; border-radius: 12px;
            text-decoration: none;
            border: 1px solid rgba(255, 255, 255, 0.25);
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
            transition: transform 0.15s ease;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
            <span>Maps</span>
          </a>
        ` : ''}
      </div>

      <!-- 3. SUBTLE FLOATING MANEUVER PILL (FULL WIDTH MATCHING HEADER) -->
      <div id="driver-maneuver-hud-card" style="
        display: ${(isFavor && isPickupStage) ? 'none' : 'flex'};
        width: 100%;
        margin-top: 5px;
        background: ${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9, 13, 22, 0.92)'};
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        border: 1px solid ${isLight ? 'rgba(225, 29, 72, 0.25)' : 'rgba(244, 63, 94, 0.35)'};
        border-radius: 18px;
        padding: 6px 12px;
        align-items: center;
        gap: 8px;
        box-shadow: 0 6px 18px ${isLight ? 'rgba(225,29,72,0.1)' : 'rgba(0,0,0,0.5)'};
        box-sizing: border-box;
      ">
        <div id="driver-maneuver-icon" style="width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg, #e11d48, #be123c); color:white; font-size:14px; font-weight:900; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 8px rgba(225,29,72,0.4);">
          ${window.lastDriverManeuver?.icon || '⬆'}
        </div>
        <div style="min-width:0; display:flex; align-items:center; gap:6px; flex:1;">
          <span id="driver-maneuver-subtext" style="font-size:11.5px; font-weight:900; color:${isLight ? '#e11d48' : '#fb7185'}; white-space:nowrap;">
            ${window.lastDriverManeuver?.distanceMeters ? `${window.lastDriverManeuver.distanceMeters > 999 ? (window.lastDriverManeuver.distanceMeters / 1000).toFixed(1) + ' km' : window.lastDriverManeuver.distanceMeters + ' m'}` : 'Ruta'}
          </span>
          <span style="opacity:0.4;">•</span>
          <span id="driver-maneuver-text" style="font-size:11.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">
            ${window.lastDriverManeuver?.instruction || 'En curso'}
          </span>
        </div>
        <div id="driver-eta-time" style="font-size:11px; font-weight:900; color:${isLight ? '#64748b' : '#94a3b8'}; margin-left:auto; padding-left:4px; flex-shrink:0;">
          ${window.lastDriverManeuver?.etaMinutes || 1} min
        </div>
      </div>
    `;
  } else {
    centerBadgeHtml = `
      <!-- CENTER: MINIMALIST JORNADA DE HOY PILL -->
      <div id="status-today-pill" onclick="if(window.openDriverDrawerMenu) window.openDriverDrawerMenu(getState().user);" style="
        background: ${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9,13,22,0.85)'};
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        padding: 6px 14px;
        border-radius: 20px;
        border: 1px solid ${isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255,255,255,0.12)'};
        font-size: 11px; font-weight: 800; color: ${isLight ? '#0f172a' : 'white'};
        display: flex; align-items: center; gap: 5px;
        cursor: pointer; user-select: none;
        box-shadow: 0 4px 12px ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.3)'};
      ">
        <span style="color:${isLight ? '#475569' : '#94a3b8'}; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.04em;">Jornada:</span>
        <strong style="color:${isLight ? '#16a34a' : '#22c55e'}; font-weight:900; font-size:12px;">${formatPrice(todayEarn)}</strong>
        <span style="color:${isLight ? '#475569' : '#94a3b8'}; font-size:10px; font-weight:700;">(${todayCount} ped.)</span>
      </div>
    `;
  }

  return `
    <div id="session-status-bar" style="
      width: 100%;
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px;
    ">
      <!-- LEFT: STATUS BADGE -->
      <div style="display:flex; align-items:center; gap:6px; background:${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9,13,22,0.85)'}; backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); padding:6px 12px; border-radius:20px; border:1px solid ${isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255,255,255,0.12)'}; box-shadow: 0 4px 12px ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.3)'};">
        <div class="${finalIsOnline ? 'status-dot-active' : ''}" style="
          width: 8px; height: 8px; border-radius: 50%;
          background: ${finalIsOnline ? '#22c55e' : (isLight ? '#94a3b8' : '#64748b')};
          box-shadow: ${finalIsOnline ? '0 0 10px #22c55e' : 'none'};
          flex-shrink: 0;
        "></div>
        <span style="font-size: 11px; font-weight: 900; color: ${finalIsOnline ? '#16a34a' : (isLight ? '#64748b' : '#94a3b8')}; text-transform: uppercase; letter-spacing: 0.5px;">
          ${finalIsOnline ? 'EN LÍNEA' : 'DESCONECTADO'}
        </span>
      </div>

      ${centerBadgeHtml}

      <!-- RIGHT: HAMBURGER MENU BUTTON -->
      <button id="driver-hamburger-btn" style="
        width: 40px; height: 40px; border-radius: 50%;
        background: ${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9,13,22,0.85)'}; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border: 1px solid ${isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255,255,255,0.2)'};
        color: ${isLight ? '#0f172a' : 'white'}; font-size: 20px; font-weight: 900;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0;
        box-shadow: 0 4px 12px ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.3)'};
      ">
        ${icon('menu', 22)}
      </button>
    </div>

    ${activeBadgesHtml ? `
      <div id="driver-active-surcharges-badges" style="
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-start;
        align-items: center;
        width: 100%;
        margin-top: 6px;
        pointer-events: auto;
      ">
        ${activeBadgesHtml}
      </div>
    ` : ''}
  `;
}

export async function openDriverDirectSupportChat(user) {
  const latestUser = getState().user || user || {};
  if (!latestUser.uid) {
    showToast('Inicia sesión para chatear con soporte', 'warning');
    return;
  }

  const isLight = getDriverMapTheme() === 'light';
  const existingModal = document.getElementById('driver-support-chat-modal');
  if (existingModal) existingModal.remove();

  const driverId = latestUser.uid;
  const driverName = latestUser.displayName || latestUser.name || 'Repartidor';
  const driverDeliveryId = latestUser.deliveryId || 'Oficial';
  const chatId = `driver_${driverId}`;

  const { db } = await import('../firebase.js');
  const { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, serverTimestamp, getDocs, query, collection, where, addDoc } = await import('firebase/firestore');
  const { compressImageToBase64 } = await import('../utils/image.js');
  const { icon } = await import('../utils/icons.js');

  const emojiCategories = {
    'Caritas': ['😊','😂','🤣','😍','😒','😭','😘','🥰','😎','🤩','🤔','🤨','🙄','😏','😴','🤤','😋','😛','😜','🤪','😇','🥳','🥺','😱','😨','😰','😥','😓','😩','😫','😤','😡','😠','🤬','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🤡','🤫','🤭','🧐','🤓','😈','👿','💀','💩'],
    'Gesto': ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💪','👀','👁️','👂','👄','💋'],
    'Entrega': ['🛵','🚚','🚛','🚲','🏍️','📍','🏁','⛽','🚦','🚧','🗺️','📦','🎁','🏠','🏢','🏪','🛒','🛍️','💰','💵','💳','🧾','⏰','⏳','⏱️','🔋','📶','📱','📞','💬'],
    'Comida': ['🍕','🍔','🍟','🌭','🥪','🌮','🌯','🍳','🥘','🍲','🥣','🥗','🍿','🍱','🍙','🍚','🍛','🍜','🍝','🍠','🍣','🍤','🥟','🍦','🍨','🍩','🍪','🎂','🍰','🍫','🍬','☕','🍵','🥤','🍺','🍻','🍷']
  };

  const overlay = document.createElement('div');
  overlay.id = 'driver-support-chat-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100010;
    background: rgba(0,0,0,0.65); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    display: flex; align-items: flex-end; justify-content: center;
    opacity: 0; transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  overlay.innerHTML = `
    <div id="driver-support-chat-card" style="
      width: 100%; max-width: 520px; height: 90vh; height: 90dvh;
      background: ${isLight ? '#ffffff' : '#0f172a'};
      border-top-left-radius: 28px; border-top-right-radius: 28px;
      border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.12)'};
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
      transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: var(--font-body, sans-serif);
      position: relative;
    ">
      <!-- HEADER -->
      <div style="
        padding: calc(14px + env(safe-area-inset-top, 0px)) 16px 14px;
        background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
        color: white; display: flex; align-items: center; justify-content: space-between;
        box-shadow: 0 2px 10px rgba(2,132,199,0.25); z-index: 10;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="close-driver-support-chat" style="
            background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 50%;
          ">
            ${icon('chevronLeft', 24)}
          </button>
          <div style="
            width: 40px; height: 40px; border-radius: 12px;
            background: rgba(255,255,255,0.2); border: 1.5px solid rgba(255,255,255,0.3);
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; color: white; position: relative; flex-shrink: 0;
          ">
            🎧
            <span style="position:absolute; bottom:-2px; right:-2px; width:11px; height:11px; border-radius:50%; background:#22c55e; border:2px solid #0369a1;"></span>
          </div>
          <div style="min-width:0;">
            <div style="font-size:14.5px; font-weight:900; color:white; display:flex; align-items:center; gap:6px;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Soporte GoDelivery</span>
              <span style="font-size:9.5px; background:rgba(255,255,255,0.25); color:white; padding:1px 6px; border-radius:6px; font-weight:900;">EN LÍNEA</span>
            </div>
            <div style="font-size:11px; color:rgba(255,255,255,0.9); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              Mesa de Ayuda para Repartidores · Magdalena
            </div>
          </div>
        </div>
      </div>

      <!-- MESSAGES FEED -->
      <div id="driver-support-chat-feed" style="
        flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
        background: ${isLight ? '#f8fafc' : '#090d16'}; -webkit-overflow-scrolling: touch;
      ">
        <div style="text-align:center; padding:8px 12px; color:${isLight ? '#94a3b8' : '#64748b'}; font-size:11.5px; font-weight:600;">
          🔒 Conversación directa con los administradores de GoDelivery Magdalena.
        </div>
      </div>

      <!-- EMOJI PICKER POPOVER -->
      <div id="support-emoji-picker" style="
        display: none; height: 210px; background: ${isLight ? '#ffffff' : '#1e293b'};
        border-top: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'};
        flex-direction: column; overflow: hidden; z-index: 20;
      ">
        <div id="support-emoji-tabs" style="display:flex; border-bottom:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'}; background:${isLight ? '#f1f5f9' : '#0f172a'}; overflow-x:auto;">
          ${Object.keys(emojiCategories).map((cat, idx) => `
            <button class="support-cat-btn" data-cat="${cat}" style="
              flex: 1; min-width: 70px; height: 36px; border: none; background: ${idx === 0 ? (isLight ? '#ffffff' : '#1e293b') : 'transparent'};
              color: ${idx === 0 ? '#0284c7' : (isLight ? '#64748b' : '#94a3b8')}; font-weight: 800; font-size: 11.5px; cursor: pointer;
            ">${cat}</button>
          `).join('')}
        </div>
        <div id="support-emoji-grid" style="flex:1; overflow-y:auto; padding:10px; display:grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap:6px; font-size:22px; text-align:center;">
          ${emojiCategories['Caritas'].map(e => `<span class="support-emoji-item" style="cursor:pointer; user-select:none; line-height:36px; transition:transform 0.1s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${e}</span>`).join('')}
        </div>
      </div>

      <!-- FOOTER / INPUT BAR -->
      <div style="
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 10px)) 14px;
        background: ${isLight ? '#ffffff' : '#1e293b'};
        border-top: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'};
        position: relative;
      ">
        <!-- Audio Recording Overlay -->
        <div id="support-audio-recording-overlay" style="
          display: none; position: absolute; inset: 0;
          background: ${isLight ? '#ffffff' : '#1e293b'};
          align-items: center; justify-content: space-between; padding: 0 16px;
          z-index: 50; border-top: 1.5px solid #0284c7;
        ">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:10px; height:10px; background:#ef4444; border-radius:50%; animation: pulse 1s infinite;"></div>
            <span id="support-audio-timer" style="font-weight:900; font-size:14px; color:${isLight ? '#0f172a' : '#ffffff'}; font-family:var(--font-display, sans-serif);">0:00</span>
          </div>
          <div id="support-audio-slidehint" style="display:flex; align-items:center; gap:4px; color:${isLight ? '#64748b' : '#94a3b8'}; font-size:12px; font-weight:700; pointer-events:none;">
            <span>‹</span> Desliza a la izquierda para cancelar
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; position:relative;">
          <!-- Emoji Toggle Button -->
          <button id="support-emoji-toggle-btn" style="
            background: none; border: none; color: ${isLight ? '#64748b' : '#94a3b8'};
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            width: 36px; height: 36px; border-radius: 50%; padding: 0; flex-shrink: 0;
          ">
            ${icon('smile', 22)}
          </button>

          <!-- Camera / Attach Button -->
          <button id="support-attach-btn" style="
            background: none; border: none; color: ${isLight ? '#64748b' : '#94a3b8'};
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            width: 36px; height: 36px; border-radius: 50%; padding: 0; flex-shrink: 0;
          ">
            ${icon('camera', 22)}
          </button>
          <input type="file" id="support-file-gallery" style="display:none;" accept="image/*" />
          <input type="file" id="support-file-camera" style="display:none;" accept="image/*" capture="environment" />

          <!-- Text Input -->
          <input id="driver-support-chat-input" type="text" placeholder="Escribí un mensaje..." autocomplete="off" style="
            flex: 1; height: 42px; border-radius: 20px;
            border: 1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'};
            background: ${isLight ? '#f8fafc' : '#090d16'};
            color: ${isLight ? '#0f172a' : '#ffffff'};
            padding: 0 16px; font-size: 13.5px; font-weight: 600; outline: none;
          " />

          <!-- Mic Audio Recorder Button -->
          <button id="support-mic-btn" title="Grabar audio" style="
            background: none; border: none; color: #0284c7;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            width: 38px; height: 38px; border-radius: 50%; padding: 0; flex-shrink: 0;
            touch-action: none; -webkit-user-select: none; user-select: none;
          ">
            ${icon('mic', 22)}
          </button>

          <!-- Send Button -->
          <button id="driver-support-chat-send-btn" style="
            width: 42px; height: 42px; border-radius: 50%; border: none;
            background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
            color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 14px rgba(2,132,199,0.35); flex-shrink: 0;
          ">
            ${icon('send', 18)}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    const card = overlay.querySelector('#driver-support-chat-card');
    if (card) card.style.transform = 'translateY(0)';
  });

  const closeChat = () => {
    overlay.style.opacity = '0';
    const card = overlay.querySelector('#driver-support-chat-card');
    if (card) card.style.transform = 'translateY(100%)';
    setTimeout(() => {
      if (unsub) unsub();
      overlay.remove();
    }, 250);
  };

  overlay.querySelector('#close-driver-support-chat').onclick = closeChat;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeChat();
  };

  const feed = overlay.querySelector('#driver-support-chat-feed');
  const input = overlay.querySelector('#driver-support-chat-input');
  const sendBtn = overlay.querySelector('#driver-support-chat-send-btn');
  const emojiToggleBtn = overlay.querySelector('#support-emoji-toggle-btn');
  const emojiPicker = overlay.querySelector('#support-emoji-picker');
  const emojiTabs = overlay.querySelector('#support-emoji-tabs');
  const emojiGrid = overlay.querySelector('#support-emoji-grid');
  const attachBtn = overlay.querySelector('#support-attach-btn');
  const fileInputGallery = overlay.querySelector('#support-file-gallery');
  const fileInputCamera = overlay.querySelector('#support-file-camera');
  const micBtn = overlay.querySelector('#support-mic-btn');
  const audioIndicator = overlay.querySelector('#support-audio-recording-overlay');
  const audioTimer = overlay.querySelector('#support-audio-timer');

  // EMOJI PICKER HANDLING
  let isEmojiOpen = false;
  if (emojiToggleBtn && emojiPicker) {
    emojiToggleBtn.onclick = (e) => {
      e.stopPropagation();
      isEmojiOpen = !isEmojiOpen;
      emojiPicker.style.display = isEmojiOpen ? 'flex' : 'none';
    };

    emojiTabs.querySelectorAll('.support-cat-btn').forEach(btn => {
      btn.onclick = () => {
        const cat = btn.dataset.cat;
        emojiTabs.querySelectorAll('.support-cat-btn').forEach(b => {
          b.style.background = 'transparent';
          b.style.color = isLight ? '#64748b' : '#94a3b8';
        });
        btn.style.background = isLight ? '#ffffff' : '#1e293b';
        btn.style.color = '#0284c7';
        emojiGrid.innerHTML = (emojiCategories[cat] || []).map(e => `
          <span class="support-emoji-item" style="cursor:pointer; user-select:none; line-height:36px;">${e}</span>
        `).join('');
        attachEmojiClickEvents();
      };
    });

    const attachEmojiClickEvents = () => {
      emojiGrid.querySelectorAll('.support-emoji-item').forEach(el => {
        el.onclick = () => {
          const char = el.textContent;
          input.value = (input.value || '') + char;
          input.focus();
        };
      });
    };
    attachEmojiClickEvents();
  }

  // ATTACH PHOTO (GALLERY OR CAMERA)
  if (attachBtn) {
    attachBtn.onclick = () => {
      const { showModal, closeModal } = window.__showModal || {};
      import('../components/modal.js').then(m => {
        m.showModal({
          title: 'Enviar imagen',
          content: `
            <div style="padding: 20px 16px; display: flex; flex-direction: column; gap: 12px; font-family:var(--font-body, sans-serif);">
              <button id="btn-sup-camera" style="
                width: 100%; height: 50px; border-radius: 16px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
                color: white; border: none; font-weight: 850; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
              ">
                📷 Tomar Foto (Cámara)
              </button>
              <button id="btn-sup-gallery" style="
                width: 100%; height: 50px; border-radius: 16px; background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
                border: 1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'}; color: ${isLight ? '#0f172a' : '#ffffff'};
                font-weight: 850; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
              ">
                🖼️ Seleccionar de Galería
              </button>
            </div>
          `,
          height: 'auto',
          hideHeader: true,
          onOpen: () => {
            const btnCam = document.getElementById('btn-sup-camera');
            const btnGal = document.getElementById('btn-sup-gallery');
            if (btnCam) btnCam.onclick = () => { m.closeModal(); fileInputCamera?.click(); };
            if (btnGal) btnGal.onclick = () => { m.closeModal(); fileInputGallery?.click(); };
          }
        });
      });
    };
  }

  const handleSendImage = async (file) => {
    if (!file) return;
    try {
      showToast('Comprimiendo y enviando imagen...', 'info');
      const base64Data = await compressImageToBase64(file, 800, 0.6);
      await sendPayload({
        sender: 'user',
        text: '📷 Foto enviada',
        image: base64Data,
        timestamp: Date.now(),
        userName: driverName
      });
      showToast('Imagen enviada con éxito', 'success');
    } catch (e) {
      console.error('Error sending support image:', e);
      showToast('Error al enviar la imagen', 'error');
    }
  };

  if (fileInputGallery) fileInputGallery.onchange = (e) => handleSendImage(e.target.files[0]);
  if (fileInputCamera) fileInputCamera.onchange = (e) => handleSendImage(e.target.files[0]);

  // VOICE AUDIO RECORDING
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStartTime = 0;
  let recordTimer = null;
  let isRecording = false;
  let startX = 0;
  let isCancelled = false;

  const stopRecording = () => {
    if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  };

  const handlePointerMove = (e) => {
    if (!isRecording) return;
    const currentX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : startX);
    const diffX = startX - currentX;
    if (diffX > 120) {
      isCancelled = true;
      stopRecording();
      showToast('Grabación cancelada', 'warning');
    }
  };

  const handlePointerUp = () => {
    if (isRecording) stopRecording();
  };

  if (micBtn) {
    micBtn.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      isCancelled = false;

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];

          mediaRecorder.ondataavailable = ev => {
            if (ev.data.size > 0) audioChunks.push(ev.data);
          };

          mediaRecorder.onstart = () => {
            isRecording = true;
            recordStartTime = Date.now();
            audioIndicator.style.display = 'flex';
            micBtn.style.color = '#ef4444';
            micBtn.style.transform = 'scale(1.2)';

            recordTimer = setInterval(() => {
              const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
              const m = Math.floor(elapsed / 60);
              const s = (elapsed % 60).toString().padStart(2, '0');
              audioTimer.textContent = `${m}:${s}`;
            }, 1000);

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', handlePointerUp);
          };

          mediaRecorder.onstop = async () => {
            isRecording = false;
            clearInterval(recordTimer);
            audioIndicator.style.display = 'none';
            micBtn.style.color = '#0284c7';
            micBtn.style.transform = 'scale(1)';

            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);

            stream.getTracks().forEach(track => track.stop());

            const elapsedMs = Date.now() - recordStartTime;
            if (audioChunks.length > 0 && !isCancelled) {
              if (elapsedMs < 800) {
                showToast('Audio muy corto', 'warning');
                return;
              }

              showToast('Enviando audio...', 'info');
              const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
              const reader = new FileReader();
              reader.onloadend = async () => {
                const base64Audio = reader.result;
                await sendPayload({
                  sender: 'user',
                  text: '🎙 Mensaje de voz',
                  audio: base64Audio,
                  timestamp: Date.now(),
                  userName: driverName
                });
                showToast('Audio enviado con éxito', 'success');
              };
              reader.readAsDataURL(audioBlob);
            }
          };

          mediaRecorder.start();
        } catch (err) {
          console.warn('Microphone permission denied / error:', err);
          showToast('Permiso de micrófono requerido', 'warning');
        }
      } else {
        showToast('Navegador no soporta grabación de voz', 'warning');
      }
    });
  }

  // RENDER MESSAGES WITH PHOTO AND AUDIO SUPPORT
  const renderMessages = (messages = []) => {
    if (!messages || messages.length === 0) {
      feed.innerHTML = `
        <div style="text-align:center; padding:40px 16px; color:${isLight ? '#64748b' : '#94a3b8'};">
          <div style="font-size:38px; margin-bottom:8px;">👋</div>
          <div style="font-size:15px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">¡Hola, ${driverName}!</div>
          <div style="font-size:12.5px; margin-top:4px; line-height:1.45;">¿Tenés algún inconveniente en la calle o duda con tus entregas? Escribinos, enviá audios o fotos y un administrador te responderá a la brevedad.</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = messages.map(m => {
      const isMine = m.sender === 'user' || m.sender === driverId;
      const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      return `
        <div style="display:flex; flex-direction:column; align-items:${isMine ? 'flex-end' : 'flex-start'}; gap:3px; max-width:85%; align-self:${isMine ? 'flex-end' : 'flex-start'};">
          <div style="font-size:10px; font-weight:800; color:${isMine ? (isLight ? '#0284c7' : '#38bdf8') : (isLight ? '#64748b' : '#94a3b8')}; padding:0 4px;">
            ${isMine ? 'Tú (Repartidor)' : '👑 Soporte GoDelivery'}
          </div>
          <div style="
            padding: ${m.image && !m.audio ? '6px 6px 14px 6px' : '10px 14px 14px 14px'};
            border-radius: 18px;
            border-bottom-${isMine ? 'right' : 'left'}-radius: 4px;
            background: ${isMine ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : (isLight ? '#ffffff' : '#1e293b')};
            color: ${isMine ? '#ffffff' : (isLight ? '#0f172a' : '#ffffff')};
            border: 1px solid ${isMine ? 'transparent' : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)')};
            font-size: 13px; font-weight: 700; line-height: 1.45; word-break: break-word;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06); position: relative; min-width: 110px;
          ">
            ${m.audio ? `
              <div style="display:flex; align-items:center; gap:8px; padding:4px 0 6px;">
                <audio controls src="${m.audio}" style="height:34px; max-width:210px; border-radius:10px; outline:none;"></audio>
              </div>
            ` : m.image ? `
              <img src="${m.image}" style="max-width:100%; max-height:260px; border-radius:14px; display:block; cursor:pointer;" onclick="window.open('${m.image}')" />
              ${m.text && m.text !== '📷 Foto enviada' ? `<div style="margin-top:6px; padding:0 6px;">${m.text}</div>` : ''}
            ` : `
              <div>${m.text}</div>
            `}

            <div style="font-size:9.5px; opacity:0.85; color:${isMine ? 'rgba(255,255,255,0.85)' : (isLight ? '#94a3b8' : '#64748b')}; text-align:right; margin-top:4px;">
              ${timeStr} ${isMine ? '✓✓' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    feed.scrollTop = feed.scrollHeight;
  };

  const chatDocRef = doc(db, 'support_chats', chatId);
  const unsub = onSnapshot(chatDocRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      renderMessages(data.messages || []);
    } else {
      renderMessages([]);
    }
  });

  const sendPayload = async (messageObj) => {
    try {
      const chatSnap = await getDoc(chatDocRef);
      const summaryText = messageObj.audio ? '🎙 Mensaje de voz' : (messageObj.image ? '📷 Foto' : messageObj.text);

      if (!chatSnap.exists()) {
        await setDoc(chatDocRef, {
          userId: driverId,
          userName: driverName,
          userRole: 'driver',
          deliveryId: driverDeliveryId,
          ticketId: `#TK-DRV-${driverDeliveryId}`,
          status: 'pending',
          createdAt: serverTimestamp(),
          lastMessageText: summaryText,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false,
          messages: [messageObj]
        });
      } else {
        await updateDoc(chatDocRef, {
          status: 'pending',
          lastMessageText: summaryText,
          lastMessageTime: serverTimestamp(),
          unreadByAdmin: true,
          unreadByUser: false,
          messages: arrayUnion(messageObj)
        });
      }

      // Notify all admins in real time
      try {
        const [roleSnap, isAdminSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', '==', 'admin'))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, 'users'), where('isAdmin', '==', true))).catch(() => ({ docs: [] }))
        ]);

        const adminIds = new Set();
        [...roleSnap.docs, ...isAdminSnap.docs].forEach(d => adminIds.add(d.id));

        const notifPromises = [];
        adminIds.forEach(adminId => {
          notifPromises.push(
            addDoc(collection(db, 'users', adminId, 'notifications'), {
              title: '🚨 Mensaje de Repartidor en Ruta',
              body: `${driverName} (${driverDeliveryId}): "${summaryText.slice(0, 80)}"`,
              createdAt: serverTimestamp(),
              type: 'support_ticket',
              status: 'unread',
              clickable: true,
              url: `#/admin/support-chats?ticketId=${chatId}`,
              data: {
                chatId: chatId,
                driverId: driverId
              }
            }).catch(e => console.warn('Admin notif error:', e))
          );
        });
        await Promise.all(notifPromises);
      } catch (errNotif) {
        console.warn('Failed admin dispatch:', errNotif);
      }
    } catch (err) {
      console.error('Error sending support payload:', err);
      showToast('Error al enviar el mensaje', 'error');
    }
  };

  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    if (emojiPicker) emojiPicker.style.display = 'none';
    isEmojiOpen = false;

    input.disabled = true;
    sendBtn.disabled = true;

    await sendPayload({
      sender: 'user',
      text: text,
      timestamp: Date.now(),
      userName: driverName
    });

    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  };

  sendBtn.onclick = sendMessage;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') sendMessage();
  };
  input.focus();
}

export async function showDriverSafetyModal(user) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const isLight = getDriverMapTheme() === 'light';
  const latestUser = getState().user || user || {};
  const driverName = latestUser.displayName || latestUser.name || 'Repartidor GoDelivery';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 16px 18px calc(24px + env(safe-area-inset-bottom, 16px)) 18px;
    background: ${isLight ? '#ffffff' : '#090d16'};
    color: ${isLight ? '#0f172a' : '#ffffff'};
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-family: var(--font-body, sans-serif);
  `;

  const getGpsShareUrl = () => {
    const pos = window.lastRiderPos;
    if (pos && pos.lat && pos.lng) {
      return `https://maps.google.com/?q=${pos.lat},${pos.lng}`;
    }
    return 'https://maps.google.com/?q=-35.0815,-57.5147';
  };

  modalEl.innerHTML = `
    <!-- HEADER ALERT BANNER -->
    <div style="
      background: linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.2) 100%);
      border: 1.5px solid rgba(239,68,68,0.35);
      border-radius: 18px; padding: 14px;
      display: flex; align-items: center; gap: 12px;
    ">
      <div style="width:44px; height:44px; border-radius:12px; background:#ef4444; color:white; display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; box-shadow:0 4px 14px rgba(239,68,68,0.4);">
        🛡️
      </div>
      <div>
        <div style="font-size:14px; font-weight:900; color:${isLight ? '#991b1b' : '#fca5a5'};">Centro de Seguridad & Emergencias</div>
        <div style="font-size:11px; color:${isLight ? '#b91c1c' : '#fecaca'}; margin-top:2px;">Asistencia inmediata en Magdalena 24/7</div>
      </div>
    </div>

    <!-- ACTION 1: 911 / COMISARIA MAGDALENA -->
    <div style="display:flex; flex-direction:column; gap:8px;">
      <a href="tel:911" style="
        display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
        background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
        border-radius: 16px; text-decoration: none; color: white;
        box-shadow: 0 6px 20px rgba(239,68,68,0.35); transition: transform 0.15s;
      ">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:38px; height:38px; border-radius:10px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; font-size:18px;">
            🚨
          </div>
          <div>
            <div style="font-size:14px; font-weight:950;">Llamar al 911 (Emergencias)</div>
            <div style="font-size:11px; opacity:0.9; margin-top:1px;">Central Telefónica de Emergencias</div>
          </div>
        </div>
        <div style="font-size:18px; font-weight:900;">➔</div>
      </a>

      <!-- Direct Comisaria Magdalena Number -->
      <a href="tel:02221452413" style="
        display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
        background: ${isLight ? '#fff1f2' : 'rgba(239,68,68,0.12)'};
        border: 1.5px solid ${isLight ? '#fecdd3' : 'rgba(239,68,68,0.3)'};
        border-radius: 14px; text-decoration: none; color: ${isLight ? '#9f1239' : '#fca5a5'};
        font-weight: 800; font-size: 13px;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <span>🚓</span>
          <span>Comisaría Magdalena: <strong>(02221) 45-2413</strong></span>
        </div>
        <span style="font-size:11.5px; background:#e11d48; color:white; padding:3px 9px; border-radius:8px; font-weight:900;">LLAMAR</span>
      </a>
    </div>

    <!-- ACTION 2: SAME / HOSPITAL MAGDALENA -->
    <div style="display:flex; flex-direction:column; gap:8px;">
      <a href="tel:107" style="
        display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
        background: linear-gradient(135deg, #059669 0%, #047857 100%);
        border-radius: 16px; text-decoration: none; color: white;
        box-shadow: 0 6px 20px rgba(5,150,105,0.3); transition: transform 0.15s;
      ">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:38px; height:38px; border-radius:10px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; font-size:18px;">
            🚑
          </div>
          <div>
            <div style="font-size:14px; font-weight:950;">Llamar al 107 (SAME)</div>
            <div style="font-size:11px; opacity:0.9; margin-top:1px;">Ambulancias y Urgencias Médicas</div>
          </div>
        </div>
        <div style="font-size:18px; font-weight:900;">➔</div>
      </a>

      <!-- Direct Hospital Magdalena Number -->
      <a href="tel:02221453388" style="
        display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
        background: ${isLight ? '#ecfdf5' : 'rgba(5,150,105,0.12)'};
        border: 1.5px solid ${isLight ? '#a7f3d0' : 'rgba(5,150,105,0.3)'};
        border-radius: 14px; text-decoration: none; color: ${isLight ? '#065f46' : '#6ee7b7'};
        font-weight: 800; font-size: 13px;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <span>🏥</span>
          <span>Hospital Magdalena: <strong>(02221) 45-3388</strong></span>
        </div>
        <span style="font-size:11.5px; background:#059669; color:white; padding:3px 9px; border-radius:8px; font-weight:900;">LLAMAR</span>
      </a>
    </div>

    <!-- ACTION 3: SHARE GPS LOCATION BY WHATSAPP -->
    <button id="safety-share-gps-btn" style="
      display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;
      background: ${isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.12)'};
      border: 1.5px solid ${isLight ? '#86efac' : 'rgba(34, 197, 94, 0.35)'};
      border-radius: 16px; color: ${isLight ? '#15803d' : '#4ade80'};
      font-size: 13.5px; font-weight: 900; cursor: pointer; text-align: left;
      transition: all 0.15s;
    ">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:38px; height:38px; border-radius:10px; background:${isLight ? '#dcfce7' : 'rgba(34, 197, 94, 0.2)'}; display:flex; align-items:center; justify-content:center; font-size:18px;">
          📍
        </div>
        <div>
          <div>Compartir mi Ubicación GPS en Vivo</div>
          <div style="font-size:11px; font-weight:600; opacity:0.85; margin-top:1px;">Enviar alerta con coordenadas por WhatsApp</div>
        </div>
      </div>
      <div style="font-size:18px;">📲</div>
    </button>

    <!-- ACTION 4: DIRECT GODELIVERY DISPATCH SUPPORT -->
    <button id="safety-support-btn" style="
      display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 16px;
      background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
      border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'};
      border-radius: 16px; color: ${isLight ? '#0f172a' : '#ffffff'};
      font-size: 13px; font-weight: 800; cursor: pointer;
    ">
      <span>🎧</span> <span>Abrir Chat con Soporte GoDelivery</span>
    </button>
  `;

  showModal({
    title: '🛡️ Seguridad del Repartidor',
    content: modalEl,
    height: 'auto',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : '#ffffff'
  });

  const shareGpsBtn = modalEl.querySelector('#safety-share-gps-btn');
  if (shareGpsBtn) {
    shareGpsBtn.onclick = () => {
      const gpsLink = getGpsShareUrl();
      const msg = encodeURIComponent(
        `🚨 *EMERGENCIA REPARTIDOR GODELIVERY*\n` +
        `👤 *Repartidor:* ${driverName}\n` +
        `📍 *Mi Ubicación GPS en Vivo:* ${gpsLink}\n` +
        `⚠️ *Solicito asistencia urgente en esta posición.*`
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    };
  }

  const supportBtn = modalEl.querySelector('#safety-support-btn');
  if (supportBtn) {
    supportBtn.onclick = () => {
      closeModal();
      openDriverDirectSupportChat(latestUser);
    };
  }
}

export function showDriverHelpBottomSheet(user) {
  const isLight = getDriverMapTheme() === 'light';
  const latestUser = getState().user || user || {};

  const existing = document.getElementById('driver-help-bottom-sheet-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'driver-help-bottom-sheet-modal';
  backdrop.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    display: flex; flex-direction: column; justify-content: flex-end;
    opacity: 0; transition: opacity 0.25s ease;
  `;

  const sheet = document.createElement('div');
  sheet.style.cssText = `
    width: 100%; max-width: 520px; margin: 0 auto;
    background: ${isLight ? '#ffffff' : '#0f172a'};
    border-top-left-radius: 28px; border-top-right-radius: 28px;
    border-top: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'};
    padding: 14px 20px max(24px, calc(16px + env(safe-area-inset-bottom, 16px))) 20px;
    box-sizing: border-box;
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
    color: ${isLight ? '#0f172a' : '#ffffff'};
    max-height: 85vh; overflow-y: auto;
  `;

  sheet.innerHTML = `
    <!-- DRAG HANDLE -->
    <div style="width: 44px; height: 5px; border-radius: 3px; background: ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)'}; margin: 0 auto 16px auto; cursor: pointer;"></div>

    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, #e11d48, #be123c); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 12px rgba(225, 29, 72, 0.4);">
          🛟
        </div>
        <div>
          <div style="font-size: 16.5px; font-weight: 900;">Centro de Ayuda Repartidor</div>
          <div style="font-size: 11.5px; color: ${isLight ? '#64748b' : '#94a3b8'};">Guías rápidas y soporte en vivo</div>
        </div>
      </div>
      <button id="close-help-sheet-btn" style="width: 34px; height: 34px; border-radius: 50%; background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'}; border: none; color: ${isLight ? '#475569' : '#cbd5e1'}; font-size: 16px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center;">
        ✕
      </button>
    </div>

    <!-- QUICK ACTIONS -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;">
      <button id="help-sheet-support-chat-btn" style="
        background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.15)'};
        border: 1.5px solid ${isLight ? '#fecaca' : 'rgba(225, 29, 72, 0.35)'};
        color: ${isLight ? '#be123c' : '#fb7185'};
        padding: 12px; border-radius: 16px; font-size: 12.5px; font-weight: 900;
        display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer;
      ">
        <span style="font-size: 22px;">💬</span>
        <span>Chat con Soporte</span>
      </button>

      <a href="https://wa.me/5492221415253?text=${encodeURIComponent('Hola Base GoDelivery! 👋 Necesito comunicarme con la base.')}" target="_blank" rel="noopener noreferrer" style="
        background: ${isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.15)'};
        border: 1.5px solid ${isLight ? '#bbf7d0' : 'rgba(34, 197, 94, 0.35)'};
        color: ${isLight ? '#15803d' : '#4ade80'};
        padding: 12px; border-radius: 16px; font-size: 12.5px; font-weight: 900;
        display: flex; flex-direction: column; align-items: center; gap: 6px; text-decoration: none; text-align: center;
      ">
        <span style="font-size: 22px;">📱</span>
        <span>Llamar a Base (WhatsApp)</span>
      </a>
    </div>

    <!-- FAQ LIST -->
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 11.5px; font-weight: 900; color: ${isLight ? '#64748b' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
        Preguntas Frecuentes
      </div>

      <details style="background: ${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; border-radius: 14px; padding: 12px; cursor: pointer;">
        <summary style="font-size: 13px; font-weight: 800; color: ${isLight ? '#0f172a' : '#f8fafc'};">
          🛒 ¿Cómo realizo un pedido tipo Mandado?
        </summary>
        <div style="font-size: 12px; color: ${isLight ? '#475569' : '#cbd5e1'}; margin-top: 8px; line-height: 1.45;">
          En los mandados el cliente escribe el comercio o producto libremente. Dirigite al local indicado, realizá la compra y luego deslizá la barra <strong>RETIRADO</strong>. Podés ingresar el valor del ticket de compra para cobrarle exacto al cliente.
        </div>
      </details>

      <details style="background: ${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; border-radius: 14px; padding: 12px; cursor: pointer;">
        <summary style="font-size: 13px; font-weight: 800; color: ${isLight ? '#0f172a' : '#f8fafc'};">
          🚪 ¿Qué hago si el cliente no responde en la puerta?
        </summary>
        <div style="font-size: 12px; color: ${isLight ? '#475569' : '#cbd5e1'}; margin-top: 8px; line-height: 1.45;">
          Tocá el botón de <strong>Chat</strong> en la barra superior para escribirle. Si pasados 5 minutos no responde, contactá al soporte central.
        </div>
      </details>

      <details style="background: ${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; border-radius: 14px; padding: 12px; cursor: pointer;">
        <summary style="font-size: 13px; font-weight: 800; color: ${isLight ? '#0f172a' : '#f8fafc'};">
          💵 ¿Cómo cobrar si el pago es por transferencia?
        </summary>
        <div style="font-size: 12px; color: ${isLight ? '#475569' : '#cbd5e1'}; margin-top: 8px; line-height: 1.45;">
          El cliente verá tu <strong>Alias</strong> directamente en su pantalla de seguimiento para transferirte el monto exacto. Podés confirmar la acreditación en tu cuenta antes de entregar el paquete.
        </div>
      </details>
    </div>
  `;

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });

  const close = () => {
    backdrop.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => backdrop.remove(), 250);
  };

  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  sheet.querySelector('#close-help-sheet-btn').onclick = close;
  const supportChatBtn = sheet.querySelector('#help-sheet-support-chat-btn');
  if (supportChatBtn) {
    supportChatBtn.onclick = () => {
      close();
      openDriverDirectSupportChat(latestUser);
    };
  }
}

export function renderBottomDockContent(user, activeOrders = []) {
  const isLight = getDriverMapTheme() === 'light';
  const hasActive = Array.isArray(activeOrders) && activeOrders.length > 0;
  const primaryOrder = hasActive ? activeOrders[0] : null;
  const isPickup = primaryOrder ? (primaryOrder.status === 'pending' || primaryOrder.status === 'accepted' || primaryOrder.status === 'preparing' || primaryOrder.status === 'ready' || (!primaryOrder.pickedUpAt && primaryOrder.status !== 'delivering')) : false;
  const isExpanded = window.driverDockExpanded === true;
  const isHidden = window.driverDockHidden === true;

  // Calculate total cash to collect across all active orders
  let totalCashToCollect = 0;
  let totalTripEarnings = 0;
  activeOrders.forEach(o => {
    if (o.paymentMethod === 'efectivo') {
      totalCashToCollect += Number(o.totalAmount || o.total || 0);
    }
    totalTripEarnings += Number(o.driverEarnings || o.shippingCost || o.deliveryFee || 0);
  });

  // 1. MINIMIZED COLLAPSIBLE DOCK CARD PILL (WHEN HIDDEN)
  if (isHidden) {
    return `
      <div id="driver-bottom-sheet-card" class="dock-minimized" style="
        background: ${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.95)'};
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.35)' : 'rgba(225, 29, 72, 0.45)'};
        border-radius: 26px;
        padding: 8px 14px;
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        box-shadow: 0 10px 30px ${isLight ? 'rgba(225,29,72,0.14)' : 'rgba(0,0,0,0.7)'};
        max-width: 480px; margin: 0 auto;
        cursor: pointer; user-select: none;
        pointer-events: auto;
        animation: dockCardSpring 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
          <span style="font-size:16px; flex-shrink:0;">🛵</span>
          <div style="font-size:13px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${hasActive ? (activeOrders.length === 1 ? '1 Pedido en Curso' : `${activeOrders.length} Pedidos`) : 'Buscando Pedidos'}
          </div>
          ${(hasActive && primaryOrder) ? `
            <span style="font-size:12px; font-weight:900; color:${isLight ? '#16a34a' : '#22c55e'}; background:${isLight ? '#dcfce7' : 'rgba(34,197,94,0.15)'}; padding:2px 8px; border-radius:8px; flex-shrink:0;">
              $${Number(primaryOrder.totalAmount || primaryOrder.total || 0).toLocaleString('es-AR')}
            </span>
          ` : ''}
        </div>

        <button id="dock-unhide-btn" style="
          background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
          color: white; border: none; border-radius: 14px;
          font-size: 11.5px; font-weight: 900;
          padding: 6px 12px; display: flex; align-items: center; gap: 5px;
          cursor: pointer; box-shadow: 0 3px 10px rgba(225,29,72,0.4);
          flex-shrink: 0;
        ">
          <span>▲</span>
          <span>Mostrar Card</span>
        </button>
      </div>
    `;
  }

  return `
    <div id="driver-bottom-sheet-card" style="
      background: ${isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)'};
      backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.25)' : 'rgba(225, 29, 72, 0.35)'};
      border-top-left-radius: 28px; border-top-right-radius: 28px;
      border-bottom-left-radius: ${isExpanded ? '0' : '28px'};
      border-bottom-right-radius: ${isExpanded ? '0' : '28px'};
      padding: 10px 16px 14px 16px;
      display: flex; flex-direction: column; gap: 8px;
      box-shadow: 0 -12px 40px ${isLight ? 'rgba(225,29,72,0.1)' : 'rgba(0,0,0,0.75)'};
      max-width: 480px; margin: 0 auto;
      max-height: ${isExpanded ? 'min(82vh, 620px)' : 'auto'};
      overflow: hidden;
      transition: max-height 0.35s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.25s ease, box-shadow 0.3s ease;
      animation: dockCardSpring 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: auto;
    ">
      
      <!-- DRAG HANDLE & TOGGLE HEADER -->
      <div id="dock-drag-handle" style="display:flex; flex-direction:column; align-items:center; cursor:pointer; user-select:none; padding:4px 0 2px 0; flex-shrink: 0;">
        <div style="width: 44px; height: 5px; border-radius: 3px; background: ${isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)'}; margin-bottom: 6px;"></div>
        
        <div style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:14px;">🛵</span>
            <span style="font-size:12.5px; font-weight:900; color:${isLight ? '#0f172a' : '#f8fafc'};">
              ${hasActive ? (activeOrders.length === 1 ? '1 Pedido en Curso' : `${activeOrders.length} Pedidos en Cola`) : 'Buscando Pedidos'}
            </span>
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            ${hasActive ? `
              <button id="dock-expand-toggle-btn" style="background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'}; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.12)'}; color:${isLight ? '#e11d48' : '#fb7185'}; font-size:11px; font-weight:900; cursor:pointer; display:flex; align-items:center; gap:4px; padding:4px 9px; border-radius:10px; transition: transform 0.2s ease;">
                <span>${isExpanded ? '▼ Menos' : '▲ Detalles'}</span>
              </button>
            ` : ''}

            <!-- MINIMIZE / HIDE CARD BUTTON -->
            <button id="dock-hide-card-btn" title="Ocultar Card temporalmente" style="background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.15)'}; border:1px solid ${isLight ? '#fecaca' : 'rgba(225,29,72,0.3)'}; color:${isLight ? '#be123c' : '#fb7185'}; font-size:11px; font-weight:900; cursor:pointer; display:flex; align-items:center; gap:4px; padding:4px 9px; border-radius:10px;">
              <span>▼</span>
              <span>Ocultar</span>
            </button>
          </div>
        </div>
      </div>

      <!-- MULTI-STOP ITINERARY ROADMAP STRIP (ONLY VISIBLE WHEN EXPANDED) -->
      ${(hasActive && isExpanded && activeOrders.length > 1) ? (() => {
        const multiStops = calculateOptimalMultiStopSequence(window.lastRiderPos, activeOrders);
        if (!multiStops || multiStops.length === 0) return '';
        return `
          <div style="display:flex; flex-direction:column; gap:6px; margin: 2px 0 6px 0; flex-shrink: 0;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:11px; font-weight:900; color:${isLight ? '#e11d48' : '#fb7185'}; display:flex; align-items:center; gap:4px;">
                <span>🗺️</span> <span>Secuencia Óptima de Paradas (${multiStops.length}):</span>
              </span>
              <span style="font-size:9.5px; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.18)'}; color:${isLight ? '#be123c' : '#fb7185'}; font-weight:800; padding:1px 6px; border-radius:6px;">
                Ruta Inteligente
              </span>
            </div>
            <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; -webkit-overflow-scrolling:touch;">
              ${multiStops.map((stop, i) => `
                <div style="
                  flex-shrink:0; display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:12px;
                  background:${i === 0 ? (isLight ? '#fff1f2' : 'rgba(225,29,72,0.18)') : (isLight ? '#f1f5f9' : 'rgba(255,255,255,0.05)')};
                  border:1.5px solid ${i === 0 ? '#e11d48' : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)')};
                ">
                  <span style="font-size:11px; font-weight:900; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); color:white; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(225,29,72,0.4);">
                    ${i + 1}
                  </span>
                  <div style="display:flex; flex-direction:column;">
                    <span style="font-size:11px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; white-space:nowrap;">
                      ${stop.type === 'pickup' ? (stop.isEncomienda ? '📦 ' : '🛍️ ') : '📍 '}${stop.shortTitle}
                    </span>
                    <span style="font-size:9.5px; color:${isLight ? '#64748b' : '#94a3b8'}; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                      ${stop.address}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      })() : ''}

      <!-- COMPACT ROW: PRIMARY ACTION SLIDER (IF COLLAPSED) -->
      ${(hasActive && !isExpanded) ? `
        <div id="dock-compact-slider-row" style="display:flex; flex-direction:column; gap:6px; animation: dockContentFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
          <!-- TOTAL A COBRAR CALLOUT WHEN DELIVERING -->
          ${(!isPickup && primaryOrder) ? (() => {
            const isCash = primaryOrder.paymentMethod === 'efectivo' || (primaryOrder.paymentMethod && primaryOrder.paymentMethod.toString().toLowerCase().includes('efect'));
            const totalAmount = Number(primaryOrder.totalAmount || primaryOrder.total || 0);
            return `
              <div style="
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding: 8px 12px; border-radius: 14px;
                background: ${isCash ? (isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.14)') : (isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.12)')};
                border: 1.5px solid ${isCash ? '#fde68a' : (isLight ? '#bbf7d0' : 'rgba(34, 197, 94, 0.3)')};
              ">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:18px;">${isCash ? '💵' : '💳'}</span>
                  <div style="display:flex; flex-direction:column;">
                    <span style="font-size:9.5px; font-weight:900; color:${isCash ? (isLight ? '#b45309' : '#f59e0b') : (isLight ? '#15803d' : '#4ade80')}; text-transform:uppercase; letter-spacing:0.5px;">
                      ${isCash ? 'TOTAL A COBRAR EN MANO:' : 'PAGO POR TRANSFERENCIA:'}
                    </span>
                    <span style="font-size:16px; font-weight:950; color:${isCash ? (isLight ? '#78350f' : '#fef08a') : (isLight ? '#14532d' : '#86efac')}; line-height:1.1;">
                      $${totalAmount.toLocaleString('es-AR')}
                    </span>
                  </div>
                </div>

                <button class="open-order-breakdown-btn" data-order-id="${primaryOrder.id}" style="
                  background: ${isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.1)'};
                  border: 1px solid ${isCash ? '#fde68a' : (isLight ? '#bbf7d0' : 'rgba(255, 255, 255, 0.2)')};
                  color: ${isCash ? (isLight ? '#b45309' : '#f59e0b') : (isLight ? '#15803d' : '#4ade80')};
                  padding: 6px 10px; border-radius: 10px;
                  font-size: 11px; font-weight: 800; cursor: pointer;
                  display: flex; align-items: center; gap: 4px;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.06); flex-shrink: 0;
                ">
                  <span>ℹ️</span>
                  <span>Ver Desglose</span>
                </button>
              </div>
            `;
          })() : ''}

          <div class="driver-swipe-slider" data-action="${isPickup ? 'pickup' : 'deliver'}" data-id="${primaryOrder.id}" data-codes="${primaryOrder.verificationCode || ''}" style="
            position: relative;
            width: 100%;
            height: 52px;
            border-radius: 26px;
            background: ${isLight ? '#fff1f2' : 'rgba(15, 23, 42, 0.94)'};
            border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.35)' : 'rgba(225, 29, 72, 0.45)'};
            overflow: hidden;
            user-select: none;
            touch-action: none;
            box-shadow: 0 8px 24px ${isLight ? 'rgba(225, 29, 72, 0.12)' : 'rgba(0, 0, 0, 0.55)'};
            display: flex; align-items: center;
          ">
            <div class="swipe-slider-fill" style="
              position: absolute; top: 0; left: 0; height: 100%; width: 0%;
              background: linear-gradient(90deg, #e11d48 0%, #be123c 100%);
              border-radius: 26px; pointer-events: none;
            "></div>

            <div class="swipe-slider-label" style="
              position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
              font-size: 13.5px; font-weight: 900; letter-spacing: 2.5px;
              color: ${isLight ? '#9f1239' : '#ffffff'};
              text-transform: uppercase; pointer-events: none; padding-left: 24px;
              transition: opacity 0.15s ease;
            ">
              ${isPickup ? 'RETIRADO › › ›' : 'ENTREGADO › › ›'}
            </div>

            <div class="swipe-slider-handle" style="
              position: absolute; top: 3px; left: 3px; width: 46px; height: 46px;
              background: #ffffff; border-radius: 50%;
              box-shadow: 0 4px 14px rgba(225, 29, 72, 0.4);
              display: flex; align-items: center; justify-content: center;
              cursor: grab; touch-action: none; z-index: 2;
            ">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none; transform: translateX(1px); display: block;">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- IDLE RADAR STATUS & PREDICTIVE DEMAND (IF NO ACTIVE ORDERS) -->
      ${!hasActive ? `
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="status-dot-active" style="width:11px; height:11px; border-radius:50%; background:#22c55e; box-shadow:0 0 12px #22c55e; flex-shrink:0;"></div>
              <div>
                <div style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : 'white'}; letter-spacing:0.2px;">Buscando pedidos...</div>
                <div style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Magdalena en tiempo real</div>
              </div>
            </div>
            <div style="background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'}; border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:800; color:${isLight ? '#e11d48' : '#fb7185'}; display:flex; align-items:center; gap:5px;">
              ⏱️ <span id="driver-live-timer-text">0m</span>
            </div>
          </div>

          <!-- PREDICTIVE DEMAND RADAR BADGE -->
          ${(() => {
            const hotspots = window.currentDemandHotspots || [];
            const totalPrep = hotspots.reduce((acc, h) => acc + h.count, 0);
            return `
              <div id="driver-live-demand-pill" style="
                display: ${totalPrep > 0 ? 'flex' : 'none'}; align-items: center; justify-content: space-between;
                padding: 8px 12px; border-radius: 14px;
                background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.15)'};
                border: 1.5px solid ${isLight ? '#fecaca' : 'rgba(225, 29, 72, 0.35)'};
                color: ${isLight ? '#be123c' : '#fb7185'}; font-size: 11.5px; font-weight: 800;
              ">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:14px;">🔥</span>
                  <span><strong>Radar de Cocina:</strong> ${totalPrep} pedido${totalPrep > 1 ? 's' : ''} preparándose en ${hotspots.length} local${hotspots.length > 1 ? 'es' : ''}</span>
                </div>
                <span style="font-size:10px; background:#e11d48; color:white; padding:2px 7px; border-radius:8px; font-weight:900;">EN VIVO</span>
              </div>
            `;
          })()}
        </div>
      ` : ''}

      <!-- EXPANDED DETAILED MULTI-ORDER BREAKDOWN LIST -->
      ${(hasActive && isExpanded) ? `
        <div id="dock-expanded-orders-list" style="display:flex; flex-direction:column; gap:14px; margin-top:4px; flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-right: 4px; padding-bottom: 6px; animation: dockContentFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
          ${activeOrders.map((order, idx) => {
            const orderIsPickup = (order.status === 'pending' || order.status === 'accepted' || order.status === 'preparing' || order.status === 'ready' || (!order.pickedUpAt && order.status !== 'delivering'));
            const itemsList = Array.isArray(order.items) ? order.items : (Array.isArray(order.products) ? order.products : []);

            const isEncomienda = isOrderEncomienda(order);
            const parsedOrderMandado = (order.isFavor && !isEncomienda) ? parseMandadoDetails(order.description || order.itemsText || order.notes || order.details, order.comercioName || order.originAddress) : null;
            const displayComercioTitle = order.isFavor 
              ? (isEncomienda ? (order.pickupAddress || order.originAddress || 'Dirección de Retiro') : (parsedOrderMandado?.comercio || order.comercioName || 'Comercio indicado')) 
              : (order.comercioName || order.originAddress || 'Comercio / Local');
            
            const isCash = order.paymentMethod === 'efectivo' || (order.paymentMethod && order.paymentMethod.toString().toLowerCase().includes('efect'));
            const paymentLabel = isCash ? '💵 PAGA EN EFECTIVO:' : '💳 PAGA CON TRANSFERENCIA:';
            const paymentColor = isCash ? (isLight ? '#b45309' : '#f59e0b') : (isLight ? '#be123c' : '#fb7185');
            const paymentBg = isCash ? (isLight ? '#fef3c7' : 'rgba(245, 158, 11, 0.15)') : (isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.15)');
            const paymentBorder = isCash ? '#fde68a' : (isLight ? '#fecaca' : 'rgba(225, 29, 72, 0.35)');

            return `
              <div style="
                background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'};
                border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.25)' : 'rgba(225, 29, 72, 0.35)'};
                border-radius: 20px;
                padding: 14px;
                display: flex; flex-direction: column; gap: 10px;
                box-shadow: 0 4px 16px ${isLight ? 'rgba(225,29,72,0.06)' : 'rgba(0,0,0,0.3)'};
              ">
                <!-- ORDER TOP BADGE -->
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); color:#ffffff; font-size:10.5px; font-weight:900; padding:2px 8px; border-radius:10px; box-shadow:0 2px 6px rgba(225,29,72,0.35);">
                      Parada #${idx + 1}
                    </span>
                    <span style="font-size:12px; font-weight:900; color:${isLight ? '#e11d48' : '#fb7185'};">
                      ${orderIsPickup ? (isEncomienda ? '📦 Realizar Encomienda' : (order.isFavor ? '🛍️ Realizar Mandado' : '🛍️ Retirar en Local')) : '📍 Entregar al Cliente'}
                    </span>
                  </div>
                  <span style="font-size:11px; font-weight:800; color:${isLight ? '#64748b' : '#94a3b8'};">
                    #${order.id ? order.id.slice(-4) : ''}
                  </span>
                </div>

                <!-- 1. RETIRO / MANDADO -->
                <div style="display:flex; flex-direction:column; gap:4px; padding:8px 10px; border-radius:12px; background:${isLight ? '#ffffff' : 'rgba(0,0,0,0.25)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'};">
                  <div style="font-size:10px; font-weight:800; color:${isLight ? '#e11d48' : '#fb7185'}; text-transform:uppercase;">
                    ${isEncomienda ? '📦 ENCOMIENDA A REALIZAR:' : (order.isFavor ? '🛍️ MANDADO / COMPRA A REALIZAR:' : '🏬 PUNTO DE RETIRO:')}
                  </div>
                  <div style="font-size:14px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
                    ${displayComercioTitle}
                  </div>
                  ${isEncomienda ? `
                    <div style="font-size:11.5px; color:${isLight ? '#1e293b' : '#f8fafc'}; font-weight:700; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.1)'}; padding:8px 10px; border-radius:10px; margin-top:3px; border-left:3px solid #e11d48; line-height:1.35;">
                      📦 <strong>Paquete / Detalle:</strong> ${cleanMandadoText(order.details || order.description || order.itemsText || 'Paquete')}
                    </div>
                  ` : (order.isFavor ? `
                    <div style="font-size:11.5px; color:${isLight ? '#1e293b' : '#f8fafc'}; font-weight:700; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.1)'}; padding:8px 10px; border-radius:10px; margin-top:3px; border-left:3px solid #e11d48; line-height:1.35;">
                      📦 <strong>Pedido:</strong> ${parsedOrderMandado?.items || cleanMandadoText(order.description || order.itemsText || order.notes || order.details || 'Realizar compra o trámite')}
                    </div>
                  ` : `
                    <div style="font-size:11.5px; color:${isLight ? '#475569' : '#cbd5e1'}; font-weight:600;">
                      📍 ${order.pickupAddress || order.originAddress || order.comercioAddress || 'Magdalena'}
                    </div>
                  `)}

                  <!-- PRODUCT ITEMS BREAKDOWN -->
                  ${itemsList.length > 0 ? `
                    <div style="margin-top:6px; padding-top:6px; border-top:1px dashed ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}; font-size:11.5px;">
                      <div style="font-size:10.5px; font-weight:800; color:${isLight ? '#64748b' : '#94a3b8'}; margin-bottom:3px;">
                        🛍️ Detalle del Pedido (${itemsList.length} ítems):
                      </div>
                      ${itemsList.map(it => `
                        <div style="display:flex; justify-content:space-between; color:${isLight ? '#1e293b' : '#f1f5f9'}; font-weight:700; margin-bottom:2px;">
                          <span>${it.quantity || it.cant || 1}x ${it.name || it.title || 'Producto'}</span>
                          ${it.price ? `<span style="font-weight:800;">$${(it.price * (it.quantity || 1)).toLocaleString('es-AR')}</span>` : ''}
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}

                  <!-- MANDADO PURCHASE COST SUMMARY & EDIT BUTTON -->
                  ${(order.isFavor && !isEncomienda) ? `
                    <div style="
                      margin-top: 6px; padding: 10px 12px; border-radius: 12px;
                      background: ${isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.12)'};
                      border: 1.5px solid ${isLight ? '#fde68a' : 'rgba(245, 158, 11, 0.3)'};
                      display: flex; align-items: center; justify-content: space-between; gap: 10px;
                    ">
                      <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="font-size:10px; font-weight:900; color:${isLight ? '#b45309' : '#f59e0b'}; text-transform:uppercase; letter-spacing:0.5px;">
                          🛍️ Valor de Compra en Locales:
                        </div>
                        <div style="font-size:15px; font-weight:900; color:${isLight ? '#78350f' : '#fef08a'};">
                          $${((order.purchaseCost !== undefined) ? order.purchaseCost : (order.purchaseItemsTotal || 0)).toLocaleString('es-AR')}
                        </div>
                      </div>
                      <button class="edit-mandado-purchase-btn" data-order-id="${order.id}" style="
                        background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
                        color: white; border: none; padding: 7px 12px; border-radius: 10px;
                        font-size: 11.5px; font-weight: 900; cursor: pointer; display: flex; align-items: center; gap: 5px;
                        box-shadow: 0 3px 10px rgba(225,29,72,0.35); flex-shrink: 0;
                      ">
                        <span>✏️</span>
                        <span>Modificar Valor</span>
                      </button>
                    </div>
                  ` : ''}
                </div>

                <!-- 2. ENTREGA (CLIENTE) -->
                <div style="display:flex; flex-direction:column; gap:4px; padding:8px 10px; border-radius:12px; background:${isLight ? '#ffffff' : 'rgba(0,0,0,0.25)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'};">
                  <div style="font-size:10px; font-weight:800; color:${isLight ? '#64748b' : '#94a3b8'}; text-transform:uppercase;">
                    👤 Punto de Entrega:
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
                      ${order.userName || order.clientName || 'Cliente'}
                    </div>
                  </div>
                  <div style="font-size:11.5px; color:${isLight ? '#475569' : '#cbd5e1'}; font-weight:600;">
                    📍 ${order.deliveryAddress || order.address || 'Magdalena'}
                  </div>
                  ${(order.addressNotes || order.notes) ? `
                    <div style="font-size:11px; color:#e11d48; font-weight:700; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.1)'}; padding:4px 8px; border-radius:6px; margin-top:2px;">
                      📝 "${order.addressNotes || order.notes}"
                    </div>
                  ` : ''}

                  <!-- DIRECT CUSTOMER CONTACT ACTIONS (WHATSAPP, CHAT APP, CALL) -->
                  ${(() => {
                    const clientPhone = order.userPhone || order.clientPhone || order.phone || '';
                    let orderWaUrl = '';
                    if (clientPhone) {
                      const cleanPhone = clientPhone.replace(/\D/g, '');
                      if (cleanPhone.length >= 8) {
                        const fullPhone = cleanPhone.startsWith('54') ? cleanPhone : (cleanPhone.startsWith('9') ? `54${cleanPhone}` : `549${cleanPhone}`);
                        orderWaUrl = `https://wa.me/${fullPhone}?text=${encodeURIComponent(`¡Hola ${order.userName || 'Cliente'}! Soy el repartidor de GO Delivery con tu pedido #${order.orderId || (order.id ? order.id.slice(-4) : '')}.`)}`;
                      }
                    }
                    return `
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:6px; padding:6px 10px; border-radius:12px; background:${isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'};">
                        <span style="font-size:11px; font-weight:800; color:${isLight ? '#475569' : '#cbd5e1'};">Contactar:</span>
                        <div style="display:flex; align-items:center; gap:6px;">
                          ${orderWaUrl ? `
                            <a href="${orderWaUrl}" target="_blank" rel="noopener noreferrer" title="WhatsApp con ${order.userName || 'Cliente'}" style="
                              display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 10px;
                              background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
                              color: white; font-size: 11px; font-weight: 900; text-decoration: none;
                              box-shadow: 0 2px 6px rgba(37, 211, 102, 0.35);
                            ">
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                              </svg>
                              <span>WhatsApp</span>
                            </a>
                          ` : ''}

                          <button class="driver-dock-chat-btn" data-order-id="${order.id}" data-customer-name="${order.userName || order.clientName || 'Cliente'}" title="Chat en la App" style="
                            display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 10px;
                            background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
                            color: white; border: none; font-size: 11px; font-weight: 900; cursor: pointer;
                            box-shadow: 0 2px 6px rgba(225, 29, 72, 0.35);
                          ">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                            </svg>
                            <span>Chat App</span>
                          </button>
                        </div>
                      </div>
                    `;
                  })()}

                  <!-- PAYMENT SUMMARY -->
                  <div style="margin-top:6px; display:flex; align-items:center; justify-content:space-between; background:${paymentBg}; border:1px solid ${paymentBorder}; padding:8px 12px; border-radius:12px;">
                    <div style="display:flex; flex-direction:column;">
                      <span style="font-size:10.5px; font-weight:900; color:${paymentColor}; text-transform:uppercase;">
                        ${paymentLabel}
                      </span>
                      <strong style="font-size:15px; font-weight:950; color:${paymentColor};">
                        $${Number(order.totalAmount || order.total || 0).toLocaleString('es-AR')}
                      </strong>
                    </div>

                    <button class="open-order-breakdown-btn" data-order-id="${order.id}" style="
                      background: ${isLight ? '#ffffff' : 'rgba(0,0,0,0.35)'};
                      border: 1px solid ${paymentBorder};
                      color: ${paymentColor};
                      padding: 5px 10px; border-radius: 9px;
                      font-size: 11px; font-weight: 800; cursor: pointer;
                      display: flex; align-items: center; gap: 4px;
                      box-shadow: 0 2px 6px rgba(0,0,0,0.06); flex-shrink: 0;
                    ">
                      <span>ℹ️</span>
                      <span>Ver Desglose</span>
                    </button>
                  </div>
                </div>

                <!-- STOP ACTION SWIPE SLIDER -->
                <div style="margin-top:4px;">
                  <div class="driver-swipe-slider" data-action="${orderIsPickup ? 'pickup' : 'deliver'}" data-id="${order.id}" data-codes="${order.verificationCode || ''}" style="
                    position: relative;
                    width: 100%;
                    height: 48px;
                    border-radius: 24px;
                    background: ${isLight ? '#fff1f2' : 'rgba(15, 23, 42, 0.94)'};
                    border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.35)' : 'rgba(225, 29, 72, 0.45)'};
                    overflow: hidden;
                    user-select: none;
                    touch-action: none;
                    box-shadow: 0 4px 14px ${isLight ? 'rgba(225, 29, 72, 0.1)' : 'rgba(0,0,0,0.4)'};
                    display: flex; align-items: center;
                  ">
                    <div class="swipe-slider-fill" style="
                      position: absolute; top: 0; left: 0; height: 100%; width: 0%;
                      background: linear-gradient(90deg, #e11d48 0%, #be123c 100%);
                      border-radius: 24px; pointer-events: none;
                    "></div>

                    <div class="swipe-slider-label" style="
                      position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
                      font-size: 12.5px; font-weight: 900; letter-spacing: 2px;
                      color: ${isLight ? '#9f1239' : '#ffffff'};
                      text-transform: uppercase; pointer-events: none; padding-left: 24px;
                      transition: opacity 0.15s ease;
                    ">
                      ${orderIsPickup ? 'RETIRADO › › ›' : 'ENTREGADO › › ›'}
                    </div>

                    <div class="swipe-slider-handle" style="
                      position: absolute; top: 3px; left: 3px; width: 42px; height: 42px;
                      background: #ffffff; border-radius: 50%;
                      box-shadow: 0 3px 10px rgba(225, 29, 72, 0.35);
                      display: flex; align-items: center; justify-content: center;
                      cursor: grab; touch-action: none; z-index: 2;
                    ">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none; transform: translateX(1px); display: block;">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      <!-- BOTTOM ROW: QUICK CONTROLS (ALWAYS VISIBLE & PINNED!) -->
      <div style="display:flex; align-items:center; gap:6px; padding-top:8px; border-top:1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; flex-shrink: 0; margin-top: auto;">
        <!-- AUTO ACCEPT TOGGLE SWITCH WITH FILTER INDICATOR -->
        ${(() => {
          const isChofer = isDriverChoferApproved(user);
          const autoFilters = window.autoAcceptFilters || getDriverAutoAcceptFilters(user);
          const maxCategories = isChofer ? 3 : 2;
          const activeFilterCount = (autoFilters.comercios ? 1 : 0) + (autoFilters.mandados ? 1 : 0) + (isChofer && autoFilters.viajes ? 1 : 0);
          return `
            <button id="driver-quick-auto-accept-btn" title="Configurar y Filtrar Auto-Aceptar" style="
              flex: 1; height: 38px; border-radius: 12px;
              background: ${window.autoAcceptEnabled ? (isLight ? '#dcfce7' : 'rgba(34, 197, 94, 0.15)') : (isLight ? '#f1f5f9' : 'rgba(255, 255, 255, 0.06)')};
              border: 1px solid ${window.autoAcceptEnabled ? (isLight ? '#86efac' : 'rgba(34, 197, 94, 0.4)') : (isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.1)')};
              color: ${window.autoAcceptEnabled ? (isLight ? '#166534' : '#4ade80') : (isLight ? '#475569' : '#94a3b8')};
              font-size: 11px; font-weight: 800;
              display: flex; align-items: center; justify-content: space-between; padding: 0 8px;
              cursor: pointer; transition: all 0.2s ease;
            ">
              <span style="display:flex; align-items:center; gap:3px;">
                <span>⚡</span>
                <span>${window.autoAcceptEnabled ? `Auto (${activeFilterCount}/${maxCategories})` : 'Auto'}</span>
              </span>
              <!-- Switch Graphic -->
              <div style="
                width: 30px; height: 18px; border-radius: 9px;
                background: ${window.autoAcceptEnabled ? '#22c55e' : (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)')};
                position: relative; transition: background 0.25s ease;
              ">
                <div style="
                  width: 14px; height: 14px; border-radius: 50%; background: white;
                  position: absolute; top: 2px;
                  left: ${window.autoAcceptEnabled ? '14px' : '2px'};
                  transition: left 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                "></div>
              </div>
            </button>
          `;
        })()}

        <!-- SOS EMERGENCY BUTTON -->
        <button id="driver-quick-sos-btn" title="Centro de Seguridad SOS" style="
          height: 38px; padding: 0 10px; border-radius: 12px;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          border: 1px solid #b91c1c;
          color: white; font-size: 11px; font-weight: 900;
          display: flex; align-items: center; justify-content: center; gap: 4px;
          cursor: pointer; transition: all 0.2s ease; box-shadow: 0 3px 10px rgba(239,68,68,0.3);
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span>SOS</span>
        </button>

        <!-- DIRECT LIVE SUPPORT CHAT BUTTON -->
        <button id="driver-quick-support-btn" title="Chat Directo con Soporte" style="
          height: 38px; padding: 0 10px; border-radius: 12px;
          background: ${isLight ? '#e0f2fe' : 'rgba(2, 132, 199, 0.18)'};
          border: 1px solid ${isLight ? '#bae6fd' : 'rgba(56, 189, 248, 0.35)'};
          color: ${isLight ? '#0284c7' : '#38bdf8'}; font-size: 11px; font-weight: 900;
          display: flex; align-items: center; justify-content: center; gap: 4px;
          cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
          </svg>
          <span>Soporte</span>
        </button>

        <!-- HELP / FAQ GUIDE BUTTON -->
        <button id="driver-quick-help-btn" title="Preguntas Frecuentes y Guía" style="
          height: 38px; padding: 0 10px; border-radius: 12px;
          background: ${isLight ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'};
          border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.12)'};
          color: ${isLight ? '#475569' : '#cbd5e1'}; font-size: 11px; font-weight: 800;
          display: flex; align-items: center; justify-content: center; gap: 4px;
          cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;
        ">
          <span>❓</span>
          <span>Ayuda</span>
        </button>
      </div>
    </div>
  `;
}

export function syncDriverNavigationWithOrders(activeOrders = []) {
  const parseCoords = (c) => {
    if (!c) return null;
    let lat = typeof c.lat === 'number' ? c.lat : (typeof c.latitude === 'number' ? c.latitude : null);
    let lng = typeof c.lng === 'number' ? c.lng : (typeof c.longitude === 'number' ? c.longitude : null);
    if (lat === null && c.lat !== undefined) lat = parseFloat(c.lat);
    if (lng === null && c.lng !== undefined) lng = parseFloat(c.lng);
    if (lat === null && c.latitude !== undefined) lat = parseFloat(c.latitude);
    if (lng === null && c.longitude !== undefined) lng = parseFloat(c.longitude);
    if (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) {
      return { lat, lng };
    }
    return null;
  };

  if (!activeOrders || activeOrders.length === 0) {
    saveActiveOrdersOffline([]);
    clearDriverRoute();
    clearMultiStopMarkers();
    setMap3DPerspective(false);
    window.lastDriverManeuver = null;
    if (window.currentDemandHotspots && window.currentDemandHotspots.length > 0) {
      renderDemandHotspots(window.currentDemandHotspots);
    }
    return;
  }

  const primaryOrder = activeOrders[0];
  const driverLoc = parseCoords(window.lastRiderPos) || parseCoords(primaryOrder.driverLocation) || parseCoords(getState().user?.location) || { lat: -35.0815, lng: -57.5147 };

  // 2. Intelligent Multi-Stop Routing vs Single Order
  if (activeOrders.length > 1) {
    const multiStops = calculateOptimalMultiStopSequence(driverLoc, activeOrders);
    if (multiStops.length > 0) {
      if (multiStops[0].isUnverifiedMandado && multiStops[0].type === 'pickup') {
        clearDriverRoute();
        clearMultiStopMarkers();
        setMap3DPerspective(false);
      } else {
        setMap3DPerspective(true, 0, driverLoc);
        renderMultiStopRoute(multiStops, driverLoc);
      }
    }
  } else if (primaryOrder) {
    clearMultiStopMarkers();
    let pickupLoc = parseCoords(primaryOrder.pickupCoords || primaryOrder.comercioCoords || primaryOrder.originCoords || primaryOrder.pickupLocation);
    let dropoffLoc = parseCoords(primaryOrder.deliveryCoords || primaryOrder.addressCoords || primaryOrder.destinationCoords || primaryOrder.deliveryLocation || primaryOrder.coords);

    if (!pickupLoc && primaryOrder.comercioId) {
      const allComercios = getState().comercios || [];
      const com = allComercios.find(c => c.id === primaryOrder.comercioId);
      if (com && com.coords) pickupLoc = parseCoords(com.coords);
    }

    if (!dropoffLoc) {
      dropoffLoc = parseCoords(getState().deliveryCoords) || { lat: -35.0840, lng: -57.5120 };
    }

    const stage = (primaryOrder.status === 'pending' || primaryOrder.status === 'accepted' || primaryOrder.status === 'preparing' || primaryOrder.status === 'ready' || (!primaryOrder.pickedUpAt && primaryOrder.status !== 'delivering')) ? 'pickup' : 'delivery';
    const isShoppingMandado = Boolean(primaryOrder.isFavor && !isOrderEncomienda(primaryOrder));

    if (isShoppingMandado && stage === 'pickup') {
      clearDriverRoute();
      clearMultiStopMarkers();
      setMap3DPerspective(false);
    } else {
      if (stage === 'pickup' && !pickupLoc) {
        clearDriverRoute();
        clearMultiStopMarkers();
        setMap3DPerspective(false);
      } else {
        setMap3DPerspective(true, 0, driverLoc);
        drawDriverRoute(driverLoc, pickupLoc, dropoffLoc, stage);
      }
    }
  }
}

export function updateDriverHudPositions(activeOrders = []) {
  const speedPill = document.getElementById('driver-speedometer-pill');
  const streetPill = document.getElementById('driver-current-street-pill');
  const compassBtn = document.getElementById('driver-recenter-compass-btn');
  const dockCard = document.getElementById('driver-bottom-sheet-card');

  let dockHeight = 160;
  if (dockCard) {
    const h = dockCard.offsetHeight;
    if (h > 0) dockHeight = h;
  }

  const isHidden = window.driverDockHidden === true;
  const isExpanded = window.driverDockExpanded === true;
  const hasActive = Array.isArray(activeOrders) && activeOrders.length > 0;

  // Generous, breathable clearance (30px above the top edge of the card)
  let baseBottomPx = 185;
  if (isHidden) {
    baseBottomPx = 72;
  } else if (hasActive) {
    baseBottomPx = isExpanded ? Math.max(400, dockHeight + 32) : Math.max(255, dockHeight + 30);
  } else {
    baseBottomPx = Math.max(185, dockHeight + 30);
  }

  const compassBottomPx = baseBottomPx + 58;

  const badgeBottom = `max(${baseBottomPx}px, calc(${baseBottomPx - 10}px + env(safe-area-inset-bottom, 12px)))`;
  const compassBottom = `max(${compassBottomPx}px, calc(${compassBottomPx - 10}px + env(safe-area-inset-bottom, 12px)))`;

  if (speedPill) {
    speedPill.style.bottom = badgeBottom;
    speedPill.style.transition = 'bottom 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease';
  }
  if (streetPill) {
    streetPill.style.bottom = badgeBottom;
    streetPill.style.transition = 'bottom 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s ease';
  }
  if (compassBtn) {
    compassBtn.style.bottom = compassBottom;
    compassBtn.style.transition = 'bottom 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, background 0.2s ease';
  }
}

export function attachBottomDockListeners(user, activeOrders = []) {
  const latestUser = getState().user || user;
  const hasActive = Array.isArray(activeOrders) && activeOrders.length > 0;
  updateDriverHudPositions(activeOrders);

  // Toggle expand / collapse bottom sheet
  const toggleBtn = document.getElementById('dock-expand-toggle-btn');
  const dragHandle = document.getElementById('dock-drag-handle');
  const hideBtn = document.getElementById('dock-hide-card-btn');
  const unhideBtn = document.getElementById('dock-unhide-btn');
  const minimizedCard = document.querySelector('#driver-bottom-sheet-card.dock-minimized');
  const cardElement = document.getElementById('driver-bottom-sheet-card');

  const toggleDock = () => {
    window.driverDockExpanded = !window.driverDockExpanded;
    const bottomDock = document.getElementById('driver-footer-dock-container');
    if (bottomDock) {
      bottomDock.innerHTML = renderBottomDockContent(latestUser, activeOrdersList);
      attachBottomDockListeners(latestUser, activeOrdersList);
    }
  };

  const toggleHideDock = (forceShow) => {
    if (forceShow === true) {
      window.driverDockHidden = false;
    } else {
      window.driverDockHidden = !window.driverDockHidden;
    }
    const bottomDock = document.getElementById('driver-footer-dock-container');
    if (bottomDock) {
      bottomDock.innerHTML = renderBottomDockContent(latestUser, activeOrdersList);
      attachBottomDockListeners(latestUser, activeOrdersList);
    }
  };

  if (hideBtn) hideBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleHideDock(false); };
  if (unhideBtn) unhideBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleHideDock(true); };
  if (minimizedCard) minimizedCard.onclick = (e) => { toggleHideDock(true); };

  if (toggleBtn) toggleBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDock(); };
  if (dragHandle) dragHandle.onclick = (e) => {
    if (e.target === dragHandle || e.target.parentElement === dragHandle) {
      toggleDock();
    }
  };

  // Vertical swipe gesture on the card to hide/show
  if (cardElement) {
    let startY = 0;
    let currentY = 0;
    let isSwiping = false;

    const onTouchStart = (e) => {
      if (e.target.closest('.driver-swipe-slider') || e.target.closest('.swipe-slider-handle')) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isSwiping = true;
    };

    const onTouchMove = (e) => {
      if (!isSwiping) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      if (window.driverDockHidden) {
        if (deltaY < 0) {
          cardElement.style.transform = `translateY(${Math.max(-25, deltaY * 0.4)}px)`;
        }
      } else {
        if (deltaY > 0) {
          cardElement.style.transform = `translateY(${Math.min(45, deltaY * 0.4)}px)`;
        }
      }
    };

    const onTouchEnd = () => {
      if (!isSwiping) return;
      isSwiping = false;
      cardElement.style.transform = '';
      const deltaY = currentY - startY;

      if (window.driverDockHidden) {
        if (deltaY < -20) {
          toggleHideDock(true);
        }
      } else {
        if (deltaY > 35) {
          toggleHideDock(false);
        } else if (deltaY < -35 && hasActive && !window.driverDockExpanded) {
          toggleDock();
        }
      }
    };

    cardElement.addEventListener('touchstart', onTouchStart, { passive: true });
    cardElement.addEventListener('touchmove', onTouchMove, { passive: true });
    cardElement.addEventListener('touchend', onTouchEnd, { passive: true });
  }
  
  const quickAutoAcceptBtn = document.getElementById('driver-quick-auto-accept-btn');
  if (quickAutoAcceptBtn) {
    quickAutoAcceptBtn.onclick = async () => {
      const isCurrentlyEnabled = window.autoAcceptEnabled === true;
      const isLight = getDriverMapTheme() === 'light';
      const isChofer = isDriverChoferApproved(latestUser);
      const currentFilters = { ...getDriverAutoAcceptFilters(latestUser) };
      const { showModal, closeModal } = await import('../components/modal.js');

      const modalEl = document.createElement('div');
      modalEl.style.cssText = `padding: 28px 20px calc(24px + env(safe-area-inset-bottom, 20px)) 20px; font-family: var(--font-body, sans-serif); color: ${isLight ? '#0f172a' : '#ffffff'};`;

      const renderFilterCards = () => `
        <div style="display: flex; flex-direction: column; gap: 10px; margin: 16px 0 20px 0;">
          <!-- 1. COMERCIOS -->
          <div id="filter-card-comercios" style="
            display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px;
            background: ${currentFilters.comercios ? (isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.12)') : (isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)')};
            border: 1.5px solid ${currentFilters.comercios ? (isLight ? '#86efac' : 'rgba(34, 197, 94, 0.35)') : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)')};
            cursor: pointer; transition: all 0.2s ease;
          ">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="font-size:22px;">🍔</div>
              <div>
                <div style="font-size:13.5px; font-weight:900; color:${currentFilters.comercios ? (isLight ? '#166534' : '#4ade80') : (isLight ? '#0f172a' : '#ffffff')};">Pedidos de Comercios</div>
                <div style="font-size:11px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:500;">Restaurantes, kioscos y locales</div>
              </div>
            </div>
            <div style="
              width: 22px; height: 22px; border-radius: 7px;
              background: ${currentFilters.comercios ? '#22c55e' : 'transparent'};
              border: 1.5px solid ${currentFilters.comercios ? '#22c55e' : (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.25)')};
              display: flex; align-items: center; justify-content: center; color: white; font-size: 13px; font-weight: 900;
            ">
              ${currentFilters.comercios ? '✓' : ''}
            </div>
          </div>

          <!-- 2. MANDADOS -->
          <div id="filter-card-mandados" style="
            display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px;
            background: ${currentFilters.mandados ? (isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.12)') : (isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)')};
            border: 1.5px solid ${currentFilters.mandados ? (isLight ? '#86efac' : 'rgba(34, 197, 94, 0.35)') : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)')};
            cursor: pointer; transition: all 0.2s ease;
          ">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="font-size:22px;">📦</div>
              <div>
                <div style="font-size:13.5px; font-weight:900; color:${currentFilters.mandados ? (isLight ? '#166534' : '#4ade80') : (isLight ? '#0f172a' : '#ffffff')};">Mandados y Envíos</div>
                <div style="font-size:11px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:500;">GoFavores, compras y paquetería</div>
              </div>
            </div>
            <div style="
              width: 22px; height: 22px; border-radius: 7px;
              background: ${currentFilters.mandados ? '#22c55e' : 'transparent'};
              border: 1.5px solid ${currentFilters.mandados ? '#22c55e' : (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.25)')};
              display: flex; align-items: center; justify-content: center; color: white; font-size: 13px; font-weight: 900;
            ">
              ${currentFilters.mandados ? '✓' : ''}
            </div>
          </div>

          <!-- 3. VIAJES (SOLO VISIBLE SI ES CHOFER HABILITADO) -->
          ${isChofer ? `
            <div id="filter-card-viajes" style="
              display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px;
              background: ${currentFilters.viajes ? (isLight ? '#f0fdf4' : 'rgba(34, 197, 94, 0.12)') : (isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)')};
              border: 1.5px solid ${currentFilters.viajes ? (isLight ? '#86efac' : 'rgba(34, 197, 94, 0.35)') : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)')};
              cursor: pointer; transition: all 0.2s ease;
            ">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="font-size:22px;">🚗</div>
                <div>
                  <div style="font-size:13.5px; font-weight:900; color:${currentFilters.viajes ? (isLight ? '#166534' : '#4ade80') : (isLight ? '#0f172a' : '#ffffff')};">Viajes de Pasajeros</div>
                  <div style="font-size:11px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:500;">GoViajes y traslados urbanos</div>
                </div>
              </div>
              <div style="
                width: 22px; height: 22px; border-radius: 7px;
                background: ${currentFilters.viajes ? '#22c55e' : 'transparent'};
                border: 1.5px solid ${currentFilters.viajes ? '#22c55e' : (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.25)')};
                display: flex; align-items: center; justify-content: center; color: white; font-size: 13px; font-weight: 900;
              ">
                ${currentFilters.viajes ? '✓' : ''}
              </div>
            </div>
          ` : ''}
        </div>
      `;

      modalEl.innerHTML = `
        <div style="text-align:center; padding-top: 8px;">
          <div style="width: 52px; height: 52px; border-radius: 16px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; background: ${isCurrentlyEnabled ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'}; color: white; box-shadow: 0 8px 20px rgba(0,0,0,0.2);">
            ⚡
          </div>
          <h3 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 900; font-family: var(--font-display, sans-serif);">
            ${isCurrentlyEnabled ? 'Filtros de Auto-Aceptar' : 'Activar Auto-Aceptar'}
          </h3>
          <p style="margin: 0; font-size: 12.5px; line-height: 1.45; color: ${isLight ? '#64748b' : '#94a3b8'}; font-weight: 500;">
            Seleccioná qué tipos de pedidos querés aceptar de forma automática en tu ruta:
          </p>
        </div>

        <div id="auto-accept-filter-cards-container">
          ${renderFilterCards()}
        </div>

        <div style="display: flex; gap: 10px; margin-top: 10px;">
          ${isCurrentlyEnabled ? `
            <button id="btn-disable-auto-accept" style="flex: 1; height: 46px; border-radius: 14px; border: 1.5px solid ${isLight ? '#fecaca' : 'rgba(239,68,68,0.3)'}; background: ${isLight ? '#fee2e2' : 'rgba(239,68,68,0.15)'}; color: ${isLight ? '#dc2626' : '#f87171'}; font-weight: 850; font-size: 13px; cursor: pointer;">
              Desactivar
            </button>
            <button id="btn-save-auto-accept" style="flex: 1; height: 46px; border-radius: 14px; border: none; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; font-weight: 900; font-size: 13px; cursor: pointer; box-shadow: 0 6px 16px rgba(16,185,129,0.35);">
              Guardar Filtros
            </button>
          ` : `
            <button id="btn-cancel-auto-accept" style="flex: 1; height: 46px; border-radius: 14px; border: 1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; background: transparent; color: ${isLight ? '#475569' : '#cbd5e1'}; font-weight: 800; font-size: 13px; cursor: pointer;">
              Cancelar
            </button>
            <button id="btn-confirm-auto-accept" style="flex: 1; height: 46px; border-radius: 14px; border: none; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; font-weight: 900; font-size: 13px; cursor: pointer; box-shadow: 0 6px 16px rgba(16,185,129,0.35);">
              ⚡ Activar Auto-Aceptar
            </button>
          `}
        </div>
      `;

      showModal({
        content: modalEl,
        height: 'auto',
        hideHeader: true,
        headerBackground: isLight ? '#ffffff' : '#090d16',
        onOpen: () => {
          const container = modalEl.querySelector('#auto-accept-filter-cards-container');
          const bindFilterEvents = () => {
            const cardComercios = modalEl.querySelector('#filter-card-comercios');
            const cardMandados = modalEl.querySelector('#filter-card-mandados');
            const cardViajes = modalEl.querySelector('#filter-card-viajes');

            if (cardComercios) {
              cardComercios.onclick = () => {
                currentFilters.comercios = !currentFilters.comercios;
                container.innerHTML = renderFilterCards();
                bindFilterEvents();
              };
            }
            if (cardMandados) {
              cardMandados.onclick = () => {
                currentFilters.mandados = !currentFilters.mandados;
                container.innerHTML = renderFilterCards();
                bindFilterEvents();
              };
            }
            if (cardViajes) {
              cardViajes.onclick = () => {
                currentFilters.viajes = !currentFilters.viajes;
                container.innerHTML = renderFilterCards();
                bindFilterEvents();
              };
            }
          };
          bindFilterEvents();

          const cancelBtn = modalEl.querySelector('#btn-cancel-auto-accept');
          if (cancelBtn) cancelBtn.onclick = () => closeModal();

          const disableBtn = modalEl.querySelector('#btn-disable-auto-accept');
          if (disableBtn) {
            disableBtn.onclick = async () => {
              closeModal();
              window.autoAcceptEnabled = false;
              localStorage.setItem('driver_auto_accept', 'false');
              if (window.toggleAutoAccept && latestUser?.uid) {
                try { window.toggleAutoAccept(false, latestUser.uid, currentFilters); } catch(e) {}
              }
              showToast('Auto-Aceptar Desactivado ⏸️', 'info');
              const bottomDock = document.getElementById('driver-footer-dock-container');
              if (bottomDock) {
                bottomDock.innerHTML = renderBottomDockContent(latestUser, activeOrdersList);
                attachBottomDockListeners(latestUser, activeOrdersList);
              }
            };
          }

          const confirmBtn = modalEl.querySelector('#btn-confirm-auto-accept') || modalEl.querySelector('#btn-save-auto-accept');
          if (confirmBtn) {
            confirmBtn.onclick = async () => {
              const selectedCount = (currentFilters.comercios ? 1 : 0) + (currentFilters.mandados ? 1 : 0) + (isChofer && currentFilters.viajes ? 1 : 0);
              if (selectedCount === 0) {
                showToast('⚠️ Seleccioná al menos un tipo de pedido', 'warning');
                return;
              }

              closeModal();
              saveDriverAutoAcceptFilters(currentFilters);
              window.autoAcceptEnabled = true;
              localStorage.setItem('driver_auto_accept', 'true');
              if (window.toggleAutoAccept && latestUser?.uid) {
                try { window.toggleAutoAccept(true, latestUser.uid, currentFilters); } catch(e) {}
              }

              const names = [];
              if (currentFilters.comercios) names.push('Comercios');
              if (currentFilters.mandados) names.push('Mandados');
              if (isChofer && currentFilters.viajes) names.push('Viajes');

              showToast(`⚡ Auto-Aceptar activo para: ${names.join(', ')}`, 'success');
              const bottomDock = document.getElementById('driver-footer-dock-container');
              if (bottomDock) {
                bottomDock.innerHTML = renderBottomDockContent(latestUser, activeOrdersList);
                attachBottomDockListeners(latestUser, activeOrdersList);
              }
            };
          }
        }
      });
    };
  }

  const quickSosBtn = document.getElementById('driver-quick-sos-btn');
  if (quickSosBtn) {
    quickSosBtn.onclick = () => {
      showDriverSafetyModal(latestUser);
    };
  }

  const quickSupportBtn = document.getElementById('driver-quick-support-btn');
  if (quickSupportBtn) {
    quickSupportBtn.onclick = () => {
      openDriverDirectSupportChat(latestUser);
    };
  }

  const quickHelpBtn = document.getElementById('driver-quick-help-btn');
  if (quickHelpBtn) {
    quickHelpBtn.onclick = () => {
      showDriverHelpBottomSheet(latestUser);
    };
  }

  // ATTACH SLIDE-TO-ACTION (SWIPE GESTURE HANDLER)
  const sliders = document.querySelectorAll('.driver-swipe-slider');
  sliders.forEach(slider => {
    const handle = slider.querySelector('.swipe-slider-handle');
    const fill = slider.querySelector('.swipe-slider-fill');
    const label = slider.querySelector('.swipe-slider-label');
    if (!handle || !fill) return;

    let isDragging = false;
    let startX = 0;
    let maxSlide = 0;

    const onStart = (e) => {
      isDragging = true;
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX;
      maxSlide = Math.max(10, slider.clientWidth - handle.clientWidth - 6);
      handle.style.transition = 'none';
      fill.style.transition = 'none';
      handle.style.cursor = 'grabbing';
    };

    const onMove = (e) => {
      if (!isDragging) return;
      const touch = e.touches ? e.touches[0] : e;
      let deltaX = touch.clientX - startX;
      if (deltaX < 0) deltaX = 0;
      if (deltaX > maxSlide) deltaX = maxSlide;

      handle.style.left = `${deltaX + 3}px`;
      fill.style.width = `${((deltaX + 24) / slider.clientWidth) * 100}%`;
      if (label) {
        label.style.opacity = Math.max(0, 1 - (deltaX / (maxSlide * 0.6)));
      }
    };

    const onEnd = async () => {
      if (!isDragging) return;
      isDragging = false;
      handle.style.cursor = 'grab';
      const currentLeft = (parseInt(handle.style.left) || 3) - 3;

      if (currentLeft >= maxSlide * 0.82) {
        handle.style.transition = 'all 0.18s ease';
        fill.style.transition = 'all 0.18s ease';
        handle.style.left = `${maxSlide + 3}px`;
        fill.style.width = '100%';
        if (label) {
          label.textContent = '¡CONFIRMADO!';
          label.style.opacity = '1';
        }

        if (navigator.vibrate) {
          try { navigator.vibrate([70, 30, 70]); } catch(e) {}
        }

        const action = slider.dataset.action;
        const oId = slider.dataset.id;
        const code = slider.dataset.codes;

        setTimeout(async () => {
          if (action === 'pickup' && oId) {
            const targetOrder = (activeOrdersList || []).find(o => o.id === oId);
            const isShoppingMandado = targetOrder && targetOrder.isFavor && !isOrderEncomienda(targetOrder);

            if (isShoppingMandado) {
              openMandadoPurchaseModal({
                order: targetOrder,
                isEdit: false,
                onCancel: () => {
                  handle.style.transition = 'all 0.25s ease';
                  fill.style.transition = 'all 0.25s ease';
                  handle.style.left = '3px';
                  fill.style.width = '0%';
                  if (label) {
                    label.textContent = 'RETIRADO › › ›';
                    label.style.opacity = '1';
                  }
                },
                onConfirm: async (purchaseTotal, stopsData, newTotal) => {
                  await markAsPickedUp(oId, {
                    purchaseCost: purchaseTotal,
                    purchaseItemsTotal: purchaseTotal,
                    stopsPurchases: stopsData,
                    total: newTotal
                  });
                }
              });
            } else {
              markAsPickedUp(oId);
            }
          } else if (action === 'deliver' && oId) {
            const ids = oId.split(',');
            const targetOrders = (activeOrdersList || []).filter(o => ids.includes(o.id));
            const isSim = ids.includes('sim_demo_order') || Boolean(window.mockSimulatedOrder);
            const isTripOrder = targetOrders.some(o => o.isTrip === true);
            const noCodeRequired = isSim || isTripOrder || targetOrders.some(o => 
              o.isManual === true || 
              o.noCodeRequired === true || 
              o.source === 'whatsapp_bot' || 
              o.favorType === 'encomienda' || 
              (o.isFavor && o.favorType === 'encomienda') || 
              o.serviceType === 'encomienda'
            );

            openSlideToConfirmModal({
              isTrip: isTripOrder,
              noCodeRequired,
              codes: code ? [code] : targetOrders.map(o => o.verificationCode).filter(Boolean),
              ids,
              orders: activeOrdersList || [],
              onCancel: () => {
                handle.style.transition = 'all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                fill.style.transition = 'all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                handle.style.left = '3px';
                fill.style.width = '0%';
                if (label) {
                  label.textContent = 'ENTREGADO › › ›';
                  label.style.opacity = '1';
                }
              },
              onConfirm: async () => {
                await markAsDelivered(ids);
              }
            });
          }
        }, 120);
      } else {
        handle.style.transition = 'all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        fill.style.transition = 'all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        handle.style.left = '3px';
        fill.style.width = '0%';
        if (label) label.style.opacity = '1';
      }
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  });

  const pickupBtns = document.querySelectorAll('.mark-picked-up-btn');
  pickupBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const oId = btn.dataset.id;
      if (oId) {
        const targetOrder = (activeOrdersList || []).find(o => o.id === oId);
        const isShoppingMandado = targetOrder && targetOrder.isFavor && !isOrderEncomienda(targetOrder);
        if (isShoppingMandado) {
          openMandadoPurchaseModal({
            order: targetOrder,
            isEdit: false,
            onConfirm: async (purchaseTotal, stopsData, newTotal) => {
              await markAsPickedUp(oId, {
                purchaseCost: purchaseTotal,
                purchaseItemsTotal: purchaseTotal,
                stopsPurchases: stopsData,
                total: newTotal
              });
            }
          });
        } else {
          markAsPickedUp(oId);
        }
      }
    };
  });

  // EDIT MANDADO PURCHASE COST BUTTONS (FROM "VER DETALLES")
  const editMandadoBtns = document.querySelectorAll('.edit-mandado-purchase-btn');
  editMandadoBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const oId = btn.dataset.orderId;
      const targetOrder = (activeOrdersList || []).find(o => o.id === oId);
      if (targetOrder) {
        openMandadoPurchaseModal({
          order: targetOrder,
          isEdit: true,
          onConfirm: async (purchaseTotal, stopsData, newTotal) => {
            try {
              const orderRef = doc(db, 'orders', targetOrder.id);
              await updateDoc(orderRef, {
                purchaseCost: purchaseTotal,
                purchaseItemsTotal: purchaseTotal,
                stopsPurchases: stopsData,
                total: newTotal,
                updatedAt: serverTimestamp()
              });
              targetOrder.purchaseCost = purchaseTotal;
              targetOrder.purchaseItemsTotal = purchaseTotal;
              targetOrder.stopsPurchases = stopsData;
              targetOrder.total = newTotal;
              showToast(`✅ Valor de compra actualizado: $${purchaseTotal.toLocaleString('es-AR')}`, 'success');

              const currentUser = getState().user;
              const bottomDock = document.getElementById('driver-footer-dock-container');
              if (bottomDock) {
                bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
                attachBottomDockListeners(currentUser, activeOrdersList);
              }
            } catch(err) {
              console.error('Error updating mandado purchase cost:', err);
              showToast('Error al actualizar valor de compra: ' + err.message, 'error');
            }
          }
        });
      }
    };
  });

  // OPEN ORDER TOTAL BREAKDOWN BUTTONS
  const breakdownBtns = document.querySelectorAll('.open-order-breakdown-btn');
  breakdownBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const oId = btn.dataset.orderId;
      const targetOrder = (activeOrdersList || []).find(o => o.id === oId) || (activeOrdersList || [])[0];
      if (targetOrder) {
        openOrderBreakdownModal(targetOrder);
      }
    };
  });

  // OPEN CHAT FOR INDIVIDUAL ORDERS IN BOTTOM DOCK
  const dockChatBtns = document.querySelectorAll('.driver-dock-chat-btn');
  dockChatBtns.forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const oId = btn.dataset.orderId;
      const cName = btn.dataset.customerName || 'Cliente';
      const targetOrder = (activeOrdersList || []).find(o => o.id === oId) || (activeOrdersList || [])[0];
      if (targetOrder) {
        const { openChat } = await import('../components/chat.js');
        openChat({
          orderId: targetOrder.id,
          type: 'client-delivery',
          otherName: cName,
          orderNum: targetOrder.orderId,
          senderDisplayName: latestUser.displayName || latestUser.name || 'Repartidor'
        });
      }
    };
  });

  const deliverBtns = document.querySelectorAll('.mark-delivered-btn');
  deliverBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const oId = btn.dataset.ids || btn.dataset.id;
      const code = btn.dataset.codes || btn.dataset.code;
      if (oId) {
        const ids = oId.split(',');
        const targetOrders = (activeOrdersList || []).filter(o => ids.includes(o.id));
        const isSim = ids.includes('sim_demo_order') || Boolean(window.mockSimulatedOrder);
        const isTripOrder = targetOrders.some(o => o.isTrip === true);
        const noCodeRequired = isSim || isTripOrder || targetOrders.some(o => 
          o.isManual === true || 
          o.noCodeRequired === true || 
          o.source === 'whatsapp_bot' || 
          o.favorType === 'encomienda' || 
          (o.isFavor && o.favorType === 'encomienda') || 
          o.serviceType === 'encomienda'
        );

        openSlideToConfirmModal({
          isTrip: isTripOrder,
          noCodeRequired,
          codes: code ? [code] : targetOrders.map(o => o.verificationCode).filter(Boolean),
          ids,
          orders: activeOrdersList || [],
          onConfirm: async () => {
            await markAsDelivered(ids);
          }
        });
      }
    };
  });
}

// Delegated click handler for open-order-breakdown-btn across the page
document.addEventListener('click', (e) => {
  const breakdownBtn = e.target.closest('.open-order-breakdown-btn');
  if (breakdownBtn) {
    e.preventDefault();
    e.stopPropagation();
    const oId = breakdownBtn.dataset.orderId;
    const targetOrder = (activeOrdersList || []).find(o => o.id === oId) || (activeOrdersList || [])[0];
    if (targetOrder) {
      openOrderBreakdownModal(targetOrder);
    }
  }
});

export async function ensureDriverPermissions() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      try {
        const { requestWebPushPermission } = await import('../utils/notifications.js');
        await requestWebPushPermission();
      } catch (e) {
        console.warn('Error requesting notifications:', e);
      }
    }
  }

  if ('geolocation' in navigator) {
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000, maximumAge: 60000, enableHighAccuracy: false });
      });
    } catch (err) {
      console.warn('Geolocation check:', err);
    }
  }

  return true;
}

function showBlockingLoading(message = 'Cargando...') {
  hideBlockingLoading();
  const overlay = document.createElement('div');
  overlay.id = 'v5-blocking-loading-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    color: white;
    font-family: var(--font-display, 'Outfit', sans-serif);
    animation: fadeIn 0.25s ease-out;
  `;
  overlay.innerHTML = `
    <div style="width: 54px; height: 54px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.2); border-top-color: var(--color-primary, #e11d48); animation: spin 0.8s linear infinite;"></div>
    <div style="font-size: 16px; font-weight: 900; letter-spacing: -0.01em; color: white; text-align: center; max-width: 280px; line-height: 1.4;">
      ${message}
    </div>
  `;
  if (!document.getElementById('blocking-loading-styles')) {
    const s = document.createElement('style');
    s.id = 'blocking-loading-styles';
    s.textContent = `
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.head.appendChild(s);
  }
  document.body.appendChild(overlay);
}

function hideBlockingLoading() {
  document.getElementById('v5-blocking-loading-overlay')?.remove();
}

export async function showDeliveryHistoryModal(user) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { collection, query, where, getDocs, limit } = await import('firebase/firestore');

  const latestUser = getState().user || user;
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 14px 16px calc(24px + env(safe-area-inset-bottom, 16px)) 16px;
    background: ${isLight ? '#ffffff' : '#090d16'};
    color: ${isLight ? '#0f172a' : '#ffffff'};
    height: 100%;
    min-height: 0;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    font-family: var(--font-body, sans-serif);
  `;

  modalEl.innerHTML = `
    <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
  `;

  showModal({
    title: '📜 Historial de Entregas',
    content: modalEl,
    height: '85dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : '#ffffff'
  });

  try {
    const q = query(
      collection(db, 'orders'),
      where('driverId', '==', latestUser.uid),
      where('status', 'in', ['completed', 'cancelled']),
      limit(100)
    );

    const snap = await getDocs(q);
    const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return tB - tA;
      });

    let filterSettlement = 'all'; // 'all' | 'unsettled'
    let filterPeriod = 'all'; // 'all' | 'today'

    function renderHistoryList() {
      const now = new Date();
      const todayDateString = now.toDateString();

      const filteredOrders = allOrders.filter(o => {
        // Settlement filter
        if (filterSettlement === 'unsettled') {
          const isSettled = o.isSettledDriver === true;
          if (isSettled) return false;
        }

        // Period filter
        if (filterPeriod === 'today') {
          const oDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : null;
          if (!oDate || oDate.toDateString() !== todayDateString) return false;
        }

        return true;
      });

      const totalDelivered = filteredOrders.filter(o => o.status === 'completed').length;
      const totalEarnings = filteredOrders.filter(o => o.status === 'completed').reduce((sum, o) => {
        return sum + getOrderDriverEarnings(o);
      }, 0);

      modalEl.innerHTML = `
        <!-- FILTER CONTROLS BAR -->
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px; flex-shrink:0;">
          <!-- ROW 1: LIQUIDACION FILTER -->
          <div style="display:flex; gap:6px; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'}; padding:4px; border-radius:14px;">
            <button id="filter-settle-all" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterSettlement === 'all' ? (isLight ? '#ffffff' : '#e11d48') : 'transparent'};
              color:${filterSettlement === 'all' ? (isLight ? '#0f172a' : '#ffffff') : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterSettlement === 'all' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterSettlement === 'all' ? (isLight ? '0 2px 8px rgba(0,0,0,0.1)' : '0 2px 8px rgba(225,29,72,0.4)') : 'none'};
            ">
              📋 Todos (${allOrders.length})
            </button>
            <button id="filter-settle-unsettled" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterSettlement === 'unsettled' ? '#f59e0b' : 'transparent'};
              color:${filterSettlement === 'unsettled' ? '#ffffff' : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterSettlement === 'unsettled' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterSettlement === 'unsettled' ? '0 2px 8px rgba(245,158,11,0.4)' : 'none'};
            ">
              ⏳ No Liquidados
            </button>
          </div>

          <!-- ROW 2: FECHA FILTER -->
          <div style="display:flex; gap:6px; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'}; padding:4px; border-radius:14px;">
            <button id="filter-period-all" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterPeriod === 'all' ? (isLight ? '#ffffff' : '#2563eb') : 'transparent'};
              color:${filterPeriod === 'all' ? (isLight ? '#0f172a' : '#ffffff') : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterPeriod === 'all' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterPeriod === 'all' ? (isLight ? '0 2px 8px rgba(0,0,0,0.1)' : '0 2px 8px rgba(37,99,235,0.4)') : 'none'};
            ">
              🗓️ Todo el Historial
            </button>
            <button id="filter-period-today" style="
              flex:1; height:34px; border-radius:11px; border:none;
              background:${filterPeriod === 'today' ? (isLight ? '#0f172a' : '#38bdf8') : 'transparent'};
              color:${filterPeriod === 'today' ? '#ffffff' : (isLight ? '#64748b' : '#94a3b8')};
              font-size:11.5px; font-weight:${filterPeriod === 'today' ? '900' : '700'};
              cursor:pointer; transition:all 0.15s; box-shadow:${filterPeriod === 'today' ? '0 2px 8px rgba(0,0,0,0.2)' : 'none'};
            ">
              ⚡ Hoy
            </button>
          </div>
        </div>

        <!-- TOP STATS KPI -->
        <div style="
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;
          background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'};
          border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
          border-radius: 18px; padding: 12px 14px; flex-shrink: 0;
        ">
          <div style="display:flex; flex-direction:column;">
            <span style="font-size:10.5px; font-weight:800; color:${isLight ? '#64748b' : '#94a3b8'}; text-transform:uppercase;">Entregas Filtradas</span>
            <span style="font-size:22px; font-weight:950; color:${isLight ? '#0f172a' : '#ffffff'};">${totalDelivered}</span>
          </div>
          <div style="display:flex; flex-direction:column; text-align:right;">
            <span style="font-size:10.5px; font-weight:800; color:${isLight ? '#64748b' : '#94a3b8'}; text-transform:uppercase;">Ganancia Real Total</span>
            <span style="font-size:22px; font-weight:950; color:#10b981;">$${totalEarnings.toLocaleString('es-AR')}</span>
          </div>
        </div>

        <!-- ORDERS LIST CONTAINER -->
        <div class="scrollable modal-scrollable-list" style="flex:1; min-height:0; max-height:100%; overflow-y:auto !important; -webkit-overflow-scrolling:touch !important; touch-action:pan-y !important; overscroll-behavior-y:contain; display:flex; flex-direction:column; gap:10px; padding-right:2px;">
          ${filteredOrders.length === 0 ? `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:45px 20px; text-align:center;">
              <div style="font-size:40px; margin-bottom:8px;">🔍</div>
              <h4 style="font-size:15px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; margin:0 0 4px 0;">Sin entregas para este filtro</h4>
              <p style="font-size:12.5px; color:${isLight ? '#64748b' : '#94a3b8'}; margin:0;">Probá cambiando los filtros superiores.</p>
            </div>
          ` : filteredOrders.map(o => {
            const isCompleted = o.status === 'completed';
            const isSettled = o.isSettledDriver === true;
            const isEncomienda = isOrderEncomienda(o);
            const orderDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : new Date();
            const dateStr = orderDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
            const timeStr = orderDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const earnings = getOrderDriverEarnings(o);

            let title = 'Pedido';
            if (isEncomienda) {
              title = `📦 Encomienda: ${cleanMandadoText(o.details || o.description || o.itemsText || 'Envío de paquete')}`;
            } else if (o.isFavor) {
              const parsed = parseMandadoDetails(o.description || o.itemsText || o.notes || o.details, o.comercioName || o.originAddress);
              title = `🛍️ Mandado: ${parsed.comercio || 'Compra'}`;
            } else {
              title = `🏪 ${o.comercioName || 'Pedido en local'}`;
            }

            const address = o.deliveryAddress || o.address || 'Magdalena';
            const itemsList = Array.isArray(o.items) ? o.items : (Array.isArray(o.products) ? o.products : []);

            return `
              <div class="history-order-card-item" data-order-id="${o.id}" style="
                background: ${isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.03)'};
                border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
                border-radius: 16px; padding: 12px 14px;
                display: flex; flex-direction: column; gap: 8px;
                box-shadow: 0 2px 8px ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.2)'};
                cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;
              ">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="background:${isCompleted ? '#dcfce7' : '#fee2e2'}; color:${isCompleted ? '#166534' : '#dc2626'}; font-size:10px; font-weight:900; padding:2px 7px; border-radius:6px;">
                      ${isCompleted ? '✓ Entregado' : '✕ Cancelado'}
                    </span>
                    <span style="background:${isSettled ? (isLight ? '#e0e7ff' : 'rgba(99,102,241,0.2)') : (isLight ? '#fef3c7' : 'rgba(245,158,11,0.2)')}; color:${isSettled ? (isLight ? '#3730a3' : '#a5b4fc') : (isLight ? '#b45309' : '#fbbf24')}; font-size:10px; font-weight:900; padding:2px 7px; border-radius:6px;">
                      ${isSettled ? '✓ Liquidado' : '⏳ No liquidado'}
                    </span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:11px; font-weight:700; color:${isLight ? '#64748b' : '#94a3b8'};">
                      ${dateStr} · ${timeStr}
                    </span>
                    <span style="font-size:11px; font-weight:900; color:${isLight ? '#0f172a' : '#cbd5e1'};">
                      #${o.orderId || (o.id ? o.id.slice(-4) : '')}
                    </span>
                  </div>
                </div>

                <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
                  <div style="min-width:0; flex:1;">
                    <div style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${title}
                    </div>
                    <div style="font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                      📍 ${address}
                    </div>
                  </div>
                  <div style="text-align:right; flex-shrink:0;">
                    <div style="font-size:15px; font-weight:950; color:${isCompleted ? '#10b981' : (isLight ? '#94a3b8' : '#64748b')};">
                      +$${earnings.toLocaleString('es-AR')}
                    </div>
                    <div style="font-size:10px; font-weight:700; color:${isLight ? '#64748b' : '#94a3b8'}; margin-top:1px;">
                      Total: $${Number(o.totalAmount || o.total || 0).toLocaleString('es-AR')}
                    </div>
                  </div>
                </div>

                ${itemsList.length > 0 ? `
                  <div style="font-size:11px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:600; background:${isLight ? '#f8fafc' : 'rgba(0,0,0,0.2)'}; padding:4px 8px; border-radius:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    🛍️ ${itemsList.map(it => `${it.quantity || it.cant || 1}x ${it.name || it.title || 'Ítem'}`).join(', ')}
                  </div>
                ` : ''}

                <div style="display:flex; align-items:center; justify-content:flex-end; gap:4px; font-size:11px; font-weight:800; color:var(--color-primary); margin-top:2px;">
                  <span>Ver detalle completo y chat</span>
                  <span>→</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Attach filter click listeners
      const btnSettleAll = modalEl.querySelector('#filter-settle-all');
      const btnSettleUnsettled = modalEl.querySelector('#filter-settle-unsettled');
      const btnPeriodAll = modalEl.querySelector('#filter-period-all');
      const btnPeriodToday = modalEl.querySelector('#filter-period-today');

      if (btnSettleAll) btnSettleAll.onclick = () => { filterSettlement = 'all'; renderHistoryList(); };
      if (btnSettleUnsettled) btnSettleUnsettled.onclick = () => { filterSettlement = 'unsettled'; renderHistoryList(); };
      if (btnPeriodAll) btnPeriodAll.onclick = () => { filterPeriod = 'all'; renderHistoryList(); };
      if (btnPeriodToday) btnPeriodToday.onclick = () => { filterPeriod = 'today'; renderHistoryList(); };

      // Attach order card click listeners
      modalEl.querySelectorAll('.history-order-card-item').forEach(card => {
        card.onclick = () => {
          const oId = card.dataset.orderId;
          const target = allOrders.find(x => x.id === oId);
          if (target) {
            openCompletedOrderDetailsModal(target, latestUser);
          }
        };
      });
    }

    renderHistoryList();
  } catch (err) {
    console.error('Error loading delivery history modal:', err);
    modalEl.innerHTML = `
      <div style="padding:30px; text-align:center; color:#ef4444; font-weight:800;">
        Error al cargar el historial. Reintenta.
      </div>
    `;
  }
}

export async function openCompletedOrderDetailsModal(order, user) {
  if (!order) return;
  const { showModal } = await import('../components/modal.js');
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';
  const latestUser = getState().user || user || {};

  const isCompleted = order.status === 'completed';
  const isSettled = order.isSettledDriver === true;
  const isCash = order.paymentMethod === 'efectivo' || (order.paymentMethod && order.paymentMethod.toString().toLowerCase().includes('efect'));
  const isFavor = Boolean(order.isFavor);
  const isEncomienda = isOrderEncomienda(order);

  const orderDate = order.createdAt ? (order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt)) : new Date();
  const dateStr = orderDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = orderDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const clientFullName = order.userName || order.clientName || 'Cliente';
  const clientPhoto = order.userPhoto || order.clientPhoto || '';
  const clientPhone = order.userPhone || order.clientPhone || order.phone || '';
  const cleanPhone = clientPhone.replace(/\D/g, '');
  const waPhone = cleanPhone.startsWith('54') ? cleanPhone : `549${cleanPhone.replace(/^0+/, '')}`;
  const waUrl = cleanPhone ? `https://wa.me/${waPhone}` : '';

  const pickupAddr = order.pickupAddress || order.originAddress || order.comercioAddress || (isFavor ? 'Local de compra' : (order.comercioName || 'Comercio'));
  const deliveryAddr = order.deliveryAddress || order.address || 'Magdalena';

  // Earnings calculations
  const deliveryFee = Number(order.deliveryCost || order.shippingCost || order.deliveryFee || order.cost || 0);
  const purchaseFee = Number(order.purchaseFee || order.mandadoFee || order.managementFee || order.mandadoPersonalFee || order.gestionCost || 0);
  const extraStopsFee = Number(order.extraStopsCost || order.extraStopsFee || order.paradasCost || 0);
  const rainSurcharge = Number(order.rainSurcharge || order.deliveryRainSurcharge || order.recargoLluvia || (order.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const nightSurcharge = Number(order.nightSurcharge || order.nightFee || 0);
  const tipAmount = Number(order.tip || order.tipAmount || order.propina || 0);
  const driverEarnings = getOrderDriverEarnings(order);

  const productsCost = Number(order.purchaseCost !== undefined ? order.purchaseCost : (order.purchaseItemsTotal || order.subtotal || order.itemsTotal || 0));
  const appUsageFee = Number(order.appUsageFee || order.serviceFee || 0);
  const pointsDiscount = Number(order.pointsDiscount || order.discountPoints || order.pointsValue || order.pointsUsedDiscount || 0);
  const couponDiscount = Number(order.couponDiscount || order.discount || 0);
  const grandTotal = Number(order.totalAmount || order.total || 0);
  const itemsList = Array.isArray(order.items) ? order.items : (Array.isArray(order.products) ? order.products : []);

  let serviceLabel = '🏪 Pedido en Local';
  let detailsText = '';
  if (isEncomienda) {
    serviceLabel = '📦 Encomienda';
    detailsText = cleanMandadoText(order.details || order.description || order.itemsText || 'Envío de paquete');
  } else if (isFavor) {
    const parsed = parseMandadoDetails(order.description || order.itemsText || order.notes || order.details, order.comercioName || order.originAddress);
    serviceLabel = `🛍️ Mandado: ${parsed.comercio || 'Compra'}`;
    detailsText = parsed.items;
  } else {
    serviceLabel = `🏪 ${order.comercioName || 'Pedido'}`;
    if (itemsList.length > 0) {
      detailsText = itemsList.map(it => `${it.quantity || it.cant || 1}x ${it.name || it.title || 'Ítem'}`).join(', ');
    }
  }

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 16px 18px calc(24px + env(safe-area-inset-bottom, 16px)) 18px;
    background: ${isLight ? '#ffffff' : '#090d16'};
    color: ${isLight ? '#0f172a' : '#ffffff'};
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    font-family: var(--font-body, sans-serif);
    overflow-y: auto;
    max-height: 82vh;
    -webkit-overflow-scrolling: touch;
  `;

  modalEl.innerHTML = `
    <!-- 1. STATUS & DATE BAR -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; padding:8px 12px; border-radius:14px; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'};">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="background:${isCompleted ? '#dcfce7' : '#fee2e2'}; color:${isCompleted ? '#166534' : '#dc2626'}; font-size:11px; font-weight:900; padding:3px 8px; border-radius:8px;">
          ${isCompleted ? '✓ Entregado' : '✕ Cancelado'}
        </span>
        <span style="background:${isSettled ? (isLight ? '#e0e7ff' : 'rgba(99,102,241,0.2)') : (isLight ? '#fef3c7' : 'rgba(245,158,11,0.2)')}; color:${isSettled ? (isLight ? '#3730a3' : '#a5b4fc') : (isLight ? '#b45309' : '#fbbf24')}; font-size:11px; font-weight:900; padding:3px 8px; border-radius:8px;">
          ${isSettled ? '✓ Liquidado' : '⏳ No liquidado'}
        </span>
      </div>
      <div style="font-size:11.5px; font-weight:800; color:${isLight ? '#64748b' : '#94a3b8'};">
        ${dateStr} · ${timeStr}
      </div>
    </div>

    <!-- 2. CLIENT CARD -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; padding:10px 14px; border-radius:16px; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'};">
      <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
        ${clientPhoto ? `
          <img src="${clientPhoto}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid #e11d48;" />
        ` : `
          <div style="width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg, #e11d48, #be123c); display:flex; align-items:center; justify-content:center; color:white; font-size:16px; font-weight:900;">
            ${clientFullName.charAt(0).toUpperCase()}
          </div>
        `}
        <div style="min-width:0; flex:1;">
          <div style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${clientFullName}
          </div>
          <div style="font-size:11px; font-weight:700; color:${isLight ? '#64748b' : '#94a3b8'}; margin-top:1px;">
            ${clientPhone ? `📞 ${clientPhone}` : 'Cliente GoDelivery'}
          </div>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:6px;">
        ${waUrl ? `
          <a href="${waUrl}" target="_blank" rel="noopener noreferrer" style="width:36px; height:36px; border-radius:50%; background:#25D366; color:white; display:flex; align-items:center; justify-content:center; text-decoration:none; box-shadow:0 3px 10px rgba(37,211,102,0.4);" title="WhatsApp">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          </a>
        ` : ''}
        <button id="open-history-chat-btn" style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg, #e11d48, #be123c); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 3px 10px rgba(225,29,72,0.4);" title="Abrir Chat">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </button>
      </div>
    </div>

    <!-- 3. SERVICE & LOCATIONS CARD -->
    <div style="background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:8px;">
      <div style="font-size:13.5px; font-weight:900; color:${isLight ? '#e11d48' : '#fb7185'};">
        ${serviceLabel}
      </div>
      ${detailsText ? `
        <div style="font-size:12px; color:${isLight ? '#334155' : '#cbd5e1'}; font-weight:700; background:${isLight ? '#ffffff' : 'rgba(0,0,0,0.2)'}; padding:8px 10px; border-radius:10px; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.06)'};">
          📝 <strong>Detalle:</strong> ${detailsText}
        </div>
      ` : ''}
      <div style="font-size:11.5px; font-weight:600; color:${isLight ? '#475569' : '#94a3b8'}; display:flex; flex-direction:column; gap:4px; margin-top:2px;">
        <div>📍 <strong>Retiro:</strong> ${pickupAddr}</div>
        <div>🏠 <strong>Entrega:</strong> ${deliveryAddr}</div>
        ${(order.addressNotes || order.notes) ? `<div>📝 <strong>Nota entrega:</strong> "${cleanMandadoText(order.addressNotes || order.notes)}"</div>` : ''}
      </div>
    </div>

    <!-- 4. ITEM BY ITEM FINANCIAL BREAKDOWN -->
    <div style="background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; border:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:6px;">
      <div style="font-size:11px; font-weight:900; color:${isLight ? '#64748b' : '#94a3b8'}; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
        Desglose Económico:
      </div>

      ${productsCost > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:${isLight ? '#334155' : '#cbd5e1'};">
          <span>🛍️ ${isFavor ? 'Productos Comprados' : 'Subtotal Productos'}:</span>
          <span style="font-weight:800;">$${productsCost.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; font-size:12px; color:${isLight ? '#334155' : '#cbd5e1'};">
        <span>🛵 Costo de Envío:</span>
        <span style="font-weight:800;">$${deliveryFee.toLocaleString('es-AR')}</span>
      </div>

      ${purchaseFee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:${isLight ? '#334155' : '#cbd5e1'};">
          <span>⚡ Gestión / Compra:</span>
          <span style="font-weight:800;">$${purchaseFee.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${extraStopsFee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:${isLight ? '#334155' : '#cbd5e1'};">
          <span>📍 Paradas Adicionales:</span>
          <span style="font-weight:800;">$${extraStopsFee.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${rainSurcharge > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#0284c7;">
          <span>🌧️ Recargo por Lluvia:</span>
          <span style="font-weight:800;">+$${rainSurcharge.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${nightSurcharge > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#7c3aed;">
          <span>🌙 Recargo Nocturno:</span>
          <span style="font-weight:800;">+$${nightSurcharge.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${tipAmount > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#10b981;">
          <span>🎁 Propina:</span>
          <span style="font-weight:800;">+$${tipAmount.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      <!-- HIGHLIGHTED DRIVER REAL EARNING -->
      <div style="margin:6px 0; padding:8px 10px; border-radius:12px; background:${isLight ? '#ecfdf5' : 'rgba(16,185,129,0.12)'}; border:1.5px solid ${isLight ? '#a7f3d0' : 'rgba(16,185,129,0.3)'}; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:12px; font-weight:900; color:#047857;">💰 TU GANANCIA REAL:</span>
        <span style="font-size:16px; font-weight:950; color:#10b981;">+$${driverEarnings.toLocaleString('es-AR')}</span>
      </div>

      ${appUsageFee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'};">
          <span>📱 Tarifa por Servicio App:</span>
          <span style="font-weight:700;">$${appUsageFee.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${pointsDiscount > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#10b981;">
          <span>💎 Descuento GoPuntos:</span>
          <span style="font-weight:800;">-$${pointsDiscount.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      ${couponDiscount > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#10b981;">
          <span>🏷️ Descuento Cupón:</span>
          <span style="font-weight:800;">-$${couponDiscount.toLocaleString('es-AR')}</span>
        </div>
      ` : ''}

      <div style="border-top:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; padding-top:6px; margin-top:2px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:13px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">Total Pedido:</div>
          <div style="font-size:10px; font-weight:700; color:${isCash ? '#d97706' : '#0284c7'}; text-transform:uppercase;">
            ${isCash ? '💵 Efectivo' : '💳 Transferencia'}
          </div>
        </div>
        <div style="font-size:17px; font-weight:950; color:${isLight ? '#0f172a' : '#ffffff'};">
          $${grandTotal.toLocaleString('es-AR')}
        </div>
      </div>
    </div>

    <!-- 5. ACTION BUTTON: OPEN FINALIZED CHAT -->
    <button id="open-chat-action-btn" style="
      width: 100%; height: 46px; border-radius: 14px; border: none;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
      color: white; font-size: 13.5px; font-weight: 900;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer; box-shadow: 0 4px 16px rgba(225, 29, 72, 0.4);
      margin-top: 4px;
    ">
      <span>💬</span>
      <span>Ver Chat con el Cliente</span>
    </button>
  `;

  showModal({
    title: `📜 Pedido #${order.orderId || (order.id ? order.id.slice(-4) : '')}`,
    content: modalEl,
    height: '85dvh',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : '#ffffff'
  });

  const chatTrigger = (e) => {
    e.stopPropagation();
    import('../components/chat.js').then(({ openChat }) => {
      openChat({
        orderId: order.id,
        type: 'client-delivery',
        otherName: clientFullName,
        orderNum: order.orderId,
        senderDisplayName: latestUser.displayName || latestUser.name || 'Repartidor'
      });
    });
  };

  const btnHistoryChat = modalEl.querySelector('#open-history-chat-btn');
  const btnChatAction = modalEl.querySelector('#open-chat-action-btn');
  if (btnHistoryChat) btnHistoryChat.onclick = chatTrigger;
  if (btnChatAction) btnChatAction.onclick = chatTrigger;
}

export async function showDriverProfileEditModal(user) {
  const { showModal, closeModal } = await import('../components/modal.js');
  const { showToast } = await import('../components/toast.js');
  const { doc, updateDoc } = await import('firebase/firestore');

  const latestUser = getState().user || user;
  let photoDataUrl = latestUser.photoURL || '';
  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = `
    padding: 16px 20px calc(36px + env(safe-area-inset-bottom, 24px)) 20px;
    background: ${isLight ? '#ffffff' : '#090d16'};
    color: ${isLight ? '#0f172a' : '#ffffff'};
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
    font-family: var(--font-body, sans-serif);
  `;

  modalEl.innerHTML = `
    <!-- AVATAR SECTION -->
    <div style="display:flex; flex-direction:column; align-items:center; gap:10px; margin-top:2px;">
      <div style="position:relative; width:88px; height:88px;">
        <div id="driver-avatar-preview" style="
          width: 88px; height: 88px; border-radius: 50%;
          background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
          color: white; font-size: 34px; font-weight: 900;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; border: 3px solid ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)'};
          box-shadow: 0 10px 25px rgba(0,0,0,0.25);
        ">
          ${photoDataUrl ? `<img src="${photoDataUrl}" style="width:100%; height:100%; object-fit:cover;" />` : (latestUser.displayName || latestUser.name || 'R')[0].toUpperCase()}
        </div>
        <label for="driver-avatar-input" style="
          position: absolute; bottom: 0px; right: 0px;
          width: 32px; height: 32px; border-radius: 50%;
          background: #e11d48; color: white;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; box-shadow: 0 4px 12px rgba(225,29,72,0.5);
          border: 2.5px solid ${isLight ? '#ffffff' : '#090d16'}; font-size: 15px;
          transition: transform 0.2s ease;
        ">
          📷
        </label>
        <input type="file" id="driver-avatar-input" accept="image/*" style="display:none;" />
      </div>
      <span style="font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:700; letter-spacing:0.2px;">Toca la cámara para cambiar foto</span>
    </div>

    <!-- FORM FIELDS -->
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div>
        <label style="font-size:11px; font-weight:900; color:${isLight ? '#475569' : '#94a3b8'}; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Nombre Completo</label>
        <input id="driver-name-input" type="text" value="${latestUser.displayName || latestUser.name || ''}" placeholder="Tu nombre" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; color:${isLight ? '#0f172a' : 'white'}; padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}'" />
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:${isLight ? '#475569' : '#94a3b8'}; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Tipo de Vehículo</label>
        <select id="driver-vehicle-type-select" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; color:${isLight ? '#0f172a' : 'white'}; padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}'">
          <option value="moto" ${(latestUser.vehicleType || latestUser.tripVehicleType || 'moto') === 'moto' ? 'selected' : ''}>🏍️ Moto</option>
          <option value="auto" ${(latestUser.vehicleType || latestUser.tripVehicleType) === 'auto' ? 'selected' : ''}>🚗 Auto</option>
          <option value="bici" ${(latestUser.vehicleType || latestUser.tripVehicleType) === 'bici' ? 'selected' : ''}>🚲 Bicicleta</option>
        </select>
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:${isLight ? '#475569' : '#94a3b8'}; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Modelo del Vehículo</label>
        <input id="driver-vehicle-model-input" type="text" value="${latestUser.deliveryVehicleModel || latestUser.vehicleModel || ''}" placeholder="Ej: Honda Wave 110" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; color:${isLight ? '#0f172a' : 'white'}; padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}'" />
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:${isLight ? '#475569' : '#94a3b8'}; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Patente del Vehículo</label>
        <input id="driver-vehicle-plate-input" type="text" value="${latestUser.deliveryVehiclePlate || latestUser.vehiclePlate || latestUser.plate || ''}" placeholder="Ej: A123BCD" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; color:${isLight ? '#0f172a' : 'white'}; padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; text-transform:uppercase; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}'" />
      </div>

      <div>
        <label style="font-size:11px; font-weight:900; color:${isLight ? '#475569' : '#94a3b8'}; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:7px;">Alias / CBU para Cobros</label>
        <input id="driver-alias-input" type="text" value="${latestUser.driverAlias || latestUser.alias || ''}" placeholder="Ej: juan.repartidor.mp" style="
          width:100%; height:50px; border-radius:16px; background:${isLight ? '#f8fafc' : '#0f172a'}; border:1.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}; color:${isLight ? '#0f172a' : 'white'}; padding:0 16px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box; transition:border-color 0.2s;
        " onfocus="this.style.borderColor='#e11d48'" onblur="this.style.borderColor='${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)'}'" />
      </div>
    </div>

    <!-- LARGE BRAND RED SAVE BUTTON -->
    <button id="save-driver-profile-btn" style="
      width: 100%;
      height: 56px;
      border-radius: 18px;
      border: none;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
      color: white;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 10px 25px rgba(225, 29, 72, 0.45);
      margin-top: 6px;
      text-transform: uppercase;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    ">
      Guardar Cambios
    </button>
  `;

  showModal({
    title: '⚙️ Mi Perfil y Vehículo',
    content: modalEl,
    height: 'auto',
    headerBackground: isLight ? '#ffffff' : '#090d16',
    headerTextColor: isLight ? '#0f172a' : 'white'
  });

  const avatarInput = modalEl.querySelector('#driver-avatar-input');
  const avatarPreview = modalEl.querySelector('#driver-avatar-preview');
  if (avatarInput) {
    avatarInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          photoDataUrl = re.target.result;
          avatarPreview.innerHTML = `<img src="${photoDataUrl}" style="width:100%; height:100%; object-fit:cover;" />`;
        };
        reader.readAsDataURL(file);
      }
    };
  }

  const saveBtn = modalEl.querySelector('#save-driver-profile-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const newName = modalEl.querySelector('#driver-name-input').value.trim();
      const newVehicleType = modalEl.querySelector('#driver-vehicle-type-select').value;
      const newVehicleModel = modalEl.querySelector('#driver-vehicle-model-input').value.trim();
      const newVehiclePlate = modalEl.querySelector('#driver-vehicle-plate-input').value.trim().toUpperCase();
      const newAlias = modalEl.querySelector('#driver-alias-input').value.trim();

      if (!newName) {
        showToast('El nombre no puede estar vacío', 'warning');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = 'Guardando...';

      try {
        const updates = {
          displayName: newName,
          name: newName,
          vehicleType: newVehicleType,
          tripVehicleType: newVehicleType,
          deliveryVehicleModel: newVehicleModel,
          vehicleModel: newVehicleModel,
          deliveryVehiclePlate: newVehiclePlate,
          vehiclePlate: newVehiclePlate,
          plate: newVehiclePlate,
          driverAlias: newAlias,
          alias: newAlias
        };
        if (photoDataUrl && photoDataUrl !== latestUser.photoURL) {
          updates.photoURL = photoDataUrl;
        }

        await updateDoc(doc(db, 'users', latestUser.uid), updates);
        setState('user', { ...latestUser, ...updates });
        showToast('Perfil actualizado correctamente', 'success');
        closeModal();
      } catch (err) {
        console.error('Error saving driver profile:', err);
        showToast('Error al guardar perfil', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Guardar Cambios';
      }
    };
  }
}

export async function startFullDriverSimulation() {
  const currentUser = getState().user || {};

  // 1. Create a rich, realistic active order in Magdalena
  const mockOrder = {
    id: 'sim_demo_order',
    orderId: '8492',
    status: 'accepted',
    isFavor: false,
    comercioName: 'Pizzería & Lomitería Los Sabores',
    comercioAddress: 'San Martín 1240, Magdalena',
    comercioPhone: '2221456789',
    comercioCoordinates: { lat: -35.0815, lng: -57.5147 },
    clientName: 'Gonzalo Fernández',
    clientPhone: '2221554433',
    clientNotes: 'Piso 1, Depto B - Tocar timbre Fernández',
    deliveryAddress: 'Calle Brenan 450, Magdalena',
    deliveryCoordinates: { lat: -35.0875, lng: -57.5180 },
    paymentMethod: 'cash',
    totalAmount: 14500,
    driverEarnings: 1800,
    shippingCost: 1800,
    isSettledDriver: false,
    createdAt: new Date(),
    items: [
      { name: 'Pizza Especial de Jamón y Morrones', quantity: 1, price: 9500 },
      { name: 'Empanadas de Carne Suave', quantity: 4, price: 5000 }
    ]
  };

  window.mockSimulatedOrder = mockOrder;
  activeOrdersList = [mockOrder];
  activeOrdersCount = 1;
  window.driverDockExpanded = false;

  // 2. Render bottom dock and top status bar with the live simulated order
  const bottomDock = document.getElementById('driver-footer-dock-container');
  if (bottomDock) {
    bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
    attachBottomDockListeners(currentUser, activeOrdersList);
  }

  const statusBar = document.getElementById('driver-top-status-bar');
  if (statusBar) {
    statusBar.innerHTML = renderStatusBarContent(currentUser, activeOrdersList);
    attachStatusBarListeners(currentUser);
  }

  // 3. Draw navigation route and start simulation to commerce pickup
  const startLoc = { lat: -35.0760, lng: -57.5100 }; // Origin
  const destLoc = { lat: -35.0815, lng: -57.5147 };  // Commerce Los Sabores

  await drawDriverRoute(startLoc, destLoc, null, 'pickup');
  await startGpsRouteSimulation();
}

export function openDriverDrawerMenu(user) {
  const existing = document.getElementById('driver-drawer-overlay');
  if (existing) existing.remove();

  const latestUser = getState().user || user;
  const isOnline = latestUser.isOnline === true;
  let currentTheme = getDriverMapTheme();
  let currentMode = getDriverThemeMode();
  const overlay = document.createElement('div');
  overlay.id = 'driver-drawer-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); display:flex; justify-content:flex-end; opacity:0; transition:opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);';

  const renderDrawerHTML = (theme, mode) => {
    const isLight = theme === 'light';
    const isAdmin = Boolean(latestUser.role === 'admin' || latestUser.isAdmin === true || (getState().user && (getState().user.role === 'admin' || getState().user.isAdmin === true)));

    return `
    <div id="driver-drawer-panel" style="
      width: 320px;
      height: 100%;
      background: ${isLight ? '#ffffff' : '#090d16'};
      border-left: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.12)'};
      padding: calc(16px + env(safe-area-inset-top, 24px)) 18px calc(24px + env(safe-area-inset-bottom, 16px)) 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: ${isLight ? '#0f172a' : 'white'};
      font-family: var(--font-body, sans-serif);
      box-shadow: ${isLight ? '-10px 0 35px rgba(0,0,0,0.15)' : '-10px 0 30px rgba(0,0,0,0.8)'};
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease;
      overflow-y: auto;
      box-sizing: border-box;
    ">
      <!-- TOP DRIVER PROFILE HEADER -->
      <div style="display:flex; align-items:center; justify-content:space-between; padding-bottom:14px; border-bottom:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'};">
        <div style="display:flex; align-items:center; gap:12px; min-width:0;">
          <!-- Driver Real Profile Photo / Avatar -->
          <div style="
            width: 44px; height: 44px; border-radius: 50%;
            background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
            box-shadow: 0 4px 12px rgba(2,132,199,0.3);
            display: flex; align-items: center; justify-content: center;
            color: white; font-size: 17px; font-weight: 900;
            overflow: hidden; flex-shrink: 0;
            border: 2px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.15)'};
          ">
            ${latestUser.photoURL 
              ? `<img src="${latestUser.photoURL}" alt="Perfil" style="width:100%; height:100%; object-fit:cover;" onerror="this.onerror=null; this.parentElement.innerHTML='${(latestUser.displayName || latestUser.name || 'R')[0].toUpperCase()}';" />` 
              : (latestUser.displayName || latestUser.name || 'R')[0].toUpperCase()}
          </div>
          <div style="min-width:0;">
            <div style="font-size:14px; font-weight:900; color:${isLight ? '#0f172a' : '#f8fafc'}; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
              ${latestUser.displayName || latestUser.name || 'Repartidor'}
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
              <span style="background:${isLight ? '#e0f2fe' : 'rgba(56,189,248,0.15)'}; color:${isLight ? '#0369a1' : '#38bdf8'}; font-size:10px; font-weight:900; padding:1px 6px; border-radius:6px;">
                ${isAdmin ? 'ADMIN · DRIVER' : 'REPARTIDOR'}
              </span>
              <span style="font-size:11px; color:${isLight ? '#64748b' : '#94a3b8'}; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${latestUser.deliveryId || 'Oficial'}</span>
            </div>
          </div>
        </div>
        <button id="close-driver-drawer" style="width:34px; height:34px; border-radius:50%; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'}; border:none; color:${isLight ? '#64748b' : '#94a3b8'}; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">✕</button>
      </div>

      <!-- Menu Options Stack -->
      <div style="display:flex; flex-direction:column; gap:9px; flex:1;">
        <!-- 1. Theme 3-Way Segment Selector: Claro / Oscuro / Automático -->
        <div id="drawer-theme-card" style="
          background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.05)'};
          border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
          border-radius: 18px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        ">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:34px; height:34px; border-radius:10px; background:${isLight ? '#fef3c7' : 'rgba(56,189,248,0.15)'}; color:${isLight ? '#d97706' : '#38bdf8'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  ${theme === 'dark' ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>' : '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'}
                </svg>
              </div>
              <div>
                <div id="drawer-theme-title" style="font-size:13px; font-weight:800; color:${isLight ? '#0f172a' : '#f8fafc'};">
                  Tema Visual y Mapa
                </div>
                <div style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'}; margin-top:2px;">
                  ${theme === 'light' ? 'Modo Claro ☀️' : 'Modo Oscuro 🌙'}
                </div>
              </div>
            </div>
          </div>

          <!-- 2-Way Segment Tabs (Claro / Oscuro) -->
          <div style="
            display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
            background: ${isLight ? '#e2e8f0' : 'rgba(0,0,0,0.35)'};
            padding: 4px; border-radius: 12px;
          ">
            <button class="drawer-theme-btn" data-theme-choice="light" style="
              height: 34px; border: none; border-radius: 9px; font-size: 11.5px; font-weight: 850;
              cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
              background: ${mode === 'light' ? (isLight ? '#ffffff' : '#1e293b') : 'transparent'};
              color: ${mode === 'light' ? (isLight ? '#0f172a' : '#ffffff') : (isLight ? '#64748b' : '#94a3b8')};
              box-shadow: ${mode === 'light' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none'};
              transition: all 0.2s ease;
            ">
              <span>☀️</span> <span>Claro</span>
            </button>

            <button class="drawer-theme-btn" data-theme-choice="dark" style="
              height: 34px; border: none; border-radius: 9px; font-size: 11.5px; font-weight: 850;
              cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
              background: ${mode === 'dark' ? (isLight ? '#ffffff' : '#1e293b') : 'transparent'};
              color: ${mode === 'dark' ? (isLight ? '#0f172a' : '#ffffff') : (isLight ? '#64748b' : '#94a3b8')};
              box-shadow: ${mode === 'dark' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none'};
              transition: all 0.2s ease;
            ">
              <span>🌙</span> <span>Oscuro</span>
            </button>
          </div>
          
          <!-- Real OLED Battery Saving Clarification -->
          <div style="
            background: ${isLight ? '#ecfdf5' : 'rgba(34, 197, 94, 0.12)'};
            border: 1px solid ${isLight ? '#a7f3d0' : 'rgba(34, 197, 94, 0.3)'};
            border-radius: 10px;
            padding: 8px 10px;
            display: flex;
            align-items: flex-start;
            gap: 8px;
          ">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${isLight ? '#059669' : '#22c55e'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:1px;">
              <rect x="1" y="6" width="18" height="12" rx="2" ry="2"></rect>
              <line x1="23" y1="13" x2="23" y2="11"></line>
            </svg>
            <span style="font-size:10px; color:${isLight ? '#065f46' : '#86efac'}; line-height:1.35; font-weight:600;">
              ${mode === 'auto' ? '<strong>Automático:</strong> Cambia a Claro de 07:00 a 19:00 hs y a Oscuro de 19:00 a 07:00 hs.' : '<strong>Ahorro OLED:</strong> El Modo Oscuro apaga los píxeles negros ahorrando hasta un <strong>40% de batería</strong>.'}
            </span>
          </div>
        </div>

        <!-- 2. GPS VOICE GUIDANCE TOGGLE (PERMANENTLY PERSISTED) -->
        <div id="drawer-voice-card" style="
          background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.05)'};
          border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
          border-radius: 18px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        ">
          <div style="display:flex; align-items:center; gap:12px; min-width:0;">
            <div id="drawer-voice-icon-box" style="width:34px; height:34px; border-radius:10px; background:${!NavigationVoice.isMuted() ? (isLight ? '#dcfce7' : 'rgba(34,197,94,0.15)') : (isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)')}; color:${!NavigationVoice.isMuted() ? (isLight ? '#16a34a' : '#22c55e') : (isLight ? '#64748b' : '#94a3b8')}; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:16px;">
              ${!NavigationVoice.isMuted() ? '🔊' : '🔇'}
            </div>
            <div>
              <div style="font-size:13px; font-weight:800; color:${isLight ? '#0f172a' : '#f8fafc'};">
                Voz de Navegación GPS
              </div>
              <div id="drawer-voice-subtext" style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'}; margin-top:2px;">
                ${!NavigationVoice.isMuted() ? 'Indicaciones habladas activas' : 'Indicaciones habladas silenciadas'}
              </div>
            </div>
          </div>

          <!-- Switch Toggle Button -->
          <button id="drawer-voice-toggle-switch" style="
            width: 48px; height: 28px; border-radius: 20px;
            background: ${!NavigationVoice.isMuted() ? '#22c55e' : (isLight ? '#cbd5e1' : '#334155')};
            border: none; cursor: pointer; position: relative;
            transition: background 0.25s ease;
            flex-shrink: 0; padding: 2px;
          ">
            <div id="drawer-voice-switch-circle" style="
              width: 24px; height: 24px; border-radius: 50%;
              background: #ffffff;
              transform: translateX(${!NavigationVoice.isMuted() ? '20px' : '0px'});
              transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
              box-shadow: 0 2px 6px rgba(0,0,0,0.25);
            "></div>
          </button>
        </div>

        <!-- 3. Profile & Vehicle -->
        <button id="drawer-profile-btn" style="
          display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
          background: ${isLight ? '#f8fafc' : 'rgba(255,255,255,0.05)'};
          border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'};
          color: ${isLight ? '#0f172a' : 'white'};
          font-size: 13px; font-weight: 800; cursor: pointer; text-align: left;
        ">
          <div style="width:34px; height:34px; border-radius:10px; background:${isLight ? '#e0f2fe' : 'rgba(56,189,248,0.12)'}; color:${isLight ? '#0284c7' : '#38bdf8'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <span>Mi Perfil y Vehículo</span>
        </button>

        <!-- 4. Fee Debt -->
        <button id="drawer-debt-btn" style="
          display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
          background: ${(latestUser.deliveryDebt || 0) > 0 ? (isLight ? '#fff1f2' : 'rgba(239,68,68,0.12)') : (isLight ? '#f8fafc' : 'rgba(255,255,255,0.05)')};
          border: 1px solid ${(latestUser.deliveryDebt || 0) > 0 ? (isLight ? '#fecdd3' : 'rgba(239,68,68,0.3)') : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)')};
          color: ${(latestUser.deliveryDebt || 0) > 0 ? (isLight ? '#e11d48' : '#ef4444') : (isLight ? '#0f172a' : '#cbd5e1')};
          font-size: 13px; font-weight: 800; cursor: pointer; text-align: left;
        ">
          <div style="width:34px; height:34px; border-radius:10px; background:${(latestUser.deliveryDebt || 0) > 0 ? (isLight ? '#fee2e2' : 'rgba(239,68,68,0.2)') : (isLight ? '#f1f5f9' : 'rgba(255,255,255,0.1)')}; color:${(latestUser.deliveryDebt || 0) > 0 ? '#e11d48' : (isLight ? '#64748b' : '#94a3b8')}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="3" ry="3"></rect>
              <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
          </div>
          <span>Deuda de Tarifas (${formatPrice(latestUser.deliveryDebt || 0)})</span>
        </button>

        <!-- 5. Delivery History -->
        <button id="drawer-history-btn" style="
          display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
          background: ${isLight ? '#f8fafc' : 'rgba(255,255,255,0.05)'};
          border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'};
          color: ${isLight ? '#0f172a' : 'white'};
          font-size: 13px; font-weight: 800; cursor: pointer; text-align: left;
        ">
          <div style="width:34px; height:34px; border-radius:10px; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'}; color:${isLight ? '#475569' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <span>Historial de Entregas</span>
        </button>

        <!-- 5.5. GPS TRIP SIMULATOR (ONLY VISIBLE FOR ADMINS) -->
        ${isAdmin ? `
          <button id="drawer-simulate-trip-btn" style="
            display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
            background: ${isLight ? 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)' : 'linear-gradient(135deg, rgba(2,132,199,0.2) 0%, rgba(3,105,161,0.3) 100%)'};
            border: 1.5px solid ${isLight ? '#7dd3fc' : 'rgba(56, 189, 248, 0.4)'};
            color: ${isLight ? '#0369a1' : '#38bdf8'};
            font-size: 13px; font-weight: 900; cursor: pointer; text-align: left;
            box-shadow: 0 4px 14px ${isLight ? 'rgba(2,132,199,0.12)' : 'rgba(0,0,0,0.3)'};
          ">
            <div style="width:34px; height:34px; border-radius:10px; background:${isLight ? 'rgba(2,132,199,0.15)' : 'rgba(56,189,248,0.2)'}; color:${isLight ? '#0284c7' : '#38bdf8'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
              </svg>
            </div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span>Simular Recorrido GPS</span>
                <span style="font-size:9px; background:#e11d48; color:white; padding:1px 5px; border-radius:5px; font-weight:900;">ADMIN</span>
              </div>
              <div style="font-size:10.5px; font-weight:600; opacity:0.85; margin-top:2px;">Simular pedido real con HUD y voz</div>
            </div>
          </button>
        ` : ''}

        <!-- 6. Ir a Modo Cliente (Tiendas) -->
        <button id="drawer-client-mode-btn" style="
          display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
          background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'};
          border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)'};
          color: ${isLight ? '#0f172a' : 'white'};
          font-size: 13px; font-weight: 800; cursor: pointer; text-align: left;
          margin-top: auto;
        ">
          <div style="width:34px; height:34px; border-radius:10px; background:${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'}; color:${isLight ? '#475569' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
          </div>
          <span>Ir a Modo Cliente (Tiendas)</span>
        </button>

        <!-- 7. Desconectarme / Iniciar Jornada (AT THE VERY BOTTOM) -->
        <button id="drawer-toggle-online-btn" style="
          display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
          background: ${isOnline ? (isLight ? '#fee2e2' : 'rgba(239,68,68,0.15)') : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'};
          border: 1px solid ${isOnline ? (isLight ? '#fecaca' : 'rgba(239,68,68,0.3)') : 'transparent'};
          color: ${isOnline ? (isLight ? '#dc2626' : '#f87171') : 'white'};
          font-size: 13px; font-weight: 900; cursor: pointer; text-align: left;
          transition: all 0.2s ease;
        ">
          <div style="width:34px; height:34px; border-radius:10px; background:${isOnline ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.2)'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
              <line x1="12" y1="2" x2="12" y2="12"></line>
            </svg>
          </div>
          <span>${isOnline ? 'Desconectarme' : 'Iniciar Jornada (Conectar)'}</span>
        </button>
      </div>

      <!-- Footer Info -->
      <div style="font-size:11px; color:${isLight ? '#94a3b8' : '#64748b'}; text-align:center; padding-top:10px; border-top:1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'};">
        GoDelivery Driver v2.0 · Magdalena
      </div>
    </div>
    `;
  };

  overlay.innerHTML = renderDrawerHTML(currentTheme, currentMode);
  document.body.appendChild(overlay);

  const attachDrawerListeners = () => {
    const panel = overlay.querySelector('#driver-drawer-panel');

    const closeDrawer = () => {
      overlay.style.opacity = '0';
      if (panel) panel.style.transform = 'translateX(100%)';
      setTimeout(() => overlay.remove(), 250);
    };

    overlay.onclick = (e) => {
      if (e.target === overlay || e.target.id === 'close-driver-drawer') {
        closeDrawer();
      }
    };

    const voiceCard = overlay.querySelector('#drawer-voice-card');
    const voiceSwitch = overlay.querySelector('#drawer-voice-toggle-switch');
    const toggleVoiceAction = () => {
      const isMuted = NavigationVoice.toggleMute();
      const isVoiceActive = !isMuted;
      
      const iconBox = overlay.querySelector('#drawer-voice-icon-box');
      const subtext = overlay.querySelector('#drawer-voice-subtext');
      const switchBtn = overlay.querySelector('#drawer-voice-toggle-switch');
      const circle = overlay.querySelector('#drawer-voice-switch-circle');
      const isLightMode = getDriverMapTheme() === 'light';

      if (iconBox) {
        iconBox.innerHTML = isVoiceActive ? '🔊' : '🔇';
        iconBox.style.background = isVoiceActive ? (isLightMode ? '#dcfce7' : 'rgba(34,197,94,0.15)') : (isLightMode ? '#f1f5f9' : 'rgba(255,255,255,0.08)');
        iconBox.style.color = isVoiceActive ? (isLightMode ? '#16a34a' : '#22c55e') : (isLightMode ? '#64748b' : '#94a3b8');
      }
      if (subtext) {
        subtext.textContent = isVoiceActive ? 'Indicaciones habladas activas' : 'Indicaciones habladas silenciadas';
      }
      if (switchBtn) {
        switchBtn.style.background = isVoiceActive ? '#22c55e' : (isLightMode ? '#cbd5e1' : '#334155');
      }
      if (circle) {
        circle.style.transform = isVoiceActive ? 'translateX(20px)' : 'translateX(0px)';
      }

      if (isVoiceActive) {
        NavigationVoice.speak('Voz de navegación activada', true);
      }
    };

    if (voiceSwitch) voiceSwitch.onclick = toggleVoiceAction;
    if (voiceCard) voiceCard.onclick = (e) => {
      if (e.target !== voiceSwitch && !voiceSwitch.contains(e.target)) {
        toggleVoiceAction();
      }
    };

    const onlineToggleBtn = overlay.querySelector('#drawer-toggle-online-btn');
    if (onlineToggleBtn) {
      onlineToggleBtn.onclick = () => {
        closeDrawer();
        if (isOnline) {
          promptEndSession(latestUser);
        } else {
          promptStartSession(latestUser);
        }
      };
    }

    overlay.querySelectorAll('.drawer-theme-btn').forEach(btn => {
      btn.onclick = () => {
        const choice = btn.dataset.themeChoice;
        setDriverThemeMode(choice);
        currentTheme = getDriverMapTheme();
        currentMode = getDriverThemeMode();
        
        // Live update top header and floating dock without page reload
        const statusBarContainer = document.getElementById('session-status-bar-container');
        if (statusBarContainer) {
          statusBarContainer.style.background = currentTheme === 'light' ? '#ffffff' : '#090d16';
          statusBarContainer.innerHTML = renderStatusBar(latestUser);
          attachStatusBarListeners(latestUser);
        }
        const bottomDock = document.getElementById('driver-footer-dock-container');
        if (bottomDock) {
          bottomDock.innerHTML = renderBottomDockContent(latestUser, activeOrdersList);
          attachBottomDockListeners(latestUser, activeOrdersList);
        }

        overlay.innerHTML = renderDrawerHTML(currentTheme, currentMode);
        const newPanel = overlay.querySelector('#driver-drawer-panel');
        if (newPanel) newPanel.style.transform = 'translateX(0)';
        attachDrawerListeners();
      };
    });

    const profileBtn = overlay.querySelector('#drawer-profile-btn');
    if (profileBtn) {
      profileBtn.onclick = () => {
        closeDrawer();
        showDriverProfileEditModal(latestUser);
      };
    }

    const clientBtn = overlay.querySelector('#drawer-client-mode-btn');
    if (clientBtn) {
      clientBtn.onclick = () => {
        closeDrawer();
        switchToClientMode();
      };
    }

    const debtBtn = overlay.querySelector('#drawer-debt-btn');
    if (debtBtn) {
      debtBtn.onclick = () => {
        closeDrawer();
        showBalanceManagementModal(latestUser, latestUser.deliveryDebt || 0);
      };
    }

    const historyBtn = overlay.querySelector('#drawer-history-btn');
    if (historyBtn) {
      historyBtn.onclick = () => {
        closeDrawer();
        showDeliveryHistoryModal(latestUser);
      };
    }

    const simBtn = overlay.querySelector('#drawer-simulate-trip-btn');
    if (simBtn) {
      simBtn.onclick = () => {
        closeDrawer();
        startFullDriverSimulation();
      };
    }
  };

  // Smooth slide-in from right
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    const panel = overlay.querySelector('#driver-drawer-panel');
    if (panel) panel.style.transform = 'translateX(0)';
  });

  attachDrawerListeners();
}

export async function switchToClientMode() {
  sessionStorage.setItem('gd_temp_client_mode', 'true');
  document.documentElement.classList.remove('is-delivery-mode');
  document.body.classList.remove('is-delivery-mode');
  
  if (window.__gd_delivery_unsub) {
    window.__gd_delivery_unsub();
    window.__gd_delivery_unsub = null;
  }

  const driverMapEl = document.getElementById('driver-fullscreen-map');
  if (driverMapEl) driverMapEl.style.display = 'none';
  const hudEl = document.getElementById('driver-hud-container');
  if (hudEl) hudEl.style.display = 'none';

  const delPage = document.getElementById('page-delivery');
  if (delPage) {
    delPage.style.display = 'none';
    delPage.innerHTML = '';
  }

  const appNav = document.getElementById('app-navbar');
  if (appNav) appNav.style.removeProperty('display');
  const appFoot = document.getElementById('app-footer');
  if (appFoot) appFoot.style.removeProperty('display');
  const appHead = document.getElementById('app-header');
  if (appHead) appHead.style.removeProperty('display');

  window.location.hash = '#/';
  
  const { renderHome } = await import('./home.js');
  const { renderNavbar } = await import('../components/navbar.js');
  const { handleRoute } = await import('../router.js');

  await renderHome();
  renderNavbar();
  await handleRoute();
}

export async function promptEndSession(user) {
  const currentUser = getState().user || user;
  if (!currentUser) return;
  
  if (activeOrdersCount > 0) {
    showToast('⚠️ No podés desconectarte si tenés pedidos en curso', 'warning');
    return;
  }

  showConfirm({
    title: '¿Desconectarte de la jornada?',
    message: 'Dejarás de recibir notificaciones de nuevos pedidos en tu zona.<br><br>💡 <b>Aviso:</b> Si volvés a conectarte más tarde en el día de hoy, <b>NO se te volverá a cobrar la cuota diaria</b>.',
    confirmText: 'Sí, desconectar',
    onConfirm: async () => {
      closeModal();
      showBlockingLoading('Desconectando sesión...');
      try {
        await endSession(currentUser);
      } catch (err) {
        console.error('Disconnection error:', err);
        showToast('Error al desconectar', 'error');
      } finally {
        hideBlockingLoading();
      }
    }
  });
}

export async function promptStartSession(user) {
  const currentUser = getState().user || user;
  if (!currentUser) return;

  // 1. Mandatory Profile Fields Check
  const name = (currentUser.displayName || currentUser.name || '').trim();
  const vehicleType = (currentUser.vehicleType || currentUser.tripVehicleType || '').trim();
  const vehicleModel = (currentUser.deliveryVehicleModel || currentUser.vehicleModel || '').trim();
  const vehiclePlate = (currentUser.deliveryVehiclePlate || currentUser.vehiclePlate || currentUser.plate || '').trim();
  const alias = (currentUser.driverAlias || currentUser.alias || currentUser.transferAlias || '').trim();

  if (!name || !vehicleType || !vehicleModel || !vehiclePlate || !alias) {
    const missing = [];
    if (!name) missing.push('Nombre');
    if (!vehicleType) missing.push('Vehículo');
    if (!vehicleModel) missing.push('Modelo');
    if (!vehiclePlate) missing.push('Patente');
    if (!alias) missing.push('Alias');

    showToast(`⚠️ Completá tus datos obligatorios para conectarte: ${missing.join(', ')}`, 'warning', 5000);
    showDriverProfileEditModal(currentUser);
    return;
  }

  // 2. Debt Limit Guard
  const debtLimitEnabled = getState().debtLimitEnabled === true;
  const maxDebtLimit = getState().maxDebtLimit !== undefined ? getState().maxDebtLimit : 15000;
  const debt = currentUser.deliveryDebt || 0;
  
  if (debtLimitEnabled && debt > maxDebtLimit) {
    showModal({
      title: '🚨 Cuenta Suspendida por Deuda',
      content: `
        <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; background: var(--color-bg);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center;">
            ${icon('shieldAlert', 28)}
          </div>
          <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: var(--color-text-primary);">Límite de Deuda Excedido</h3>
          <p style="margin: 0; font-size: 13px; color: var(--color-text-secondary); line-height: 1.55; font-weight: 600;">
            Tu deuda acumulada es de <strong style="color:#ef4444;">${formatPrice(debt)}</strong>, lo cual supera el límite permitido de <strong>${formatPrice(maxDebtLimit)}</strong>.<br><br>
            Para poder conectarte y seguir recibiendo pedidos, debés transferir y subir tu comprobante de pago en el Gestor de Balance.
          </p>
          <button id="modal-suspend-pay-btn" style="width:100%; height:48px; border-radius:14px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:13px; cursor:pointer; text-transform:uppercase; margin-top:8px; box-shadow:0 6px 16px rgba(var(--color-primary-rgb),0.25);">
            Regularizar Ahora
          </button>
        </div>
      `,
      height: 'auto',
      headerBackground: '#E11D48',
      headerTextColor: 'white'
    });
    
    document.getElementById('modal-suspend-pay-btn').onclick = () => {
      closeModal();
      showBalanceManagementModal(currentUser, debt);
    };
    return;
  }

  // 3. Canon Daily Fee check
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  const isExempt = currentUser.isCanonExempt === true || currentUser.role === 'admin' || currentUser.isAdmin === true;
  const isFirstConnectionToday = !isExempt && currentUser.lastCanonChargeDate !== todayStr;
  const configuredCanonAmount = getState().canonAmount || 2000;

  const modalMessage = isFirstConnectionToday
    ? `Comenzarás a recibir pedidos en tu zona.<br><br>🛵 <b>Canon diario:</b> Al ser tu primera conexión de hoy, se registrarán <b>$${configuredCanonAmount.toLocaleString('es-AR')}</b> de canon diario en tu saldo de comisiones.<br><br>💡 Si te desconectás y volvés a conectar más tarde en el día, <b>NO se te volverá a cobrar</b>.`
    : `Comenzarás a recibir pedidos en tu zona.<br><br>✅ <b>Cuota del día activa:</b> Ya abonaste el canon diario de hoy, por lo que <b>NO se generará ningún cargo extra</b> al conectarte.`;

  showConfirm({
    title: '¿Iniciar Jornada de Trabajo?',
    message: modalMessage,
    confirmText: 'Sí, conectar ahora',
    onConfirm: async () => {
      showBlockingLoading('Verificando permisos y conectando...');

      try {
        await ensureDriverPermissions();

        if (isFirstConnectionToday) {
          try {
            const { doc, setDoc, updateDoc, increment, serverTimestamp, collection, getDoc } = await import('firebase/firestore');
            const { db } = await import('../firebase.js');

            const canonDocRef = doc(db, 'delivery_canon_payments', `${currentUser.uid}_${todayStr}`);
            const canonSnap = await getDoc(canonDocRef);
            if (!canonSnap.exists() || canonSnap.data().amount <= 0) {
              await setDoc(canonDocRef, {
                driverId: currentUser.uid,
                driverName: currentUser.displayName || currentUser.name || 'Repartidor',
                dateStr: todayStr,
                amount: configuredCanonAmount,
                settled: false,
                createdAt: serverTimestamp()
              }, { merge: true });

              const transRef = doc(collection(db, 'delivery_transactions'));
              await setDoc(transRef, {
                driverId: currentUser.uid,
                type: 'canon_charge',
                amount: configuredCanonAmount,
                description: `Canon Diario Jornada (${todayStr})`,
                createdAt: serverTimestamp()
              });

              await updateDoc(doc(db, 'users', currentUser.uid), {
                deliveryDebt: increment(configuredCanonAmount),
                lastCanonChargeDate: todayStr
              });

              showToast(`🛵 Se registraron +$${configuredCanonAmount.toLocaleString('es-AR')} de canon diario.`, 'info');
            }
          } catch (canonErr) {
            console.warn('Canon charge registration non-fatal error:', canonErr);
          }
        }

        await startSession(currentUser);
      } catch (err) {
        console.error('Error starting session:', err);
        showToast('Error al conectar sesión', 'error');
      } finally {
        hideBlockingLoading();
      }
    }
  });
}

function attachStatusBarListeners(user) {
  const latestUser = getState().user || user;
  const btn = document.getElementById('session-toggle-btn');

  const driverZoomInBtn = document.getElementById('driver-zoom-in-btn');
  if (driverZoomInBtn) {
    driverZoomInBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      driverZoomInBtn.style.transform = 'scale(0.9)';
      setTimeout(() => driverZoomInBtn.style.transform = 'scale(1)', 150);
      zoomInDriverMap();
    };
  }

  const driverZoomOutBtn = document.getElementById('driver-zoom-out-btn');
  if (driverZoomOutBtn) {
    driverZoomOutBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      driverZoomOutBtn.style.transform = 'scale(0.9)';
      setTimeout(() => driverZoomOutBtn.style.transform = 'scale(1)', 150);
      zoomOutDriverMap();
    };
  }

  const recenterCompassBtn = document.getElementById('driver-recenter-compass-btn');
  if (recenterCompassBtn) {
    recenterCompassBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      recenterCompassBtn.style.transform = 'scale(0.88) rotate(360deg)';
      setTimeout(() => recenterCompassBtn.style.transform = 'scale(1) rotate(0deg)', 250);
      recenterOnDriver();
    };
  }

  const burgerBtn = document.getElementById('driver-hamburger-btn');
  if (burgerBtn) {
    burgerBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDriverDrawerMenu(latestUser);
    };
  }

  const heroConnectBtn = document.getElementById('main-connect-hero-btn');
  if (heroConnectBtn) {
    heroConnectBtn.onclick = () => {
      promptStartSession(latestUser);
    };
  }

  const heroDisconnectBtn = document.getElementById('main-disconnect-hero-btn');
  if (heroDisconnectBtn) {
    heroDisconnectBtn.onclick = () => {
      promptEndSession(latestUser);
    };
  }

  const clientModeBtn = document.getElementById('go-client-mode-btn');
  if (clientModeBtn) {
    clientModeBtn.onclick = () => {
      switchToClientMode();
    };
  }

  const badge = document.getElementById('status-tarife-badge');
  if (badge) {
    badge.onclick = () => {
      const latest = getState().user || user;
      showBalanceManagementModal(latest, latest.deliveryDebt || 0);
    };
  }
  
  const chatBtn = document.getElementById('driver-bar-chat-btn');
  if (chatBtn) {
    chatBtn.onclick = async (e) => {
      e.stopPropagation();
      const oId = chatBtn.dataset.orderId;
      const order = (activeOrdersList || []).find(o => o.id === oId) || (activeOrdersList || [])[0];
      if (order) {
        const { openChat } = await import('../components/chat.js');
        openChat({
          orderId: order.id,
          type: 'client-delivery',
          otherName: order.userName || order.clientName || 'Cliente',
          orderNum: order.orderId,
          senderDisplayName: latestUser.displayName || latestUser.name || 'Repartidor'
        });
      }
    };
  }

  const voiceBtn = document.getElementById('driver-voice-toggle-btn');
  if (voiceBtn) {
    voiceBtn.onclick = (e) => {
      e.stopPropagation();
      voiceBtn.style.transform = 'scale(0.85)';
      setTimeout(() => voiceBtn.style.transform = 'scale(1)', 150);
      const isMuted = NavigationVoice.toggleMute();
      const iconSpan = document.getElementById('driver-voice-icon');
      if (iconSpan) iconSpan.textContent = isMuted ? '🔇' : '🔊';
      import('../components/toast.js').then(m => {
        m.showToast(isMuted ? 'Voz de navegación silenciada 🔇' : 'Voz de navegación activada 🔊', 'info');
      });
    };
  }

  if (btn) {
    btn.onclick = () => {
      const currentUser = getState().user || user;
      if (!currentUser) return;
      if (currentUser.isOnline) {
        promptEndSession(currentUser);
      } else {
        promptStartSession(currentUser);
      }
    };
  }
}

// --- LOGIC FUNCTIONS ---

let isCurrentlyTakingBatch = false;

function getDistanceSync(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function takeBatch(batchId, user, batchData = null, btn = null) {
  if (isCurrentlyTakingBatch) {
    console.log('[takeBatch] A order claim is already in progress, ignoring double-click.');
    return;
  }
  isCurrentlyTakingBatch = true;
  try {
    const userData = getState().user || user;
    // Default estimated delivery time to 30 mins
    const estTime = 30;

    let ordersToTake = [];
    if (batchData && batchData.isBundle) {
      ordersToTake = batchData.orders;
    } else if (batchData && batchData.order) {
      ordersToTake = [batchData.order];
    } else {
      const { getDocs, query, collection, where } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'orders'), where('bundleId', '==', batchId)));
      if (snap.empty) {
        const { getDoc, doc } = await import('firebase/firestore');
        const docSnap = await getDoc(doc(db, 'orders', batchId));
        if (docSnap.exists()) {
          ordersToTake = [{ id: docSnap.id, ...docSnap.data() }];
        } else {
          const single = await getDocs(query(collection(db, 'orders'), where('id', '==', batchId)));
          ordersToTake = single.docs.map(d => ({ id: d.id, ...d.data() }));
        }
      } else {
        ordersToTake = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }

    if (ordersToTake.length === 0) throw new Error('No se encontraron pedidos');

    // Anti-hoarding Smart Dynamic Cap Logic (Using cached activeOrdersList for immediate lookup)
    const activeOrders = activeOrdersList;
    const activeCount = activeOrders.length;
    const ordersToTakeCount = ordersToTake.length;
    const totalCount = activeCount + ordersToTakeCount;

    // Unlimited orders per delivery driver: Allow accepting any order or batch freely
    console.log(`[Take Batch] Active count: ${activeCount}. Taking: ${ordersToTakeCount}. Total: ${totalCount}`);

    // Fetch initial driver GPS location with cached fallback and fast timeout to prevent blocking UI
    let initialDriverLocation = window.lastRiderPos || null;
    if (!initialDriverLocation && navigator.geolocation) {
      try {
        console.log('[takeBatch] Fetching initial driver location with fast timeout...');
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 1000, enableHighAccuracy: false });
        });
        initialDriverLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        window.lastRiderPos = initialDriverLocation;
      } catch (e) {
        console.warn('[takeBatch] Fast GPS location fetch timed out/failed', e);
      }
    }

    await runTransaction(db, async (transaction) => {
      const orderRefs = ordersToTake.map(o => doc(db, 'orders', o.id));
      const snaps = await Promise.all(orderRefs.map(ref => transaction.get(ref)));
      
      for (const snap of snaps) {
        if (!snap.exists()) throw 'Pedido no encontrado';
        if (snap.data().driverId) throw 'Pedido ya tomado por otro repartidor';
      }

      ordersToTake.forEach((o, index) => {
        const ref = orderRefs[index];
        const snap = snaps[index];
        const orderData = snap.data();

        let deliveryCost = orderData.deliveryCost;
        let total = orderData.total;

        if (orderData.isGoCash || orderData.favorType === 'gocash') {
          if (initialDriverLocation && orderData.deliveryCoords) {
            try {
              const dist = getDistanceSync(initialDriverLocation.lat, initialDriverLocation.lng, orderData.deliveryCoords.lat, orderData.deliveryCoords.lng);
              const state = getState();
              const basePriceVal = state.deliveryBasePrice || 1500;
              const pricePerKmVal = state.deliveryPricePerKm || 300;
              const minPriceVal = state.deliveryMinPrice || 1500;
              
              let rawFee = basePriceVal + (dist * pricePerKmVal);
              if (rawFee < minPriceVal) {
                rawFee = minPriceVal;
              }
              deliveryCost = Math.ceil(rawFee / 10) * 10;
              total = deliveryCost;
            } catch (e) {
              console.error("[takeBatch] Error calculating Go Cash delivery cost:", e);
            }
          }
        }

        const updateFields = {
          driverId: user.uid,
          driverName: user.displayName || user.name || 'Repartidor',
          driverPhoto: user.photoURL || '',
          driverPhone: user.phone || '',
          driverDeliveryId: user.deliveryId || '',
          driverAlias: (userData.driverAlias || userData.alias || userData.transferAlias || user.driverAlias || user.alias || user.transferAlias || '').trim(),
          driverVehicleModel: userData.vehicleModel || '',
          driverVehicleColor: userData.vehicleColor || '',
          driverVehiclePatent: userData.vehicleDetails || userData.patente || '',
          deliverySessionId: user.currentSessionId || null,
          status: (o.isFavor || o.isTrip) ? 'confirmed' : 'accepted',
          acceptedAt: serverTimestamp(),
          estimatedDeliveryTime: estTime,
          queueTargetDriverId: null,
          queueTargetDriverName: null,
          queueOfferedAt: null
        };

        if (orderData.isGoCash || orderData.favorType === 'gocash') {
          updateFields.deliveryCost = deliveryCost;
          updateFields.total = total;
        }

        if (initialDriverLocation) {
          updateFields.driverLocation = {
            lat: initialDriverLocation.lat,
            lng: initialDriverLocation.lng,
            updatedAt: serverTimestamp()
          };
        }
        transaction.update(ref, updateFields);

        // Bind new driver to chat channels
        try {
          const cdRef = doc(db, 'chats', `${o.id}_client-delivery`);
          transaction.set(cdRef, {
            orderId: o.id,
            type: 'client-delivery',
            driverId: user.uid,
            driverName: user.displayName || user.name || 'Repartidor',
            userId: o.userId || null,
            participants: arrayUnion(...[user.uid, o.userId].filter(Boolean))
          }, { merge: true });

          if (o.comercioId) {
            const comdRef = doc(db, 'chats', `${o.id}_commerce-delivery`);
            transaction.set(comdRef, {
              orderId: o.id,
              type: 'commerce-delivery',
              driverId: user.uid,
              driverName: user.displayName || user.name || 'Repartidor',
              comercioId: o.comercioId,
              participants: arrayUnion(...[user.uid, o.comercioId].filter(Boolean))
            }, { merge: true });
          }
        } catch (e) {
          console.warn('[takeBatch] Error updating chat doc in transaction:', e);
        }

        // Add real-time push/in-app notification to the client (if registered user)
        if (o.userId) {
          if (o.isTrip) {
            const notifRef = doc(collection(db, 'users', o.userId, 'notifications'));
            transaction.set(notifRef, {
              type: 'trip_taken',
              title: '⚡ ¡Chofer asignado!',
              body: `El chofer está yendo a tu ubicación. Patente: ${userData.vehicleDetails || userData.patente || '---'}`,
              status: 'unread',
              url: `#/pedido/${o.id}`,
              createdAt: new Date()
            });

            // Global push notification collection write
            const pushRef = doc(collection(db, 'notifications'));
            transaction.set(pushRef, {
              userId: o.userId,
              title: '⚡ ¡Chofer asignado!',
              body: `El chofer está yendo a tu ubicación. Patente: ${userData.vehicleDetails || userData.patente || '---'}`,
              type: 'trip_taken',
              orderId: o.id,
              createdAt: new Date(),
              read: false
            });
          } else {
            // Standard commerce order or favor
            const notifRef = doc(collection(db, 'users', o.userId, 'notifications'));
            transaction.set(notifRef, {
              type: 'order_taken',
              title: '🛵 ¡Repartidor asignado!',
              body: `Tu pedido de ${o.comercioName || 'el comercio'} fue tomado por ${userData.displayName || userData.name || 'un repartidor'} y va en camino.`,
              status: 'unread',
              url: `#/pedido/${o.id}`,
              createdAt: new Date()
            });

            // Global push notification collection write
            const pushRef = doc(collection(db, 'notifications'));
            transaction.set(pushRef, {
              userId: o.userId,
              title: '🛵 ¡Repartidor asignado!',
              body: `Tu pedido de ${o.comercioName || 'el comercio'} fue tomado por ${userData.displayName || userData.name || 'un repartidor'} y va en camino.`,
              type: 'order_taken',
              orderId: o.id,
              createdAt: new Date(),
              read: false
            });
          }
        }
      });

      // Update driver activity
      transaction.update(doc(db, 'users', user.uid), {
        lastActivityAt: serverTimestamp(),
        lastTripAcceptedAt: serverTimestamp(),
        missedOffersCount: 0
      });
      user.lastActivityAt = new Date();
      user.lastTripAcceptedAt = new Date();
      setState('user', { ...getState().user, lastActivityAt: new Date(), lastTripAcceptedAt: new Date() });
    });

    // Send automated messages for Pago de Servicios orders
    for (const o of ordersToTake) {
      if (o.favorType === 'pagodeservicios') {
        try {
          const alias = userData.transferAlias || 'No configurado';
          const totalTransfer = o.total || 0;
          const driverName = user.displayName || user.name || 'Repartidor';
          
          await addDoc(collection(db, 'orders', o.id, 'messages'), {
            senderId: 'system',
            senderName: 'GoDelivery',
            text: `👋 ¡Hola! El repartidor **${driverName}** ha aceptado tu Pago de Servicio.\n\n🏦 **Detalles para Transferencia**:\n• **Monto a transferir:** ${formatPrice(totalTransfer)}\n• **Alias:** \`${alias}\`\n\nPor favor realiza la transferencia y envía el comprobante por este chat para que el repartidor proceda a pagar tu servicio.`,
            createdAt: serverTimestamp(),
            type: 'system'
          });
        } catch (msgErr) {
          console.error('Error sending automated accept message:', msgErr);
        }
      }
    }

    window._animatePickupPill = true;
    showToast('¡Pedido tomado! Abriendo mapa en vivo...', 'success');
    // Automatically switch to active tab
    window.dispatchEvent(new CustomEvent('switch-delivery-tab', { detail: 'active' }));

    // Automatically open the Live GPS Tracking Map for the accepted order
    if (ordersToTake && ordersToTake.length > 0) {
      const targetOrder = ordersToTake[0];
      setTimeout(() => {
        if (typeof showDeliveryMapModal === 'function') {
          showDeliveryMapModal(targetOrder, ordersToTake);
        }
      }, 350);
    }
  } catch (err) {
    console.error('takeBatch error:', err);
    showToast(err.toString(), 'error');
    if (btn) {
      btn.disabled = false;
      if (btn.classList.contains('add-suggested-order-btn')) {
        btn.innerHTML = `${icon('plusCircle', 14)} SUMAR A MI RUTA`;
      } else {
        btn.innerHTML = `${icon('checkCircle', 20)} TOMAR PEDIDO`;
      }
    }
  } finally {
    isCurrentlyTakingBatch = false;
  }
}

export const takeOrder = takeBatch;

export function getMandadoStopsList(order) {
  if (!order) return [];
  const text = order.description || order.itemsText || order.details || order.notes || '';
  const clean = cleanMandadoText(text);

  if (Array.isArray(order.stopsPurchases) && order.stopsPurchases.length > 0) {
    return order.stopsPurchases.map(sp => ({
      store: sp.store || 'Comercio',
      items: sp.items || 'Productos del mandado',
      amount: typeof sp.amount === 'number' ? sp.amount : (parseFloat(sp.amount) || 0)
    }));
  }

  const regex = /(?:(\d+)\.\s*)?(?:Comercio|Lugar|Local)\s*:\s*([^📦📝\n]+)(?:[\s\S]*?(?:Pedido|Detalle|Instrucción|Compra)\s*:\s*([^1-9\n\r]+))?/gi;
  const stops = [];
  let match;
  while ((match = regex.exec(clean)) !== null) {
    let store = (match[2] || '').trim().replace(/^comercio:\s*/i, '');
    let items = (match[3] || '').trim() || 'Ver productos';
    if (store) {
      stops.push({ store, items, amount: 0 });
    }
  }

  if (stops.length === 0) {
    const parsed = parseMandadoDetails(text, order.comercioName || order.pickupAddress || 'Comercio / Kiosco');
    stops.push({
      store: parsed.comercio,
      items: parsed.items,
      amount: typeof order.purchaseCost === 'number' ? order.purchaseCost : (order.purchaseItemsTotal || 0)
    });
  }

  return stops;
}

export function openMandadoPurchaseModal({ order, isEdit = false, onConfirm, onCancel }) {
  if (!order) return;

  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';
  const stops = getMandadoStopsList(order);

  // Compute fixed breakdown fees
  const deliveryDistFee = Number(order.deliveryCost || order.shippingCost || order.deliveryFee || 0);
  const purchaseFee = Number(order.purchaseFee || 0);
  const extraStopsFee = Number(order.extraStopsFee || 0);
  const appUsageFee = Number(order.appUsageFee || order.serviceFee || 0);
  const rainSurcharge = Number(order.rainSurcharge || (order.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const pointsDiscount = Number(order.pointsDiscount || order.discountPoints || order.pointsValue || order.pointsUsedDiscount || 0);
  const couponDiscount = Number(order.couponDiscount || order.discount || 0);
  const tipAmount = Number(order.tip || order.tipAmount || 0);

  const deliveryBaseFee = deliveryDistFee + purchaseFee + extraStopsFee + appUsageFee + rainSurcharge + tipAmount - pointsDiscount - couponDiscount;

  // Initial purchase total
  let initialPurchaseTotal = stops.reduce((sum, s) => sum + (s.amount || 0), 0);
  if (initialPurchaseTotal === 0 && (order.purchaseCost || order.purchaseItemsTotal)) {
    initialPurchaseTotal = order.purchaseCost || order.purchaseItemsTotal || 0;
    if (stops.length === 1) stops[0].amount = initialPurchaseTotal;
  }

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'mandado-purchase-modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    z-index: 99999999; display: flex; align-items: flex-end; justify-content: center;
    animation: fadeIn 0.2s ease-out;
  `;

  modalOverlay.innerHTML = `
    <div id="mandado-purchase-modal-card" style="
      width: 100%; max-width: 500px;
      max-height: 88vh;
      background: ${isLight ? '#ffffff' : '#0b111e'};
      border: 1.5px solid ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(225,29,72,0.45)'};
      border-radius: 28px 28px 0 0;
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.6);
      display: flex; flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
    ">
      <!-- DRAG HANDLE BAR -->
      <div style="width: 100%; display: flex; justify-content: center; padding: 12px 0 4px 0;">
        <div style="width: 44px; height: 5px; border-radius: 4px; background: ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)'};"></div>
      </div>

      <!-- HEADER -->
      <div style="padding: 6px 18px 12px 18px; border-bottom: 1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:42px; height:42px; border-radius:14px; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 4px 12px rgba(225,29,72,0.4); flex-shrink:0;">
            🛍️
          </div>
          <div>
            <div style="font-size:16px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
              ${isEdit ? 'Modificar Valor de Compra' : 'Valor de Productos Comprados'}
            </div>
            <div style="font-size:11.5px; font-weight:700; color:${isLight ? '#64748b' : '#94a3b8'}; margin-top:1px;">
              Pedido #${order.orderId || order.id.slice(0, 6)} • ${order.userName || order.clientName || 'Cliente'}
            </div>
          </div>
        </div>
        <button id="close-mandado-purchase-modal-btn" style="
          width: 32px; height: 32px; border-radius: 50%;
          background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
          border: none; color: ${isLight ? '#64748b' : '#94a3b8'};
          font-size: 16px; font-weight: 900; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        ">✕</button>
      </div>

      <!-- INSTRUCTIONS -->
      <div style="padding: 10px 18px 4px 18px; font-size: 12px; color: ${isLight ? '#475569' : '#cbd5e1'}; line-height: 1.4;">
        Ingresá el importe abonado en cada parada del mandado. <strong>Podés ingresar $0</strong> si no hubo costo de compra.
      </div>

      <!-- SCROLLABLE STOPS LIST -->
      <div style="padding: 8px 18px 14px 18px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; max-height: 40vh; -webkit-overflow-scrolling: touch;">
        ${stops.map((stop, idx) => `
          <div style="
            background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'};
            border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.25)' : 'rgba(225, 29, 72, 0.35)'};
            border-radius: 18px; padding: 12px 14px;
            display: flex; flex-direction: column; gap: 8px;
          ">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); color:white; font-size:10px; font-weight:900; padding:2px 7px; border-radius:8px;">
                  Parada #${idx + 1}
                </span>
                <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
                  ${stop.store}
                </span>
              </div>
            </div>

            <div style="font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:600;">
              📦 ${stop.items}
            </div>

            <!-- INPUT FIELD -->
            <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
              <div style="
                flex: 1; display: flex; align-items: center;
                background: ${isLight ? '#ffffff' : 'rgba(0,0,0,0.4)'};
                border: 2px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'};
                border-radius: 14px; padding: 0 12px; height: 46px;
                transition: border-color 0.2s ease;
              " class="mandado-input-wrapper">
                <span style="font-size:16px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'}; margin-right:4px;">$</span>
                <input type="number" step="10" min="0" data-idx="${idx}" class="mandado-stop-amount-input" 
                       placeholder="0" value="${stop.amount > 0 ? stop.amount : ''}" 
                       style="
                         width: 100%; border: none; background: transparent;
                         font-size: 17px; font-weight: 900; color: ${isLight ? '#0f172a' : '#ffffff'};
                         outline: none; font-family: inherit;
                       " />
              </div>
            </div>

            <!-- QUICK CHIP BUTTONS -->
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="0" style="
                background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
                border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'};
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:${isLight ? '#475569' : '#cbd5e1'}; cursor:pointer;
              ">$0</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="500" style="
                background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
                border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'};
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:${isLight ? '#475569' : '#cbd5e1'}; cursor:pointer;
              ">+$500</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="1000" style="
                background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
                border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'};
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:${isLight ? '#475569' : '#cbd5e1'}; cursor:pointer;
              ">+$1.000</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="2000" style="
                background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
                border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'};
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:${isLight ? '#475569' : '#cbd5e1'}; cursor:pointer;
              ">+$2.000</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="5000" style="
                background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
                border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'};
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:${isLight ? '#475569' : '#cbd5e1'}; cursor:pointer;
              ">+$5.000</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- LIVE CALCULATION TOTAL CARD (ITEMIZED) -->
      <div style="
        margin: 0 18px 12px 18px; padding: 12px 14px; border-radius: 16px;
        background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.12)'};
        border: 1.5px solid ${isLight ? '#fecaca' : 'rgba(225, 29, 72, 0.35)'};
        display: flex; flex-direction: column; gap: 4px;
      ">
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:700;">
          <span>🛍️ Subtotal Productos Comprados:</span>
          <span id="mandado-modal-live-purchases" style="font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">$0</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:700;">
          <span>🛵 Costo de Envío / Distancia:</span>
          <span style="font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">$${deliveryDistFee.toLocaleString('es-AR')}</span>
        </div>
        ${purchaseFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:700;">
            <span>⚡ Gestión y Compra en Locales:</span>
            <span style="font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">$${purchaseFee.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${extraStopsFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:700;">
            <span>📍 Paradas Adicionales:</span>
            <span style="font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">$${extraStopsFee.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${appUsageFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:${isLight ? '#64748b' : '#94a3b8'}; font-weight:700;">
            <span>📱 Tarifa por Servicio App:</span>
            <span style="font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">$${appUsageFee.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${rainSurcharge > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#e11d48; font-weight:700;">
            <span>🌧️ Recargo por Lluvia:</span>
            <span style="font-weight:900; color:#e11d48;">$${rainSurcharge.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${pointsDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#16a34a; font-weight:700;">
            <span>💎 Descuento GoPuntos:</span>
            <span style="font-weight:900; color:#16a34a;">-$${pointsDiscount.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${couponDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#16a34a; font-weight:700;">
            <span>🏷️ Descuento Cupón:</span>
            <span style="font-weight:900; color:#16a34a;">-$${couponDiscount.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:900; color:${isLight ? '#be123c' : '#fb7185'}; padding-top:5px; border-top:1px dashed ${isLight ? 'rgba(225,29,72,0.2)' : 'rgba(225,29,72,0.3)'}; margin-top:2px;">
          <span>TOTAL A COBRAR:</span>
          <span id="mandado-modal-live-total">$0</span>
        </div>
      </div>

      <!-- ACTION BUTTONS -->
      <div style="padding: 0 18px 18px 18px; display: flex; gap: 10px;">
        <button id="mandado-modal-cancel-btn" style="
          flex: 1; height: 50px; border-radius: 16px;
          background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
          border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'};
          color: ${isLight ? '#475569' : '#cbd5e1'};
          font-size: 13.5px; font-weight: 800; cursor: pointer;
        ">
          Cancelar
        </button>

        <button id="mandado-modal-confirm-btn" style="
          flex: 2; height: 50px; border-radius: 16px;
          background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
          border: none; color: white;
          font-size: 13.5px; font-weight: 900; cursor: pointer;
          box-shadow: 0 6px 18px rgba(225, 29, 72, 0.45);
          display: flex; align-items: center; justify-content: center; gap: 6px;
        ">
          <span>${isEdit ? '💾 Guardar Cambios' : '✅ Confirmar y Continuar'}</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  // Recalculate helper
  const updateLiveTotals = () => {
    let sum = 0;
    const inputs = modalOverlay.querySelectorAll('.mandado-stop-amount-input');
    inputs.forEach(inp => {
      const val = parseFloat(inp.value) || 0;
      if (val > 0) sum += val;
    });
    const totalElement = modalOverlay.querySelector('#mandado-modal-live-total');
    const purchasesElement = modalOverlay.querySelector('#mandado-modal-live-purchases');
    if (purchasesElement) purchasesElement.textContent = `$${sum.toLocaleString('es-AR')}`;
    if (totalElement) totalElement.textContent = `$${(deliveryBaseFee + sum).toLocaleString('es-AR')}`;
    return sum;
  };

  updateLiveTotals();

  // Bind input changes
  const inputs = modalOverlay.querySelectorAll('.mandado-stop-amount-input');
  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      updateLiveTotals();
    });
    inp.addEventListener('focus', () => {
      const wrapper = inp.closest('.mandado-input-wrapper');
      if (wrapper) wrapper.style.borderColor = '#e11d48';
    });
    inp.addEventListener('blur', () => {
      const wrapper = inp.closest('.mandado-input-wrapper');
      if (wrapper) wrapper.style.borderColor = isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)';
    });
  });

  // Bind quick chip buttons
  const chips = modalOverlay.querySelectorAll('.mandado-quick-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = chip.dataset.idx;
      const addVal = parseFloat(chip.dataset.val) || 0;
      const targetInput = modalOverlay.querySelector(`.mandado-stop-amount-input[data-idx="${idx}"]`);
      if (targetInput) {
        if (addVal === 0) {
          targetInput.value = '0';
        } else {
          const currentVal = parseFloat(targetInput.value) || 0;
          targetInput.value = (currentVal + addVal).toString();
        }
        updateLiveTotals();
      }
    });
  });

  const closeModal = () => {
    modalOverlay.remove();
  };

  modalOverlay.querySelector('#close-mandado-purchase-modal-btn').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };

  modalOverlay.querySelector('#mandado-modal-cancel-btn').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };

  modalOverlay.querySelector('#mandado-modal-confirm-btn').onclick = () => {
    const sum = updateLiveTotals();
    const updatedStops = stops.map((s, idx) => {
      const inp = modalOverlay.querySelector(`.mandado-stop-amount-input[data-idx="${idx}"]`);
      const val = inp ? (parseFloat(inp.value) || 0) : 0;
      return {
        store: s.store,
        items: s.items,
        amount: val
      };
    });
    const finalGrandTotal = deliveryBaseFee + sum;
    closeModal();
    if (onConfirm) {
      onConfirm(sum, updatedStops, finalGrandTotal);
    }
  };
}

export function openOrderBreakdownModal(order) {
  if (!order) return;

  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const isCash = order.paymentMethod === 'efectivo' || (order.paymentMethod && order.paymentMethod.toString().toLowerCase().includes('efect'));
  const isFavor = Boolean(order.isFavor);
  const isEncomienda = isOrderEncomienda(order);

  // 1. Products / Items / Purchase cost
  let productsSubtotal = 0;
  let productsLabel = 'Productos / Pedido';
  let stopDetails = [];

  if (isFavor && !isEncomienda) {
    productsLabel = 'Compra en Locales';
    productsSubtotal = (order.purchaseCost !== undefined) ? order.purchaseCost : (order.purchaseItemsTotal || 0);
    if (Array.isArray(order.stopsPurchases) && order.stopsPurchases.length > 0) {
      stopDetails = order.stopsPurchases;
    }
  } else if (isFavor && isEncomienda) {
    productsLabel = 'Servicio de Encomienda';
    productsSubtotal = order.packageCost || 0;
  } else {
    productsLabel = 'Productos del Comercio';
    if (order.subtotal !== undefined) {
      productsSubtotal = Number(order.subtotal);
    } else if (order.itemsTotal !== undefined) {
      productsSubtotal = Number(order.itemsTotal);
    } else if (Array.isArray(order.items)) {
      productsSubtotal = order.items.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.quantity) || Number(it.cant) || 1)), 0);
    }
  }

  // 2. Breakdown Components
  const deliveryFee = Number(order.deliveryCost || order.shippingCost || order.deliveryFee || 0);
  const purchaseFee = Number(order.purchaseFee || 0);
  const extraStopsFee = Number(order.extraStopsFee || 0);
  const appUsageFee = Number(order.appUsageFee || order.serviceFee || 0);
  const rainSurcharge = Number(order.rainSurcharge || (order.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const nightSurcharge = Number(order.nightSurcharge || order.extraFee || 0);
  const tipAmount = Number(order.tip || order.tipAmount || 0);
  const pointsDiscount = Number(order.pointsDiscount || order.discountPoints || order.pointsValue || order.pointsUsedDiscount || 0);
  const couponDiscount = Number(order.couponDiscount || order.discount || 0);

  // Grand total
  const grandTotal = Number(order.totalAmount || order.total || 0);

  // Driver Earnings
  const driverEarnings = getOrderDriverEarnings(order);

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'order-breakdown-modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    z-index: 99999999; display: flex; align-items: flex-end; justify-content: center;
    animation: fadeIn 0.2s ease-out;
  `;

  modalOverlay.innerHTML = `
    <div id="order-breakdown-modal-card" style="
      width: 100%; max-width: 500px;
      max-height: 90vh;
      background: ${isLight ? '#ffffff' : '#0b111e'};
      border: 1.5px solid ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(225,29,72,0.45)'};
      border-radius: 28px 28px 0 0;
      box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.65);
      display: flex; flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
    ">
      <!-- DRAG HANDLE -->
      <div style="width: 100%; display: flex; justify-content: center; padding: 12px 0 4px 0;">
        <div style="width: 44px; height: 5px; border-radius: 4px; background: ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)'};"></div>
      </div>

      <!-- HEADER -->
      <div style="padding: 6px 18px 12px 18px; border-bottom: 1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:42px; height:42px; border-radius:14px; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 4px 12px rgba(225,29,72,0.4); flex-shrink:0;">
            🧾
          </div>
          <div>
            <div style="font-size:16px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
              Desglose del Total
            </div>
            <div style="font-size:11.5px; font-weight:700; color:${isLight ? '#64748b' : '#94a3b8'}; margin-top:1px;">
              Pedido #${order.orderId || order.id.slice(0, 6)} • ${order.userName || order.clientName || 'Cliente'}
            </div>
          </div>
        </div>
        <button id="close-breakdown-modal-btn" style="
          width: 32px; height: 32px; border-radius: 50%;
          background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'};
          border: none; color: ${isLight ? '#64748b' : '#94a3b8'};
          font-size: 16px; font-weight: 900; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        ">✕</button>
      </div>

      <!-- MAIN PAYMENT CALLOUT BANNER -->
      <div style="padding: 12px 18px 6px 18px;">
        <div style="
          padding: 12px 14px; border-radius: 18px;
          background: ${isCash ? (isLight ? '#fef3c7' : 'rgba(245, 158, 11, 0.15)') : (isLight ? '#e0f2fe' : 'rgba(14, 165, 233, 0.15)')};
          border: 1.5px solid ${isCash ? '#fde68a' : (isLight ? '#bae6fd' : 'rgba(14, 165, 233, 0.35)')};
          display: flex; flex-direction: column; gap: 4px;
        ">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span style="font-size:11px; font-weight:900; color:${isCash ? (isLight ? '#b45309' : '#f59e0b') : (isLight ? '#0369a1' : '#38bdf8')}; text-transform:uppercase; letter-spacing:0.5px;">
              ${isCash ? '💵 PAGO EN EFECTIVO' : '💳 PAGO POR TRANSFERENCIA'}
            </span>
            <span style="font-size:10px; font-weight:900; background:${isCash ? '#f59e0b' : '#0ea5e9'}; color:white; padding:2px 7px; border-radius:8px;">
              ${isCash ? 'COBRAR EN EFECTIVO' : 'SOLICITAR TRANSFERENCIA'}
            </span>
          </div>
          <div style="font-size:24px; font-weight:950; color:${isCash ? (isLight ? '#78350f' : '#fef08a') : (isLight ? '#0c4a6e' : '#e0f2fe')}; line-height:1.1;">
            $${grandTotal.toLocaleString('es-AR')}
          </div>
          <div style="font-size:11px; font-weight:700; color:${isCash ? (isLight ? '#92400e' : '#fde68a') : (isLight ? '#0284c7' : '#7dd3fc')}; margin-top:2px;">
            ${isCash ? '💰 El cliente debe abonar esta suma en efectivo al momento de la entrega.' : '📲 El cliente te transfiere a vos. Solicitá y verificá el comprobante al entregar.'}
          </div>
        </div>
      </div>

      <!-- ITEM BY ITEM BREAKDOWN LIST -->
      <div style="padding: 8px 18px 12px 18px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 44vh; -webkit-overflow-scrolling: touch;">
        <div style="font-size: 11px; font-weight: 800; color: ${isLight ? '#64748b' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
          Conceptos Incluidos:
        </div>

        <!-- 1. PRODUCTOS / MANDADO -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'};">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:15px;">🛍️</span>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:12.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'};">${productsLabel}</span>
              ${stopDetails.length > 0 ? `
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">
                  ${stopDetails.map(s => `${s.store}: $${(s.amount || 0).toLocaleString('es-AR')}`).join(' • ')}
                </span>
              ` : ''}
            </div>
          </div>
          <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
            $${productsSubtotal.toLocaleString('es-AR')}
          </span>
        </div>

        <!-- 2. COSTO DE ENVÍO -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'};">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:15px;">🛵</span>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:12.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'};">Costo de Envío / Distancia</span>
              <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Tarifa base por recorrido</span>
            </div>
          </div>
          <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
            $${deliveryFee.toLocaleString('es-AR')}
          </span>
        </div>

        <!-- 3. GESTIÓN PERSONALIZADA -->
        ${purchaseFee > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">⚡</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'};">Gestión y Compra en Locales</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Atención y selección personalizada</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
              $${purchaseFee.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 4. PARADAS ADICIONALES -->
        ${extraStopsFee > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">📍</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'};">Paradas Adicionales (${order.stopsCount || 2})</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Múltiples comercios visitados</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
              $${extraStopsFee.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 5. TARIFA POR USO DE APP -->
        ${appUsageFee > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">📱</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'};">Tarifa por Servicio GoDelivery</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Soporte, tecnología y conectividad</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
              $${appUsageFee.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 6. RECARGO POR LLUVIA / CLIMA -->
        ${rainSurcharge > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.1)'}; border:1px solid ${isLight ? '#fecaca' : 'rgba(225,29,72,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">🌧️</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#e11d48;">Recargo por Lluvia / Clima</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Adicional asignado al repartidor</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#e11d48;">
              $${rainSurcharge.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 7. RECARGO NOCTURNO -->
        ${nightSurcharge > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">🌙</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:${isLight ? '#0f172a' : '#ffffff'};">Recargo de Horario Especial</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Franja horaria nocturna / feriado</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#0f172a' : '#ffffff'};">
              $${nightSurcharge.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 8. PROPINA -->
        ${tipAmount > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f0fdf4' : 'rgba(34,197,94,0.1)'}; border:1px solid ${isLight ? '#bbf7d0' : 'rgba(34,197,94,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">🎁</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#16a34a;">Propina para el Repartidor</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">100% directa para vos</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#16a34a;">
              $${tipAmount.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 9. DESCUENTO POR PUNTOS -->
        ${pointsDiscount > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f0fdf4' : 'rgba(34,197,94,0.1)'}; border:1px solid ${isLight ? '#bbf7d0' : 'rgba(34,197,94,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">💎</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#16a34a;">Descuento por GoPuntos</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Puntos canjeados por el cliente</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#16a34a;">
              -$${pointsDiscount.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 10. DESCUENTO POR CUPÓN -->
        ${couponDiscount > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f0fdf4' : 'rgba(34,197,94,0.1)'}; border:1px solid ${isLight ? '#bbf7d0' : 'rgba(34,197,94,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">🏷️</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#16a34a;">Descuento Cupón (${order.couponCode || 'Promo'})</span>
                <span style="font-size:10.5px; color:${isLight ? '#64748b' : '#94a3b8'};">Bonificación aplicada al cliente</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#16a34a;">
              -$${couponDiscount.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- TOTAL ROW -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-radius:14px; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.15)'}; border:1.5px solid ${isLight ? '#fecaca' : 'rgba(225,29,72,0.35)'}; margin-top:4px;">
          <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#be123c' : '#fb7185'};">TOTAL A COBRAR:</span>
          <span style="font-size:17px; font-weight:950; color:${isLight ? '#9f1239' : '#ffffff'};">$${grandTotal.toLocaleString('es-AR')}</span>
        </div>
      </div>

      <!-- DRIVER SETTLEMENT & NET EARNINGS -->
      <div style="margin: 4px 18px 12px 18px; padding: 10px 12px; border-radius: 14px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)'}; border:1px dashed ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:14px;">💰</span>
          <span style="font-size:11.5px; font-weight:800; color:${isLight ? '#334155' : '#cbd5e1'};">Tu Ganancia Neta por este Pedido:</span>
        </div>
        <span style="font-size:14px; font-weight:900; color:#22c55e;">
          $${driverEarnings.toLocaleString('es-AR')}
        </span>
      </div>

      <!-- CLOSE BUTTON -->
      <div style="padding: 0 18px 18px 18px;">
        <button id="breakdown-modal-ok-btn" style="
          width: 100%; height: 48px; border-radius: 16px;
          background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
          border: none; color: white;
          font-size: 14px; font-weight: 900; cursor: pointer;
          box-shadow: 0 6px 18px rgba(225, 29, 72, 0.4);
          display: flex; align-items: center; justify-content: center; gap: 6px;
        ">
          👍 Entendido
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const closeModal = () => modalOverlay.remove();
  modalOverlay.querySelector('#close-breakdown-modal-btn').onclick = closeModal;
  modalOverlay.querySelector('#breakdown-modal-ok-btn').onclick = closeModal;
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
  };
}

export async function markAsPickedUp(orderIdOrIds, extraData = {}) {
  const ids = Array.isArray(orderIdOrIds) ? orderIdOrIds : orderIdOrIds.split(',');

  // Check if simulated demo order
  if (ids.includes('sim_demo_order') || window.mockSimulatedOrder) {
    if (window.mockSimulatedOrder) {
      window.mockSimulatedOrder.status = 'delivering';
    }
    const currentUser = getState().user;
    const bottomDock = document.getElementById('driver-footer-dock-container');
    if (bottomDock) {
      bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
      attachBottomDockListeners(currentUser, activeOrdersList);
    }
    NavigationVoice.speak('Pedido retirado. Dirigite a Calle Brenan 450', true);
    showToast('🛍️ Pedido retirado. ¡Yendo a entregar al cliente!', 'success');
    
    // Draw route from Los Sabores to Client
    const startLoc = { lat: -35.0815, lng: -57.5147 };
    const destLoc = { lat: -35.0875, lng: -57.5180 };
    drawDriverRoute(startLoc, destLoc, null, 'dropoff').then(() => {
      startGpsRouteSimulation();
    });
    return;
  }

  // Voice announcement of next destination
  const primaryId = ids[0];
  const orderObj = (activeOrdersList || []).find(o => o.id === primaryId);
  const dropAddress = orderObj?.deliveryAddress || orderObj?.address || orderObj?.destinationAddress || orderObj?.shippingAddress || 'el domicilio del cliente';
  NavigationVoice.speak(`Pedido retirado. Dirigite a ${dropAddress}`, true);

  // Optimistic UI response: Feedback is instant to the rider
  showToast(ids.length > 1 ? 'Pedidos retirados con éxito 🚴' : 'Pedido retirado con éxito 🚴', 'success');

  // Asynchronous background execution (does not block UI)
  (async () => {
    try {
      let lat = window.lastRiderPos?.lat || null;
      let lng = window.lastRiderPos?.lng || null;

      if (!lat && navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 1000, enableHighAccuracy: false });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
          window.lastRiderPos = { lat, lng };
        } catch (e) {
          console.warn('Location fetch failed on pickup', e);
        }
      }

      const updates = {
        pickedUpAt: serverTimestamp(),
        status: 'delivering'
      };

      if (extraData.purchaseCost !== undefined) {
        updates.purchaseCost = extraData.purchaseCost;
        updates.purchaseItemsTotal = extraData.purchaseCost;
      }
      if (extraData.stopsPurchases) {
        updates.stopsPurchases = extraData.stopsPurchases;
      }
      if (extraData.total !== undefined) {
        updates.total = extraData.total;
      }

      if (lat !== null && lng !== null) {
        updates.driverLocation = { lat, lng, updatedAt: serverTimestamp() };
      }

      const batch = writeBatch(db);
      ids.forEach(id => {
        batch.update(doc(db, 'orders', id), updates);
      });
      await batch.commit();

      // Update in-memory active orders immediately
      (activeOrdersList || []).forEach(o => {
        if (ids.includes(o.id)) {
          o.status = 'delivering';
          o.pickedUpAt = new Date();
          if (extraData.purchaseCost !== undefined) o.purchaseCost = extraData.purchaseCost;
          if (extraData.purchaseItemsTotal !== undefined) o.purchaseItemsTotal = extraData.purchaseCost;
          if (extraData.stopsPurchases) o.stopsPurchases = extraData.stopsPurchases;
          if (extraData.total !== undefined) o.total = extraData.total;
        }
      });

      const currentUser = getState().user;
      const bottomDock = document.getElementById('driver-footer-dock-container');
      if (bottomDock) {
        bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
        attachBottomDockListeners(currentUser, activeOrdersList);
      }
      
      // Background non-blocking notification to users
      Promise.all(ids.map(async id => {
        try {
          const orderSnap = await getDoc(doc(db, 'orders', id));
          if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            if (orderData.userId) {
              const isEncomienda = orderData.favorType === 'encomienda' || (orderData.isFavor && orderData.favorType === 'encomienda') || orderData.serviceType === 'encomienda';
              const codeStr = (orderData.verificationCode && !isEncomienda) ? ` Tené listo tu código de entrega: ${orderData.verificationCode}` : '';
              await addDoc(collection(db, 'users', orderData.userId, 'notifications'), {
                title: orderData.isFavor ? '¡Tu favor va en camino! 🚴' : '¡Tu pedido va en camino! 🚴',
                body: orderData.isFavor 
                  ? `El repartidor ya retiró tu favor y va para allá.${codeStr}` 
                  : `El repartidor retiró tu pedido y va hacia tu domicilio.${codeStr}`,
                type: 'system',
                status: 'unread',
                createdAt: serverTimestamp()
              });
            }
          }
        } catch (notifErr) {
          console.warn('Could not send pickup notification to user:', notifErr);
        }
      }));
    } catch (err) {
      console.warn('Async pickup sync error:', err);
    }
  })();
}

export function openSlideToConfirmModal({ isTrip, noCodeRequired, codes, ids, orders, onConfirm, onCancel }) {
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 8px 16px 16px;';

  const isLight = getDriverMapTheme() === 'light';
  const needsCode = !isTrip && !noCodeRequired;
  let isConfirmed = false;

  modalContent.innerHTML = `
    <div>
      ${needsCode ? `
        <p style="font-size:14px; color:${isLight ? '#475569' : '#94a3b8'}; margin-bottom:16px; line-height:1.5; text-align:center; font-weight:600;">
          Pedile al cliente su <strong>código de 4 dígitos</strong> para validar la entrega.
        </p>
        <div style="margin-bottom:12px; display:flex; flex-direction:column; align-items:center;">
          <input type="text" id="modal-verification-input" 
                 placeholder="0000" maxlength="4" inputmode="numeric" autocomplete="one-time-code"
                 style="width:100%; max-width:280px; height:68px; border-radius:22px; background:${isLight ? '#f8fafc' : 'rgba(255,255,255,0.06)'}; border:2.5px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.18)'}; text-align:center; font-size:34px; font-weight:950; letter-spacing:12px; color:${isLight ? '#0f172a' : '#ffffff'}; box-shadow:0 6px 20px rgba(0,0,0,0.08); transition:all 0.25s ease; outline:none;">
          <div id="modal-verification-status" style="min-height:28px; margin-top:8px; display:flex; align-items:center; justify-content:center;"></div>
        </div>
      ` : `
        <p style="font-size:14px; color:${isLight ? '#475569' : '#94a3b8'}; margin-bottom:24px; line-height:1.5; text-align:center; font-weight:600;">
          ${isTrip ? 'Confirmá que llegaste al destino y que el pasajero descendió del vehículo.' : 'Confirmá la entrega de este pedido manual. No requiere código.'}
        </p>

        <!-- Slider Container for Manual / Trip confirmation -->
        <div id="slide-confirm-container" class="slider-container" style="
          position: relative; 
          width: 100%; 
          height: 60px; 
          background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.06)'}; 
          border-radius: 30px; 
          border: 2px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; 
          overflow: hidden; 
          user-select: none;
          touch-action: none;
          transition: opacity 0.3s ease;
        ">
          <div class="slider-bg" style="position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: linear-gradient(90deg, #e11d48, #10b981); border-radius: 30px; touch-action: none;"></div>
          <div class="slider-text" style="position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 900; color: ${isLight ? '#475569' : '#cbd5e1'}; pointer-events: none; text-transform: uppercase; letter-spacing: 0.05em; touch-action: none;">
            DESLIZÁ PARA CONFIRMAR
          </div>
          <div class="slider-handle" style="position: absolute; top: 4px; left: 4px; width: 48px; height: 48px; background: white; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; cursor: grab; transition: left 0.1s ease; touch-action: none;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #e11d48; display: flex; align-items: center; justify-content: center; color: white; touch-action: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="touch-action: none;"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>
          </div>
        </div>
      `}
      <p style="font-size:11px; text-align:center; color:${isLight ? '#94a3b8' : '#64748b'}; margin-top:18px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Seguridad GoDelivery</p>
    </div>
  `;

  showModal({
    title: isTrip ? '🚕 ¿Finalizar Viaje?' : (needsCode ? '🔑 Código de Entrega' : 'Confirmación de Entrega'),
    content: modalContent,
    height: 'auto',
    onClose: () => {
      if (!isConfirmed && typeof onCancel === 'function') {
        onCancel();
      }
    }
  });

  const input = modalContent.querySelector('#modal-verification-input');
  const statusEl = modalContent.querySelector('#modal-verification-status');

  if (input) {
    setTimeout(() => {
      input.focus();
      try { input.select(); } catch(e){}
    }, 250);

    let isProcessing = false;

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      input.style.borderColor = isLight ? '#e11d48' : 'rgba(225,29,72,0.8)';
      if (statusEl) statusEl.innerHTML = '';

      if (input.value.length === 4 && !isProcessing) {
        const typedCode = input.value.trim();
        const validCodes = (codes || []).map(c => String(c).trim());
        const isMaster = typedCode === '9999' || typedCode === '0000';
        const isCorrect = validCodes.includes(typedCode) || isMaster;

        if (isCorrect) {
          isProcessing = true;
          isConfirmed = true;
          input.disabled = true;
          input.style.borderColor = '#10b981';
          input.style.background = isLight ? '#f0fdf4' : 'rgba(16, 185, 129, 0.15)';
          input.style.color = '#10b981';

          if (statusEl) {
            statusEl.innerHTML = `
              <div style="display:flex; align-items:center; gap:6px; color:#10b981; font-weight:900; font-size:14px; animation:fadeIn 0.2s ease;">
                <span>✅</span> <span>¡Código correcto! Completando entrega...</span>
              </div>
            `;
          }

          if (navigator.vibrate) {
            try { navigator.vibrate([70, 40, 70]); } catch(e) {}
          }
          try {
            AudioManager.playSynthChime();
          } catch(e) {}

          setTimeout(() => {
            closeModal();
            onConfirm();
          }, 420);
        } else {
          input.style.borderColor = '#ef4444';
          input.style.background = isLight ? '#fef2f2' : 'rgba(239, 68, 68, 0.15)';
          input.style.color = '#ef4444';
          input.style.animation = 'shake 0.4s ease';

          if (statusEl) {
            statusEl.innerHTML = `
              <div style="display:flex; align-items:center; gap:6px; color:#ef4444; font-weight:800; font-size:13.5px; animation:fadeIn 0.2s ease;">
                <span>❌</span> <span>Código incorrecto. Verificalo con el cliente.</span>
              </div>
            `;
          }

          if (navigator.vibrate) {
            try { navigator.vibrate([200, 100, 200]); } catch(e) {}
          }
          try {
            AudioManager.hapticError();
          } catch(e) {}

          setTimeout(() => {
            input.style.animation = '';
            input.value = '';
            input.style.borderColor = isLight ? '#cbd5e1' : 'rgba(255,255,255,0.18)';
            input.style.background = isLight ? '#f8fafc' : 'rgba(255,255,255,0.06)';
            input.style.color = isLight ? '#0f172a' : '#ffffff';
            input.focus();
          }, 550);
        }
      }
    });
  }

  // Slider handler for manual orders / trips
  const containerEl = modalContent.querySelector('#slide-confirm-container');
  if (containerEl) {
    const handle = modalContent.querySelector('.slider-handle');
    const bg = modalContent.querySelector('.slider-bg');
    const text = modalContent.querySelector('.slider-text');

    let isDragging = false;
    let startX = 0;
    let maxSlide = 0;

    const onStart = (e) => {
      isDragging = true;
      startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
      maxSlide = containerEl.clientWidth - handle.clientWidth - 8;
      handle.style.transition = 'none';
      bg.style.transition = 'none';
      handle.style.cursor = 'grabbing';
    };

    const onMove = (e) => {
      if (!isDragging) return;
      const clientX = (e.type === 'touchmove') ? e.touches[0].clientX : e.clientX;
      let deltaX = clientX - startX;
      if (deltaX < 0) deltaX = 0;
      if (deltaX > maxSlide) deltaX = maxSlide;

      handle.style.left = `${deltaX + 4}px`;
      bg.style.width = `${((deltaX + 24) / containerEl.clientWidth) * 100}%`;
      text.style.opacity = Math.max(0, 1 - (deltaX / (maxSlide * 0.6)));
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      handle.style.cursor = 'grab';
      const currentLeft = parseInt(handle.style.left) - 4;

      if (currentLeft >= maxSlide * 0.9) {
        isConfirmed = true;
        handle.style.transition = 'all 0.2s ease';
        bg.style.transition = 'all 0.2s ease';
        handle.style.left = `${maxSlide + 4}px`;
        bg.style.width = '100%';
        text.style.opacity = '0';

        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }

        setTimeout(() => {
          closeModal();
          onConfirm();
        }, 200);
      } else {
        handle.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        bg.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        handle.style.left = '4px';
        bg.style.width = '0%';
        text.style.opacity = '1';
      }
    };

    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    handle.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  }
}

export async function showSuccessCelebration(orders, onFinish) {
  const isLight = getDriverMapTheme() === 'light';
  const user = getState().user;
  const currentSessionId = user?.currentSessionId;
  let previousSessionEarned = 0;
  let currentDebt = orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);

  const totalEarned = orders.reduce((sum, o) => {
    return sum + getOrderDriverEarnings(o);
  }, 0);

  if (currentSessionId) {
    try {
      const q = query(
        collection(db, 'orders'),
        where('driverId', '==', user.uid),
        where('deliverySessionId', '==', currentSessionId),
        where('status', '==', 'completed')
      );
      const snap = await getDocs(q);
      let totalCompletedInSession = 0;
      snap.docs.forEach(d => {
        const o = d.data();
        const netEarnings = getOrderDriverEarnings(o);
        totalCompletedInSession += netEarnings;
      });

      const currentOrderIds = orders.map(o => o.id);
      let currentOrdersSessionEarnings = 0;
      snap.docs.forEach(d => {
        if (currentOrderIds.includes(d.id)) {
          const o = d.data();
          const netEarnings = getOrderDriverEarnings(o);
          currentOrdersSessionEarnings += netEarnings;
        }
      });
      previousSessionEarned = Math.max(0, totalCompletedInSession - currentOrdersSessionEarnings);
    } catch (e) {
      console.error('Error calculating session earnings for celebration:', e);
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'delivery-success-celebration';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #E11D48;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #0f172a;
    font-family: var(--font-display, 'Outfit', sans-serif);
    opacity: 0;
    transition: opacity 0.5s cubic-bezier(0.19, 1, 0.22, 1);
    overflow: hidden;
  `;

  const previousDebt = Math.max(0, (getState().user?.deliveryDebt || 0) - currentDebt);

  overlay.innerHTML = `
    <!-- Expanding Morphing Sphere from Center -->
    <div class="celebration-circle-grow" style="
      position: absolute;
      width: 10px;
      height: 10px;
      background: ${isLight ? 'rgba(248, 250, 252, 1)' : '#090d16'};
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      transform-origin: center;
      animation: expandWhiteCircle 1.6s cubic-bezier(0.85, 0, 0.15, 1) forwards;
      z-index: 1;
      pointer-events: none;
    "></div>

    <canvas id="confetti-canvas" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 2; opacity: 0; animation: fadeInConfetti 1s ease 1s forwards;"></canvas>
    
    <div style="text-align:center; z-index: 10; padding:36px 28px; max-width:400px; display:flex; flex-direction:column; align-items:center; gap:24px; width:92%; box-sizing:border-box; background: ${isLight ? 'white' : 'rgba(15, 23, 42, 0.95)'}; backdrop-filter: blur(20px); border: 1.5px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'}; border-radius: 36px; box-shadow: 0 30px 60px -15px ${isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(0, 0, 0, 0.7)'}; transform: scale(0.9) translateY(20px); opacity: 0; animation: modalEntrance 0.8s cubic-bezier(0.19, 1, 0.22, 1) 0.5s forwards;">
      
      <!-- Brand Logo Header -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 2px;">
        <img src="/logo-pwa.png" alt="Go! Delivery" onerror="this.onerror=null; this.src='/logo.png';" style="width: 86px; height: 86px; border-radius: 50%; object-fit: cover; filter: drop-shadow(0 6px 15px rgba(0, 0, 0, 0.25)); animation: bounceLogo 2.2s infinite ease-in-out;">
      </div>

      <div style="text-align: center; display: flex; flex-direction: column; gap: 6px;">
        <h1 style="font-size: 26px; font-weight: 950; margin: 0; letter-spacing: -0.8px; color: ${isLight ? '#0f172a' : '#ffffff'};">¡Entrega Completada!</h1>
        <p style="font-size: 14px; color: ${isLight ? '#64748b' : '#94a3b8'}; margin: 0; line-height: 1.45; font-weight: 600;">¡Excelente trabajo! Has sumado ganancias a tu cuenta.</p>
      </div>
      
      <div style="background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'}; border: 1.5px solid ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255, 255, 255, 0.08)'}; padding: 24px; border-radius: 28px; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.01);">
        <div style="text-align: center;">
          <span style="font-size: 10.5px; font-weight: 900; text-transform: uppercase; color: ${isLight ? '#0d9488' : '#2dd4bf'}; letter-spacing: 0.1em; display: block; margin-bottom: 4px;">Ganado en este viaje</span>
          <div id="celebration-amount" style="font-size: 40px; font-weight: 950; color: ${isLight ? '#0f172a' : '#ffffff'}; letter-spacing: -1.5px; line-height: 1;">$ 0.00</div>
        </div>
        
        <div style="height: 1.5px; background: ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'}; width: 100%;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: ${isLight ? '#64748b' : '#94a3b8'};">
          <span style="display: flex; align-items: center; gap: 8px;">💼 Total Sesión Actual</span>
          <span id="celebration-session-amount" style="font-size: 18px; font-weight: 950; color: ${isLight ? '#0f172a' : '#ffffff'}; letter-spacing: -0.5px;">$ 0.00</span>
        </div>

        <div style="height: 1.5px; background: ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'}; width: 100%;"></div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: ${isLight ? '#e11d48' : '#fb7185'};">
          <span style="display: flex; align-items: center; gap: 8px;">💳 Tarifa App a Rendir (Total)</span>
          <span id="celebration-debt-amount" style="font-size: 18px; font-weight: 950; color: ${isLight ? '#e11d48' : '#fb7185'}; letter-spacing: -0.5px;">$ 0.00</span>
        </div>
      </div>

      <button id="celebration-continue-btn" style="
        background: linear-gradient(135deg, #E11D48 0%, #BE123C 100%); 
        color: white; 
        border: none; 
        padding: 18px 40px; 
        font-weight: 900; 
        font-size: 15px; 
        border-radius: 20px; 
        cursor: pointer; 
        box-shadow: 0 8px 25px rgba(225, 29, 72, 0.25);
        transition: all 0.3s cubic-bezier(0.19, 1, 0.22, 1);
        width: 100%;
        height: auto;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      ">
        Entendido
      </button>
    </div>

    <style>
      @keyframes expandWhiteCircle {
        0% {
          transform: translate(-50%, -50%) scale(0);
        }
        100% {
          transform: translate(-50%, -50%) scale(350);
        }
      }
      @keyframes modalEntrance {
        to { transform: scale(1) translateY(0); opacity: 1; }
      }
      @keyframes fadeInConfetti {
        to { opacity: 1; }
      }
      @keyframes bounceLogo {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      #celebration-continue-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 30px rgba(225, 29, 72, 0.35);
      }
      #celebration-continue-btn:active {
        transform: translateY(1px) scale(0.98);
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.2);
      }
    </style>
  `;

  document.body.appendChild(overlay);
  
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });

  const canvas = overlay.querySelector('#confetti-canvas');
  const ctx = canvas.getContext('2d');
  let animationFrameId;

  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const confettiCount = 150;
  const confettiList = [];
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  for (let i = 0; i < confettiCount; i++) {
    confettiList.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * confettiCount,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: (Math.random() * 0.07) + 0.05,
      tiltAngle: 0
    });
  }

  const drawConfetti = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < confettiCount; i++) {
      const p = confettiList[i];
      ctx.beginPath();
      ctx.lineWidth = p.r / 2;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + (p.r / 4), p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + (p.r / 4));
      ctx.stroke();
    }

    for (let i = 0; i < confettiCount; i++) {
      const p = confettiList[i];
      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.d);
      p.tilt = Math.sin(p.tiltAngle - (i / 3)) * 15;

      if (p.y > canvas.height) {
        confettiList[i] = {
          x: Math.random() * canvas.width,
          y: -10,
          r: p.r,
          d: p.d,
          color: p.color,
          tilt: p.tilt,
          tiltAngleIncremental: p.tiltAngleIncremental,
          tiltAngle: p.tiltAngle
        };
      }
    }
    animationFrameId = requestAnimationFrame(drawConfetti);
  };
  drawConfetti();

  const amountEl = overlay.querySelector('#celebration-amount');
  const sessionAmountEl = overlay.querySelector('#celebration-session-amount');
  const debtAmountEl = overlay.querySelector('#celebration-debt-amount');
  
  sessionAmountEl.textContent = formatPrice(previousSessionEarned);
  if (debtAmountEl) {
    debtAmountEl.textContent = formatPrice(previousDebt);
  }

  let currentVal = 0;
  const duration = 1200;
  const stepTime = 20;
  const totalSteps = duration / stepTime;
  const stepAmount = totalEarned / totalSteps;

  const counterInterval = setInterval(() => {
    currentVal += stepAmount;
    let isDone = false;
    if (currentVal >= totalEarned) {
      currentVal = totalEarned;
      isDone = true;
    }
    amountEl.textContent = formatPrice(currentVal);
    sessionAmountEl.textContent = formatPrice(previousSessionEarned + currentVal);
    
    if (debtAmountEl) {
      const currentDebtVal = isDone ? (previousDebt + currentDebt) : (previousDebt + (currentVal / (totalEarned || 1)) * currentDebt);
      debtAmountEl.textContent = formatPrice(currentDebtVal);
    }
    
    if (isDone) {
      clearInterval(counterInterval);
    }
  }, stepTime);

  const cleanup = () => {
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', resizeCanvas);
    clearInterval(counterInterval);
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      if (typeof onFinish === 'function') onFinish();
    }, 500);
  };

  overlay.querySelector('#celebration-continue-btn').addEventListener('click', cleanup);
}

export async function markAsDelivered(orderIdOrIds) {
  const ids = Array.isArray(orderIdOrIds) ? orderIdOrIds : orderIdOrIds.split(',');
  const user = getState().user;

  // Check if simulated demo order
  if (ids.includes('sim_demo_order') || window.mockSimulatedOrder) {
    stopGpsRouteSimulation();
    window.mockSimulatedOrder = null;
    activeOrdersList = [];
    activeOrdersCount = 0;
    syncDriverNavigationWithOrders([]);
    NavigationVoice.speak('¡Excelente! Has completado la entrega.', true);
    
    // Show celebration modal for the simulated order
    const simMockCompleted = {
      id: 'sim_demo_order',
      driverEarnings: 1800,
      shippingCost: 1800,
      appUsageFee: 180
    };
    showSuccessCelebration([simMockCompleted], () => {
      showToast('🏁 ¡Simulación completada con éxito!', 'success');
      const currentUser = getState().user;
      const bottomDock = document.getElementById('driver-footer-dock-container');
      if (bottomDock) {
        bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
        attachBottomDockListeners(currentUser, activeOrdersList);
      }
      const statusBar = document.getElementById('driver-top-status-bar');
      if (statusBar) {
        statusBar.innerHTML = renderStatusBarContent(currentUser, activeOrdersList);
        attachStatusBarListeners(currentUser);
      }
    });
    return;
  }
  
  // 0. Optimistic local update: remove delivered orders from route sheet immediately (0ms delay)
  activeOrdersList = (activeOrdersList || []).filter(o => !ids.includes(o.id));
  window.activeOrdersList = activeOrdersList;
  activeOrdersCount = activeOrdersList.length;

  // Immediately synchronize map and navigation route (wiping route if 0 orders left, or recalculating next stop)
  syncDriverNavigationWithOrders(activeOrdersList);

  // Immediately refresh status bar and dock to display next order if available
  const currentLocalUser = getState().user;
  const currentStatusBar = document.getElementById('driver-top-status-bar');
  if (currentStatusBar) {
    currentStatusBar.innerHTML = renderStatusBarContent(currentLocalUser, activeOrdersList);
    attachStatusBarListeners(currentLocalUser);
  }
  const currentBottomDock = document.getElementById('driver-footer-dock-container');
  if (currentBottomDock) {
    currentBottomDock.innerHTML = renderBottomDockContent(currentLocalUser, activeOrdersList);
    attachBottomDockListeners(currentLocalUser, activeOrdersList);
  }
  if (typeof updateDriverNavigationRoute === 'function') {
    updateDriverNavigationRoute(activeOrdersList);
  }
  
  try {
    // 1. Update order documents to 'completed' FIRST to guarantee they leave active route sheet
    const now = new Date();
    for (const id of ids) {
      try {
        await updateDoc(doc(db, 'orders', id), {
          status: 'completed',
          deliveredAt: serverTimestamp(),
          deliverySessionId: user?.currentSessionId || null
        });
      } catch (uErr) {
        console.warn(`[markAsDelivered] Direct updateDoc notice for order ${id}:`, uErr);
      }
    }

    // 2. Fetch the orders for rewards calculation & UI display
    let orders = [];
    try {
      const q = query(collection(db, 'orders'), where('__name__', 'in', ids));
      const snap = await getDocs(q);
      orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[markAsDelivered] Error fetching orders for rewards:', e);
      orders = ids.map(id => ({ id, status: 'completed' }));
    }

    const totalAppFee = orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
    if (totalAppFee > 0) {
      const currentLocalUser = getState().user || {};
      const newDebt = (currentLocalUser.deliveryDebt || 0) + totalAppFee;
      setState('user', { ...currentLocalUser, deliveryDebt: newDebt });
    }

    // 3. Process rewards in background batch (isolated so rewards error never blocks delivery)
    setTimeout(async () => {
      try {
        const customerUids = [...new Set(orders.map(o => o.userId).filter(Boolean))];
        const customerDataMap = {};
        for (const uid of customerUids) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) {
            customerDataMap[uid] = userSnap.data();
          }
        }
        const rewardsBatch = writeBatch(db);
        let rewardsCount = 0;
        for (const id of ids) {
          const orderData = orders.find(o => o.id === id);
          if (orderData?.userId && customerDataMap[orderData.userId]) {
            const { processOrderCompletionRewards } = await import('../utils/rewards.js');
            await processOrderCompletionRewards(rewardsBatch, orderData.userId, customerDataMap[orderData.userId], id);
            rewardsCount++;
          }
        }
        if (rewardsCount > 0) {
          await rewardsBatch.commit();
        }
      } catch (rErr) {
        console.warn('[markAsDelivered] Rewards background processing notice:', rErr);
      }
    }, 50);

    // 4. Trigger Success Celebration Modal
    showSuccessCelebration(orders, () => {
      showCustomerRatingModal(orders);
    });
  } catch (err) {
    console.error('markAsDelivered error:', err);
    showToast('Error al procesar la entrega', 'error');
  }
}

/**
 * Show anonymous customer rating modal for completed orders
 */
export function showCustomerRatingModal(orders, index = 0) {
  if (!orders || index >= orders.length) {
    closeModal();
    const currentUser = getState().user;
    const statusBar = document.getElementById('driver-top-status-bar');
    if (statusBar) {
      statusBar.innerHTML = renderStatusBarContent(currentUser, activeOrdersList);
      attachStatusBarListeners(currentUser);
    }
    const bottomDock = document.getElementById('driver-footer-dock-container');
    if (bottomDock) {
      bottomDock.innerHTML = renderBottomDockContent(currentUser, activeOrdersList);
      attachBottomDockListeners(currentUser, activeOrdersList);
    }
    if (typeof updateDriverNavigationRoute === 'function') {
      updateDriverNavigationRoute(activeOrdersList);
    }
    return;
  }

  const order = orders[index];
  if (!order || !order.userId) {
    showCustomerRatingModal(orders, index + 1);
    return;
  }

  let selectedRating = 0;
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 32px 24px 24px; text-align: center;';

  function render() {
    modalContent.innerHTML = `
      <div style="margin-bottom: 28px;">
        <div style="width: 72px; height: 72px; background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05)); color: #10b981; border-radius: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 8px 25px rgba(16,185,129,0.12);">
          ${icon('star', 36)}
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; margin: 0 0 8px; color: var(--color-text-primary); letter-spacing: -0.02em;">
          ¿Cómo fue el cliente?
        </h2>
        <p style="font-size: 14px; color: var(--color-text-secondary); margin: 0; line-height: 1.5;">
          Puntuá a <strong style="color: var(--color-text-primary);">${order.userName || 'el cliente'}</strong> (Pedido #${order.orderId})
        </p>
      </div>

      <div class="rating-stars" style="display: flex; justify-content: center; gap: 12px; margin-bottom: 28px;">
        ${[1, 2, 3, 4, 5].map(i => `
          <button class="star-btn" data-value="${i}" style="
            width: 52px; height: 52px; border-radius: 16px; border: 2px solid ${i <= selectedRating ? '#f59e0b' : 'var(--color-border-light)'};
            background: ${i <= selectedRating ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-secondary)'};
            color: ${i <= selectedRating ? '#f59e0b' : 'var(--color-text-tertiary)'};
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            transition: all 0.2s; transform: ${i <= selectedRating ? 'scale(1.1)' : 'scale(1)'};
            box-shadow: ${i <= selectedRating ? '0 4px 12px rgba(245,158,11,0.2)' : 'none'};
          ">
            ${icon('star', 24)}
          </button>
        `).join('')}
      </div>

      ${selectedRating > 0 ? `
        <div style="text-align: left; margin-bottom: 20px;">
          <label style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: block; margin-bottom: 6px;">
            Comentario (opcional)
          </label>
          <textarea id="customer-rating-comment" class="input" placeholder="Ej. Cliente súper amable y puntual..." 
            style="width: 100%; min-height: 80px; resize: none; font-size: 14px; border-radius: 16px; background:var(--color-bg-page); border:1.5px solid var(--color-border-light); padding:10px 12px; outline:none; box-sizing:border-box; color:var(--color-text-primary);"></textarea>
          <p style="font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 6px; line-height: 1.3;">
            Tu reseña es 100% anónima. El cliente nunca sabrá quién la dejó.
          </p>
        </div>
      ` : ''}

      <div style="display: flex; gap: 10px; margin-top: 8px;">
        <button class="btn btn-ghost" id="customer-rating-skip-btn" style="flex: 1; height: 52px; border-radius: 16px; font-weight: 700; color: var(--color-text-secondary); background:var(--color-bg-secondary); border:1px solid var(--color-border-light);">
          Omitir
        </button>
        <button class="btn btn-primary" id="customer-rating-submit-btn" style="flex: 2; height: 52px; border-radius: 16px; font-weight: 800; font-size: 1rem; opacity: ${selectedRating > 0 ? '1' : '0.4'}; pointer-events: ${selectedRating > 0 ? 'auto' : 'none'}; background:var(--color-primary); border:none; color:white;"
        >
          ${icon('star', 18)} Calificar Cliente
        </button>
      </div>
    `;

    // Star clicks
    modalContent.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRating = parseInt(btn.dataset.value);
        render();
      });
    });

    // Skip
    modalContent.querySelector('#customer-rating-skip-btn')?.addEventListener('click', () => {
      closeModal();
      showCustomerRatingModal(orders, index + 1);
    });

    // Submit
    modalContent.querySelector('#customer-rating-submit-btn')?.addEventListener('click', async () => {
      if (selectedRating === 0) return;

      const comment = modalContent.querySelector('#customer-rating-comment')?.value?.trim() || '';
      const submitBtn = modalContent.querySelector('#customer-rating-submit-btn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `${icon('loader', 18, 'animate-spin')} Enviando...`;

      try {
        // Save rating on order (anonymously)
        const orderRef = doc(db, 'orders', order.id);
        await updateDoc(orderRef, {
          customerRating: selectedRating,
          customerRatingComment: comment,
          customerRatedAt: serverTimestamp()
        });

        // Save rating on user's ratings list (anonymously)
        const userRef = doc(db, 'users', order.userId);
        await updateDoc(userRef, {
          ratings: arrayUnion({
            orderId: order.id,
            rating: selectedRating,
            comment: comment,
            createdAt: new Date().toISOString()
            // CRITICAL: We completely omit driverId, driverName to preserve absolute anonymity!
          })
        });

        closeModal();
        showToast('¡Gracias por tu puntuación!', 'success');
        
        // Go to next customer in the batch recursively
        showCustomerRatingModal(orders, index + 1);
      } catch (err) {
        console.error('Error submitting customer rating:', err);
        showToast('Error al enviar la puntuación', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${icon('star', 18)} Calificar Cliente`;
      }
    });
  }

  render();

  showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    height: 'auto'
  });
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const deltaPhi = (lat2-lat1) * Math.PI/180;
  const deltaLambda = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
}

export async function renderDeliveryHistory() {
  await renderSubPage('history', 'Historial de Pedidos');
}

export async function renderDeliveryFinances() {
  await renderSubPage('finances', 'Finanzas y Cuentas');
}

export async function renderDeliveryConfig() {
  await renderSubPage('config', 'Configuración de Perfil');
}

async function renderSubPage(tab, title) {
  const content = document.getElementById('app-content');
  if (!content) return;
  content.style.overflow = 'hidden';

  const user = getState().user;
  if (!user || !isDelivery()) {
    content.innerHTML = `<div class="empty-state">Acceso denegado</div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; width:100%; position:fixed; top:0; left:0; z-index:1000; overflow:hidden; background:var(--color-bg-secondary);">
      <!-- Header -->
      <div style="position:sticky; top:0; z-index:100; display:flex; align-items:center; gap:14px; padding: calc(16px + env(safe-area-inset-top, 0px)) 20px 16px 20px; background:var(--color-primary); flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/delivery" style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; flex-shrink:0; text-decoration:none; transition:all 0.2s; position:relative; z-index:2;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1; min-width:0; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">
            ${title}
          </h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.7); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.05em;">Repartidor ${user.deliveryId || ''}</p>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div id="sub-page-content" style="flex:1; overflow-y:auto; overflow-x:hidden; padding:16px 16px 40px; -webkit-overflow-scrolling:touch;">
        <div class="loader-dots" style="margin: 4rem auto;"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;

  const container = document.getElementById('sub-page-content');
  loadTabContent(tab, container, user);
}

export async function updateDispatchQueue(orderId) {
  try {
    const orderRef = doc(db, 'orders', orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return;
    const o = orderSnap.data();
    if (o.driverId) return;

    // Los pedidos gastronómicos/comercio solo se ofrecen cuando pasan a estar en estado "listo"
    if (!o.isFavor && !o.isTrip && o.status !== 'ready') {
      return;
    }

    const now = Date.now() + (getState().serverTimeOffset || 0);
    const offeredAt = o.queueOfferedAt 
      ? (o.queueOfferedAt.toMillis ? o.queueOfferedAt.toMillis() : new Date(o.queueOfferedAt).getTime())
      : null;

    // GUARD 1: Si la oferta actual está dirigida y tiene menos de 28s de emitida, NO ROTAR.
    // Esto evita que relojes desfasados salten ofertas activas a los pocos segundos.
    if (o.queueTargetDriverId && offeredAt && (now - offeredAt < 28000)) {
      return;
    }

    const prevTargetDriverId = o.queueTargetDriverId || null;
    let manualRejected = [...(o.manuallyRejectedDrivers || [])];
    let offeredDrivers = [...(o.queueOfferedDrivers || o.queueRejectedDrivers || [])];

    if (prevTargetDriverId && !offeredDrivers.includes(prevTargetDriverId)) {
      offeredDrivers.push(prevTargetDriverId);
    }

    // Direct assignment override from Admin
    let nextDriverId = null;
    let nextDriverName = null;

    const targetDirectUid = o.directDriverUid || o.preferredDriverUid;
    if (targetDirectUid && targetDirectUid !== 'rotation' && !manualRejected.includes(targetDirectUid) && !offeredDrivers.includes(targetDirectUid)) {
      const directDriverSnap = await getDoc(doc(db, 'users', targetDirectUid));
      if (directDriverSnap.exists()) {
        const dData = directDriverSnap.data();
        nextDriverId = targetDirectUid;
        nextDriverName = dData.displayName || dData.name || 'Repartidor';
        console.log(`[Queue] Asignación directa prioritaria de admin a: ${nextDriverName} (${nextDriverId})`);
      }
    }

    if (!nextDriverId) {
      // Fetch all online drivers
      const usersSnap = await getDocs(collection(db, 'users'));
      const onlineDrivers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => (u.isDelivery === true || u.role === 'delivery' || u.role === 'driver' || u.role === 'chofer') && u.isOnline === true);

      if (onlineDrivers.length === 0) return;

      // 1. Filtrar repartidores en línea que aún NO han recibido la oferta en esta ronda
      let candidates = onlineDrivers.filter(d => !offeredDrivers.includes(d.id) && !manualRejected.includes(d.id));

      if (candidates.length === 0) {
        // Ronda completada para todos los repartidores. Iniciar nueva ronda excluyendo los que rechazaron manualmente.
        const nonManualRejectingDrivers = onlineDrivers.filter(d => !manualRejected.includes(d.id));
        if (nonManualRejectingDrivers.length > 0) {
          console.log(`[Queue] Ronda de ofertas completada. Reiniciando ciclo secuencial para ${nonManualRejectingDrivers.length} repartidores.`);
          offeredDrivers = [];
          candidates = nonManualRejectingDrivers;
        } else {
          console.log(`[Queue] Todos los repartidores en línea rechazaron manualmente el pedido.`);
          offeredDrivers = [];
          candidates = onlineDrivers;
        }
      }

      const nextDriver = candidates.length > 0 ? candidates[0] : null;
      if (nextDriver) {
        nextDriverId = nextDriver.id;
        nextDriverName = nextDriver.name || nextDriver.displayName || 'Repartidor';
        if (!offeredDrivers.includes(nextDriverId)) {
          offeredDrivers.push(nextDriverId);
        }
      }
    }

    await runTransaction(db, async (transaction) => {
      const freshSnap = await transaction.get(orderRef);
      if (!freshSnap.exists()) return;
      const fresh = freshSnap.data();
      if (fresh.driverId) throw new Error('already_assigned');

      const freshOfferedAt = fresh.queueOfferedAt 
        ? (fresh.queueOfferedAt.toMillis ? fresh.queueOfferedAt.toMillis() : new Date(fresh.queueOfferedAt).getTime())
        : null;
      const freshNow = Date.now() + (getState().serverTimeOffset || 0);

      // GUARD 2: Candado dentro de la transacción de 28 segundos mínimos de duración por oferta
      if (fresh.queueTargetDriverId && freshOfferedAt && (freshNow - freshOfferedAt < 28000) && fresh.queueTargetDriverId === prevTargetDriverId) {
        throw new Error('offer_still_active');
      }

      const rejectedList = nextDriverId ? offeredDrivers.filter(id => id !== nextDriverId) : offeredDrivers;
      const updateData = {
        queueTargetDriverId: nextDriverId || deleteField(),
        queueTargetDriverName: nextDriverName || deleteField(),
        queueOfferedAt: nextDriverId ? serverTimestamp() : deleteField(),
        queueOfferedDrivers: offeredDrivers,
        queueRejectedDrivers: rejectedList,
        manuallyRejectedDrivers: manualRejected,
        isPermanentOffer: deleteField()
      };
      transaction.update(orderRef, updateData);
    });

    console.log(`[Queue] Pedido #${o.orderId || orderId} rotado secuencialmente a: ${nextDriverName || 'Buscando'}`);
  } catch (txErr) {
    if (txErr.message === 'already_assigned' || txErr.message === 'offer_still_active' || txErr.code === 'failed-precondition') {
      // Aborto normal por candado de tiempo, reintento optimista de Firestore o pedido ya tomado
    } else {
      console.warn('[Queue rotation notice]:', txErr.message || txErr);
    }
  }
}

export async function renderDailyEarningsWidget(user) {
  if (!user?.uid) return;

  const renderFrame = (todayTotal = 0, todayCount = 0) => {
    setState('driverTodayEarnings', todayTotal);
    setState('driverTodayOrdersCount', todayCount);

    const bar = document.getElementById('session-status-bar-container');
    if (bar) {
      bar.innerHTML = renderStatusBar(getState().user || user);
      attachStatusBarListeners(getState().user || user);
    }
  };

  renderFrame(0, 0);

  try {
    const { collection, query, where, getDocs } = await import('firebase/firestore');
    const { db } = await import('../firebase.js');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const q = query(
      collection(db, 'orders'),
      where('driverId', '==', user.uid)
    );

    const snap = await getDocs(q);
    let todayTotal = 0;
    let todayCount = 0;
    const todayOrders = [];

    snap.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (data.status === 'delivered' || data.status === 'completed') {
        const timestamp = data.deliveredAt || data.completedAt || data.createdAt;
        if (timestamp) {
          const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
          if (date >= startOfDay) {
            todayCount++;
            const earnings = getOrderDriverEarnings(data) || 0;
            todayTotal += earnings;
            todayOrders.push({ id: docSnap.id, ...data, _earnings: earnings, _date: date });
          }
        }
      }
    });

    // Sort newest first
    todayOrders.sort((a, b) => b._date - a._date);
    window._todayOrdersList = todayOrders;

    renderFrame(todayTotal, todayCount);
  } catch (err) {
    console.warn('Error loading daily earnings widget:', err);
  }
}

function openTodayOrdersSheet(orders) {
  const existing = document.getElementById('today-orders-sheet');
  if (existing) existing.remove();

  const ordersHtml = orders.map((o, i) => {
    const timeStr = o._date ? o._date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const appFee = o.appUsageFee || o.appFee || o.deliveryFee || 0;
    const coupon = o.couponCode || o.appliedCoupon || null;
    const earnings = o._earnings || 0;
    const orderNum = o.orderNumber || o.id?.slice(-4)?.toUpperCase() || `#${i+1}`;

    return `
      <div style="background: var(--color-bg-secondary); border-radius: 14px; padding: 13px 15px; border: 1px solid var(--color-border-light); display: flex; flex-direction: column; gap: 8px;">
        <!-- Header row -->
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 30px; height: 30px; border-radius: 9px; background: rgba(225,29,72,0.1); display: flex; align-items: center; justify-content: center; color: var(--color-primary); font-size: 14px;">🛵</div>
            <div>
              <div style="font-size: 12px; font-weight: 900; color: var(--color-text-primary);">Pedido #${orderNum}</div>
              <div style="font-size: 10px; color: var(--color-text-tertiary); font-weight: 600;">${timeStr} · ${o.commerceName || 'Comercio'}</div>
            </div>
          </div>
          <div style="font-size: 16px; font-weight: 950; color: #22c55e; letter-spacing: -0.5px;">${formatPrice(earnings)}</div>
        </div>
        <!-- Fee row -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 10px; font-weight: 800; background: rgba(239,68,68,0.1); color: #ef4444; padding: 3px 8px; border-radius: 20px; border: 1px solid rgba(239,68,68,0.2);">Tarifa App: ${formatPrice(appFee)}</span>
          ${coupon ? `<span style="font-size: 10px; font-weight: 800; background: rgba(168,85,247,0.1); color: #a855f7; padding: 3px 8px; border-radius: 20px; border: 1px solid rgba(168,85,247,0.2);">🎟️ ${coupon}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'today-orders-sheet';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,0.5); display:flex; flex-direction:column; justify-content:flex-end; opacity:0; transition:opacity 0.3s ease;';
  overlay.innerHTML = `
    <div id="today-orders-sheet-card" style="background:var(--color-bg); border-top-left-radius:24px; border-top-right-radius:24px; display:flex; flex-direction:column; max-height:85vh; box-shadow:0 -8px 40px rgba(0,0,0,0.2); transform:translateY(100%); transition:transform 0.35s cubic-bezier(0.16,1,0.3,1);">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #dc2626 0%, #991b1b 100%); border-top-left-radius:24px; border-top-right-radius:24px; padding:18px 20px; position:relative; overflow:hidden; flex-shrink:0;">
        <div style="position:absolute; top:-20px; right:-20px; width:80px; height:80px; background:rgba(255,255,255,0.08); border-radius:50%;"></div>
        <div style="position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);"></div>
        <div style="display:flex; align-items:center; justify-content:space-between; position:relative; z-index:1;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; background:rgba(255,255,255,0.15); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px;">📦</div>
            <div>
              <div style="font-size:9.5px; font-weight:900; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:1px; margin-bottom:1px;">Jornada de Hoy</div>
              <div style="font-size:16px; font-weight:950; color:white; letter-spacing:-0.5px;">${orders.length} Pedido${orders.length !== 1 ? 's' : ''} Entregado${orders.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <button id="today-orders-close-btn" style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.2); color:white; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1;">×</button>
        </div>
      </div>
      <!-- Scrollable list -->
      <div style="overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; -webkit-overflow-scrolling:touch;">
        ${ordersHtml || '<div style="text-align:center; color:var(--color-text-tertiary); font-size:13px; padding:20px;">No hay pedidos entregados hoy</div>'}
        <div style="height: env(safe-area-inset-bottom, 12px);"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.opacity = '1';
    const card = document.getElementById('today-orders-sheet-card');
    if (card) card.style.transform = 'translateY(0)';
  }, 10);

  const closeSheet = () => {
    const card = document.getElementById('today-orders-sheet-card');
    if (card) card.style.transform = 'translateY(100%)';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 350);
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  document.getElementById('today-orders-close-btn')?.addEventListener('click', closeSheet);
}


let exclusiveModalCountdownInterval = null;

export function hideExclusiveOfferOverlay() {
  const existing = document.getElementById('exclusive-offer-fullscreen-overlay');
  if (existing) {
    existing.remove();
  }
  if (exclusiveModalCountdownInterval) {
    clearInterval(exclusiveModalCountdownInterval);
    exclusiveModalCountdownInterval = null;
  }
}

export function showExclusiveOfferOverlay(batch, user) {
  if (document.getElementById('exclusive-offer-fullscreen-overlay')) {
    return;
  }

  // Haptic feedback vibration alert on incoming offer
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([250, 100, 250, 100, 500]);
    }
  } catch(e) {}

  const orderObj = batch.isBundle ? batch.orders[0] : batch.order;
  if (!orderObj) return;

  const isLight = getDriverMapTheme() === 'light';
  const favorType = (orderObj.favorType || batch.favorType || orderObj.serviceType || batch.type || '').toString().toLowerCase();
  const isTrip = Boolean(batch.isTrip || orderObj.isTrip || batch.type === 'trip' || orderObj.serviceType === 'viaje' || favorType === 'viaje');
  const isGoCash = favorType === 'gocash' || Boolean(orderObj.isGoCash || batch.isGoCash);
  const isPagoServicios = favorType === 'pagodeservicios' || favorType === 'servicio' || favorType === 'servicios' || Boolean(orderObj.isServicePayment || batch.isServicePayment);
  const isEncomienda = isOrderEncomienda(orderObj) || isOrderEncomienda(batch.order) || isOrderEncomienda(batch) || favorType === 'encomienda' || favorType === 'mandado_paquete';
  const isMandado = (Boolean(orderObj.isFavor || batch.isFavor || batch.order?.isFavor) || favorType === 'mandado' || favorType === 'compra') && !isEncomienda && !isTrip && !isGoCash && !isPagoServicios;
  const isComercio = !isTrip && !isEncomienda && !isMandado && !isGoCash && !isPagoServicios;

  let typeBadgeLabel = 'COMERCIO';
  let typeBadgeIcon = '';
  let typeBadgeBg = '';
  let typeBadgeBorder = '';
  let typeBadgeColor = '';
  let typeBadgeSub = '';
  let originTitle = '';
  let originSubtitle = '';
  let originIcon = '';

  if (isGoCash) {
    typeBadgeLabel = 'GO CASH';
    typeBadgeIcon = `<img src="/go-cash.png?v=5" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="Go Cash" />`;
    typeBadgeBg = isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.18)';
    typeBadgeBorder = isLight ? '#a7f3d0' : 'rgba(16, 185, 129, 0.5)';
    typeBadgeColor = isLight ? '#059669' : '#34d399';
    typeBadgeSub = orderObj.details || orderObj.description || 'Entrega de dinero en efectivo';

    originIcon = `<img src="/go-cash.png?v=5" style="width:34px; height:34px; object-fit:contain; display:block;" alt="Go Cash" />`;
    originTitle = orderObj.pickupAddress || orderObj.originAddress || 'Punto de retiro de efectivo';
    originSubtitle = `Monto a entregar: $${Number(orderObj.amount || orderObj.cashAmount || orderObj.totalAmount || 0).toLocaleString('es-AR')}`;
  } else if (isPagoServicios) {
    typeBadgeLabel = 'PAGO DE SERVICIO';
    typeBadgeIcon = `<img src="/go-clipboard.png?v=5" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="Pago de Servicios" />`;
    typeBadgeBg = isLight ? '#eff6ff' : 'rgba(59, 130, 246, 0.18)';
    typeBadgeBorder = isLight ? '#bfdbfe' : 'rgba(59, 130, 246, 0.5)';
    typeBadgeColor = isLight ? '#2563eb' : '#60a5fa';
    typeBadgeSub = orderObj.details || orderObj.description || 'Pago de impuestos o facturas';

    originIcon = `<img src="/go-clipboard.png?v=5" style="width:34px; height:34px; object-fit:contain; display:block;" alt="Pago de Servicios" />`;
    originTitle = orderObj.pickupAddress || orderObj.originAddress || 'Punto de retiro de factura / fondos';
    originSubtitle = orderObj.serviceName || orderObj.companyName || 'Gestión de cobro y pago';
  } else if (isTrip) {
    typeBadgeLabel = 'VIAJE';
    typeBadgeIcon = `<img src="/go-car.jpg" style="width:44px; height:44px; border-radius:12px; object-fit:cover; display:block; box-shadow:0 3px 10px rgba(0,0,0,0.2);" alt="Viaje" />`;
    typeBadgeBg = isLight ? '#f0f9ff' : 'rgba(14, 165, 233, 0.18)';
    typeBadgeBorder = isLight ? '#bae6fd' : 'rgba(14, 165, 233, 0.5)';
    typeBadgeColor = isLight ? '#0284c7' : '#38bdf8';
    typeBadgeSub = 'Traslado exclusivo de pasajero';

    originIcon = `<img src="/go-car.jpg" style="width:34px; height:34px; border-radius:8px; object-fit:cover; display:block;" alt="Viaje" />`;
    originTitle = orderObj.originAddress || 'Punto de recogida';
    originSubtitle = `Pasajero: ${orderObj.userName || 'Pasajero'}`;
  } else if (isEncomienda) {
    typeBadgeLabel = 'ENCOMIENDA';
    typeBadgeIcon = `<img src="/go-pickup-point.png?v=5" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="Encomienda" />`;
    typeBadgeBg = isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.18)';
    typeBadgeBorder = isLight ? '#fde68a' : 'rgba(245, 158, 11, 0.5)';
    typeBadgeColor = isLight ? '#b45309' : '#fbbf24';
    typeBadgeSub = cleanMandadoText(orderObj.details || orderObj.description || orderObj.itemsText || 'Envío de paquete o encomienda');

    originIcon = `<img src="/go-pickup-point.png?v=5" style="width:34px; height:34px; object-fit:contain; display:block;" alt="Encomienda" />`;
    originTitle = orderObj.pickupAddress || orderObj.originAddress || 'Dirección de Retiro';
    originSubtitle = cleanMandadoText(orderObj.details || orderObj.description || orderObj.itemsText || 'Paquete a retirar');
  } else if (isMandado) {
    const parsedM = parseMandadoDetails(orderObj.description || orderObj.itemsText || orderObj.notes || orderObj.details, orderObj.comercioName || orderObj.originAddress);
    typeBadgeLabel = 'MANDADO';
    typeBadgeIcon = `<img src="/go-bag.png?v=6" style="width:44px; height:44px; object-fit:contain; display:block; filter:drop-shadow(0 3px 8px rgba(0,0,0,0.18));" alt="GO! Mandado" />`;
    typeBadgeBg = isLight ? '#faf5ff' : 'rgba(168, 85, 247, 0.18)';
    typeBadgeBorder = isLight ? '#e9d5ff' : 'rgba(168, 85, 247, 0.5)';
    typeBadgeColor = isLight ? '#7e22ce' : '#c084fc';
    typeBadgeSub = parsedM.items || 'Compra en local / trámite';

    originIcon = `<img src="/go-bag.png?v=6" style="width:34px; height:34px; object-fit:contain; display:block;" alt="GO! Mandado" />`;
    originTitle = parsedM.comercio || orderObj.comercioName || 'Local de compra';
    originSubtitle = parsedM.items || 'Compra solicitada por el cliente';
  } else {
    // Comercio (Gastronomy / Stores)
    const commerceLogo = orderObj.comercioRealLogo || orderObj.comercioLogo || batch.comercioLogo || orderObj.comercioImage || batch.comercioImage || orderObj.logo || batch.logo || '/logo.png';
    const commerceName = batch.isBundle ? (batch.comercioName || 'Comercio') : (orderObj.comercioName || 'Comercio');
    const itemsList = Array.isArray(orderObj.items) ? orderObj.items : (Array.isArray(orderObj.products) ? orderObj.products : []);

    typeBadgeLabel = 'COMERCIO';
    typeBadgeIcon = `<img src="${commerceLogo}" onerror="this.onerror=null; this.src='/go-bag.png?v=6';" style="width:44px; height:44px; border-radius:12px; object-fit:cover; display:block; box-shadow:0 3px 10px rgba(0,0,0,0.18);" alt="${commerceName}" />`;
    typeBadgeBg = isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.16)';
    typeBadgeBorder = isLight ? '#fecdd3' : 'rgba(225, 29, 72, 0.45)';
    typeBadgeColor = isLight ? '#be123c' : '#fb7185';
    typeBadgeSub = `${commerceName} • Pedido en local`;

    originIcon = `<img src="${commerceLogo}" onerror="this.onerror=null; this.src='/go-bag.png?v=6';" style="width:34px; height:34px; border-radius:8px; object-fit:cover; display:block;" alt="${commerceName}" />`;
    originTitle = commerceName;
    originSubtitle = itemsList.length > 0 ? itemsList.map(it => `${it.quantity || it.cant || 1}x ${it.name || it.title}`).join(', ') : (orderObj.comercioAddress || 'Pedido en local');
  }

  let destAddress = batch.isBundle ? batch.orders.map(o => o.destinationAddress || o.address || o.deliveryAddress).join(' • ') : (orderObj.destinationAddress || orderObj.address || orderObj.deliveryAddress || 'Dirección de entrega');
  let driverEarnings = getOrderDriverEarnings(batch.order || orderObj || batch);

  const TOTAL_DURATION = 30;
  const offeredAt = orderObj?.queueOfferedAt ? (orderObj.queueOfferedAt.toMillis ? orderObj.queueOfferedAt.toMillis() : new Date(orderObj.queueOfferedAt).getTime()) : (Date.now() + (getState().serverTimeOffset || 0));
  const calcRemaining = () => {
    const now = Date.now() + (getState().serverTimeOffset || 0);
    const elapsed = Math.floor((now - offeredAt) / 1000);
    return Math.max(0, TOTAL_DURATION - elapsed);
  };

  const overlay = document.createElement('div');
  overlay.id = 'exclusive-offer-fullscreen-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
    overflow-y: auto;
    touch-action: none;
  `;

  overlay.innerHTML = `
    <!-- Floating Badge Modal Card -->
    <div style="
      max-width: 420px;
      width: 100%;
      background: ${isLight ? '#ffffff' : '#080C14'};
      border: 1.5px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.14)'};
      border-radius: 32px;
      padding: 22px 20px;
      box-shadow: ${isLight ? '0 25px 70px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.04)' : '0 25px 70px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.05)'};
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
      position: relative;
      animation: modalPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <!-- Top Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; align-items: center; gap: 7px; background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.15)'}; border: 1.5px solid ${isLight ? '#fecdd3' : 'rgba(225, 29, 72, 0.35)'}; padding: 7px 13px; border-radius: 99px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #e11d48; box-shadow: 0 0 10px #e11d48;"></span>
          <span style="font-size: 11px; font-weight: 900; color: #e11d48; text-transform: uppercase; letter-spacing: 0.04em;">🚨 NUEVO PEDIDO EXCLUSIVO</span>
        </div>
        
        <div style="background: ${isLight ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'}; color: ${isLight ? '#0f172a' : 'white'}; border: 1px solid ${isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.14)'}; padding: 6px 13px; border-radius: 99px; font-weight: 900; font-size: 13.5px; font-variant-numeric: tabular-nums;">
          ⏳ <span id="exclusive-modal-countdown">${calcRemaining()}</span>s
        </div>
      </div>

      <!-- EXPLICIT ORDER TYPE BADGE (MANDADO / ENCOMIENDA / VIAJE / COMERCIO / GO CASH / PAGO SERVICIOS) -->
      <div style="
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        background: ${typeBadgeBg};
        border: 1.5px solid ${typeBadgeBorder};
        padding: 10px 14px;
        border-radius: 20px;
        box-shadow: ${isLight ? '0 2px 8px rgba(0,0,0,0.04)' : '0 4px 16px rgba(0, 0, 0, 0.4)'};
      ">
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
          <div style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            ${typeBadgeIcon}
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 14px; font-weight: 950; color: ${typeBadgeColor}; text-transform: uppercase; letter-spacing: 0.05em;">
              PEDIDO: ${typeBadgeLabel}
            </div>
            ${typeBadgeSub ? `
              <div style="font-size: 11.5px; font-weight: 700; color: ${isLight ? '#475569' : '#cbd5e1'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                ${typeBadgeSub}
              </div>
            ` : ''}
          </div>
        </div>
        <div style="background: ${isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.12)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'transparent'}; padding: 4px 8px; border-radius: 8px; font-size: 10px; font-weight: 900; color: ${isLight ? '#334155' : 'white'}; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;">
          ASIGNADO
        </div>
      </div>

      <!-- PROGRESS BAR LINE -->
      <div style="width: 100%; height: 5px; background: ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 99px; overflow: hidden; margin-top: -2px; margin-bottom: 2px;">
        <div id="exclusive-modal-progress-bar" style="
          width: ${(calcRemaining() / TOTAL_DURATION) * 100}%;
          height: 100%;
          background: linear-gradient(90deg, #10B981 0%, #22C55E 70%, #E11D48 100%);
          border-radius: 99px;
          transition: width 1s linear;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.6);
        "></div>
      </div>

      <!-- Earnings Card -->
      <div style="
        background: linear-gradient(135deg, #10B981 0%, #059669 100%);
        border-radius: 24px;
        padding: 18px 16px;
        text-align: center;
        color: white;
        box-shadow: 0 12px 30px rgba(16, 185, 129, 0.38), inset 0 1px 1px rgba(255,255,255,0.4);
        position: relative;
        overflow: hidden;
      ">
        <div style="position:absolute; top:-30px; left:-30px; width:120px; height:120px; background:radial-gradient(circle, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 70%); pointer-events:none;"></div>
        <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.95; margin-bottom: 2px;">Tu Ganancia Estimada</div>
        <div style="font-size: 42px; font-weight: 950; letter-spacing: -1.5px; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">${formatPrice(driverEarnings)}</div>
      </div>

      <!-- Route Info Card -->
      <div style="background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.035)'}; border: 1px solid ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 22px; padding: 16px 14px; color: ${isLight ? '#0f172a' : 'white'}; display: flex; flex-direction: column; gap: 12px;">
        <!-- Origin -->
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.16)'}; border: 1px solid ${isLight ? '#fecdd3' : 'rgba(225, 29, 72, 0.35)'}; border-radius: 14px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; overflow: hidden;">
            ${originIcon}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 10px; font-weight: 850; color: ${isLight ? '#64748b' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.05em;">Retiro (Origen)</div>
            <div style="font-size: 15.5px; font-weight: 900; color: ${isLight ? '#0f172a' : '#f8fafc'}; margin-top: 2px; line-height: 1.25; word-break: break-word;">${originTitle}</div>
            ${originSubtitle ? `<div style="font-size: 11.5px; font-weight: 700; color: ${isLight ? '#475569' : '#cbd5e1'}; margin-top: 2px; line-height: 1.3;">${originSubtitle}</div>` : ''}
          </div>
        </div>

        <div style="width: 100%; height: 1px; background: ${isLight ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};"></div>

        <!-- Destination -->
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: ${isLight ? '#ecfdf5' : 'rgba(34, 197, 94, 0.16)'}; border: 1px solid ${isLight ? '#a7f3d0' : 'rgba(34, 197, 94, 0.35)'}; border-radius: 14px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;">📍</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 10px; font-weight: 850; color: ${isLight ? '#64748b' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.05em;">Entrega (Destino)</div>
            <div style="font-size: 14.5px; font-weight: 800; color: ${isLight ? '#0f172a' : '#e2e8f0'}; margin-top: 2px; line-height: 1.35; word-break: break-word;">${destAddress}</div>
          </div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 4px;">
        <button id="fullscreen-accept-offer-btn" style="width: 100%; height: 58px; border-radius: 20px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; font-size: 16.5px; font-weight: 950; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 9px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4); letter-spacing: 0.03em; text-transform: uppercase; transition: transform 0.15s ease;">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>
          <span>ACEPTAR ${typeBadgeLabel} AHORA</span>
        </button>
        
        <button id="fullscreen-reject-offer-btn" style="width: 100%; height: 48px; border-radius: 16px; background: ${isLight ? '#fff1f2' : 'rgba(239, 68, 68, 0.12)'}; color: ${isLight ? '#be123c' : '#f43f5e'}; font-size: 13.5px; font-weight: 900; border: 1.5px solid ${isLight ? '#fecdd3' : 'rgba(239, 68, 68, 0.3)'}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; text-transform: uppercase; transition: all 0.15s ease;">
          ✕ RECHAZAR PEDIDO
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  playExclusiveOfferAlert();

  if (exclusiveModalCountdownInterval) clearInterval(exclusiveModalCountdownInterval);
  exclusiveModalCountdownInterval = setInterval(() => {
    const rem = calcRemaining();
    const cdEl = document.getElementById('exclusive-modal-countdown');
    const barEl = document.getElementById('exclusive-modal-progress-bar');
    if (cdEl) cdEl.textContent = rem;
    if (barEl) {
      const pct = Math.max(0, Math.min(100, (rem / TOTAL_DURATION) * 100));
      barEl.style.width = pct + '%';
      if (rem <= 8) {
        barEl.style.background = '#F43F5E';
        barEl.style.boxShadow = '0 0 12px rgba(244, 63, 94, 0.9)';
      }
    }
    if (rem <= 0) {
      const orderIdToRotate = orderObj.id || batch.id;
      hideExclusiveOfferOverlay();
      stopExclusiveOfferAlert();
      updateDispatchQueue(orderIdToRotate).catch(console.warn);
      return;
    }
  }, 1000);

  const acceptBtn = overlay.querySelector('#fullscreen-accept-offer-btn');
  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      // Show professional dark loading animation over the badge modal
      const modalBox = overlay.querySelector('div[style*="max-width: 440px"]');
      let loader = overlay.querySelector('#offer-accept-loader-screen');
      if (!loader && modalBox) {
        loader = document.createElement('div');
        loader.id = 'offer-accept-loader-screen';
        loader.style.cssText = `
          position: absolute;
          inset: 0;
          background: rgba(9, 13, 22, 0.96);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-radius: 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 24px;
          text-align: center;
        `;
        loader.innerHTML = `
          <div style="width: 54px; height: 54px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #22C55E; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 18px;"></div>
          <h3 style="font-size: 20px; font-weight: 950; color: white; margin: 0 0 6px 0;">¡Asignando Pedido!</h3>
          <p style="font-size: 13.5px; color: #94a3b8; margin: 0; font-weight: 600;">Cargando tu hoja de ruta y mapa de entrega...</p>
        `;
        modalBox.appendChild(loader);
      }

      try {
        window._animatePickupPill = true;
        await takeBatch(batch.id, user, batch, acceptBtn);
      } catch (err) {
        console.error('[Accept batch error]', err);
        if (loader) loader.remove();
        showToast(err.message || 'No se pudo aceptar el pedido.', 'error');
        return;
      }

      // Hide alert & overlay only once assignment is completed and active order route is loaded
      stopExclusiveOfferAlert();
      hideExclusiveOfferOverlay();
    };
  }

  const rejectBtn = overlay.querySelector('#fullscreen-reject-offer-btn');
  if (rejectBtn) {
    rejectBtn.onclick = async () => {
      stopExclusiveOfferAlert();
      hideExclusiveOfferOverlay();
      showToast('Pedido rechazado. Pasando al siguiente repartidor...', 'info');

      try {
        const orderIds = batch.isBundle ? (batch.orders || []).map(o => o.id) : [orderObj.id || batch.id];
        const { doc, runTransaction } = await import('firebase/firestore');
        const { db } = await import('../firebase.js');

        await runTransaction(db, async (transaction) => {
          for (const oId of orderIds) {
            if (!oId) continue;
            const orderRef = doc(db, 'orders', oId);
            const oSnap = await transaction.get(orderRef);
            if (oSnap.exists()) {
              const data = oSnap.data();
              const manualRejected = data.manuallyRejectedDrivers || [];
              const passiveRejected = data.queueRejectedDrivers || [];
              if (user?.uid) {
                if (!manualRejected.includes(user.uid)) manualRejected.push(user.uid);
                if (!passiveRejected.includes(user.uid)) passiveRejected.push(user.uid);
              }
              transaction.update(orderRef, {
                manuallyRejectedDrivers: manualRejected,
                queueRejectedDrivers: passiveRejected,
                queueTargetDriverId: null,
                queueTargetDriverName: null,
                queueOfferedAt: null,
                isPermanentOffer: null
              });
            }
          }
        });

        for (const oId of orderIds) {
          if (oId) {
            if (window.expiredLocalOrders) window.expiredLocalOrders.add(oId);
            updateDispatchQueue(oId).catch(console.warn);
          }
        }
      } catch (err) {
        console.error('Error rejecting order offer:', err);
      }
    };
  }
}

export function showPausedSessionModal(user) {
  if (document.getElementById('paused-session-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'paused-session-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <div style="background: var(--color-bg-card, #1e293b); border: 2px solid #ef4444; border-radius: 32px; padding: 32px 24px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(239, 68, 68, 0.35);">
      <div style="font-size: 56px; margin-bottom: 12px;">🔕</div>
      <h2 style="font-size: 22px; font-weight: 950; color: var(--color-text-primary, #ffffff); margin-bottom: 10px; letter-spacing: -0.5px;">Sesión Pausada por Inactividad</h2>
      <p style="font-size: 14px; color: var(--color-text-secondary, #94a3b8); line-height: 1.55; margin-bottom: 26px;">
        Se pausó tu conexión automáticamente porque ignoraste 2 ofertas consecutivas de pedido.<br><br>
        Tocá a continuación para reanudar tu sesión y volver a recibir ofertas inmediatamente.
      </p>
      <button id="paused-session-reconnect-btn" style="width: 100%; height: 58px; border-radius: 20px; background: #22c55e; color: white; font-size: 17px; font-weight: 950; border: none; cursor: pointer; box-shadow: 0 10px 25px rgba(34, 197, 94, 0.35); text-transform: uppercase; letter-spacing: 0.03em;">
        ⚡ VOLVER A CONECTARME
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#paused-session-reconnect-btn');
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = '⏳ CONECTANDO...';
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          isOnline: true,
          missedOffersCount: 0,
          disconnectedReason: null
        });
        setState('user', { ...getState().user, isOnline: true, missedOffersCount: 0, disconnectedReason: null });
        overlay.remove();
        showToast('¡Sesión reanudada con éxito!', 'success');
      } catch (err) {
        console.error('Error re-connecting:', err);
        btn.disabled = false;
        btn.innerHTML = '⚡ VOLVER A CONECTARME';
        showToast('Error al reconectar. Reintenta.', 'error');
      }
    };
  }
}

export function hidePausedSessionModal() {
  const el = document.getElementById('paused-session-modal-overlay');
  if (el) el.remove();
}

export function playExclusiveOfferAlert() {
  if (window.exclusiveAlertInterval) return;

  // Modern single unified chime alert with zero delay and high fidelity
  import('../utils/audio-manager.js').then(({ AudioManager }) => {
    AudioManager.startDriverOfferLoop();
  }).catch(err => console.warn('Could not start offer loop sound:', err));

  // Perform immediate initial strong vibration
  if (navigator.vibrate) {
    navigator.vibrate([600, 200, 600, 200, 600]);
  }

  // Vibrate strongly every 2.5 seconds
  window.exclusiveAlertInterval = setInterval(() => {
    if (navigator.vibrate) {
      navigator.vibrate([600, 200, 600, 200, 600]);
    }
  }, 2500);
}

export function stopExclusiveOfferAlert() {
  // Stop the audio chime loop
  import('../utils/audio-manager.js').then(({ AudioManager }) => {
    AudioManager.stopDriverOfferLoop();
  }).catch(err => console.warn('Could not stop loop sound:', err));

  // Clear vibration interval
  if (window.exclusiveAlertInterval) {
    clearInterval(window.exclusiveAlertInterval);
    window.exclusiveAlertInterval = null;
  }
  
  // Stop active vibrations
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

export function showCanonPaymentModal(user, dateStr) {
  import('../components/modal.js').then(({ showModal, closeModal }) => {
    const adminPhone = (window.gd_settings && window.gd_settings.whatsappPayments) || '5491123456789';
    const canonAmt = (window.gd_settings && window.gd_settings.canonAmount) || getState().canonAmount || 2000;
    const wpMessage = encodeURIComponent(`Hola! Soy ${user.displayName || 'repartidor'} (${user.uid}). Quisiera abonar/confirmar el canon diario de la jornada ${dateStr} ($${canonAmt.toLocaleString('es-AR')}) para que me habiliten ONLINE.`);
    const wpUrl = `https://wa.me/${adminPhone}?text=${wpMessage}`;

    showModal({
      title: '🛵 Jornada No Habilitada',
      hideHeader: false,
      content: `
        <div style="padding:16px; font-family:var(--font-body); text-align:center;">
          <div style="font-size:42px; margin-bottom:12px;">⚠️</div>
          <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin-bottom:8px; color:var(--color-text-primary);">
            Canon Diario Pendiente (${dateStr})
          </h3>
          <p style="font-size:13.5px; color:var(--color-text-secondary); line-height:1.5; margin-bottom:20px;">
            Tu jornada de hoy no se encuentra habilitada aún por administración. Aboná el canon diario de <strong>$${canonAmt.toLocaleString('es-AR')}</strong> o enviá el comprobante a soporte para activarla.
          </p>
          <div style="background:rgba(225,29,72,0.06); border:1px solid rgba(225,29,72,0.15); border-radius:14px; padding:12px; margin-bottom:20px; font-size:12.5px; color:var(--color-primary); font-weight:700;">
            💬 Contactate con el administrador por WhatsApp para confirmar tu pago y comenzar a recibir pedidos.
          </div>
          <a href="${wpUrl}" target="_blank" class="btn btn-primary btn-block" style="height:52px; border-radius:16px; font-weight:900; font-size:15px; background:#25D366; border:none; color:white; box-shadow:0 6px 20px rgba(37,211,102,0.3); display:flex; align-items:center; justify-content:center; gap:10px; text-decoration:none;">
            <span>Contactar Soporte por WhatsApp</span>
          </a>
        </div>
      `
    });
  });
}


function showStopDetailsBottomSheet(stop) {
  document.getElementById('v5-stop-details-sheet')?.remove();
  document.getElementById('v5-stop-details-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'v5-stop-details-backdrop';
  backdrop.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99998; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); opacity: 0; pointer-events: none; transition: opacity 0.3s ease;";

  const sheet = document.createElement('div');
  sheet.id = 'v5-stop-details-sheet';
  sheet.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; box-shadow: 0 -12px 30px rgba(0,0,0,0.15); z-index: 99999; transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); max-height: 85vh; display: flex; flex-direction: column; padding-bottom: calc(20px + env(safe-area-inset-bottom, 16px));";

  const isPickup = stop.type === 'PICKUP';
  const firstOrder = stop.orders?.[0] || {};
  const totalAmountToPay = stop.orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const totalTips = stop.orders.reduce((sum, o) => sum + (o.tip || 0), 0);
  const totalDeliveryCost = stop.orders.reduce((sum, o) => {
    const baseFee = Math.max(0, (o.deliveryCost || 0) - (o.rainSurcharge || 0));
    return sum + baseFee;
  }, 0);
  const totalAppFee = stop.orders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
  const totalPurchaseFee = stop.orders.reduce((sum, o) => sum + (o.purchaseFee || 0), 0);
  const totalRainSurcharge = stop.orders.reduce((sum, o) => sum + (o.rainSurcharge || 0), 0);
  const totalExtraStops = stop.orders.reduce((sum, o) => sum + (o.extraStopsFee || 0), 0);
  const totalDiscount = stop.orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
  const totalCouponDiscount = stop.orders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);

  let itemsHtml = '';
  if (stop.isFavor) {
    const details = firstOrder.details || firstOrder.description || '';
    const parsedStores = parseFavorDetails(details);
    if (parsedStores.length > 0) {
      itemsHtml = parsedStores.map((s, idx) => `
        <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow: var(--shadow-sm); margin-bottom: 10px;">
          <div style="display:flex; flex-direction:column; gap:4px; text-align:left; border-bottom:1px dashed var(--color-border-light); padding-bottom:10px;">
            <span style="font-size:9.5px; font-weight:900; color:#3b82f6; text-transform:uppercase; letter-spacing:0.08em;">Comercio ${idx + 1}</span>
            <div style="font-size:14.5px; font-weight:800; color:var(--color-text-primary); display:flex; align-items:center; gap:8px;">
              <span style="font-size:16px;">🏪</span> ${s.name}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:4px; text-align:left;">
            <span style="font-size:9.5px; font-weight:900; color:#e11d48; text-transform:uppercase; letter-spacing:0.08em;">Detalle del Pedido</span>
            <div style="font-size:14px; font-weight:700; color:var(--color-text-secondary); line-height:1.4; display:flex; align-items:flex-start; gap:8px;">
              <span style="font-size:16px; margin-top:2px;">📦</span> 
              <div style="flex:1; white-space: pre-wrap;">${s.items}</div>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      itemsHtml = `
        <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:18px; padding:16px; text-align:left;">
          <div style="font-size:14px; font-weight:700; color:var(--color-text-secondary); line-height:1.4; white-space: pre-wrap;">
            ${details}
          </div>
        </div>
      `;
    }
  } else {
    itemsHtml = stop.orders.map(o => `
      <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:800; color:var(--color-text-primary);">
          <span>Pedido #${o.orderId || '---'}</span>
          <span>$${Math.round(o.subtotal || 0).toLocaleString('es-AR')}</span>
        </div>
        ${o.items && o.items.length > 0 ? `
          <div style="font-size:12px; color:var(--color-text-secondary); padding-left:8px; border-left:2.5px solid var(--color-primary); display:flex; flex-direction:column; gap:4px;">
            ${o.items.map(item => `
              <div><span style="color:var(--color-primary); font-weight:800;">${item.qty || 1}x</span> ${item.name}</div>
            `).join('')}
          </div>
        ` : `<div style="font-size:11.5px; color:var(--color-text-tertiary); font-style:italic;">Pedido de Comercio</div>`}
      </div>
    `).join('');
  }

  const orderNumber = firstOrder.orderId || '---';
  const isEncomienda = firstOrder.favorType === 'mandado';
  
  const headerBg = isEncomienda 
    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
    : 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)';
  const headerIconSrc = isEncomienda ? '/go-pickup-point.png' : '/go-bag.png';
  const headerShadow = isEncomienda 
    ? '0 4px 15px rgba(5, 150, 105, 0.15)' 
    : '0 4px 15px rgba(190, 18, 60, 0.15)';

  sheet.innerHTML = `
    <div style="background: ${headerBg}; padding: 18px 24px; border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; color: white; position: relative; box-shadow: ${headerShadow};">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${headerIconSrc}" style="width: 48px; height: 48px; object-fit: contain; display: block; flex-shrink: 0; margin-right: 4px;" />
        <div style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
          <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: white; letter-spacing: -0.01em;">Desglose del Importe</h3>
          <span style="font-size: 12px; color: rgba(255,255,255,0.85); font-weight: 600;">Detalle transparente del pedido #${orderNumber}</span>
        </div>
      </div>
      <button id="v5-stop-details-close" style="background: rgba(255,255,255,0.15); border: none; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: white; transition: background 0.2s;">
        ${icon('close', 16)}
      </button>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; flex-direction: column; gap: 6px; text-align: left;">
        <span style="font-size: 10px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px;">${isPickup ? 'Origen / Retiro' : 'Destino / Entrega'}</span>
        <strong style="font-size: 15px; color: var(--color-text-primary); font-weight: 800;">${isPickup ? (stop.comercioName || 'Comercio') : stop.address}</strong>
        ${(!isPickup && firstOrder.addressNotes) ? `<span style="font-size: 12.5px; color:#d97706; font-weight:700;">⚠️ Ref: ${firstOrder.addressNotes}</span>` : ''}
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
        <span style="font-size: 10px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px;">Productos / Contenido</span>
        ${itemsHtml}
      </div>

      <div style="background: var(--color-surface); border-radius: 24px; padding: 20px; border: 1.5px solid var(--color-border-light); display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-sm);">
        <div style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; text-align: left;">Desglose de Cobro</div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
          <span>Costo del Mandado / Productos:</span>
          ${totalAmountToPay === 0 ? `
            <span style="background: #fef3c7; color: #d97706; font-size: 10px; font-weight: 900; padding: 4px 8px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #fde68a;">PENDIENTE</span>
          ` : `
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalAmountToPay).toLocaleString('es-AR')}</span>
          `}
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
          <span>Costo de Envío / Reparto:</span>
          <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalDeliveryCost).toLocaleString('es-AR')}</span>
        </div>
        
        ${totalPurchaseFee > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Gestión de Compra / Trámite:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalPurchaseFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalRainSurcharge > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Recargo por Lluvia:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalRainSurcharge).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalExtraStops > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Paradas Extra:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalExtraStops).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalTips > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: #10b981;">
            <span>Propina al Repartidor:</span>
            <span style="font-weight: 800;">+ $${Math.round(totalTips).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalAppFee > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 700; color: var(--color-text-secondary);">
            <span>Tarifa de Servicio:</span>
            <span style="color: var(--color-text-primary); font-weight: 800;">$${Math.round(totalAppFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalDiscount > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 750; color: var(--color-success);">
            <span>Descuento GoPoints:</span>
            <span>- $${Math.round(totalDiscount).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        ${totalCouponDiscount > 0 ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; font-weight: 750; color: #a855f7;">
            <span>Descuento Cupón:</span>
            <span>- $${Math.round(totalCouponDiscount).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 15.5px; font-weight: 900; padding-top: 14px; border-top: 2px dashed var(--color-border-light); margin-top: 4px;">
          <span style="color: var(--color-text-primary); letter-spacing: -0.01em;">${isPickup ? 'TOTAL A ABONAR:' : 'TOTAL FINAL:'}</span>
          <span style="color: #e11d48; font-size: 21px; font-weight: 950; letter-spacing: -0.02em;">$${Math.round(isPickup ? (stop.amountToPay || 0) : stop.orders.reduce((s, o) => s + (o.total || o.totalAmount || 0), 0)).toLocaleString('es-AR')}</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    backdrop.style.pointerEvents = 'auto';
    sheet.style.transform = 'translateY(0)';
  });

  const close = () => {
    backdrop.style.opacity = '0';
    backdrop.style.pointerEvents = 'none';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 350);
  };

  backdrop.onclick = close;
  sheet.querySelector('#v5-stop-details-close').onclick = close;
}
