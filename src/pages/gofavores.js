
import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { getState, setState } from '../state.js';
import { formatPrice } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { icon } from '../utils/icons.js';
import { showModal, closeModal, showConfirm } from '../components/modal.js';
import { isLoggedIn } from '../auth.js';
import { showAddressPrompt } from '../components/address-modal.js';

export async function renderGoFavores(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const user = getState().user;
  if (!user || !isLoggedIn()) {
    content.innerHTML = `<div class="empty-state">Iniciá sesión para usar GoFavores</div>`;
    return;
  }
  
  content.innerHTML = `
    <div class="gofavores-page page-enter" style="display:flex; flex-direction:column; height: 100%; background: var(--color-bg); overflow: hidden;">
      
      <div style="flex:1; display: flex; flex-direction: column; gap: 20px; overflow-y:auto; padding: 20px; -webkit-overflow-scrolling: touch; padding-bottom: 40px;">
        
        <!-- Option 1: Mandado -->
        <div id="favor-mandado-btn" class="card-interactive" style="background: var(--color-surface); border-radius: 32px; padding: 40px 24px; border: 1px solid var(--color-border); cursor: pointer; transition: all 0.3s; position: relative; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.02); display: flex; flex-direction: column; align-items: center; text-align: center; min-height: 240px; justify-content: center;">
          <div style="width: 64px; height: 64px; border-radius: 22px; background: rgba(34, 197, 94, 0.1); color: #16a34a; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; flex-shrink: 0;">
            ${icon('package', 32)}
          </div>
          <h3 style="font-size: 22px; font-weight: 950; margin-bottom: 10px; color: var(--color-text); letter-spacing: -0.02em;">Mandado / Envío</h3>
          <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6; font-weight: 600; margin: 0; max-width: 240px;">¿Olvidaste algo? Nosotros lo buscamos <br/>y lo llevamos donde nos digas.</p>
          <div style="margin-top: 24px; background: rgba(34, 197, 94, 0.08); padding: 8px 16px; border-radius: 12px; color: #16a34a; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em;">
            Costo normal de envío
          </div>
        </div>

        <!-- Option 2: Compra -->
        <div id="favor-compra-btn" class="card-interactive" style="background: var(--color-surface); border-radius: 32px; padding: 40px 24px; border: 1px solid var(--color-border); cursor: pointer; transition: all 0.3s; position: relative; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.02); display: flex; flex-direction: column; align-items: center; text-align: center; min-height: 240px; justify-content: center;">
          <div style="width: 64px; height: 64px; border-radius: 22px; background: rgba(239, 68, 68, 0.1); color: #dc2626; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; flex-shrink: 0;">
            ${icon('shoppingBag', 32)}
          </div>
          <h3 style="font-size: 22px; font-weight: 950; margin-bottom: 10px; color: var(--color-text); letter-spacing: -0.02em;">Comprar algo</h3>
          <p style="font-size: 14px; color: var(--color-text-secondary); line-height: 1.6; font-weight: 600; margin: 0; max-width: 240px;">Compramos por vos lo que necesites en <br/>cualquier negocio de la ciudad.</p>
          <div style="margin-top: 24px; background: rgba(239, 68, 68, 0.08); padding: 8px 16px; border-radius: 12px; color: #dc2626; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em;">
            Tarifa especial por gestión
          </div>
        </div>

        <!-- Info Section -->
        <div style="margin-top: 10px; padding: 24px; background: var(--color-bg-secondary); border-radius: 32px; border: 1.5px dashed var(--color-border);">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 18px;">
            <div style="width:32px; height:32px; border-radius:10px; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 10px rgba(var(--color-primary-rgb),0.2);">
              ${icon('info', 18)}
            </div>
            <h4 style="font-size: 16px; font-weight: 900; color: var(--color-text); margin: 0;">¿Cómo funciona?</h4>
          </div>
          <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px;">
            <li style="display:flex; gap:14px; align-items: flex-start;">
               <div style="width:20px; height:20px; border-radius:50%; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:12px; font-weight:900; margin-top:2px;">1</div>
               <span style="font-size: 13.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.4;">Describe detalladamente lo que necesitas.</span>
            </li>
            <li style="display:flex; gap:14px; align-items: flex-start;">
               <div style="width:20px; height:20px; border-radius:50%; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:12px; font-weight:900; margin-top:2px;">2</div>
               <span style="font-size: 13.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.4;">El repartidor te contactará por el chat interno para coordinar.</span>
            </li>
            <li style="display:flex; gap:14px; align-items: flex-start;">
               <div style="width:20px; height:20px; border-radius:50%; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:12px; font-weight:900; margin-top:2px;">3</div>
               <span style="font-size: 13.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.4;">Seguí el recorrido en tiempo real desde el mapa.</span>
            </li>
            <li style="display:flex; gap:14px; align-items: flex-start;">
               <div style="width:20px; height:20px; border-radius:50%; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:12px; font-weight:900; margin-top:2px;">4</div>
               <span style="font-size: 13.5px; color: var(--color-text-secondary); font-weight: 600; line-height: 1.4;">El pago de los productos se arregla con el repartidor.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `;

  document.getElementById('favor-mandado-btn').onclick = () => showMandadoForm();
  document.getElementById('favor-compra-btn').onclick = () => showCompraForm();
}

