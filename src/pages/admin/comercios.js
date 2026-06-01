// GoDelivery — Admin Comercios Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';

export async function renderAdminComercios() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
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
          <div class="admin-comercio-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:16px; display:flex; align-items:center; gap:14px; transition:all 0.2s;">
            <div style="width:52px; height:52px; border-radius:50%; overflow:hidden; border:1px solid var(--color-border-light); background:white; flex-shrink:0; padding:2px;">
              <img src="${c.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-weight:800; font-size:16px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.name}</div>
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
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding: 24px 20px 40px; overflow-y: auto; height: 100%;';

  modalContent.innerHTML = `
    <div style="text-align:center; margin-bottom:24px;">
      <div style="width:70px; height:70px; border-radius:50%; overflow:hidden; border:2px solid var(--color-primary); margin:0 auto 12px; background:white; box-shadow:0 8px 20px rgba(0,0,0,0.1); padding:2px;">
        <img src="${comercio.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
      </div>
      <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; margin:0;">Editar Comercio</h2>
      <p style="font-size:12px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">${comercio.name}</p>
    </div>
    
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Nombre Público</label>
        <input type="text" id="edit-com-name" value="${comercio.name || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Rubro Principal</label>
        <input type="text" id="edit-com-cat" value="${comercio.category || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Comisión del Sistema (%)</label>
        <input type="number" id="edit-com-commission" placeholder="Ej: 15 (Dejar vacío para global)" value="${comercio.commissionRate !== undefined && comercio.commissionRate !== null ? Math.round(comercio.commissionRate * 100) : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Logo (URL)</label>
          <input type="text" id="edit-com-logo" value="${comercio.logo || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:14px; outline:none;" />
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Banner (URL)</label>
          <input type="text" id="edit-com-banner" value="${comercio.banner || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:14px; outline:none;" />
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Dirección Física</label>
        <input type="text" id="edit-com-address" value="${comercio.address || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
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

  // Handle Save
  modalContent.querySelector('#save-com-btn').onclick = async () => {
    const btn = modalContent.querySelector('#save-com-btn');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    const commValue = document.getElementById('edit-com-commission').value;

    const updateData = {
      name: document.getElementById('edit-com-name').value,
      category: document.getElementById('edit-com-cat').value,
      logo: document.getElementById('edit-com-logo').value,
      banner: document.getElementById('edit-com-banner').value,
      address: document.getElementById('edit-com-address').value
    };

    if (commValue !== '') {
      updateData.commissionRate = parseFloat(commValue) / 100;
    } else {
      updateData.commissionRate = null;
    }

    try {
      await updateDoc(doc(db, 'comercios', comercio.id), updateData);
      showToast('Perfil actualizado correctamente', 'success');
      closeModal();
      loadComercios();
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
            refreshData();
          } catch (err) {
            console.error('Error deleting commerce:', err);
            showToast('Error al eliminar', 'danger');
          }
        }
      });
    });
  };
}
