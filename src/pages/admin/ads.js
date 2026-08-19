// GoDelivery — Ads Management (Premium Admin Section)
import { db } from '../../firebase.js';
import { collection, getDocs, getDoc, doc, updateDoc, setDoc, addDoc, deleteDoc, Timestamp, query, where, collectionGroup } from 'firebase/firestore';
import { showConfirm } from '../../components/modal.js';
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
      <div style="display:flex; background:var(--color-surface); border-bottom:1px solid var(--color-border-light); padding:10px 16px; gap:10px; flex-shrink:0; z-index:10; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none;">
        <button id="tab-shop-ads" class="ad-tab active" style="flex:0 0 auto; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); padding:0 16px; cursor:pointer; transition:all 0.2s;">Destaques</button>
        <button id="tab-only-in-app" class="ad-tab" style="flex:0 0 auto; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); padding:0 16px; cursor:pointer; transition:all 0.2s;">📱 Solo en App</button>
        <button id="tab-custom-ads" class="ad-tab" style="flex:0 0 auto; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); padding:0 16px; cursor:pointer; transition:all 0.2s;">Personalizados</button>
        <button id="tab-mandado-banners" class="ad-tab" style="flex:0 0 auto; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); padding:0 16px; cursor:pointer; transition:all 0.2s;">Banners Mandados</button>
        <button id="tab-ad-requests" class="ad-tab" style="flex:0 0 auto; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); padding:0 16px; cursor:pointer; transition:all 0.2s;">Solicitudes</button>
        <button id="tab-sponsored-merchants" class="ad-tab" style="flex:0 0 auto; height:44px; border-radius:12px; border:none; background:transparent; font-weight:800; font-size:13px; color:var(--color-text-tertiary); padding:0 16px; cursor:pointer; transition:all 0.2s;">Patrocinios</button>
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
      .ad-tab::-webkit-scrollbar { display:none; }
    </style>
  `;

  let currentTab = 'shop';

  const tabShop = document.getElementById('tab-shop-ads');
  const tabOnlyInApp = document.getElementById('tab-only-in-app');
  const tabCustom = document.getElementById('tab-custom-ads');
  const tabMandadoBanners = document.getElementById('tab-mandado-banners');
  const tabAdRequests = document.getElementById('tab-ad-requests');
  const tabSponsoredMerchants = document.getElementById('tab-sponsored-merchants');
  const actionBar = document.getElementById('ads-action-bar');
  const createBtn = document.getElementById('btn-create-custom-ad');

  const switchTab = (tab) => {
    currentTab = tab;
    tabShop.classList.remove('active');
    if (tabOnlyInApp) tabOnlyInApp.classList.remove('active');
    tabCustom.classList.remove('active');
    tabMandadoBanners.classList.remove('active');
    tabAdRequests.classList.remove('active');
    tabSponsoredMerchants.classList.remove('active');

    if (tab === 'shop') {
      tabShop.classList.add('active');
      actionBar.style.display = 'none';
      loadShopAds();
    } else if (tab === 'onlyInApp') {
      if (tabOnlyInApp) tabOnlyInApp.classList.add('active');
      actionBar.style.display = 'none';
      loadOnlyInAppProducts();
    } else if (tab === 'custom') {
      tabCustom.classList.add('active');
      actionBar.style.display = 'flex';
      createBtn.innerHTML = `${icon('plus', 16)} Crear Anuncio`;
      createBtn.onclick = () => openCustomAdEditor();
      loadCustomAds();
    } else if (tab === 'mandado') {
      tabMandadoBanners.classList.add('active');
      actionBar.style.display = 'flex';
      createBtn.innerHTML = `${icon('plus', 16)} Nuevo Banner`;
      createBtn.onclick = () => openMandadoBannerEditor();
      loadMandadoBanners();
    } else if (tab === 'requests') {
      tabAdRequests.classList.add('active');
      actionBar.style.display = 'flex';
      createBtn.innerHTML = `${icon('settings', 16)} Tarifas`;
      createBtn.onclick = () => openTariffsConfigEditor();
      loadAdRequests();
    } else if (tab === 'sponsored') {
      tabSponsoredMerchants.classList.add('active');
      actionBar.style.display = 'none';
      loadSponsoredMerchants();
    }
  };

  tabShop.onclick = () => switchTab('shop');
  if (tabOnlyInApp) tabOnlyInApp.onclick = () => switchTab('onlyInApp');
  tabCustom.onclick = () => switchTab('custom');
  tabMandadoBanners.onclick = () => switchTab('mandado');
  tabAdRequests.onclick = () => switchTab('requests');
  tabSponsoredMerchants.onclick = () => switchTab('sponsored');

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

  <div style="padding:20px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0)); border-top:1px solid var(--color-border-light); background:var(--color-bg); flex-shrink:0; z-index:10; box-sizing:border-box; display:flex; flex-direction:column; gap:10px;">
    <button id="save-ad-settings" style="width:100%; height:52px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; box-shadow:0 8px 24px rgba(var(--color-primary-rgb),0.3);">
      Guardar Configuración
    </button>
    <button id="delete-shop-ad-btn" style="width:100%; height:46px; border-radius:14px; background:rgba(239,68,68,0.08); color:#ef4444; border:1px solid rgba(239,68,68,0.2); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
      ${icon('trash', 16)} Desactivar y Quitar del Slider
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

  const deleteShopAdBtn = modalContent.querySelector('#delete-shop-ad-btn');
  if (deleteShopAdBtn) {
    deleteShopAdBtn.onclick = () => {
      showConfirm({
        title: 'Desactivar Destaque',
        message: `¿Estás seguro de quitar el destaque del comercio "${ad.name}" del slider principal?`,
        confirmText: 'Sí, Desactivar',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'comercios', ad.id), {
              promotion: { active: false, isPaid: false, isPriority: false, label: 'Anuncio' }
            });
            showToast('Destaque desactivado correctamente', 'success');
            closeModal();
            loadShopAds();
          } catch (err) {
            console.error('Error deactivating shop ad:', err);
            showToast('Error al desactivar destaque', 'danger');
          }
        }
      });
    };
  }
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

async function loadMandadoBanners() {
  const container = document.getElementById('ads-list-container');
  if (!container) return;
  container.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';

  try {
    const snap = await getDocs(collection(db, 'banners_mandados'));
    const banners = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Sort by startDate desc
    banners.sort((a, b) => (b.startDate?.seconds || 0) - (a.startDate?.seconds || 0));

    if (banners.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:var(--color-text-tertiary);">
          <div style="font-size:32px; display:inline-block; margin-bottom:12px; color:var(--color-text-tertiary);">${icon('sparkles', 32)}</div>
          <h4 style="font-size:16px; font-weight:800; color:var(--color-text); margin:0 0 4px;">Sin banners de mandados</h4>
          <p style="font-size:12px; max-width:240px; margin:0 auto; line-height:1.4;">Creá tu primer banner promocional para el flujo de mandados.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${banners.map(b => {
          const isActive = b.status === 'active';
          const isWaiting = b.status === 'waiting';
          const isCompleted = b.status === 'completed';
          
          let statusLabel = 'Inactivo';
          let statusBg = 'var(--color-bg-secondary)';
          let statusColor = 'var(--color-text-tertiary)';
          
          if (isActive) {
            statusLabel = 'Activo';
            statusBg = 'rgba(16, 185, 129, 0.15)';
            statusColor = '#10b981';
          } else if (isWaiting) {
            statusLabel = 'En Espera';
            statusBg = 'rgba(99, 102, 241, 0.15)';
            statusColor = '#6366f1';
          } else if (isCompleted) {
            statusLabel = 'Completado';
            statusBg = 'var(--color-bg-secondary)';
            statusColor = 'var(--color-text-tertiary)';
          }

          const impressions = b.stats?.impressions || 0;
          const clicks = b.stats?.clicks || 0;
          const conversions = b.stats?.conversions || 0;
          const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) + '%' : '0%';

          return `
            <div style="background:var(--color-surface); border:1.5px solid ${isActive ? '#10b981' : 'var(--color-border)'}; border-radius:24px; padding:16px; display:flex; flex-direction:column; gap:12px; position:relative;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-weight:900; font-size:15px; color:var(--color-text-primary);">${b.name}</span>
                  <span style="font-size:10px; font-weight:900; padding:3px 8px; border-radius:6px; background:${statusBg}; color:${statusColor}; text-transform:uppercase;">
                    ${statusLabel}
                  </span>
                </div>
                <div style="display:flex; gap:6px;">
                  <button class="edit-banner-btn" data-id="${b.id}" style="width:34px; height:34px; border-radius:8px; border:none; background:var(--color-bg-secondary); color:var(--color-text); cursor:pointer; display:flex; align-items:center; justify-content:center;">
                    ${icon('edit', 14)}
                  </button>
                  <button class="delete-banner-btn" data-id="${b.id}" style="width:34px; height:34px; border-radius:8px; border:none; background:rgba(239,68,68,0.08); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                    ${icon('trash', 14)}
                  </button>
                </div>
              </div>

              <div style="display:flex; gap:12px; align-items:center;">
                <div style="width:80px; height:45px; border-radius:8px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); flex-shrink:0;">
                  <img src="${b.imageUrl || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
                </div>
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:12px; color:var(--color-text-secondary);">Comercio: <b>${b.merchantName}</b></div>
                  <div style="font-size:11px; color:var(--color-text-tertiary);">
                    Vigencia: ${b.startDate ? new Date(b.startDate.seconds * 1000).toLocaleDateString('es-AR') : ''} al ${b.endDate ? new Date(b.endDate.seconds * 1000).toLocaleDateString('es-AR') : ''} (${b.daysPaid} días)
                  </div>
                  <div style="font-size:11px; color:var(--color-text-tertiary);">
                    Descuento: ${b.hasDiscount ? `<b>${formatPrice(b.discountAmount)}</b> (Límite: ${b.discountLimitPerDay}/día)` : 'Desactivado'}
                  </div>
                </div>
              </div>

              <!-- Stats Dashboard -->
              <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:8px; background:var(--color-bg-secondary); border-radius:14px; padding:10px; text-align:center; border:1px solid var(--color-border-light);">
                <div>
                  <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; display:block;">Impr.</span>
                  <span style="font-size:13px; font-weight:900; color:var(--color-text-primary); display:block; margin-top:2px;">${impressions}</span>
                </div>
                <div>
                  <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; display:block;">Clicks</span>
                  <span style="font-size:13px; font-weight:900; color:var(--color-text-primary); display:block; margin-top:2px;">${clicks}</span>
                </div>
                <div>
                  <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; display:block;">CTR</span>
                  <span style="font-size:13px; font-weight:900; color:var(--color-text-primary); display:block; margin-top:2px;">${ctr}</span>
                </div>
                <div>
                  <span style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; display:block;">Pedidos</span>
                  <span style="font-size:13px; font-weight:900; color:#10b981; display:block; margin-top:2px;">${conversions}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.edit-banner-btn').forEach(btn => {
      btn.onclick = () => openMandadoBannerEditor(banners.find(b => b.id === btn.dataset.id));
    });

    container.querySelectorAll('.delete-banner-btn').forEach(btn => {
      btn.onclick = () => deleteMandadoBanner(btn.dataset.id);
    });

  } catch (err) {
    console.error('Error loading banners:', err);
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding:40px;">Error al cargar banners</p>';
  }
}

