import { db } from '../../firebase.js';
import { collection, query, orderBy, getDocs, where } from 'firebase/firestore';
import { formatPrice, formatDate } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';

export async function renderAdminCommissions() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:var(--color-bg);">
      <!-- Red Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;position:relative;z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;">Comisiones</h1>
          <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Liquidación de saldos</p>
        </div>
        <button id="view-settlements-btn" style="width:40px; height:40px; border-radius:12px; border:none; background:rgba(255,255,255,0.15); color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; position:relative; z-index:2;">
          ${icon('history', 20)}
        </button>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div id="global-commissions-summary" style="margin-bottom: var(--space-6);"></div>

        <div class="tab-pills" style="margin-bottom:var(--space-6); display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none;">
          <button class="tab-pill active" data-tab="comercios" style="flex:1; white-space:nowrap; padding:10px 16px; border-radius:14px; border:none; font-weight:700; font-size:13px; cursor:pointer; background:var(--color-bg-secondary); color:var(--color-text-tertiary);">Comercios</button>
          <button class="tab-pill" data-tab="repartidores" style="flex:1; white-space:nowrap; padding:10px 16px; border-radius:14px; border:none; font-weight:700; font-size:13px; cursor:pointer; background:var(--color-bg-secondary); color:var(--color-text-tertiary);">Repartidores</button>
        </div>

        <div class="search-bar" style="margin-bottom:var(--space-5); background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:0 16px; height:52px; display:flex; align-items:center; gap:12px; box-shadow:var(--shadow-sm);">
          <span style="color:var(--color-text-tertiary); display:flex;">${icon('search', 20)}</span>
          <input type="text" id="commission-search" placeholder="Buscar..." style="flex:1; border:none; background:transparent; font-size:15px; font-weight:500; color:var(--color-text); outline:none;" />
        </div>

        <div id="comercios-list-container">
          <div class="loader-dots" style="margin: 4rem auto;"><span></span><span></span><span></span></div>
        </div>

        <div id="orders-detail-container" class="orders-overlay"></div>
        <div id="settlements-container" class="orders-overlay"></div>
      </div>
    </div>
  `;

  await loadAndGroupOrders();
  
  document.getElementById('view-settlements-btn')?.addEventListener('click', showSettlementsHistory);

  // Tab switching logic
  document.querySelectorAll('.tab-pill').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pill').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'var(--color-bg-secondary)';
        b.style.color = 'var(--color-text-tertiary)';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--color-primary)';
      btn.style.color = 'white';
      
      const tab = btn.dataset.tab;
      if (tab === 'comercios') {
        renderComerciosList();
      } else {
        renderDriversList();
      }
    };
  });
  
  // Initial active style
  const activeTab = document.querySelector('.tab-pill.active');
  if (activeTab) {
    activeTab.style.background = 'var(--color-primary)';
    activeTab.style.color = 'white';
  }

  document.getElementById('commission-search')?.addEventListener('input', (e) => {
    const activeTab = document.querySelector('.tab-pill.active').dataset.tab;
    const filter = e.target.value.toLowerCase();
    if (activeTab === 'comercios') {
      renderComerciosList(filter);
    } else {
      renderDriversList(filter);
    }
  });
}

let groupedComercios = {};
let groupedDrivers = {};

async function loadAndGroupOrders() {
  const container = document.getElementById('comercios-list-container');
  try {
    const [comerciosSnap, ordersSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'comercios')),
      getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'users'))
    ]);

    groupedDrivers = {};
    usersSnap.docs.forEach(doc => {
      const data = doc.data();
      // Filter drivers using the same logic as admin/users.js
      if (data.role === 'delivery' || data.isDelivery === true) {
        groupedDrivers[doc.id] = {
          id: doc.id,
          name: data.displayName || 'Repartidor sin nombre',
          debt: data.deliveryDebt || 0,
          photo: data.photoURL || '',
          deliveryId: data.deliveryId || '---',
          orders: []
        };
      }
    });

    const activeOrders = ordersSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(o => !o.isSettled);

    let globalAppFees = 0;
    let globalCommissions = 0;

    activeOrders.forEach(order => {
      globalAppFees += (order.appUsageFee || 0);
      globalCommissions += (order.commissionAmount || 0);

      const cid = order.comercioId;
      // If order belongs to a commerce that for some reason isn't in 'comercios' collection, create it
      if (!groupedComercios[cid]) {
        groupedComercios[cid] = {
          id: cid,
          name: order.comercioName || 'Comercio desconocido',
          orders: [],
          totalSales: 0,
          totalCommission: 0,
          pendingCount: 0,
          confirmedCount: 0,
          completedCount: 0
        };
      }
      
      groupedComercios[cid].orders.push(order);
      
      if (order.status !== 'cancelled') {
        groupedComercios[cid].totalSales += order.total;
        groupedComercios[cid].totalCommission += (order.commissionAmount || 0);
      }
      
      if (order.status === 'pending') groupedComercios[cid].pendingCount++;
      if (order.status === 'confirmed') groupedComercios[cid].confirmedCount++;
      if (order.status === 'completed') groupedComercios[cid].completedCount++;

      // Also track orders for drivers if they are completed but not paid in debt
      if (order.driverId && order.status === 'completed' && order.commissionStatus !== 'paid') {
        if (groupedDrivers[order.driverId]) {
          groupedDrivers[order.driverId].orders.push(order);
        }
      }
    });

    // Render Global Summary
    const summaryTarget = document.getElementById('global-commissions-summary');
    if (summaryTarget) {
      summaryTarget.innerHTML = `        <div style="background: linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); border: 1px solid rgba(255,255,255,0.06); border-radius: 32px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); position: relative; overflow: hidden;">
          <!-- Abstract Background Glow -->
          <div style="position:absolute; top:-20px; right:-20px; width:120px; height:120px; background:var(--color-primary); filter:blur(60px); opacity:0.15; border-radius:50%;"></div>
          
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
            <div>
              <span style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.7;">Balance Pendiente</span>
              <div style="font-size: 36px; font-weight: 950; color: white; letter-spacing: -1.5px; margin-top: 4px;">${formatPrice(globalAppFees + globalCommissions)}</div>
            </div>
            <div style="background: rgba(var(--color-primary-rgb), 0.15); color: var(--color-primary); padding: 6px 12px; border-radius: 12px; font-size: 11px; font-weight: 900; display: flex; align-items: center; gap: 6px;">
              <span style="width: 6px; height: 6px; background: var(--color-primary); border-radius: 50%; display: inline-block; box-shadow: 0 0 8px var(--color-primary);"></span>
              EN VIVO
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08);">
            <div style="background: rgba(255,255,255,0.03); padding: 12px 16px; border-radius: 18px; border: 1px solid rgba(255,255,255,0.04);">
              <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin-bottom: 4px; opacity: 0.6;">Tarifas App</div>
              <div style="font-size: 18px; font-weight: 800; color: white; letter-spacing: -0.5px;">${formatPrice(globalAppFees)}</div>
            </div>
            <div style="background: rgba(var(--color-primary-rgb),0.05); padding: 12px 16px; border-radius: 18px; border: 1px solid rgba(var(--color-primary-rgb),0.1);">
              <div style="font-size: 10px; font-weight: 800; color: var(--color-primary); text-transform: uppercase; margin-bottom: 4px; opacity: 0.8;">Comisiones</div>
              <div style="font-size: 18px; font-weight: 800; color: var(--color-primary); letter-spacing: -0.5px;">${formatPrice(globalCommissions)}</div>
            </div>
          </div>
        </div>
      `;
    }

    renderComerciosList();
  } catch (err) {
    console.error('Error loading commissions:', err);
    container.innerHTML = `<div class="alert alert-danger">Error al cargar comisiones.</div>`;
  }
}


function renderComerciosList(filter = '') {
  const container = document.getElementById('comercios-list-container');
  const comercios = Object.values(groupedComercios).filter(c => 
    c.name.toLowerCase().includes(filter)
  );

  if (comercios.length === 0) {
    container.innerHTML = `
      <div class="empty-state-mini" style="padding: 5rem 1rem; background: var(--color-bg-secondary); border-radius: var(--radius-2xl); border: 1px dashed var(--color-border);">
        <div style="opacity: 0.2; margin-bottom: 1rem;">${icon('search', 48)}</div>
        <p style="color: var(--color-text-secondary);">No hay comisiones pendientes de liquidar</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${comercios.map(c => `
        <div class="commerce-card-modern page-enter" data-id="${c.id}" style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:24px; padding:18px; display:flex; align-items:center; justify-content:space-between; gap:16px; cursor:pointer; transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow:var(--shadow-sm);">
          <div style="display:flex; align-items:center; gap:14px; min-width:0;">
            <div style="width:52px; height:52px; background:rgba(var(--color-primary-rgb), 0.05); border-radius:18px; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--color-primary);">
              ${icon('bank', 24)}
            </div>
            <div style="min-width:0;">
              <h3 style="font-weight:800; font-size:16px; color:var(--color-text); margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.name}</h3>
              <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                <span style="background:var(--color-bg-secondary); color:var(--color-text-tertiary); padding:3px 8px; border-radius:8px; font-size:11px; font-weight:700; display:flex; align-items:center; gap:4px;">
                  ${icon('shoppingBag', 12)} ${c.orders.length} pedidos
                </span>
              </div>
            </div>
          </div>
          
          <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
            <div style="text-align:right;">
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">Saldo</div>
              <div style="font-size:17px; font-weight:900; color:var(--color-primary); letter-spacing:-0.5px;">${formatPrice(c.totalCommission)}</div>
            </div>
            <div style="width:36px; height:36px; border-radius:12px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary);">
              ${icon('chevronRight', 18)}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.commerce-card-modern').forEach(card => {
    card.addEventListener('click', () => showOrdersDetail(card.dataset.id));
  });
}

function showOrdersDetail(commerceId) {
  const comercio = groupedComercios[commerceId];
  if (!comercio) return;

  const overlay = document.getElementById('orders-detail-container');
  overlay.innerHTML = `
    <div class="orders-detail-content page-enter" style="background: var(--color-bg); padding: 0;">
      <div class="detail-header" style="padding: 16px 20px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); position: sticky; top: 0; z-index: 100; display: flex; align-items: center; gap: 16px;">
        <button class="close-detail-btn" style="width: 40px; height: 40px; border-radius: 12px; background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); color: var(--color-text); display: flex; align-items: center; justify-content: center; cursor: pointer;">
          ${icon('back', 24)}
        </button>
        <h2 style="font-family:var(--font-display); font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin:0;">${comercio.name}</h2>
      </div>
      
      <div style="padding: 20px;">
        <div style="background: linear-gradient(135deg, var(--color-primary) 0%, #a30b11 100%); padding: 32px 24px; border-radius: 32px; box-shadow: 0 16px 32px rgba(var(--color-primary-rgb), 0.2); color: white; margin-bottom: 32px; text-align: center;">
          <div style="font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.7); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">Total a Cobrar</div>
          <div style="font-size: 48px; font-weight: 950; letter-spacing: -2px;">${formatPrice(comercio.totalCommission)}</div>
          <div style="display: flex; justify-content: center; gap: 24px; margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div>
              <div style="font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.6); text-transform: uppercase; margin-bottom: 2px;">Ventas</div>
              <div style="font-size: 16px; font-weight: 800;">${formatPrice(comercio.totalSales)}</div>
            </div>
            <div>
              <div style="font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.6); text-transform: uppercase; margin-bottom: 2px;">Pedidos</div>
              <div style="font-size: 16px; font-weight: 800;">${comercio.orders.length}</div>
            </div>
          </div>
        </div>

        <div class="action-bar" style="margin-bottom: 32px;">
          <button class="btn btn-block" id="settle-btn" style="background: var(--color-success); color: white; border: none; height: 64px; border-radius: 20px; font-size: 17px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 30px rgba(0, 214, 127, 0.3);">
            ${icon('checkCircle', 22)} Confirmar Cobro
          </button>
          <p style="text-align:center; font-size:12px; color:var(--color-text-tertiary); margin-top:14px; font-weight:500; line-height:1.5; padding: 0 20px;">
            Confirmá que ya recibiste el dinero. Esto marcará los pedidos como pagados y reiniciará el balance.
          </p>
        </div>

        <h3 style="font-size: 17px; font-weight: 800; margin-bottom: 16px; padding-left: 4px; display:flex; align-items:center; gap:8px;">
          ${icon('folder', 18)} Detalles del Período
        </h3>
        <div class="orders-vertical-list" style="display: flex; flex-direction: column; gap: 12px;">
          ${comercio.orders.map(o => `
            <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px; box-shadow: var(--shadow-sm);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <div>
                  <div style="font-weight: 800; color: var(--color-primary); font-size: 12px; margin-bottom: 2px; letter-spacing: 0.5px;">#${o.orderId || '---'}</div>
                  <div style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 600;">${formatDate(o.createdAt?.toDate())}</div>
                </div>
                <span class="badge ${getStatusBadge(o.status)}" style="padding: 4px 10px; border-radius: 8px; font-size: 9px; font-weight: 800; text-transform: uppercase;">
                  ${getStatusLabel(o.status)}
                </span>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 12px; border-top: 1px dashed var(--color-border-light);">
                <div>
                  <div style="font-size: 9px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Venta</div>
                  <div style="font-size: 16px; font-weight: 800; color: var(--color-text);">${formatPrice(o.total)}</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 9px; font-weight: 800; color: var(--color-primary); text-transform: uppercase; margin-bottom: 2px;">Comisión</div>
                  <div style="font-size: 16px; font-weight: 800; color: var(--color-primary);">${formatPrice(o.commissionAmount)}</div>
                </div>
              </div>

              ${o.couponCode ? `
                <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px dotted var(--color-border-light); font-size: 11px; font-weight: 700; color: var(--color-text-secondary);">
                  <span>Cupón: <span style="font-family: monospace; background: var(--color-bg-secondary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--color-border-light);">${o.couponCode}</span></span>
                  <span style="color: ${o.couponAbsorbedBy === 'comercio' ? '#ef4444' : 'var(--color-text-tertiary)'};">
                    -${formatPrice(o.couponDiscount)} (${o.couponAbsorbedBy === 'comercio' ? 'Asumido Comercio' : 'Asumido Plataforma'})
                  </span>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  overlay.classList.add('active');
  document.body.classList.add('overlay-open');

  overlay.querySelector('.close-detail-btn').addEventListener('click', () => {
    overlay.classList.remove('active');
    document.body.classList.remove('overlay-open');
  });

  overlay.querySelector('#settle-btn').addEventListener('click', () => settleComercio(commerceId));
}

async function settleComercio(commerceId) {
  const comercio = groupedComercios[commerceId];
  const { showConfirm } = await import('../../components/modal.js');
  
  showConfirm({
    title: 'Confirmar Liquidación',
    message: `¿Confirmás que cobraste <b>${formatPrice(comercio.totalCommission)}</b> de ${comercio.name}?`,
    confirmText: 'Sí, cobrar ahora',
    onConfirm: async () => {
      try {
        const { addDoc, doc, updateDoc, writeBatch, serverTimestamp } = await import('firebase/firestore');
        const batch = writeBatch(db);
        
        await addDoc(collection(db, 'settlements'), {
          comercioId: commerceId,
          comercioName: comercio.name,
          totalSales: comercio.totalSales,
          amountCollected: comercio.totalCommission,
          orderCount: comercio.orders.length,
          type: 'commerce_settlement',
          createdAt: serverTimestamp()
        });

        comercio.orders.forEach(o => {
          batch.update(doc(db, 'orders', o.id), { 
            isSettled: true,
            commissionStatus: 'paid',
            settledAt: serverTimestamp()
          });
        });

        await batch.commit();
        showToast('Cobro registrado', 'success');
        document.getElementById('orders-detail-container').classList.remove('active');
        document.body.classList.remove('overlay-open');
        loadAndGroupOrders();
      } catch (err) {
        console.error('Error settling:', err);
        showToast('Error al procesar el cobro', 'danger');
      }
    }
  });
}

async function showSettlementsHistory() {
  const overlay = document.getElementById('settlements-container');
  overlay.innerHTML = `
    <div class="orders-detail-content page-enter" style="background:var(--color-bg); padding:0;">
      <div class="detail-header" style="padding:16px 20px; background:var(--color-primary); position:sticky; top:0; z-index:100; display:flex; align-items:center; gap:16px; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <button class="close-settlements-btn" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; color:white; display:flex; align-items:center; justify-content:center; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <h2 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; flex:1; position:relative; z-index:2; letter-spacing:-0.02em;">Historial de Cobros</h2>
        <button id="clear-history-btn" title="Limpiar todo el historial" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); color:white; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; position:relative; z-index:2;">
          ${icon('trash', 20)}
        </button>
      </div>
      
      <div style="padding:20px;">
        <div id="settlements-category-filters" style="margin-bottom:12px;"></div>
        <div id="settlements-filters-target" style="margin-bottom:24px;"></div>
        <div id="settlements-list">
          <div class="loader-dots" style="margin:4rem auto;"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>
  `;

  overlay.classList.add('active');
  document.body.classList.add('overlay-open');

  overlay.querySelector('.close-settlements-btn').addEventListener('click', () => {
    overlay.classList.remove('active');
    document.body.classList.remove('overlay-open');
  });

  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    showConfirm({
      title: 'Limpiar historial',
      message: '¿Estás seguro de que querés borrar TODO el historial de cobros y liquidaciones? Esta acción no se puede deshacer.',
      confirmText: 'Borrar todo',
      danger: true,
      onConfirm: async () => {
        try {
          showToast('Limpiando historial...', 'info');
          const { collection, getDocs, writeBatch } = await import('firebase/firestore');
          const snap = await getDocs(collection(db, 'settlements'));
          
          if (snap.empty) {
            showToast('El historial ya está vacío', 'info');
            return;
          }

          const docs = snap.docs;
          for (let i = 0; i < docs.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = docs.slice(i, i + 500);
            chunk.forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          
          showToast('Historial limpiado correctamente', 'success');
          const list = document.getElementById('settlements-list');
          if (list) {
            list.innerHTML = `
              <div class="empty-state-mini" style="padding: 5rem 1rem; background: var(--color-bg-secondary); border-radius: 28px; border: 1px dashed var(--color-border);">
                <div style="opacity: 0.15; margin-bottom: 1.5rem; color: var(--color-text-tertiary);">${icon('folder', 56)}</div>
                <p style="color: var(--color-text-secondary); font-weight: 700; font-size:14px;">No hay registros para este período</p>
              </div>
            `;
          }
        } catch (e) {
          console.error(e);
          showToast('Error al limpiar historial', 'error');
        }
      }
    });
  });

  try {
    const { getDocs, collection, query, where, orderBy } = await import('firebase/firestore');
    
    // Fetch from both collections for total transparency
    const [settlementsSnap, transSnap] = await Promise.all([
      getDocs(query(collection(db, 'settlements'), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, 'delivery_transactions'), where('type', '==', 'liquidation')))
    ]);

    let settlements = settlementsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const transactions = transSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Convert transactions to settlement format and merge
    // De-duplicate if they represent the same event (unlikely but safe)
    const normalizedTrans = transactions.filter(t => {
      // Avoid duplicates if they are already in settlements (by checking timestamp and driverId)
      const exists = settlements.find(s => 
        s.type === 'driver_debt' && 
        s.driverId === t.driverId && 
        s.createdAt?.toMillis() === t.createdAt?.toMillis()
      );
      return !exists;
    }).map(t => {
      const driver = groupedDrivers[t.driverId];
      return {
        id: t.id,
        driverId: t.driverId,
        driverName: driver?.name || 'Repartidor',
        deliveryId: driver?.deliveryId || '---',
        amountCollected: Math.abs(t.amount || 0),
        type: 'driver_debt',
        createdAt: t.createdAt,
        description: t.description
      };
    });

    let history = [...settlements, ...normalizedTrans].sort((a, b) => 
      (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
    );

    const list = document.getElementById('settlements-list');
    const categoryTarget = document.getElementById('settlements-category-filters');
    const filtersTarget = document.getElementById('settlements-filters-target');
    
    let currentMonth = 'all';
    let currentCategory = 'all';

    const updateHistory = () => {
      let filtered = [...history];
      if (currentMonth !== 'all') {
        const month = parseInt(currentMonth);
        filtered = filtered.filter(s => s.createdAt?.toDate().getMonth() === month);
      }
      if (currentCategory !== 'all') {
        filtered = filtered.filter(s => s.type === currentCategory);
      }
      renderHistory(filtered);
    };

    const renderHistory = (items) => {
      if (items.length === 0) {
        list.innerHTML = `
          <div class="empty-state-mini" style="padding: 5rem 1rem; background: var(--color-bg-secondary); border-radius: 28px; border: 1px dashed var(--color-border);">
            <div style="opacity: 0.15; margin-bottom: 1.5rem; color: var(--color-text-tertiary);">${icon('folder', 56)}</div>
            <p style="color: var(--color-text-secondary); font-weight: 700; font-size:14px;">No hay registros para este período</p>
          </div>
        `;
        return;
      }
      
      const totalPeriod = items.reduce((s, i) => s + (i.amountCollected || 0), 0);
      
      list.innerHTML = `
        <div style="background:var(--color-surface); border:1px solid var(--color-border); padding:20px; border-radius:24px; margin-bottom:24px; text-align:center; box-shadow:var(--shadow-sm);">
          <div style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Total Recaudado en el Período</div>
          <div style="font-size:28px; font-weight:950; color:var(--color-success); letter-spacing:-1px;">${formatPrice(totalPeriod)}</div>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${items.map(s => `
            <div style="padding: 16px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow:var(--shadow-xs);">
              <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
                <div style="width: 44px; height: 44px; background: var(--color-success-light); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--color-success); flex-shrink: 0;">
                  ${icon('checkCircle', 20)}
                </div>
                <div style="min-width: 0;">
                  <div style="font-weight: 800; font-size: 14px; color: var(--color-text); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${s.comercioName || s.driverName || 'Liquidación'} 
                    ${s.type === 'driver_debt' ? `<span style="font-size: 11px; font-weight: 700; color: var(--color-primary); opacity: 0.8; margin-left: 4px;">(${s.deliveryId || groupedDrivers[s.driverId]?.deliveryId || '---'})</span>` : ''}
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 4px; background: ${s.type === 'driver_debt' ? 'var(--color-primary-lighter)' : 'var(--color-bg-secondary)'}; color: ${s.type === 'driver_debt' ? 'var(--color-primary)' : 'var(--color-text-tertiary)'}; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${s.type === 'driver_debt' ? 'Repartidor' : 'Comercio'}
                    </span>
                    <span style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 600;">
                      ${formatDate(s.createdAt?.toDate())} ${s.orderCount ? `• ${s.orderCount} ped.` : ''}
                    </span>
                  </div>
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <div style="font-weight: 900; font-size: 16px; color: var(--color-text); letter-spacing: -0.5px;">
                  ${formatPrice(s.amountCollected)}
                </div>
                <div style="font-size: 9px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Completado</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    let monthChipsHtml = '<button class="chip active" data-value="all" style="padding: 8px 16px; border-radius: 12px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 12px; font-weight: 800; color: var(--color-text-tertiary); cursor: pointer; transition: all 0.2s;">Todos</button>';
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthChipsHtml += `<button class="chip" data-value="${d.getMonth()}" style="padding: 8px 16px; border-radius: 12px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 12px; font-weight: 800; color: var(--color-text-tertiary); cursor: pointer; white-space: nowrap; transition: all 0.2s;">${months[d.getMonth()]} ${d.getFullYear()}</button>`;
    }

    categoryTarget.innerHTML = `
      <div style="display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px;">
        <button class="cat-chip active" data-cat="all" style="padding: 10px 16px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 13px; font-weight: 800; color: var(--color-text-tertiary); cursor: pointer; white-space: nowrap; transition: all 0.2s;">Todos</button>
        <button class="cat-chip" data-cat="commerce_settlement" style="padding: 10px 16px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 13px; font-weight: 800; color: var(--color-text-tertiary); cursor: pointer; white-space: nowrap; transition: all 0.2s;">Comercios</button>
        <button class="cat-chip" data-cat="driver_debt" style="padding: 10px 16px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 13px; font-weight: 800; color: var(--color-text-tertiary); cursor: pointer; white-space: nowrap; transition: all 0.2s;">Repartidores</button>
      </div>
    `;

    filtersTarget.innerHTML = `
      <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; display: flex; gap: 8px; padding-bottom: 4px;">
        ${monthChipsHtml}
      </div>
      <style>
        .chip.active, .cat-chip.active { background: var(--color-primary) !important; color: white !important; border-color: var(--color-primary) !important; box-shadow: 0 4px 10px rgba(var(--color-primary-rgb), 0.2); }
      </style>
    `;

    const catChips = categoryTarget.querySelectorAll('.cat-chip');
    catChips.forEach(chip => {
      chip.addEventListener('click', () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentCategory = chip.dataset.cat;
        updateHistory();
      });
    });

    const chips = filtersTarget.querySelectorAll('.chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentMonth = chip.dataset.value;
        updateHistory();
      });
    });

    renderHistory(history);
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function getStatusBadge(status) {
  switch (status) {
    case 'completed': return 'badge-success';
    case 'confirmed': return 'badge-primary';
    case 'cancelled': return 'badge-danger';
    default: return 'badge-warning';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'completed': return 'Completado';
    case 'confirmed': return 'Confirmado';
    case 'cancelled': return 'Cancelado';
    default: return 'Pendiente';
  }
}

