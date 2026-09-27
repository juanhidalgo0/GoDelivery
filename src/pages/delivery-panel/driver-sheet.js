// Shared bottom-sheet shell for the driver dock's quick actions (Auto-aceptar, Soporte,
// Ayuda, SOS). Keeps every sheet on the same visual language as the dock card: dark
// panel, 24px top radius, drag handle, tinted icon tile + title, round close button.
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';

const TONES = {
  red:   { fg: '#f87171', fgLight: '#dc2626', bg: 'rgba(239,68,68,0.14)',  bgLight: '#fee2e2' },
  rose:  { fg: '#fb7185', fgLight: '#e11d48', bg: 'rgba(225,29,72,0.14)',  bgLight: '#ffe4e6' },
  green: { fg: '#4ade80', fgLight: '#16a34a', bg: 'rgba(34,197,94,0.14)',  bgLight: '#dcfce7' },
  sky:   { fg: '#38bdf8', fgLight: '#0284c7', bg: 'rgba(56,189,248,0.14)', bgLight: '#e0f2fe' },
  amber: { fg: '#fbbf24', fgLight: '#d97706', bg: 'rgba(245,158,11,0.14)', bgLight: '#fef3c7' },
  slate: { fg: '#cbd5e1', fgLight: '#475569', bg: 'rgba(255,255,255,0.08)', bgLight: '#f1f5f9' },
};

export function sheetTone(name) {
  const isLight = getDriverMapTheme() === 'light';
  const t = TONES[name] || TONES.slate;
  return { fg: isLight ? t.fgLight : t.fg, bg: isLight ? t.bgLight : t.bg };
}

export function ensureSheetStyles() {
  if (document.getElementById('driver-sheet-styles')) return;
  const style = document.createElement('style');
  style.id = 'driver-sheet-styles';
  style.textContent = `
    .dsheet-row {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 12px; border-radius: 16px; box-sizing: border-box;
      background: var(--driver-fill-faint); border: 1px solid var(--driver-border);
      color: var(--driver-text-primary); text-decoration: none; text-align: left;
      font-family: inherit; cursor: pointer;
      transition: background 0.15s ease, transform 0.12s ease;
    }
    .dsheet-row:active { transform: scale(0.985); background: var(--driver-fill-subtle); }
    .dsheet-tile {
      width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .dsheet-row-title { font-size: 14px; font-weight: 800; line-height: 1.25; }
    .dsheet-row-sub { font-size: 12px; font-weight: 500; color: var(--driver-text-secondary); margin-top: 2px; line-height: 1.35; }
    .dsheet-chev { margin-left: auto; color: var(--driver-text-secondary); display: flex; flex-shrink: 0; }
    .dsheet-label {
      font-size: 11px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase;
      color: var(--driver-text-secondary); margin: 6px 2px 0;
    }
    .dsheet-btn {
      height: 50px; border-radius: 16px; border: none; font-family: inherit;
      font-size: 14.5px; font-weight: 800; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: transform 0.12s ease, opacity 0.15s ease;
    }
    .dsheet-btn:active { transform: scale(0.98); }
    .dsheet-btn-ghost { background: var(--driver-fill-subtle); color: var(--driver-text-primary); border: 1px solid var(--driver-border); }
    .dsheet-faq { background: var(--driver-fill-faint); border: 1px solid var(--driver-border); border-radius: 16px; overflow: hidden; }
    .dsheet-faq summary {
      list-style: none; display: flex; align-items: center; gap: 10px; padding: 14px;
      font-size: 13.5px; font-weight: 700; color: var(--driver-text-primary); cursor: pointer;
    }
    .dsheet-faq summary::-webkit-details-marker { display: none; }
    .dsheet-faq summary .dsheet-chev { transition: transform 0.2s ease; }
    .dsheet-faq[open] summary .dsheet-chev { transform: rotate(90deg); }
    .dsheet-faq-body { padding: 0 14px 14px 44px; font-size: 13px; line-height: 1.5; color: var(--driver-text-secondary); }
    .dsheet-faq-body strong { color: var(--driver-text-primary); }
  `;
  document.head.appendChild(style);
}

