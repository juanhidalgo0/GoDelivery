// Guía paso a paso que resalta partes reales de la pantalla (oscurece todo lo demás) y
// explica cada una en una frase. La usan la guía del cliente y la del panel del comercio.
import '../styles/go-tour.css';
import { escapeHtml as esc } from '../utils/escape.js';

const BLOCKERS = '.go-bsheet, .go-promo-sheet, .modal-overlay, .cp-sheet, #splash-screen, #onboarding-container, #login-wall, #pwa-lock-screen, .location-modal-container';
let running = false;

export const isTourRunning = () => running;

/**
 * @param {object} o
 * @param {{target?: string, title: string, text: string}[]} o.steps  Sin target (o si no está en pantalla) va centrado.
 * @param {Function} [o.onEnd]  Se llama una vez al terminar o saltar: ('done' | 'skip').
 * @param {Function} [o.canStart]  Condición extra para arrancar (por ejemplo, seguir en la misma pantalla).
 * @param {number} [attempt]
 */
export function startSpotlightTour({ steps, onEnd = null, canStart = () => true, finishLabel = 'Empezar', extraBlockers = '' }, attempt = 0) {
  if (running) return;
  // Una cosa a la vez: si hay otra hoja abierta (novedades, permisos, dirección…), espera.
  if (document.querySelector(extraBlockers ? `${BLOCKERS}, ${extraBlockers}` : BLOCKERS) || !canStart()) {
    if (attempt < 60) setTimeout(() => startSpotlightTour({ steps, onEnd, canStart, finishLabel, extraBlockers }, attempt + 1), 1000);
    return;
  }
  running = true;

  const layer = document.createElement('div');
  layer.className = 'go-tour';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', 'Guía');
  layer.innerHTML = `
    <div class="go-tour-hole" aria-hidden="true"></div>
    <div class="go-tour-card">
      <div class="go-tour-count"></div>
      <h2 class="go-tour-title"></h2>
      <p class="go-tour-text"></p>
      <div class="go-tour-actions">
        <button type="button" class="go-tour-btn is-ghost" data-tour="skip">Saltar</button>
        <span style="flex:1"></span>
        <button type="button" class="go-tour-btn" data-tour="prev">Atrás</button>
        <button type="button" class="go-tour-btn is-primary" data-tour="next">Siguiente</button>
      </div>
    </div>`;
  document.body.appendChild(layer);

  const hole = layer.querySelector('.go-tour-hole');
  const card = layer.querySelector('.go-tour-card');
  let i = 0;

  const findTarget = (sel) => {
    if (!sel) return null;
    return [...document.querySelectorAll(sel)].find(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) || null;
  };

  const draw = (el) => {
    if (!el) {
      hole.style.cssText = 'left:50%; top:50%; width:0; height:0;';
      card.style.cssText = 'left:50%; top:50%; transform:translate(-50%, -50%);';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hole.style.cssText = `left:${r.left - pad}px; top:${r.top - pad}px; width:${r.width + pad * 2}px; height:${r.height + pad * 2}px;`;
    const cardW = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - cardW - 12, r.left + r.width / 2 - cardW / 2));
    const below = r.top + r.height / 2 < window.innerHeight / 2;
    card.style.cssText = below
      ? `left:${left}px; top:${Math.min(r.bottom + pad + 12, window.innerHeight - 200)}px; width:${cardW}px;`
      : `left:${left}px; bottom:${Math.min(window.innerHeight - r.top + pad + 12, window.innerHeight - 200)}px; width:${cardW}px;`;
  };

  const place = () => {
    const step = steps[i];
    layer.querySelector('.go-tour-count').textContent = `${i + 1} de ${steps.length}`;
    layer.querySelector('.go-tour-title').textContent = step.title;
    layer.querySelector('.go-tour-text').innerHTML = esc(step.text);
    layer.querySelector('[data-tour="prev"]').style.visibility = i === 0 ? 'hidden' : 'visible';
    layer.querySelector('[data-tour="next"]').textContent = i === steps.length - 1 ? finishLabel : 'Siguiente';
    layer.querySelector('[data-tour="skip"]').style.visibility = i === steps.length - 1 ? 'hidden' : 'visible';
    // Un paso puede preparar la pantalla antes (por ejemplo, volver arriba para que se vea el encabezado)
    if (step.before && !step._prepared) {
      step._prepared = true;
      try { step.before(); } catch (e) {}
      draw(null);
      setTimeout(() => { step._prepared = false; if (steps[i] === step) placeTarget(step); }, 450);
      return;
    }
    placeTarget(step);
  };

  const placeTarget = (step) => {
    const el = findTarget(step.target);
    if (!el) return draw(null);
    // Si está fuera de la vista (más abajo en el inicio), se acerca primero
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 80) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      draw(el);
      setTimeout(() => { if (steps[i] === step) draw(el); }, 420);
    } else {
      draw(el);
    }
  };

  const end = (reason) => {
    running = false;
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    layer.remove();
    if (onEnd) onEnd(reason);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') end('skip');
    if (e.key === 'ArrowRight') layer.querySelector('[data-tour="next"]').click();
    if (e.key === 'ArrowLeft' && i > 0) { i--; place(); }
  };

  layer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    if (b.dataset.tour === 'skip') return end('skip');
    if (b.dataset.tour === 'prev' && i > 0) i--;
    if (b.dataset.tour === 'next') {
      if (i === steps.length - 1) return end('done');
      i++;
    }
    place();
  });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey);
  place();
  layer.querySelector('[data-tour="next"]').focus();
}
