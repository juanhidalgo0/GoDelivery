// Volver al mismo lugar cuando el sistema cierra la app en segundo plano.
//
// Android (y a veces iPhone) cierra la app por memoria mientras estás en otra: al volver arrancaba
// de cero en el inicio (Admin → Reinicios: "el sistema la cerró en segundo plano"). Como hacen las
// apps grandes, cada vez que la app pasa a segundo plano se anota la pantalla y hasta dónde habías
// bajado, y al arrancar de nuevo dentro de los 30 minutos se vuelve ahí.

const KEY = 'gd_resume_place';
const MAX_AGE_MS = 30 * 60 * 1000;
// Pantallas a las que no tiene sentido volver solas (acciones de un solo uso, salidas de la app)
const SKIP = [/takeOrderId=/, /^#\/sorteo/, /^#\/mp-connect/, /preview=true/];

const isHome = (hash) => !hash || hash === '#' || hash === '#/';

function scrollers() {
  const panel = document.querySelector('.slide-panel.active');
  const overlay = document.getElementById('app-overlay');
  // Es position: fixed (offsetParent siempre da null): se mira si tiene contenido y se ve
  const overlayOpen = overlay && overlay.childElementCount > 0 && getComputedStyle(overlay).display !== 'none' && overlay.getBoundingClientRect().width > 0;
  return { panel, overlay: overlayOpen ? overlay : null };
}

function save() {
  try {
    const route = location.hash || '#/';
    const { panel, overlay } = scrollers();
    localStorage.setItem(KEY, JSON.stringify({
      at: Date.now(),
      route,
      panelId: panel?.id || '',
      panelTop: Math.round(panel?.scrollTop || 0),
      overlayTop: Math.round(overlay?.scrollTop || 0),
    }));
  } catch (e) { /* sin almacenamiento */ }
}

/** Pone la altura de scroll cuando la pantalla ya tiene contenido (la tienda tarda en dibujarse). */
function restoreScroll(place) {
  const deadline = Date.now() + 4000;
  let panelDone = !place.panelTop;
  let overlayDone = !place.overlayTop;
  const tryNow = () => {
    const { panel, overlay } = scrollers();
    if (!panelDone && panel && panel.id === place.panelId && panel.scrollHeight - panel.clientHeight >= place.panelTop - 10) {
      panel.scrollTop = place.panelTop;
      panelDone = true;
    }
    if (!overlayDone && overlay && overlay.scrollHeight - overlay.clientHeight >= place.overlayTop - 10) {
      overlay.scrollTop = place.overlayTop;
      overlayDone = true;
    }
    if ((!panelDone || !overlayDone) && Date.now() < deadline) setTimeout(tryNow, 120);
  };
  setTimeout(tryNow, 150);
}

/**
 * Llamar al principio de main.js, antes de que arranque el router y antes de initReloadLog
 * (que borra la marca de "salió a otra página").
 */
export function initResumePlace() {
  if (typeof window === 'undefined') return;
  let place = null;
  try { place = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { place = null; }

  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || 'navigate';
  let left = null;
  try { left = JSON.parse(localStorage.getItem('gd_left_page') || 'null'); } catch (e) { left = null; }
  const leftOnPurpose = nav === 'reload' || nav === 'back_forward' || (left && Date.now() - left.at < 2 * 60 * 1000);

  if (place && Date.now() - place.at < MAX_AGE_MS && !leftOnPurpose && !SKIP.some((re) => re.test(place.route))) {
    // Solo si arrancó en el inicio: un enlace o una notificación que abre otra pantalla manda
    if (isHome(location.hash)) {
      // El inicio queda debajo en el historial: "atrás" vuelve ahí en vez de no hacer nada
      if (!isHome(place.route)) history.pushState(history.state, '', place.route);
      restoreScroll(place);
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('pagehide', save);
}