async function deleteMandadoBanner(id) {
  const { showConfirm } = await import('../../components/modal.js');
  showConfirm({
    title: 'Eliminar Banner',
    message: '¿Estás seguro de que deseas eliminar este banner? Se perderán las estadísticas.',
    danger: true,
    onConfirm: async () => {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'banners_mandados', id));
      showToast('Banner eliminado', 'info');
      loadMandadoBanners();
    }
  });
}

function openMandadoBannerEditor(banner = null) {
  try {
    const isEdit = banner !== null;
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative;';

  modalContent.innerHTML = `
    <!-- Modal Header -->
    <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; color:white;">
      <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0;">
        ${isEdit ? 'Editar Banner de Mandado' : 'Nuevo Banner de Mandado'}
      </h3>
      <button id="close-banner-modal" style="background:transparent; border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center;">
        ${icon('close', 20)}
      </button>
    </div>

    <!-- Progress Indicator Bar -->
    <div style="display:flex; gap:8px; padding:12px 20px 6px 20px; background:var(--color-bg); flex-shrink:0;">
      <div id="dot-step-1" style="flex:1; height:4px; border-radius:2px; background:var(--color-primary); transition:background 0.3s;"></div>
      <div id="dot-step-2" style="flex:1; height:4px; border-radius:2px; background:var(--color-border); transition:background 0.3s;"></div>
      <div id="dot-step-3" style="flex:1; height:4px; border-radius:2px; background:var(--color-border); transition:background 0.3s;"></div>
    </div>
    <div id="step-title" style="font-size:11px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase; padding:0 20px; margin-bottom:4px; flex-shrink:0; letter-spacing:0.05em;">Paso 1: Información Comercial</div>

    <!-- Form Area -->
    <div style="flex:1; padding:12px 20px 20px 20px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; overflow:hidden;">
      <div id="steps-container" style="flex:1; display:flex; flex-direction:column; justify-content:flex-start; gap:16px;">
        
        <!-- Step 1: Info Comercial -->
        <div id="step-1" class="wizard-step" style="display:flex; flex-direction:column; gap:14px; width:100%;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Nombre de la Campaña</label>
            <input type="text" id="banner-name-input" value="${isEdit ? banner.name : ''}" placeholder="Ej: Promo Maxikiosco Paulos" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface);" required />
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Comercio Destino (Autocompletar en Compra)</label>
            <input type="text" id="banner-merchant-input" value="${isEdit ? banner.merchantName : ''}" placeholder="Ej: Maxikiosco Paulos" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface);" required />
          </div>
          <div style="display:flex; gap:12px;">
            <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Días Contratados</label>
              <input type="number" id="banner-days-input" value="${isEdit ? banner.daysPaid : '7'}" min="1" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface);" required />
            </div>
            <div style="width:120px; display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Precio ($)</label>
              <input type="number" id="banner-price-input" value="${isEdit ? banner.pricePaid : '10000'}" min="0" style="height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface);" required />
            </div>
          </div>
        </div>

        <!-- Step 2: Diseño del Banner -->
        <div id="step-2" class="wizard-step" style="display:none; flex-direction:column; gap:14px; width:100%; box-sizing:border-box;">
          <div style="display:flex; gap:12px; width:100%; box-sizing:border-box;">
            <div style="flex:1; display:flex; flex-direction:column; gap:6px; min-width:0;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Título en Banner</label>
              <input type="text" id="banner-title-text" value="${isEdit && banner.title ? banner.title : ''}" placeholder="Ej: Promo Paulos" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
            </div>
            <div style="flex:1; display:flex; flex-direction:column; gap:6px; min-width:0;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Subtítulo en Banner</label>
              <input type="text" id="banner-subtitle-text" value="${isEdit && banner.subtitle ? banner.subtitle : ''}" placeholder="Ej: Pedir ahora" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; width:100%; box-sizing:border-box;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Imagen de Publicidad (Aspecto: 8:5)</label>
            <div style="display:flex; gap:12px; align-items:center; width:100%; box-sizing:border-box;">
              <div id="banner-editor-preview-container" style="width:100px; height:62px; border-radius:10px; border:1.5px dashed var(--color-border); background:var(--color-bg-secondary); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${isEdit ? `<img id="banner-editor-preview" src="${banner.imageUrl}" style="width:100%; height:100%; object-fit:cover;" />` : `<div id="banner-editor-placeholder" style="font-size:9px; color:var(--color-text-tertiary); font-weight:800; text-align:center; padding:2px;">Sin imagen</div>`}
              </div>
              <button type="button" id="btn-upload-banner-image" style="height:36px; padding:0 12px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-weight:800; font-size:12px; cursor:pointer;">Subir Banner</button>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; width:100%; box-sizing:border-box;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Logo de Tienda (Aspecto: 1:1)</label>
            <div style="display:flex; gap:12px; align-items:center; width:100%; box-sizing:border-box;">
              <div id="banner-logo-preview-container" style="width:48px; height:48px; border-radius:50%; border:1.5px dashed var(--color-border); background:var(--color-bg-secondary); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${isEdit && banner.logoUrl ? `<img id="banner-logo-preview" src="${banner.logoUrl}" style="width:100%; height:100%; object-fit:cover;" />` : `<div id="banner-logo-placeholder" style="font-size:8px; color:var(--color-text-tertiary); font-weight:800; text-align:center; padding:2px;">Sin logo</div>`}
              </div>
              <button type="button" id="btn-upload-banner-logo" style="height:36px; padding:0 12px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-weight:800; font-size:12px; cursor:pointer;">Subir Logo</button>
            </div>
          </div>
        </div>

        <!-- Step 3: Beneficios y Descuentos -->
        <div id="step-3" class="wizard-step" style="display:none; flex-direction:column; gap:14px; width:100%; box-sizing:border-box;">
          
          <!-- Bonificación de Envío -->
          <div style="display:flex; flex-direction:column; gap:10px; border:1px solid var(--color-border-light); border-radius:16px; padding:14px; background:var(--color-bg-secondary); width:100%; box-sizing:border-box;">
            <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; margin:0; width:100%; box-sizing:border-box;">
              <span style="font-size:13px; font-weight:850; color:var(--color-text-primary);">Financiar descuento de envío</span>
              <input type="checkbox" id="banner-discount-toggle" ${isEdit && banner.hasDiscount ? 'checked' : ''} style="width:20px; height:20px; accent-color:var(--color-primary); flex-shrink:0;" />
            </label>
            <div id="discount-subform" style="display:${isEdit && banner.hasDiscount ? 'flex' : 'none'}; gap:12px; margin-top:12px; width:100%; box-sizing:border-box;">
              <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
                <label style="font-size:10px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Descuento ($)</label>
                <input type="number" id="banner-discount-amount" value="${isEdit ? banner.discountAmount : '500'}" style="width:100%; height:40px; border-radius:10px; border:1.5px solid var(--color-border); padding:0 10px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
                <label style="font-size:10px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Límite Diario</label>
                <input type="number" id="banner-discount-limit" value="${isEdit ? banner.discountLimitPerDay : '5'}" style="width:100%; height:40px; border-radius:10px; border:1.5px solid var(--color-border); padding:0 10px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
              </div>
            </div>
          </div>

          <!-- Destacado Estético -->
          <div style="display:flex; flex-direction:column; gap:10px; border:1px solid var(--color-border-light); border-radius:16px; padding:14px; background:var(--color-bg-secondary); width:100%; box-sizing:border-box;">
            <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; margin:0; width:100%; box-sizing:border-box;">
              <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
                <span style="font-size:13px; font-weight:850; color:var(--color-text-primary); text-align:left;">Destacado Estético (Visual Premium)</span>
                <span style="font-size:10px; color:var(--color-text-secondary); font-weight:550; text-align:left; white-space:normal; word-break:break-word;">Borde dorado animado en la lista de mandados</span>
              </div>
              <input type="checkbox" id="banner-glow-toggle" ${isEdit && banner.hasPremiumGlow ? 'checked' : ''} style="width:20px; height:20px; accent-color:var(--color-primary); flex-shrink:0;" />
            </label>
          </div>

          <!-- Envío Prioritario -->
          <div style="display:flex; flex-direction:column; gap:10px; border:1px solid var(--color-border-light); border-radius:16px; padding:14px; background:var(--color-bg-secondary); width:100%; box-sizing:border-box;">
            <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; margin:0; width:100%; box-sizing:border-box;">
              <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
                <span style="font-size:13px; font-weight:850; color:var(--color-text-primary); text-align:left;">Envío Prioritario (Fast Delivery)</span>
                <span style="font-size:10px; color:var(--color-text-secondary); font-weight:550; text-align:left; white-space:normal; word-break:break-word;">Prioriza asignación de cadetes en este comercio</span>
              </div>
              <input type="checkbox" id="banner-priority-toggle" ${isEdit && banner.hasPriorityDelivery ? 'checked' : ''} style="width:20px; height:20px; accent-color:var(--color-primary); flex-shrink:0;" />
            </label>
          </div>

        </div>

      </div>

      <!-- Navigation Footer Buttons -->
      <div style="display:flex; justify-content:space-between; gap:12px; margin-top:20px; flex-shrink:0;">
        <button type="button" id="wizard-prev-btn" style="flex:1; height:48px; border-radius:14px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-weight:800; font-size:13.5px; cursor:pointer; display:none; transition:all 0.2s;">Atrás</button>
        <button type="button" id="wizard-next-btn" style="flex:2; height:48px; border-radius:14px; border:none; background:var(--color-primary); color:white; font-weight:950; font-size:13.5px; cursor:pointer; transition:all 0.2s;">Siguiente</button>
        <button type="button" id="btn-save-banner" style="flex:2; height:48px; border-radius:14px; border:none; background:var(--color-primary); color:white; font-weight:950; font-size:13.5px; cursor:pointer; display:none; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); transition:all 0.2s;">
          ${isEdit ? 'Guardar Cambios' : 'Crear Banner'}
        </button>
      </div>
    </div>
  `;

  showModal({
    title: '',
    hideHeader: true,
    height: '80dvh',
    content: modalContent,
    onOpen: () => {
      const modalBody = modalContent.closest('.modal-body');
      if (modalBody) {
        modalBody.style.overflow = 'hidden';
        modalBody.style.webkitOverflowScrolling = 'auto';
      }
    }
  });

  const closeBtn = modalContent.querySelector('#close-banner-modal');
  closeBtn.onclick = () => closeModal();

  // Wizard Navigation Logic
  let currentStep = 1;
  const step1 = modalContent.querySelector('#step-1');
  const step2 = modalContent.querySelector('#step-2');
  const step3 = modalContent.querySelector('#step-3');
  const prevBtn = modalContent.querySelector('#wizard-prev-btn');
  const nextBtn = modalContent.querySelector('#wizard-next-btn');
  const saveBtn = modalContent.querySelector('#btn-save-banner');
  const stepTitle = modalContent.querySelector('#step-title');
  const dot1 = modalContent.querySelector('#dot-step-1');
  const dot2 = modalContent.querySelector('#dot-step-2');
  const dot3 = modalContent.querySelector('#dot-step-3');

  const updateWizardUI = () => {
    step1.style.display = 'none';
    step2.style.display = 'none';
    step3.style.display = 'none';
    dot1.style.background = 'var(--color-border)';
    dot2.style.background = 'var(--color-border)';
    dot3.style.background = 'var(--color-border)';

    if (currentStep === 1) {
      step1.style.display = 'flex';
      dot1.style.background = 'var(--color-primary)';
      stepTitle.innerText = 'Paso 1: Información Comercial';
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'block';
      saveBtn.style.display = 'none';
    } else if (currentStep === 2) {
      step2.style.display = 'flex';
      dot1.style.background = 'var(--color-primary)';
      dot2.style.background = 'var(--color-primary)';
      stepTitle.innerText = 'Paso 2: Diseño del Banner';
      prevBtn.style.display = 'block';
      nextBtn.style.display = 'block';
      saveBtn.style.display = 'none';
    } else if (currentStep === 3) {
      step3.style.display = 'flex';
      dot1.style.background = 'var(--color-primary)';
      dot2.style.background = 'var(--color-primary)';
      dot3.style.background = 'var(--color-primary)';
      stepTitle.innerText = 'Paso 3: Beneficios y Descuentos';
      prevBtn.style.display = 'block';
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'block';
    }
  };

  prevBtn.onclick = () => {
    if (currentStep > 1) {
      currentStep--;
      updateWizardUI();
    }
  };

  nextBtn.onclick = () => {
    if (currentStep === 1) {
      const name = modalContent.querySelector('#banner-name-input').value.trim();
      const merchantName = modalContent.querySelector('#banner-merchant-input').value.trim();
      if (!name || !merchantName) {
        showToast('Por favor completá los campos requeridos', 'warning');
        return;
      }
    }
    if (currentStep === 2) {
      if (!croppedBase64) {
        showToast('Por favor subí una imagen para el banner', 'warning');
        return;
      }
    }
    if (currentStep < 3) {
      currentStep++;
      updateWizardUI();
    }
  };

  const discountToggle = modalContent.querySelector('#banner-discount-toggle');
  const discountSubform = modalContent.querySelector('#discount-subform');
  discountToggle.onchange = () => {
    discountSubform.style.display = discountToggle.checked ? 'grid' : 'none';
  };

  let croppedBase64 = isEdit ? banner.imageUrl : '';
  let logoBase64 = isEdit ? (banner.logoUrl || '') : '';

  const uploadBtn = modalContent.querySelector('#btn-upload-banner-image');
  uploadBtn.onclick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const base64 = await openCropper(file, { aspectRatio: 8 / 5, maxWidth: 800, maxHeight: 500 });
          croppedBase64 = base64;
          const previewContainer = modalContent.querySelector('#banner-editor-preview-container');
          if (previewContainer) {
            previewContainer.innerHTML = `<img id="banner-editor-preview" src="${base64}" style="width:100%; height:100%; object-fit:cover;" />`;
          }
        } catch (err) {
          console.error('Cropping cancelled or failed:', err);
        }
      }
    };
    fileInput.click();
  };

  const uploadLogoBtn = modalContent.querySelector('#btn-upload-banner-logo');
  uploadLogoBtn.onclick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const base64 = await openCropper(file, { aspectRatio: 1, circular: true, maxWidth: 300, maxHeight: 300 });
          logoBase64 = base64;
          const logoContainer = modalContent.querySelector('#banner-logo-preview-container');
          if (logoContainer) {
            logoContainer.innerHTML = `<img id="banner-logo-preview" src="${base64}" style="width:100%; height:100%; object-fit:cover;" />`;
          }
        } catch (err) {
          console.error('Cropping cancelled or failed:', err);
        }
      }
    };
    fileInput.click();
  };

  saveBtn.onclick = async () => {
    const name = modalContent.querySelector('#banner-name-input').value.trim();
    const title = modalContent.querySelector('#banner-title-text').value.trim();
    const subtitle = modalContent.querySelector('#banner-subtitle-text').value.trim();
    const daysPaid = parseInt(modalContent.querySelector('#banner-days-input').value) || 7;
    const pricePaid = parseInt(modalContent.querySelector('#banner-price-input').value) || 0;
    const merchantName = modalContent.querySelector('#banner-merchant-input').value.trim();
    const hasDiscount = discountToggle.checked;
    const discountAmount = parseInt(modalContent.querySelector('#banner-discount-amount').value) || 0;
    const discountLimitPerDay = parseInt(modalContent.querySelector('#banner-discount-limit').value) || 0;
    const hasPremiumGlow = modalContent.querySelector('#banner-glow-toggle').checked;
    const hasPriorityDelivery = modalContent.querySelector('#banner-priority-toggle').checked;

    if (!name || !merchantName) {
      showToast('Por favor completá los campos requeridos', 'warning');
      return;
    }
    if (!croppedBase64) {
      showToast('Por favor subí una imagen para el banner', 'warning');
      return;
    }

    const { showConfirm } = await import('../../components/modal.js');
    showConfirm({
      title: 'Confirmar Registro Contable',
      message: `Se guardará la campaña de publicidad. Esto registrará automáticamente un ingreso de dinero de $${pricePaid} en el Balance Mensual y Contabilidad como "Ingreso Publicidad: ${name}". ¿Deseas confirmar?`,
      onConfirm: async () => {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Guardando...';

        try {
          const { setDoc, addDoc, doc, collection, getDocs, query, where, Timestamp } = await import('firebase/firestore');

          // Schedule logic
          let startDate = new Date();
          const qSnap = await getDocs(query(collection(db, 'banners_mandados'), where('status', 'in', ['active', 'waiting'])));
          let latestEndDate = new Date();
          qSnap.forEach(d => {
            if (isEdit && d.id === banner.id) return;
            const data = d.data();
            const dEnd = data.endDate?.toDate ? data.endDate.toDate() : new Date(data.endDate);
            if (dEnd > latestEndDate) {
              latestEndDate = dEnd;
            }
          });

          if (isEdit) {
            startDate = banner.startDate?.toDate ? banner.startDate.toDate() : new Date(banner.startDate);
          } else {
            startDate = latestEndDate;
          }
          
          const endDate = new Date(startDate.getTime() + daysPaid * 24 * 60 * 60 * 1000);
          
          const now = new Date();
          let status = 'waiting';
          if (startDate <= now && endDate >= now) {
            status = 'active';
          } else if (endDate < now) {
            status = 'completed';
          }

          const bannerData = {
            name,
            title,
            subtitle,
            daysPaid,
            pricePaid,
            merchantName,
            hasDiscount,
            discountAmount: hasDiscount ? discountAmount : 0,
            discountLimitPerDay: hasDiscount ? discountLimitPerDay : 0,
            hasPremiumGlow,
            hasPriorityDelivery,
            imageUrl: croppedBase64,
            logoUrl: logoBase64,
            startDate: Timestamp.fromDate(startDate),
            endDate: Timestamp.fromDate(endDate),
            status,
            updatedAt: Timestamp.now()
          };

          if (!isEdit) {
            bannerData.createdAt = Timestamp.now();
            bannerData.stats = { impressions: 0, clicks: 0, conversions: 0 };
            await addDoc(collection(db, 'banners_mandados'), bannerData);
            
            // Register revenue in accounting (company_expenses)
            if (pricePaid > 0) {
              const expenseData = {
                concept: `Ingreso Publicidad: ${name}`,
                amount: pricePaid,
                date: new Date().toISOString(),
                category: 'Publicidad',
                paymentMethod: 'Transferencia',
                notes: `Registrado automáticamente al crear campaña para ${merchantName}`,
                type: 'income',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
              };
              await addDoc(collection(db, 'company_expenses'), expenseData);
            }
            showToast('Banner creado con éxito', 'success');
          } else {
            await setDoc(doc(db, 'banners_mandados', banner.id), bannerData, { merge: true });
            
            // Adjust revenue in accounting if price changed
            if (pricePaid > 0 && pricePaid !== banner.pricePaid) {
              const expenseData = {
                concept: `Ingreso Publicidad (Ajuste): ${name}`,
                amount: pricePaid - (banner.pricePaid || 0),
                date: new Date().toISOString(),
                category: 'Publicidad',
                paymentMethod: 'Transferencia',
                notes: `Ajuste automático de precio cobrado de $${banner.pricePaid || 0} a $${pricePaid}`,
                type: 'income',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
              };
              await addDoc(collection(db, 'company_expenses'), expenseData);
            }
            showToast('Banner actualizado', 'success');
          }

          closeModal();
          loadMandadoBanners();
        } catch (err) {
          console.error('Error saving banner:', err);
          showToast('Error al guardar', 'danger');
          saveBtn.disabled = false;
          saveBtn.innerText = isEdit ? 'Guardar Cambios' : 'Crear Banner';
        }
      }
    });
    };
  } catch (err) {
    console.error('Error opening banner editor:', err);
    showToast('Error al abrir editor: ' + err.message, 'danger');
  }
}

