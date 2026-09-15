// Mandado (errand) stop-list and purchase-editor modal for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens a mandado order, instead of on every panel load.
import { closeModal } from '../../components/modal.js';
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { cleanMandadoText, parseMandadoDetails } from '../delivery-panel.js';

export function getMandadoStopsList(order) {
  if (!order) return [];
  const text = order.description || order.itemsText || order.details || order.notes || '';
  const clean = cleanMandadoText(text);

  if (Array.isArray(order.stopsPurchases) && order.stopsPurchases.length > 0) {
    return order.stopsPurchases.map(sp => ({
      store: sp.store || 'Comercio',
      items: sp.items || 'Productos del mandado',
      amount: typeof sp.amount === 'number' ? sp.amount : (parseFloat(sp.amount) || 0)
    }));
  }

  const regex = /(?:(\d+)\.\s*)?(?:Comercio|Lugar|Local)\s*:\s*([^📦📝\n]+)(?:[\s\S]*?(?:Pedido|Detalle|Instrucción|Compra)\s*:\s*([^1-9\n\r]+))?/gi;
  const stops = [];
  let match;
  while ((match = regex.exec(clean)) !== null) {
    let store = (match[2] || '').trim().replace(/^comercio:\s*/i, '');
    let items = (match[3] || '').trim() || 'Ver productos';
    if (store) {
      stops.push({ store, items, amount: 0 });
    }
  }

  if (stops.length === 0) {
    const parsed = parseMandadoDetails(text, order.comercioName || order.pickupAddress || 'Comercio / Kiosco');
    stops.push({
      store: parsed.comercio,
      items: parsed.items,
      amount: typeof order.purchaseCost === 'number' ? order.purchaseCost : (order.purchaseItemsTotal || 0)
    });
  }

  return stops;
}

