/**
 * PWA Installation Logic
 */

let deferredPrompt = null;
let isInstalled = false;

// Check if app is already running in standalone mode or native Capacitor wrapper
if ((window.Capacitor && window.Capacitor.isNative) || (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web') || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
  isInstalled = true;
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  window.deferredPrompt = e;
  console.log('PWA: beforeinstallprompt event fired');

  // Dispatch a custom event to notify components that the prompt is available
  window.dispatchEvent(new CustomEvent('pwa-prompt-available'));
});

window.addEventListener('appinstalled', (evt) => {
  console.log('PWA: App was installed');
  isInstalled = true;
  deferredPrompt = null;
  window.dispatchEvent(new CustomEvent('pwa-installed'));
});

export function getDeferredPrompt() {
  return deferredPrompt;
}

export function checkIfInstalled() {
  if (isInstalled) return true;
  // Also check dynamically in case Capacitor was initialized after module load
  if (window.Capacitor && window.Capacitor.isNative) return true;
  if (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web') return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone === true) return true;
  return false;
}

export function isIOS() {
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad Pro
}

export async function promptInstall() {
  if (!deferredPrompt) {
    return false;
  }

  // Show the prompt
  deferredPrompt.prompt();

  // Wait for the user to respond to the prompt
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`PWA: User response to the install prompt: ${outcome}`);

  // We've used the prompt, and can't use it again, throw it away
  deferredPrompt = null;

  return outcome === 'accepted';
}

let installModalOpen = false;

/**
 * Shows a premium installation UI
 */
