// GoDelivery — Admin Offers Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, deleteDoc, updateDoc, addDoc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { formatPrice } from '../../utils/format.js';

export async function renderAdminOffers() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <button onclick="location.hash='#/admin'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Ofertas y Promociones</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Gestión Global</p>
        </div>
        <button id="admin-create-offer-btn" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; position:relative; z-index:2;">
          ${icon('plus', 20)}
        </button>
      </div>

      <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px;">
        <div id="admin-offers-list">
          <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('admin-create-offer-btn').onclick = () => openOfferEditor();
  const unsubOffers = loadOffers();
  return {
    cleanup: () => {
      if (unsubOffers) unsubOffers();
    }
  };
}

function loadOffers() {
  const container = document.getElementById('admin-offers-list');
  if (!container) return;

  return onSnapshot(collection(db, 'offers'), (snap) => {
    const offers = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (offers.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:600;">No hay ofertas activas</div>`;
      return;
    }

    container.innerHTML = offers.map(o => `
      <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:16px; margin-bottom:12px; display:flex; align-items:center; gap:12px;">
        <div style="width:48px; height:48px; border-radius:12px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
          ${o.banner 
            ? `<img src="${o.banner}" alt="" style="width:100%; height:100%; object-fit:cover;" />` 
            : `<div style="color:var(--color-primary); display:flex; align-items:center; justify-content:center;">${icon('sparkles', 24)}</div>`
          }
        </div>
        <div style="flex:1;">
          <div style="font-weight:800; font-size:16px; color:var(--color-text);">${o.title}</div>
          <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">
            ${o.comercioName || 'Comercio Desconocido'} • ${o.type === '2x1' ? '2x1' : o.value + '% OFF'}
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="toggle-offer-btn" data-id="${o.id}" data-active="${o.active}" style="width:40px; height:40px; border-radius:12px; border:none; background:var(--color-bg-secondary); color:${o.active ? 'var(--color-success)' : 'var(--color-text-tertiary)'}; cursor:pointer;">
            ${icon(o.active ? 'check' : 'x', 20)}
          </button>
          <button class="edit-offer-btn" data-id="${o.id}" style="width:40px; height:40px; border-radius:12px; border:none; background:var(--color-bg-secondary); color:var(--color-text-secondary); cursor:pointer;">
            ${icon('edit', 20)}
          </button>
          <button class="delete-offer-btn" data-id="${o.id}" style="width:40px; height:40px; border-radius:12px; border:none; background:var(--color-danger-light); color:var(--color-danger); cursor:pointer;">
            ${icon('trash', 20)}
          </button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.toggle-offer-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const active = btn.dataset.active === 'true';
        await updateDoc(doc(db, 'offers', id), { active: !active });
      };
    });

    container.querySelectorAll('.edit-offer-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const offer = offers.find(o => o.id === id);
        if (offer) {
          openOfferEditor(offer);
        }
      };
    });

    container.querySelectorAll('.delete-offer-btn').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('¿Eliminar oferta?')) {
          await deleteDoc(doc(db, 'offers', btn.dataset.id));
        }
      };
    });
  }, (err) => {
    console.error(err);
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--color-danger);">Error al cargar</div>`;
  });
}

async function openOfferEditor(existingOffer = null) {
  const modalContent = document.createElement('div');
  modalContent.style.height = '100dvh';
  modalContent.style.display = 'flex';
  modalContent.style.flexDirection = 'column';
  modalContent.style.background = 'var(--color-bg)';

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
      
      <div class="form-group" style="position: relative;">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Comercio *</label>
        <div style="position: relative;">
          <input type="text" id="comercio-autocomplete" value="${existingOffer ? existingOffer.comercioName : ''}" placeholder="Buscar comercio por nombre..." autocomplete="off" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-surface); color:var(--color-text);" />
          <input type="hidden" id="offer-comercio-id" value="${existingOffer ? existingOffer.comercioId : ''}" />
          <input type="hidden" id="offer-comercio-name" value="${existingOffer ? existingOffer.comercioName : ''}" />
        </div>
        <div id="comercio-suggestions" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; box-shadow:var(--shadow-lg); max-height:220px; overflow-y:auto; z-index:1000; margin-top:6px;"></div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Título de la Oferta</label>
        <input type="text" id="offer-title" value="${existingOffer ? existingOffer.title : ''}" placeholder="Ej: Burger Week" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
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
          <input type="number" id="offer-value" value="${existingOffer && existingOffer.value !== null && existingOffer.value !== undefined ? existingOffer.value : ''}" placeholder="Ej: 20" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); margin-bottom:8px;">Banner URL (Opcional - por defecto usa imagen de producto)</label>
        <input type="text" id="offer-banner" value="${existingOffer && existingOffer.banner ? existingOffer.banner : ''}" placeholder="URL de la imagen" style="width:100%; height:50px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <!-- Advanced Products Selection Section -->
      <div class="form-group" style="display:flex; flex-direction:column; gap:12px; flex:1; min-height:350px;">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary);">Productos Seleccionados *</label>
        
        <!-- Filter Toolbar -->
        <div id="product-toolbar" style="display:none; flex-direction:column; gap:12px; background:var(--color-surface); padding:16px; border-radius:20px; border:1px solid var(--color-border-light);">
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
          <div style="color:var(--color-text-tertiary); font-size:13px; text-align:center; padding:60px 20px; font-weight:600;">Busca y selecciona un comercio primero</div>
        </div>
      </div>

    </div>

    <!-- Sticky Footer -->
    <div style="padding: 16px 24px; border-top: 1px solid var(--color-border-light); background: var(--color-surface); flex-shrink: 0; display: flex; gap: 12px;">
      <button id="cancel-offer-btn" style="flex: 1; height: 54px; border-radius: 18px; border: 1px solid var(--color-border); background: var(--color-bg-secondary); font-weight: 800; font-size: 15px; cursor: pointer; color: var(--color-text-secondary);">Cancelar</button>
      <button id="save-offer-btn" style="flex: 2; height: 54px; border-radius: 18px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 16px; cursor: pointer;">${existingOffer ? 'Guardar Cambios' : 'Crear Oferta'}</button>
    </div>
    
    <style>
      .autocomplete-suggestion-item {
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid var(--color-border-light);
        transition: background 0.2s;
      }
      .autocomplete-suggestion-item:hover {
        background: var(--color-bg-secondary);
      }
      .autocomplete-suggestion-item:last-child {
        border-bottom: none;
      }

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

  const autocompleteInput = modalContent.querySelector('#comercio-autocomplete');
  const commerceIdInput = modalContent.querySelector('#offer-comercio-id');
  const commerceNameInput = modalContent.querySelector('#offer-comercio-name');
  const suggestionsDropdown = modalContent.querySelector('#comercio-suggestions');
  const typeSelect = modalContent.querySelector('#offer-type');
  const valueGroup = modalContent.querySelector('#offer-value-group');
  const productsContainer = modalContent.querySelector('#offer-products-container');
  const productToolbar = modalContent.querySelector('#product-toolbar');
  const prodSearchInput = modalContent.querySelector('#prod-search-input');
  const prodCategoriesBar = modalContent.querySelector('#prod-categories-bar');

  let activeProducts = [];
  let allComercios = [];
  let categories = [];
  let selectedCategory = null; // null means 'TODOS'
  let searchQuery = '';
  const checkedProductIds = new Set();

  // Load comercios
  try {
    const cSnap = await getDocs(collection(db, 'comercios'));
    allComercios = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    allComercios.sort((a,b) => (a.name||'').localeCompare(b.name||''));
  } catch (e) {
    console.error('Error loading comercios for autocomplete:', e);
  }

  // Handle autocomplete input
  autocompleteInput.oninput = () => {
    const queryStr = autocompleteInput.value.toLowerCase().trim();
    if (!queryStr) {
      suggestionsDropdown.style.display = 'none';
      return;
    }

    const filtered = allComercios.filter(c => (c.name || '').toLowerCase().includes(queryStr));
    if (filtered.length === 0) {
      suggestionsDropdown.innerHTML = `<div style="padding:14px; text-align:center; color:var(--color-text-tertiary); font-size:13px; font-weight:600;">No se encontraron comercios</div>`;
    } else {
      suggestionsDropdown.innerHTML = filtered.map(c => `
        <div class="autocomplete-suggestion-item" data-id="${c.id}" data-name="${c.name}">
          <img src="${c.logo || '/logo.png'}" alt="" style="width:28px; height:28px; border-radius:8px; object-fit:contain; background:white; border:1px solid var(--color-border-light);" />
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.name}</span>
        </div>
      `).join('');
    }

    suggestionsDropdown.style.display = 'block';
  };

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#comercio-autocomplete') && !e.target.closest('#comercio-suggestions')) {
      suggestionsDropdown.style.display = 'none';
    }
  });

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

  async function selectCommerce(cid, name) {
    commerceIdInput.value = cid;
    commerceNameInput.value = name;
    autocompleteInput.value = name;
    suggestionsDropdown.style.display = 'none';

    // Clear filters and search state
    selectedCategory = null;
    searchQuery = '';
    prodSearchInput.value = '';

    // Trigger loading products
    productsContainer.innerHTML = '<div class="spinner-mini" style="margin:40px auto;"></div>';
    try {
      const pSnap = await getDocs(collection(db, 'comercios', cid, 'products'));
      activeProducts = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const catsSnap = await getDocs(collection(db, 'comercios', cid, 'categories'));
      categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (activeProducts.length === 0) {
        productToolbar.style.display = 'none';
        productsContainer.innerHTML = '<div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-size:13px; font-weight:600;">El comercio no tiene productos</div>';
        return;
      }
      
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

      productToolbar.style.display = 'flex';
      renderProductsTable();
    } catch (err) {
      console.error(err);
      productsContainer.innerHTML = '<div style="color:var(--color-danger); font-size:12px; padding:40px; text-align:center;">Error al cargar productos</div>';
    }
  }

  // Suggestion item selection click handler
  suggestionsDropdown.onclick = async (e) => {
    const item = e.target.closest('.autocomplete-suggestion-item');
    if (!item) return;

    checkedProductIds.clear();
    await selectCommerce(item.dataset.id, item.dataset.name);
  };

  if (existingOffer) {
    if (existingOffer.productIds) {
      existingOffer.productIds.forEach(id => checkedProductIds.add(id));
    }
    await selectCommerce(existingOffer.comercioId, existingOffer.comercioName);
  }

  // Live products searching
  prodSearchInput.oninput = () => {
    searchQuery = prodSearchInput.value.toLowerCase().trim();
    renderProductsTable();
  };

  typeSelect.onchange = () => {
    if (typeSelect.value === '2x1') {
      valueGroup.style.display = 'none';
    } else {
      valueGroup.style.display = 'block';
    }
  };

  modalContent.querySelector('#save-offer-btn').onclick = async () => {
    const btn = modalContent.querySelector('#save-offer-btn');
    const comercioId = commerceIdInput.value;
    const comercioName = commerceNameInput.value;
    const title = modalContent.querySelector('#offer-title').value.trim();
    const type = typeSelect.value;
    const value = parseFloat(modalContent.querySelector('#offer-value').value);
    let banner = modalContent.querySelector('#offer-banner').value.trim();

    const selectedProducts = Array.from(checkedProductIds);

    if (!comercioId || !title || selectedProducts.length === 0) {
      return showToast('Completa todos los campos y selecciona productos', 'error');
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
          comercioId,
          comercioName,
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
      loadOffers();
    } catch (err) {
      console.error(err);
      showToast('Error al guardar', 'error');
      btn.disabled = false;
      btn.textContent = existingOffer ? 'Guardar Cambios' : 'Crear Oferta';
    }
  };
}
