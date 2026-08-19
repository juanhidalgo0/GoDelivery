import { db } from '../../firebase.js';
import { doc, getDoc, getDocs, collection, query, where, addDoc, Timestamp } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { formatPrice } from '../../utils/format.js';
import { openCropper } from '../../utils/cropper.js';

let currentComercioName = '';
let pricingSettings = {
  bannerBasePrice: 1000, // per day
  premiumGlowPrice: 500, // per day
  sponsoredBasePrice: 1500 // per day
};

export async function renderComercioAds(container) {
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  // Calculate padding dynamically
  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative 
    ? 'var(--status-bar-height, 24px)' 
    : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; overflow:hidden; background:var(--color-bg);">
      <!-- Premium Fixed Header -->
      <div style="width:100%; padding-top: ${topPadding}; background: var(--color-primary); position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1); flex-shrink: 0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding: 12px 16px 20px 16px; position:relative; overflow:hidden; color:white;">
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          
          <div style="display:flex; align-items:center; gap:12px; position:relative; z-index:2; min-width:0; flex:1;">
            <a href="#/mi-comercio/${comercioId}" style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.15); color:white; text-decoration:none;">
              ${icon('chevronLeft', 24)}
            </a>
            <div style="min-width:0; flex:1;">
              <h1 style="font-family:var(--font-display); font-weight:800; font-size:18px; margin:0; line-height:1.2; letter-spacing:-0.01em;">Publicidad y Banners</h1>
              <p id="ads-commerce-subtitle" style="font-size:10px; color:rgba(255,255,255,0.85); font-weight:700; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Cargando...</p>
            </div>
          </div>
          
          <button id="commerce-request-ad-btn" style="height:36px; padding: 0 12px; border-radius:10px; border:none; background:white; color:var(--color-primary); font-weight:800; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:4px; position:relative; z-index:2; box-shadow:0 4px 10px rgba(0,0,0,0.1); transition: all 0.2s;">
            ${icon('plus', 14)} Solicitar
          </button>
        </div>
      </div>

      <!-- Scrollable List -->
      <div style="flex:1; overflow-y:auto; padding:20px; -webkit-overflow-scrolling:touch;">
        <div style="display:flex; flex-direction:column; gap:16px; max-width:600px; margin:0 auto;">

          <!-- Action Cards for Paid Ads & Featured Placement -->
          <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:4px;">
            <!-- Push Ad Card -->
            <div id="btn-push-ad-card" style="background: linear-gradient(135deg, rgba(225,29,72,0.06) 0%, rgba(168,85,247,0.06) 100%); border: 1.5px solid rgba(225,29,72,0.25); border-radius: 20px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 14px rgba(225,29,72,0.04);">
              <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                <div style="width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, var(--color-primary), #a855f7); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(225,29,72,0.25);">
                  ${icon('bell', 22)}
                </div>
                <div style="min-width: 0; flex: 1;">
                  <h4 style="font-family: var(--font-display); font-size: 14px; font-weight: 900; margin: 0; color: var(--color-text-primary);">Enviar Notificación Anuncio</h4>
                  <p style="font-size: 11px; color: var(--color-text-secondary); margin: 2px 0 0; font-weight: 600;">Notificación push masiva a todos los usuarios</p>
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <span id="push-ad-price-tag" style="display: block; font-size: 15px; font-weight: 950; color: var(--color-primary); font-family: var(--font-display);">$0</span>
                <span style="font-size: 10px; font-weight: 800; color: #059669; background: rgba(5,150,105,0.1); padding: 2px 6px; border-radius: 6px; text-transform: uppercase;">Enviar Ya</span>
              </div>
            </div>

            <!-- Featured Slider Card -->
            <div id="btn-featured-slider-card" style="background: linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(217,119,6,0.06) 100%); border: 1.5px solid rgba(245,158,11,0.3); border-radius: 20px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 14px rgba(245,158,11,0.04);">
              <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                <div style="width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(245,158,11,0.25);">
                  ${icon('sparkles', 22)}
                </div>
                <div style="min-width: 0; flex: 1;">
                  <h4 style="font-family: var(--font-display); font-size: 14px; font-weight: 900; margin: 0; color: var(--color-text-primary);">Contratar Destaque Slider Home</h4>
                  <p style="font-size: 11px; color: var(--color-text-secondary); margin: 2px 0 0; font-weight: 600;">Aparecer primero en Destacados del Home</p>
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <span id="featured-ad-price-tag" style="display: block; font-size: 15px; font-weight: 950; color: #d97706; font-family: var(--font-display);">$0</span>
                <span style="font-size: 10px; font-weight: 800; color: #d97706; background: rgba(245,158,11,0.15); padding: 2px 6px; border-radius: 6px; text-transform: uppercase;">Aparecer Top</span>
              </div>
            </div>
          </div>

          <h2 style="font-size:14px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin:0 0 -4px 0;">Tus Campañas Publicitarias</h2>
          
          <div id="commerce-ads-list" style="display:flex; flex-direction:column; gap:14px; padding-bottom:30px;">
            <div style="text-align:center; padding:40px; color:var(--color-text-tertiary);">Cargando campañas...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Fetch commerce name and ad settings
  let logoUrl = '';
  try {
    const comSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (comSnap.exists()) {
      const data = comSnap.data();
      currentComercioName = data.name || 'Mi Comercio';
      logoUrl = data.logo || '';
      const sub = document.getElementById('ads-commerce-subtitle');
      if (sub) sub.textContent = currentComercioName;
    }

    const settingsSnap = await getDoc(doc(db, 'settings', 'ads_pricing'));
    if (settingsSnap.exists()) {
      pricingSettings = { ...pricingSettings, ...settingsSnap.data() };
    }

    // Update UI price tags
    const pushPriceTag = document.getElementById('push-ad-price-tag');
    if (pushPriceTag) pushPriceTag.textContent = formatPrice(pricingSettings.pushAdPrice || 3000);

    const featuredPriceTag = document.getElementById('featured-ad-price-tag');
    if (featuredPriceTag) featuredPriceTag.textContent = formatPrice(pricingSettings.featuredAdPrice || 5000);

    // Bind action card click listeners
    const pushCard = document.getElementById('btn-push-ad-card');
    if (pushCard) pushCard.onclick = () => openPushAdModal(comercioId, currentComercioName);

    const featuredCard = document.getElementById('btn-featured-slider-card');
    if (featuredCard) featuredCard.onclick = () => openFeaturedSliderModal(comercioId, currentComercioName);
  } catch (err) {
    console.error('Error fetching details:', err);
  }

  // Load Commerce campaigns
  const loadCommerceAds = async () => {
    const listContainer = document.getElementById('commerce-ads-list');
    if (!listContainer) return;

    try {
      const q = query(collection(db, 'banners_mandados'), where('comercioId', '==', comercioId));
      const snap = await getDocs(q);
      const campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (campaigns.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align:center; padding:40px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:20px; border:1.5px dashed var(--color-border);">
            <div style="font-size:32px; display:inline-block; margin-bottom:12px; color:var(--color-text-tertiary);">${icon('megaphone', 32)}</div>
            <h4 style="font-size:14px; font-weight:800; color:var(--color-text); margin:0 0 4px;">Sin campañas activas</h4>
            <p style="font-size:11px; max-width:240px; margin:0 auto; line-height:1.4;">Impulsá tus ventas solicitando un banner en Mandados o patrocinio en la lista.</p>
          </div>
        `;
        return;
      }

      // Sort by status and date
      campaigns.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      listContainer.innerHTML = campaigns.map(c => {
        let statusLabel = 'Pendiente';
        let statusBg = 'rgba(245, 158, 11, 0.15)';
        let statusColor = '#f59e0b';

        if (c.status === 'active') {
          statusLabel = 'Activa';
          statusBg = 'rgba(16, 185, 129, 0.15)';
          statusColor = '#10b981';
        } else if (c.status === 'waiting') {
          statusLabel = 'Aprobada (En Espera)';
          statusBg = 'rgba(99, 102, 241, 0.15)';
          statusColor = '#6366f1';
        } else if (c.status === 'rejected') {
          statusLabel = 'Rechazada';
          statusBg = 'rgba(239, 68, 68, 0.15)';
          statusColor = '#ef4444';
        } else if (c.status === 'completed') {
          statusLabel = 'Finalizada';
          statusBg = 'var(--color-bg-secondary)';
          statusColor = 'var(--color-text-tertiary)';
        }

        const isBannerType = c.type !== 'sponsored_listing';

        return `
          <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:12px; box-sizing:border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <span style="font-weight:900; font-size:14px; color:var(--color-text-primary);">${c.name}</span>
              <span style="font-size:9.5px; font-weight:900; padding:2px 8px; border-radius:6px; background:${statusBg}; color:${statusColor}; text-transform:uppercase;">${statusLabel}</span>
            </div>

            <div style="display:flex; gap:12px; align-items:center;">
              ${isBannerType ? `
                <div style="width:70px; height:42px; border-radius:8px; overflow:hidden; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); flex-shrink:0;">
                  <img src="${c.imageUrl || ''}" style="width:100%; height:100%; object-fit:cover;" />
                </div>
              ` : `
                <div style="width:40px; height:40px; border-radius:50%; overflow:hidden; background:var(--color-bg-secondary); border:1.5px solid #fbbf24; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  <img src="${c.logoUrl || logoUrl}" style="width:100%; height:100%; object-fit:cover;" />
                </div>
              `}
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
                <div style="font-size:12px; color:var(--color-text-secondary);">
                  Tipo: <b>${isBannerType ? 'Banner Promocional' : 'Comercio Patrocinado (Top)'}</b>
                </div>
                <div style="font-size:11px; color:var(--color-text-tertiary);">
                  Duración: <b>${c.daysPaid} días</b> | Total: <b>${formatPrice(c.pricePaid)}</b>
                </div>
                ${c.rejectionReason ? `
                  <div style="font-size:11px; color:#ef4444; margin-top:4px;">
                    Motivo de rechazo: "${c.rejectionReason}"
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      console.error('Error loading ads list:', err);
      listContainer.innerHTML = '<p style="color:var(--color-danger); text-align:center; padding:20px;">Error al cargar campañas.</p>';
    }
  };

  loadCommerceAds();

  // Request new Ad Modal
  const requestAdBtn = document.getElementById('commerce-request-ad-btn');
  requestAdBtn.onclick = () => {
    let adType = 'banner'; // 'banner' or 'sponsored'
    let selectedDays = 7;
    let hasGlow = false;
    let hasDiscount = false;
    let discountAmount = 500;
    let discountLimit = 5;
    let croppedBase64 = '';
    let logoBase64 = logoUrl;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative; box-sizing:border-box;';

    const getEstimatedCost = () => {
      if (adType === 'sponsored') {
        return selectedDays * pricingSettings.sponsoredBasePrice;
      }
      let base = selectedDays * pricingSettings.bannerBasePrice;
      if (hasGlow) base += selectedDays * pricingSettings.premiumGlowPrice;
      return base;
    };

    const updateModalUI = () => {
      const sponsoredSection = modalContent.querySelector('#request-sponsored-section');
      const bannerSection = modalContent.querySelector('#request-banner-section');
      const totalLabel = modalContent.querySelector('#request-total-price');

      if (adType === 'sponsored') {
        sponsoredSection.style.display = 'flex';
        bannerSection.style.display = 'none';
      } else {
        sponsoredSection.style.display = 'none';
        bannerSection.style.display = 'flex';
      }

      totalLabel.innerText = formatPrice(getEstimatedCost());
    };

    modalContent.innerHTML = `
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; color:white;">
        <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0;">Nueva Solicitud Publicitaria</h3>
        <button id="close-request-modal" style="background:transparent; border:none; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          ${icon('close', 20)}
        </button>
      </div>

      <div style="flex:1; padding:20px; display:flex; flex-direction:column; gap:16px; overflow-y:auto; box-sizing:border-box; -webkit-overflow-scrolling:touch;">
        
        <div style="display:flex; flex-direction:column; gap:6px; width:100%; box-sizing:border-box;">
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Nombre de la Campaña</label>
          <input type="text" id="req-name-input" placeholder="Ej: Promo Finde ${currentComercioName}" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" required />
        </div>

        <div style="display:flex; gap:12px; width:100%; box-sizing:border-box;">
          <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Tipo de Publicidad</label>
            <select id="req-type-select" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 10px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;">
              <option value="banner">Banner en Mandados</option>
              <option value="sponsored">Comercio Patrocinado (Top Lista)</option>
            </select>
          </div>
          <div style="width:110px; display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Días</label>
            <input type="number" id="req-days-input" value="7" min="1" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" required />
          </div>
        </div>

        <!-- Banner design section -->
        <div id="request-banner-section" style="display:flex; flex-direction:column; gap:14px; width:100%; box-sizing:border-box;">
          <div style="display:flex; gap:12px; width:100%; box-sizing:border-box;">
            <div style="flex:1; display:flex; flex-direction:column; gap:6px; min-width:0;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Título en Banner</label>
              <input type="text" id="req-title-text" placeholder="Ej: 20% OFF" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
            </div>
            <div style="flex:1; display:flex; flex-direction:column; gap:6px; min-width:0;">
              <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Subtítulo en Banner</label>
              <input type="text" id="req-subtitle-text" placeholder="Ej: En helados" style="width:100%; height:44px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:6px; width:100%; box-sizing:border-box;">
            <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Imagen de Publicidad (Aspecto: 8:5)</label>
            <div style="display:flex; gap:12px; align-items:center; width:100%; box-sizing:border-box;">
              <div id="req-banner-preview-container" style="width:100px; height:62px; border-radius:10px; border:1.5px dashed var(--color-border); background:var(--color-bg-secondary); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <div style="font-size:9px; color:var(--color-text-tertiary); font-weight:800; text-align:center; padding:2px;">Sin imagen</div>
              </div>
              <button type="button" id="btn-req-upload-image" style="height:36px; padding:0 12px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-weight:800; font-size:12px; cursor:pointer;">Subir Imagen</button>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; border:1px solid var(--color-border-light); border-radius:16px; padding:14px; background:var(--color-bg-secondary); width:100%; box-sizing:border-box;">
            <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; margin:0; width:100%; box-sizing:border-box;">
              <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
                <span style="font-size:13px; font-weight:850; color:var(--color-text-primary); text-align:left;">Destacado Estético (Visual Premium)</span>
                <span style="font-size:10px; color:var(--color-text-secondary); font-weight:550; text-align:left; white-space:normal; word-break:break-word;">Borde dorado animado (+${formatPrice(pricingSettings.premiumGlowPrice)}/día)</span>
              </div>
              <input type="checkbox" id="req-glow-toggle" style="width:20px; height:20px; accent-color:var(--color-primary); flex-shrink:0;" />
            </label>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; border:1px solid var(--color-border-light); border-radius:16px; padding:14px; background:var(--color-bg-secondary); width:100%; box-sizing:border-box;">
            <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; margin:0; width:100%; box-sizing:border-box;">
              <span style="font-size:13px; font-weight:850; color:var(--color-text-primary);">Financiar descuento de envío</span>
              <input type="checkbox" id="req-discount-toggle" style="width:20px; height:20px; accent-color:var(--color-primary); flex-shrink:0;" />
            </label>
            <div id="req-discount-subform" style="display:none; gap:12px; margin-top:12px; width:100%; box-sizing:border-box;">
              <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
                <label style="font-size:10px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Descuento ($)</label>
                <input type="number" id="req-discount-amount" value="500" style="width:100%; height:40px; border-radius:10px; border:1.5px solid var(--color-border); padding:0 10px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width:0;">
                <label style="font-size:10px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Límite Diario</label>
                <input type="number" id="req-discount-limit" value="5" style="width:100%; height:40px; border-radius:10px; border:1.5px solid var(--color-border); padding:0 10px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface); box-sizing:border-box;" />
              </div>
            </div>
          </div>
        </div>

        <!-- Sponsored listing section -->
        <div id="request-sponsored-section" style="display:none; flex-direction:column; gap:10px; width:100%; box-sizing:border-box;">
          <div style="background:rgba(251, 191, 36, 0.08); border:1.5px solid rgba(251, 191, 36, 0.25); border-radius:16px; padding:14px; color:var(--color-text-secondary); font-size:12px; line-height:1.4;">
            ${icon('star', 16, '#d97706')} Tu comercio aparecerá en las <b>primeras posiciones</b> de la lista horizontal con un elegante borde brillante dorado y un badge de corona destacada.
          </div>
        </div>

        <!-- Total Price Summary -->
        <div style="margin-top:auto; padding:14px; background:var(--color-bg-secondary); border-radius:16px; border:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
          <span style="font-size:12px; font-weight:850; color:var(--color-text-secondary); text-transform:uppercase;">Presupuesto Estimado</span>
          <span id="request-total-price" style="font-size:18px; font-weight:950; color:var(--color-primary);">$0</span>
        </div>

        <button type="button" id="btn-submit-request" style="height:48px; border-radius:14px; border:none; background:var(--color-primary); color:white; font-weight:950; font-size:14px; cursor:pointer; width:100%; margin-top:8px;">
          Enviar Solicitud
        </button>
      </div>
    `;

    showModal({
      title: '',
      hideHeader: true,
      height: '82dvh',
      content: modalContent
    });

    const closeBtn = modalContent.querySelector('#close-request-modal');
    closeBtn.onclick = () => closeModal();

    const typeSelect = modalContent.querySelector('#req-type-select');
    typeSelect.onchange = () => {
      adType = typeSelect.value;
      updateModalUI();
    };

    const daysInput = modalContent.querySelector('#req-days-input');
    daysInput.oninput = () => {
      selectedDays = parseInt(daysInput.value) || 1;
      updateModalUI();
    };

    const glowToggle = modalContent.querySelector('#req-glow-toggle');
    glowToggle.onchange = () => {
      hasGlow = glowToggle.checked;
      updateModalUI();
    };

    const discountToggle = modalContent.querySelector('#req-discount-toggle');
    const discountSubform = modalContent.querySelector('#req-discount-subform');
    discountToggle.onchange = () => {
      hasDiscount = discountToggle.checked;
      discountSubform.style.display = hasDiscount ? 'flex' : 'none';
      updateModalUI();
    };

    const uploadImageBtn = modalContent.querySelector('#btn-req-upload-image');
    uploadImageBtn.onclick = () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
          try {
            const base64 = await openCropper(file, { aspectRatio: 8 / 5, maxWidth: 800, maxHeight: 500 });
            croppedBase64 = base64;
            const container = modalContent.querySelector('#req-banner-preview-container');
            if (container) {
              container.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover;" />`;
            }
          } catch (err) {
            console.error('Error cropping request image:', err);
          }
        }
      };
      fileInput.click();
    };

    const submitBtn = modalContent.querySelector('#btn-submit-request');
    submitBtn.onclick = async () => {
      const name = modalContent.querySelector('#req-name-input').value.trim();
      if (!name) {
        showToast('Completá el nombre de la campaña', 'warning');
        return;
      }
      if (adType === 'banner' && !croppedBase64) {
        showToast('Subí una imagen para el banner', 'warning');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerText = 'Enviando...';

      try {
        const finalPrice = getEstimatedCost();
        const requestData = {
          name,
          type: adType === 'sponsored' ? 'sponsored_listing' : 'banner',
          daysPaid: selectedDays,
          pricePaid: finalPrice,
          comercioId,
          merchantName: currentComercioName,
          status: 'pending',
          hasPremiumGlow: adType === 'banner' ? hasGlow : false,
          hasDiscount: adType === 'banner' ? hasDiscount : false,
          discountAmount: (adType === 'banner' && hasDiscount) ? parseInt(modalContent.querySelector('#req-discount-amount').value) || 0 : 0,
          discountLimitPerDay: (adType === 'banner' && hasDiscount) ? parseInt(modalContent.querySelector('#req-discount-limit').value) || 0 : 0,
          imageUrl: adType === 'banner' ? croppedBase64 : '',
          logoUrl: logoBase64,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        await addDoc(collection(db, 'banners_mandados'), requestData);
        showToast('Solicitud enviada con éxito', 'success');
        closeModal();
        loadCommerceAds();
      } catch (err) {
        console.error('Error submitting request:', err);
        showToast('Error al enviar solicitud', 'danger');
        submitBtn.disabled = false;
        submitBtn.innerText = 'Enviar Solicitud';
      }
    };

    updateModalUI();
  };
}