function renderDriversList(filter = '') {
  const container = document.getElementById('comercios-list-container');
  const drivers = Object.values(groupedDrivers).filter(d => 
    d.name.toLowerCase().includes(filter) || d.deliveryId.toLowerCase().includes(filter)
  ).sort((a, b) => b.debt - a.debt);

  if (drivers.length === 0) {
    container.innerHTML = `
      <div class="empty-state-mini" style="padding: 5rem 1rem; background: var(--color-bg-secondary); border-radius: var(--radius-2xl); border: 1px dashed var(--color-border);">
        <div style="opacity: 0.2; margin-bottom: 1rem;">${icon('search', 48)}</div>
        <p style="color: var(--color-text-secondary);">No se encontraron repartidores</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${drivers.map(d => `
        <div class="driver-card-modern page-enter" data-id="${d.id}" style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:24px; padding:18px; display:flex; align-items:center; justify-content:space-between; gap:16px; cursor:pointer; transition:all 0.2s; box-shadow:var(--shadow-sm);">
          <div style="display:flex; align-items:center; gap:14px; min-width:0;">
            <div style="width:52px; height:52px; background:rgba(234, 179, 8, 0.08); border-radius:18px; display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden; color: #ca8a04;">
              ${d.photo ? `<img src="${d.photo}" style="width:100%;height:100%;object-fit:cover;" />` : icon('bike', 24)}
            </div>
            <div style="min-width:0;">
              <h3 style="font-weight:800; font-size:16px; color:var(--color-text); margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.name}</h3>
              <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                <span style="background:var(--color-bg-secondary); color:var(--color-text-tertiary); padding:3px 8px; border-radius:8px; font-size:11px; font-weight:700;">ID: ${d.deliveryId}</span>
              </div>
            </div>
          </div>
          
          <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
            <div style="text-align:right;">
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">Deuda Total</div>
              <div style="font-size:17px; font-weight:900; color:${d.debt > 0 ? 'var(--color-success)' : 'var(--color-text-tertiary)'}; letter-spacing:-0.5px;">${formatPrice(d.debt)}</div>
            </div>
            <div style="width:36px; height:36px; border-radius:12px; background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary);">
              ${icon('chevronRight', 18)}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.driver-card-modern').forEach(card => {
    card.addEventListener('click', () => showDriverDetail(card.dataset.id));
  });
}

