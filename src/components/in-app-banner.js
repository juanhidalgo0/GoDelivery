// GoDelivery — banner for a push that arrives while the app is open.
// Looks like the system notification (logo, app name, title, body) instead of a "title: body"
// toast: slides down from the top, tap opens it, swipe up (or wait) dismisses it. One at a time;
// a newer one replaces the current one, and one with the same tag (same order) updates it in place.

let current = null; // { el, tag, timer }

const STYLE_ID = 'go-inapp-banner-style';
const CSS = `
.go-banner {
  position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 8px);
  width: min(440px, calc(100vw - 16px)); z-index: 16000000;
  transform: translate(-50%, calc(-100% - 24px)); opacity: 0;
  transition: transform .38s cubic-bezier(.2,.9,.25,1.1), opacity .25s ease;
  background: rgba(255,255,255,.97); backdrop-filter: saturate(180%) blur(22px); -webkit-backdrop-filter: saturate(180%) blur(22px);
  border: 1px solid rgba(15,23,42,.06); border-radius: 20px;
  box-shadow: 0 14px 40px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.06);
  padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start;
  font-family: var(--font-body, -apple-system, BlinkMacSystemFont, 'Inter', sans-serif);
  color: #0F172A; cursor: pointer; touch-action: pan-x; user-select: none; -webkit-user-select: none;
}
.go-banner.visible { transform: translate(-50%, 0); opacity: 1; }
.go-banner.dragging { transition: none; }
.go-banner-icon { width: 38px; height: 38px; border-radius: 10px; flex: 0 0 auto; object-fit: cover; background: #E11D48; }
.go-banner-main { min-width: 0; flex: 1; }
.go-banner-meta { display: flex; justify-content: space-between; font-size: 11.5px; font-weight: 600; color: #64748B; letter-spacing: .01em; margin-bottom: 2px; }
.go-banner-title { font-size: 14.5px; font-weight: 700; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.go-banner-body { font-size: 13.5px; line-height: 1.35; color: #334155; margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.go-banner-body b { font-weight: 800; color: #0F172A; letter-spacing: .04em; }
.go-banner-grip { position: absolute; left: 50%; bottom: 5px; width: 32px; height: 4px; margin-left: -16px; border-radius: 2px; background: rgba(15,23,42,.12); }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "Código de entrega: 4821" → the code in bold, so it can be read at a glance.
function formatBody(body) {
  return escapeHtml(body).replace(/(c[oó]digo[^:]*:\s*)(\w+)/i, '$1<b>$2</b>');
}

// Push URLs arrive absolute (https://…web.app/#/pedido/x); the app routes by hash.
export function hashFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('#')) return `#${url.split('#')[1]}`;
  if (url.startsWith('/')) return `#${url}`;
  return '';
}

function dismiss(animated = true) {
  if (!current) return;
  const { el, timer } = current;
  clearTimeout(timer);
  current = null;
  if (!animated) { el.remove(); return; }
  el.classList.remove('visible');
  setTimeout(() => el.remove(), 400);
}

/**
 * @param {{title: string, body?: string, url?: string, tag?: string, duration?: number}} n
 */
export function showInAppBanner({ title, body = '', url = '', tag = '', duration } = {}) {
  if (!title) return;
  ensureStyle();
  const ms = duration || (/c[oó]digo/i.test(`${title} ${body}`) ? 12000 : 5000);
  const target = hashFromUrl(url);

  // Same order/chat already showing: update the text instead of dropping a new card.
  if (current && tag && current.tag === tag) {
    current.el.querySelector('.go-banner-title').textContent = title;
    current.el.querySelector('.go-banner-body').innerHTML = formatBody(body);
    current.el.dataset.target = target;
    clearTimeout(current.timer);
    current.timer = setTimeout(() => dismiss(), ms);
    return;
  }
  dismiss(false);

  const el = document.createElement('div');
  el.className = 'go-banner';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.dataset.target = target;
  el.innerHTML = `
    <img class="go-banner-icon" src="/logo-pwa.png" alt="" draggable="false">
    <div class="go-banner-main">
      <div class="go-banner-meta"><span>GO! Delivery</span><span>ahora</span></div>
      <div class="go-banner-title">${escapeHtml(title)}</div>
      ${body ? `<div class="go-banner-body">${formatBody(body)}</div>` : ''}
    </div>
    <span class="go-banner-grip"></span>`;
  document.body.appendChild(el);

  // Swipe up to dismiss; a tap (no real movement) opens the notification.
  let startY = null;
  let dy = 0;
  let moved = 0;
  el.addEventListener('pointerdown', (e) => {
    startY = e.clientY; dy = 0; moved = 0;
    el.classList.add('dragging');
    clearTimeout(current?.timer);
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
  el.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    moved = Math.max(moved, Math.abs(e.clientY - startY));
    dy = Math.min(0, e.clientY - startY);
    el.style.transform = `translate(-50%, ${dy}px)`;
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    el.classList.remove('dragging');
    el.style.transform = '';
    if (dy < -30) { dismiss(); return; }
    if (moved < 8) {
      const hash = el.dataset.target;
      dismiss();
      if (hash) {
        if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else window.location.hash = hash;
      }
      return;
    }
    if (current?.el === el) current.timer = setTimeout(() => dismiss(), ms);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  current = { el, tag, timer: setTimeout(() => dismiss(), ms) };
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}
