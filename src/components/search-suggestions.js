// GoDelivery — Search Suggestions Component
// Stores show at once; products join as soon as they arrive. A light index is kept on the
// phone so the next search is instant, and it refreshes in the background.
import { db } from '../firebase.js';
import { collection, getDocs, query, collectionGroup } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';
import { withTimeout } from '../utils/firestore-cache.js';
import { escapeHtml } from '../utils/escape.js';

const COMERCIOS_TIMEOUT_MS = 8000;
const PRODUCTS_TIMEOUT_MS = 25000; // a big catalog can take a while on mobile data
const SEARCH_DATA_TTL_MS = 5 * 60 * 1000;
const INDEX_KEY = 'gd_search_index_v1';
const INDEX_MAX_AGE_MS = 6 * 60 * 60 * 1000;

let allComercios = [];
let allProducts = [];
let comerciosLoadedAt = 0;
let productsLoadedAt = 0;
let comerciosPromise = null;
let productsPromise = null;
let selectedIndex = -1;
let onDataChange = null;

// Accent- and case-insensitive: "cafe" finds "Café".
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Local index (only what the list shows) ──
(function hydrateFromIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return;
    const idx = JSON.parse(raw);
    if (!idx || Date.now() - idx.t > INDEX_MAX_AGE_MS) return;
    allComercios = idx.comercios || [];
    allProducts = idx.products || [];
  } catch (e) {}
})();

function saveIndex() {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify({
      t: Date.now(),
      comercios: allComercios.map(c => ({ id: c.id, name: c.name, category: c.category, logo: c.logo })),
      products: allProducts.map(p => ({ id: p.id, name: p.name, category: p.category, price: p.price, image: p.image, comercioId: p.comercioId, comercioName: p.comercioName })),
    }));
  } catch (e) {
    // Quota exceeded on a huge catalog: search still works from memory.
  }
}

function loadComercios() {
  if (comerciosLoadedAt && Date.now() - comerciosLoadedAt < SEARCH_DATA_TTL_MS) return Promise.resolve();
  if (comerciosPromise) return comerciosPromise;
  comerciosPromise = (async () => {
    try {
      const comSnap = await withTimeout(getDocs(query(collection(db, 'comercios'))), COMERCIOS_TIMEOUT_MS, 'search_comercios');
      allComercios = comSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.isActive !== false)
        .map(c => ({ id: c.id, name: c.name, category: c.category, logo: c.logo }));
      comerciosLoadedAt = Date.now();
    } catch (e) {
      console.warn('[Search] Could not load stores:', e);
    }
  })().finally(() => { comerciosPromise = null; });
  return comerciosPromise;
}

function loadProducts() {
  if (productsLoadedAt && Date.now() - productsLoadedAt < SEARCH_DATA_TTL_MS) return Promise.resolve();
  if (productsPromise) return productsPromise;
  productsPromise = (async () => {
    await loadComercios();
    const byId = new Map(allComercios.map(c => [c.id, c]));
    const toItem = (d, comercioId) => {
      const data = d.data();
      const comercio = byId.get(comercioId);
      if (!comercio || data.isAvailable === false || !data.name) return null;
      return { id: d.id, name: data.name, category: data.category, price: data.price, image: data.image, comercioId, comercioName: comercio.name };
    };
    try {
      const prodSnap = await withTimeout(getDocs(collectionGroup(db, 'products')), PRODUCTS_TIMEOUT_MS, 'search_products_group');
      allProducts = prodSnap.docs
        .filter(d => d.ref.path.startsWith('comercios/'))
        .map(d => toItem(d, d.ref.path.split('/')[1]))
        .filter(Boolean);
    } catch (err) {
      console.warn('[Search] Product group query failed, loading per store', err);
      const results = await Promise.all(allComercios.map(async (c) => {
        try {
          const pSnap = await withTimeout(getDocs(collection(db, 'comercios', c.id, 'products')), PRODUCTS_TIMEOUT_MS, `search_products_${c.id}`);
          return pSnap.docs.map(d => toItem(d, c.id)).filter(Boolean);
        } catch (e) {
          return [];
        }
      }));
      allProducts = results.flat();
    }
    productsLoadedAt = Date.now();
    saveIndex();
    onDataChange?.();
  })().finally(() => { productsPromise = null; });
  return productsPromise;
}

