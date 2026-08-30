// GoDelivery — True WebGL + SVG HUD Dual-Engine Navigation Map for Delivery Drivers
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NavigationVoice } from '../utils/navigation-voice.js';

let driverMap = null;
let driverMarker = null;
let pickupMarker = null;
let dropoffMarker = null;
let turnBeaconMarker = null;
let is3DActive = false;
let isUserInteracting = false;
let autoRecenterTimer = null;
let driverHistoryCoords = [];
let fullRoutePathCoords = [];
let activeRoutePathCoords = [];
let activeRouteManeuverSteps = [];
let currentManeuverStepIndex = 0;
let currentRouteVertexIndex = 0;
let lastActiveOrderRouteParams = null;
let lastDriverPos = null;
let lastHeading = 0;
let consecutiveOffRouteCount = 0;
let lastRerouteTimestamp = 0;


// Dark High-Legibility Map Style (Carto Dark Matter Retina 2x + Brightened Labels Overlay)
// High-Definition Vector Map Styles (OpenFreeMap Dark & Liberty Vector)
const DARK_MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const LIGHT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function getDriverMapTheme() {
  return localStorage.getItem('gd_driver_theme') || 'dark';
}

export function getDriverThemeMode() {
  return localStorage.getItem('gd_driver_theme_mode') || 'auto';
}

export function setDriverThemeMode(mode) {
  if (mode === 'auto') {
    localStorage.setItem('gd_driver_theme_mode', 'auto');
    checkAutoSolarTheme(true);
  } else {
    localStorage.setItem('gd_driver_theme_mode', mode);
    setDriverMapTheme(mode, false);
  }
}

