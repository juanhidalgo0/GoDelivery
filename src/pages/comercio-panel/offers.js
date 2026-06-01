// GoDelivery — Comercio Offers Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, deleteDoc, updateDoc, addDoc, serverTimestamp, query, where, getDoc, setDoc } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { getRouteParams } from '../../router.js';
import { formatPrice } from '../../utils/format.js';

let comercioId = null;
let comercioName = '';

export async function renderComercioOffers() {
  const content = document.getElementById('app-content');
  if (!content) return;

  const params = getRouteParams();
  comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  const { getState } = await import('../../state.js');
  const user = getState().user;
  const { isAdmin } = await import('../../auth.js');

  try {
    const cSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (!cSnap.exists()) {
      location.hash = '#/profile';
      return;
    }
    const comercioData = cSnap.data();
    if (comercioData.ownerId !== user?.uid && !isAdmin()) {
      location.hash = '#/profile';
      return;
    }
    comercioName = comercioData.name;

    content.innerHTML = `
      <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
        <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0;">
          <button onclick="location.hash='#/mi-comercio/${comercioId}/orders'" style="width:40px; height:40px; border-radius:12px; background:var(--color-bg-secondary); border:1px solid var(--color-border); display:flex; align-items:center; justify-content:center; color:var(--color-text);">
            ${icon('arrowLeft', 20)}
          </button>
          <div style="flex:1;">
            <h1 id="comercio-page-title" style="font-family:var(--font-display); font-size:20px; font-weight:900; margin:0;">Mis Ofertas</h1>
            <p id="comercio-page-subtitle" style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-top:2px;">Promociones de ${comercioName}</p>
          </div>
          <button id="comercio-create-offer-btn" style="width:40px; height:40px; border-radius:12px; background:var(--color-primary); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:var(--shadow-sm);">
            ${icon('plus', 20)}
          </button>
        </div>

        <!-- Segmented Tab selector -->
        <div style="padding: 12px 20px 0 20px; flex-shrink:0;">
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border);">
            <button id="comercio-tab-offers" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 6px rgba(0,0,0,0.06); transition:all 0.2s;">
              🏷️ Ofertas
            </button>
            <button id="comercio-tab-coupons" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">
              🎫 Cupones
            </button>
          </div>
        </div>

        <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px;">
          <div id="comercio-offers-list">
            <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    `;

    const tabOffers = document.getElementById('comercio-tab-offers');
    const tabCoupons = document.getElementById('comercio-tab-coupons');
    const createBtn = document.getElementById('comercio-create-offer-btn');
    const titleEl = document.getElementById('comercio-page-title');
    const subtitleEl = document.getElementById('comercio-page-subtitle');

    const setActiveTab = (tab) => {
      if (tab === 'offers') {
        tabOffers.style.background = 'white';
        tabOffers.style.color = 'var(--color-text)';
        tabOffers.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
        tabCoupons.style.background = 'transparent';
        tabCoupons.style.color = 'var(--color-text-tertiary)';
        tabCoupons.style.boxShadow = 'none';
        
        titleEl.textContent = 'Mis Ofertas';
        subtitleEl.textContent = `Promociones de ${comercioName}`;
        createBtn.onclick = () => openOfferEditor();
        loadOffers();
      } else {
        tabCoupons.style.background = 'white';
        tabCoupons.style.color = 'var(--color-text)';
        tabCoupons.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
        tabOffers.style.background = 'transparent';
        tabOffers.style.color = 'var(--color-text-tertiary)';
        tabOffers.style.boxShadow = 'none';

        titleEl.textContent = 'Mis Cupones';
        subtitleEl.textContent = `Cupones creados por ${comercioName}`;
        createBtn.onclick = () => openCouponEditor();
        loadComercioCoupons();
      }
    };

    tabOffers.onclick = () => setActiveTab('offers');
    tabCoupons.onclick = () => setActiveTab('coupons');

    createBtn.onclick = () => openOfferEditor();
    loadOffers();
  } catch (err) {
    console.error('Error rendering offers:', err);
    location.hash = '#/profile';
  }
}

