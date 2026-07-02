// GoDelivery — Admin Reviews Panel
import { db } from '../../firebase.js';
import { collection, getDocs, doc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/modal.js';

export async function renderAdminReviews() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Red Premium Header -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <button onclick="location.hash='#/admin'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Reseñas de Usuarios</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Moderación de valoraciones y comentarios</p>
        </div>
      </div>

      <!-- Filters & Summary Stats -->
      <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border); flex-shrink:0; display:flex; flex-direction:column; gap:12px; padding:16px 20px;">
        <div style="display:flex; gap:10px;">
          <!-- Search input -->
          <div style="flex:2; background:var(--color-bg-secondary); border-radius:16px; height:46px; display:flex; align-items:center; padding:0 14px; gap:10px; border:1px solid var(--color-border); box-shadow:inset 0 2px 4px rgba(0,0,0,0.01);">
            <span style="color:var(--color-text-tertiary);">${icon('search', 18)}</span>
            <input type="text" id="admin-reviews-search" placeholder="Buscar por comercio o cliente..." style="flex:1; border:none; background:transparent; font-size:14px; font-weight:600; outline:none; color:var(--color-text);" />
          </div>

          <!-- Star filter -->
          <select id="admin-reviews-star-filter" style="flex:1; height:46px; border-radius:16px; border:1px solid var(--color-border); padding:0 12px; font-weight:700; font-size:13px; background:var(--color-bg-secondary); color:var(--color-text); outline:none; cursor:pointer;">
            <option value="all">Todas las estrellas</option>
            <option value="5">⭐⭐⭐⭐⭐ (5)</option>
            <option value="4">⭐⭐⭐⭐ (4)</option>
            <option value="3">⭐⭐⭐ (3)</option>
            <option value="2">⭐⭐ (2)</option>
            <option value="1">⭐ (1)</option>
          </select>
        </div>

        <!-- Global Summary Grid -->
        <div id="reviews-stats-summary" style="display:grid; grid-template-columns:1fr 1.2fr 1fr; gap:12px; background:var(--color-bg-secondary); border-radius:16px; padding:12px;">
          <div style="text-align:center;">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Total Reseñas</div>
            <div id="stat-total-reviews" style="font-size:18px; font-weight:900; color:var(--color-text); margin-top:2px;">--</div>
          </div>
          <div style="text-align:center; border-left:1px solid var(--color-border); border-right:1px solid var(--color-border);">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Promedio Global</div>
            <div id="stat-avg-rating" style="font-size:18px; font-weight:900; color:#FFC107; margin-top:2px; display:flex; align-items:center; justify-content:center; gap:4px;">
              <span>--</span> <span style="font-size:14px;">★</span>
            </div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Con Comentario</div>
            <div id="stat-commented-reviews" style="font-size:18px; font-weight:900; color:var(--color-text); margin-top:2px;">--</div>
          </div>
        </div>
      </div>

      <!-- Reviews list -->
      <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:14px; -webkit-overflow-scrolling:touch; background:var(--color-bg);">
        <div id="reviews-list">
          <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>
  `;

  let allReviews = [];

  const loadAndFilter = () => {
    const listContainer = document.getElementById('reviews-list');
    if (!listContainer) return;

    const queryStr = (document.getElementById('admin-reviews-search')?.value || '').toLowerCase();
    const starFilter = document.getElementById('admin-reviews-star-filter')?.value || 'all';

    const filtered = allReviews.filter(r => {
      const matchesSearch = 
        (r.userName || '').toLowerCase().includes(queryStr) || 
        (r.comercioName || '').toLowerCase().includes(queryStr) || 
        (r.comment || '').toLowerCase().includes(queryStr);
      
      const matchesStars = starFilter === 'all' || r.rating === parseInt(starFilter);

      return matchesSearch && matchesStars;
    });

    // Update Stats dynamically
    const total = filtered.length;
    const avg = total > 0 ? (filtered.reduce((sum, r) => sum + (r.rating || 0), 0) / total).toFixed(2) : '0.00';
    const commented = filtered.filter(r => r.comment && r.comment.trim().length > 0).length;

    document.getElementById('stat-total-reviews').textContent = total;
    document.getElementById('stat-avg-rating').querySelector('span').textContent = avg;
    document.getElementById('stat-commented-reviews').textContent = commented;

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding:48px 24px; color:var(--color-text-tertiary);">
          <div style="font-size:40px; margin-bottom:12px;">⭐</div>
          <div style="font-weight:700; font-size:15px;">No se encontraron reseñas</div>
          <div style="font-size:12px; margin-top:4px;">Probá ajustando el filtro de búsqueda.</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${filtered.map(r => {
          const dateStr = r.createdAt && r.createdAt.seconds ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('es-AR', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          }) : 'Reciente';

          const starsHtml = Array(5).fill(0).map((_, i) => `
            <span style="color:${i < r.rating ? '#FFC107' : '#D1D5DB'}; font-size:16px;">★</span>
          `).join('');

          return `
            <div class="admin-review-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:18px; display:flex; flex-direction:column; gap:12px; position:relative; transition:all 0.2s; box-shadow:var(--shadow-xs);">
              
              <!-- Card Header -->
              <div style="display:flex; justify-content:space-between; align-items:start; gap:12px;">
                <div>
                  <div style="font-weight:900; font-size:15px; color:var(--color-text);">${r.userName || 'Cliente'}</div>
                  <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-top:2px;">
                    Calificó a: <span style="color:var(--color-primary); font-weight:900;">${r.comercioName || 'Comercio'}</span>
                  </div>
                </div>
                <button class="delete-review-btn" data-id="${r.id}" style="width:36px; height:36px; border-radius:10px; border:none; background:var(--color-danger-light, rgba(239,68,68,0.1)); color:var(--color-danger, #EF4444); display:flex; align-items:center; justify-content:center; cursor:pointer;">
                  ${icon('trash', 16)}
                </button>
              </div>

              <!-- Rating Stars & Date -->
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="display:flex;">${starsHtml}</div>
                <span style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); margin-left:auto;">${dateStr}</span>
              </div>

              <!-- Comment Bubble (Administrators Only - Secret from shops/clients) -->
              <div style="background:var(--color-bg-secondary); border-radius:14px; padding:12px 14px; border:1px dashed var(--color-border); font-size:13px; font-weight:600; line-height:1.5; color:var(--color-text-secondary); position:relative;">
                ${r.comment && r.comment.trim() ? r.comment : `<span style="font-style:italic; opacity:0.6; font-weight:500;">(Calificó sin escribir una opinión escrita)</span>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Bind delete buttons
    listContainer.querySelectorAll('.delete-review-btn').forEach(btn => {
      btn.onclick = () => {
        const review = allReviews.find(r => r.id === btn.dataset.id);
        if (!review) return;
        
        showConfirm({
          title: '¿Eliminar reseña?',
          message: `¿Estás seguro de que querés borrar la reseña de "${review.userName}" para "${review.comercioName}"? Esta acción no se puede deshacer.`,
          confirmText: 'Sí, eliminar',
          cancelText: 'Cancelar',
          danger: true,
          onConfirm: async () => {
            try {
              await deleteDoc(doc(db, 'reviews', review.id));
              showToast('Reseña eliminada correctamente', 'success');
              refreshData();
            } catch (err) {
              console.error('Error deleting review:', err);
              showToast('Error al borrar la reseña', 'danger');
            }
          }
        });
      };
    });
  };

  const refreshData = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'reviews')));
      allReviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Sort reviews by creation date descending
      allReviews.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });

      loadAndFilter();
    } catch (err) {
      console.error('Error loading reviews:', err);
      const container = document.getElementById('reviews-list');
      if (container) {
        container.innerHTML = `<div style="color:var(--color-danger); text-align:center; font-weight:700; padding:20px;">Error al cargar las reseñas de la base de datos</div>`;
      }
    }
  };

  // Initial load
  await refreshData();

  // Attach search listeners
  document.getElementById('admin-reviews-search')?.addEventListener('input', loadAndFilter);
  document.getElementById('admin-reviews-star-filter')?.addEventListener('change', loadAndFilter);
}
