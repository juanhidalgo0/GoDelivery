// GoDelivery — Comercio Offers Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, deleteDoc, updateDoc, addDoc, serverTimestamp, query, where, getDoc, setDoc } from 'firebase/firestore';
import { loadPanelCatalog } from '../../utils/panel-catalog.js';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { formatPrice } from '../../utils/format.js';

let comercioId = null;
let comercioName = '';
let afterSave = null;

// Promos abre el editor de ofertas (crear o editar) y refresca su lista al guardar.
export function openOfferEditorFor(cid, cname, existingOffer = null, onSaved = null) {
  comercioId = cid;
  comercioName = cname || '';
  afterSave = onSaved;
  return openOfferEditor(existingOffer);
}


async function openOfferEditor(existingOffer = null) {
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'height: 100%; display: flex; flex-direction: column; background: var(--color-bg); overflow: hidden;';

  modalContent.innerHTML = `
    <!-- Sticky Header -->
    <div style="padding: 16px 24px; border-bottom: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; background: var(--color-surface);">
      <h2 style="font-family: var(--font-display); font-size: 20px; font-weight: 900; margin: 0; color: var(--color-text-primary);">${existingOffer ? 'Editar Oferta' : 'Nueva Oferta'}</h2>
      <button id="close-offer-editor-btn" style="width: 40px; height: 40px; border-radius: 50%; background: var(--color-bg-secondary); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text-secondary);">
        ${icon('close', 20)}
      </button>
    </div>
    
    <!-- Scrollable Body -->
    <div style="flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 20px;">
      
      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Título de la Oferta</label>
        <input type="text" id="offer-title" value="${existingOffer ? existingOffer.title : ''}" placeholder="Ej: Burger Week" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-surface); color:var(--color-text);" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Tipo</label>
          <select id="offer-type" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-surface); color:var(--color-text);">
            <option value="percentage" ${existingOffer && existingOffer.type === 'percentage' ? 'selected' : ''}>% Descuento</option>
            <option value="2x1" ${existingOffer && existingOffer.type === '2x1' ? 'selected' : ''}>Llevá 2 Pagá 1</option>
          </select>
        </div>
        <div class="form-group" id="offer-value-group" style="${existingOffer && existingOffer.type === '2x1' ? 'display:none;' : ''}">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Porcentaje (%)</label>
          <input type="number" id="offer-value" value="${existingOffer && existingOffer.value !== null && existingOffer.value !== undefined ? existingOffer.value : ''}" placeholder="Ej: 20" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-surface); color:var(--color-text);" />
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Banner URL (Opcional - por defecto usa imagen de producto)</label>
        <input type="text" id="offer-banner" value="${existingOffer && existingOffer.banner ? existingOffer.banner : ''}" placeholder="URL de la imagen" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-surface); color:var(--color-text);" />
      </div>

      <!-- Advanced Products Selection Section -->
      <div class="form-group" style="display:flex; flex-direction:column; gap:12px; flex:1; min-height:350px;">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary);">Productos Seleccionados *</label>
        
        <!-- Filter Toolbar -->
        <div id="product-toolbar" style="display:flex; flex-direction:column; gap:12px; background:var(--color-surface); padding:16px; border-radius:20px; border:1px solid var(--color-border-light);">
          <!-- Search input -->
          <div style="position:relative;">
            <input type="text" id="prod-search-input" placeholder="Filtrar productos por nombre..." style="width:100%; height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 14px 0 40px; font-weight:600; font-size:13px; outline:none; background:var(--color-bg-secondary); color:var(--color-text);" />
            <div style="position:absolute; left:14px; top:12px; color:var(--color-text-tertiary); display:flex; align-items:center;">${icon('search', 16)}</div>
          </div>
          
          <!-- Category buttons bar -->
          <div id="prod-categories-bar" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;" class="hide-scrollbar"></div>
        </div>

        <!-- Products Table Container -->
        <div id="offer-products-container" style="flex:1; overflow-y:auto; border:1px solid var(--color-border); border-radius:20px; background:var(--color-surface);">
          <div class="spinner-mini" style="margin:40px auto;"></div>
        </div>
      </div>

    </div>

    <!-- Sticky Footer -->
    <div style="padding: 16px 24px; border-top: 1px solid var(--color-border-light); background: var(--color-surface); flex-shrink: 0; display: flex; gap: 12px;">
      <button id="cancel-offer-btn" style="flex: 1; height: 54px; border-radius: 18px; border: 1px solid var(--color-border); background: var(--color-bg-secondary); font-weight: 800; font-size: 15px; cursor: pointer; color: var(--color-text-secondary);">Cancelar</button>
      <button id="save-offer-btn" style="flex: 2; height: 54px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 16px; cursor: pointer;">${existingOffer ? 'Guardar Cambios' : 'Crear Oferta'}</button>
    </div>
    
    <style>
      .category-pill-btn {
        padding: 8px 16px;
        border-radius: 30px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
        border: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        color: var(--color-text-secondary);
        transition: all 0.2s ease;
      }
      .category-pill-btn.active {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
        box-shadow: 0 4px 10px rgba(var(--color-primary-rgb), 0.2);
      }

      .prod-row {
        cursor: pointer;
        border-bottom: 1px solid var(--color-border-light);
        transition: background 0.15s;
      }
      .prod-row:hover {
        background: var(--color-bg-secondary);
      }
      .prod-row.selected {
        background: rgba(var(--color-primary-rgb), 0.03);
      }
    </style>
  `;

  showModal({ title: '', hideHeader: true, fullscreen: true, content: modalContent });

  const closeBtn = modalContent.querySelector('#close-offer-editor-btn');
  const cancelBtn = modalContent.querySelector('#cancel-offer-btn');
  closeBtn.onclick = () => closeModal();
  cancelBtn.onclick = () => closeModal();

  const typeSelect = modalContent.querySelector('#offer-type');
  const valueGroup = modalContent.querySelector('#offer-value-group');
  const productsContainer = modalContent.querySelector('#offer-products-container');
  const prodSearchInput = modalContent.querySelector('#prod-search-input');
  const prodCategoriesBar = modalContent.querySelector('#prod-categories-bar');

  typeSelect.onchange = () => {
    if (typeSelect.value === '2x1') {
      valueGroup.style.display = 'none';
    } else {
      valueGroup.style.display = 'block';
    }
  };

  let activeProducts = [];
  let categories = [];
  let selectedCategory = null; // null means 'TODOS'
  let searchQuery = '';
  const checkedProductIds = new Set();

  if (existingOffer && existingOffer.productIds) {
    existingOffer.productIds.forEach(id => checkedProductIds.add(id));
  }

  function renderProductsTable() {
    let filtered = activeProducts;

    // Filter by Category
    if (selectedCategory) {
      filtered = filtered.filter(p => p.categoryId === selectedCategory);
    }

    // Filter by Name
    if (searchQuery) {
      filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(searchQuery));
    }

    if (filtered.length === 0) {
      productsContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--color-text-tertiary); font-weight: 600; font-size: 13px;">
          No se encontraron productos coincidentes
        </div>
      `;
      return;
    }

    // Generate table content
    productsContainer.innerHTML = `
      <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
        <thead>
          <tr style="border-bottom:1.5px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text-secondary); font-weight:800; text-transform:uppercase; font-size:11px; letter-spacing:0.05em;">
            <th style="padding:14px; width:48px; text-align:center;">
              <input type="checkbox" id="select-all-prods" style="width:18px; height:18px; cursor:pointer;" />
            </th>
            <th style="padding:14px;">Producto</th>
            <th style="padding:14px; width:100px;">Precio</th>
            <th style="padding:14px; width:140px;">Categoría</th>
          </tr>
        </thead>
        <tbody style="font-weight:600; color:var(--color-text);">
          ${filtered.map(p => {
            const cat = categories.find(c => c.id === p.categoryId);
            const isChecked = checkedProductIds.has(p.id);
            return `
              <tr class="prod-row ${isChecked ? 'selected' : ''}" data-id="${p.id}">
                <td style="padding:12px; text-align:center;" onclick="event.stopPropagation();">
                   <input type="checkbox" class="prod-cb" value="${p.id}" ${isChecked ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;" />
                </td>
                <td style="padding:12px; display:flex; align-items:center; gap:10px;">
                  <img src="${p.image || '/logo.png'}" alt="" style="width:36px; height:36px; border-radius:8px; object-fit:cover; border:1px solid var(--color-border-light); background:white;" />
                  <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${p.name}</span>
                </td>
                <td style="padding:12px; color:var(--color-primary); font-weight:800;">${formatPrice(p.price)}</td>
                <td style="padding:12px;">
                  <span style="background:var(--color-bg-secondary); color:var(--color-text-secondary); font-size:10px; font-weight:800; padding:4px 8px; border-radius:6px; text-transform:uppercase;">
                    ${cat ? cat.name : 'Sin cat.'}
                  </span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    // Row Click Toggle handler
    productsContainer.querySelectorAll('.prod-row').forEach(row => {
      row.onclick = () => {
        const id = row.dataset.id;
        const cb = row.querySelector('.prod-cb');
        if (checkedProductIds.has(id)) {
          checkedProductIds.delete(id);
          cb.checked = false;
          row.classList.remove('selected');
        } else {
          checkedProductIds.add(id);
          cb.checked = true;
          row.classList.add('selected');
        }
      };
    });

    // Checkbox directly click handler
    productsContainer.querySelectorAll('.prod-cb').forEach(cb => {
      cb.onclick = (e) => {
        const id = cb.value;
        const row = cb.closest('.prod-row');
        if (cb.checked) {
          checkedProductIds.add(id);
          row.classList.add('selected');
        } else {
          checkedProductIds.delete(id);
          row.classList.remove('selected');
        }
      };
    });

    // Select All visible handler
    const selectAllCb = productsContainer.querySelector('#select-all-prods');
    const visibleIds = filtered.map(p => p.id);
    const allVisibleChecked = visibleIds.every(id => checkedProductIds.has(id));
    selectAllCb.checked = allVisibleChecked;

    selectAllCb.onclick = () => {
      const state = selectAllCb.checked;
      visibleIds.forEach(id => {
        if (state) {
          checkedProductIds.add(id);
        } else {
          checkedProductIds.delete(id);
        }
      });
      renderProductsTable();
    };
  }

  // Load products & categories
  try {
    activeProducts = await loadPanelCatalog(comercioId);

    const catsSnap = await getDocs(collection(db, 'comercios', comercioId, 'categories'));
    categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (activeProducts.length === 0) {
      productsContainer.innerHTML = '<div style="color:var(--color-text-tertiary); font-size:13px; text-align:center; padding:40px; font-weight:600;">No tienes productos</div>';
    } else {
      // Render Category Buttons Bar
      prodCategoriesBar.innerHTML = `
        <button class="category-pill-btn active" data-id="all">TODOS</button>
        ${categories.map(c => `<button class="category-pill-btn" data-id="${c.id}">${c.name}</button>`).join('')}
      `;

      // Category Pill Button Clicks
      prodCategoriesBar.querySelectorAll('.category-pill-btn').forEach(btn => {
        btn.onclick = () => {
          prodCategoriesBar.querySelectorAll('.category-pill-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const id = btn.dataset.id;
          selectedCategory = id === 'all' ? null : id;
          renderProductsTable();
        };
      });

      renderProductsTable();
    }
  } catch (e) {
    console.error(e);
    productsContainer.innerHTML = '<div style="color:var(--color-danger); font-size:12px; padding:40px; text-align:center;">Error al cargar productos</div>';
  }

  // Live products searching
  prodSearchInput.oninput = () => {
    searchQuery = prodSearchInput.value.toLowerCase().trim();
    renderProductsTable();
  };

  modalContent.querySelector('#save-offer-btn').onclick = async () => {
    const btn = modalContent.querySelector('#save-offer-btn');
    const title = modalContent.querySelector('#offer-title').value.trim();
    const type = typeSelect.value;
    const value = parseFloat(modalContent.querySelector('#offer-value').value);
    let banner = modalContent.querySelector('#offer-banner').value.trim();

    const selectedProducts = Array.from(checkedProductIds);

    if (!title || selectedProducts.length === 0) {
      return showToast('Ingresa un título y selecciona productos', 'error');
    }
    if (type === 'percentage' && (isNaN(value) || value <= 0 || value > 100)) {
      return showToast('Ingresa un porcentaje válido (1-100)', 'error');
    }

    // Default banner to the first selected product's image if blank
    if (!banner) {
      const firstProd = activeProducts.find(p => p.id === selectedProducts[0]);
      if (firstProd && firstProd.image) {
        banner = firstProd.image;
      }
    }

    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      if (existingOffer) {
        await updateDoc(doc(db, 'offers', existingOffer.id), {
          title,
          type,
          value: type === 'percentage' ? value : null,
          banner,
          productIds: selectedProducts,
          updatedAt: serverTimestamp()
        });
        showToast('Oferta actualizada', 'success');
      } else {
        await addDoc(collection(db, 'offers'), {
          comercioId,
          comercioName,
          title,
          type,
          value: type === 'percentage' ? value : null,
          banner,
          productIds: selectedProducts,
          active: true,
          createdAt: serverTimestamp()
        });
        showToast('Oferta creada', 'success');
      }
      closeModal();
      if (afterSave) afterSave();
    } catch (err) {
      console.error(err);
      showToast('Error al guardar', 'error');
      btn.disabled = false;
      btn.textContent = existingOffer ? 'Guardar Cambios' : 'Crear Oferta';
    }
  };
}

// ═══════════════════════════════════════════════════
// CUSTOM MERCHANT COUPONS MANAGEMENT (NEW)
// ═══════════════════════════════════════════════════
