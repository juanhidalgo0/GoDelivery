// El cliente con un pedido en curso y los avisos apagados no se entera si el repartidor le escribe.
// Se lo decimos una vez por pedido: si todavía se puede, un toque y listo; si los bloqueó, un botón
// que abre los ajustes de GO! (donde el celular lo permite) y los pasos de su celular. Al volver de
// los ajustes se revisa solo.
import { showGoSheet, isAnySheetOpen } from './go-sheet.js';
import { getNativePushPermission, initPushNotifications, requestWebPushPermission } from '../utils/notifications.js';
import { goSharePlugin } from '../utils/share-receiver.js';
import { showToast } from './toast.js';

const KEY = 'gd_push_reminder_order';
const remembered = new Set();
const platform = () => (window.Capacitor?.getPlatform ? window.Capacitor.getPlatform() : 'web');
const isIOSWeb = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

async function currentPermission() {
  if (platform() !== 'web') return getNativePushPermission();
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

// Los pasos de ESTE celular; los nombres son los que se ven en sus menús
function steps() {
  if (platform() === 'ios') return ['Tocá <strong>Abrir ajustes</strong>', 'Entrá a <strong>Notificaciones</strong>', 'Activá <strong>Permitir notificaciones</strong>'];
  if (platform() === 'android') {
    return goSharePlugin()
      ? ['Tocá <strong>Abrir ajustes</strong>', 'Activá <strong>Mostrar notificaciones</strong>', 'Volvé a GO!']
      : ['Abrí <strong>Ajustes</strong> del celular', 'Entrá a <strong>Aplicaciones</strong> y buscá <strong>GO!</strong>', 'En <strong>Notificaciones</strong>, activalas'];
  }
  if (isIOSWeb()) return ['Abrí <strong>Ajustes</strong> del iPhone', 'Entrá a <strong>Notificaciones</strong> y buscá <strong>GO!</strong>', 'Activá <strong>Permitir notificaciones</strong>'];
  return ['Tocá el <strong>candado</strong> junto a la dirección', 'Entrá a <strong>Permisos</strong> o <strong>Notificaciones</strong>', 'Elegí <strong>Permitir</strong> y recargá la página'];
}

// true si pudo abrir los ajustes de GO! directamente
async function openSettings() {
  try {
    const plugin = goSharePlugin();
    if (plugin) { await plugin.openNotificationSettings(); return true; }
    if (platform() === 'ios') { window.location.href = 'app-settings:'; return true; }
  } catch (e) { /* quedan los pasos en pantalla */ }
  return false;
}
const canOpenSettings = () => platform() === 'ios' || Boolean(goSharePlugin());

// Al volver a la app con los avisos activados: se registra el celular para recibirlos
function watchReturn(close) {
  const check = async () => {
    if (document.visibilityState !== 'visible') return;
    if (await currentPermission() !== 'granted') return;
    document.removeEventListener('visibilitychange', check);
    close?.('primary');
    if (platform() !== 'web') await initPushNotifications();
    else await requestWebPushPermission();
    showToast('¡Listo! Te vamos a avisar de tu pedido.', 'success');
  };
  document.addEventListener('visibilitychange', check);
  setTimeout(() => document.removeEventListener('visibilitychange', check), 10 * 60 * 1000);
}

export async function remindPushForOrder(orderId, attempt = 0) {
  if (remembered.has(orderId)) return;
  try { if (localStorage.getItem(KEY) === orderId) return; } catch (e) { /* sin almacenamiento */ }
  const permission = await currentPermission();
  if (permission !== 'prompt' && permission !== 'denied') return;
  // Una conversación por vez: espera a que se cierre lo que esté abierto
  if (isAnySheetOpen()) {
    if (attempt < 10) setTimeout(() => remindPushForOrder(orderId, attempt + 1), 3000);
    return;
  }
  remembered.add(orderId);
  try { localStorage.setItem(KEY, orderId); } catch (e) { /* sin almacenamiento */ }

  const blocked = permission === 'denied';
  const bodyHtml = blocked
    ? `<p style="margin:0 0 10px;">Si el repartidor te escribe, no te vas a enterar.</p>
       <ol style="margin:0; padding-left:20px; list-style:decimal; line-height:1.4;">${steps().map(s => `<li style="display:list-item; margin-bottom:6px;">${s}</li>`).join('')}</ol>`
    : '<p style="margin:0;">Enterate cuando tu pedido sale, llega o el repartidor te escribe. Tocá <strong>Permitir</strong> en el cartel que aparece.</p>';

  showGoSheet({
    id: 'order-push-reminder',
    iconName: 'bell',
    eyebrow: 'Tu pedido',
    title: blocked ? 'Activá los avisos' : 'Tenés los avisos apagados',
    bodyHtml,
    primary: blocked
      ? (canOpenSettings()
        ? { label: 'Abrir ajustes', onClick: async ({ close }) => { watchReturn(close); await openSettings(); return false; } }
        : { label: 'Entendido', onClick: ({ close }) => { watchReturn(close); } })
      : {
        label: 'Activar avisos',
        onClick: async () => {
          if (platform() !== 'web') await initPushNotifications();
          else await requestWebPushPermission();
          if (await currentPermission() === 'granted') showToast('¡Listo! Te vamos a avisar de tu pedido.', 'success');
        },
      },
    secondary: { label: 'Ahora no' },
  });
  // La pantalla de seguimiento va por encima de las hojas comunes: sin esto queda tapada
  const sheet = document.getElementById('order-push-reminder');
  if (sheet) sheet.style.zIndex = '99999999';
}
