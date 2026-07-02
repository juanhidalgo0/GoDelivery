// GoDelivery — Admin Coupons Management Page
import { db } from '../../firebase.js';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';

export async function renderAdminCoupons() {
  const content = document.getElementById('app-content');

  // Premium Violet Layout
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Premium Header with Violet Gradient -->
      <div style="background:linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 20px rgba(126, 34, 206, 0.25); z-index:100;">
        <!-- Decorative Background Circles -->
        <div style="position: absolute; top: -30px; right: -30px; width: 110px; height: 110px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        <div style="position: absolute; bottom: -20px; left: -20px; width: 70px; height: 70px; background: rgba(255,255,255,0.05); border-radius: 50%; pointer-events: none;"></div>

        <button onclick="location.hash='#/admin'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2; transition: background 0.2s;">
          ${icon('chevronLeft', 24)}
        </button>
        
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2; letter-spacing:-0.02em;">Cupones</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.75); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Fidelización & Promociones</p>
        </div>

        <button id="admin-create-coupon-btn" style="height:40px; padding: 0 16px; border-radius:12px; border:none; background:white; color:#7e22ce; font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:6px; position:relative; z-index:2; box-shadow:0 4px 10px rgba(0,0,0,0.1); transition: all 0.2s;">
          ${icon('plus', 16, '', '#7e22ce')} Generar
        </button>
      </div>

      <!-- Main Body -->
      <div style="flex:1; overflow-y:auto; padding:20px; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:20px;">
        
        <!-- Summary Cards -->
        <div id="coupons-stats" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; flex-shrink:0;">
          <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:12px 14px; text-align:center; box-shadow:var(--shadow-sm);">
            <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Activos</div>
            <div id="stat-active" style="font-size:20px; font-weight:900; color:#a855f7;">--</div>
          </div>
          <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:12px 14px; text-align:center; box-shadow:var(--shadow-sm);">
            <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Usados</div>
            <div id="stat-used" style="font-size:20px; font-weight:900; color:#22c55e;">--</div>
          </div>
          <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:12px 14px; text-align:center; box-shadow:var(--shadow-sm);">
            <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Disponibles</div>
            <div id="stat-remaining" style="font-size:20px; font-weight:900; color:var(--color-text);">--</div>
          </div>
        </div>

        <!-- Search Bar -->
        <div style="position:relative; flex-shrink:0;">
          <div style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); pointer-events:none; display:flex; align-items:center;">
            ${icon('search', 18)}
          </div>
          <input type="text" id="coupon-search-input" placeholder="Buscar cupón por código..." style="width:100%; height:48px; border-radius:16px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px 0 44px; font-weight:700; font-size:14px; color:var(--color-text); outline:none; box-sizing:border-box; transition:all 0.2s;" />
        </div>

        <!-- Coupons List Container -->
        <div id="coupons-list" style="display:flex; flex-direction:column; gap:14px; padding-bottom:30px;">
          ${Array(4).fill('<div class="stat-card skeleton" style="height:120px; border-radius:24px;"></div>').join('')}
        </div>
      </div>
    </div>
  `;

  let coupons = [];

  // Load and Render Coupons
  async function loadCoupons() {
    try {
      const snap = await getDocs(query(collection(db, 'coupons'), orderBy('createdAt', 'desc')));
      coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      calculateStats();
      renderCouponsList();
    } catch (err) {
      console.error('Error loading coupons:', err);
      showToast('Error al cargar los cupones', 'error');
    }
  }

  // Calculate and Render Metrics
  function calculateStats() {
    const activeCount = coupons.filter(c => c.active === true).length;
    const totalUsed = coupons.reduce((sum, c) => sum + (c.usedCount || 0), 0);
    const totalRemaining = coupons.reduce((sum, c) => sum + (typeof c.remaining === 'number' ? c.remaining : 0), 0);

    const activeEl = document.getElementById('stat-active');
    const usedEl = document.getElementById('stat-used');
    const remainingEl = document.getElementById('stat-remaining');

    if (activeEl) activeEl.textContent = activeCount;
    if (usedEl) usedEl.textContent = totalUsed;
    if (remainingEl) remainingEl.textContent = totalRemaining;
  }

  // Render Coupons Cards
  function renderCouponsList() {
    const container = document.getElementById('coupons-list');
    const searchVal = document.getElementById('coupon-search-input')?.value.trim().toUpperCase() || '';
    if (!container) return;

    const filtered = coupons.filter(c => c.id.toUpperCase().includes(searchVal));

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); display:flex; flex-direction:column; align-items:center; gap:16px;">
          <div style="width:64px; height:64px; border-radius:50%; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-secondary);">
            ${icon('tag', 30)}
          </div>
          <div>
            <div style="font-weight:800; font-size:16px; color:var(--color-text); margin-bottom:4px;">No se encontraron cupones</div>
            <div style="font-size:12px; font-weight:600;">${searchVal ? 'Probá con otro filtro o código.' : 'Hacé click en Generar para crear el primero.'}</div>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(c => {
      const scope = c.scope || 'products';
      const discountType = c.discountType || (c.type === 'free_delivery' ? 'percentage' : 'percentage');
      const ownerId = c.ownerId || 'admin';
      
      const isFreeDelivery = (c.type === 'free_delivery') || (scope === 'shipping' && discountType === 'percentage' && c.value === 100);
      
      let typeLabel = '';
      if (isFreeDelivery) {
        typeLabel = 'ENVÍO GRATIS';
      } else if (scope === 'shipping') {
        typeLabel = discountType === 'percentage' ? `${c.value}% ENVÍO` : `$${c.value} ENVÍO`;
      } else {
        typeLabel = discountType === 'percentage' ? `${c.value}% OFF` : `$${c.value} OFF`;
      }
      
      const isMerchant = ownerId !== 'admin';
      const typeBadgeBg = isMerchant ? 'rgba(234, 179, 8, 0.1)' : (isFreeDelivery ? 'rgba(34, 197, 94, 0.1)' : 'rgba(168, 85, 247, 0.1)');
      const typeBadgeColor = isMerchant ? '#ca8a04' : (isFreeDelivery ? '#22c55e' : '#a855f7');
      const iconBg = isMerchant ? 'linear-gradient(135deg, #fef08a 0%, #eab308 100%)' : (isFreeDelivery ? 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)' : 'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)');
      
      const usageLimit = c.usageLimit || 0;
      const remaining = typeof c.remaining === 'number' ? c.remaining : 0;
      const usedCount = c.usedCount || 0;
      const percentLeft = usageLimit > 0 ? (remaining / usageLimit) * 100 : 0;

      return `
        <div style="background:var(--color-surface); border:1.5px solid ${c.active ? 'var(--color-border-light)' : 'var(--color-border)'}; border-radius:24px; padding:18px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-sm); opacity:${c.active ? '1' : '0.65'}; transition:all 0.25s; position:relative; overflow:hidden;">
          
          <!-- Top Row: Code and Badge -->
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:44px; height:44px; border-radius:14px; background:${iconBg}; display:flex; align-items:center; justify-content:center; color:white; flex-shrink:0;">
                ${icon('tag', 20)}
              </div>
              <div>
                <div style="font-family:monospace; font-weight:900; font-size:18px; color:var(--color-text); letter-spacing:-0.03em; background:var(--color-bg-secondary); padding:4px 8px; border-radius:8px; display:inline-block; border:1px dashed var(--color-border); text-transform:uppercase;">
                  ${c.id}
                </div>
                <div style="margin-top:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span style="font-size:10px; font-weight:800; background:${typeBadgeBg}; color:${typeBadgeColor}; padding:3px 8px; border-radius:6px; letter-spacing:0.5px; text-transform:uppercase;">
                    ${typeLabel}
                  </span>
                  ${isMerchant ? `
                    <span style="font-size:10px; font-weight:800; background:rgba(227,27,35,0.08); color:var(--color-primary); padding:3px 8px; border-radius:6px; letter-spacing:0.5px; text-transform:uppercase;">
                      ${c.comercioName || 'Comercio'}
                    </span>
                  ` : ''}
                </div>
              </div>
            </div>

            <!-- Active Switch + Delete -->
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="coupon-toggle-btn" data-id="${c.id}" style="width:40px; height:24px; border-radius:12px; background:${c.active ? '#a855f7' : 'var(--color-border)'}; border:none; position:relative; cursor:pointer; outline:none; transition:background 0.2s; padding:0;">
                <div style="width:18px; height:18px; border-radius:50%; background:white; position:absolute; top:3px; left:${c.active ? '19px' : '3px'}; transition:left 0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
              </button>

              <button class="coupon-delete-btn" data-id="${c.id}" style="width:36px; height:36px; border-radius:10px; border:none; background:rgba(239, 68, 68, 0.08); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">
                ${icon('trash', 18)}
              </button>
            </div>
          </div>

          <!-- Progress Bar & Usage stats -->
          <div style="background:var(--color-bg-secondary); border-radius:16px; padding:12px 14px; border:1px solid var(--color-border-light);">
            <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">
              <span>Stock: ${remaining} de ${usageLimit} disponibles</span>
              <span style="font-weight:800; color:${remaining === 0 ? '#ef4444' : 'var(--color-text-primary)'};">${usedCount} canjeados</span>
            </div>
            
            <div style="width:100%; height:8px; background:var(--color-border-light); border-radius:4px; overflow:hidden; position:relative;">
              <div style="width:${percentLeft}%; height:100%; background:${remaining === 0 ? '#ef4444' : 'linear-gradient(90deg, #c084fc 0%, #7e22ce 100%)'}; border-radius:4px; transition:width 0.3s;"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Bind Events
  document.getElementById('coupon-search-input')?.addEventListener('input', renderCouponsList);

  // Card click actions (Toggle and Delete)
  document.getElementById('coupons-list')?.addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('.coupon-toggle-btn');
    const deleteBtn = e.target.closest('.coupon-delete-btn');

    if (toggleBtn) {
      const code = toggleBtn.dataset.id;
      const coupon = coupons.find(c => c.id === code);
      if (!coupon) return;

      const nextActive = !coupon.active;
      try {
        await updateDoc(doc(db, 'coupons', code), { active: nextActive });
        coupon.active = nextActive;
        renderCouponsList();
        calculateStats();
        showToast(nextActive ? 'Cupón activado' : 'Cupón desactivado', 'info');
      } catch (err) {
        console.error('Error toggling coupon status:', err);
        showToast('Error al cambiar estado del cupón', 'error');
      }
    }

    if (deleteBtn) {
      const code = deleteBtn.dataset.id;
      showConfirm({
        title: 'Eliminar Cupón',
        message: `¿Estás seguro de que querés eliminar el cupón <b>${code}</b>? Esta acción no se puede deshacer y los usuarios no podrán volver a utilizarlo.`,
        confirmText: 'Eliminar Cupón',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'coupons', code));
            coupons = coupons.filter(c => c.id !== code);
            renderCouponsList();
            calculateStats();
            showToast('Cupón eliminado con éxito', 'info');
          } catch (err) {
            console.error('Error deleting coupon:', err);
            showToast('Error al eliminar el cupón', 'error');
          }
        }
      });
    }
  });

  // Open modal trigger
  document.getElementById('admin-create-coupon-btn')?.addEventListener('click', () => {
    showGenerateCouponModal(loadCoupons);
  });

  // Initial Load
  await loadCoupons();
}

