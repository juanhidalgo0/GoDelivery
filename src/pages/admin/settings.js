import { db } from "../../firebase.js";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs, writeBatch, serverTimestamp } from "firebase/firestore";
import { isAdmin } from "../../auth.js";
import { icon } from "../../utils/icons.js";
import { formatPrice } from "../../utils/format.js";
import { getState, setState } from "../../state.js";
import { showToast } from "../../components/toast.js";
import { showConfirm, showModal, closeModal } from "../../components/modal.js";
import { compressImage } from "../../utils/image-compressor.js";
let globalPendingOrders = [];
export async function renderAdminSettings() {
  const content = document.getElementById("app-content");
  if (!content) return;
  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No ten\xE9s acceso a esta secci\xF3n.</p></div>`;
    return;
  }
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;position:relative;z-index:2;">
          ${icon("chevronLeft", 24)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Configuraci\xF3n</h1>
          <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Ajustes del sistema</p>
        </div>
      </div>

      <!-- Menu Links List -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch;">
        
        <!-- 1. Logistics -->
        <a href="#/admin/settings/logistics" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#dbeafe,#bfdbfe); color:#2563eb; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("bike", 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Tarifas de Log\xEDstica</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Precios de env\xEDo, costo por km, viajes y precios fijos</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 18)}</div>
        </a>

        <!-- 1.5 Paulos Convenio -->
        <a href="#/admin/settings/kiosk-paulos" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:linear-gradient(135deg, rgba(76,29,149,0.06) 0%, rgba(124,58,237,0.1) 100%); border:1.5px solid rgba(124,58,237,0.3); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#7c3aed,#6d28d9); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 4px 10px rgba(124,58,237,0.3); font-size:20px;">\u2B50</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Convenio Maxikiosco Paulos</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Tarifas, liquidaciones a $0, historial y reporte WhatsApp/Excel</div>
            </div>
          </div>
          <div style="color:#7c3aed;">${icon("chevronRight", 18)}</div>
        </a>

        <!-- 2. Economy -->
        <a href="#/admin/settings/economy" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#d1fae5,#a7f3d0); color:#059669; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("bank", 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Econom\xEDa de la App</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Comisiones del sistema y costos de la plataforma</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 18)}</div>
        </a>

        <!-- 3. Dynamic Pricing -->
        <a href="#/admin/settings/dynamic" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#e0e7ff,#c7d2fe); color:#4f46e5; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("clock", 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Tarifas Din\xE1micas (Horarios)</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Recargos nocturnos e incentivos de reparto</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 18)}</div>
        </a>

        <!-- 4. GoPoints -->
        <a href="#/admin/settings/gopoints" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#fef3c7,#fde68a); color:#d97706; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("sparkles", 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Programa GoPoints</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Recompensas, niveles, referidos y desaf\xEDos semanales</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 18)}</div>
        </a>

        <!-- 5. Push Texts -->
        <a href="#/admin/settings/push" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#e0e7ff,#c7d2fe); color:#4f46e5; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("bell", 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Notificaciones Push</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Personalizar notificaciones del sistema</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 18)}</div>
        </a>

        <!-- 6. Maintenance -->
        <a href="#/admin/settings/maintenance" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; text-decoration:none; box-sizing:border-box; box-shadow:var(--shadow-sm); transition:all 0.25s ease;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#fee2e2,#fee2e2); color:#ef4444; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("alertTriangle", 22)}</div>
            <div>
              <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text); letter-spacing:-0.01em;">Mantenimiento y Sistema</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Bloqueo global, optimizaci\xF3n de im\xE1genes y reseteo</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 18)}</div>
        </a>

      </div>
    </div>
  `;
}
export async function renderAdminLogisticsSettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  const renderContent = () => {
    const rules = getState().deliveryDistanceRules || [];
    const sortedRules = [...rules].sort((a, b) => a.limitKm - b.limitKm);
    container.innerHTML = `
      <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(126, 34, 206, 0.25); z-index:100;">
          <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
            ${icon("chevronLeft", 24)}
          </a>
          <div style="flex:1;">
            <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Tarifas de Log\xEDstica</h1>
            <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Gesti\xF3n de tarifas y reglas fijas</p>
          </div>
        </div>

        <!-- Main Body -->
        <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch;">
          <p style="font-size:13px; color:var(--color-text-secondary); margin:0; font-weight:600; line-height:1.5;">
            Configura los precios del sistema para el delivery general, el costo de favores y recados, las tarifas de viajes en veh\xEDculos y las reglas de precios fijos por kil\xF3metro.
          </p>

          <div style="display:flex; flex-direction:column; gap:16px; margin-top:8px;">
            <!-- Delivery General -->
            <button id="btn-show-delivery-general" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(168, 85, 247, 0.1); color:#a855f7; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("bike", 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">DELIVERY GENERAL</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Costo base, costo por km, recargo lluvia y paradas</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 20)}</div>
            </button>

            <!-- Go Favores -->
            <button id="btn-show-go-favores" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(59, 130, 246, 0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("tag", 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">GO FAVORES</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Gesti\xF3n de favores y base para pago de servicios</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 20)}</div>
            </button>

            <!-- Viajes -->
            <button id="btn-show-viajes" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(16, 185, 129, 0.1); color:#10b981; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("mapPin", 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">VIAJES (MOTO / AUTO)</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Costo base, m\xEDnimo y extra por kil\xF3metro</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 20)}</div>
            </button>

            <!-- Precio Fijo por KM -->
            <button id="btn-show-precio-fijo" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(245, 158, 11, 0.1); color:#f59e0b; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon("trendingUp", 22)}</div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">PRECIO FIJO POR KM</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Reglas din\xE1micas de precio fijo seg\xFAn rango de km</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon("chevronRight", 20)}</div>
            </button>
          </div>
        </div>
      </div>
    `;
    document.getElementById("btn-show-delivery-general").onclick = openDeliveryGeneralModal;
    document.getElementById("btn-show-go-favores").onclick = openGoFavoresModal;
    document.getElementById("btn-show-viajes").onclick = openViajesModal;
    document.getElementById("btn-show-precio-fijo").onclick = openPrecioFijoModal;
  };
  const openDeliveryGeneralModal = () => {
    const s = getState();
    const modalContent = document.createElement("div");
    modalContent.style.cssText = "padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg);";
    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Delivery General</h3>
      <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo Base ($)</label>
          <input type="number" id="logistics-delivery-base" value="${s.deliveryBasePrice || 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo M\xEDnimo ($)</label>
          <input type="number" id="logistics-delivery-min" value="${s.deliveryMinPrice || 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Extra por Kil\xF3metro ($)</label>
          <input type="number" id="logistics-delivery-km" value="${s.deliveryPricePerKm || 300}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Parada Extra ($)</label>
          <input type="number" id="logistics-delivery-extra-stop" value="${s.deliveryExtraStopFee || 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Recargo por Lluvia ($)</label>
          <input type="number" id="logistics-delivery-rain-surcharge" value="${s.deliveryRainSurcharge || 300}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Modo del Recargo</label>
          <select id="logistics-rain-mode" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);">
            <option value="auto" ${s.rainMode === "auto" ? "selected" : ""}>Autom\xE1tico (API)</option>
            <option value="on" ${s.rainMode === "on" ? "selected" : ""}>Siempre Activo</option>
            <option value="off" ${s.rainMode === "off" ? "selected" : ""}>Siempre Desactivado</option>
          </select>
        </div>
      </div>
      <button id="btn-save-delivery-general" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Ajustes
      </button>
    `;
    showModal({
      title: "",
      content: modalContent,
      height: "auto",
      hideHeader: true,
      onOpen: () => {
        modalContent.querySelector("#btn-save-delivery-general").onclick = async () => {
          const btn = modalContent.querySelector("#btn-save-delivery-general");
          btn.disabled = true;
          btn.textContent = "Guardando...";
          const deliveryBasePrice = parseFloat(modalContent.querySelector("#logistics-delivery-base").value) || 0;
          const deliveryMinPrice = parseFloat(modalContent.querySelector("#logistics-delivery-min").value) || 0;
          const deliveryPricePerKm = parseFloat(modalContent.querySelector("#logistics-delivery-km").value) || 0;
          const deliveryExtraStopFee = parseFloat(modalContent.querySelector("#logistics-delivery-extra-stop").value) || 0;
          const deliveryRainSurcharge = parseFloat(modalContent.querySelector("#logistics-delivery-rain-surcharge").value) || 0;
          const rainMode = modalContent.querySelector("#logistics-rain-mode").value;
          try {
            await setDoc(doc(db, "settings", "global"), {
              deliveryBasePrice,
              deliveryMinPrice,
              deliveryPricePerKm,
              deliveryExtraStopFee,
              deliveryRainSurcharge,
              rainMode
            }, { merge: true });
            setState("deliveryBasePrice", deliveryBasePrice);
            setState("deliveryMinPrice", deliveryMinPrice);
            setState("deliveryPricePerKm", deliveryPricePerKm);
            setState("deliveryExtraStopFee", deliveryExtraStopFee);
            setState("deliveryRainSurcharge", deliveryRainSurcharge);
            setState("rainMode", rainMode);
            showToast("Ajustes de Delivery General guardados.", "success");
            closeModal();
          } catch (err) {
            console.error(err);
            showToast("Error al guardar ajustes.", "error");
            btn.disabled = false;
            btn.textContent = "Guardar Ajustes";
          }
        };
      }
    });
  };
  const openGoFavoresModal = () => {
    const s = getState();
    const modalContent = document.createElement("div");
    modalContent.style.cssText = "padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg);";
    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Go Favores</h3>
      <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Gesti\xF3n GoFavor ($)</label>
          <input type="number" id="logistics-favor-fee" value="${s.favorPurchaseFee || 800}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Base Pago de Servicios ($)</label>
          <input type="number" id="logistics-service-fee" value="${s.servicePaymentErrandFee || 2e3}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
      </div>
      <button id="btn-save-go-favores" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Ajustes
      </button>
    `;
    showModal({
      title: "",
      content: modalContent,
      height: "auto",
      hideHeader: true,
      onOpen: () => {
        modalContent.querySelector("#btn-save-go-favores").onclick = async () => {
          const btn = modalContent.querySelector("#btn-save-go-favores");
          btn.disabled = true;
          btn.textContent = "Guardando...";
          const favorPurchaseFee = parseFloat(modalContent.querySelector("#logistics-favor-fee").value) || 0;
          const servicePaymentErrandFee = parseFloat(modalContent.querySelector("#logistics-service-fee").value) || 0;
          try {
            await setDoc(doc(db, "settings", "global"), { favorPurchaseFee, servicePaymentErrandFee }, { merge: true });
            setState("favorPurchaseFee", favorPurchaseFee);
            setState("servicePaymentErrandFee", servicePaymentErrandFee);
            showToast("Ajustes de Go Favores guardados.", "success");
            closeModal();
          } catch (err) {
            console.error(err);
            showToast("Error al guardar ajustes.", "error");
            btn.disabled = false;
            btn.textContent = "Guardar Ajustes";
          }
        };
      }
    });
  };
  const openViajesModal = () => {
    const s = getState();
    const modalContent = document.createElement("div");
    modalContent.style.cssText = "padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg);";
    modalContent.innerHTML = `
      <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:var(--color-text-primary);">Viajes (Moto / Auto)</h3>
      <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo Base ($)</label>
          <input type="number" id="logistics-trip-base" value="${s.tripBasePrice !== void 0 ? s.tripBasePrice : 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Costo M\xEDnimo ($)</label>
          <input type="number" id="logistics-trip-min" value="${s.tripMinPrice !== void 0 ? s.tripMinPrice : 1500}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
        <div>
          <label style="font-size:11px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Extra por Kil\xF3metro ($)</label>
          <input type="number" id="logistics-trip-km" value="${s.tripPricePerKm !== void 0 ? s.tripPricePerKm : 300}" style="width:100%; height:48px; border-radius:14px; border:1.5px solid var(--color-border); padding:0 14px; font-size:14px; background:var(--color-bg-card); color:var(--color-text-primary);" />
        </div>
      </div>
      <button id="btn-save-viajes" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Ajustes
      </button>
    `;
    showModal({
      title: "",
      content: modalContent,
      height: "auto",
      hideHeader: true,
      onOpen: () => {
        modalContent.querySelector("#btn-save-viajes").onclick = async () => {
          const btn = modalContent.querySelector("#btn-save-viajes");
          btn.disabled = true;
          btn.textContent = "Guardando...";
          const tripBasePrice = parseFloat(modalContent.querySelector("#logistics-trip-base").value) || 0;
          const tripMinPrice = parseFloat(modalContent.querySelector("#logistics-trip-min").value) || 0;
          const tripPricePerKm = parseFloat(modalContent.querySelector("#logistics-trip-km").value) || 0;
          try {
            await setDoc(doc(db, "settings", "global"), { tripBasePrice, tripMinPrice, tripPricePerKm }, { merge: true });
            setState("tripBasePrice", tripBasePrice);
            setState("tripMinPrice", tripMinPrice);
            setState("tripPricePerKm", tripPricePerKm);
            showToast("Ajustes de Viajes guardados.", "success");
            closeModal();
          } catch (err) {
            console.error(err);
            showToast("Error al guardar ajustes.", "error");
            btn.disabled = false;
            btn.textContent = "Guardar Ajustes";
          }
        };
      }
    });
  };
  const openPrecioFijoModal = () => {
    let localRules = [...getState().deliveryDistanceRules || []];
    const modalContent = document.createElement("div");
    modalContent.style.cssText = "padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg); max-height:85vh; overflow-y:auto;";
    const renderRulesList = () => {
      const containerEl = modalContent.querySelector("#rules-list-container");
      if (!containerEl) return;
      if (localRules.length === 0) {
        containerEl.innerHTML = `
          <div style="text-align:center; padding:24px; color:var(--color-text-tertiary); font-size:12px; font-weight:600; border:1.5px dashed var(--color-border); border-radius:18px;">
            No hay reglas configuradas. Se usar\xE1 el c\xE1lculo din\xE1mico.
          </div>
        `;
        return;
      }
      containerEl.innerHTML = localRules.map((rule, index) => `
        <div class="rule-row" data-index="${index}" style="display:flex; flex-direction:column; gap:10px; background:var(--color-bg-card); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm); margin-bottom:12px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Regla de Env\xEDo</div>
            <button class="rule-delete-btn" style="width:28px; height:28px; border-radius:8px; background:rgba(239, 68, 68, 0.08); border:none; display:flex; align-items:center; justify-content:center; color:var(--color-danger); cursor:pointer;">
              ${icon("trash", 12)}
            </button>
          </div>
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Nombre de la Regla</div>
            <input type="text" class="rule-name-input" value="${rule.name || ""}" placeholder="Ej. Tarifa Atalaya" style="width:100%; height:38px; border-radius:10px; border:1px solid var(--color-border); padding:0 8px; font-size:13px; font-weight:700; background:var(--color-bg); color:var(--color-text); box-sizing:border-box;" />
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:4px;">Distancia M\xEDnima</div>
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
      `).join("");
      containerEl.querySelectorAll(".rule-delete-btn").forEach((btn, i) => {
        btn.onclick = () => {
          localRules.splice(i, 1);
          renderRulesList();
        };
      });
      containerEl.querySelectorAll(".rule-row").forEach((row) => {
        const i = parseInt(row.dataset.index);
        const nameInput = row.querySelector(".rule-name-input");
        const limitInput = row.querySelector(".rule-limit-input");
        const priceInput = row.querySelector(".rule-price-input");
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
        ${icon("plus", 14)} AGREGAR REGLA DE DISTANCIA
      </button>

      <button id="btn-save-precio-fijo" style="margin-top:16px; height:50px; border-radius:16px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer; width:100%;">
        Guardar Configuraci\xF3n
      </button>
    `;
    showModal({
      title: "",
      content: modalContent,
      height: "auto",
      hideHeader: true,
      onOpen: () => {
        renderRulesList();
        modalContent.querySelector("#btn-add-rule").onclick = () => {
          localRules.push({ name: "", limitKm: 0, price: 0 });
          renderRulesList();
        };
        modalContent.querySelector("#btn-save-precio-fijo").onclick = async () => {
          const btn = modalContent.querySelector("#btn-save-precio-fijo");
          btn.disabled = true;
          btn.textContent = "Guardando...";
          const cleanRules = localRules.filter((r) => r.limitKm > 0 && r.price > 0).map((r) => ({
            name: (r.name || "").trim(),
            limitKm: Number(r.limitKm),
            price: Number(r.price)
          }));
          try {
            await setDoc(doc(db, "settings", "global"), { deliveryDistanceRules: cleanRules }, { merge: true });
            setState("deliveryDistanceRules", cleanRules);
            showToast("Reglas de Precio Fijo guardadas.", "success");
            closeModal();
            renderContent();
          } catch (err) {
            console.error(err);
            showToast("Error al guardar configuraci\xF3n.", "error");
            btn.disabled = false;
            btn.textContent = "Guardar Configuraci\xF3n";
          }
        };
      }
    });
  };
  renderContent();
}
export async function renderAdminEconomySettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(16, 185, 129, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon("chevronLeft", 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Econom\xEDa de la App</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Configuraci\xF3n econ\xF3mica general</p>
        </div>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div>
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Comisi\xF3n del Comercio (%)</label>
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
                  <option value="fixed" ${s.servicesAppFeeConfig?.gofavor?.type === "fixed" ? "selected" : ""}>Fijo ($)</option>
                  <option value="percentage" ${s.servicesAppFeeConfig?.gofavor?.type === "percentage" ? "selected" : ""}>Porcentaje (%)</option>
                </select>
                <input type="number" id="fee-config-gofavor-value" value="${s.servicesAppFeeConfig?.gofavor?.value || 0}" style="width:70px; height:34px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700; border:1px solid var(--color-border-light); background:var(--color-surface);" />
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; font-size:11px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase;">Cash</div>
                <select id="fee-config-gocash-type" class="input" style="height:34px; border-radius:8px; padding:0 6px; font-size:12px; font-weight:700; flex:1; background:var(--color-surface); border:1px solid var(--color-border-light);">
                  <option value="fixed" ${s.servicesAppFeeConfig?.gocash?.type === "fixed" ? "selected" : ""}>Fijo ($)</option>
                  <option value="percentage" ${s.servicesAppFeeConfig?.gocash?.type === "percentage" ? "selected" : ""}>Porcentaje (%)</option>
                </select>
                <input type="number" id="fee-config-gocash-value" value="${s.servicesAppFeeConfig?.gocash?.value || 0}" style="width:70px; height:34px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700; border:1px solid var(--color-border-light); background:var(--color-surface);" />
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; font-size:11px; font-weight:900; color:var(--color-text-secondary); text-transform:uppercase;">Viaje</div>
                <select id="fee-config-goviaje-type" class="input" style="height:34px; border-radius:8px; padding:0 6px; font-size:12px; font-weight:700; flex:1; background:var(--color-surface); border:1px solid var(--color-border-light);">
                  <option value="fixed" ${s.servicesAppFeeConfig?.goviaje?.type === "fixed" ? "selected" : ""}>Fijo ($)</option>
                  <option value="percentage" ${s.servicesAppFeeConfig?.goviaje?.type === "percentage" ? "selected" : ""}>Porcentaje (%)</option>
                </select>
                <input type="number" id="fee-config-goviaje-value" value="${s.servicesAppFeeConfig?.goviaje?.value || 0}" style="width:70px; height:34px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700; border:1px solid var(--color-border-light); background:var(--color-surface);" />
              </div>
            </div>
          </div>

          <div style="border-top:1px dashed var(--color-border-light); padding-top:18px; margin-top:8px;">
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Monto de Canon Diario ($)</label>
            <input type="number" class="input" id="global-canon-amount" value="${s.canonAmount || 2e3}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
          </div>

          <div style="border-top:1px dashed var(--color-border-light); padding-top:18px; margin-top:8px;">
            <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:#25D366; text-transform:uppercase; letter-spacing:0.04em; display:flex; align-items:center; gap:6px;">
              ${icon("chat", 16)} Tarifas Bot WhatsApp
            </h4>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div>
                <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Costo Envío WhatsApp ($)</label>
                <input type="number" class="input" id="global-whatsapp-delivery-fee" value="${s.whatsappDeliveryFee !== undefined ? s.whatsappDeliveryFee : 2000}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
              </div>
              <div>
                <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Tarifa App WhatsApp ($)</label>
                <input type="number" class="input" id="global-whatsapp-app-fee" value="${s.whatsappAppFee !== undefined ? s.whatsappAppFee : 100}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
              </div>
            </div>
          </div>

          <div style="border-top:1px dashed var(--color-border-light); padding-top:18px; margin-top:8px;">
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">WhatsApp de Pagos y Soporte</label>
            <input type="text" class="input" id="global-whatsapp-payments" value="${s.whatsappPayments || "5491123456789"}" placeholder="Ej: 549221555555" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
          </div>

          <div style="border-top:1px dashed var(--color-border-light); padding-top:18px; margin-top:8px;">
            <button type="button" id="btn-manage-wa-commerces" style="width:100%; height:50px; border-radius:16px; background:rgba(37, 211, 102, 0.1); border:1.5px solid #25D366; color:#25D366; font-weight:900; font-size:13.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${icon("store", 18)} Gestionar Comercios WhatsApp
            </button>
          </div>

          <button id="save-economy-btn" style="margin-top:20px; height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${icon("check", 20)} Guardar Ajustes
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("save-economy-btn").onclick = async () => {
    const btn = document.getElementById("save-economy-btn");
    btn.disabled = true;
    btn.innerHTML = "Guardando...";
    const commissionRate = (parseFloat(document.getElementById("global-commission-rate").value) || 10) / 100;
    const appUsageFeeRate = (parseFloat(document.getElementById("global-app-fee-rate").value) || 5) / 100;
    const whatsappPayments = document.getElementById("global-whatsapp-payments").value.trim();
    const canonAmount = parseFloat(document.getElementById("global-canon-amount").value) || 2e3;
    const servicesAppFeeConfig = {
      gofavor: {
        type: document.getElementById("fee-config-gofavor-type").value,
        value: parseFloat(document.getElementById("fee-config-gofavor-value").value) || 0
      },
      gocash: {
        type: document.getElementById("fee-config-gocash-type").value,
        value: parseFloat(document.getElementById("fee-config-gocash-value").value) || 0
      },
      goviaje: {
        type: document.getElementById("fee-config-goviaje-type").value,
        value: parseFloat(document.getElementById("fee-config-goviaje-value").value) || 0
      }
    };
    const whatsappDeliveryFee = parseFloat(document.getElementById("global-whatsapp-delivery-fee").value) || 2000;
    const whatsappAppFee = parseFloat(document.getElementById("global-whatsapp-app-fee").value) || 100;
    try {
      await setDoc(doc(db, "settings", "global"), {
        commissionRate,
        appUsageFeeRate,
        whatsappPayments,
        servicesAppFeeConfig,
        canonAmount,
        whatsappDeliveryFee,
        whatsappAppFee
      }, { merge: true });
      setState("commissionRate", commissionRate);
      setState("appUsageFeeRate", appUsageFeeRate);
      setState("whatsappPayments", whatsappPayments);
      setState("servicesAppFeeConfig", servicesAppFeeConfig);
      setState("canonAmount", canonAmount);
      setState("whatsappDeliveryFee", whatsappDeliveryFee);
      setState("whatsappAppFee", whatsappAppFee);
      showToast("Ajustes de Econom\xEDa actualizados.", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar ajustes.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("check", 20)} Guardar Ajustes`;
    }
  };

  const btnWA = document.getElementById("btn-manage-wa-commerces");
  if (btnWA) {
    btnWA.onclick = () => openWACommercesModal();
  }
}

export async function openWACommercesModal() {
  const modalContent = document.createElement("div");
  modalContent.style.cssText = "padding: 24px; display:flex; flex-direction:column; gap:16px; background:var(--color-bg); max-height:80vh; overflow-y:auto;";
  modalContent.innerHTML = `
    <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; margin:0; color:#25D366; display:flex; align-items:center; gap:8px;">
      ${icon("store", 22)} Comercios Adheridos WhatsApp
    </h3>
    <p style="font-size:12px; color:var(--color-text-secondary); margin:0; line-height:1.4;">
      Registrá comercios con su número de teléfono de WhatsApp para que el Bot reconozca su local automáticamente y no tengan que tippear la dirección de retiro.
    </p>

    <div style="background:var(--color-surface); padding:16px; border-radius:16px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:10px;">
      <h4 style="font-size:12px; font-weight:800; margin:0; color:var(--color-text-primary); text-transform:uppercase;">Agregar Nuevo Comercio</h4>
      <input type="text" id="wa-comm-name" placeholder="Nombre del Comercio (Ej: Panadería Don Pedro)" style="height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 12px; font-size:13px; font-weight:700; background:var(--color-bg-card); color:var(--color-text-primary);" />
      <input type="text" id="wa-comm-phone" placeholder="Teléfono WhatsApp (Ej: 5492215554433)" style="height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 12px; font-size:13px; font-weight:700; background:var(--color-bg-card); color:var(--color-text-primary);" />
      <input type="text" id="wa-comm-address" placeholder="Dirección del Local (Ej: Calle 11 #450)" style="height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 12px; font-size:13px; font-weight:700; background:var(--color-bg-card); color:var(--color-text-primary);" />
      <button id="btn-save-wa-comm" style="height:44px; border-radius:12px; background:#25D366; color:white; border:none; font-weight:900; font-size:13px; cursor:pointer;">
        + Agregar a la Lista
      </button>
    </div>

    <div style="margin-top:10px;">
      <h4 style="font-size:12px; font-weight:800; margin-bottom:10px; color:var(--color-text-tertiary); text-transform:uppercase;">Comercios Registrados</h4>
      <div id="wa-commerces-list" style="display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:12px; color:var(--color-text-tertiary); text-align:center; padding:12px;">Cargando comercios...</div>
      </div>
    </div>
  `;

  const m = showModal({ title: "", content: modalContent, showConfirm: false });

  const loadList = async () => {
    const listEl = modalContent.querySelector("#wa-commerces-list");
    try {
      const snap = await getDocs(collection(db, "whatsapp_commerces"));
      if (snap.empty) {
        listEl.innerHTML = `<div style="font-size:12px; color:var(--color-text-tertiary); text-align:center; padding:16px; background:var(--color-surface); border-radius:12px;">No hay comercios de WhatsApp registrados aún.</div>`;
        return;
      }
      listEl.innerHTML = snap.docs.map(docSnap => {
        const d = docSnap.data();
        return `
          <div style="display:flex; align-items:center; justify-space-between; padding:12px 16px; background:var(--color-surface); border-radius:14px; border:1px solid var(--color-border-light);">
            <div style="flex:1;">
              <div style="font-size:14px; font-weight:900; color:var(--color-text-primary);">${d.name}</div>
              <div style="font-size:11px; color:#25D366; font-weight:700; margin-top:2px;">📱 ${d.phone}</div>
              <div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">📍 ${d.address}</div>
            </div>
            <button class="delete-wa-comm-btn" data-id="${docSnap.id}" style="width:32px; height:32px; border-radius:10px; background:rgba(239,68,68,0.1); border:none; color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center;">
              ✕
            </button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.delete-wa-comm-btn').forEach(b => {
        b.onclick = async () => {
          await deleteDoc(doc(db, "whatsapp_commerces", b.dataset.id));
          showToast("Comercio eliminado", "info");
          loadList();
        };
      });
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<div style="font-size:12px; color:red;">Error al cargar lista.</div>`;
    }
  };

  modalContent.querySelector("#btn-save-wa-comm").onclick = async () => {
    const name = modalContent.querySelector("#wa-comm-name").value.trim();
    let phone = modalContent.querySelector("#wa-comm-phone").value.trim().replace(/\D/g, '');
    const address = modalContent.querySelector("#wa-comm-address").value.trim();

    if (!name || !phone || !address) {
      showToast("Completá todos los campos", "warning");
      return;
    }

    try {
      await addDoc(collection(db, "whatsapp_commerces"), {
        name,
        phone,
        address,
        createdAt: serverTimestamp()
      });
      showToast("Comercio agregado con éxito", "success");
      modalContent.querySelector("#wa-comm-name").value = "";
      modalContent.querySelector("#wa-comm-phone").value = "";
      modalContent.querySelector("#wa-comm-address").value = "";
      loadList();
    } catch (err) {
      console.error(err);
      showToast("Error al guardar comercio", "error");
    }
  };

  loadList();
}
export async function renderAdminDeliveriesSettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  if (!isAdmin()) {
    container.innerHTML = `<div class="empty-state"><p>No ten\xE9s acceso a esta secci\xF3n.</p></div>`;
    return;
  }
  const s = getState();
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Minimalist 1-Row Header (sticky) -->
      <div style="background:linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); padding:calc(12px + env(safe-area-inset-top, 0px)) 16px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-shrink:0; position:relative; box-shadow:0 4px 20px rgba(0,0,0,0.15); z-index:100; border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <a href="#/admin" style="width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; flex-shrink:0; transition:all 0.2s;">
            ${icon("chevronLeft", 20)}
          </a>
          <div style="display:flex; align-items:center; gap:8px; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <h1 style="font-family:var(--font-display); font-weight:900; font-size:16px; color:white; margin:0; letter-spacing:-0.02em; text-transform:uppercase;">REPARTIDORES</h1>
            <span style="color:rgba(255,255,255,0.3); font-size:12px;">\u2022</span>
            <span style="font-size:11px; color:rgba(255,255,255,0.65); font-weight:700; overflow:hidden; text-overflow:ellipsis;">Control & Cuotas</span>
          </div>
        </div>
        <button id="del-tab-config" style="width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; transition:all 0.2s;">
          ${icon("settings", 18)}
        </button>
      </div>

      <!-- Navigation Tabs (sticky) -->
      <div style="display:flex; background:var(--color-surface); border-bottom:1px solid var(--color-border-light); padding:8px 16px; gap:8px; flex-shrink:0;">
        <button id="del-tab-drivers" style="flex:1; height:38px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:center; gap:6px;">
          ${icon("bike", 16)} Repartidores
        </button>
        <button id="del-tab-settlements" style="flex:1; height:38px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:var(--color-bg-secondary); color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; position:relative;">
          ${icon("clock", 16)} Validaciones
          <span id="del-proofs-badge" style="display:none; position:absolute; top:-4px; right:-4px; background:#ef4444; color:white; font-size:9.5px; font-weight:900; padding:2px 6px; border-radius:10px; border:1.5px solid var(--color-surface);">0</span>
        </button>
        <button id="del-tab-settlements-history" style="flex:1; height:38px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:var(--color-bg-secondary); color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; gap:6px;">
          ${icon("history", 16)} Historial
        </button>
      </div>

      <!-- Sticky Search + Filter Bar (drivers tab only, shown/hidden by JS) -->
      <div id="deliveries-search-bar" style="background:var(--color-bg); border-bottom:1px solid var(--color-border-light); padding:10px 16px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; z-index:50;">
        <div style="position:relative; width:100%;">
          <input type="text" id="driver-search-input-sticky" placeholder="\u{1F50D} Buscar por nombre, email o ID (go-xxxx)..." style="width:100%; height:44px; border-radius:14px; padding:0 16px 0 42px; font-weight:700; font-size:13px; background:var(--color-surface); border:1.5px solid var(--color-border); color:var(--color-text); outline:none; box-sizing:border-box; box-shadow:var(--shadow-sm);" />
          <div style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); display:flex;">
            ${icon("search", 18)}
          </div>
        </div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:2px; -webkit-overflow-scrolling:touch; scrollbar-width:none;">
          <button class="driver-filter-sticky" data-filter="all" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-primary); color:white;">Todos</button>
          <button class="driver-filter-sticky" data-filter="online" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-surface); color:var(--color-text-secondary); border:1px solid var(--color-border);">\u{1F7E2} Conectados</button>
          <button class="driver-filter-sticky" data-filter="debt" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-surface); color:var(--color-text-secondary); border:1px solid var(--color-border);">\u26A0\uFE0F Con Deuda</button>
          <button class="driver-filter-sticky" data-filter="clean" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-surface); color:var(--color-text-secondary); border:1px solid var(--color-border);">\u2705 Al D\xEDa</button>
        </div>
      </div>

      <!-- Main Container -->
      <div id="deliveries-panel-body" style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;
  let activeTab = "drivers";
  let searchQuery = "";
  let settlementSearchQuery = "";
  let filterStatus = "all";
  let driversData = [];
  let canonPaymentsData = [];
  let settlementsData = [];
  let pendingProofsData = [];
  let unsubUsers = null;
  async function loadData() {
    try {
      const { onSnapshot, collection: collection2, query, where, getDocs: getDocs2 } = await import("firebase/firestore");
      if (unsubUsers) unsubUsers();
      // Filter only delivery drivers — avoids reading all users
      unsubUsers = onSnapshot(query(collection2(db, "users"), where("role", "==", "delivery")), (usersSnap) => {
        driversData = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (activeTab === "drivers") {
          renderTab();
        }
      }, (err) => {
        console.warn("Realtime drivers listener error:", err);
      });
      try {
        const { orderBy, limit, Timestamp } = await import("firebase/firestore");
        // Load only last 60 days of orders to reduce reads
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const qOrders = query(
          collection2(db, "orders"),
          where("createdAt", ">=", Timestamp.fromDate(sixtyDaysAgo)),
          orderBy("createdAt", "desc"),
          limit(200)
        );
        const ordersSnap = await getDocs2(qOrders);
        globalPendingOrders = ordersSnap.docs.map((doc2) => ({ id: doc2.id, ...doc2.data() }));
      } catch (err) {
        console.warn("Error loading orders for coupons credit:", err);
      }
      try {
        // Load canon payments for last 60 days only
        const { Timestamp: TS2 } = await import("firebase/firestore");
        const sixtyDaysAgo2 = new Date();
        sixtyDaysAgo2.setDate(sixtyDaysAgo2.getDate() - 60);
        const canonQ = query(collection2(db, "delivery_canon_payments"), where("createdAt", ">=", TS2.fromDate(sixtyDaysAgo2)));
        const canonSnap = await getDocs2(canonQ);
        canonPaymentsData = canonSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn("Error loading cuota payments:", err);
      }
      try {
        const settlementsSnap = await getDocs2(collection2(db, "delivery_debt_settlements"));
        settlementsData = settlementsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      } catch (err) {
        console.warn("Error loading settlements:", err);
      }
      try {
        const proofsSnap = await getDocs2(collection2(db, "delivery_settlement_proofs"));
        pendingProofsData = proofsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        const pendingCount = pendingProofsData.filter((p) => p.status === "pending").length;
        const badgeEl = document.getElementById("del-proofs-badge");
        if (badgeEl) {
          if (pendingCount > 0) {
            badgeEl.textContent = pendingCount;
            badgeEl.style.display = "block";
          } else {
            badgeEl.style.display = "none";
          }
        }
      } catch (err) {
        console.warn("Error loading pending proofs:", err);
      }
    } catch (err) {
      console.error("Error loading deliveries data:", err);
      showToast("Error al cargar informaci\xF3n de repartidores", "error");
    }
  }
  function switchTab(tab) {
    activeTab = tab;
    ["drivers", "settlements", "settlements-history", "config"].forEach((t) => {
      const btn = document.getElementById(`del-tab-${t}`);
      if (btn) {
        if (t === tab) {
          btn.style.background = "var(--color-primary)";
          btn.style.color = "white";
        } else {
          btn.style.background = "var(--color-bg-secondary)";
          btn.style.color = "var(--color-text-secondary)";
        }
      }
    });
    const searchBar = document.getElementById("deliveries-search-bar");
    if (searchBar) searchBar.style.display = tab === "drivers" ? "flex" : "none";
    renderTab();
  }
  function renderTab() {
    const body = document.getElementById("deliveries-panel-body");
    if (!body) return;
    if (activeTab === "drivers") {
      renderDriversTab(body);
    } else if (activeTab === "settlements") {
      renderSettlementsTab(body);
    } else if (activeTab === "settlements-history") {
      renderSettlementsHistoryTab(body);
    } else if (activeTab === "config") {
      renderConfigTab(body);
    }
  }
  function openIndividualHistoryModal(driver) {
    const displayId = driver.deliveryId || driver.goId || driver.customId || "go-" + driver.id.slice(0, 4);
    const modalHtml = `
      <div id="individual-history-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(6px); z-index:10000; display:flex; align-items:center; justify-content:center; padding:16px;">
        <div style="background:var(--color-surface); border-radius:24px; width:100%; max-width:500px; max-height:85dvh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.3); overflow:hidden; border:1px solid var(--color-border-light);">
          
          <!-- Header -->
          <div style="padding:18px 20px; border-bottom:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; background:var(--color-bg-secondary);">
            <div>
              <div style="font-family:var(--font-display); font-size:16px; font-weight:900; color:var(--color-text);">Historial de Cobros</div>
              <div style="font-size:12px; font-weight:700; color:var(--color-primary); margin-top:2px;">${driver.displayName || driver.name} (${displayId})</div>
            </div>
            <button id="close-ind-modal-btn" style="width:32px; height:32px; border-radius:50%; background:rgba(0,0,0,0.06); border:none; color:var(--color-text); font-weight:900; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center;">\u2715</button>
          </div>

          <!-- Body -->
          <div id="ind-modal-body" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch;">
            <div class="loader-dots" style="margin:20px auto;"><span></span><span></span><span></span></div>
          </div>

        </div>
      </div>
    `;
    const div = document.createElement("div");
    div.id = "ind-modal-container";
    div.innerHTML = modalHtml;
    document.body.appendChild(div);
    document.getElementById("close-ind-modal-btn").onclick = () => div.remove();
    const driverSettlements = settlementsData.filter((s2) => s2.driverId === driver.id);
    const body = document.getElementById("ind-modal-body");
    if (!body) return;
    if (driverSettlements.length === 0) {
      body.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary);">
          ${icon("receipt", 40)}
          <p style="margin-top:12px; font-weight:700;">Este repartidor no registra cobros o liquidaciones previas.</p>
        </div>
      `;
      return;
    }
    body.innerHTML = driverSettlements.map((s2) => {
      const dateStr = s2.createdAt?.toDate ? s2.createdAt.toDate().toLocaleString("es-AR") : "Reciente";
      const methodText = s2.method === "transferencia" ? "\u{1F3E6} Transferencia" : "\u{1F4B5} Efectivo";
      return `
        <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:14px; display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-weight:900; font-size:15px; color:#22c55e;">+${formatPrice(s2.amount)}</div>
            <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">${methodText} \u2022 ${dateStr}</div>
            ${s2.notes ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:4px; font-style:italic;">"${s2.notes}"</div>` : ""}
          </div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); background:var(--color-surface); padding:4px 8px; border-radius:8px; border:1px solid var(--color-border-light);">
            Por ${s2.settledBy || "Admin"}
          </div>
        </div>
      `;
    }).join("");
  }
  function bindPendingProofListeners(body, renderFn) {
    body.querySelectorAll(".approve-proof-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.proofId;
        const proof = pendingProofsData.find((p) => p.id === id);
        if (!proof) return;
        btn.disabled = true;
        btn.innerHTML = "Aprobando...";
        try {
          const { writeBatch: writeBatch2, doc: doc2, collection: collection2, serverTimestamp: serverTimestamp2 } = await import("firebase/firestore");
          const batch = writeBatch2(db);
          const driver = driversData.find((d) => d.id === proof.driverId);
          const currentDebt = driver ? driver.deliveryDebt || 0 : proof.amount;
          const newDebt = Math.max(0, currentDebt - proof.amount);
          const adminEmail = getState().user?.email || "Admin";
          batch.update(doc2(db, "users", proof.driverId), {
            deliveryDebt: newDebt
          });
          const settlementRef = doc2(collection2(db, "delivery_debt_settlements"));
          batch.set(settlementRef, {
            driverId: proof.driverId,
            driverName: proof.driverName || "Repartidor",
            driverEmail: driver?.email || "",
            amount: proof.amount,
            method: "transferencia",
            notes: "Aprobaci\xF3n comprobante nativo app",
            settledBy: adminEmail,
            createdAt: serverTimestamp2()
          });
          const transRef = doc2(collection2(db, "delivery_transactions"));
          batch.set(transRef, {
            driverId: proof.driverId,
            type: "liquidation",
            amount: -proof.amount,
            description: `Aprobaci\xF3n Comprobante Nativa App`,
            settledBy: adminEmail,
            createdAt: serverTimestamp2()
          });
          batch.update(doc2(db, "delivery_settlement_proofs", id), {
            status: "approved",
            settledAt: serverTimestamp2(),
            settledBy: adminEmail
          });
          await batch.commit();
          showToast("\u2705 Comprobante aprobado con \xE9xito.", "success");
          await loadData();
          renderFn();
        } catch (err) {
          console.error(err);
          showToast("\u274C Error al aprobar comprobante.", "error");
          btn.disabled = false;
          btn.innerHTML = `${icon("check", 12)} Aprobar Pago`;
        }
      };
    });
    body.querySelectorAll(".reject-proof-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.proofId;
        btn.disabled = true;
        btn.innerHTML = "Rechazando...";
        try {
          const { doc: doc2, updateDoc: updateDoc2, serverTimestamp: serverTimestamp2 } = await import("firebase/firestore");
          await updateDoc2(doc2(db, "delivery_settlement_proofs", id), {
            status: "rejected",
            rejectedAt: serverTimestamp2(),
            rejectedBy: getState().user?.email || "Admin"
          });
          showToast("\u274C Comprobante rechazado.", "warning");
          await loadData();
          renderFn();
        } catch (err) {
          console.error(err);
          showToast("\u274C Error al rechazar comprobante.", "error");
          btn.disabled = false;
          btn.innerHTML = `${icon("x", 12)} Rechazar`;
        }
      };
    });
  }
  function renderDriversTab(body) {
    const totalDebt = driversData.reduce((sum, d) => sum + (d.deliveryDebt || 0), 0);
    const onlineCount = driversData.filter((d) => d.isOnline === true).length;
    const activeTodayCount = driversData.filter((d) => d.lastCanonDate === todayStr || d.isOnline === true).length;
    const paidCanonTodayCount = driversData.filter((d) => d.lastCanonDate === todayStr).length;
    const withDebtCount = driversData.filter((d) => (d.deliveryDebt || 0) > 0).length;
    const cleanCount = driversData.filter((d) => (d.deliveryDebt || 0) <= 0).length;
    const filteredDrivers = driversData.filter((d) => {
      const name = (d.displayName || d.name || "").toLowerCase();
      const email = (d.email || "").toLowerCase();
      const dlId = (d.deliveryId || d.goId || d.customId || "go-" + d.id.slice(0, 4)).toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || name.includes(q) || email.includes(q) || dlId.includes(q);
      const debt = d.deliveryDebt || 0;
      const isOnline = d.isOnline === true;
      if (!matchesSearch) return false;
      if (filterStatus === "online") return isOnline;
      if (filterStatus === "debt") return debt > 0;
      if (filterStatus === "clean") return debt <= 0;
      if (filterStatus === "active") return d.lastCanonDate === todayStr || isOnline;
      return true;
    });
    body.innerHTML = `
      <!-- KPI Summary Header -->
      <div style="background: linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); border-radius: 24px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); color: white;">
        <div style="font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px;">Deuda Total Acumulada (Repartidores)</div>
        <div style="font-size: 34px; font-weight: 950; letter-spacing: -1.5px; margin: 4px 0 16px; color: #ef4444;">${formatPrice(totalDebt)}</div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);">
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 14px; text-align: center;">
            <div style="font-size: 8.5px; font-weight: 800; color: rgba(255,255,255,0.6); text-transform: uppercase;">Total</div>
            <div style="font-size: 15px; font-weight: 900; margin-top: 2px;">${driversData.length}</div>
          </div>
          <div style="background: rgba(34,197,94,0.12); padding: 8px; border-radius: 14px; text-align: center; border: 1px solid rgba(34,197,94,0.25);">
            <div style="font-size: 8.5px; font-weight: 800; color: #22c55e; text-transform: uppercase;">Conectados</div>
            <div style="font-size: 15px; font-weight: 900; color: #22c55e; margin-top: 2px;">${onlineCount}</div>
          </div>
          <div style="background: rgba(59,130,246,0.1); padding: 8px; border-radius: 14px; text-align: center; border: 1px solid rgba(59,130,246,0.2);">
            <div style="font-size: 8.5px; font-weight: 800; color: #60a5fa; text-transform: uppercase;">Activos Hoy</div>
            <div style="font-size: 15px; font-weight: 900; color: #60a5fa; margin-top: 2px;">${activeTodayCount}</div>
          </div>
          <div style="background: rgba(234,179,8,0.1); padding: 8px; border-radius: 14px; text-align: center; border: 1px solid rgba(234,179,8,0.2);">
            <div style="font-size: 8.5px; font-weight: 800; color: #eab308; text-transform: uppercase;">Cuota Hoy</div>
            <div style="font-size: 15px; font-weight: 900; color: #eab308; margin-top: 2px;">${paidCanonTodayCount}</div>
          </div>
        </div>
      </div>



      <!-- Drivers List Section -->
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <h3 style="font-family:var(--font-display); font-size:14px; font-weight:900; margin:0; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Resultados (${filteredDrivers.length})</h3>
        </div>

        ${filteredDrivers.length === 0 ? `
          <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:20px; border:1px dashed var(--color-border-light);">
            ${icon("search", 32)}
            <p style="margin-top:12px; font-weight:700;">No se encontraron repartidores con los criterios de b\xFAsqueda.</p>
          </div>
        ` : filteredDrivers.map((d) => {
      const debt = d.deliveryDebt || 0;
      const isCanonPaidToday = d.lastCanonDate === todayStr;
      const isExempt = d.isCanonExempt === true;
      const isOnlineNow = d.isOnline === true;
      const photo = d.photoURL || d.avatarUrl || d.photo || d.profileImage || "";
      const displayId = d.deliveryId || d.goId || d.customId || "go-" + d.id.slice(0, 4);
      const driverOrders = globalPendingOrders.filter((o) => o.driverId === d.id && o.isSettledDriver !== true && (o.status === "delivered" || o.status === "completed"));
      const totalCouponsCredit = driverOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
      const finalSettleAmount = Math.max(0, debt - totalCouponsCredit);
      return `
            <div style="background:var(--color-surface); border:1.5px solid ${finalSettleAmount > 0 ? "rgba(239,68,68,0.25)" : "var(--color-border-light)"}; border-radius:24px; padding:18px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px; transition:all 0.2s;">
              
              <!-- Driver Header -->
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                  <div style="position:relative; width:48px; height:48px; flex-shrink:0;">
                    ${photo ? `
                      <img src="${photo}" alt="${d.displayName || d.name}" style="width:48px; height:48px; border-radius:16px; object-fit:cover; border:2px solid var(--color-border-light); background:var(--color-bg-secondary);" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                      <div style="display:none; width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#fee2e2,#fca5a5); color:#dc2626; font-weight:900; align-items:center; justify-content:center; font-size:16px;">
                        ${(d.displayName || d.name || "D").charAt(0).toUpperCase()}
                      </div>
                    ` : `
                      <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#fee2e2,#fca5a5); color:#dc2626; font-weight:900; display:flex; align-items:center; justify-content:center; font-size:16px;">
                        ${(d.displayName || d.name || "D").charAt(0).toUpperCase()}
                      </div>
                    `}
                    <span style="position:absolute; bottom:-2px; right:-2px; width:12px; height:12px; border-radius:50%; background:${isOnlineNow ? "#22c55e" : "#cbd5e1"}; border:2.5px solid var(--color-surface); ${isOnlineNow ? "box-shadow:0 0 8px #22c55e;" : ""}" title="${isOnlineNow ? "Conectado y Disponible" : "Desconectado"}"></span>
                  </div>
                  
                  <div style="min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                      <span style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">${d.displayName || d.name || "Repartidor sin nombre"}</span>
                      <span style="font-size:10px; font-weight:900; background:rgba(225,29,72,0.08); color:var(--color-primary); padding:2px 7px; border-radius:8px; font-family:monospace; border:1px solid rgba(225,29,72,0.15); letter-spacing:0.5px;">${displayId}</span>
                    </div>
                    <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.email || d.phone || "Sin contacto"}</div>
                  </div>
                </div>

                <!-- Badges -->
                <div style="flex-shrink:0;">
                  ${isExempt ? `
                    <span style="background:rgba(168,85,247,0.1); color:#a855f7; font-size:10.5px; font-weight:800; padding:5px 10px; border-radius:10px; border:1px solid rgba(168,85,247,0.2);">\u{1F39F}\uFE0F Eximido</span>
                  ` : isOnlineNow ? `
                    <span style="background:rgba(34,197,94,0.12); color:#22c55e; font-size:10.5px; font-weight:900; padding:5px 10px; border-radius:10px; border:1px solid rgba(34,197,94,0.25); box-shadow:0 0 10px rgba(34,197,94,0.2);">\u{1F7E2} Conectado</span>
                  ` : isCanonPaidToday ? `
                    <span style="background:rgba(59,130,246,0.1); color:#3b82f6; font-size:10.5px; font-weight:800; padding:5px 10px; border-radius:10px; border:1px solid rgba(59,130,246,0.2);">\u2705 Cuota Hoy</span>
                  ` : debt <= 0 ? `
                    <span style="background:rgba(34,197,94,0.1); color:#22c55e; font-size:10.5px; font-weight:800; padding:5px 10px; border-radius:10px; border:1px solid rgba(34,197,94,0.2);">\u2705 Al D\xEDa</span>
                  ` : `
                    <span style="background:rgba(239,68,68,0.1); color:#ef4444; font-size:10.5px; font-weight:800; padding:5px 10px; border-radius:10px; border:1px solid rgba(239,68,68,0.2);">\u26A0\uFE0F Debe Cuota</span>
                  `}
                </div>
              </div>

              <!-- Debt Info -->
              ${totalCouponsCredit > 0 ? `
                <div data-driver-debt-info="${d.id}" style="background:linear-gradient(135deg, rgba(239,68,68,0.01) 0%, rgba(239,68,68,0.04) 100%); border:1.5px solid var(--color-border-light); border-radius:20px; padding:14px; display:flex; flex-direction:column; gap:10px; box-shadow:inset 0 1px 3px rgba(0,0,0,0.02); cursor:pointer; transition:all 0.2s;" onmouseover="this.style.borderColor='rgba(225,29,72,0.3)'; this.style.background='rgba(225,29,72,0.01)';" onmouseout="this.style.borderColor='var(--color-border-light)'; this.style.background='linear-gradient(135deg, rgba(239,68,68,0.01) 0%, rgba(239,68,68,0.04) 100%)';">
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; border-bottom:1px dashed var(--color-border-light); padding-bottom:8px;">
                    <div>
                      <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em; display:flex; align-items:center; gap:4px;">
                        Deuda Sistema
                      </div>
                      <div style="font-size:15px; font-weight:900; color:#ef4444; margin-top:2px;">${formatPrice(debt)}</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:9px; font-weight:800; color:#a855f7; text-transform:uppercase; letter-spacing:0.04em;">Descuentos/Cupones</div>
                      <div style="font-size:15px; font-weight:900; color:#a855f7; margin-top:2px;">-${formatPrice(totalCouponsCredit)}</div>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                      <div style="font-size:9px; font-weight:850; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Neto a Liquidar</div>
                      <div style="font-size:20px; font-weight:950; color:${finalSettleAmount > 0 ? "#10b981" : "#22c55e"}; letter-spacing:-0.5px; margin-top:2px;">${formatPrice(finalSettleAmount)}</div>
                    </div>
                    <span style="font-size:9.5px; font-weight:900; color:white; background:#10b981; padding:5px 10px; border-radius:8px; box-shadow:0 3px 8px rgba(16,185,129,0.2); display:flex; align-items:center; gap:4px;">
                      Neto Ajustado ${icon("info", 11, "", "white")}
                    </span>
                  </div>
                </div>
              ` : `
                <div ${debt > 0 ? `data-driver-debt-info="${d.id}" style="background:linear-gradient(135deg, rgba(239,68,68,0.04) 0%, rgba(239,68,68,0.08) 100%); border:1.5px solid rgba(239,68,68,0.15); cursor:pointer;` : `style="background:linear-gradient(135deg, rgba(34,197,94,0.04) 0%, rgba(34,197,94,0.08) 100%); border:1px solid rgba(34,197,94,0.15);`} border-radius:18px; padding:14px; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s;" ${debt > 0 ? `onmouseover="this.style.borderColor='rgba(239,68,68,0.4)'; this.style.background='rgba(239,68,68,0.06)';" onmouseout="this.style.borderColor='rgba(239,68,68,0.15)'; this.style.background='linear-gradient(135deg, rgba(239,68,68,0.04) 0%, rgba(239,68,68,0.08) 100%)';"` : ""}>
                  <div>
                    <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">
                      Deuda Acumulada
                    </div>
                    <div style="font-size:22px; font-weight:950; color:${debt > 0 ? "#ef4444" : "#22c55e"}; letter-spacing:-0.5px; margin-top:2px;">${formatPrice(debt)}</div>
                  </div>
                  <div>
                    ${debt > 0 ? `
                      <span style="font-size:11px; font-weight:900; color:white; background:#ef4444; padding:6px 12px; border-radius:10px; box-shadow:0 3px 8px rgba(239,68,68,0.25); display:flex; align-items:center; gap:4px;">
                        Saldo Pendiente ${icon("info", 11, "", "white")}
                      </span>
                    ` : `
                      <span style="font-size:11px; font-weight:800; color:#22c55e; background:white; border:1px solid rgba(34,197,94,0.2); padding:5px 10px; border-radius:10px; box-shadow:0 2px 6px rgba(34,197,94,0.1);">Al D\xEDa</span>
                    `}
                  </div>
                </div>
              `}

              <!-- Primary Action Buttons -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button data-wsp-driver="${d.id}" style="height:46px; border-radius:16px; background:linear-gradient(135deg, #25D366 0%, #128C7E 100%); color:white; border:none; font-weight:900; font-size:12.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:0 6px 16px rgba(37,211,102,0.25); transition:transform 0.15s active;">
                  ${icon("whatsappLogo", 18)} WhatsApp Cobro
                </button>
                <button data-settle-driver="${d.id}" style="height:46px; border-radius:16px; background:${finalSettleAmount > 0 ? "linear-gradient(135deg, #E11D48 0%, #BE123C 100%)" : "var(--color-bg-secondary)"}; color:${finalSettleAmount > 0 ? "white" : "var(--color-text-tertiary)"}; border:none; font-weight:900; font-size:12.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:${finalSettleAmount > 0 ? "0 6px 16px rgba(225,29,72,0.25)" : "none"}; opacity:${finalSettleAmount > 0 ? "1" : "0.6"};">
                  ${icon("bank", 18)} Liquidar Deuda
                </button>
              </div>

              <!-- Quick Toggles & Controls -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; border-top:1px dashed var(--color-border-light); padding-top:12px;">
                <button data-toggle-online="${d.id}" style="height:34px; border-radius:10px; background:${isOnlineNow ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)"}; border:1px solid ${isOnlineNow ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)"}; color:${isOnlineNow ? "#ef4444" : "#22c55e"}; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                  ${isOnlineNow ? "\u26D4 Desconectar" : "\u{1F50C} Conectar"}
                </button>
                <button data-toggle-canon="${d.id}" style="height:34px; border-radius:10px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); color:var(--color-text); font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                  ${isCanonPaidToday ? "\u21A9\uFE0F Cuota Hoy" : "\u{1F4B5} Cuota Hoy"}
                </button>
              </div>

              <!-- History Buttons -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; border-top:1px dashed var(--color-border-light); padding-top:12px;">
                <button data-driver-orders="${d.id}" style="height:34px; border-radius:10px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); color:#6366f1; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;">
                  ${icon("bag", 13)} Hist. Pedidos
                </button>
                <button data-driver-payments="${d.id}" style="height:34px; border-radius:10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2); color:#10b981; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;">
                  ${icon("bank", 13)} Hist. Pagos
                </button>
              </div>

            </div>
          `;
    }).join("")}
      </div>
    `;
    const searchInput = body.querySelector("#driver-search-input");
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchQuery = e.target.value;
        renderDriversTab(body);
        const updatedInput = body.querySelector("#driver-search-input");
        if (updatedInput) {
          updatedInput.focus();
          updatedInput.setSelectionRange(searchQuery.length, searchQuery.length);
        }
      };
    }
    const clearBtn = body.querySelector("#clear-search-btn");
    if (clearBtn) {
      clearBtn.onclick = () => {
        searchQuery = "";
        renderDriversTab(body);
      };
    }
    body.querySelectorAll(".driver-filter-btn").forEach((btn) => {
      btn.onclick = () => {
        filterStatus = btn.dataset.filter;
        renderDriversTab(body);
      };
    });
    body.querySelectorAll("[data-wsp-driver]").forEach((btn) => {
      btn.onclick = () => {
        const uid = btn.dataset.wspDriver;
        const driver = driversData.find((d) => d.id === uid);
        if (!driver) return;
        const phone = (driver.phone || driver.whatsapp || "").replace(/\D/g, "");
        if (!phone) {
          showToast("El repartidor no tiene n\xFAmero de tel\xE9fono registrado.", "error");
          return;
        }
        const debt = driver.deliveryDebt || 0;
        const bankAlias = getState().bankAlias || getState().whatsappPayments || "godelivery.oficial";
        const text = `Hola ${driver.displayName || driver.name}! Te escribimos de GoDelivery para recordarte la rendici\xF3n de tu saldo acumulado:

\u{1F4CC} Total Adeudado: ${formatPrice(debt)}

Pod\xE9s transferir al siguiente Alias:
\u{1F4B3} ALIAS: ${bankAlias}

Por favor, envi\xE1 el comprobante por este medio una vez realizada la transferencia. \xA1Muchas gracias!`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
      };
    });
    body.querySelectorAll("[data-settle-driver]").forEach((btn) => {
      btn.onclick = () => {
        const driver = driversData.find((d) => d.id === btn.dataset.settleDriver);
        if (driver) openSettlementsModal(driver);
      };
    });
    body.querySelectorAll("[data-toggle-online]").forEach((btn) => {
      btn.onclick = async () => {
        const uid = btn.dataset.toggleOnline;
        const driver = driversData.find((d) => d.id === uid);
        if (!driver) return;
        const newStatus = !(driver.isOnline === true);
        showConfirm({
          title: "Estado de Conexi\xF3n",
          message: `\xBFQuer\xE9s ${newStatus ? "CONECTAR" : "DESCONECTAR"} a ${driver.displayName || driver.name}?`,
          onConfirm: async () => {
            try {
              const { doc: doc2, updateDoc: updateDoc2, setDoc: setDoc2, increment, serverTimestamp: fTimestamp } = await import("firebase/firestore");
              const updateData = {
                isOnline: newStatus,
                lastActivityAt: fTimestamp()
              };
              let chargedCanonThisConnection = false;
              const isExempt = driver.isCanonExempt === true || driver.role === "admin" || driver.isAdmin === true;
              if (newStatus && !isExempt && driver.lastCanonChargeDate !== todayStr) {
                const canonAmt = getState().canonAmount || 2e3;
                const canonDocRef = doc2(db, "delivery_canon_payments", `${uid}_${todayStr}`);
                await setDoc2(canonDocRef, {
                  driverId: uid,
                  driverName: driver.displayName || driver.name || "Repartidor",
                  dateStr: todayStr,
                  amount: canonAmt,
                  settled: false,
                  createdAt: fTimestamp()
                }, { merge: true });
                const transRef = doc2(collection(db, "delivery_transactions"));
                await setDoc2(transRef, {
                  driverId: uid,
                  type: "canon_charge",
                  amount: canonAmt,
                  description: `Canon Diario Jornada (${todayStr})`,
                  createdAt: fTimestamp()
                });
                updateData.deliveryDebt = increment(canonAmt);
                updateData.lastCanonChargeDate = todayStr;
                updateData.lastCanonDate = todayStr;
                driver.lastCanonDate = todayStr;
                driver.lastCanonChargeDate = todayStr;
                driver.deliveryDebt = (driver.deliveryDebt || 0) + canonAmt;
                chargedCanonThisConnection = true;
              }
              await updateDoc2(doc2(db, "users", uid), updateData);
              driver.isOnline = newStatus;
              if (chargedCanonThisConnection) {
                showToast(`Repartidor conectado. Se sumaron $${(getState().canonAmount || 2e3).toLocaleString("es-AR")} de canon diario.`, "info");
              } else {
                showToast(`Repartidor ${newStatus ? "conectado" : "desconectado"} correctamente`, "success");
              }
              renderDriversTab(body);
            } catch (err) {
              console.error(err);
              showToast("Error al cambiar estado de conexi\xF3n", "error");
            }
          }
        });
      };
    });
    body.querySelectorAll("[data-driver-history]").forEach((btn) => {
      btn.onclick = () => {
        const uid = btn.dataset.driverHistory;
        const driver = driversData.find((d) => d.id === uid);
        if (!driver) return;
        openIndividualHistoryModal(driver);
      };
    });
    body.querySelectorAll("[data-toggle-canon]").forEach((btn) => {
      btn.onclick = async () => {
        const uid = btn.dataset.toggleCanon;
        const driver = driversData.find((d) => d.id === uid);
        if (!driver) return;
        const isCurrentlyActive = driver.lastCanonDate === todayStr;
        const actionText = isCurrentlyActive ? "desmarcar" : "marcar como abonado";
        showConfirm({
          title: "Cuota Diaria",
          message: `\xBFQuer\xE9s ${actionText} la cuota diaria de hoy de ${driver.displayName || driver.name}?`,
          onConfirm: async () => {
            try {
              const canonDocRef = doc(db, "delivery_canon_payments", `${uid}_${todayStr}`);
              if (!isCurrentlyActive) {
                await setDoc(canonDocRef, {
                  driverId: uid,
                  date: todayStr,
                  amount: getState().canonAmount || 2e3,
                  settled: true,
                  createdAt: serverTimestamp()
                }, { merge: true });
                await updateDoc(doc(db, "users", uid), { lastCanonDate: todayStr, lastCanonChargeDate: todayStr });
                driver.lastCanonDate = todayStr;
              } else {
                await setDoc(canonDocRef, { status: "revoked", settled: false, updatedAt: serverTimestamp() }, { merge: true });
                await updateDoc(doc(db, "users", uid), { lastCanonDate: null, lastCanonChargeDate: null });
                driver.lastCanonDate = null;
              }
              showToast("Cuota diaria actualizada", "success");
              loadData();
            } catch (err) {
              console.error(err);
              showToast("Error al actualizar cuota diaria", "error");
            }
          }
        });
      };
    });
    body.querySelectorAll("[data-toggle-exempt]").forEach((btn) => {
      btn.onclick = async () => {
        const uid = btn.dataset.toggleExempt;
        const driver = driversData.find((d) => d.id === uid);
        if (!driver) return;
        const newExempt = !driver.isCanonExempt;
        showConfirm({
          title: "Exenci\xF3n de Cuota Diaria",
          message: `\xBFQuer\xE9s ${newExempt ? "EXIMIR permanentemente" : "REQUERIR"} la cuota diaria a ${driver.displayName || driver.name}?`,
          onConfirm: async () => {
            try {
              await updateDoc(doc(db, "users", uid), { isCanonExempt: newExempt });
              driver.isCanonExempt = newExempt;
              showToast("Estado de exenci\xF3n actualizado", "success");
              loadData();
            } catch (err) {
              console.error(err);
              showToast("Error al actualizar exenci\xF3n", "error");
            }
          }
        });
      };
    });
    body.querySelectorAll("[data-driver-orders]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const uid = btn.dataset.driverOrders;
        const driver = driversData.find((d) => d.id === uid);
        if (driver) showDriverOrderHistoryModal(driver, db);
      };
    });
    body.querySelectorAll("[data-driver-payments]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const uid = btn.dataset.driverPayments;
        const driver = driversData.find((d) => d.id === uid);
        if (driver) showDriverPaymentHistoryModal(driver, db);
      };
    });
    body.querySelectorAll("[data-driver-debt-info]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const uid = btn.dataset.driverDebtInfo;
        const driver = driversData.find((d) => d.id === uid);
        if (driver) showDriverDebtDetailModal(driver, db);
      };
    });
    bindPendingProofListeners(body, () => renderDriversTab(body));
  }
  function renderSettlementsTab(body) {
    window.showImageFullscreen = (url) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.9); backdrop-filter:blur(12px); display:flex; align-items:center; justify-content:center; z-index:99999; opacity:0; transition:opacity 0.2s ease; cursor:pointer;";
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "max-width:94%; max-height:85%; border-radius:24px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.6); border:1.5px solid rgba(255,255,255,0.15); transform:scale(0.95); transition:transform 0.2s ease;";
      const closeBtn = document.createElement("div");
      closeBtn.innerHTML = "\u2715";
      closeBtn.style.cssText = "position:absolute; top:calc(20px + env(safe-area-inset-top, 0px)); right:20px; color:white; font-size:24px; font-weight:900; background:rgba(255,255,255,0.1); width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.15); cursor:pointer;";
      overlay.appendChild(img);
      overlay.appendChild(closeBtn);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        img.style.transform = "scale(1)";
      });
      overlay.onclick = () => {
        overlay.style.opacity = "0";
        img.style.transform = "scale(0.95)";
        setTimeout(() => overlay.remove(), 200);
      };
    };
    const activePendingProofs = pendingProofsData.filter((p) => p.status === "pending");
    let pendingProofsHtml = "";
    if (activePendingProofs.length > 0) {
      pendingProofsHtml = `
        <div style="background:rgba(225, 29, 72, 0.04); border:1.5px solid rgba(225, 29, 72, 0.15); border-radius:24px; padding:20px; display:flex; flex-direction:column; gap:14px; margin-bottom:20px;">
          <h4 style="margin:0; font-family:var(--font-display); font-size:14px; font-weight:900; color:#E11D48; display:flex; align-items:center; gap:8px;">
            ${icon("clock", 16)} Validaciones Pendientes (${activePendingProofs.length})
          </h4>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${activePendingProofs.map((p) => {
        const dateStr = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString("es-AR") : "Reciente";
        return `
                <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow:var(--shadow-sm);">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                      <div style="font-weight:900; font-size:14px; color:var(--color-text-primary);">${p.driverName || "Repartidor"}</div>
                      <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">ID: ${p.driverDeliveryId || "---"} \u2022 ${dateStr}</div>
                      <div style="font-size:16px; font-weight:950; color:#E11D48; margin-top:6px;">Monto: ${formatPrice(p.amount)}</div>
                    </div>
                    <div style="position:relative; width:64px; height:64px; border-radius:12px; overflow:hidden; border:1.5px solid var(--color-border-light); cursor:pointer;" onclick="window.showImageFullscreen('${p.imageUrl}')">
                      <img src="${p.imageUrl}" style="width:100%; height:100%; object-fit:cover;" />
                      <div style="position:absolute; inset:0; background:rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; color:white; font-size:9px; font-weight:900;">AMPLIAR</div>
                    </div>
                  </div>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <button class="reject-proof-btn" data-proof-id="${p.id}" style="height:36px; border-radius:10px; background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.2); color:#ef4444; font-weight:900; font-size:11px; cursor:pointer; text-transform:uppercase; display:flex; align-items:center; justify-content:center; gap:4px; transition:all 0.2s;">
                      ${icon("x", 12)} Rechazar
                    </button>
                    <button class="approve-proof-btn" data-proof-id="${p.id}" style="height:36px; border-radius:10px; background:#10b981; border:none; color:white; font-weight:900; font-size:11px; cursor:pointer; text-transform:uppercase; display:flex; align-items:center; justify-content:center; gap:4px; transition:all 0.2s; box-shadow:0 4px 10px rgba(16, 185, 129, 0.2);">
                      ${icon("check", 12)} Aprobar Pago
                    </button>
                  </div>
                </div>
              `;
      }).join("")}
          </div>
        </div>
      `;
    } else {
      pendingProofsHtml = `
        <div style="text-align:center; padding:50px 20px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:24px; border:1px dashed var(--color-border-light); margin-top:20px;">
          ${icon("checkCircle", 42, "color:#10b981")}
          <h4 style="margin:16px 0 6px; font-size:14px; font-weight:900; color:var(--color-text-primary);">\xA1Todo al D\xEDa!</h4>
          <p style="margin:0; font-size:12px; font-weight:600;">No hay solicitudes de validaci\xF3n pendientes por aprobar.</p>
        </div>
      `;
    }
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        ${pendingProofsHtml}
      </div>
    `;
    bindPendingProofListeners(body, () => renderSettlementsTab(body));
  }
  function renderSettlementsHistoryTab(body) {
    const filteredSettlements = settlementsData.filter((s2) => {
      const q = settlementSearchQuery.toLowerCase().trim();
      if (!q) return true;
      const name = (s2.driverName || "").toLowerCase();
      const notes = (s2.notes || "").toLowerCase();
      const admin = (s2.settledBy || "").toLowerCase();
      const driver = driversData.find((d) => d.id === s2.driverId);
      const email = (driver?.email || "").toLowerCase();
      const dlId = (driver?.deliveryId || driver?.goId || driver?.customId || "go-" + (s2.driverId || "").slice(0, 4)).toLowerCase();
      return name.includes(q) || notes.includes(q) || admin.includes(q) || email.includes(q) || dlId.includes(q);
    });
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; color:var(--color-text); text-transform:uppercase; letter-spacing:0.02em;">Historial de Liquidaciones (${filteredSettlements.length})</h3>

        <!-- Search Bar -->
        <div style="position:relative; width:100%;">
          <input type="text" id="settlement-search-input" value="${settlementSearchQuery}" placeholder="\u{1F50D} Buscar cobro por repartidor, email o ID (go-xxxx)..." style="width:100%; height:46px; border-radius:14px; padding:0 16px 0 42px; font-weight:700; font-size:13px; background:var(--color-surface); border:1.5px solid var(--color-border); color:var(--color-text); outline:none; box-sizing:border-box;" />
          <div style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); display:flex;">
            ${icon("search", 18)}
          </div>
          ${settlementSearchQuery ? `
            <button id="clear-settlement-search" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.1); border:none; border-radius:50%; width:24px; height:24px; color:var(--color-text); cursor:pointer; font-weight:900; font-size:12px; display:flex; align-items:center; justify-content:center;">\u2715</button>
          ` : ""}
        </div>

        ${filteredSettlements.length === 0 ? `
          <div style="text-align:center; padding:50px 20px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:20px; border:1px dashed var(--color-border-light);">
            ${icon("receipt", 40)}
            <p style="margin-top:14px; font-weight:700;">No se encontraron liquidaciones con los criterios de b\xFAsqueda.</p>
          </div>
        ` : `
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${filteredSettlements.map((s2) => {
      const dateStr = s2.createdAt?.toDate ? s2.createdAt.toDate().toLocaleString("es-AR") : "Reciente";
      const methodText = s2.method === "transferencia" ? "\u{1F3E6} Transferencia" : "\u{1F4B5} Efectivo";
      return `
                <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm);">
                  <div style="display:flex; align-items:center; gap:14px;">
                    <div style="width:40px; height:40px; border-radius:12px; background:rgba(34,197,94,0.1); color:#22c55e; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                      ${icon("checkCircle", 20)}
                    </div>
                    <div>
                      <div style="font-weight:900; font-size:14.5px; color:var(--color-text);">${s2.driverName || "Repartidor"}</div>
                      <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">
                        ${methodText} \u2022 ${dateStr}
                      </div>
                      ${s2.notes ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:4px; font-style:italic;">"${s2.notes}"</div>` : ""}
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:18px; font-weight:950; color:#22c55e;">${formatPrice(s2.amount)}</div>
                    <div style="font-size:10px; color:var(--color-text-tertiary); font-weight:700;">Liquidado por ${s2.settledBy || "Admin"}</div>
                  </div>
                </div>
              `;
    }).join("")}
          </div>
        `}
      </div>
    `;
    const sInput = body.querySelector("#settlement-search-input");
    if (sInput) {
      sInput.oninput = (e) => {
        settlementSearchQuery = e.target.value;
        renderSettlementsHistoryTab(body);
        const updatedInput = body.querySelector("#settlement-search-input");
        if (updatedInput) {
          updatedInput.focus();
          updatedInput.setSelectionRange(settlementSearchQuery.length, settlementSearchQuery.length);
        }
      };
    }
    const clearS = body.querySelector("#clear-settlement-search");
    if (clearS) {
      clearS.onclick = () => {
        settlementSearchQuery = "";
        renderSettlementsHistoryTab(body);
      };
    }
  }
  function renderConfigTab(body) {
    const canonAmt = getState().canonAmount || 2e3;
    const bankAlias = getState().bankAlias || "godelivery.oficial";
    const bankOwner = getState().bankOwner || "GoDelivery S.R.L.";
    const whatsappPayments = getState().whatsappPayments || "5491123456789";
    const maxDebtLimit = getState().maxDebtLimit !== void 0 ? getState().maxDebtLimit : 15e3;
    const debtLimitEnabled = getState().debtLimitEnabled === true;
    body.innerHTML = `
      <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:20px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-sm);">
        <h3 style="font-family:var(--font-display); font-size:16px; font-weight:900; margin:0; color:var(--color-text);">Configuraci\xF3n de Repartidores</h3>
        
        <div>
          <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Cuota Diaria de Repartidores ($)</label>
          <input type="number" class="input" id="cfg-canon-amount" value="${canonAmt}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
        </div>

        <div>
          <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Alias Bancario para Transferencias</label>
          <input type="text" class="input" id="cfg-bank-alias" value="${bankAlias}" placeholder="Ej: godelivery.oficial" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
        </div>

        <div>
          <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Titular de la Cuenta Bancaria</label>
          <input type="text" class="input" id="cfg-bank-owner" value="${bankOwner}" placeholder="Ej: GoDelivery S.R.L." style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
        </div>

        <div>
          <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">WhatsApp de Pagos y Soporte (Finanzas)</label>
          <input type="text" class="input" id="cfg-whatsapp-payments" value="${whatsappPayments}" placeholder="Ej: 5491123456789" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
        </div>

        <div style="border-top: 1px dashed var(--color-border-light); padding-top: 16px;">
          <h4 style="margin: 0 0 12px; font-family: var(--font-display); font-size: 14px; font-weight: 900; color: var(--color-text);">Sem\xE1foro de Deuda (Bloqueo Autom\xE1tico)</h4>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary);">Habilitar Bloqueo por Deuda</span>
            <label class="switch" style="position: relative; display: inline-block; width: 44px; height: 24px;">
              <input type="checkbox" id="cfg-debt-limit-enabled" ${debtLimitEnabled ? "checked" : ""} style="opacity: 0; width: 0; height: 0;" />
              <span class="slider" style="position: absolute; cursor: pointer; inset: 0; background-color: #cbd5e1; transition: .3s; border-radius: 24px;"></span>
            </label>
          </div>
          <div>
            <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">L\xEDmite de Deuda M\xE1ximo ($)</label>
            <input type="number" class="input" id="cfg-max-debt-limit" value="${maxDebtLimit}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:15px;" />
          </div>
        </div>

        <style>
          .switch input:checked + .slider { background-color: var(--color-primary); }
          .slider:before {
            position: absolute; content: ""; height: 16px; width: 16px; left: 4px; bottom: 4px;
            background-color: white; transition: .3s; border-radius: 50%;
          }
          .switch input:checked + .slider:before { transform: translateX(20px); }
        </style>

        <button id="save-del-config-btn" style="height:48px; border-radius:14px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:8px; box-shadow:0 6px 16px rgba(var(--color-primary-rgb),0.25);">
          ${icon("check", 18)} Guardar Configuraci\xF3n
        </button>
      </div>
    `;
    const saveBtn = body.querySelector("#save-del-config-btn");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.innerHTML = "Guardando...";
        const newCanon = parseFloat(document.getElementById("cfg-canon-amount").value) || 2e3;
        const newAlias = document.getElementById("cfg-bank-alias").value.trim() || "godelivery.oficial";
        const newOwner = document.getElementById("cfg-bank-owner").value.trim() || "GoDelivery S.R.L.";
        const newWsp = document.getElementById("cfg-whatsapp-payments").value.trim() || "5491123456789";
        const newLimit = parseFloat(document.getElementById("cfg-max-debt-limit").value) || 15e3;
        const limitEnabled = document.getElementById("cfg-debt-limit-enabled").checked;
        try {
          await setDoc(doc(db, "settings", "global"), {
            canonAmount: newCanon,
            bankAlias: newAlias,
            bankOwner: newOwner,
            whatsappPayments: newWsp,
            maxDebtLimit: newLimit,
            debtLimitEnabled: limitEnabled
          }, { merge: true });
          setState("canonAmount", newCanon);
          setState("bankAlias", newAlias);
          setState("bankOwner", newOwner);
          setState("whatsappPayments", newWsp);
          setState("maxDebtLimit", newLimit);
          setState("debtLimitEnabled", limitEnabled);
          showToast("Configuraci\xF3n guardada correctamente.", "success");
        } catch (err) {
          console.error(err);
          showToast("Error al guardar configuraci\xF3n.", "error");
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = `${icon("check", 18)} Guardar Configuraci\xF3n`;
        }
      };
    }
  }
  function openSettlementsModal(driver) {
    const currentDebt = driver.deliveryDebt || 0;
    const driverOrders = globalPendingOrders.filter((o) => o.driverId === driver.id && o.isSettledDriver !== true && (o.status === "delivered" || o.status === "completed"));
    const totalCouponsCredit = driverOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
    const finalSettleAmount = Math.max(0, currentDebt - totalCouponsCredit);
    const modalContent = document.createElement("div");
    modalContent.style.cssText = "padding:20px; display:flex; flex-direction:column; gap:16px;";
    modalContent.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Repartidor</div>
        <div style="font-family:var(--font-display); font-size:18px; font-weight:900; color:var(--color-text); margin-top:2px;">${driver.displayName || driver.name}</div>
        
        ${totalCouponsCredit > 0 ? `
          <div style="margin-top:10px; padding:12px; background:var(--color-bg-secondary); border-radius:16px; font-size:12px; display:flex; flex-direction:column; gap:6px; text-align:left; border:1px solid var(--color-border-light); box-shadow:inset 0 1px 2px rgba(0,0,0,0.01);">
            <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
              <span>Deuda en Sistema:</span>
              <strong style="color:#ef4444; font-weight:800;">${formatPrice(currentDebt)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; color:var(--color-text-secondary);">
              <span>Cr\xE9dito por Cupones:</span>
              <strong style="color:#a855f7; font-weight:800;">-${formatPrice(totalCouponsCredit)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-top:1px dashed var(--color-border); padding-top:6px; font-weight:900; margin-top:4px;">
              <span style="color:var(--color-text-primary);">Neto a Cobrar:</span>
              <strong style="color:#10b981; font-size:13.5px; font-weight:950;">${formatPrice(finalSettleAmount)}</strong>
            </div>
          </div>
        ` : `
          <div style="font-size:24px; font-weight:950; color:#ef4444; margin-top:6px;">${formatPrice(currentDebt)}</div>
        `}
      </div>

      <div>
        <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase;">Monto a Liquidar ($)</label>
        <input type="number" id="settle-amount-input" value="${finalSettleAmount}" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:900; font-size:18px; border:1px solid var(--color-border);" />
      </div>

      <div>
        <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase;">M\xE9todo de Cobro</label>
        <select id="settle-method-select" class="input" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:14px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text);">
          <option value="efectivo">\u{1F4B5} Efectivo</option>
          <option value="transferencia">\u{1F3E6} Transferencia Bancaria</option>
        </select>
      </div>

      <div>
        <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase;">Notas / Comprobante (Opcional)</label>
        <input type="text" id="settle-notes-input" placeholder="Ej. Rendici\xF3n semanal abonada en mano" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:600; font-size:13px; border:1px solid var(--color-border);" />
      </div>

      <button id="confirm-settlement-btn" style="height:54px; border-radius:18px; background:#22c55e; color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 20px rgba(34,197,94,0.25); margin-top:8px;">
        ${icon("checkCircle", 20)} Confirmar Liquidaci\xF3n
      </button>
    `;
    showModal({ title: "Liquidar Deuda de Repartidor", content: modalContent, height: "auto" });
    modalContent.querySelector("#confirm-settlement-btn").onclick = async () => {
      const btn = modalContent.querySelector("#confirm-settlement-btn");
      btn.disabled = true;
      btn.innerHTML = "Procesando...";
      const amountToSettle = parseFloat(modalContent.querySelector("#settle-amount-input").value) || 0;
      const method = modalContent.querySelector("#settle-method-select").value;
      const notes = modalContent.querySelector("#settle-notes-input").value.trim();
      if (amountToSettle <= 0 && currentDebt > 0) {
        showToast("Ingres\xE1 un monto mayor a $0", "error");
        btn.disabled = false;
        btn.innerHTML = `${icon("checkCircle", 20)} Confirmar Liquidaci\xF3n`;
        return;
      }
      try {
        const { writeBatch: writeBatch2, doc: doc2, collection: collection2 } = await import("firebase/firestore");
        const batch = writeBatch2(db);
        const newDebt = Math.max(0, currentDebt - amountToSettle);
        const adminEmail = getState().user?.email || "Admin";
        batch.update(doc2(db, "users", driver.id), {
          deliveryDebt: newDebt
        });
        const settlementRef = doc2(collection2(db, "delivery_debt_settlements"));
        batch.set(settlementRef, {
          driverId: driver.id,
          driverName: driver.displayName || driver.name || "Repartidor",
          driverEmail: driver.email || "",
          amount: amountToSettle,
          method,
          notes,
          settledBy: adminEmail,
          createdAt: serverTimestamp()
        });
        const transRef = doc2(collection2(db, "delivery_transactions"));
        batch.set(transRef, {
          driverId: driver.id,
          type: "liquidation",
          amount: -amountToSettle,
          description: `Liquidaci\xF3n de deuda (${method === "transferencia" ? "Transferencia" : "Efectivo"})${notes ? ": " + notes : ""}`,
          settledBy: adminEmail,
          createdAt: serverTimestamp()
        });
        driverOrders.forEach((o) => {
          batch.update(doc2(db, "orders", o.id), {
            isSettledDriver: true,
            driverCommissionStatus: "paid",
            driverSettledAt: serverTimestamp()
          });
        });
        await batch.commit();
        try {
          const notifRef = doc2(collection2(db, "users", driver.id, "notifications"));
          await setDoc(notifRef, {
            title: "\u2705 Deuda Liquidada",
            body: `\xA1Tu deuda por ${formatPrice(amountToSettle)} fue liquidada con \xE9xito! Saldo actual: ${formatPrice(newDebt)}.`,
            type: "settlement",
            url: "#/delivery-panel?tab=settlements",
            status: "unread",
            createdAt: serverTimestamp()
          });
        } catch (notifErr) {
          console.warn("Could not send notification to driver:", notifErr);
        }
        showToast(`Se liquidaron ${formatPrice(amountToSettle)} exitosamente.`, "success");
        closeModal();
        loadData();
      } catch (err) {
        console.error(err);
        showToast("Error al procesar la liquidaci\xF3n", "error");
        btn.disabled = false;
        btn.innerHTML = `${icon("checkCircle", 20)} Confirmar Liquidaci\xF3n`;
      }
    };
  }
  const tabDrivers = document.getElementById("del-tab-drivers");
  if (tabDrivers) tabDrivers.onclick = () => switchTab("drivers");
  const tabSettlements = document.getElementById("del-tab-settlements");
  if (tabSettlements) tabSettlements.onclick = () => switchTab("settlements");
  const tabSettlementsHistory = document.getElementById("del-tab-settlements-history");
  if (tabSettlementsHistory) tabSettlementsHistory.onclick = () => switchTab("settlements-history");
  const tabConfig = document.getElementById("del-tab-config");
  if (tabConfig) tabConfig.onclick = () => switchTab("config");
  const stickyInput = document.getElementById("driver-search-input-sticky");
  if (stickyInput) {
    stickyInput.oninput = (e) => {
      searchQuery = e.target.value;
      if (activeTab === "drivers") renderTab();
    };
  }
  document.querySelectorAll(".driver-filter-sticky").forEach((btn) => {
    btn.onclick = () => {
      filterStatus = btn.dataset.filter;
      document.querySelectorAll(".driver-filter-sticky").forEach((b) => {
        const isActive = b.dataset.filter === filterStatus;
        b.style.background = isActive ? "var(--color-primary)" : "var(--color-surface)";
        b.style.color = isActive ? "white" : "var(--color-text-secondary)";
        b.style.border = isActive ? "none" : "1px solid var(--color-border)";
      });
      if (activeTab === "drivers") renderTab();
    };
  });
  loadData();
  return {
    cleanup: () => {
      if (unsubUsers) {
        unsubUsers();
        unsubUsers = null;
      }
    }
  };
}
export async function renderAdminDynamicSettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(79, 70, 229, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon("chevronLeft", 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Tarifas Din\xE1micas</h1>
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
                <input type="checkbox" id="global-night-surcharge-enabled" ${s.nightSurchargeConfig?.enabled ? "checked" : ""}>
                <span class="settings-slider"></span>
              </label>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Inicio</label>
                <input type="time" class="input" id="global-night-surcharge-start" value="${s.nightSurchargeConfig?.start || "00:00"}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Fin</label>
                <input type="time" class="input" id="global-night-surcharge-end" value="${s.nightSurchargeConfig?.end || "06:00"}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Tipo de Recargo</label>
                <select class="input" id="global-night-surcharge-type" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; background:var(--color-bg); border:1px solid var(--color-border);">
                  <option value="fixed" ${s.nightSurchargeConfig?.type === "fixed" ? "selected" : ""}>Monto Fijo ($)</option>
                  <option value="percentage" ${s.nightSurchargeConfig?.type === "percentage" ? "selected" : ""}>Porcentaje (%)</option>
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
                <input type="checkbox" id="global-driver-incentive-enabled" ${s.driverIncentiveConfig?.enabled ? "checked" : ""}>
                <span class="settings-slider"></span>
              </label>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Inicio</label>
                <input type="time" class="input" id="global-driver-incentive-start" value="${s.driverIncentiveConfig?.start || "20:00"}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Hora Fin</label>
                <input type="time" class="input" id="global-driver-incentive-end" value="${s.driverIncentiveConfig?.end || "23:59"}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px;" />
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700; text-transform:uppercase;">Tipo de Incentivo</label>
                <select class="input" id="global-driver-incentive-type" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; background:var(--color-bg); border:1px solid var(--color-border);">
                  <option value="fixed" ${s.driverIncentiveConfig?.type === "fixed" ? "selected" : ""}>Monto Fijo ($)</option>
                  <option value="percentage" ${s.driverIncentiveConfig?.type === "percentage" ? "selected" : ""}>Porcentaje (%)</option>
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
          ${icon("check", 20)} Guardar Configuraci\xF3n
        </button>
      </div>
    </div>
  `;
  document.getElementById("save-dynamic-btn").onclick = async () => {
    const btn = document.getElementById("save-dynamic-btn");
    btn.disabled = true;
    btn.innerHTML = "Guardando...";
    const nightSurchargeConfig = {
      enabled: document.getElementById("global-night-surcharge-enabled").checked,
      start: document.getElementById("global-night-surcharge-start").value,
      end: document.getElementById("global-night-surcharge-end").value,
      type: document.getElementById("global-night-surcharge-type").value,
      value: parseFloat(document.getElementById("global-night-surcharge-value").value) || 0
    };
    const driverIncentiveConfig = {
      enabled: document.getElementById("global-driver-incentive-enabled").checked,
      start: document.getElementById("global-driver-incentive-start").value,
      end: document.getElementById("global-driver-incentive-end").value,
      type: document.getElementById("global-driver-incentive-type").value,
      value: parseFloat(document.getElementById("global-driver-incentive-value").value) || 0
    };
    try {
      await setDoc(doc(db, "settings", "global"), {
        nightSurchargeConfig,
        driverIncentiveConfig
      }, { merge: true });
      setState("nightSurchargeConfig", nightSurchargeConfig);
      setState("driverIncentiveConfig", driverIncentiveConfig);
      showToast("Ajustes de tarifas din\xE1micas guardados.", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar ajustes.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("check", 20)} Guardar Configuraci\xF3n`;
    }
  };
}
export async function renderAdminGoPointsSettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  const renderContent = () => {
    const s = getState();
    container.innerHTML = `
      <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(245, 158, 11, 0.25); z-index:100;">
          <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
            ${icon("chevronLeft", 24)}
          </a>
          <div style="flex:1;">
            <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Programa GoPoints</h1>
            <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Fidelizaci\xF3n y Desaf\xEDos</p>
          </div>
        </div>

        <!-- Main Body -->
        <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:24px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
          <!-- Reembolso y Valor del Punto -->
          <div>
            <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Conversi\xF3n de Puntos</h4>
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
                En un pedido de <strong>$10.000</strong>, el cliente ganar\xE1 <strong id="ref-points-earned" style="color:var(--color-primary);">---</strong> puntos, canjeables por <strong id="ref-discount-value" style="color:var(--color-success); font-weight:800;">---</strong>.
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

          <!-- Desaf\xEDos Semanales -->
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin:0; letter-spacing:0.04em;">Desaf\xEDos Semanales</h4>
              <button id="btn-add-challenge" style="background:none; border:none; color:var(--color-primary); font-weight:800; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:4px;">
                ${icon("plus", 12)} AGREGAR
              </button>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px;" id="weekly-challenges-editor-container">
              ${(s.weeklyChallenges || []).map((ch, idx) => `
                <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border); position:relative;" class="challenge-edit-card" data-id="${ch.id}">
                  <button class="btn-delete-challenge" data-index="${idx}" style="position:absolute; top:12px; right:12px; border:none; background:none; color:var(--color-danger); cursor:pointer;">
                    ${icon("trash", 14)}
                  </button>
                  <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
                    <div>
                      <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">T\xEDtulo del Desaf\xEDo</label>
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
              `).join("")}
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
                      <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Pedidos M\xEDnimos</label>
                      <input type="number" class="input level-min-orders" data-level="${key}" value="${lvl.minOrders}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                    </div>
                    <div>
                      <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Multiplicador</label>
                      <input type="number" step="0.05" class="input level-multiplier" data-level="${key}" value="${lvl.multiplier}" style="width:100%; height:36px; border-radius:8px; padding:0 8px; font-size:13px; font-weight:700;" />
                    </div>
                  </div>
                  <div>
                    <label style="font-size:9px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Beneficios</label>
                    <textarea class="input level-benefits" data-level="${key}" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-size:12px; resize:none; line-height:1.4;">${lvl.benefits || ""}</textarea>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <button id="save-gopoints-btn" style="height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${icon("check", 20)} Guardar Todo
          </button>
        </div>
      </div>
    </div>
  `;
    const updatePreview = () => {
      const rate = (parseFloat(document.getElementById("global-points-rate").value) || 0) / 100;
      const val = parseFloat(document.getElementById("global-point-value").value) || 0;
      const earned = Math.floor(1e4 * rate);
      document.getElementById("ref-points-earned").textContent = earned;
      document.getElementById("ref-discount-value").textContent = formatPrice(earned * val);
    };
    document.getElementById("global-points-rate").oninput = updatePreview;
    document.getElementById("global-point-value").oninput = updatePreview;
    updatePreview();
    document.getElementById("btn-add-challenge").onclick = () => {
      const challenges = s.weeklyChallenges || [];
      const newId = "challenge_" + Math.random().toString(36).substr(2, 5);
      challenges.push({
        id: newId,
        title: "Nuevo Desaf\xEDo",
        target: 5,
        pointsReward: 100
      });
      s.weeklyChallenges = challenges;
      renderContent();
    };
    document.querySelectorAll(".btn-delete-challenge").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        s.weeklyChallenges.splice(idx, 1);
        renderContent();
      };
    });
    document.getElementById("save-gopoints-btn").onclick = async () => {
      const btn = document.getElementById("save-gopoints-btn");
      btn.disabled = true;
      btn.innerHTML = "Guardando...";
      const pointsPerDollar = (parseFloat(document.getElementById("global-points-rate").value) || 1) / 100;
      const dollarPerPoint = parseFloat(document.getElementById("global-point-value").value) || 1;
      const referralPoints = parseFloat(document.getElementById("global-referral-points").value) || 500;
      const weeklyChallenges = [];
      document.querySelectorAll("#weekly-challenges-editor-container .challenge-edit-card").forEach((card) => {
        const id = card.dataset.id;
        const title = card.querySelector(".challenge-title").value.trim();
        const target = parseInt(card.querySelector(".challenge-target").value) || 1;
        const pointsReward = parseInt(card.querySelector(".challenge-reward").value) || 0;
        weeklyChallenges.push({
          id,
          title,
          description: `Complet\xE1 ${target} pedidos esta semana`,
          target,
          pointsReward
        });
      });
      const currentLevels = { ...s.levels };
      document.querySelectorAll(".level-min-orders").forEach((input) => {
        currentLevels[input.dataset.level].minOrders = parseInt(input.value) || 0;
      });
      document.querySelectorAll(".level-multiplier").forEach((input) => {
        currentLevels[input.dataset.level].multiplier = parseFloat(input.value) || 1;
      });
      document.querySelectorAll(".level-benefits").forEach((textarea) => {
        currentLevels[textarea.dataset.level].benefits = textarea.value || "";
      });
      try {
        await setDoc(doc(db, "settings", "global"), {
          pointsPerDollar,
          dollarPerPoint,
          referralPoints,
          weeklyChallenges
        }, { merge: true });
        await setDoc(doc(db, "settings", "levels"), currentLevels);
        setState("pointsPerDollar", pointsPerDollar);
        setState("dollarPerPoint", dollarPerPoint);
        setState("referralPoints", referralPoints);
        setState("weeklyChallenges", weeklyChallenges);
        setState("levels", currentLevels);
        showToast("Ajustes de fidelizaci\xF3n actualizados.", "success");
      } catch (err) {
        console.error(err);
        showToast("Error al guardar ajustes.", "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${icon("check", 20)} Guardar Todo`;
        renderContent();
      }
    };
  };
  renderContent();
}
export async function renderAdminPushSettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(59, 130, 246, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon("chevronLeft", 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Notificaciones Push</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Mensajes Autom\xE1ticos</p>
        </div>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <div style="display:flex; flex-direction:column; gap:16px;">
          
          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Desconexi\xF3n por Inactividad</label>
            <input type="text" id="push-text-disconnect-title" placeholder="T\xEDtulo" value="${s.pushMessages?.disconnect?.title || "Zzz... Sesi\xF3n pausada"}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-disconnect-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.disconnect?.body || "Te desconectamos porque pasaron 3 horas de inactividad."}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Nueva Oferta / Anuncio</label>
            <input type="text" id="push-text-offer-title" placeholder="T\xEDtulo" value="${s.pushMessages?.offer?.title || "\xA1Nueva Oferta!"}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-offer-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.offer?.body || "Aprovech\xE1 esta nueva oferta en GoDelivery."}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Recargo por Lluvia</label>
            <input type="text" id="push-text-rain-title" placeholder="T\xEDtulo" value="${s.pushMessages?.rain?.title || "\u{1F327} \xA1Empez\xF3 a llover!"}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-rain-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.rain?.body || "El recargo por lluvia est\xE1 activo. \xA1Conduc\xED con cuidado!"}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Recargo Nocturno</label>
            <input type="text" id="push-text-night-title" placeholder="T\xEDtulo" value="${s.pushMessages?.night?.title || "\u{1F319} Recargo Nocturno Activo"}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-night-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.night?.body || "Comenz\xF3 el horario de recargo nocturno."}</textarea>
          </div>

          <div style="background:var(--color-surface); border-radius:20px; padding:16px; border:1px solid var(--color-border);">
            <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:block; font-weight:700; text-transform:uppercase;">Incentivo Extra</label>
            <input type="text" id="push-text-incentive-title" placeholder="T\xEDtulo" value="${s.pushMessages?.incentive?.title || "\u{1F680} \xA1Incentivo Activo!"}" style="width:100%; height:38px; border-radius:8px; padding:0 10px; font-weight:700; font-size:13px; margin-bottom:8px; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);" />
            <textarea id="push-text-incentive-body" placeholder="Cuerpo del mensaje" style="width:100%; height:50px; border-radius:8px; padding:6px 8px; font-weight:500; font-size:12px; resize:none; line-height:1.4; border:1px solid var(--color-border); background:var(--color-bg); color:var(--color-text);">${s.pushMessages?.incentive?.body || "Sal\xED a repartir ahora y gan\xE1 un extra por cada pedido."}</textarea>
          </div>

          <button id="save-push-btn" style="height:54px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:10px;">
            ${icon("check", 20)} Guardar Plantillas
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("save-push-btn").onclick = async () => {
    const btn = document.getElementById("save-push-btn");
    btn.disabled = true;
    btn.innerHTML = "Guardando...";
    const pushMessages = {
      disconnect: { title: document.getElementById("push-text-disconnect-title").value, body: document.getElementById("push-text-disconnect-body").value },
      offer: { title: document.getElementById("push-text-offer-title").value, body: document.getElementById("push-text-offer-body").value },
      rain: { title: document.getElementById("push-text-rain-title").value, body: document.getElementById("push-text-rain-body").value },
      night: { title: document.getElementById("push-text-night-title").value, body: document.getElementById("push-text-night-body").value },
      incentive: { title: document.getElementById("push-text-incentive-title").value, body: document.getElementById("push-text-incentive-body").value }
    };
    try {
      await setDoc(doc(db, "settings", "global"), { pushMessages }, { merge: true });
      setState("pushMessages", pushMessages);
      showToast("Mensajes push actualizados correctamente.", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar ajustes.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("check", 20)} Guardar Plantillas`;
    }
  };
}
export async function renderAdminMaintenanceSettings(container) {
  if (!container) container = document.getElementById("app-content");
  if (!container) return;
  const s = getState();
  container.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg, #ef4444 0%, #991b1b 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(239, 68, 68, 0.25); z-index:100;">
        <a href="#/admin/settings" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; text-decoration:none;">
          ${icon("chevronLeft", 24)}
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
                <input type="checkbox" id="global-maintenance-mode" ${s.maintenanceMode ? "checked" : ""}>
                <span class="settings-slider"></span>
              </label>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Mensaje para los usuarios</label>
              <textarea id="global-maintenance-message" class="input" style="width:100%; height:80px; border-radius:12px; padding:10px; font-weight:600; font-size:13px; background:var(--color-bg); border:1px solid var(--color-border); resize:none; color:var(--color-text);">${s.maintenanceMessage || ""}</textarea>
            </div>
            <div id="maintenance-emails-section" style="${s.maintenanceMode ? "display:flex;" : "display:none;"} flex-direction:column; gap:6px; border-top: 1px dashed var(--color-border-light); padding-top: 12px;">
              <label style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase;">Correos Excluidos (Acceso Permitido)</label>
              <div style="display:flex; gap:8px;">
                <input type="email" id="maintenance-email-input" placeholder="ejemplo@correo.com" class="input" style="flex:1; height:38px; border-radius:10px; padding:0 12px; font-size:13px; font-weight:600; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text);" />
                <button type="button" id="btn-add-maintenance-email" style="height:38px; padding:0 16px; border-radius:10px; background:var(--color-primary); color:white; border:none; font-weight:800; font-size:12px; cursor:pointer;">Agregar</button>
              </div>
              <div id="maintenance-emails-list" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;"></div>
            </div>
            <button id="save-maintenance-btn" style="height:46px; border-radius:12px; background:var(--color-primary); color:white; border:none; font-weight:850; font-size:14px; cursor:pointer;">
              Guardar Estado
            </button>
          </div>
        </div>

        <!-- 2. Optimizaci\xF3n de Im\xE1genes -->
        <div>
          <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:12px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Optimizaci\xF3n de Base de Datos</h4>
          <div style="background:var(--color-surface); border-radius:20px; padding:18px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:12px;">
            <p style="font-size:12px; color:var(--color-text-secondary); line-height:1.6; margin:0;">
              Comprime todas las fotos de comercios y productos de tu base de datos al formato ligero <strong>WebP (calidad 75%)</strong>.
            </p>
            <button class="btn" id="btn-optimize-images" style="width:100%; height:48px; border-radius:12px; background:linear-gradient(135deg,#0284c7,#0369a1); color:white; border:none; font-weight:900; font-size:13.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${icon("sparkles", 16)} OPTIMIZAR IM\xC1GENES
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
          <div style="background:rgba(239,68,68,0.02); border:1.5px solid rgba(239,68,68,0.12); border-radius:20px; padding:18px; display:flex; flex-direction:column; gap:16px;">
            
            <!-- Reset Econom\xEDa & Balances Option -->
            <div style="background: rgba(245, 158, 11, 0.04); border: 1.5px solid rgba(245, 158, 11, 0.2); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
              <div style="font-size: 13.5px; font-weight: 900; color: var(--color-text-primary); display:flex; align-items:center; gap:6px;">
                <span>\u{1F504}</span> Resetear Saldos de Econom\xEDa a $0
              </div>
              <p style="font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; margin: 0;">
                Resetea a <strong>$0</strong> las deudas de todos los repartidores, comisiones de comercios y tarifas app, marcando las operaciones como liquidadas y limpiando la secci\xF3n de Econom\xEDa.
              </p>
              <button class="btn" id="btn-reset-economy-balances" style="width: 100%; height: 46px; border-radius: 12px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; font-weight: 900; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);">
                ${icon("refresh", 16)} RESETEAR SALDOS A $0 Y LIMPIAR ECONOM\xCDA
              </button>
            </div>

            <div>
              <p style="font-size:12px; color:var(--color-text-secondary); line-height:1.5; margin:0 0 10px 0;">
                Elimina todos los pedidos, chats, balances e historiales del sistema. <span style="color:#ef4444; font-weight:800;">Esta acci\xF3n es irreversible.</span>
              </p>
              <button class="btn btn-block" id="btn-hard-reset" style="width:100%; height:48px; border-radius:12px; background:linear-gradient(135deg,#ef4444,#dc2626); color:white; border:none; font-weight:900; font-size:13.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                ${icon("trash", 16)} RESETEO TOTAL (NUCLEAR)
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
  let localEmails = [...getState().maintenanceAllowedEmails || []];
  const renderEmails = () => {
    const listEl = document.getElementById("maintenance-emails-list");
    if (!listEl) return;
    listEl.innerHTML = localEmails.map((email, idx) => `
      <div style="display:flex; align-items:center; gap:6px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); padding:4px 10px; border-radius:99px; font-size:12px; font-weight:700; color:var(--color-text-primary);">
        <span>${email}</span>
        <button type="button" class="btn-remove-email" data-index="${idx}" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:900; font-size:12px; padding:0; display:flex; align-items:center; justify-content:center; width:16px; height:16px;">\xD7</button>
      </div>
    `).join("");
    listEl.querySelectorAll(".btn-remove-email").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        localEmails.splice(idx, 1);
        renderEmails();
      };
    });
  };
  setTimeout(() => {
    const switchEl = document.getElementById("global-maintenance-mode");
    const emailsSection = document.getElementById("maintenance-emails-section");
    if (switchEl && emailsSection) {
      switchEl.onchange = (e) => {
        emailsSection.style.display = e.target.checked ? "flex" : "none";
      };
    }
    const addBtn = document.getElementById("btn-add-maintenance-email");
    if (addBtn) {
      addBtn.onclick = () => {
        const input = document.getElementById("maintenance-email-input");
        const val = input.value.trim().toLowerCase();
        if (val && !localEmails.includes(val)) {
          localEmails.push(val);
          input.value = "";
          renderEmails();
        }
      };
    }
    renderEmails();
  }, 50);
  document.getElementById("save-maintenance-btn").onclick = async () => {
    const btn = document.getElementById("save-maintenance-btn");
    btn.disabled = true;
    btn.innerHTML = "Guardando...";
    const maintenanceMode = document.getElementById("global-maintenance-mode").checked;
    const maintenanceMessage = document.getElementById("global-maintenance-message").value.trim();
    try {
      await setDoc(doc(db, "settings", "global"), {
        maintenanceMode,
        maintenanceMessage,
        maintenanceAllowedEmails: localEmails
      }, { merge: true });
      setState("maintenanceMode", maintenanceMode);
      setState("maintenanceMessage", maintenanceMessage);
      setState("maintenanceAllowedEmails", localEmails);
      showToast("Estado de mantenimiento guardado.", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "Guardar Estado";
    }
  };
  document.getElementById("btn-reset-economy-balances").onclick = () => {
    showConfirm({
      title: "\u26A0\uFE0F RESETEAR TODO A $0 Y LIMPIAR ECONOM\xCDA",
      message: "Esta acci\xF3n blanquear\xE1 a <b>$0</b> todas las deudas de repartidores, comisiones de comercios y tarifas app.<br><br>Adem\xE1s se eliminar\xE1 todo el historial de liquidaciones en Econom\xEDa.<br><br>\xBFEst\xE1s seguro de continuar?",
      confirmText: "S\xCD, RESETEAR A $0",
      onConfirm: async () => {
        showToast("Reseteando saldos a $0...", "info");
        try {
          const { collection: fColl, getDocs: fGet, doc: fDoc, writeBatch: fBatch, deleteDoc: fDel, serverTimestamp: fServ } = await import("firebase/firestore");
          const usersSnap = await fGet(fColl(db, "users"));
          const b1 = fBatch(db);
          usersSnap.docs.forEach((uDoc) => {
            const uData = uDoc.data();
            if (uData.deliveryDebt || uData.role === "delivery" || uData.isDelivery) {
              b1.update(fDoc(db, "users", uDoc.id), { deliveryDebt: 0 });
            }
          });
          await b1.commit();
          const ordersSnap = await fGet(fColl(db, "orders"));
          const b2 = fBatch(db);
          ordersSnap.docs.forEach((oDoc) => {
            const oData = oDoc.data();
            if (!oData.isSettled || !oData.isSettledDriver || oData.commissionStatus !== "paid") {
              b2.update(fDoc(db, "orders", oDoc.id), {
                isSettled: true,
                commissionStatus: "paid",
                isSettledDriver: true,
                driverCommissionStatus: "paid",
                settledAt: fServ()
              });
            }
          });
          await b2.commit();
          const setSnap = await fGet(fColl(db, "settlements"));
          for (const sDoc of setSnap.docs) {
            await fDel(fDoc(db, "settlements", sDoc.id));
          }
          const transSnap = await fGet(fColl(db, "delivery_transactions"));
          for (const tDoc of transSnap.docs) {
            await fDel(fDoc(db, "delivery_transactions", tDoc.id));
          }
          try {
            const debtSetSnap = await fGet(fColl(db, "delivery_debt_settlements"));
            for (const dDoc of debtSetSnap.docs) {
              await fDel(fDoc(db, "delivery_debt_settlements", dDoc.id));
            }
          } catch (e) {
          }
          showToast("Saldos reseteados a $0 y Econom\xEDa limpiada con \xE9xito", "success");
          setTimeout(() => location.reload(), 1200);
        } catch (err) {
          console.error("Error during economy reset:", err);
          showToast("Error al resetear saldos de econom\xEDa", "error");
        }
      }
    });
  };
  document.getElementById("btn-optimize-images").onclick = () => {
    showConfirm({
      title: "\u{1F4F8} OPTIMIZAR IM\xC1GENES",
      message: "Esta acci\xF3n escanear\xE1 todos los comercios y productos de la plataforma y convertir\xE1 sus fotos a WebP comprimido (75% calidad).<br><br>\xBFDeseas iniciar la optimizaci\xF3n ahora?",
      confirmText: "S\xCD, OPTIMIZAR",
      onConfirm: runImageOptimization
    });
  };
  document.getElementById("btn-hard-reset").onclick = async () => {
    const uid = Math.random().toString(36).substr(2, 5);
    const modalContent = `
      <div style="padding: 20px 24px; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px;">
        <div style="background: rgba(239,68,68,0.06); border: 1px dashed rgba(239,68,68,0.25); border-radius: 18px; padding: 14px 16px; display: flex; gap: 12px; align-items: flex-start;">
          <div style="color: #ef4444; flex-shrink:0; margin-top:2px;">${icon("alertTriangle", 20)}</div>
          <div style="font-size: 13px; color: var(--color-text-secondary); line-height: 1.5;">
            Est\xE1s por iniciar un <strong>Reseteo Nuclear</strong>. Se borrar\xE1n todos los pedidos, chats, notificaciones, liquidaciones, historial, opiniones, y calificaciones de la plataforma.
          </div>
        </div>
        
        <p style="font-size: 13px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin: 4px 0 0 0; letter-spacing: 0.05em;">Conservaci\xF3n de Datos:</p>
        
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px;">
              <div style="color: var(--color-success); margin-top: 2px;">${icon("check", 18)}</div>
              <div style="flex: 1;">
                <div style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Usuarios Registrados</div>
                <div style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; line-height: 1.35;">Se conservan los perfiles de los usuarios en el sistema, pero se blanquean a 0 todos sus saldos, deudas y calificaciones.</div>
              </div>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 14px; background: var(--color-bg-secondary); border: 1.5px solid var(--color-border); border-radius: 16px;">
              <div style="color: var(--color-success); margin-top: 2px;">${icon("check", 18)}</div>
              <div style="flex: 1;">
                <div style="font-weight: 800; font-size: 13.5px; color: var(--color-text-primary);">Conservar Comercios y Productos</div>
                <div style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; line-height: 1.35;">Se conservan los perfiles de los comercios y sus cat\xE1logos de productos, pero se eliminan todas sus opiniones y calificaciones recibidas.</div>
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
          ${icon("trash", 18)} EJECUTAR RESETEO NUCLEAR
        </button>
      </div>
    `;
    showModal({
      title: "\u26A0\uFE0F Reseteo Nuclear",
      height: "auto",
      content: modalContent,
      hideHeader: true,
      onOpen: () => {
        const input = document.getElementById("confirm-nuclear-input");
        const executeBtn = document.getElementById("btn-execute-nuclear");
        const keepPointsCheck = document.getElementById("keep-points-check");
        const keepAdsCheck = document.getElementById("keep-ads-check");
        const keepOffersCheck = document.getElementById("keep-offers-check");
        input.oninput = () => {
          if (input.value.trim() === uid) {
            executeBtn.disabled = false;
            executeBtn.style.cursor = "pointer";
            executeBtn.style.background = "#dc2626";
          } else {
            executeBtn.disabled = true;
            executeBtn.style.cursor = "not-allowed";
            executeBtn.style.background = "#ef4444";
          }
        };
        executeBtn.onclick = async () => {
          executeBtn.disabled = true;
          executeBtn.innerHTML = "Reseteando...";
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
  const btn = document.getElementById("btn-optimize-images");
  const progContainer = document.getElementById("optimize-progress-container");
  const statusText = document.getElementById("opt-progress-status");
  const pctText = document.getElementById("opt-progress-pct");
  const progressBar = document.getElementById("opt-progress-bar");
  const resultsText = document.getElementById("opt-progress-results");
  if (!btn || !progContainer) return;
  btn.disabled = true;
  progContainer.style.display = "block";
  statusText.textContent = "Obteniendo lista de comercios...";
  pctText.textContent = "0%";
  progressBar.style.width = "0%";
  resultsText.innerHTML = "";
  let totalScanned = 0;
  let totalOptimized = 0;
  let totalSavedBytes = 0;
  try {
    const comerciosSnap = await getDocs(collection(db, "comercios"));
    const comercios = comerciosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allProductsToOptimize = [];
    statusText.textContent = "Obteniendo lista de productos...";
    for (const store of comercios) {
      const prodsSnap = await getDocs(collection(db, "comercios", store.id, "products"));
      prodsSnap.forEach((d) => {
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
      const pct = Math.round(completedTasks / totalTasks * 100);
      if (pctText) pctText.textContent = `${pct}%`;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (statusText) statusText.textContent = status;
    };
    const getBase64Size = (str) => {
      if (!str || !str.startsWith("data:image")) return 0;
      return Math.round(str.length * 3 / 4);
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
      if (store.logo && store.logo.startsWith("data:image")) {
        totalScanned++;
        const originalSize = getBase64Size(store.logo);
        const compressed = await compressImage(store.logo, 200, 200, 0.75);
        const newSize = getBase64Size(compressed);
        if (newSize < originalSize) {
          updatedStore.logo = compressed;
          isStoreChanged = true;
          totalOptimized++;
          totalSavedBytes += originalSize - newSize;
        }
      }
      updateProgress(`Comprimiendo logos... (${store.name})`);
      if (store.banner && store.banner.startsWith("data:image")) {
        totalScanned++;
        const originalSize = getBase64Size(store.banner);
        const compressed = await compressImage(store.banner, 800, 400, 0.75);
        const newSize = getBase64Size(compressed);
        if (newSize < originalSize) {
          updatedStore.banner = compressed;
          isStoreChanged = true;
          totalOptimized++;
          totalSavedBytes += originalSize - newSize;
        }
      }
      updateProgress(`Comprimiendo banners... (${store.name})`);
      if (isStoreChanged) {
        await setDoc(doc(db, "comercios", store.id), updatedStore, { merge: true });
      }
    }
    for (const prod of allProductsToOptimize) {
      if (prod.data.image && prod.data.image.startsWith("data:image")) {
        totalScanned++;
        const originalSize = getBase64Size(prod.data.image);
        const compressed = await compressImage(prod.data.image, 800, 600, 0.75);
        const newSize = getBase64Size(compressed);
        if (newSize < originalSize) {
          await setDoc(prod.ref, { image: compressed }, { merge: true });
          totalOptimized++;
          totalSavedBytes += originalSize - newSize;
        }
      }
      updateProgress(`Comprimiendo productos... (${prod.data.name || "Producto"})`);
    }
    if (statusText) statusText.textContent = "\xA1Optimizaci\xF3n completada con \xE9xito!";
    if (pctText) pctText.textContent = "100%";
    if (progressBar) progressBar.style.width = "100%";
    resultsText.innerHTML += `
      <div style="margin-top:10px; padding:12px; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.15); border-radius:12px; color:var(--color-success); font-weight:700; line-height:1.5;">
        \u2728 Resultados de Optimizaci\xF3n:<br>
        \u2022 Im\xE1genes analizadas: ${totalScanned}<br>
        \u2022 Im\xE1genes comprimidas a WebP: ${totalOptimized}<br>
        \u2022 Espacio de base de datos ahorrado: ${formatBytes(totalSavedBytes)}<br>
        \u2022 Rendimiento de carga mejorado notablemente!
      </div>
    `;
    showToast("\xA1Base de im\xE1genes optimizada correctamente!", "success");
  } catch (err) {
    console.error("Image optimization failed:", err);
    if (statusText) statusText.textContent = "Error en la optimizaci\xF3n";
    showToast("Error al optimizar im\xE1genes", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function performHardReset({ keepPoints = false, keepAds = false, keepOffers = false } = {}) {
  try {
    showToast("Iniciando Reseteo Nuclear...", "info");
    const { auth } = await import("../../firebase.js");
    const { getIdToken } = await import("firebase/auth");
    if (!auth.currentUser) {
      showToast("Error: Usuario no autenticado", "error");
      return;
    }
    const idToken = await getIdToken(auth.currentUser);
    const response = await fetch(`https://us-central1-godelivery-magdalena.cloudfunctions.net/adminHardReset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
    showToast("Limpiando cach\xE9 local y preparando reinicio...", "info");
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("gd_clear_persistence", "true");
    showToast("\xA1Sistema reseteado a cero con \xE9xito! Reiniciando...", "success");
    setTimeout(() => window.location.reload(), 1e3);
  } catch (err) {
    console.error("Hard Reset error:", err);
    showToast(`Error cr\xEDtico en el Hard Reset: ${err.message}`, "error");
  }
}
let _ordersModalOpen = false;
async function showDriverOrderHistoryModal(driver, db2) {
  if (_ordersModalOpen) return;
  _ordersModalOpen = true;
  setTimeout(() => {
    _ordersModalOpen = false;
  }, 1e3);
  const { showModal: showModal2 } = await import("../../components/modal.js");
  const { collection: collection2, query, where, orderBy, getDocs: getDocs2, limit } = await import("firebase/firestore");
  const { formatPrice: formatPrice2 } = await import("../../utils/format.js");
  const wrapperId = `orders-modal-wrapper-${Date.now()}`;
  showModal2({
    title: `\u{1F4E6} Pedidos \u2014 ${driver.displayName || driver.name || "Repartidor"}`,
    hideHeader: false,
    headerBackground: "#E11D48",
    headerTextColor: "#FFFFFF",
    height: "92dvh",
    content: `
      <div id="${wrapperId}" style="display:flex; flex-direction:column; height:100%; width:100%; box-sizing:border-box;">
        <div style="padding:60px 24px; text-align:center; color:var(--color-text-secondary); font-size:14px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; flex:1;">
          <div class="loader-dots"><span></span><span></span><span></span></div>
          <span style="font-weight:700;">Cargando pedidos...</span>
        </div>
      </div>
    `,
    onClose: () => {
      _ordersModalOpen = false;
    }
  });
  try {
    const q = query(
      collection2(db2, "orders"),
      where("driverId", "==", driver.id),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const snap = await getDocs2(q);
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const totalOrders = orders.length;
    const totalEarned = orders.reduce((s, o) => s + (Number(o.deliveryCost) || 0), 0);
    const completed = orders.filter((o) => o.status === "delivered" || o.status === "completed").length;
    const formatDate = (ts) => {
      if (!ts) return "---";
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const getOrderTypeName = (o) => {
      if (o.isTrip) return "\u{1F697} Go Viaje";
      if (o.isFavor) {
        if (o.favorType === "gocash") return "\u{1F4B5} Go Cash";
        if (o.favorType === "encomienda") return "\u{1F4E6} Encomienda";
        if (o.favorType === "mandado" || o.favorType === "compra") return "\u{1F6F5} Mandado";
        if (o.favorType === "pagodeservicios") return "\u{1F9FE} Pago de Servicios";
        return "\u{1F6F5} Mandado";
      }
      return `\u{1F3EA} ${o.comercioName || o.commerce || "Comercio"}`;
    };
    const statusLabel = (s) => {
      const map = { delivered: "Entregado", completed: "Completado", cancelled: "Cancelado", pending: "Pendiente", assigned: "Asignado", picked_up: "En camino", preparing: "Preparando", delivering: "En camino", ready: "Listo" };
      return map[s] || s || "---";
    };
    const statusColor = (s) => {
      if (s === "delivered" || s === "completed") return "#10b981";
      if (s === "cancelled") return "#ef4444";
      return "#f59e0b";
    };
    const listHTML = orders.length === 0 ? `<div style="padding:48px 24px; text-align:center; color:var(--color-text-tertiary); font-size:13px; font-weight:700;">Sin pedidos registrados</div>` : orders.map((o) => {
      const isSettled = o.isSettledDriver === true;
      const cardBg = isSettled ? "rgba(16,185,129,0.03)" : "rgba(239,68,68,0.03)";
      const cardBorderColor = isSettled ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)";
      const hoverBg = isSettled ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)";
      return `
        <div class="order-history-row" data-order-id="${o.id}" style="margin:10px 16px; padding:16px; border-radius:18px; border:1.5px solid ${cardBorderColor}; background:${cardBg}; display:flex; flex-direction:column; gap:6px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='${hoverBg}'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='${cardBg}'; this.style.transform='none'">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:13px; font-weight:900; color:var(--color-text-primary);">${getOrderTypeName(o)}</span>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:9.5px; font-weight:900; color:white; background:${isSettled ? "#10b981" : "#ef4444"}; padding:2px 6px; border-radius:6px; text-transform:uppercase; letter-spacing:0.5px;">
                ${isSettled ? "Liquidado" : "Pendiente"}
              </span>
              <span style="font-size:10.5px; font-weight:850; color:${statusColor(o.status)}; background:${statusColor(o.status)}12; padding:2px 8px; border-radius:8px; border:1px solid ${statusColor(o.status)}25;">${statusLabel(o.status)}</span>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:600;">${formatDate(o.createdAt)}</span>
            <span style="font-size:13.5px; font-weight:950; color:#10b981;">+${formatPrice2(o.deliveryCost || 0)}</span>
          </div>
          
          ${o.appUsageFee > 0 || o.couponDiscount > 0 ? `
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:1px;">
              ${o.appUsageFee > 0 ? `
                <span style="font-size:9.5px; font-weight:800; background:rgba(59,130,246,0.08); color:#3b82f6; border:1px solid rgba(59,130,246,0.15); padding:2px 6px; border-radius:6px; display:inline-flex; align-items:center;">
                  Tarifa App: +${formatPrice2(o.appUsageFee)}
                </span>
              ` : ""}
              ${o.couponDiscount > 0 ? `
                <span style="font-size:9.5px; font-weight:800; background:rgba(168,85,247,0.08); color:#a855f7; border:1px solid rgba(168,85,247,0.15); padding:2px 6px; border-radius:6px; display:inline-flex; align-items:center;">
                  Cup\xF3n: -${formatPrice2(o.couponDiscount)} ${o.couponCode ? `(${o.couponCode})` : ""}
                </span>
              ` : ""}
            </div>
          ` : ""}

          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--color-text-tertiary); margin-top:2px; border-top:1px dashed ${isSettled ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)"}; padding-top:6px;">
            <span>Cliente: <strong style="color:var(--color-text-secondary); font-weight:700;">${o.userName || o.clientName || "---"}</strong></span>
            <span style="font-weight:800; color:#E11D48; display:flex; align-items:center; gap:2px; font-size:10.5px;">Ver Detalle \u2192</span>
          </div>
        </div>
      `;
    }).join("");
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
      wrapper.innerHTML = `
        <div style="display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden;">
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:16px; background:linear-gradient(180deg, var(--color-bg-secondary) 0%, var(--color-bg) 100%); border-bottom:1px solid var(--color-border-light); flex-shrink:0;">
            <div style="text-align:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:8px 4px;">
              <div style="font-size:22px; font-weight:950; color:var(--color-text-primary);">${totalOrders}</div>
              <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Total</div>
            </div>
            <div style="text-align:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:8px 4px;">
              <div style="font-size:22px; font-weight:950; color:#10b981;">${completed}</div>
              <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Entregados</div>
            </div>
            <div style="text-align:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:8px 4px;">
              <div style="font-size:20px; font-weight:950; color:#E11D48;">${formatPrice2(totalEarned)}</div>
              <div style="font-size:9px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ganado</div>
            </div>
          </div>
          <div id="driver-orders-list-container" style="flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding-bottom:calc(24px + env(safe-area-inset-bottom, 24px)); box-sizing:border-box;">
            ${listHTML}
          </div>
        </div>
      `;
      setTimeout(() => {
        const container = document.getElementById("driver-orders-list-container");
        if (container) {
          container.querySelectorAll(".order-history-row").forEach((row) => {
            row.onclick = async () => {
              const orderId = row.dataset.orderId;
              const { closeModal: closeModal2 } = await import("../../components/modal.js");
              closeModal2();
              if (typeof window.showOrderDetail !== "function") {
                await import("./orders.js");
              }
              if (typeof window.showOrderDetail === "function") {
                setTimeout(() => {
                  window.showOrderDetail(orderId);
                }, 150);
              }
            };
          });
        }
      }, 100);
    }
  } catch (err) {
    console.error("Error loading driver order history:", err);
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
      wrapper.innerHTML = `<div style="padding:24px; text-align:center; color:#ef4444; font-weight:700;">${err.message}</div>`;
    }
  }
}
let _paymentsModalOpen = false;
async function showDriverPaymentHistoryModal(driver, db2) {
  if (_paymentsModalOpen) return;
  _paymentsModalOpen = true;
  setTimeout(() => {
    _paymentsModalOpen = false;
  }, 1e3);
  const { showModal: showModal2 } = await import("../../components/modal.js");
  const { collection: collection2, query, where, orderBy, getDocs: getDocs2 } = await import("firebase/firestore");
  const { formatPrice: formatPrice2 } = await import("../../utils/format.js");
  const wrapperId = `payments-modal-wrapper-${Date.now()}`;
  showModal2({
    title: `\u{1F4B8} Pagos \u2014 ${driver.displayName || driver.name || "Repartidor"}`,
    hideHeader: false,
    headerBackground: "#E11D48",
    headerTextColor: "#FFFFFF",
    height: "92dvh",
    content: `
      <div id="${wrapperId}" style="display:flex; flex-direction:column; height:100%; width:100%; box-sizing:border-box;">
        <div style="padding:60px 24px; text-align:center; color:var(--color-text-secondary); font-size:14px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; flex:1;">
          <div class="loader-dots"><span></span><span></span><span></span></div>
          <span style="font-weight:700;">Cargando pagos...</span>
        </div>
      </div>
    `,
    onClose: () => {
      _paymentsModalOpen = false;
    }
  });
  try {
    const q = query(
      collection2(db2, "delivery_transactions"),
      where("driverId", "==", driver.id),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs2(q);
    const txns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const payTxns = txns.filter((t) => t.type === "settlement" || t.type === "liquidation" || t.type === "pago");
    const formatDate = (ts) => {
      if (!ts) return "---";
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const listHTML = payTxns.length === 0 ? `<div style="padding:40px 24px; text-align:center; color:var(--color-text-tertiary); font-size:13px; font-weight:700;">No se registraron pagos de liquidaci\xF3n para este repartidor</div>` : payTxns.map((t) => `
        <div style="padding:16px 20px; border-bottom:1px solid var(--color-border-light); display:flex; justify-content:space-between; align-items:center; gap:12px; background:var(--color-surface); margin:8px 12px; border-radius:16px; border:1.5px solid var(--color-border-light); box-shadow:var(--shadow-sm);">
          <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
            <span style="font-size:13.5px; font-weight:900; color:var(--color-text-primary);">Liquidaci\xF3n Aprobada</span>
            ${t.description ? `<span style="font-size:11.5px; color:var(--color-text-secondary); font-weight:600;">${t.description}</span>` : ""}
            <span style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:700;">${formatDate(t.createdAt)}</span>
          </div>
          <div style="text-align:right; flex-shrink:0;">
            <div style="font-size:16px; font-weight:950; color:#10b981;">
              + ${formatPrice2(Math.abs(Number(t.amount || 0)))}
            </div>
            <div style="font-size:9.5px; font-weight:800; color:#10b981; text-transform:uppercase; margin-top:2px;">Abonado</div>
          </div>
        </div>
      `).join("");
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
      wrapper.innerHTML = `
        <div style="display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden;">
          <div style="flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:10px 0 calc(24px + env(safe-area-inset-bottom, 24px)); box-sizing:border-box; background:var(--color-bg);">
            ${listHTML}
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.error("Error loading driver payment history:", err);
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
      wrapper.innerHTML = `<div style="padding:24px; text-align:center; color:#ef4444; font-weight:700;">${err.message}</div>`;
    }
    _paymentsModalOpen = false;
  }
}
async function showDriverDebtDetailModal(driver, db2) {
  const { showModal: showModal2 } = await import("../../components/modal.js");
  const { formatPrice: formatPrice2 } = await import("../../utils/format.js");
  const currentDebt = driver.deliveryDebt || 0;
  const canonAmt = getState().canonAmount || 1800;
  const driverOrders = globalPendingOrders.filter(
    (o) => o.driverId === driver.id && o.isSettledDriver !== true && (o.status === "delivered" || o.status === "completed")
  );
  const appFeesTotal = driverOrders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
  const rawCanonFees = Math.max(0, currentDebt - appFeesTotal);
  const canonFeesTotal = rawCanonFees;
  const totalCouponsCredit = driverOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
  const finalSettleAmount = Math.max(0, appFeesTotal + canonFeesTotal - totalCouponsCredit);
  const getOrderTypeName = (o) => {
    if (o.isTrip) return "\u{1F697} Go Viaje";
    if (o.isFavor) {
      if (o.favorType === "gocash") return "\u{1F4B5} Go Cash";
      if (o.favorType === "encomienda") return "\u{1F4E6} Encomienda";
      if (o.favorType === "mandado" || o.favorType === "compra") return "\u{1F6F5} Mandado";
      if (o.favorType === "pagodeservicios") return "\u{1F9FE} Pago de Servicios";
      return "\u{1F6F5} Mandado";
    }
    return `\u{1F3EA} ${o.comercioName || o.commerce || "Comercio"}`;
  };
  const formatDate = (ts) => {
    if (!ts) return "---";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const ordersListHTML = driverOrders.length === 0 ? `<div style="text-align:center; padding:16px; color:var(--color-text-tertiary); font-size:11px; font-weight:700;">Sin tarifas de pedidos pendientes de liquidar.</div>` : driverOrders.map((o) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:12px; font-size:11.5px; transition:all 0.15s;">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span style="font-weight:800; color:var(--color-text-primary);">${getOrderTypeName(o)}</span>
            <span style="font-size:10px; color:var(--color-text-tertiary); font-weight:600;">${formatDate(o.createdAt)}</span>
          </div>
          <div style="text-align:right;">
            <strong style="color:#ef4444; font-family:monospace; font-size:12.5px;">+${formatPrice2(o.appUsageFee || 0)}</strong>
            ${o.couponDiscount > 0 ? `
              <div style="font-size:9.5px; color:#a855f7; font-weight:850; margin-top:2px;">Cup\xF3n: -${formatPrice2(o.couponDiscount)}</div>
            ` : ""}
          </div>
        </div>
      `).join("");
  const detailHTML = `
    <div style="font-family:var(--font-body); padding:20px; display:flex; flex-direction:column; gap:16px; max-height:80dvh; overflow:hidden;">
      
      <!-- General Header Info -->
      <div style="text-align:center; padding-bottom:12px; border-bottom:1px solid var(--color-border-light); flex-shrink:0;">
        <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Desglose de Saldos</div>
        <div style="font-family:var(--font-display); font-size:18px; font-weight:900; color:var(--color-text); margin-top:2px;">${driver.displayName || driver.name}</div>
      </div>

      <!-- Scrollable content area -->
      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:16px; padding-right:4px; -webkit-overflow-scrolling:touch;">
        <!-- Itemized Debt components -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          
          <!-- App Usage Fees -->
          <div style="background:rgba(59,130,246,0.03); border:1px solid rgba(59,130,246,0.1); border-radius:16px; padding:14px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13px; font-weight:900; color:var(--color-text-primary);">Tarifas de Uso App</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">Comisiones de pedidos no liquidados</div>
            </div>
            <div style="font-size:16px; font-weight:900; color:#ef4444; font-family:monospace;">+${formatPrice2(appFeesTotal)}</div>
          </div>

          <!-- Canon Diario -->
          <div style="background:rgba(239,68,68,0.02); border:1px solid rgba(239,68,68,0.08); border-radius:16px; padding:14px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13px; font-weight:900; color:var(--color-text-primary);">Canon Diario / Ajustes</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">Acumulado de cuotas o diferencias de saldo</div>
            </div>
            <div style="font-size:16px; font-weight:900; color:#ef4444; font-family:monospace;">+${formatPrice2(canonFeesTotal)}</div>
          </div>

          <!-- Total Base Debt -->
          <div style="display:flex; justify-content:space-between; align-items:center; padding:0 8px; font-weight:800; font-size:12.5px; border-bottom:1px dashed var(--color-border-light); padding-bottom:10px;">
            <span>Subtotal Deuda (Sistema)</span>
            <span style="color:#ef4444; font-weight:900; font-family:monospace;">${formatPrice2(currentDebt)}</span>
          </div>

          <!-- Coupons Credit (if exists) -->
          ${totalCouponsCredit > 0 ? `
            <div style="background:rgba(168,85,247,0.04); border:1.5px dashed rgba(168,85,247,0.2); border-radius:16px; padding:14px; display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
              <div>
                <div style="font-size:13px; font-weight:900; color:#a855f7;">Cr\xE9dito por Cupones</div>
                <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">Descuentos asumidos por plataforma</div>
              </div>
              <div style="font-size:16px; font-weight:900; color:#a855f7; font-family:monospace;">-${formatPrice2(totalCouponsCredit)}</div>
            </div>
          ` : ""}

        </div>

        <!-- List of itemized orders debt -->
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="font-size:10.5px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Detalle por Pedido Pendiente</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${ordersListHTML}
          </div>
        </div>
      </div>

      <!-- Settle suggestions and net totals -->
      <div style="margin-top:4px; background:linear-gradient(135deg, rgba(16,185,129,0.03) 0%, rgba(16,185,129,0.08) 100%); border:1px solid rgba(16,185,129,0.15); border-radius:20px; padding:16px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm); flex-shrink:0;">
        <div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Verdadero a Liquidar</div>
          <div style="font-size:24px; font-weight:950; color:#10b981; letter-spacing:-0.5px; margin-top:3px; font-family:monospace;">${formatPrice2(finalSettleAmount)}</div>
        </div>
        <div style="text-align:right;">
          <span style="font-size:9.5px; font-weight:900; color:white; background:#10b981; padding:5px 10px; border-radius:8px; text-transform:uppercase; box-shadow:0 4px 10px rgba(16,185,129,0.25);">Neto Sugerido</span>
        </div>
      </div>
      
    </div>
  `;
  showModal2({
    title: `\u2139\uFE0F Detalles de Deuda`,
    hideHeader: false,
    headerBackground: "#E11D48",
    headerTextColor: "#FFFFFF",
    content: detailHTML,
    height: "auto"
  });
}
