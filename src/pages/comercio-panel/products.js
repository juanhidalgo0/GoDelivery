// GoDelivery — Comercio Products Management
import { db } from '../../firebase.js';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { formatPrice } from '../../utils/format.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { openCropper } from '../../utils/cropper.js';
import { isAdmin } from '../../auth.js';

export async function renderComercioProducts() {
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
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;height:64px;padding:0 16px;background:var(--color-primary);box-shadow:0 4px 12px rgba(0,0,0,0.1);flex-shrink:0;overflow:hidden;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:12px;position:relative;z-index:2;flex:1;min-width:0;">
          <a href="#/mi-comercio/${comercioId}/settings" style="display:flex;align-items:center;justify-content:center;background:none;border:none;color:white;cursor:pointer;padding:0;text-decoration:none;">
            ${icon('chevronLeft', 28)}
          </a>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;">
            <span style="font-weight:800;font-size:20px;color:white;letter-spacing:-0.02em;">Productos</span>
            <p id="panel-commerce-name" style="font-size:11px;color:rgba(255,255,255,0.85);margin:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></p>
          </div>
        </div>
        <button class="hdr-icon-btn" id="add-product-btn" title="Agregar Producto" style="position:relative;z-index:2;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.1);color:white;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;transition:all 0.2s;">
          ${icon('plus', 18)}
        </button>
      </div>

      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div class="search-bar" style="margin-bottom:var(--space-3);">
          <span class="search-icon">${icon('search', 20)}</span>
          <input type="text" id="products-search" placeholder="Buscar productos..." />
        </div>

        <div id="products-categories-filter" class="tab-pills hide-scrollbar" style="margin-bottom:var(--space-4);">
          <div class="skeleton" style="width:60px;height:32px;border-radius:20px;"></div>
          <div class="skeleton" style="width:80px;height:32px;border-radius:20px;"></div>
        </div>

        <div id="products-list">
          <div class="skeleton" style="height:90px;margin-bottom:var(--space-3);border-radius:var(--radius-lg);"></div>
          <div class="skeleton" style="height:90px;margin-bottom:var(--space-3);border-radius:var(--radius-lg);"></div>
        </div>
      </div>
    </div>
  `;

  let products = [];
  let categories = [];
  let currentCategoryId = 'all';

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

    const prodsSnap = await getDocs(collection(db, 'comercios', comercioId, 'products'));
    products = prodsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const catsSnap = await getDocs(query(collection(db, 'comercios', comercioId, 'categories'), orderBy('order')));
    categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderCategoriesFilter(categories);
    renderProductsList(products, '', currentCategoryId);
  } catch (e) {
    console.error('Error loading products:', e);
    showToast('Error al cargar productos', 'error');
    location.hash = '#/profile';
  }

  function renderCategoriesFilter(cats) {
    const container = document.getElementById('products-categories-filter');
    if (!container) return;

    container.innerHTML = `
      <button class="tab-pill ${currentCategoryId === 'all' ? 'active' : ''}" data-cat-id="all">Todos</button>
      ${cats.map(c => `
        <button class="tab-pill ${currentCategoryId === c.id ? 'active' : ''}" data-cat-id="${c.id}">${c.name}</button>
      `).join('')}
    `;

    container.querySelectorAll('.tab-pill').forEach(btn => {
      btn.onclick = () => {
        currentCategoryId = btn.dataset.catId;
        container.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
      };
    });
  }

  // Search
  document.getElementById('products-search')?.addEventListener('input', (e) => {
    renderProductsList(products, e.target.value, currentCategoryId);
  });

  // Add product
  document.getElementById('add-product-btn')?.addEventListener('click', () => {
    showProductModal(null, categories, comercioId, async (product) => {
      products.push(product);
      renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
    }, (newCat) => {
      renderCategoriesFilter(categories);
    });
  });

  // Actions
  document.getElementById('products-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');
    const toggleBtn = e.target.closest('[data-action="toggle"]');

    if (editBtn) {
      const product = products.find(p => p.id === editBtn.dataset.id);
      if (product) {
        showProductModal(product, categories, comercioId, (updated) => {
          const idx = products.findIndex(p => p.id === updated.id);
          if (idx >= 0) products[idx] = updated;
          renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
        }, (newCat) => {
          renderCategoriesFilter(categories);
        });
      }
    }

    if (deleteBtn) {
      const product = products.find(p => p.id === deleteBtn.dataset.id);
      if (product) {
        const doDeleteCloud = async () => {
          await deleteDoc(doc(db, 'comercios', comercioId, 'products', product.id));
          products = products.filter(p => p.id !== product.id);
          renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
        };

        const doDeleteLocalSync = async () => {
          try {
            const res = await fetch(`http://localhost:3001/api/sync/product/${product.barcode}`, {
              method: 'DELETE',
              headers: {
                'x-sync-token': 'paulos-local-sync-token-secret-2026'
              }
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.message || 'Error del POS local');
            }
          } catch (err) {
            console.error('Error in local delete sync:', err);
            showToast('No se pudo dar de baja en Kiosco POS local. ¿El servidor está encendido?', 'warning');
            throw err;
          }
        };

        if (product.barcode) {
          showSyncConfirm({
            title: 'Dar de Baja Producto',
            message: `¿Querés eliminar "${product.name}" únicamente de tu tienda online GoDelivery, o también desactivarlo en tu sistema local Kiosco POS?`,
            onSyncBoth: async () => {
              await doDeleteCloud();
              await doDeleteLocalSync();
              showToast('Producto dado de baja en ambos sistemas', 'success');
            },
            onSyncOnlyCloud: async () => {
              await doDeleteCloud();
              showToast('Producto eliminado solo de GoDelivery', 'info');
            },
            onCancel: () => {}
          });
        } else {
          showConfirm({
            title: 'Eliminar producto',
            message: `¿Eliminar "${product.name}"?`,
            confirmText: 'Eliminar',
            danger: true,
            onConfirm: async () => {
              try {
                await doDeleteCloud();
                showToast('Producto eliminado', 'info');
              } catch (e) {
                showToast('Error al eliminar', 'error');
              }
            }
          });
        }
      }
    }

    if (toggleBtn) {
      const product = products.find(p => p.id === toggleBtn.dataset.id);
      if (product) {
        const newAvail = product.isAvailable === false;
        try {
          await updateDoc(doc(db, 'comercios', comercioId, 'products', product.id), { isAvailable: newAvail });
          product.isAvailable = newAvail;
          renderProductsList(products, document.getElementById('products-search')?.value || '', currentCategoryId);
          showToast(newAvail ? 'Producto disponible' : 'Producto no disponible', 'info');
        } catch (e) {
          showToast('Error', 'error');
        }
      }
    }
  });
}

