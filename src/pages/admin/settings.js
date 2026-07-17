import { db } from '../../firebase.js';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { isAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { getState, setState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal, closeModal } from '../../components/modal.js';
import { compressImage } from '../../utils/image-compressor.js';

// MAIN SETTINGS DASHBOARD
export async function renderAdminSettings() {
  const content = document.getElementById('app-content');
  if (!content) return;

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;position:relative;z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Configuración</h1>
          <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Ajustes del sistema</p>
        </div>
      </div>

      <!-- Menu Links List -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch;">
        
        <!-- 1. Logistics -->
        <a href="#/admin/settings/logistics" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#dbeafe,#bfdbfe); color:#2563eb; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('bike', 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Tarifas de Logística</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Precios de envío, costo por km, viajes y precios fijos</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
        </a>

        <!-- 2. Economy -->
        <a href="#/admin/settings/economy" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#d1fae5,#a7f3d0); color:#059669; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('bank', 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Economía de la App</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Comisiones del sistema y costos de la plataforma</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
        </a>

        <!-- 3. Dynamic Pricing -->
        <a href="#/admin/settings/dynamic" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#e0e7ff,#c7d2fe); color:#4f46e5; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('clock', 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Tarifas Dinámicas (Horarios)</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Recargos nocturnos e incentivos de reparto</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
        </a>

        <!-- 4. GoPoints -->
        <a href="#/admin/settings/gopoints" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#fef3c7,#fde68a); color:#d97706; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('sparkles', 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Programa GoPoints</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Recompensas, niveles, referidos y desafíos semanales</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
        </a>

        <!-- 5. Push Texts -->
        <a href="#/admin/settings/push" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#e0e7ff,#c7d2fe); color:#4f46e5; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('bell', 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Notificaciones Push</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Personalizar notificaciones del sistema</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
        </a>

        <!-- 6. Maintenance -->
        <a href="#/admin/settings/maintenance" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#fee2e2,#fee2e2); color:#ef4444; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('alertTriangle', 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Mantenimiento y Sistema</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Bloqueo global, optimización de imágenes y reseteo</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
        </a>

      </div>
    </div>
  `;
}

// 1. DEDICATED LOGISTICS SETTINGS
export async function renderAdminLogisticsSettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const renderContent = () => {
    const rules = getState().deliveryDistanceRules || [];
    const sortedRules = [...rules].sort((a, b) => a.limitKm - b.limitKm);

    container.innerHTML = `
      <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(126, 34, 206, 0.25); z-index:100;">
          <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
            ${icon('chevronLeft', 24)}
          </a>
          <div style="flex:1;">
            <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Tarifas de Logística</h1>
            <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Gestión de tarifas y reglas fijas</p>
          </div>
        </div>

        <!-- Main Body -->
        <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch;">
          <p style="font-size:13px; color:var(--color-text-secondary); margin:0; font-weight:600; line-height:1.5;">
            Configura los precios del sistema para el delivery general, el costo de favores y recados, las tarifas de viajes en vehículos y las reglas de precios fijos por kilómetro.
          </p>

          <div style="display:flex; flex-direction:column; gap:16px; margin-top:8px;">
            <!-- Delivery General -->
            <button id="btn-show-delivery-general" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(168, 85, 247, 0.1); color:#a855f7; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('bike', 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">DELIVERY GENERAL</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Costo base, costo por km, recargo lluvia y paradas</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>

            <!-- Go Favores -->
            <button id="btn-show-go-favores" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(59, 130, 246, 0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('tag', 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">GO FAVORES</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Gestión de favores y base para pago de servicios</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>

            <!-- Viajes -->
            <button id="btn-show-viajes" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(16, 185, 129, 0.1); color:#10b981; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('mapPin', 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">VIAJES (MOTO / AUTO)</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Costo base, mínimo y extra por kilómetro</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>

            <!-- Precio Fijo por KM -->
            <button id="btn-show-precio-fijo" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(245, 158, 11, 0.1); color:#f59e0b; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('trendingUp', 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">PRECIO FIJO POR KM</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Reglas dinámicas de precio fijo según rango de km</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-show-delivery-general').onclick = openDeliveryGeneralModal;
    document.getElementById('btn-show-go-favores').onclick = openGoFavoresModal;
    document.getElementById('btn-show-viajes').onclick = openViajesModal;
    document.getElementById('btn-show-precio-fijo').onclick = openPrecioFijoModal;
  };

  const openDeliveryGeneralModal = () => {
    const s = getState();
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg);';
    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Delivery General</h3>
      <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo Base ($)</label>
          <input type="number" id="logistics-delivery-base" value="${s.deliveryBasePrice || 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo Mínimo ($)</label>
          <input type="number" id="logistics-delivery-min" value="${s.deliveryMinPrice || 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Extra por Kilómetro ($)</label>
          <input type="number" id="logistics-delivery-km" value="${s.deliveryPricePerKm || 300}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Parada Extra ($)</label>
          <input type="number" id="logistics-delivery-extra-stop" value="${s.deliveryExtraStopFee || 500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Recargo por Lluvia ($)</label>
          <input type="number" id="logistics-delivery-rain-surcharge" value="${s.deliveryRainSurcharge || 300}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Modo del Recargo</label>
          <select id="logistics-rain-mode" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);">
            <option value="auto" ${s.rainMode === 'auto' ? 'selected' : ''}>Automático (API)</option>
            <option value="on" ${s.rainMode === 'on' ? 'selected' : ''}>Siempre Activo</option>
            <option value="off" ${s.rainMode === 'off' ? 'selected' : ''}>Siempre Desactivado</option>
          </select>
        </div>
      </div>
      <button id="btn-save-delivery-general" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Ajustes
      </button>
    `;

    showModal({
      title: '',
      content: modalContent,
      height: 'auto',
      hideHeader: true,
      onOpen: () => {
        modalContent.querySelector('#btn-save-delivery-general').onclick = async () => {
          const btn = modalContent.querySelector('#btn-save-delivery-general');
          btn.disabled = true;
          btn.textContent = 'Guardando...';
          
          const deliveryBasePrice = parseFloat(modalContent.querySelector('#logistics-delivery-base').value) || 0;
          const deliveryMinPrice = parseFloat(modalContent.querySelector('#logistics-delivery-min').value) || 0;
          const deliveryPricePerKm = parseFloat(modalContent.querySelector('#logistics-delivery-km').value) || 0;
          const deliveryExtraStopFee = parseFloat(modalContent.querySelector('#logistics-delivery-extra-stop').value) || 0;
          const deliveryRainSurcharge = parseFloat(modalContent.querySelector('#logistics-delivery-rain-surcharge').value) || 0;
          const rainMode = modalContent.querySelector('#logistics-rain-mode').value;

          try {
            await setDoc(doc(db, 'settings', 'global'), {
              deliveryBasePrice, deliveryMinPrice, deliveryPricePerKm, deliveryExtraStopFee, deliveryRainSurcharge, rainMode
            }, { merge: true });
            
            setState('deliveryBasePrice', deliveryBasePrice);
            setState('deliveryMinPrice', deliveryMinPrice);
            setState('deliveryPricePerKm', deliveryPricePerKm);
            setState('deliveryExtraStopFee', deliveryExtraStopFee);
            setState('deliveryRainSurcharge', deliveryRainSurcharge);
            setState('rainMode', rainMode);

            showToast('Ajustes de Delivery General guardados.', 'success');
            closeModal();
          } catch (err) {
            console.error(err);
            showToast('Error al guardar ajustes.', 'error');
            btn.disabled = false;
            btn.textContent = 'Guardar Ajustes';
          }
        };
      }
    });
  };

  const openGoFavoresModal = () => {
    const s = getState();
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg);';
    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Go Favores</h3>
      <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Gestión GoFavor ($)</label>
          <input type="number" id="logistics-favor-fee" value="${s.favorPurchaseFee || 800}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Base Pago de Servicios ($)</label>
          <input type="number" id="logistics-service-fee" value="${s.servicePaymentErrandFee || 2000}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
      </div>
      <button id="btn-save-go-favores" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Ajustes
      </button>
    `;

    showModal({
      title: '',
      content: modalContent,
      height: 'auto',
      hideHeader: true,
      onOpen: () => {
        modalContent.querySelector('#btn-save-go-favores').onclick = async () => {
          const btn = modalContent.querySelector('#btn-save-go-favores');
          btn.disabled = true;
          btn.textContent = 'Guardando...';

          const favorPurchaseFee = parseFloat(modalContent.querySelector('#logistics-favor-fee').value) || 0;
          const servicePaymentErrandFee = parseFloat(modalContent.querySelector('#logistics-service-fee').value) || 0;

          try {
            await setDoc(doc(db, 'settings', 'global'), { favorPurchaseFee, servicePaymentErrandFee }, { merge: true });
            setState('favorPurchaseFee', favorPurchaseFee);
            setState('servicePaymentErrandFee', servicePaymentErrandFee);
            showToast('Ajustes de Go Favores guardados.', 'success');
            closeModal();
          } catch (err) {
            console.error(err);
            showToast('Error al guardar ajustes.', 'error');
            btn.disabled = false;
            btn.textContent = 'Guardar Ajustes';
          }
        };
      }
    });
  };

  const openViajesModal = () => {
    const s = getState();
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg);';
    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Viajes (Moto / Auto)</h3>
      <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo Base ($)</label>
          <input type="number" id="logistics-trip-base" value="${s.tripBasePrice !== undefined ? s.tripBasePrice : 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo Mínimo ($)</label>
          <input type="number" id="logistics-trip-min" value="${s.tripMinPrice !== undefined ? s.tripMinPrice : 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Extra por Kilómetro ($)</label>
          <input type="number" id="logistics-trip-km" value="${s.tripPricePerKm !== undefined ? s.tripPricePerKm : 300}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
      </div>
      <button id="btn-save-viajes" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Ajustes
      </button>
    `;

    showModal({
      title: '',
      content: modalContent,
      height: 'auto',
      hideHeader: true,
      onOpen: () => {
        modalContent.querySelector('#btn-save-viajes').onclick = async () => {
          const btn = modalContent.querySelector('#btn-save-viajes');
          btn.disabled = true;
          btn.textContent = 'Guardando...';

          const tripBasePrice = parseFloat(modalContent.querySelector('#logistics-trip-base').value) || 0;
          const tripMinPrice = parseFloat(modalContent.querySelector('#logistics-trip-min').value) || 0;
          const tripPricePerKm = parseFloat(modalContent.querySelector('#logistics-trip-km').value) || 0;

          try {
            await setDoc(doc(db, 'settings', 'global'), { tripBasePrice, tripMinPrice, tripPricePerKm }, { merge: true });
            setState('tripBasePrice', tripBasePrice);
            setState('tripMinPrice', tripMinPrice);
            setState('tripPricePerKm', tripPricePerKm);
            showToast('Ajustes de Viajes guardados.', 'success');
            closeModal();
          } catch (err) {
            console.error(err);
            showToast('Error al guardar ajustes.', 'error');
            btn.disabled = false;
            btn.textContent = 'Guardar Ajustes';
          }
        };
      }
    });
  };

  const openPrecioFijoModal = () => {
    let localRules = [...(getState().deliveryDistanceRules || [])];
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg); max-height:85vh; overflow-y:auto;';

    const renderRulesList = () => {
      const containerEl = modalContent.querySelector('#rules-list-container');
      if (!containerEl) return;

      if (localRules.length === 0) {
        containerEl.innerHTML = `
          <div style="text-align:center; padding:24px; color:var(--color-text-tertiary); font-size:12px; font-weight:600; border:1.5px dashed var(--color-border); border-radius:18px;">
            No hay reglas configuradas. Se usará el cálculo dinámico.
          </div>
        `;
        return;
      }

      containerEl.innerHTML = localRules.map((rule, index) => `
        <div class="rule-row" data-index="${index}" style="display:flex; flex-direction:column; gap:10px; background:var(--color-bg-card); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm); margin-bottom:12px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Regla de Envío</div>
            <button class="rule-delete-btn" style="width:28px; height:28px; border-radius:8px; background:rgba(239, 68, 68, 0.08); border:none; display:flex; align-items:center; justify-content:center; color:var(--color-danger); cursor:pointer;">
              ${icon('trash', 12)}
            </button>
          </div>
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Nombre de la Regla</div>
            <input type="text" class="rule-name-input" value="${rule.name || ''}" placeholder="Ej. Tarifa Atalaya" style="width:100%; height:38px; border-radius:10px; border:1px solid var(--color-border); padding:0 8px; font-size:13px; font-weight:700; background:var(--color-bg); color:var(--color-text); box-sizing:border-box;" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Distancia Mínima</div>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" step="0.1" class="rule-limit-input" value="${rule.limitKm}" style="width:100%; height:38px; border-radius:10px; border:1px solid var(--color-border); padding:0 8px; font-size:14px; font-weight:700; background:var(--color-bg); color:var(--color-text); box-sizing:border-box;" />
                <span style="font-size:12px; font-weight:700; color:var(--color-text-secondary);">Km</span>
              </div>
            </div>
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Precio Fijo</div>
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="font-size:12px; font-weight:700; color:var(--color-text-secondary);">$</span>
                <input type="number" class="rule-price-input" value="${rule.price}" style="width:100%; height:38px; border-radius:10px; border:1px solid var(--color-border); padding:0 8px; font-size:14px; font-weight:700; background:var(--color-bg); color:var(--color-text); box-sizing:border-box;" />
              </div>
            </div>
          </div>
        </div>
      `).join('');

      containerEl.querySelectorAll('.rule-delete-btn').forEach((btn, i) => {
        btn.onclick = () => {
          localRules.splice(i, 1);
          renderRulesList();
        };
      });

      containerEl.querySelectorAll('.rule-row').forEach(row => {
        const i = parseInt(row.dataset.index);
        const nameInput = row.querySelector('.rule-name-input');
        const limitInput = row.querySelector('.rule-limit-input');
        const priceInput = row.querySelector('.rule-price-input');
        
        nameInput.oninput = () => {
          localRules[i].name = nameInput.value;
        };
        limitInput.oninput = () => {
          localRules[i].limitKm = parseFloat(limitInput.value) || 0;
        };
        priceInput.oninput = () => {
          localRules[i].price = parseFloat(priceInput.value) || 0;
        };
      });
    };

    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Precio Fijo por KM</h3>
      <p style="font-size:12px; color:var(--color-text-secondary); margin:4px 0 10px 0; font-weight:600; line-height:1.4;">
        Define tarifas planas para rangos de distancia. Escribe un nombre identificador para cada regla.
      </p>

      <div id="rules-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
        <!-- Rules injected here -->
      </div>

      <button id="btn-add-rule" class="btn btn-ghost" style="margin-top:8px; height:46px; border-radius:12px; border:1.5px dashed var(--color-border); font-weight:800; font-size:13px; color:var(--color-primary); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; width:100%; background:none;">
        ${icon('plus', 14)} AGREGAR REGLA DE DISTANCIA
      </button>

      <button id="btn-save-precio-fijo" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Configuración
      </button>
    `;

    showModal({
      title: '',
      content: modalContent,
      height: 'auto',
      hideHeader: true,
      onOpen: () => {
        renderRulesList();

        modalContent.querySelector('#btn-add-rule').onclick = () => {
          localRules.push({ name: '', limitKm: 0, price: 0 });
          renderRulesList();
        };

        modalContent.querySelector('#btn-save-precio-fijo').onclick = async () => {
          const btn = modalContent.querySelector('#btn-save-precio-fijo');
          btn.disabled = true;
          btn.textContent = 'Guardando...';

          const cleanRules = localRules
            .filter(r => r.limitKm > 0 && r.price > 0)
            .map(r => ({
              name: (r.name || '').trim(),
              limitKm: Number(r.limitKm),
              price: Number(r.price)
            }));

          try {
            await setDoc(doc(db, 'settings', 'global'), { deliveryDistanceRules: cleanRules }, { merge: true });
            setState('deliveryDistanceRules', cleanRules);
            showToast('Reglas de Precio Fijo guardadas.', 'success');
            closeModal();
            renderContent();
          } catch (err) {
            console.error(err);
            showToast('Error al guardar configuración.', 'error');
            btn.disabled = false;
            btn.textContent = 'Guardar Configuración';
          }
        };
      }
    });
  };

  renderContent();
}

