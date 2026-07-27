import { db } from '../firebase.js';
import { doc, onSnapshot, runTransaction, serverTimestamp, increment, collection, query, where, getDocs } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';
import { showConfirm, closeModal, showModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { getState } from '../state.js';
import { openChat } from '../components/chat.js';

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
    case 'encomienda':
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
    case 'mandado':
    case 'compra':
    default:
      return {
        title: 'GoFavor: Mandado',
        label: 'GO FAVOR',
        headerText: 'Detalles del Favor',
        color: '#ef4444',
        textColor: '#ef4444'
      };
  }
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

let liveMap = null;
let riderMarker = null;
let homeMarker = null;
let pickupMarker = null;
let dropoffMarker = null;
let routeLine = null;
let routeLineGlow = null;
let currentETA = '--';
let isFirstFit = true;
let isDetailsExpanded = false;

export function renderOrderTracking(orderId, content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  isFirstFit = true;
  isDetailsExpanded = false;

  content.innerHTML = `
    <div class="tracking-v5-viewport">
      <div id="live-tracking-map" class="map-container-v5"></div>
      <div class="tracking-v5-nav">
        <a href="#/profile/orders" class="v5-back-btn">${icon('chevronLeft', 24)}</a>
        <div id="v5-header-driver-card" style="flex:1; margin-left:10px; pointer-events:auto; min-width:0;"></div>
      </div>
      
      <div style="position:absolute; top:calc(82px + env(safe-area-inset-top, 0px)); right:16px; z-index:100; display:flex; flex-direction:row-reverse; align-items:center; gap:10px; pointer-events:auto;">
        <button id="recenter-map-btn" class="v5-recenter-btn-premium" title="Centrar Recorrido" style="position:static; flex-shrink:0;">
          <div class="v5-recenter-icon-wrapper">
            ${icon('navigationArrow', 22)}
          </div>
        </button>

        <div id="v5-dynamic-eta-container" style="pointer-events:auto;"></div>
      </div>

      <div id="tracking-info-panel" class="v5-info-panel"></div>
      <div id="price-breakdown-modal-container"></div>
    </div>

    <style>
      #app-content { 
        height: 100% !important;
        min-height: 0 !important;
        padding-bottom: 0 !important;
        overflow: hidden !important;
        position: relative !important;
        margin: 0 !important;
      }
      .slide-overlay.active { overflow: hidden !important; }
      
      #global-active-delivery-fab, 
      #global-delivery-available-fab, 
      #global-order-fab,
      .active-order-banner,
      .active-order-banner-v2 { 
        display: none !important; 
      }

      .tracking-v5-viewport {
        position: absolute;
        inset: 0;
        background: var(--color-bg);
        z-index: 10;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .map-container-v5 { position: absolute; inset: 0; z-index: 1; background: var(--color-bg-secondary); }
      
      .tracking-v5-nav { position: absolute; top: calc(16px + env(safe-area-inset-top, 0px)); left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: center; z-index: 100; pointer-events: none; }
      .v5-back-btn { pointer-events: auto; width: 44px; height: 44px; background: var(--color-surface); border-radius: 14px; display: flex; align-items: center; justify-content: center; color: var(--color-text); box-shadow: var(--shadow-md); border: 1px solid var(--color-border); }
      .v5-live-pill { background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); padding: 8px 14px; border-radius: 100px; display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 11px; color: var(--color-danger); box-shadow: var(--shadow-sm); border: 1px solid var(--glass-border); }
      .v5-pulse-dot { width: 7px; height: 7px; background: var(--color-danger); border-radius: 50%; animation: pulse-v5 1.5s infinite; }
      
      @keyframes pulse-v5 { 0% { transform: scale(0.9); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.5; } 100% { transform: scale(0.9); opacity: 1; } }

      .sonar-pulse-ring-1 {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        height: 100%;
        background: rgba(var(--color-primary-rgb, 225, 29, 72), 0.25);
        border-radius: 50%;
        transform-origin: center center;
        animation: radar-ripple-premium 2.2s cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
      }
      .sonar-pulse-ring-2 {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        height: 100%;
        background: rgba(var(--color-primary-rgb, 225, 29, 72), 0.2);
        border-radius: 50%;
        transform-origin: center center;
        animation: radar-ripple-premium 2.2s cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
        animation-delay: 0.6s;
      }

      .v5-recenter-btn-premium {
        position: absolute;
        top: 76px;
        right: 16px;
        z-index: 100;
        width: 50px;
        height: 50px;
        background: var(--color-surface);
        border-radius: 16px;
        border: 1px solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: var(--shadow-lg);
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .v5-recenter-btn-premium:active { transform: scale(0.9); }
      .v5-recenter-icon-wrapper { color: var(--color-primary); display: flex; align-items: center; justify-content: center; transition: transform 0.3s ease; }
      .v5-recenter-btn-premium:hover .v5-recenter-icon-wrapper { transform: rotate(-15deg) scale(1.1); }

      .v5-info-panel {
        position: absolute;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        left: 12px;
        right: 12px;
        background: var(--glass-bg, rgba(255, 255, 255, 0.96));
        backdrop-filter: var(--glass-blur, blur(24px));
        -webkit-backdrop-filter: var(--glass-blur, blur(24px));
        border-radius: 22px;
        padding: 12px 14px;
        z-index: 100;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        gap: 8px;
        animation: v5-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        border: 1px solid var(--glass-border, rgba(0, 0, 0, 0.08));
        transition: all 0.3s ease;
        max-height: 75vh;
        overflow-y: auto;
      }
      @keyframes v5-slide-up { from { transform: translateY(110%); } to { transform: translateY(0); } }
      .v5-status-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .v5-status-title { font-size: 13.5px; font-weight: 850; color: var(--color-text); margin: 0; letter-spacing: -0.3px; display: flex; align-items: center; gap: 6px; }
      .radar-search-wrapper { position: relative; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .radar-search-dot { width: 8px; height: 8px; background-color: var(--color-primary); border-radius: 50%; position: absolute; z-index: 2; }
      .radar-search-wave { position: absolute; width: 100%; height: 100%; background-color: var(--color-primary); border-radius: 50%; opacity: 0.6; z-index: 1; animation: radar-pulse 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }
      .radar-search-wave:nth-child(2) { animation-delay: 0.4s; }
      @keyframes radar-pulse { 0% { transform: scale(0.5); opacity: 0.8; } 70% { transform: scale(3.5); opacity: 0; } 100% { transform: scale(0.5); opacity: 0; } }
      .v5-eta-label { font-size: 13px; color: var(--color-primary); font-weight: 800; margin-top: 2px; display: flex; align-items: center; gap: 4px; }
      .v5-stepper-container {
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0 14px 0;
        margin-top: 5px;
      }
      .v5-stepper-line {
        position: absolute;
        top: 21px; /* Mathematically centered with the 26px circle (10px padding + 13px radius - 2px half-height) */
        left: 10%; /* Starts exactly at center of first circle */
        right: 10%; /* Ends exactly at center of last circle */
        height: 4px;
        background: var(--color-border-light);
        z-index: 1;
        border-radius: 2px;
      }
      .v5-stepper-line-fill {
        height: 100%;
        width: 0%;
        transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 2px;
        background: linear-gradient(270deg, var(--color-primary), #F97316, #8B5CF6, var(--color-primary));
        background-size: 400% 400%;
        animation: gradient-shimmer-liquid 4s ease infinite;
      }
      .v5-stepper-step {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 2;
        flex: 1;
      }
      .v5-step-circle {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--color-surface);
        border: 3px solid var(--color-border-light);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        transition: all 0.5s ease;
      }
      .v5-step-icon {
        display: none;
        color: white;
        line-height: 0;
        align-items: center;
        justify-content: center;
      }
      .v5-step-pulse {
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.25);
        opacity: 0;
        transform: scale(0.8);
        pointer-events: none;
        transition: all 0.3s ease;
      }
      
      /* Active Step */
      .v5-stepper-step.active .v5-step-circle {
        border-color: var(--color-primary);
        background: var(--color-primary);
        box-shadow: 0 0 12px rgba(var(--color-primary-rgb, 59, 130, 246), 0.4);
      }
      .v5-stepper-step.active .v5-step-pulse {
        animation: v5-step-pulse-anim 1.8s infinite ease-in-out;
        opacity: 1;
      }
      @keyframes v5-step-pulse-anim {
        0% { transform: scale(0.9); opacity: 0.6; }
        50% { transform: scale(1.5); opacity: 0; }
        100% { transform: scale(0.9); opacity: 0; }
      }

      /* Completed Step */
      .v5-stepper-step.completed .v5-step-circle {
        background: var(--color-primary);
        border-color: var(--color-primary);
      }
      .v5-stepper-step.completed .v5-step-icon {
        display: flex;
      }

      /* Inactive Step */
      .v5-stepper-step.inactive .v5-step-circle {
        background: var(--color-surface);
        border-color: var(--color-border-light);
      }

      /* Step Labels */
      .v5-step-label {
        font-size: 10px;
        font-weight: 800;
        color: var(--color-text-tertiary);
        margin-top: 8px;
        text-align: center;
        transition: color 0.3s ease;
        white-space: nowrap;
      }
      .v5-stepper-step.active .v5-step-label {
        color: var(--color-primary);
        font-weight: 900;
      }
      .v5-stepper-step.completed .v5-step-label {
        color: var(--color-text-secondary);
        font-weight: 850;
      }
      .v5-driver-strip { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--color-bg-secondary); border-radius: 16px; border: 1px solid var(--color-border-light); }
      .v5-driver-img { width: 40px; height: 40px; border-radius: 12px; background: var(--color-surface); border: 1px solid var(--color-border); overflow: hidden; }
      .v5-driver-img img { width: 100%; height: 100%; object-fit: cover; }
      .v5-driver-info h4 { font-size: 13px; font-weight: 850; margin: 0; color: var(--color-text); }
      .v5-driver-info p { font-size: 9px; color: var(--color-text-tertiary); font-weight: 700; margin-top: 1px; text-transform: uppercase; }
      .v5-chat-btn { margin-left: auto; width: 40px; height: 40px; background: var(--color-primary); border-radius: 12px; border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: var(--shadow-primary); }
      .v5-cta-code { background: var(--color-secondary); color: white; padding: 12px; border-radius: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 900; font-size: 12px; border: 1px solid var(--color-border); }
      .v5-code-val { font-size: 18px; color: var(--color-primary); letter-spacing: 4px; }
      .v5-summary-mini { display: flex; justify-content: space-between; border-top: 1px solid var(--color-border-light); padding-top: 12px; gap: 4px; }
      .v5-price-item { text-align: center; flex: 1; }
      .v5-price-label { font-size: 8px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin-bottom: 2px; white-space: nowrap; }
      .v5-price-val { font-size: 11px; font-weight: 800; color: var(--color-text-secondary); }
      .v5-price-val.total { font-size: 14px; font-weight: 950; color: var(--color-text); }
      .v5-marker-shadow { filter: drop-shadow(0 4px 10px rgba(0,0,0,0.2)); }
      .v5-cancel-btn {
        width: 100%;
        padding: 14px;
        background: rgba(239, 68, 68, 0.08);
        border: 1.5px dashed rgba(239, 68, 68, 0.25);
        color: #ef4444;
        font-size: 13px;
        font-weight: 850;
        border-radius: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .v5-cancel-btn:active {
        transform: scale(0.97);
        background: rgba(239, 68, 68, 0.15);
      }
      .v5-details-container {
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transition: max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, margin-top 0.3s ease;
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: 8px;
      }
      .v5-details-container.expanded {
        max-height: 500px;
        opacity: 1;
        margin-top: 10px;
      }
      .v5-toggle-btn {
        width: 100%;
        height: 44px;
        border-radius: 16px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border-light);
        color: var(--color-text-secondary);
        font-size: 11.5px;
        font-weight: 850;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-top: 4px;
        text-transform: uppercase;
        transition: all 0.2s ease;
        letter-spacing: 0.03em;
        box-shadow: var(--shadow-sm);
      }
      .v5-toggle-btn:hover {
        background: var(--color-border-light);
        color: var(--color-primary);
      }
      .v5-toggle-btn:active {
        transform: scale(0.97);
      }
    </style>
  `;

  const unsub = onSnapshot(doc(db, 'orders', orderId), (snapshot) => {
    if (!snapshot.exists()) return;
    const order = { id: snapshot.id, ...snapshot.data() };
    
    // Auth Check: Prevent driver from viewing the customer tracking view and the verification code
    const user = getState().user;
    if (user && order.driverId === user.uid && order.userId !== user.uid) {
      window.location.hash = '#/delivery';
      return;
    }

    const rawStatus = (order.status || '').toString().toLowerCase();
    const isCompleted = rawStatus === 'completed' || rawStatus === 'entregado';
    if (isCompleted) {
      if (!window[`hasShownCompletedModal_${order.id}`]) {
        window[`hasShownCompletedModal_${order.id}`] = true;
        import('../components/delivery-rating.js').then(m => m.showDeliveryRating(order));
      }
    }

    window.lastOrderData = order;
    updateUI(order);
    updateMap(order);

    // Real-time update for Price Breakdown Modal if currently open
    const priceModalBackdrop = document.getElementById('v5-price-modal-backdrop');
    if (priceModalBackdrop) {
      openPriceBreakdownModal(order);
    }
  });

  document.getElementById('recenter-map-btn').onclick = () => {
    if (!liveMap) return;
    
    const order = window.lastOrderData;
    const isTrip = order?.isTrip === true;
    const rawStatus = (order?.status || '').toString().toLowerCase();
    const riderPos = order?.driverLocation ? { lat: order.driverLocation.lat, lng: order.driverLocation.lng } : null;
    const pickupPos = order?.pickupCoords ? { lat: order.pickupCoords.lat, lng: order.pickupCoords.lng } : null;
    const dropoffPos = order?.deliveryCoords ? { lat: order.deliveryCoords.lat, lng: order.deliveryCoords.lng } : null;
    const destPos = isTrip
      ? (rawStatus === 'delivering' || rawStatus === 'en camino' ? dropoffPos : pickupPos)
      : dropoffPos;

    if (riderPos && destPos && routeLine) {
      const bounds = new google.maps.LatLngBounds();
      routeLine.getPath().forEach(p => bounds.extend(p));
      liveMap.fitBounds(bounds, { top: 50, bottom: 250, left: 50, right: 50 });
    } else if (destPos) {
      liveMap.panTo(destPos);
      liveMap.setZoom(17);
    } else if (riderPos) {
      liveMap.panTo(riderPos);
      liveMap.setZoom(17);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const myCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        liveMap.panTo(myCoords);
        liveMap.setZoom(17);
      }, (err) => console.warn('Geolocation error:', err));
    }
  };

  return {
    cleanup: () => {
      unsub();
      if (liveMap) {
        if (riderMarker) riderMarker.setMap(null);
        if (homeMarker) homeMarker.setMap(null);
        if (pickupMarker) pickupMarker.setMap(null);
        if (dropoffMarker) dropoffMarker.setMap(null);
        if (routeLine) routeLine.setMap(null);
        if (routeLineGlow) routeLineGlow.setMap(null);
        liveMap = null;
      }
      riderMarker = null;
      homeMarker = null;
      pickupMarker = null;
      dropoffMarker = null;
      routeLine = null;
      routeLineGlow = null;
    }
  };
}