// ─── MODAL ENVIAR NOTIFICACIÓN ANUNCIO PUSH ──────────────────────────────────
function openPushAdModal(comercioId, comercioName) {
  const pushPrice = pricingSettings.pushAdPrice || 3000;
  let croppedBase64 = '';

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative; box-sizing:border-box;';

  modalContent.innerHTML = `
    <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; color:white; flex-shrink:0;">
      <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:6px;">
        ${icon('bell', 18)} Enviar Notificación Anuncio
      </h3>
      <button id="close-push-modal" style="background:transparent; border:none; color:white; cursor:pointer;">${icon('close', 20)}</button>
    </div>

    <div style="flex:1; padding:20px; display:flex; flex-direction:column; gap:16px; overflow-y:auto; box-sizing:border-box; -webkit-overflow-scrolling:touch;">
      <!-- Clarification Box -->
      <div style="background:linear-gradient(135deg, rgba(225,29,72,0.08) 0%, rgba(168,85,247,0.08) 100%); border:1.5px solid rgba(225,29,72,0.25); border-radius:16px; padding:14px; display:flex; gap:10px; align-items:flex-start;">
        <div style="color:var(--color-primary); font-size:20px; line-height:1;">ℹ️</div>
        <div style="flex:1; font-size:12px; color:var(--color-text-secondary); line-height:1.45; font-weight:600;">
          <strong style="color:var(--color-text-primary); font-weight:900; display:block; margin-bottom:2px;">Aclaración sobre el costo:</strong>
          El costo de esta notificación push es de <strong style="color:var(--color-primary); font-size:14px;">${formatPrice(pushPrice)}</strong>. 
          Al enviar la notificación, <strong>este importe se sumará automáticamente a tus comisiones pendientes de pago</strong>.
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Título de la Notificación *</label>
        <input type="text" id="push-title-input" placeholder="Ej: ¡20% OFF hoy en ${comercioName}!" style="width:100%; height:46px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface);" required />
      </div>

      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Texto / Mensaje *</label>
        <textarea id="push-body-input" rows="3" placeholder="Ej: Aprovechá nuestro descuento exclusivo pidiendo desde la app de GoDelivery." style="width:100%; border-radius:12px; border:1.5px solid var(--color-border); padding:10px 12px; font-weight:600; font-size:13px; color:var(--color-text-primary); background:var(--color-surface); resize:none;" required></textarea>
      </div>

      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Imagen del Banner (Opcional - 16:9)</label>
        <div style="display:flex; gap:12px; align-items:center;">
          <div id="push-preview-container" style="width:90px; height:50px; border-radius:10px; border:1.5px dashed var(--color-border); background:var(--color-bg-secondary); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <span style="font-size:9px; color:var(--color-text-tertiary); font-weight:800;">Sin foto</span>
          </div>
          <button type="button" id="btn-push-upload-image" style="height:36px; padding:0 12px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-weight:800; font-size:12px; cursor:pointer;">Seleccionar Imagen</button>
        </div>
      </div>

      <div style="margin-top:auto; padding:14px; background:var(--color-bg-secondary); border-radius:16px; border:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:12px; font-weight:850; color:var(--color-text-secondary);">Costo a adicionar a comisiones:</span>
        <span style="font-size:18px; font-weight:950; color:var(--color-primary);">${formatPrice(pushPrice)}</span>
      </div>

      <button type="button" id="btn-submit-push-ad" style="height:52px; border-radius:16px; border:none; background:var(--color-primary); color:white; font-weight:900; font-size:15px; cursor:pointer; width:100%; box-shadow:0 8px 20px rgba(var(--color-primary-rgb),0.25);">
        Confirmar y Enviar Notificación (${formatPrice(pushPrice)})
      </button>
    </div>
  `;

  showModal({ title: '', hideHeader: true, height: '82dvh', content: modalContent });

  modalContent.querySelector('#close-push-modal').onclick = () => closeModal();

  const uploadBtn = modalContent.querySelector('#btn-push-upload-image');
  uploadBtn.onclick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const base64 = await openCropper(file, { aspectRatio: 16 / 9, maxWidth: 800, maxHeight: 450 });
          croppedBase64 = base64;
          const container = modalContent.querySelector('#push-preview-container');
          if (container) container.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover;" />`;
        } catch (err) { console.error(err); }
      }
    };
    fileInput.click();
  };

  const submitBtn = modalContent.querySelector('#btn-submit-push-ad');
  submitBtn.onclick = async () => {
    const title = modalContent.querySelector('#push-title-input').value.trim();
    const body = modalContent.querySelector('#push-body-input').value.trim();
    if (!title || !body) {
      return showToast('Completá el título y el mensaje de la notificación', 'warning');
    }

    submitBtn.disabled = true;
    submitBtn.innerText = 'Enviando notificación...';

    try {
      // 1. Add ad charge order record (increases pending commission debt)
      await addDoc(collection(db, 'orders'), {
        comercioId,
        comercioName,
        status: 'completed',
        isAdCharge: true,
        type: 'ad_push',
        title: `Notificación Push: ${title}`,
        total: pushPrice,
        commissionAmount: pushPrice,
        commissionStatus: 'pending',
        createdAt: Timestamp.now(),
        notes: `Notificación anuncio enviada. Título: "${title}"`
      });

      // 2. Add to customAds collection (triggers FCM push broadcast & shows on home)
      await addDoc(collection(db, 'customAds'), {
        title,
        body,
        banner: croppedBase64 || '',
        link: `#/comercio/${comercioId}`,
        active: true,
        isPriority: true,
        comercioId,
        createdAt: Timestamp.now()
      });

      showToast(`¡Notificación enviada! Se sumaron ${formatPrice(pushPrice)} a tus comisiones pendientes.`, 'success');
      closeModal();
    } catch (err) {
      console.error('Error sending push ad:', err);
      showToast('Error al enviar notificación anuncio', 'danger');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Confirmar y Enviar Notificación';
    }
  };
}