// 2. ECONOMY SETTINGS PAGE
export async function renderAdminEconomySettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(16, 185, 129, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Economía de la App</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Configuración económica general</p>
        </div>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div>
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Comisión del Comercio (%)</label>
            <input type="number" class="input" id="global-commission-rate" value="${(s.commissionRate * 100).toFixed(0)}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
          </div>
          <div>
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Costo de Uso de App (%)</label>
            <input type="number" class="input" id="global-app-fee-rate" value="${(s.appUsageFeeRate * 100).toFixed(0)}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
          </div>

          <div style="border-top:1px dashed var(--color-border-light); padding-top:18px; margin-top:8px;">
            <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Tarifas del Servicio (Porcentaje/Fijo)</h4>
            <div style="display:flex; flex-direction:column; gap:12px; background:var(--color-bg-secondary); border-radius:18px; padding:16px; border:1px solid var(--color-border-light);">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; font-size:11px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase;">Favor</div>
                <select id="fee-config-gofavor-type" class="input" style="height:34px; border-radius:8px; padding:0 6px; font-size:12px; font-weight:700; flex:1; background:var(--color-surface); border:1px solid var(--color-border-light);">
                  <option value="fixed" ${s.servicesAppFeeConfig?.gofavor?.type === 'fixed' ? 'selected' : ''}>Fijo ($)</option>
                  <option value="percentage" ${s.servicesAppFeeConfig?.gofavor?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                </select>
                <input type="number" id="fee-config-gofavor-value" value="${s.servicesAppFeeConfig?.gofavor?.value || 0}" style="width:70px; height:34px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700; border:1px solid var(--color-border-light); background:var(--color-surface);" />
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; font-size:11px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase;">Cash</div>
                <select id="fee-config-gocash-type" class="input" style="height:34px; border-radius:8px; padding:0 6px; font-size:12px; font-weight:700; flex:1; background:var(--color-surface); border:1px solid var(--color-border-light);">
                  <option value="fixed" ${s.servicesAppFeeConfig?.gocash?.type === 'fixed' ? 'selected' : ''}>Fijo ($)</option>
                  <option value="percentage" ${s.servicesAppFeeConfig?.gocash?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                </select>
                <input type="number" id="fee-config-gocash-value" value="${s.servicesAppFeeConfig?.gocash?.value || 0}" style="width:70px; height:34px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700; border:1px solid var(--color-border-light); background:var(--color-surface);" />
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; font-size:11px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase;">Viaje</div>
                <select id="fee-config-goviaje-type" class="input" style="height:34px; border-radius:8px; padding:0 6px; font-size:12px; font-weight:700; flex:1; background:var(--color-surface); border:1px solid var(--color-border-light);">
                  <option value="fixed" ${s.servicesAppFeeConfig?.goviaje?.type === 'fixed' ? 'selected' : ''}>Fijo ($)</option>
                  <option value="percentage" ${s.servicesAppFeeConfig?.goviaje?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                </select>
                <input type="number" id="fee-config-goviaje-value" value="${s.servicesAppFeeConfig?.goviaje?.value || 0}" style="width:70px; height:34px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700; border:1px solid var(--color-border-light); background:var(--color-surface);" />
              </div>
            </div>
          </div>

          <div style="border-top:1px dashed var(--color-border-light); padding-top:18px; margin-top:8px;">
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">WhatsApp de Pagos y Soporte</label>
            <input type="text" class="input" id="global-whatsapp-payments" value="${s.whatsappPayments || '5491123456789'}" placeholder="Ej: 549221555555" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
          </div>

          <button id="save-economy-btn" style="margin-top:20px; height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${icon('check', 20)} Guardar Ajustes
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('save-economy-btn').onclick = async () => {
    const btn = document.getElementById('save-economy-btn');
    btn.disabled = true;
    btn.innerHTML = 'Guardando...';

    const commissionRate = (parseFloat(document.getElementById('global-commission-rate').value) || 10) / 100;
    const appUsageFeeRate = (parseFloat(document.getElementById('global-app-fee-rate').value) || 5) / 100;
    const whatsappPayments = document.getElementById('global-whatsapp-payments').value.trim();

    const servicesAppFeeConfig = {
      gofavor: {
        type: document.getElementById('fee-config-gofavor-type').value,
        value: parseFloat(document.getElementById('fee-config-gofavor-value').value) || 0
      },
      gocash: {
        type: document.getElementById('fee-config-gocash-type').value,
        value: parseFloat(document.getElementById('fee-config-gocash-value').value) || 0
      },
      goviaje: {
        type: document.getElementById('fee-config-goviaje-type').value,
        value: parseFloat(document.getElementById('fee-config-goviaje-value').value) || 0
      }
    };

    try {
      await setDoc(doc(db, 'settings', 'global'), {
        commissionRate, appUsageFeeRate, whatsappPayments, servicesAppFeeConfig
      }, { merge: true });

      setState('commissionRate', commissionRate);
      setState('appUsageFeeRate', appUsageFeeRate);
      setState('whatsappPayments', whatsappPayments);
      setState('servicesAppFeeConfig', servicesAppFeeConfig);

      showToast('Ajustes de Economía actualizados.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar ajustes.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check', 20)} Guardar Ajustes`;
    }
  };
}

// 3. DYNAMIC PRICING SCHEDULES PAGE
export async function renderAdminDynamicSettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(79, 70, 229, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Tarifas Dinámicas</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Recargos nocturnos e incentivos</p>
        </div>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:24px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <style>
          .settings-switch { position: relative; display: inline-block; width: 44px; height: 24px; margin: 0; flex-shrink: 0; }
          .settings-switch input { opacity: 0; width: 0; height: 0; }
          .settings-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .3s; border-radius: 24px; }
          .settings-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.15); }
          .settings-switch input:checked + .settings-slider { background-color: var(--color-primary); }
          .settings-switch input:checked + .settings-slider:before { transform: translateX(20px); }
        </style>

        <!-- Night Surcharge Config -->
        <div>
          <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:14px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Recargo Nocturno (Lo paga el cliente)</h4>
          <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:16px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:13.5px; font-weight:800; color:var(--color-text);">Activar Recargo Nocturno</span>
              <label class="settings-switch">
                <input type="checkbox" id="global-night-surcharge-enabled" ${s.nightSurchargeConfig?.enabled ? 'checked' : ''}>
                <span class="settings-slider"></span>
              </label>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Inicio</label>
                <input type="time" class="input" id="global-night-surcharge-start" value="${s.nightSurchargeConfig?.start || '00:00'}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Fin</label>
                <input type="time" class="input" id="global-night-surcharge-end" value="${s.nightSurchargeConfig?.end || '06:00'}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Tipo de Recargo</label>
                <select class="input" id="global-night-surcharge-type" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; background:var(--color-bg); border:1px solid var(--color-border);">
                  <option value="fixed" ${s.nightSurchargeConfig?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                  <option value="percentage" ${s.nightSurchargeConfig?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                </select>
              </div>
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Valor</label>
                <input type="number" class="input" id="global-night-surcharge-value" value="${s.nightSurchargeConfig?.value || 0}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
            </div>
          </div>
        </div>

        <!-- Driver Incentive Config -->
        <div>
          <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:14px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Incentivo Repartidor (Lo absorbe GoDelivery)</h4>
          <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:16px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:13.5px; font-weight:800; color:var(--color-text);">Activar Incentivo</span>
              <label class="settings-switch">
                <input type="checkbox" id="global-driver-incentive-enabled" ${s.driverIncentiveConfig?.enabled ? 'checked' : ''}>
                <span class="settings-slider"></span>
              </label>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Inicio</label>
                <input type="time" class="input" id="global-driver-incentive-start" value="${s.driverIncentiveConfig?.start || '20:00'}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Fin</label>
                <input type="time" class="input" id="global-driver-incentive-end" value="${s.driverIncentiveConfig?.end || '23:59'}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Tipo de Incentivo</label>
                <select class="input" id="global-driver-incentive-type" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; background:var(--color-bg); border:1px solid var(--color-border);">
                  <option value="fixed" ${s.driverIncentiveConfig?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                  <option value="percentage" ${s.driverIncentiveConfig?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                </select>
              </div>
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Valor Extra</label>
                <input type="number" class="input" id="global-driver-incentive-value" value="${s.driverIncentiveConfig?.value || 0}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
            </div>
          </div>
        </div>

        <button id="save-dynamic-btn" style="height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
          ${icon('check', 20)} Guardar Configuración
        </button>
      </div>
    </div>
  `;

  document.getElementById('save-dynamic-btn').onclick = async () => {
    const btn = document.getElementById('save-dynamic-btn');
    btn.disabled = true;
    btn.innerHTML = 'Guardando...';

    const nightSurchargeConfig = {
      enabled: document.getElementById('global-night-surcharge-enabled').checked,
      start: document.getElementById('global-night-surcharge-start').value,
      end: document.getElementById('global-night-surcharge-end').value,
      type: document.getElementById('global-night-surcharge-type').value,
      value: parseFloat(document.getElementById('global-night-surcharge-value').value) || 0
    };

    const driverIncentiveConfig = {
      enabled: document.getElementById('global-driver-incentive-enabled').checked,
      start: document.getElementById('global-driver-incentive-start').value,
      end: document.getElementById('global-driver-incentive-end').value,
      type: document.getElementById('global-driver-incentive-type').value,
      value: parseFloat(document.getElementById('global-driver-incentive-value').value) || 0
    };

    try {
      await setDoc(doc(db, 'settings', 'global'), {
        nightSurchargeConfig, driverIncentiveConfig
      }, { merge: true });

      setState('nightSurchargeConfig', nightSurchargeConfig);
      setState('driverIncentiveConfig', driverIncentiveConfig);
      showToast('Ajustes de tarifas dinámicas guardados.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar ajustes.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check', 20)} Guardar Configuración`;
    }
  };
}

// 4. GOPOINTS SETTINGS PAGE
export async function renderAdminGoPointsSettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const renderContent = () => {
    const s = getState();
    container.innerHTML = `
      <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(245, 158, 11, 0.25); z-index:100;">
          <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
            ${icon('chevronLeft', 24)}
          </a>
          <div style="flex:1;">
            <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Programa GoPoints</h1>
            <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Fidelización y Desafíos</p>
          </div>
        </div>

        <!-- Main Body -->
        <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:24px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
          <!-- Reembolso y Valor del Punto -->
          <div>
            <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Conversión de Puntos</h4>
            <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:14px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                <div>
                  <label style="font-weight:700; font-size:10px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Reembolso (%)</label>
                  <input type="number" step="0.1" class="input" id="global-points-rate" value="${(s.pointsPerDollar * 100).toFixed(1)}" style="width:100%; height:44px; border-radius:12px; padding:0 12px; font-weight:700; font-size:15px;" />
                </div>
                <div>
                  <label style="font-weight:700; font-size:10px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Valor del Punto ($)</label>
                  <input type="number" step="0.1" class="input" id="global-point-value" value="${s.dollarPerPoint || 1}" style="width:100%; height:44px; border-radius:12px; padding:0 12px; font-weight:700; font-size:15px;" />
                </div>
              </div>
              <div style="background:var(--color-bg-secondary); border-radius:12px; padding:12px; border:1px solid var(--color-border-light); font-size:12px; color:var(--color-text-secondary); line-height:1.4;">
                En un pedido de <strong>$10.000</strong>, el cliente ganará <strong id="ref-points-earned" style="color:var(--color-primary);">---</strong> puntos, canjeables por <strong id="ref-discount-value" style="color:var(--color-success); font-weight:800;">---</strong>.
              </div>
            </div>
          </div>

          <!-- Bono por Referidos -->
          <div>
            <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Programa de Referidos</h4>
            <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border);">
              <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Puntos por Referido Exitoso</label>
              <input type="number" class="input" id="global-referral-points" value="${s.referralPoints || 500}" style="width:100%; height:44px; border-radius:12px; padding:0 12px; font-weight:700; font-size:14px;" />
            </div>
          </div>

          <!-- Desafíos Semanales -->
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin:0; letter-spacing:0.04em;">Desafíos Semanales</h4>
              <button id="btn-add-challenge" style="background:none; border:none; color:var(--color-primary); font-weight:800; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:4px;">
                ${icon('plus', 12)} AGREGAR
              </button>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px;" id="weekly-challenges-editor-container">
              ${(s.weeklyChallenges || []).map((ch, idx) => `
                <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border); position:relative;" class="challenge-edit-card" data-id="${ch.id}">
                  <button class="btn-delete-challenge" data-index="${idx}" style="position:absolute; top:12px; right:12px; border:none; background:none; color:var(--color-danger); cursor:pointer;">
                    ${icon('trash', 14)}
                  </button>
                  <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
                    <div>
                      <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Título del Desafío</label>
                      <input type="text" class="input challenge-title" value="${ch.title}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                      <div>
                        <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Pedidos Objetivo</label>
                        <input type="number" class="input challenge-target" value="${ch.target}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                      </div>
                      <div>
                        <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Premio (Puntos)</label>
                        <input type="number" class="input challenge-reward" value="${ch.pointsReward}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- GoLevels (Escalafones) -->
          <div>
            <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Niveles GoLevels</h4>
            <div style="display:flex; flex-direction:column; gap:14px;">
              ${Object.entries(s.levels || {}).map(([key, lvl]) => `
                <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border);">
                  <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <div style="width:32px; height:32px; border-radius:50%; background:${lvl.color}15; color:${lvl.color}; display:flex; align-items:center; justify-content:center;">${icon(lvl.icon, 18)}</div>
                    <span style="font-weight:900; font-family:var(--font-display); font-size:14px; color:var(--color-text);">${lvl.name}</span>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div>
                      <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Pedidos Mínimos</label>
                      <input type="number" class="input level-min-orders" data-level="${key}" value="${lvl.minOrders}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                    </div>
                    <div>
                      <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Multiplicador</label>
                      <input type="number" step="0.05" class="input level-multiplier" data-level="${key}" value="${lvl.multiplier}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                    </div>
                  </div>
                  <div>
                    <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Beneficios</label>
                    <textarea class="input level-benefits" data-level="${key}" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-size:12px; resize:none; line-height:1.4;">${lvl.benefits || ''}</textarea>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <button id="save-gopoints-btn" style="height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${icon('check', 20)} Guardar Todo
          </button>
        </div>
      </div>
    </div>
  `;

    // Live preview update
    const updatePreview = () => {
      const rate = (parseFloat(document.getElementById('global-points-rate').value) || 0) / 100;
      const val = parseFloat(document.getElementById('global-point-value').value) || 0;
      const earned = Math.floor(10000 * rate);
      document.getElementById('ref-points-earned').textContent = earned;
      document.getElementById('ref-discount-value').textContent = formatPrice(earned * val);
    };

    document.getElementById('global-points-rate').oninput = updatePreview;
    document.getElementById('global-point-value').oninput = updatePreview;
    updatePreview();

    // Add challenge
    document.getElementById('btn-add-challenge').onclick = () => {
      const challenges = s.weeklyChallenges || [];
      const newId = 'challenge_' + Math.random().toString(36).substr(2, 5);
      challenges.push({
        id: newId,
        title: 'Nuevo Desafío',
        target: 5,
        pointsReward: 100
      });
      s.weeklyChallenges = challenges;
      renderContent();
    };

    // Delete challenge
    document.querySelectorAll('.btn-delete-challenge').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        s.weeklyChallenges.splice(idx, 1);
        renderContent();
      };
    });

    // Save
    document.getElementById('save-gopoints-btn').onclick = async () => {
      const btn = document.getElementById('save-gopoints-btn');
      btn.disabled = true;
      btn.innerHTML = 'Guardando...';

      const pointsPerDollar = (parseFloat(document.getElementById('global-points-rate').value) || 1) / 100;
      const dollarPerPoint = parseFloat(document.getElementById('global-point-value').value) || 1;
      const referralPoints = parseFloat(document.getElementById('global-referral-points').value) || 500;

      const weeklyChallenges = [];
      document.querySelectorAll('#weekly-challenges-editor-container .challenge-edit-card').forEach(card => {
        const id = card.dataset.id;
        const title = card.querySelector('.challenge-title').value.trim();
        const target = parseInt(card.querySelector('.challenge-target').value) || 1;
        const pointsReward = parseInt(card.querySelector('.challenge-reward').value) || 0;
        weeklyChallenges.push({
          id,
          title,
          description: `Completá ${target} pedidos esta semana`,
          target,
          pointsReward
        });
      });

      const currentLevels = { ...s.levels };
      document.querySelectorAll('.level-min-orders').forEach(input => {
        currentLevels[input.dataset.level].minOrders = parseInt(input.value) || 0;
      });
      document.querySelectorAll('.level-multiplier').forEach(input => {
        currentLevels[input.dataset.level].multiplier = parseFloat(input.value) || 1.0;
      });
      document.querySelectorAll('.level-benefits').forEach(textarea => {
        currentLevels[textarea.dataset.level].benefits = textarea.value || '';
      });

      try {
        await setDoc(doc(db, 'settings', 'global'), {
          pointsPerDollar, dollarPerPoint, referralPoints, weeklyChallenges
        }, { merge: true });
        
        await setDoc(doc(db, 'settings', 'levels'), currentLevels);

        setState('pointsPerDollar', pointsPerDollar);
        setState('dollarPerPoint', dollarPerPoint);
        setState('referralPoints', referralPoints);
        setState('weeklyChallenges', weeklyChallenges);
        setState('levels', currentLevels);

        showToast('Ajustes de fidelización actualizados.', 'success');
      } catch (err) {
        console.error(err);
        showToast('Error al guardar ajustes.', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${icon('check', 20)} Guardar Todo`;
        renderContent();
      }
    };
  };

  renderContent();
}

// 5. NOTIFICATIONS PUSH PAGE
export async function renderAdminPushSettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(59, 130, 246, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Notificaciones Push</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Mensajes Automáticos</p>
        </div>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <div style="display:flex; flex-direction:column; gap:16px;">
          
          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Desconexión por Inactividad</label>
            <input type="text" id="push-text-disconnect-title" placeholder="Título" value="${s.pushMessages?.disconnect?.title || 'Zzz... Sesión pausada'}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-disconnect-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.disconnect?.body || 'Te desconectamos porque pasaron 3 horas de inactividad.'}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Nueva Oferta / Anuncio</label>
            <input type="text" id="push-text-offer-title" placeholder="Título" value="${s.pushMessages?.offer?.title || '¡Nueva Oferta!'}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-offer-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.offer?.body || 'Aprovechá esta nueva oferta en GoDelivery.'}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Recargo por Lluvia</label>
            <input type="text" id="push-text-rain-title" placeholder="Título" value="${s.pushMessages?.rain?.title || '🌧 ¡Empezó a llover!'}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-rain-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.rain?.body || 'El recargo por lluvia está activo. ¡Conducí con cuidado!'}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Recargo Nocturno</label>
            <input type="text" id="push-text-night-title" placeholder="Título" value="${s.pushMessages?.night?.title || '🌙 Recargo Nocturno Activo'}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-night-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.night?.body || 'Comenzó el horario de recargo nocturno.'}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Incentivo Extra</label>
            <input type="text" id="push-text-incentive-title" placeholder="Título" value="${s.pushMessages?.incentive?.title || '🚀 ¡Incentivo Activo!'}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-incentive-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.incentive?.body || 'Salí a repartir ahora y ganá un extra por cada pedido.'}</textarea>
          </div>

          <button id="save-push-btn" style="height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:10px;">
            ${icon('check', 20)} Guardar Plantillas
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('save-push-btn').onclick = async () => {
    const btn = document.getElementById('save-push-btn');
    btn.disabled = true;
    btn.innerHTML = 'Guardando...';

    const pushMessages = {
      disconnect: { title: document.getElementById('push-text-disconnect-title').value, body: document.getElementById('push-text-disconnect-body').value },
      offer: { title: document.getElementById('push-text-offer-title').value, body: document.getElementById('push-text-offer-body').value },
      rain: { title: document.getElementById('push-text-rain-title').value, body: document.getElementById('push-text-rain-body').value },
      night: { title: document.getElementById('push-text-night-title').value, body: document.getElementById('push-text-night-body').value },
      incentive: { title: document.getElementById('push-text-incentive-title').value, body: document.getElementById('push-text-incentive-body').value }
    };

    try {
      await setDoc(doc(db, 'settings', 'global'), { pushMessages }, { merge: true });
      setState('pushMessages', pushMessages);
      showToast('Mensajes push actualizados correctamente.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar ajustes.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check', 20)} Guardar Plantillas`;
    }
  };
}

// 6. SYSTEM MAINTENANCE PAGE
export async function renderAdminMaintenanceSettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #ef4444 0%, #991b1b 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(239, 68, 68, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Mantenimiento</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Control de Sistema y Reseteo</p>
        </div>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:24px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <style>
          .settings-switch { position: relative; display: inline-block; width: 44px; height: 24px; margin: 0; flex-shrink: 0; }
          .settings-switch input { opacity: 0; width: 0; height: 0; }
          .settings-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .3s; border-radius: 24px; }
          .settings-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.15); }
          .settings-switch input:checked + .settings-slider { background-color: var(--color-primary); }
          .settings-switch input:checked + .settings-slider:before { transform: translateX(20px); }
        </style>

        <!-- 1. Modo Mantenimiento Switch -->
        <div>
          <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Acceso del Servidor</h4>
          <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:14px;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <div style="display:flex; flex-direction:column; gap:2px;">
                <span style="font-size:13.5px; font-weight:800; color:var(--color-text);">Modo Mantenimiento Global</span>
                <span style="font-size:11px; color:var(--color-text-secondary); font-weight:500;">Bloquea clientes, comercios y repartidores de inmediato.</span>
              </div>
              <label class="settings-switch">
                <input type="checkbox" id="global-maintenance-mode" ${s.maintenanceMode ? 'checked' : ''}>
                <span class="settings-slider"></span>
              </label>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Mensaje para los usuarios</label>
              <textarea id="global-maintenance-message" class="input" style="width:100%; height:80px; border-radius:12px; padding:10px; font-weight:600; font-size:13px; background:var(--color-bg); border:1px solid var(--color-border); resize:none; color:var(--color-text);">${s.maintenanceMessage || ''}</textarea>
            </div>
            <button id="save-maintenance-btn" style="height:46px; border-radius:12px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer;">
              Guardar Estado
            </button>
          </div>
        </div>

        <!-- 2. Optimización de Imágenes -->
        <div>
          <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Optimización de Base de Datos</h4>
          <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:12px;">
            <p style="font-size:12px; color:var(--color-text-secondary); line-height:1.6; margin:0;">
              Comprime todas las fotos de comercios y productos de tu base de datos al formato ligero <strong>WebP (calidad 75%)</strong>.
            </p>
            <button class="btn" id="btn-optimize-images" style="width:100%; height:48px; border-radius:12px; background:linear-gradient(135deg,#0284c7,#0369a1); color:white; border:none; font-weight:900; font-size:13.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${icon('sparkles', 16)} OPTIMIZAR IMÁGENES
            </button>
            <div id="optimize-progress-container" style="display:none; margin-top:10px; background:var(--color-bg-secondary); padding:14px; border-radius:14px; border:1px solid var(--color-border-light);">
              <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:8px; color:var(--color-text);">
                <span id="opt-progress-status">Procesando...</span>
                <span id="opt-progress-pct">0%</span>
              </div>
              <div style="width:100%; height:8px; background:var(--color-border-light); border-radius:4px; overflow:hidden; position:relative;">
                <div id="opt-progress-bar" style="width:0%; height:100%; background:var(--color-primary); transition:width 0.2s ease;"></div>
              </div>
              <div id="opt-progress-results" style="margin-top:10px; font-size:11px; color:var(--color-text-secondary); line-height:1.4;"></div>
            </div>
          </div>
        </div>

        <!-- 3. Zona de Peligro -->
        <div>
          <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Zona de Peligro</h4>
          <div style="background:rgba(239,68,68,0.02); border:1.5px solid rgba(239,68,68,0.12); border-radius:20px; padding:18px; display:flex; flex-direction:column; gap:12px;">
            <p style="font-size:12px; color:var(--color-text-secondary); line-height:1.5; margin:0;">
              Elimina todos los pedidos, chats, balances e historiales del sistema. <span style="color:#ef4444; font-weight:800;">Esta acción es irreversible.</span>
            </p>
            <button class="btn btn-block" id="btn-hard-reset" style="width:100%; height:48px; border-radius:12px; background:linear-gradient(135deg,#ef4444,#dc2626); color:white; border:none; font-weight:900; font-size:13.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${icon('trash', 16)} RESETEO TOTAL (NUCLEAR)
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  // Bind maintenance mode save button
  document.getElementById('save-maintenance-btn').onclick = async () => {
    const btn = document.getElementById('save-maintenance-btn');
    btn.disabled = true;
    btn.innerHTML = 'Guardando...';

    const maintenanceMode = document.getElementById('global-maintenance-mode').checked;
    const maintenanceMessage = document.getElementById('global-maintenance-message').value.trim();

    try {
      await setDoc(doc(db, 'settings', 'global'), { maintenanceMode, maintenanceMessage }, { merge: true });
      setState('maintenanceMode', maintenanceMode);
      setState('maintenanceMessage', maintenanceMessage);
      showToast('Estado de mantenimiento guardado.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Guardar Estado';
    }
  };

  // Bind image optimization click
  document.getElementById('btn-optimize-images').onclick = () => {
    showConfirm({
      title: '📸 OPTIMIZAR IMÁGENES',
      message: 'Esta acción escaneará todos los comercios y productos de la plataforma y convertirá sus fotos a WebP comprimido (75% calidad).<br><br>¿Deseas iniciar la optimización ahora?',
      confirmText: 'SÍ, OPTIMIZAR',
      onConfirm: runImageOptimization
    });
  };

  // Bind Hard Reset click
  document.getElementById('btn-hard-reset').onclick = async () => {
    const uid = Math.random().toString(36).substr(2, 5);
    const modalContent = `
      <div style="padding: 20px 24px; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px;">
        <div style="background: rgba(239,68,68,0.06); border: 1px dashed rgba(239,68,68,0.25); border-radius: 18px; padding: 14px 16px; display: flex; gap: 12px; align-items: flex-start;">
          <div style="color: #ef4444; flex-shrink:0; margin-top:2px;">${icon('alertTriangle', 20)}</div>
          <div style="font-size: 13px; color: var(--color-text-secondary); line-height: 1.5;">
            Estás por iniciar un <strong>Reseteo Nuclear</strong>. Se borrarán todos los pedidos, chats, notificaciones, liquidaciones, historial, opiniones, y calificaciones de la plataforma.
          </div>
        </div>
        
        <p style="font-size: 13px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin: 4px 0 0 0; letter-spacing: 0.05em;">Conservación de Datos:</p>
        
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px;">
              <div style="color: var(--color-success); margin-top: 2px;">${icon('check', 18)}</div>
              <div style="flex: 1;">
                <div style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Usuarios Registrados</div>
                <div style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; line-height: 1.35;">Se conservan los perfiles de los usuarios en el sistema, pero se blanquean a 0 todos sus saldos, deudas y calificaciones.</div>
              </div>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px;">
              <div style="color: var(--color-success); margin-top: 2px;">${icon('check', 18)}</div>
              <div style="flex: 1;">
                <div style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Comercios y Productos</div>
                <div style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; line-height: 1.35;">Se conservan los perfiles de los comercios y sus catálogos de productos, pero se eliminan todas sus opiniones y calificaciones recibidas.</div>
              </div>
            </div>
          </div>

          <p style="font-size: 13px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin: 8px 0 0 0; letter-spacing: 0.05em;">Opciones Adicionales:</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px; cursor: pointer;">
              <div style="display:flex; flex-direction:column; gap:2px; flex:1; padding-right:12px;">
                <span style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Puntos de Usuarios</span>
                <span style="font-size: 11px; color: var(--color-text-tertiary); line-height: 1.35;">Mantiene los puntos acumulados por cada usuario sin blanquearlos a 0.</span>
              </div>
              <input type="checkbox" id="keep-points-check" style="width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer;" />
            </label>
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px; cursor: pointer;">
              <div style="display:flex; flex-direction:column; gap:2px; flex:1; padding-right:12px;">
                <span style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Anuncios en Curso</span>
                <span style="font-size: 11px; color: var(--color-text-tertiary); line-height: 1.35;">No elimina los banners publicitarios (ads/customAds) activos.</span>
              </div>
              <input type="checkbox" id="keep-ads-check" style="width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer;" />
            </label>
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px; cursor: pointer;">
              <div style="display:flex; flex-direction:column; gap:2px; flex:1; padding-right:12px;">
                <span style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Ofertas en Curso</span>
                <span style="font-size: 11px; color: var(--color-text-tertiary); line-height: 1.35;">Conserva las ofertas promocionales y cupones configurados.</span>
              </div>
              <input type="checkbox" id="keep-offers-check" style="width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer;" />
            </label>
          </div>
        </div>

        <div style="margin-top: 10px; display:flex; flex-direction:column; gap:6px;">
          <label style="font-size: 10px; color: var(--color-text-tertiary); font-weight:700; text-transform: uppercase;">Para confirmar, escribe: <span style="color:#ef4444; font-weight:900;">${uid}</span></label>
          <input type="text" id="confirm-nuclear-input" class="input" style="width:100%; height:44px; border-radius:12px; text-align:center; font-weight:900; font-size:16px; border: 1.5px solid var(--color-border); background:var(--color-bg);" />
        </div>

        <button id="btn-execute-nuclear" disabled style="height: 52px; border-radius:16px; background:#ef4444; color:white; border:none; font-weight:900; font-size:15px; cursor:not-allowed; display:flex; align-items:center; justify-content:center; gap:8px;">
          ${icon('trash', 18)} EJECUTAR RESETEO NUCLEAR
        </button>
      </div>
    `;

    showModal({
      title: '⚠️ Reseteo Nuclear',
      height: 'auto',
      content: modalContent,
      hideHeader: true,
      onOpen: () => {
        const input = document.getElementById('confirm-nuclear-input');
        const executeBtn = document.getElementById('btn-execute-nuclear');
        const keepPointsCheck = document.getElementById('keep-points-check');
        const keepAdsCheck = document.getElementById('keep-ads-check');
        const keepOffersCheck = document.getElementById('keep-offers-check');

        input.oninput = () => {
          if (input.value.trim() === uid) {
            executeBtn.disabled = false;
            executeBtn.style.cursor = 'pointer';
            executeBtn.style.background = '#dc2626';
          } else {
            executeBtn.disabled = true;
            executeBtn.style.cursor = 'not-allowed';
            executeBtn.style.background = '#ef4444';
          }
        };

        executeBtn.onclick = async () => {
          executeBtn.disabled = true;
          executeBtn.innerHTML = 'Reseteando...';
          await performHardReset({
            keepPoints: keepPointsCheck.checked,
            keepAds: keepAdsCheck.checked,
            keepOffers: keepOffersCheck.checked
          });
          closeModal();
        };
      }
    });
  };
}

async function runImageOptimization() {
  const btn = document.getElementById('btn-optimize-images');
  const progContainer = document.getElementById('optimize-progress-container');
  const statusText = document.getElementById('opt-progress-status');
  const pctText = document.getElementById('opt-progress-pct');
  const progressBar = document.getElementById('opt-progress-bar');
  const resultsText = document.getElementById('opt-progress-results');

  if (!btn || !progContainer) return;

  btn.disabled = true;
  progContainer.style.display = 'block';
  statusText.textContent = 'Obteniendo lista de comercios...';
  pctText.textContent = '0%';
  progressBar.style.width = '0%';
  resultsText.innerHTML = '';

  let totalScanned = 0;
  let totalOptimized = 0;
  let totalSavedBytes = 0;

  try {
    const comerciosSnap = await getDocs(collection(db, 'comercios'));
    const comercios = comerciosSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const allProductsToOptimize = [];
    statusText.textContent = 'Obteniendo lista de productos...';

    for (const store of comercios) {
      const prodsSnap = await getDocs(collection(db, 'comercios', store.id, 'products'));
      prodsSnap.forEach(d => {
        allProductsToOptimize.push({
          storeId: store.id,
          productId: d.id,
          ref: d.ref,
          data: d.data()
        });
      });
    }

    const totalTasks = comercios.length * 2 + allProductsToOptimize.length;
    let completedTasks = 0;

    const updateProgress = (status) => {
      completedTasks++;
      const pct = Math.round((completedTasks / totalTasks) * 100);
      if (pctText) pctText.textContent = `${pct}%`;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (statusText) statusText.textContent = status;
    };

    const getBase64Size = (str) => {
      if (!str || !str.startsWith('data:image')) return 0;
      return Math.round((str.length * 3) / 4);
    };

    const formatBytes = (bytes) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1048576).toFixed(1)} MB`;
    };

    resultsText.innerHTML = `Escaneando: <strong>${comercios.length}</strong> comercios y <strong>${allProductsToOptimize.length}</strong> productos...<br>`;

    for (const store of comercios) {
      let updatedStore = {};
      let isStoreChanged = false;

      if (store.logo && store.logo.startsWith('data:image')) {
        totalScanned++;
        const originalSize = getBase64Size(store.logo);
        const compressed = await compressImage(store.logo, 200, 200, 0.75);
        const newSize = getBase64Size(compressed);

        if (newSize < originalSize) {
          updatedStore.logo = compressed;
          isStoreChanged = true;
          totalOptimized++;
          totalSavedBytes += (originalSize - newSize);
        }
      }
      updateProgress(`Comprimiendo logos... (${store.name})`);

      if (store.banner && store.banner.startsWith('data:image')) {
        totalScanned++;
        const originalSize = getBase64Size(store.banner);
        const compressed = await compressImage(store.banner, 800, 400, 0.75);
        const newSize = getBase64Size(compressed);

        if (newSize < originalSize) {
          updatedStore.banner = compressed;
          isStoreChanged = true;
          totalOptimized++;
          totalSavedBytes += (originalSize - newSize);
        }
      }
      updateProgress(`Comprimiendo banners... (${store.name})`);

      if (isStoreChanged) {
        await setDoc(doc(db, 'comercios', store.id), updatedStore, { merge: true });
      }
    }

    for (const prod of allProductsToOptimize) {
      if (prod.data.image && prod.data.image.startsWith('data:image')) {
        totalScanned++;
        const originalSize = getBase64Size(prod.data.image);
        const compressed = await compressImage(prod.data.image, 800, 600, 0.75);
        const newSize = getBase64Size(compressed);

        if (newSize < originalSize) {
          await setDoc(prod.ref, { image: compressed }, { merge: true });
          totalOptimized++;
          totalSavedBytes += (originalSize - newSize);
        }
      }
      updateProgress(`Comprimiendo productos... (${prod.data.name || 'Producto'})`);
    }

    if (statusText) statusText.textContent = '¡Optimización completada con éxito!';
    if (pctText) pctText.textContent = '100%';
    if (progressBar) progressBar.style.width = '100%';
    resultsText.innerHTML += `
      <div style="margin-top:10px; padding:12px; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.15); border-radius:12px; color:var(--color-success); font-weight:700; line-height:1.5;">
        ✨ Resultados de Optimización:<br>
        • Imágenes analizadas: ${totalScanned}<br>
        • Imágenes comprimidas a WebP: ${totalOptimized}<br>
        • Espacio de base de datos ahorrado: ${formatBytes(totalSavedBytes)}<br>
        • Rendimiento de carga mejorado notablemente!
      </div>
    `;
    showToast('¡Base de imágenes optimizada correctamente!', 'success');
  } catch (err) {
    console.error('Image optimization failed:', err);
    if (statusText) statusText.textContent = 'Error en la optimización';
    showToast('Error al optimizar imágenes', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function performHardReset({ keepPoints = false, keepAds = false, keepOffers = false } = {}) {
  try {
    showToast('Iniciando Reseteo Nuclear...', 'info');

    const { auth } = await import('../../firebase.js');
    const { getIdToken } = await import('firebase/auth');
    if (!auth.currentUser) {
      showToast('Error: Usuario no autenticado', 'error');
      return;
    }
    const idToken = await getIdToken(auth.currentUser);

    const response = await fetch(`https://us-central1-godelivery-magdalena.cloudfunctions.net/adminHardReset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idToken,
        keepPoints,
        keepAds,
        keepOffers
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${response.status}`);
    }

    showToast('Limpiando caché local y preparando reinicio...', 'info');
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('gd_clear_persistence', 'true');

    showToast('¡Sistema reseteado a cero con éxito! Reiniciando...', 'success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    console.error('Hard Reset error:', err);
    showToast(`Error crítico en el Hard Reset: ${err.message}`, 'error');
  }
}