function updateUI(order) {
  const container = document.getElementById('tracking-info-panel');
  if (!container) return;

  const statusMap = {
    'pendiente': 'pending', 'confirmado': 'confirmed', 'preparando': 'confirmed',
    'listo': 'ready', 'en camino': 'delivering', 'entregado': 'completed', 'cancelado': 'cancelled'
  };

  const rawStatus = (order.status || '').toString().toLowerCase();
  let normalizedStatus = statusMap[rawStatus] || rawStatus;
  if (normalizedStatus.includes('camin')) normalizedStatus = 'delivering';
  if (normalizedStatus.includes('entreg') || normalizedStatus.includes('complet')) normalizedStatus = 'completed';
  if (normalizedStatus.includes('cancel')) normalizedStatus = 'cancelled';

  const itemsCost = order.itemsCost || order.subtotal || order.itemsTotal || (order.items || []).reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0);
  const shippingFee = order.shippingFee || order.deliveryFee || order.shippingCost || order.deliveryCost || 0;
  const serviceFee = order.appUsageFee || order.serviceFee || order.platformFee || 0;
  const discount = order.discount || order.discountAmount || 0;
  const totalAmount = order.totalAmount || order.total || (itemsCost + shippingFee + serviceFee - discount);

  // Prevent flickering: calculate fingerprint of dynamic tracking attributes
  const trackingFingerprint = JSON.stringify({
    id: order.id,
    status: normalizedStatus,
    driverId: order.driverId || '',
    driverAlias: order.driverAlias || '',
    code: order.verificationCode || '',
    itemsCost: Number(itemsCost) || 0,
    shippingFee: Number(shippingFee) || 0,
    purchaseFee: Number(order.purchaseFee || 0),
    extraStopsFee: Number(order.extraStopsFee || 0),
    serviceFee: Number(serviceFee) || 0,
    total: Number(totalAmount) || 0,
    modifiedAt: order.modifiedAt?.toMillis ? order.modifiedAt.toMillis() : (order.modifiedAt || '')
  });

  if (container.dataset.lastTrackingFingerprint === trackingFingerprint) {
    return;
  }
  container.dataset.lastTrackingFingerprint = trackingFingerprint;

  const isCompleted = normalizedStatus === 'completed';
  const isCancelled = normalizedStatus === 'cancelled';
  const isFinalized = isCompleted || isCancelled;
  const isDelivering = normalizedStatus === 'delivering';
  const isWaitingConfirmation = (normalizedStatus === 'pending');
  const isSearchingRider = (!order.driverId && (normalizedStatus === 'ready' || order.isFavor || order.isTrip));

  // Update Live Pill
  const livePill = document.querySelector('.v5-live-pill');
  if (livePill) {
    if (isFinalized) {
      livePill.innerHTML = `FINALIZADO`;
      livePill.style.color = 'var(--color-text-tertiary)';
      livePill.style.background = 'var(--color-bg-secondary)';
      livePill.querySelector('.v5-pulse-dot')?.remove();
    } else {
      livePill.innerHTML = `<span class="v5-pulse-dot"></span> EN VIVO`;
    }
  }

  // Update Top Floating Header Driver Card
  const headerDriverCard = document.getElementById('v5-header-driver-card');
  if (headerDriverCard) {
    if (order.driverId) {
      const nameForInitials = order.driverName || 'Repartidor';
      const initialLetter = nameForInitials.charAt(0).toUpperCase();
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
      const fallbackColor = colors[nameForInitials.length % colors.length];
      
      const driverIdStr = order.driverDeliveryId || (order.driverId ? order.driverId.slice(0, 6).toUpperCase() : '');
      const avatarHtml = order.driverPhoto ? `
        <div style="width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: ${fallbackColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <img src="${order.driverPhoto}" onerror="this.onerror=null; this.parentNode.innerHTML='<span style=\\'color:white; font-weight:900; font-size:14px;\\'>${initialLetter}</span>';" style="width:100%; height:100%; object-fit:cover;">
        </div>
      ` : `
        <div style="width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: ${fallbackColor}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 900; font-size: 14px; flex-shrink: 0;">
          ${initialLetter}
        </div>
      `;

      headerDriverCard.innerHTML = `
        <div style="background: var(--glass-bg, rgba(255, 255, 255, 0.96)); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid var(--glass-border, rgba(0,0,0,0.08)); border-radius: 100px; padding: 4px 6px 4px 5px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.12);">
          ${avatarHtml}
          <div style="min-width: 0; flex: 1; display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 14.5px; font-weight: 900; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">${order.driverName || 'Repartidor'}</span>
            ${driverIdStr ? `<span style="font-size: 10px; font-weight: 850; color: var(--color-text-tertiary); background: var(--color-bg-secondary); padding: 2px 6px; border-radius: 6px; border: 1px solid var(--color-border-light); flex-shrink: 0;">ID: ${driverIdStr}</span>` : ''}
          </div>
          <button id="header-chat-v5-btn" style="background: var(--color-primary); color: white; border: none; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; box-shadow: 0 4px 14px rgba(225, 29, 72, 0.45); transition: transform 0.2s ease;">
            ${icon('chatBubble', 17)}
          </button>
        </div>
      `;
      const chatBtn = document.getElementById('header-chat-v5-btn');
      if (chatBtn) {
        chatBtn.onclick = (e) => {
          e.stopPropagation();
          const targetOrder = window.lastOrderData || order;
          openChat({
            orderId: targetOrder.id,
            type: 'client-delivery',
            otherName: targetOrder.driverName || 'Repartidor',
            orderNum: targetOrder.orderId
          });
        };
      }
    } else {
      headerDriverCard.innerHTML = `
        <div style="background: var(--glass-bg, rgba(255, 255, 255, 0.95)); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--glass-border, rgba(0,0,0,0.08)); border-radius: 100px; padding: 6px 14px; display: flex; align-items: center; justify-content: center; font-weight: 850; font-size: 13px; color: var(--color-text-primary); box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
          ⚡ Seguimiento en Vivo
        </div>
      `;
    }
  }

  // Title translation logic for Trips and GoFavors
  let titleText = '';
  if (order.isTrip) {
    titleText = isCompleted ? '¡Viaje Finalizado!' :
                isCancelled ? 'Viaje Cancelado' :
                order.isAtDoor ? '¡El chofer está en la puerta!' :
                isDelivering ? 'Viaje en curso (Pasajero a bordo)' :
                (!order.driverId ? 'Buscando chofer...' : 'El chofer va hacia tu ubicación');
  } else if (order.isFavor) {
    titleText = isCompleted ? '¡Favor Finalizado!' : 
                isCancelled ? 'Favor Cancelado' : 
                order.isAtDoor ? '¡El repartidor está en la puerta!' :
                isDelivering ? 'El repartidor lleva tu pedido' : 
                (order.driverId ? 'Yendo a buscar tu pedido' : 'Buscando repartidor...');
  } else {
    titleText = isCompleted ? '¡Pedido Finalizado!' : 
                isCancelled ? 'Pedido Cancelado' : 
                order.isAtDoor ? '¡El repartidor está en la puerta!' :
                isDelivering ? 'El repartidor va hacia vos' : 
                (normalizedStatus === 'pending' ? 'Esperando confirmación' :
                 normalizedStatus === 'ready' ? (order.driverId ? (order.isGoCash ? 'Yendo a tu ubicación' : 'Yendo a buscar tu pedido') : 'Buscando repartidor...') : 
                 'Preparando tu pedido');
  }

  let subtitleHtml = '';
  if (order.isAtDoor && !isCompleted && !isCancelled) {
    subtitleHtml = `
      <p class="v5-status-subtitle" style="font-size: 13px; color: #d97706; margin: 6px 0 0 0; font-weight: 700; line-height: 1.4;">
        Por favor, salí a recibir ${order.isTrip ? 'al chofer' : 'tu pedido'} para evitar demoras.
      </p>
    `;
  } else if (!order.driverId && (order.isTrip || order.isFavor || normalizedStatus === 'pending' || normalizedStatus === 'ready' || normalizedStatus === 'confirmed')) {
    if (order.queueTargetDriverName) {
      subtitleHtml = `
        <div style="margin-top: 6px; padding: 10px 14px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 800; color: #d97706;">
            <span style="font-size: 15px;">⏳</span>
            <span>Ofreciendo a: <strong style="color: var(--color-text-primary); font-weight: 900;">${order.queueTargetDriverName}</strong></span>
          </div>
          <div class="client-queue-timer" data-offered-at="${order.queueOfferedAt?.toMillis ? order.queueOfferedAt.toMillis() : (order.queueOfferedAt ? new Date(order.queueOfferedAt).getTime() : Date.now())}" style="font-size: 11px; font-weight: 900; background: #d97706; color: white; padding: 3px 8px; border-radius: 99px;">
            60s
          </div>
        </div>
      `;
    } else if (normalizedStatus === 'pending') {
      subtitleHtml = `
        <p class="v5-status-subtitle" style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0 0; font-weight: 550; line-height: 1.4;">
          Por favor espera a que el comercio confirme tu pedido, tomará solo un momento.
        </p>
      `;
    } else if (normalizedStatus === 'confirmed' || normalizedStatus === 'preparing') {
      subtitleHtml = `
        <p class="v5-status-subtitle" style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0 0; font-weight: 550; line-height: 1.4;">
          El comercio aceptó tu pedido y se encuentra preparándolo.
        </p>
      `;
    } else {
      subtitleHtml = order.isTrip ? `
        <p class="v5-status-subtitle" style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0 0; font-weight: 550; line-height: 1.4;">
          Por favor espera mientras asignamos un chofer disponible para tu viaje.
        </p>
      ` : `
        <p class="v5-status-subtitle" style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0 0; font-weight: 550; line-height: 1.4;">
          Por favor espera mientras asignamos un repartidor disponible.
        </p>
      `;
    }
  }

  container.innerHTML = `
    <div class="v5-status-header">
      <div class="v5-status-content">
        <h2 class="v5-status-title">
          ${titleText.includes('Buscando') ? `
            <div class="radar-search-wrapper">
              <div class="radar-search-wave"></div>
              <div class="radar-search-wave"></div>
              <div class="radar-search-dot"></div>
            </div>
          ` : ''}
          ${titleText}
        </h2>
        ${subtitleHtml}
        <div id="v5-dynamic-eta-container" style="margin-top: 6px;"></div>
      </div>
      <div style="font-size:9px; font-weight:800; color: var(--color-text-tertiary); padding:5px 10px; background: var(--color-bg-secondary); border-radius:8px; border: 1px solid var(--color-border-light);">#${order.orderId || '...'}</div>
    </div>
    
    ${order.isTrip ? `
      <div class="v5-stepper-container">
        <div class="v5-stepper-line">
          <div class="v5-stepper-line-fill" style="width: ${getTripStepperLinePercent(order)}%;"></div>
        </div>
        
        <div class="v5-stepper-step ${getTripStepClass(order, 0)}">
          <div class="v5-step-circle">
            <span class="v5-step-icon">${icon('check', 10)}</span>
            <span class="v5-step-pulse"></span>
          </div>
          <span class="v5-step-label">Buscando</span>
        </div>
 
        <div class="v5-stepper-step ${getTripStepClass(order, 1)}">
          <div class="v5-step-circle">
            <span class="v5-step-icon">${icon('check', 10)}</span>
            <span class="v5-step-pulse"></span>
          </div>
          <span class="v5-step-label">Asignado</span>
        </div>
 
        <div class="v5-stepper-step ${getTripStepClass(order, 2)}">
          <div class="v5-step-circle">
            <span class="v5-step-icon">${icon('check', 10)}</span>
            <span class="v5-step-pulse"></span>
          </div>
          <span class="v5-step-label">En camino</span>
        </div>
 
        <div class="v5-stepper-step ${getTripStepClass(order, 3)}">
          <div class="v5-step-circle">
            <span class="v5-step-icon">${icon('check', 10)}</span>
            <span class="v5-step-pulse"></span>
          </div>
          <span class="v5-step-label">En viaje</span>
        </div>
 
        <div class="v5-stepper-step ${getTripStepClass(order, 4)}">
          <div class="v5-step-circle">
            <span class="v5-step-icon">${icon('check', 10)}</span>
            <span class="v5-step-pulse"></span>
          </div>
          <span class="v5-step-label">Llegaste</span>
        </div>
      </div>
    ` : `
      <div class="v5-stepper-container">
        <div class="v5-stepper-line">
          <div class="v5-stepper-line-fill" style="width: ${getStepperLinePercent(normalizedStatus, order.isFavor)}%;"></div>
        </div>
        
        ${order.isFavor ? `
          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 0, true)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Solicitado</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 1, true)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Buscando</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 2, true)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Yendo al punto</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 3, true)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">En camino</span>
          </div>
        ` : `
          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 0)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Pendiente</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 1)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Aprobado</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 2)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Preparando</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 3)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">Listo</span>
          </div>

          <div class="v5-stepper-step ${getStepClass(normalizedStatus, 4)}">
            <div class="v5-step-circle"><span class="v5-step-icon">${icon('check', 10)}</span><span class="v5-step-pulse"></span></div>
            <span class="v5-step-label">En camino</span>
          </div>
        `}
      </div>
    `}

    ${order.isTrip ? `
      <div style="background:var(--color-bg-secondary); padding:14px; border-radius:18px; border:1px solid var(--color-border-light); margin-top:4px; display:flex; flex-direction:column; gap:10px;">
        <div style="font-size:9px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase;">Detalles del Viaje</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">${order.tripType === 'moto' ? '🏍️' : '🚗'}</span>
          <span style="font-size:12px; font-weight:800; color:var(--color-text-primary); text-transform:capitalize;">Vehículo: ${order.tripType === 'moto' ? 'Moto' : 'Auto'}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--color-border-light); padding-top:10px;">
          <div style="font-size:11.5px; font-weight:600; color:var(--color-text-secondary); display:flex; align-items:center; gap:6px;">
            <span style="color:#22c55e;">●</span> <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Origen:</span> ${order.pickupAddress}
          </div>
          <div style="font-size:11.5px; font-weight:600; color:var(--color-text-secondary); display:flex; align-items:center; gap:6px;">
            <span style="color:#ef4444;">●</span> <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Destino:</span> ${order.deliveryAddress}
          </div>
        </div>
      </div>
    ` : ''}



    ${isDelivering && !order.isTrip ? `
      <div class="v5-cta-code"><span>CÓDIGO DE ENTREGA</span><span class="v5-code-val">${order.verificationCode}</span></div>
    ` : ''}

    ${(order.paymentMethod === 'transferencia' || order.paymentMethod === 'transfer' || (order.paymentMethod && order.paymentMethod.toString().toLowerCase().includes('transf'))) ? `
      <!-- Card de Transferencia con Alias del Repartidor -->
      <div style="background:rgba(124,58,237,0.08); border:1.5px solid rgba(124,58,237,0.25); border-radius:18px; padding:12px 14px; margin-top:2px; display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:15px;">🏦</span>
            <span style="font-size:11px; font-weight:850; color:#6d28d9; text-transform:uppercase; letter-spacing:0.04em;">Pago por Transferencia</span>
          </div>
          <span style="font-size:10px; font-weight:800; color:#7c3aed; background:rgba(124,58,237,0.12); padding:2px 8px; border-radius:6px;">Alias Repartidor</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; background:var(--color-surface); padding:8px 12px; border-radius:12px; border:1px solid rgba(124,58,237,0.2);">
          <div style="display:flex; flex-direction:column; min-width:0; flex:1; margin-right:8px;">
            <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Alias CBU / CVU</span>
            <span style="font-size:13.5px; font-weight:900; color:var(--color-text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" id="v5-driver-alias-val">${order.driverAlias || 'Consultar al repartidor'}</span>
          </div>
          ${order.driverAlias ? `
            <button id="v5-copy-alias-btn" style="background:linear-gradient(135deg,#7c3aed,#6d28d9); color:white; border:none; padding:7px 14px; border-radius:10px; font-size:11.5px; font-weight:900; cursor:pointer; flex-shrink:0; box-shadow:0 3px 8px rgba(124,58,237,0.3); text-transform:uppercase;">
              Copiar
            </button>
          ` : ''}
        </div>
      </div>
    ` : ''}

    <!-- Total Price Pill & Details Toggle -->
    <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 14px; background:var(--color-bg-secondary); border-radius:18px; border:1px solid var(--color-border-light); margin-top:2px; box-sizing:border-box;">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:12px; font-weight:700; color:var(--color-text-secondary);">Total:</span>
        <strong id="v5-footer-total-val" style="font-size:18px; font-weight:950; color:var(--color-text-primary); transition: all 0.3s ease;">
          $${Math.round(totalAmount).toLocaleString('es-AR')}
        </strong>
        <button id="v5-price-breakdown-info-btn" style="background:rgba(var(--color-primary-rgb, 225, 29, 72), 0.12); color:var(--color-primary); border:none; width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; cursor:pointer; font-family:sans-serif;" title="Ver desglose del importe">
          i
        </button>
      </div>
      <button id="v5-toggle-details-btn" class="v5-toggle-btn" style="margin:0; padding:6px 14px; font-size:11.5px; width:auto; border-radius:10px;">
        ${isDetailsExpanded ? icon('chevronUp', 13) : icon('chevronDown', 13)} 
        ${isDetailsExpanded ? 'Ocultar' : 'Ver Detalles'}
      </button>
    </div>

    <!-- Contenedor expandible -->
    <div id="v5-expandable-details" class="v5-details-container ${isDetailsExpanded ? 'expanded' : ''}">
      ${order.isFavor ? `
        <div style="background:var(--color-bg-secondary); padding:14px; border-radius:18px; border:1px solid var(--color-border-light); margin-bottom:12px; width: 100%; box-sizing: border-box; text-align: left;">
          <div style="font-size:9px; font-weight:900; color:${getFavorTypeMeta(order.favorType).textColor}; text-transform:uppercase; margin-bottom:8px;">${getFavorTypeMeta(order.favorType).headerText}</div>
          <div style="font-size:12px; font-weight:600; color:var(--color-text-primary); margin-bottom:10px; line-height:1.4;">${formatFavorDetailsHTML(order.details)}</div>
          ${order.pickupAddress ? `
            <div style="font-size:11px; font-weight:700; color:var(--color-text-secondary); display:flex; align-items:center; gap:6px; border-top:1px solid var(--color-border-light); padding-top:8px;">
              ${icon('mapPin', 14)} <span style="font-size:9px; opacity:0.6; text-transform:uppercase;">Origen:</span> ${order.pickupAddress}
            </div>
          ` : ''}
        </div>
      ` : ''}
      ${(normalizedStatus === 'pending' || (order.isTrip && ['ready', 'preparing', 'confirmed'].includes(normalizedStatus))) ? `
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-border-light); display: flex; flex-direction: column; align-items: flex-end; width: 100%;">
          <button id="v5-cancel-order-btn" class="v5-cancel-btn" style="margin: 0; padding: 6px 14px; font-size: 11.5px; font-weight: 800; background: rgba(239, 68, 68, 0.08); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
            ${icon('trash', 13)} ${order.isTrip ? 'Cancelar Viaje' : 'Cancelar Pedido'}
          </button>
          ${order.pointsRedeemed > 0 ? `
            <div style="display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 750; color: var(--color-text-secondary); opacity: 0.85; margin-top: 4px;">
              ${icon('goPointsLogo', 11)} Go Points canjeados serán reintegrados
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('v5-copy-alias-btn')?.addEventListener('click', () => {
    if (order.driverAlias) {
      navigator.clipboard.writeText(order.driverAlias).then(() => {
        showToast('Alias copiado al portapapeles 📋', 'success');
      }).catch(() => {
        showToast(`Alias: ${order.driverAlias}`, 'info');
      });
    }
  });

  document.getElementById('v5-toggle-details-btn')?.addEventListener('click', () => {
    isDetailsExpanded = !isDetailsExpanded;
    const expDiv = document.getElementById('v5-expandable-details');
    const toggleBtn = document.getElementById('v5-toggle-details-btn');
    if (expDiv && toggleBtn) {
      if (isDetailsExpanded) {
        expDiv.classList.add('expanded');
        toggleBtn.innerHTML = `<span>Ocultar</span> ${icon('chevronUp', 13)}`;
      } else {
        expDiv.classList.remove('expanded');
        toggleBtn.innerHTML = `<span>Ver Detalles</span> ${icon('chevronDown', 13)}`;
      }
    }
  });

  document.getElementById('chat-v5-btn')?.addEventListener('click', () => {
    import('../components/chat.js').then(m => m.openChat({
      orderId: order.id, type: 'client-delivery', otherName: order.driverName || 'Repartidor', orderNum: order.orderId
    }));
  });

  document.getElementById('v5-cancel-order-btn')?.addEventListener('click', () => {
    const redeemedPoints = order.pointsRedeemed || 0;
    const pointsText = redeemedPoints > 0 
      ? `Los <b>${redeemedPoints} Go Points</b> canjeados serán reintegrados de forma automática e inmediata a tu cuenta.`
      : 'Los <b>Go Points</b> canjeados en esta compra (si los hubiere) serán reintegrados de forma automática e inmediata a tu cuenta.';

    const confirmMessage = order.isTrip
      ? '¿Estás seguro de que deseas cancelar este viaje? Se cancelará la solicitud de inmediato.'
      : `
      ¿Estás seguro de que deseas cancelar este pedido? Se notificará al comercio de inmediato.
      <br><br>
      <span style="font-size: 13px; color: var(--color-text-secondary); display: block; border-top: 1px solid var(--color-border-light); padding-top: 12px; margin-top: 4px; text-align: left; line-height: 1.5;">
        ℹ️ <b>Reintegro de Puntos:</b> ${pointsText}
      </span>
    `;

    showConfirm({
      title: order.isTrip ? 'Cancelar Viaje' : 'Cancelar Pedido',
      message: confirmMessage,
      confirmText: 'Sí, cancelar',
      cancelText: 'Volver',
      danger: true,
      onConfirm: async () => {
        try {
          await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', order.id);
            const orderSnap = await transaction.get(orderRef);
            if (!orderSnap.exists()) throw 'Pedido no encontrado';

            const orderData = orderSnap.data();
            const rawStatus = (orderData.status || '').toString().toLowerCase();
            const allowedCancelStatuses = orderData.isTrip
              ? ['ready', 'preparing', 'confirmed', 'pending']
              : ['pendiente', 'pending'];

            if (!allowedCancelStatuses.includes(rawStatus)) {
              throw orderData.isTrip
                ? 'Un chofer ya inició el viaje o este ya fue cancelado.'
                : 'El comercio ya está preparando tu pedido o este ya fue cancelado.';
            }

            transaction.update(orderRef, {
              status: 'cancelled',
              cancelledAt: serverTimestamp(),
              cancelledBy: 'client'
            });

            if (orderData.pointsRedeemed > 0 && orderData.userId) {
              const userRef = doc(db, 'users', orderData.userId);
              transaction.update(userRef, {
                points: increment(orderData.pointsRedeemed)
              });
            }
          });
          showToast('Pedido cancelado con éxito', 'success');
        } catch (err) {
          console.error('Error cancelling order:', err);
          showToast(typeof err === 'string' ? err : 'Error al cancelar el pedido', 'error');
          throw err;
        }
      }
    });
  });

  const infoBtn = document.getElementById('v5-price-breakdown-info-btn');
  if (infoBtn) {
    infoBtn.onclick = (e) => {
      e.stopPropagation();
      window.openPriceBreakdownModal(order);
    };
  }

  // Trigger Asynchronous Predictive and Weather-Adaptive ETA calculation
  setTimeout(() => {
    calculatePredictiveETA(order).then(eta => {
      const etaContainer = document.getElementById('v5-dynamic-eta-container');
      if (etaContainer) {
        if (order.status === 'completed' || order.status === 'cancelled' || isWaitingConfirmation || isSearchingRider) {
          etaContainer.innerHTML = '';
        } else {
          const timeStr = eta.label.includes('Llega') ? `<b>${eta.total} min</b>` : `<b>${eta.min}-${eta.max} min</b>`;
          etaContainer.innerHTML = `
            <div class="v5-eta-floating-badge" style="background: var(--glass-bg, rgba(255, 255, 255, 0.95)); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--glass-border, rgba(0,0,0,0.08)); padding: 7px 12px; border-radius: 14px; display: inline-flex; align-items: center; gap: 6px; font-weight: 850; font-size: 12px; color: var(--color-primary); box-shadow: 0 4px 16px rgba(0,0,0,0.1); white-space: nowrap; animation: fadeIn 0.3s ease;">
              ${icon('clock', 14)}
              <span>${timeStr}</span>
              ${order.isRaining ? `
                <span class="rain-badge-pulsing" style="font-size:9.5px; font-weight:900; background:rgba(0, 158, 227, 0.1); color:#009EE3; padding:2px 6px; border-radius:6px; display:inline-flex; align-items:center; gap:2px;">
                  🌧️ +25%
                </span>
              ` : ''}
            </div>
          `;
        }
      }
    });
  }, 50);
}

function updateMap(order) {
  if (typeof google === 'undefined') return;
  const container = document.getElementById('live-tracking-map');
  if (!container) return;

  const isFinalized = order.status === 'completed' || order.status === 'cancelled';
  if (isFinalized) {
    if (liveMap) {
      if (riderMarker) riderMarker.setMap(null);
      if (homeMarker) homeMarker.setMap(null);
      if (pickupMarker) pickupMarker.setMap(null);
      if (dropoffMarker) dropoffMarker.setMap(null);
      if (routeLine) routeLine.setMap(null);
      if (routeLineGlow) routeLineGlow.setMap(null);
    }
    container.innerHTML = `
      <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--color-bg-secondary); color:var(--color-text-tertiary); padding:40px; text-align:center;">
        <div style="opacity:0.2; margin-bottom:16px;">${icon('map', 64)}</div>
        <p style="font-size:14px; font-weight:700;">Seguimiento en vivo finalizado</p>
      </div>
    `;
    return;
  }

  const rawStatus = (order.status || '').toString().toLowerCase();

  if (order.isTrip === true) {
    const riderPos = order.driverLocation ? { lat: order.driverLocation.lat, lng: order.driverLocation.lng } : null;
    const pickupPos = order.pickupCoords ? { lat: order.pickupCoords.lat, lng: order.pickupCoords.lng } : null;
    const dropoffPos = order.deliveryCoords ? { lat: order.deliveryCoords.lat, lng: order.deliveryCoords.lng } : null;

    if (!liveMap) {
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      liveMap = new google.maps.Map(container, {
        zoom: 16,
        center: pickupPos || dropoffPos || { lat: -35.0315, lng: -57.5147 },
        disableDefaultUI: true,
        zoomControl: false,
        styles: theme === 'dark' ? getDarkStyles() : [],
        gestureHandling: 'greedy'
      });
    }

    if (pickupPos) {
      if (!pickupMarker) {
        pickupMarker = new google.maps.OverlayView();
        pickupMarker.pos = pickupPos;
        pickupMarker.onAdd = function() {
          const div = document.createElement('div');
          div.className = 'v5-marker-shadow';
          div.style.position = 'absolute';
          div.style.zIndex = '50';
          div.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center;">
              <div style="background:#22c55e; width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow:0 6px 15px rgba(34,197,94, 0.45);">
                <div style="color:white; display:flex;">${icon('user', 18)}</div>
              </div>
              <div style="width:10px; height:3px; background:rgba(0,0,0,0.15); border-radius:50%; margin-top:2px; filter:blur(1px);"></div>
            </div>`;
          this.getPanes().overlayMouseTarget.appendChild(div);
          this.div = div;
        };
        pickupMarker.draw = function() {
          const projection = this.getProjection();
          if (!projection) return;
          const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
          if (point && this.div) {
            this.div.style.left = (point.x - 19) + 'px';
            this.div.style.top = (point.y - 41) + 'px';
          }
        };
        pickupMarker.setMap(liveMap);
      } else {
        pickupMarker.pos = pickupPos;
        if (pickupMarker.draw) pickupMarker.draw();
      }
    }

    if (dropoffPos) {
      if (!dropoffMarker) {
        dropoffMarker = new google.maps.OverlayView();
        dropoffMarker.pos = dropoffPos;
        dropoffMarker.onAdd = function() {
          const div = document.createElement('div');
          div.className = 'v5-marker-shadow';
          div.style.position = 'absolute';
          div.style.zIndex = '50';
          div.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center;">
              <div style="background:#ef4444; width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow:0 6px 15px rgba(239,68,68, 0.45);">
                <div style="color:white; display:flex;">${icon('mapPin', 18)}</div>
              </div>
              <div style="width:10px; height:3px; background:rgba(0,0,0,0.15); border-radius:50%; margin-top:2px; filter:blur(1px);"></div>
            </div>`;
          this.getPanes().overlayMouseTarget.appendChild(div);
          this.div = div;
        };
        dropoffMarker.draw = function() {
          const projection = this.getProjection();
          if (!projection) return;
          const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
          if (point && this.div) {
            this.div.style.left = (point.x - 19) + 'px';
            this.div.style.top = (point.y - 41) + 'px';
          }
        };
        dropoffMarker.setMap(liveMap);
      } else {
        dropoffMarker.pos = dropoffPos;
        if (dropoffMarker.draw) dropoffMarker.draw();
      }
    }

    if (riderPos) {
      if (!riderMarker) {
        riderMarker = new google.maps.OverlayView();
        riderMarker.pos = riderPos;
        riderMarker.lastPos = null;
        riderMarker.angle = 0;
        riderMarker.onAdd = function() {
          const div = document.createElement('div');
          div.className = 'v5-marker-shadow';
          div.style.position = 'absolute';
          div.style.transition = 'left 1.5s linear, top 1.5s linear, transform 1.5s linear';
          div.innerHTML = `
            <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; position:relative;">
              <div class="sonar-pulse-ring-1"></div>
              <div class="sonar-pulse-ring-2"></div>
              <div class="rider-marker-avatar" style="background:#3b82f6; color:white; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2.5px solid white; position:relative; z-index:2; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.45); transition: transform 0.8s ease;">
                ${order.tripType === 'moto' ? icon('bike', 18) : icon('car', 18)}
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
            this.div.style.left = (point.x - 20) + 'px';
            this.div.style.top = (point.y - 20) + 'px';
            const avatar = this.div.querySelector('.rider-marker-avatar');
            if (avatar) {
              avatar.style.transform = `rotate(${this.angle}deg)`;
            }
          }
        };
        riderMarker.setMap(liveMap);
      } else {
        if (riderMarker.pos && (riderMarker.pos.lat !== riderPos.lat || riderMarker.pos.lng !== riderPos.lng)) {
          // Calculate heading/bearing angle
          const lat1 = riderMarker.pos.lat * Math.PI / 180;
          const lat2 = riderPos.lat * Math.PI / 180;
          const dLon = (riderPos.lng - riderMarker.pos.lng) * Math.PI / 180;
          const y = Math.sin(dLon) * Math.cos(lat2);
          const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
          let bearing = Math.atan2(y, x) * 180 / Math.PI;
          bearing = (bearing + 360) % 360;
          
          // Smooth rotation logic: avoid spinning the full wheel around 360
          let delta = bearing - (riderMarker.angle % 360);
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          riderMarker.angle += delta;
        }
        riderMarker.pos = riderPos;
        if (riderMarker.div) {
          const innerBadge = riderMarker.div.querySelector('.rider-marker-avatar');
          if (innerBadge) {
            innerBadge.innerHTML = order.tripType === 'moto' ? icon('bike', 18) : icon('car', 18);
          }
        }
        if (riderMarker.draw) riderMarker.draw();
      }
    }

    if (isFirstFit) {
      const bounds = new google.maps.LatLngBounds();
      if (pickupPos) bounds.extend(pickupPos);
      if (dropoffPos) bounds.extend(dropoffPos);
      if (riderPos) bounds.extend(riderPos);
      liveMap.fitBounds(bounds, { top: 50, bottom: 250, left: 50, right: 50 });
      isFirstFit = false;
    }

    if (riderPos) {
      const targetPos = (rawStatus === 'delivering' || rawStatus === 'en camino') ? dropoffPos : pickupPos;
      if (targetPos) {
        updateRoute(riderPos, targetPos);
      }
    }
  } else {
    const riderPos = order.driverLocation ? { lat: order.driverLocation.lat, lng: order.driverLocation.lng } : null;
    const destPos = order.deliveryCoords ? { lat: order.deliveryCoords.lat, lng: order.deliveryCoords.lng } : null;

    if (!liveMap) {
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      liveMap = new google.maps.Map(container, {
        zoom: 16,
        center: destPos || riderPos || { lat: -35.0315, lng: -57.5147 },
        disableDefaultUI: true,
        zoomControl: false,
        styles: theme === 'dark' ? getDarkStyles() : [],
        gestureHandling: 'greedy'
      });
    }

    if (destPos && riderPos && isFirstFit) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(destPos);
      bounds.extend(riderPos);
      liveMap.fitBounds(bounds, { top: 50, bottom: 250, left: 50, right: 50 });
      isFirstFit = false;
    } else if (destPos && isFirstFit && !riderPos) {
      liveMap.setCenter(destPos);
      liveMap.setZoom(17);
      isFirstFit = false;
    }

    if (destPos) {
      if (!homeMarker) {
        homeMarker = new google.maps.OverlayView();
        homeMarker.pos = destPos;
        homeMarker.onAdd = function() {
          const div = document.createElement('div');
          div.className = 'v5-marker-shadow';
          div.style.position = 'absolute';
          div.style.zIndex = '50';
          div.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center;">
              <div style="background:#ef4444; width:48px; height:48px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow:0 10px 25px rgba(239,68,68, 0.5);">
                <div style="transform:rotate(45deg); color:white; display:flex;">${icon('home', 24)}</div>
              </div>
              <div style="width:12px; height:4px; background:rgba(0,0,0,0.15); border-radius:50%; margin-top:4px; filter:blur(2px);"></div>
            </div>`;
          this.getPanes().overlayMouseTarget.appendChild(div);
          this.div = div;
        };
        homeMarker.draw = function() {
          const projection = this.getProjection();
          if (!projection) return;
          const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
          if (point && this.div) {
            this.div.style.left = (point.x - 24) + 'px';
            this.div.style.top = (point.y - 52) + 'px';
          }
        };
        homeMarker.setMap(liveMap);
      } else {
        homeMarker.pos = destPos;
        if (homeMarker.draw) homeMarker.draw();
      }
    }

    if (riderPos) {
      if (!riderMarker) {
        riderMarker = new google.maps.OverlayView();
        riderMarker.pos = riderPos;
        riderMarker.lastPos = null;
        riderMarker.angle = 0;
        riderMarker.onAdd = function() {
          const div = document.createElement('div');
          div.className = 'v5-marker-shadow';
          // NO transition CSS on left/top to keep marker anchored during map pan/zoom
          div.style.cssText = 'position:absolute; pointer-events:none; z-index:100;';
          div.innerHTML = `
            <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; position:relative;">
              <div class="rider-marker-avatar" style="background:var(--color-primary); color:white; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; position:relative; z-index:2; box-shadow: 0 6px 16px rgba(225, 29, 72, 0.45); transition: transform 0.8s ease;">
                ${order.tripType === 'moto' ? icon('bike', 20) : icon('car', 20)}
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
            this.div.style.left = (point.x - 20) + 'px';
            this.div.style.top = (point.y - 20) + 'px';
            const avatar = this.div.querySelector('.rider-marker-avatar');
            if (avatar) {
              avatar.style.transform = `rotate(${this.angle}deg)`;
            }
          }
        };
        riderMarker.setMap(liveMap);
      } else {
        if (riderMarker.pos && (riderMarker.pos.lat !== riderPos.lat || riderMarker.pos.lng !== riderPos.lng)) {
          // Calculate heading/bearing angle
          const lat1 = riderMarker.pos.lat * Math.PI / 180;
          const lat2 = riderPos.lat * Math.PI / 180;
          const dLon = (riderPos.lng - riderMarker.pos.lng) * Math.PI / 180;
          const y = Math.sin(dLon) * Math.cos(lat2);
          const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
          let bearing = Math.atan2(y, x) * 180 / Math.PI;
          bearing = (bearing + 360) % 360;
          
          // Smooth rotation logic: avoid spinning the full wheel around 360
          let delta = bearing - (riderMarker.angle % 360);
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          riderMarker.angle += delta;
        }
        riderMarker.pos = riderPos;
        if (riderMarker.draw) riderMarker.draw();
      }
    }

    if (riderPos && destPos) {
      updateRoute(riderPos, destPos);
    }
  }
}