// ─── SOLICITUDES DE COMERCIOS ──────────────────────────────────────────────────
async function loadAdRequests() {
  const container = document.getElementById('ads-list-container');
  if (!container) return;
  container.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';

  try {
    const snap = await getDocs(collection(db, 'banners_mandados'));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pending = all.filter(b => b.status === 'pending');

    if (pending.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:20px; border:1.5px dashed var(--color-border);">
          <div style="font-size:32px; margin-bottom:12px;">${icon('check', 32)}</div>
          <h4 style="font-size:15px; font-weight:800; color:var(--color-text); margin:0 0 4px;">Sin solicitudes pendientes</h4>
          <p style="font-size:12px; max-width:240px; margin:0 auto; line-height:1.4;">Todas las solicitudes de comercios han sido revisadas.</p>
        </div>`;
      return;
    }

    container.innerHTML = `<div style="display:flex; flex-direction:column; gap:14px;">${pending.map(b => {
      const isBanner = b.type !== 'sponsored_listing';
      return `
        <div style="background:var(--color-surface); border:1.5px solid rgba(245,158,11,0.3); border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:12px;" data-id="${b.id}">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div>
              <span style="font-weight:900; font-size:15px; color:var(--color-text-primary);">${b.name}</span>
              <span style="display:inline-flex; align-items:center; margin-left:8px; font-size:9px; font-weight:900; padding:2px 8px; border-radius:6px; background:rgba(245,158,11,0.12); color:#f59e0b; text-transform:uppercase;">Pendiente</span>
            </div>
            <span style="font-size:10px; font-weight:800; color:var(--color-text-tertiary);">${b.merchantName || ''}</span>
          </div>
          <div style="display:flex; gap:12px; align-items:center;">
            ${isBanner && b.imageUrl ? `<div style="width:80px; height:48px; border-radius:8px; overflow:hidden; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); flex-shrink:0;"><img src="${b.imageUrl}" style="width:100%;height:100%;object-fit:cover;"/></div>` : `<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--color-bg-secondary);border:1.5px solid #fbbf24;flex-shrink:0;">${b.logoUrl ? `<img src="${b.logoUrl}" style="width:100%;height:100%;object-fit:cover;"/>` : ''}</div>`}
            <div style="flex:1; display:flex; flex-direction:column; gap:3px;">
              <div style="font-size:12px; color:var(--color-text-secondary);">Tipo: <b>${isBanner ? 'Banner Mandados' : 'Comercio Patrocinado'}</b></div>
              <div style="font-size:11px; color:var(--color-text-tertiary);">Duración: <b>${b.daysPaid} días</b></div>
              <div style="font-size:12px; color:var(--color-primary); font-weight:900;">Valor: ${formatPrice(b.pricePaid)}</div>
              ${b.hasPremiumGlow ? `<div style="font-size:10px; color:#d97706;">★ Con Destacado Estético</div>` : ''}
              ${b.hasDiscount ? `<div style="font-size:10px; color:#6366f1;">✦ Descuento de envío: $${b.discountAmount} (límite ${b.discountLimitPerDay}/día)</div>` : ''}
            </div>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn-approve-request" data-id="${b.id}" data-type="${b.type || 'banner'}" style="flex:1; height:40px; border-radius:10px; border:none; background:rgba(16,185,129,0.1); color:#10b981; font-weight:900; font-size:12px; cursor:pointer;">${icon('check', 14)} Aprobar</button>
            <button class="btn-reject-request" data-id="${b.id}" style="flex:1; height:40px; border-radius:10px; border:none; background:rgba(239,68,68,0.08); color:#ef4444; font-weight:900; font-size:12px; cursor:pointer;">${icon('close', 14)} Rechazar</button>
          </div>
        </div>`;
    }).join('')}</div>`;

    // Approve handler
    container.querySelectorAll('.btn-approve-request').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const type = btn.dataset.type;
        showConfirm({
          title: 'Aprobar Solicitud',
          message: `Al aprobar, se registrará el ingreso en la contabilidad y la campaña pasará a estado "En Espera" para publicarse en la fecha indicada.`,
          confirmText: 'Aprobar',
          onConfirm: async () => {
            try {
              const bannerRef = doc(db, 'banners_mandados', id);
              const bannerSnap = await getDoc(bannerRef);
              const bannerData = bannerSnap.data();
              const now = Timestamp.now();
              const startDate = now;
              const endDate = Timestamp.fromMillis(now.toMillis() + (bannerData.daysPaid || 1) * 86400000);

              // Set status to 'waiting' (will auto-activate on start date)
              await updateDoc(bannerRef, {
                status: 'waiting',
                startDate,
                endDate,
                updatedAt: now
              });

              // If it's a sponsored listing, also set isSponsored on the comercio
              if (type === 'sponsored_listing' && bannerData.comercioId) {
                await updateDoc(doc(db, 'comercios', bannerData.comercioId), {
                  isSponsored: true,
                  sponsoredUntil: endDate
                });
              }

              // Register income in accounting
              if (bannerData.pricePaid > 0) {
                await addDoc(collection(db, 'company_expenses'), {
                  concept: `Ingreso Publicidad: ${bannerData.name}`,
                  amount: bannerData.pricePaid,
                  date: new Date().toISOString(),
                  category: 'Publicidad',
                  paymentMethod: 'Transferencia',
                  notes: `Comercio: ${bannerData.merchantName} — ${bannerData.daysPaid} días`,
                  type: 'income',
                  createdAt: now,
                  updatedAt: now
                });
              }

              showToast('Solicitud aprobada', 'success');
              loadAdRequests();
            } catch (err) {
              console.error('Error approving request:', err);
              showToast('Error al aprobar', 'danger');
            }
          }
        });
      };
    });

    // Reject handler
    container.querySelectorAll('.btn-reject-request').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding:20px;';
        modalContent.innerHTML = `
          <p style="font-size:13px; color:var(--color-text-secondary); margin:0;">Indicá el motivo de rechazo para que el comercio pueda verlo:</p>
          <textarea id="rejection-reason-input" rows="3" placeholder="Ej: La imagen no cumple los requisitos de calidad." style="width:100%; border-radius:12px; border:1.5px solid var(--color-border); padding:12px; font-size:13px; color:var(--color-text-primary); background:var(--color-surface); resize:none; box-sizing:border-box;"></textarea>
          <button id="btn-confirm-reject" style="height:44px; border-radius:12px; border:none; background:#ef4444; color:white; font-weight:900; font-size:13px; cursor:pointer;">Confirmar Rechazo</button>`;
        showModal({ title: 'Rechazar Solicitud', content: modalContent });
        modalContent.querySelector('#btn-confirm-reject').onclick = async () => {
          const reason = modalContent.querySelector('#rejection-reason-input').value.trim();
          try {
            await updateDoc(doc(db, 'banners_mandados', id), {
              status: 'rejected',
              rejectionReason: reason || 'Sin motivo especificado.',
              updatedAt: Timestamp.now()
            });
            showToast('Solicitud rechazada', 'info');
            closeModal();
            loadAdRequests();
          } catch (err) {
            console.error('Error rejecting:', err);
            showToast('Error al rechazar', 'danger');
          }
        };
      };
    });

  } catch (err) {
    console.error('Error loading ad requests:', err);
    container.innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px;">Error al cargar solicitudes.</p>';
  }
}

