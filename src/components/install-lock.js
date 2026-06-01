import { checkIfInstalled, showInstallUI, isIOS, promptInstall } from './install-prompt.js';
import { icon } from '../utils/icons.js';

let pwaCheckDone = false;

/**
 * PWA Enforcement Lock Screen
 */
export function ensureAppInstalled() {
  if (checkIfInstalled()) return;
  
  if (window.location.search.includes('test=true')) return;
  
  // No forzar en desktop si no es necesario, pero permitir que el usuario lo vea
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return;
  
  if (sessionStorage.getItem('pwa_skipped')) return;
  showLockScreen();
}

function showLockScreen() {
  if (document.getElementById('pwa-lock-screen')) return;

  const lockScreen = document.createElement('div');
  lockScreen.id = 'pwa-lock-screen';
  lockScreen.className = 'pwa-lock-overlay';
  lockScreen.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 200000;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    animation: fadeIn 0.4s ease-out;
  `;

  document.body.appendChild(lockScreen);

  let currentView = null;
  let installationStarted = false;
  let installationFinished = false;

  const renderContent = () => {
    if (installationStarted) return; // Don't interrupt installation UI

    const isIos = isIOS();
    const canInstallAndroid = window.deferredPrompt !== undefined;
    
    // Eliminamos la detección agresiva de 'likelyInstalled' que fallaba
    const viewToRender = 'install-prompt';
    if (currentView === viewToRender) return;
    currentView = viewToRender;

    lockScreen.innerHTML = `
      <div class="lock-content" style="max-width: 320px; width: 100%; animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);">
        <div class="lock-logo-container" style="margin-bottom: 32px;">
          <div style="width: 100px; height: 100px; background: var(--color-primary); border-radius: 28px; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 12px 30px rgba(227, 27, 35, 0.3);">
            <img src="/logo-pwa.png" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover;" />
          </div>
        </div>

        <h1 style="font-family: var(--font-display); font-size: 1.85rem; font-weight: 900; color: var(--color-text-primary); margin-bottom: 12px; letter-spacing: -0.02em;">
          GoDelivery App
        </h1>
        <p style="color: var(--color-text-secondary); font-size: 15px; line-height: 1.6; margin-bottom: 32px;">
          Instalá nuestra app oficial para una experiencia más rápida y segura.
        </p>

        ${isIos ? renderIosGuide() : `
          <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
            <button id="lock-install-btn" class="btn btn-primary btn-block btn-lg" style="height: 60px; font-weight: 800; font-size: 1.1rem; border-radius: 18px; box-shadow: var(--shadow-primary);">
              ${icon('plus', 20)} Instalar App
            </button>
            
            <button id="lock-skip-btn" class="btn btn-ghost btn-block" style="color: var(--color-text-tertiary); font-weight: 600; font-size: 14px; margin-top: 8px;">
              Continuar en el navegador
            </button>
          </div>
        `}
      </div>
    `;

    // Listeners
    document.getElementById('lock-install-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('lock-install-btn');
      const originalText = btn.innerHTML;
      
      const success = await promptInstall();
      if (success) {
        startInstallationFlow(lockScreen);
      } else {
        // Si el prompt falla o no está disponible, mostramos guía manual
        btn.innerHTML = `<span style="font-size:14px; opacity:0.8;">Buscá "Instalar app" en tu navegador</span>`;
        setTimeout(() => {
          showInstallUI(); // Muestra el modal con instrucciones
          btn.innerHTML = originalText;
        }, 2000);
      }
    });

    document.getElementById('lock-skip-btn')?.addEventListener('click', () => {
      sessionStorage.setItem('pwa_skipped', 'true');
      lockScreen.classList.add('fade-out');
      setTimeout(() => {
        lockScreen.remove();
        window.dispatchEvent(new CustomEvent('pwa-lock-dismissed'));
      }, 400);
    });
    
    document.getElementById('lock-skip-btn-ios')?.addEventListener('click', () => {
      sessionStorage.setItem('pwa_skipped', 'true');
      lockScreen.classList.add('fade-out');
      setTimeout(() => {
        lockScreen.remove();
        window.dispatchEvent(new CustomEvent('pwa-lock-dismissed'));
      }, 400);
    });
  };

  const startInstallationFlow = (lockScreen) => {
    installationStarted = true;
    currentView = 'installing';
    showInstallingState(lockScreen);

    // Minimum display time for the "Installing" screen to feel interactive
    const minWait = new Promise(resolve => setTimeout(resolve, 3500));
    
    // Listen for the actual completion
    window.addEventListener('appinstalled', () => {
      installationFinished = true;
      minWait.then(() => {
        currentView = 'success';
        showSuccessState(lockScreen);
      });
    }, { once: true });

    // Fallback: If for some reason appinstalled doesn't fire but we think it's done
    minWait.then(() => {
        if (installationFinished) {
            currentView = 'success';
            showSuccessState(lockScreen);
        }
    });
  };

  renderContent();
  
  setTimeout(() => {
    pwaCheckDone = true;
    renderContent();
  }, 2500);

  window.addEventListener('pwa-prompt-available', renderContent);
}

function renderIosGuide() {
  return `
    <div class="ios-guide" style="background: var(--color-bg-secondary); border-radius: 24px; padding: 20px; text-align: left; border: 1.5px solid var(--color-border); animation: fadeIn 0.5s ease-out;">
      <p style="font-weight: 800; font-size: 13px; color: var(--color-primary); text-transform: uppercase; margin-bottom: 16px;">Instrucciones para iPhone:</p>
      
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 28px; height: 28px; background: var(--color-primary-light); color: var(--color-primary); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px;">1</div>
          <p style="font-size: 14px; font-weight: 600; color: var(--color-text-primary);">Toca el botón de compartir ${icon('externalLink', 16)}</p>
        </div>
        
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 28px; height: 28px; background: var(--color-primary-light); color: var(--color-primary); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px;">2</div>
          <p style="font-size: 14px; font-weight: 600; color: var(--color-text-primary);">Busca <strong style="color: var(--color-primary);">"Agregar a inicio"</strong></p>
        </div>
      </div>

      <button id="lock-skip-btn-ios" class="btn btn-ghost btn-block" style="margin-top: 20px; font-size: 12px; opacity: 0.7;">
        Ya lo hice / Continuar en Safari
      </button>
    </div>
  `;
}

function renderAlreadyInstalled(lockScreen) {
  lockScreen.innerHTML = `
    <div class="lock-content" style="max-width: 320px; width: 100%; animation: slideUp 0.5s ease-out;">
      <div class="lock-logo-container" style="margin-bottom: 32px; opacity: 0.5;">
        <div style="width: 80px; height: 80px; background: var(--color-bg-secondary); border-radius: 24px; margin: 0 auto; display: flex; align-items: center; justify-content: center; border: 2px solid var(--color-border);">
          <img src="/logo-pwa.png" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover; filter: grayscale(1);" />
        </div>
      </div>
      <h1 style="font-family: var(--font-display); font-size: 1.75rem; font-weight: 900; color: var(--color-text-primary); margin-bottom: 12px;">¡Ya tenés la App!</h1>
      <p style="color: var(--color-text-secondary); font-size: 15px; margin-bottom: 32px;">Cerrá esta pestaña y abrí GoDelivery desde tu pantalla de inicio.</p>
      <button id="lock-skip-btn-already" class="btn btn-ghost btn-block" style="font-weight: 700; color: var(--color-primary);">Continuar de todos modos</button>
    </div>
  `;
  
  document.getElementById('lock-skip-btn-already')?.addEventListener('click', () => {
    sessionStorage.setItem('pwa_skipped', 'true');
    lockScreen.remove();
    window.dispatchEvent(new CustomEvent('pwa-lock-dismissed'));
  });
}

function showInstallingState(lockScreen) {
  lockScreen.innerHTML = `
    <div class="lock-content" style="max-width: 320px; width: 100%; animation: zoomIn 0.5s ease-out;">
      <div style="margin-bottom: 40px; position: relative; width: 120px; height: 120px; margin: 0 auto;">
        <svg class="progress-ring" width="120" height="120" style="transform: rotate(-90deg);">
          <circle class="progress-ring__circle" stroke="var(--color-primary)" stroke-width="6" fill="transparent" r="54" cx="60" cy="60" style="stroke-dasharray: 339.292; stroke-dashoffset: 339.292; animation: progress 3.5s linear forwards;" />
        </svg>
        <div style="position: absolute; top: 10px; left: 10px; width: 100px; height: 100px; background: var(--color-primary); border-radius: 28px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
          <img src="/logo-pwa.png" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
      </div>

      <h1 style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; color: var(--color-text-primary); margin-bottom: 12px;">Instalando...</h1>
      <p style="color: var(--color-text-secondary); font-size: 14px; font-weight: 500;">
        Configurando <strong style="color: var(--color-primary);">GoDelivery</strong> para vos.
      </p>

      <style>
        @keyframes progress {
          from { stroke-dashoffset: 339.292; }
          to { stroke-dashoffset: 0; }
        }
      </style>
    </div>
  `;
}

function showSuccessState(lockScreen) {
  lockScreen.innerHTML = `
    <div class="lock-content" style="max-width: 320px; width: 100%; animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);">
      <div style="margin-bottom: 40px; position: relative;">
        <div style="width: 100px; height: 100px; background: var(--color-success); border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 12px 40px rgba(34, 197, 94, 0.3); animation: bounce 1s infinite alternate;">
          ${icon('check', 48, 'color: white')}
        </div>
      </div>

      <h1 style="font-family: var(--font-display); font-size: 1.85rem; font-weight: 950; color: var(--color-text-primary); margin-bottom: 16px;">¡App Instalada!</h1>
      <p style="color: var(--color-text-secondary); font-size: 15px; margin-bottom: 40px;">
        Cerrá esta pestaña y abrí el ícono de <br/> <strong>GoDelivery</strong> en tu celular.
      </p>

      <div style="background: var(--color-success-light); border-radius: 20px; padding: 20px;">
         <p style="font-size: 14px; font-weight: 700; color: var(--color-success-dark);">¡Experiencia completa activada!</p>
      </div>
    </div>
  `;
}