function getTripStepClass(order, index) {
  const rawStatus = (order.status || '').toString().toLowerCase();
  let currentVal = 0;
  if (!order.driverId) {
    currentVal = 0; // Buscando
  } else if (rawStatus === 'confirmed') {
    currentVal = 1; // Asignado
  } else if (rawStatus === 'ready') {
    currentVal = 2; // En camino
  } else if (rawStatus === 'delivering' || rawStatus === 'en camino') {
    currentVal = 3; // En viaje
  } else if (rawStatus === 'completed' || rawStatus === 'entregado') {
    currentVal = 4; // Llegaste
  }
  
  if (currentVal > index) return 'completed';
  if (currentVal === index) return 'active';
  return 'inactive';
}

function getTripStepperLinePercent(order) {
  const rawStatus = (order.status || '').toString().toLowerCase();
  let currentVal = 0;
  if (!order.driverId) {
    currentVal = 0;
  } else if (rawStatus === 'confirmed') {
    currentVal = 25;
  } else if (rawStatus === 'ready') {
    currentVal = 50;
  } else if (rawStatus === 'delivering' || rawStatus === 'en camino') {
    currentVal = 75;
  } else if (rawStatus === 'completed' || rawStatus === 'entregado') {
    currentVal = 100;
  }
  return currentVal;
}

