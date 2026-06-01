// GoDelivery — Comercio Categories Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, orderBy, getDoc } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { isAdmin } from '../../auth.js';

export async function renderComercioCategories() {
  const content = document.getElementById('app-content');
  const user = getState().user;
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;">
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:14px;padding:16px 20px;background:var(--color-surface);border-bottom:1px solid var(--color-border-light);box-shadow:0 2px 12px rgba(0,0,0,0.08);flex-shrink:0;">
        <a href="#/mi-comercio/${comercioId}/orders" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--color-bg-secondary);color:var(--color-text);border:1px solid var(--color-border-light);flex-shrink:0;">${icon('back', 18)}</a>
        <div style="flex:1;min-width:0;">
          <h1 style="font-family:var(--font-display);font-weight:800;font-size:18px;color:var(--color-text);margin:0;line-height:1.2;">Categorías</h1>
          <p id="panel-commerce-name" style="font-size:12px;color:var(--color-text-tertiary);margin:2px 0 0;"></p>
        </div>
        <button class="btn btn-primary btn-sm" id="add-cat-btn" style="border-radius:10px;font-size:12px;padding:8px 14px;">
          ${icon('plus', 14)} Agregar
        </button>
      </div>

      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <p style="color:var(--color-text-secondary);font-size:var(--font-sm);margin-bottom:var(--space-4);">
          Organizá tus productos en categorías para que tus clientes encuentren lo que buscan.
        </p>
        <div id="categories-list"></div>
      </div>
    </div>
  `;

  let categories = [];

  try {
    const comercioSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (!comercioSnap.exists()) {
      location.hash = '#/profile';
      return;
    }
    const comercioData = comercioSnap.data();
    if (comercioData.ownerId !== user.uid && !isAdmin()) {
      location.hash = '#/profile';
      return;
    }
    const nameContainer = document.getElementById('panel-commerce-name');
    if (nameContainer) nameContainer.textContent = comercioData.name;

    const snap = await getDocs(query(collection(db, 'comercios', comercioId, 'categories'), orderBy('order')));
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList(categories);
  } catch (e) {
    console.error('Error loading categories:', e);
    showToast('Error al cargar categorías', 'error');
    location.hash = '#/profile';
  }

  document.getElementById('add-cat-btn')?.addEventListener('click', () => {
    showCatModal(null, async (data) => {
      try {
        const newRef = doc(collection(db, 'comercios', comercioId, 'categories'));
        const catData = { name: data.name, order: categories.length, isActive: true };
        await setDoc(newRef, catData);
        categories.push({ id: newRef.id, ...catData });
        renderList(categories);
        showToast('Categoría creada', 'success');
      } catch (e) {
        showToast('Error al crear', 'error');
      }
    });
  });

  document.getElementById('categories-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');
    const toggleBtn = e.target.closest('[data-action="toggle"]');

    if (editBtn) {
      const cat = categories.find(c => c.id === editBtn.dataset.id);
      if (cat) {
        showCatModal(cat, async (data) => {
          try {
            await updateDoc(doc(db, 'comercios', comercioId, 'categories', cat.id), { name: data.name });
            cat.name = data.name;
            renderList(categories);
            showToast('Categoría actualizada', 'success');
          } catch (e) {
            showToast('Error', 'error');
          }
        });
      }
    }

    if (deleteBtn) {
      const cat = categories.find(c => c.id === deleteBtn.dataset.id);
      if (cat) {
        showConfirm({
          title: 'Eliminar categoría',
          message: `¿Eliminar "${cat.name}"?`,
          confirmText: 'Eliminar',
          danger: true,
          onConfirm: async () => {
            try {
              await deleteDoc(doc(db, 'comercios', comercioId, 'categories', cat.id));
              categories = categories.filter(c => c.id !== cat.id);
              renderList(categories);
              showToast('Categoría eliminada', 'info');
            } catch (e) {
              showToast('Error', 'error');
            }
          }
        });
      }
    }

    if (toggleBtn) {
      const cat = categories.find(c => c.id === toggleBtn.dataset.id);
      if (cat) {
        const newActive = cat.isActive === false;
        try {
          await updateDoc(doc(db, 'comercios', comercioId, 'categories', cat.id), { isActive: newActive });
          cat.isActive = newActive;
          renderList(categories);
        } catch (e) {
          showToast('Error', 'error');
        }
      }
    }
  });
}

function renderList(categories) {
  const container = document.getElementById('categories-list');
  if (!container) return;

  if (categories.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('tag', 40)}</div><div class="empty-state-title">Sin categorías</div><div class="empty-state-text">Creá categorías para organizar tus productos</div></div>`;
    return;
  }

  container.innerHTML = categories.map(c => `
    <div class="category-item" style="opacity:${c.isActive === false ? '0.5' : '1'};">
      <span class="category-item-name">${c.name}</span>
      ${c.isActive === false ? '<span class="badge badge-danger">Inactiva</span>' : ''}
      <div class="category-item-actions">
        <button class="btn btn-sm btn-ghost" data-action="toggle" data-id="${c.id}">${c.isActive === false ? icon('eye', 16) : icon('eye', 16)}</button>
        <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${c.id}">${icon('edit', 16)}</button>
        <button class="btn btn-sm btn-ghost" data-action="delete" data-id="${c.id}" style="color:var(--color-danger);">${icon('trash', 16)}</button>
      </div>
    </div>
  `).join('');
}

function showCatModal(category, onSave) {
  showModal({
    title: category ? 'Editar Categoría' : 'Nueva Categoría',
    content: `
      <div class="input-group">
        <label>Nombre</label>
        <input type="text" class="input" id="ccat-name" value="${category?.name || ''}" placeholder="Ej: Bebidas" />
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="ccat-cancel">Cancelar</button>
      <button class="btn btn-primary" id="ccat-save">Guardar</button>
    `
  });

  document.getElementById('ccat-cancel')?.addEventListener('click', closeModal);
  document.getElementById('ccat-save')?.addEventListener('click', () => {
    const name = document.getElementById('ccat-name')?.value.trim();
    if (!name) { showToast('Ingresá un nombre', 'warning'); return; }
    closeModal();
    onSave({ name });
  });
}