// ─── CONFIGURADOR DE TARIFAS ───────────────────────────────────────────────────
async function openTariffsConfigEditor() {
  let settings = {
    bannerBasePrice: 1000,
    premiumGlowPrice: 500,
    sponsoredBasePrice: 1500,
    pushAdPrice: 3000,
    featuredAdPrice: 5000
  };

  try {
    const snap = await getDoc(doc(db, 'settings', 'ads_pricing'));
    if (snap.exists()) settings = { ...settings, ...snap.data() };
  } catch (e) {}

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex;flex-direction:column;gap:0;';
  modalContent.innerHTML = `
    <div style="padding:20px; display:flex; flex-direction:column; gap:20px;">
      <div style="background:rgba(99,102,241,0.06); border:1.5px solid rgba(99,102,241,0.2); border-radius:16px; padding:14px; font-size:12px; color:var(--color-text-secondary); line-height:1.5;">
        Estos valores se usan automáticamente en las opciones de contratación de publicidad para comercios.
      </div>
      <div style="display:flex; flex-direction:column; gap:14px;">
        ${[
          { key: 'pushAdPrice', label: 'Precio Notificación Push Anuncio (por envío)', icon: 'bell' },
          { key: 'featuredAdPrice', label: 'Precio Destaque en Slider Home (por 7 días)', icon: 'sparkles' },
          { key: 'bannerBasePrice', label: 'Precio Banner Mandados (por día)', icon: 'image' },
          { key: 'premiumGlowPrice', label: 'Adicional Destacado Estético (por día)', icon: 'star' },
          { key: 'sponsoredBasePrice', label: 'Precio Comercio Patrocinado (por día)', icon: 'megaphone' }
        ].map(field => `
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; display:flex; align-items:center; gap:6px;">${icon(field.icon, 14)} ${field.label}</label>
            <div style="position:relative; display:flex; align-items:center;">
              <span style="position:absolute; left:14px; font-weight:900; color:var(--color-text-tertiary); font-size:14px;">$</span>
              <input type="number" id="tariff-${field.key}" value="${settings[field.key] !== undefined ? settings[field.key] : ''}" style="width:100%; height:48px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 14px 0 28px; font-weight:900; font-size:16px; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
            </div>
          </div>
        `).join('')}
      </div>
      <button id="btn-save-tariffs" style="height:48px; border-radius:14px; border:none; background:var(--color-primary); color:white; font-weight:950; font-size:14px; cursor:pointer;">Guardar Tarifas</button>
    </div>`;

  showModal({ title: 'Configurar Tarifas de Publicidad', content: modalContent });

  modalContent.querySelector('#btn-save-tariffs').onclick = async () => {
    const saveBtn = modalContent.querySelector('#btn-save-tariffs');
    saveBtn.disabled = true;
    saveBtn.innerText = 'Guardando...';
    try {
      const newSettings = {
        pushAdPrice: parseFloat(modalContent.querySelector('#tariff-pushAdPrice').value) || 0,
        featuredAdPrice: parseFloat(modalContent.querySelector('#tariff-featuredAdPrice').value) || 0,
        bannerBasePrice: parseFloat(modalContent.querySelector('#tariff-bannerBasePrice').value) || 0,
        premiumGlowPrice: parseFloat(modalContent.querySelector('#tariff-premiumGlowPrice').value) || 0,
        sponsoredBasePrice: parseFloat(modalContent.querySelector('#tariff-sponsoredBasePrice').value) || 0,
        updatedAt: Timestamp.now()
      };
      await setDoc(doc(db, 'settings', 'ads_pricing'), newSettings, { merge: true });
      showToast('Tarifas actualizadas', 'success');
      closeModal();
    } catch (err) {
      console.error('Error saving tariffs:', err);
      showToast('Error al guardar tarifas', 'danger');
      saveBtn.disabled = false;
      saveBtn.innerText = 'Guardar Tarifas';
    }
  };
}