let lastRouteFetchTime = 0;
let lastRouteStartCoords = null;
let lastRouteEndCoords = null;

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

async function updateRoute(start, end) {
  const now = Date.now();
  const timeElapsed = now - lastRouteFetchTime;
  
  let shouldFetch = false;
  if (!lastRouteStartCoords || !lastRouteEndCoords) {
    shouldFetch = true;
  } else {
    const startMoved = getHaversineDistance(start.lat, start.lng, lastRouteStartCoords.lat, lastRouteStartCoords.lng);
    const endMoved = getHaversineDistance(end.lat, end.lng, lastRouteEndCoords.lat, lastRouteEndCoords.lng);
    
    // Fetch a new route every 10 seconds if start/end moved (for fluid polyline recalculation)
    if (timeElapsed >= 10000 && (startMoved >= 12 || endMoved >= 8)) {
      shouldFetch = true;
    }
  }

  if (!shouldFetch) {
    if (routeLine && routeLineGlow) {
      try {
        const path = routeLine.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
        if (path.length >= 2) {
          // Adjust start position of current route optimistically
          path[0] = start;
          routeLine.setPath(path);
          routeLineGlow.setPath(path);
        }
      } catch (e) {
        console.warn('Optimistic route path update failed:', e);
      }
    }
    return;
  }

  lastRouteFetchTime = now;
  lastRouteStartCoords = { lat: start.lat, lng: start.lng };
  lastRouteEndCoords = { lat: end.lat, lng: end.lng };

  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (data.routes?.[0] && liveMap) {
      let coords = data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
      
      // EXTREME PRECISION: Prepend riderPos and append destPos to ensure the line "touches" the markers
      coords.unshift(start);
      coords.push(end);

      let isNewLine = false;
      if (!routeLineGlow) {
        isNewLine = true;
        routeLineGlow = new google.maps.Polyline({
          path: coords,
          geodesic: true,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.18,
          strokeWeight: 10,
          map: liveMap
        });
      } else {
        routeLineGlow.setPath(coords);
      }

      if (!routeLine) {
        isNewLine = true;
        const lineSymbol = {
          path: google.maps.SymbolPath.CIRCLE,
          fillOpacity: 1,
          scale: 4,
          fillColor: '#3b82f6',
          strokeColor: '#3b82f6',
          strokeWeight: 1
        };
        routeLine = new google.maps.Polyline({
          path: coords,
          geodesic: true,
          strokeOpacity: 0,
          icons: [{
            icon: lineSymbol,
            offset: '0%',
            repeat: '18px'
          }],
          map: liveMap
        });
      } else {
        routeLine.setPath(coords);
      }

      if (isFirstFit || isNewLine) {
        const bounds = new google.maps.LatLngBounds();
        coords.forEach(c => bounds.extend(c));
        liveMap.fitBounds(bounds, { top: 50, bottom: 250, left: 50, right: 50 });
        isFirstFit = false;
      }

      const durationSec = data.routes[0].duration;
      const minutes = Math.ceil(durationSec / 60) + 1;
      currentETA = minutes;
      const etaValEl = document.querySelector('#v5-dynamic-eta-container b');
      if (etaValEl) {
        etaValEl.textContent = `${minutes} min`;
      }
    }
  } catch (err) { console.warn('Route/ETA error', err); }
}

