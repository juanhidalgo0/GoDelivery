import { checkIfInstalled, isIOS } from './install-prompt.js';

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
    background: #080b11;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: calc(env(safe-area-inset-top, 24px) + 20px) 24px calc(env(safe-area-inset-bottom, 20px) + 16px) 24px;
    box-sizing: border-box;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    animation: fadeIn 0.3s ease-out;
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
    <style>
      .store-primary-cta {
        position: relative;
        overflow: hidden;
        transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s ease;
      }
      .store-primary-cta:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 36px rgba(225, 29, 72, 0.45);
      }
      .store-primary-cta:active {
        transform: scale(0.98);
      }
      .store-primary-cta::after {
        content: '';
        position: absolute;
        top: 0; left: -100%; width: 60%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        transform: skewX(-20deg);
        animation: shineSweep 4s infinite;
      }
      @keyframes shineSweep {
        0%, 75% { left: -100%; }
        100% { left: 200%; }
      }
      .skip-web-link:hover {
        color: #e2e8f0 !important;
      }
    </style>

    <!-- Top Ambient Glow -->
    <div style="position: absolute; top: -80px; left: 50%; transform: translateX(-50%); width: 380px; height: 380px; background: radial-gradient(circle, rgba(225, 29, 72, 0.22) 0%, transparent 65%); pointer-events: none; filter: blur(50px);"></div>

    <!-- Top Badge -->
    <div style="z-index: 1; margin-bottom: auto; padding-top: 8px;">
      <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(225, 29, 72, 0.12); border: 1px solid rgba(225, 29, 72, 0.28); padding: 5px 14px; border-radius: 100px; font-size: 11px; font-weight: 850; color: #fb7185; letter-spacing: 0.5px;">
        <span>★ 4.9</span>
        <span style="opacity:0.4;">•</span>
        <span>APP OFICIAL</span>
      </div>
    </div>

    <!-- Center Hero Section -->
    <div style="z-index: 1; max-width: 380px; width: 100%; display: flex; flex-direction: column; align-items: center; text-align: center; margin: auto 0; padding: 24px 0;">
      
      <!-- Brand App Icon -->
      <div style="position: relative; margin-bottom: 20px;">
        <div style="position: absolute; inset: -8px; background: radial-gradient(circle, rgba(225,29,72,0.4) 0%, transparent 70%); filter: blur(14px); border-radius: 28px;"></div>
        <div style="position: relative; width: 88px; height: 88px; background: linear-gradient(135deg, #e11d48 0%, #be123c 100%); border-radius: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 16px 36px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(255, 255, 255, 0.2); overflow: hidden;">
          <img src="/logo-pwa.png" style="width: 100%; height: 100%; object-fit: cover;" alt="GoDelivery" />
        </div>
      </div>

      <!-- Title & Tagline -->
      <h1 style="font-family: var(--font-display, sans-serif); font-size: 2.1rem; font-weight: 950; color: #ffffff; margin: 0 0 8px 0; letter-spacing: -0.03em; line-height: 1.15;">
        GoDelivery
      </h1>
      
      <p style="color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 28px 0; max-width: 320px; font-weight: 500;">
        Tu comida, farmacia y mandados favoritos en la puerta de tu casa.
      </p>

      <!-- Minimal Benefit Rows -->
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; text-align: left;">
        <div style="display: flex; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); padding: 11px 14px; border-radius: 16px;">
          <div style="width: 30px; height: 30px; border-radius: 10px; background: rgba(225, 29, 72, 0.16); color: #fb7185; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">⚡</div>
          <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.35;">
            Descuentos y cupones exclusivos en la app
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); padding: 11px 14px; border-radius: 16px;">
          <div style="width: 30px; height: 30px; border-radius: 10px; background: rgba(59, 130, 246, 0.16); color: #60a5fa; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">🛵</div>
          <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.35;">
            Seguimiento de tu pedido en vivo por GPS
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); padding: 11px 14px; border-radius: 16px;">
          <div style="width: 30px; height: 30px; border-radius: 10px; background: rgba(16, 185, 129, 0.16); color: #34d399; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">🔔</div>
          <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.35;">
            Avisos instantáneos de cada estado de entrega
          </div>
        </div>
      </div>

    </div>

    <!-- Bottom Actions Area -->
    <div style="z-index: 1; max-width: 380px; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: auto;">
      
      <!-- Primary Store CTA -->
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
        ${isIos ? `
          <a href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer" id="btn-open-appstore" class="store-primary-cta" style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, #e11d48 0%, #be123c 100%); color: white; padding: 15px 18px; border-radius: 18px; text-decoration: none; box-shadow: 0 10px 28px rgba(225, 29, 72, 0.38); border: 1px solid rgba(255, 255, 255, 0.22); cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 38px; height: 38px; background: rgba(0,0,0,0.22); border-radius: 11px; display: flex; align-items: center; justify-content: center; color: white;">
                ${appleLogoSvg}
              </div>
              <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
                <span style="font-size: 10.5px; font-weight: 700; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.5px;">Disponible en el</span>
                <span style="font-size: 17px; font-weight: 950; letter-spacing: -0.3px;">App Store</span>
              </div>
            </div>
            <div style="background: #ffffff; color: #be123c; font-weight: 950; font-size: 12px; padding: 8px 15px; border-radius: 100px; box-shadow: 0 4px 12px rgba(0,0,0,0.18); display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              <span>OBTENER</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </a>
        ` : isAndroid ? `
          <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" id="btn-open-playstore" class="store-primary-cta" style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, #e11d48 0%, #be123c 100%); color: white; padding: 15px 18px; border-radius: 18px; text-decoration: none; box-shadow: 0 10px 28px rgba(225, 29, 72, 0.38); border: 1px solid rgba(255, 255, 255, 0.22); cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 38px; height: 38px; background: rgba(0,0,0,0.22); border-radius: 11px; display: flex; align-items: center; justify-content: center;">
                ${googlePlaySvg}
              </div>
              <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
                <span style="font-size: 10.5px; font-weight: 700; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.5px;">Disponible en</span>
                <span style="font-size: 17px; font-weight: 950; letter-spacing: -0.3px;">Google Play</span>
              </div>
            </div>
            <div style="background: #ffffff; color: #be123c; font-weight: 950; font-size: 12px; padding: 8px 15px; border-radius: 100px; box-shadow: 0 4px 12px rgba(0,0,0,0.18); display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              <span>INSTALAR</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </a>
        ` : `
          <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" class="store-primary-cta" style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, #e11d48 0%, #be123c 100%); color: white; padding: 14px 18px; border-radius: 18px; text-decoration: none; box-shadow: 0 10px 25px rgba(225, 29, 72, 0.4); border: 1px solid rgba(255, 255, 255, 0.25);">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 36px; height: 36px; background: rgba(0,0,0,0.25); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                ${googlePlaySvg}
              </div>
              <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
                <span style="font-size: 10px; font-weight: 700; opacity: 0.85; text-transform: uppercase;">Descargar en</span>
                <span style="font-size: 16px; font-weight: 950;">Google Play</span>
              </div>
            </div>
            <div style="background: #ffffff; color: #be123c; font-weight: 950; font-size: 11.5px; padding: 6px 14px; border-radius: 100px;">INSTALAR</div>
          </a>
          <a href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer" class="store-primary-cta" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.08); color: white; padding: 14px 18px; border-radius: 18px; text-decoration: none; border: 1.5px solid rgba(255, 255, 255, 0.2);">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 36px; height: 36px; background: rgba(255,255,255,0.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white;">
                ${appleLogoSvg}
              </div>
              <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
                <span style="font-size: 10px; font-weight: 700; opacity: 0.85; text-transform: uppercase;">Descargar en</span>
                <span style="font-size: 16px; font-weight: 950;">App Store</span>
              </div>
            </div>
            <div style="background: rgba(255,255,255,0.2); color: #ffffff; font-weight: 950; font-size: 11.5px; padding: 6px 14px; border-radius: 100px;">OBTENER</div>
          </a>
        `}
      </div>

      <!-- Minimalist Skip Web Link -->
      <button id="lock-skip-btn" class="skip-web-link" style="background: transparent; border: none; color: #64748b; font-weight: 600; font-size: 13px; padding: 8px 16px; cursor: pointer; transition: color 0.2s ease; text-decoration: underline; text-underline-offset: 4px;">
        Continuar en el navegador web
      </button>

    </div>
  `;

  // Listeners
  document.getElementById('lock-skip-btn')?.addEventListener('click', () => {
    sessionStorage.setItem('pwa_skipped', 'true');
    lockScreen.style.opacity = '0';
    lockScreen.style.transition = 'opacity 0.25s ease';
    setTimeout(() => {
      lockScreen.remove();
      window.dispatchEvent(new CustomEvent('pwa-lock-dismissed'));
    }, 250);
  });
}


