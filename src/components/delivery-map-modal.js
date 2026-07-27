// GoDelivery — Delivery Map Modal Component (Premium Google Maps Route)
import { showModal, closeModal } from './modal.js';
import { icon } from '../utils/icons.js';
import { db } from '../firebase.js';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

let googleMap = null;
let riderMarker = null;
let destinationMarkers = [];
let routeLine = null;
let watchId = null;
let resolvedStores = []; // Cache to avoid multiple Firestore fetches

// OSRM throttle state
let _lastOsrmFetchTime = 0;
let _lastOsrmStart = null;
let _riderAngle = 0; // Smooth bearing state for rider marker

export function isOrderGeolocalizablePickup(o) {
  if (!o) return false;
  if (!o.isFavor) return true; // Standard orders are always geolocalizable
  
  // GoFavores (using favorType or type field from Firestore):
  const fType = o.favorType || o.type;
  if (fType === 'gocash') return false; // Go Cash has no pickup point
  if (fType === 'compra') return false; // Mandado / Compra has no pickup point
  if (fType === 'pagodeservicios' && o.receiptDeliveryType === 'digital') return false; // Digital bill payment
  
  return true; // Encomienda (favorType: 'mandado') and physical bill payments are geolocalizable
}

export function showDeliveryMapModal(order, batch = null) {
  if (order.status === 'completed' || order.status === 'cancelled') {
    import('./toast.js').then(m => m.showToast('Este pedido ya ha finalizado.', 'info'));
    return;
  }
  if (watchId) navigator.geolocation.clearWatch(watchId);
  cleanupMap();

  const orders = batch || [order];
  const modalContent = document.createElement('div');
  modalContent.className = 'tracking-v5-viewport';

  modalContent.innerHTML = `
    <div class="v5-header-overlay">
      <button id="close-delivery-map-btn" class="v5-back-btn">${icon('chevronLeft', 24)}</button>
      <div class="v5-live-pill">
        <span class="v5-pulse-dot"></span> RUTA EN CURSO
      </div>
    </div>
    
    <div style="flex:1; background: var(--color-bg-secondary); position:relative;">
      <div id="delivery-map-container" style="position:absolute; inset:0;"></div>
      <button id="center-on-me-btn" class="v5-recenter-btn-premium">
        ${icon('navigationArrow', 22)}
      </button>
    </div>

    <div id="bottom-info-panel" class="v5-info-panel-v2">
      <div style="padding:40px; text-align:center; color:var(--color-text-tertiary);">Cargando información...</div>
    </div>

    <style>
      .tracking-v5-viewport { height: 100%; display: flex; flex-direction: column; background: var(--color-bg-secondary); overflow: hidden; position: relative; }
      .v5-header-overlay { position: absolute; top: max(16px, env(safe-area-inset-top)); left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: center; z-index: 100; pointer-events: none; }
      .v5-back-btn { pointer-events: auto; width: 44px; height: 44px; background: var(--color-surface); border-radius: 14px; display: flex; align-items: center; justify-content: center; color: var(--color-text); box-shadow: var(--shadow-md); border: 1px solid var(--color-border); cursor: pointer; }
      .v5-live-pill { background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); padding: 8px 14px; border-radius: 100px; display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 11px; color: var(--color-primary); box-shadow: var(--shadow-sm); border: 1px solid var(--glass-border); }
      .v5-pulse-dot { width: 7px; height: 7px; background: var(--color-primary); border-radius: 50%; animation: pulse-v5 1.5s infinite; }
      
      .v5-recenter-btn-premium { position: absolute; top: 76px; right: 16px; z-index: 100; width: 50px; height: 50px; background: var(--color-surface); border-radius: 16px; border: 1px solid var(--color-border); display: flex; align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; box-shadow: var(--shadow-lg); }
      
      .v5-info-panel-v2 { background: var(--color-surface); border-radius: 28px 28px 0 0; padding: 24px; z-index: 100; box-shadow: 0 -10px 40px rgba(0,0,0,0.1); display: flex; flex-direction: column; gap: 16px; border-top: 1px solid var(--color-border-light); }
      
      @keyframes pulse-v5 { 0% { transform: scale(0.9); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.5; } 100% { transform: scale(0.9); opacity: 1; } }
      .v5-marker-shadow { filter: drop-shadow(0 4px 10px rgba(0,0,0,0.2)); }
    </style>
  `;

  showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    fullscreen: true,
    onOpen: () => {
      initDeliveryMap(order, orders);
      setTimeout(() => updateBottomPanel(order, orders), 100);
    },
    onClose: () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
      cleanupMap();
    }
  });

  document.getElementById('close-delivery-map-btn').onclick = () => closeModal();
}