/**
 * Calculates the full predictive ETA in minutes.
 * @param {Object} order 
 * @returns {Promise<{ min: number, max: number, total: number, label: string }>}
 */
async function calculatePredictiveETA(order) {
  const isRaining = order.isRaining === true;
  const weatherMultiplier = isRaining ? 1.25 : 1.0;
  const isFavor = order.isFavor === true;
  const rawStatus = (order.status || '').toString().toLowerCase();
  
  const now = new Date();

  // 1. Calculate preparation time and pickup delay dynamically using historical orders
  let prepTime = 20; // default prep time fallback
  let pickupDelay = isFavor ? 3 : 5; // default pickup delay fallback

  if (order.comercioId && !isFavor) {
    try {
      const q = query(
        collection(db, 'orders'),
        where('comercioId', '==', order.comercioId)
      );
      const snap = await getDocs(q);
      
      const pastOrders = [];
      snap.forEach(docSnap => {
        const d = docSnap.data();
        if (d.status && ['ready', 'delivering', 'completed'].includes(d.status) && d.confirmedAt && d.readyAt) {
          pastOrders.push({
            confirmedAt: d.confirmedAt.toDate ? d.confirmedAt.toDate() : new Date(d.confirmedAt),
            readyAt: d.readyAt.toDate ? d.readyAt.toDate() : new Date(d.readyAt),
            pickedUpAt: d.pickedUpAt || null,
            items: d.items || [],
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt || 0)
          });
        }
      });
      
      // Sort by creation date descending (recent first)
      pastOrders.sort((a, b) => b.createdAt - a.createdAt);
      
      const validPrepDurations = [];
      const similarPrepDurations = [];
      const validPickupDelays = [];
      const currentItemCount = (order.items || []).reduce((sum, i) => sum + (i.qty || 1), 0);
      
      pastOrders.forEach(p => {
        const durationMin = (p.readyAt - p.confirmedAt) / 60000;
        // Keep valid preparations between 1 and 120 minutes to filter out test/manual anomaly actions
        if (durationMin >= 1 && durationMin <= 120) {
          validPrepDurations.push(durationMin);
          
          const histItemCount = (p.items || []).reduce((sum, i) => sum + (i.qty || 1), 0);
          if (Math.abs(histItemCount - currentItemCount) <= 1) {
            similarPrepDurations.push(durationMin);
          }
        }

        // Calculate actual pickup delay if timestamps are available
        if (p.readyAt && p.pickedUpAt) {
          const pickedUpTime = p.pickedUpAt.toDate ? p.pickedUpAt.toDate() : new Date(p.pickedUpAt);
          const delayMin = (pickedUpTime - p.readyAt) / 60000;
          if (delayMin >= 0 && delayMin <= 60) {
            validPickupDelays.push(delayMin);
          }
        }
      });
      
      // Select the best preparation time estimate based on sample size
      if (similarPrepDurations.length >= 3) {
        const sum = similarPrepDurations.reduce((acc, val) => acc + val, 0);
        prepTime = Math.ceil(sum / similarPrepDurations.length);
      } else if (validPrepDurations.length > 0) {
        const recentSubset = validPrepDurations.slice(0, 10);
        const sum = recentSubset.reduce((acc, val) => acc + val, 0);
        const generalAvg = sum / recentSubset.length;
        
        if (similarPrepDurations.length > 0) {
          const simSum = similarPrepDurations.reduce((acc, val) => acc + val, 0);
          const simAvg = simSum / similarPrepDurations.length;
          const weight = similarPrepDurations.length === 2 ? 0.7 : 0.4;
          prepTime = Math.ceil((simAvg * weight) + (generalAvg * (1 - weight)));
        } else {
          prepTime = Math.ceil(generalAvg);
        }
      } else {
        prepTime = 15 + (currentItemCount * 2);
      }
      
      // Select the best rider pickup delay estimate
      if (validPickupDelays.length > 0) {
        const recentDelays = validPickupDelays.slice(0, 10);
        const sum = recentDelays.reduce((acc, val) => acc + val, 0);
        pickupDelay = Math.ceil(sum / recentDelays.length);
      }
      
      // Impose reasonable constraints
      prepTime = Math.max(5, Math.min(90, prepTime));
      pickupDelay = Math.max(3, Math.min(20, pickupDelay));
    } catch (err) {
      console.warn('[ETA] Error calculating dynamic prep/pickup times, using fallback:', err);
      const currentItemCount = (order.items || []).reduce((sum, i) => sum + (i.qty || 1), 0);
      prepTime = 15 + (currentItemCount * 2);
    }
  }

  // Calculate remaining preparation time
  let prepTimeRemaining = prepTime;
  if (rawStatus === 'confirmed' || rawStatus === 'preparando') {
    if (order.confirmedAt?.toDate) {
      const confirmedTime = order.confirmedAt.toDate();
      const elapsedMin = Math.floor((now - confirmedTime) / 60000);
      prepTimeRemaining = Math.max(2, prepTime - elapsedMin); // at least 2 mins left if still prepping
    }
  } else if (rawStatus === 'ready' || rawStatus === 'listo' || rawStatus === 'en camino' || rawStatus === 'delivering') {
    prepTimeRemaining = 0; // Already prepared!
  }

  // 2. Fetch or estimate travel durations using OSRM
  let riderToStoreTime = 5; // 5 minutes default dispatch/travel
  let storeToCustomerTime = 8; // 8 minutes default transit

  const commerceCoords = order.comercioCoords || order.pickupCoords;
  const deliveryCoords = order.deliveryCoords;
  const driverCoords = order.driverLocation;

  try {
    // A. Commerce to Customer distance
    if (commerceCoords && deliveryCoords) {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${commerceCoords.lng},${commerceCoords.lat};${deliveryCoords.lng},${deliveryCoords.lat}?overview=false`);
      const data = await res.json();
      if (data.routes?.[0]) {
        storeToCustomerTime = Math.ceil((data.routes[0].duration / 60) * weatherMultiplier);
      }
    }

    // B. Rider to Commerce distance (if assigned and not yet delivering)
    if (order.driverId && driverCoords && commerceCoords && rawStatus !== 'delivering' && rawStatus !== 'en camino') {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${driverCoords.lng},${driverCoords.lat};${commerceCoords.lng},${commerceCoords.lat}?overview=false`);
      const data = await res.json();
      if (data.routes?.[0]) {
        riderToStoreTime = Math.ceil((data.routes[0].duration / 60) * weatherMultiplier);
      }
    } else if (order.driverId && rawStatus === 'delivering') {
      riderToStoreTime = 0;
    }
  } catch (err) {
    console.warn('[ETA] OSRM prediction error, using fallbacks:', err);
  }

  // Calculate totals
  let totalMin = 0;
  let label = '';

  if (order.isFavor) {
    const isShopping = order.favorType === 'compra' || (order.favorTypeLabel || '').toLowerCase().includes('compra');
    const shoppingOrPickupTime = isShopping ? 15 : 5; // 15 mins for supermarket/store purchase, 5 mins for package pickup

    if (rawStatus === 'delivering' || rawStatus === 'en camino') {
      totalMin = Math.max(3, storeToCustomerTime);
      label = 'Llega en';
    } else if (order.driverId) {
      totalMin = riderToStoreTime + shoppingOrPickupTime + storeToCustomerTime;
      label = 'Estimado de entrega';
    } else {
      totalMin = 5 + shoppingOrPickupTime + storeToCustomerTime + 3;
      label = 'Estimado de entrega';
    }
  } else if (rawStatus === 'pending' || rawStatus === 'pendiente') {
    totalMin = Math.max(prepTime, riderToStoreTime) + pickupDelay + storeToCustomerTime + 3;
    label = 'Estimado de entrega';
  } else if (rawStatus === 'confirmed' || rawStatus === 'preparando') {
    totalMin = Math.max(prepTimeRemaining, riderToStoreTime) + pickupDelay + storeToCustomerTime;
    label = 'Estimado de entrega';
  } else if (rawStatus === 'ready' || rawStatus === 'listo') {
    totalMin = riderToStoreTime + pickupDelay + storeToCustomerTime;
    label = 'Estimado de entrega';
  } else if (rawStatus === 'delivering' || rawStatus === 'en camino') {
    totalMin = Math.max(3, storeToCustomerTime);
    label = 'Llega en';
  }

  const minWindow = Math.max(1, totalMin - 2);
  const maxWindow = totalMin + 3;

  return {
    min: minWindow,
    max: maxWindow,
    total: totalMin,
    label
  };
}