function renderProductsList(products, search, categoryId) {
  const container = document.getElementById('products-list');
  if (!container) return;

  let filtered = products;
  if (categoryId && categoryId !== 'all') {
    filtered = filtered.filter(p => p.categoryId === categoryId);
  }
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(s));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icon('package', 40)}</div>
        <div class="empty-state-title">${(search || categoryId !== 'all') ? 'Sin resultados' : 'Sin productos'}</div>
        <div class="empty-state-text">${(search || categoryId !== 'all') ? 'Probá con otra búsqueda o categoría' : 'Agregá tu primer producto'}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    let stockBadgeHtml = '';
    if (p.stockMode === 'limited') {
      const qty = p.stockQuantity || 0;
      const threshold = p.stockThreshold !== undefined ? p.stockThreshold : 3;
      if (qty <= 0) {
        stockBadgeHtml = `<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:900; background:rgba(239,68,68,0.12); color:#EF4444; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.5px; border:1px solid rgba(239,68,68,0.25);">${icon('alertTriangle', 10)} Agotado</span>`;
      } else if (qty <= threshold) {
        stockBadgeHtml = `<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:900; background:rgba(245,158,11,0.12); color:#F59E0B; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.5px; border:1px solid rgba(245,158,11,0.25);">${icon('alertCircle', 10)} Stock Bajo: ${qty}</span>`;
      } else {
        stockBadgeHtml = `<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:800; background:rgba(34,197,94,0.08); color:#22C55E; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.5px; border:1px solid rgba(34,197,94,0.15);">Stock: ${qty}</span>`;
      }
    }

    return `
      <div class="panel-product-card ${p.isAvailable === false ? 'unavailable' : ''}">
        <img src="${p.image || '/logo.png'}" alt="${p.name}" class="panel-product-card-img" style="opacity:${p.isAvailable === false ? '0.5' : '1'};" />
        <div class="panel-product-card-info" style="opacity:${p.isAvailable === false ? '0.7' : '1'};">
          <div class="panel-product-card-name">${p.name}</div>
          <div class="panel-product-card-desc">${p.description || 'Sin descripción'}</div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:4px;">
            <div class="panel-product-card-price" style="margin:0;">${formatPrice(p.price)}</div>
            ${stockBadgeHtml}
          </div>
        </div>
        <div class="panel-product-card-actions">
          <button class="btn btn-sm btn-ghost" data-action="toggle" data-id="${p.id}" title="${p.isAvailable === false ? 'Activar' : 'Desactivar'}">
            ${icon('eye', 18)}
          </button>
          <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${p.id}" title="Editar">
            ${icon('edit', 18)}
          </button>
          <button class="btn btn-sm btn-ghost delete" data-action="delete" data-id="${p.id}" title="Eliminar">
            ${icon('trash', 18)}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function showProductModal(product, categories, comercioId, onSave, onCategoryAdded) {
  let croppedImage = product?.image || '';

  showModal({
    title: product ? 'Editar Producto' : 'Nuevo Producto',
    content: `
      <div class="panel-form">
        <div class="input-group">
          <label>Nombre *</label>
          <input type="text" class="input" id="prod-name" value="${product?.name || ''}" placeholder="Nombre del producto" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
        </div>
        <div class="input-group">
          <label>Código de Barras (opcional, para sincronizar con POS)</label>
          <input type="text" class="input" id="prod-barcode" value="${product?.barcode || ''}" placeholder="Código de barras del producto" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
        </div>
        <div class="input-group">
          <label>Descripción</label>
          <textarea class="input" id="prod-desc" placeholder="Descripción breve" style="height:80px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:12px 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); resize:none; line-height:1.5; width:100%;">${product?.description || ''}</textarea>
        </div>
        <div class="input-group">
          <label>Precio *</label>
          <input type="number" class="input" id="prod-price" value="${product?.price || ''}" placeholder="0" min="0" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
        </div>
        <div class="input-group">
          <label>Categoría</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <select class="input" id="prod-category" style="flex:1; height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); background:var(--color-surface);">
              <option value="">Sin categoría</option>
              ${categories.map(c => `<option value="${c.id}" ${product?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
            <button class="btn btn-outline" id="prod-new-category-btn" type="button" style="height:48px; width:48px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:12px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-primary); cursor:pointer;" title="Nueva Categoría">
              ${icon('plus', 18)}
            </button>
          </div>
        </div>
        <div class="input-group">
          <label>Imagen</label>
          <div class="image-upload" id="prod-image-upload">
            <img src="${product?.image || '/logo.png'}" alt="Preview" id="prod-image-preview" style="${product?.image ? '' : 'opacity:0.3;'}" />
            <span class="image-upload-icon" style="${product?.image ? 'display:none;' : ''}">${icon('upload', 32)}</span>
            <span class="image-upload-text" style="${product?.image ? 'display:none;' : ''}">Click para subir o ajustar</span>
            <input type="file" accept="image/*" id="prod-image-input" />
          </div>
        </div>

        <div class="divider"></div>
        <div style="margin-bottom:var(--space-4);">
          <h4 style="font-family:var(--font-display); margin-bottom:12px; display:flex; align-items:center; gap:8px;">
            ${icon('package', 18)} Control de Stock
          </h4>
          <div class="input-group" style="margin-bottom:12px;">
            <label>Modo de Inventario</label>
            <select class="input" id="prod-stock-mode" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%; background:var(--color-surface);">
              <option value="unlimited" ${product?.stockMode === 'unlimited' || !product?.stockMode ? 'selected' : ''}>Ilimitado (Sin control)</option>
              <option value="limited" ${product?.stockMode === 'limited' ? 'selected' : ''}>Limitado (Controlar cantidad)</option>
            </select>
          </div>
          <div id="prod-stock-fields" style="display:${product?.stockMode === 'limited' ? 'grid' : 'none'}; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="input-group" style="margin-bottom:0;">
              <label>Cantidad Disponible *</label>
              <input type="number" class="input" id="prod-stock-quantity" value="${product?.stockQuantity !== undefined ? product.stockQuantity : ''}" placeholder="0" min="0" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
            </div>
            <div class="input-group" style="margin-bottom:0;">
              <label>Alerta Stock Mínimo</label>
              <input type="number" class="input" id="prod-stock-threshold" value="${product?.stockThreshold !== undefined ? product.stockThreshold : '3'}" placeholder="3" min="0" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
            </div>
          </div>
        </div>

        <div class="divider"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-3);">
          <h4 style="font-family:var(--font-display);">${icon('settings', 18)} Opciones y Extras</h4>
          <button class="btn btn-sm btn-outline" id="add-option-group">
            ${icon('plus', 14)} Nuevo Grupo
          </button>
        </div>
        <div id="prod-options-groups"></div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="prod-cancel">Cancelar</button>
      <button class="btn btn-primary" id="prod-save">Guardar</button>
    `
  });

  // Options Management
  let optionsGroups = JSON.parse(JSON.stringify(product?.optionsGroups || []));

  const renderOptionsGroups = () => {
    const container = document.getElementById('prod-options-groups');
    if (!container) return;

    if (optionsGroups.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:var(--space-4); color:var(--color-text-tertiary); font-size:var(--font-sm); border:1px dashed var(--color-border); border-radius:var(--radius-lg);">Sin opciones configuradas</div>`;
      return;
    }

    container.innerHTML = optionsGroups.map((group, gIdx) => `
      <div class="option-group-editor" style="background:var(--color-bg-secondary); border-radius:var(--radius-lg); padding:var(--space-4); margin-bottom:var(--space-4); border:1px solid var(--color-border-light);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-3);">
          <div style="font-weight:bold; font-size:var(--font-sm); color:var(--color-primary);">GRUPO #${gIdx + 1}</div>
          <button class="btn btn-sm btn-ghost" data-action="remove-group" data-idx="${gIdx}">${icon('trash', 16)}</button>
        </div>
        
        <div class="input-group" style="margin-bottom:var(--space-3);">
          <label style="font-size:var(--font-xs);">Nombre del Grupo (ej: Extras, Sabores)</label>
          <input type="text" class="input group-name-input" data-idx="${gIdx}" value="${group.name || ''}" placeholder="Ej: Elegí tu sabor" />
        </div>

        <div style="display:flex; gap:var(--space-4); margin-bottom:var(--space-4);">
          <label style="display:flex; align-items:center; gap:var(--space-2); font-size:var(--font-xs); cursor:pointer;">
            <input type="checkbox" class="group-required-input" data-idx="${gIdx}" ${group.required ? 'checked' : ''} /> Obligatorio
          </label>
          <label style="display:flex; align-items:center; gap:var(--space-2); font-size:var(--font-xs); cursor:pointer;">
            <input type="checkbox" class="group-multi-input" data-idx="${gIdx}" ${group.multi ? 'checked' : ''} /> Multiselección
          </label>
        </div>

        <div style="background:var(--color-surface); padding:var(--space-3); border-radius:var(--radius-md);">
          <label style="font-size:var(--font-xs); font-weight:bold; color:var(--color-text-secondary); display:block; margin-bottom:var(--space-2);">OPCIONES</label>
          <div class="options-editor-list">
            ${(group.options || []).map((opt, oIdx) => `
              <div style="display:flex; gap:var(--space-2); margin-top:var(--space-2); align-items:flex-end;">
                <div style="flex:1.5; min-width:0;">
                  <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase;">Nombre</span>
                  <input type="text" class="input opt-name-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.name || ''}" placeholder="Ej: Cheddar" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-3);" />
                </div>
                <div style="flex:1; min-width:70px;">
                  <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase;">Precio</span>
                  <input type="number" class="input opt-price-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.price || ''}" placeholder="0" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-2);" />
                </div>
                <div style="flex:0.7; min-width:55px;">
                  <span style="font-size:9px; color:var(--color-text-tertiary); margin-left:4px; text-transform:uppercase;">Máx</span>
                  <input type="number" class="input opt-maxqty-input" data-gidx="${gIdx}" data-oidx="${oIdx}" value="${opt.maxQty || 1}" placeholder="1" min="1" style="font-size:var(--font-sm); min-height:36px; padding: var(--space-2) var(--space-2); text-align:center;" />
                </div>
                <button class="btn btn-sm btn-ghost" data-action="remove-option" data-gidx="${gIdx}" data-oidx="${oIdx}" style="min-width:36px; height:36px; color:var(--color-text-tertiary);">${icon('close', 14)}</button>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-sm btn-ghost btn-block" data-action="add-option" data-idx="${gIdx}" style="margin-top:var(--space-3); border:1px dashed var(--color-border);">
            ${icon('plus', 14)} Agregar opción
          </button>
        </div>
      </div>
    `).join('');

    // Listeners for groups
    container.querySelectorAll('.group-name-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.idx].name = input.value; };
    });
    container.querySelectorAll('.group-required-input').forEach(input => {
      input.onchange = () => { optionsGroups[input.dataset.idx].required = input.checked; };
    });
    container.querySelectorAll('.group-multi-input').forEach(input => {
      input.onchange = () => { optionsGroups[input.dataset.idx].multi = input.checked; };
    });
    container.querySelectorAll('.opt-name-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].name = input.value; };
    });
    container.querySelectorAll('.opt-price-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].price = parseFloat(input.value) || 0; };
    });
    container.querySelectorAll('.opt-maxqty-input').forEach(input => {
      input.oninput = () => { optionsGroups[input.dataset.gidx].options[input.dataset.oidx].maxQty = parseInt(input.value) || 1; };
    });

    // Remove group
    container.querySelectorAll('[data-action="remove-group"]').forEach(btn => {
      btn.onclick = () => {
        optionsGroups.splice(btn.dataset.idx, 1);
        renderOptionsGroups();
      };
    });

    // Add option
    container.querySelectorAll('[data-action="add-option"]').forEach(btn => {
      btn.onclick = () => {
        optionsGroups[btn.dataset.idx].options.push({ name: '', price: 0 });
        renderOptionsGroups();
      };
    });

    // Remove option
    container.querySelectorAll('[data-action="remove-option"]').forEach(btn => {
      btn.onclick = () => {
        optionsGroups[btn.dataset.gidx].options.splice(btn.dataset.oidx, 1);
        renderOptionsGroups();
      };
    });
  };

  setTimeout(renderOptionsGroups, 100);

  document.getElementById('add-option-group')?.addEventListener('click', () => {
    optionsGroups.push({ name: '', required: false, multi: false, options: [{ name: '', price: 0, maxQty: 1 }] });
    renderOptionsGroups();
  });

  // Reactive Stock Fields Toggle
  document.getElementById('prod-stock-mode')?.addEventListener('change', (e) => {
    const mode = e.target.value;
    const fields = document.getElementById('prod-stock-fields');
    if (fields) {
      fields.style.display = mode === 'limited' ? 'grid' : 'none';
    }
  });

  // Inline Category Creation
  document.getElementById('prod-new-category-btn')?.addEventListener('click', () => {
    showModal({
      title: 'Nueva Categoría',
      height: 'auto',
      content: `
        <div class="panel-form" style="padding: 20px;">
          <div class="input-group">
            <label>Nombre de la Categoría *</label>
            <input type="text" class="input" id="new-cat-name" placeholder="Ej: Hamburguesas, Bebidas" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="new-cat-cancel">Cancelar</button>
        <button class="btn btn-primary" id="new-cat-save">Crear</button>
      `
    });

    document.getElementById('new-cat-cancel')?.addEventListener('click', () => closeModal());
    
    document.getElementById('new-cat-save')?.addEventListener('click', async () => {
      const catName = document.getElementById('new-cat-name')?.value.trim();
      if (!catName) {
        showToast('Ingresá un nombre para la categoría', 'warning');
        return;
      }

      const saveBtn = document.getElementById('new-cat-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Creando...';

      try {
        const nextOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order || 0)) + 1 : 0;
        const newCatRef = doc(collection(db, 'comercios', comercioId, 'categories'));
        const newCatData = {
          name: catName,
          order: nextOrder,
          createdAt: new Date()
        };

        await setDoc(newCatRef, newCatData);

        const newCategory = { id: newCatRef.id, ...newCatData };
        categories.push(newCategory);

        // Re-render select inside product modal
        const select = document.getElementById('prod-category');
        if (select) {
          select.innerHTML = `
            <option value="">Sin categoría</option>
            ${categories.map(c => `<option value="${c.id}" ${newCategory.id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          `;
          select.value = newCategory.id;
        }

        // Hot-reload filter tabs in background
        if (onCategoryAdded) {
          onCategoryAdded(newCategory);
        }

        closeModal();
        showToast('Categoría creada', 'success');
      } catch (err) {
        console.error('Error creating category:', err);
        showToast('Error al crear categoría', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Crear';
      }
    });
  });

  // Image upload with Cropper
  document.getElementById('prod-image-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 4 / 3 });
        croppedImage = cropped;
        const preview = document.getElementById('prod-image-preview');
        preview.src = cropped;
        preview.style.opacity = '1';
        // Hide text
        document.querySelector('.image-upload-icon').style.display = 'none';
        document.querySelector('.image-upload-text').style.display = 'none';
      } catch (err) {
        console.log('Cropping cancelled or failed');
      }
    }
  });

  document.getElementById('prod-cancel')?.addEventListener('click', closeModal);
  document.getElementById('prod-save')?.addEventListener('click', async () => {
    const name = document.getElementById('prod-name')?.value.trim();
    const barcode = document.getElementById('prod-barcode')?.value.trim() || '';
    const desc = document.getElementById('prod-desc')?.value.trim();
    const price = parseFloat(document.getElementById('prod-price')?.value);
    const categoryId = document.getElementById('prod-category')?.value;

    if (!name) { showToast('Ingresá un nombre', 'warning'); return; }
    if (!price || price <= 0) { showToast('Ingresá un precio válido', 'warning'); return; }

    const stockMode = document.getElementById('prod-stock-mode')?.value || 'unlimited';
    let stockQuantity = 0;
    let stockThreshold = 3;

    if (stockMode === 'limited') {
      const qtyInput = document.getElementById('prod-stock-quantity')?.value;
      if (qtyInput === '') {
        showToast('Ingresá la cantidad disponible en stock', 'warning');
        return;
      }
      stockQuantity = parseInt(qtyInput);
      if (isNaN(stockQuantity) || stockQuantity < 0) {
        showToast('La cantidad de stock no puede ser negativa', 'warning');
        return;
      }
      const thresholdInput = document.getElementById('prod-stock-threshold')?.value;
      stockThreshold = thresholdInput !== '' ? parseInt(thresholdInput) : 3;
      if (isNaN(stockThreshold) || stockThreshold < 0) {
        showToast('La alerta de stock mínimo no puede ser negativa', 'warning');
        return;
      }
    }

    const saveBtn = document.getElementById('prod-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
      const productData = {
        name,
        barcode,
        description: desc,
        price,
        categoryId: categoryId || '',
        image: croppedImage,
        optionsGroups: optionsGroups.filter(g => g.name.trim() !== ''),
        isAvailable: product ? product.isAvailable : true,
        stockMode,
        stockQuantity,
        stockThreshold,
        order: product?.order || 0,
        createdAt: product?.createdAt || new Date()
      };

      const doSaveCloud = async () => {
        if (product) {
          await updateDoc(doc(db, 'comercios', comercioId, 'products', product.id), productData);
          onSave({ id: product.id, ...productData });
        } else {
          const newRef = doc(collection(db, 'comercios', comercioId, 'products'));
          await setDoc(newRef, productData);
          onSave({ id: newRef.id, ...productData });
        }
      };

      const doSaveLocalSync = async () => {
        try {
          const res = await fetch('http://localhost:3001/api/sync/product', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-sync-token': 'paulos-local-sync-token-secret-2026'
            },
            body: JSON.stringify({
              barcode: barcode,
              name: name,
              salePrice: price,
              stock: stockMode === 'limited' ? stockQuantity : undefined,
              description: desc || ''
            })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || 'Error del POS local');
          }
        } catch (err) {
          console.error('Error in local sync fetch:', err);
          showToast('No se pudo conectar con Kiosco POS local. ¿El servidor está encendido?', 'warning');
          throw err;
        }
      };

      if (barcode) {
        showSyncConfirm({
          title: 'Sincronizar Cambios',
          message: `¿Querés guardar "${name}" únicamente en la tienda online GoDelivery, o también sincronizarlo en tiempo real con tu sistema local Kiosco POS?`,
          onSyncBoth: async () => {
            await doSaveCloud();
            await doSaveLocalSync();
            closeModal();
            showToast('Producto actualizado en GoDelivery y Kiosco POS', 'success');
          },
          onSyncOnlyCloud: async () => {
            await doSaveCloud();
            closeModal();
            showToast('Producto guardado solo en GoDelivery (Online)', 'success');
          },
          onCancel: () => {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar';
          }
        });
      } else {
        await doSaveCloud();
        closeModal();
        showToast(product ? 'Producto actualizado' : 'Producto creado', 'success');
      }
    } catch (e) {
      console.error('Error saving product:', e);
      showToast('Error al guardar', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  });
}

