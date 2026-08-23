import { checkIfInstalled, showInstallUI, isIOS, promptInstall } from './install-prompt.js';
import { icon } from '../utils/icons.js';

let pwaCheckDone = false;

/**
 * PWA Enforcement Lock Screen
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
    justify-content: flex-start;
    padding: 16px 16px 32px;
    text-align: center;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    animation: fadeIn 0.4s ease-out;
    box-sizing: border-box;
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
      <div class="lock-content" style="max-width: 360px; width: 100%; margin: auto 0; animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);">
        <div class="lock-logo-container" style="margin-bottom: 10px; margin-top: 10px;">
          <div style="width: 64px; height: 64px; background: #E11D48; border-radius: 18px; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(225, 29, 72, 0.3);">
            <img src="/logo-pwa.png" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover;" />
          </div>
        </div>

        <h1 style="font-family: var(--font-display); font-size: 1.45rem; font-weight: 900; color: var(--color-text-primary); margin-bottom: 4px; letter-spacing: -0.02em;">
          GoDelivery App
        </h1>
        <p style="color: var(--color-text-secondary); font-size: 13px; line-height: 1.4; margin-bottom: 14px;">
          Instalá nuestra app oficial para una experiencia más rápida y segura.
        </p>

        ${isIos ? renderIosGuide() : `
          <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
            <button id="lock-install-btn" class="btn btn-primary btn-block btn-lg" style="height: 56px; font-weight: 800; font-size: 1.05rem; border-radius: 18px; box-shadow: var(--shadow-primary);">
              ${icon('plus', 20)} Instalar App
            </button>
            
            <button id="lock-skip-btn" class="btn btn-ghost btn-block" style="color: var(--color-text-tertiary); font-weight: 600; font-size: 13.5px; margin-top: 4px;">
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
    <div class="ios-guide" style="background: var(--color-surface); border-radius: 28px; padding: 22px; text-align: left; border: 1.5px solid var(--color-border); box-shadow: var(--shadow-md); animation: fadeIn 0.4s ease-out;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom: 18px;">
        <div style="width:36px; height:36px; background:#E11D48; color:white; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px;">📱</div>
        <div>
          <h3 style="font-weight: 900; font-size: 15px; color: var(--color-text-primary); margin:0;">Cómo instalar en iPhone</h3>
          <p style="font-size: 12px; color: var(--color-text-tertiary); margin:0;">Seguí estos 3 pasos rápidos en Safari:</p>
        </div>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; align-items: flex-start; gap: 12px; background: var(--color-bg-secondary); padding: 12px 14px; border-radius: 16px; border: 1px solid var(--color-border-light);">
          <div style="width: 28px; height: 28px; background: #E11D48; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; flex-shrink: 0;">1</div>
          <div>
            <p style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary); margin:0 0 2px;">Tocá el botón Compartir <span style="display:inline-block; background:rgba(225,29,72,0.12); color:#E11D48; padding:2px 8px; border-radius:8px; font-size:15px; font-weight:900;">⎋</span></p>
            <p style="font-size: 11.5px; color: var(--color-text-tertiary); margin:0;">Ubicado abajo al centro en la barra de Safari.</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: flex-start; gap: 12px; background: var(--color-bg-secondary); padding: 12px 14px; border-radius: 16px; border: 1px solid var(--color-border-light);">
          <div style="width: 28px; height: 28px; background: #E11D48; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; flex-shrink: 0;">2</div>
          <div>
            <p style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary); margin:0 0 2px;">Buscá <strong style="color: #E11D48;">"Agregar a inicio"</strong> <span style="display:inline-block; background:rgba(225,29,72,0.12); color:#E11D48; padding:2px 8px; border-radius:8px; font-size:14px; font-weight:900;">➕</span></p>
            <p style="font-size: 11.5px; color: var(--color-text-tertiary); margin:0;">Deslizá el menú de opciones hacia abajo para encontrarla.</p>
          </div>
        </div>

        <div style="display: flex; align-items: flex-start; gap: 12px; background: var(--color-bg-secondary); padding: 12px 14px; border-radius: 16px; border: 1px solid var(--color-border-light);">
          <div style="width: 28px; height: 28px; background: #E11D48; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; flex-shrink: 0;">3</div>
          <div>
            <p style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary); margin:0 0 2px;">Tocá <strong style="color: #E11D48;">"Agregar"</strong> arriba a la derecha</p>
            <p style="font-size: 11.5px; color: var(--color-text-tertiary); margin:0;">¡Listo! Se creará el ícono oficial en tu pantalla.</p>
          </div>
        </div>
      </div>

      <div style="text-align: center; margin-top: 12px; font-size: 20px; animation: pulse-blue 1.5s infinite;">
        👇
      </div>

      <button id="lock-skip-btn-ios" class="btn btn-ghost btn-block" style="margin-top: 10px; font-size: 12.5px; font-weight: 700; color: var(--color-text-tertiary);">
        Continuar en Safari sin instalar
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
