// GoDelivery — Delivery Map Modal Component (Premium Google Maps Route)
import { showModal, closeModal } from './modal.js';
import { icon } from '../utils/icons.js';

let googleMap = null;
let riderMarker = null;
let destinationMarkers = [];
let routeLine = null;
let watchId = null;
let resolvedStores = []; // Cache to avoid multiple Firestore fetches

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
  const label = isPickedUp ? 'Punto de entrega' : `Retirar en: ${order.comercioName || 'Comercio'}`;
  const iconName = isPickedUp ? 'mapPin' : 'store';
  const address = isPickedUp ? order.deliveryAddress : (order.pickupAddress || order.comercioAddress || 'Cargando dirección...');
  const userName = order.userName || 'Cliente';
  
  const formatPrice = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(val || 0);
  const serviceFee = order.appUsageFee || order.serviceFee || order.platformFee || 0;
  const pFee = order.purchaseFee || (order.isFavor && order.favorType === 'compra' ? 800 : 0);
  const finalTotal = (order.subtotal || 0) + (order.deliveryCost || 0) + serviceFee + pFee;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="flex:1; min-width:0; padding-right:12px;">
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
      <div style="flex:1; min-width:0;">
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
  if (riderMarker) riderMarker.setMap(null);
  destinationMarkers.forEach(m => { if(m.setMap) m.setMap(null); });
  if (routeLine) routeLine.setMap(null);
  googleMap = null;
  riderMarker = null;
  destinationMarkers = [];
  routeLine = null;
  resolvedStores = [];
}

