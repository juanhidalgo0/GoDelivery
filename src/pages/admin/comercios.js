import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showModal, closeModal } from '../../components/modal.js';
import { showToast } from '../../components/toast.js';
import { openCropper } from '../../utils/cropper.js';
import { formatPrice } from '../../utils/format.js';
import { getState } from '../../state.js';

export async function renderAdminComercios() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Minimalist 1-Row Header (sticky, identical to Repartidores) -->
      <div style="background:linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); padding:calc(12px + env(safe-area-inset-top, 0px)) 16px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-shrink:0; position:relative; box-shadow:0 4px 20px rgba(0,0,0,0.15); z-index:100; border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <a href="#/admin" style="width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; flex-shrink:0; transition:all 0.2s;">
            ${icon('chevronLeft', 20)}
          </a>
          <div style="display:flex; align-items:center; gap:8px; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <h1 style="font-family:var(--font-display); font-weight:900; font-size:16px; color:white; margin:0; letter-spacing:-0.02em; text-transform:uppercase;">COMERCIOS</h1>
            <span style="color:rgba(255,255,255,0.3); font-size:12px;">•</span>
            <span style="font-size:11px; color:rgba(255,255,255,0.65); font-weight:700; overflow:hidden; text-overflow:ellipsis;">Control & Liquidación</span>
          </div>
        </div>
      </div>

      <!-- Sticky Search + Filter Bar (identical layout to Repartidores) -->
      <div id="comercios-search-bar" style="background:var(--color-bg); border-bottom:1px solid var(--color-border-light); padding:10px 16px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; z-index:50;">
        <div style="position:relative; width:100%;">
          <input type="text" id="comercio-search-input-sticky" placeholder="🔍 Buscar por nombre o rubro..." style="width:100%; height:44px; border-radius:14px; padding:0 16px 0 42px; font-weight:700; font-size:13px; background:var(--color-surface); border:1.5px solid var(--color-border); color:var(--color-text); outline:none; box-sizing:border-box; box-shadow:var(--shadow-sm);" />
          <div style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); display:flex;">
            ${icon('search', 18)}
          </div>
        </div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:2px; -webkit-overflow-scrolling:touch; scrollbar-width:none;">
          <button class="comercio-filter-sticky" data-filter="all" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-primary); color:white;">Todos</button>
          <button class="comercio-filter-sticky" data-filter="debt" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-surface); color:var(--color-text-secondary); border:1px solid var(--color-border);">⚠️ Con Deuda</button>
          <button class="comercio-filter-sticky" data-filter="clean" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-surface); color:var(--color-text-secondary); border:1px solid var(--color-border);">✅ Al Día</button>
          <button class="comercio-filter-sticky" data-filter="pending" style="height:34px; padding:0 14px; border-radius:10px; font-weight:800; font-size:11px; border:none; cursor:pointer; white-space:nowrap; background:var(--color-surface); color:var(--color-text-secondary); border:1px solid var(--color-border);">⏳ Pendientes</button>
        </div>
      </div>

      <!-- Main Container -->
      <div id="comercios-panel-body" style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch; padding-bottom:40px;">
        <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;

  let allComercios = [];
  let allOrders = [];
  let searchQuery = '';
  let filterStatus = 'all';

  const renderComerciosList = () => {
    const body = document.getElementById('comercios-panel-body');
    if (!body) return;

    // Filter out internal system market
    const activeComercios = allComercios.filter(c => {
      const name = (c.name || '').toLowerCase();
      return !(name.includes('go!') && name.includes('market'));
    });

    // Map commerce debt and stats from orders
    const comercioStatsMap = {};
    activeComercios.forEach(c => {
      comercioStatsMap[c.id] = {
        unsettledOrders: [],
        unsettledCommission: 0,
        totalSales: 0,
        ordersCount: 0
      };
    });

    allOrders.forEach(o => {
      if (o.status === 'cancelled') return;
      const cId = o.comercioId;
      if (!cId || !comercioStatsMap[cId]) return;

      comercioStatsMap[cId].ordersCount++;
      comercioStatsMap[cId].totalSales += Number(o.total || 0);

      if (!o.isSettled) {
        const commAmt = Number(o.commissionAmount || 0);
        comercioStatsMap[cId].unsettledCommission += commAmt;
        comercioStatsMap[cId].unsettledOrders.push(o);
      }
    });

    let totalDebtSum = 0;
    let debtCount = 0;
    let cleanCount = 0;
    let pendingCount = 0;

    activeComercios.forEach(c => {
      const stats = comercioStatsMap[c.id] || { unsettledCommission: 0 };
      const debt = stats.unsettledCommission;
      totalDebtSum += debt;
      if (c.approvedByAdmin === false) pendingCount++;
      if (debt > 0) debtCount++;
      else cleanCount++;
    });

    // Filter by search & status
    const filtered = activeComercios.filter(c => {
      const name = (c.name || '').toLowerCase();
      const cat = (c.category || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || name.includes(q) || cat.includes(q);

      if (!matchesSearch) return false;

      const stats = comercioStatsMap[c.id] || { unsettledCommission: 0 };
      const debt = stats.unsettledCommission;

      if (filterStatus === 'debt') return debt > 0;
      if (filterStatus === 'clean') return debt <= 0;
      if (filterStatus === 'pending') return c.approvedByAdmin === false;

      return true;
    });

    body.innerHTML = `
      <!-- KPI Summary Header Card (identical to Repartidores) -->
      <div style="background: linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); border-radius: 24px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); color: white;">
        <div style="font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px;">Comisiones Pendientes por Cobrar (Comercios)</div>
        <div style="font-size: 34px; font-weight: 950; letter-spacing: -1.5px; margin: 4px 0 16px; color: #ef4444;">${formatPrice(totalDebtSum)}</div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);">
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 14px; text-align: center;">
            <div style="font-size: 8.5px; font-weight: 800; color: rgba(255,255,255,0.6); text-transform: uppercase;">Total</div>
            <div style="font-size: 15px; font-weight: 900; margin-top: 2px;">${activeComercios.length}</div>
          </div>
          <div style="background: rgba(239,68,68,0.12); padding: 8px; border-radius: 14px; text-align: center; border: 1px solid rgba(239,68,68,0.25);">
            <div style="font-size: 8.5px; font-weight: 800; color: #ef4444; text-transform: uppercase;">Con Deuda</div>
            <div style="font-size: 15px; font-weight: 900; color: #ef4444; margin-top: 2px;">${debtCount}</div>
          </div>
          <div style="background: rgba(34,197,94,0.12); padding: 8px; border-radius: 14px; text-align: center; border: 1px solid rgba(34,197,94,0.25);">
            <div style="font-size: 8.5px; font-weight: 800; color: #22c55e; text-transform: uppercase;">Al Día</div>
            <div style="font-size: 15px; font-weight: 900; color: #22c55e; margin-top: 2px;">${cleanCount}</div>
          </div>
          <div style="background: rgba(245,158,11,0.1); padding: 8px; border-radius: 14px; text-align: center; border: 1px solid rgba(245,158,11,0.2);">
            <div style="font-size: 8.5px; font-weight: 800; color: #f59e0b; text-transform: uppercase;">Pendientes</div>
            <div style="font-size: 15px; font-weight: 900; color: #f59e0b; margin-top: 2px;">${pendingCount}</div>
          </div>
        </div>
      </div>

      <!-- Comercios Cards List -->
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <h3 style="font-family:var(--font-display); font-size:14px; font-weight:900; margin:0; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Resultados (${filtered.length})</h3>
        </div>

        ${filtered.length === 0 ? `
          <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); background:var(--color-surface); border-radius:20px; border:1px dashed var(--color-border-light);">
            ${icon('search', 32)}
            <p style="margin-top:12px; font-weight:700;">No se encontraron comercios con los criterios de búsqueda.</p>
          </div>
        ` : filtered.map(c => {
          const stats = comercioStatsMap[c.id] || { unsettledCommission: 0, unsettledOrders: [], totalSales: 0 };
          const debt = stats.unsettledCommission;
          const isPendingApproval = c.approvedByAdmin === false;
          const isClean = debt <= 0;
          const logo = c.logo || '/logo.png';

          return `
            <div class="admin-card-v2" style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:24px; padding:18px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-sm); transition:all 0.2s;">
              
              <!-- Card Header -->
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                  <div style="width:48px; height:48px; border-radius:50%; overflow:hidden; border:2px solid var(--color-bg-secondary); background:white; flex-shrink:0; padding:2px; box-shadow:0 4px 10px rgba(0,0,0,0.06);">
                    <img src="${logo}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />
                  </div>
                  <div style="min-width:0;">
                    <div style="font-weight:900; font-size:16px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:-0.01em;">${c.name}</div>
                    <div style="font-size:12px; font-weight:700; color:var(--color-text-tertiary); margin-top:2px;">
                      ${icon('tag', 12)} ${c.category || 'Comercio'} • ${c.phone || c.whatsapp || 'Sin Tel.'}
                    </div>
                  </div>
                </div>

                <!-- Badges -->
                <div style="flex-shrink:0;">
                  ${isPendingApproval ? `
                    <span style="background:rgba(245,158,11,0.1); color:#f59e0b; font-size:10.5px; font-weight:900; padding:5px 10px; border-radius:10px; border:1px solid rgba(245,158,11,0.2);">⏳ Pendiente</span>
                  ` : isClean ? `
                    <span style="background:rgba(34,197,94,0.1); color:#22c55e; font-size:10.5px; font-weight:800; padding:5px 10px; border-radius:10px; border:1px solid rgba(34,197,94,0.2);">✅ Al Día</span>
                  ` : `
                    <span style="background:rgba(239,68,68,0.1); color:#ef4444; font-size:10.5px; font-weight:800; padding:5px 10px; border-radius:10px; border:1px solid rgba(239,68,68,0.2);">⚠️ Debe Comisión</span>
                  `}
                </div>
              </div>

              <!-- Debt & Sales Info -->
              <div style="background:${debt > 0 ? 'linear-gradient(135deg, rgba(239,68,68,0.04) 0%, rgba(239,68,68,0.08) 100%)' : 'linear-gradient(135deg, rgba(34,197,94,0.04) 0%, rgba(34,197,94,0.08) 100%)'}; border:1px solid ${debt > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'}; border-radius:18px; padding:14px; display:flex; align-items:center; justify-content:space-between;">
                <div>
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Comisión Pendiente (${stats.unsettledOrders.length} ped.)</div>
                  <div style="font-size:22px; font-weight:950; color:${debt > 0 ? '#ef4444' : '#22c55e'}; letter-spacing:-0.5px; margin-top:2px;">${formatPrice(debt)}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em;">Ventas Totales</div>
                  <div style="font-size:14px; font-weight:800; color:var(--color-text-secondary); margin-top:2px;">${formatPrice(stats.totalSales)}</div>
                </div>
              </div>

              <!-- Primary Action Buttons -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button data-wsp-comercio="${c.id}" style="height:46px; border-radius:16px; background:linear-gradient(135deg, #25D366 0%, #128C7E 100%); color:white; border:none; font-weight:900; font-size:12.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:0 6px 16px rgba(37,211,102,0.25);">
                  ${icon('whatsappLogo', 18)} WhatsApp Cobro
                </button>
                <button data-settle-comercio="${c.id}" style="height:46px; border-radius:16px; background:${debt > 0 ? 'linear-gradient(135deg, #E11D48 0%, #BE123C 100%)' : 'var(--color-bg-secondary)'}; color:${debt > 0 ? 'white' : 'var(--color-text-tertiary)'}; border:none; font-weight:900; font-size:12.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:${debt > 0 ? '0 6px 16px rgba(225,29,72,0.25)' : 'none'}; opacity:${debt > 0 ? '1' : '0.6'};">
                  ${icon('bank', 18)} Liquidar Comercio
                </button>
              </div>

              <!-- Secondary Controls (Editar / Pedidos) -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; border-top:1px dashed var(--color-border-light); padding-top:12px;">
                <button class="admin-edit-com-btn" data-id="${c.id}" style="height:38px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text); font-weight:800; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                  ${icon('settings', 16)} Editar Perfil
                </button>
                <a href="#/mi-comercio/${c.id}/orders" style="height:38px; border-radius:12px; border:none; background:var(--color-primary-lighter); color:var(--color-primary); font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px; text-decoration:none;">
                  ${icon('package', 16)} Ver Pedidos
                </a>
              </div>

            </div>
          `;
        }).join('')}
      </div>
    `;

    // Attach Listeners
    body.querySelectorAll('.comercio-filter-sticky').forEach(btn => {
      btn.onclick = () => {
        filterStatus = btn.dataset.filter;
        renderComerciosList();
      };
    });

    body.querySelectorAll('[data-wsp-comercio]').forEach(btn => {
      btn.onclick = () => {
        const cId = btn.dataset.wspComercio;
        const comercio = allComercios.find(c => c.id === cId);
        if (!comercio) return;
        const phone = (comercio.phone || comercio.whatsapp || '').replace(/\D/g, '');
        if (!phone) {
          showToast('El comercio no tiene número de teléfono registrado.', 'error');
          return;
        }
        const stats = comercioStatsMap[cId] || { unsettledCommission: 0 };
        const debt = stats.unsettledCommission;
        const bankAlias = getState().bankAlias || getState().whatsappPayments || 'godelivery.oficial';
        const text = `Hola *${comercio.name}*! Te escribimos de GoDelivery para recordarte la rendición de comisiones de tus pedidos:

📌 Comisión Pendiente: ${formatPrice(debt)}

Podés realizar el pago al Alias oficial:
💳 ALIAS: ${bankAlias}

Por favor, enviá el comprobante de transferencia por este medio una vez realizado. ¡Muchas gracias!`;

        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
      };
    });

    body.querySelectorAll('[data-settle-comercio]').forEach(btn => {
      btn.onclick = () => {
        const cId = btn.dataset.settleComercio;
        const comercio = allComercios.find(c => c.id === cId);
        const stats = comercioStatsMap[cId];
        if (!comercio || !stats) return;

        openComercioSettleModal(comercio, stats.unsettledOrders, stats.unsettledCommission, refreshData);
      };
    });

    body.querySelectorAll('.admin-edit-com-btn').forEach(btn => {
      btn.onclick = () => openComercioEditor(allComercios.find(c => c.id === btn.dataset.id), () => refreshData());
    });
  };

  const refreshData = async () => {
    try {
      const [comerciosSnap, ordersSnap] = await Promise.all([
        getDocs(collection(db, 'comercios')),
        getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')))
      ]);
      allComercios = comerciosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      allComercios.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      allOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderComerciosList();
    } catch (err) {
      console.error('Error loading comercios data:', err);
    }
  };

  // Initial load
  await refreshData();

  // Bind sticky search input
  const stickySearchInput = document.getElementById('comercio-search-input-sticky');
  if (stickySearchInput) {
    stickySearchInput.oninput = (e) => {
      searchQuery = e.target.value;
      renderComerciosList();
    };
  }
}

