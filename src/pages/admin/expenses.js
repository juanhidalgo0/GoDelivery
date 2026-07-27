import { db } from '../../firebase.js';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';

let expensesUnsub = null;
let currentExpenses = [];
let currentOrders = [];
let currentTransactions = [];
let currentSettlements = [];
let goMarketCatalogProducts = [];

let activeTab = 'balance'; // 'balance', 'expenses', 'gomarket'
let selectedCategoryFilter = 'all';
let selectedMonthFilter = `${new Date().getFullYear()}-${String(new Date().getMonth()).padStart(2, '0')}`;
let searchQuery = '';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export function renderAdminExpenses(container) {
  if (expensesUnsub) expensesUnsub();

  const currentYear = new Date().getFullYear();
  const currentMonthIdx = new Date().getMonth();

  container.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg-secondary);">
      
      <!-- Fixed Header matching admin standard with Safe Area padding -->
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:12px;padding:calc(12px + env(safe-area-inset-top, 0px)) 16px 12px 16px;background:var(--color-primary);flex-shrink:0;position:relative;overflow:hidden;box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;position:relative;z-index:2;">
          ${icon('chevronLeft', 22)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:18px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            Gastos y Contabilidad
          </h1>
        </div>

        <button id="add-expense-btn" style="height:38px; padding:0 14px; border-radius:12px; background:rgba(255,255,255,0.2); color:white; border:none; font-weight:800; font-size:12.5px; display:flex; align-items:center; gap:5px; cursor:pointer; position:relative; z-index:2; backdrop-filter:blur(4px); transition:all 0.2s; white-space:nowrap; flex-shrink:0;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
          ${icon('plus', 15)} Cargar Gasto
        </button>
      </div>

      <!-- Section Navigation Tabs Bar (ALWAYS TOP VISIBLE & FULLY RESPONSIVE) -->
      <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border-light); padding:8px 16px; flex-shrink:0; z-index:90; box-shadow:var(--shadow-sm);">
        <div style="display:flex; gap:8px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; max-width:1200px; margin:0 auto;">
          <button class="nav-tab-btn ${activeTab === 'balance' ? 'active' : ''}" data-tab="balance" style="flex:1; min-width:130px; white-space:nowrap; height:42px; border-radius:12px; border:none; font-weight:800; font-size:13px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px; flex-shrink:0; ${activeTab === 'balance' ? 'background:var(--color-primary); color:white; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.25);' : 'background:var(--color-bg-secondary); color:var(--color-text-tertiary);'}">
            📊 Balance e Ingresos
          </button>
          <button class="nav-tab-btn ${activeTab === 'expenses' ? 'active' : ''}" data-tab="expenses" style="flex:1; min-width:130px; white-space:nowrap; height:42px; border-radius:12px; border:none; font-weight:800; font-size:13px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px; flex-shrink:0; ${activeTab === 'expenses' ? 'background:var(--color-primary); color:white; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.25);' : 'background:var(--color-bg-secondary); color:var(--color-text-tertiary);'}">
            💸 Gastos y Egresos
          </button>
          <button class="nav-tab-btn ${activeTab === 'gomarket' ? 'active' : ''}" data-tab="gomarket" style="flex:1; min-width:140px; white-space:nowrap; height:42px; border-radius:12px; border:none; font-weight:800; font-size:13px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px; flex-shrink:0; ${activeTab === 'gomarket' ? 'background:var(--color-primary); color:white; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.25);' : 'background:var(--color-bg-secondary); color:var(--color-text-tertiary);'}">
            🛒 Ganancias GoMarket
          </button>
        </div>
      </div>

      <!-- Scrollable Content Area -->
      <div style="flex:1; overflow-y:auto; padding:16px 16px 40px; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:16px; max-width:1200px; margin:0 auto; width:100%; box-sizing:border-box;">

        <!-- Month & Year Filter Bar -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; box-shadow: var(--shadow-sm); flex-shrink: 0;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;">📅</span>
            <div>
              <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--color-text-tertiary); letter-spacing: 0.05em;">Período Seleccionado</div>
              <div id="selected-month-label" style="font-weight: 900; font-size: 15px; color: var(--color-text-primary);">
                ${MONTH_NAMES[currentMonthIdx]} ${currentYear}
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <label style="font-size: 12px; font-weight: 800; color: var(--color-text-tertiary);">Filtrar Mes:</label>
            <select id="expense-month-filter" style="height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); font-size: 13.5px; font-weight: 800; outline: none; cursor: pointer; color: var(--color-text-primary);">
              <option value="all">🗓️ Todos los Meses (Histórico)</option>
              ${MONTH_NAMES.map((name, idx) => {
                const val = `${currentYear}-${String(idx).padStart(2, '0')}`;
                const isSelected = val === selectedMonthFilter;
                return `<option value="${val}" ${isSelected ? 'selected' : ''}>${name} ${currentYear}</option>`;
              }).join('')}
              ${[currentYear - 1].map(y => 
                MONTH_NAMES.map((name, idx) => {
                  const val = `${y}-${String(idx).padStart(2, '0')}`;
                  return `<option value="${val}">${name} ${y}</option>`;
                }).join('')
              ).join('')}
            </select>
          </div>
        </div>

        <!-- Dynamic Tab View Render Target -->
        <div id="tab-content-area" style="display:flex; flex-direction:column; gap:16px;">
          <!-- Content rendered dynamically -->
        </div>

      </div>
    </div>
  `;

  // Attach Add Button Listener
  document.getElementById('add-expense-btn').onclick = () => openExpenseModal();

  // Attach Month Filter Listener
  document.getElementById('expense-month-filter').onchange = (e) => {
    selectedMonthFilter = e.target.value;
    updateDashboardView();
  };

  // Attach Nav Tabs Listeners
  container.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.nav-tab-btn').forEach(b => {
        b.style.background = 'var(--color-bg-secondary)';
        b.style.color = 'var(--color-text-tertiary)';
        b.style.boxShadow = 'none';
      });
      btn.style.background = 'var(--color-primary)';
      btn.style.color = 'white';
      btn.style.boxShadow = '0 4px 12px rgba(var(--color-primary-rgb),0.25)';
      updateDashboardView();
    };
  });

  // Subscribe to Realtime Firestore Data
  listenToData();
}

function listenToData() {
  // 1. Company Expenses
  const qExp = query(collection(db, 'company_expenses'), orderBy('date', 'desc'));
  expensesUnsub = onSnapshot(qExp, (snap) => {
    currentExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });

  // 2. Orders
  onSnapshot(collection(db, 'orders'), (snap) => {
    currentOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });

  // 3. Delivery Transactions
  onSnapshot(collection(db, 'delivery_transactions'), (snap) => {
    currentTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });

  // 4. Admin Settlements (Economía section liquidations for drivers and commerce)
  onSnapshot(collection(db, 'settlements'), (snap) => {
    currentSettlements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });

  // 5. Fetch GoMarket Catalog Products
  (async () => {
    try {
      const comSnap = await getDocs(collection(db, 'comercios'));
      const goMarketDoc = comSnap.docs.find(d => {
        const name = (d.data().name || '').toLowerCase();
        return name.includes('go!') && name.includes('market') || name.includes('gomarket');
      });
      if (goMarketDoc) {
        const pSnap = await getDocs(collection(db, 'comercios', goMarketDoc.id, 'products'));
        goMarketCatalogProducts = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateDashboardView();
      }
    } catch (e) {}
  })();
}

function formatPrice(val) {
  return `$${Number(val || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getSelectedMonthPeriod() {
  if (selectedMonthFilter === 'all') return { isAll: true };
  const [yearStr, monthStr] = selectedMonthFilter.split('-');
  return {
    isAll: false,
    year: parseInt(yearStr),
    month: parseInt(monthStr)
  };
}

function calculateFinancials(period) {
  // Filter Expenses
  const filteredExpenses = currentExpenses.filter(exp => {
    if (period.isAll) return true;
    const expDate = exp.date ? new Date(exp.date) : new Date();
    return expDate.getMonth() === period.month && expDate.getFullYear() === period.year;
  });

  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Filter Orders
  const filteredOrders = currentOrders.filter(o => {
    if (period.isAll) return true;
    const oDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : null;
    if (!oDate) return false;
    return oDate.getMonth() === period.month && oDate.getFullYear() === period.year;
  });

  // Filter Settlements executed in Economía (collection 'settlements')
  const filteredSettlements = currentSettlements.filter(s => {
    if (period.isAll) return true;
    const sDate = s.createdAt ? (s.createdAt.toDate ? s.createdAt.toDate() : new Date(s.createdAt)) : null;
    if (!sDate) return false;
    return sDate.getMonth() === period.month && sDate.getFullYear() === period.year;
  });

  // Calculate Income Streams
  let comercioCommissionsTotal = 0;
  let driverCanonTotal = 0;
  let appUsageFeesTotal = 0;
  let goMarketIncomeTotal = 0;
  let goMarketProfitTotal = 0;
  const goMarketProductsMap = {};

  // 1. DRIVER SETTLEMENTS & CANON (FROM 'settlements' collection executed in Economía)
  filteredSettlements.forEach(s => {
    if (s.type === 'driver_debt' || s.driverId || s.driverName) {
      driverCanonTotal += Math.abs(Number(s.amountCollected || s.amount || 0));
    } else if (s.type === 'commerce_settlement' || s.comercioId) {
      comercioCommissionsTotal += Math.abs(Number(s.amountCollected || s.amount || 0));
    }
  });

  // Also check delivery_transactions for driver liquidations if settlements collection didn't catch them
  currentTransactions.forEach(t => {
    const isLiquidation = t.type === 'liquidation' || t.type === 'settlement' || t.type === 'pago' || t.type === 'canon_paid';
    if (isLiquidation && t.type !== 'canon_charge') {
      const tDate = t.createdAt ? (t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt)) : null;
      if (!tDate) return;

      if (period.isAll || (tDate.getMonth() === period.month && tDate.getFullYear() === period.year)) {
        const amt = Math.abs(Number(t.amount || 0));
        // Avoid duplicate counting if already counted via settlements collection
        if (filteredSettlements.length === 0) {
          driverCanonTotal += amt;
        }
      }
    }
  });

  // Populate catalog products
  goMarketCatalogProducts.forEach(prod => {
    const prodName = prod.name || 'Producto GoMarket';
    const key = prodName.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
    
    const purchasePrice = Number(prod.costPrice || 0);
    const price = Number(prod.price || 0);
    const hasCostPrice = purchasePrice > 0;
    const unitProfit = hasCostPrice ? Math.max(0, price - purchasePrice) : price;

    goMarketProductsMap[key] = {
      key: key,
      name: prodName,
      qty: 0,
      price: price,
      purchasePrice: purchasePrice,
      hasCostPrice: hasCostPrice,
      unitProfit: unitProfit,
      marginPct: (hasCostPrice && price > 0) ? Math.round((unitProfit / price) * 100) : 100,
      totalRevenue: 0,
      totalProfit: 0
    };
  });

  filteredOrders.forEach(order => {
    const isOrderDelivered = order.status === 'delivered' || order.status === 'completed';

    // Commerce Commission (Fallback if not counted in settlements collection)
    const isCommissionPaid = order.commissionStatus === 'paid' || order.isSettled;
    if (isCommissionPaid && comercioCommissionsTotal === 0) {
      const comm = order.isManual ? 0 : Number(order.commissionAmount || 0);
      comercioCommissionsTotal += comm;
    }

    // App Usage Fee (ONLY IF DELIVERED)
    if (isOrderDelivered) {
      const fee = Number(order.appUsageFee || order.appFee || 0);
      appUsageFeesTotal += fee;
    }

    // GoMarket Products Sales & Real Profit (ONLY IF DELIVERED)
    const isGoMarketOrder = order.isGoMarket || 
      (order.comercioName || '').toLowerCase().includes('gomarket') || 
      (order.comercioName || '').toLowerCase().includes('go! market');

    if (isGoMarketOrder && isOrderDelivered) {
      const items = order.items || [];
      items.forEach(item => {
        const prodName = item.name || 'Producto GoMarket';
        const key = prodName.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
        
        const price = Number(item.price || 0);
        const qty = Number(item.qty || 1);
        const revenue = price * qty;

        const catalogProd = goMarketProductsMap[key];
        const purchasePrice = catalogProd 
          ? catalogProd.purchasePrice 
          : Number(item.costPrice || 0);

        const hasCostPrice = purchasePrice > 0;
        
        // REAL PROFIT = SALE PRICE - PURCHASE PRICE
        const unitProfit = hasCostPrice ? Math.max(0, price - purchasePrice) : price;
        const totalProfit = unitProfit * qty;

        goMarketIncomeTotal += revenue;
        goMarketProfitTotal += totalProfit;

        if (!goMarketProductsMap[key]) {
          goMarketProductsMap[key] = {
            key: key,
            name: prodName,
            qty: 0,
            price: price,
            purchasePrice: purchasePrice,
            hasCostPrice: hasCostPrice,
            unitProfit: unitProfit,
            marginPct: (hasCostPrice && price > 0) ? Math.round((unitProfit / price) * 100) : 100,
            totalRevenue: 0,
            totalProfit: 0
          };
        }
        goMarketProductsMap[key].qty += qty;
        goMarketProductsMap[key].totalRevenue += revenue;
        goMarketProductsMap[key].totalProfit += totalProfit;
      });
    }
  });

  const totalIncome = comercioCommissionsTotal + appUsageFeesTotal + driverCanonTotal + goMarketProfitTotal;
  const netResult = totalIncome - totalExpenses;
  const netMarginPct = totalIncome > 0 ? Math.round((netResult / totalIncome) * 100) : 0;

  return {
    filteredExpenses,
    totalExpenses,
    comercioCommissionsTotal,
    appUsageFeesTotal,
    driverCanonTotal,
    goMarketIncomeTotal,
    goMarketProfitTotal,
    goMarketProductsList: Object.values(goMarketProductsMap),
    totalIncome,
    netResult,
    netMarginPct
  };
}

function updateDashboardView() {
  const container = document.getElementById('tab-content-area');
  if (!container) return;

  const period = getSelectedMonthPeriod();
  const monthLabelText = period.isAll 
    ? 'Todos los Meses' 
    : `${MONTH_NAMES[period.month]} ${period.year}`;

  const elMonthLabel = document.getElementById('selected-month-label');
  if (elMonthLabel) elMonthLabel.textContent = monthLabelText;

  const financials = calculateFinancials(period);

  if (activeTab === 'balance') {
    renderBalanceTab(container, financials, monthLabelText);
  } else if (activeTab === 'expenses') {
    renderExpensesTab(container, financials, monthLabelText);
  } else if (activeTab === 'gomarket') {
    renderGoMarketTab(container, financials, monthLabelText);
  }
}

function renderBalanceTab(container, financials, monthLabelText) {
  const { totalIncome, totalExpenses, netResult, netMarginPct, comercioCommissionsTotal, appUsageFeesTotal, driverCanonTotal, goMarketProfitTotal } = financials;

  const isPositive = netResult >= 0;

  container.innerHTML = `
    <!-- Net Profit Highlight Card -->
    <div style="background: ${isPositive ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)'}; border-radius: 24px; padding: 22px; color: white; box-shadow: 0 10px 25px ${isPositive ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}; position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(255,255,255,0.1); border-radius: 50%; pointer-events: none;"></div>
      
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
        <div>
          <div style="font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9;">
            Resultado Neto Real Cobrado (${monthLabelText})
          </div>
          <div style="font-family: var(--font-display); font-size: 34px; font-weight: 950; margin-top: 4px; letter-spacing: -1px;">
            ${isPositive ? '+' : ''}${formatPrice(netResult)}
          </div>
          <div style="font-size: 12.5px; font-weight: 700; margin-top: 6px; opacity: 0.95;">
            ${isPositive ? '🟢 Ganancia Neta Efectiva Cobrada' : '🔴 Déficit Operacional'} · Margen Neto: <b>${netMarginPct}%</b>
          </div>
        </div>

        <div style="display: flex; gap: 14px; background: rgba(255,255,255,0.15); backdrop-filter: blur(8px); padding: 12px 18px; border-radius: 18px; border: 1px solid rgba(255,255,255,0.2);">
          <div>
            <div style="font-size: 10.5px; font-weight: 800; text-transform: uppercase; opacity: 0.85;">Total Ingresos Cobrados</div>
            <div style="font-size: 18px; font-weight: 950; margin-top: 2px;">+${formatPrice(totalIncome)}</div>
          </div>
          <div style="width: 1px; background: rgba(255,255,255,0.25);"></div>
          <div>
            <div style="font-size: 10.5px; font-weight: 800; text-transform: uppercase; opacity: 0.85;">Total Egresos</div>
            <div style="font-size: 18px; font-weight: 950; margin-top: 2px;">-${formatPrice(totalExpenses)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Income Streams Breakdown -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 22px; padding: 18px; box-shadow: var(--shadow-sm);">
      <div style="font-weight: 900; font-size: 15px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; color: var(--color-text-primary);">
        💰 Ingresos Efectivamente Cobrados (${monthLabelText})
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px;">
        <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 14px;">
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--color-text-tertiary);">
            <span>🏪</span> Comisiones de Comercios
          </div>
          <div style="font-size: 20px; font-weight: 950; color: #10b981; margin-top: 4px;">+${formatPrice(comercioCommissionsTotal)}</div>
          <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;">Liquidaciones cobradas en Economía</div>
        </div>

        <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 14px;">
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--color-text-tertiary);">
            <span>🛵</span> Liquidaciones de Repartidores
          </div>
          <div style="font-size: 20px; font-weight: 950; color: #059669; margin-top: 4px;">+${formatPrice(driverCanonTotal)}</div>
          <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;">Liquidaciones cobradas en Economía</div>
        </div>

        <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 14px;">
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--color-text-tertiary);">
            <span>📲</span> Tarifas de Servicio App
          </div>
          <div style="font-size: 20px; font-weight: 950; color: #3b82f6; margin-top: 4px;">+${formatPrice(appUsageFeesTotal)}</div>
          <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;">Cargos de servicio en órdenes entregadas</div>
        </div>

        <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 14px;">
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--color-text-tertiary);">
            <span>🛒</span> Ganancia Neta GoMarket
          </div>
          <div style="font-size: 20px; font-weight: 950; color: #8b5cf6; margin-top: 4px;">+${formatPrice(goMarketProfitTotal)}</div>
          <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;">Ganancia limpia (Venta - Compra) entregada</div>
        </div>
      </div>
    </div>
  `;
}

function renderExpensesTab(container, financials, monthLabelText) {
  const { filteredExpenses, totalExpenses } = financials;

  const categoryTotals = {};
  filteredExpenses.forEach(exp => {
    const cat = exp.category || 'Otros';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(exp.amount || 0);
  });

  const categories = [
    { key: 'Sueldos', label: 'Sueldos y Honorarios', icon: '👤', color: '#ef4444' },
    { key: 'Combustible', label: 'Combustible y Logística', icon: '⛽', color: '#f59e0b' },
    { key: 'Servidores', label: 'Servidores y Software', icon: '💻', color: '#3b82f6' },
    { key: 'Marketing', label: 'Marketing y Publicidad', icon: '📢', color: '#8b5cf6' },
    { key: 'Insumos', label: 'Insumos y Papelería', icon: '📦', color: '#10b981' },
    { key: 'Impuestos', label: 'Impuestos y Tasas', icon: '🏛️', color: '#64748b' },
    { key: 'Mantenimiento', label: 'Mantenimiento', icon: '🛠️', color: '#ec4899' },
    { key: 'Otros', label: 'Otros Egresos', icon: '📑', color: '#6b7280' }
  ];

  const activeCategories = categories.filter(cat => (categoryTotals[cat.key] || 0) > 0);

  const finalFiltered = filteredExpenses.filter(exp => {
    const matchesCat = selectedCategoryFilter === 'all' || exp.category === selectedCategoryFilter;
    const matchesSearch = !searchQuery || 
      (exp.concept || '').toLowerCase().includes(searchQuery) ||
      (exp.notes || '').toLowerCase().includes(searchQuery) ||
      (exp.paymentMethod || '').toLowerCase().includes(searchQuery);
    return matchesCat && matchesSearch;
  });

  container.innerHTML = `
    <!-- Categories Breakdown Card -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 18px; box-shadow: var(--shadow-sm);">
      <div style="font-weight: 900; font-size: 14.5px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: var(--color-text-primary);">
        ${icon('pieChart', 18)} Desglose de Gastos por Categoría (${monthLabelText})
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        ${activeCategories.length === 0 ? `
          <div style="grid-column: 1 / -1; padding: 12px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; font-weight: 600;">
            No hay gastos registrados en el mes seleccionado.
          </div>
        ` : activeCategories.map(cat => {
          const amount = categoryTotals[cat.key] || 0;
          const pct = totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0;
          return `
            <div style="background: var(--color-bg-secondary); border-radius: 14px; padding: 12px 14px; border: 1px solid var(--color-border-light);">
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 700; margin-bottom: 6px;">
                <span>${cat.icon} ${cat.label}</span>
                <span style="color: ${cat.color}; font-weight: 900;">${pct}%</span>
              </div>
              <div style="font-size: 16px; font-weight: 950; color: var(--color-text-primary); margin-bottom: 6px;">
                ${formatPrice(amount)}
              </div>
              <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.06); border-radius: 10px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: ${cat.color}; border-radius: 10px;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Filters & Controls -->
    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 240px; position: relative;">
        <input type="text" id="expense-search-input" placeholder="Buscar por concepto, nota o comprobante..." value="${searchQuery}" style="width: 100%; height: 46px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); padding: 0 16px 0 40px; font-size: 13.5px; font-weight: 600; outline: none; box-shadow: var(--shadow-sm); color: var(--color-text-primary);" />
        <div style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--color-text-tertiary); pointer-events: none; display: flex;">
          ${icon('search', 18)}
        </div>
      </div>

      <select id="expense-category-filter" style="height: 46px; padding: 0 16px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 13.5px; font-weight: 700; outline: none; cursor: pointer; color: var(--color-text-primary); box-shadow: var(--shadow-sm);">
        <option value="all" ${selectedCategoryFilter === 'all' ? 'selected' : ''}>Todas las Categorías</option>
        <option value="Sueldos" ${selectedCategoryFilter === 'Sueldos' ? 'selected' : ''}>Sueldos y Honorarios</option>
        <option value="Combustible" ${selectedCategoryFilter === 'Combustible' ? 'selected' : ''}>Combustible y Logística</option>
        <option value="Servidores" ${selectedCategoryFilter === 'Servidores' ? 'selected' : ''}>Servidores y Software</option>
        <option value="Marketing" ${selectedCategoryFilter === 'Marketing' ? 'selected' : ''}>Marketing y Publicidad</option>
        <option value="Insumos" ${selectedCategoryFilter === 'Insumos' ? 'selected' : ''}>Insumos y Papelería</option>
        <option value="Impuestos" ${selectedCategoryFilter === 'Impuestos' ? 'selected' : ''}>Impuestos y Tasas</option>
        <option value="Mantenimiento" ${selectedCategoryFilter === 'Mantenimiento' ? 'selected' : ''}>Mantenimiento y Reparación</option>
        <option value="Otros" ${selectedCategoryFilter === 'Otros' ? 'selected' : ''}>Otros Egresos</option>
      </select>
    </div>

    <!-- Expenses Table -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; box-shadow: var(--shadow-sm);">
      <div style="padding: 14px 18px; background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="font-size: 13px; font-weight: 800; color: var(--color-text-primary);">
          Egresos Detallados (${monthLabelText}) — <span style="color: var(--color-text-tertiary);">${finalFiltered.length} registro${finalFiltered.length === 1 ? '' : 's'}</span>
        </div>
        <div style="font-size: 14px; font-weight: 900; color: #ef4444; background: rgba(239,68,68,0.1); padding: 4px 12px; border-radius: 20px;">
          Total Egresos: ${formatPrice(totalExpenses)}
        </div>
      </div>

      ${finalFiltered.length === 0 ? `
        <div style="padding: 50px 20px; text-align: center; color: var(--color-text-tertiary);">
          <div style="font-size: 40px; margin-bottom: 8px;">🧾</div>
          <div style="font-weight: 800; font-size: 15px; color: var(--color-text-primary);">No hay gastos cargados en el filtro seleccionado</div>
        </div>
      ` : `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
            <thead>
              <tr style="background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); font-size: 11.5px; font-weight: 800; text-transform: uppercase; color: var(--color-text-tertiary); letter-spacing: 0.05em;">
                <th style="padding: 14px 18px;">Fecha</th>
                <th style="padding: 14px 18px;">Concepto</th>
                <th style="padding: 14px 18px;">Categoría</th>
                <th style="padding: 14px 18px;">Método de Pago</th>
                <th style="padding: 14px 18px; text-align: right;">Monto</th>
                <th style="padding: 14px 18px; text-align: center;">Comprobante</th>
                <th style="padding: 14px 18px; text-align: center;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${finalFiltered.map(exp => {
                const dateStr = exp.date ? new Date(exp.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                return `
                  <tr style="border-bottom: 1px solid var(--color-border-light); transition: background 0.15s;" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 14px 18px; font-weight: 600; color: var(--color-text-secondary); white-space: nowrap;">${dateStr}</td>
                    <td style="padding: 14px 18px;">
                      <div style="font-weight: 800; color: var(--color-text-primary);">${exp.concept || 'Sin concepto'}</div>
                      ${exp.notes ? `<div style="font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px;">${exp.notes}</div>` : ''}
                    </td>
                    <td style="padding: 14px 18px; white-space: nowrap;">
                      <span style="background: rgba(239, 68, 68, 0.12); color: #dc2626; padding: 4px 10px; border-radius: 20px; font-weight: 800; font-size: 11.5px; display: inline-block;">
                        ${exp.category || 'Otros'}
                      </span>
                    </td>
                    <td style="padding: 14px 18px; font-weight: 600; text-transform: capitalize; color: var(--color-text-secondary); white-space: nowrap;">
                      ${exp.paymentMethod || 'Efectivo'}
                    </td>
                    <td style="padding: 14px 18px; text-align: right; font-family: var(--font-display); font-weight: 950; font-size: 15px; color: #ef4444; white-space: nowrap;">
                      -${formatPrice(exp.amount)}
                    </td>
                    <td style="padding: 14px 18px; text-align: center;">
                      ${exp.receiptUrl ? `
                        <button onclick="window.viewReceiptModal('${exp.id}')" style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); padding: 5px 12px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: var(--color-primary);">
                          ${icon('image', 14)} Ver Comprobante
                        </button>
                      ` : `<span style="font-size: 12px; color: var(--color-text-tertiary); font-style: italic;">Sin foto</span>`}
                    </td>
                    <td style="padding: 14px 18px; text-align: center; white-space: nowrap;">
                      <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <button onclick="window.editExpenseModal('${exp.id}')" style="width: 32px; height: 32px; border-radius: 10px; background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: center; color: var(--color-text-primary); cursor: pointer;" title="Editar">
                          ${icon('edit', 14)}
                        </button>
                        <button onclick="window.deleteExpenseConfirm('${exp.id}')" style="width: 32px; height: 32px; border-radius: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); display: flex; align-items: center; justify-content: center; color: #ef4444; cursor: pointer;" title="Eliminar">
                          ${icon('trash', 14)}
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  // Attach inner controls listeners
  const inputSearch = document.getElementById('expense-search-input');
  if (inputSearch) {
    inputSearch.oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      updateDashboardView();
    };
  }

  const catSelect = document.getElementById('expense-category-filter');
  if (catSelect) {
    catSelect.onchange = (e) => {
      selectedCategoryFilter = e.target.value;
      updateDashboardView();
    };
  }
}

