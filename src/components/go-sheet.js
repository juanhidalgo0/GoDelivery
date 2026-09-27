// GO! bottom sheet for the moments that talk to the person: welcome, permissions, install,
// news. Same shape every time: ink hero with an icon in the ring-and-red-dot of the splash,
// title with the red bar, a short body and one clear action (plus an optional "later").
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape.js';

/**
 * @param {object} o
 * @param {string} [o.id]        Only one sheet per id at a time.
 * @param {string} [o.iconName]  Icon inside the ring.
 * @param {string} [o.eyebrow]
 * @param {string} o.title
 * @param {string} [o.bodyHtml]  Trusted markup built by the caller.
 * @param {{label: string, onClick?: Function}} [o.primary]  Return false from onClick to keep it open.
 * @param {{label: string, onClick?: Function}} [o.secondary]
 * @param {boolean} [o.dismissible=true]  Backdrop, ✕, drag down and back close it.
 * @param {Function} [o.onClose]  Called once with the reason: 'primary' | 'secondary' | 'dismiss'.
 */
export function showGoSheet({ id = '', iconName = 'sparkles', eyebrow = '', title = '', bodyHtml = '', primary = null, secondary = null, dismissible = true, onClose = null } = {}) {
  if (id && document.getElementById(id)) return null;

  const sheet = document.createElement('div');
  sheet.className = 'go-bsheet';
  if (id) sheet.id = id;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `
    <div class="go-bsheet-backdrop" ${dismissible ? 'data-sheet-close' : ''}></div>
    <div class="go-bsheet-card">
      <div class="go-bsheet-hero">
        <span class="go-bsheet-handle" aria-hidden="true"></span>
        ${dismissible ? `<button type="button" class="go-bsheet-x" data-sheet-close aria-label="Cerrar">${icon('close', 16)}</button>` : ''}
        <span class="go-bsheet-ring" aria-hidden="true">${icon(iconName, 30)}<i></i></span>
        ${eyebrow ? `<span class="go-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
        <h2 class="go-title">${escapeHtml(title)}</h2>
        <span class="go-bar"></span>
      </div>
      ${bodyHtml ? `<div class="go-bsheet-body">${bodyHtml}</div>` : ''}
      <div class="go-bsheet-actions">
        ${primary ? `<button type="button" class="go-bsheet-cta" data-sheet-primary>${escapeHtml(primary.label)}</button>` : ''}
        ${secondary ? `<button type="button" class="go-bsheet-later" data-sheet-secondary>${escapeHtml(secondary.label)}</button>` : ''}
      </div>
    </div>`;
  // Rise after the splash is gone, so the entrance is actually seen.
  const mount = () => {
    if (document.getElementById('splash-screen')) { setTimeout(mount, 120); return; }
    document.body.appendChild(sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
  };
  mount();

  let closed = false;
  const stateKey = id || `go-sheet-${Date.now()}`;
  const onPop = () => {
    if (dismissible) close('dismiss', true);
    else window.history.pushState({ goSheet: stateKey }, ''); // can't be backed out of
  };
  window.history.pushState({ goSheet: stateKey }, '');
  window.addEventListener('popstate', onPop);

  function close(reason = 'dismiss', fromPop = false) {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPop);
    sheet.classList.remove('is-open');
    sheet.classList.add('is-closing');
    setTimeout(() => sheet.remove(), 260);
    if (!fromPop && window.history.state && window.history.state.goSheet === stateKey) window.history.back();
    try { onClose?.(reason); } catch (e) { console.error(e); }
  }

  sheet.querySelectorAll('[data-sheet-close]').forEach(el => el.addEventListener('click', () => close('dismiss')));
  sheet.querySelector('[data-sheet-primary]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    let keepOpen = false;
    try { keepOpen = (await primary.onClick?.({ close, sheet })) === false; } catch (err) { console.error(err); }
    btn.disabled = false;
    if (!keepOpen) close('primary');
  });
  sheet.querySelector('[data-sheet-secondary]')?.addEventListener('click', async () => {
    try { await secondary.onClick?.({ close, sheet }); } catch (err) { console.error(err); }
    close('secondary');
  });

  if (dismissible) {
    const card = sheet.querySelector('.go-bsheet-card');
    let startY = null;
    let dy = 0;
    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, a, input, textarea, select') || card.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      dy = 0;
      card.style.transition = 'none';
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      card.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    card.addEventListener('touchend', () => {
      if (startY === null) return;
      startY = null;
      card.style.transition = '';
      card.style.transform = '';
      if (dy > 90) close('dismiss');
    });
  }

  return { el: sheet, close };
}

/** True while any sheet, modal or first-run overlay is on screen: one conversation at a time. */
export function isAnySheetOpen() {
  return !!document.querySelector('.go-bsheet, .go-promo-sheet, .modal-overlay, #onboarding-container, #app-guide-overlay, #splash-screen, #login-wall');
}
