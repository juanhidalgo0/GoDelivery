// GoDelivery — Admin Platform Categories
import { db } from '../../firebase.js';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';

const DEFAULT_ICONS = {
  'Comida': '🍕', 'Carnicería': '🥩', 'Pollería': '🍗', 'Verdulería': '🥬', 'Almacén': '🏪',
  'Librería': '📚', 'Farmacia': '💊', 'Kiosco': '🍬', 'Supermercado': '🛒',
  'Fiambrería': '🧀', 'Panadería': '🥐', 'Restaurante': '🍽️', 'Heladería': '🍦',
  'Bebidas': '🥤', 'Ferretería': '🔧', 'Veterinaria': '🐾', 'Electrónica': '📱'
};

function categoryIcon(name, size = 20) {
  const emoji = DEFAULT_ICONS[name] || '📦';
  return `<span style="font-size:${size}px;">${emoji}</span>`;
}

export async function renderAdminCategories() {
  const content = document.getElementById('app-content');

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:var(--color-bg);">
      <!-- Fixed Header -->
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:14px;padding:16px 20px;background:var(--color-primary);flex-shrink:0;position:relative;overflow:hidden;box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;position:relative;z-index:2;">${icon('chevronLeft', 24)}</a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Categorías</h1>
          <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Organización global</p>
        </div>
        <button id="add-category-btn" style="width:40px; height:40px; border-radius:12px; border:none; background:rgba(255,255,255,0.15); color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; position:relative; z-index:2;">
          ${icon('plus', 20)}
        </button>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div id="categories-list" style="display:flex; flex-direction:column; gap:12px;">
          ${Array(5).fill('<div class="stat-card skeleton" style="height:70px;"></div>').join('')}
        </div>
      </div>
    </div>
  `;

  let categories = [];
  
  try {
    const snap = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // If no categories exist, seed default ones
    if (categories.length === 0) {
      await seedDefaultCategories();
      const snap2 = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
      categories = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Ensure "Comida" exists in the local list for admin
    if (!categories.some(c => c.name === 'Comida')) {
      const { setDoc, doc: fDoc } = await import('firebase/firestore');
      await setDoc(fDoc(db, 'platformCategories', 'comida'), {
        name: 'Comida',
        icon: '🍕',
        order: -1,
        isActive: true
      });
      categories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1, isActive: true });
    }
    
    // Cleanup duplicate "Comidas" if it exists
    const duplicateIndex = categories.findIndex(c => c.name === 'Comidas');
    if (duplicateIndex !== -1) {
      const { deleteDoc, doc: fDoc } = await import('firebase/firestore');
      const dup = categories[duplicateIndex];
      await deleteDoc(fDoc(db, 'platformCategories', dup.id));
      categories.splice(duplicateIndex, 1);
    }
    
    renderCategoriesList(categories);
  } catch (e) {
    console.error('Error loading categories:', e);
    showToast('Error al cargar categorías', 'error');
  }

  // Add category
  document.getElementById('add-category-btn')?.addEventListener('click', () => {
    showCategoryModal(null, async (data) => {
      try {
        const newId = data.name.toLowerCase().replace(/\s+/g, '-');
        await setDoc(doc(db, 'platformCategories', newId), {
          name: data.name,
          icon: data.icon || DEFAULT_ICONS[data.name] || '📦',
          order: categories.length,
          isActive: true
        });
        categories.push({ id: newId, name: data.name, icon: data.icon || '📦', order: categories.length, isActive: true });
        renderCategoriesList(categories);
        showToast('Categoría creada', 'success');
      } catch (e) {
        showToast('Error al crear categoría', 'error');
      }
    });
  });

  // Click handlers
  document.getElementById('categories-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');
    const toggleBtn = e.target.closest('[data-action="toggle"]');

    if (editBtn) {
      const cat = categories.find(c => c.id === editBtn.dataset.id);
      if (cat) {
        showCategoryModal(cat, async (data) => {
          try {
            await updateDoc(doc(db, 'platformCategories', cat.id), { name: data.name, icon: data.icon });
            cat.name = data.name;
            cat.icon = data.icon;
            renderCategoriesList(categories);
            showToast('Categoría actualizada', 'success');
          } catch (e) {
            showToast('Error al actualizar', 'error');
          }
        });
      }
    }

    if (deleteBtn) {
      const cat = categories.find(c => c.id === deleteBtn.dataset.id);
      if (cat) {
        showConfirm({
          title: 'Eliminar categoría',
          message: `¿Eliminar "${cat.name}"? Los comercios con esta categoría no serán afectados.`,
          confirmText: 'Eliminar',
          danger: true,
          onConfirm: async () => {
            try {
              await deleteDoc(doc(db, 'platformCategories', cat.id));
              categories = categories.filter(c => c.id !== cat.id);
              renderCategoriesList(categories);
              showToast('Categoría eliminada', 'info');
            } catch (e) {
              showToast('Error al eliminar', 'error');
            }
          }
        });
      }
    }

    if (toggleBtn) {
      const cat = categories.find(c => c.id === toggleBtn.dataset.id);
      if (cat) {
        const newActive = cat.isActive === false ? true : false;
        try {
          await updateDoc(doc(db, 'platformCategories', cat.id), { isActive: newActive });
          cat.isActive = newActive;
          renderCategoriesList(categories);
          showToast(newActive ? 'Categoría activada' : 'Categoría desactivada', 'info');
        } catch (e) {
          showToast('Error', 'error');
        }
      }
    }
  });
}

function renderCategoriesList(categories) {
  const container = document.getElementById('categories-list');
  if (!container) return;

  if (categories.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('folder', 40)}</div><div class="empty-state-title">Sin categorías</div></div>`;
    return;
  }

  container.innerHTML = categories.map(c => `
    <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px; display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:var(--shadow-sm); opacity:${c.isActive === false ? '0.6' : '1'};">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:48px; height:48px; border-radius:14px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${categoryIcon(c.name, 24)}
        </div>
        <div>
          <div style="font-weight:800; font-size:16px; color:var(--color-text);">${c.name}</div>
          ${c.isActive === false ? '<span style="font-size:10px; font-weight:800; color:var(--color-danger); text-transform:uppercase; letter-spacing:0.5px;">Inactiva</span>' : '<span style="font-size:10px; font-weight:800; color:rgba(34,197,94,1); text-transform:uppercase; letter-spacing:0.5px;">Activa</span>'}
        </div>
      </div>
      
      <div style="display:flex; gap:6px;">
        <button style="width:36px; height:36px; border-radius:10px; border:none; background:var(--color-bg-secondary); color:var(--color-text-tertiary); cursor:pointer; display:flex; align-items:center; justify-content:center;" data-action="toggle" data-id="${c.id}" title="${c.isActive === false ? 'Activar' : 'Desactivar'}">
          ${icon('eye', 18)}
        </button>
        <button style="width:36px; height:36px; border-radius:10px; border:none; background:var(--color-bg-secondary); color:var(--color-text-tertiary); cursor:pointer; display:flex; align-items:center; justify-content:center;" data-action="edit" data-id="${c.id}" title="Editar">
          ${icon('edit', 18)}
        </button>
        <button style="width:36px; height:36px; border-radius:10px; border:none; background:var(--color-bg-secondary); color:var(--color-danger); cursor:pointer; display:flex; align-items:center; justify-content:center;" data-action="delete" data-id="${c.id}" title="Eliminar">
          ${icon('trash', 18)}
        </button>
      </div>
    </div>
  `).join('');
}

