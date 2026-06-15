
import { db } from '../../firebase.js';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';

export async function renderComercioFinances() {
  const content = document.getElementById('app-content');
  const user = getState().user;
  const params = getRouteParams();
  const comercioId = params.id;
  
  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  const { isAdmin } = await import('../../auth.js');

  try {
    const comercioSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (!comercioSnap.exists()) {
      location.hash = '#/profile';
      return;
    }
    const comercioData = comercioSnap.data();
    if (comercioData.ownerId !== user?.uid && !isAdmin()) {
      location.hash = '#/profile';
      return;
    }

    content.innerHTML = `
      <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;">
        <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:14px;padding:16px 20px;background:var(--color-primary);border-bottom:1px solid rgba(255,255,255,0.1);box-shadow:0 2px 12px rgba(0,0,0,0.08);flex-shrink:0;color:white;">
          <a href="#/mi-comercio/${comercioId}" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.25);flex-shrink:0;">${icon('back', 18)}</a>
          <div style="flex:1;min-width:0;">
            <h1 style="font-family:var(--font-display);font-weight:800;font-size:18px;color:white;margin:0;line-height:1.2;">${isAdmin() ? 'Adm: Finanzas' : 'Comisiones y Finanzas'}</h1>
            <p style="font-size:12px;color:rgba(255,255,255,0.85);margin:2px 0 0;">${isAdmin() ? `Adm: Resumen de ${comercioData.name}` : `Resumen financiero de ${comercioData.name}`}</p>
          </div>
        </div>

        <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
          <div class="filter-container" style="margin-bottom: var(--space-4); overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;">
            <div id="month-chips" style="display: flex; gap: var(--space-2); padding-bottom: var(--space-2);">
              <button class="chip active" data-value="all">Todos</button>
              ${generateMonthChips()}
            </div>
          </div>

          <div class="tab-pills" style="margin-bottom: var(--space-4); background: var(--color-bg-secondary); padding: 4px; border-radius: 12px; display: flex; gap: 4px;">
            <button class="tab-pill active" data-finance-tab="orders" style="flex: 1; padding: 10px; font-size: 13px;">Movimientos</button>
            <button class="tab-pill" data-finance-tab="payments" style="flex: 1; padding: 10px; font-size: 13px;">Pagos Realizados</button>
          </div>

          <div id="finances-summary" style="margin-bottom: var(--space-6);"></div>
          <div id="finances-list">
            <div class="loader-dots" style="margin: 4rem auto;"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    `;

    const [ordersSnap, settlementsSnap] = await Promise.all([
      getDocs(query(collection(db, 'orders'), where('comercioId', '==', comercioId))),
      getDocs(query(collection(db, 'settlements'), where('comercioId', '==', comercioId)))
    ]);

    const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      
    const settlements = settlementsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    let activeFinanceTab = 'orders';

    const chips = document.querySelectorAll('#month-chips .chip');
    const tabs = document.querySelectorAll('.tab-pill[data-finance-tab]');

    const refreshView = () => {
      const filter = document.querySelector('#month-chips .chip.active').dataset.value;
      if (activeFinanceTab === 'orders') {
        filterAndRenderOrders(orders, filter);
      } else {
        filterAndRenderPayments(settlements, filter);
      }
    };

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        refreshView();
      });
    });

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFinanceTab = tab.dataset.financeTab;
        refreshView();
      });
    });

    refreshView();



  } catch (err) {
    console.error('Error loading finances:', err);
  }
}

