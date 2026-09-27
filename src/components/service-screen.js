// GO! service screens (Mandados, Viajes, Market, Ofertas): one shape for all four.
// They rise from the bottom over the home, share the same header and close the same way:
// the ⌄ button, Android back, or dragging the header down.
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape.js';

export const SERVICE_ROUTES = {
  '/mandados': { eyebrow: 'Te lo buscamos y te lo llevamos', title: 'Mandados' },
  '/gofavores': { eyebrow: 'Te lo buscamos y te lo llevamos', title: 'Mandados' },
  '/viajes': { eyebrow: 'Elegí tu destino y viajá seguro', title: 'Viajes' },
  '/marketplace': { eyebrow: 'Compra y venta entre vecinos', title: 'Market' },
  '/offers': { eyebrow: 'Promociones de hoy', title: 'Ofertas' },
};

export function isServiceRoute(path) {
  return Object.prototype.hasOwnProperty.call(SERVICE_ROUTES, path);
}

/**
 * Shared header. `leftId` lets a screen take over the left button (Mandados turns it
 * into "back to the list" while a form is open); without it the button closes the screen.
 */
export function goServiceHeader({ eyebrow = '', title = '', infoId = '', infoLabel = 'Cómo funciona', leftId = '', actionsHtml = '' } = {}) {
  return `
    <header class="go-service-header go-page-header" data-service-header>
      <span class="go-service-grabber" aria-hidden="true"></span>
      <div class="go-service-row">
        <button type="button" class="go-icon-btn go-service-left" ${leftId ? `id="${leftId}"` : 'data-service-close'} aria-label="Cerrar">${icon('chevronDown', 20)}</button>
        <div class="go-service-titles">
          <span class="go-eyebrow go-service-eyebrow">${escapeHtml(eyebrow)}</span>
          <h1 class="go-title go-service-title">${escapeHtml(title)}</h1>
          <span class="go-bar go-service-bar"></span>
        </div>
        <div class="go-service-actions">
          ${actionsHtml}
          ${infoId ? `<button type="button" id="${infoId}" class="go-icon-btn" aria-label="${escapeHtml(infoLabel)}">${icon('info', 18)}</button>` : ''}
        </div>
      </div>
    </header>`;
}

/** Discreet "first time?" line that replaces the info sheets that used to pop up on entry. */
export function goServiceHint({ id, storageKey, text = '¿Primera vez? Mirá cómo funciona', style = '' }) {
  let seen = false;
  try { seen = localStorage.getItem(storageKey) === 'true'; } catch (e) {}
  if (seen) return '';
  return `
    <div class="go-service-hint" id="${id}" data-storage-key="${escapeHtml(storageKey)}"${style ? ` style="${style}"` : ''}>
      <button type="button" class="go-service-hint-open">
        <span class="go-service-hint-dot" aria-hidden="true"></span>
        <span>${escapeHtml(text)}</span>
        <span style="display:flex; color: var(--go-red);">${icon('chevronRight', 16)}</span>
      </button>
      <button type="button" class="go-service-hint-close" aria-label="No mostrar más">${icon('close', 14)}</button>
    </div>`;
}

