// GoDelivery — Search Suggestions Component
import { db } from '../firebase.js';
import { collection, getDocs, query, where, collectionGroup } from 'firebase/firestore';
import { icon } from '../utils/icons.js';
import { formatPrice } from '../utils/format.js';

let allComercios = [];
let allProducts = [];
let isLoaded = false;
let selectedIndex = -1;

async function loadSearchData() {
  if (isLoaded) return;
  try {
    const comSnap = await getDocs(query(collection(db, 'comercios'), where('isActive', '==', true)));
    allComercios = comSnap.docs.map(doc => ({ id: doc.id, type: 'comercio', ...doc.data() }));

    // Fetch products with fallback if collectionGroup fails or index is missing
    try {
      const prodSnap = await getDocs(collectionGroup(db, 'products'));
      allProducts = prodSnap.docs.map(doc => {
        const data = doc.data();
        const pathParts = doc.ref.path.split('/');
        const comercioId = pathParts[1];
        const comercio = allComercios.find(c => c.id === comercioId);
        if (!comercio) return null;
        return { 
          id: doc.id, 
          type: 'product', 
          comercioId, 
          comercioName: comercio.name, 
          ...data 
        };
      }).filter(p => p !== null && p.isActive !== false);
    } catch (err) {
      console.warn('CollectionGroup failed, fetching individually', err);
      const promises = allComercios.map(async (c) => {
        const pSnap = await getDocs(collection(db, 'comercios', c.id, 'products'));
        return pSnap.docs.map(d => ({
          id: d.id,
          type: 'product',
          comercioId: c.id,
          comercioName: c.name,
          ...d.data()
        }));
      });
      const results = await Promise.all(promises);
      allProducts = results.flat().filter(p => p.isActive !== false && allComercios.some(c => c.id === p.comercioId));
    }

    isLoaded = true;
  } catch (e) {
    console.error('Error loading search data:', e);
  }
}


export function initSearchSuggestions() {
  const searchInput = document.getElementById('header-search');
  if (!searchInput) return;

  // Cleanly remove any stale suggestions container
  const oldContainer = document.getElementById('search-suggestions');
  if (oldContainer) {
    oldContainer.remove();
  }

  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'search-suggestions';
  suggestionsContainer.className = 'search-suggestions-dropdown';
  searchInput.parentElement.parentElement.appendChild(suggestionsContainer);

  searchInput.addEventListener('focus', () => {
    loadSearchData();
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

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    selectedIndex = -1;
    if (query.length < 2) {
      suggestionsContainer.innerHTML = '';
      suggestionsContainer.classList.remove('active');
      return;
    }
    renderSuggestions(query, suggestionsContainer);
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
      suggestionsContainer.classList.remove('active');
    }
  });
}

function updateSelection(items) {
  items.forEach((item, idx) => {
    item.classList.toggle('selected', idx === selectedIndex);
    if (idx === selectedIndex) item.scrollIntoView({ block: 'nearest' });
  });
}

function highlightText(text, query) {
  if (!text) return '';
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return text;
  return `${text.substring(0, index)}<span class="suggestion-highlight">${text.substring(index, index + query.length)}</span>${text.substring(index + query.length)}`;
}

function renderSuggestions(searchTerm, container) {
  const filteredComercios = allComercios.filter(c => 
    (c.name || '').toLowerCase().includes(searchTerm) ||
    (c.category || '').toLowerCase().includes(searchTerm)
  ).slice(0, 4);

  const filteredProducts = allProducts.filter(p => 
    (p.name || '').toLowerCase().includes(searchTerm)
  ).slice(0, 6);

  if (filteredComercios.length === 0 && filteredProducts.length === 0) {
    container.innerHTML = `<div class="search-suggestion-empty">No se encontraron resultados para "${searchTerm}"</div>`;
    container.classList.add('active');
    return;
  }

  container.innerHTML = `
    ${filteredComercios.length > 0 ? `
      <div class="search-suggestion-group">
        <div class="search-suggestion-header">Comercios</div>
        ${filteredComercios.map(c => `
          <a href="#/comercio/${c.id}" class="search-suggestion-item">
            <div class="suggestion-icon-box">
              ${c.logo ? `<img src="${c.logo}" alt="" />` : icon('store', 18)}
            </div>
            <div class="suggestion-info">
              <div class="suggestion-title">${highlightText(c.name, searchTerm)}</div>
              <div class="suggestion-subtitle">${highlightText(c.category, searchTerm) || 'Comercio'}</div>
            </div>
          </a>
        `).join('')}
      </div>
    ` : ''}

    ${filteredProducts.length > 0 ? `
      <div class="search-suggestion-group">
        <div class="search-suggestion-header">Productos</div>
        ${filteredProducts.map(p => `
          <a href="#/comercio/${p.comercioId}?product=${p.id}" class="search-suggestion-item">
            <div class="suggestion-icon-box">
              ${p.image ? `<img src="${p.image}" alt="" />` : icon('package', 18)}
            </div>
            <div class="suggestion-info">
              <div class="suggestion-title">${highlightText(p.name, searchTerm)}</div>
              <div class="suggestion-subtitle">en <strong>${p.comercioName}</strong> • ${formatPrice(p.price)}</div>
            </div>
          </a>
        `).join('')}
      </div>
    ` : ''}
  `;

  container.classList.add('active');

  container.querySelectorAll('.search-suggestion-item').forEach(item => {
    item.onclick = () => {
      container.classList.remove('active');
      document.getElementById('header-search').value = '';
    };
  });
}

