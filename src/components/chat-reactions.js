// Reacciones del chat, como en WhatsApp: se mantiene pulsada la burbuja, se destaca sobre la pantalla
// oscurecida y arriba aparece la barra de emojis. Tocar el mismo emoji saca la reacción.
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/native.js';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const HOLD_MS = 420;
const DELETE_WINDOW_MS = 5 * 60 * 1000;
const MOVE_TOLERANCE = 10;
const SWIPE_REPLY = 56;
const SWIPE_MAX = 80;

/** El globito con las reacciones de un mensaje. */
export function reactionPillHtml(reactions, myUid) {
  const entries = Object.entries(reactions || {}).filter(([, emoji]) => emoji);
  if (!entries.length) return '';
  const unique = [...new Set(entries.map(([, emoji]) => emoji))];
  const esc = (v) => String(v).replace(/[&<>"']/g, '');
  return `<button type="button" class="chat-rx-pill ${reactions[myUid] ? 'is-mine' : ''}" aria-label="Reacciones">${unique.map(esc).join('')}${entries.length > 1 ? `<small>${entries.length}</small>` : ''}</button>`;
}

export function initReactions(container, { uid, messagesRef, getMessage, isLocked, moreEmojis = [], onReply, onDelete }) {
  if (container.dataset.rxReady) return;
  container.dataset.rxReady = '1';

  let timer = null;
  let start = null;
  let swipe = null;
  let skipClick = false;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
  const endSwipe = (reply) => {
    if (!swipe) return;
    const { bubble } = swipe;
    swipe = null;
    bubble.style.transition = 'transform 0.16s ease-out';
    bubble.style.transform = '';
    setTimeout(() => { bubble.style.transition = ''; }, 170);
    if (reply) {
      const msg = getMessage(bubble.dataset.msgId);
      if (msg && !isLocked()) { haptic('light'); onReply?.(msg); }
    }
  };

  const open = (bubble) => {
    const id = bubble.dataset.msgId;
    const msg = id && getMessage(id);
    if (!msg || isLocked()) return;
    skipClick = true;
    setTimeout(() => { skipClick = false; }, 500);
    haptic('medium');
    showMenu(bubble, msg, { uid, messagesRef, moreEmojis, onReply, onDelete });
  };

  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const bubble = e.target.closest('.chat-bubble[data-msg-id]');
    if (!bubble || e.target.closest('.wa-play, .wa-seek, .wa-speed, .btn-mark-paid, button, a')) return;
    start = { x: e.clientX, y: e.clientY, bubble };
    timer = setTimeout(() => { timer = null; open(bubble); }, HOLD_MS);
  });
  container.addEventListener('pointermove', (e) => {
    if (swipe) {
      const dx = Math.max(0, Math.min(SWIPE_MAX, e.clientX - swipe.x));
      swipe.dx = dx;
      swipe.bubble.style.transform = `translateX(${dx}px)`;
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    // Hacia la derecha, sin subir ni bajar: responder (como en WhatsApp)
    if (dx > MOVE_TOLERANCE && Math.abs(dy) < dx / 2 && e.pointerType !== 'mouse') {
      swipe = { x: start.x, bubble: start.bubble, dx };
      cancel();
    } else if (Math.hypot(dx, dy) > MOVE_TOLERANCE) cancel();
  });
  container.addEventListener('pointerup', () => { cancel(); if (swipe) endSwipe(swipe.dx >= SWIPE_REPLY); });
  ['pointercancel', 'pointerleave'].forEach((ev) => container.addEventListener(ev, () => { cancel(); endSwipe(false); }));
  container.addEventListener('scroll', cancel, { passive: true });

  // El menú propio del celular (copiar imagen, etc.) no se abre; en PC, clic derecho reacciona
  container.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.chat-bubble[data-msg-id]');
    if (!bubble) return;
    e.preventDefault();
    if (e.pointerType !== 'touch' && !timer && !document.querySelector('.chat-rx-layer')) open(bubble);
  });

  container.addEventListener('click', (e) => {
    // Soltar después de mantener pulsado no abre la foto
    if (skipClick) { e.stopPropagation(); e.preventDefault(); skipClick = false; return; }
    const pill = e.target.closest('.chat-rx-pill');
    if (pill) open(pill.closest('.chat-bubble'));
  }, true);
}

