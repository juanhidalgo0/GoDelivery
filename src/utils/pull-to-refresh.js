// GoDelivery — Premium Pull-to-Refresh Module
import { AudioManager } from './audio-manager.js';

let isInitialized = false;
let isRefreshing = false;
let isPulling = false;
let startY = 0;
let startX = 0;
let hapticFired = false;
let activeScrollContainer = null;
let indicatorEl = null;

const THRESHOLD = 65; // pixels to trigger refresh
const MAX_PULL = 92;  // max visual translation

function createIndicator() {
  if (document.getElementById('gd-ptr-indicator')) {
    return document.getElementById('gd-ptr-indicator');
  }

  const el = document.createElement('div');
  el.id = 'gd-ptr-indicator';
  el.className = 'gd-ptr-indicator';
  el.innerHTML = `
    <div class="gd-ptr-pill">
      <div class="gd-ptr-icon-wrap">
        <svg class="gd-ptr-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <polyline points="19 12 12 19 5 12"></polyline>
        </svg>
        <div class="gd-ptr-spinner"></div>
        <svg class="gd-ptr-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <span class="gd-ptr-text">Deslizá para actualizar</span>
    </div>
  `;

  document.body.appendChild(el);
  return el;
}

function findScrollContainer(target) {
  // Check if a slide-overlay is open and visible
  const overlay = document.getElementById('app-overlay');
  if (overlay && window.getComputedStyle(overlay).display !== 'none' && overlay.contains(target)) {
    return overlay;
  }

  // Check active slide panel
  const activePanel = document.querySelector('.slide-panel.active') || document.querySelector('.slide-panel');
  if (activePanel && activePanel.contains(target)) {
    return activePanel;
  }

  // Walk up parents for overflow-y
  let el = target;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }

  return window;
}

function isExcludedTarget(target) {
  if (!target) return false;

  // 0. Any modal is open — checked via body class instead of DOM ancestry
  // because a re-render between touchstart and touchmove can detach the
  // original target from the tree, breaking closest() lookups below.
  if (document.body.classList.contains('modal-open')) {
    return true;
  }

  // 1. Interactive Maps (MapLibre, Mapbox, Leaflet)
  if (target.closest('.maplibregl-canvas, .mapboxgl-canvas, .leaflet-container, #map, #driver-navigation-map-canvas, .map-container')) {
    return true;
  }

  // 2. Modals, Drawers & Dialogs
  if (target.closest('.modal-container, .modal-overlay, .modal-container-v2, #address-modal-container, .bottom-sheet, .bottom-sheet-content, .drawer-container')) {
    return true;
  }

  // 3. Delivery driver live navigation mode
  if (document.documentElement.classList.contains('is-delivery-mode') || document.body.classList.contains('is-delivery-mode') || window.isDeliveryPanelActive) {
    return true;
  }

  // 4. Form inputs (don't interfere with typing or selecting)
  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }

  return false;
}

function getScrollTop(container) {
  if (!container || container === window) {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }
  return container.scrollTop || 0;
}