// ─── COMERCIOS PATROCINADOS ACTIVOS ────────────────────────────────────────────
async function loadSponsoredMerchants() {
  const container = document.getElementById('ads-list-container');
  if (!container) return;
  container.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';

  try {
    const snap = await getDocs(query(collection(db, 'banners_mandados'), where('type', '==', 'sponsored_listing')));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (all.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:20px; border:1.5px dashed var(--color-border);">
          <div style="font-size:32px; margin-bottom:12px;">${icon('star', 32)}</div>
          <h4 style="font-size:15px; font-weight:800; color:var(--color-text); margin:0 0 4px;">Sin comercios patrocinados</h4>
          <p style="font-size:12px; max-width:240px; margin:0 auto; line-height:1.4;">Los comercios pueden solicitar patrocinio desde su panel.</p>
        </div>`;
      return;
    }

    const statusColors = { active: '#10b981', waiting: '#6366f1', pending: '#f59e0b', rejected: '#ef4444', completed: '#64748b' };
    const statusLabels = { active: 'Activo', waiting: 'En Espera', pending: 'Pendiente', rejected: 'Rechazado', completed: 'Finalizado' };

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">${all.map(b => {
      const color = statusColors[b.status] || '#64748b';
      const label = statusLabels[b.status] || b.status;
      const endDate = b.endDate ? new Date(b.endDate.seconds * 1000).toLocaleDateString('es-AR') : '—';
      return `
        <div style="background:var(--color-surface); border:1.5px solid rgba(251,191,36,0.25); border-radius:20px; padding:14px; display:flex; align-items:center; gap:12px;">
          <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;background:var(--color-bg-secondary);border:2px solid #fbbf24;flex-shrink:0;">
            ${b.logoUrl ? `<img src="${b.logoUrl}" style="width:100%;height:100%;object-fit:cover;"/>` : ''}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:900; font-size:14px; color:var(--color-text-primary);">${b.merchantName}</div>
            <div style="font-size:11px; color:var(--color-text-tertiary);">Hasta: ${endDate} · ${b.daysPaid} días</div>
          </div>
          <span style="font-size:9.5px; font-weight:900; padding:3px 10px; border-radius:6px; background:${color}20; color:${color}; text-transform:uppercase; flex-shrink:0;">${label}</span>
        </div>`;
    }).join('')}</div>`;

  } catch (err) {
    console.error('Error loading sponsored merchants:', err);
    container.innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px;">Error al cargar patrocinios.</p>';
  }
}

// ─── GESTOR DE PRODUCTOS SOLO EN LA APP ───────────────────────────────────────
async function loadOnlyInAppProducts() {
  const container = document.getElementById('ads-list-container');
  if (!container) return;
  container.innerHTML = '<div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>';

  try {
    // 1. Fetch all comercios map for names
    const comerciosSnap = await getDocs(collection(db, 'comercios'));
    const comerciosMap = {};
    comerciosSnap.docs.forEach(d => {
      comerciosMap[d.id] = d.data().name || 'Comercio';
    });

    // 2. Fetch all products where onlyInApp == true across all stores
    let onlyInAppProducts = [];
    try {
      const q = query(collectionGroup(db, 'products'), where('onlyInApp', '==', true));
      const snap = await getDocs(q);
      onlyInAppProducts = snap.docs.map(docSnap => {
        const data = docSnap.data();
        const pathSegments = docSnap.ref.path.split('/');
        const comercioId = pathSegments[1];
        return {
          id: docSnap.id,
          comercioId,
          comercioName: comerciosMap[comercioId] || 'Comercio',
          ...data
        };
      });
    } catch (err) {
      console.warn('Fallback collectionGroup query failed, scanning comercios subcollections:', err);
      for (const comDoc of comerciosSnap.docs) {
        const pSnap = await getDocs(collection(db, 'comercios', comDoc.id, 'products'));
        pSnap.docs.forEach(pd => {
          const pData = pd.data();
          if (pData.onlyInApp === true) {
            onlyInAppProducts.push({
              id: pd.id,
              comercioId: comDoc.id,
              comercioName: comDoc.data().name || 'Comercio',
              ...pData
            });
          }
        });
      }
    }

    if (onlyInAppProducts.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:50px 20px; background:var(--color-surface); border-radius:24px; border:1.5px dashed var(--color-border);">
          <div style="font-size:36px; margin-bottom:12px;">📱</div>
          <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0 0 6px; color:var(--color-text-primary);">No hay productos "Solo en la App" activos</h3>
          <p style="font-size:12px; color:var(--color-text-secondary); max-width:320px; margin:0 auto; line-height:1.4;">
            Ningún comercio tiene productos marcados como exclusivos de la app en este momento.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="background:rgba(99,102,241,0.06); border:1.5px solid rgba(99,102,241,0.2); border-radius:16px; padding:14px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <h4 style="font-size:13px; font-weight:900; color:var(--color-text-primary); margin:0;">Productos Exclusivos "Solo en App"</h4>
            <p style="font-size:11px; color:var(--color-text-secondary); margin:2px 0 0;">Controlá o quitá anuncios exclusivos de la app de cualquier comercio.</p>
          </div>
          <span style="font-size:13px; font-weight:950; color:var(--color-primary); background:rgba(99,102,241,0.12); padding:4px 12px; border-radius:20px;">${onlyInAppProducts.length} Activos</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          ${onlyInAppProducts.map(prod => `
            <div style="background:var(--color-surface); border-radius:20px; border:1.5px solid var(--color-border); padding:16px; display:flex; align-items:center; justify-content:space-between; gap:14px; box-shadow:0 4px 12px rgba(0,0,0,0.03);">
              <div style="display:flex; align-items:center; gap:14px; min-width:0; flex:1;">
                <div style="width:54px; height:54px; border-radius:14px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
                  ${prod.image ? `<img src="${prod.image}" style="width:100%; height:100%; object-fit:cover;" />` : `<span style="font-size:20px;">📦</span>`}
                </div>
                <div style="min-width:0; flex:1;">
                  <span style="font-size:10px; font-weight:800; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.04em;">${prod.comercioName}</span>
                  <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-text-primary); margin:2px 0 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${prod.name || 'Producto'}</h4>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:13px; font-weight:950; color:var(--color-text-primary);">${formatPrice(prod.price || 0)}</span>
                    <span style="font-size:10px; font-weight:800; color:#8b5cf6; background:rgba(139,92,246,0.12); padding:2px 8px; border-radius:6px; text-transform:uppercase;">Solo en App</span>
                  </div>
                </div>
              </div>
              <button class="btn-disable-only-in-app" data-comercio-id="${prod.comercioId}" data-prod-id="${prod.id}" style="height:38px; padding:0 12px; border-radius:12px; border:none; background:rgba(239,68,68,0.1); color:#ef4444; font-weight:900; font-size:11.5px; cursor:pointer; flex-shrink:0; display:flex; align-items:center; gap:4px; transition:all 0.2s;">
                ${icon('close', 14)} Quitar de "Solo en App"
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Attach click listeners to disable button
    container.querySelectorAll('.btn-disable-only-in-app').forEach(btn => {
      btn.onclick = async () => {
        const cId = btn.dataset.comercioId;
        const pId = btn.dataset.prodId;
        btn.disabled = true;
        btn.innerText = 'Desactivando...';

        try {
          await updateDoc(doc(db, 'comercios', cId, 'products', pId), {
            onlyInApp: false,
            updatedAt: Timestamp.now()
          });
          showToast('Producto quitado de "Solo en la App"', 'success');
          loadOnlyInAppProducts();
        } catch (err) {
          console.error('Error disabling onlyInApp:', err);
          showToast('Error al desactivar la etiqueta', 'danger');
          btn.disabled = false;
          btn.innerHTML = `${icon('close', 14)} Quitar de "Solo en App"`;
        }
      };
    });
  } catch (err) {
    console.error('Error loading onlyInApp products:', err);
    container.innerHTML = '<p style="color:#ef4444; text-align:center; padding:20px;">Error al cargar productos solo en la app.</p>';
  }
}