// ─── MODAL CONTRATAR DESTAQUE SLIDER HOME ──────────────────────────────────────
function openFeaturedSliderModal(comercioId, comercioName) {
  const featuredPrice = pricingSettings.featuredAdPrice || 5000;
  let croppedBase64 = '';

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative; box-sizing:border-box;';

  modalContent.innerHTML = `
    <div style="background:linear-gradient(135deg, #f59e0b, #d97706); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; color:white; flex-shrink:0;">
      <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; display:flex; align-items:center; gap:6px;">
        ${icon('sparkles', 18)} Destaque Slider Home
      </h3>
      <button id="close-featured-modal" style="background:transparent; border:none; color:white; cursor:pointer;">${icon('close', 20)}</button>
    </div>

    <div style="flex:1; padding:20px; display:flex; flex-direction:column; gap:16px; overflow-y:auto; box-sizing:border-box; -webkit-overflow-scrolling:touch;">
      <!-- Clarification Box -->
      <div style="background:linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(217,119,6,0.08) 100%); border:1.5px solid rgba(245,158,11,0.3); border-radius:16px; padding:14px; display:flex; gap:10px; align-items:flex-start;">
        <div style="color:#d97706; font-size:20px; line-height:1;">⭐</div>
        <div style="flex:1; font-size:12px; color:var(--color-text-secondary); line-height:1.45; font-weight:600;">
          <strong style="color:var(--color-text-primary); font-weight:900; display:block; margin-bottom:2px;">Aclaración sobre el costo:</strong>
          Tu comercio aparecerá destacado en el slider principal del Home por 7 días. 
          El costo de esta promoción es de <strong style="color:#d97706; font-size:14px;">${formatPrice(featuredPrice)}</strong> y <strong>se sumará automáticamente a tus comisiones pendientes de pago</strong>.
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Texto del Badge / Etiqueta *</label>
        <input type="text" id="featured-label-input" placeholder="Ej: Hasta 30% OFF o ¡Imperdible!" value="Promoción Especial" style="width:100%; height:46px; border-radius:12px; border:1.5px solid var(--color-border); padding:0 12px; font-weight:700; color:var(--color-text-primary); background:var(--color-surface);" required />
      </div>

      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase;">Banner para el Slider (Opcional - 16:9)</label>
        <div style="display:flex; gap:12px; align-items:center;">
          <div id="featured-preview-container" style="width:90px; height:50px; border-radius:10px; border:1.5px dashed var(--color-border); background:var(--color-bg-secondary); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <span style="font-size:9px; color:var(--color-text-tertiary); font-weight:800;">Logo comercio</span>
          </div>
          <button type="button" id="btn-featured-upload-image" style="height:36px; padding:0 12px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-secondary); font-weight:800; font-size:12px; cursor:pointer;">Seleccionar Banner</button>
        </div>
      </div>

      <div style="margin-top:auto; padding:14px; background:var(--color-bg-secondary); border-radius:16px; border:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:12px; font-weight:850; color:var(--color-text-secondary);">Costo a adicionar a comisiones:</span>
        <span style="font-size:18px; font-weight:950; color:#d97706;">${formatPrice(featuredPrice)}</span>
      </div>

      <button type="button" id="btn-submit-featured-ad" style="height:52px; border-radius:16px; border:none; background:linear-gradient(135deg, #f59e0b, #d97706); color:white; font-weight:900; font-size:15px; cursor:pointer; width:100%; box-shadow:0 8px 20px rgba(245,158,11,0.25);">
        Activar Destaque (${formatPrice(featuredPrice)})
      </button>
    </div>
  `;

  showModal({ title: '', hideHeader: true, height: '78dvh', content: modalContent });

  modalContent.querySelector('#close-featured-modal').onclick = () => closeModal();

  const uploadBtn = modalContent.querySelector('#btn-featured-upload-image');
  uploadBtn.onclick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const base64 = await openCropper(file, { aspectRatio: 16 / 9, maxWidth: 800, maxHeight: 450 });
          croppedBase64 = base64;
          const container = modalContent.querySelector('#featured-preview-container');
          if (container) container.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover;" />`;
        } catch (err) { console.error(err); }
      }
    };
    fileInput.click();
  };

  const submitBtn = modalContent.querySelector('#btn-submit-featured-ad');
  submitBtn.onclick = async () => {
    const label = modalContent.querySelector('#featured-label-input').value.trim() || 'Destacado';

    submitBtn.disabled = true;
    submitBtn.innerText = 'Activando destaque...';

    try {
      // 1. Add ad charge order record
      await addDoc(collection(db, 'orders'), {
        comercioId,
        comercioName,
        status: 'completed',
        isAdCharge: true,
        type: 'featured_listing',
        title: 'Destaque en Slider Principal Home',
        total: featuredPrice,
        commissionAmount: featuredPrice,
        commissionStatus: 'pending',
        createdAt: Timestamp.now(),
        notes: `Destaque slider home contratado por 7 días.`
      });

      // 2. Activate featured promotion on commerce document
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);
      await updateDoc(doc(db, 'comercios', comercioId), {
        promotion: {
          active: true,
          isPaid: true,
          isPriority: true,
          label,
          banner: croppedBase64 || '',
          startDate: Timestamp.now(),
          endDate: Timestamp.fromDate(endDate)
        }
      });

      showToast(`¡Destaque activado! Tu comercio ya aparece en el slider del home. Se sumaron ${formatPrice(featuredPrice)} a tus comisiones pendientes.`, 'success');
      closeModal();
    } catch (err) {
      console.error('Error activating featured slider ad:', err);
      showToast('Error al activar destaque', 'danger');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Activar Destaque';
    }
  };
}
