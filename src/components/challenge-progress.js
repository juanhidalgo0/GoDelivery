// When an order is delivered, the driver's app advances the customer's weekly challenges.
// This tells the customer right away (or the next time they open the app) with a card
// showing where each challenge stands, or the points won if one was completed.
import { getState, subscribe } from '../state.js';
import { db } from '../firebase.js';
import { collection, onSnapshot } from 'firebase/firestore';
import { escapeHtml } from '../utils/escape.js';
import { showGoSheet, isAnySheetOpen } from './go-sheet.js';

const SEEN_KEY = (uid) => `gd_challenge_progress_${uid}`;
let unsub = null;
let currentUid = null;

function readSeen(uid) {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY(uid)) || 'null'); } catch (e) { return null; }
}
function writeSeen(uid, map) {
  try { localStorage.setItem(SEEN_KEY(uid), JSON.stringify(map)); } catch (e) {}
}

function showCard(challenges, advancedIds, attempt = 0) {
  if (isAnySheetOpen()) {
    if (attempt < 20) setTimeout(() => showCard(challenges, advancedIds, attempt + 1), 2000);
    return;
  }
  const completed = challenges.filter(c => advancedIds.includes(c.id) && c.completed);
  const won = completed.reduce((sum, c) => sum + (c.pointsReward || 0), 0);
  const rows = challenges
    .slice()
    .sort((a, b) => (advancedIds.includes(b.id) ? 1 : 0) - (advancedIds.includes(a.id) ? 1 : 0))
    .map(c => {
      const target = Math.max(1, c.target || 1);
      const progress = Math.min(c.progress || 0, target);
      const pct = Math.round((progress / target) * 100);
      const moved = advancedIds.includes(c.id);
      return `
        <div class="go-challenge ${c.completed ? 'is-done' : ''} ${moved ? 'is-moved' : ''}">
          <div class="go-challenge-top">
            <strong>${escapeHtml(c.title || 'Desafío')}</strong>
            <span>${c.completed ? '¡Completado!' : `${progress}/${target}`}</span>
          </div>
          <div class="go-challenge-track"><span style="--to: ${pct}%;"></span></div>
          ${c.pointsReward ? `<small>${c.completed ? 'Ganaste' : 'Premio'}: ${Number(c.pointsReward).toLocaleString('es-AR')} GO Points</small>` : ''}
        </div>`;
    }).join('');

  showGoSheet({
    id: 'go-challenge-progress',
    iconName: 'target',
    eyebrow: 'Desafíos de la semana',
    title: won ? `¡Ganaste ${won.toLocaleString('es-AR')} pts!` : 'Sumaste un pedido',
    bodyHtml: `<p>${won ? 'Completaste un desafío con tu último pedido. Los puntos ya están en tu cuenta.' : 'Tu último pedido cuenta para tus desafíos. Así vas:'}</p><div class="go-challenge-list">${rows}</div>`,
    primary: { label: won ? 'Buenísimo' : 'Seguir sumando' },
    secondary: { label: 'Ver Club GO', onClick: () => { window.location.hash = '#/profile'; } },
  });
}

function watch(uid) {
  unsub?.();
  unsub = null;
  currentUid = uid;
  if (!uid) return;
  unsub = onSnapshot(collection(db, 'users', uid, 'challenges'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const challenges = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const now = Object.fromEntries(challenges.map(c => [c.id, c.progress || 0]));
    const seen = readSeen(uid);
    writeSeen(uid, now);
    if (!seen) return; // first time on this device: just remember where things stand
    const advanced = challenges.filter(c => (c.progress || 0) > (seen[c.id] ?? (c.progress || 0))).map(c => c.id);
    if (advanced.length) showCard(challenges, advanced);
  }, (err) => console.warn('[Challenges] listener error:', err));
}

/** Starts once; follows whoever is signed in. Drivers and shops are skipped. */
export function initChallengeProgress() {
  const sync = () => {
    const u = getState().user;
    const uid = u && (u.role || 'user') === 'user' ? u.uid : null;
    if (uid !== currentUid) watch(uid);
  };
  sync();
  subscribe('user', sync);
}
