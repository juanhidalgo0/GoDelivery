
import { db } from '../firebase.js';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { icon, categoryIcon } from '../utils/icons.js';
import { formatPrice, isShopOpen } from '../utils/format.js';
import { getDocsOptimized } from '../utils/firestore-cache.js';
import { getFooterHTML } from '../components/footer.js';


export async function renderCategoryPage(categoryName, content) {
  if (categoryName && categoryName.toLowerCase() === 'gomarket') {
    try {
      const comSnap = await getDocsOptimized(collection(db, 'comercios'), 'gomarket_redirect_comercios', 900000);
      const goMarket = comSnap.docs.find(d => {
        const name = (d.data().name || '').toLowerCase();
        return name.includes('go!') && name.includes('market');
      });
      if (goMarket) {
        window.history.replaceState(null, '', `#/comercio/${goMarket.id}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
      }
    } catch (e) {
      console.warn('Error redirecting to GoMarket:', e);
    }
  }

  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  // Premium Header (Red)
  content.innerHTML = `
    <div class="category-page page-enter" style="display:flex; flex-direction:column; height: 100%; background: var(--color-bg); overflow: hidden;">
      
      <!-- Search Bar (Now in Content) -->
      <div style="padding: 16px 20px; background: var(--color-bg); z-index: 10; position: relative;">
         <div style="position: relative;">
           <input type="text" id="category-search" placeholder="Buscar en ${categoryName}..." style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border); background: var(--color-surface); padding: 0 44px; color: var(--color-text); font-size: 14px; font-weight: 600; outline: none; transition: all 0.3s; box-shadow: var(--shadow-sm);">
           <div style="position: absolute; left: 14px; top: 14px; color: var(--color-text-tertiary);">${icon('search', 18)}</div>
         </div>
      </div>

      <!-- Commerces List -->
      <div style="flex:1; overflow-y:auto; padding: 20px; -webkit-overflow-scrolling: touch;" id="category-comercios-grid">
        <div class="empty-state" style="padding-top: 40px;">Cargando comercios...</div>
      </div>
    </div>

    <style>
      #category-search::placeholder { color: rgba(255,255,255,0.6); }
      #category-search:focus { background: rgba(255,255,255,0.25); border-color: rgba(255,255,255,0.3); }
    </style>
  `;

  // Load Data
  try {
    const q = query(collection(db, 'comercios'), where('isActive', '==', true), where('category', '==', categoryName));
    const snap = await getDocsOptimized(q, `category_comercios_${categoryName}`, 900000);
    const comercios = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const renderList = (filtered) => {
      const grid = document.getElementById('category-comercios-grid');
      if (!grid) return;

      if (filtered.length === 0) {
        grid.innerHTML = `
          <div class="empty-state" style="padding-top: 40px;">
            <div class="empty-state-icon" style="color: var(--color-text-tertiary);">${icon('store', 48)}</div>
            <div class="empty-state-title" style="margin-top:16px;">No hay comercios</div>
            <div class="empty-state-text">Probá con otra categoría o búsqueda</div>
          </div>
        `;
        return;
      }

      grid.innerHTML = filtered.map((c, i) => {
        let isOpen = true;
        try {
          isOpen = isShopOpen(c.schedules || (c.schedule ? [c.schedule] : []));
        } catch (e) {}
        
        const isPaused = c.isPaused === true;
        const statusClass = isPaused ? 'paused' : (isOpen ? 'open' : 'closed');
        const statusText = isPaused ? 'Pausado' : (isOpen ? 'Abierto' : 'Cerrado');

        return `
          <a href="#/comercio/${c.id}" class="comercio-card card-interactive page-enter stagger-${Math.min(i+1, 5)}" style="display:flex; align-items:center; gap:16px; padding:16px; background:var(--color-surface); border-radius:24px; border:1px solid var(--color-border); margin-bottom:12px; text-decoration:none;">
            <div style="width:70px; height:70px; border-radius:18px; overflow:hidden; background:white; border:1px solid var(--color-border-light); flex-shrink:0; position:relative;">
              <img src="${c.logo || '/logo.png'}" alt="" style="width:100%; height:100%; object-fit:contain; padding:6px;" />
              <div style="position:absolute; bottom:0; left:0; right:0; height:4px; background:${isPaused ? '#94a3b8' : (isOpen ? '#22c55e' : '#ef4444')};"></div>
            </div>
            <div style="flex:1; min-width:0;">
              <h3 style="font-size:16px; font-weight:900; color:var(--color-text); margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.name}</h3>
              <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                <span style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">${icon('clock', 12)} ${c.deliveryTime || '20-35'} min</span>
                <span style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">${icon('bike', 12)} ${formatPrice(c.deliveryFee || 0)}</span>
              </div>
              <div style="margin-top:6px;">
                <span style="font-size:10px; font-weight:800; text-transform:uppercase; color:${isPaused ? '#64748b' : (isOpen ? '#16a34a' : '#dc2626')}; background:${isPaused ? 'rgba(100,116,139,0.1)' : (isOpen ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)')}; padding:3px 8px; border-radius:6px;">
                  ${statusText}
                </span>
              </div>
            </div>
            <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
          </a>
        `;
      }).join('') + getFooterHTML();
    };

    renderList(comercios);

    // Search
    document.getElementById('category-search').oninput = (e) => {
      const s = e.target.value.toLowerCase();
      const filtered = comercios.filter(c => c.name.toLowerCase().includes(s));
      renderList(filtered);
    };

  } catch (err) {
    console.error(err);
  }
}
