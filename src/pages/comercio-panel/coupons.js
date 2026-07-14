import { db } from '../../firebase.js';
import { doc, setDoc, getDoc, getDocs, collection, query, where, orderBy, limit, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { formatDate } from '../../utils/format.js';

let currentComercioName = '';

export async function renderComercioCoupons(container) {
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
              <h1 style="font-family:var(--font-display); font-weight:800; font-size:18px; margin:0; line-height:1.2; letter-spacing:-0.01em;">Cupones de Descuento</h1>
              <p id="coupon-commerce-subtitle" style="font-size:10px; color:rgba(255,255,255,0.85); font-weight:700; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Cargando...</p>
            </div>
          </div>
          
          <button id="commerce-create-coupon-btn" style="height:36px; padding: 0 12px; border-radius:10px; border:none; background:white; color:var(--color-primary); font-weight:800; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:4px; position:relative; z-index:2; box-shadow:0 4px 10px rgba(0,0,0,0.1); transition: all 0.2s;">
            ${icon('plus', 14)} Nuevo
          </button>
        </div>
      </div>

      <!-- Scrollable List -->
      <div style="flex:1; overflow-y:auto; padding:20px; -webkit-overflow-scrolling:touch;">
        <div style="display:flex; flex-direction:column; gap:16px; max-width:600px; margin:0 auto;">
          <!-- Active search filter -->
          <div style="position:relative;">
            <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); display:flex; align-items:center;">
              ${icon('search', 18)}
            </span>
            <input type="text" id="commerce-coupon-search-input" placeholder="Buscar cupón por código..." style="width:100%; height:48px; border-radius:16px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px 0 44px; font-weight:700; font-size:14px; color:var(--color-text); outline:none; box-sizing:border-box;" />
          </div>

          <div id="commerce-coupons-list" style="display:flex; flex-direction:column; gap:14px; padding-bottom:30px;">
            <div style="text-align:center; padding:40px; color:var(--color-text-tertiary);">Cargando cupones...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  let coupons = [];

  // Fetch commerce name
  try {
    const comSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (comSnap.exists()) {
      currentComercioName = comSnap.data().name || 'Mi Comercio';
      const sub = document.getElementById('coupon-commerce-subtitle');
      if (sub) sub.textContent = currentComercioName;
    }
  } catch (err) {
    console.error('Error fetching commerce name:', err);
  }

  // Load coupons from Firestore
  async function loadCoupons() {
    try {
      const q = query(
        collection(db, 'coupons'), 
        where('ownerId', '==', comercioId),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCouponsList();
    } catch (err) {
      console.error('Error loading coupons:', err);
      const listContainer = document.getElementById('commerce-coupons-list');
      if (listContainer) {
        listContainer.innerHTML = `<div style="text-align:center;color:var(--color-danger);font-weight:700;padding:20px;">Error al cargar cupones.</div>`;
      }
    }
  }

  function renderCouponsList() {
    const container = document.getElementById('commerce-coupons-list');
    if (!container) return;

    const searchVal = document.getElementById('commerce-coupon-search-input')?.value.trim().toUpperCase() || '';
    const filtered = coupons.filter(c => c.id.toUpperCase().includes(searchVal));

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px; border: 1.5px dashed var(--color-border); border-radius: 20px; background:var(--color-surface); opacity:0.75;">
          <div style="font-size:44px; margin-bottom:12px;">🏷️</div>
          <h3 style="font-family:var(--font-display); font-weight:800; margin:0; font-size:16px;">Sin cupones activos</h3>
          <p style="font-size:12px; color:var(--color-text-tertiary); margin:8px 0 0;">Creá cupones de descuento exclusivos para incentivar a tus clientes.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(c => {
      const isExpired = c.expirationDate && new Date(c.expirationDate + 'T23:59:59-03:00').getTime() < Date.now();
      const statusBadge = isExpired 
        ? `<span style="background:rgba(239, 68, 68, 0.1); color:#ef4444; font-size:10px; font-weight:800; padding:4px 8px; border-radius:8px;">EXPIRADO</span>`
        : (c.active 
            ? `<span style="background:rgba(39, 174, 96, 0.1); color:#27ae60; font-size:10px; font-weight:800; padding:4px 8px; border-radius:8px;">ACTIVO</span>`
            : `<span style="background:var(--color-border); color:var(--color-text-tertiary); font-size:10px; font-weight:800; padding:4px 8px; border-radius:8px;">PAUSADO</span>`);

      const discountLabel = c.type === 'free_delivery'
        ? `Envío Gratis`
        : (c.discountType === 'percentage' ? `${c.value}% OFF` : `$${c.value} OFF`);

      return `
        <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; flex-direction:column; gap:12px; box-shadow:var(--shadow-sm); position:relative;">
          
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-family: monospace; font-size: 16px; font-weight: 800; color: var(--color-text); background: var(--color-bg-secondary); padding: 4px 10px; border-radius: 8px; border: 1.5px dashed var(--color-border); display:inline-block; letter-spacing:1px; margin-bottom:8px;">
                ${c.id}
              </div>
              <div style="font-size:18px; font-weight:900; color:var(--color-primary);">${discountLabel}</div>
            </div>
            ${statusBadge}
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; border-top:1px solid var(--color-border-light); padding-top:12px; font-size:12px; color:var(--color-text-secondary); font-weight:600;">
            <div>Usos: <b>${c.usedCount || 0} / ${c.usageLimit || '∞'}</b></div>
            <div>Expiración: <b>${c.expirationDate ? c.expirationDate.split('-').reverse().join('/') : 'Sin límite'}</b></div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; border-top:1px solid var(--color-border-light); padding-top:12px; margin-top:4px;">
            <button class="coupon-toggle-btn btn btn-ghost" data-id="${c.id}" style="height:36px; padding:0 12px; border-radius:10px; font-size:12px; font-weight:800; border:1px solid var(--color-border); cursor:pointer; background:${c.active ? 'rgba(39, 174, 96, 0.08)' : 'transparent'}; color:${c.active ? '#27ae60' : 'var(--color-text-secondary)'};">
              ${c.active ? 'Pausar' : 'Activar'}
            </button>
            <button class="coupon-delete-btn btn btn-ghost" data-id="${c.id}" style="height:36px; padding:0 12px; border-radius:10px; font-size:12px; font-weight:800; border:1px solid rgba(239, 68, 68, 0.2); cursor:pointer; color:#ef4444; background:rgba(239, 68, 68, 0.05);">
              Eliminar
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Bind list interactions (active status change & deletion)
  document.getElementById('commerce-coupons-list')?.addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('.coupon-toggle-btn');
    const deleteBtn = e.target.closest('.coupon-delete-btn');

    if (toggleBtn) {
      const code = toggleBtn.dataset.id;
      const coupon = coupons.find(c => c.id === code);
      if (!coupon) return;

      const nextActive = !coupon.active;
      toggleBtn.disabled = true;
      try {
        await updateDoc(doc(db, 'coupons', code), { active: nextActive });
        coupon.active = nextActive;
        renderCouponsList();
        showToast(`Cupón ${code} ${nextActive ? 'activado' : 'pausado'} con éxito.`, 'success');
      } catch (err) {
        console.error(err);
        showToast('Error al modificar estado.', 'error');
      } finally {
        toggleBtn.disabled = false;
      }
    }

    if (deleteBtn) {
      const code = deleteBtn.dataset.id;
      showConfirm({
        title: '⚠️ ¿ELIMINAR CUPÓN?',
        message: `¿Estás seguro de que querés eliminar el cupón <b>${code}</b> definitivamente? Los clientes ya no podrán aplicarlo.`,
        confirmText: 'SÍ, ELIMINAR',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'coupons', code));
            coupons = coupons.filter(c => c.id !== code);
            renderCouponsList();
            showToast(`Cupón ${code} eliminado con éxito.`, 'success');
          } catch (err) {
            console.error(err);
            showToast('Error al eliminar cupón.', 'error');
          }
        }
      });
    }
  });

  // Bind live search
  document.getElementById('commerce-coupon-search-input')?.addEventListener('input', renderCouponsList);

  // Bind creation modal trigger
  document.getElementById('commerce-create-coupon-btn')?.addEventListener('click', () => {
    showCreateModal(comercioId, loadCoupons);
  });

  // Load on enter
  await loadCoupons();
}

function showCreateModal(comercioId, onSuccessCallback) {
  let selectedDiscountType = 'percentage'; // 'percentage' or 'fixed'
  let codeMode = 'random'; // 'random' or 'custom'
  let currentRandomCode = '';

  const generateRandomAlphanumeric = (length = 4) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const updateRandomCodePreview = () => {
    const prefix = document.getElementById('m-prefix')?.value || 'SALE-';
    currentRandomCode = `${prefix}${generateRandomAlphanumeric(4)}`;
    const preview = document.getElementById('m-code-preview');
    if (preview) preview.textContent = currentRandomCode;
  };

  showModal({
    title: 'Crear Cupón de Descuento',
    content: `
      <div style="display:flex; flex-direction:column; gap:16px; padding:4px;">
        
        <!-- Segmented Type Selector -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Tipo de Descuento</label>
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border);">
            <button id="m-type-percentage" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 6px rgba(0,0,0,0.06);">
              🏷️ Porcentaje (%)
            </button>
            <button id="m-type-fixed" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
              💲 Monto Fijo ($)
            </button>
          </div>
        </div>

        <!-- Value Input -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label id="m-value-label" style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Porcentaje de Descuento</label>
          <div style="position:relative;">
            <input type="number" id="m-coupon-value" value="10" min="1" max="100" placeholder="Ej: 15" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 36px 0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
            <span id="m-value-symbol" style="position:absolute; right:16px; top:50%; transform:translateY(-50%); font-weight:800; color:var(--color-text-secondary);">%</span>
          </div>
        </div>

        <!-- Stock Input -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Cantidad de Cupones (Límite)</label>
          <input type="number" id="m-coupon-limit" value="50" min="1" placeholder="Ej: 100" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
        </div>

        <!-- Expiration Date -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Fecha de Vencimiento (Opcional)</label>
          <input type="date" id="m-coupon-expiry" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text); cursor:pointer;" />
        </div>

        <!-- Code Generation Mode -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Código de Cupón</label>
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border); margin-bottom:8px;">
            <button id="m-code-rand" style="flex:1; height:36px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:12px; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.06);">
              Aleatorio
            </button>
            <button id="m-code-custom" style="flex:1; height:36px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:12px; cursor:pointer;">
              Personalizado
            </button>
          </div>

          <!-- Random Prefix Block -->
          <div id="m-code-rand-block" style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; gap:10px; align-items:center;">
              <select id="m-prefix" style="flex:1; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 12px; font-weight:700; font-size:14px; color:var(--color-text); outline:none; cursor:pointer;">
                <option value="SALE-">Prefijo: SALE-</option>
                <option value="DESCU-">Prefijo: DESCU-</option>
                <option value="PROMO-">Prefijo: PROMO-</option>
              </select>
              <button id="m-code-regenerate-btn" class="btn btn-ghost" style="height:48px; border-radius:14px; font-weight:800; border:1.5px solid var(--color-border); background:var(--color-surface); cursor:pointer;">
                🔄 Generar
              </button>
            </div>
            <div style="font-size:12px; color:var(--color-text-secondary); font-weight:700; padding:6px; text-align:center; background:rgba(168, 85, 247, 0.06); border-radius:10px; border:1px dashed rgba(168, 85, 247, 0.2);">
              Código propuesto: <b id="m-code-preview" style="font-family:monospace; color:var(--color-primary); font-size:14px;">SALE-XXXX</b>
            </div>
          </div>

          <!-- Custom Code Input -->
          <div id="m-code-custom-block" style="display:none; flex-direction:column; gap:4px;">
            <input type="text" id="m-coupon-code" placeholder="Ej: DESCUENTOHELADO" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-family:monospace; font-weight:800; font-size:14px; outline:none; box-sizing:border-box; text-transform:uppercase; color:var(--color-text);" />
            <span style="font-size:10px; font-weight:700; color:var(--color-text-tertiary); padding-left:4px;">Letras y números únicamente.</span>
          </div>
        </div>

      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="m-coupon-cancel" style="height:48px; border-radius:14px; font-weight:800; flex:1;">Cancelar</button>
      <button class="btn btn-primary" id="m-coupon-create" style="height:48px; border-radius:14px; font-weight:900; flex:2; display:flex; align-items:center; justify-content:center; gap:8px;">
        ${icon('check', 16)} CREAR CUPÓN
      </button>
    `,
    onOpen: () => {
      const btnTypePct = document.getElementById('m-type-percentage');
      const btnTypeFixed = document.getElementById('m-type-fixed');
      const valueLabel = document.getElementById('m-value-label');
      const valueSymbol = document.getElementById('m-value-symbol');
      const valueInput = document.getElementById('m-coupon-value');

      const btnCodeRand = document.getElementById('m-code-rand');
      const btnCodeCustom = document.getElementById('m-code-custom');
      const randBlock = document.getElementById('m-code-rand-block');
      const customBlock = document.getElementById('m-code-custom-block');
      const prefixSelect = document.getElementById('m-prefix');
      const regenBtn = document.getElementById('m-code-regenerate-btn');
      const codeInput = document.getElementById('m-coupon-code');

      updateRandomCodePreview();

      const setActiveSegButton = (activeBtn, inactiveBtn) => {
        activeBtn.style.background = 'white';
        activeBtn.style.color = 'var(--color-text)';
        activeBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
        inactiveBtn.style.background = 'transparent';
        inactiveBtn.style.color = 'var(--color-text-tertiary)';
        inactiveBtn.style.boxShadow = 'none';
      };

      btnTypePct?.addEventListener('click', () => {
        selectedDiscountType = 'percentage';
        setActiveSegButton(btnTypePct, btnTypeFixed);
        if (valueLabel) valueLabel.textContent = 'Porcentaje de Descuento';
        if (valueSymbol) valueSymbol.textContent = '%';
        if (valueInput) {
          valueInput.value = '10';
          valueInput.setAttribute('max', '100');
        }
      });

      btnTypeFixed?.addEventListener('click', () => {
        selectedDiscountType = 'fixed';
        setActiveSegButton(btnTypeFixed, btnTypePct);
        if (valueLabel) valueLabel.textContent = 'Monto Fijo de Descuento';
        if (valueSymbol) valueSymbol.textContent = '$';
        if (valueInput) {
          valueInput.value = '150';
          valueInput.removeAttribute('max');
        }
      });

      btnCodeRand?.addEventListener('click', () => {
        codeMode = 'random';
        setActiveSegButton(btnCodeRand, btnCodeCustom);
        if (randBlock) randBlock.style.display = 'flex';
        if (customBlock) customBlock.style.display = 'none';
      });

      btnCodeCustom?.addEventListener('click', () => {
        codeMode = 'custom';
        setActiveSegButton(btnCodeCustom, btnCodeRand);
        if (randBlock) randBlock.style.display = 'none';
        if (customBlock) customBlock.style.display = 'flex';
        setTimeout(() => codeInput?.focus(), 150);
      });

      prefixSelect?.addEventListener('change', updateRandomCodePreview);
      regenBtn?.addEventListener('click', updateRandomCodePreview);

      codeInput?.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });

      document.getElementById('m-coupon-cancel')?.addEventListener('click', closeModal);

      document.getElementById('m-coupon-create')?.addEventListener('click', async () => {
        const limitVal = parseInt(document.getElementById('m-coupon-limit')?.value || '50', 10);
        const valueVal = parseFloat(valueInput?.value || '0');
        const expiryVal = document.getElementById('m-coupon-expiry')?.value || '';

        let finalCode = '';
        if (codeMode === 'random') {
          finalCode = currentRandomCode;
        } else {
          finalCode = codeInput?.value.trim().toUpperCase() || '';
          if (!finalCode) {
            showToast('Ingresá un código personalizado.', 'warning');
            return;
          }
        }

        if (isNaN(limitVal) || limitVal <= 0) {
          showToast('Ingresá un límite de usos válido.', 'warning');
          return;
        }

        if (isNaN(valueVal) || valueVal <= 0) {
          showToast('Ingresá un valor de descuento válido.', 'warning');
          return;
        }

        if (selectedDiscountType === 'percentage' && valueVal > 100) {
          showToast('El porcentaje no puede ser mayor a 100%.', 'warning');
          return;
        }

        const createBtn = document.getElementById('m-coupon-create');
        if (createBtn) {
          createBtn.disabled = true;
          createBtn.innerHTML = 'Creando...';
        }

        try {
          // Zero-Trust Check: Ensure it does not already exist
          const docRef = doc(db, 'coupons', finalCode);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            showToast(`El código de cupón ${finalCode} ya existe. Elegí otro.`, 'warning');
            if (createBtn) {
              createBtn.disabled = false;
              createBtn.innerHTML = `${icon('check', 16)} CREAR CUPÓN`;
            }
            return;
          }

          // Write to Firestore
          await setDoc(docRef, {
            active: true,
            ownerId: comercioId,
            comercioName: currentComercioName,
            scope: 'products',
            discountType: selectedDiscountType,
            absorbedBy: 'comercio',
            type: selectedDiscountType === 'percentage' ? 'percentage' : 'fixed',
            value: valueVal,
            usageLimit: limitVal,
            remaining: limitVal,
            usedCount: 0,
            expirationDate: expiryVal || null,
            createdAt: serverTimestamp()
          });

          showToast(`¡Cupón ${finalCode} creado con éxito!`, 'success');
          closeModal();
          if (onSuccessCallback) onSuccessCallback();
        } catch (err) {
          console.error(err);
          showToast('Error al crear el cupón.', 'error');
          if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = `${icon('check', 16)} CREAR CUPÓN`;
          }
        }
      });
    }
  });
}