function showDriverDetail(driverId) {
  const driver = groupedDrivers[driverId];
  if (!driver) return;

  const overlay = document.getElementById('orders-detail-container');
  overlay.innerHTML = `
    <div class="orders-detail-content page-enter" style="background: var(--color-bg); padding: 0;">
      <div class="detail-header" style="padding: 16px 20px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); position: sticky; top: 0; z-index: 100; display: flex; align-items: center; gap: 16px;">
        <button class="close-detail-btn" style="width: 44px; height: 44px; border-radius: 14px; background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); color: var(--color-text); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;">
          ${icon('chevronLeft', 28, '', 'var(--color-text)')}
        </button>
        <h2 style="font-family:var(--font-display); font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin:0;">${driver.name}</h2>
      </div>
      
      
      <div style="padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e1e2d 0%, #11111d 100%); padding: 32px 24px; border-radius: 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); color: white; margin-bottom: 32px; position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,0.08);">
           <div style="position:absolute; top:-20px; right:-20px; width:120px; height:120px; background:var(--color-primary); filter:blur(60px); opacity:0.12; border-radius:50%;"></div>
           
           <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <div>
                <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; opacity:0.7;">Tarifa App</div>
                <div style="font-size: 20px; font-weight: 900; color: white;">${formatPrice(driver.orders.reduce((s, o) => s + (o.appUsageFee || 0), 0))}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 10px; font-weight: 800; color: var(--color-primary); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; opacity:1;">Comisiones</div>
                <div style="font-size: 20px; font-weight: 900; color: var(--color-primary);">${formatPrice(driver.orders.reduce((s, o) => s + (o.commissionAmount || 0), 0))}</div>
              </div>
            </div>
            
            <div style="text-align: center;">
              <div style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 2.5px; margin-bottom: 8px; opacity:0.6;">Deuda Total a Liquidar</div>
              <div style="font-size: 48px; font-weight: 950; color: white; letter-spacing: -2px; text-shadow: 0 4px 12px rgba(0,0,0,0.3);">${formatPrice(driver.debt)}</div>
            </div>
        </div>

        <div class="action-bar" style="margin-bottom: 32px;">
          <button class="btn btn-block" id="settle-driver-btn" style="background: var(--color-success); color: white; border: none; height: 64px; border-radius: 20px; font-size: 17px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 30px rgba(0, 214, 127, 0.3);">
            ${icon('checkCircle', 22)} Confirmar Liquidación
          </button>
          <p style="text-align:center; font-size:12px; color:var(--color-text-tertiary); margin-top:14px; font-weight:500; line-height:1.5; padding: 0 20px;">
            Confirmá que el repartidor ya entregó el dinero correspondiente a la plataforma.
          </p>
        </div>

        <h3 style="font-size: 17px; font-weight: 800; margin-bottom: 16px; padding-left: 4px; display:flex; align-items:center; gap:8px;">
          ${icon('bike', 18)} Últimas Entregas
        </h3>
        <div class="orders-vertical-list" style="display: flex; flex-direction: column; gap: 12px;">
          ${driver.orders.length > 0 ? driver.orders.map(o => `
            <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px; box-shadow: var(--shadow-sm);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <div>
                  <div style="font-weight: 800; color: var(--color-text); font-size: 14px; margin-bottom: 2px;">${o.comercioName}</div>
                  <div style="font-size: 11px; color: var(--color-text-tertiary); font-weight: 600;">#${o.orderId || '---'} • ${formatDate(o.deliveredAt?.toDate())}</div>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 12px; border-top: 1px dashed var(--color-border-light);">
                <div>
                  <div style="font-size: 9px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; margin-bottom: 2px;">Tarifa App</div>
                  <div style="font-size: 15px; font-weight: 800; color: var(--color-text);">${formatPrice(o.appUsageFee || 0)}</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 9px; font-weight: 800; color: var(--color-primary); text-transform: uppercase; margin-bottom: 2px;">Comisión</div>
                  <div style="font-size: 15px; font-weight: 800; color: var(--color-primary);">${formatPrice(o.commissionAmount || 0)}</div>
                </div>
              </div>
            </div>
          `).join('') : `
            <div style="text-align:center; padding: 3rem 1rem; color:var(--color-text-tertiary); font-size:14px; background:var(--color-bg-secondary); border-radius:24px; border:1px dashed var(--color-border-light);">
              No hay órdenes individuales pendientes, pero el balance de deuda es de ${formatPrice(driver.debt)}.
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  overlay.classList.add('active');
  document.body.classList.add('overlay-open');

  overlay.querySelector('.close-detail-btn').addEventListener('click', () => {
    overlay.classList.remove('active');
    document.body.classList.remove('overlay-open');
  });

  overlay.querySelector('#settle-driver-btn').addEventListener('click', () => settleDriver(driverId));
}