function generateMonthChips() {
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const now = new Date();
  let chips = '';
  for (let i = 0; i < 6; i++) { // Show last 6 months for better UX
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${d.getMonth() + 1}`;
    chips += `<button class="chip" data-value="${val}">${months[d.getMonth()]} ${d.getFullYear()}</button>`;
  }
  return chips;
}


function filterAndRenderOrders(orders, filterValue) {
  const container = document.getElementById('finances-list');
  const summary = document.getElementById('finances-summary');
  
  let filtered = orders;
  if (filterValue !== 'all') {
    const [year, month] = filterValue.split('-').map(Number);
    filtered = orders.filter(o => {
      const d = o.createdAt?.toDate();
      return d && d.getFullYear() === year && d.getMonth() + 1 === month;
    });
  }

  // Filter for completed orders to compute valid commission metrics
  const completedOrders = filtered.filter(o => o.status === 'completed');
  
  const pending = completedOrders.reduce((sum, o) => {
    const isPending = !o.commissionStatus || o.commissionStatus === 'pending';
    return sum + (isPending ? (o.commissionAmount || 0) : 0);
  }, 0);
  
  const paid = completedOrders.reduce((sum, o) => sum + (o.commissionStatus === 'paid' ? (o.commissionAmount || 0) : 0), 0);

  const totalBilled = completedOrders.reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  const avgTicket = completedOrders.length > 0 ? (totalBilled / completedOrders.length) : 0;
  const avgCommission = completedOrders.length > 0 ? ((pending + paid) / completedOrders.length) : 0;

  summary.style.display = 'block';
  summary.innerHTML = `
    <!-- Top Commission Cards -->
    <div class="admin-stats-grid" style="grid-template-columns: 1fr 1fr; gap: var(--space-4); margin-bottom: var(--space-4);">
      <div class="stat-card finance-summary-card pending" style="padding: var(--space-4); border-radius: var(--radius-2xl); position: relative; overflow: hidden; background: var(--color-bg-secondary); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
        <div style="position: relative; z-index: 2; text-align:left;">
          <div style="font-size: 26px; font-weight: 950; color: var(--color-primary); margin-bottom: 2px; letter-spacing: -0.5px;">$${pending.toLocaleString('es-AR')}</div>
          <div style="font-size: 10px; font-weight: 850; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.8px;">Comisión Pendiente</div>
        </div>
        <div style="position: absolute; right: -8px; bottom: -8px; opacity: 0.04; transform: rotate(-15deg); color: var(--color-primary);">
          ${icon('zap', 56)}
        </div>
      </div>
      
      <div class="stat-card finance-summary-card paid" style="padding: var(--space-4); border-radius: var(--radius-2xl); position: relative; overflow: hidden; background: var(--color-bg-secondary); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
        <div style="position: relative; z-index: 2; text-align:left;">
          <div style="font-size: 26px; font-weight: 950; color: #10B981; margin-bottom: 2px; letter-spacing: -0.5px;">$${paid.toLocaleString('es-AR')}</div>
          <div style="font-size: 10px; font-weight: 850; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.8px;">Comisión Pagada</div>
        </div>
        <div style="position: absolute; right: -8px; bottom: -8px; opacity: 0.04; transform: rotate(-15deg); color: #10B981;">
          ${icon('checkCircle', 56)}
        </div>
      </div>
    </div>

    <!-- Secondary BI KPI Grid -->
    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px; box-shadow: var(--shadow-xs);">
      <div style="text-align: left; border-right: 1px solid var(--color-border-light); padding-right: 8px;">
        <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Ventas Netas</div>
        <div style="font-size: 17px; font-weight: 900; color: var(--color-text-primary);">$${totalBilled.toLocaleString('es-AR')}</div>
      </div>
      <div style="text-align: left; padding-left: 8px;">
        <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Entregas Exitosas</div>
        <div style="font-size: 17px; font-weight: 900; color: var(--color-text-primary);">${completedOrders.length}</div>
      </div>
      <div style="text-align: left; border-right: 1px solid var(--color-border-light); padding-right: 8px; border-top: 1px solid var(--color-border-light); padding-top: 12px; margin-top: 8px;">
        <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Ticket Promedio</div>
        <div style="font-size: 17px; font-weight: 900; color: var(--color-text-primary);">$${Math.round(avgTicket).toLocaleString('es-AR')}</div>
      </div>
      <div style="text-align: left; padding-left: 8px; border-top: 1px solid var(--color-border-light); padding-top: 12px; margin-top: 8px;">
        <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Comisión Promedio</div>
        <div style="font-size: 17px; font-weight: 900; color: var(--color-text-primary);">$${Math.round(avgCommission).toLocaleString('es-AR')}</div>
      </div>
    </div>
  `;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state-mini" style="padding: 5rem 1rem; background: var(--color-bg-secondary); border-radius: var(--radius-2xl); border: 1px dashed var(--color-border);">
        <div style="opacity: 0.3; margin-bottom: 1.5rem; color: var(--color-text-tertiary);">${icon('scroll', 56)}</div>
        <p style="color: var(--color-text-secondary); font-weight: 500;">No hay movimientos en este periodo</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="finance-list" style="display: flex; flex-direction: column; gap: var(--space-3); margin-top: 16px;">
      ${filtered.map(o => {
        const isCancelled = o.status === 'cancelled';
        const isPending = !isCancelled && (!o.commissionStatus || o.commissionStatus === 'pending');
        const isPaid = !isCancelled && o.commissionStatus === 'paid';
        
        let statusText = 'Pendiente';
        let statusColor = 'var(--color-primary)';
        let bgIconColor = 'rgba(227, 27, 35, 0.1)';
        let statusIcon = 'package';
        let displayCommission = o.commissionAmount || 0;
        
        if (isCancelled) {
          statusText = 'Cancelado';
          statusColor = 'var(--color-text-tertiary)';
          bgIconColor = 'var(--color-bg-secondary)';
          statusIcon = 'close';
          displayCommission = 0;
        } else if (isPaid) {
          statusText = 'Pagado';
          statusColor = '#10B981';
          bgIconColor = 'rgba(16, 185, 129, 0.1)';
          statusIcon = 'checkCircle';
        }

        return `
          <div class="finance-list-item" style="padding: var(--space-4); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); transition: all 0.2s ease;">
            <div style="display: flex; align-items: center; gap: var(--space-4); min-width: 0;">
              <div style="width: 48px; height: 48px; background: ${bgIconColor}; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${statusColor};">
                ${icon(statusIcon, 24)}
              </div>

              <div style="min-width: 0; text-align: left;">
                <div style="font-weight: 800; font-size: 15px; color: var(--color-text); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  Pedido #${o.orderId || o.id.slice(0,6)}
                </div>
                <div style="font-size: 12px; color: var(--color-text-tertiary); display: flex; align-items: center; gap: 6px; font-weight: 500;">
                  <span>${o.createdAt?.toDate()?.toLocaleDateString() || '-'}</span>
                  <span style="width: 4px; height: 4px; background: var(--color-border); border-radius: 50%;"></span>
                  <span>${o.userName || 'Cliente'}</span>
                </div>
                ${o.couponCode ? `
                  <div style="font-size: 11px; font-weight: 700; color: var(--color-text-tertiary); margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                    <span>Cupón: <span style="font-family: monospace; background: var(--color-bg-secondary); padding: 1px 4px; border-radius: 4px; border: 1px solid var(--color-border-light);">${o.couponCode}</span></span>
                    <span style="color: ${o.couponAbsorbedBy === 'comercio' ? '#ef4444' : 'var(--color-text-tertiary)'};">
                      -${formatPrice(o.couponDiscount)} (${o.couponAbsorbedBy === 'comercio' ? 'asumido por vos' : 'asumido por GoDelivery'})
                    </span>
                  </div>
                ` : ''}
              </div>
            </div>
            
            <div style="text-align: right; flex-shrink: 0;">
              <div style="font-weight: 900; font-size: 17px; color: ${isCancelled ? 'var(--color-text-tertiary)' : 'var(--color-text)'}; margin-bottom: 2px; letter-spacing: -0.5px;">
                $${displayCommission.toLocaleString('es-AR')}
              </div>
              <div style="font-size: 10px; font-weight: 800; color: ${statusColor}; text-transform: uppercase; letter-spacing: 0.5px;">
                ${statusText}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function filterAndRenderPayments(settlements, filterValue) {
  const container = document.getElementById('finances-list');
  const summary = document.getElementById('finances-summary');
  summary.style.display = 'none'; // No summary for payments tab
  
  let filtered = settlements;
  if (filterValue !== 'all') {
    const [year, month] = filterValue.split('-').map(Number);
    filtered = settlements.filter(s => {
      const d = s.createdAt?.toDate();
      return d && d.getFullYear() === year && d.getMonth() + 1 === month;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state-mini" style="padding: 5rem 1rem; background: var(--color-bg-secondary); border-radius: var(--radius-2xl); border: 1px dashed var(--color-border);">
        <div style="opacity: 0.3; margin-bottom: 1.5rem; color: var(--color-text-tertiary);">${icon('bank', 56)}</div>
        <p style="color: var(--color-text-secondary); font-weight: 500;">Aún no hay registros de cobros</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="finance-list" style="display: flex; flex-direction: column; gap: var(--space-3);">
      ${filtered.map(s => `
        <div class="finance-list-item" style="padding: var(--space-5); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: var(--space-4);">
            <div style="width: 52px; height: 52px; background: rgba(16, 185, 129, 0.15); border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #10B981; border: 1px solid rgba(16, 185, 129, 0.2);">
              ${icon('creditCard', 28)}
            </div>
            <div>
              <div style="font-weight: 800; font-size: 16px; color: var(--color-text); margin-bottom: 2px;">Pago Confirmado</div>
              <div style="font-size: 12px; color: var(--color-text-tertiary); font-weight: 500;">
                ${s.createdAt?.toDate()?.toLocaleDateString() || '-'} • ${s.orderCount} pedidos liquidados
              </div>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 900; font-size: 18px; color: #10B981; letter-spacing: -0.5px;">
              $${(s.amountCollected || 0).toLocaleString('es-AR')}
            </div>
            <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Monto Liquidado</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}




