import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { getState } from '../state.js';
import { formatPrice } from '../utils/format.js';
import { showToast } from '../components/toast.js';
import { icon } from '../utils/icons.js';
import { showModal, closeModal, showConfirm } from '../components/modal.js';
import { isLoggedIn } from '../auth.js';
import { showAddressPrompt } from '../components/address-modal.js';

function showWarningModal(message) {
  const alertEl = document.createElement('div');
  alertEl.innerHTML = `
    <p style="padding: 32px 24px; text-align: center; color: var(--color-text-secondary); font-size: 15.5px; font-weight: 700; line-height: 1.6; margin: 0;">${message}</p>
    <div style="padding: 0 24px 24px;">
      <button id="alert-ok-btn" class="btn btn-primary" style="width: 100%; height: 54px; border-radius: 18px; font-weight: 900; font-size: 15px; background: var(--color-primary); color: white; border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(var(--color-primary-rgb), 0.2);">Entendido</button>
    </div>
  `;
  const alertModal = showModal({
    title: 'Datos Incompletos',
    content: alertEl,
    hideHeader: false,
    height: 'auto'
  });
  alertEl.querySelector('#alert-ok-btn').onclick = () => alertModal.close();
}

export async function renderViajes(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  const user = getState().user;
  if (!user || !isLoggedIn()) {
    content.innerHTML = `
      <div class="empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; text-align:center; height:80dvh;">
        <div style="width:72px; height:72px; background:rgba(var(--color-primary-rgb),0.1); color:var(--color-primary); border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
          ${icon('user', 36)}
        </div>
        <h3 style="font-family:var(--font-display); font-size:18px; font-weight:800; margin-bottom:8px;">Iniciá sesión</h3>
        <p style="color:var(--color-text-secondary); font-size:14px; margin-bottom:24px; max-width:280px;">Necesitás tener una cuenta activa para poder solicitar un viaje en la plataforma.</p>
        <button onclick="location.hash='#/profile'" class="btn btn-primary" style="padding:12px 30px; border-radius:14px; font-weight:800; font-size:14px; border:none; background:var(--color-primary); color:white; cursor:pointer;">Ir a mi Perfil</button>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="viajes-page page-enter" style="display:flex; flex-direction:column; height: 100dvh; background: var(--color-bg); overflow: hidden; position:relative;">
      
      <!-- Premium Red Header with smooth gradient -->
      <div style="background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); padding:calc(18px + env(safe-area-inset-top, 0px)) 20px 18px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 6px 20px rgba(225, 29, 72, 0.2); z-index:100;">
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        <button onclick="history.back()" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Solicitar Viaje</h1>
          <p style="font-size:10px; font-weight:850; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Elegí tu destino y viaja seguro</p>
        </div>
      </div>

      <!-- Main Scrollable Body -->
      <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        
        <!-- Address Selector Panel with connected route timeline -->
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:24px; padding:20px; display:flex; gap:16px; box-shadow:var(--shadow-sm); position:relative;">
          
          <!-- Connected visual timeline -->
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:18px 0; width:16px; flex-shrink:0; position:relative;">
            <div style="width:10px; height:10px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px rgba(34, 197, 94, 0.45); z-index:2;"></div>
            <div style="position:absolute; top:28px; bottom:28px; width:2px; border-left:2px dashed var(--color-border); z-index:1; opacity:0.6;"></div>
            <div style="width:10px; height:10px; border-radius:50%; background:var(--color-primary); box-shadow:0 0 8px rgba(225, 29, 72, 0.45); z-index:2;"></div>
          </div>

          <!-- Input Fields Group -->
          <div style="flex:1; display:flex; flex-direction:column; gap:20px; min-width:0;">
            <!-- Origin -->
            <div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
              <label style="font-size: 10px; font-weight: 850; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.05em;">Punto de partida</label>
              <button id="viaje-origin-btn" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-secondary); font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:10px; text-align:left; color:var(--color-text-primary); cursor:pointer; transition:all 0.2s; min-width:0;">
                 <span id="origin-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Seleccionar punto de partida...</span>
                 <span style="color:var(--color-text-tertiary); display:inline-flex;">${icon('chevronRight', 14)}</span>
              </button>
            </div>

            <!-- Destination -->
            <div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
              <label style="font-size: 10px; font-weight: 850; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.05em;">Destino</label>
              <button id="viaje-dest-btn" style="width: 100%; height: 50px; border-radius: 14px; border: 1.5px solid var(--color-border-light); padding: 0 14px; background: var(--color-bg-secondary); font-size: 13px; font-weight: 700; display:flex; align-items:center; gap:10px; text-align:left; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s; min-width:0;">
                 <span id="dest-text" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Ingresar dirección de destino...</span>
                 <span style="color:var(--color-text-tertiary); display:inline-flex;">${icon('chevronRight', 14)}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Vehicle Selection -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          <label style="font-size: 10px; font-weight: 850; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing:0.05em; padding-left:4px;">Tipo de Vehículo</label>
          
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
            <!-- Moto Option -->
            <div id="vehicle-moto" class="vehicle-card-pro active type-moto">
              <div class="vehicle-icon-box" style="background:rgba(120,120,120,0.06); color:var(--color-text-secondary);">
                ${icon('bike', 28)}
              </div>
              <span style="font-size:15px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.01em;">Viaje en Moto</span>
              <span style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">Rápido y económico</span>
              <div id="moto-price-preview" style="font-size:18px; font-weight:950; color:var(--color-primary); margin-top:14px; font-family:var(--font-display);">$ 0</div>
            </div>

            <!-- Auto Option -->
            <div id="vehicle-auto" class="vehicle-card-pro type-auto">
              <div class="vehicle-icon-box" style="background:rgba(120,120,120,0.06); color:var(--color-text-secondary);">
                ${icon('car', 28)}
              </div>
              <span style="font-size:15px; font-weight:900; color:var(--color-text-primary); letter-spacing:-0.01em;">Viaje en Auto</span>
              <span style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">Cómodo y seguro</span>
              <div id="auto-price-preview" style="font-size:18px; font-weight:950; color:#3b82f6; margin-top:14px; font-family:var(--font-display);">$ 0</div>
            </div>
          </div>
        </div>

        <!-- Cost & Distance Summary Box -->
        <div id="trip-cost-box" style="background: var(--color-surface); border:1px solid var(--color-border-light); border-radius: 24px; padding: 20px; display: none; flex-direction:column; gap:10px; box-shadow:var(--shadow-xs); animation: fadeIn 0.3s ease-out;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12.5px;">Distancia estimada</span>
            <span id="trip-distance-text" style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary);">0.0 km</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight: 600; color: var(--color-text-secondary); font-size: 12.5px;">Tarifa del servicio</span>
            <span id="trip-base-cost-text" style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary);">$ 0</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:10px; border-top:1px dashed var(--color-border-light);">
            <span style="font-weight: 900; color: var(--color-primary); font-size: 15px;">Total estimado</span>
            <span id="trip-total-cost-text" style="font-size: 20px; font-weight: 950; color: var(--color-primary); font-family:var(--font-display);">$ 0</span>
          </div>
          <p style="font-size: 9.5px; color: var(--color-text-tertiary); margin-top: 6px; font-weight: 700; text-align: center; line-height:1.45;">
            * El viaje se abona en efectivo o transferencia directamente al chofer al finalizar.
          </p>
        </div>

        <!-- Request Button with premium action styling -->
        <button id="request-trip-btn" style="width: 100%; height: 56px; border-radius: 18px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: white; border: none; font-weight: 900; font-size: 15.5px; cursor: pointer; box-shadow: 0 8px 24px rgba(var(--color-primary-rgb), 0.25); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top:auto; transition:all 0.2s;">
          ${icon('zap', 18)} Pedir Viaje
        </button>

      </div>
    </div>

    <!-- Premium Styles Block for vehicle cards & micro-animations -->
    <style>
      .vehicle-card-pro {
        background: var(--color-surface);
        border: 1.5px solid var(--color-border-light);
        border-radius: 24px;
        padding: 20px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: var(--shadow-sm);
        position: relative;
        overflow: hidden;
      }
      .vehicle-card-pro:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }
      .vehicle-card-pro:active {
        transform: scale(0.97);
      }
      
      /* Moto active state */
      .vehicle-card-pro.active.type-moto {
        border-color: var(--color-primary) !important;
        box-shadow: 0 8px 25px rgba(225, 29, 72, 0.12), 0 0 0 1px var(--color-primary) !important;
      }
      .vehicle-card-pro.active.type-moto .vehicle-icon-box {
        background: var(--color-primary-light) !important;
        color: var(--color-primary) !important;
        transform: scale(1.05);
      }

      /* Auto active state */
      .vehicle-card-pro.active.type-auto {
        border-color: #3b82f6 !important;
        box-shadow: 0 8px 25px rgba(59, 130, 246, 0.12), 0 0 0 1px #3b82f6 !important;
      }
      .vehicle-card-pro.active.type-auto .vehicle-icon-box {
        background: rgba(59, 130, 246, 0.12) !important;
        color: #3b82f6 !important;
        transform: scale(1.05);
      }

      .vehicle-icon-box {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 12px;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
    </style>
  `;


  // UI elements
  const originBtn = document.getElementById('viaje-origin-btn');
  const destBtn = document.getElementById('viaje-dest-btn');
  const originText = document.getElementById('origin-text');
  const destText = document.getElementById('dest-text');
  const motoCard = document.getElementById('vehicle-moto');
  const autoCard = document.getElementById('vehicle-auto');
  const requestBtn = document.getElementById('request-trip-btn');
  
  const tripBox = document.getElementById('trip-cost-box');
  const distText = document.getElementById('trip-distance-text');
  const baseCostText = document.getElementById('trip-base-cost-text');
  const totalCostText = document.getElementById('trip-total-cost-text');
  const motoPreview = document.getElementById('moto-price-preview');
  const autoPreview = document.getElementById('auto-price-preview');

  let originData = null;
  let destData = null;
  let selectedVehicle = 'moto'; // 'moto' or 'auto'
  let calculatedDistance = 0;

  // Calculate pricing based on logistics config
  const calculateTripCost = (distance, vehicleType) => {
    const basePrice = getState().tripBasePrice !== undefined ? getState().tripBasePrice : (getState().deliveryBasePrice || 1500);
    const pricePerKm = getState().tripPricePerKm !== undefined ? getState().tripPricePerKm : (getState().deliveryPricePerKm || 300);
    const minPrice = getState().tripMinPrice !== undefined ? getState().tripMinPrice : (getState().deliveryMinPrice || 1500);

    // Apply auto/car multiplier if selected
    const multiplier = vehicleType === 'auto' ? 1.6 : 1.0;

    const calculated = (basePrice + (distance * pricePerKm)) * multiplier;
    const final = Math.max(minPrice * multiplier, calculated);

    return Math.ceil(final / 10) * 10; // Round to nearest 10
  };

  const updateCostDisplay = async () => {
    if (originData && destData) {
      try {
        const { getDistance } = await import('../utils/geo.js');
        calculatedDistance = await getDistance(
          originData.coords.lat,
          originData.coords.lng,
          destData.coords.lat,
          destData.coords.lng
        );

        const motoCost = calculateTripCost(calculatedDistance, 'moto');
        const autoCost = calculateTripCost(calculatedDistance, 'auto');

        // Previews
        motoPreview.textContent = formatPrice(motoCost);
        autoPreview.textContent = formatPrice(autoCost);

        // Details
        const activeCost = selectedVehicle === 'moto' ? motoCost : autoCost;
        distText.textContent = `${calculatedDistance.toFixed(1)} km`;
        baseCostText.textContent = formatPrice(activeCost);
        totalCostText.textContent = formatPrice(activeCost);

        tripBox.style.display = 'flex';
      } catch (err) {
        console.error('Error calculating trip costs:', err);
        showToast('Error al calcular el trayecto', 'error');
      }
    }
  };

  // Click handlers for inputs
  originBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      originData = { address: addr, coords };
      originText.textContent = addr;
      originText.style.color = 'var(--color-text-primary)';
      updateCostDisplay();
    }, { mode: 'pick', skipDetails: true });
  };

  destBtn.onclick = () => {
    showAddressPrompt((addr, notes, coords) => {
      destData = { address: addr, coords };
      destText.textContent = addr;
      destText.style.color = 'var(--color-text-primary)';
      updateCostDisplay();
    }, { mode: 'deliver', skipDetails: true });
  };

  // Vehicle toggle
  motoCard.onclick = () => {
    selectedVehicle = 'moto';
    motoCard.classList.add('active');
    motoCard.style.borderColor = 'var(--color-primary)';
    motoCard.style.borderWidth = '2.5px';

    autoCard.classList.remove('active');
    autoCard.style.borderColor = 'var(--color-border)';
    autoCard.style.borderWidth = '1.5px';

    updateCostDisplay();
  };

  autoCard.onclick = () => {
    selectedVehicle = 'auto';
    autoCard.classList.add('active');
    autoCard.style.borderColor = '#3b82f6';
    autoCard.style.borderWidth = '2.5px';

    motoCard.classList.remove('active');
    motoCard.style.borderColor = 'var(--color-border)';
    motoCard.style.borderWidth = '1.5px';

    updateCostDisplay();
  };

  // ── Helper: Check if any driver is online for the selected vehicle type ──
  async function checkDriverAvailability(vehicleType) {
    try {
      const driversQ = query(
        collection(db, 'users'),
        where('tripStatus', '==', 'approved'),
        where('isOnline', '==', true),
        where('tripVehicleType', '==', vehicleType)
      );
      const snap = await getDocs(driversQ);
      return snap.size > 0;
    } catch (err) {
      console.warn('Error checking driver availability:', err);
      return true; // Allow trip if check fails
    }
  }

  // ── Helper: Show schedule trip modal ──
  function showScheduleModal(cost, vehicleType) {
    const now = new Date();
    const maxDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const formatDateInput = (d) => d.toISOString().split('T')[0];
    const minDate = formatDateInput(now);
    const maxDateStr = formatDateInput(maxDate);

    // Build hours for the time selector
    const hours = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const hh = String(h).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        hours.push(`${hh}:${mm}`);
      }
    }

    const modalContent = document.createElement('div');
    modalContent.innerHTML = `
      <div style="padding:24px 20px; display:flex; flex-direction:column; gap:20px;">
        <div style="text-align:center;">
          <div style="font-size:48px; margin-bottom:8px; animation: guideIconFloat 3s ease-in-out infinite;">📅</div>
          <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0 0 6px; color:var(--color-text-primary);">No hay choferes disponibles</h3>
          <p style="font-size:13px; color:var(--color-text-secondary); margin:0; line-height:1.5;">En este momento no hay choferes de <strong>${vehicleType === 'moto' ? 'moto 🏍️' : 'auto 🚗'}</strong> online. Podés programar tu viaje para los próximos 3 días.</p>
        </div>

        <div style="display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:10px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Fecha del viaje</label>
            <input type="date" id="schedule-date" min="${minDate}" max="${maxDateStr}" value="${minDate}"
              style="width:100%; height:50px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-bg-secondary); font-size:14px; font-weight:700; color:var(--color-text-primary); font-family:var(--font-body); box-sizing:border-box;" />
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:10px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Hora del viaje</label>
            <select id="schedule-time"
              style="width:100%; height:50px; border-radius:14px; border:1.5px solid var(--color-border-light); padding:0 14px; background:var(--color-bg-secondary); font-size:14px; font-weight:700; color:var(--color-text-primary); font-family:var(--font-body); appearance:none; -webkit-appearance:none; box-sizing:border-box;">
              ${hours.map(h => {
                const [hh] = h.split(':');
                const selected = parseInt(hh) === now.getHours() + 2 ? 'selected' : '';
                return `<option value="${h}" ${selected}>${h} hs</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <div style="background:rgba(var(--color-primary-rgb),0.06); border:1px solid rgba(var(--color-primary-rgb),0.12); border-radius:16px; padding:14px; display:flex; gap:10px; align-items:flex-start;">
          <span style="font-size:16px;">💡</span>
          <div style="font-size:11.5px; color:var(--color-text-secondary); line-height:1.5;">
            <strong style="color:var(--color-text-primary);">¿Cómo funciona?</strong><br>
            Un chofer disponible aceptará tu viaje programado. Recibirás una notificación cuando sea aceptado y otra como recordatorio antes de la hora del viaje.
          </div>
        </div>

        <div style="display:flex; gap:10px;">
          <button id="schedule-cancel-btn" style="flex:1; height:52px; border-radius:16px; background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); font-weight:800; font-size:14px; color:var(--color-text-secondary); cursor:pointer; transition:all 0.2s;">Cancelar</button>
          <button id="schedule-confirm-btn" style="flex:2; height:52px; border-radius:16px; background:linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); border:none; font-weight:900; font-size:14px; color:white; cursor:pointer; box-shadow:0 6px 20px rgba(var(--color-primary-rgb),0.25); display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">${icon('calendar', 18)} Programar Viaje</button>
        </div>
      </div>
    `;

    const modal = showModal({
      title: '',
      content: modalContent,
      hideHeader: true,
      height: 'auto'
    });

    modalContent.querySelector('#schedule-cancel-btn').onclick = () => modal.close();
    modalContent.querySelector('#schedule-confirm-btn').onclick = async () => {
      const dateVal = modalContent.querySelector('#schedule-date').value;
      const timeVal = modalContent.querySelector('#schedule-time').value;

      if (!dateVal || !timeVal) {
        showToast('Seleccioná una fecha y hora válidas.', 'warning');
        return;
      }

      const [year, month, day] = dateVal.split('-').map(Number);
      const [hour, minute] = timeVal.split(':').map(Number);
      const scheduledDate = new Date(year, month - 1, day, hour, minute, 0);

      if (scheduledDate <= new Date()) {
        showToast('La fecha/hora debe ser posterior al momento actual.', 'warning');
        return;
      }

      const diffMs = scheduledDate.getTime() - Date.now();
      if (diffMs > 3 * 24 * 60 * 60 * 1000) {
        showToast('Máximo 3 días de anticipación.', 'warning');
        return;
      }

      const confirmBtn = modalContent.querySelector('#schedule-confirm-btn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="spinner"></span> Programando...`;

      try {
        const tripOrder = {
          userId: user.uid,
          userName: user.displayName || user.name || 'Cliente',
          userPhone: user.phone || '',
          driverId: null,
          driverName: null,
          pickupAddress: originData.address,
          pickupCoords: originData.coords,
          deliveryAddress: destData.address,
          deliveryCoords: destData.coords,
          deliveryCost: cost,
          appUsageFee: Math.ceil((cost * (getState().appUsageFeeRate || 0.05)) / 10) * 10,
          total: cost,
          status: 'scheduled',
          isTrip: true,
          tripType: vehicleType,
          scheduledFor: Timestamp.fromDate(scheduledDate),
          createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, 'orders'), tripOrder);

        // Save last address
        try {
          const { doc, updateDoc } = await import('firebase/firestore');
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, {
            lastAddress: {
              address: destData.address,
              notes: '',
              coords: destData.coords || null
            }
          });
        } catch (e) {
          console.error('Error saving lastAddress:', e);
        }

        modal.close();
        showToast('¡Viaje programado con éxito! Te notificaremos cuando un chofer lo acepte.', 'success');

        setTimeout(() => {
          location.hash = `#/pedido/${docRef.id}`;
        }, 150);

      } catch (err) {
        console.error('Error scheduling trip:', err);
        showToast('Error al programar el viaje: ' + err.message, 'error');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${icon('calendar', 18)} Programar Viaje`;
      }
    };
  }

  // Submit Trip
  requestBtn.onclick = async () => {
    if (!originData) {
      showWarningModal('Por favor, selecciona la dirección de origen (¿Dónde te buscamos?)');
      return;
    }
    if (!destData) {
      showWarningModal('Por favor, selecciona la dirección de destino (¿A dónde vas?)');
      return;
    }

    if (!user.phone || user.phone.trim() === '') {
      showConfirm({
        title: '📱 Teléfono Requerido',
        message: 'Para solicitar un viaje es obligatorio configurar un celular de contacto para que el chofer se comunique.',
        confirmText: 'Configurar ahora',
        cancelText: 'Volver',
        onConfirm: () => {
          sessionStorage.setItem('open-phone-edit', 'true');
          location.hash = '#/profile';
        }
      });
      return;
    }

    const cost = calculateTripCost(calculatedDistance, selectedVehicle);

    // Check if there are online drivers for the selected vehicle type
    requestBtn.disabled = true;
    requestBtn.innerHTML = `${icon('loader', 20, 'animate-spin')} Verificando choferes...`;

    const hasDrivers = await checkDriverAvailability(selectedVehicle);

    if (!hasDrivers) {
      // No drivers available — show schedule modal
      requestBtn.disabled = false;
      requestBtn.innerHTML = `${icon('zap', 18)} Pedir Viaje`;
      showScheduleModal(cost, selectedVehicle);
      return;
    }

    requestBtn.disabled = false;
    requestBtn.innerHTML = `${icon('zap', 18)} Pedir Viaje`;

    showConfirm({
      title: '🚕 ¿Confirmar viaje?',
      message: `Se enviará una solicitud a todos los choferes de la zona.<br><br>Vehículo: <strong>${selectedVehicle === 'moto' ? 'Moto 🏍️' : 'Auto 🚗'}</strong><br>Costo estimado: <strong>${formatPrice(cost)}</strong>`,
      onConfirm: async () => {
        try {
          requestBtn.disabled = true;
          requestBtn.innerHTML = `${icon('loader', 20, 'animate-spin')} Enviando solicitud...`;

          const tripOrder = {
            userId: user.uid,
            userName: user.displayName || user.name || 'Cliente',
            userPhone: user.phone || '',
            driverId: null,
            driverName: null,
            pickupAddress: originData.address,
            pickupCoords: originData.coords,
            deliveryAddress: destData.address,
            deliveryCoords: destData.coords,
            deliveryCost: cost,
            appUsageFee: Math.ceil((cost * (getState().appUsageFeeRate || 0.05)) / 10) * 10,
            total: cost,
            status: 'ready',
            isTrip: true,
            tripType: selectedVehicle,
            createdAt: serverTimestamp()
          };

          const docRef = await addDoc(collection(db, 'orders'), tripOrder);
          
          // Save last address to Firestore
          try {
            const { doc, updateDoc } = await import('firebase/firestore');
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
              lastAddress: {
                address: destData.address,
                notes: '',
                coords: destData.coords || null
              }
            });
          } catch (err) {
            console.error('Error saving lastAddress to user profile in viajes:', err);
          }

          showToast('¡Viaje solicitado con éxito!', 'success');
          closeModal();
          
          setTimeout(() => {
            location.hash = `#/pedido/${docRef.id}`;
          }, 150);

        } catch (err) {
          console.error('Error creating trip order:', err);
          showToast('Error al crear el viaje: ' + err.message, 'error');
          requestBtn.disabled = false;
          requestBtn.innerHTML = `${icon('zap', 20)} Pedir Viaje`;
        }
      }
    });
  };
}