function showCategoryModal(category, onSave) {
  showModal({
    title: category ? 'Editar Categoría' : 'Nueva Categoría',
    content: `
      <div class="panel-form">
        <div class="input-group">
          <label>Nombre</label>
          <input type="text" class="input" id="cat-name" value="${category?.name || ''}" placeholder="Ej: Panadería" />
        </div>
        <div class="input-group">
          <label>Ícono (emoji)</label>
          <input type="text" class="input" id="cat-icon" value="${category?.icon || ''}" placeholder="Ej: 🥐" maxlength="4" />
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="cat-cancel">Cancelar</button>
      <button class="btn btn-primary" id="cat-save">Guardar</button>
    `
  });

  document.getElementById('cat-cancel')?.addEventListener('click', closeModal);
  document.getElementById('cat-save')?.addEventListener('click', () => {
    const name = document.getElementById('cat-name')?.value.trim();
    const icon = document.getElementById('cat-icon')?.value.trim();
    if (!name) {
      showToast('Ingresá un nombre', 'warning');
      return;
    }
    closeModal();
    onSave({ name, icon: icon || DEFAULT_ICONS[name] || '📦' });
  });
}

async function seedDefaultCategories() {
  const defaults = [
    'Comida', 'Heladería', 'Carnicería', 'Pollería', 'Verdulería', 'Almacén', 'Librería',
    'Farmacia', 'Kiosco', 'Supermercado', 'Fiambrería', 'Bebidas'
  ];
  
  for (let i = 0; i < defaults.length; i++) {
    const name = defaults[i];
    const id = name.toLowerCase().replace(/\s+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    await setDoc(doc(db, 'platformCategories', id), {
      name,
      icon: DEFAULT_ICONS[name] || '📦',
      order: i,
      isActive: true
    });
  }
}