export function setDriverMapTheme(theme, isManual = true) {
  const newTheme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem('gd_driver_theme', newTheme);
  if (isManual) {
    localStorage.setItem('gd_driver_theme_mode', newTheme);
  }

  if (newTheme === 'light') {
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

  if (driverMap) {
    try {
      const activeStyle = newTheme === 'light' ? LIGHT_MAP_STYLE : DARK_MAP_STYLE;
      driverMap.setStyle(activeStyle);
      driverMap.once('style.load', () => {
        renderRouteHud();
        updateWebGlSource(activeRoutePathCoords);
        const currentPos = lastDriverPos || window.lastRiderPos;
        if (currentPos) {
          if (driverMarker) {
            try { driverMarker.remove(); } catch(e) {}
            driverMarker = null;
          }
          updateDriverMapLocation(currentPos, lastHeading || 0);
        }
        try { driverMap.resize(); } catch(e) {}
      });
    } catch(e) {
      console.warn('[DriverMap] Theme switch error:', e);
    }
  }

  // Force re-create marker immediately for the new theme
  const currentPos = lastDriverPos || window.lastRiderPos;
  if (currentPos) {
    if (driverMarker) {
      try { driverMarker.remove(); } catch(e) {}
      driverMarker = null;
    }
    updateDriverMapLocation(currentPos, lastHeading || 0);
  }

  renderRouteHud();
  window.dispatchEvent(new CustomEvent('driver-theme-changed', { detail: { theme: newTheme } }));
  return newTheme;
}

function calculateBearing(startLat, startLng, destLat, destLng) {
  const startLatRad = (startLat * Math.PI) / 180;
  const startLngRad = (startLng * Math.PI) / 180;
  const destLatRad = (destLat * Math.PI) / 180;
  const destLngRad = (destLng * Math.PI) / 180;
  const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
  const x = Math.cos(startLatRad) * Math.sin(destLatRad) - Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

// Calculate perpendicular distance in meters from point (lat, lng) to segment (p1, p2)
function getDistanceToSegmentMeters(p, p1, p2) {
  const x = p.lng, y = p.lat;
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  let projX, projY;
  if (lenSq === 0) {
    projX = x1;
    projY = y1;
  } else {
    let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    projX = x1 + t * dx;
    projY = y1 + t * dy;
  }

  const dLat = (projY - y) * Math.PI / 180;
  const dLon = (projX - x) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(y * Math.PI / 180) * Math.cos(projY * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

function getMinDistanceToRouteMeters(pos, routeCoords) {
  if (!routeCoords || routeCoords.length < 2) return 0;
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const dist = getDistanceToSegmentMeters(pos, routeCoords[i], routeCoords[i + 1]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export const MANEUVER_SVGS = {
  left: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v5.5"/></svg>`,
  right: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5V20"/></svg>`,
  sharp_left: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17L4 12l5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v3"/></svg>`,
  sharp_right: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"/><path d="M20 12H9a5 5 0 0 0-5 5v3"/></svg>`,
  slight_left: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5H7v7"/><path d="M7 5l12 12"/></svg>`,
  slight_right: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5h7v7"/><path d="M17 5L5 17"/></svg>`,
  straight: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`,
  uturn: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10L4 15l5 5"/><path d="M20 4v7a5 5 0 0 1-5 5H4"/></svg>`,
  roundabout: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4l3 3-3 3"/><path d="M20 12l-3 3-3-3"/></svg>`,
  arrive: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
};

function parseManeuverDetails(step, defaultDist = 0) {
  if (!step) return null;
  const m = step.maneuver || {};
  const type = (m.type || 'continue').toLowerCase();
  const mod = (m.modifier || '').toLowerCase();
  const streetName = step.name || '';
  const dist = Math.round(step.distance || defaultDist || 0);

  let iconSvg = MANEUVER_SVGS.straight;
  let icon = '⬆';
  let verb = 'Continuá';
  let shortVerb = 'Continuá';
  let turnType = 'straight';

  if (type === 'uturn' || mod.includes('uturn')) {
    iconSvg = MANEUVER_SVGS.uturn;
    icon = '⮌';
    verb = 'Hacé un retome en U';
    shortVerb = 'Retome en U';
    turnType = 'uturn';
  } else if (mod.includes('sharp left')) {
    iconSvg = MANEUVER_SVGS.sharp_left;
    icon = '↲';
    verb = 'Doblá cerrado a la izquierda';
    shortVerb = 'Giro cerrado a la izq.';
    turnType = 'sharp_left';
  } else if (mod.includes('slight left')) {
    iconSvg = MANEUVER_SVGS.slight_left;
    icon = '↖';
    verb = 'Mantenete a la izquierda';
    shortVerb = 'Mantenerse a la izq.';
    turnType = 'slight_left';
  } else if (mod.includes('left')) {
    iconSvg = MANEUVER_SVGS.left;
    icon = '↰';
    verb = 'Doblá a la izquierda';
    shortVerb = 'Doblar a la izq.';
    turnType = 'left';
  } else if (mod.includes('sharp right')) {
    iconSvg = MANEUVER_SVGS.sharp_right;
    icon = '↳';
    verb = 'Doblá cerrado a la derecha';
    shortVerb = 'Giro cerrado a la der.';
    turnType = 'sharp_right';
  } else if (mod.includes('slight right')) {
    iconSvg = MANEUVER_SVGS.slight_right;
    icon = '↗';
    verb = 'Mantenete a la derecha';
    shortVerb = 'Mantenerse a la der.';
    turnType = 'slight_right';
  } else if (mod.includes('right')) {
    iconSvg = MANEUVER_SVGS.right;
    icon = '↱';
    verb = 'Doblá a la derecha';
    shortVerb = 'Doblar a la der.';
    turnType = 'right';
  } else if (type.includes('roundabout') || type.includes('rotary')) {
    iconSvg = MANEUVER_SVGS.roundabout;
    icon = '🔄';
    const exitNum = m.exit ? `${m.exit}ª salida` : 'la rotonda';
    verb = `Tomá ${exitNum}`;
    shortVerb = `Rotonda (${exitNum})`;
    turnType = 'roundabout';
  } else if (type === 'arrive') {
    iconSvg = MANEUVER_SVGS.arrive;
    icon = '🏁';
    verb = 'Llegando al destino';
    shortVerb = 'Llegada';
    turnType = 'arrive';
  }

  const instruction = streetName ? `${verb} por ${streetName}` : verb;
  const location = m.location || null;

  return {
    icon,
    iconSvg,
    turnType,
    verb,
    shortVerb,
    instruction,
    streetName,
    distanceMeters: dist,
    location
  };
}

export function updateDynamicManeuverState(driverLngLat, totalDistMeters = null, targetStage = 'pickup') {
  if (!activeRouteManeuverSteps || activeRouteManeuverSteps.length === 0) return;

  const [dLng, dLat] = driverLngLat;

  // Step 0 is departure. Turns start at Step 1.
  let foundIndex = -1;
  let distToTurn = Infinity;

  for (let i = Math.max(1, currentManeuverStepIndex); i < activeRouteManeuverSteps.length; i++) {
    const step = activeRouteManeuverSteps[i];
    if (step && step.location) {
      const d = 6371000 * 2 * Math.asin(Math.sqrt(
        Math.sin(((step.location[1] - dLat) * Math.PI / 180) / 2) ** 2 +
        Math.cos(dLat * Math.PI / 180) * Math.cos(step.location[1] * Math.PI / 180) *
        Math.sin(((step.location[0] - dLng) * Math.PI / 180) / 2) ** 2
      ));

      // If we are at or past this step turn point (distance <= 14m), advance to next step
      if (d > 14) {
        foundIndex = i;
        distToTurn = Math.round(d);
        break;
      }
    }
  }

  if (foundIndex === -1) {
    foundIndex = Math.max(0, activeRouteManeuverSteps.length - 1);
    distToTurn = Math.round(totalDistMeters !== null ? totalDistMeters : 15);
  }

  currentManeuverStepIndex = foundIndex;
  const primaryStep = activeRouteManeuverSteps[currentManeuverStepIndex] || activeRouteManeuverSteps[0];
  const secondaryStep = activeRouteManeuverSteps[currentManeuverStepIndex + 1] || null;

  const effectiveTotalDist = totalDistMeters !== null ? totalDistMeters : distToTurn;
  const etaMins = Math.max(1, Math.round(effectiveTotalDist / 500));

  const initialSegmentDist = Math.max(distToTurn, 150);
  const progressPct = Math.max(0, Math.min(100, Math.round((1 - (distToTurn / initialSegmentDist)) * 100)));

  const maneuverTelemetry = {
    icon: primaryStep?.icon || '⬆',
    iconSvg: primaryStep?.iconSvg || MANEUVER_SVGS.straight,
    turnType: primaryStep?.turnType || 'straight',
    verb: primaryStep?.verb || 'Continuá',
    shortVerb: primaryStep?.shortVerb || 'Continuá',
    instruction: primaryStep?.instruction || 'Continuá recto',
    streetName: primaryStep?.streetName || '',
    distanceMeters: distToTurn,
    progressPct,
    etaMinutes: etaMins,
    currentStreet: primaryStep?.streetName || '',
    totalDistanceMeters: effectiveTotalDist,
    targetStage,
    thenManeuver: secondaryStep ? {
      icon: secondaryStep.icon,
      iconSvg: secondaryStep.iconSvg || MANEUVER_SVGS.straight,
      turnType: secondaryStep.turnType,
      instruction: secondaryStep.instruction,
      shortVerb: secondaryStep.shortVerb,
      distanceMeters: Math.round(secondaryStep.distanceMeters || 100)
    } : null
  };

  window.lastDriverManeuver = maneuverTelemetry;
  window.dispatchEvent(new CustomEvent('driver-navigation-telemetry', { detail: maneuverTelemetry }));
  NavigationVoice.processTelemetry(maneuverTelemetry);

  // Imminent Turn Peripheral Pulse (< 55m alert)
  const hudCard = document.getElementById('driver-maneuver-hud-card');
  if (hudCard) {
    if (distToTurn <= 55 && distToTurn > 0) {
      hudCard.classList.add('imminent-turn-pulse');
    } else {
      hudCard.classList.remove('imminent-turn-pulse');
    }
  }

  // Modern 3D Floating Intersection Beacon Marker
  if (primaryStep?.location && Array.isArray(primaryStep.location) && Number.isFinite(Number(primaryStep.location[0])) && Number.isFinite(Number(primaryStep.location[1])) && distToTurn > 12 && distToTurn < 600 && driverMap && driverMap.getContainer()) {
    const [tLng, tLat] = [Number(primaryStep.location[0]), Number(primaryStep.location[1])];
    const isRight = primaryStep.turnType && primaryStep.turnType.includes('right');
    const isLeft = primaryStep.turnType && primaryStep.turnType.includes('left');
    const beaconTheme = isRight ? '#2563eb' : (isLeft ? '#e11d48' : '#10b981');

    try {
      if (!turnBeaconMarker) {
        const bEl = document.createElement('div');
        bEl.className = 'driver-turn-beacon';
        bEl.style.cssText = 'display:flex; flex-direction:column; align-items:center; pointer-events:none; z-index:450;';
        bEl.innerHTML = `
          <div style="display:flex; align-items:center; gap:5px; padding:5px 10px; border-radius:14px; background:rgba(15,23,42,0.94); backdrop-filter:blur(12px); border:1.5px solid ${beaconTheme}; box-shadow:0 6px 20px ${beaconTheme}88; color:white; font-size:11.5px; font-weight:900; margin-bottom:4px; transform:translateY(-4px);">
            <div style="width:20px; height:20px; display:flex; align-items:center; justify-content:center; color:${beaconTheme};">
              ${primaryStep.iconSvg}
            </div>
            <span>${distToTurn}m</span>
          </div>
          <div style="width:14px; height:14px; border-radius:50%; background:${beaconTheme}; border:2.5px solid white; box-shadow:0 0 14px ${beaconTheme};"></div>
        `;
        turnBeaconMarker = new maplibregl.Marker({ element: bEl, anchor: 'bottom' })
          .setLngLat([tLng, tLat])
          .addTo(driverMap);
      } else {
        turnBeaconMarker.setLngLat([tLng, tLat]);
        const el = turnBeaconMarker.getElement();
        if (el) {
          el.innerHTML = `
            <div style="display:flex; align-items:center; gap:5px; padding:5px 10px; border-radius:14px; background:rgba(15,23,42,0.94); backdrop-filter:blur(12px); border:1.5px solid ${beaconTheme}; box-shadow:0 6px 20px ${beaconTheme}88; color:white; font-size:11.5px; font-weight:900; margin-bottom:4px; transform:translateY(-4px);">
              <div style="width:20px; height:20px; display:flex; align-items:center; justify-content:center; color:${beaconTheme};">
                ${primaryStep.iconSvg}
              </div>
              <span>${distToTurn}m</span>
            </div>
            <div style="width:14px; height:14px; border-radius:50%; background:${beaconTheme}; border:2.5px solid white; box-shadow:0 0 14px ${beaconTheme};"></div>
          `;
        }
      }
    } catch(err) {}
  } else if (turnBeaconMarker) {
    try { turnBeaconMarker.remove(); } catch(e) {}
    turnBeaconMarker = null;
  }
}

// ----------------------------------------------------
// PURE GPU HARDWARE ACCELERATED ROUTE RENDERER
// (All route geometry is rendered natively in WebGL via MapLibre shaders)
export function updateSvgRouteOverlay() {}
export function scheduleRouteHud() {}
export function renderRouteHud() {}

export function initDriverNavigationMap(container) {
  if (!container) return null;

  const targetContainer = typeof container === 'string' ? document.getElementById(container) : container;
  if (!targetContainer) return null;

  targetContainer.style.setProperty('display', 'block', 'important');
  targetContainer.style.setProperty('position', 'fixed', 'important');
  targetContainer.style.setProperty('inset', '0', 'important');
  targetContainer.style.setProperty('top', '0', 'important');
  targetContainer.style.setProperty('left', '0', 'important');
  targetContainer.style.setProperty('right', '0', 'important');
  targetContainer.style.setProperty('bottom', '0', 'important');
  targetContainer.style.setProperty('width', '100vw', 'important');
  targetContainer.style.setProperty('height', '100vh', 'important');
  targetContainer.style.setProperty('height', '100dvh', 'important');
  targetContainer.style.setProperty('z-index', '10', 'important');
  targetContainer.style.setProperty('margin', '0', 'important');
  targetContainer.style.setProperty('padding', '0', 'important');

  // Clean previous instance
  if (driverMap) {
    try {
      if (driverMarker) driverMarker.remove();
      if (pickupMarker) pickupMarker.remove();
      if (dropoffMarker) dropoffMarker.remove();
      clearMultiStopMarkers();
      driverMap.remove();
    } catch(e) {}
    driverMap = null;
    driverMarker = null;
    pickupMarker = null;
    dropoffMarker = null;
  }

  targetContainer.innerHTML = '';

  const magdalenaCenter = [-57.5147, -35.0815]; // [lng, lat] for MapLibre

  const currentTheme = getDriverMapTheme();
  if (currentTheme === 'light') {
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

  const initialStyle = currentTheme === 'light' ? LIGHT_MAP_STYLE : DARK_MAP_STYLE;

  try {
    driverMap = new maplibregl.Map({
      container: targetContainer,
      style: initialStyle,
      center: magdalenaCenter,
      zoom: 15,
      pitch: 0,
      bearing: 0,
      maxPitch: 75,
      attributionControl: false,
      antialias: false, // Low-power GPU optimization for mobile devices
      trackResize: true
    });

    // User touch / pan / zoom interaction tracking (pauses auto-follow for 7 seconds)
    const onUserInteract = () => {
      isUserInteracting = true;
      if (autoRecenterTimer) clearTimeout(autoRecenterTimer);
      autoRecenterTimer = setTimeout(() => {
        isUserInteracting = false;
        recenterOnDriver();
      }, 7000);
    };

    driverMap.on('dragstart', onUserInteract);
    driverMap.on('touchstart', onUserInteract);
    driverMap.on('rotatestart', onUserInteract);
    driverMap.on('pitchstart', onUserInteract);
    driverMap.on('zoomstart', onUserInteract);
    driverMap.on('movestart', onUserInteract);
    driverMap.on('boxzoomstart', onUserInteract);
    driverMap.on('wheel', onUserInteract);

    driverMap.on('load', () => {
      try { driverMap.resize(); } catch(e) {}
      ensureWebGlRouteLayers();

      if (pendingRouteCoords && pendingRouteCoords.length > 0) {
        updateWebGlSource(pendingRouteCoords);
      }

      if (window.lastDriverRouteArgs) {
        const { driverPos, pickupPos, dropoffPos, targetStage } = window.lastDriverRouteArgs;
        drawDriverRoute(driverPos, pickupPos, dropoffPos, targetStage);
      }

      // Initial position right upon map load
      const initialPos = window.lastRiderPos || { lat: -35.0815, lng: -57.5147 };
      updateDriverMapLocation(initialPos, 0);

      // Single GPS Watcher Architecture: Rely on global background-tracking to save 50% GPS sensor battery
      if (window._driverMapGeoWatchId) {
        try { navigator.geolocation.clearWatch(window._driverMapGeoWatchId); } catch(e) {}
        window._driverMapGeoWatchId = null;
      }
    });

    // Listen to real-time driver GPS updates from background-tracking
    if (!window._driverLocationTickBound) {
      window._driverLocationTickBound = true;
      window.addEventListener('driver-location-tick', (e) => {
        if (e.detail && e.detail.coords) {
          window.lastRiderPos = e.detail.coords;
          updateDriverMapLocation(e.detail.coords, e.detail.heading || 0);

          // If driver is far off the existing route (> 45m), reroute with cooldown
          if (fullRoutePathCoords && fullRoutePathCoords.length >= 2 && lastActiveOrderRouteParams) {
            const distOff = getMinDistanceToRouteMeters(e.detail.coords, fullRoutePathCoords);
            const now = Date.now();
            if (distOff > 45 && (!window._lastRerouteTime || now - window._lastRerouteTime > 6000)) {
              window._lastRerouteTime = now;
              drawDriverRoute(e.detail.coords, lastActiveOrderRouteParams.pickupPos, lastActiveOrderRouteParams.dropoffPos, lastActiveOrderRouteParams.targetStage);
            }
          }
        }
      });
    }
  } catch(err) {
    console.warn('[DriverMap] MapLibre initialization warning:', err);
  }

  // Inject Pulse and 3D Marker Styles
  if (!document.getElementById('driver-map-3d-styles')) {
    const s = document.createElement('style');
    s.id = 'driver-map-3d-styles';
    s.textContent = `
      #driver-fullscreen-map {
        position: fixed !important;
        inset: 0 !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        background: #090d16;
        z-index: 10 !important;
        overflow: hidden !important;
      }
      .driver-light-mode #driver-fullscreen-map {
        background: #f8fafc !important;
      }
      .maplibregl-canvas {
        outline: none !important;
      }
      .maplibregl-marker {
        z-index: 400 !important;
      }
      .driver-3d-marker-container {
        z-index: 500 !important;
      }
      @keyframes driver-pulse {
        0% { transform: scale(0.85); opacity: 0.9; box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.85); }
        70% { transform: scale(1.4); opacity: 0; box-shadow: 0 0 0 20px rgba(225, 29, 72, 0); }
        100% { transform: scale(0.85); opacity: 0; box-shadow: 0 0 0 0 rgba(225, 29, 72, 0); }
      }
      .driver-pulse-ring {
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        border: 2.5px solid #e11d48;
        animation: driver-pulse 2s infinite cubic-bezier(0.2, 0.8, 0.2, 1);
        pointer-events: none;
      }
      .driver-marker-arrow {
        transition: transform 0.25s ease;
      }

      /* TARGET ARRIVAL BEACON (Pulsing Concentric Wave + Vertical Light Beam) */
      @keyframes beacon-wave-pulse {
        0% { transform: scale(0.6); opacity: 0.9; }
        50% { opacity: 0.4; }
        100% { transform: scale(2.2); opacity: 0; }
      }
      @keyframes beacon-beam-glow {
        0%, 100% { opacity: 0.75; transform: scaleY(1); }
        50% { opacity: 1.0; transform: scaleY(1.15); }
      }
      .target-beacon-wrapper {
        position: relative;
        width: 60px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .target-beacon-wave {
        position: absolute;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        animation: beacon-wave-pulse 2.2s infinite cubic-bezier(0.1, 0.8, 0.3, 1);
        pointer-events: none;
      }
      .target-beacon-beam {
        position: absolute;
        bottom: 28px;
        width: 8px;
        height: 48px;
        border-radius: 4px;
        background: linear-gradient(to top, rgba(225, 29, 72, 0.85), rgba(255, 255, 255, 0));
        animation: beacon-beam-glow 1.8s infinite ease-in-out;
        pointer-events: none;
        filter: drop-shadow(0 0 8px rgba(225, 29, 72, 0.9));
      }
      .target-beacon-dropoff .target-beacon-beam {
        background: linear-gradient(to top, rgba(16, 185, 129, 0.85), rgba(255, 255, 255, 0));
        filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.9));
      }

      /* Imminent Turn Peripheral Pulse (< 55m) */
      @keyframes turn-glow-pulse {
        0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); border-color: #22c55e; }
        50% { box-shadow: 0 0 24px 6px rgba(34, 197, 94, 0.55); border-color: #4ade80; }
        100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); border-color: #22c55e; }
      }
      .imminent-turn-pulse {
        animation: turn-glow-pulse 1.2s infinite ease-in-out !important;
        border-color: #22c55e !important;
      }

      /* Native High-Resolution Vector Rendering (OpenFreeMap Dark & Liberty) */
      .driver-dark-mode #driver-fullscreen-map .maplibregl-canvas {
        filter: none !important;
      }
      .driver-light-mode #driver-fullscreen-map .maplibregl-canvas {
        filter: none !important;
      }
      .driver-dark-mode #driver-fullscreen-map {
        background-color: #12161f !important;
      }
      .driver-light-mode #driver-fullscreen-map {
        background-color: #f8fafc !important;
      }
      .maplibregl-ctrl-attrib {
        display: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  const doResize = () => {
    if (driverMap) {
      try {
        driverMap.resize();
        renderRouteHud();
      } catch(e) {}
    }
  };
  doResize();
  setTimeout(doResize, 60);
  setTimeout(doResize, 200);
  setTimeout(doResize, 500);
  setTimeout(doResize, 1000);

  if (window.ResizeObserver && targetContainer) {
    if (window._driverMapResizeObserver) {
      try { window._driverMapResizeObserver.disconnect(); } catch(e) {}
    }
    window._driverMapResizeObserver = new ResizeObserver(() => {
      doResize();
    });
    window._driverMapResizeObserver.observe(targetContainer);
  }

  return driverMap;
}

export function getDriverMapInstance() {
  return driverMap;
}

export function recenterOnDriver() {
  if (!driverMap || !driverMap.getContainer()) return;
  isUserInteracting = false;
  if (autoRecenterTimer) clearTimeout(autoRecenterTimer);

  const target = lastDriverPos || window.lastRiderPos || { lat: -35.0815, lng: -57.5147 };
  const lngLat = [Number(target.lng), Number(target.lat)];
  const hasActiveRoute = !!(activeRoutePathCoords && activeRoutePathCoords.length >= 2);

  try {
    driverMap.flyTo({
      center: lngLat,
      zoom: hasActiveRoute ? 17.6 : 16.8,
      pitch: hasActiveRoute ? 50 : (is3DActive ? 48 : 0),
      bearing: hasActiveRoute ? (lastHeading || 0) : (is3DActive ? (lastHeading || 0) : 0),
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 750
    });
  } catch(e) {}
}

export function setMap3DPerspective(enable, heading = 0, coords = null) {
  if (!driverMap || !driverMap.getContainer()) return;
  is3DActive = enable;

  try {
    if (!driverMap._loaded && typeof driverMap.loaded === 'function' && !driverMap.loaded()) return;

    if (enable) {
      if (coords) lastDriverPos = coords;
      if (heading !== undefined) lastHeading = heading;
      let targetCenter = null;
      if (coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))) {
        targetCenter = [Number(coords.lng), Number(coords.lat)];
      } else if (lastDriverPos && Number.isFinite(Number(lastDriverPos.lat)) && Number.isFinite(Number(lastDriverPos.lng))) {
        targetCenter = [Number(lastDriverPos.lng), Number(lastDriverPos.lat)];
      } else {
        const c = driverMap.getCenter();
        if (c) targetCenter = [c.lng, c.lat];
      }

      if (targetCenter && Number.isFinite(targetCenter[0]) && Number.isFinite(targetCenter[1])) {
        driverMap.easeTo({
          center: targetCenter,
          zoom: 17.5,
          pitch: 50,
          bearing: heading || lastHeading || 0,
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          duration: 600
        });
      }
    } else {
      driverMap.easeTo({
        center: [-57.5147, -35.0815],
        zoom: 15,
        pitch: 0,
        bearing: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        offset: [0, 0],
        duration: 500
      });
    }
  } catch(e) {
    console.warn('Map navigation perspective warning:', e);
  }
}

function getRemainingRouteCoords(currentLngLat, routeCoords) {
  if (!routeCoords || routeCoords.length < 2) return routeCoords || [];
  
  const [cLng, cLat] = currentLngLat;

  // Find the closest point along the entire remaining polyline
  let bestIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const p1 = routeCoords[i];
    const p2 = routeCoords[i + 1];
    
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const lenSq = dx * dx + dy * dy;
    
    let t = lenSq > 0 ? ((cLng - p1[0]) * dx + (cLat - p1[1]) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    
    const projLng = p1[0] + t * dx;
    const projLat = p1[1] + t * dy;
    const distSq = (cLng - projLng) ** 2 + (cLat - projLat) ** 2;
    
    if (distSq < minDistance) {
      minDistance = distSq;
      bestIndex = i;
    }
  }

  const remaining = routeCoords.slice(bestIndex + 1);
  if (remaining.length === 0) {
    return [currentLngLat, routeCoords[routeCoords.length - 1]];
  }
  return [currentLngLat, ...remaining];
}

export function updateDriverMapLocation(coords, heading = 0) {
  if (!driverMap || !driverMap.getContainer() || !coords) return;
  const latNum = Number(coords.lat);
  const lngNum = Number(coords.lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;
  if (!driverMap._loaded && typeof driverMap.loaded === 'function' && !driverMap.loaded()) return;

  // Compute real speed in km/h from device sensor or delta distance/time
  let currentSpeedKmh = 0;
  if (coords.speed !== undefined && coords.speed !== null && coords.speed >= 0) {
    currentSpeedKmh = Math.round(coords.speed * 3.6);
  } else if (lastDriverPos) {
    const now = Date.now();
    const dt = (now - (window._lastSpeedCalcTime || now)) / 1000;
    if (dt >= 0.5 && dt <= 10) {
      const meters = Math.hypot((coords.lat - lastDriverPos.lat) * 111139, (coords.lng - lastDriverPos.lng) * 111139 * Math.cos(coords.lat * Math.PI / 180));
      currentSpeedKmh = Math.min(110, Math.round((meters / dt) * 3.6));
    }
    window._lastSpeedCalcTime = now;
  }
  window.currentDriverSpeedKmh = currentSpeedKmh;
  window.dispatchEvent(new CustomEvent('driver-speed-update', { detail: { speedKmh: currentSpeedKmh } }));

  const prevPos = lastDriverPos;
  lastDriverPos = coords;
  const lngLat = [Number(coords.lng), Number(coords.lat)];

  let distFromPrev = 999;
  if (prevPos) {
    distFromPrev = Math.hypot((coords.lat - prevPos.lat) * 111139, (coords.lng - prevPos.lng) * 111139 * Math.cos(coords.lat * Math.PI / 180));
  }

  // Slice forward remaining route from driver's current position to destination (no duplicate/triangle lines)
  if (fullRoutePathCoords && fullRoutePathCoords.length >= 2) {
    if (distFromPrev >= 1.8 || !activeRoutePathCoords || activeRoutePathCoords.length === 0) {
      activeRoutePathCoords = getRemainingRouteCoords(lngLat, fullRoutePathCoords);
      updateWebGlSource(activeRoutePathCoords);
    }
  }

  const hasActiveRoute = !!(activeRoutePathCoords && activeRoutePathCoords.length >= 2);

  // Compute forward road bearing from vehicle heading or upcoming segment
  let forwardBearing = heading;
  if (forwardBearing === undefined || forwardBearing === null || isNaN(forwardBearing) || (forwardBearing === 0 && !hasActiveRoute)) {
    if (activeRoutePathCoords && activeRoutePathCoords.length >= 2) {
      forwardBearing = calculateBearing(
        activeRoutePathCoords[0][1], activeRoutePathCoords[0][0],
        activeRoutePathCoords[1][1], activeRoutePathCoords[1][0]
      );
    } else if (lastDriverPos) {
      forwardBearing = calculateBearing(lastDriverPos.lat, lastDriverPos.lng, coords.lat, coords.lng);
    } else {
      forwardBearing = lastHeading || 0;
    }
  }
  lastHeading = forwardBearing;

  // Shortest delta angle for lag-free camera tracking
  let currentMapBearing = driverMap.getBearing() || 0;
  let bearingDiff = ((forwardBearing - currentMapBearing + 540) % 360) - 180;
  let targetMapBearing = currentMapBearing + bearingDiff;

  // Record history path (breadcrumb trail)
  if (driverHistoryCoords.length === 0 || Math.hypot(lngLat[0] - driverHistoryCoords[driverHistoryCoords.length - 1][0], lngLat[1] - driverHistoryCoords[driverHistoryCoords.length - 1][1]) > 0.00005) {
    driverHistoryCoords.push(lngLat);
    if (driverHistoryCoords.length > 50) driverHistoryCoords.shift();
    const trailSource = driverMap.getSource('driver-history-trail-source');
    if (trailSource && driverHistoryCoords.length >= 2) {
      trailSource.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: driverHistoryCoords
          }
        }]
      });
    }
  }

  // Dynamic Speed-Based Camera Pitch & Zoom (AAA Navigation Experience)
  const currentSpeed = Number(window.currentDriverSpeedKmh) || 0;
  let dynamicZoom = 17.6;
  let dynamicPitch = 52;

  if (currentSpeed > 35) {
    dynamicZoom = 16.4;
    dynamicPitch = 54;
  } else if (currentSpeed > 15) {
    dynamicZoom = 17.0;
    dynamicPitch = 52;
  }

  if (!window._driverMapFirstCentered) {
    window._driverMapFirstCentered = true;
    try {
      driverMap.flyTo({
        center: lngLat,
        zoom: hasActiveRoute ? dynamicZoom : 17.0,
        pitch: hasActiveRoute ? dynamicPitch : 0,
        bearing: Number.isFinite(forwardBearing) ? forwardBearing : 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: 500
      });
    } catch(e) {}
  } else if (!isUserInteracting) {
    try {
      // Instant, silky-smooth 60fps camera tracking with centered vehicle perspective
      driverMap.jumpTo({
        center: lngLat,
        zoom: hasActiveRoute ? dynamicZoom : (is3DActive ? 17.4 : 16.5),
        pitch: hasActiveRoute ? dynamicPitch : (is3DActive ? 48 : 0),
        bearing: (hasActiveRoute || is3DActive) ? (Number.isFinite(targetMapBearing) ? targetMapBearing : 0) : 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
      });
    } catch(e) {}
  }

  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  // In 3D Head-Up First-Person perspective, the camera rotates with the vehicle's heading.
  // Thus, straight ahead on the road is ALWAYS UP on the screen (0deg).
  // In 2D overview mode (north-up), the arrow points to the heading angle.
  const arrowAngle = (hasActiveRoute || is3DActive) ? 0 : (lastHeading || 0);

  if (!driverMarker) {
    const el = document.createElement('div');
    el.className = 'driver-3d-marker-container';
    el.style.cssText = 'width:80px; height:80px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:500;';
    el.innerHTML = `
      <div style="position:relative; width:80px; height:80px; display:flex; align-items:center; justify-content:center;">
        <!-- Brand Red Radar Vision Cone -->
        <div class="driver-radar-cone" style="
          position: absolute;
          top: -24px;
          width: 54px;
          height: 54px;
          background: radial-gradient(circle at 50% 100%, ${isLight ? 'rgba(225, 29, 72, 0.45)' : 'rgba(244, 63, 94, 0.55)'} 0%, rgba(225, 29, 72, 0) 75%);
          clip-path: polygon(50% 100%, 0% 0%, 100% 0%);
          transform-origin: 50% 100%;
          transform: rotate(${arrowAngle}deg);
          pointer-events: none;
        "></div>
        <div class="driver-pulse-ring" style="border: 2.5px solid ${isLight ? '#e11d48' : '#f43f5e'};"></div>
        <div class="driver-marker-arrow" style="
          width: 44px; height: 44px; border-radius: 50%;
          background: ${isLight ? 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)' : 'linear-gradient(135deg, #e11d48 0%, #9f1239 100%)'};
          border: 3px solid #ffffff;
          box-shadow: 0 0 20px ${isLight ? 'rgba(225, 29, 72, 0.9)' : 'rgba(244, 63, 94, 0.85)'}, 0 4px 12px rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          transform: rotate(${arrowAngle}deg);
        ">
          <span style="color:#ffffff; font-size:19px; font-weight:900; line-height:1; filter:drop-shadow(0 0 4px rgba(0,0,0,0.5));">▲</span>
        </div>
      </div>
    `;

    driverMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(lngLat)
      .addTo(driverMap);
  } else {
    driverMarker.setLngLat(lngLat);
    const arrow = driverMarker.getElement().querySelector('.driver-marker-arrow');
    if (arrow) arrow.style.transform = `rotate(${arrowAngle}deg)`;
    const cone = driverMarker.getElement().querySelector('.driver-radar-cone');
    if (cone) cone.style.transform = `rotate(${arrowAngle}deg)`;
  }

  // Automatic Off-Route Detection & Dynamic Rerouting
  if (!isSimulationActive && hasActiveRoute && activeRoutePathCoords.length >= 2 && lastActiveOrderRouteParams) {
    const offRouteDist = getMinDistanceToRouteMeters(coords, activeRoutePathCoords);
    const now = Date.now();
    if (offRouteDist > 38) {
      consecutiveOffRouteCount++;
      if (consecutiveOffRouteCount >= 2 && now - lastRerouteTimestamp > 12000) {
        lastRerouteTimestamp = now;
        consecutiveOffRouteCount = 0;
        const { pickupPos, dropoffPos, targetStage } = lastActiveOrderRouteParams;
        window.dispatchEvent(new CustomEvent('driver-navigation-telemetry', { detail: { isRerouting: true, targetStage } }));
        NavigationVoice.processTelemetry({ isRerouting: true, targetStage });
        drawDriverRoute(coords, pickupPos, dropoffPos, targetStage);
      }
    } else {
      consecutiveOffRouteCount = 0;
    }
  }

  // Update dynamic step-by-step turn guidance and voice
  if (hasActiveRoute && activeRouteManeuverSteps.length > 0) {
    const remainingMeters = (isSimulationActive && simDensePoints.length > 0)
      ? Math.max(0, Math.round((simDensePoints.length - 1 - simCurrentIndex) * 1.0))
      : null;
    updateDynamicManeuverState(lngLat, remainingMeters, lastActiveOrderRouteParams?.targetStage || 'pickup');
  }

  // Slice forward remaining route from driver's current position to destination
  if (fullRoutePathCoords && fullRoutePathCoords.length >= 2) {
    activeRoutePathCoords = getRemainingRouteCoords(lngLat, fullRoutePathCoords);
    updateWebGlSource(activeRoutePathCoords);
  }

  renderRouteHud();
}

let pendingRouteCoords = null;

function ensureWebGlRouteLayers() {
  if (!driverMap || !driverMap.isStyleLoaded()) return;

  const isLight = getDriverMapTheme() === 'light';

  if (!driverMap.getSource('driver-history-source')) {
    driverMap.addSource('driver-history-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
  }

  if (!driverMap.getLayer('driver-history-line')) {
    driverMap.addLayer({
      id: 'driver-history-line',
      type: 'line',
      source: 'driver-history-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': isLight ? '#94a3b8' : '#64748b',
        'line-width': 5,
        'line-opacity': 0.65,
        'line-dasharray': [2, 2]
      }
    });
  }

  if (!driverMap.getSource('driver-route-source')) {
    driverMap.addSource('driver-route-source', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      }
    });
  }

  // 1. Animated arrows Point source
  if (!driverMap.getSource('driver-animated-arrows-source')) {
    driverMap.addSource('driver-animated-arrows-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
  }

  // Deep soft ambient glow
  if (!driverMap.getLayer('driver-route-glow')) {
    driverMap.addLayer({
      id: 'driver-route-glow',
      type: 'line',
      source: 'driver-route-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#e11d48',
        'line-width': 18,
        'line-opacity': isLight ? 0.28 : 0.35,
        'line-blur': 5
      }
    });
  }

  // Outer Crisp Dark Casing
  if (!driverMap.getLayer('driver-route-casing')) {
    driverMap.addLayer({
      id: 'driver-route-casing',
      type: 'line',
      source: 'driver-route-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': isLight ? '#be123c' : '#4c0519',
        'line-width': 9,
        'line-opacity': 0.95
      }
    });
  }

  // Vibrant Neon Crimson Core
  if (!driverMap.getLayer('driver-route-core')) {
    driverMap.addLayer({
      id: 'driver-route-core',
      type: 'line',
      source: 'driver-route-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': isLight ? '#e11d48' : '#ff2a5f',
        'line-width': 5.5,
        'line-opacity': 1.0
      }
    });
  }

  // Sleek Inner Light Center Spine
  if (!driverMap.getLayer('driver-route-spine')) {
    driverMap.addLayer({
      id: 'driver-route-spine',
      type: 'line',
      source: 'driver-route-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 1.8,
        'line-opacity': 0.92
      }
    });
  }

  // Sleek Aerodynamic Flow Chevron Icon (Pointed UP at 0 deg North)
  if (!driverMap.hasImage('nav-sleek-chevron-icon')) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);

      // Glowing crimson drop shadow
      ctx.shadowColor = 'rgba(225, 29, 72, 1)';
      ctx.shadowBlur = 8;

      // Modern sleek chevron pointing UP (0 deg North)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(32, 8);   // Apex tip (Pointing UP)
      ctx.lineTo(52, 48);  // Right wing
      ctx.lineTo(32, 34);  // Center notch
      ctx.lineTo(12, 48);  // Left wing
      ctx.closePath();
      ctx.fill();

      // Sharp outer contrast border
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#881337';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      driverMap.addImage('nav-sleek-chevron-icon', ctx.getImageData(0, 0, 64, 64), { sdf: false });
    } catch(e) {
      console.warn('[DriverMap] Could not create sleek chevron icon:', e);
    }
  }

  // Animated Flowing Chevrons Symbol Layer
  if (!driverMap.getLayer('driver-route-animated-chevrons')) {
    driverMap.addLayer({
      id: 'driver-route-animated-chevrons',
      type: 'symbol',
      source: 'driver-animated-arrows-source',
      layout: {
        'icon-image': 'nav-sleek-chevron-icon',
        'icon-size': 0.58,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-keep-upright': false
      },
      paint: {
        'icon-opacity': 1.0
      }
    });
  }
}

let _routeArrowAnimFrame = null;
let _animOffsetMeters = 0;

function computePointsAlongRoute(coords, stepMeters = 30, offsetMeters = 0) {
  if (!coords || coords.length < 2) return [];

  const features = [];
  let currentTargetDist = offsetMeters;
  let accumulatedDist = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dLat = (p2[1] - p1[1]) * 111139;
    const dLng = (p2[0] - p1[0]) * 111139 * Math.cos((p1[1] + p2[1]) / 2 * Math.PI / 180);
    const segLen = Math.hypot(dLat, dLng);

    if (segLen <= 0.5) continue;

    const bearing = calculateBearing(p1[1], p1[0], p2[1], p2[0]);

    while (currentTargetDist <= accumulatedDist + segLen) {
      const segFraction = Math.max(0, Math.min(1, (currentTargetDist - accumulatedDist) / segLen));
      const ptLng = p1[0] + (p2[0] - p1[0]) * segFraction;
      const ptLat = p1[1] + (p2[1] - p1[1]) * segFraction;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [ptLng, ptLat]
        },
        properties: {
          bearing: bearing
        }
      });

      currentTargetDist += stepMeters;
    }

    accumulatedDist += segLen;
  }

  return features;
}

export function startRouteArrowAnimation() {
  if (_routeArrowAnimFrame) return;

  let lastTime = 0;
  function animateFlow(timestamp) {
    if (!driverMap || !driverMap.getContainer()) {
      _routeArrowAnimFrame = null;
      return;
    }

    // Zero-overhead when tab is in background
    if (typeof document !== 'undefined' && document.hidden) {
      _routeArrowAnimFrame = requestAnimationFrame(animateFlow);
      return;
    }

    if (activeRoutePathCoords && activeRoutePathCoords.length >= 2 && driverMap.isStyleLoaded()) {
      if (timestamp - lastTime > 32) {
        lastTime = timestamp;
        _animOffsetMeters = (_animOffsetMeters + 0.45) % 30;

        const points = computePointsAlongRoute(activeRoutePathCoords, 30, _animOffsetMeters);
        const animSrc = driverMap.getSource('driver-animated-arrows-source');
        if (animSrc) {
          try {
            animSrc.setData({
              type: 'FeatureCollection',
              features: points
            });
          } catch(e) {}
        }
      }
    }

    _routeArrowAnimFrame = requestAnimationFrame(animateFlow);
  }

  _routeArrowAnimFrame = requestAnimationFrame(animateFlow);
}

export function stopRouteArrowAnimation() {
  if (_routeArrowAnimFrame) {
    cancelAnimationFrame(_routeArrowAnimFrame);
    _routeArrowAnimFrame = null;
  }
}

if (typeof document !== 'undefined' && !window._driverMapVisibilityBound) {
  window._driverMapVisibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && driverMap) {
      if (activeRoutePathCoords && activeRoutePathCoords.length >= 2) {
        startRouteArrowAnimation();
      }
      try {
        driverMap.resize();
      } catch(e) {}
    }
  });
}

let _lastSetGeoJsonHash = '';

function updateWebGlSource(coords) {
  pendingRouteCoords = coords;
  if (!driverMap) return;

  const cleanCoords = (coords && Array.isArray(coords) && coords.length >= 2)
    ? coords.map(c => [Number(c[0]), Number(c[1])]).filter(c => !isNaN(c[0]) && !isNaN(c[1]))
    : [];

  if (cleanCoords.length > 0) {
    startRouteArrowAnimation();
  } else {
    stopRouteArrowAnimation();
    const animSrc = driverMap.getSource('driver-animated-arrows-source');
    if (animSrc) {
      try {
        animSrc.setData({ type: 'FeatureCollection', features: [] });
      } catch(e) {}
    }
  }

  const geojsonData = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: cleanCoords
    }
  };

  const hash = cleanCoords.length > 0 ? `${cleanCoords[0][0].toFixed(5)},${cleanCoords[0][1].toFixed(5)}_${cleanCoords.length}` : 'empty';
  if (hash === _lastSetGeoJsonHash) return;
  _lastSetGeoJsonHash = hash;

  if (!driverMap.isStyleLoaded()) {
    driverMap.once('load', () => {
      ensureWebGlRouteLayers();
      const src = driverMap.getSource('driver-route-source');
      if (src) src.setData(geojsonData);
    });
    return;
  }

  try {
    ensureWebGlRouteLayers();
    let src = driverMap.getSource('driver-route-source');
    if (src) {
      src.setData(geojsonData);
    }
  } catch(err) {
    console.warn('[DriverMap] WebGL source update warning:', err);
  }
}

function generateStreetGridFallbackRoute(startLng, startLat, endLng, endLat) {
  // In Magdalena, streets follow a grid tilted at -36.5 deg (Goenaga, San Martin, Brenan, Rivadavia)
  const rad = -36.5 * Math.PI / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);

  const dlng = endLng - startLng;
  const dlat = endLat - startLat;

  // Project vector onto Magdalena street axes
  const a = dlng * ux + dlat * uy;
  const cornerLng = startLng + a * ux;
  const cornerLat = startLat + a * uy;

  const rawCoords = [
    [startLng, startLat],
    [cornerLng, cornerLat],
    [endLng, endLat]
  ];

  const dist1 = 6371000 * 2 * Math.asin(Math.hypot(
    (cornerLat - startLat) * Math.PI / 180,
    (cornerLng - startLng) * Math.PI / 180 * Math.cos(startLat * Math.PI / 180)
  ));
  const dist2 = 6371000 * 2 * Math.asin(Math.hypot(
    (endLat - cornerLat) * Math.PI / 180,
    (endLng - cornerLng) * Math.PI / 180 * Math.cos(cornerLat * Math.PI / 180)
  ));
  const totalDist = Math.max(10, Math.round(dist1 + dist2));

  return {
    routes: [
      {
        distance: totalDist,
        duration: Math.round(totalDist / 8.33),
        geometry: {
          coordinates: rawCoords
        },
        legs: [
          {
            steps: [
              {
                maneuver: { type: 'depart', modifier: 'straight', location: [startLng, startLat] },
                name: 'Calle Principal',
                distance: Math.round(dist1)
              },
              {
                maneuver: { type: 'turn', modifier: 'left', location: [cornerLng, cornerLat] },
                name: 'Esquina',
                distance: Math.round(dist2)
              },
              {
                maneuver: { type: 'arrive', modifier: '', location: [endLng, endLat] },
                name: 'Destino',
                distance: 0
              }
            ]
          }
        ]
      }
    ]
  };
}

async function fetchTurnByTurnRoute(startLng, startLat, endLng, endLat) {
  const waypoints = `${startLng},${startLat};${endLng},${endLat}`;
  const endpoints = [
    `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson&steps=true`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${waypoints}?overview=full&geometries=geojson&steps=true`
  ];

  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data.routes?.[0]?.geometry?.coordinates?.length >= 2) {
          return data;
        }
      }
    } catch(e) {}
  }

  return generateStreetGridFallbackRoute(startLng, startLat, endLng, endLat);
}

export async function drawDriverRoute(driverPos, pickupPos, dropoffPos, targetStage = 'pickup') {
  window.lastDriverRouteArgs = { driverPos, pickupPos, dropoffPos, targetStage };
  lastActiveOrderRouteParams = { pickupPos, dropoffPos, targetStage };

  if (!driverMap) return;

  try { driverMap.resize(); } catch(e) {}

  const effectiveDriver = (driverPos && driverPos.lat && driverPos.lng) ? driverPos : (window.lastRiderPos || { lat: -35.0815, lng: -57.5147 });
  const effectivePickup = (pickupPos && pickupPos.lat && pickupPos.lng && Number.isFinite(Number(pickupPos.lat)) && Number.isFinite(Number(pickupPos.lng))) ? pickupPos : null;
  const effectiveDropoff = (dropoffPos && dropoffPos.lat && dropoffPos.lng && Number.isFinite(Number(dropoffPos.lat)) && Number.isFinite(Number(dropoffPos.lng))) ? dropoffPos : null;

  if (targetStage === 'pickup' && !effectivePickup) {
    clearDriverRoute();
    setMap3DPerspective(false);
    return;
  }

  if (targetStage === 'delivery' && !effectiveDropoff) {
    clearDriverRoute();
    setMap3DPerspective(false);
    return;
  }

  const rawTarget = (targetStage === 'pickup') ? effectivePickup : (effectiveDropoff || effectivePickup);
  if (!rawTarget) {
    clearDriverRoute();
    setMap3DPerspective(false);
    return;
  }

  const driverLng = Number(effectiveDriver.lng);
  const driverLat = Number(effectiveDriver.lat);
  const targetLngLat = [Number(rawTarget.lng), Number(rawTarget.lat)];

  // Clear idle demand hotspots when entering active navigation
  renderDemandHotspots(false);

  // Fetch guaranteed street route (OSRM + Mirror + Magdalena Street Grid)
  try {
    const data = await fetchTurnByTurnRoute(driverLng, driverLat, targetLngLat[0], targetLngLat[1]);
    if (data && data.routes?.[0]?.geometry?.coordinates) {
      const rawCoords = data.routes[0].geometry.coordinates;
      // Make sure the path starts EXACTLY at the driver's current position
      rawCoords[0] = [driverLng, driverLat];
      
      // Make sure the path finishes EXACTLY at the target marker center (0px gap)
      const lastPt = rawCoords[rawCoords.length - 1];
      if (Math.hypot(lastPt[0] - targetLngLat[0], lastPt[1] - targetLngLat[1]) > 0.000005) {
        rawCoords.push(targetLngLat);
      } else {
        rawCoords[rawCoords.length - 1] = targetLngLat;
      }

      fullRoutePathCoords = rawCoords;
      activeRoutePathCoords = rawCoords;
      currentRouteVertexIndex = 0;
      renderRouteHud();
      updateWebGlSource(activeRoutePathCoords);

      // Compute immediate street heading
      const initialHeading = activeRoutePathCoords.length >= 2
        ? calculateBearing(activeRoutePathCoords[0][1], activeRoutePathCoords[0][0], activeRoutePathCoords[1][1], activeRoutePathCoords[1][0])
        : calculateBearing(driverLat, driverLng, targetLngLat[1], targetLngLat[0]);

      updateDriverMapLocation(effectiveDriver, initialHeading);
      setMap3DPerspective(true, initialHeading, effectiveDriver);

      // Parse Step-by-Step Maneuvers Telemetry
      const totalDist = Math.round(data.routes[0].distance || 0);
      const totalSecs = Math.round(data.routes[0].duration || 60);
      const etaMins = Math.max(1, Math.round(totalSecs / 60));

      const rawSteps = data.routes[0].legs?.[0]?.steps || [];
      activeRouteManeuverSteps = rawSteps.map(s => parseManeuverDetails(s, s.distance)).filter(Boolean);
      currentManeuverStepIndex = 0;
      updateDynamicManeuverState([driverLng, driverLat], totalDist, targetStage);

      // Proximity Geofence Trigger (< 50m)
      if (totalDist <= 50) {
        if (!window._driverArrivalAnnounced) {
          window._driverArrivalAnnounced = true;
          window.dispatchEvent(new CustomEvent('driver-arrival-proximity', { detail: { targetStage, distanceMeters: totalDist } }));
        }
      } else {
        window._driverArrivalAnnounced = false;
      }
    }
  } catch (err) {
    console.warn('[DriverMap] OSRM routing note:', err);
  }

  // Update Destination Markers with 3D Arrival Beacon
  if (targetStage === 'pickup' && effectivePickup) {
    const pLngLat = [Number(effectivePickup.lng), Number(effectivePickup.lat)];
    if (!pickupMarker) {
      const el = document.createElement('div');
      el.style.cssText = 'z-index:400; cursor:pointer; width:60px; height:60px; display:flex; align-items:center; justify-content:center;';
      el.innerHTML = `
        <div class="target-beacon-wrapper target-beacon-pickup">
          <div class="target-beacon-beam"></div>
          <div class="target-beacon-wave" style="background: radial-gradient(circle, rgba(225,29,72,0.45) 0%, rgba(0,0,0,0) 70%); border: 1.5px solid rgba(225,29,72,0.8);"></div>
          <div style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, #e11d48 0%, #9f1239 100%); border:3px solid white; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(225,29,72,0.85); font-size:21px; position:relative; z-index:2;">
            🛍️
          </div>
        </div>
      `;
      pickupMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(pLngLat).addTo(driverMap);
    } else {
      pickupMarker.setLngLat(pLngLat);
    }
  } else if (pickupMarker) {
    pickupMarker.remove();
    pickupMarker = null;
  }

  if (effectiveDropoff) {
    const dLngLat = [Number(effectiveDropoff.lng), Number(effectiveDropoff.lat)];
    if (!dropoffMarker) {
      const el = document.createElement('div');
      el.style.cssText = 'z-index:400; cursor:pointer; width:60px; height:60px; display:flex; align-items:center; justify-content:center;';
      el.innerHTML = `
        <div class="target-beacon-wrapper target-beacon-dropoff">
          <div class="target-beacon-beam"></div>
          <div class="target-beacon-wave" style="background: radial-gradient(circle, rgba(16,185,129,0.45) 0%, rgba(0,0,0,0) 70%); border: 1.5px solid rgba(16,185,129,0.8);"></div>
          <div style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, #10b981 0%, #047857 100%); border:3px solid white; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(16,185,129,0.85); font-size:21px; position:relative; z-index:2;">
            📍
          </div>
        </div>
      `;
      dropoffMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(dLngLat).addTo(driverMap);
    } else {
      dropoffMarker.setLngLat(dLngLat);
    }
  } else if (dropoffMarker) {
    dropoffMarker.remove();
    dropoffMarker = null;
  }
}

// ----------------------------------------------------
// MULTI-STOP BATCH SEQUENCER (WAYPOINT MARKERS & COMBINED ROUTE)
// ----------------------------------------------------
let multiStopMarkers = [];

export function clearMultiStopMarkers() {
  multiStopMarkers.forEach(m => { try { m.remove(); } catch(e) {} });
  multiStopMarkers = [];
}

export async function renderMultiStopRoute(stops = [], driverPos = null) {
  clearMultiStopMarkers();
  if (!driverMap || !Array.isArray(stops) || stops.length === 0) return;

  const isLight = getDriverMapTheme() === 'light';
  const effectiveDriverPos = driverPos || lastDriverPos;

  // If the immediate next stop is an unverified Mandado pickup (no verified GPS), suppress polyline and markers
  const immediateStop = stops[0];
  if (immediateStop && immediateStop.isUnverifiedMandado && immediateStop.type === 'pickup') {
    clearDriverRoute();
    setMap3DPerspective(false);
    return;
  }

  // Filter only stops with verified, real geographic coordinates
  const verifiedStops = stops.filter(s => s.coords && !s.isUnverifiedMandado && !isNaN(s.coords[0]) && !isNaN(s.coords[1]));
  if (verifiedStops.length === 0) {
    clearDriverRoute();
    setMap3DPerspective(false);
    return;
  }

  // Add numbered waypoint markers for verified stops
  verifiedStops.forEach((stop, index) => {
    const lngLat = [Number(stop.coords[0]), Number(stop.coords[1])];
    const isPickup = stop.type === 'pickup';
    const stopNumber = index + 1;

    const el = document.createElement('div');
    el.style.cssText = `
      z-index: ${500 - index}; cursor: pointer; display: flex; flex-direction: column; align-items: center;
      transition: transform 0.2s ease;
    `;
    el.title = `${stopNumber}. ${stop.title} (${stop.address || ''})`;

    const bgColor = isPickup 
      ? 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)' 
      : 'linear-gradient(135deg, #10b981 0%, #047857 100%)';
    const shadowColor = isPickup ? 'rgba(225, 29, 72, 0.45)' : 'rgba(16, 185, 129, 0.45)';

    el.innerHTML = `
      <div style="
        display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 20px;
        background: ${bgColor}; color: white; font-weight: 900; font-size: 11px;
        border: 2px solid white; box-shadow: 0 4px 12px ${shadowColor};
        font-family: var(--font-display, sans-serif); white-space: nowrap;
      ">
        <span style="font-size: 12px;">${isPickup ? '🛍️' : '📍'}</span>
        <span>#${stopNumber}</span>
        <span style="font-size: 9.5px; opacity: 0.9; max-width: 90px; overflow: hidden; text-overflow: ellipsis;">${stop.shortTitle || (isPickup ? 'Retiro' : 'Entrega')}</span>
      </div>
      <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid ${isPickup ? '#be123c' : '#047857'}; margin-top: -1px;"></div>
    `;

    el.onclick = (e) => {
      e.stopPropagation();
      driverMap.flyTo({ center: lngLat, zoom: 17.5, speed: 1.2 });
      import('./toast.js').then(m => {
        m.showToast(`Parada #${stopNumber}: ${stop.title} - ${stop.address || ''}`, 'info');
      });
    };

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(lngLat)
      .addTo(driverMap);

    multiStopMarkers.push(marker);
  });

  // Calculate combined multi-stop polyline via OSRM
  if (effectiveDriverPos && effectiveDriverPos.lng && effectiveDriverPos.lat) {
    try {
      const coordPairs = [
        `${effectiveDriverPos.lng},${effectiveDriverPos.lat}`,
        ...verifiedStops.map(s => `${s.coords[0]},${s.coords[1]}`)
      ];

      const url = `https://router.project-osrm.org/route/v1/driving/${coordPairs.join(';')}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes[0]) {
          const route = data.routes[0];
          fullRoutePathCoords = route.geometry.coordinates;
          activeRoutePathCoords = fullRoutePathCoords;
          updateWebGlSource(activeRoutePathCoords);

          // Update HUD for the next immediate stop
          if (route.legs && route.legs[0]) {
            const nextStop = verifiedStops[0];
            const etaMinutes = Math.max(1, Math.round(route.legs[0].duration / 60));
            const distMeters = Math.round(route.legs[0].distance);

            window.dispatchEvent(new CustomEvent('driver-navigation-telemetry', {
              detail: {
                destinationName: `#1 ${nextStop.title}`,
                destinationAddress: nextStop.address,
                stage: nextStop.type === 'pickup' ? 'Retiro' : 'Entrega',
                etaMinutes,
                distMeters,
              }
            }));
          }
        }
      }
    } catch (err) {
      console.warn('Multi-stop OSRM fetch error:', err);
    }
  }
}