function showMenu(bubble, msg, { uid, messagesRef, moreEmojis, onReply, onDelete }) {
  document.querySelector('.chat-rx-layer')?.remove();
  const host = bubble.closest('.chat-container');
  if (!host) return;
  const hostRect = host.getBoundingClientRect();
  const rect = bubble.getBoundingClientRect();
  const mine = msg.reactions?.[uid] || '';

  const layer = document.createElement('div');
  layer.className = 'chat-rx-layer';
  const emojiBtn = (e) => `<button type="button" class="chat-rx-emoji ${e === mine ? 'is-on' : ''}" data-emoji="${e}" aria-label="Reaccionar con ${e}">${e}</button>`;
  const sentAt = msg.timestamp?.toMillis?.() || 0;
  const canDelete = msg.senderId === uid && sentAt > 0 && Date.now() - sentAt < DELETE_WINDOW_MS;
  const copyable = msg.type !== 'image' && msg.type !== 'audio' && msg.text;
  layer.innerHTML = `
    <div class="chat-rx-clone"></div>
    <div class="chat-rx-bar" role="menu">
      ${QUICK.map(emojiBtn).join('')}
      ${moreEmojis.length ? `<button type="button" class="chat-rx-more" aria-label="Más emojis">${icon('plus', 18)}</button>` : ''}
    </div>
    <div class="chat-rx-grid" hidden>${moreEmojis.map(emojiBtn).join('')}</div>
    <div class="chat-rx-copy">
      <button type="button" class="chat-rx-action" data-action="reply">${icon('reply', 16)} Responder</button>
      ${copyable ? `<button type="button" class="chat-rx-action" data-action="copy">${icon('copy', 16)} Copiar</button>` : ''}
      ${canDelete ? `<button type="button" class="chat-rx-action is-danger" data-action="delete">${icon('trash', 16)} Eliminar</button>` : ''}
    </div>`;
  host.appendChild(layer);

  // La burbuja queda en su lugar, por encima de lo oscurecido
  const clone = bubble.cloneNode(true);
  clone.querySelector('.chat-rx-pill')?.remove();
  clone.removeAttribute('data-msg-id');
  const cloneBox = layer.querySelector('.chat-rx-clone');
  cloneBox.appendChild(clone);
  const bar = layer.querySelector('.chat-rx-bar');
  const copy = layer.querySelector('.chat-rx-copy');
  const grid = layer.querySelector('.chat-rx-grid');

  const left = rect.left - hostRect.left;
  const barW = bar.offsetWidth;
  const margin = 8;
  const barLeft = Math.max(margin, Math.min(hostRect.width - barW - margin, msg.senderId === uid ? rect.right - hostRect.left - barW : left));
  const barH = bar.offsetHeight;
  const copyH = copy ? copy.offsetHeight + 8 : 0;
  const minTop = barH + 76; // debajo de la cabecera
  // Burbuja muy alta o pegada a un borde: se mueve lo justo para que todo se vea
  const maxTop = hostRect.height - Math.min(rect.height, hostRect.height * 0.5) - copyH - margin;
  const top = Math.max(minTop, Math.min(maxTop, rect.top - hostRect.top));

  cloneBox.style.cssText = `left:${left}px; top:${top}px; width:${rect.width}px; max-height:${Math.round(hostRect.height * 0.5)}px;`;
  bar.style.cssText = `left:${barLeft}px; top:${top - barH - 8}px;`;
  grid.style.cssText = `left:${margin}px; right:${margin}px; top:${top - barH - 8}px;`;
  if (copy) copy.style.cssText = `top:${top + Math.min(rect.height, hostRect.height * 0.5) + 8}px; ${msg.senderId === uid ? `right:${hostRect.width - rect.right + hostRect.left}px;` : `left:${left}px;`}`;

  const close = () => {
    layer.classList.add('is-closing');
    setTimeout(() => layer.remove(), 120);
  };

  layer.addEventListener('click', async (e) => {
    const more = e.target.closest('.chat-rx-more');
    if (more) {
      grid.hidden = false;
      bar.hidden = true;
      return;
    }
    if (e.target.closest('[data-action="reply"]')) {
      close();
      onReply?.(msg);
      return;
    }
    if (e.target.closest('[data-action="delete"]')) {
      close();
      onDelete?.(msg);
      return;
    }
    if (e.target.closest('[data-action="copy"]')) {
      close();
      const { showToast } = await import('./toast.js');
      try { await navigator.clipboard.writeText(msg.text); showToast('Mensaje copiado', 'success'); } catch (err) { showToast('No se pudo copiar', 'warning'); }
      return;
    }
    const btn = e.target.closest('[data-emoji]');
    if (!btn) { close(); return; }
    const emoji = btn.dataset.emoji;
    haptic('selection');
    close();
    try {
      await updateDoc(doc(messagesRef, msg.id), { [`reactions.${uid}`]: emoji === mine ? deleteField() : emoji });
    } catch (err) {
      console.warn('[chat] reaction', err);
      const { showToast } = await import('./toast.js');
      showToast('No se pudo reaccionar. Revisá tu conexión.', 'warning');
    }
  });
}