export function initSearchSuggestions() {
  const searchInput = document.getElementById('header-search');
  if (!searchInput) return;

  document.getElementById('search-suggestions')?.remove();
  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'search-suggestions';
  suggestionsContainer.className = 'search-suggestions-dropdown';
  document.body.appendChild(suggestionsContainer);

  const positionDropdown = () => {
    const rect = searchInput.parentElement.getBoundingClientRect();
    suggestionsContainer.style.top = `${rect.bottom + 8}px`;
    suggestionsContainer.style.left = `${rect.left}px`;
    suggestionsContainer.style.width = `${rect.width}px`;
  };

  const currentQuery = () => searchInput.value.trim();
  const show = () => {
    const q = currentQuery();
    if (q.length < 2) return;
    positionDropdown();
    suggestionsContainer.classList.add('active');
    renderSuggestions(q, suggestionsContainer);
  };

  // When products (or stores) arrive while the list is open, refresh it in place.
  onDataChange = () => {
    if (suggestionsContainer.classList.contains('active')) show();
  };

  const warmUp = () => {
    loadComercios().then(onDataChange);
    loadProducts();
  };

  // The keyboard covers the footer: it must not ride up above the keyboard.
  searchInput.addEventListener('blur', () => document.documentElement.classList.remove('go-search-typing'));
  searchInput.addEventListener('focus', () => {
    document.documentElement.classList.add('go-search-typing');
    warmUp();
    if (currentQuery().length >= 2) show();
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = suggestionsContainer.querySelectorAll('.search-suggestion-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection(items);
    } else if (e.key === 'Enter') {
      if (selectedIndex > -1) {
        e.preventDefault();
        items[selectedIndex].click();
      }
    } else if (e.key === 'Escape') {
      suggestionsContainer.classList.remove('active');
    }
  });

  let typingTimer = null;
  searchInput.addEventListener('input', () => {
    selectedIndex = -1;
    clearTimeout(typingTimer);
    if (currentQuery().length < 2) {
      suggestionsContainer.classList.remove('active');
      return;
    }
    // A short pause between keystrokes, so the list doesn't redraw on every letter.
    typingTimer = setTimeout(show, 90);
  });

  // Close when tapping anywhere else (one listener, even if the header re-renders).
  if (!window.__goSearchOutsideBound) {
    window.__goSearchOutsideBound = true;
    document.addEventListener('click', (e) => {
      const input = document.getElementById('header-search');
      const box = document.getElementById('search-suggestions');
      if (!box || (input && input.contains(e.target)) || box.contains(e.target)) return;
      box.classList.remove('active');
    });
  }
}

function updateSelection(items) {
  items.forEach((item, idx) => {
    item.classList.toggle('selected', idx === selectedIndex);
    if (idx === selectedIndex) item.scrollIntoView({ block: 'nearest' });
  });
}

function highlightText(text, rawQuery) {
  if (!text) return '';
  const n = norm(text);
  const q = norm(rawQuery);
  const index = n.indexOf(q);
  if (index === -1 || !q) return escapeHtml(text);
  // Normalizing keeps string length for Spanish text, so indexes line up with the original.
  return `${escapeHtml(text.substring(0, index))}<span class="suggestion-highlight">${escapeHtml(text.substring(index, index + q.length))}</span>${escapeHtml(text.substring(index + q.length))}`;
}

function renderSuggestions(searchTerm, container) {
  const q = norm(searchTerm);
  const filteredComercios = allComercios.filter(c => norm(c.name).includes(q) || norm(c.category).includes(q)).slice(0, 4);
  const filteredProducts = allProducts
    .filter(p => norm(p.name).includes(q) || norm(p.category).includes(q))
    // Names that start with the query first
    .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1))
    .slice(0, 6);
  const productsPending = !productsLoadedAt && allProducts.length === 0;

  let html;
  if (filteredComercios.length === 0 && filteredProducts.length === 0) {
    html = productsPending
      ? `<div class="search-suggestion-empty">Buscando…</div>`
      : `<div class="search-suggestion-empty">No encontramos nada con "${escapeHtml(searchTerm)}"</div>`;
  } else {
    html = `
      ${filteredComercios.length > 0 ? `
        <div class="search-suggestion-group">
          <div class="search-suggestion-header">Comercios</div>
          ${filteredComercios.map(c => `
            <a href="#/comercio/${encodeURIComponent(c.id)}" class="search-suggestion-item">
              <div class="suggestion-icon-box">${c.logo ? `<img src="${escapeHtml(c.logo)}" alt="" loading="lazy" />` : icon('store', 18)}</div>
              <div class="suggestion-info">
                <div class="suggestion-title">${highlightText(c.name, searchTerm)}</div>
                <div class="suggestion-subtitle">${c.category ? highlightText(c.category, searchTerm) : 'Comercio'}</div>
              </div>
            </a>`).join('')}
        </div>` : ''}
      ${filteredProducts.length > 0 ? `
        <div class="search-suggestion-group">
          <div class="search-suggestion-header">Productos</div>
          ${filteredProducts.map(p => `
            <a href="#/comercio/${encodeURIComponent(p.comercioId)}?product=${encodeURIComponent(p.id)}" class="search-suggestion-item">
              <div class="suggestion-icon-box">${p.image ? `<img src="${escapeHtml(p.image)}" alt="" loading="lazy" />` : icon('package', 18)}</div>
              <div class="suggestion-info">
                <div class="suggestion-title">${highlightText(p.name, searchTerm)}</div>
                <div class="suggestion-subtitle">en <strong>${escapeHtml(p.comercioName)}</strong>${p.price ? ` · ${formatPrice(p.price)}` : ''}</div>
              </div>
            </a>`).join('')}
        </div>` : (productsPending ? `<div class="search-suggestion-empty" style="padding: 10px 16px;">Buscando productos…</div>` : '')}
    `;
  }

  // Same results as on screen: leave the DOM alone (no image reloads, no flicker).
  if (container.dataset.sig !== html) {
    container.dataset.sig = html;
    container.innerHTML = html;
    container.querySelectorAll('.search-suggestion-item').forEach(item => {
      item.onclick = () => {
        container.classList.remove('active');
        const input = document.getElementById('header-search');
        if (input) { input.value = ''; input.blur(); }
      };
    });
  }
  container.classList.add('active');
}
