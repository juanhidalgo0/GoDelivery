import { db } from '../../firebase.js';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';

let currentComercioName = '';

// Promos abre este formulario para crear un cupón del comercio.
export function openCouponCreator(comercioId, comercioName, onSuccessCallback) {
  currentComercioName = comercioName || '';
  return showCreateModal(comercioId, onSuccessCallback);
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