// ----------------------------------------------------
// PREDICTIVE DEMAND RADAR (KITCHEN PREP HOTSPOTS)
// ----------------------------------------------------
let demandHotspotMarkers = [];
export function renderDemandHotspots(hotspotsData = null) {
  demandHotspotMarkers.forEach(m => { try { m.remove(); } catch(e) {} });
  demandHotspotMarkers = [];

  if (!driverMap || !Array.isArray(hotspotsData) || hotspotsData.length === 0) return;

  const isLight = getDriverMapTheme() === 'light';

  hotspotsData.forEach(h => {
    if (!h.coords || isNaN(h.coords[0]) || isNaN(h.coords[1])) return;
    const lngLat = [Number(h.coords[0]), Number(h.coords[1])];
    const count = h.count || 1;

    const el = document.createElement('div');
    el.style.cssText = `
      z-index: 250; cursor: pointer; display: flex; flex-direction: column; align-items: center;
      filter: drop-shadow(0 4px 10px rgba(249, 115, 22, 0.45));
    `;

    el.innerHTML = `
      <div style="
        display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 20px;
        background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
        border: 2px solid #fff; color: white; font-weight: 900; font-size: 11px;
        font-family: var(--font-display, sans-serif); box-shadow: 0 4px 14px rgba(234, 88, 12, 0.5);
      ">
        <span style="font-size: 13px;">🔥</span>
        <span>${count} en cocina</span>
      </div>
      <div style="
        font-size: 9.5px; font-weight: 800; color: ${isLight ? '#431407' : '#fed7aa'};
        background: ${isLight ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.85)'};
        padding: 1px 6px; border-radius: 6px; margin-top: 2px;
        border: 1px solid ${isLight ? '#fed7aa' : 'rgba(249,115,22,0.3)'};
        white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis;
      ">
        ${h.name || 'Comercio'}
      </div>
    `;

    el.onclick = (e) => {
      e.stopPropagation();
      driverMap.flyTo({ center: lngLat, zoom: 17, speed: 1.2 });
      import('./toast.js').then(m => {
        m.showToast(`🔥 ${h.name}: ${count} pedido${count > 1 ? 's' : ''} preparándose en cocina`, 'info');
      });
    };

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(lngLat)
      .addTo(driverMap);

    demandHotspotMarkers.push(marker);
  });
}