async function showMandadoForm() {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = getState().deliveryAddress || '';

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 20px;';
  modalEl.innerHTML = `
    <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px;">
      <div style="display:flex; flex-direction:column; gap:12px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Origen: ¿Dónde recogemos?</label>
        <button id="pickup-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('mapPin', 20)}</div>
           <span id="pickup-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Elegir dirección en el mapa...</span>
           ${icon('chevronRight', 16)}
        </button>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">Destino: ¿Dónde entregamos?</label>
        <button id="delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
           <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
           ${icon('chevronRight', 16)}
        </button>
      </div>

      <div>
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px; margin-bottom:12px; display:block;">Detalles del Mandado</label>
        <textarea id="favor-details" placeholder="Ej: Recoger llaves en el portero y traerlas. Contacto: Juan 123456..." style="width: 100%; height: 110px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 600; resize: none; outline:none; font-family:inherit;"></textarea>
      </div>
      
      <div id="cost-preview" style="background: var(--color-bg-secondary); padding: 16px; border-radius: 20px; display: none; flex-direction:column; gap:8px; border:1px solid var(--color-border-light); margin-top:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Envío (distancia)</span>
          <span id="dist-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12px;">Tarifa servicio</span>
          <span id="service-cost" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">$ 0</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:8px; border-top:1px dashed var(--color-border-light);">
          <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total Servicio</span>
          <span id="estimated-cost" style="font-size: 20px; font-weight: 950; color: var(--color-primary);">$ 0</span>
        </div>
        <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 8px; font-weight: 600; text-align: center;">
          * Este es el costo por el servicio de envío.
        </p>
      </div>
    </div>

    <button id="confirm-favor-btn" style="width: 100%; height: 60px; border-radius: 20px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 16px; cursor: pointer; box-shadow: 0 10px 25px rgba(var(--color-primary-rgb), 0.3); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px;">
      ${icon('check', 20)} Solicitar Favor
    </button>
  `;

  showModal({ title: 'Detalles del Mandado', content: modalEl, height: '80dvh', hideHeader: true });

  const pickupBtn = modalEl.querySelector('#pickup-addr-btn');
  const deliveryBtn = modalEl.querySelector('#delivery-addr-btn');
  const pickupText = modalEl.querySelector('#pickup-text');
  const deliveryText = modalEl.querySelector('#delivery-text');
  const detailsInput = modalEl.querySelector('#favor-details');
  const previewBox = modalEl.querySelector('#cost-preview');
  const distCostEl = modalEl.querySelector('#dist-cost');
  const serviceCostEl = modalEl.querySelector('#service-cost');
  const totalCostEl = modalEl.querySelector('#estimated-cost');

  let pickupData = null;
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedFee = 0;
  let appFee = 0;

  const updateCost = async () => {
    if (pickupData && deliveryData) {
      try {
        const dist = await getDistance(pickupData.coords.lat, pickupData.coords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedFee = calculateDynamicFee(dist);
        
        const appUsageFeeRate = getState().appUsageFeeRate || 0.05;
        appFee = Math.ceil((calculatedFee * appUsageFeeRate) / 10) * 10;
        const total = calculatedFee + appFee;

        distCostEl.textContent = formatPrice(calculatedFee);
        serviceCostEl.textContent = formatPrice(appFee);
        totalCostEl.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  pickupBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      pickupData = { address: addr, coords };
      pickupText.textContent = addr;
      pickupText.style.color = 'var(--color-text-primary)';
      updateCost();
    }, { mode: 'pick' });
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      updateCost();
    });
  };

  modalEl.querySelector('#confirm-favor-btn').onclick = async () => {
    if (!pickupData || !deliveryData || !detailsInput.value.trim()) {
      showToast('Completá todos los campos', 'warning');
      return;
    }

    if (calculatedFee === 0) {
      await updateCost();
    }

    const total = calculatedFee + appFee;

    showConfirm({
      title: '¿Confirmar favor?',
      message: `Se enviará un repartidor para realizar tu mandado.<br><br>Costo del servicio: <strong>${formatPrice(total)}</strong>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'mandado',
            pickupAddress: pickupData.address,
            pickupCoords: pickupData.coords,
            deliveryAddress: deliveryData.address,
            deliveryCoords: deliveryData.coords,
            details: detailsInput.value.trim(),
            deliveryCost: calculatedFee,
            appUsageFee: appFee,
            total: total
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Mandado favor:', e);
          showToast('Error al crear favor: ' + e.message, 'error');
        }
      }
    });
  };
}

async function showCompraForm() {
  const { geocodeAddress, getDistance, calculateDynamicFee } = await import('../utils/geo.js');
  const user = getState().user;
  const currentAddress = getState().deliveryAddress || '';
  const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
  const purchaseFee = settingsSnap.exists() ? (settingsSnap.data().favorPurchaseFee || 800) : 800;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 20px;';
  modalEl.innerHTML = `
    <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding-bottom:12px;">
      <div style="display:flex; flex-direction:column; gap:12px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Dónde comprar?</label>
        <button id="buy-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(239, 68, 68, 0.1); color:#ef4444; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('store', 20)}</div>
           <span id="buy-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Elegir comercio o dirección en el mapa...</span>
           ${icon('chevronRight', 16)}
        </button>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px;">¿Dónde entregamos?</label>
        <button id="delivery-addr-btn" style="width: 100%; height: 60px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 0 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 700; display:flex; align-items:center; gap:12px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s;">
           <div style="width:36px; height:36px; border-radius:12px; background:rgba(34, 197, 94, 0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('home', 20)}</div>
           <span id="delivery-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentAddress || 'Elegir destino...'}</span>
           ${icon('chevronRight', 16)}
        </button>
      </div>

      <div>
        <label style="font-size: 11px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.5px; margin-bottom:12px; display:block;">¿Qué debemos comprar?</label>
        <textarea id="buy-details" placeholder="Ej: 1kg de helado mixto en Grido. 1 pack de gaseosas en el chino de la esquina..." style="width: 100%; height: 110px; border-radius: 18px; border: 1.5px solid var(--color-border-light); padding: 16px; background: var(--color-bg-card); font-size: 14px; font-weight: 600; resize: none; outline:none; font-family:inherit;"></textarea>
      </div>
      
      <div id="compra-cost-preview" style="background: var(--color-bg-secondary); border-radius: 20px; padding: 16px; border: 1px solid var(--color-border-light); display:none; flex-direction:column; gap:8px; margin-top:auto;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-secondary); font-weight:600;">
           <span>Envío (distancia)</span>
           <span id="dist-fee">$ ---</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-secondary); font-weight:600;">
           <span>Gestión especial</span>
           <span>+ ${formatPrice(purchaseFee)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-secondary); font-weight:600;">
           <span>Servicio App</span>
           <span id="app-service-fee">$ ---</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 950; color: var(--color-primary); border-top: 1px dashed var(--color-border-light); padding-top: 8px; margin-top:2px;">
           <span>Total Servicio</span>
           <span id="final-service-fee">$ ---</span>
        </div>
        <p style="font-size: 10px; color: var(--color-text-tertiary); margin-top: 6px; line-height: 1.3; font-weight:700; text-align:center;">
           * El costo mostrado es solo por el envío y gestión.
        </p>
        <p style="font-size: 9px; color: var(--color-text-tertiary); margin-top: 4px; line-height: 1.3; opacity: 0.8; font-weight:500; text-align:center;">
           * El valor de los productos comprados se le abona directamente al repartidor al recibir el pedido.
        </p>
      </div>
    </div>

    <button id="confirm-buy-btn" style="width: 100%; height: 60px; border-radius: 20px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 16px; cursor: pointer; box-shadow: 0 10px 25px rgba(var(--color-primary-rgb), 0.3); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px;">
      ${icon('check', 20)} Solicitar Compra
    </button>
  `;

  showModal({ title: 'Detalles de Compra', content: modalEl, height: '80dvh', hideHeader: true });

  const buyBtn = modalEl.querySelector('#buy-addr-btn');
  const deliveryBtn = modalEl.querySelector('#delivery-addr-btn');
  const buyText = modalEl.querySelector('#buy-text');
  const deliveryText = modalEl.querySelector('#delivery-text');
  const detailsInput = modalEl.querySelector('#buy-details');
  const distFeeText = modalEl.querySelector('#dist-fee');
  const appFeeText = modalEl.querySelector('#app-service-fee');
  const totalFeeText = modalEl.querySelector('#final-service-fee');
  const previewBox = modalEl.querySelector('#compra-cost-preview');

  let buyData = null;
  let deliveryData = currentAddress ? { address: currentAddress, coords: getState().deliveryCoords } : null;
  let calculatedDistFee = 0;
  let appFee = 0;

  const updateCost = async () => {
    if (buyData && deliveryData) {
      try {
        const dist = await getDistance(buyData.coords.lat, buyData.coords.lng, deliveryData.coords.lat, deliveryData.coords.lng);
        calculatedDistFee = calculateDynamicFee(dist);
        
        const subtotal = calculatedDistFee + purchaseFee;
        const appUsageFeeRate = getState().appUsageFeeRate || 0.05;
        appFee = Math.ceil((subtotal * appUsageFeeRate) / 10) * 10;
        const total = subtotal + appFee;

        distFeeText.textContent = formatPrice(calculatedDistFee);
        appFeeText.textContent = formatPrice(appFee);
        totalFeeText.textContent = formatPrice(total);
        previewBox.style.display = 'flex';
      } catch (e) {}
    }
  };

  buyBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      buyData = { address: addr, coords };
      buyText.textContent = addr;
      buyText.style.color = 'var(--color-text-primary)';
      updateCost();
    }, { mode: 'pick' });
  };

  deliveryBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      deliveryData = { address: addr, coords };
      deliveryText.textContent = addr;
      updateCost();
    });
  };

  modalEl.querySelector('#confirm-buy-btn').onclick = async () => {
    if (!buyData || !deliveryData || !detailsInput.value.trim()) {
      showToast('Completá todos los campos', 'warning');
      return;
    }

    if (calculatedDistFee === 0) {
      await updateCost();
    }

    const subtotal = calculatedDistFee + purchaseFee;
    const total = subtotal + appFee;

    showConfirm({
      title: '¿Confirmar compra?',
      message: `Se enviará un repartidor para realizar tu compra.<br><br>Costo del servicio: <strong>${formatPrice(total)}</strong><br><br><small>* Recordá que a esto se le sumará el valor de los productos que compre el repartidor.</small>`,
      onConfirm: async () => {
        try {
          const orderId = await createFavorOrder({
            type: 'compra',
            pickupAddress: buyData.address,
            pickupCoords: buyData.coords,
            deliveryAddress: deliveryData.address,
            deliveryCoords: deliveryData.coords,
            details: detailsInput.value.trim(),
            deliveryCost: calculatedDistFee,
            purchaseFee: purchaseFee,
            appUsageFee: appFee,
            total: total
          });
          closeModal();
          setTimeout(() => {
            location.hash = `#/pedido/${orderId}`;
          }, 150);
        } catch (e) {
          console.error('Error creating Compra favor:', e);
          showToast('Error al crear favor: ' + e.message, 'error');
        }
      }
    });
  };
}

async function createFavorOrder(data) {
  const { auth } = await import('../firebase.js');
  const idToken = await auth.currentUser.getIdToken();
  
  const response = await fetch('https://us-central1-godelivery-magdalena.cloudfunctions.net/createFavorOrder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({
      type: data.type,
      pickupAddress: data.pickupAddress,
      pickupCoords: data.pickupCoords,
      deliveryAddress: data.deliveryAddress,
      deliveryCoords: data.deliveryCoords,
      details: data.details,
      deliveryCost: data.deliveryCost,
      purchaseFee: data.purchaseFee || 0,
      appUsageFee: data.appUsageFee || 0,
      total: data.total
    })
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error || 'Error al procesar el favor en el servidor');
  }

  const resData = await response.json();
  return resData.orderId;
}
