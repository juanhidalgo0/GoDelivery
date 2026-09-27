// Small GO! brand building blocks shared by the client screens.
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/escape.js';

/** Section header: tracked eyebrow, heavy uppercase title and the red bar, with an optional link. */
export function goSectionHead({ eyebrow = '', title, href = '', linkLabel = 'Ver todos', note = '', top = 28 } = {}) {
  return `
    <div class="go-section-head" style="margin-top: ${top}px;">
      <div style="min-width: 0;">
        ${eyebrow ? `<span class="go-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
        <h2 class="go-title" style="font-size: 22px; margin-top: ${eyebrow ? 6 : 0}px;">${escapeHtml(title)}</h2>
        <span class="go-bar" style="margin-top: 8px;"></span>
        ${note ? `<span style="display:block; font-size: 13px; color: var(--go-text-2); margin-top: 8px;">${escapeHtml(note)}</span>` : ''}
      </div>
      ${href ? `<a href="${href}" class="go-link">${escapeHtml(linkLabel)} <span style="display: flex; color: var(--go-red);">${icon('chevronRight', 16)}</span></a>` : ''}
    </div>`;
}

/**
 * Store card used by the home slider and category lists.
 * `timeLabel` is precomputed by the caller (it knows the schedule/ETA helpers).
 */
export function goStoreCard({ c, href, isOpen = true, isPaused = false, isInactive = false, deliveryFee = null, timeLabel = '', style = '' }) {
  const name = escapeHtml(c.name || 'Comercio');
  const rating = c.ratingAverage !== undefined && c.ratingAverage > 0 ? Number(c.ratingAverage).toFixed(1) : null;
  const statusText = isInactive ? 'Próximamente' : (isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado'));
  const statusMod = isInactive ? '' : (isPaused ? 'is-paused' : (isOpen ? 'is-open' : ''));
  const feeLabel = deliveryFee === null
    ? 'Envío a calcular'
    : (deliveryFee === 0 ? '<span class="go-free">Envío gratis</span>' : `Envío $${deliveryFee}`);
  const muted = isInactive || isPaused || !isOpen;

  return `
    <a href="${href}" class="go-store-card comercio-card ${isPaused ? 'is-paused' : ''} ${isInactive ? 'is-inactive' : ''} ${muted ? 'is-muted' : ''}" aria-label="${name}" style="${style}">
      <div class="go-store-cover">
        ${c.banner ? `<img src="${escapeHtml(c.banner)}" alt="" loading="lazy" decoding="async" />` : `<div class="go-store-cover-empty">${icon('store', 36)}</div>`}
        <span class="go-status ${statusMod}">${statusText}</span>
        <span class="go-store-logo">
          ${c.logo ? `<img src="${escapeHtml(c.logo)}" alt="" loading="lazy" decoding="async" />` : icon('store', 22)}
        </span>
      </div>
      <div class="go-store-body">
        <div class="go-store-name">
          <span>${name}</span>
          <span class="go-rating">${icon('star', 14, '', '#f59e0b')} ${rating || 'Nuevo'}</span>
        </div>
        <div class="go-store-meta">
          <span>${escapeHtml(c.category || 'Comercio')}</span>
          ${timeLabel ? `<span class="go-dot"></span><span>${timeLabel}</span>` : ''}
          <span class="go-dot"></span>
          <span>${feeLabel}</span>
        </div>
      </div>
    </a>`;
}