function updateBottomPanel(order, batch) {
  const panel = document.getElementById('bottom-info-panel');
  if (!panel) return;

  const isPickedUp = !!order.pickedUpAt || order.status === 'picked_up' || order.status === 'delivered';
  const hasGeolocPickup = isOrderGeolocalizablePickup(order);
  const label = isPickedUp ? 'Punto de entrega' : `Retirar en: ${order.comercioName || 'Comercio'}`;
  const iconName = isPickedUp ? 'mapPin' : 'store';
  
  let address = '';
  if (isPickedUp) {
    address = order.deliveryAddress;
  } else {
    if (hasGeolocPickup) {
      address = order.pickupAddress || order.comercioAddress || 'Cargando dirección...';
    } else {
      const fType = order.favorType || order.type;
      if (fType === 'gocash') {
        address = 'Intercambio de Efectivo (Go Cash) — Sin retiro físico';
      } else if (fType === 'pagodeservicios' && order.receiptDeliveryType === 'digital') {
        address = 'Pago de Servicio Digital — Sin retiro físico';
      } else {
        address = `${order.pickupAddress || 'Mandado'} (Dirección no geolocalizable)`;
      }
    }
  }

  const userName = order.userName || 'Cliente';
  
  const formatPrice = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(val || 0);
  const serviceFee = order.appUsageFee || order.serviceFee || order.platformFee || 0;
  const pFee = order.purchaseFee || (order.isFavor && order.favorType === 'compra' ? 800 : 0);
  const finalTotal = (order.subtotal || 0) + (order.deliveryCost || 0) + serviceFee + pFee;

  panel.innerHTML = `
    ${!isPickedUp && !hasGeolocPickup ? `
      <div style="background:rgba(245, 158, 11, 0.12); border:1px solid rgba(245, 158, 11, 0.3); color:#d97706; padding:12px 16px; border-radius:16px; font-size:12.5px; font-weight:800; display:flex; align-items:center; gap:10px; line-height:1.4; margin-bottom:4px;">
        <span style="font-size:18px;">⚠️</span>
        <div style="text-align:left;">
          <strong>Trámite sin punto en mapa:</strong>
          <span style="font-weight:600; display:block; font-size:11.5px; margin-top:2px;">Este pedido se gestiona digitalmente o no tiene ubicación de retiro exacta. Revisa los detalles.</span>
        </div>
      </div>
    ` : ''}

    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="flex:1; min-width:0; padding-right:12px; text-align:left;">
        <div style="font-size:11px; font-weight:800; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${label}</div>
        <h3 style="font-size:22px; font-weight:950; color:var(--color-text); margin:0; letter-spacing:-0.5px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${isPickedUp ? userName : (order.comercioName || 'Comercio')}</h3>
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div style="font-size:9px; font-weight:900; background:var(--color-bg-secondary); padding:4px 10px; border-radius:8px; color:var(--color-text-tertiary); border:1px solid var(--color-border-light); display:inline-block;">#${String(order.orderId || order.id || '').slice(-4).toUpperCase()}</div>
        <div id="v5-distance-badge" style="font-size:12px; color:var(--color-success); font-weight:800; margin-top:8px; display:flex; align-items:center; justify-content:flex-end; gap:4px; white-space:nowrap;">
          ${icon('clock', 13)} <span id="v5-distance-text">Buscando GPS...</span>
        </div>
      </div>
    </div>

    <div style="display:flex; align-items:center; gap:12px; padding:16px; background:var(--color-bg-secondary); border-radius:20px; border:1px solid var(--color-border-light); position:relative;">
      <div style="width:42px; height:42px; border-radius:12px; background:var(--color-surface); display:flex; align-items:center; justify-content:center; color:var(--color-primary); border:1px solid var(--color-border); flex-shrink:0;">
        ${icon(iconName, 22)}
      </div>
      <div style="flex:1; min-width:0; text-align:left;">
        <p style="margin:0; font-size:14px; font-weight:700; color:var(--color-text-secondary); line-height:1.4; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${address}</p>
      </div>
      <button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}', '_blank')" style="width:40px; height:40px; border-radius:12px; border:none; background:var(--color-primary-light); color:var(--color-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
        ${icon('navigationArrow', 18)}
      </button>
    </div>

    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; padding:14px; background:rgba(var(--color-primary-rgb), 0.04); border-radius:18px; border:1px dashed rgba(var(--color-primary-rgb), 0.2);">
      <div style="text-align:center;">
        <div style="font-size:7px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:2px;">Subtotal</div>
        <div style="font-size:10px; font-weight:800; color:var(--color-text-secondary);">${formatPrice(order.subtotal)}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:7px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:2px;">Envío</div>
        <div style="font-size:10px; font-weight:800; color:var(--color-text-secondary);">${formatPrice(order.deliveryCost)}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:7px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:2px;">Servicio</div>
        <div style="font-size:10px; font-weight:800; color:var(--color-text-secondary);">${formatPrice(serviceFee)}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:7px; font-weight:800; color:var(--color-primary); text-transform:uppercase; margin-bottom:2px;">Cobrar</div>
        <div style="font-size:12px; font-weight:950; color:var(--color-text);">${formatPrice(finalTotal)}</div>
      </div>
    </div>

    <button id="close-delivery-map-bottom-btn" style="width:100%; height:60px; border-radius:20px; font-weight:950; border:none; color:white; cursor:pointer; background:var(--color-primary); box-shadow: 0 10px 30px rgba(var(--color-primary-rgb), 0.35); font-size:16px; letter-spacing:0.02em; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:10px; margin-top:4px;">
      VOLVER AL PANEL
    </button>
  `;
  document.getElementById('close-delivery-map-bottom-btn').onclick = () => closeModal();
}