async function openComercioSettleModal(comercio, unsettledOrders, unsettledCommission, onSettled) {
  if (!unsettledOrders || unsettledOrders.length === 0 || unsettledCommission <= 0) {
    showToast('Este comercio no registra comisiones pendientes por liquidar.', 'info');
    return;
  }

  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'padding:20px; display:flex; flex-direction:column; gap:16px;';
  modalContent.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase;">Comercio</div>
      <div style="font-family:var(--font-display); font-size:18px; font-weight:900; color:var(--color-text); margin-top:2px;">${comercio.name}</div>
      <div style="font-size:24px; font-weight:950; color:#ef4444; margin-top:6px;">${formatPrice(unsettledCommission)}</div>
      <div style="font-size:12px; color:var(--color-text-secondary); font-weight:700; margin-top:4px;">${unsettledOrders.length} pedido(s) sin liquidar</div>
    </div>

    <div>
      <label style="font-weight:700; font-size:11px; margin-bottom:6px; display:block; color:var(--color-text-tertiary); text-transform:uppercase;">Método de Cobro / Rendición</label>
      <select id="comercio-settle-method-select" style="width:100%; height:48px; border-radius:14px; padding:0 14px; font-weight:700; font-size:14px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text);">
        <option value="transferencia">🏦 Transferencia Bancaria</option>
        <option value="efectivo">💵 Efectivo</option>
      </select>
    </div>

    <button id="confirm-comercio-settle-btn" style="height:54px; border-radius:18px; background:#22c55e; color:white; border:none; font-weight:900; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 20px rgba(34,197,94,0.25); margin-top:8px;">
      ${icon('checkCircle', 20)} Confirmar Liquidación de Comercio
    </button>
  `;

  showModal({ title: 'Liquidar Comercio', content: modalContent, height: 'auto' });

  modalContent.querySelector('#confirm-comercio-settle-btn').onclick = async () => {
    const btn = modalContent.querySelector('#confirm-comercio-settle-btn');
    btn.disabled = true;
    btn.innerHTML = 'Procesando...';

    try {
      const { addDoc, writeBatch, serverTimestamp } = await import('firebase/firestore');

      // 1. Add settlement record
      await addDoc(collection(db, 'settlements'), {
        type: 'commerce_settlement',
        comercioId: comercio.id,
        comercioName: comercio.name,
        amountCollected: unsettledCommission,
        orderIds: unsettledOrders.map(o => o.id),
        orderCount: unsettledOrders.length,
        createdAt: serverTimestamp(),
        adminEmail: getState().user?.email || 'Admin'
      });

      // 2. Mark orders as settled
      const batch = writeBatch(db);
      unsettledOrders.forEach(o => {
        batch.update(doc(db, 'orders', o.id), {
          isSettled: true,
          settledAt: serverTimestamp()
        });
      });
      await batch.commit();

      closeModal();
      showToast('Liquidación de comercio completada con éxito', 'success');
      if (onSettled) onSettled();
    } catch (err) {
      console.error('Error liquidando comercio:', err);
      showToast('Error al liquidar comercio', 'error');
      btn.disabled = false;
      btn.innerHTML = `${icon('checkCircle', 20)} Confirmar Liquidación de Comercio`;
    }
  };
}

async function openComercioEditor(comercio, onSaved) {
  let platformCategories = [];
  try {
    const platCatsSnap = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
    platformCategories = platCatsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
    if (!platformCategories.some(c => c.name === 'Comida')) {
      platformCategories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
    }
  } catch (err) {
    console.error('Error fetching categories in admin editor:', err);
  }

  let comercioCoords = comercio.coords || null;
  let croppedLogo = comercio.logo || '';
  let croppedBanner = comercio.banner || '';
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden; position:relative;';

  modalContent.innerHTML = `
    <div style="flex:1; overflow-y:auto; padding:24px 20px 10px;">
      <div style="text-align:center; margin-bottom:24px;">
      <div style="width:70px; height:70px; border-radius:50%; overflow:hidden; border:2px solid var(--color-primary); margin:0 auto 12px; background:white; box-shadow:0 8px 20px rgba(0,0,0,0.1); padding:2px;">
        <img src="${comercio.logo || '/logo.png'}" id="edit-com-logo-top-preview" style="width:100%; height:100%; object-fit:cover;" />
      </div>
      <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; margin:0;">Editar Comercio</h2>
      <p style="font-size:12px; color:var(--color-text-tertiary); font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">${comercio.name}</p>
    </div>
    
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Nombre Público *</label>
        <input type="text" id="edit-com-name" value="${comercio.name || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Rubro Principal *</label>
        <select id="edit-com-cat" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none; background:var(--color-bg) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none;">
          ${platformCategories.map(c => `<option value="${c.name}" ${comercio.category === c.name ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Comisión del Sistema (%)</label>
        <input type="number" id="edit-com-commission" placeholder="Ej: 15 (Dejar vacío para global)" value="${comercio.commissionRate !== undefined && comercio.commissionRate !== null ? Math.round(comercio.commissionRate * 100) : ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Logo *</label>
          <div style="position:relative; width:100%; height:120px; border-radius:16px; border:2px dashed var(--color-border); display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--color-bg-secondary); cursor:pointer;">
            <img src="${comercio.logo || '/logo.png'}" id="edit-com-logo-preview" style="width:100%; height:100%; object-fit:cover; position:absolute; inset:0; ${comercio.logo ? '' : 'opacity:0.35;'}" />
            <span id="logo-upload-icon" style="position:relative; z-index:2; pointer-events:none; font-size:24px; color:var(--color-text-tertiary); ${comercio.logo ? 'display:none;' : ''}">${icon('upload', 24)}</span>
            <input type="file" accept="image/*" id="edit-com-logo-file" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
          </div>
        </div>
        <div class="form-group">
          <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Banner *</label>
          <div style="position:relative; width:100%; height:120px; border-radius:16px; border:2px dashed var(--color-border); display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--color-bg-secondary); cursor:pointer;">
            <img src="${comercio.banner || '/logo.png'}" id="edit-com-banner-preview" style="width:100%; height:100%; object-fit:cover; position:absolute; inset:0; ${comercio.banner ? '' : 'opacity:0.12;'}" />
            <span id="banner-upload-icon" style="position:relative; z-index:2; pointer-events:none; font-size:24px; color:var(--color-text-tertiary); ${comercio.banner ? 'display:none;' : ''}">${icon('upload', 24)}</span>
            <input type="file" accept="image/*" id="edit-com-banner-file" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
          </div>
        </div>
      </div>

      <div class="form-group">
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px;">Dirección Física *</label>
        <div style="display:flex; gap:10px; width:100%; position:relative;">
          <div style="position:relative; flex:1;">
            <input type="text" id="edit-com-address" value="${comercio.address || ''}" style="width:100%; height:54px; border-radius:16px; border:1px solid var(--color-border); padding:0 16px; font-weight:600; font-size:15px; outline:none;" autocomplete="off" />
            <div id="edit-com-address-suggestions" style="position:absolute; top:100%; left:0; right:0; background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:12px; box-shadow:var(--shadow-lg); z-index:9999; max-height:200px; overflow-y:auto; margin-top:4px; display:none;"></div>
          </div>
          <button type="button" class="btn btn-primary" id="open-com-map-btn" style="width:54px; height:54px; border-radius:16px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border:none; background:var(--color-primary); color:white; cursor:pointer;">
            ${icon('mapPin', 24)}
          </button>
        </div>
        <div id="edit-com-address-badge" style="display:none; font-size:12px; font-weight:700; color:#0d9488; background:rgba(13,148,136,0.06); border:1px solid rgba(13,148,136,0.18); border-radius:8px; padding:8px 12px; align-items:center; gap:6px; word-break:break-all; line-height:1.4; margin-top:8px;">
          ${icon('checkCircle', 14)} Dirección seleccionada y verificada
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:14px; background:var(--color-bg-secondary); padding:16px; border-radius:16px; border:1px solid var(--color-border-light);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <label style="display:block; font-size:13px; font-weight:800; color:var(--color-text-primary);">Aprobado por Administrador</label>
            <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:600;">Permite que el comercio aparezca en la app</span>
          </div>
          <input type="checkbox" id="edit-com-approved" ${comercio.approvedByAdmin !== false ? 'checked' : ''} style="width:22px; height:22px; accent-color:var(--color-primary); cursor:pointer;" />
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--color-border-light); padding-top:12px; margin-top:4px;">
          <div>
            <label style="display:block; font-size:13px; font-weight:800; color:var(--color-text-primary);">Comercio Activo (Visible)</label>
            <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:600;">Controla la visibilidad pública en la app</span>
          </div>
          <input type="checkbox" id="edit-com-active" ${comercio.isActive !== false ? 'checked' : ''} style="width:22px; height:22px; accent-color:var(--color-primary); cursor:pointer;" />
        </div>
      </div>

    </div>
  </div>

  <div style="padding:20px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0)); display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--color-border-light); background:var(--color-bg); flex-shrink:0; z-index:10; box-sizing:border-box;">
    <button id="save-com-btn" style="width:100%; height:56px; border-radius:18px; background:var(--color-primary); color:white; border:none; font-weight:900; font-size:16px; cursor:pointer; box-shadow:0 10px 30px rgba(var(--color-primary-rgb),0.25);">
      Guardar Cambios
    </button>
    <div style="display:flex; gap:10px;">
      <button id="delete-com-btn" style="flex:1; height:46px; border-radius:14px; background:transparent; color:var(--color-danger); border:1.5px solid var(--color-danger); font-weight:800; font-size:13px; cursor:pointer;">
        Eliminar
      </button>
      <a href="#/mi-comercio/${comercio.id}/orders" style="flex:2; height:46px; border-radius:14px; background:var(--color-bg-secondary); color:var(--color-text); border:1.5px solid var(--color-border); display:flex; align-items:center; justify-content:center; text-decoration:none; font-weight:800; font-size:13px; gap:6px;">
        ${icon('package', 16)} Administrar Productos
      </a>
    </div>
  </div>
  `;

  showModal({ title: '', hideHeader: true, height: '90dvh', content: modalContent });

  const addressInput = modalContent.querySelector('#edit-com-address');
  const suggestionsDropdown = modalContent.querySelector('#edit-com-address-suggestions');
  const badgeEl = modalContent.querySelector('#edit-com-address-badge');

  const selectLocation = (coords, address) => {
    comercioCoords = coords;
    if (addressInput) addressInput.value = address;
    if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';

    if (badgeEl) {
      badgeEl.style.display = 'flex';
      badgeEl.innerHTML = `${icon('checkCircle', 14)} Dirección seleccionada y verificada: <span style="font-weight:800; margin-left:4px; color:var(--color-text-primary);">${address}</span>`;
    }
  };

  if (comercioCoords && comercio.address && badgeEl) {
    selectLocation(comercioCoords, comercio.address);
  }

  let debounceTimeout;
  addressInput?.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    const term = e.target.value;
    if (term.trim().length < 3) {
      if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const { searchAddressSuggestions } = await import('../../utils/geo.js');
        const suggestions = await searchAddressSuggestions(term);
        if (suggestions.length === 0) {
          if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
          return;
        }

        if (suggestionsDropdown) {
          suggestionsDropdown.innerHTML = suggestions.map(s => `
            <div class="suggestion-item" data-lat="${s.lat || ''}" data-lng="${s.lng || ''}" data-placeid="${s.placeId || ''}" data-addr="${s.address}" style="padding:12px 16px; font-size:13px; font-weight:600; color:var(--color-text-primary); cursor:pointer; border-bottom:1px solid var(--color-border-light);">
              ${s.address}
            </div>
          `).join('');
          suggestionsDropdown.style.display = 'block';

          suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.onclick = async () => {
              let lat = parseFloat(item.dataset.lat);
              let lng = parseFloat(item.dataset.lng);
              const placeId = item.dataset.placeid;
              const addr = item.dataset.addr;

              if (isNaN(lat) || isNaN(lng)) {
                if (placeId) {
                  try {
                    const { geocodePlaceId } = await import('../../utils/geo.js');
                    const coords = await geocodePlaceId(placeId);
                    if (coords) {
                      selectLocation({ lat: coords.lat, lng: coords.lng }, addr);
                    } else {
                      console.error('Failed to geocode suggestion place ID');
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }
              } else {
                selectLocation({ lat, lng }, addr);
              }
            };
          });
        }
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }, 400);
  });

  // Handle Logo Upload via Cropper
  modalContent.querySelector('#edit-com-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 1, circular: true });
        croppedLogo = cropped;
        
        const preview = modalContent.querySelector('#edit-com-logo-preview');
        if (preview) {
          preview.src = cropped;
          preview.style.opacity = '1';
        }
        const topPreview = modalContent.querySelector('#edit-com-logo-top-preview');
        if (topPreview) {
          topPreview.src = cropped;
        }
        const iconEl = modalContent.querySelector('#logo-upload-icon');
        if (iconEl) iconEl.style.display = 'none';
      } catch (err) {
        console.error('Error cropping logo:', err);
      }
    }
  });

  // Handle Banner Upload via Cropper
  modalContent.querySelector('#edit-com-banner-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const cropped = await openCropper(file, { aspectRatio: 16/8 });
        croppedBanner = cropped;
        
        const preview = modalContent.querySelector('#edit-com-banner-preview');
        if (preview) {
          preview.src = cropped;
          preview.style.opacity = '1';
        }
        const iconEl = modalContent.querySelector('#banner-upload-icon');
        if (iconEl) iconEl.style.display = 'none';
      } catch (err) {
        console.error('Error cropping banner:', err);
      }
    }
  });

  modalContent.querySelector('#open-com-map-btn')?.addEventListener('click', async () => {
    try {
      const { showLocationPicker } = await import('../../components/location-modal.js');
      showLocationPicker({
        initialCoords: comercioCoords,
        initialAddress: addressInput ? addressInput.value : '',
        onSelect: ({ coords, address }) => {
          selectLocation(coords, address);
        }
      });
    } catch (err) {
      console.error(err);
      showToast('Error al abrir el mapa', 'danger');
    }
  });

  // Handle Save
  modalContent.querySelector('#save-com-btn').onclick = async () => {
    const btn = modalContent.querySelector('#save-com-btn');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    const commValue = document.getElementById('edit-com-commission').value;

    const updateData = {
      name: document.getElementById('edit-com-name').value.trim(),
      category: document.getElementById('edit-com-cat').value.trim(),
      logo: croppedLogo,
      banner: croppedBanner,
      address: document.getElementById('edit-com-address').value.trim(),
      coords: comercioCoords,
      approvedByAdmin: document.getElementById('edit-com-approved').checked,
      isActive: document.getElementById('edit-com-active').checked
    };

    const showCenterAlert = (title, message) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        opacity: 0;
        transition: opacity 0.2s ease-out;
      `;
      
      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 24px;
        padding: 24px;
        width: 90%;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        transform: scale(0.9);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      `;
      
      card.innerHTML = `
        <div style="
          width: 56px;
          height: 56px;
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h3 style="margin: 0 0 10px 0; font-family: var(--font-display); font-size: 18px; font-weight: 900; color: var(--color-text-primary);">${title}</h3>
        <p style="margin: 0 0 24px 0; font-size: 13.5px; color: var(--color-text-secondary); line-height: 1.5; font-weight: 600;">${message}</p>
        <button id="alert-close-btn" style="
          width: 100%;
          height: 50px;
          border: none;
          background: var(--color-primary);
          color: white;
          font-weight: 850;
          font-size: 14px;
          border-radius: 14px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.2);
        ">Entendido</button>
      `;
      
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        card.style.transform = 'scale(1)';
      });
      
      const closeAlert = () => {
        overlay.style.opacity = '0';
        card.style.transform = 'scale(0.9)';
        setTimeout(() => {
          overlay.remove();
        }, 200);
      };
      
      card.querySelector('#alert-close-btn').onclick = closeAlert;
      overlay.onclick = (e) => {
        if (e.target === overlay) closeAlert();
      };
    };

    if (!updateData.name || !updateData.category || !updateData.logo || !updateData.banner || !updateData.address || !updateData.coords) {
      showCenterAlert('Datos Incompletos', 'Todos los datos del comercio, incluyendo ubicación en mapa, logo y banner son obligatorios para poder guardar los cambios.');
      btn.disabled = false;
      btn.innerText = 'Guardar Cambios';
      return;
    }

    if (commValue !== '') {
      updateData.commissionRate = parseFloat(commValue) / 100;
    } else {
      updateData.commissionRate = null;
    }

    try {
      await updateDoc(doc(db, 'comercios', comercio.id), updateData);
      
      if (updateData.approvedByAdmin && comercio.ownerId) {
        try {
          await updateDoc(doc(db, 'users', comercio.ownerId), {
            role: 'comercio',
            isComercio: true,
            commerceStatus: 'approved'
          });
        } catch (userErr) {
          console.error('Error updating user role on commerce approval:', userErr);
        }
      }
      
      showToast('Perfil actualizado correctamente', 'success');
      closeModal();
      onSaved();
    } catch (err) {
      console.error('Error saving commerce profile:', err);
      showToast('Error al guardar cambios', 'danger');
      btn.disabled = false;
      btn.innerText = 'Guardar Cambios';
    }
  };

  // Handle Delete
  modalContent.querySelector('#delete-com-btn').onclick = () => {
    import('../../components/modal.js').then(m => {
      m.showConfirm({
        title: '¿Eliminar Comercio?',
        message: `Esta acción es definitiva. Se borrará "${comercio.name}" y toda su configuración. ¿Estás seguro?`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'comercios', comercio.id));
            showToast('Comercio eliminado', 'success');
            closeModal();
            onSaved();
          } catch (err) {
            console.error('Error deleting commerce:', err);
            showToast('Error al eliminar', 'danger');
          }
        }
      });
    });
  };
}
