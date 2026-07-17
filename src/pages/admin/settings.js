import { db } from '../../firebase.js';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { isAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { getState, setState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal, closeModal } from '../../components/modal.js';
import { compressImage } from '../../utils/image-compressor.js';

export async function renderAdminSettings() {
  const content = document.getElementById('app-content');
  if (!content) return;

  window.showDeliveryConfigHelp = (type) => {
    let title = '';
    let description = '';
    switch(type) {
      case 'base':
        title = 'Costo Base';
        description = 'Es la tarifa inicial y fija que se aplica a cada envío, independientemente de la distancia recorrida. Se sumará al costo calculado por distancia.';
        break;
      case 'min':
        title = 'Costo Mínimo';
        description = 'Es el precio mínimo total que pagará el cliente por el envío. Si el cálculo de (Costo Base + Kilómetros * Tarifa por KM) da un valor menor a este costo mínimo, se cobrará automáticamente el costo mínimo.';
        break;
      case 'km':
        title = 'Extra por KM';
        description = 'Monto adicional que se suma por cada kilómetro recorrido desde el origen del comercio hasta el domicilio de entrega.';
        break;
      case 'stop':
        title = 'Parada Extra';
        description = 'Cargo que se añade automáticamente al costo de envío por cada comercio intermedio o destino adicional agregado al mismo pedido (pedidos combinados).';
        break;
      case 'rain':
        title = 'Recargo por Lluvia';
        description = 'Monto adicional fijo que se aplica al costo de envío durante días de lluvia o mal clima para incentivar a los repartidores disponibles.';
        break;
    }
    showModal({
      title: `<div style="display:flex;align-items:center;gap:8px;">💡 ${title}</div>`,
      height: 'auto',
      content: `<div style="font-size:14px;color:var(--color-text-secondary);line-height:1.6;padding:12px 0;">${description}</div>`,
      footer: `<button onclick="closeModal()" class="btn btn-primary" style="width:100%;height:46px;border-radius:12px;font-weight:800;">¡Entendido!</button>`
    });
  };

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;position:relative;z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Configuración</h1>
          <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Ajustes del sistema</p>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px 20px calc(20px + env(safe-area-inset-bottom, 0px));-webkit-overflow-scrolling:touch;">
        <div style="display:flex;flex-direction:column;gap:16px;padding-bottom:40px;">

          <!-- 1. Logistics Section (Redirect to dedicated full screen subpage) -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;">
            <a href="#/admin/settings/logistics" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;text-decoration:none;box-sizing:border-box;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);color:#2563eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('bike', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Tarifas de Logística</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Precios de envío, costo por km, viajes y precios fijos</div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</div>
            </a>
          </div>

          <!-- 2. Economy Section -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;">
            <button class="settings-section-toggle" data-target="section-economy" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#d1fae5,#a7f3d0);color:#059669;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('bank', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Economía de la App</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Comisiones, tasas de servicio y contacto</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-economy" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <div>
                  <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Comisión Tienda (%)</label>
                  <input type="number" class="input" id="global-commission-rate" value="${(getState().commissionRate * 100).toFixed(0)}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                </div>
                <div>
                  <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">App Usage Fee (%)</label>
                  <input type="number" class="input" id="global-app-fee-rate" value="${(getState().appUsageFeeRate * 100).toFixed(0)}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr;gap:14px;">
                <div>
                  <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">WhatsApp Pagos</label>
                  <input type="text" class="input" id="global-whatsapp-payments" value="${getState().whatsappPayments || ''}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:14px;" />
                </div>
              </div>

              <!-- Custom Service Fees Config -->
              <div style="border-top:1px dashed var(--color-border-light); margin-top:20px; padding-top:20px;">
                <h4 style="font-family:var(--font-display); font-size:12px; font-weight:800; margin-bottom:14px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Tasas de Servicio Especiales</h4>
                
                <!-- Mandados / Encomiendas -->
                <div style="background:var(--color-bg-secondary); border-radius:18px; padding:16px; border:1px solid var(--color-border-light); margin-bottom:14px;">
                  <div style="font-size:13px; font-weight:850; color:var(--color-text); margin-bottom:12px;">Mandados y Encomiendas</div>
                  <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:12px;">
                    <div>
                      <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700;">Tipo</label>
                      <select class="input" id="fee-config-gofavor-type" style="width:100%; height:40px; border-radius:10px; padding:0 8px; font-size:13px; font-weight:700; background:var(--color-surface); border:1px solid var(--color-border);">
                        <option value="percentage" ${getState().servicesAppFeeConfig?.gofavor?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                        <option value="fixed" ${getState().servicesAppFeeConfig?.gofavor?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700;">Valor</label>
                      <input type="number" step="any" class="input" id="fee-config-gofavor-value" value="${getState().servicesAppFeeConfig?.gofavor?.value !== undefined ? getState().servicesAppFeeConfig?.gofavor?.value : 1.2}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; border:1px solid var(--color-border);" />
                    </div>
                  </div>
                </div>

                <!-- Go Cash -->
                <div style="background:var(--color-bg-secondary); border-radius:18px; padding:16px; border:1px solid var(--color-border-light); margin-bottom:14px;">
                  <div style="font-size:13px; font-weight:850; color:var(--color-text); margin-bottom:12px;">Go Cash (Retiro de Efectivo)</div>
                  <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:12px;">
                    <div>
                      <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700;">Tipo</label>
                      <select class="input" id="fee-config-gocash-type" style="width:100%; height:40px; border-radius:10px; padding:0 8px; font-size:13px; font-weight:700; background:var(--color-surface); border:1px solid var(--color-border);">
                        <option value="percentage" ${getState().servicesAppFeeConfig?.gocash?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                        <option value="fixed" ${getState().servicesAppFeeConfig?.gocash?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700;">Valor</label>
                      <input type="number" step="any" class="input" id="fee-config-gocash-value" value="${getState().servicesAppFeeConfig?.gocash?.value !== undefined ? getState().servicesAppFeeConfig?.gocash?.value : 1.2}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; border:1px solid var(--color-border);" />
                    </div>
                  </div>
                </div>

                <!-- Go Viajes -->
                <div style="background:var(--color-bg-secondary); border-radius:18px; padding:16px; border:1px solid var(--color-border-light);">
                  <div style="font-size:13px; font-weight:850; color:var(--color-text); margin-bottom:12px;">Go Viajes</div>
                  <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:12px;">
                    <div>
                      <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700;">Tipo</label>
                      <select class="input" id="fee-config-goviaje-type" style="width:100%; height:40px; border-radius:10px; padding:0 8px; font-size:13px; font-weight:700; background:var(--color-surface); border:1px solid var(--color-border);">
                        <option value="percentage" ${getState().servicesAppFeeConfig?.goviaje?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                        <option value="fixed" ${getState().servicesAppFeeConfig?.goviaje?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; display:block; font-weight:700;">Valor</label>
                      <input type="number" step="any" class="input" id="fee-config-goviaje-value" value="${getState().servicesAppFeeConfig?.goviaje?.value !== undefined ? getState().servicesAppFeeConfig?.goviaje?.value : 1.2}" style="width:100%; height:40px; border-radius:10px; padding:0 10px; font-weight:700; font-size:14px; border:1px solid var(--color-border);" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Dynamic Schedule Pricing -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;">
            <button class="settings-section-toggle" data-target="section-dynamic-pricing" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#e0e7ff,#c7d2fe);color:#4f46e5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('clock', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Tarifas Dinámicas (Horarios)</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Recargos nocturnos e incentivos a repartidores</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-dynamic-pricing" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              
              <style>
                .settings-switch { position: relative; display: inline-block; width: 44px; height: 24px; margin: 0; flex-shrink: 0; }
                .settings-switch input { opacity: 0; width: 0; height: 0; }
                .settings-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .3s; border-radius: 24px; }
                .settings-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.15); }
                .settings-switch input:checked + .settings-slider { background-color: var(--color-primary); }
                .settings-switch input:checked + .settings-slider:before { transform: translateX(20px); }
              </style>
              <div style="border-top:1px dashed var(--color-border-light);padding-top:18px;margin-bottom:20px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin-bottom:14px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Recargo Nocturno (Lo paga el cliente)</h4>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <span style="font-size:13px;font-weight:800;color:var(--color-text);">Activar Recargo Nocturno</span>
                    <label class="settings-switch">
                      <input type="checkbox" id="global-night-surcharge-enabled" ${getState().nightSurchargeConfig?.enabled ? 'checked' : ''}>
                      <span class="settings-slider"></span>
                    </label>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Hora Inicio (ej 00:00)</label>
                      <input type="time" class="input" id="global-night-surcharge-start" value="${getState().nightSurchargeConfig?.start || '00:00'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Hora Fin (ej 06:00)</label>
                      <input type="time" class="input" id="global-night-surcharge-end" value="${getState().nightSurchargeConfig?.end || '06:00'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                    </div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Tipo</label>
                      <select class="input" id="global-night-surcharge-type" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;background:var(--color-surface);">
                        <option value="fixed" ${getState().nightSurchargeConfig?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                        <option value="percentage" ${getState().nightSurchargeConfig?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Valor</label>
                      <input type="number" class="input" id="global-night-surcharge-value" value="${getState().nightSurchargeConfig?.value || 0}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                    </div>
                  </div>
                </div>
              </div>

              <div style="border-top:1px dashed var(--color-border-light);padding-top:18px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin-bottom:14px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Incentivo Repartidor (Lo absorbe GoDelivery)</h4>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <span style="font-size:13px;font-weight:800;color:var(--color-text);">Activar Incentivo</span>
                    <label class="settings-switch">
                      <input type="checkbox" id="global-driver-incentive-enabled" ${getState().driverIncentiveConfig?.enabled ? 'checked' : ''}>
                      <span class="settings-slider"></span>
                    </label>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Hora Inicio (ej 20:00)</label>
                      <input type="time" class="input" id="global-driver-incentive-start" value="${getState().driverIncentiveConfig?.start || '20:00'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Hora Fin (ej 23:59)</label>
                      <input type="time" class="input" id="global-driver-incentive-end" value="${getState().driverIncentiveConfig?.end || '23:59'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                    </div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Tipo</label>
                      <select class="input" id="global-driver-incentive-type" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;background:var(--color-surface);">
                        <option value="fixed" ${getState().driverIncentiveConfig?.type === 'fixed' ? 'selected' : ''}>Monto Fijo ($)</option>
                        <option value="percentage" ${getState().driverIncentiveConfig?.type === 'percentage' ? 'selected' : ''}>Porcentaje (%)</option>
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Valor extra a pagar</label>
                      <input type="number" class="input" id="global-driver-incentive-value" value="${getState().driverIncentiveConfig?.value || 0}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                    </div>
                  </div>
                </div>
              </div>
              
            </div>
          </div>

          <!-- 4. GoPoints Section -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;">
            <button class="settings-section-toggle" data-target="section-gopoints" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fef3c7,#fde68a);color:#d97706;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('sparkles', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Programa GoPoints</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Recompensas, niveles y gamificación</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-gopoints" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
                <div>
                  <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Reembolso (%)</label>
                  <input type="number" step="0.1" class="input" id="global-points-rate" value="${(getState().pointsPerDollar * 100).toFixed(1)}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                </div>
                <div>
                  <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Valor del Punto ($)</label>
                  <input type="number" step="0.1" class="input" id="global-point-value" value="${getState().dollarPerPoint || 1}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                </div>
              </div>

              <div style="background:var(--color-bg-secondary);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:12px;border:1px solid var(--color-border-light);margin-bottom:20px;">
                <div style="width:36px;height:36px;border-radius:10px;background:var(--color-primary);color:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('info', 18)}</div>
                <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.5;">
                  En un pedido de <strong>$10.000</strong>, el cliente ganará <strong id="ref-points-earned" style="color:var(--color-primary);">---</strong> puntos,
                  canjeables por <strong id="ref-discount-value" style="color:var(--color-success);font-weight:800;">---</strong>.
                </div>
              </div>

              <div style="border-top:1px dashed var(--color-border-light);padding-top:18px;margin-top:16px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin-bottom:14px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Bono por Referidos</h4>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);margin-bottom:20px;">
                  <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Puntos por referido</label>
                  <input type="number" class="input" id="global-referral-points" value="${getState().referralPoints || 500}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                </div>
              </div>

              <div style="border-top:1px dashed var(--color-border-light);padding-top:18px;margin-bottom:20px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin-bottom:14px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Desafíos Semanales (Recompensas)</h4>
                <div style="display:flex;flex-direction:column;gap:14px;" id="weekly-challenges-editor-container">
                  ${(getState().weeklyChallenges || []).map((ch, idx) => `
                    <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);" class="challenge-edit-card" data-id="${ch.id}">
                      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                        <span style="font-weight:900;font-family:var(--font-display);font-size:14px;color:var(--color-text);">${ch.title}</span>
                      </div>
                      <div style="display:flex;flex-direction:column;gap:10px;">
                        <div>
                          <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Título del Desafío</label>
                          <input type="text" class="input challenge-title" value="${ch.title}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:13px;" />
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                          <div>
                            <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Pedidos Objetivo</label>
                            <input type="number" class="input challenge-target" value="${ch.target}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                          </div>
                          <div>
                            <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Premio (Puntos)</label>
                            <input type="number" class="input challenge-reward" value="${ch.pointsReward}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                          </div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div style="border-top:1px dashed var(--color-border-light);padding-top:18px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin-bottom:14px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Escalafones (GoLevels)</h4>
                <div style="display:flex;flex-direction:column;gap:14px;">
                  ${Object.entries(getState().levels).map(([key, lvl]) => `
                    <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                        <div style="width:32px;height:32px;border-radius:50%;background:${lvl.color}15;color:${lvl.color};display:flex;align-items:center;justify-content:center;">${icon(lvl.icon, 18)}</div>
                        <span style="font-weight:900;font-family:var(--font-display);font-size:14px;color:var(--color-text);">${lvl.name}</span>
                      </div>
                      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                        <div>
                          <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Pedidos min.</label>
                          <input type="number" class="input level-min-orders" data-level="${key}" value="${lvl.minOrders}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                        </div>
                        <div>
                          <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Multiplicador</label>
                          <input type="number" step="0.05" class="input level-multiplier" data-level="${key}" value="${lvl.multiplier}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:14px;" />
                        </div>
                      </div>
                      <div>
                        <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Beneficios</label>
                        <textarea class="input level-benefits" data-level="${key}" style="width:100%;height:56px;border-radius:10px;padding:8px 10px;font-weight:500;font-size:12px;resize:none;line-height:1.4;">${lvl.benefits || ''}</textarea>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <!-- 4. Image Optimization Section -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;">
            <button class="settings-section-toggle" data-target="section-img-optimize" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#e0f2fe,#bae6fd);color:#0284c7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('image', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Optimización de Imágenes</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Comprimir fotos de comercios y productos a WebP</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-img-optimize" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <p style="font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin-bottom:16px;">
                Esta herramienta escanea la base de datos completa de <strong>Comercios</strong> (logos y banners) y <strong>Productos</strong> (fotos) y comprime todas las imágenes existentes al formato ultraligero <strong>WebP (calidad 75%)</strong>.
                <br><br>
                Esto reduce drásticamente el uso de almacenamiento, acelera la carga en la app y optimiza el consumo de datos de los usuarios.
              </p>
              <button class="btn btn-block" id="btn-optimize-images" style="width:100%;height:52px;border-radius:16px;background:linear-gradient(135deg,#0284c7,#0369a1);color:white;border:none;font-weight:900;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 8px 20px rgba(2,132,199,0.3);">
                ${icon('sparkles', 18)} OPTIMIZAR BASE DE IMÁGENES
              </button>
              <div id="optimize-progress-container" style="display:none;margin-top:16px;background:var(--color-bg-secondary);padding:16px;border-radius:18px;border:1px solid var(--color-border-light);">
                <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:8px;color:var(--color-text);">
                  <span id="opt-progress-status">Procesando...</span>
                  <span id="opt-progress-pct">0%</span>
                </div>
                <div style="width:100%;height:8px;background:var(--color-border-light);border-radius:4px;overflow:hidden;position:relative;">
                  <div id="opt-progress-bar" style="width:0%;height:100%;background:var(--color-primary);transition:width 0.2s ease;"></div>
                </div>
                <div id="opt-progress-results" style="margin-top:12px;font-size:11px;color:var(--color-text-secondary);line-height:1.4;"></div>
              </div>
            </div>
          </div>

          <!-- 5. Push Notifications Texts -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;margin-bottom:20px;">
            <button class="settings-section-toggle" data-target="section-push-texts" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#e0e7ff,#c7d2fe);color:#4f46e5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('bell', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Textos de Notificaciones Push</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Personalizar mensajes automáticos</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-push-texts" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <div style="display:grid;grid-template-columns:1fr;gap:14px;">
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Desconexión por Inactividad</label>
                  <input type="text" id="push-text-disconnect-title" placeholder="Título (ej: Sesión Cerrada)" value="${getState().pushMessages?.disconnect?.title || 'Zzz... Sesión pausada'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:13px;margin-bottom:8px;border:1px solid var(--color-border-light);background:var(--color-surface);" />
                  <textarea id="push-text-disconnect-body" placeholder="Cuerpo del mensaje" style="width:100%;height:56px;border-radius:10px;padding:8px 10px;font-weight:500;font-size:12px;resize:none;line-height:1.4;border:1px solid var(--color-border-light);background:var(--color-surface);">${getState().pushMessages?.disconnect?.body || 'Te desconectamos porque pasaron 3 horas de inactividad.'}</textarea>
                </div>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Nueva Oferta / Anuncio</label>
                  <input type="text" id="push-text-offer-title" placeholder="Título" value="${getState().pushMessages?.offer?.title || '¡Nueva Oferta!'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:13px;margin-bottom:8px;border:1px solid var(--color-border-light);background:var(--color-surface);" />
                  <textarea id="push-text-offer-body" placeholder="Cuerpo del mensaje" style="width:100%;height:56px;border-radius:10px;padding:8px 10px;font-weight:500;font-size:12px;resize:none;line-height:1.4;border:1px solid var(--color-border-light);background:var(--color-surface);">${getState().pushMessages?.offer?.body || 'Aprovechá esta nueva oferta en GoDelivery.'}</textarea>
                </div>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Recargo por Lluvia</label>
                  <input type="text" id="push-text-rain-title" placeholder="Título" value="${getState().pushMessages?.rain?.title || '🌧 ¡Empezó a llover!'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:13px;margin-bottom:8px;border:1px solid var(--color-border-light);background:var(--color-surface);" />
                  <textarea id="push-text-rain-body" placeholder="Cuerpo del mensaje" style="width:100%;height:56px;border-radius:10px;padding:8px 10px;font-weight:500;font-size:12px;resize:none;line-height:1.4;border:1px solid var(--color-border-light);background:var(--color-surface);">${getState().pushMessages?.rain?.body || 'El recargo por lluvia está activo. ¡Conducí con cuidado!'}</textarea>
                </div>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Recargo Nocturno</label>
                  <input type="text" id="push-text-night-title" placeholder="Título" value="${getState().pushMessages?.night?.title || '🌙 Recargo Nocturno Activo'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:13px;margin-bottom:8px;border:1px solid var(--color-border-light);background:var(--color-surface);" />
                  <textarea id="push-text-night-body" placeholder="Cuerpo del mensaje" style="width:100%;height:56px;border-radius:10px;padding:8px 10px;font-weight:500;font-size:12px;resize:none;line-height:1.4;border:1px solid var(--color-border-light);background:var(--color-surface);">${getState().pushMessages?.night?.body || 'Comenzó el horario de recargo nocturno.'}</textarea>
                </div>
                <div style="background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                  <label style="font-size:10px;color:var(--color-text-tertiary);margin-bottom:4px;display:block;font-weight:700;text-transform:uppercase;">Incentivo Extra</label>
                  <input type="text" id="push-text-incentive-title" placeholder="Título" value="${getState().pushMessages?.incentive?.title || '🚀 ¡Incentivo Activo!'}" style="width:100%;height:38px;border-radius:10px;padding:0 10px;font-weight:700;font-size:13px;margin-bottom:8px;border:1px solid var(--color-border-light);background:var(--color-surface);" />
                  <textarea id="push-text-incentive-body" placeholder="Cuerpo del mensaje" style="width:100%;height:56px;border-radius:10px;padding:8px 10px;font-weight:500;font-size:12px;resize:none;line-height:1.4;border:1px solid var(--color-border-light);background:var(--color-surface);">${getState().pushMessages?.incentive?.body || 'Salí a repartir ahora y ganá un extra por cada pedido.'}</textarea>
                </div>
              </div>
            </div>
          </div>

          <!-- 5.5 Brand Theme Section -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;margin-bottom:16px;">
            <button class="settings-section-toggle" data-target="section-brand-theme" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#e2e8f0,#cbd5e1);color:#1e293b;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('settings', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Tema de Marca (Colores)</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Personalizar el color de la aplicación</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-brand-theme" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <div style="display:flex;align-items:center;justify-content:space-between;background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);">
                <div style="display:flex;flex-direction:column;gap:2px;">
                  <span style="font-size:13px;font-weight:800;color:var(--color-text);">Activar Tema Oscuro de Marca</span>
                  <span style="font-size:11px;color:var(--color-text-secondary);font-weight:500;">Reemplaza todos los detalles rojos de la app por el color oscuro (Negro/Slate)</span>
                </div>
                <label class="settings-switch">
                  <input type="checkbox" id="global-use-dark-brand-theme" ${getState().useDarkBrandTheme ? 'checked' : ''}>
                  <span class="settings-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- 5.5 Maintenance Mode -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border-light);border-radius:24px;overflow:hidden;margin-bottom:18px;">
            <button class="settings-section-toggle" data-target="section-maintenance" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fee2e2,#fee2e2);color:#ef4444;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('alertTriangle', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Modo Mantenimiento</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Bloqueo global de la aplicación</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-maintenance" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <div style="display:flex;align-items:center;justify-content:space-between;background:var(--color-bg-secondary);border-radius:18px;padding:16px;border:1px solid var(--color-border-light);margin-bottom:14px;">
                <div style="display:flex;flex-direction:column;gap:2px;">
                  <span style="font-size:13px;font-weight:800;color:var(--color-text);">Activar Modo Mantenimiento</span>
                  <span style="font-size:11px;color:var(--color-text-secondary);font-weight:500;">Bloquea el acceso a clientes, comercios y repartidores de inmediato.</span>
                </div>
                <label class="settings-switch">
                  <input type="checkbox" id="global-maintenance-mode" ${getState().maintenanceMode ? 'checked' : ''}>
                  <span class="settings-slider"></span>
                </label>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label style="font-size:10px;color:var(--color-text-tertiary);font-weight:700;text-transform:uppercase;">Mensaje para los usuarios</label>
                <textarea id="global-maintenance-message" class="input" style="width:100%;height:80px;border-radius:12px;padding:10px;font-weight:600;font-size:13px;background:var(--color-bg-secondary);border:1px solid var(--color-border-light);resize:none;">${getState().maintenanceMessage || ''}</textarea>
              </div>
            </div>
          </div>

          <!-- 6. Danger Zone -->
          <div class="settings-section" style="background:rgba(239,68,68,0.03);border:1.5px solid rgba(239,68,68,0.15);border-radius:24px;overflow:hidden;">
            <button class="settings-section-toggle" data-target="section-danger" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fee2e2,#fecaca);color:#dc2626;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('alertTriangle', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:#dc2626;letter-spacing:-0.01em;">Zona de Peligro</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Mantenimiento crítico del sistema</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-danger" class="settings-section-body" style="display:none;padding:0 20px 20px;">
              <p style="font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin-bottom:16px;">
                Esta acción eliminará <strong>TODOS</strong> los pedidos, chats, liquidaciones, historial de balances y sesiones.
                Los saldos volverán a $0. <span style="color:#dc2626;font-weight:800;">No se puede deshacer.</span>
              </p>
              <button class="btn btn-block" id="btn-hard-reset" style="width:100%;height:52px;border-radius:16px;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;font-weight:900;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 8px 20px rgba(239,68,68,0.3);">
                ${icon('trash', 18)} RESETEO TOTAL (NUCLEAR)
              </button>
            </div>
          </div>
        </div>

          <!-- Save Button (at the bottom) -->
          <button class="btn btn-primary btn-block" id="save-global-settings-btn" style="width:100%;height:56px;border-radius:18px;font-weight:900;font-size:15px;display:flex;align-items:center;justify-content:center;gap:10px;border:none;background:var(--color-primary);color:white;cursor:pointer;box-shadow:0 10px 30px rgba(var(--color-primary-rgb),0.3);">
            ${icon('check', 20)} Guardar Configuración
          </button>

      </div>
    </div>
  `;

  // Accordion toggle logic
  document.querySelectorAll('.settings-section-toggle').forEach(btn => {
    btn.onclick = () => {
      const targetId = btn.dataset.target;
      const body = document.getElementById(targetId);
      const chevron = btn.querySelector('.section-chevron');
      if (!body) return;

      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    };
  });

  // GoPoints live preview
  const updateGoPointsRef = () => {
    const rate = (parseFloat(document.getElementById('global-points-rate')?.value) || 0) / 100;
    const valuePerPoint = parseFloat(document.getElementById('global-point-value')?.value) || 0;
    const points = Math.floor(10000 * rate);
    const discount = points * valuePerPoint;
    const pointsEl = document.getElementById('ref-points-earned');
    const discountEl = document.getElementById('ref-discount-value');
    if (pointsEl) pointsEl.textContent = points;
    if (discountEl) discountEl.textContent = formatPrice(discount);
  };

  document.getElementById('global-points-rate')?.addEventListener('input', updateGoPointsRef);
  document.getElementById('global-point-value')?.addEventListener('input', updateGoPointsRef);
  updateGoPointsRef();

  // Save logic
  document.getElementById('save-global-settings-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-global-settings-btn');
    const deliveryBasePrice = getState().deliveryBasePrice || 1500;
    const deliveryMinPrice = getState().deliveryMinPrice || 1500;
    const deliveryPricePerKm = getState().deliveryPricePerKm || 300;
    const deliveryExtraStopFee = getState().deliveryExtraStopFee || 500;
    const deliveryRainSurcharge = getState().deliveryRainSurcharge || 300;
    const deliveryFixedThresholdKm = getState().deliveryFixedThresholdKm || 0;
    const deliveryFixedThresholdPrice = getState().deliveryFixedThresholdPrice || 0;
    const rainMode = getState().rainMode || 'auto';
    const tripBasePrice = getState().tripBasePrice || 1500;
    const tripMinPrice = getState().tripMinPrice || 1500;
    const tripPricePerKm = getState().tripPricePerKm || 300;
    const commissionRate = (parseFloat(document.getElementById('global-commission-rate').value) || 10) / 100;
    const appUsageFeeRate = (parseFloat(document.getElementById('global-app-fee-rate').value) || 5) / 100;
    const favorPurchaseFee = getState().favorPurchaseFee || 800;
    const servicePaymentErrandFee = getState().servicePaymentErrandFee || 2000;
    const whatsappPayments = document.getElementById('global-whatsapp-payments').value || '5491123456789';
    const pointsPerDollar = (parseFloat(document.getElementById('global-points-rate').value) || 1) / 100;
    const dollarPerPoint = parseFloat(document.getElementById('global-point-value').value) || 1;
    const referralPoints = parseFloat(document.getElementById('global-referral-points').value) || 500;
    const useDarkBrandTheme = document.getElementById('global-use-dark-brand-theme').checked;
    const maintenanceMode = document.getElementById('global-maintenance-mode').checked;
    const maintenanceMessage = document.getElementById('global-maintenance-message').value.trim();

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

    btn.disabled = true;
    btn.innerHTML = icon('loader', 16, 'animate-spin');

    try {
      const currentLevels = { ...getState().levels };
      document.querySelectorAll('.level-min-orders').forEach(input => {
        currentLevels[input.dataset.level].minOrders = parseInt(input.value) || 0;
      });
      document.querySelectorAll('.level-multiplier').forEach(input => {
        currentLevels[input.dataset.level].multiplier = parseFloat(input.value) || 1.0;
      });
      document.querySelectorAll('.level-benefits').forEach(textarea => {
        currentLevels[textarea.dataset.level].benefits = textarea.value || '';
      });

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

      const pushMessages = {
        disconnect: { title: document.getElementById('push-text-disconnect-title').value, body: document.getElementById('push-text-disconnect-body').value },
        offer: { title: document.getElementById('push-text-offer-title').value, body: document.getElementById('push-text-offer-body').value },
        rain: { title: document.getElementById('push-text-rain-title').value, body: document.getElementById('push-text-rain-body').value },
        night: { title: document.getElementById('push-text-night-title').value, body: document.getElementById('push-text-night-body').value },
        incentive: { title: document.getElementById('push-text-incentive-title').value, body: document.getElementById('push-text-incentive-body').value }
      };

      await setDoc(doc(db, 'settings', 'global'), {
        deliveryBasePrice, deliveryMinPrice, deliveryPricePerKm, deliveryExtraStopFee, deliveryRainSurcharge,
        deliveryFixedThresholdKm, deliveryFixedThresholdPrice,
        tripBasePrice, tripMinPrice, tripPricePerKm,
        commissionRate, appUsageFeeRate, pointsPerDollar, dollarPerPoint, referralPoints, weeklyChallenges,
        favorPurchaseFee, servicePaymentErrandFee, whatsappPayments, nightSurchargeConfig, driverIncentiveConfig, pushMessages,
        rainMode, useDarkBrandTheme, maintenanceMode, maintenanceMessage, servicesAppFeeConfig
      }, { merge: true });

      await setDoc(doc(db, 'settings', 'levels'), currentLevels);

      setState('levels', currentLevels);
      setState('deliveryBasePrice', deliveryBasePrice);
      setState('deliveryMinPrice', deliveryMinPrice);
      setState('deliveryPricePerKm', deliveryPricePerKm);
      setState('deliveryExtraStopFee', deliveryExtraStopFee);
      setState('deliveryRainSurcharge', deliveryRainSurcharge);
      setState('deliveryFixedThresholdKm', deliveryFixedThresholdKm);
      setState('deliveryFixedThresholdPrice', deliveryFixedThresholdPrice);
      setState('tripBasePrice', tripBasePrice);
      setState('tripMinPrice', tripMinPrice);
      setState('tripPricePerKm', tripPricePerKm);
      setState('commissionRate', commissionRate);
      setState('appUsageFeeRate', appUsageFeeRate);
      setState('pointsPerDollar', pointsPerDollar);
      setState('dollarPerPoint', dollarPerPoint);
      setState('referralPoints', referralPoints);
      setState('weeklyChallenges', weeklyChallenges);
      setState('favorPurchaseFee', favorPurchaseFee);
      setState('servicePaymentErrandFee', servicePaymentErrandFee);
      setState('whatsappPayments', whatsappPayments);
      setState('nightSurchargeConfig', nightSurchargeConfig);
      setState('driverIncentiveConfig', driverIncentiveConfig);
      setState('pushMessages', pushMessages);
      setState('useDarkBrandTheme', useDarkBrandTheme);
      setState('maintenanceMode', maintenanceMode);
      setState('maintenanceMessage', maintenanceMessage);
      setState('servicesAppFeeConfig', servicesAppFeeConfig);

      showModal({
        title: '<div style="text-align:center;">¡Cambios Guardados!</div>',
        height: 'auto',
        content: `
          <div style="text-align: center; padding: 20px 10px;">
            <div style="color: #10b981; margin-bottom: 16px;">${icon('checkCircle', 56)}</div>
            <p style="font-size: 15px; color: var(--color-text-secondary); margin: 0;">La configuración global se ha actualizado correctamente en todos los dispositivos.</p>
          </div>
        `,
        footer: `<button onclick="this.closest('.modal').querySelector('.modal-close').click()" class="btn btn-primary" style="width:100%; border-radius:12px; height:48px; font-weight:800; font-size: 15px;">Genial</button>`
      });
    } catch (e) {
      console.error('Error saving settings:', e);
      showToast('Error al guardar', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check', 20)} Guardar Configuración`;
    }
  });

  // Hard Reset
  document.getElementById('btn-hard-reset')?.addEventListener('click', async () => {
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
    `;

    showModal({
      title: '⚠️ Reseteo Nuclear',
      height: 'auto',
      content: modalContent,
      footer: `
        <div style="display: flex; gap: 12px; width: 100%; padding-bottom: 12px;">
          <button class="btn btn-ghost" id="btn-cancel-nuclear-${uid}" style="flex: 1; height: 50px; border-radius: 14px; font-weight: 800; font-size: 13.5px; color: var(--color-text-secondary); background: var(--color-bg-secondary); border: 1px solid var(--color-border);">Cancelar</button>
          <button class="btn btn-danger" id="btn-confirm-nuclear-${uid}" style="flex: 1.5; height: 50px; border-radius: 14px; font-weight: 900; font-size: 13.5px; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; box-shadow: 0 6px 16px rgba(239,68,68,0.3);">CONFIRMAR ACCIÓN</button>
        </div>
      `,
      onOpen: () => {
        const cancelBtn = document.getElementById(`btn-cancel-nuclear-${uid}`);
        const confirmBtn = document.getElementById(`btn-confirm-nuclear-${uid}`);
        
        cancelBtn?.addEventListener('click', () => closeModal());
        
        confirmBtn?.addEventListener('click', async () => {
          const keepPoints = document.getElementById('keep-points-check')?.checked || false;
          const keepAds = document.getElementById('keep-ads-check')?.checked || false;
          const keepOffers = document.getElementById('keep-offers-check')?.checked || false;

          closeModal();

          // Wait a moment for modal animation, then show the second confirmation for safety
          setTimeout(() => {
            showConfirm({
              title: '⛔ CONFIRMACIÓN FINAL',
              message: `Estás por realizar una limpieza irreversible de toda la actividad y puntuaciones de la plataforma.<br><br>Se conservarán los usuarios, comercios, productos y las opciones adicionales seleccionadas.<br><br>¿Confirmás que querés proceder con esta acción nuclear?`,
              confirmText: 'SÍ, BORRAR TODO Y RESETEAR',
              danger: true,
              onConfirm: () => performHardReset({ keepPoints, keepAds, keepOffers })
            });
          }, 300);
        });
      }
    });
  });

  // Image optimization listener
  document.getElementById('btn-optimize-images')?.addEventListener('click', () => {
    showConfirm({
      title: '📸 OPTIMIZAR IMÁGENES',
      message: 'Esta acción escaneará todos los comercios y productos de la plataforma y convertirá sus fotos a WebP comprimido (75% calidad).<br><br>¿Deseas iniciar la optimización ahora?',
      confirmText: 'SÍ, OPTIMIZAR',
      onConfirm: runImageOptimization
    });
  });
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
    // 1. Fetch all stores
    const comerciosSnap = await getDocs(collection(db, 'comercios'));
    const comercios = comerciosSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2. Fetch all products across all stores
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

    // Helper to calculate base64 length in bytes
    const getBase64Size = (str) => {
      if (!str || !str.startsWith('data:image')) return 0;
      return Math.round((str.length * 3) / 4);
    };

    // Helper to format bytes
    const formatBytes = (bytes) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1048576).toFixed(1)} MB`;
    };

    resultsText.innerHTML = `Escaneando: <strong>${comercios.length}</strong> comercios y <strong>${allProductsToOptimize.length}</strong> productos...<br>`;

    // 3. Optimize Comercios (Logos and Banners)
    for (const store of comercios) {
      let updatedStore = {};
      let isStoreChanged = false;

      // Optimize Logo
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

      // Optimize Banner
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

    // 4. Optimize Products
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

    // Done!
    if (statusText) statusText.textContent = '¡Optimización completada con éxito!';
    if (pctText) pctText.textContent = '100%';
    if (progressBar) progressBar.style.width = '100%';
    resultsText.innerHTML += `
      <div style="margin-top:10px;padding:12px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);border-radius:12px;color:var(--color-success);font-weight:700;line-height:1.5;">
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

    // 1. Get Firebase Auth ID Token
    const { auth } = await import('../../firebase.js');
    const { getIdToken } = await import('firebase/auth');
    if (!auth.currentUser) {
      showToast('Error: Usuario no autenticado', 'error');
      return;
    }
    const idToken = await getIdToken(auth.currentUser);

    // 2. Call Cloud Function performAdminHardReset
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

    // 3. Clear client-side cache and flag Firestore Offline Persistence (IndexedDB) for cleanup on reload
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

export async function renderAdminLogisticsSettings(container) {
  if (!container) container = document.getElementById('app-content');
  if (!container) return;

  const renderContent = () => {
    const rules = getState().deliveryDistanceRules || [];
    
    // Sort rules to display them logically by km ascending
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

          <!-- Buttons Menu Grid -->
          <div style="display:flex; flex-direction:column; gap:16px; margin-top:8px;">
            
            <!-- Delivery General Button -->
            <button id="btn-show-delivery-general" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(168, 85, 247, 0.1); color:#a855f7; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('bike', 22)}
                </div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">DELIVERY GENERAL</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Costo base, costo por km, recargo lluvia y paradas</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>

            <!-- Go Favores Button -->
            <button id="btn-show-go-favores" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(59, 130, 246, 0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('tag', 22)}
                </div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">GO FAVORES</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Gestión de favores y base para pago de servicios</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>

            <!-- Viajes Button -->
            <button id="btn-show-viajes" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(16, 185, 129, 0.1); color:#10b981; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('mapPin', 22)}
                </div>
                <div>
                  <div style="font-family:var(--font-display); font-size:15px; font-weight:900; color:var(--color-text);">VIAJES (MOTO / AUTO)</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px; font-weight:600;">Costo base, mínimo y extra por kilómetro</div>
                </div>
              </div>
              <div style="color:var(--color-text-tertiary);">${icon('chevronRight', 20)}</div>
            </button>

            <!-- Precio Fijo por KM Button -->
            <button id="btn-show-precio-fijo" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background:var(--color-surface); border:1.5px solid var(--color-border); border-radius:24px; cursor:pointer; text-align:left; transition:all 0.25s ease;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:44px; height:44px; border-radius:14px; background:rgba(245, 158, 11, 0.1); color:#f59e0b; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('trendingUp', 22)}
                </div>
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

    // Bind event listeners for each configuration overlay
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

      // Bind delete handlers
      containerEl.querySelectorAll('.rule-delete-btn').forEach((btn, i) => {
        btn.onclick = () => {
          localRules.splice(i, 1);
          renderRulesList();
        };
      });

      // Bind input changes to keep state synced
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

          // Clean rules: remove empty/invalid rules
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


