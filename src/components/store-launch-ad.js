// "Kiosco Paulos llegó a GO!": announces a store that just joined the app. It is an invitation,
// so it shows on the home at most once a day and only on the first 7 days it is seen on this
// device; after that, or once the person opens the store from it, never again.
import { db } from '../firebase.js';
import { icon } from '../utils/icons.js';

const STORE_ID = 'gV5p2aGcgrRBM1n5wsGg'; // Kiosco Paulos
const STORE_KEY = 'gd_launch_ad_paulos'; // { count, last: 'YYYY-MM-DD', done }
const MAX_DAYS = 7;

let tries = 0;
let started = false;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readRecord() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function writeRecord(rec) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rec)); } catch (e) {}
}

function isDue() {
  const rec = readRecord();
  if (rec.done || (rec.count || 0) >= MAX_DAYS) return false;
  return rec.last !== today();
}

function canShowNow() {
  const hash = window.location.hash || '#/';
  const onHome = hash === '#/' || hash === '#' || hash === '';
  const busy = document.querySelector('.go-bsheet, .go-promo-sheet, .modal-overlay, #welcome-beta-modal-overlay, #onboarding-container, .go-tour, .delivery-map-modal-v4, #splash-screen, #app-overlay.active, #login-wall');
  return onHome && !busy && document.visibilityState === 'visible';
}

async function tryShow() {
  if (!isDue()) return;
  // Wait for a calm moment on the home (at most ~40 s, then it waits for the next open).
  if (!canShowNow()) {
    if (++tries < 20) setTimeout(tryShow, 2000);
    return;
  }

  // Only while the store is open to the public.
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'comercios', STORE_ID));
    if (!snap.exists() || snap.data().isActive === false) return;
  } catch (e) {
    return;
  }
  if (!isDue() || !canShowNow()) return;

  const rec = readRecord();
  writeRecord({ ...rec, count: (rec.count || 0) + 1, last: today() });
  showStoreLaunchAd();
}

/** Builds and opens the ad. Exported so it can be previewed without the rules. */
export function showStoreLaunchAd() {
  if (document.getElementById('go-launch-ad')) return;

  const sheet = document.createElement('div');
  sheet.id = 'go-launch-ad';
  sheet.className = 'go-promo-sheet go-launch';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Kiosco Paulos llegó a GO!');
  sheet.innerHTML = `
    <div class="go-launch-backdrop" data-launch-close></div>
    <div class="go-launch-card">
      <div class="go-launch-hero">
        <button type="button" class="go-launch-x" data-launch-close aria-label="Cerrar">${icon('close', 16)}</button>
        <span class="go-launch-badge"><span class="go-launch-dot"></span>Nuevo en GO!</span>
        <span class="go-launch-logo"><img src="/paulos-logo-real.jpg?v=9" alt="Maxikiosco Paulos" decoding="async" /></span>
      </div>
      <div class="go-launch-body">
        <span class="go-eyebrow">Ya podés pedirle</span>
        <h2 class="go-title">Kiosco Paulos llegó a GO!</h2>
        <span class="go-bar"></span>
        <p>Bebidas, golosinas, almacén y mucho más. Lo pedís desde la app y te lo llevamos a tu casa.</p>
        <ul class="go-launch-perks">
          <li>${icon('tag', 18)}<span>Precios<br>del local</span></li>
          <li>${icon('shoppingBag', 18)}<span>Miles de<br>productos</span></li>
          <li>${icon('motorcycle', 18)}<span>Envío a<br>tu casa</span></li>
        </ul>
      </div>
      <div class="go-launch-actions">
        <button type="button" class="go-launch-cta" data-launch-go>Ir a la tienda ${icon('chevronRight', 18)}</button>
        <button type="button" class="go-launch-later" data-launch-close>Ahora no</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));

  let closed = false;
  const close = (fromPop = false) => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPop);
    sheet.classList.remove('is-open');
    sheet.classList.add('is-closing');
    setTimeout(() => sheet.remove(), 260);
    if (!fromPop && window.history.state && window.history.state.isLaunchAd) window.history.back();
  };
  const onPop = () => close(true);
  window.history.pushState({ isLaunchAd: true }, '');
  window.addEventListener('popstate', onPop);

  sheet.querySelectorAll('[data-launch-close]').forEach(el => el.addEventListener('click', () => close()));
  sheet.querySelector('[data-launch-go]').addEventListener('click', () => {
    writeRecord({ ...readRecord(), done: true }); // they found it: no need to announce it again
    close(true);
    // Replace the ad's history entry with the store, so back returns to the home.
    window.location.replace(`#/comercio/${STORE_ID}`);
  });
}

/** Call once at startup, for signed-in people and guests alike. */
export function initStoreLaunchAd() {
  if (started) return;
  started = true;
  setTimeout(tryShow, 2500);
}