export function openMandadoPurchaseModal({ order, isEdit = false, onConfirm, onCancel }) {
  if (!order) return;

  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';
  const stops = getMandadoStopsList(order);

  // Compute fixed breakdown fees
  const deliveryDistFee = Number(order.deliveryCost || order.shippingCost || order.deliveryFee || 0);
  const purchaseFee = Number(order.purchaseFee || 0);
  const extraStopsFee = Number(order.extraStopsFee || 0);
  const appUsageFee = Number(order.appUsageFee || order.serviceFee || 0);
  const rainSurcharge = Number(order.rainSurcharge || (order.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const pointsDiscount = Number(order.pointsDiscount || order.discountPoints || order.pointsValue || order.pointsUsedDiscount || 0);
  const couponDiscount = Number(order.couponDiscount || order.discount || 0);
  const tipAmount = Number(order.tip || order.tipAmount || 0);

  const deliveryBaseFee = deliveryDistFee + purchaseFee + extraStopsFee + appUsageFee + rainSurcharge + tipAmount - pointsDiscount - couponDiscount;

  // Initial purchase total
  let initialPurchaseTotal = stops.reduce((sum, s) => sum + (s.amount || 0), 0);
  if (initialPurchaseTotal === 0 && (order.purchaseCost || order.purchaseItemsTotal)) {
    initialPurchaseTotal = order.purchaseCost || order.purchaseItemsTotal || 0;
    if (stops.length === 1) stops[0].amount = initialPurchaseTotal;
  }

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'mandado-purchase-modal-overlay';
  modalOverlay.className = 'modal-overlay';
  modalOverlay.setAttribute('data-scrollable', 'true');
  modalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh;
    background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    z-index: 99999999; display: flex; align-items: flex-end; justify-content: center;
    animation: fadeIn 0.2s ease-out; touch-action: pan-y;
  `;

  modalOverlay.innerHTML = `
    <div id="mandado-purchase-modal-card" class="modal-content" data-scrollable="true" style="
      width: 100%; max-width: 500px;
      max-height: 92vh; max-height: 92dvh;
      background: ${isLight ? '#ffffff' : '#0b111e'};
      border: 1.5px solid ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(225,29,72,0.45)'};
      border-radius: 28px 28px 0 0;
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.6);
      display: flex; flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      touch-action: pan-y;
    ">
      <!-- DRAG HANDLE BAR -->
      <div style="width: 100%; display: flex; justify-content: center; padding: 12px 0 4px 0; flex-shrink: 0;">
        <div style="width: 44px; height: 5px; border-radius: 4px; background: ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)'};"></div>
      </div>

      <!-- HEADER -->
      <div style="padding: 6px 18px 12px 18px; border-bottom: 1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-shrink: 0;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:42px; height:42px; border-radius:14px; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); display:flex; align-items:center; justify-content:center; color:white; box-shadow:0 4px 12px rgba(225,29,72,0.4); flex-shrink:0;">
            ${icon('shoppingBag', 20)}
          </div>
          <div>
            <div style="font-size:16px; font-weight:900; color:var(--driver-text-primary);">
              ${isEdit ? 'Modificar Valor de Compra' : 'Valor de Productos Comprados'}
            </div>
            <div style="font-size:11.5px; font-weight:700; color:var(--driver-text-secondary); margin-top:1px;">
              Pedido #${order.orderId || order.id.slice(0, 6)} • ${order.userName || order.clientName || 'Cliente'}
            </div>
          </div>
        </div>
        <button id="close-mandado-purchase-modal-btn" aria-label="Cerrar" style="
          width: 44px; height: 44px; border-radius: 50%;
          background: var(--driver-fill-subtle);
          border: none; color: var(--driver-text-secondary);
          font-size: 16px; font-weight: 900; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        ">✕</button>
      </div>

      <!-- INSTRUCTIONS -->
      <div style="padding: 10px 18px 4px 18px; font-size: 12px; color: var(--driver-text-label); line-height: 1.4; flex-shrink: 0;">
        Ingresá el importe abonado en cada parada del mandado. <strong>Podés ingresar $0</strong> si no hubo costo de compra.
      </div>

      <!-- SCROLLABLE STOPS LIST -->
      <div id="mandado-stops-list-container" class="mandado-stops-scroll-container scrollable-y" data-scrollable="true" style="
        padding: 8px 18px 14px 18px;
        display: flex; flex-direction: column; gap: 12px;
        overflow-y: auto; -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        touch-action: pan-y !important;
        flex: 1 1 auto;
        min-height: 140px;
        max-height: 44vh;
      ">
        ${stops.map((stop, idx) => `
          <div style="
            background: ${isLight ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)'};
            border: 1.5px solid ${isLight ? 'rgba(225, 29, 72, 0.25)' : 'rgba(225, 29, 72, 0.35)'};
            border-radius: 18px; padding: 12px 14px;
            display: flex; flex-direction: column; gap: 8px;
          ">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); color:white; font-size:10px; font-weight:900; padding:2px 7px; border-radius:8px;">
                  Parada #${idx + 1}
                </span>
                <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
                  ${stop.store}
                </span>
              </div>
            </div>

            <div style="font-size:11.5px; color:var(--driver-text-secondary); font-weight:600; display:flex; align-items:center; gap:4px;">
              <span style="display:inline-flex;">${icon('package', 12)}</span> ${stop.items}
            </div>

            <!-- INPUT FIELD -->
            <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
              <div style="
                flex: 1; display: flex; align-items: center;
                background: ${isLight ? '#ffffff' : 'rgba(0,0,0,0.4)'};
                border: 2px solid var(--driver-border-strong);
                border-radius: 14px; padding: 0 12px; height: 46px;
                transition: border-color 0.2s ease;
              " class="mandado-input-wrapper">
                <span style="font-size:16px; font-weight:900; color:var(--driver-text-primary); margin-right:4px;">$</span>
                <input type="number" step="10" min="0" data-idx="${idx}" class="mandado-stop-amount-input" 
                       placeholder="0" value="${stop.amount > 0 ? stop.amount : ''}" 
                       style="
                         width: 100%; border: none; background: transparent;
                         font-size: 17px; font-weight: 900; color: var(--driver-text-primary);
                         outline: none; font-family: inherit;
                       " />
              </div>
            </div>

            <!-- QUICK CHIP BUTTONS -->
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="0" style="
                background:var(--driver-fill-subtle);
                border:1px solid var(--driver-border-c);
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:var(--driver-text-label); cursor:pointer;
              ">$0</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="500" style="
                background:var(--driver-fill-subtle);
                border:1px solid var(--driver-border-c);
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:var(--driver-text-label); cursor:pointer;
              ">+$500</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="1000" style="
                background:var(--driver-fill-subtle);
                border:1px solid var(--driver-border-c);
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:var(--driver-text-label); cursor:pointer;
              ">+$1.000</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="2000" style="
                background:var(--driver-fill-subtle);
                border:1px solid var(--driver-border-c);
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:var(--driver-text-label); cursor:pointer;
              ">+$2.000</button>
              <button type="button" class="mandado-quick-chip" data-idx="${idx}" data-val="5000" style="
                background:var(--driver-fill-subtle);
                border:1px solid var(--driver-border-c);
                padding:4px 8px; border-radius:8px; font-size:11px; font-weight:800;
                color:var(--driver-text-label); cursor:pointer;
              ">+$5.000</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- LIVE CALCULATION TOTAL CARD (ITEMIZED) -->
      <div style="
        margin: 0 18px 12px 18px; padding: 12px 14px; border-radius: 16px;
        background: ${isLight ? '#fff1f2' : 'rgba(225, 29, 72, 0.12)'};
        border: 1.5px solid ${isLight ? '#fecaca' : 'rgba(225, 29, 72, 0.35)'};
        display: flex; flex-direction: column; gap: 4px;
      ">
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--driver-text-secondary); font-weight:700;">
          <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('shoppingBag', 11)}</span> Subtotal Productos Comprados:</span>
          <span id="mandado-modal-live-purchases" style="font-weight:900; color:var(--driver-text-primary);">$0</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--driver-text-secondary); font-weight:700;">
          <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('motorcycle', 11)}</span> Costo de Envío / Distancia:</span>
          <span style="font-weight:900; color:var(--driver-text-primary);">$${deliveryDistFee.toLocaleString('es-AR')}</span>
        </div>
        ${purchaseFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--driver-text-secondary); font-weight:700;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('zap', 11)}</span> Gestión y Compra en Locales:</span>
            <span style="font-weight:900; color:var(--driver-text-primary);">$${purchaseFee.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${extraStopsFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--driver-text-secondary); font-weight:700;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('mapPin', 11)}</span> Paradas Adicionales:</span>
            <span style="font-weight:900; color:var(--driver-text-primary);">$${extraStopsFee.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${appUsageFee > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--driver-text-secondary); font-weight:700;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('smartphone', 11)}</span> Tarifa por Servicio App:</span>
            <span style="font-weight:900; color:var(--driver-text-primary);">$${appUsageFee.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${rainSurcharge > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#e11d48; font-weight:700;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('cloudRain', 11)}</span> Recargo por Lluvia:</span>
            <span style="font-weight:900; color:#e11d48;">$${rainSurcharge.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${pointsDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#16a34a; font-weight:700;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('gem', 11)}</span> Descuento GoPuntos:</span>
            <span style="font-weight:900; color:#16a34a;">-$${pointsDiscount.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        ${couponDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#16a34a; font-weight:700;">
            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-flex;">${icon('tag', 11)}</span> Descuento Cupón:</span>
            <span style="font-weight:900; color:#16a34a;">-$${couponDiscount.toLocaleString('es-AR')}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:900; color:${isLight ? '#be123c' : '#fb7185'}; padding-top:5px; border-top:1px dashed ${isLight ? 'rgba(225,29,72,0.2)' : 'rgba(225,29,72,0.3)'}; margin-top:2px;">
          <span>TOTAL A COBRAR:</span>
          <span id="mandado-modal-live-total">$0</span>
        </div>
      </div>

      <!-- ACTION BUTTONS -->
      <div style="padding: 0 18px calc(18px + max(env(safe-area-inset-bottom, 0px), 24px)) 18px; display: flex; gap: 10px; flex-shrink: 0; background: ${isLight ? '#ffffff' : '#0b111e'};">
        <button id="mandado-modal-cancel-btn" style="
          flex: 1; height: 50px; border-radius: 16px;
          background: var(--driver-fill-subtle);
          border: 1px solid var(--driver-border-strong);
          color: var(--driver-text-label);
          font-size: 13.5px; font-weight: 800; cursor: pointer;
        ">
          Cancelar
        </button>

        <button id="mandado-modal-confirm-btn" style="
          flex: 2; height: 50px; border-radius: 16px;
          background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
          border: none; color: white;
          font-size: 13.5px; font-weight: 900; cursor: pointer;
          box-shadow: 0 6px 18px rgba(225, 29, 72, 0.45);
          display: flex; align-items: center; justify-content: center; gap: 6px;
        ">
          <span style="display:inline-flex;">${icon(isEdit ? 'save' : 'checkCircle', 15)}</span> <span>${isEdit ? 'Guardar Cambios' : 'Confirmar y Continuar'}</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  modalOverlay.addEventListener('touchmove', (e) => {
    e.stopPropagation();
  }, { passive: true });

  const stopsScrollContainer = modalOverlay.querySelector('#mandado-stops-list-container');
  if (stopsScrollContainer) {
    stopsScrollContainer.addEventListener('touchmove', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }
  const updateLiveTotals = () => {
    let sum = 0;
    const inputs = modalOverlay.querySelectorAll('.mandado-stop-amount-input');
    inputs.forEach(inp => {
      const val = parseFloat(inp.value) || 0;
      if (val > 0) sum += val;
    });
    const totalElement = modalOverlay.querySelector('#mandado-modal-live-total');
    const purchasesElement = modalOverlay.querySelector('#mandado-modal-live-purchases');
    if (purchasesElement) purchasesElement.textContent = `$${sum.toLocaleString('es-AR')}`;
    if (totalElement) totalElement.textContent = `$${(deliveryBaseFee + sum).toLocaleString('es-AR')}`;
    return sum;
  };

  updateLiveTotals();

  // Bind input changes
  const inputs = modalOverlay.querySelectorAll('.mandado-stop-amount-input');
  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      updateLiveTotals();
    });
    inp.addEventListener('focus', () => {
      const wrapper = inp.closest('.mandado-input-wrapper');
      if (wrapper) wrapper.style.borderColor = '#e11d48';
    });
    inp.addEventListener('blur', () => {
      const wrapper = inp.closest('.mandado-input-wrapper');
      if (wrapper) wrapper.style.borderColor = 'var(--driver-border-strong)';
    });
  });

  // Bind quick chip buttons
  const chips = modalOverlay.querySelectorAll('.mandado-quick-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = chip.dataset.idx;
      const addVal = parseFloat(chip.dataset.val) || 0;
      const targetInput = modalOverlay.querySelector(`.mandado-stop-amount-input[data-idx="${idx}"]`);
      if (targetInput) {
        if (addVal === 0) {
          targetInput.value = '0';
        } else {
          const currentVal = parseFloat(targetInput.value) || 0;
          targetInput.value = (currentVal + addVal).toString();
        }
        updateLiveTotals();
      }
    });
  });

  const closeModal = () => {
    modalOverlay.remove();
  };

  modalOverlay.querySelector('#close-mandado-purchase-modal-btn').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };

  modalOverlay.querySelector('#mandado-modal-cancel-btn').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };

  modalOverlay.querySelector('#mandado-modal-confirm-btn').onclick = () => {
    const sum = updateLiveTotals();
    const updatedStops = stops.map((s, idx) => {
      const inp = modalOverlay.querySelector(`.mandado-stop-amount-input[data-idx="${idx}"]`);
      const val = inp ? (parseFloat(inp.value) || 0) : 0;
      return {
        store: s.store,
        items: s.items,
        amount: val
      };
    });
    const finalGrandTotal = deliveryBaseFee + sum;
    closeModal();
    if (onConfirm) {
      onConfirm(sum, updatedStops, finalGrandTotal);
    }
  };
}

