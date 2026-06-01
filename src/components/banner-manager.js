// GoDelivery — Global Banner Manager (Robust & Fluid)
import { icon } from '../utils/icons.js';

export const activeBanners = {
  message: { config: null },
  commerce: { config: null },
  delivery: { config: null },
  customer: { config: null }
};

const bannerTimeouts = {};

export function setBanner(type, config) {
  activeBanners[type].config = config;
  
  // Handle auto-dismiss duration
  if (bannerTimeouts[type]) {
    clearTimeout(bannerTimeouts[type]);
    delete bannerTimeouts[type];
  }

  if (config.duration) {
    bannerTimeouts[type] = setTimeout(() => {
      clearBanner(type);
    }, config.duration);
  }

  renderBanners();
}

export function clearBanner(type) {
  if (bannerTimeouts[type]) {
    clearTimeout(bannerTimeouts[type]);
    delete bannerTimeouts[type];
  }

  const el = document.querySelector(`.banner-stack-item.${type}`);
  if (el && !el.classList.contains('leaving')) {
    el.classList.add('leaving');
    setTimeout(() => {
      activeBanners[type].config = null;
      renderBanners();
    }, 600); // Faster dismissal for better UX
  } else if (!el) {
    activeBanners[type].config = null;
    renderBanners();
  }
}

export function clearAllBanners() {
  Object.keys(activeBanners).forEach(type => clearBanner(type));
}

function renderBanners() {
  const container = document.getElementById('active-order-banner-container');
  if (!container) return;

  const types = ['message', 'commerce', 'delivery', 'customer'];
  
  types.forEach(type => {
    const data = activeBanners[type];
    let existingEl = container.querySelector(`.banner-stack-item.${type}`);

    if (data.config) {
      if (!existingEl) {
        existingEl = document.createElement('div');
        existingEl.className = `banner-stack-item ${type}`;
        container.appendChild(existingEl);
        // Force reflow for entry animation
        void existingEl.offsetWidth;
      }
      
      if (existingEl.classList.contains('leaving')) return;

      existingEl.innerHTML = `
        <div class="banner-content-container">${data.config.html}</div>
      `;

      existingEl.onclick = (e) => {
        if (data.config.onClick) data.config.onClick(e);
      };
    } else {
      if (existingEl && !existingEl.classList.contains('leaving')) {
        existingEl.remove();
      }
    }
  });

  const hasAny = container.querySelector('.banner-stack-item:not(.leaving)');
  if (hasAny) {
    container.classList.add('active');
  } else {
    container.classList.remove('active');
  }
}

// Global styles for banners
if (!document.getElementById('banner-stack-styles')) {
  const style = document.createElement('style');
  style.id = 'banner-stack-styles';
  style.textContent = `
    #active-order-banner-container {
      position: fixed;
      bottom: calc(var(--navbar-height) + 16px);
      right: 0;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
      gap: 12px;
    }

    .banner-stack-item {
      position: relative;
      display: flex;
      align-items: center;
      pointer-events: auto;
      cursor: pointer;
      will-change: transform, opacity;
      transform: translateX(120%);
      opacity: 0;
      transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease;
    }

    /* Entry state */
    #active-order-banner-container.active .banner-stack-item:not(.leaving) {
      transform: translateX(0);
      opacity: 1;
    }

    .banner-stack-item.leaving {
      transform: translateX(150%) !important;
      opacity: 0 !important;
      pointer-events: none;
    }

    .banner-pull-handle {
      width: 44px;
      height: 44px;
      background: #111;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 50%;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      position: absolute;
      left: -22px;
      z-index: 10;
    }

    .banner-content-container {
      background: transparent;
      min-width: 240px;
      max-width: 85vw;
    }

    .active-order-banner {
      border-radius: 28px 0 0 28px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.15);
      box-shadow: -15px 15px 50px rgba(0,0,0,0.5);
    }
  `;
  document.head.appendChild(style);
}
