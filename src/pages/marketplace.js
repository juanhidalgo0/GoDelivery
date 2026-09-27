import { db } from '../firebase.js';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';
import { goServiceHeader, goServiceHint, bindServiceHint, showGoInfoSheet } from '../components/service-screen.js';

export async function renderMarketplace(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  // Render template layout
  content.innerHTML = `
    <style>
      @keyframes marketSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes productFadeIn {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .product-card-animated {
        animation: productFadeIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
    </style>
    <div class="go-service-page marketplace-container">
      ${goServiceHeader({ eyebrow: 'Compra y venta entre vecinos', title: 'Market', infoId: 'marketplace-help-header-btn', infoLabel: '¿Cómo funciona el Market?' })}

      <!-- Search and Filter -->
      <div class="marketplace-filters" style="padding:12px 16px; background:var(--color-surface); border-bottom:1px solid var(--color-border); display:flex; flex-direction:column; gap:8px;">
        <div style="position:relative; width:100%;">
          <input type="text" id="market-search" placeholder="¿Qué estás buscando?" style="width:100%; height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 16px 0 40px; font-size:14px; background:var(--color-bg); color:var(--color-text); box-sizing:border-box;" />
          <div style="position:absolute; left:12px; top:12px; color:var(--color-text-secondary);">
            ${icon('search', 18) || '🔍'}
          </div>
        </div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding:4px 0; scrollbar-width:none;">
          <button class="filter-chip active" data-condition="all" style="background:var(--go-ink); color:white; border:none; border-radius:20px; padding:6px 14px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer;">Todos</button>          <button class="filter-chip" data-condition="new" style="background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border); border-radius:20px; padding:6px 14px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer;">Nuevos</button>
          <button class="filter-chip" data-condition="used" style="background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border); border-radius:20px; padding:6px 14px; font-size:12px; font-weight:700; white-space:nowrap; cursor:pointer;">Usados</button>
        </div>
      </div>

      ${goServiceHint({ id: 'market-hint', storageKey: 'info_seen_marketplace_v4' })}

      <!-- Products Grid -->
      <div id="market-products-list" style="flex:1; overflow-y:auto; padding:16px; display:grid; grid-template-columns:repeat(2, 1fr); gap:12px; align-content:start;">
        <div style="grid-column:1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; color:var(--color-text-secondary); gap:14px;">
          <div style="width:32px; height:32px; border:3px solid rgba(16,185,129,0.15); border-top-color:var(--go-ink); border-radius:50%; animation:marketSpin 0.75s linear infinite;"></div>
          <span style="font-size:13px; font-weight:600; color:var(--color-text-secondary);">Cargando publicaciones...</span>
        </div>
      </div>

      <div class="go-service-actionbar">
        <a href="#/profile/publications" class="is-secondary">${icon('tag', 18)} Mis publicaciones</a>
        <a href="#/marketplace/publish" class="is-primary">${icon('plus', 18)} Publicar</a>
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

    listContainer.innerHTML = filtered.map((p, index) => `
      <a href="#/marketplace/product/${p.id}" class="product-card-animated" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; overflow:hidden; text-decoration:none; color:inherit; display:flex; flex-direction:column; box-shadow:var(--shadow-sm); transition:transform 0.2s; animation-delay:${index * 0.035}s;">
        <div style="position:relative; width:100%; padding-top:100%; background:#f0f0f0;">
          <img src="${p.images?.[0] || '/logo.png'}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover;" />
          <div style="position:absolute; top:8px; left:8px; background:${p.condition === 'new' ? '#10B981' : '#F59E0B'}; color:white; font-size:10px; font-weight:800; padding:3px 8px; border-radius:8px; text-transform:uppercase;">
            ${p.condition === 'new' ? 'Nuevo' : 'Usado'}
          </div>
        </div>
        <div style="padding:10px; display:flex; flex-direction:column; gap:4px; flex:1;">
          <span style="font-family:var(--go-font); font-size:16px; font-weight:900; color:var(--go-text);">$${p.price}</span>
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
      chip.style.background = 'var(--go-ink)';
      chip.style.color = 'white';
      chip.style.borderColor = 'transparent';

      filterCondition = chip.dataset.condition;
      renderProducts();
    };
  });

  // Handle general info modal trigger for marketplace
  const showMarketplaceInfoModal = () => showGoInfoSheet({
    title: 'Market',
    intro: 'Comprá y vendé entre vecinos de Magdalena, sin intermediarios.',
    steps: [
      { title: 'Explorá lo que hay cerca', text: 'Ropa, tecnología, herramientas y más, nuevos o usados.' },
      { title: 'Hablá con quien vende', text: 'Coordinás precio, dudas y punto de encuentro por el chat de la app.' },
      { title: 'Publicá gratis', text: '¿Tenés algo para vender? Subilo en segundos con el botón Publicar.' },
    ],
  });

  const helpBtn = document.getElementById('marketplace-help-header-btn');
  if (helpBtn) {
    helpBtn.onclick = () => showMarketplaceInfoModal();
  }

  bindServiceHint('market-hint', () => showMarketplaceInfoModal());

  return {
    cleanup: () => {}
  };
}