// Generate unique alphanumeric suffixes
function generateRandomAlphanumeric(length = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid O, I, 0, 1 for visual clarity
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Show Premium Modal for Creating Coupons
function showGenerateCouponModal(onSuccessCallback) {
  showModal({
    title: 'Generar Nuevo Cupón',
    content: `
      <div style="display:flex; flex-direction:column; gap:16px; padding:4px;">
        
        <!-- Segmented Scope Selector -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Aplicar Descuento A</label>
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border);">
            <button id="modal-scope-products" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 6px rgba(0,0,0,0.06); transition:all 0.2s;">
              🛒 Productos
            </button>
            <button id="modal-scope-shipping" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">
              🚚 Envío
            </button>
          </div>
        </div>

        <!-- Segmented Type Selector -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Tipo de Descuento</label>
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border);">
            <button id="modal-type-fixed" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">
              💲 Fijo ($)
            </button>
            <button id="modal-type-percentage" type="button" style="flex:1; height:40px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 6px rgba(0,0,0,0.06); transition:all 0.2s;">
              🏷️ Porcentaje (%)
            </button>
          </div>
        </div>

        <!-- Value Input -->
        <div id="modal-value-container" style="display:flex; flex-direction:column; gap:6px;">
          <label id="modal-value-label" style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Porcentaje de Descuento</label>
          <div style="position:relative;">
            <input type="number" id="modal-coupon-value" value="10" min="1" placeholder="Ej: 15" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 36px 0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
            <span id="modal-value-symbol" style="position:absolute; right:16px; top:50%; transform:translateY(-50%); font-weight:800; color:var(--color-text-secondary);">%</span>
          </div>
        </div>

        <!-- Stock / Limit Input -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Cantidad de Cupones (Stock)</label>
          <input type="number" id="modal-coupon-limit" value="50" min="1" placeholder="Cantidad de usos totales" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-weight:700; font-size:14px; outline:none; box-sizing:border-box; color:var(--color-text);" />
        </div>

        <!-- Code Generation Selector -->
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Código de Cupón</label>
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; border:1px solid var(--color-border); margin-bottom:8px;">
            <button id="modal-code-rand" style="flex:1; height:36px; border-radius:10px; border:none; background:white; color:var(--color-text); font-weight:800; font-size:12px; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 6px rgba(0,0,0,0.06);">
              Aleatorio
            </button>
            <button id="modal-code-custom" style="flex:1; height:36px; border-radius:10px; border:none; background:transparent; color:var(--color-text-tertiary); font-weight:800; font-size:12px; cursor:pointer; transition:all 0.2s;">
              Personalizado
            </button>
          </div>

          <!-- Random Prefix Block -->
          <div id="modal-code-rand-block" style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; gap:10px; align-items:center;">
              <select id="modal-code-prefix" style="flex:1; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 12px; font-weight:700; font-size:14px; outline:none; color:var(--color-text); cursor:pointer;">
                <option value="PROMO-">Prefix: PROMO-</option>
                <option value="ENVIO-">Prefix: ENVIO-</option>
                <option value="GODEL-">Prefix: GODEL-</option>
              </select>
              <button id="modal-code-regenerate-btn" class="btn btn-ghost" style="height:48px; border-radius:14px; font-weight:800; font-size:13px; display:flex; align-items:center; gap:6px; border:1.5px solid var(--color-border); background:var(--color-surface); cursor:pointer;">
                🔄 Generar
              </button>
            </div>
            <div style="font-size:12px; color:var(--color-text-secondary); font-weight:700; padding:4px; text-align:center; background:rgba(126, 34, 206, 0.06); border-radius:10px; border:1px dashed rgba(126, 34, 206, 0.2);">
              Código propuesto: <b id="modal-code-preview" style="font-family:monospace; color:#7e22ce; font-size:14px;">PROMO-XXXX</b>
            </div>
          </div>

          <!-- Custom Code Input -->
          <div id="modal-code-custom-block" style="display:none; flex-direction:column; gap:4px;">
            <input type="text" id="modal-coupon-code" placeholder="Ej: MAGDALENA2026" style="width:100%; height:48px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 16px; font-family:monospace; font-weight:800; font-size:14px; outline:none; box-sizing:border-box; text-transform:uppercase; color:var(--color-text);" />
            <span style="font-size:10px; font-weight:700; color:var(--color-text-tertiary); padding-left:4px;">Solo letras, números y guiones. Se convertirá a mayúsculas.</span>
          </div>
        </div>

      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="modal-coupon-cancel" style="height:48px; border-radius:14px; font-weight:800; flex:1;">Cancelar</button>
      <button class="btn btn-primary" id="modal-coupon-create" style="height:48px; border-radius:14px; font-weight:900; background:linear-gradient(135deg, #a855f7 0%, #7e22ce 100%); border:none; color:white; flex:2; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 18px rgba(126, 34, 206, 0.2);">
        ${icon('check', 16)} CREAR CUPÓN
      </button>
    `
  });

  // State elements for creation modal
  let selectedScope = 'products'; // 'products' or 'shipping'
  let selectedDiscountType = 'percentage'; // 'fixed' or 'percentage'
  let codeMode = 'random'; // 'random' or 'custom'
  let currentRandomCode = '';

  const btnScopeProducts = document.getElementById('modal-scope-products');
  const btnScopeShipping = document.getElementById('modal-scope-shipping');
  const btnTypeFixed = document.getElementById('modal-type-fixed');
  const btnTypePercentage = document.getElementById('modal-type-percentage');
  
  const valueLabel = document.getElementById('modal-value-label');
  const valueSymbol = document.getElementById('modal-value-symbol');
  const valueInput = document.getElementById('modal-coupon-value');
  
  const btnCodeRand = document.getElementById('modal-code-rand');
  const btnCodeCustom = document.getElementById('modal-code-custom');
  const codeRandBlock = document.getElementById('modal-code-rand-block');
  const codeCustomBlock = document.getElementById('modal-code-custom-block');
  const selectPrefix = document.getElementById('modal-code-prefix');
  const regenerateBtn = document.getElementById('modal-code-regenerate-btn');
  const codePreview = document.getElementById('modal-code-preview');
  const codeInput = document.getElementById('modal-coupon-code');

  // Generate preview immediately
  function updateRandomCodePreview() {
    const prefix = selectPrefix ? selectPrefix.value : 'PROMO-';
    currentRandomCode = `${prefix}${generateRandomAlphanumeric(4)}`;
    if (codePreview) codePreview.textContent = currentRandomCode;
  }
  updateRandomCodePreview();

  // Helper styles for segmented buttons
  const setActiveSegButton = (activeBtn, inactiveBtn) => {
    activeBtn.style.background = 'white';
    activeBtn.style.color = 'var(--color-text)';
    activeBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
    inactiveBtn.style.background = 'transparent';
    inactiveBtn.style.color = 'var(--color-text-tertiary)';
    inactiveBtn.style.boxShadow = 'none';
  };

  // Scope selections
  btnScopeProducts?.addEventListener('click', () => {
    selectedScope = 'products';
    setActiveSegButton(btnScopeProducts, btnScopeShipping);
    if (selectPrefix) {
      selectPrefix.innerHTML = `
        <option value="PROMO-">Prefix: PROMO-</option>
        <option value="GODEL-">Prefix: GODEL-</option>
      `;
      updateRandomCodePreview();
    }
  });

  btnScopeShipping?.addEventListener('click', () => {
    selectedScope = 'shipping';
    setActiveSegButton(btnScopeShipping, btnScopeProducts);
    if (selectPrefix) {
      selectPrefix.innerHTML = `
        <option value="ENVIO-">Prefix: ENVIO-</option>
        <option value="GODEL-">Prefix: GODEL-</option>
      `;
      updateRandomCodePreview();
    }
  });

  // Type selections
  btnTypeFixed?.addEventListener('click', () => {
    selectedDiscountType = 'fixed';
    setActiveSegButton(btnTypeFixed, btnTypePercentage);
    if (valueLabel) valueLabel.textContent = 'Monto de Descuento';
    if (valueSymbol) valueSymbol.textContent = '$';
    if (valueInput) {
      valueInput.value = '200';
      valueInput.removeAttribute('max');
    }
  });

  btnTypePercentage?.addEventListener('click', () => {
    selectedDiscountType = 'percentage';
    setActiveSegButton(btnTypePercentage, btnTypeFixed);
    if (valueLabel) valueLabel.textContent = 'Porcentaje de Descuento';
    if (valueSymbol) valueSymbol.textContent = '%';
    if (valueInput) {
      valueInput.value = '10';
      valueInput.setAttribute('max', '100');
    }
  });

  // Code selections
  btnCodeRand?.addEventListener('click', () => {
    codeMode = 'random';
    setActiveSegButton(btnCodeRand, btnCodeCustom);
    if (codeRandBlock) codeRandBlock.style.display = 'flex';
    if (codeCustomBlock) codeCustomBlock.style.display = 'none';
  });

  btnCodeCustom?.addEventListener('click', () => {
    codeMode = 'custom';
    setActiveSegButton(btnCodeCustom, btnCodeRand);
    if (codeRandBlock) codeRandBlock.style.display = 'none';
    if (codeCustomBlock) codeCustomBlock.style.display = 'flex';
    setTimeout(() => codeInput?.focus(), 150);
  });

  // Random generator triggers
  selectPrefix?.addEventListener('change', updateRandomCodePreview);
  regenerateBtn?.addEventListener('click', updateRandomCodePreview);

  // Sanitize manual code inputs in real time
  codeInput?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  });

  // Cancel trigger
  document.getElementById('modal-coupon-cancel')?.addEventListener('click', closeModal);

  // Save / Create Coupon logic
  document.getElementById('modal-coupon-create')?.addEventListener('click', async () => {
    const limitVal = parseInt(document.getElementById('modal-coupon-limit')?.value || '50', 10);
    const valueVal = parseFloat(document.getElementById('modal-coupon-value')?.value || '0');

    let finalCode = '';
    if (codeMode === 'random') {
      finalCode = currentRandomCode;
    } else {
      finalCode = codeInput?.value.trim().toUpperCase() || '';
      if (!finalCode) {
        showToast('Ingresá un código personalizado o usá el modo aleatorio.', 'warning');
        return;
      }
      if (finalCode.length < 3) {
        showToast('El código debe tener al menos 3 caracteres.', 'warning');
        return;
      }
    }

    if (isNaN(limitVal) || limitVal <= 0) {
      showToast('El límite de usos debe ser mayor a 0.', 'warning');
      return;
    }

    if (isNaN(valueVal) || valueVal <= 0) {
      showToast('El valor de descuento debe ser mayor a 0.', 'warning');
      return;
    }

    if (selectedDiscountType === 'percentage' && valueVal > 100) {
      showToast('El porcentaje de descuento no puede ser mayor a 100%.', 'warning');
      return;
    }

    // Disable button to prevent double submit
    const createBtn = document.getElementById('modal-coupon-create');
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.innerHTML = `Creando...`;
    }

    try {
      // 1. Zero-Trust Check: Ensure it does not already exist
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

      // 2. Write to Firestore
      await setDoc(docRef, {
        active: true,
        ownerId: 'admin',
        scope: selectedScope,
        discountType: selectedDiscountType,
        absorbedBy: 'platform',
        type: (selectedScope === 'shipping' && selectedDiscountType === 'percentage' && valueVal === 100) ? 'free_delivery' : (selectedDiscountType === 'percentage' ? 'percentage' : 'fixed'),
        value: valueVal,
        usageLimit: limitVal,
        remaining: limitVal,
        usedCount: 0,
        createdAt: serverTimestamp()
      });

      showToast(`¡Cupón ${finalCode} creado con éxito!`, 'success');
      closeModal();
      if (onSuccessCallback) onSuccessCallback();
    } catch (err) {
      console.error('Error creating coupon:', err);
      showToast('Error al crear el cupón.', 'error');
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.innerHTML = `${icon('check', 16)} CREAR CUPÓN`;
      }
    }
  });
}
