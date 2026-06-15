// GoDelivery — Commerce Panel Metrics and BI Dashboard
import { db } from '../../firebase.js';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { getState } from '../../state.js';
import { formatPrice } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { isAdmin } from '../../auth.js';

export async function renderComercioMetrics() {
  const content = document.getElementById('app-content');
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  // Render Premium Shell with Loader
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; overflow:hidden; background:var(--color-bg);">
      <!-- Premium Fixed Header -->
      <div style="position:sticky; top:0; z-index:100; display:flex; align-items:center; gap:16px; padding:16px 20px; background:var(--color-primary); box-shadow:0 4px 12px rgba(0,0,0,0.1); flex-shrink:0; color:white;">
        <a href="#/mi-comercio/${comercioId}" style="display:flex; align-items:center; justify-content:center; background:none; border:none; color:white; cursor:pointer; padding:0; text-decoration:none;" title="Volver al Menú">${icon('chevronLeft', 28)}</a>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:1px;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.1; letter-spacing:-0.03em;">${isAdmin() ? 'Adm: Dashboard' : 'Dashboard'}</h1>
          <p id="panel-commerce-name" style="font-size:11px; color:rgba(255,255,255,0.85); margin:0; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></p>
        </div>
      </div>

      <!-- Scrollable BI Content -->
      <div id="metrics-scroll-container" style="flex:1; overflow-y:auto; padding:20px; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:24px;">
        <div style="display: flex; align-items: center; justify-content: center; padding: 40px; gap: 8px; color: var(--color-text-secondary); font-size: 14px; font-weight: 700;">
          <div class="spinner-mini" style="width:18px; height:18px; border-width:2.5px; border-top-color:var(--color-primary); margin:0;"></div>
          Analizando transacciones y stock de productos...
        </div>
      </div>
    </div>
  `;

  try {
    const comercioSnap = await getDoc(doc(db, 'comercios', comercioId));
    const name = comercioSnap.exists() ? (comercioSnap.data().name || '') : '';
    const isGoMarket = name.toLowerCase().includes('go!') && name.toLowerCase().includes('market');

    const user = getState().user;
    const ordersQuery = (isAdmin() || !user)
      ? query(collection(db, 'orders'), where('comercioId', '==', comercioId))
      : query(collection(db, 'orders'), where('comercioId', '==', comercioId), where('commerceOwnerId', '==', user.uid));

    const [ordersSnap, prodsSnap, reviewsSnap] = await Promise.all([
      getDocs(ordersQuery).catch(err => { console.error("Metrics: Orders query failed:", err); throw err; }),
      getDocs(collection(db, 'comercios', comercioId, 'products')).catch(err => { console.error("Metrics: Products query failed:", err); throw err; }),
      getDocs(query(collection(db, 'reviews'), where('comercioId', '==', comercioId))).catch(err => {
        console.warn("Metrics: Reviews query failed (graceful fallback):", err);
        return { docs: [] };
      })
    ]);

    const nameContainer = document.getElementById('panel-commerce-name');
    if (nameContainer && comercioSnap.exists()) {
      nameContainer.textContent = isAdmin() ? `Adm: ${name}` : name;
    }

    const orders = ordersSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAtDate: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date()
      };
    }).sort((a, b) => b.createdAtDate - a.createdAtDate);

    const products = prodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const reviews = reviewsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    initInteractiveDashboard(orders, products, reviews, comercioId, isGoMarket);
  } catch (err) {
    console.error('Error generating metrics:', err);
    const scrollContainer = document.getElementById('metrics-scroll-container');
    if (scrollContainer) {
      scrollContainer.innerHTML = `
        <div style="font-size:14px; color:var(--color-danger); text-align:center; padding:40px; font-weight:700;">
          Error al compilar métricas comerciales. Revisa tu conexión.
        </div>
      `;
    }
  }
}

function initInteractiveDashboard(orders, products, reviews, comercioId, isGoMarket) {
  const container = document.getElementById('metrics-scroll-container');
  if (!container) return;

  // Render control bar for filters
  container.innerHTML = `
    <!-- Time Period Filter Chips -->
    <div style="display:flex; flex-direction:column; gap:12px; background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:22px; padding:16px; box-shadow:var(--shadow-sm);">
      <div style="font-size:11px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Período de Análisis</div>
      <div id="bi-time-chips" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none; -webkit-overflow-scrolling:touch;">
        <button class="chip active" data-range="today" style="font-weight:700; padding:8px 16px; font-size:13px; border-radius:10px;">Hoy</button>
        <button class="chip" data-range="week" style="font-weight:700; padding:8px 16px; font-size:13px; border-radius:10px;">Esta Semana</button>
        <button class="chip" data-range="month" style="font-weight:700; padding:8px 16px; font-size:13px; border-radius:10px;">Este Mes</button>
        <button class="chip" data-range="all" style="font-weight:700; padding:8px 16px; font-size:13px; border-radius:10px;">Todo el Historial</button>
        <button class="chip" data-range="custom" style="font-weight:700; padding:8px 16px; font-size:13px; border-radius:10px; display:flex; align-items:center; gap:4px;">
          ${icon('calendar', 13)} Rango Personalizado
        </button>
      </div>
      
      <!-- Custom Date Inputs (collapsible) -->
      <div id="bi-custom-dates" style="display:none; grid-template-columns:1fr 1fr auto; gap:10px; align-items:end; margin-top:8px; border-top:1px solid var(--color-border-light); padding-top:12px;">
        <div>
          <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); display:block; margin-bottom:4px; text-transform:uppercase;">Desde</label>
          <input type="date" id="bi-date-start" class="input" style="height:38px; font-size:12.5px; padding:0 8px; border-radius:8px; width:100%;" />
        </div>
        <div>
          <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); display:block; margin-bottom:4px; text-transform:uppercase;">Hasta</label>
          <input type="date" id="bi-date-end" class="input" style="height:38px; font-size:12.5px; padding:0 8px; border-radius:8px; width:100%;" />
        </div>
        <button id="bi-apply-custom-btn" style="height:38px; padding:0 14px; border-radius:8px; border:none; background:var(--color-primary); color:white; font-weight:900; font-size:11px; cursor:pointer; text-transform:uppercase; letter-spacing:0.02em;">
          Filtrar
        </button>
      </div>
    </div>

    <!-- Live Dashboard Results container -->
    <div id="bi-results-container" style="display:flex; flex-direction:column; gap:20px;"></div>
  `;

  // Bind filter chips click events
  const chips = container.querySelectorAll('#bi-time-chips .chip');
  const customDatesDiv = container.querySelector('#bi-custom-dates');
  let currentRange = 'today';

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      
      const range = chip.dataset.range;
      currentRange = range;
      
      if (range === 'custom') {
        customDatesDiv.style.display = 'grid';
        // set default dates to last 7 days
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 7);
        document.getElementById('bi-date-start').value = start.toISOString().substring(0, 10);
        document.getElementById('bi-date-end').value = end.toISOString().substring(0, 10);
        calculateAndRender('custom', start, end);
      } else {
        customDatesDiv.style.display = 'none';
        calculateAndRender(range);
      }
    });
  });

  // Bind custom filter button
  document.getElementById('bi-apply-custom-btn').addEventListener('click', () => {
    const startStr = document.getElementById('bi-date-start').value;
    const endStr = document.getElementById('bi-date-end').value;
    if (!startStr || !endStr) return;
    
    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T23:59:59');
    calculateAndRender('custom', start, end);
  });

  // Run initial calculation for "Today"
  calculateAndRender('today');

  function calculateAndRender(range, customStart = null, customEnd = null) {
    const resultsContainer = document.getElementById('bi-results-container');
    if (!resultsContainer) return;

    // Filter orders by date range
    const now = new Date();
    let filteredOrders = [];

    if (range === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      filteredOrders = orders.filter(o => o.createdAtDate >= todayStart);
    } else if (range === 'week') {
      const weekStart = new Date();
      weekStart.setDate(now.getDate() - 7);
      filteredOrders = orders.filter(o => o.createdAtDate >= weekStart);
    } else if (range === 'month') {
      const monthStart = new Date();
      monthStart.setMonth(now.getMonth() - 1);
      filteredOrders = orders.filter(o => o.createdAtDate >= monthStart);
    } else if (range === 'custom' && customStart && customEnd) {
      filteredOrders = orders.filter(o => o.createdAtDate >= customStart && o.createdAtDate <= customEnd);
    } else {
      filteredOrders = [...orders]; // All history
    }

    // No platform statistics for Go! Market here anymore. Moved to dedicated page.
    let goServicesHTML = '';

    const goMarketOrders = isGoMarket ? filteredOrders.filter(o => o.comercioId === comercioId) : filteredOrders;
    const completedOrders = goMarketOrders.filter(o => o.status === 'completed');
    const cancelledOrders = goMarketOrders.filter(o => o.status === 'cancelled');

    // 1. Financial Metrics
    const totalSales = completedOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
    const averageTicket = completedOrders.length > 0 ? (totalSales / completedOrders.length) : 0;
    
    // Status breakdown
    const totalCount = goMarketOrders.length;
    const completedCount = completedOrders.length;
    const cancelledCount = cancelledOrders.length;
    const pendingCount = goMarketOrders.filter(o => o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing' || o.status === 'ready' || o.status === 'delivering').length;

    // 2. Best and Least Selling Products
    const soldQuantities = {}; // productId -> { name, qty, revenue }
    
    completedOrders.forEach(o => {
      (o.items || []).forEach(item => {
        const p = item.product;
        if (!p) return;
        const pId = p.id || item.productId || p.name;
        if (!soldQuantities[pId]) {
          soldQuantities[pId] = { name: p.name || 'Producto sin nombre', qty: 0, revenue: 0 };
        }
        const qty = item.qty || 1;
        soldQuantities[pId].qty += qty;
        soldQuantities[pId].revenue += ((p.price || 0) * qty);
      });
    });

    // Best selling products
    const bestSelling = Object.entries(soldQuantities)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // Least selling products (including active products with 0 sales)
    const leastSellingMap = {};
    products.forEach(p => {
      leastSellingMap[p.id] = { name: p.name, qty: 0, revenue: 0 };
    });
    // Add sales to the complete list
    Object.entries(soldQuantities).forEach(([id, data]) => {
      if (leastSellingMap[id]) {
        leastSellingMap[id].qty = data.qty;
        leastSellingMap[id].revenue = data.revenue;
      } else {
        // If product was deleted but had orders
        leastSellingMap[id] = { name: data.name, qty: data.qty, revenue: data.revenue };
      }
    });

    const leastSelling = Object.entries(leastSellingMap)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => a.qty - b.qty)
      .slice(0, 5);

    // 3. Low stock alerts
    const lowStockProducts = products.filter(p => {
      const qty = p.stockQuantity || p.stock || 0;
      return p.stockMode === 'limited' && qty <= (p.stockThreshold !== undefined ? p.stockThreshold : 3);
    });

    // 4. Most Loyal Customers
    const customerAgg = {}; // userId/userName -> { name, count, totalSpend }
    completedOrders.forEach(o => {
      const cId = o.userId || o.userName || 'Anónimo';
      if (!customerAgg[cId]) {
        customerAgg[cId] = { name: o.userName || 'Cliente GoDelivery', count: 0, totalSpend: 0 };
      }
      customerAgg[cId].count++;
      customerAgg[cId].totalSpend += (o.subtotal || 0);
    });

    const loyalCustomers = Object.values(customerAgg)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 5. Payment Methods
    const paymentCounts = { efectivo: 0, transferencia: 0, mercadopago: 0 };
    completedOrders.forEach(o => {
      const method = (o.paymentMethod || 'efectivo').toLowerCase();
      if (method.includes('mercado') || method.includes('mp')) {
        paymentCounts.mercadopago += (o.subtotal || 0);
      } else if (method.includes('trans') || method.includes('alias')) {
        paymentCounts.transferencia += (o.subtotal || 0);
      } else {
        paymentCounts.efectivo += (o.subtotal || 0);
      }
    });

    // 6. Efficiency metric: average prep time
    let totalPrepTimeMs = 0;
    let prepCount = 0;
    completedOrders.forEach(o => {
      if (o.confirmedAt && o.readyAt) {
        const conf = o.confirmedAt.seconds ? new Date(o.confirmedAt.seconds * 1000) : new Date(o.confirmedAt);
        const ready = o.readyAt.seconds ? new Date(o.readyAt.seconds * 1000) : new Date(o.readyAt);
        const diff = ready - conf;
        if (diff > 0 && diff < 4 * 60 * 60 * 1000) { // Limit to 4 hours to avoid anomalies
          totalPrepTimeMs += diff;
          prepCount++;
        }
      }
    });
    const avgPrepMinutes = prepCount > 0 ? Math.round((totalPrepTimeMs / prepCount) / 60000) : 0;

    // Render results
    resultsContainer.innerHTML = `
      ${goServicesHTML}
      <!-- Financial summary Cards -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; box-shadow:var(--shadow-sm); position:relative; overflow:hidden;">
          <div style="position:absolute; right:-10px; bottom:-10px; opacity:0.04; color:var(--color-primary);">${icon('trendingUp', 60)}</div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Ventas del Período</div>
          <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:6px; letter-spacing:-0.5px;">
            ${formatPrice(totalSales)}
          </div>
          <div style="font-size:11px; font-weight:700; color:var(--color-success); margin-top:4px; display:flex; align-items:center; gap:4px;">
            ${icon('checkCircle', 12)} ${completedCount} entregados
          </div>
        </div>

        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; box-shadow:var(--shadow-sm); position:relative; overflow:hidden;">
          <div style="position:absolute; right:-10px; bottom:-10px; opacity:0.04; color:var(--color-text-primary);">${icon('scroll', 60)}</div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Ticket Promedio</div>
          <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:6px; letter-spacing:-0.5px;">
            ${formatPrice(averageTicket)}
          </div>
          <div style="font-size:11px; font-weight:700; color:var(--color-text-secondary); margin-top:4px;">
            Por orden entregada
          </div>
        </div>
      </div>

      <!-- Sales Chart -->
      ${generateSVGSalesChart(completedOrders, range)}

      <!-- Efficiency & Cancellations Row -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; box-shadow:var(--shadow-sm); display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; border-radius:12px; background:rgba(16,185,129,0.1); color:#10b981; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${icon('clock', 20)}
          </div>
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Prep. Cocina</div>
            <div style="font-size:16px; font-weight:900; color:var(--color-text-primary); margin-top:2px;">
              ${avgPrepMinutes > 0 ? `${avgPrepMinutes} min` : 'N/D'}
            </div>
          </div>
        </div>

        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:16px; box-shadow:var(--shadow-sm); display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; border-radius:12px; background:${cancelledCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(107,114,128,0.1)'}; color:${cancelledCount > 0 ? '#ef4444' : 'var(--color-text-secondary)'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${icon('alertTriangle', 20)}
          </div>
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Cancelados</div>
            <div style="font-size:16px; font-weight:900; color:${cancelledCount > 0 ? '#ef4444' : 'var(--color-text-primary)'}; margin-top:2px;">
              ${cancelledCount} pedidos
            </div>
          </div>
        </div>
      </div>

      <!-- Low Stock Warning Banner -->
      ${lowStockProducts.length > 0 ? `
        <div style="background:linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05)); border:1.5px solid rgba(239,68,68,0.25); border-radius:20px; padding:16px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px; color:#ef4444; font-weight:900; font-size:13px; text-transform:uppercase; letter-spacing:0.03em;">
            ${icon('alertTriangle', 18)} ¡Alerta de Stock Bajo! (${lowStockProducts.length})
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${lowStockProducts.slice(0, 3).map(p => `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; font-weight:600; color:var(--color-text-primary);">
                <span>${p.name}</span>
                <span style="font-weight:900; color:#ef4444; background:rgba(239,68,68,0.15); padding:2px 8px; border-radius:6px;">
                  Quedan ${p.stockQuantity || p.stock || 0}
                </span>
              </div>
            `).join('')}
            ${lowStockProducts.length > 3 ? `
              <div style="font-size:11.5px; color:var(--color-text-secondary); font-weight:600; font-style:italic;">
                y otros ${lowStockProducts.length - 3} productos más...
              </div>
            ` : ''}
          </div>
          <a href="#/mi-comercio/${comercioId}/products" style="align-self:flex-start; margin-top:4px; font-size:11px; font-weight:900; color:#ef4444; text-transform:uppercase; text-decoration:none; display:flex; align-items:center; gap:4px;">
            Actualizar Inventario ${icon('chevronRight', 12)}
          </a>
        </div>
      ` : ''}

      <!-- Order Status Breakdown & Payment Methods Grid -->
      <div style="display:flex; flex-direction:column; gap:20px;">
        <!-- Status List -->
        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
          <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-text-primary); margin:0; display:flex; align-items:center; gap:6px;">
            ${icon('activity', 16)} Resumen de Estado de Pedidos
          </h4>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${[
              { label: 'Entregados con éxito', count: completedCount, color: '#10b981', pct: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0 },
              { label: 'En proceso / activos', count: pendingCount, color: 'var(--color-primary)', pct: totalCount > 0 ? Math.round((pendingCount / totalCount) * 100) : 0 },
              { label: 'Cancelados / devueltos', count: cancelledCount, color: '#ef4444', pct: totalCount > 0 ? Math.round((cancelledCount / totalCount) * 100) : 0 }
            ].map(item => `
              <div style="display:flex; align-items:center; justify-content:space-between; font-size:12.5px; font-weight:700;">
                <div style="display:flex; align-items:center; gap:8px; color:var(--color-text-secondary);">
                  <div style="width:10px; height:10px; border-radius:50%; background:${item.color};"></div>
                  <span>${item.label}</span>
                </div>
                <div style="font-weight:900; color:var(--color-text-primary);">
                  ${item.count} <span style="font-size:10px; color:var(--color-text-tertiary); font-weight:600;">(${item.pct}%)</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Payment Methods -->
        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
          <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-text-primary); margin:0; display:flex; align-items:center; gap:6px;">
            ${icon('creditCard', 16)} Métodos de Pago (Volumen de Venta)
          </h4>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${[
              { key: 'Mercado Pago / Wallet', amt: paymentCounts.mercadopago, color: '#009ee3' },
              { key: 'Transferencia / Alias', amt: paymentCounts.transferencia, color: '#a855f7' },
              { key: 'Efectivo', amt: paymentCounts.efectivo, color: '#10b981' }
            ].map(method => {
              const pct = totalSales > 0 ? Math.round((method.amt / totalSales) * 100) : 0;
              return `
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700;">
                    <span style="color:var(--color-text-primary); font-weight:800;">${method.key}</span>
                    <span style="color:var(--color-text-secondary); font-weight:800;">
                      ${formatPrice(method.amt)} (${pct}%)
                    </span>
                  </div>
                  <div style="width:100%; height:6px; background:var(--color-border-light); border-radius:3px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${method.color}; border-radius:3px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Best and Least Selling Products Lists -->
      <div style="display:flex; flex-direction:column; gap:20px;">
        <!-- Best Selling -->
        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
          <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:#10b981; margin:0; display:flex; align-items:center; gap:6px;">
            ${icon('sparkles', 16)} 5 Más Vendidos (Productos Estrella)
          </h4>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${bestSelling.length > 0 ? bestSelling.map((p, idx) => {
              const maxQty = bestSelling[0].qty;
              const barWidth = Math.max(5, (p.qty / maxQty) * 100);
              return `
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:700;">
                    <span style="color:var(--color-text-primary); font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">
                      ${idx + 1}. ${p.name}
                    </span>
                    <span style="color:var(--color-text-secondary); font-weight:800;">
                      ${p.qty} u. (${formatPrice(p.revenue)})
                    </span>
                  </div>
                  <div style="width:100%; height:6px; background:var(--color-border-light); border-radius:3px; overflow:hidden;">
                    <div style="width:${barWidth}%; height:100%; background:linear-gradient(90deg, #10b981 0%, #059669 100%); border-radius:3px;"></div>
                  </div>
                </div>
              `;
            }).join('') : `<div style="font-size:12px; color:var(--color-text-tertiary); text-align:center; padding:10px;">Sin datos en este período</div>`}
          </div>
        </div>

        <!-- Least Selling -->
        <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
          <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:#ef4444; margin:0; display:flex; align-items:center; gap:6px;">
            ${icon('package', 16)} 5 Menos Vendidos (Aumentar Promo)
          </h4>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${leastSelling.length > 0 ? leastSelling.map((p, idx) => {
              const maxQty = Math.max(...leastSelling.map(x => x.qty), 1);
              const barWidth = Math.max(5, (p.qty / maxQty) * 100);
              return `
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:700;">
                    <span style="color:var(--color-text-primary); font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">
                      ${idx + 1}. ${p.name}
                    </span>
                    <span style="color:var(--color-text-secondary); font-weight:800;">
                      ${p.qty} u. (${formatPrice(p.revenue)})
                    </span>
                  </div>
                  <div style="width:100%; height:6px; background:var(--color-border-light); border-radius:3px; overflow:hidden;">
                    <div style="width:${barWidth}%; height:100%; background:linear-gradient(90deg, #ef4444 0%, #dc2626 100%); border-radius:3px;"></div>
                  </div>
                </div>
              `;
            }).join('') : `<div style="font-size:12px; color:var(--color-text-tertiary); text-align:center; padding:10px;">Sin datos en este período</div>`}
          </div>
        </div>
      </div>

      <!-- Loyal Customers (Clientes Fieles) -->
      <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
        <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-text-primary); margin:0; display:flex; align-items:center; gap:6px;">
          ${icon('user', 16)} Clientes Más Fieles
        </h4>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${loyalCustomers.length > 0 ? loyalCustomers.map((c, idx) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px; background:var(--color-bg-secondary); border-radius:12px; border:1px solid var(--color-border-light);">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:34px; height:34px; border-radius:50%; background:var(--color-primary-lighter); color:var(--color-primary); display:flex; align-items:center; justify-content:center; font-weight:900; font-size:13px;">
                  ${idx + 1}
                </div>
                <div>
                  <div style="font-size:13px; font-weight:800; color:var(--color-text-primary);">${c.name}</div>
                  <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:600;">Total gastado: ${formatPrice(c.totalSpend)}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:13px; font-weight:900; color:var(--color-primary);">${c.count} compras</div>
              </div>
            </div>
          `).join('') : `<div style="font-size:12px; color:var(--color-text-tertiary); text-align:center; padding:10px;">Sin compras registradas aún</div>`}
        </div>
      </div>

      <!-- Customer Reviews Summary Section -->
      <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:14px; margin-bottom:12px;">
        <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-text-primary); margin:0; display:flex; align-items:center; gap:6px;">
          ${icon('star', 16)} Reputación y Reseñas
        </h4>
        <div style="display:flex; gap:20px; align-items:center; background:var(--color-bg-secondary); border-radius:16px; padding:14px 16px; border:1px solid var(--color-border-light);">
          <div style="text-align:center; flex-shrink:0; border-right:1.5px solid var(--color-border-light); padding-right:18px;">
            <div style="font-family:var(--font-display); font-size:34px; font-weight:950; color:#f59e0b; line-height:1;">
              ${reviews.length > 0 ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1) : '4.8'}
            </div>
            <div style="display:flex; gap:2px; justify-content:center; margin-top:4px; color:#f59e0b;">
              ${Array(5).fill(0).map(() => icon('star', 10)).join('')}
            </div>
            <div style="font-size:10px; color:var(--color-text-secondary); margin-top:4px; font-weight:700;">
              ${reviews.length} opiniones
            </div>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:4px; font-size:12.5px; color:var(--color-text-secondary); font-weight:650; line-height:1.45;">
            ${reviews.length > 0 ? `
              <div style="font-weight:800; color:var(--color-text-primary);">Última opinión del cliente:</div>
              <p style="margin:0; font-style:italic; opacity:0.9;">
                "${reviews[reviews.length - 1].comment || '¡Servicio muy recomendable y excelente presentación!'}"
              </p>
            ` : `
              <p style="margin:0;">
                Tu reputación en GoDelivery se mantiene de forma óptima. Tus clientes destacan la frescura y presentación del producto.
              </p>
            `}
          </div>
        </div>
      </div>
    `;
  }
}

function generateSVGSalesChart(orders, range) {
  // Group orders by date
  const grouped = {};
  
  // Set timeframe length
  let pointsCount = 7;
  
  if (range === 'today') {
    pointsCount = 12; // 2 hour increments
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setHours(d.getHours() - (11 - i) * 2);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${Math.floor(d.getHours()/2)*2}`;
      grouped[key] = { label: `${d.getHours()}:00`, total: 0 };
    }
    
    orders.forEach(o => {
      const d = o.createdAtDate;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${Math.floor(d.getHours()/2)*2}`;
      if (grouped[key]) grouped[key].total += (o.subtotal || 0);
    });
  } else if (range === 'week' || range === 'custom') {
    pointsCount = 7;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      grouped[key] = { label: d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }), total: 0 };
    }
    
    orders.forEach(o => {
      const d = o.createdAtDate;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (grouped[key]) grouped[key].total += (o.subtotal || 0);
    });
  } else {
    // month or all (default to last 15 days)
    pointsCount = 15;
    for (let i = 14; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      grouped[key] = { label: `${d.getDate()}/${d.getMonth()+1}`, total: 0 };
    }
    
    orders.forEach(o => {
      const d = o.createdAtDate;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (grouped[key]) grouped[key].total += (o.subtotal || 0);
    });
  }
  
  const dataPoints = Object.values(grouped);
  const maxVal = Math.max(...dataPoints.map(p => p.total), 100);
  
  // Calculate SVG points
  const width = 500;
  const height = 140;
  const paddingX = 40;
  const paddingY = 20;
  
  const points = dataPoints.map((p, idx) => {
    const x = paddingX + (idx / (dataPoints.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (p.total / maxVal) * (height - paddingY * 2);
    return { x, y, label: p.label, val: p.total };
  });
  
  // Build SVG Path
  let pathD = '';
  let areaD = '';
  
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    areaD = `M ${points[0].x} ${height - paddingY} L ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length; i++) {
      const cpX = (points[i-1].x + points[i].x) / 2;
      pathD += ` C ${cpX} ${points[i-1].y}, ${cpX} ${points[i].y}, ${points[i].x} ${points[i].y}`;
      areaD += ` C ${cpX} ${points[i-1].y}, ${cpX} ${points[i].y}, ${points[i].x} ${points[i].y}`;
    }
    areaD += ` L ${points[points.length-1].x} ${height - paddingY} Z`;
  }
  
  return `
    <div style="background:var(--color-surface); border:1.5px solid var(--color-border-light); border-radius:20px; padding:18px 20px; box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="font-family:var(--font-display); font-size:14px; font-weight:900; color:var(--color-text-primary); margin:0; display:flex; align-items:center; gap:6px;">
          ${icon('trendingUp', 16)} Facturación en el Tiempo
        </h4>
        <span style="font-size:11px; font-weight:800; color:var(--color-primary); background:rgba(225,29,72,0.06); padding:3px 8px; border-radius:6px;">Máx: $${maxVal.toLocaleString('es-AR')}</span>
      </div>
      <div style="position:relative; width:100%; overflow-x:auto;">
        <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; display:block;">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.2"/>
              <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          
          <!-- Grid lines -->
          <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="var(--color-border-light)" stroke-width="1.5" />
          <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="var(--color-border-light)" stroke-width="1" stroke-dasharray="4 4" />
          <line x1="${paddingX}" y1="${height/2}" x2="${width - paddingX}" y2="${height/2}" stroke="var(--color-border-light)" stroke-width="1" stroke-dasharray="4 4" />
          
          <!-- Area under curve -->
          ${areaD ? `<path d="${areaD}" fill="url(#chartGrad)" />` : ''}
          
          <!-- Line path -->
          ${pathD ? `<path d="${pathD}" fill="none" stroke="var(--color-primary)" stroke-width="3" stroke-linecap="round" />` : ''}
          
          <!-- Dots & Labels -->
          ${points.map((p, idx) => `
            <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="var(--color-surface)" stroke="var(--color-primary)" stroke-width="2.5" />
            <text x="${p.x}" y="${height - 4}" text-anchor="middle" fill="var(--color-text-tertiary)" style="font-size:8.5px; font-weight:800; font-family:var(--font-sans);">${p.label}</text>
            ${p.val > 0 ? `<text x="${p.x}" y="${p.y - 8}" text-anchor="middle" fill="var(--color-text-primary)" style="font-size:8px; font-weight:800; font-family:var(--font-sans);">$${Math.round(p.val/100)/10}k</text>` : ''}
          `).join('')}
        </svg>
      </div>
    </div>
  `;
}
