// GoDelivery — Ads Management (Premium Admin Section)
import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc, Timestamp, query, where } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { formatPrice } from '../../utils/format.js';
import { openCropper } from '../../utils/cropper.js';

export async function renderAdminAds() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg-secondary); overflow:hidden;">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <button onclick="location.hash='#/admin'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Gestión de Anuncios</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Publicidad y Destaques</p>
        </div>
      </div>

      <!-- Segment Tabs -->
      <div style="display:flex; background:var(--color-surface); border-bottom:1px solid var(--color-border-light); padding:10px 16px; gap:10px; flex-shrink:0; z-index:10;">
        <button id="tab-shop-ads" class="ad-tab active" style="flex:1; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); cursor:pointer; transition:all 0.2s;">Destaques de Tiendas</button>
        <button id="tab-custom-ads" class="ad-tab" style="flex:1; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); cursor:pointer; transition:all 0.2s;">Anuncios Personalizados</button>
      </div>

      <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch; padding-bottom:60px;">
        <div id="ads-action-bar" style="display:none; justify-content:flex-end; flex-shrink:0;">
          <button id="btn-create-custom-ad" style="height:44px; padding:0 20px; border-radius:12px; border:none; background:var(--color-primary); color:white; font-weight:800; font-size:13px; display:flex; align-items:center; gap:8px; cursor:pointer; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
            ${icon('plus', 16)} Crear Anuncio
          </button>
        </div>
        <div id="ads-list-container">
          <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>

    <style>
      .ad-tab.active {
        background: var(--color-primary-light);
        color: var(--color-primary) !important;
      }
      .ad-tab:not(.active):hover {
        background: var(--color-bg-secondary);
        color: var(--color-text-secondary);
      }
    </style>
  `;

  let currentTab = 'shop'; // 'shop' or 'custom'

  const tabShop = document.getElementById('tab-shop-ads');
  const tabCustom = document.getElementById('tab-custom-ads');
  const actionBar = document.getElementById('ads-action-bar');
  const createBtn = document.getElementById('btn-create-custom-ad');

  const switchTab = (tab) => {
    currentTab = tab;
    if (tab === 'shop') {
      tabShop.classList.add('active');
      tabCustom.classList.remove('active');
      actionBar.style.display = 'none';
      loadShopAds();
    } else {
      tabShop.classList.remove('active');
      tabCustom.classList.add('active');
      actionBar.style.display = 'flex';
      loadCustomAds();
    }
  };

  tabShop.onclick = () => switchTab('shop');
  tabCustom.onclick = () => switchTab('custom');
  createBtn.onclick = () => openCustomAdEditor();

  // Load initial tab
  loadShopAds();
}

async function loadShopAds() {
  const container = document.getElementById('ads-list-container');
  if (!container) return;
  container.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';

  try {
    const comerciosSnap = await getDocs(collection(db, 'comercios'));
    const comercios = comerciosSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const ads = comercios.map(c => ({
      ...c,
      promotion: c.promotion || { active: false, label: 'Anuncio', isPaid: false, startDate: null, endDate: null, isPriority: false }
    }));

    ads.sort((a, b) => {
      // Sort: priority first, then active, then by name
      const aPri = a.promotion.isPriority ? 1 : 0;
      const bPri = b.promotion.isPriority ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;

      const aAct = a.promotion.active && a.promotion.isPaid ? 1 : 0;
      const bAct = b.promotion.active && b.promotion.isPaid ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;

      return a.name.localeCompare(b.name);
    });

    if (ads.length === 0) {
      container.innerHTML = '<p style="text-align:center; color:var(--color-text-tertiary); padding:40px;">No hay comercios registrados</p>';
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${ads.map(ad => {
          const promo = ad.promotion;
          const isActive = promo.active && promo.isPaid;
          const isPriority = promo.isPriority === true;
          const now = new Date();
          const endDate = promo.endDate?.toDate ? promo.endDate.toDate() : (promo.endDate ? new Date(promo.endDate) : null);
          const timeLeft = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;

          return `
            <div class="ad-admin-card" style="background:var(--color-surface); border:1.5px solid ${isPriority ? 'var(--color-warning)' : (isActive ? 'var(--color-primary)' : 'var(--color-border)')}; border-radius:24px; padding:16px; display:flex; gap:14px; position:relative; overflow:hidden;">
              <div style="position:absolute; top:0; right:0; display:flex; gap:4px;">
                ${isPriority ? `<div style="background:var(--color-warning); color:#000; padding:4px 12px; font-size:10px; font-weight:900; border-bottom-left-radius:12px; text-transform:uppercase; display:flex; align-items:center; gap:3px;">${icon('sparkles', 10)} Prioritario</div>` : ''}
                ${isActive && !isPriority ? `<div style="background:var(--color-primary); color:white; padding:4px 12px; font-size:10px; font-weight:900; border-bottom-left-radius:12px; text-transform:uppercase;">Activo</div>` : ''}
              </div>
              
              <div style="width:54px; height:54px; border-radius:14px; overflow:hidden; border:1px solid var(--color-border-light); background:white; flex-shrink:0; margin-top: 4px;">
                <img src="${ad.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:contain; padding:6px;" />
              </div>

              <div style="flex:1; min-width:0; padding-right: 40px; margin-top: 4px;">
                <div style="font-weight:900; font-size:16px; color:var(--color-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ad.name}</div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;">
                  <span style="font-size:11px; font-weight:800; padding:4px 8px; border-radius:6px; background:${isActive ? 'rgba(255,235,0,0.2)' : 'var(--color-bg-secondary)'}; color:${isActive ? '#854d0e' : 'var(--color-text-tertiary)'}; border:1px solid ${isActive ? 'rgba(255,235,0,0.5)' : 'transparent'};">
                    ${promo.label || 'Anuncio'}
                  </span>
                  ${timeLeft !== null && isActive ? `
                    <span style="font-size:11px; font-weight:800; padding:4px 8px; border-radius:6px; background:var(--color-info-light); color:var(--color-info);">
                      Quedan ${timeLeft} días
                    </span>
                  ` : ''}
                </div>
              </div>

              <button class="edit-ad-btn" data-id="${ad.id}" style="width:44px; height:44px; border-radius:14px; border:none; background:var(--color-bg-secondary); color:var(--color-text); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s; align-self: center;">
                ${icon('settings', 20)}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.edit-ad-btn').forEach(btn => {
      btn.onclick = () => openAdEditor(ads.find(a => a.id === btn.dataset.id));
    });

  } catch (err) {
    console.error('Error loading shop ads:', err);
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding:40px;">Error al cargar datos</p>';
  }
}