/** Tappable list row: tinted icon tile + title/subtitle + trailing chevron (or custom node). */
export function sheetRow({ id = '', tag = 'button', href = '', iconName, tone = 'slate', title, subtitle = '', trailing, attrs = '' }) {
  const t = sheetTone(tone);
  const idAttr = id ? `id="${id}"` : '';
  const open = tag === 'a'
    ? `<a ${idAttr} class="dsheet-row" href="${href}" ${attrs}>`
    : `<button type="button" ${idAttr} class="dsheet-row" ${attrs}>`;
  return `${open}
    <div class="dsheet-tile" style="background:${t.bg}; color:${t.fg};">${icon(iconName, 20)}</div>
    <div style="min-width:0; flex:1;">
      <div class="dsheet-row-title">${title}</div>
      ${subtitle ? `<div class="dsheet-row-sub">${subtitle}</div>` : ''}
    </div>
    ${trailing !== undefined ? trailing : `<span class="dsheet-chev">${icon('chevronRight', 18)}</span>`}
  </${tag === 'a' ? 'a' : 'button'}>`;
}

/**
 * Opens a bottom sheet and returns { sheet, body, close }.
 * `body` is an HTML string; wire listeners with sheet.querySelector afterwards.
 */
export function openDriverSheet({ id, iconName, tone = 'slate', title, subtitle = '', body = '', onClose }) {
  ensureSheetStyles();
  const isLight = getDriverMapTheme() === 'light';
  document.getElementById(id)?.remove();

  const t = sheetTone(tone);
  const backdrop = document.createElement('div');
  backdrop.id = id;
  backdrop.style.cssText = `
    position: fixed; inset: 0; z-index: 100005;
    background: rgba(2, 6, 15, ${isLight ? '0.4' : '0.6'});
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    display: flex; flex-direction: column; justify-content: flex-end;
    opacity: 0; transition: opacity 0.25s ease;
  `;

  const sheet = document.createElement('div');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  sheet.style.cssText = `
    width: 100%; max-width: 520px; margin: 0 auto; box-sizing: border-box;
    background: ${isLight ? '#ffffff' : '#111722'};
    border: 1px solid var(--driver-border); border-bottom: none;
    border-radius: 24px 24px 0 0;
    padding: 10px 16px max(20px, calc(12px + max(var(--safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px))));
    box-shadow: 0 -12px 40px rgba(0,0,0,${isLight ? '0.12' : '0.5'});
    color: var(--driver-text-primary); font-family: var(--font-body, sans-serif);
    max-height: 88vh; max-height: 88dvh; display: flex; flex-direction: column;
    transform: translateY(100%); transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  sheet.innerHTML = `
    <div data-sheet-handle style="padding: 4px 0 12px; cursor: grab; flex-shrink:0;">
      <div style="width: 40px; height: 4px; border-radius: 2px; background: var(--driver-border-strong); margin: 0 auto;"></div>
    </div>
    <div style="display:flex; align-items:center; gap:12px; padding: 0 2px 14px; flex-shrink:0;">
      <div class="dsheet-tile" style="width:44px; height:44px; background:${t.bg}; color:${t.fg};">${icon(iconName, 22)}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-family: var(--font-display, sans-serif); font-size: 18px; font-weight: 800; line-height:1.2;">${title}</div>
        ${subtitle ? `<div style="font-size: 12.5px; color: var(--driver-text-secondary); margin-top: 2px;">${subtitle}</div>` : ''}
      </div>
      <button type="button" data-sheet-close aria-label="Cerrar" style="
        width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
        background: var(--driver-fill-subtle); border: 1px solid var(--driver-border);
        color: var(--driver-text-secondary); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      ">${icon('close', 16)}</button>
    </div>
    <div data-sheet-body style="overflow-y: auto; -webkit-overflow-scrolling: touch; display:flex; flex-direction:column; gap:8px; padding: 0 2px 2px;">
      ${body}
    </div>
  `;

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });

  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => backdrop.remove(), 280);
    onClose?.();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  sheet.querySelector('[data-sheet-close]').onclick = close;

  // Swipe down on the handle/header to dismiss.
  const handle = sheet.querySelector('[data-sheet-handle]');
  let startY = null;
  handle.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    sheet.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
    if (dy > 80) close(); else sheet.style.transform = 'translateY(0)';
  });
  handle.addEventListener('click', close);

  return { sheet, body: sheet.querySelector('[data-sheet-body]'), close };
}
