import { db } from '../firebase.js';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';

export async function renderMarketplace(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  // Render template layout
  content.innerHTML = `
    <div class="marketplace-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative;">
      <!-- Header (Red Premium style) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <a href="#/" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Marketplace</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Compra y venta</p>
        </div>
        <div style="display:flex; gap:8px;">
          <a href="#/profile/publications" title="Mis Publicaciones" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
            ${icon('tag', 20) || icon('shop', 20) || '🏷️'}
          </a>
          <a href="#/marketplace/publish" style="background:rgba(255,255,255,0.25); color:white; border:none; border-radius:12px; padding:0 12px; font-weight:700; text-decoration:none; font-size:13.5px; display:flex; align-items:center; gap:4px; height:40px;">
            ${icon('plus', 14) || '+'} Publicar
          </a>
        </div>
      </div>

      <!-- Search and Filter -->
      <div class="marketplace-filters" style="padding:12px 16px; background:var(--color-surface); border-bottom:1px solid var(--color-border); display:flex; flex-direction:column; gap:8px;">
        <div style="position:relative; width:100%;">
          <input type="text" id="market-search" placeholder="¿Qué estás buscando?" style="width:100%; height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 16px 0 40px; font-size:14px; background:var(--color-bg); color:var(--color-text); box-sizing:border-box;" />
          <div style="position:absolute; left:12px; top:12px; color:var(--color-text-secondary);">
            ${icon('search', 18) || '🔍'}
          </div>
        </div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding:4px 0; scrollbar-width:none;">
          <button class="filter-chip active" data-condition="all" style="background:var(--color-primary); color:white; border:none; border-radius:20px; padding:6px 14px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer;">Todos</button>
          <button class="filter-chip" data-condition="new" style="background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border); border-radius:20px; padding:6px 14px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer;">Nuevos</button>
          <button class="filter-chip" data-condition="used" style="background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border); border-radius:20px; padding:6px 14px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer;">Usados</button>
        </div>
      </div>

      <!-- Products Grid -->
      <div id="market-products-list" style="flex:1; overflow-y:auto; padding:16px; display:grid; grid-template-columns:repeat(2, 1fr); gap:12px; align-content:start;">
        <div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--color-text-secondary);">
          Cargando publicaciones...
        </div>
      </div>
    </div>
  `;

  const searchInput = content.querySelector('#market-search');
  const listContainer = content.querySelector('#market-products-list');
  const chips = content.querySelectorAll('.filter-chip');

  let products = [];
  let filterCondition = 'all';
  let searchQuery = '';

  const renderProducts = () => {
    let filtered = products.filter(p => p.status === 'active'); // Solo mostrar activos/aprobados

    if (filterCondition !== 'all') {
      filtered = filtered.filter(p => p.condition === filterCondition);
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        (p.title || '').toLowerCase().includes(q) || 
        (p.description || '').toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--color-text-secondary);">
          <div style="font-size:40px; margin-bottom:12px;">🏷️</div>
          <p style="margin:0; font-weight:700; color:var(--color-text);">No se encontraron productos</p>
          <p style="margin:4px 0 0; font-size:13px;">Probá cambiando el término de búsqueda o filtros.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered.map(p => `
      <a href="#/marketplace/product/${p.id}" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; overflow:hidden; text-decoration:none; color:inherit; display:flex; flex-direction:column; box-shadow:var(--shadow-sm); transition:transform 0.2s;">
        <div style="position:relative; width:100%; padding-top:100%; background:#f0f0f0;">
          <img src="${p.images?.[0] || '/logo.png'}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover;" />
          <div style="position:absolute; top:8px; left:8px; background:${p.condition === 'new' ? '#10B981' : '#F59E0B'}; color:white; font-size:10px; font-weight:800; padding:3px 8px; border-radius:8px; text-transform:uppercase;">
            ${p.condition === 'new' ? 'Nuevo' : 'Usado'}
          </div>
        </div>
        <div style="padding:10px; display:flex; flex-direction:column; gap:4px; flex:1;">
          <span style="font-size:16px; font-weight:900; color:var(--color-primary);">$${p.price}</span>
          <h3 style="font-size:13px; font-weight:700; margin:0; line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; color:var(--color-text);">${p.title}</h3>
          <span style="font-size:11px; color:var(--color-text-secondary); margin-top:auto;">Por: ${p.sellerName}</span>
        </div>
      </a>
    `).join('');
  };

  // Load products from Firestore
  try {
    const { where } = await import('firebase/firestore');
    const q = query(
      collection(db, 'marketplace_products'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderProducts();
  } catch (err) {
    console.error('Error fetching marketplace products:', err);
    listContainer.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--color-primary);">
        Error al cargar publicaciones. Intentá de nuevo.
      </div>
    `;
  }

  // Event Listeners
  searchInput.oninput = (e) => {
    searchQuery = e.target.value;
    renderProducts();
  };

  chips.forEach(chip => {
    chip.onclick = () => {
      chips.forEach(c => {
        c.classList.remove('active');
        c.style.background = 'var(--color-bg-secondary)';
        c.style.color = 'var(--color-text-secondary)';
        c.style.borderColor = 'var(--color-border)';
      });
      chip.classList.add('active');
      chip.style.background = 'var(--color-primary)';
      chip.style.color = 'white';
      chip.style.borderColor = 'transparent';

      filterCondition = chip.dataset.condition;
      renderProducts();
    };
  });

  return {
    cleanup: () => {}
  };
}