function openAdEditor(ad) {
  const promo = ad.promotion;
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative;';

  // Helper for date formatting
  const formatDateForInput = (d) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toISOString().split('T')[0];
  };

  modalContent.innerHTML = `
    <div style="flex:1; overflow-y:auto; padding:24px 20px 10px;">
      <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; margin-bottom:24px; text-align:center;">Configurar Anuncio</h2>
    
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Estado del Anuncio</label>
          <button id="toggle-active" style="width:100%; padding:14px; border-radius:16px; border:2px solid ${promo.active && promo.isPaid ? 'var(--color-primary)' : 'var(--color-border)'}; background:${promo.active && promo.isPaid ? 'var(--color-primary-lighter)' : 'transparent'}; font-weight:900; font-size:12px; cursor:pointer;">
            ${promo.active && promo.isPaid ? 'ACTIVADO' : 'DESACTIVADO'}
          </button>
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">¿Es Prioritario?</label>
          <button id="toggle-priority" style="width:100%; padding:14px; border-radius:16px; border:2px solid ${promo.isPriority ? 'var(--color-warning)' : 'var(--color-border)'}; background:${promo.isPriority ? 'rgba(254,240,138,0.3)' : 'transparent'}; font-weight:900; font-size:12px; color:${promo.isPriority ? '#854d0e' : 'var(--color-text)'}; cursor:pointer;">
            ${promo.isPriority ? 'SI (SIEMPRE PRIMERO)' : 'NO (ROTACIÓN NORMAL)'}
          </button>
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Texto del Badge (Ej: "Hasta 40% OFF")</label>
        <input type="text" id="promo-label" value="${promo.label || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" placeholder="Anuncio" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Fecha Inicio</label>
          <input type="date" id="promo-start" value="${formatDateForInput(promo.startDate)}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; outline:none;" />
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Fecha Fin</label>
          <input type="date" id="promo-end" value="${formatDateForInput(promo.endDate)}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; outline:none;" />
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Imagen del Banner (16:9 — Recomendado: 1200x675 px)</label>
        <div style="display:flex; gap:10px;">
          <input type="text" id="promo-banner" value="${promo.banner ? '(Imagen recortada)' : (ad.banner || '')}" style="flex:1; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:14px; outline:none;" placeholder="https://..." readonly />
          <button id="btn-crop-promo-banner" style="height:54px; padding:0 16px; border-radius:16px; border:1px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text); font-weight:800; font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
            ${icon('crop', 16)} Seleccionar
          </button>
        </div>
        <input type="file" id="file-promo-banner" accept="image/*" style="display:none;" />
        <div id="crop-preview-container" style="margin-top:12px; display:${promo.banner || ad.banner ? 'block' : 'none'};">
          <img id="img-crop-preview" src="${promo.banner || ad.banner || ''}" style="width:100%; aspect-ratio:16/9; border-radius:14px; object-fit:cover; border:1px solid var(--color-border-light);" />
        </div>
      </div>

    </div>
  </div>

  <div style="padding:20px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0)); border-top:1px solid var(--color-border-light); background:var(--color-bg); flex-shrink:0; z-index:10; box-sizing:border-box;">
    <button id="save-ad-settings" style="width:100%; height:56px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 10px 30px rgba(var(--color-primary-rgb),0.3);">
      Guardar Configuración
    </button>
  </div>
  `;

  showModal({ title: '', hideHeader: true, height: 'auto', content: modalContent });

  let isActive = promo.active && promo.isPaid;
  let isPriority = promo.isPriority === true;
  let croppedBase64 = promo.banner || ad.banner || '';

  const toggleBtn = modalContent.querySelector('#toggle-active');
  toggleBtn.onclick = () => {
    isActive = !isActive;
    toggleBtn.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-border)';
    toggleBtn.style.background = isActive ? 'var(--color-primary-lighter)' : 'transparent';
    toggleBtn.innerText = isActive ? 'ACTIVADO' : 'DESACTIVADO';
  };

  const priorityBtn = modalContent.querySelector('#toggle-priority');
  priorityBtn.onclick = () => {
    isPriority = !isPriority;
    priorityBtn.style.borderColor = isPriority ? 'var(--color-warning)' : 'var(--color-border)';
    priorityBtn.style.background = isPriority ? 'rgba(254,240,138,0.3)' : 'transparent';
    priorityBtn.style.color = isPriority ? '#854d0e' : 'var(--color-text)';
    priorityBtn.innerText = isPriority ? 'SI (SIEMPRE PRIMERO)' : 'NO (ROTACIÓN NORMAL)';
  };

  const cropBtn = modalContent.querySelector('#btn-crop-promo-banner');
  const fileInput = modalContent.querySelector('#file-promo-banner');
  const previewImg = modalContent.querySelector('#img-crop-preview');
  const previewContainer = modalContent.querySelector('#crop-preview-container');

  cropBtn.onclick = () => fileInput.click();
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await openCropper(file, { aspectRatio: 16 / 9, maxWidth: 800, maxHeight: 450 });
        croppedBase64 = base64;
        previewImg.src = base64;
        previewContainer.style.display = 'block';
        modalContent.querySelector('#promo-banner').value = '(Imagen recortada)';
      } catch (err) {
        console.warn('Cropper cancelled or failed:', err);
      }
    }
  };

  const saveBtn = modalContent.querySelector('#save-ad-settings');
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.innerText = 'Guardando...';

    const label = document.getElementById('promo-label').value || 'Anuncio';
    const startDate = document.getElementById('promo-start').value;
    const endDate = document.getElementById('promo-end').value;
    const bannerVal = document.getElementById('promo-banner').value;
    const banner = bannerVal === '(Imagen recortada)' ? croppedBase64 : (bannerVal || croppedBase64);

    const newPromotion = {
      active: isActive,
      isPaid: isActive,
      isPriority,
      label,
      banner,
      startDate: startDate ? Timestamp.fromDate(new Date(startDate + 'T00:00:00')) : null,
      endDate: endDate ? Timestamp.fromDate(new Date(endDate + 'T23:59:59')) : null
    };

    try {
      await updateDoc(doc(db, 'comercios', ad.id), {
        promotion: newPromotion
      });
      showToast('Configuración actualizada', 'success');
      closeModal();
      loadShopAds();
    } catch (err) {
      console.error('Error saving ad settings:', err);
      showToast('Error al guardar', 'danger');
      saveBtn.disabled = false;
      saveBtn.innerText = 'Guardar Configuración';
    }
  };
}