export function checkAutoSolarTheme(force = false) {
  const mode = getDriverThemeMode();
  if (mode !== 'auto' && !force) return; // User explicitly selected their theme, preserve it!
  const hour = new Date().getHours();
  const shouldBeLight = (hour >= 7 && hour < 19);
  const targetTheme = shouldBeLight ? 'light' : 'dark';
  if (getDriverMapTheme() !== targetTheme || force) {
    setDriverMapTheme(targetTheme, false);
  }
}

export function clearDriverRoute() {
  lastActiveOrderRouteParams = null;
  window.lastDriverRouteArgs = null;
  activeRoutePathCoords = [];
  activeRouteManeuverSteps = [];
  currentManeuverStepIndex = 0;
  window.lastDriverManeuver = null;
  renderRouteHud();
  updateWebGlSource([]);
  driverHistoryCoords = [];
  if (driverMap && driverMap.isStyleLoaded()) {
    try {
      const routeSrc = driverMap.getSource('driver-route-source');
      if (routeSrc) routeSrc.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
      const animSrc = driverMap.getSource('driver-animated-arrows-source');
      if (animSrc) animSrc.setData({ type: 'FeatureCollection', features: [] });
      const historySrc = driverMap.getSource('driver-history-source');
      if (historySrc) historySrc.setData({ type: 'FeatureCollection', features: [] });
    } catch(e) {}
  }
  if (pickupMarker) { try { pickupMarker.remove(); } catch(e){} pickupMarker = null; }
  if (dropoffMarker) { try { dropoffMarker.remove(); } catch(e){} dropoffMarker = null; }
  clearMultiStopMarkers();
  if (turnBeaconMarker) {
    try { turnBeaconMarker.remove(); } catch(e) {}
    turnBeaconMarker = null;
  }
  consecutiveOffRouteCount = 0;
  NavigationVoice.reset();
  window.dispatchEvent(new CustomEvent('driver-navigation-telemetry', { detail: null }));
}