function getProgress(status, isFavor = false) {
  const steps = { 'pending': 20, 'confirmed': 40, 'ready': 60, 'delivering': 85, 'completed': 100 };
  if (isFavor && status === 'pending') return 30;
  return steps[status] || 0;
}

function getStepClass(status, index, isFavor = false) {
  if (isFavor) {
    // Favor steps: 0: Solicitado, 1: Buscando, 2: Yendo al punto, 3: En camino
    const favorMap = { 'pending': 0, 'confirmed': 1, 'ready': 2, 'delivering': 3, 'completed': 4 };
    const curr = favorMap[status] ?? 0;
    if (curr > index) return 'completed';
    if (curr === index) return 'active';
    return 'inactive';
  } else {
    // Commerce steps: 0: Pendiente, 1: Aprobado, 2: Preparando, 3: Listo, 4: En camino
    const commerceMap = { 'pending': 0, 'confirmed': 1, 'preparing': 2, 'ready': 3, 'delivering': 4, 'completed': 5 };
    const curr = commerceMap[status] ?? 0;
    if (curr > index) return 'completed';
    if (curr === index) return 'active';
    if (curr === 2 && index === 1) return 'completed';
    return 'inactive';
  }
}

function getStepperLinePercent(status, isFavor = false) {
  if (isFavor) {
    // 4 steps -> 3 intervals (0%, 33.3%, 66.6%, 100%)
    const favorLineMap = { 'pending': 0, 'confirmed': 33.3, 'ready': 66.6, 'delivering': 100, 'completed': 100 };
    return favorLineMap[status] ?? 0;
  } else {
    // 5 steps -> 4 intervals (0%, 25%, 50%, 75%, 100%)
    const commerceLineMap = { 'pending': 0, 'confirmed': 25, 'preparing': 50, 'ready': 75, 'delivering': 100, 'completed': 100 };
    return commerceLineMap[status] ?? 0;
  }
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

export function showPointsEarnedModal(order) {
  const s = getState();
  const dollarPerPoint = s.dollarPerPoint || 1;
  window.lastDollarPerPoint = dollarPerPoint;
  
  const points = order.pointsEarned;
  const hasPoints = points !== undefined && points !== null;
  const valueDiscount = (points || 0) * dollarPerPoint;

  const levelMap = {
    bronce: { name: 'Bronce', color: '#CD7F32' },
    plata: { name: 'Plata', color: '#C0C0C0' },
    oro: { name: 'Oro', color: '#FFD700' }
  };
  const lvlInfo = levelMap[order.userLevel || 'bronce'] || levelMap.bronce;

  const modalContent = `
    <div style="padding: 24px 20px; text-align: center; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; align-items: center; gap: 16px;">
      
      <!-- Pulsing Circle -->
      <div class="points-earned-pulse" style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(245, 158, 11, 0.4); animation: points-bounce 1s infinite alternate; position: relative;">
        ${icon('goPointsLogo', 42)}
      </div>

      <div style="margin-top: 8px;">
        <h3 style="font-family: var(--font-display); font-size: 22px; font-weight: 950; margin: 0; letter-spacing: -0.5px;">¡Pedido Entregado!</h3>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0 0; font-weight: 600; line-height: 1.45;">
          ¡Tu pedido #${(order.orderId || order.id || '').toString().slice(-4).toUpperCase()} llegó con éxito!
        </p>
      </div>

      <div style="background: var(--color-bg-secondary); border: 1.5px solid var(--color-border-light); border-radius: 20px; padding: 18px 24px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; box-shadow: var(--shadow-sm);">
        <span style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px;">Sumaste en Club GO</span>
        <div id="modal-points-value-container" style="font-size: 32px; font-weight: 950; color: #f59e0b; letter-spacing: -0.5px; display: flex; align-items: center; gap: 4.5px; min-height: 38px;">
          ${hasPoints ? `+${points} <span style="font-size: 14px; font-weight: 850; letter-spacing: 0;">GO PTS</span>` : `<div class="spinner-mini" style="width:20px; height:20px; border-width:3px; border-top-color:#f59e0b; margin:0;"></div>`}
        </div>
        <div id="modal-points-discount-container" style="font-size: 12px; color: var(--color-text-secondary); font-weight: 700; margin-top: 2px;">
          ${hasPoints ? `Equivalentes a <strong style="color: var(--color-success); font-weight: 900;">${formatPrice(valueDiscount)}</strong> de descuento directo.` : `Calculando puntos ganados...`}
        </div>
      </div>

      <div id="modal-points-multiplier-container" style="font-size: 11.5px; color: var(--color-text-tertiary); line-height: 1.5; text-align: center; max-width: 280px; font-weight: 600;">
        ${hasPoints ? `Multiplicador de nivel <strong style="color: ${lvlInfo.color}; font-weight: 900;">${lvlInfo.name}</strong> activo: <strong style="color: var(--color-primary); font-weight: 900;">${order.appliedMultiplier || 1.0}x puntos</strong>.` : ''}
      </div>

      <div id="modal-points-referral-container" style="width: 100%;">
        ${order.referredRewardGranted ? `
          <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%); border: 1.5px dashed rgba(245, 158, 11, 0.4); border-radius: 20px; padding: 16px; width:100%; box-sizing:border-box; text-align:left; display:flex; gap:12px; align-items:flex-start; margin-top: 4px;">
            <span style="font-size:24px; animation: scale-pulse 2s infinite;">🎁</span>
            <div>
              <strong style="font-size:13px; color:#d97706; display:block; margin-bottom:2px;">¡Bono de Referido Acreditado!</strong>
              <span style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.45; display:block;">
                Por haber ingresado con la invitación de tu amigo y completar tu primer pedido, te regalamos <strong>${order.referralBonusAmount || 500} GO Points extra</strong>. ¡Disfrutalos!
              </span>
            </div>
          </div>
        ` : ''}
      </div>

      <button id="btn-close-points-modal" class="btn btn-primary btn-block" style="height: 50px; border-radius: 16px; font-size: 13.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: none; margin-top: 8px; box-shadow: 0 8px 24px rgba(var(--color-primary-rgb), 0.25);">
        ¡Genial, gracias!
      </button>
      
    </div>

    <style>
      @keyframes points-bounce {
        0% { transform: translateY(0) scale(1); }
        100% { transform: translateY(-6px) scale(1.03); }
      }
    </style>
  `;

  showModal({
    title: '🎉 ¡Pedido Entregado!',
    height: 'auto',
    content: modalContent,
    onOpen: () => {
      const btn = document.getElementById('btn-close-points-modal');
      btn?.addEventListener('click', () => {
        localStorage.setItem(`gd_dismissed_points_modal_${order.id}`, 'true');
        closeModal();
      });
    }
  });
}

