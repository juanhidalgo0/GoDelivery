// Order price-breakdown modal for the driver panel.
// Extracted from delivery-panel.js so this code is only fetched/parsed when the
// driver actually opens it, instead of on every panel load.
import { closeModal } from '../../components/modal.js';
import { getState } from '../../state.js';
import { icon } from '../../utils/icons.js';
import { getDriverMapTheme } from '../../components/driver-navigation-map.js';
import { getOrderDriverEarnings, isOrderEncomienda } from '../delivery-panel.js';

export function openOrderBreakdownModal(order) {
  if (!order) return;

  const currentTheme = getDriverMapTheme();
  const isLight = currentTheme === 'light';

  const isCash = order.paymentMethod === 'efectivo' || (order.paymentMethod && order.paymentMethod.toString().toLowerCase().includes('efect'));
  const isFavor = Boolean(order.isFavor);
  const isEncomienda = isOrderEncomienda(order);

  // 1. Products / Items / Purchase cost
  let productsSubtotal = 0;
  let productsLabel = 'Productos / Pedido';
  let stopDetails = [];

  if (isFavor && !isEncomienda) {
    productsLabel = 'Compra en Locales';
    productsSubtotal = (order.purchaseCost !== undefined) ? order.purchaseCost : (order.purchaseItemsTotal || 0);
    if (Array.isArray(order.stopsPurchases) && order.stopsPurchases.length > 0) {
      stopDetails = order.stopsPurchases;
    }
  } else if (isFavor && isEncomienda) {
    productsLabel = 'Servicio de Encomienda';
    productsSubtotal = order.packageCost || 0;
  } else {
    productsLabel = 'Productos del Comercio';
    if (order.subtotal !== undefined) {
      productsSubtotal = Number(order.subtotal);
    } else if (order.itemsTotal !== undefined) {
      productsSubtotal = Number(order.itemsTotal);
    } else if (Array.isArray(order.items)) {
      productsSubtotal = order.items.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.quantity) || Number(it.cant) || 1)), 0);
    }
  }

  // 2. Breakdown Components
  const deliveryFee = Number(order.deliveryCost || order.shippingCost || order.deliveryFee || 0);
  const purchaseFee = Number(order.purchaseFee || 0);
  const extraStopsFee = Number(order.extraStopsFee || 0);
  const appUsageFee = Number(order.appUsageFee || order.serviceFee || 0);
  const rainSurcharge = Number(order.rainSurcharge || (order.isRaining ? (getState().deliveryRainSurcharge || 300) : 0));
  const nightSurcharge = Number(order.nightSurcharge || order.extraFee || 0);
  const tipAmount = Number(order.tip || order.tipAmount || 0);
  const pointsDiscount = Number(order.pointsDiscount || order.discountPoints || order.pointsValue || order.pointsUsedDiscount || 0);
  const couponDiscount = Number(order.couponDiscount || order.discount || 0);

  // Grand total
  const grandTotal = Number(order.totalAmount || order.total || 0);

  // Driver Earnings
  const driverEarnings = getOrderDriverEarnings(order);

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'order-breakdown-modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    z-index: 99999999; display: flex; align-items: flex-end; justify-content: center;
    animation: fadeIn 0.2s ease-out;
  `;

  modalOverlay.innerHTML = `
    <div id="order-breakdown-modal-card" style="
      width: 100%; max-width: 500px;
      max-height: 90vh;
      background: ${isLight ? '#ffffff' : '#0b111e'};
      border: 1.5px solid ${isLight ? 'rgba(225,29,72,0.25)' : 'rgba(225,29,72,0.45)'};
      border-radius: 28px 28px 0 0;
      box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.65);
      display: flex; flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
    ">
      <!-- DRAG HANDLE -->
      <div style="width: 100%; display: flex; justify-content: center; padding: 12px 0 4px 0;">
        <div style="width: 44px; height: 5px; border-radius: 4px; background: ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.2)'};"></div>
      </div>

      <!-- HEADER -->
      <div style="padding: 6px 18px 12px 18px; border-bottom: 1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:42px; height:42px; border-radius:14px; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); display:flex; align-items:center; justify-content:center; color:white; box-shadow:0 4px 12px rgba(225,29,72,0.4); flex-shrink:0;">
            ${icon('receipt', 20)}
          </div>
          <div>
            <div style="font-size:16px; font-weight:900; color:var(--driver-text-primary);">
              Desglose del Total
            </div>
            <div style="font-size:11.5px; font-weight:700; color:var(--driver-text-secondary); margin-top:1px;">
              Pedido #${order.orderId || order.id.slice(0, 6)} • ${order.userName || order.clientName || 'Cliente'}
            </div>
          </div>
        </div>
        <button id="close-breakdown-modal-btn" aria-label="Cerrar" style="
          width: 44px; height: 44px; border-radius: 50%;
          background: var(--driver-fill-subtle);
          border: none; color: var(--driver-text-secondary);
          font-size: 16px; font-weight: 900; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        ">✕</button>
      </div>

      <!-- MAIN PAYMENT CALLOUT BANNER -->
      <div style="padding: 12px 18px 6px 18px;">
        <div style="
          padding: 12px 14px; border-radius: 18px;
          background: ${isCash ? (isLight ? '#fef3c7' : 'rgba(245, 158, 11, 0.15)') : (isLight ? '#e0f2fe' : 'rgba(14, 165, 233, 0.15)')};
          border: 1.5px solid ${isCash ? '#fde68a' : (isLight ? '#bae6fd' : 'rgba(14, 165, 233, 0.35)')};
          display: flex; flex-direction: column; gap: 4px;
        ">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span style="font-size:11px; font-weight:900; color:${isCash ? (isLight ? '#b45309' : '#f59e0b') : (isLight ? '#0369a1' : '#38bdf8')}; text-transform:uppercase; letter-spacing:0.5px; display:inline-flex; align-items:center; gap:4px;">
              <span style="display:inline-flex;">${icon(isCash ? 'dollarSign' : 'creditCard', 11)}</span> ${isCash ? 'PAGO EN EFECTIVO' : 'PAGO POR TRANSFERENCIA'}
            </span>
            <span style="font-size:10px; font-weight:900; background:${isCash ? '#f59e0b' : '#0ea5e9'}; color:white; padding:2px 7px; border-radius:8px;">
              ${isCash ? 'COBRAR EN EFECTIVO' : 'SOLICITAR TRANSFERENCIA'}
            </span>
          </div>
          <div style="font-size:24px; font-weight:950; color:${isCash ? (isLight ? '#78350f' : '#fef08a') : (isLight ? '#0c4a6e' : '#e0f2fe')}; line-height:1.1;">
            $${grandTotal.toLocaleString('es-AR')}
          </div>
          <div style="font-size:11px; font-weight:700; color:${isCash ? (isLight ? '#92400e' : '#fde68a') : (isLight ? '#0284c7' : '#7dd3fc')}; margin-top:2px; display:flex; align-items:flex-start; gap:4px;">
            <span style="display:inline-flex; flex-shrink:0; margin-top:1px;">${icon(isCash ? 'wallet' : 'smartphone', 11)}</span> <span>${isCash ? 'El cliente debe abonar esta suma en efectivo al momento de la entrega.' : 'El cliente te transfiere a vos. Solicitá y verificá el comprobante al entregar.'}</span>
          </div>
        </div>
      </div>

      <!-- ITEM BY ITEM BREAKDOWN LIST -->
      <div style="padding: 8px 18px 12px 18px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 44vh; -webkit-overflow-scrolling: touch;">
        <div style="font-size: 11px; font-weight: 800; color: var(--driver-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
          Conceptos Incluidos:
        </div>

        <!-- 1. PRODUCTOS / MANDADO -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:var(--driver-fill-faint-b); border:1px solid var(--driver-hairline);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-flex;">${icon('shoppingBag', 15)}</span>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary);">${productsLabel}</span>
              ${stopDetails.length > 0 ? `
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">
                  ${stopDetails.map(s => `${s.store}: $${(s.amount || 0).toLocaleString('es-AR')}`).join(' • ')}
                </span>
              ` : ''}
            </div>
          </div>
          <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
            $${productsSubtotal.toLocaleString('es-AR')}
          </span>
        </div>

        <!-- 2. COSTO DE ENVÍO -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:var(--driver-fill-faint-b); border:1px solid var(--driver-hairline);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-flex;">${icon('motorcycle', 15)}</span>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary);">Costo de Envío / Distancia</span>
              <span style="font-size:10.5px; color:var(--driver-text-secondary);">Tarifa base por recorrido</span>
            </div>
          </div>
          <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
            $${deliveryFee.toLocaleString('es-AR')}
          </span>
        </div>

        <!-- 3. GESTIÓN PERSONALIZADA -->
        ${purchaseFee > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:var(--driver-fill-faint-b); border:1px solid var(--driver-hairline);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('zap', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary);">Gestión y Compra en Locales</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Atención y selección personalizada</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
              $${purchaseFee.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 4. PARADAS ADICIONALES -->
        ${extraStopsFee > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:var(--driver-fill-faint-b); border:1px solid var(--driver-hairline);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('mapPin', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary);">Paradas Adicionales (${order.stopsCount || 2})</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Múltiples comercios visitados</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
              $${extraStopsFee.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 5. TARIFA POR USO DE APP -->
        ${appUsageFee > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:var(--driver-fill-faint-b); border:1px solid var(--driver-hairline);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('smartphone', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary);">Tarifa por Servicio GoDelivery</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Soporte, tecnología y conectividad</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
              $${appUsageFee.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 6. RECARGO POR LLUVIA / CLIMA -->
        ${rainSurcharge > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.1)'}; border:1px solid ${isLight ? '#fecaca' : 'rgba(225,29,72,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('cloudRain', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#e11d48;">Recargo por Lluvia / Clima</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Adicional asignado al repartidor</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#e11d48;">
              $${rainSurcharge.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 7. RECARGO NOCTURNO -->
        ${nightSurcharge > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:var(--driver-fill-faint-b); border:1px solid var(--driver-hairline);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('moon', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:var(--driver-text-primary);">Recargo de Horario Especial</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Franja horaria nocturna / feriado</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:var(--driver-text-primary);">
              $${nightSurcharge.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 8. PROPINA -->
        ${tipAmount > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f0fdf4' : 'rgba(34,197,94,0.1)'}; border:1px solid ${isLight ? '#bbf7d0' : 'rgba(34,197,94,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('gift', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#16a34a;">Propina para el Repartidor</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">100% directa para vos</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#16a34a;">
              $${tipAmount.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 9. DESCUENTO POR PUNTOS -->
        ${pointsDiscount > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f0fdf4' : 'rgba(34,197,94,0.1)'}; border:1px solid ${isLight ? '#bbf7d0' : 'rgba(34,197,94,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('gem', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#16a34a;">Descuento por GoPuntos</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Puntos canjeados por el cliente</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#16a34a;">
              -$${pointsDiscount.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- 10. DESCUENTO POR CUPÓN -->
        ${couponDiscount > 0 ? `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-radius:12px; background:${isLight ? '#f0fdf4' : 'rgba(34,197,94,0.1)'}; border:1px solid ${isLight ? '#bbf7d0' : 'rgba(34,197,94,0.25)'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="display:inline-flex;">${icon('tag', 15)}</span>
              <div style="display:flex; flex-direction:column;">
                <span style="font-size:12.5px; font-weight:800; color:#16a34a;">Descuento Cupón (${order.couponCode || 'Promo'})</span>
                <span style="font-size:10.5px; color:var(--driver-text-secondary);">Bonificación aplicada al cliente</span>
              </div>
            </div>
            <span style="font-size:13.5px; font-weight:900; color:#16a34a;">
              -$${couponDiscount.toLocaleString('es-AR')}
            </span>
          </div>
        ` : ''}

        <!-- TOTAL ROW -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-radius:14px; background:${isLight ? '#fff1f2' : 'rgba(225,29,72,0.15)'}; border:1.5px solid ${isLight ? '#fecaca' : 'rgba(225,29,72,0.35)'}; margin-top:4px;">
          <span style="font-size:13.5px; font-weight:900; color:${isLight ? '#be123c' : '#fb7185'};">TOTAL A COBRAR:</span>
          <span style="font-size:17px; font-weight:950; color:${isLight ? '#9f1239' : '#ffffff'};">$${grandTotal.toLocaleString('es-AR')}</span>
        </div>
      </div>

      <!-- DRIVER SETTLEMENT & NET EARNINGS -->
      <div style="margin: 4px 18px 12px 18px; padding: 10px 12px; border-radius: 14px; background:var(--driver-fill-faint); border:1px dashed var(--driver-border-strong); display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-flex;">${icon('wallet', 14)}</span>
          <span style="font-size:11.5px; font-weight:800; color:var(--driver-text-tertiary);">Tu Ganancia Neta por este Pedido:</span>
        </div>
        <span style="font-size:14px; font-weight:900; color:#22c55e;">
          $${driverEarnings.toLocaleString('es-AR')}
        </span>
      </div>

      <!-- CLOSE BUTTON -->
      <div style="padding: 0 18px 18px 18px;">
        <button id="breakdown-modal-ok-btn" style="
          width: 100%; height: 48px; border-radius: 16px;
          background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
          border: none; color: white;
          font-size: 14px; font-weight: 900; cursor: pointer;
          box-shadow: 0 6px 18px rgba(225, 29, 72, 0.4);
          display: flex; align-items: center; justify-content: center; gap: 6px;
        ">
          ${icon('checkCircle', 16)} Entendido
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const closeModal = () => modalOverlay.remove();
  modalOverlay.querySelector('#close-breakdown-modal-btn').onclick = closeModal;
  modalOverlay.querySelector('#breakdown-modal-ok-btn').onclick = closeModal;
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
  };
}