async function settleDriver(driverId) {
  const driver = groupedDrivers[driverId];
  const { showModal, closeModal } = await import('../../components/modal.js');
  
  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding:24px; background:var(--color-bg);';
  modalEl.innerHTML = `
    <div style="margin-bottom:24px; text-align:center;">
      <h3 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:var(--color-text); margin:0;">Liquidación de Deuda</h3>
      <p style="font-size:13px; color:var(--color-text-tertiary); margin-top:4px;">Repartidor: <b>${driver.name}</b> (${driver.deliveryId})</p>
    </div>

    <div style="background:var(--color-bg-secondary); border-radius:24px; padding:24px; border:1px solid var(--color-border-light); margin-bottom:24px;">
      <label style="display:block; font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; text-align:center;">Monto a Liquidar ($)</label>
      <input type="number" id="settle-amount-input" value="${driver.debt}" style="width:100%; height:64px; border-radius:18px; background:var(--color-surface); border:2px solid var(--color-primary); color:var(--color-text); font-size:28px; font-weight:950; text-align:center; outline:none;" />
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:16px;">
        <button id="liquidate-all-btn" style="height:40px; border-radius:12px; border:1px solid var(--color-primary); background:rgba(var(--color-primary-rgb), 0.1); color:var(--color-primary); font-size:11px; font-weight:800; cursor:pointer; text-transform:uppercase;">Todo: ${formatPrice(driver.debt)}</button>
        <button id="liquidate-clear-btn" style="height:40px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text-tertiary); font-size:11px; font-weight:800; cursor:pointer; text-transform:uppercase;">Limpiar</button>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:12px;">
      <button class="btn btn-primary" id="confirm-settle-btn" style="width:100%; height:60px; border-radius:18px; background:var(--color-success); color:white; border:none; font-weight:900; font-size:17px; cursor:pointer; box-shadow:0 10px 25px rgba(0,214,127,0.3); display:flex; align-items:center; justify-content:center; gap:12px;">
        ${icon('checkCircle', 22)} CONFIRMAR PAGO
      </button>
      <button class="btn" id="cancel-settle-btn" style="width:100%; height:52px; border-radius:18px; background:transparent; border:none; color:var(--color-text-tertiary); font-weight:800; font-size:14px; cursor:pointer;">Cancelar</button>
    </div>
  `;

  showModal({ title: 'Liquidar Deuda', content: modalEl, height: 'auto' });

  const input = modalEl.querySelector('#settle-amount-input');
  modalEl.querySelector('#liquidate-all-btn').onclick = () => { input.value = driver.debt; };
  modalEl.querySelector('#liquidate-clear-btn').onclick = () => { input.value = 0; input.focus(); };
  modalEl.querySelector('#cancel-settle-btn').onclick = () => closeModal();

  modalEl.querySelector('#confirm-settle-btn').onclick = async () => {
    const amountToSettle = parseFloat(input.value) || 0;
    if (amountToSettle <= 0) {
      showToast('Ingresá un monto válido', 'warning');
      return;
    }

    const btn = modalEl.querySelector('#confirm-settle-btn');
    btn.disabled = true;
    btn.innerHTML = icon('loader', 20, 'animate-spin') + ' PROCESANDO...';

    try {
      const { doc, updateDoc, writeBatch, serverTimestamp, addDoc, increment, collection } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      // 1. Subtract the entered amount from user debt
      batch.update(doc(db, 'users', driverId), { 
        deliveryDebt: increment(-amountToSettle) 
      });

      // 2. Register a settlement for platform revenue tracking (Admin history)
      const settlementRef = doc(collection(db, 'settlements'));
      batch.set(settlementRef, {
        driverId: driverId,
        driverName: driver.name,
        deliveryId: driver.deliveryId,
        amountCollected: amountToSettle,
        type: 'driver_debt',
        createdAt: serverTimestamp()
      });

      // 3. Record transaction for driver history (Driver panel history)
      const transRef = doc(collection(db, 'delivery_transactions'));
      batch.set(transRef, {
        driverId: driverId,
        type: 'liquidation',
        amount: -amountToSettle, // Negative to clear debt in history views
        description: `Liquidación de deuda (${formatPrice(amountToSettle)})`,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      showToast('Liquidación registrada', 'success');
      closeModal();
      
      // Close detail and refresh
      document.getElementById('orders-detail-container').classList.remove('active');
      document.body.classList.remove('overlay-open');
      loadAndGroupOrders();
    } catch (err) {
      console.error('Error settling driver:', err);
      showToast('Error al procesar la liquidación', 'danger');
      btn.disabled = false;
      btn.innerHTML = icon('checkCircle', 22) + ' CONFIRMAR PAGO';
    }
  };
}