async function loadOffers() {
  const container = document.getElementById('comercio-offers-list');
  if (!container) return;

  try {
    const snap = await getDocs(query(collection(db, 'offers'), where('comercioId', '==', comercioId)));
    const offers = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (offers.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:600;">No tienes ofertas activas</div>`;
      return;
    }

    container.innerHTML = offers.map(o => `
      <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:20px; padding:16px; margin-bottom:12px; display:flex; align-items:center; gap:12px;">
        <div style="width:48px; height:48px; border-radius:12px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
          ${o.banner 
            ? `<img src="${o.banner}" alt="" style="width:100%; height:100%; object-fit:cover;" />` 
            : `<div style="color:var(--color-secondary); display:flex; align-items:center; justify-content:center;">${icon('sparkles', 24)}</div>`
          }
        </div>
        <div style="flex:1;">
          <div style="font-weight:800; font-size:16px; color:var(--color-text);">${o.title}</div>
          <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">
            ${o.type === '2x1' ? '2x1' : o.value + '% OFF'} • ${o.productIds.length} producto(s)
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
        loadOffers();
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
          loadOffers();
        }
      };
    });

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--color-danger);">Error al cargar</div>`;
  }
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
    const pSnap = await getDocs(collection(db, 'comercios', comercioId, 'products'));
    activeProducts = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
      loadOffers();
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

async function loadComercioCoupons() {
  const container = document.getElementById('comercio-offers-list');
  if (!container) return;

  container.innerHTML = `<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>`;

  try {
    const snap = await getDocs(query(collection(db, 'coupons'), where('ownerId', '==', comercioId)));
    const coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (coupons.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:600; display:flex; flex-direction:column; align-items:center; gap:16px;">
          <div style="width:56px; height:56px; border-radius:50%; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-secondary);">
            ${icon('tag', 26)}
          </div>
          <div>
            <div style="font-weight:800; font-size:16px; color:var(--color-text); margin-bottom:4px;">No tienes cupones creados</div>
            <div style="font-size:12px;">Haz click en el botón + para generar tu primer cupón de descuento.</div>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = coupons.map(c => {
      const discountType = c.discountType || 'percentage';
      const label = discountType === 'percentage' ? `${c.value}% DESCUENTO` : `$${c.value} DESCUENTO`;
      
      const usageLimit = c.usageLimit || 0;
      const remaining = typeof c.remaining === 'number' ? c.remaining : 0;
      const usedCount = c.usedCount || 0;
      const percentLeft = usageLimit > 0 ? (remaining / usageLimit) * 100 : 0;

      const expirationDate = c.expirationDate;
      const expiryBadge = expirationDate 
        ? `<span style="font-size:10px; font-weight:800; background:rgba(239, 68, 68, 0.06); color:#ef4444; padding:3px 8px; border-radius:6px; letter-spacing:0.5px; text-transform:uppercase;">🕒 Vence: ${expirationDate.split('-').reverse().join('/')}</span>`
        : `<span style="font-size:10px; font-weight:800; background:rgba(34, 197, 94, 0.06); color:#22c55e; padding:3px 8px; border-radius:6px; letter-spacing:0.5px; text-transform:uppercase;">♾️ Sin Vence</span>`;

      return `
        <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:18px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-sm); opacity:${c.active ? '1' : '0.65'}; transition:all 0.2s;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg, #fef08a 0%, #eab308 100%)---; background:linear-gradient(135deg, #c084fc 0%, #a855f7 100%); display:flex; align-items:center; justify-content:center; color:white; flex-shrink:0;">
                ${icon('tag', 20)}
              </div>
              <div>
                <div style="font-family:monospace; font-weight:900; font-size:18px; color:var(--color-text); letter-spacing:-0.03em; background:var(--color-bg-secondary); padding:4px 8px; border-radius:8px; display:inline-block; border:1px dashed var(--color-border); text-transform:uppercase;">
                  ${c.id}
                </div>
                <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                  <span style="font-size:10px; font-weight:800; background:rgba(168, 85, 247, 0.1); color:#a855f7; padding:3px 8px; border-radius:6px; letter-spacing:0.5px; text-transform:uppercase;">
                    ${label}
                  </span>
                  ${expiryBadge}
                </div>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:8px;">
              <button class="toggle-coupon-btn" data-id="${c.id}" data-active="${c.active}" style="width:40px; height:24px; border-radius:12px; background:${c.active ? '#a855f7' : 'var(--color-border)'}; border:none; position:relative; cursor:pointer; outline:none; transition:background 0.2s; padding:0;">
                <div style="width:18px; height:18px; border-radius:50%; background:white; position:absolute; top:3px; left:${c.active ? '19px' : '3px'}; transition:left 0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
              </button>

              <button class="delete-coupon-btn" data-id="${c.id}" style="width:36px; height:36px; border-radius:10px; border:none; background:rgba(239, 68, 68, 0.08); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">
                ${icon('trash', 18)}
              </button>
            </div>
          </div>

          <div style="background:var(--color-bg-secondary); border-radius:16px; padding:12px 14px; border:1px solid var(--color-border-light);">
            <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">
              <span>Stock: ${remaining} de ${usageLimit} disponibles</span>
              <span style="font-weight:800; color:${remaining === 0 ? '#ef4444' : 'var(--color-text-primary)'};">${usedCount} canjeados</span>
            </div>
            
            <div style="width:100%; height:8px; background:var(--color-border-light); border-radius:4px; overflow:hidden; position:relative;">
              <div style="width:${percentLeft}%; height:100%; background:${remaining === 0 ? '#ef4444' : 'linear-gradient(90deg, #c084fc 0%, #7e22ce 100%)'}; border-radius:4px; transition:width 0.3s;"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.toggle-coupon-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const active = btn.dataset.active === 'true';
        await updateDoc(doc(db, 'coupons', id), { active: !active });
        showToast(!active ? 'Cupón activado' : 'Cupón desactivado', 'info');
        loadComercioCoupons();
      };
    });

    container.querySelectorAll('.delete-coupon-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        if (confirm(`¿Estás seguro de que deseas eliminar el cupón ${id}?`)) {
          await deleteDoc(doc(db, 'coupons', id));
          showToast('Cupón eliminado', 'success');
          loadComercioCoupons();
        }
      };
    });

  } catch (err) {
    console.error('Error loading merchant coupons:', err);
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--color-danger);">Error al cargar los cupones</div>`;
  }
}

function openCouponEditor() {
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; background: var(--color-bg); border-top-left-radius: 28px; border-top-right-radius: 28px; display: flex; flex-direction: column; gap: 20px;';

  modalContent.innerHTML = `
    <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 8px; flex-shrink: 0;"></div>
    
    <div style="text-align: center;">
      <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 900; color: var(--color-text-primary); margin: 0 0 4px 0;">
        Crear Cupón de Comercio
      </h2>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5;">
        Crea cupones de descuento exclusivos para tu comercio. El valor del descuento correrá por tu cuenta y se deducirá de tu pago neto.
      </p>
    </div>

    <!-- Segmented Type Selector -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Tipo de Descuento</label>
      <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border);">
        <button id="modal-coup-type-fixed" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">
          💲 Fijo ($)
        </button>
        <button id="modal-coup-type-percentage" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 6px rgba(0,0,0,0.06); transition:all 0.2s;">
          🏷️ Porcentaje (%)
        </button>
      </div>
    </div>

    <!-- Value Input -->
    <div id="modal-coup-value-container" style="display:flex; flex-direction:column; gap:6px;">
      <label id="modal-coup-value-label" style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Porcentaje de Descuento</label>
      <div style="position:relative;">
        <input type="number" id="modal-coup-value" value="10" min="1" placeholder="Ej: 15" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 36px 0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
        <span id="modal-coup-value-symbol" style="position:absolute; right:16px; top:50%; transform:translateY(-50%); font-weight:800; color:var(--color-text-secondary);">%</span>
      </div>
    </div>

    <!-- Limit Input -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Cantidad de Cupones (Stock)</label>
      <input type="number" id="modal-coup-limit" value="50" min="1" placeholder="Stock de usos" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
    </div>

    <!-- Expiration Date Input -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Fecha Límite (Opcional)</label>
      <input type="date" id="modal-coup-expiry" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
    </div>

    <!-- Code Input -->
    <div style="display:flex; flex-direction:column; gap:6px;">
      <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Código de Cupón Personalizado</label>
      <input type="text" id="modal-coup-code" placeholder="Ej: PIZZA15" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-family:monospace; font-weight:800; font-size:14px; outline:none; box-sizing:border-box; text-transform:uppercase; color:var(--color-text);" />
      <span style="font-size:10px; font-weight:700; color:var(--color-text-tertiary); padding-left:4px;">Solo letras y números. Se convertirá a mayúsculas.</span>
    </div>

    <div style="display: flex; gap: 12px; margin-top: 12px;">
      <button class="btn btn-ghost" id="modal-coup-cancel" style="height:48px; border-radius:14px; font-weight:800; flex:1;">Cancelar</button>
      <button class="btn btn-primary" id="modal-coup-create" style="height:48px; border-radius:14px; font-weight:900; background:linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); border:none; color:white; flex:2; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 18px rgba(126, 34, 206, 0.2);">
        ${icon('check', 16)} CREAR CUPÓN
      </button>
    </div>
  `;

  showModal({
    title: '',
    hideHeader: true,
    height: 'auto',
    content: modalContent
  });

  // Limit min expiration date to today
  const todayStr = new Date().toISOString().split('T')[0];
  const expiryInput = modalContent.querySelector('#modal-coup-expiry');
  if (expiryInput) {
    expiryInput.min = todayStr;
  }

  let selectedDiscountType = 'percentage'; // 'fixed' or 'percentage'

  const btnTypeFixed = modalContent.querySelector('#modal-coup-type-fixed');
  const btnTypePercentage = modalContent.querySelector('#modal-coup-type-percentage');
  const valueLabel = modalContent.querySelector('#modal-coup-value-label');
  const valueSymbol = modalContent.querySelector('#modal-coup-value-symbol');
  const valueInput = modalContent.querySelector('#modal-coup-value');
  const codeInput = modalContent.querySelector('#modal-coup-code');
  const cancelBtn = modalContent.querySelector('#modal-coup-cancel');
  const createBtn = modalContent.querySelector('#modal-coup-create');

  const setActiveSegButton = (activeBtn, inactiveBtn) => {
    activeBtn.style.background = 'white';
    activeBtn.style.color = 'var(--color-text)';
    activeBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
    inactiveBtn.style.background = 'transparent';
    inactiveBtn.style.color = 'var(--color-text-tertiary)';
    inactiveBtn.style.boxShadow = 'none';
  };

  btnTypeFixed?.addEventListener('click', () => {
    selectedDiscountType = 'fixed';
    setActiveSegButton(btnTypeFixed, btnTypePercentage);
    if (valueLabel) valueLabel.textContent = 'Monto de Descuento';
    if (valueSymbol) valueSymbol.textContent = '$';
    if (valueInput) {
      valueInput.value = '100';
      valueInput.removeAttribute('max');
    }
  });

  btnTypePercentage?.addEventListener('click', () => {
    selectedDiscountType = 'percentage';
    setActiveSegButton(btnTypePercentage, btnTypeFixed);
    if (valueLabel) valueLabel.textContent = 'Porcentaje de Descuento';
    if (valueSymbol) valueSymbol.textContent = '%';
    if (valueInput) {
      valueInput.value = '10';
      valueInput.setAttribute('max', '100');
    }
  });

  codeInput?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  cancelBtn?.addEventListener('click', closeModal);

  createBtn?.addEventListener('click', async () => {
    const code = codeInput?.value.trim().toUpperCase() || '';
    const limit = parseInt(modalContent.querySelector('#modal-coup-limit')?.value || '50', 10);
    const value = parseFloat(valueInput?.value || '0');
    const expiry = modalContent.querySelector('#modal-coup-expiry')?.value || '';

    if (!code) {
      showToast('Por favor, ingresa el código del cupón.', 'warning');
      return;
    }

    if (code.length < 3) {
      showToast('El código debe tener al menos 3 caracteres.', 'warning');
      return;
    }

    if (isNaN(limit) || limit <= 0) {
      showToast('La cantidad debe ser mayor a 0.', 'warning');
      return;
    }

    if (isNaN(value) || value <= 0) {
      showToast('El valor de descuento debe ser mayor a 0.', 'warning');
      return;
    }

    if (selectedDiscountType === 'percentage' && value > 100) {
      showToast('El porcentaje de descuento no puede superar el 100%.', 'warning');
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creando...';

    try {
      // Zero-Trust validation: check existence in firestore
      const docRef = doc(db, 'coupons', code);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        showToast('Este código de cupón ya existe. Elige uno diferente.', 'warning');
        createBtn.disabled = false;
        createBtn.innerHTML = `${icon('check', 16)} CREAR CUPÓN`;
        return;
      }

      await setDoc(docRef, {
        active: true,
        ownerId: comercioId,
        comercioName: comercioName,
        scope: 'products',
        discountType: selectedDiscountType,
        absorbedBy: 'comercio',
        type: selectedDiscountType === 'percentage' ? 'percentage' : 'fixed',
        value: value,
        usageLimit: limit,
        remaining: limit,
        usedCount: 0,
        expirationDate: expiry || null,
        createdAt: serverTimestamp()
      });

      showToast(`Cupón ${code} creado exitosamente`, 'success');
      closeModal();
      loadComercioCoupons();
    } catch (err) {
      console.error('Error creating coupon:', err);
      showToast('Error al crear el cupón', 'error');
      createBtn.disabled = false;
      createBtn.innerHTML = `${icon('check', 16)} CREAR CUPÓN`;
    }
  });
}

function generateRandomAlphanumeric(length = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