// ----------------------------------------------------
// GPS ROUTE SIMULATOR ENGINE (FOR REAL-TIME TESTING WITHOUT PHYSICAL MOVEMENT)
// ----------------------------------------------------
let simInterval = null;
let isSimulationActive = false;
let isSimulationPaused = false;
let simSpeedMultiplier = 1;
let simCurrentIndex = 0;
let simDensePoints = [];

export function isGpsSimulationRunning() {
  return isSimulationActive;
}

export function stopGpsRouteSimulation() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  isSimulationActive = false;
  isSimulationPaused = false;
  simCurrentIndex = 0;
  simDensePoints = [];
  window.currentDriverSpeedKmh = 0;
  const speedVal = document.getElementById('driver-speed-value');
  if (speedVal) speedVal.textContent = '0';

  const simBar = document.getElementById('driver-gps-simulator-bar');
  if (simBar) simBar.remove();

  import('../components/toast.js').then(m => {
    m.showToast('Simulación de viaje finalizada 🛑', 'info');
  });
}

export async function startGpsRouteSimulation(targetCoordsList = null) {
  stopGpsRouteSimulation();

  // If no active route exists, build a realistic multi-turn demo route across Magdalena
  if (!targetCoordsList || targetCoordsList.length < 2) {
    if (!activeRoutePathCoords || activeRoutePathCoords.length < 2) {
      const demoStart = { lat: -35.0815, lng: -57.5147 }; // Plaza San Martín
      const demoEnd = { lat: -35.0875, lng: -57.5180 };   // 3 corners away
      await drawDriverRoute(demoStart, demoEnd, null, 'pickup');
      await new Promise(r => setTimeout(r, 600));
    }
    targetCoordsList = activeRoutePathCoords;
  }

  if (!targetCoordsList || targetCoordsList.length < 2) {
    import('../components/toast.js').then(m => {
      m.showToast('No se pudo generar la ruta de simulación', 'warning');
    });
    return;
  }

  fullRoutePathCoords = targetCoordsList;
  activeRoutePathCoords = targetCoordsList;
  currentRouteVertexIndex = 0;

  // Sub-interpolate path coordinates into dense steps spaced at 1.0 meter for realistic motorcycle physics
  simDensePoints = [];
  for (let i = 0; i < targetCoordsList.length - 1; i++) {
    const p1 = targetCoordsList[i];
    const p2 = targetCoordsList[i + 1];
    const distMeters = 6371000 * 2 * Math.asin(Math.sqrt(
      Math.sin(((p2[1] - p1[1]) * Math.PI / 180) / 2) ** 2 +
      Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
      Math.sin(((p2[0] - p1[0]) * Math.PI / 180) / 2) ** 2
    ));
    // 1 sub-step every ~1.0 meter
    const numSubSteps = Math.max(2, Math.round(distMeters / 1.0));
    for (let j = 0; j < numSubSteps; j++) {
      const t = j / numSubSteps;
      const lng = p1[0] + (p2[0] - p1[0]) * t;
      const lat = p1[1] + (p2[1] - p1[1]) * t;
      simDensePoints.push([lng, lat]);
    }
  }
  simDensePoints.push(targetCoordsList[targetCoordsList.length - 1]);

  isSimulationActive = true;
  isSimulationPaused = false;
  simCurrentIndex = 0;
  simSpeedMultiplier = 1;

  renderGpsSimulatorBar();

  import('../components/toast.js').then(m => {
    m.showToast('🎮 Simulación a velocidad real de moto iniciada', 'success');
  });

  runSimulationLoop();
}