async function initDeliveryMap(order, orders) {
  if (typeof google === 'undefined') return;
  const container = document.getElementById('delivery-map-container');
  if (!container) return;

  const destCoords = order.deliveryCoords || { lat: -35.0833, lng: -57.65 };
  const theme = document.documentElement.getAttribute('data-theme') || 'light';

  googleMap = new google.maps.Map(container, {
    zoom: 14,
    center: destCoords,
    disableDefaultUI: true,
    styles: theme === 'dark' ? getDarkStyles() : [],
    gestureHandling: 'greedy'
  });

  // 1. Pickup Markers (Stores) - Robust fallback to Firestore
  const storeSet = new Set();
  resolvedStores = [];
  const { doc, getDoc } = await import('firebase/firestore');
  const { db } = await import('../firebase.js');

  for (const o of orders) {
    // 1.1 Support GoFavor Pickup Coords
    if (o.isFavor && o.pickupCoords) {
      const isPickedUp = !!o.pickedUpAt || o.status === 'picked_up' || o.status === 'delivered';
      addOverlayMarker(o.pickupCoords, o.favorType === 'mandado' ? 'mapPin' : 'store', isPickedUp ? '#94a3b8' : '#f59e0b', isPickedUp);
      resolvedStores.push({ ...o.pickupCoords, id: `favor-${o.id}`, isPickedUp });
      continue;
    }

    if (o.comercioId && !storeSet.has(o.comercioId)) {
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

      if (coords) {
        const isPickedUp = !!o.pickedUpAt || o.status === 'picked_up' || o.status === 'delivered';
        addOverlayMarker(coords, isPickedUp ? 'check' : 'store', isPickedUp ? '#94a3b8' : '#f59e0b', isPickedUp);
        storeSet.add(o.comercioId);
        resolvedStores.push({ ...coords, id: o.comercioId, isPickedUp });
      }
    }
  }

  // 2. Destination Marker (Home)
  addOverlayMarker(destCoords, 'home', '#10b981');
  
  // 3. Instant Initial State
  if (window.lastRiderPos) {
    updateRiderLocation(window.lastRiderPos.lat, window.lastRiderPos.lng, destCoords, orders, true);
  } else {
    updateRiderLocation(null, null, destCoords, orders);
  }

  // 4. Geolocation Tracking
  if (navigator.geolocation) {
    const geoOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
    const onGeoSuccess = (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateRiderLocation(p.lat, p.lng, destCoords, orders, true);
    };

    const onGeoSuccessCurrent = (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateRiderLocation(p.lat, p.lng, destCoords, orders, true);
    };

    const onGeoError = (err) => {
      console.warn('GPS Error:', err);
      updateRiderLocation(null, null, destCoords, orders);
    };

    navigator.geolocation.getCurrentPosition(onGeoSuccessCurrent, onGeoError, geoOptions);
    watchId = navigator.geolocation.watchPosition(onGeoSuccess, onGeoError, geoOptions);
  }

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

function addOverlayMarker(pos, iconName, color, isCompleted = false) {
  const marker = new google.maps.OverlayView();
  marker.onAdd = function() {
    const div = document.createElement('div');
    div.className = 'v5-marker-shadow';
    div.style.position = 'absolute';
    div.style.zIndex = isCompleted ? '1' : '10';
    div.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; opacity:${isCompleted ? '0.7' : '1'};">
        <div style="background:${color}; width:42px; height:42px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
          <div style="transform:rotate(45deg); color:white; display:flex;">${icon(iconName, 20)}</div>
        </div>
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

async function updateRiderLocation(lat, lng, dest, orders, isRealGps = false) {
  if (!googleMap) return;
  const badgeText = document.getElementById('v5-distance-text');
  
  if (window._hasRealGps && !isRealGps) return;
  if (isRealGps) window._hasRealGps = true;

  const hasGps = lat !== null && lng !== null;
  if (hasGps) {
    const riderPos = { lat, lng };
    if (!riderMarker) {
      riderMarker = new google.maps.OverlayView();
      riderMarker.pos = riderPos;
      riderMarker.onAdd = function() {
        const div = document.createElement('div');
        div.className = 'v5-marker-shadow';
        div.style.position = 'absolute';
        div.style.zIndex = '1000';
        div.innerHTML = `
          <div style="width:48px; height:48px; display:flex; align-items:center; justify-content:center; position:relative;">
            <div style="position:absolute; width:48px; height:48px; background:rgba(var(--color-primary-rgb),0.25); border-radius:50%; animation: pulse-v5 2s infinite;"></div>
            <div style="background:var(--color-primary); color:white; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; position:relative; z-index:2; box-shadow: 0 8px 25px rgba(var(--color-primary-rgb),0.4);">
              ${icon('bike', 20)}
            </div>
          </div>`;
        this.getPanes().overlayMouseTarget.appendChild(div);
        this.div = div;
      };
      riderMarker.draw = function() {
        const projection = this.getProjection();
        if (!projection) return;
        const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
        if (point && this.div) {
          this.div.style.left = (point.x - 24) + 'px';
          this.div.style.top = (point.y - 24) + 'px';
        }
      };
      riderMarker.setMap(googleMap);
    } else {
      riderMarker.pos = riderPos;
      if (riderMarker.draw) riderMarker.draw();
    }
  }

  const pendingStores = resolvedStores.filter(s => !s.isPickedUp);
  const waypoints = [];
  if (hasGps) {
    waypoints.push(`${lng},${lat}`);
    
    if (pendingStores.length > 0) {
      // Smart Routing: If there are pending pickups, ONLY route to pickups
      pendingStores.forEach(s => waypoints.push(`${s.lng},${s.lat}`));
    } else {
      // If all picked up, route ONLY to destination
      waypoints.push(`${dest.lng},${dest.lat}`);
    }
  } else {
    if (routeLine) routeLine.setMap(null);
    if (badgeText) badgeText.textContent = 'Buscando GPS...';
    return;
  }

  if (waypoints.length < 2) {
    if (badgeText) badgeText.textContent = '¡Llegaste!';
    if (routeLine) routeLine.setMap(null);
    return;
  }

  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${waypoints.join(';')}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (data.routes?.[0] && googleMap) {
      const coords = data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
      coords.unshift({ lat, lng });
      
      const finalPoint = (pendingStores.length > 0) 
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
        routeLine.setMap(googleMap);
      }

      const distanceKm = data.routes[0].distance / 1000;
      if (badgeText) {
        if (distanceKm < 0.05 && pendingStores.length === 0) {
          badgeText.textContent = '¡Llegaste!';
        } else {
          badgeText.textContent = `${distanceKm.toFixed(1)} km • ${Math.round(data.routes[0].duration / 60)} min`;
        }
      }

      // Auto-fit initial load
      if (!window._firstFit) {
        const bounds = new google.maps.LatLngBounds();
        coords.forEach(p => bounds.extend(p));
        googleMap.fitBounds(bounds, { top: 100, bottom: 250, left: 60, right: 60 });
        window._firstFit = true;
      }
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