export function updatePointsModalValues(order) {
  const pointsContainer = document.getElementById('modal-points-value-container');
  const discountContainer = document.getElementById('modal-points-discount-container');
  const multiplierContainer = document.getElementById('modal-points-multiplier-container');
  const referralContainer = document.getElementById('modal-points-referral-container');
  
  if (!pointsContainer || order.pointsEarned === undefined) return;
  
  const points = order.pointsEarned;
  const dollarPerPoint = window.lastDollarPerPoint || 1;
  const valueDiscount = points * dollarPerPoint;
  
  const levelMap = {
    bronce: { name: 'Bronce', color: '#CD7F32' },
    plata: { name: 'Plata', color: '#C0C0C0' },
    oro: { name: 'Oro', color: '#FFD700' }
  };
  const lvlInfo = levelMap[order.userLevel || 'bronce'] || levelMap.bronce;
  
  const formatPrice = (val) => `$${Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  
  // Animate values load
  pointsContainer.style.opacity = '0';
  pointsContainer.style.transform = 'scale(0.8)';
  pointsContainer.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
  
  setTimeout(() => {
    pointsContainer.innerHTML = `+${points} <span style="font-size: 14px; font-weight: 850; letter-spacing: 0;">GO PTS</span>`;
    pointsContainer.style.opacity = '1';
    pointsContainer.style.transform = 'scale(1)';
  }, 150);
  
  if (discountContainer) {
    discountContainer.innerHTML = `Equivalentes a <strong style="color: var(--color-success); font-weight: 900;">${formatPrice(valueDiscount)}</strong> de descuento directo.`;
  }
  
  if (multiplierContainer) {
    multiplierContainer.innerHTML = `
      Multiplicador de nivel <strong style="color: ${lvlInfo.color}; font-weight: 900;">${lvlInfo.name}</strong> activo: <strong style="color: var(--color-primary); font-weight: 900;">${order.appliedMultiplier || 1.0}x puntos</strong>.
    `;
  }

  if (referralContainer && order.referredRewardGranted) {
    referralContainer.innerHTML = `
      <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%); border: 1.5px dashed rgba(245, 158, 11, 0.4); border-radius: 20px; padding: 16px; width:100%; box-sizing:border-box; text-align:left; display:flex; gap:12px; align-items:flex-start; margin-top: 4px;">
        <span style="font-size: 24px;">🎁</span>
        <div>
          <strong style="font-size: 13px; color: #d97706; display: block; margin-bottom: 2px;">¡Bono de Referido Acreditado!</strong>
          <span style="font-size: 11.5px; color: var(--color-text-secondary); line-height: 1.45; display: block;">
            Por haber ingresado con la invitación de tu amigo y completar tu primer pedido, te regalamos <strong>${order.referralBonusAmount || 500} GO Points extra</strong>. ¡Disfrutalos!
          </span>
        </div>
      </div>
    `;
  }
}

// Global live countdown timer for client order tracking screen
if (!window._clientTimerInterval) {
  window._clientTimerInterval = setInterval(() => {
    document.querySelectorAll('.client-queue-timer').forEach(el => {
      const offeredAt = parseInt(el.dataset.offeredAt || '0', 10);
      if (!offeredAt) return;
      const elapsedSec = Math.floor((Date.now() - offeredAt) / 1000);
      const remainingSec = Math.max(0, 60 - elapsedSec);
      el.textContent = `${remainingSec}s`;
    });
  }, 1000);
}

window.closePriceBreakdownModal = function() {
  const backdrop = document.getElementById('v5-price-modal-backdrop');
  const sheet = document.getElementById('v5-price-modal-sheet');
  if (backdrop) backdrop.style.opacity = '0';
  if (sheet) sheet.style.transform = 'translate(-50%, 100%)';
  setTimeout(() => {
    const container = document.getElementById('price-breakdown-modal-container');
    if (container) container.innerHTML = '';
  }, 280);
};

window.openPriceBreakdownModal = function(order) {
  const o = order || window.lastOrderData;
  if (!o) return;
  
  const itemsCost = Number(o.itemsCost || o.subtotal || o.itemsTotal || (o.items || []).reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0)) || 0;
  const shippingFee = Number(o.shippingFee || o.deliveryFee || o.shippingCost || o.deliveryCost || 0) || 0;
  const purchaseFee = Number(o.purchaseFee || o.gestorFee || o.managementFee || 0) || 0;
  const extraStopsFee = Number(o.extraStopsFee || 0) || 0;
  const rainSurcharge = Number(o.rainSurcharge || 0) || 0;
  const serviceFee = Number(o.appUsageFee || o.serviceFee || o.platformFee || 0) || 0;
  const tip = Number(o.tip || 0) || 0;
  const discount = Number(o.discount || o.discountAmount || o.couponDiscount || 0) || 0;

  const calculatedTotal = itemsCost + shippingFee + purchaseFee + extraStopsFee + rainSurcharge + serviceFee + tip - discount;
  const totalVal = (o.totalAmount || o.total) ? Number(o.totalAmount || o.total) : calculatedTotal;
  
  const container = document.getElementById('price-breakdown-modal-container');
  if (!container) return;

  container.innerHTML = `
    <div id="v5-price-modal-backdrop" onclick="window.closePriceBreakdownModal()" style="position:fixed; inset:0; background:rgba(0,0,0,0.25); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); z-index:9998; opacity:0; transition:opacity 0.25s ease;"></div>
    <div id="v5-price-modal-sheet" style="position:fixed; bottom:0; left:50%; transform:translate(-50%, 100%); width:100%; max-width:440px; background:var(--color-surface); border-radius:28px 28px 0 0; box-shadow:0 -10px 40px rgba(0,0,0,0.22); border-top:1px solid var(--color-border); z-index:9999; box-sizing:border-box; transition:transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); overflow:hidden; max-height:85vh; padding-bottom:calc(20px + env(safe-area-inset-bottom, 14px));">
      
      <!-- Premium Red Header Bar -->
      <div style="background: linear-gradient(135deg, var(--color-primary) 0%, #be123c 100%); color: white; padding: 18px 20px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 16px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <div>
            <h3 style="margin:0; font-size:16.5px; font-weight:900; color:white; letter-spacing: -0.3px;">Desglose del Importe</h3>
            <span style="font-size: 11px; opacity: 0.9; font-weight: 700;">Detalle transparente del pedido #${o.orderId || '...'}</span>
          </div>
        </div>
        <button onclick="window.closePriceBreakdownModal()" style="background:rgba(255,255,255,0.2); border:none; width:30px; height:30px; border-radius:50%; font-size:15px; color:white; cursor:pointer; font-weight:900; display:flex; align-items:center; justify-content:center;">✕</button>
      </div>

      <div style="padding: 22px; display:flex; flex-direction:column; gap:11px; font-size:13px; font-weight:700;">
        <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
          <span>${o.isFavor ? 'Costo del Mandado / Productos' : 'Subtotal Productos'}:</span>
          <span style="color:var(--color-text-primary); font-weight:850;">
            ${(o.isFavor && itemsCost === 0) ? '<span style="color:#f59e0b; font-weight:850; background:rgba(245,158,11,0.12); padding:3px 9px; border-radius:8px; border:1px solid rgba(245,158,11,0.3); font-size:11.5px;">PENDIENTE</span>' : `$${Math.round(itemsCost).toLocaleString('es-AR')}`}
          </span>
        </div>
        
        <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
          <span>Costo de Envío / Reparto:</span>
          <span style="color:var(--color-text-primary); font-weight:850;">$${Math.round(shippingFee).toLocaleString('es-AR')}</span>
        </div>

        ${purchaseFee > 0 ? `
          <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
            <span>Gestión de Compra / Trámite:</span>
            <span style="color:var(--color-text-primary); font-weight:850;">$${Math.round(purchaseFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}

        ${extraStopsFee > 0 ? `
          <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
            <span>Paradas Extra:</span>
            <span style="color:var(--color-text-primary); font-weight:850;">$${Math.round(extraStopsFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}

        ${rainSurcharge > 0 ? `
          <div style="display:flex; justify-content:space-between; color:#009EE3;">
            <span>Recargo por Lluvia 🌧️:</span>
            <span style="font-weight:850;">+$${Math.round(rainSurcharge).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}

        ${serviceFee > 0 ? `
          <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
            <span>Tarifa de Servicio:</span>
            <span style="color:var(--color-text-primary); font-weight:850;">$${Math.round(serviceFee).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}

        ${tip > 0 ? `
          <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
            <span>Propina al Repartidor:</span>
            <span style="color:var(--color-text-primary); font-weight:850;">$${Math.round(tip).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}

        ${discount > 0 ? `
          <div style="display:flex; justify-content:space-between; color:#10b981;">
            <span>Descuento / Cupón:</span>
            <span style="font-weight:900;">-$${Math.round(discount).toLocaleString('es-AR')}</span>
          </div>
        ` : ''}

        <div style="border-top:1.5px dashed var(--color-border-light); margin-top:4px; padding-top:14px; display:flex; justify-content:space-between; align-items:center; font-size:17px; font-weight:950; color:var(--color-text-primary);">
          <span>TOTAL FINAL:</span>
          <span style="color:var(--color-primary); font-size:20px;">$${Math.round(totalVal).toLocaleString('es-AR')}</span>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    const backdrop = document.getElementById('v5-price-modal-backdrop');
    const sheet = document.getElementById('v5-price-modal-sheet');
    if (backdrop) backdrop.style.opacity = '1';
    if (sheet) sheet.style.transform = 'translate(-50%, 0)';
  });
};