function showSyncConfirm({ title, message, onSyncBoth, onSyncOnlyCloud, onCancel }) {
  const uid = Math.random().toString(36).substr(2, 5);
  const cancelId = `sync-cancel-${uid}`;
  const onlyCloudId = `sync-only-cloud-${uid}`;
  const bothId = `sync-both-${uid}`;

  let hasResponded = false;

  showModal({
    title: title || 'Sincronizar Cambios',
    height: 'auto',
    content: `
      <div style="padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
        <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(34, 197, 94, 0.1); display: flex; align-items: center; justify-content: center; color: #22C55E;">
          ${icon('refresh', 28)}
        </div>
        <div style="font-weight: 800; font-size: 18px; color: var(--color-text-primary);">${title || 'Sincronización POS'}</div>
        <p style="color: var(--color-text-secondary); font-size: 14px; line-height: 1.6; margin: 0; font-weight: 500;">
          ${message}
        </p>
      </div>
    `,
    footer: `
      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; padding: 0 4px 8px 4px;">
        <button class="btn btn-primary" id="${bothId}" style="height: 52px; border-radius: 14px; font-weight: 900; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${icon('refresh', 16)} Sincronizar en Ambos Sistemas
        </button>
        <button class="btn btn-outline" id="${onlyCloudId}" style="height: 52px; border-radius: 14px; font-weight: 800; font-size: 14px; background: transparent; border: 1.5px solid var(--color-border); color: var(--color-text-primary);">
          Solo en GoDelivery (Online)
        </button>
        <button class="btn btn-ghost" id="${cancelId}" style="height: 44px; border-radius: 12px; font-weight: 700; font-size: 13px; color: var(--color-text-tertiary);">
          Cancelar
        </button>
      </div>
    `,
    onClose: () => {
      if (!hasResponded && onCancel) {
        onCancel();
      }
    }
  });

  document.getElementById(cancelId)?.addEventListener('click', () => {
    hasResponded = true;
    closeModal();
    if (onCancel) onCancel();
  });

  document.getElementById(onlyCloudId)?.addEventListener('click', async () => {
    hasResponded = true;
    const btn = document.getElementById(onlyCloudId);
    const bothBtn = document.getElementById(bothId);
    const cancelBtn = document.getElementById(cancelId);
    if (btn) btn.disabled = true;
    if (bothBtn) bothBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    
    try {
      await onSyncOnlyCloud();
      closeModal();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (bothBtn) bothBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });

  document.getElementById(bothId)?.addEventListener('click', async () => {
    hasResponded = true;
    const btn = document.getElementById(bothId);
    const cloudBtn = document.getElementById(onlyCloudId);
    const cancelBtn = document.getElementById(cancelId);
    if (btn) btn.disabled = true;
    if (cloudBtn) cloudBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      await onSyncBoth();
      closeModal();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (cloudBtn) cloudBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });
}