function runSimulationLoop() {
  if (simInterval) clearInterval(simInterval);

  // 120ms tick: advances 1 sub-point (1.0m) every 120ms = ~8.33 m/s = 30 km/h (realistic city moto speed)
  simInterval = setInterval(() => {
    if (!isSimulationActive) return;
    if (isSimulationPaused) return;

    if (simCurrentIndex >= simDensePoints.length - 1) {
      // Arrived at destination!
      const lastPt = simDensePoints[simDensePoints.length - 1];
      updateDriverMapLocation({ lat: lastPt[1], lng: lastPt[0] }, lastHeading);
      NavigationVoice.processTelemetry({ totalDistanceMeters: 0, distanceMeters: 0, instruction: 'Llegando a destino', targetStage: 'pickup' });
      window.dispatchEvent(new CustomEvent('driver-arrival-proximity', { detail: { targetStage: 'pickup', distanceMeters: 0 } }));
      stopGpsRouteSimulation();
      import('../components/toast.js').then(m => {
        m.showToast('🏁 ¡Simulación completada! Has llegado a destino.', 'success');
      });
      return;
    }

    const currentPt = simDensePoints[simCurrentIndex];
    const nextPt = simDensePoints[Math.min(simCurrentIndex + 1, simDensePoints.length - 1)];

    const heading = calculateBearing(currentPt[1], currentPt[0], nextPt[1], nextPt[0]);
    const simPos = { lat: currentPt[1], lng: currentPt[0] };

    // Realistic motorcycle city speed: 30 km/h at 1x, 60 km/h at 2x, 120 km/h at 4x
    const speedKmh = 30 * simSpeedMultiplier;
    window.currentDriverSpeedKmh = speedKmh;

    const speedVal = document.getElementById('driver-speed-value');
    if (speedVal) speedVal.textContent = speedKmh;

    // Advance driver location (automatically computes dynamic step-by-step turn and voice guidance)
    updateDriverMapLocation(simPos, heading);

    // Increment index based on speed multiplier (1x = 1 point, 2x = 2 points, 4x = 4 points)
    simCurrentIndex = Math.min(simDensePoints.length - 1, simCurrentIndex + simSpeedMultiplier);

    // Update simulation progress bar in floating controller
    const fillEl = document.getElementById('sim-progress-bar-fill');
    if (fillEl) {
      const pct = Math.round((simCurrentIndex / (simDensePoints.length - 1)) * 100);
      fillEl.style.width = `${pct}%`;
    }
  }, 120);
}

