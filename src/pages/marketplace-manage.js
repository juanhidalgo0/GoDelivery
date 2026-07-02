import { db } from '../firebase.js';
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getState } from '../state.js';
import { icon } from '../utils/icons.js';

export async function renderMyPublications(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const currentUser = getState().user;
  if (!currentUser) {
    window.location.hash = '#/profile';
    return;
  }

  // Header and layout with Normal container (to prevent duplication / fullscreen overlap)
  content.innerHTML = `
    <div class="my-publications-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative; box-sizing:border-box;">
      <!-- Header (Red Premium style) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <a href="#/marketplace" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Mis Publicaciones</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Marketplace</p>
        </div>
      </div>

      <!-- List -->
      <div id="my-publications-list" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; box-sizing:border-box;">
        <div style="text-align:center; padding:40px; color:var(--color-text-secondary);">
          Cargando tus publicaciones...
        </div>
      </div>
    </div>
  `;

  const listContainer = content.querySelector('#my-publications-list');

  const loadPublications = async () => {
    try {
      const q = query(
        collection(db, 'marketplace_products'),
        where('sellerId', '==', currentUser.uid)
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (items.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align:center; padding:60px 20px; color:var(--color-text-secondary);">
            <div style="font-size:40px; margin-bottom:12px;">📦</div>
            <p style="margin:0; font-weight:700; color:var(--color-text);">No tenés publicaciones activas</p>
            <a href="#/marketplace/publish" style="margin-top:16px; display:inline-block; background:var(--color-primary); color:white; border-radius:10px; padding:10px 20px; text-decoration:none; font-weight:700;">Publicar un producto</a>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = items.map(item => `
        <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; padding:12px; display:flex; gap:12px; align-items:center; box-shadow:var(--shadow-sm);">
          <img src="${item.images?.[0] || '/logo.png'}" style="width:64px; height:64px; border-radius:12px; object-fit:cover; border:1px solid var(--color-border);" />
          <div style="flex:1; min-width:0;">
            <h4 style="font-size:14px; font-weight:800; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--color-text);">${item.title}</h4>
            <span style="font-size:14px; font-weight:900; color:var(--color-primary); display:block; margin-top:2px;">$${item.price}</span>
            <div style="margin-top:4px; display:flex; gap:6px;">
              <span style="font-size:9.5px; font-weight:900; padding:2px 6px; border-radius:4px; text-transform:uppercase; 
                background:${item.status === 'active' ? 'rgba(16, 185, 129, 0.1)' : item.status === 'pending' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)'};
                color:${item.status === 'active' ? '#10B981' : item.status === 'pending' ? '#F59E0B' : '#EF4444'};
              ">
                ${item.status === 'active' ? 'Activo' : item.status === 'pending' ? 'Pendiente' : 'Rechazado'}
              </span>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button class="edit-pub-btn" data-id="${item.id}" style="height:32px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text); font-size:11px; font-weight:800; cursor:pointer; padding:0 12px; display:flex; align-items:center; gap:4px;">
              ${icon('edit', 12)} Editar
            </button>
            <button class="delete-pub-btn" data-id="${item.id}" style="height:32px; border-radius:8px; border:none; background:rgba(239, 68, 68, 0.1); color:#EF4444; font-size:11px; font-weight:800; cursor:pointer; padding:0 12px; display:flex; align-items:center; gap:4px;">
              ${icon('trash', 12) || icon('delete', 12) || '🗑️'} Borrar
            </button>
          </div>
        </div>
      `).join('');

      // Add actions event listeners
      listContainer.querySelectorAll('.edit-pub-btn').forEach(btn => {
        btn.onclick = () => showEditModal(items.find(i => i.id === btn.dataset.id));
      });

      listContainer.querySelectorAll('.delete-pub-btn').forEach(btn => {
        btn.onclick = () => showDeleteConfirmModal(btn.dataset.id);
      });

    } catch (err) {
      console.error(err);
      listContainer.innerHTML = `<div style="text-align:center; color:var(--color-primary);">Error al cargar publicaciones.</div>`;
    }
  };

  const showDeleteConfirmModal = (productId) => {
    const confirmEl = document.createElement('div');
    confirmEl.style.cssText = 'padding:24px; display:flex; flex-direction:column; gap:16px; text-align:center; background:var(--color-bg);';
    confirmEl.innerHTML = `
      <div style="width:56px; height:56px; background:rgba(239,68,68,0.1); color:#EF4444; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 8px;">
        ${icon('trash', 28) || '🗑️'}
      </div>
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text);">¿Eliminar publicación?</h3>
      <p style="font-size:14px; color:var(--color-text-secondary); margin:0; line-height:1.5;">Esta acción es irreversible. Se removerá el producto y ya no estará disponible en el Marketplace.</p>
      <div style="display:flex; gap:12px; margin-top:8px;">
        <button id="btn-cancel-delete" style="flex:1; height:46px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text); font-weight:700; cursor:pointer;">Cancelar</button>
        <button id="btn-confirm-delete" style="flex:1; height:46px; border-radius:12px; border:none; background:#EF4444; color:white; font-weight:800; cursor:pointer;">Eliminar</button>
      </div>
    `;

    import('../components/modal.js').then(m => {
      m.showModal({
        title: '',
        content: confirmEl,
        height: 'auto',
        hideHeader: true,
        onOpen: () => {
          confirmEl.querySelector('#btn-cancel-delete').onclick = () => m.closeModal();
          confirmEl.querySelector('#btn-confirm-delete').onclick = async () => {
            try {
              await deleteDoc(doc(db, 'marketplace_products', productId));
              m.closeModal();
              loadPublications();
            } catch (err) {
              console.error(err);
            }
          };
        }
      });
    });
  };

  const showEditModal = (item) => {
    const modalEl = document.createElement('div');
    modalEl.style.cssText = 'padding:20px; display:flex; flex-direction:column; gap:12px; background:var(--color-bg);';
    modalEl.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text);">Editar Publicación</h3>
      <input type="text" id="edit-title" value="${item.title}" style="height:44px; border-radius:10px; border:1px solid var(--color-border); padding:0 12px; font-size:14px; background:var(--color-surface); color:var(--color-text);" />
      <input type="number" id="edit-price" value="${item.price}" style="height:44px; border-radius:10px; border:1px solid var(--color-border); padding:0 12px; font-size:14px; background:var(--color-surface); color:var(--color-text);" />
      <textarea id="edit-desc" style="height:100px; border-radius:10px; border:1px solid var(--color-border); padding:10px; font-size:14px; background:var(--color-surface); color:var(--color-text); resize:none;">${item.description}</textarea>
      <button id="btn-save-edit" style="height:48px; background:var(--color-primary); color:white; border:none; border-radius:12px; font-weight:800; cursor:pointer;">Guardar Cambios</button>
    `;

    import('../components/modal.js').then(m => {
      m.showModal({
        title: '',
        content: modalEl,
        height: 'auto',
        hideHeader: true,
        onOpen: () => {
          modalEl.querySelector('#btn-save-edit').onclick = async () => {
            const title = modalEl.querySelector('#edit-title').value.trim();
            const price = parseFloat(modalEl.querySelector('#edit-price').value);
            const description = modalEl.querySelector('#edit-desc').value.trim();

            if (!title || isNaN(price) || !description) return;

            try {
              await updateDoc(doc(db, 'marketplace_products', item.id), {
                title,
                price,
                description,
                status: 'pending' // Resubmit to pending approval on edit
              });
              m.closeModal();
              alert('Publicación editada. Será revisada por un administrador antes de mostrarse.');
              loadPublications();
            } catch (err) {
              console.error(err);
            }
          };
        }
      });
    });
  };

  loadPublications();

  return {
    cleanup: () => {}
  };
}