function renderGoMarketTab(container, financials, monthLabelText) {
  const { goMarketProductsList, goMarketProfitTotal, goMarketIncomeTotal } = financials;

  container.innerHTML = `
    <!-- GoMarket Revenue & Real Profit Summary Card -->
    <div style="background: linear-gradient(135deg, #8b5cf6, #6d28d9); border-radius: 24px; padding: 22px; color: white; box-shadow: 0 10px 25px rgba(139,92,246,0.3); position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(255,255,255,0.1); border-radius: 50%; pointer-events: none;"></div>
      
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
        <div>
          <div style="font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9;">
            Ganancia Real GoMarket (${monthLabelText})
          </div>
          <div style="font-family: var(--font-display); font-size: 34px; font-weight: 950; margin-top: 4px; letter-spacing: -1px;">
            +${formatPrice(goMarketProfitTotal)}
          </div>
          <div style="font-size: 12.5px; font-weight: 700; margin-top: 4px; opacity: 0.95;">
            Suma de <b>(Precio Venta - Precio Compra) × Unid. Entregadas</b>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.15); backdrop-filter: blur(8px); padding: 12px 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 10.5px; font-weight: 800; text-transform: uppercase; opacity: 0.85;">Ventas Brutas Totales</div>
          <div style="font-size: 18px; font-weight: 950; margin-top: 2px;">${formatPrice(goMarketIncomeTotal)}</div>
        </div>
      </div>
    </div>

    <!-- Products Profitability Table -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; box-shadow: var(--shadow-sm);">
      <div style="padding: 14px 18px; background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div style="font-size: 13px; font-weight: 800; color: var(--color-text-primary);">
          Rendimiento y Ganancia Real por Producto (${monthLabelText})
        </div>
        <div style="font-size: 11.5px; color: var(--color-text-tertiary); font-weight: 600;">
          💡 Basado en productos de órdenes entregadas en el período.
        </div>
      </div>

      ${goMarketProductsList.length === 0 ? `
        <div style="padding: 50px 20px; text-align: center; color: var(--color-text-tertiary);">
          <div style="font-size: 40px; margin-bottom: 8px;">🛒</div>
          <div style="font-weight: 800; font-size: 15px; color: var(--color-text-primary);">No hay ventas de GoMarket entregadas en este período</div>
          <p style="font-size: 13px; margin-top: 4px;">Cambiá el mes en el filtro superior para consultar otros períodos.</p>
        </div>
      ` : `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
            <thead>
              <tr style="background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); font-size: 11.5px; font-weight: 800; text-transform: uppercase; color: var(--color-text-tertiary); letter-spacing: 0.05em;">
                <th style="padding: 14px 18px;">Producto</th>
                <th style="padding: 14px 18px; text-align: right;">Precio Venta</th>
                <th style="padding: 14px 18px; text-align: right;">Precio Compra (Costo)</th>
                <th style="padding: 14px 18px; text-align: right;">Ganancia Real / Unid.</th>
                <th style="padding: 14px 18px; text-align: center;">% Margen Real</th>
                <th style="padding: 14px 18px; text-align: center;">Unid. Vendidas</th>
                <th style="padding: 14px 18px; text-align: right;">Ganancia Real Total</th>
              </tr>
            </thead>
            <tbody>
              ${goMarketProductsList.map(prod => `
                <tr style="border-bottom: 1px solid var(--color-border-light); transition: background 0.15s;" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">
                  <td style="padding: 14px 18px; font-weight: 800; color: var(--color-text-primary);">${prod.name}</td>
                  <td style="padding: 14px 18px; text-align: right; font-weight: 800; color: var(--color-text-primary);">${formatPrice(prod.price)}</td>
                  
                  <td style="padding: 14px 18px; text-align: right; font-weight: 700; color: var(--color-text-secondary);">
                    ${prod.hasCostPrice ? formatPrice(prod.purchasePrice) : '<span style="font-size:11.5px; color:var(--color-text-tertiary); font-style:italic;">Sin costo</span>'}
                  </td>

                  <td style="padding: 14px 18px; text-align: right; font-weight: 800; color: ${prod.unitProfit > 0 ? '#10b981' : 'var(--color-text-tertiary)'};">
                    +${formatPrice(prod.unitProfit)}
                  </td>

                  <td style="padding: 14px 18px; text-align: center;">
                    <span style="background: rgba(139,92,246,0.12); color: #7c3aed; padding: 4px 10px; border-radius: 12px; font-weight: 900; font-size: 12px;">
                      ${prod.marginPct}%
                    </span>
                  </td>

                  <td style="padding: 14px 18px; text-align: center; font-weight: 800; color: var(--color-text-primary);">${prod.qty}</td>

                  <td style="padding: 14px 18px; text-align: right; font-family: var(--font-display); font-weight: 950; font-size: 15px; color: ${prod.totalProfit > 0 ? '#8b5cf6' : 'var(--color-text-tertiary)'};">
                    +${formatPrice(prod.totalProfit)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// Global Modal handlers attached to window
window.viewReceiptModal = (expenseId) => {
  const exp = currentExpenses.find(e => e.id === expenseId);
  if (!exp || !exp.receiptUrl) return;

  showModal({
    title: '📄 Comprobante de Gasto',
    height: 'auto',
    content: `
      <div style="padding: 16px; text-align: center;">
        <div style="font-weight: 800; font-size: 16px; margin-bottom: 4px; color: var(--color-text-primary);">${exp.concept}</div>
        <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 16px;">Monto: <b style="color: #ef4444;">${formatPrice(exp.amount)}</b></div>
        
        <div style="max-height: 70vh; overflow-y: auto; border-radius: 16px; border: 1px solid var(--color-border-light); background: #18181b; padding: 10px; display: flex; align-items: center; justify-content: center;">
          <img src="${exp.receiptUrl}" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" alt="Comprobante" />
        </div>
      </div>
    `
  });
};

window.editExpenseModal = (expenseId) => {
  const exp = currentExpenses.find(e => e.id === expenseId);
  if (exp) openExpenseModal(exp);
};

window.deleteExpenseConfirm = (expenseId) => {
  const exp = currentExpenses.find(e => e.id === expenseId);
  if (!exp) return;

  showConfirm({
    title: '¿Eliminar registro de gasto?',
    message: `Vas a eliminar el gasto <b>"${exp.concept}"</b> por <b>${formatPrice(exp.amount)}</b>. Esta acción no se puede deshacer.`,
    confirmText: 'Sí, eliminar',
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'company_expenses', expenseId));
        showToast('Gasto eliminado exitosamente', 'info');
      } catch (err) {
        console.error('Error deleting expense:', err);
        showToast('Error al eliminar gasto', 'error');
      } finally {
        closeModal();
      }
    }
  });
};

function openExpenseModal(existingExpense = null) {
  let uploadedReceiptBase64 = existingExpense?.receiptUrl || '';

  const todayStr = existingExpense?.date 
    ? new Date(existingExpense.date).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  showModal({
    title: existingExpense ? '✏️ Editar Gasto' : '💸 Cargar Nuevo Gasto Manual',
    height: 'auto',
    content: `
      <form id="expense-form" style="display: flex; flex-direction: column; gap: 16px; padding: 4px 4px calc(24px + env(safe-area-inset-bottom, 0px)) 4px; max-height: calc(82dvh - env(safe-area-inset-bottom, 0px)); overflow-y: auto; box-sizing: border-box;">
        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Concepto / Título *</label>
          <input type="text" id="exp-concept" required placeholder="Ej: Pago alquiler depósito, Combustible moto..." value="${existingExpense?.concept || ''}" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box;" />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Monto ($) *</label>
            <input type="number" id="exp-amount" min="1" step="any" required placeholder="0" value="${existingExpense?.amount || ''}" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 15px; font-weight: 800; outline: none; box-sizing: border-box;" />
          </div>

          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Fecha *</label>
            <input type="date" id="exp-date" required value="${todayStr}" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Categoría *</label>
            <select id="exp-category" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box; cursor: pointer;">
              <option value="Sueldos" ${existingExpense?.category === 'Sueldos' ? 'selected' : ''}>👤 Sueldos y Honorarios</option>
              <option value="Combustible" ${existingExpense?.category === 'Combustible' ? 'selected' : ''}>⛽ Combustible y Logística</option>
              <option value="Servidores" ${existingExpense?.category === 'Servidores' ? 'selected' : ''}>💻 Servidores y Software</option>
              <option value="Marketing" ${existingExpense?.category === 'Marketing' ? 'selected' : ''}>📢 Marketing y Publicidad</option>
              <option value="Insumos" ${existingExpense?.category === 'Insumos' ? 'selected' : ''}>📦 Insumos y Papelería</option>
              <option value="Impuestos" ${existingExpense?.category === 'Impuestos' ? 'selected' : ''}>🏛️ Impuestos y Tasas</option>
              <option value="Mantenimiento" ${existingExpense?.category === 'Mantenimiento' ? 'selected' : ''}>🛠️ Mantenimiento</option>
              <option value="Otros" ${!existingExpense || existingExpense?.category === 'Otros' ? 'selected' : ''}>📑 Otros Egresos</option>
            </select>
          </div>

          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Método de Pago</label>
            <select id="exp-payment-method" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box; cursor: pointer;">
              <option value="Efectivo" ${existingExpense?.paymentMethod === 'Efectivo' ? 'selected' : ''}>💵 Efectivo</option>
              <option value="Transferencia" ${existingExpense?.paymentMethod === 'Transferencia' ? 'selected' : ''}>🏦 Transferencia Buro/CBU</option>
              <option value="Mercado Pago" ${existingExpense?.paymentMethod === 'Mercado Pago' ? 'selected' : ''}>📱 Mercado Pago</option>
              <option value="Tarjeta" ${existingExpense?.paymentMethod === 'Tarjeta' ? 'selected' : ''}>💳 Tarjeta Débito/Crédito</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Notas / Observaciones</label>
          <textarea id="exp-notes" rows="2" placeholder="Detalles adicionales, proveedor, nro de factura..." style="width: 100%; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 10px 14px; font-size: 13.5px; font-family: inherit; outline: none; box-sizing: border-box; resize: vertical;">${existingExpense?.notes || ''}</textarea>
        </div>

        <!-- Receipt Image Upload Section -->
        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Foto de Comprobante / Factura</label>
          <div style="border: 2px dashed var(--color-border-light); border-radius: 16px; padding: 16px; text-align: center; background: var(--color-bg-secondary); cursor: pointer; position: relative;" id="receipt-upload-box">
            <input type="file" id="exp-receipt-file" accept="image/*" style="position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;" />
            <div id="receipt-preview-container">
              ${uploadedReceiptBase64 ? `
                <img src="${uploadedReceiptBase64}" style="max-height: 140px; border-radius: 10px; border: 1px solid var(--color-border-light); display: block; margin: 0 auto 8px auto;" />
                <span style="font-size: 12px; font-weight: 700; color: var(--color-primary);">Cambiar foto de comprobante</span>
              ` : `
                <div style="font-size: 28px; margin-bottom: 4px;">📷</div>
                <div style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">Adjuntar foto de ticket o factura</div>
                <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;">Formatos permitidos: JPG, PNG, WEBP</div>
              `}
            </div>
          </div>
        </div>

        <button type="submit" id="save-expense-btn" style="margin-top: 8px; height: 48px; border-radius: 14px; background: var(--color-primary); color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.25); transition: all 0.2s;">
          ${existingExpense ? 'Guardar Cambios' : 'Guardar Gasto en Contabilidad'}
        </button>
      </form>
    `
  });

  // Handle File Input Change for Base64 Compression
  const fileInput = document.getElementById('exp-receipt-file');
  const previewBox = document.getElementById('receipt-preview-container');

  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1200;
          let w = img.width;
          let h = img.height;

          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          uploadedReceiptBase64 = canvas.toDataURL('image/jpeg', 0.75);

          if (previewBox) {
            previewBox.innerHTML = `
              <img src="${uploadedReceiptBase64}" style="max-height: 140px; border-radius: 10px; border: 1px solid var(--color-border-light); display: block; margin: 0 auto 8px auto;" />
              <span style="font-size: 12px; font-weight: 700; color: var(--color-primary);">¡Comprobante adjuntado! Toca para cambiar</span>
            `;
          }
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    };
  }

  // Handle Form Submission
  const form = document.getElementById('expense-form');
  form.onsubmit = async (e) => {
    e.preventDefault();

    const concept = document.getElementById('exp-concept').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const date = document.getElementById('exp-date').value;
    const category = document.getElementById('exp-category').value;
    const paymentMethod = document.getElementById('exp-payment-method').value;
    const notes = document.getElementById('exp-notes').value.trim();

    if (!concept || isNaN(amount) || amount <= 0 || !date) {
      showToast('Por favor completa los campos obligatorios', 'warning');
      return;
    }

    const saveBtn = document.getElementById('save-expense-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = `${icon('loader', 16, 'animate-spin')} Guardando...`;

    try {
      const expenseData = {
        concept,
        amount,
        date: new Date(date + 'T12:00:00').toISOString(),
        category,
        paymentMethod,
        notes,
        receiptUrl: uploadedReceiptBase64 || '',
        updatedAt: serverTimestamp()
      };

      if (existingExpense) {
        await updateDoc(doc(db, 'company_expenses', existingExpense.id), expenseData);
        showToast('Gasto actualizado con éxito', 'success');
      } else {
        expenseData.createdAt = serverTimestamp();
        await addDoc(collection(db, 'company_expenses'), expenseData);
        showToast('Gasto registrado en la contabilidad 💸', 'success');
      }

      closeModal();
    } catch (err) {
      console.error('Error saving expense:', err);
      showToast('Error al guardar gasto', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = existingExpense ? 'Guardar Cambios' : 'Guardar Gasto en Contabilidad';
    }
  };
}
