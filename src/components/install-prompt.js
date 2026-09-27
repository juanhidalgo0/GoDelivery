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

  const { showGoSheet } = await import('./go-sheet.js');
  const storeLink = (href, label) => `<a class="go-store-row" href="${href}" target="_blank" rel="noopener noreferrer"><span>${label}</span><span aria-hidden="true">›</span></a>`;
  showGoSheet({
    id: 'store-install-sheet',
    iconName: 'smartphone',
    eyebrow: 'App oficial',
    title: 'Descargá GO!',
    bodyHtml: `
      <p>Pedí más rápido, seguí tu pedido en el mapa y recibí avisos al instante.</p>
      <div class="go-store-rows">
        ${storeLink(PLAY_STORE_URL, 'Google Play')}
        ${storeLink(APP_STORE_URL, 'App Store')}
      </div>`,
    secondary: { label: 'Seguir en el navegador' },
    onClose: () => { installModalOpen = false; },
  });
}