function renderGpsSimulatorBar() {
  const existing = document.getElementById('driver-gps-simulator-bar');
  if (existing) existing.remove();

  const isLight = getDriverMapTheme() === 'light';
  const bar = document.createElement('div');
  bar.id = 'driver-gps-simulator-bar';
  bar.style.cssText = `
    position: fixed;
    top: max(235px, calc(220px + env(safe-area-inset-top, 0px)));
    left: 14px;
    z-index: 9995;
    background: ${isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(9, 13, 22, 0.94)'};
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1.5px solid ${isLight ? 'rgba(56, 189, 248, 0.35)' : 'rgba(56, 189, 248, 0.5)'};
    border-radius: 18px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    max-width: 260px;
    pointer-events: auto;
    animation: fadeIn 0.25s ease-out;
  `;

  bar.innerHTML = `
    <!-- TOP ROW: TITLE & CLOSE BUTTON -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:14px; animation:spin 2s infinite linear;">🎮</span>
        <span style="font-size:11.5px; font-weight:900; color:#38bdf8; letter-spacing:0.3px;">SIMULADOR GPS</span>
      </div>
      <button id="sim-close-btn" title="Cerrar Simulación" style="background:none; border:none; color:${isLight ? '#64748b' : '#94a3b8'}; cursor:pointer; font-size:14px; font-weight:900; padding:2px;">✕</button>
    </div>

    <!-- PROGRESS LINE -->
    <div style="width:100%; height:4px; border-radius:2px; background:${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}; overflow:hidden;">
      <div id="sim-progress-bar-fill" style="height:100%; width:0%; background:linear-gradient(90deg, #38bdf8, #22c55e); transition:width 0.15s linear;"></div>
    </div>

    <!-- CONTROLS ROW: PLAY/PAUSE, SPEED, RESET -->
    <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
      <button id="sim-play-pause-btn" style="flex:1; height:30px; border-radius:10px; border:none; background:#0284c7; color:white; font-size:12px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
        <span id="sim-play-pause-text">⏸ Pausar</span>
      </button>
      <button id="sim-speed-btn" style="height:30px; padding:0 8px; border-radius:10px; border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'}; color:${isLight ? '#0f172a' : '#ffffff'}; font-size:11px; font-weight:900; cursor:pointer;">
        ⚡ <span id="sim-speed-text">1x</span>
      </button>
      <button id="sim-reset-btn" title="Reiniciar desde el inicio" style="height:30px; padding:0 8px; border-radius:10px; border:1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)'}; background:${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'}; color:${isLight ? '#0f172a' : '#ffffff'}; font-size:12px; cursor:pointer;">
        🔄
      </button>
    </div>
  `;

  document.body.appendChild(bar);

  // Attach control listeners
  const closeBtn = bar.querySelector('#sim-close-btn');
  if (closeBtn) closeBtn.onclick = stopGpsRouteSimulation;

  const playPauseBtn = bar.querySelector('#sim-play-pause-btn');
  const playPauseText = bar.querySelector('#sim-play-pause-text');
  if (playPauseBtn) {
    playPauseBtn.onclick = () => {
      isSimulationPaused = !isSimulationPaused;
      if (playPauseText) playPauseText.textContent = isSimulationPaused ? '▶ Reanudar' : '⏸ Pausar';
      playPauseBtn.style.background = isSimulationPaused ? '#10b981' : '#0284c7';
    };
  }

  const speedBtn = bar.querySelector('#sim-speed-btn');
  const speedText = bar.querySelector('#sim-speed-text');
  if (speedBtn) {
    speedBtn.onclick = () => {
      if (simSpeedMultiplier === 1) simSpeedMultiplier = 2;
      else if (simSpeedMultiplier === 2) simSpeedMultiplier = 4;
      else simSpeedMultiplier = 1;
      if (speedText) speedText.textContent = `${simSpeedMultiplier}x`;
    };
  }

  const resetBtn = bar.querySelector('#sim-reset-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      simCurrentIndex = 0;
      isSimulationPaused = false;
      if (playPauseText) playPauseText.textContent = '⏸ Pausar';
      if (playPauseBtn) playPauseBtn.style.background = '#0284c7';
      NavigationVoice.reset();
    };
  }
}