async function loadCustomAds() {
  const container = document.getElementById('ads-list-container');
  if (!container) return;
  container.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';

  try {
    const snap = await getDocs(collection(db, 'customAds'));
    const ads = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    ads.sort((a, b) => {
      const aPri = a.isPriority ? 1 : 0;
      const bPri = b.isPriority ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;

      const aAct = a.active ? 1 : 0;
      const bAct = b.active ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;

      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });

    if (ads.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:var(--color-text-tertiary);">
          <div style="font-size:32px; display:inline-block; margin-bottom:12px; color:var(--color-text-tertiary);">${icon('sparkles', 32)}</div>
          <h4 style="font-size:16px; font-weight:800; color:var(--color-text); margin:0 0 4px;">Sin anuncios personalizados</h4>
          <p style="font-size:12px; max-width:240px; margin:0 auto; line-height:1.4;">Creá tu primer anuncio personalizado que pueda redireccionar a cualquier parte de la app o a un link externo.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${ads.map(ad => {
          const isActive = ad.active === true;
          const isPriority = ad.isPriority === true;
          const now = new Date();
          const endDate = ad.endDate?.toDate ? ad.endDate.toDate() : (ad.endDate ? new Date(ad.endDate) : null);
          const timeLeft = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;

          return `
            <div class="ad-admin-card" style="background:var(--color-surface); border:1.5px solid ${isPriority ? 'var(--color-warning)' : (isActive ? 'var(--color-success)' : 'var(--color-border)')}; border-radius:24px; padding:16px; display:flex; gap:14px; position:relative; overflow:hidden;">
              <div style="position:absolute; top:0; right:0; display:flex; gap:4px;">
                ${isPriority ? `<div style="background:var(--color-warning); color:#000; padding:4px 12px; font-size:10px; font-weight:900; border-bottom-left-radius:12px; text-transform:uppercase; display:flex; align-items:center; gap:3px;">${icon('sparkles', 10)} Prioritario</div>` : ''}
                ${isActive && !isPriority ? `<div style="background:var(--color-success); color:white; padding:4px 12px; font-size:10px; font-weight:900; border-bottom-left-radius:12px; text-transform:uppercase;">Activo</div>` : ''}
              </div>
              
              <div style="width:72px; height:40px; border-radius:10px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); flex-shrink:0; align-self:center; margin-top: 4px;">
                <img src="${ad.banner || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
              </div>

              <div style="flex:1; min-width:0; padding-right: 40px; margin-top: 4px;">
                <div style="font-weight:900; font-size:15px; color:var(--color-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ad.title || 'Anuncio sin título'}</div>
                <div style="font-size:11px; color:var(--color-text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;">Enlace: <b>${ad.link || 'Sin link'}</b></div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;">
                  <span style="font-size:10px; font-weight:800; padding:3px 6px; border-radius:5px; background:var(--color-bg-secondary); color:var(--color-text-tertiary);">
                    ${ad.label || 'Anuncio'}
                  </span>
                  ${timeLeft !== null && isActive ? `
                    <span style="font-size:10px; font-weight:800; padding:3px 6px; border-radius:5px; background:var(--color-info-light); color:var(--color-info);">
                      Quedan ${timeLeft} días
                    </span>
                  ` : ''}
                </div>
              </div>

              <div style="display:flex; gap:6px; align-self:center; flex-shrink:0; z-index: 10;">
                <button class="edit-custom-ad-btn" data-id="${ad.id}" style="width:38px; height:38px; border-radius:10px; border:none; background:var(--color-bg-secondary); color:var(--color-text); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                  ${icon('edit', 16)}
                </button>
                <button class="delete-custom-ad-btn" data-id="${ad.id}" style="width:38px; height:38px; border-radius:10px; border:none; background:rgba(239,68,68,0.08); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                  ${icon('trash', 16)}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.edit-custom-ad-btn').forEach(btn => {
      btn.onclick = () => openCustomAdEditor(ads.find(a => a.id === btn.dataset.id));
    });

    container.querySelectorAll('.delete-custom-ad-btn').forEach(btn => {
      btn.onclick = () => deleteCustomAd(btn.dataset.id);
    });

  } catch (err) {
    console.error('Error loading custom ads:', err);
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding:40px;">Error al cargar datos</p>';
  }
}

async function deleteCustomAd(id) {
  const { showConfirm } = await import('../../components/modal.js');
  showConfirm({
    title: 'Eliminar Anuncio',
    message: '¿Estás seguro de que querés eliminar este anuncio personalizado? Esta acción no se puede deshacer.',
    danger: true,
    onConfirm: async () => {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'customAds', id));
      showToast('Anuncio eliminado', 'info');
      loadCustomAds();
    }
  });
}

function openCustomAdEditor(ad = null) {
  const isEdit = ad !== null;
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative;';

  const formatDateForInput = (d) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toISOString().split('T')[0];
  };

  modalContent.innerHTML = `
    <div style="flex:1; overflow-y:auto; padding:24px 20px 10px;">
      <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; margin-bottom:24px; text-align:center;">
        ${isEdit ? 'Editar Anuncio' : 'Nuevo Anuncio Personalizado'}
      </h2>
    
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Estado del Anuncio</label>
          <button id="toggle-custom-active" style="width:100%; padding:14px; border-radius:16px; border:2px solid ${isEdit && ad.active ? 'var(--color-success)' : 'var(--color-border)'}; background:${isEdit && ad.active ? 'var(--color-success-light)' : 'transparent'}; font-weight:900; font-size:12px; color:${isEdit && ad.active ? 'var(--color-success)' : 'var(--color-text)'}; cursor:pointer;">
            ${isEdit && ad.active ? 'ACTIVADO' : 'DESACTIVADO'}
          </button>
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">¿Es Prioritario?</label>
          <button id="toggle-custom-priority" style="width:100%; padding:14px; border-radius:16px; border:2px solid ${isEdit && ad.isPriority ? 'var(--color-warning)' : 'var(--color-border)'}; background:${isEdit && ad.isPriority ? 'rgba(254,240,138,0.3)' : 'transparent'}; font-weight:900; font-size:12px; color:${isEdit && ad.isPriority ? '#854d0e' : 'var(--color-text)'}; cursor:pointer;">
            ${isEdit && ad.isPriority ? 'SI (SIEMPRE PRIMERO)' : 'NO (ROTACIÓN NORMAL)'}
          </button>
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Título del Anuncio (Ej: "Gran Apertura en GoMarket")</label>
        <input type="text" id="custom-title" value="${isEdit ? ad.title || '' : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" placeholder="Título del anuncio..." />
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Texto del Badge (Ej: "Oficial", "Nuevo")</label>
        <input type="text" id="custom-label" value="${isEdit ? ad.label || '' : 'Anuncio'}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" placeholder="Anuncio" />
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Enlace de Redirección (Ej: #/gofavores, https://...)</label>
        <input type="text" id="custom-link" value="${isEdit ? ad.link || '' : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:14px; outline:none;" placeholder="#/comercio/ID o URL externa" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Fecha Inicio</label>
          <input type="date" id="custom-start" value="${isEdit ? formatDateForInput(ad.startDate) : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; outline:none;" />
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Fecha Fin</label>
          <input type="date" id="custom-end" value="${isEdit ? formatDateForInput(ad.endDate) : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; outline:none;" />
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Imagen del Banner (16:9 — Recomendado: 1200x675 px)</label>
        <div style="display:flex; gap:10px;">
          <input type="text" id="custom-banner" value="${isEdit && ad.banner ? '(Imagen cargada)' : ''}" style="flex:1; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:14px; outline:none;" placeholder="Subí una imagen..." readonly />
          <button id="btn-crop-custom-banner" style="height:54px; padding:0 16px; border-radius:16px; border:1px solid var(--color-border); background:var(--color-bg-secondary); color:var(--color-text); font-weight:800; font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
            ${icon('crop', 16)} Seleccionar
          </button>
        </div>
        <input type="file" id="file-custom-banner" accept="image/*" style="display:none;" />
        <div id="custom-crop-preview-container" style="margin-top:12px; display:${isEdit && ad.banner ? 'block' : 'none'};">
          <img id="img-custom-crop-preview" src="${isEdit ? ad.banner || '' : ''}" style="width:100%; aspect-ratio:16/9; border-radius:14px; object-fit:cover; border:1px solid var(--color-border-light);" />
        </div>
      </div>

    </div>
  </div>

  <div style="padding:20px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0)); border-top:1px solid var(--color-border-light); background:var(--color-bg); flex-shrink:0; z-index:10; box-sizing:border-box;">
    <button id="save-custom-ad" style="width:100%; height:56px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 10px 30px rgba(var(--color-primary-rgb),0.3);">
      ${isEdit ? 'Guardar Cambios' : 'Crear Anuncio'}
    </button>
  </div>
  `;

  showModal({ title: '', hideHeader: true, height: 'auto', content: modalContent });

  let isActive = isEdit ? ad.active === true : false;
  let isPriority = isEdit ? ad.isPriority === true : false;
  let croppedBase64 = isEdit ? ad.banner || '' : '';

  const activeBtn = modalContent.querySelector('#toggle-custom-active');
  activeBtn.onclick = () => {
    isActive = !isActive;
    activeBtn.style.borderColor = isActive ? 'var(--color-success)' : 'var(--color-border)';
    activeBtn.style.background = isActive ? 'var(--color-success-light)' : 'transparent';
    activeBtn.style.color = isActive ? 'var(--color-success)' : 'var(--color-text)';
    activeBtn.innerText = isActive ? 'ACTIVADO' : 'DESACTIVADO';
  };

  const priorityBtn = modalContent.querySelector('#toggle-custom-priority');
  priorityBtn.onclick = () => {
    isPriority = !isPriority;
    priorityBtn.style.borderColor = isPriority ? 'var(--color-warning)' : 'var(--color-border)';
    priorityBtn.style.background = isPriority ? 'rgba(254,240,138,0.3)' : 'transparent';
    priorityBtn.style.color = isPriority ? '#854d0e' : 'var(--color-text)';
    priorityBtn.innerText = isPriority ? 'SI (SIEMPRE PRIMERO)' : 'NO (ROTACIÓN NORMAL)';
  };

  const cropBtn = modalContent.querySelector('#btn-crop-custom-banner');
  const fileInput = modalContent.querySelector('#file-custom-banner');
  const previewImg = modalContent.querySelector('#img-custom-crop-preview');
  const previewContainer = modalContent.querySelector('#custom-crop-preview-container');

  cropBtn.onclick = () => fileInput.click();
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await openCropper(file, { aspectRatio: 16 / 9, maxWidth: 800, maxHeight: 450 });
        croppedBase64 = base64;
        previewImg.src = base64;
        previewContainer.style.display = 'block';
        modalContent.querySelector('#custom-banner').value = '(Imagen recortada)';
      } catch (err) {
        console.warn('Cropper cancelled or failed:', err);
      }
    }
  };

  const saveBtn = modalContent.querySelector('#save-custom-ad');
  saveBtn.onclick = async () => {
    if (!croppedBase64) {
      showToast('Por favor, selecciona y recorta una imagen para el banner.', 'warning');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerText = 'Guardando...';

    const title = document.getElementById('custom-title').value || 'Anuncio Especial';
    const label = document.getElementById('custom-label').value || 'Anuncio';
    const link = document.getElementById('custom-link').value || '';
    const startDate = document.getElementById('custom-start').value;
    const endDate = document.getElementById('custom-end').value;

    const adData = {
      active: isActive,
      isPriority,
      title,
      label,
      link,
      banner: croppedBase64,
      startDate: startDate ? Timestamp.fromDate(new Date(startDate + 'T00:00:00')) : null,
      endDate: endDate ? Timestamp.fromDate(new Date(endDate + 'T23:59:59')) : null,
      updatedAt: Timestamp.now()
    };

    try {
      const { setDoc, addDoc, doc, collection } = await import('firebase/firestore');
      if (isEdit) {
        await setDoc(doc(db, 'customAds', ad.id), adData, { merge: true });
        showToast('Anuncio actualizado', 'success');
      } else {
        adData.createdAt = Timestamp.now();
        await addDoc(collection(db, 'customAds'), adData);
        showToast('Anuncio creado con éxito', 'success');
      }
      closeModal();
      loadCustomAds();
    } catch (err) {
      console.error('Error saving custom ad:', err);
      showToast('Error al guardar anuncio', 'danger');
      saveBtn.disabled = false;
      saveBtn.innerText = isEdit ? 'Guardar Cambios' : 'Crear Anuncio';
    }
  };
}
