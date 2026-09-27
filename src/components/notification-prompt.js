import { requestWebPushPermission } from '../utils/notifications.js';
import { icon } from '../utils/icons.js';
import { showToast } from './toast.js';
import { showGoSheet, isAnySheetOpen } from './go-sheet.js';

const LAST_SHOWN_KEY = 'gd-notification-prompt-last-shown';
const EVERY_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Explains what the notifications are for before the browser asks, so the answer is an
 * informed "yes". At most once every 3 days, and it waits its turn behind other sheets.
 */
export function showNotificationPrompt(onAccept, attempt = 0) {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  if (document.getElementById('pwa-lock-screen') || document.getElementById('onboarding-container')) return;

  const lastShown = Number(localStorage.getItem(LAST_SHOWN_KEY) || 0);
  if (lastShown && Date.now() - lastShown < EVERY_MS) return;

  // One conversation at a time: wait for the welcome, the address, etc. (up to ~30 s).
  if (isAnySheetOpen()) {
    if (attempt < 15) setTimeout(() => showNotificationPrompt(onAccept, attempt + 1), 2000);
    return;
  }
  localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));

  showGoSheet({
    id: 'smart-notification-prompt',
    iconName: 'bell',
    eyebrow: 'Avisos',
    title: 'Enterate de cada paso',
    bodyHtml: `
      <ul class="go-bsheet-list">
        <li><span>${icon('check', 17)}</span><span><strong>Tu pedido, en vivo</strong><small>Cuando lo confirman, sale y llega a tu puerta.</small></span></li>
        <li><span>${icon('chat', 17)}</span><span><strong>Mensajes</strong><small>Si el repartidor o el comercio te escriben.</small></span></li>
        <li><span>${icon('ticket', 17)}</span><span><strong>Promos del día</strong><small>Pocas y solo cuando valen la pena.</small></span></li>
      </ul>`,
    primary: {
      label: 'Activar avisos',
      onClick: async () => {
        const permission = await requestWebPushPermission();
        if (permission === 'granted') {
          showToast('Listo, te vamos a avisar.', 'success');
          onAccept?.();
        }
      }
    },
    secondary: { label: 'Ahora no' },
  });
}

