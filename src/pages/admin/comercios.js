// GoDelivery — Admin Comercios Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { openCropper } from '../../utils/cropper.js';

export async function renderAdminComercios() {
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
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Gestión de Comercios</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Control total de perfiles y catálogos</p>
        </div>
      </div>

      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; background:var(--color-bg);">
        <div style="background:var(--color-surface); padding:12px 20px 20px; border-bottom:1px solid var(--color-border); flex-shrink:0;">
          <div style="background:var(--color-bg-secondary); border-radius:16px; height:50px; display:flex; align-items:center; padding:0 16px; gap:12px; border:1px solid var(--color-border); box-shadow:inset 0 2px 4px rgba(0,0,0,0.02);">
            <span style="color:var(--color-text-tertiary);">${icon('search', 20)}</span>
            <input type="text" id="admin-comercio-search" placeholder="Buscar comercio por nombre..." style="flex:1; border:none; background:transparent; font-size:15px; font-weight:600; outline:none; color:var(--color-text);" />
          </div>
        </div>

        <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch;">
          <div id="comercios-list">
            <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  let allComercios = [];

  const loadAndFilter = (searchQuery = '') => {
    const container = document.getElementById('comercios-list');
    if (!container) return;

    const filtered = allComercios.filter(c => {
      const isGoMarket = (c.name || '').toLowerCase().includes('go!') && (c.name || '').toLowerCase().includes('market');
      if (isGoMarket) return false;
      return (c.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:600;">No se encontraron comercios${searchQuery ? ' para "' + searchQuery + '"' : ''}</div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${filtered.map(c => `
          <div class="admin-comercio-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:16px; display:flex; align-items:center; gap:14px; transition:all 0.2s; position:relative;">
            <div style="width:52px; height:52px; border-radius:50%; overflow:hidden; border:1px solid var(--color-border-light); background:white; flex-shrink:0; padding:2px;">
              <img src="${c.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-weight:800; font-size:16px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:8px;">
                ${c.name}
                ${c.approvedByAdmin === false ? `
                  <span style="font-size:10px; font-weight:800; background:#f59e0b; color:white; padding:2px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:0.03em;">Pendiente</span>
                ` : ''}
              </div>
              <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600; display:flex; align-items:center; gap:4px;">
                ${icon('tag', 12)} ${c.category || 'Sin categoría'}
              </div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="admin-edit-com-btn" data-id="${c.id}" style="width:42px; height:42px; border-radius:12px; border:none; background:var(--color-bg-secondary); color:var(--color-text); display:flex; align-items:center; justify-content:center; cursor:pointer;">
                ${icon('settings', 20)}
              </button>
              <a href="#/mi-comercio/${c.id}/orders" style="width:42px; height:42px; border-radius:12px; border:none; background:var(--color-primary-lighter); color:var(--color-primary); display:flex; align-items:center; justify-content:center; text-decoration:none;">
                ${icon('package', 20)}
              </a>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.admin-edit-com-btn').forEach(btn => {
      btn.onclick = () => openComercioEditor(allComercios.find(c => c.id === btn.dataset.id), () => refreshData());
    });
  };

  const refreshData = async () => {
    try {
      const snap = await getDocs(collection(db, 'comercios'));
      allComercios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      allComercios.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      loadAndFilter(document.getElementById('admin-comercio-search')?.value || '');
    } catch (err) {
      console.error('Error loading comercios:', err);
    }
  };

  // Initial load
  await refreshData();

  // Bind search input
  const searchInput = document.getElementById('admin-comercio-search');
  if (searchInput) {
    searchInput.oninput = (e) => loadAndFilter(e.target.value);
  }
}

async function openComercioEditor(comercio, onSaved) {
  let platformCategories = [];
  try {
    const platCatsSnap = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
    platformCategories = platCatsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
    if (!platformCategories.some(c => c.name === 'Comida')) {
      platformCategories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
    }
  } catch (err) {
    console.error('Error fetching categories in admin editor:', err);
  }

  let comercioCoords = comercio.coords || null;
  let croppedLogo = comercio.logo || '';
  let croppedBanner = comercio.banner || '';
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; overflow-y: auto; height: 100%;';

  modalContent.innerHTML = `
    <div style="text-align:center; margin-bottom:24px;">
      <div style="width:70px; height:70px; border-radius:50%; overflow:hidden; border:2px solid var(--color-primary); margin:0 auto 12px; background:white; box-shadow:0 8px 20px rgba(0,0,0,0.1); padding:2px;">
        <img src="${comercio.logo || '/logo.png'}" id="edit-com-logo-top-preview" style="width:100%; height:100%; object-fit:cover;" />
      </div>
      <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; margin:0;">Editar Comercio</h2>
      <p style="font-size:12px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">${comercio.name}</p>
    </div>
    
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Nombre Público *</label>
        <input type="text" id="edit-com-name" value="${comercio.name || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Rubro Principal *</label>
        <select id="edit-com-cat" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-bg) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none;">
          ${platformCategories.map(c => `<option value="${c.name}" ${comercio.category === c.name ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Comisión del Sistema (%)</label>
        <input type="number" id="edit-com-commission" placeholder="Ej: 15 (Dejar vacío para global)" value="${comercio.commissionRate !== undefined && comercio.commissionRate !== null ? Math.round(comercio.commissionRate * 100) : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Logo *</label>
          <div style="position:relative; width:100%; height:120px; border-radius:16px; border:2px dashed var(--color-border); display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--color-bg-secondary); cursor:pointer;">
            <img src="${comercio.logo || '/logo.png'}" id="edit-com-logo-preview" style="width:100%; height:100%; object-fit:cover; position:absolute; inset:0; ${comercio.logo ? '' : 'opacity:0.35;'}" />
            <span id="logo-upload-icon" style="position:relative; z-index:2; pointer-events:none; font-size:24px; color:var(--color-text-tertiary); ${comercio.logo ? 'display:none;' : ''}">${icon('upload', 24)}</span>
            <input type="file" accept="image/*" id="edit-com-logo-file" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
          </div>
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Banner *</label>
          <div style="position:relative; width:100%; height:120px; border-radius:16px; border:2px dashed var(--color-border); display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--color-bg-secondary); cursor:pointer;">
            <img src="${comercio.banner || '/logo.png'}" id="edit-com-banner-preview" style="width:100%; height:100%; object-fit:cover; position:absolute; inset:0; ${comercio.banner ? '' : 'opacity:0.12;'}" />
            <span id="banner-upload-icon" style="position:relative; z-index:2; pointer-events:none; font-size:24px; color:var(--color-text-tertiary); ${comercio.banner ? 'display:none;' : ''}">${icon('upload', 24)}</span>
            <input type="file" accept="image/*" id="edit-com-banner-file" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
          </div>
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Dirección Física *</label>
        <div style="display:flex; gap:10px; width:100%; position:relative;">
          <div style="position:relative; flex:1;">
            <input type="text" id="edit-com-address" value="${comercio.address || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" autocomplete="off" />
            <div id="edit-com-address-suggestions" style="position:absolute; top:100%; left:0; right:0; background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:12px; box-shadow:var(--shadow-lg); z-index:9999; max-height:200px; overflow-y:auto; margin-top:4px; display:none;"></div>
          </div>
          <button type="button" class="btn btn-primary" id="open-com-map-btn" style="width:54px; height:54px; border-radius:16px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border:none; background:var(--color-primary); color:white; cursor:pointer;">
            ${icon('mapPin', 24)}
          </button>
        </div>
        <div id="edit-com-address-badge" style="display:none; font-size:12px; font-weight:700; color:#0d9488; background:rgba(13,148,136,0.06); border:1px solid rgba(13,148,136,0.18); border-radius:8px; padding:8px 12px; align-items:center; gap:6px; word-break:break-all; line-height:1.4; margin-top:8px;">
          ${icon('checkCircle', 14)} Dirección seleccionada y verificada
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:14px; background:var(--color-bg-secondary); padding:16px; border-radius:16px; border:1px solid var(--color-border-light);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <label style="display:block; font-size:13px; font-weight:800; color:var(--color-text-primary);">Aprobado por Administrador</label>
            <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:600;">Permite que el comercio aparezca en la app</span>
          </div>
          <input type="checkbox" id="edit-com-approved" ${comercio.approvedByAdmin !== false ? 'checked' : ''} style="width:22px; height:22px; accent-color:var(--color-primary); cursor:pointer;" />
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--color-border-light); padding-top:12px; margin-top:4px;">
          <div>
            <label style="display:block; font-size:13px; font-weight:800; color:var(--color-text-primary);">Comercio Activo (Visible)</label>
            <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:600;">Controla la visibilidad pública en la app</span>
          </div>
          <input type="checkbox" id="edit-com-active" ${comercio.isActive !== false ? 'checked' : ''} style="width:22px; height:22px; accent-color:var(--color-primary); cursor:pointer;" />
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px; margin-top:10px;">
        <button id="save-com-btn" style="width:100%; height:60px; border-radius:20px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 10px 30px rgba(var(--color-primary-rgb),0.25);">
          Guardar Cambios
        </button>
        <button id="delete-com-btn" style="width:100%; height:54px; border-radius:20px; background:transparent; color:var(--color-danger); border:1.5px solid var(--color-danger); font-weight:800; font-size:14px; cursor:pointer;">
          Eliminar Comercio Definitivamente
        </button>
        <a href="#/mi-comercio/${comercio.id}/orders" style="width:100%; height:54px; border-radius:20px; background:var(--color-bg-secondary); color:var(--color-text); border:1.5px solid var(--color-border); display:flex; align-items:center; justify-content:center; text-decoration:none; font-weight:800; font-size:14px; gap:8px;">
          ${icon('package', 20)} Administrar Productos y Pedidos
        </a>
      </div>
    </div>
  `;

  showModal({ title: '', hideHeader: true, height: '90dvh', content: modalContent });

  const addressInput = modalContent.querySelector('#edit-com-address');
  const suggestionsDropdown = modalContent.querySelector('#edit-com-address-suggestions');
  const badgeEl = modalContent.querySelector('#edit-com-address-badge');

  const selectLocation = (coords, address) => {
    comercioCoords = coords;
    if (addressInput) addressInput.value = address;
    if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';

    if (badgeEl) {
      badgeEl.style.display = 'flex';
      badgeEl.innerHTML = `${icon('checkCircle', 14)} Dirección seleccionada y verificada: <span style="font-weight:800; margin-left:4px; color:var(--color-text-primary);">${address}</span>`;
    }
  };

  if (comercioCoords && comercio.address && badgeEl) {
    selectLocation(comercioCoords, comercio.address);
  }

  let debounceTimeout;
  addressInput?.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    const term = e.target.value;
    if (term.trim().length < 3) {
      if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const { searchAddressSuggestions } = await import('../../utils/geo.js');
        const suggestions = await searchAddressSuggestions(term);
        if (suggestions.length === 0) {
          if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
          return;
        }

        if (suggestionsDropdown) {
          suggestionsDropdown.innerHTML = suggestions.map(s => `
            <div class="suggestion-item" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${s.address}" style="padding:12px 16px; font-size:13px; font-weight:600; color:var(--color-text-primary); cursor:pointer; border-bottom:1px solid var(--color-border-light);">
              ${s.address}
            </div>
          `).join('');
          suggestionsDropdown.style.display = 'block';

          suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.onclick = () => {
              const lat = parseFloat(item.dataset.lat);
              const lng = parseFloat(item.dataset.lng);
              const addr = item.dataset.addr;
              selectLocation({ lat, lng }, addr);
            };
          });
        }
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }, 400);
  });

  // Handle Logo Upload via Cropper
  modalContent.querySelector('#edit-com-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 1, circular: true });
        croppedLogo = cropped;
        
        const preview = modalContent.querySelector('#edit-com-logo-preview');
        if (preview) {
          preview.src = cropped;
          preview.style.opacity = '1';
        }
        const topPreview = modalContent.querySelector('#edit-com-logo-top-preview');
        if (topPreview) {
          topPreview.src = cropped;
        }
        const iconEl = modalContent.querySelector('#logo-upload-icon');
        if (iconEl) iconEl.style.display = 'none';
      } catch (err) {
        console.error('Error cropping logo:', err);
      }
    }
  });

  // Handle Banner Upload via Cropper
  modalContent.querySelector('#edit-com-banner-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 16/8 });
        croppedBanner = cropped;
        
        const preview = modalContent.querySelector('#edit-com-banner-preview');
        if (preview) {
          preview.src = cropped;
          preview.style.opacity = '1';
        }
        const iconEl = modalContent.querySelector('#banner-upload-icon');
        if (iconEl) iconEl.style.display = 'none';
      } catch (err) {
        console.error('Error cropping banner:', err);
      }
    }
  });

  modalContent.querySelector('#open-com-map-btn')?.addEventListener('click', async () => {
    try {
      const { showLocationPicker } = await import('../../components/location-modal.js');
      showLocationPicker({
        initialCoords: comercioCoords,
        initialAddress: addressInput ? addressInput.value : '',
        onSelect: ({ coords, address }) => {
          selectLocation(coords, address);
        }
      });
    } catch (err) {
      console.error(err);
      showToast('Error al abrir el mapa', 'danger');
    }
  });

  // Handle Save
  modalContent.querySelector('#save-com-btn').onclick = async () => {
    const btn = modalContent.querySelector('#save-com-btn');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    const commValue = document.getElementById('edit-com-commission').value;

    const updateData = {
      name: document.getElementById('edit-com-name').value.trim(),
      category: document.getElementById('edit-com-cat').value.trim(),
      logo: croppedLogo,
      banner: croppedBanner,
      address: document.getElementById('edit-com-address').value.trim(),
      coords: comercioCoords,
      approvedByAdmin: document.getElementById('edit-com-approved').checked,
      isActive: document.getElementById('edit-com-active').checked
    };

    const showCenterAlert = (title, message) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        opacity: 0;
        transition: opacity 0.2s ease-out;
      `;
      
      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 24px;
        padding: 24px;
        width: 90%;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        transform: scale(0.9);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      `;
      
      card.innerHTML = `
        <div style="
          width: 56px;
          height: 56px;
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h3 style="margin: 0 0 10px 0; font-family: var(--font-display); font-size: 18px; font-weight: 900; color: var(--color-text-primary);">${title}</h3>
        <p style="margin: 0 0 24px 0; font-size: 13.5px; color: var(--color-text-secondary); line-height: 1.5; font-weight: 600;">${message}</p>
        <button id="alert-close-btn" style="
          width: 100%;
          height: 50px;
          border: none;
          background: var(--color-primary);
          color: white;
          font-weight: 850;
          font-size: 14px;
          border-radius: 14px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.2);
        ">Entendido</button>
      `;
      
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        card.style.transform = 'scale(1)';
      });
      
      const closeAlert = () => {
        overlay.style.opacity = '0';
        card.style.transform = 'scale(0.9)';
        setTimeout(() => {
          overlay.remove();
        }, 200);
      };
      
      card.querySelector('#alert-close-btn').onclick = closeAlert;
      overlay.onclick = (e) => {
        if (e.target === overlay) closeAlert();
      };
    };

    if (!updateData.name || !updateData.category || !updateData.logo || !updateData.banner || !updateData.address || !updateData.coords) {
      showCenterAlert('Datos Incompletos', 'Todos los datos del comercio, incluyendo ubicación en mapa, logo y banner son obligatorios para poder guardar los cambios.');
      btn.disabled = false;
      btn.innerText = 'Guardar Cambios';
      return;
    }

    if (commValue !== '') {
      updateData.commissionRate = parseFloat(commValue) / 100;
    } else {
      updateData.commissionRate = null;
    }

    try {
      await updateDoc(doc(db, 'comercios', comercio.id), updateData);
      showToast('Perfil actualizado correctamente', 'success');
      closeModal();
      onSaved();
    } catch (err) {
      console.error('Error saving commerce profile:', err);
      showToast('Error al guardar cambios', 'danger');
      btn.disabled = false;
      btn.innerText = 'Guardar Cambios';
    }
  };

  // Handle Delete
  modalContent.querySelector('#delete-com-btn').onclick = () => {
    import('../../components/modal.js').then(m => {
      m.showConfirm({
        title: '¿Eliminar Comercio?',
        message: `Esta acción es definitiva. Se borrará "${comercio.name}" y toda su configuración. ¿Estás seguro?`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'comercios', comercio.id));
            showToast('Comercio eliminado', 'success');
            closeModal();
            onSaved();
          } catch (err) {
            console.error('Error deleting commerce:', err);
            showToast('Error al eliminar', 'danger');
          }
        }
      });
    });
  };
}
