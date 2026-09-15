/**
 * Official Store App Installation Logic (Google Play & App Store)
 */

export const APP_STORE_URL = 'https://apps.apple.com/app/go-delivery/id6790820954';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.godelivery.magdalena';

let isInstalled = false;

// Check if app is running natively in Capacitor or standalone mode
const isCapacitorNative = () => !!(window.Capacitor && (
  (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
  window.Capacitor.isNative ||
  (window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')
));

if (isCapacitorNative() || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
  isInstalled = true;
}

export function checkIfInstalled() {
  if (isInstalled) return true;
  if (isCapacitorNative()) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone === true) return true;
  return false;
}

export function isIOS() {
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad Pro
}

export function isAndroid() {
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /android/.test(userAgent);
}

export function getDeferredPrompt() {
  return null;
}

export async function promptInstall() {
  if (isIOS()) {
    window.open(APP_STORE_URL, '_blank');
    return true;
  }
  window.open(PLAY_STORE_URL, '_blank');
  return true;
}

let installModalOpen = false;

/**
 * Shows the official Store Download UI
 */
export async function showInstallUI() {
  if (isIOS()) {
    window.location.href = APP_STORE_URL;
    return;
  }
  if (isAndroid()) {
    window.location.href = PLAY_STORE_URL;
    return;
  }

  if (installModalOpen) return;
  installModalOpen = true;

  const { showModal } = await import('./modal.js');

  const modalContent = document.createElement('div');
  modalContent.style.padding = 'var(--space-2, 8px)';
  modalContent.style.textAlign = 'center';

  modalContent.innerHTML = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="width: 72px; height: 72px; background: linear-gradient(135deg, #e11d48, #be123c); border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 10px 30px rgba(225, 29, 72, 0.35);">
        <img src="/logo-pwa.png" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover;" alt="GoDelivery" />
      </div>
      <h2 style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; margin-bottom: 6px; color: var(--color-text-primary);">Descargá GoDelivery</h2>
      <p style="font-size: 13.5px; color: var(--color-text-secondary); line-height: 1.5; max-width: 290px; margin: 0 auto;">Descargá nuestra aplicación oficial desde tu tienda de aplicaciones favorita:</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
      <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 12px; background: #000000; color: #ffffff; border: 1.5px solid rgba(255, 255, 255, 0.2); border-radius: 16px; padding: 14px 20px; text-decoration: none; font-weight: 800; font-size: 14px;">
        Descargar en Google Play
      </a>
      <a href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 12px; background: #000000; color: #ffffff; border: 1.5px solid rgba(255, 255, 255, 0.2); border-radius: 16px; padding: 14px 20px; text-decoration: none; font-weight: 800; font-size: 14px;">
        Descargar en App Store
      </a>
    </div>

    <button id="store-guide-close-btn" class="btn btn-ghost btn-block" style="color: var(--color-text-tertiary); font-weight: 700; font-size: 13px;">
      Continuar en el navegador
    </button>
  `;

  const modal = showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    onClose: () => {
      installModalOpen = false;
    }
  });

  document.getElementById('store-guide-close-btn')?.addEventListener('click', () => {
    modal.close();
  });
}