export function initPullToRefresh() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  indicatorEl = createIndicator();

  const onTouchStart = (e) => {
    if (isRefreshing) return;
    const target = e.target;

    if (isExcludedTarget(target)) {
      activeScrollContainer = null;
      return;
    }

    activeScrollContainer = findScrollContainer(target);
    const scrollTop = getScrollTop(activeScrollContainer);

    if (scrollTop <= 2) {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      isPulling = false;
      hapticFired = false;
    } else {
      activeScrollContainer = null;
    }
  };

  const onTouchMove = (e) => {
    if (!activeScrollContainer || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const deltaY = currentY - startY;
    const deltaX = currentX - startX;

    // Check if user is scrolling up or swiping horizontally
    if (deltaY <= 0) {
      if (isPulling) resetIndicator();
      return;
    }

    if (!isPulling && Math.abs(deltaX) > Math.abs(deltaY) * 0.9) {
      // Horizontal swipe detected (e.g. products slider) -> cancel pull
      activeScrollContainer = null;
      return;
    }

    const scrollTop = getScrollTop(activeScrollContainer);
    if (scrollTop > 2) {
      if (isPulling) resetIndicator();
      return;
    }

    // Initiate pull
    isPulling = true;

    // Prevent native overscroll / white bounce if cancelable
    if (e.cancelable && deltaY > 6) {
      e.preventDefault();
    }

    // Elastic rubberband calculation
    const pullDistance = Math.min(MAX_PULL, Math.pow(deltaY, 0.82) * 1.6);
    const progress = Math.min(1, pullDistance / THRESHOLD);

    indicatorEl.style.transition = 'none';
    indicatorEl.style.transform = `translate3d(0, ${pullDistance - 58}px, 0)`;

    const arrowEl = indicatorEl.querySelector('.gd-ptr-arrow');
    const textEl = indicatorEl.querySelector('.gd-ptr-text');

    if (arrowEl) {
      arrowEl.style.transform = `rotate(${progress * 180}deg)`;
    }

    if (pullDistance >= THRESHOLD) {
      if (!hapticFired) {
        hapticFired = true;
        try { AudioManager.hapticLight(); } catch (e) {}
      }
      indicatorEl.classList.add('is-ready');
      if (textEl) textEl.textContent = 'Soltá para actualizar';
    } else {
      hapticFired = false;
      indicatorEl.classList.remove('is-ready');
      if (textEl) textEl.textContent = 'Deslizá para actualizar';
    }
  };

  const onTouchEnd = async () => {
    if (!isPulling || isRefreshing) {
      activeScrollContainer = null;
      return;
    }

    const shouldRefresh = hapticFired;
    isPulling = false;
    activeScrollContainer = null;

    if (shouldRefresh) {
      await executeRefresh();
    } else {
      resetIndicator();
    }
  };

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { passive: true });
}

async function executeRefresh() {
  if (isRefreshing) return;
  isRefreshing = true;

  indicatorEl.classList.remove('is-ready');
  indicatorEl.classList.add('is-refreshing');
  indicatorEl.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
  indicatorEl.style.transform = 'translate3d(0, 24px, 0)';

  const textEl = indicatorEl.querySelector('.gd-ptr-text');
  if (textEl) textEl.textContent = 'Actualizando...';

  const startTime = Date.now();

  try {
    // 1. Dispatch custom event for active views to reload data
    window.dispatchEvent(new CustomEvent('app-pull-refresh', {
      detail: { timestamp: startTime }
    }));

    // 2. Trigger active route reload if router is present
    if (typeof window.handleRoute === 'function') {
      const currentHash = window.location.hash || '#/';
      window.handleRoute(currentHash);
    }

    // 3. Background app version check
    if (typeof window.checkAppVersion === 'function') {
      window.checkAppVersion();
    }

    // Minimum visual duration (600ms) for smooth UX feel
    const elapsed = Date.now() - startTime;
    if (elapsed < 600) {
      await new Promise(r => setTimeout(r, 600 - elapsed));
    }

    // Show success state
    indicatorEl.classList.remove('is-refreshing');
    indicatorEl.classList.add('is-success');
    if (textEl) textEl.textContent = '¡Actualizado!';
    try { AudioManager.hapticLight(); } catch (e) {}

    await new Promise(r => setTimeout(r, 350));
  } catch (err) {
    console.warn('PullToRefresh execution error:', err);
  } finally {
    resetIndicator();
    setTimeout(() => {
      isRefreshing = false;
    }, 350);
  }
}

function resetIndicator() {
  if (!indicatorEl) return;
  indicatorEl.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease';
  indicatorEl.style.transform = 'translate3d(0, -70px, 0)';
  indicatorEl.classList.remove('is-ready', 'is-refreshing', 'is-success');

  const arrowEl = indicatorEl.querySelector('.gd-ptr-arrow');
  if (arrowEl) arrowEl.style.transform = 'rotate(0deg)';
}
