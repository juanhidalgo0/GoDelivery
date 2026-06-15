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

  if (!isAdmin()) {
    content.innerHTML = `<div class="empty-state"><p>No tenés acceso a esta sección.</p></div>`;
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
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
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div style="display:flex;flex-direction:column;gap:16px;padding-bottom:40px;">

          <!-- 1. Logistics Section -->
          <div class="settings-section" style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:24px;overflow:hidden;">
            <button class="settings-section-toggle" data-target="section-logistics" style="width:100%;display:flex;align-items:center;gap:14px;padding:20px;background:none;border:none;cursor:pointer;text-align:left;">
              <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);color:#2563eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('bike', 22)}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--font-display);font-size:15px;font-weight:900;color:var(--color-text);letter-spacing:-0.01em;">Tarifas de Logística</div>
                <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:2px;font-weight:600;">Precios de envío, costo por km y paradas extra</div>
              </div>
              <div class="section-chevron" style="color:var(--color-text-tertiary);transition:transform 0.3s;">${icon('chevronDown', 18)}</div>
            </button>
            <div id="section-logistics" class="settings-section-body" style="display:none;padding:0 20px 20px;display:flex;flex-direction:column;gap:18px;">
              <!-- Delivery General -->
              <div style="border-bottom:1px dashed var(--color-border-light);padding-bottom:14px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin:0 0 12px 0;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;">Delivery General</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Costo Base ($)</label>
                    <input type="number" class="input" id="global-delivery-base" value="${getState().deliveryBasePrice || 1500}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Costo Mín. ($)</label>
                    <input type="number" class="input" id="global-delivery-min" value="${getState().deliveryMinPrice || 1500}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Extra por KM ($)</label>
                    <input type="number" class="input" id="global-delivery-km" value="${getState().deliveryPricePerKm || 300}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Parada Extra ($)</label>
                    <input type="number" class="input" id="global-delivery-extra-stop" value="${getState().deliveryExtraStopFee || 500}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                  <div style="grid-column: span 2;">
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Recargo por Lluvia ($)</label>
                    <input type="number" class="input" id="global-delivery-rain-surcharge" value="${getState().deliveryRainSurcharge || 300}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                </div>
              </div>

              <!-- Go Favores -->
              <div style="border-bottom:1px dashed var(--color-border-light);padding-bottom:14px;">
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin:0 0 12px 0;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;">Go Favores</h4>
                <div style="display:grid;grid-template-columns:1fr;gap:14px;">
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Gestión GoFavor ($)</label>
                    <input type="number" class="input" id="global-favor-purchase-fee" value="${getState().favorPurchaseFee || 800}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                </div>
              </div>

              <!-- Viajes -->
              <div>
                <h4 style="font-family:var(--font-display);font-size:12px;font-weight:800;margin:0 0 12px 0;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;">Viajes (Moto / Auto)</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Costo Base ($)</label>
                    <input type="number" class="input" id="global-trip-base" value="${getState().tripBasePrice !== undefined ? getState().tripBasePrice : 1500}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                  <div>
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Costo Mín. ($)</label>
                    <input type="number" class="input" id="global-trip-min" value="${getState().tripMinPrice !== undefined ? getState().tripMinPrice : 1500}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                  <div style="grid-column: span 2;">
                    <label style="font-weight:700;font-size:11px;margin-bottom:6px;display:block;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;">Extra por KM ($)</label>
                    <input type="number" class="input" id="global-trip-km" value="${getState().tripPricePerKm !== undefined ? getState().tripPricePerKm : 300}" style="width:100%;height:48px;border-radius:14px;padding:0 14px;font-weight:700;font-size:15px;" />
                  </div>
                </div>
              </div>
            </div>
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
            </div>
          </div>

          <!-- 3. GoPoints Section -->
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
    const deliveryBasePrice = parseFloat(document.getElementById('global-delivery-base').value) || 0;
    const deliveryMinPrice = parseFloat(document.getElementById('global-delivery-min').value) || 0;
    const deliveryPricePerKm = parseFloat(document.getElementById('global-delivery-km').value) || 0;
    const deliveryExtraStopFee = parseFloat(document.getElementById('global-delivery-extra-stop').value) || 0;
    const deliveryRainSurcharge = parseFloat(document.getElementById('global-delivery-rain-surcharge').value) || 0;
    const tripBasePrice = parseFloat(document.getElementById('global-trip-base').value) || 0;
    const tripMinPrice = parseFloat(document.getElementById('global-trip-min').value) || 0;
    const tripPricePerKm = parseFloat(document.getElementById('global-trip-km').value) || 0;
    const commissionRate = (parseFloat(document.getElementById('global-commission-rate').value) || 10) / 100;
    const appUsageFeeRate = (parseFloat(document.getElementById('global-app-fee-rate').value) || 5) / 100;
    const favorPurchaseFee = parseFloat(document.getElementById('global-favor-purchase-fee').value) || 0;
    const whatsappPayments = document.getElementById('global-whatsapp-payments').value || '5491123456789';
    const pointsPerDollar = (parseFloat(document.getElementById('global-points-rate').value) || 1) / 100;
    const dollarPerPoint = parseFloat(document.getElementById('global-point-value').value) || 1;
    const referralPoints = parseFloat(document.getElementById('global-referral-points').value) || 500;

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

      await setDoc(doc(db, 'settings', 'global'), {
        deliveryBasePrice, deliveryMinPrice, deliveryPricePerKm, deliveryExtraStopFee, deliveryRainSurcharge,
        tripBasePrice, tripMinPrice, tripPricePerKm,
        commissionRate, appUsageFeeRate, pointsPerDollar, dollarPerPoint, referralPoints, weeklyChallenges,
        favorPurchaseFee, whatsappPayments
      }, { merge: true });

      await setDoc(doc(db, 'settings', 'levels'), currentLevels);

      setState('levels', currentLevels);
      setState('deliveryBasePrice', deliveryBasePrice);
      setState('deliveryMinPrice', deliveryMinPrice);
      setState('deliveryPricePerKm', deliveryPricePerKm);
      setState('deliveryExtraStopFee', deliveryExtraStopFee);
      setState('deliveryRainSurcharge', deliveryRainSurcharge);
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
      setState('whatsappPayments', whatsappPayments);

      showToast('Configuración guardada', 'success');
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


