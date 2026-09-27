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