function cleanupMap() {
  if (window._liveMapUnsubs) {
    window._liveMapUnsubs.forEach(unsub => { try { unsub(); } catch (e) {} });
    window._liveMapUnsubs = [];
  }
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (riderMarker) riderMarker.setMap(null);
  destinationMarkers.forEach(m => { if(m.setMap) m.setMap(null); });
  if (routeLine) routeLine.setMap(null);
  googleMap = null;
  riderMarker = null;
  destinationMarkers = [];
  routeLine = null;
  resolvedStores = [];
  window._hasRealGps = false;
  window._firstFit = false;
  _lastOsrmFetchTime = 0;
  _lastOsrmStart = null;
  _riderAngle = 0;
}

async function initDeliveryMap(order, orders) {
  if (typeof google === 'undefined') return;
  const container = document.getElementById('delivery-map-container');
  if (!container) return;

  let destCoords = order.deliveryCoords || null;

  // Fallback Geocoding if deliveryCoords is missing but deliveryAddress text is present
  if ((!destCoords || (!destCoords.lat && !destCoords.lng)) && order.deliveryAddress && typeof google !== 'undefined' && google.maps.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const addressQuery = order.deliveryAddress.toLowerCase().includes('magdalena') 
        ? order.deliveryAddress 
        : `${order.deliveryAddress}, Magdalena, Buenos Aires, Argentina`;
      
      const geoResult = await new Promise((resolve) => {
        geocoder.geocode({ address: addressQuery }, (results, status) => {
          if (status === 'OK' && results[0]) {
            const loc = results[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else {
            resolve(null);
          }
        });
      });
      if (geoResult) {
        destCoords = geoResult;
      }
    } catch (e) {
      console.warn('Geocoding fallback failed for address:', order.deliveryAddress, e);
    }
  }

  if (!destCoords) {
    destCoords = { lat: -35.0833, lng: -57.65 };
  }

  const theme = document.documentElement.getAttribute('data-theme') || 'light';

  googleMap = new google.maps.Map(container, {
    zoom: 14,
    center: destCoords,
    disableDefaultUI: true,
    styles: theme === 'dark' ? getDarkStyles() : [],
    gestureHandling: 'greedy'
  });

  // Hotspots: Draw glowing red overlay circles for active orders
  (async () => {
    try {
      const { collection, query, getDocs, limit } = await import('firebase/firestore');
      const ordersSnap = await getDocs(query(collection(db, 'orders'), limit(40)));
      ordersSnap.docs.forEach(docSnap => {
        const ord = docSnap.data();
        const lat = ord.comercioCoords?.lat || ord.comercioCoords?.latitude;
        const lng = ord.comercioCoords?.lng || ord.comercioCoords?.longitude;
        if (lat && lng) {
          new google.maps.Circle({
            strokeColor: '#ef4444',
            strokeOpacity: 0.25,
            strokeWeight: 0,
            fillColor: '#ef4444',
            fillOpacity: 0.12,
            map: googleMap,
            center: { lat, lng },
            radius: 200
          });
        }
      });
    } catch (e) {
      console.error('Error drawing hotspots:', e);
    }
  })();

  // 1. Build unified stops sequence to assign sequential step numbers
  const stopsSequence = [];
  const storeSet = new Set();
  const deliverySet = new Set();
  resolvedStores = [];

  for (const o of orders) {
    const geoloc = isOrderGeolocalizablePickup(o);
    if (!geoloc) continue;

    if (o.isFavor) {
      const coords = o.pickupCoords || { lat: -35.0811, lng: -57.5146 };
      const isPickedUp = !!o.pickedUpAt || o.status === 'picked_up' || o.status === 'delivered';
      const key = `favor-${o.id}`;
      if (!storeSet.has(key)) {
        storeSet.add(key);
        stopsSequence.push({
          type: 'PICKUP',
          coords: coords,
          iconName: o.favorType === 'mandado' ? 'mapPin' : 'store',
          isPickedUp,
          orderRef: o
        });
        resolvedStores.push({ ...coords, id: key, isPickedUp });
      }
    } else if (o.comercioId) {
      let coords = o.comercioCoords;
      if (!coords || !o.comercioAddress) {
        try {
          const cSnap = await getDoc(doc(db, 'comercios', o.comercioId));
          if (cSnap.exists()) {
            const data = cSnap.data();
            coords = data.coords;
            o.comercioAddress = data.address;
            if (o.id === order.id) updateBottomPanel(order, orders);
          }
        } catch (err) { console.warn('Commerce fetch error:', err); }
      }
      if (coords && !storeSet.has(o.comercioId)) {
        const isPickedUp = !!o.pickedUpAt || o.status === 'picked_up' || o.status === 'delivered';
        storeSet.add(o.comercioId);
        stopsSequence.push({
          type: 'PICKUP',
          coords,
          iconName: isPickedUp ? 'check' : 'store',
          isPickedUp,
          orderRef: o
        });
        resolvedStores.push({ ...coords, id: o.comercioId, isPickedUp });
      }
    }
  }

  for (const o of orders) {
    const deliveryCoords = o.deliveryCoords || destCoords;
    const key = `${deliveryCoords.lat},${deliveryCoords.lng}`;
    if (!deliverySet.has(key)) {
      deliverySet.add(key);
      const isPickedUp = !!o.pickedUpAt || o.status === 'picked_up' || o.status === 'delivered';
      stopsSequence.push({
        type: 'DROP_OFF',
        coords: deliveryCoords,
        iconName: 'home',
        isPickedUp,
        orderRef: o
      });
    }
  }

  stopsSequence.forEach((stop, index) => {
    const stopNumber = index + 1;
    let color = '';
    if (stop.type === 'PICKUP') {
      color = stop.isPickedUp ? '#94a3b8' : '#f59e0b';
    } else {
      color = stop.isPickedUp ? '#10b981' : '#94a3b8';
    }

    const stopOrders = orders.filter(x => {
      if (stop.type === 'PICKUP') {
        return stop.orderRef.isFavor ? (x.id === stop.orderRef.id) : (x.comercioId === stop.orderRef.comercioId);
      } else {
        const deliveryCoords = x.deliveryCoords || destCoords;
        return (deliveryCoords.lat === stop.coords.lat && deliveryCoords.lng === stop.coords.lng);
      }
    });
    const clientName = stopOrders.map(x => (x.userName || 'Cliente').split(' ')[0]).join(' + ');

    addOverlayMarker(stop.coords, stop.iconName, color, stop.type === 'PICKUP' ? stop.isPickedUp : false, stopNumber, clientName);
  });
  
  // Initial check of driver location stored on the order document
  if (order.driverLocation && order.driverLocation.lat && order.driverLocation.lng) {
    updateRiderLocation(order.driverLocation.lat, order.driverLocation.lng, destCoords, orders);
  }

  // ─── Real-time Firestore listeners (ONLY source of rider position — never viewer GPS) ───

  // Primary: driverLocation field on the order document (written by background-tracking.js)
  const orderUnsub = onSnapshot(doc(db, 'orders', order.id), (snap) => {
    if (!snap.exists()) return;
    const liveData = snap.data();
    const driverLoc = liveData.driverLocation;
    if (driverLoc && driverLoc.lat && driverLoc.lng) {
      updateRiderLocation(driverLoc.lat, driverLoc.lng, destCoords, orders);
    }
  });

  // Secondary: currentLocation field on the driver's user document (backup stream)
  let driverUnsub = null;
  if (order.driverId) {
    driverUnsub = onSnapshot(doc(db, 'users', order.driverId), (snap) => {
      if (!snap.exists()) return;
      const dData = snap.data();
      const loc = dData.currentLocation || dData.location;
      if (loc && loc.lat && loc.lng) {
        // Only use user doc if order doc hasn't delivered a position yet
        if (!window._hasRealGps) {
          updateRiderLocation(loc.lat, loc.lng, destCoords, orders);
        }
      }
    });
  }

  window._liveMapUnsubs = [orderUnsub, ...(driverUnsub ? [driverUnsub] : [])];

  // NOTE: Viewer's own GPS is NEVER used here — the map shows the rider's position, not the admin's.

  const centerBtn = document.getElementById('center-on-me-btn');
  if (centerBtn) {
    centerBtn.onclick = () => {
      if (googleMap && routeLine) {
        const bounds = new google.maps.LatLngBounds();
        routeLine.getPath().forEach(p => bounds.extend(p));
        googleMap.fitBounds(bounds, { top: 100, bottom: 250, left: 60, right: 60 });
      }
    };
  }
}

function addOverlayMarker(pos, iconName, color, isCompleted = false, labelText = '', clientName = '') {
  const marker = new google.maps.OverlayView();
  marker.onAdd = function() {
    const div = document.createElement('div');
    div.className = 'v5-marker-shadow';
    div.style.position = 'absolute';
    div.style.zIndex = isCompleted ? '1' : '10';
    div.innerHTML = `
      <div style="position:relative; display:flex; flex-direction:column; align-items:center; opacity:${isCompleted ? '0.7' : '1'};">
        ${labelText ? `
          <div style="position:absolute; top:-10px; right:-10px; background:#0f172a; color:#ffffff; width:20px; height:20px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900; z-index:12; box-shadow:0 2px 6px rgba(0,0,0,0.25);">
            ${labelText}
          </div>
        ` : ''}
        <div style="background:${color}; width:42px; height:42px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
          <div style="transform:rotate(45deg); color:white; display:flex;">${icon(iconName, 20)}</div>
        </div>
        ${clientName ? `
          <div style="margin-top:6px; background:rgba(15, 23, 42, 0.85); backdrop-filter:blur(4px); color:white; padding:3px 8px; border-radius:8px; font-size:9.5px; font-weight:900; white-space:nowrap; border:1px solid rgba(255,255,255,0.15); box-shadow:0 4px 10px rgba(0,0,0,0.15); z-index:11;">
            ${clientName}
          </div>
        ` : ''}
      </div>`;
    this.getPanes().overlayMouseTarget.appendChild(div);
    this.div = div;
  };
  marker.draw = function() {
    const projection = this.getProjection();
    if (!projection) return;
    const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(pos.lat, pos.lng));
    if (point && this.div) {
      this.div.style.left = (point.x - 21) + 'px';
      this.div.style.top = (point.y - 42) + 'px';
    }
  };
  marker.setMap(googleMap);
  destinationMarkers.push(marker);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function updateRiderLocation(lat, lng, dest, orders) {
  if (!googleMap || lat == null || lng == null) return;
  window._hasRealGps = true;

  const badgeText = document.getElementById('v5-distance-text');
  const riderPos = { lat, lng };

  // ── 1. Create or smoothly move the rider marker ──────────────────────────────
  if (!riderMarker) {
    riderMarker = new google.maps.OverlayView();
    riderMarker.pos = riderPos;
    riderMarker.angle = 0;
    riderMarker.onAdd = function() {
      const div = document.createElement('div');
      div.className = 'v5-marker-shadow';
      // IMPORTANT: NO CSS transitions on left/top to avoid conflicts when panning/zooming Google Maps
      div.style.cssText = 'position:absolute; z-index:1000; pointer-events:none;';
      div.innerHTML = `
        <div style="width:48px; height:48px; display:flex; align-items:center; justify-content:center; position:relative;">
          <div style="position:absolute; width:48px; height:48px; background:rgba(225,29,72,0.2); border-radius:50%; animation: pulse-v5 2s infinite;"></div>
          <div class="rider-icon-inner" style="background:#E11D48; color:white; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; position:relative; z-index:2; box-shadow: 0 8px 25px rgba(225,29,72,0.45); transition: transform 0.6s ease;">
            ${icon('bike', 20)}
          </div>
        </div>`;
      this.getPanes().overlayMouseTarget.appendChild(div);
      this.div = div;
    };
    riderMarker.draw = function() {
      const proj = this.getProjection();
      if (!proj || !this.div) return;
      const pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
      if (pt) {
        this.div.style.left = (pt.x - 24) + 'px';
        this.div.style.top  = (pt.y - 24) + 'px';
        const inner = this.div.querySelector('.rider-icon-inner');
        if (inner) inner.style.transform = `rotate(${this.angle}deg)`;
      }
    };
    riderMarker.setMap(googleMap);
  } else {
    // Only calculate bearing/rotation if rider has moved at least 3 meters (prevents spinning on GPS noise)
    if (riderMarker.pos) {
      const dist = haversineMeters(riderMarker.pos.lat, riderMarker.pos.lng, lat, lng);
      if (dist >= 3) {
        const lat1r = riderMarker.pos.lat * Math.PI / 180;
        const lat2r = lat * Math.PI / 180;
        const dLon  = (lng - riderMarker.pos.lng) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2r);
        const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360;
        let delta = bearing - (riderMarker.angle % 360);
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        riderMarker.angle += delta;
      }
    }
    riderMarker.pos = riderPos;
    if (riderMarker.draw) riderMarker.draw();
  }

  // ── 2. OSRM route — fetch every 10s or if moved 15m, otherwise update optimistically ──
  const pendingStores = resolvedStores.filter(s => !s.isPickedUp);
  const waypoints = [
    `${lng},${lat}`,
    ...(pendingStores.length > 0
      ? pendingStores.map(s => `${s.lng},${s.lat}`)
      : [`${dest.lng},${dest.lat}`]
    )
  ];

  const now = Date.now();
  const movedMeters = _lastOsrmStart ? haversineMeters(lat, lng, _lastOsrmStart.lat, _lastOsrmStart.lng) : Infinity;
  const timeElapsed = now - _lastOsrmFetchTime;
  const needsFetch = !routeLine || timeElapsed >= 10000 || movedMeters >= 15;

  if (!needsFetch) {
    // Optimistic: just slide the first point of the existing polyline to current position
    if (routeLine) {
      try {
        const path = routeLine.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
        if (path.length >= 2) { path[0] = riderPos; routeLine.setPath(path); }
      } catch (e) {}
    }
    return;
  }

  _lastOsrmFetchTime = now;
  _lastOsrmStart = riderPos;

  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${waypoints.join(';')}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (!data.routes?.[0] || !googleMap) return;

    const coords = data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
    coords.unshift(riderPos);
    const finalPoint = pendingStores.length > 0
      ? { lat: pendingStores[pendingStores.length - 1].lat, lng: pendingStores[pendingStores.length - 1].lng }
      : dest;
    coords.push(finalPoint);

    if (!routeLine) {
      routeLine = new google.maps.Polyline({
        path: coords,
        geodesic: true,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.85,
        strokeWeight: 6,
        map: googleMap,
        zIndex: 40
      });
    } else {
      routeLine.setPath(coords);
    }

    const distanceKm = data.routes[0].distance / 1000;
    if (badgeText) {
      if (distanceKm < 0.05 && pendingStores.length === 0) {
        badgeText.textContent = '¡Llegaste!';
      } else {
        badgeText.textContent = `${distanceKm.toFixed(1)} km • ${Math.round(data.routes[0].duration / 60)} min`;
      }
    }

    if (!window._firstFit) {
      const bounds = new google.maps.LatLngBounds();
      coords.forEach(p => bounds.extend(p));
      googleMap.fitBounds(bounds, { top: 100, bottom: 250, left: 60, right: 60 });
      window._firstFit = true;
    }
  } catch (err) { console.warn('Routing error:', err); }
}

function getDarkStyles() {
  return [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  ];
}
