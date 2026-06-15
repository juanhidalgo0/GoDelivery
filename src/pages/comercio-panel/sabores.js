// GoDelivery — Commerce Ice Cream Flavors & Food Varieties Management
import { db } from '../../firebase.js';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { isAdmin } from '../../auth.js';

export async function renderComercioSabores() {
  const content = document.getElementById('app-content');
  const user = getState().user;
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:var(--color-bg-secondary);">
      <!-- Fixed Header -->
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;height:64px;padding:0 16px;background:var(--color-primary);box-shadow:0 4px 12px rgba(0,0,0,0.1);flex-shrink:0;overflow:hidden;color:white;">
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:12px;position:relative;z-index:2;flex:1;min-width:0;">
          <a href="#/mi-comercio/${comercioId}" style="display:flex;align-items:center;justify-content:center;background:none;border:none;color:white;cursor:pointer;padding:0;text-decoration:none;">
            ${icon('chevronLeft', 28)}
          </a>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;">
            <span id="sabores-title-text" style="font-weight:800;font-size:20px;color:white;letter-spacing:-0.02em;">Gestor de Sabores</span>
            <p id="sabores-commerce-name" style="font-size:11px;color:rgba(255,255,255,0.85);margin:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Cargando...</p>
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; position:relative; z-index:2;">
          <button class="hdr-icon-btn" id="add-sabor-btn" title="Agregar Sabor" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.1);color:white;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;transition:all 0.2s;">
            ${icon('plus', 18)}
          </button>
        </div>
      </div>

      <!-- Search & Main Body -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:16px;">
        <div class="search-bar" style="margin-bottom:4px;">
          <span class="search-icon">${icon('search', 20)}</span>
          <input type="text" id="sabores-search" placeholder="Buscar sabores..." />
        </div>

        <div id="sabores-container" style="flex:1; display:flex; flex-direction:column; gap:16px;">
          <div class="skeleton" style="height:100px; border-radius:16px;"></div>
          <div class="skeleton" style="height:100px; border-radius:16px;"></div>
        </div>
      </div>
    </div>
  `;

  let sabores = [];
  let isHeladeria = true; // Dynamic category detection
  const comercioRef = doc(db, 'comercios', comercioId);
  
  const unsubscribe = onSnapshot(comercioRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      sabores = data.sabores || [];
      isHeladeria = (data.category || '').toLowerCase().includes('helad');

      // Update Header Text and Placeholders dynamically based on category
      const titleEl = document.getElementById('sabores-title-text');
      if (titleEl) titleEl.textContent = isHeladeria ? 'Gestor de Sabores' : 'Gustos y Variedades';
      
      const searchInput = document.getElementById('sabores-search');
      if (searchInput) searchInput.placeholder = isHeladeria ? 'Buscar sabores...' : 'Buscar gustos y variedades...';

      const el = document.getElementById('sabores-commerce-name');
      if (el) el.textContent = isAdmin() ? `Adm: ${data.name}` : data.name;
      
      renderFlavors(sabores, document.getElementById('sabores-search')?.value || '');
    }
  }, (err) => {
    console.error('[Sabores] Permission or fetch error:', err);
    showToast('Error de permisos al cargar sabores.', 'error');
  });

  // Filter search
  document.getElementById('sabores-search')?.addEventListener('input', (e) => {
    renderFlavors(sabores, e.target.value);
  });

  // Add flavor button click
  document.getElementById('add-sabor-btn')?.addEventListener('click', () => {
    openAddSaborModal();
  });

  function renderFlavors(list, searchFilter = '') {
    const container = document.getElementById('sabores-container');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:24px; border:1px dashed var(--color-border-light); display:flex; flex-direction:column; gap:16px; align-items:center; justify-content:center;">
          <span style="font-size:48px;">${isHeladeria ? '🍦' : '🍕'}</span>
          <div style="font-weight:800; font-size:16px; color:var(--color-text);">${isHeladeria ? 'No tenés sabores cargados' : 'No tenés gustos ni variedades'}</div>
          <p style="font-size:12px; max-width:280px; margin:0; line-height:1.5; font-weight:600;">
            ${isHeladeria ? 'Cargá tu lista de sabores tradicionales para habilitar/deshabilitar con un solo switch.' : 'Cargá tu lista de gustos y rellenos tradicionales para habilitar/deshabilitar fácilmente.'}
          </p>
          <button class="btn btn-primary" id="load-default-flavors-btn" style="height:44px; border-radius:12px; font-weight:800; padding:0 20px;">
            ${isHeladeria ? 'Cargar sabores tradicionales' : 'Cargar gustos tradicionales'}
          </button>
        </div>
      `;
      
      document.getElementById('load-default-flavors-btn')?.addEventListener('click', loadDefaultFlavors);
      return;
    }

    let filtered = list;
    if (searchFilter) {
      const q = searchFilter.toLowerCase().trim();
      filtered = filtered.filter(s => s.name.toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q));
    }

    // Group flavors by category
    const groups = {};
    filtered.forEach(s => {
      const cat = s.category || (isHeladeria ? 'Otros Sabores' : 'Otras Variedades');
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    });

    // Sort categories alphabetically
    const sortedCategories = Object.keys(groups).sort();

    container.innerHTML = sortedCategories.map(cat => {
      const flavorItems = groups[cat].sort((a,b) => a.name.localeCompare(b.name));
      
      return `
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow:var(--shadow-sm);">
          <div style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-primary); letter-spacing:-0.01em; border-bottom:1px solid var(--color-border-light); padding-bottom:8px; display:flex; align-items:center; justify-content:between;">
            <span>${cat}</span>
            <span style="font-size:11px; font-weight:800; background:var(--color-bg-secondary); color:var(--color-text-secondary); padding:2px 8px; border-radius:100px; margin-left:auto;">${flavorItems.length}</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${flavorItems.map(f => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--color-bg-secondary); margin-bottom:-1px;">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  <span style="font-size:14px; font-weight:750; color:${f.isAvailable ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)'}; text-decoration:${f.isAvailable ? 'none' : 'line-through'}; text-align:left;">
                    ${f.name}
                  </span>
                </div>
                <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
                  <!-- Availability Toggle -->
                  <label class="sabor-switch" style="width:40px; height:22px; cursor:pointer; position:relative; display:inline-block; margin:0;">
                    <input type="checkbox" class="sabor-availability-toggle" data-id="${f.id}" ${f.isAvailable ? 'checked' : ''} style="opacity:0; width:0; height:0;" />
                    <span class="sabor-slider" style="position:absolute; inset:0; background-color:#cbd5e1; border-radius:34px; transition:0.2s; cursor:pointer;"></span>
                  </label>
                  
                  <button class="btn-delete-sabor" data-id="${f.id}" style="border:none; background:none; color:var(--color-text-tertiary); cursor:pointer; padding:4px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--color-text-tertiary)'">
                    ${icon('trash', 15)}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Apply Switch CSS Styles dynamically
    if (!document.getElementById('sabor-switch-styles')) {
      const style = document.createElement('style');
      style.id = 'sabor-switch-styles';
      style.innerHTML = `
        .sabor-switch input:checked + .sabor-slider { background-color: var(--color-success) !important; }
        .sabor-switch .sabor-slider:before {
          position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px;
          background-color: white; border-radius: 50%; transition: 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .sabor-switch input:checked + .sabor-slider:before { transform: translateX(18px); }
      `;
      document.head.appendChild(style);
    }

    // Toggle listener
    container.querySelectorAll('.sabor-availability-toggle').forEach(input => {
      input.onchange = async () => {
        const id = input.dataset.id;
        const checked = input.checked;
        try {
          const updatedSabores = sabores.map(f => f.id === id ? { ...f, isAvailable: checked } : f);
          await updateDoc(comercioRef, { sabores: updatedSabores });
          showToast(checked ? (isHeladeria ? 'Sabor disponible' : 'Gusto disponible') : (isHeladeria ? 'Sabor no disponible (agotado)' : 'Gusto no disponible (agotado)'), 'success');
        } catch (e) {
          showToast('Error al actualizar disponibilidad', 'error');
          input.checked = !checked;
        }
      };
    });

    // Delete listener
    container.querySelectorAll('.btn-delete-sabor').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const flavor = list.find(s => s.id === id);
        showConfirm({
          title: isHeladeria ? 'Eliminar Sabor' : 'Eliminar Gusto/Variedad',
          message: `¿Querés eliminar permanentemente ${isHeladeria ? 'el sabor' : 'el gusto/variedad'} <b>${flavor.name}</b> de tu lista?`,
          danger: true,
          confirmText: 'Eliminar',
          onConfirm: async () => {
            const updatedSabores = sabores.filter(f => f.id !== id);
            await updateDoc(comercioRef, { sabores: updatedSabores });
            showToast(isHeladeria ? 'Sabor eliminado' : 'Variedad eliminada', 'info');
          }
        });
      };
    });
  }

  async function loadDefaultFlavors() {
    const iceCreamDefaults = [
      // Cremas
      { name: 'Tramontana', category: 'Cremas' },
      { name: 'Crema Americana', category: 'Cremas' },
      { name: 'Vainilla', category: 'Cremas' },
      { name: 'Frutilla a la Crema', category: 'Cremas' },
      { name: 'Sambayón', category: 'Cremas' },
      { name: 'Granizado', category: 'Cremas' },
      
      // Dulces de Leche
      { name: 'Dulce de Leche Tradicional', category: 'Dulces de Leche' },
      { name: 'Dulce de Leche Granizado', category: 'Dulces de Leche' },
      { name: 'Dulce de Leche con Brownie', category: 'Dulces de Leche' },
      { name: 'Dulce de Leche con Almendras', category: 'Dulces de Leche' },
      
      // Chocolates
      { name: 'Chocolate Clásico', category: 'Chocolates' },
      { name: 'Chocolate con Almendras', category: 'Chocolates' },
      { name: 'Chocolate Suizo', category: 'Chocolates' },
      { name: 'Chocolate Blanco', category: 'Chocolates' },
      
      // Al Agua
      { name: 'Limón al Agua', category: 'Frutales al Agua' },
      { name: 'Frutilla al Agua', category: 'Frutales al Agua' },
      { name: 'Durazno al Agua', category: 'Frutales al Agua' }
    ];

    const foodDefaults = [
      // Pizzas
      { name: 'Muzzarella', category: 'Pizzas' },
      { name: 'Fugazzeta', category: 'Pizzas' },
      { name: 'Napolitana', category: 'Pizzas' },
      { name: 'Especial (Jamón y Morrón)', category: 'Pizzas' },
      { name: 'Calabresa', category: 'Pizzas' },
      { name: 'Cuatro Quesos', category: 'Pizzas' },
      { name: 'Jamón y Huevo', category: 'Pizzas' },
      { name: 'Provolone', category: 'Pizzas' },
      
      // Empanadas
      { name: 'Carne Suave', category: 'Empanadas' },
      { name: 'Carne Cortada a Cuchillo', category: 'Empanadas' },
      { name: 'Carne Picante', category: 'Empanadas' },
      { name: 'Jamón y Queso', category: 'Empanadas' },
      { name: 'Pollo', category: 'Empanadas' },
      { name: 'Humita', category: 'Empanadas' },
      { name: 'Caprese', category: 'Empanadas' },
      { name: 'Verdura', category: 'Empanadas' },
      { name: 'Roquefort y Jamón', category: 'Empanadas' }
    ];

    const defaults = isHeladeria ? iceCreamDefaults : foodDefaults;

    try {
      showToast('Cargando catálogo...', 'info');
      const newSabores = defaults.map(item => ({
        id: Math.random().toString(36).substr(2, 9),
        name: item.name,
        category: item.category,
        isAvailable: true,
        createdAt: new Date().toISOString()
      }));
      await updateDoc(comercioRef, { sabores: newSabores });
      showToast(isHeladeria ? 'Catálogo tradicional cargado' : 'Gustos tradicionales cargados', 'success');
    } catch (e) {
      console.error(e);
      showToast('Error al cargar catálogo', 'error');
    }
  }

  function openAddSaborModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'panel-form';
    modalContent.style.padding = '16px 20px 24px 20px';

    modalContent.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="input-group">
          <label>${isHeladeria ? 'Nombre del Sabor *' : 'Nombre del Gusto/Variedad *'}</label>
          <input type="text" class="input-premium" id="new-sabor-name" placeholder="${isHeladeria ? 'Ej: Super Chocolate con Nutella' : 'Ej: Jamón, Queso y Huevo'}" />
        </div>
        <div class="input-group">
          <label>Categoría *</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <select class="input-premium" id="new-sabor-cat" style="flex:1;">
              ${isHeladeria ? `
                <option value="Cremas">Cremas</option>
                <option value="Chocolates">Chocolates</option>
                <option value="Dulces de Leche">Dulces de Leche</option>
                <option value="Frutales al Agua">Frutales al Agua</option>
                <option value="Especiales">Especiales</option>
              ` : `
                <option value="Pizzas">Pizzas</option>
                <option value="Empanadas">Empanadas</option>
                <option value="Rellenos">Rellenos</option>
                <option value="Ingredientes">Ingredientes</option>
                <option value="Especiales">Especiales</option>
              `}
            </select>
            <button class="btn btn-outline" id="new-sabor-cat-custom-btn" style="height:48px; width:48px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:12px; border:1.5px solid #e2e8f0; background:#f8fafc; color:var(--color-text-primary); cursor:pointer;">
              ${icon('plus', 18)}
            </button>
          </div>
        </div>
      </div>
    `;

    showModal({
      title: isHeladeria ? 'Agregar Sabor' : 'Agregar Gusto/Variedad',
      content: modalContent,
      height: 'auto',
      footer: `
        <button class="btn btn-ghost" id="add-sabor-cancel">Cancelar</button>
        <button class="btn btn-primary" id="add-sabor-save">Guardar</button>
      `
    });

    document.getElementById('add-sabor-cancel')?.addEventListener('click', closeModal);

    // Custom category button
    document.getElementById('new-sabor-cat-custom-btn')?.addEventListener('click', () => {
      const customCat = prompt(isHeladeria ? 'Escribe el nombre de la nueva categoría (ej: Veganos, Sin TACC):' : 'Escribe el nombre de la nueva categoría (ej: Calzones, Tartas):');
      if (customCat && customCat.trim()) {
        const sel = document.getElementById('new-sabor-cat');
        const opt = document.createElement('option');
        opt.value = customCat.trim();
        opt.textContent = customCat.trim();
        opt.selected = true;
        sel.appendChild(opt);
      }
    });

    document.getElementById('add-sabor-save')?.addEventListener('click', async () => {
      const name = document.getElementById('new-sabor-name')?.value.trim();
      const category = document.getElementById('new-sabor-cat')?.value;

      if (!name) {
        showToast(isHeladeria ? 'Ingresá el nombre del sabor' : 'Ingresá el nombre de la variedad', 'warning');
        return;
      }

      const saveBtn = document.getElementById('add-sabor-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      try {
        const newSabor = {
          id: Math.random().toString(36).substr(2, 9),
          name,
          category,
          isAvailable: true,
          createdAt: new Date().toISOString()
        };
        const updatedSabores = [...sabores, newSabor];
        await updateDoc(comercioRef, { sabores: updatedSabores });
        closeModal();
        showToast(isHeladeria ? 'Sabor agregado con éxito' : 'Gusto agregado con éxito', 'success');
      } catch (e) {
        showToast('Error al guardar', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar';
      }
    });
  }

  return {
    cleanup: () => {
      unsubscribe();
    }
  };
}
