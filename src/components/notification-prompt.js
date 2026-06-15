import { icon } from '../utils/icons.js';

/**
 * Smart Notification Prompt
 * Shows a beautiful banner to explain the value of notifications before requesting permission.
 */
export function showNotificationPrompt(onAccept) {
  if (Notification.permission !== 'default') return;

  // 1. If not running in standalone PWA mode, request permission directly using the native prompt
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (!isStandalone) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted' && onAccept) {
        onAccept();
      }
    });
    return;
  }

  // 3. Don't show if the install lock or onboarding is active
  if (document.getElementById('pwa-install-lock') || document.getElementById('onboarding-container')) return;

  // 2. Periodic Display: Show only once every 3 days
  const lastShown = localStorage.getItem('gd-notification-prompt-last-shown');
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;

  if (lastShown && (now - parseInt(lastShown)) < threeDays) return;
  localStorage.setItem('gd-notification-prompt-last-shown', now.toString());

  const prompt = document.createElement('div');
  prompt.id = 'smart-notification-prompt';
  prompt.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translate(-50%, 100%);
    width: min(400px, 92vw);
    background: var(--color-surface);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--color-border-light);
    border-radius: 24px;
    padding: 20px;
    z-index: 10000;
    box-shadow: 0 20px 50px rgba(0,0,0,0.3);
    transition: all 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    display: flex;
    flex-direction: column;
    gap: 16px;
    opacity: 0;
  `;

  prompt.innerHTML = `
    <div style="display:flex; gap:16px; align-items:center;">
      <div style="width:48px; height:48px; background:linear-gradient(135deg, var(--color-primary), #991b1b); border-radius:14px; display:flex; align-items:center; justify-content:center; color:white; flex-shrink:0; box-shadow: 0 8px 16px rgba(var(--color-primary-rgb), 0.2);">
        ${icon('bell', 24)}
      </div>
      <div style="flex:1;">
        <h4 style="margin:0; font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text);">Activar Notificaciones</h4>
        <p style="margin:2px 0 0; font-size:13px; color:var(--color-text-tertiary); font-weight:500; line-height:1.4;">Recibí alertas en tiempo real de tus pedidos y mensajes de chat.</p>
      </div>
    </div>
    <div style="display:flex; gap:10px;">
      <button id="n-prompt-later" style="flex:1; height:44px; border-radius:12px; border:1.5px solid var(--color-border-light); background:transparent; color:var(--color-text-secondary); font-size:13px; font-weight:800; cursor:pointer;">Más tarde</button>
      <button id="n-prompt-ok" style="flex:1.5; height:44px; border-radius:12px; border:none; background:var(--color-primary); color:white; font-size:13px; font-weight:900; cursor:pointer; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.2);">Activar ahora</button>
    </div>
  `;

  document.body.appendChild(prompt);

  // Animate in
  setTimeout(() => {
    prompt.style.transform = 'translate(-50%, 0)';
    prompt.style.opacity = '1';
  }, 1000);

  const close = () => {
    prompt.style.transform = 'translate(-50%, 100%)';
    prompt.style.opacity = '0';
    setTimeout(() => prompt.remove(), 600);
  };

  document.getElementById('n-prompt-later').onclick = close;
  document.getElementById('n-prompt-ok').onclick = async () => {
    close();
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && onAccept) {
      onAccept();
    }
  };
}