/** Wires a hint: opening it shows the info, and either button hides it for good. */
export function bindServiceHint(id, onOpen) {
  const el = document.getElementById(id);
  if (!el) return;
  const forget = () => {
    try { localStorage.setItem(el.dataset.storageKey, 'true'); } catch (e) {}
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('.go-service-hint-open')?.addEventListener('click', () => { forget(); onOpen?.(); });
  el.querySelector('.go-service-hint-close')?.addEventListener('click', forget);
}

/** Centered empty/blocked state (not logged in, nothing to show) inside a service screen. */
export function goServiceEmpty({ iconName = 'info', title = '', text = '', ctaLabel = '', ctaHref = '' } = {}) {
  return `
    <div class="go-service-empty">
      <span class="go-service-empty-icon">${icon(iconName, 28)}</span>
      <h2 class="go-title" style="font-size: 22px;">${escapeHtml(title)}</h2>
      <span class="go-bar" style="margin: 10px auto 0;"></span>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
      ${ctaLabel ? `<a class="go-service-empty-cta" href="${escapeHtml(ctaHref)}">${escapeHtml(ctaLabel)}</a>` : ''}
    </div>`;
}

/** Painted the moment the screen starts rising, so it never slides up blank. */
export function serviceSkeleton(path) {
  const meta = SERVICE_ROUTES[path] || { eyebrow: '', title: '' };
  return `
    <div class="go-service-page">
      ${goServiceHeader(meta)}
      <div class="go-service-skeleton" aria-hidden="true">
        <span style="height: 48px;"></span>
        <span style="height: 88px;"></span>
        <span style="height: 88px;"></span>
        <span style="height: 88px; opacity: 0.6;"></span>
      </div>
    </div>`;
}

export function closeServiceScreen() {
  window.location.hash = '#/';
}

let gesturesReady = false;

/** Close button + drag-down-to-close on the header, delegated once for every service screen. */
export function initServiceScreens() {
  if (gesturesReady || typeof document === 'undefined') return;
  gesturesReady = true;

  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-service-close]')) {
      e.preventDefault();
      closeServiceScreen();
    }
  });

  let drag = null;
  const overlayOf = (el) => el?.closest?.('#app-overlay.is-service');

  document.addEventListener('touchstart', (e) => {
    const header = e.target.closest?.('[data-service-header]');
    if (!header || e.target.closest('button, a, input, textarea, select')) return;
    const overlay = overlayOf(header);
    if (!overlay || e.touches.length !== 1) return;
    drag = { overlay, startY: e.touches[0].clientY, startT: performance.now(), dy: 0, active: false };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const dy = e.touches[0].clientY - drag.startY;
    if (!drag.active) {
      if (dy < 6) return;
      drag.active = true;
      // The entrance animation fills forwards and would win over the inline transform.
      drag.overlay.style.animation = 'none';
      drag.overlay.style.transition = 'none';
    }
    drag.dy = Math.max(0, dy);
    drag.overlay.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: true });

  const endDrag = () => {
    if (!drag) return;
    const { overlay, dy, startT, active } = drag;
    drag = null;
    if (!active) return;
    const velocity = dy / Math.max(1, performance.now() - startT);
    if (dy > 120 || (dy > 40 && velocity > 0.6)) {
      overlay.style.transition = 'transform 0.22s cubic-bezier(0.4, 0, 1, 1)';
      overlay.style.transform = 'translateY(100%)';
      setTimeout(() => {
        overlay.dataset.dismissed = '1';
        closeServiceScreen();
      }, 200);
    } else {
      overlay.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';
      overlay.style.transform = 'translateY(0)';
    }
  };
  document.addEventListener('touchend', endDrag, { passive: true });
  document.addEventListener('touchcancel', endDrag, { passive: true });
}

/**
 * "Cómo funciona" sheet shared by every service: numbered steps plus optional notes
 * (limits, fees). One look for Mandados, Viajes, Market and each Mandados option.
 */
export async function showGoInfoSheet({ eyebrow = 'Cómo funciona', title = '', intro = '', steps = [], notesTitle = '', notes = [], ctaLabel = 'Entendido' } = {}) {
  const { showModal, closeModal } = await import('./modal.js');
  const el = document.createElement('div');
  el.className = 'go-info-sheet';
  el.innerHTML = `
    <div class="go-sheet-header">
      <div class="go-sheet-titles">
        <span class="go-eyebrow">${escapeHtml(eyebrow)}</span>
        <h3 class="go-title">${escapeHtml(title)}</h3>
      </div>
      <button type="button" class="go-icon-btn" data-info-close aria-label="Cerrar">${icon('close', 18)}</button>
    </div>
    <div class="go-info-body">
      ${intro ? `<p class="go-info-intro">${escapeHtml(intro)}</p>` : ''}
      ${steps.length ? `<ol class="go-info-steps">
        ${steps.map((s, i) => `
          <li>
            <span class="go-info-num">${i + 1}</span>
            <span class="go-info-step"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.text)}</span></span>
          </li>`).join('')}
      </ol>` : ''}
      ${notes.length ? `
        <div class="go-info-notes">
          ${notesTitle ? `<span class="go-eyebrow">${escapeHtml(notesTitle)}</span>` : ''}
          <ul>
            ${notes.map(n => `<li><strong>${escapeHtml(n.title)}</strong> ${escapeHtml(n.text)}</li>`).join('')}
          </ul>
        </div>` : ''}
    </div>
    <div class="go-info-foot">
      <button type="button" class="go-info-cta" data-info-close>${escapeHtml(ctaLabel)}</button>
    </div>`;
  showModal({ title: '', hideHeader: true, height: 'auto', content: el });
  el.querySelectorAll('[data-info-close]').forEach(b => b.addEventListener('click', () => closeModal()));
}
