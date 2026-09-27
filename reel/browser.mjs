// Navegador compartido para el reel: iPhone 15 Pro (393x852 @3x; 54pt de status bar los agrega el video) con la sesión del perfil .profile.
import { chromium, devices } from 'playwright';
export const VIEWPORT = { width: 393, height: 798 };
// El screencast de Chrome entrega cuadros en píxeles de ventana, ignorando deviceScaleFactor.
// Para capturar en Retina, la ventana mide 3x y el meta viewport de la app fija el ancho en 393:
// el navegador escala la página x3 (como un celular real) y dibuja todo nítido.
export const ZOOM = 3;
export const APP = 'https://godelivery-magdalena.web.app';

// Lo que un cliente común no ve: la cuenta del reel también es admin/repartidor.
const CLIENT_ONLY_CSS = `
  #floating-driver-mode-pill,
  .nav-item[href="#/mi-comercio"],
  .nav-item[href="#/delivery"] { display: none !important; }
  /* El panel del bot vive fuera de pantalla y su sombra asoma por el borde derecho. */
  #support-bot-window-panel { box-shadow: none !important; }
`;

// Zona horaria que la app usa para "hora de Argentina". Con fakeArgTz, solo esa cuenta (horarios de
// los locales) usa otra zona: sirve para grabar un local abierto fuera de horario. No toca Date.now.
export async function launch({ headless = true, fakeArgTz = process.env.REEL_FAKE_TZ } = {}) {
  const ctx = await chromium.launchPersistentContext('.profile', {
    channel: 'chrome', headless, ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: VIEWPORT.width * ZOOM, height: VIEWPORT.height * ZOOM }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: devices['iPhone 15 Pro'].userAgent, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
    colorScheme: 'light',
    geolocation: { latitude: -35.0806, longitude: -57.5176 }, permissions: ['geolocation', 'notifications'],
  });
  // Saltea "instalá la app" y el onboarding, y fuerza modo cliente.
  await ctx.addInitScript((css) => {
    try {
      sessionStorage.setItem('pwa_skipped', 'true');
      sessionStorage.setItem('gd_temp_client_mode', 'true');
      localStorage.setItem('gd-onboarding-done', 'true');
      localStorage.setItem('welcome_beta_v1', 'true');
    } catch {}
    const inject = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    const VP = 'width=393, initial-scale=3, maximum-scale=3, minimum-scale=3, user-scalable=no, viewport-fit=cover';
    const fixViewport = () => document.querySelectorAll('meta[name="viewport"]').forEach(m => { if (m.content !== VP) m.content = VP; });
    new MutationObserver(fixViewport).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
    if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject);

    // Privacidad: las direcciones reales se muestran como "Mi casa" (solo en pantalla; el pedido usa la real).
    const ADDR = /(Ituzaing.{1,2} 1190|Jos.{1,2} Mar.{1,2}a Miguens( 494)?)(,\s?Magdalena)?/gi; // .{1,2}: acentos NFC o NFD
    const scrub = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (ADDR.test(n.nodeValue)) { ADDR.lastIndex = 0; n.nodeValue = n.nodeValue.replace(ADDR, 'Mi casa'); }
        ADDR.lastIndex = 0;
      }
      root.querySelectorAll?.('input, textarea').forEach(i => {
        if (i.placeholder && ADDR.test(i.placeholder)) i.placeholder = i.placeholder.replace(ADDR, 'Mi casa');
        ADDR.lastIndex = 0;
      });
    };
    new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'characterData') { if (ADDR.test(m.target.nodeValue)) { ADDR.lastIndex = 0; m.target.nodeValue = m.target.nodeValue.replace(ADDR, 'Mi casa'); } ADDR.lastIndex = 0; }
      else m.addedNodes.forEach(n => n.nodeType === 3 ? scrub(n.parentNode || document.body) : n.nodeType === 1 && scrub(n));
    })).observe(document, { childList: true, subtree: true, characterData: true });
  }, CLIENT_ONLY_CSS);
  if (fakeArgTz) {
    await ctx.addInitScript((tz) => {
      const Orig = Intl.DateTimeFormat;
      const Fake = function (locales, options) {
        if (options && options.timeZone === 'America/Argentina/Buenos_Aires') options = { ...options, timeZone: tz };
        return new Orig(locales, options);
      };
      Fake.prototype = Orig.prototype;
      Fake.supportedLocalesOf = Orig.supportedLocalesOf;
      Intl.DateTimeFormat = Fake;
    }, fakeArgTz);
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  return { ctx, page };
}
