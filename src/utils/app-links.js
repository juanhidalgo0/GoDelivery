// Links de GO! que abren la app (WhatsApp, el bot, mensajes) y el toque en un aviso de chat de
// Android (ChatReply.java), que llega por el mismo camino. Las pantallas van después del #, así
// que alcanza con pasar el hash: https://godelivery-magdalena.web.app/#/tienda/x → #/tienda/x
// Del lado nativo: public/.well-known/, AndroidManifest.xml y App.entitlements.
import { Capacitor } from '@capacitor/core';

const HOSTS = new Set(['godelivery-magdalena.web.app', 'godelivery-magdalena.firebaseapp.com']);
const LAUNCH_KEY = 'gd_launch_link_done';

/** El hash a abrir, o null si el link no es de una pantalla de la app. */
export function hashFromAppLink(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.hash && u.hash.length > 1 ? u.hash : '#/';
}

function open(url) {
  const hash = hashFromAppLink(url);
  if (!hash || hash === window.location.hash) return;
  window.location.hash = hash;
}

export function initAppLinks() {
  if (!Capacitor.isNativePlatform()) return;
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appUrlOpen', ({ url }) => open(url));
    // Abierta en frío desde un link. Una vez por link: si la app se recarga, el link sigue siendo
    // el de arranque y volvería a llevar ahí.
    App.getLaunchUrl().then((res) => {
      const url = res?.url;
      if (!url) return;
      try {
        if (sessionStorage.getItem(LAUNCH_KEY) === url) return;
        sessionStorage.setItem(LAUNCH_KEY, url);
      } catch (e) { /* sin sessionStorage igual se abre */ }
      open(url);
    }).catch(() => {});
  }).catch(() => {});
}