export async function showInstallUI() {
  if (installModalOpen) return;
  installModalOpen = true;

  const { showModal } = await import('./modal.js');
  const { icon } = await import('../utils/icons.js');

  const modalContent = document.createElement('div');
  modalContent.className = 'install-prompt-modal';
  modalContent.style.padding = 'var(--space-2)';

  const isIos = isIOS();
  const hasPrompt = deferredPrompt !== null;

  if (isIos) {
    modalContent.innerHTML = `
      <div style="text-align: center; margin-bottom: var(--space-6);">
        <div class="install-icon-container" style="width: 80px; height: 80px; background: var(--color-primary); color: white; border-radius: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-4); font-size: 40px; box-shadow: 0 8px 24px rgba(227, 27, 35, 0.25);">
          <img src="/logo-brand.jpg" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover;" />
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; margin-bottom: var(--space-2); color: var(--color-text-primary);">Instalar GoDelivery</h2>
        <p style="font-size: var(--font-sm); color: var(--color-text-secondary); line-height: 1.6; max-width: 280px; margin: 0 auto;">Agregá GoDelivery a tu pantalla de inicio para una experiencia más rápida y fluida.</p>
      </div>

      <div style="background: var(--color-bg-secondary); border-radius: var(--radius-xl); padding: var(--space-5); border: 1px solid var(--color-border-light);">
        <p style="font-weight: 700; font-size: var(--font-sm); margin-bottom: var(--space-4); color: var(--color-text-primary);">Pasos para instalar en iPhone:</p>
        <div style="display: flex; flex-direction: column; gap: var(--space-4);">
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <div style="width: 32px; height: 32px; background: var(--color-surface); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--color-primary); border: 1px solid var(--color-border);">1</div>
            <p style="font-size: var(--font-sm); color: var(--color-text-secondary);">Tocá el botón <strong>Compartir</strong> <span style="display:inline-flex; vertical-align:middle; color:#007AFF;">${icon('share', 18)}</span> en la barra inferior.</p>
          </div>
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <div style="width: 32px; height: 32px; background: var(--color-surface); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--color-primary); border: 1px solid var(--color-border);">2</div>
            <p style="font-size: var(--font-sm); color: var(--color-text-secondary);">Buscá y seleccioná <strong>"Agregar a Inicio"</strong>.</p>
          </div>
        </div>
      </div>
      
      <button class="btn btn-block btn-lg" id="ios-guide-close-btn" style="margin-top: var(--space-6); background: var(--color-bg-secondary); color: var(--color-text-tertiary); font-weight: 700;">Entendido</button>
    `;
  } else if (!hasPrompt) {
    modalContent.innerHTML = `
      <div style="text-align: center; margin-bottom: var(--space-6);">
        <div class="install-icon-container" style="width: 80px; height: 80px; background: var(--color-primary); color: white; border-radius: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-4); font-size: 40px; box-shadow: 0 8px 24px rgba(227, 27, 35, 0.25);">
          <img src="/logo-brand.jpg" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover;" />
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; margin-bottom: var(--space-2); color: var(--color-text-primary);">Instalar GoDelivery</h2>
        <p style="font-size: var(--font-sm); color: var(--color-text-secondary); line-height: 1.6; max-width: 280px; margin: 0 auto;">Instalá la aplicación manualmente en tu Android en solo 2 pasos:</p>
      </div>

      <div style="background: var(--color-bg-secondary); border-radius: var(--radius-xl); padding: var(--space-5); border: 1px solid var(--color-border-light);">
        <p style="font-weight: 700; font-size: var(--font-sm); margin-bottom: var(--space-4); color: var(--color-text-primary);">Pasos para instalar en Android / Chrome:</p>
        <div style="display: flex; flex-direction: column; gap: var(--space-4);">
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <div style="width: 32px; height: 32px; background: var(--color-surface); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--color-primary); border: 1px solid var(--color-border);">1</div>
            <p style="font-size: var(--font-sm); color: var(--color-text-secondary);">Tocá el botón de <strong>Opciones (los tres puntos ⋮)</strong> en la esquina superior derecha del navegador Chrome.</p>
          </div>
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <div style="width: 32px; height: 32px; background: var(--color-surface); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--color-primary); border: 1px solid var(--color-border);">2</div>
            <p style="font-size: var(--font-sm); color: var(--color-text-secondary);">Seleccioná la opción <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</p>
          </div>
        </div>
      </div>
      
      <button class="btn btn-block btn-lg" id="android-guide-close-btn" style="margin-top: var(--space-6); background: var(--color-bg-secondary); color: var(--color-text-tertiary); font-weight: 700;">Entendido</button>
    `;
  } else {
    modalContent.innerHTML = `
      <div style="text-align: center; margin-bottom: var(--space-6);">
        <div class="install-icon-container" style="width: 80px; height: 80px; background: var(--color-primary); color: white; border-radius: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-4); font-size: 40px; box-shadow: 0 8px 24px rgba(227, 27, 35, 0.25);">
           <img src="/logo-brand.jpg" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover;" />
        </div>
        <h2 style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; margin-bottom: var(--space-2); color: var(--color-text-primary);">Instalar GoDelivery</h2>
        <p style="font-size: var(--font-sm); color: var(--color-text-secondary); line-height: 1.6; max-width: 280px; margin: 0 auto;">Disfrutá de GoDelivery como una aplicación real, sin barras de navegación y con acceso directo.</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: var(--space-3);">
        <button class="btn btn-primary btn-block btn-lg" id="confirm-install-btn" style="height: 56px; font-weight: 800; border-radius: var(--radius-xl); box-shadow: var(--shadow-primary);">
          Instalar App
        </button>
        <button class="btn btn-ghost btn-block" style="color: var(--color-text-tertiary); font-weight: 600;" id="cancel-install-btn">
          Ahora no
        </button>
      </div>
    `;
  }

  const modal = showModal({
    title: '',
    content: modalContent,
    hideHeader: true,
    onClose: () => {
      installModalOpen = false;
    }
  });

  if (isIos) {
    document.getElementById('ios-guide-close-btn')?.addEventListener('click', () => {
      modal.close();
    });
  } else if (!hasPrompt) {
    document.getElementById('android-guide-close-btn')?.addEventListener('click', () => {
      modal.close();
    });
  } else {
    document.getElementById('confirm-install-btn')?.addEventListener('click', async () => {
      const success = await promptInstall();
      if (success) {
        modal.close();
      }
    });

    document.getElementById('cancel-install-btn')?.addEventListener('click', () => {
      modal.close();
    });
  }
}
