import { checkIfInstalled, isIOS } from './install-prompt.js';
import { icon } from '../utils/icons.js';

export const APP_STORE_URL = 'https://apps.apple.com/app/go-delivery/id6790820954';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.godelivery.magdalena';

/**
 * Native App Store Enforcement Lock Screen
 */
export function ensureAppInstalled() {
  const isCapacitorNative = !!(window.Capacitor && (
    (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
    window.Capacitor.isNative ||
    (window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')
  ));
  if (isCapacitorNative) return;
  if (checkIfInstalled()) return;
  
  if (window.location.search.includes('test=true') || window.location.search.includes('preview=true') || window.location.hash.includes('preview=true')) return;
  
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return;
  
  if (sessionStorage.getItem('pwa_skipped')) return;
  showLockScreen();
}

function showLockScreen() {
  if (document.getElementById('pwa-lock-screen')) return;

  const lockScreen = document.createElement('div');
  lockScreen.id = 'pwa-lock-screen';
  lockScreen.className = 'pwa-lock-fullscreen';
  lockScreen.style.cssText = `
    position: fixed;
    inset: 0;
    width: 100vw;
    min-height: 100dvh;
    z-index: 200000;
    background: #0b0b0c;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: calc(max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 24px)) + 20px) 24px calc(max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 20px)) + 16px) 24px;
    box-sizing: border-box;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  `;

  document.body.appendChild(lockScreen);

  const isIos = isIOS();
  const isAndroid = /Android/i.test(navigator.userAgent);

  const appleLogoSvg = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.82 1.11-1.96.99-3.1-.96.04-2.11.64-2.79 1.44-.59.69-1.12 1.83-.98 2.94 1.07.08 2.15-.55 2.78-1.28z"/>
    </svg>
  `;

  const googlePlaySvg = `
    <svg width="22" height="22" viewBox="0 0 24 24" style="flex-shrink:0;">
      <path fill="#4285F4" d="M3.6 1.8l10.9 10.9-3.1 3.1L2.1 2.6c-.3.4-.3 1 0 1.4l1.5-2.2z"/>
      <path fill="#EA4335" d="M14.5 12.7L3.6 23.6c.3.4.9.4 1.4.1l12.4-7.2-2.9-3.8z"/>
      <path fill="#FBBC04" d="M21.9 11.3l-4.5-2.6-2.9 4 2.9 4 4.5-2.6c.8-.5.8-2.3 0-2.8z"/>
      <path fill="#34A853" d="M3.6 1.8L14.5 12.7l2.9-4L5 1.5c-.5-.3-1.1-.3-1.4.3z"/>
    </svg>
  `;

  lockScreen.innerHTML = `
    <div class="gl-top">
      <span class="gl-ring"><img src="/logo-brand.jpg?v=2" alt="GO! Delivery" /><i></i></span>
    </div>

    <div class="gl-hero">
      <span class="go-eyebrow">App oficial · Magdalena</span>
      <h1 class="go-title">Pedí mejor<br>desde la app</h1>
      <span class="go-bar"></span>
      <p>Comida, súper, mandados y viajes, puerta a puerta.</p>
      <ul class="gl-benefits">
        <li><span>${icon('ticket', 18)}</span>Cupones y descuentos que solo están en la app</li>
        <li><span>${icon('mapPin', 18)}</span>Seguí tu pedido en vivo en el mapa</li>
        <li><span>${icon('bell', 18)}</span>Avisos al instante en cada paso de tu pedido</li>
      </ul>
    </div>

    <div class="gl-actions">
      ${isIos ? `
          <a href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer" id="btn-open-appstore" class="gl-store">
            <span class="gl-store-logo">${appleLogoSvg}</span>
            <span class="gl-store-text"><small>Descargala en</small><strong>App Store</strong></span>
            <span class="gl-store-go">${icon('chevronRight', 18)}</span>
          </a>
      ` : isAndroid ? `
          <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" id="btn-open-playstore" class="gl-store">
            <span class="gl-store-logo">${googlePlaySvg}</span>
            <span class="gl-store-text"><small>Descargala en</small><strong>Google Play</strong></span>
            <span class="gl-store-go">${icon('chevronRight', 18)}</span>
          </a>
      ` : `
          <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" class="gl-store">
            <span class="gl-store-logo">${googlePlaySvg}</span>
            <span class="gl-store-text"><small>Descargala en</small><strong>Google Play</strong></span>
            <span class="gl-store-go">${icon('chevronRight', 18)}</span>
          </a>
          <a href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer" class="gl-store">
            <span class="gl-store-logo">${appleLogoSvg}</span>
            <span class="gl-store-text"><small>Descargala en</small><strong>App Store</strong></span>
            <span class="gl-store-go">${icon('chevronRight', 18)}</span>
          </a>
      `}
      <button id="lock-skip-btn" class="gl-skip">Seguir en el navegador</button>
    </div>
  `;

  // Listeners
  document.getElementById('lock-skip-btn')?.addEventListener('click', () => {
    sessionStorage.setItem('pwa_skipped', 'true');
    lockScreen.classList.add('is-leaving');
    setTimeout(() => {
      lockScreen.remove();
      window.dispatchEvent(new CustomEvent('pwa-lock-dismissed'));
    }, 320);
  });
}


