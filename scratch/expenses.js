import { db } from "../../firebase.js";
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs } from "firebase/firestore";
import { icon } from "../../utils/icons.js";
import { showToast } from "../../components/toast.js";
import { showModal, closeModal, showConfirm } from "../../components/modal.js";
let expensesUnsub = null;
let currentExpenses = [];
let currentOrders = [];
let currentTransactions = [];
let currentSettlements = [];
let currentUsers = [];
let currentProofs = [];
let goMarketCatalogProducts = [];
let activeTab = "balance";
let selectedCategoryFilter = "all";
let selectedMonthFilter = "all";
let searchQuery = "";
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];
function parseFirestoreDate(dt) {
  if (!dt) return null;
  if (typeof dt.toDate === "function") return dt.toDate();
  if (dt.seconds !== void 0) return new Date(dt.seconds * 1e3);
  const d = new Date(dt);
  return isNaN(d.getTime()) ? null : d;
}
export function renderAdminExpenses(container) {
  if (expensesUnsub) expensesUnsub();
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const currentMonthIdx = (/* @__PURE__ */ new Date()).getMonth();
  container.innerHTML = `
    <!-- Inject responsive tables CSS style block -->
    <style>
      .responsive-table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 13.5px;
      }
      @media (max-width: 768px) {
        .responsive-table thead {
          display: none;
        }
        .responsive-table tbody {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 12px;
        }
        .responsive-table tr {
          display: flex;
          flex-direction: column;
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: 16px;
          padding: 14px;
          box-shadow: var(--shadow-sm);
          gap: 8px;
        }
        .responsive-table td {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 0 !important;
          border: none !important;
          text-align: right !important;
          border-bottom: 1px dashed var(--color-border-light) !important;
        }
        .responsive-table td:last-child {
          border-bottom: none !important;
          margin-top: 4px;
          justify-content: center !important;
        }
        .responsive-table td::before {
          content: attr(data-label);
          font-weight: 800;
          color: var(--color-text-tertiary);
          font-size: 11px;
          text-transform: uppercase;
          text-align: left;
          margin-right: 12px;
        }
      }
    </style>

    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg-secondary);">
      
      <!-- Fixed Header standard with Safe Area padding -->
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(12px + env(safe-area-inset-top, 0px)) 16px 12px 16px;background:linear-gradient(135deg, #18181b 0%, #09090b 100%);border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
        
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;">
            ${icon("chevronLeft", 20)}
          </a>
          <div style="min-width:0;">
            <h1 style="font-family:var(--font-display);font-weight:900;font-size:15px;color:white;margin:0;line-height:1.2;letter-spacing:0.02em;text-transform:uppercase;">
              Contabilidad
            </h1>
            <span style="font-size:10px; color:rgba(255,255,255,0.45); font-weight:700;">Panel Financiero</span>
          </div>
        </div>

        <button id="add-expense-btn" style="height:36px; padding:0 14px; border-radius:10px; background:#10b981; color:white; border:none; font-weight:900; font-size:12.5px; display:flex; align-items:center; gap:6px; cursor:pointer; transition:all 0.2s; box-shadow:0 4px 12px rgba(16, 185, 129, 0.25);" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">
          ${icon("plus", 14)} Cargar Movimiento
        </button>
      </div>

      <!-- Navigation Tabs Bar -->
      <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border-light); padding:8px 16px; flex-shrink:0; z-index:90; box-shadow:var(--shadow-sm);">
        <div style="background:var(--color-bg-secondary); border-radius:14px; padding:4px; display:flex; gap:4px; max-width:1200px; margin:0 auto; border:1px solid var(--color-border-light);">
          <button class="nav-tab-btn ${activeTab === "balance" ? "active" : ""}" data-tab="balance" style="flex:1; height:38px; border-radius:10px; border:none; font-weight:800; font-size:11.5px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === "balance" ? "background:var(--color-surface); color:var(--color-primary); box-shadow:var(--shadow-sm); border:1px solid rgba(var(--color-primary-rgb),0.08);" : "background:transparent; color:var(--color-text-secondary);"}">
            Balance
          </button>
          <button class="nav-tab-btn ${activeTab === "expenses" ? "active" : ""}" data-tab="expenses" style="flex:1; height:38px; border-radius:10px; border:none; font-weight:800; font-size:11.5px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === "expenses" ? "background:var(--color-surface); color:var(--color-primary); box-shadow:var(--shadow-sm); border:1px solid rgba(var(--color-primary-rgb),0.08);" : "background:transparent; color:var(--color-text-secondary);"}">
            Gastos
          </button>
          <button class="nav-tab-btn ${activeTab === "gomarket" ? "active" : ""}" data-tab="gomarket" style="flex:1; height:38px; border-radius:10px; border:none; font-weight:800; font-size:11.5px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === "gomarket" ? "background:var(--color-surface); color:var(--color-primary); box-shadow:var(--shadow-sm); border:1px solid rgba(var(--color-primary-rgb),0.08);" : "background:transparent; color:var(--color-text-secondary);"}">
            Go Market
          </button>
        </div>
      </div>

      <!-- Scrollable Content Area -->
      <div style="flex:1; overflow-y:auto; padding:16px 16px 40px; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:16px; max-width:1200px; margin:0 auto; width:100%; box-sizing:border-box;">

        <!-- Month Filter Bar Redesigned Premium -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 22px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: nowrap; box-shadow: var(--shadow-sm); flex-shrink: 0; font-family: var(--font-body); width:100%; box-sizing:border-box;">
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink:0;">
            <span style="font-size: 12.5px; font-weight: 900; color: var(--color-text-primary); text-transform: uppercase; letter-spacing: 0.05em; white-space:nowrap;">Filtrar Periodo:</span>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; justify-content: flex-end; min-width:0;">
            <!-- Segmented Toggle -->
            <div style="background: var(--color-bg-secondary); border-radius: 10px; padding: 3px; display: flex; border: 1px solid var(--color-border-light); align-items: center; flex-shrink:0;">
              <button id="btn-period-all" style="height: 30px; padding: 0 10px; border-radius: 8px; border: none; font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.2s; ${selectedMonthFilter === "all" ? "background: var(--color-surface); color: var(--color-primary); box-shadow: var(--shadow-sm); font-weight: 900;" : "background: transparent; color: var(--color-text-secondary);"}">
                TODO
              </button>
              <button id="btn-period-month" style="height: 30px; padding: 0 10px; border-radius: 8px; border: none; font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.2s; ${selectedMonthFilter !== "all" ? "background: var(--color-surface); color: var(--color-primary); box-shadow: var(--shadow-sm); font-weight: 900;" : "background: transparent; color: var(--color-text-secondary);"}">
                MES
              </button>
            </div>

            <!-- Month Calendar Picker Button -->
            <button id="expense-month-picker-trigger" style="height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); font-size: 12.5px; font-weight: 800; color: var(--color-text-primary); cursor: pointer; outline: none; display: ${selectedMonthFilter !== "all" ? "flex" : "none"}; align-items: center; gap: 6px; box-shadow: var(--shadow-sm); flex-shrink:0;">
              ${icon("calendar", 14)} <span id="current-picker-label">${selectedMonthFilter === "all" ? "Elegir Mes" : formatMonthFilterLabel(selectedMonthFilter)}</span>
            </button>
          </div>
        </div>

        <!-- Dynamic Tab View Target -->
        <div id="tab-content-area" style="display:flex; flex-direction:column; gap:16px;">
          <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
        </div>

      </div>
    </div>
  `;
  document.getElementById("add-expense-btn").onclick = () => openExpenseModal();
  const btnAll = document.getElementById("btn-period-all");
  const btnMonth = document.getElementById("btn-period-month");
  const monthTrigger = document.getElementById("expense-month-picker-trigger");
  const setFilterState = (isAll) => {
    if (isAll) {
      selectedMonthFilter = "all";
      btnAll.style.background = "var(--color-surface)";
      btnAll.style.color = "var(--color-primary)";
      btnAll.style.boxShadow = "var(--shadow-sm)";
      btnAll.style.fontWeight = "900";
      btnMonth.style.background = "transparent";
      btnMonth.style.color = "var(--color-text-secondary)";
      btnMonth.style.boxShadow = "none";
      btnMonth.style.fontWeight = "800";
      monthTrigger.style.display = "none";
    } else {
      btnMonth.style.background = "var(--color-surface)";
      btnMonth.style.color = "var(--color-primary)";
      btnMonth.style.boxShadow = "var(--shadow-sm)";
      btnMonth.style.fontWeight = "900";
      btnAll.style.background = "transparent";
      btnAll.style.color = "var(--color-text-secondary)";
      btnAll.style.boxShadow = "none";
      btnAll.style.fontWeight = "800";
      monthTrigger.style.display = "flex";
      if (selectedMonthFilter === "all") {
        const fallbackMonth = `${(/* @__PURE__ */ new Date()).getFullYear()}-${String((/* @__PURE__ */ new Date()).getMonth() + 1).padStart(2, "0")}`;
        selectedMonthFilter = fallbackMonth;
        const lbl = document.getElementById("current-picker-label");
        if (lbl) lbl.textContent = formatMonthFilterLabel(selectedMonthFilter);
        window.openPremiumMonthPicker();
      }
    }
    updateDashboardView();
  };
  btnAll.onclick = () => setFilterState(true);
  btnMonth.onclick = () => setFilterState(false);
  monthTrigger.onclick = () => window.openPremiumMonthPicker();
  container.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll(".nav-tab-btn").forEach((b) => {
        b.style.background = "transparent";
        b.style.color = "var(--color-text-secondary)";
        b.style.boxShadow = "none";
        b.style.border = "none";
      });
      btn.style.background = "var(--color-surface)";
      btn.style.color = "var(--color-primary)";
      btn.style.boxShadow = "var(--shadow-sm)";
      btn.style.border = "1px solid rgba(var(--color-primary-rgb),0.08)";
      updateDashboardView();
    };
  });
  listenToData();
}
function listenToData() {
  const qExp = query(collection(db, "company_expenses"), orderBy("date", "desc"));
  expensesUnsub = onSnapshot(qExp, (snap) => {
    currentExpenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });
  onSnapshot(collection(db, "orders"), (snap) => {
    currentOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });
  onSnapshot(collection(db, "delivery_transactions"), (snap) => {
    currentTransactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });
  onSnapshot(collection(db, "settlements"), (snap) => {
    currentSettlements = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });
  onSnapshot(collection(db, "users"), (snap) => {
    currentUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });
  onSnapshot(collection(db, "delivery_settlement_proofs"), (snap) => {
    currentProofs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDashboardView();
  });
  (async () => {
    try {
      const comSnap = await getDocs(collection(db, "comercios"));
      const goMarketDoc = comSnap.docs.find((d) => {
        const name = (d.data().name || "").toLowerCase();
        return name.includes("go!") && name.includes("market") || name.includes("gomarket");
      });
      if (goMarketDoc) {
        const pSnap = await getDocs(collection(db, "comercios", goMarketDoc.id, "products"));
        goMarketCatalogProducts = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        updateDashboardView();
      }
    } catch (e) {
    }
  })();
}
function formatPrice(val) {
  return `$${Number(val || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function formatMonthFilterLabel(val) {
  if (val === "all") return "Hist\xF3rico";
  const [y, m] = val.split("-");
  const monthIdx = parseInt(m) - 1;
  return `${MONTH_NAMES[monthIdx]} ${y}`;
}
function getSelectedMonthPeriod() {
  if (selectedMonthFilter === "all") return { isAll: true };
  const [yearStr, monthStr] = selectedMonthFilter.split("-");
  return {
    isAll: false,
    year: parseInt(yearStr),
    month: parseInt(monthStr) - 1
  };
}
function calculateFinancials(period) {
  const checkPeriodDate = (dt) => {
    const d = parseFirestoreDate(dt);
    if (!d) return false;
    if (period.isAll) return true;
    return d.getMonth() === period.month && d.getFullYear() === period.year;
  };
  const filteredManuals = currentExpenses.filter((exp) => {
    return checkPeriodDate(exp.date);
  });
  const totalExpenses = filteredManuals.filter((e) => e.type !== "income").reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalManualIncomes = filteredManuals.filter((e) => e.type === "income").reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const filteredOrders = currentOrders.filter((o) => {
    return checkPeriodDate(o.createdAt);
  });
  const filteredSettlements = currentSettlements.filter((s) => {
    return checkPeriodDate(s.createdAt);
  });
  let comercioCommissionsTotal = 0;
  let appUsageFeesTotal = 0;
  let goMarketIncomeTotal = 0;
  let goMarketProfitTotal = 0;
  const goMarketProductsMap = {};
  const hasCommerceSettlements = filteredSettlements.some((s) => s.type === "commerce_settlement" || s.comercioId);
  filteredSettlements.forEach((s) => {
    if (s.type === "commerce_settlement" || s.comercioId) {
      comercioCommissionsTotal += Math.abs(Number(s.amountCollected || s.amount || 0));
    }
  });
  const liquidatedDriverIds = /* @__PURE__ */ new Set();
  filteredSettlements.forEach((s) => {
    if (s.type === "driver_debt" || s.driverId) {
      liquidatedDriverIds.add(s.driverId);
    }
  });
  currentTransactions.forEach((t) => {
    const isLiquidation = t.type === "liquidation" || t.type === "settlement" || t.type === "pago" || t.type === "canon_paid";
    if (isLiquidation && t.driverId && checkPeriodDate(t.createdAt)) {
      liquidatedDriverIds.add(t.driverId);
    }
  });
  let driverCanonTotal = 0;
  currentTransactions.forEach((t) => {
    if (t.type === "canon_charge" && t.driverId && liquidatedDriverIds.has(t.driverId) && checkPeriodDate(t.createdAt)) {
      driverCanonTotal += Number(t.amount || 1800);
    }
  });
  goMarketCatalogProducts.forEach((prod) => {
    const prodName = prod.name || "Producto GoMarket";
    const key = prodName.toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
    const purchasePrice = Number(prod.costPrice || 0);
    const price = Number(prod.price || 0);
    const hasCostPrice = purchasePrice > 0;
    const unitProfit = hasCostPrice && price > 0 ? Math.max(0, price - purchasePrice) : 0;
    goMarketProductsMap[key] = {
      key,
      name: prodName,
      qty: 0,
      price,
      purchasePrice,
      hasCostPrice,
      unitProfit,
      marginPct: hasCostPrice && price > 0 ? Math.round(unitProfit / price * 100) : 0,
      totalRevenue: 0,
      totalProfit: 0
    };
  });
  filteredOrders.forEach((order) => {
    const isOrderDelivered = order.status === "delivered" || order.status === "completed";
    const isCommissionPaid = order.commissionStatus === "paid" || order.isSettled === true;
    if (isCommissionPaid && !hasCommerceSettlements) {
      const comm = order.isManual ? 0 : Number(order.commissionAmount || 0);
      comercioCommissionsTotal += comm;
    }
    if (isOrderDelivered && order.driverId && liquidatedDriverIds.has(order.driverId)) {
      const fee = Number(order.appUsageFee || order.appFee || 0);
      appUsageFeesTotal += fee;
    }
    const isGoMarketOrder = order.isGoMarket || (order.comercioName || "").toLowerCase().includes("gomarket") || (order.comercioName || "").toLowerCase().includes("go! market");
    if (isGoMarketOrder && isOrderDelivered) {
      const isLiquidatedGoMarket = order.paymentMethod !== "efectivo" || order.isSettledDriver === true;
      if (isLiquidatedGoMarket) {
        const items = order.items || [];
        items.forEach((item) => {
          const prodName = item.name || "Producto GoMarket";
          const key = prodName.toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
          const price = Number(item.price || 0);
          const qty = Number(item.qty || 1);
          const revenue = price * qty;
          const catalogProd = goMarketProductsMap[key];
          const purchasePrice = catalogProd ? catalogProd.purchasePrice : Number(item.costPrice || 0);
          const hasCostPrice = purchasePrice > 0;
          const unitProfit = hasCostPrice && price > 0 ? Math.max(0, price - purchasePrice) : 0;
          const totalProfit = unitProfit * qty;
          goMarketIncomeTotal += revenue;
          goMarketProfitTotal += totalProfit;
          if (!goMarketProductsMap[key]) {
            goMarketProductsMap[key] = {
              key,
              name: prodName,
              qty: 0,
              price,
              purchasePrice,
              hasCostPrice,
              unitProfit,
              marginPct: hasCostPrice && price > 0 ? Math.round(unitProfit / price * 100) : 0,
              totalRevenue: 0,
              totalProfit: 0
            };
          }
          goMarketProductsMap[key].qty += qty;
          goMarketProductsMap[key].totalRevenue += revenue;
          goMarketProductsMap[key].totalProfit += totalProfit;
        });
      }
    }
  });
  const totalIncome = comercioCommissionsTotal + appUsageFeesTotal + driverCanonTotal + goMarketProfitTotal + totalManualIncomes;
  const netResult = totalIncome - totalExpenses;
  const netMarginPct = totalIncome > 0 ? Math.round(netResult / totalIncome * 100) : 0;
  return {
    filteredManuals,
    totalExpenses,
    totalManualIncomes,
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
  const container = document.getElementById("tab-content-area");
  if (!container) return;
  const period = getSelectedMonthPeriod();
  const monthLabelText = period.isAll ? "Hist\xF3rico Completo" : `${MONTH_NAMES[period.month]} ${period.year}`;
  const financials = calculateFinancials(period);
  if (activeTab === "balance") {
    renderBalanceTab(container, financials, monthLabelText);
  } else if (activeTab === "expenses") {
    renderExpensesTab(container, financials, monthLabelText);
  } else if (activeTab === "gomarket") {
    renderGoMarketTab(container, financials, monthLabelText);
  }
}
function renderBalanceTab(container, financials, monthLabelText) {
  const { totalIncome, totalExpenses, netResult, netMarginPct, comercioCommissionsTotal, appUsageFeesTotal, driverCanonTotal, goMarketProfitTotal, totalManualIncomes, filteredManuals } = financials;
  const isPositive = netResult >= 0;
  const manualIncomesList = filteredManuals.filter((e) => e.type === "income");
  const listHTML = manualIncomesList.length === 0 ? `<div style="padding:32px; text-align:center; color:var(--color-text-tertiary); font-size:12px; font-weight:700;">No se registraron ingresos manuales en este per\xEDodo.</div>` : manualIncomesList.map((item) => {
    let dateStr = "\u2014";
    if (item.date) {
      const dt = new Date(item.date);
      const day = String(dt.getDate()).padStart(2, "0");
      const month = String(dt.getMonth() + 1).padStart(2, "0");
      const hours = String(dt.getHours()).padStart(2, "0");
      const minutes = String(dt.getMinutes()).padStart(2, "0");
      dateStr = `${day}/${month} ${hours}:${minutes}`;
    }
    return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 16px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; box-shadow:var(--shadow-sm); transition: transform 0.15s ease;" onmouseover="this.style.transform='translateX(3px)'" onmouseout="this.style.transform='none'">
            <div>
              <div style="font-weight:900; font-size:13.5px; color:var(--color-text-primary); text-align:left;">${item.concept}</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:700; margin-top:2.5px; text-align:left;">
                ${dateStr} \u2022 ${item.paymentMethod || "Efectivo"} ${item.notes ? `\u2022 "${item.notes}"` : ""}
              </div>
            </div>
            <div style="text-align:right; display:flex; align-items:center; gap:10px;">
              <span style="font-size:15px; font-weight:950; color:#10b981;">+${formatPrice(item.amount)}</span>
              <div style="display:flex; gap:4px;">
                <button onclick="window.editExpenseModal('${item.id}')" style="width:28px; height:28px; border-radius:8px; border:1px solid var(--color-border-light); background:var(--color-surface); display:flex; align-items:center; justify-content:center; color:var(--color-text-secondary); cursor:pointer;">
                  ${icon("edit", 12)}
                </button>
                <button onclick="window.deleteExpenseConfirm('${item.id}')" style="width:28px; height:28px; border-radius:8px; border:1px solid rgba(239,68,68,0.2); background:rgba(239,68,68,0.05); display:flex; align-items:center; justify-content:center; color:#ef4444; cursor:pointer;">
                  ${icon("trash", 12)}
                </button>
              </div>
            </div>
          </div>
        `;
  }).join("");
  container.innerHTML = `
    <!-- Hero Balance General Card -->
    <div style="background: ${isPositive ? "linear-gradient(135deg, #10b981, #059669)" : "linear-gradient(135deg, #ef4444, #dc2626)"}; border-radius: 24px; padding: 22px; color: white; box-shadow: 0 10px 25px ${isPositive ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}; position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
      
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
        <div style="text-align:left;">
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9;">
            Resultado Neto Real Cobrado (${monthLabelText})
          </div>
          <div style="font-family: var(--font-display); font-size: 32px; font-weight: 950; margin-top: 4px; letter-spacing: -1px;">
            ${isPositive ? "+" : ""}${formatPrice(netResult)}
          </div>
          <div style="font-size: 12px; font-weight: 700; margin-top: 6px; opacity: 0.95;">
            ${isPositive ? "\u{1F7E2} Super\xE1vit Neto Efectivo" : "\u{1F534} D\xE9ficit Operacional"} \xB7 Margen: <b>${netMarginPct}%</b>
          </div>
        </div>

        <div style="display: flex; gap: 12px; background: rgba(255,255,255,0.15); backdrop-filter: blur(8px); padding: 10px 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.2); text-align:left;">
          <div>
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; opacity: 0.85;">Ingresos Cobrados</div>
            <div style="font-size: 16px; font-weight: 950; margin-top: 2px;">+${formatPrice(totalIncome)}</div>
          </div>
          <div style="width: 1px; background: rgba(255,255,255,0.25);"></div>
          <div>
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; opacity: 0.85;">Egresos Totales</div>
            <div style="font-size: 16px; font-weight: 950; margin-top: 2px;">-${formatPrice(totalExpenses)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Desglose de Ingresos Card -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 24px; padding: 20px; box-shadow: var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
      <h3 style="font-family:var(--font-display); font-size:13.5px; font-weight:900; margin:0; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.04em; text-align:left;">
        \u{1F4B0} Ingresos Efectivamente Cobrados (${monthLabelText})
      </h3>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; text-align:left;">
        
        <!-- Commerce Commissions Card -->
        <div onclick="window.showCategoryDetailsModal('comercio_commissions', '${monthLabelText}')" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%); border: 1.5px solid rgba(16, 185, 129, 0.22); border-radius: 20px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.04);" onmouseover="this.style.background='linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.04) 100%)'; this.style.borderColor='rgba(16, 185, 129, 0.45)';" onmouseout="this.style.background='linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)'; this.style.borderColor='rgba(16, 185, 129, 0.22)';">
          <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
            <div style="width:52px; height:52px; border-radius:14px; background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#047857;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-size: 11px; font-weight: 850; color: #065f46; text-transform:uppercase; letter-spacing:0.02em;">\u{1F3EA} Comisiones Comercios</div>
              <div style="font-size: 19px; font-weight: 950; color: #047857; margin-top: 2px;">+${formatPrice(comercioCommissionsTotal)}</div>
              <div style="font-size: 10.5px; color: #065f46; margin-top: 1px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Comisiones de pedidos liquidadas</div>
            </div>
          </div>
          <div style="color:#047857; margin-left: 8px; display:flex; align-items:center;">
            ${icon("chevronRight", 20)}
          </div>
        </div>

        <!-- Driver Canon Card -->
        <div onclick="window.showCategoryDetailsModal('driver_liquidations', '${monthLabelText}')" style="background: linear-gradient(135deg, rgba(5, 150, 105, 0.08) 0%, rgba(5, 150, 105, 0.02) 100%); border: 1.5px solid rgba(5, 150, 105, 0.22); border-radius: 20px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(5, 150, 105, 0.04);" onmouseover="this.style.background='linear-gradient(135deg, rgba(5, 150, 105, 0.12) 0%, rgba(5, 150, 105, 0.04) 100%)'; this.style.borderColor='rgba(5, 150, 105, 0.45)';" onmouseout="this.style.background='linear-gradient(135deg, rgba(5, 150, 105, 0.08) 0%, rgba(5, 150, 105, 0.02) 100%)'; this.style.borderColor='rgba(5, 150, 105, 0.22)';">
          <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
            <div style="width:52px; height:52px; border-radius:14px; background:rgba(5, 150, 105, 0.15); border:1px solid rgba(5, 150, 105, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#065f46;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="18" r="3"/>
                <path d="M12 18V8a2 2 0 0 1 2-2h2"/>
                <path d="M6 15h12l-2-6H8L6 15z"/>
              </svg>
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-size: 11px; font-weight: 850; color: #064e3b; text-transform:uppercase; letter-spacing:0.02em;">\u{1F6F5} Canon Repartidores</div>
              <div style="font-size: 19px; font-weight: 950; color: #065f46; margin-top: 2px;">+${formatPrice(driverCanonTotal)}</div>
              <div style="font-size: 10.5px; color: #064e3b; margin-top: 1px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">C\xE1nones y saldos cobrados</div>
            </div>
          </div>
          <div style="color:#065f46; margin-left: 8px; display:flex; align-items:center;">
            ${icon("chevronRight", 20)}
          </div>
        </div>

        <!-- App Fees Card -->
        <div onclick="window.showCategoryDetailsModal('app_fees', '${monthLabelText}')" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%); border: 1.5px solid rgba(59, 130, 246, 0.22); border-radius: 20px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(59, 130, 246, 0.04);" onmouseover="this.style.background='linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(59, 130, 246, 0.04) 100%)'; this.style.borderColor='rgba(59, 130, 246, 0.45)';" onmouseout="this.style.background='linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%)'; this.style.borderColor='rgba(59, 130, 246, 0.22)';">
          <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
            <div style="width:52px; height:52px; border-radius:14px; background:rgba(59, 130, 246, 0.15); border:1px solid rgba(59, 130, 246, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#1d4ed8;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
                <path d="M9 6h6"/>
              </svg>
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-size: 11px; font-weight: 850; color: #1e3a8a; text-transform:uppercase; letter-spacing:0.02em;">\u{1F4F2} Tarifas Servicio App</div>
              <div style="font-size: 19px; font-weight: 950; color: #1d4ed8; margin-top: 2px;">+${formatPrice(appUsageFeesTotal)}</div>
              <div style="font-size: 10.5px; color: #1e3a8a; margin-top: 1px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">De pedidos liquidados</div>
            </div>
          </div>
          <div style="color:#1d4ed8; margin-left: 8px; display:flex; align-items:center;">
            ${icon("chevronRight", 20)}
          </div>
        </div>

        <!-- GoMarket Margins Card -->
        <div onclick="window.showCategoryDetailsModal('gomarket_profit', '${monthLabelText}')" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(139, 92, 246, 0.02) 100%); border: 1.5px solid rgba(139, 92, 246, 0.22); border-radius: 20px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.04);" onmouseover="this.style.background='linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0.04) 100%)'; this.style.borderColor='rgba(139, 92, 246, 0.45)';" onmouseout="this.style.background='linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(139, 92, 246, 0.02) 100%)'; this.style.borderColor='rgba(139, 92, 246, 0.22)';">
          <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
            <div style="width:52px; height:52px; border-radius:14px; background:rgba(139, 92, 246, 0.15); border:1px solid rgba(139, 92, 246, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#6d28d9;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="21" r="1"/>
                <circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-size: 11px; font-weight: 850; color: #3b0764; text-transform:uppercase; letter-spacing:0.02em;">\u{1F6D2} Margen GoMarket</div>
              <div style="font-size: 19px; font-weight: 950; color: #6d28d9; margin-top: 2px;">+${formatPrice(goMarketProfitTotal)}</div>
              <div style="font-size: 10.5px; color: #3b0764; margin-top: 1px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Margen real neto de entregas</div>
            </div>
          </div>
          <div style="color:#6d28d9; margin-left: 8px; display:flex; align-items:center;">
            ${icon("chevronRight", 20)}
          </div>
        </div>

        <!-- Manual Incomes Card -->
        <div onclick="window.showCategoryDetailsModal('manual_incomes', '${monthLabelText}')" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%); border: 1.5px solid rgba(16, 185, 129, 0.22); border-radius: 20px; padding: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.04);" onmouseover="this.style.background='linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.04) 100%)'; this.style.borderColor='rgba(16, 185, 129, 0.45)';" onmouseout="this.style.background='linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)'; this.style.borderColor='rgba(16, 185, 129, 0.22)';">
          <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
            <div style="width:52px; height:52px; border-radius:14px; background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#047857;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-size: 11px; font-weight: 850; color: #065f46; text-transform:uppercase; letter-spacing:0.02em;">\u{1F4B8} Ingresos Manuales</div>
              <div style="font-size: 19px; font-weight: 950; color: #047857; margin-top: 2px;">+${formatPrice(totalManualIncomes)}</div>
              <div style="font-size: 10.5px; color: #065f46; margin-top: 1px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Inyecciones y otros ingresos manuales</div>
            </div>
          </div>
          <div style="color:var(--color-text-tertiary); margin-left: 8px; display:flex; align-items:center;">
            ${icon("chevronRight", 20)}
          </div>
        </div>

      </div>
    </div>

    <!-- Ingresos Manuales Detallados -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 24px; padding: 20px; box-shadow: var(--shadow-sm); display:flex; flex-direction:column; gap:14px;">
      <h3 style="font-family:var(--font-display); font-size:13.5px; font-weight:900; margin:0; color:var(--color-text-primary); text-transform:uppercase; letter-spacing:0.04em; text-align:left;">
        \u{1F4E5} Log de Ingresos Manuales (${monthLabelText})
      </h3>
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${listHTML}
      </div>
    </div>
  `;
}
function renderExpensesTab(container, financials, monthLabelText) {
  const { filteredManuals, totalExpenses } = financials;
  const manualExpenses = filteredManuals.filter((e) => e.type !== "income");
  const categoryTotals = {};
  manualExpenses.forEach((exp) => {
    const cat = exp.category || "Otros";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(exp.amount || 0);
  });
  const categories = [
    { key: "Sueldos", label: "Sueldos y Honorarios", icon: "\u{1F464}", color: "#ef4444" },
    { key: "Combustible", label: "Combustible y Log\xEDstica", icon: "\u26FD", color: "#f59e0b" },
    { key: "Servidores", label: "Servidores y Software", icon: "\u{1F4BB}", color: "#3b82f6" },
    { key: "Marketing", label: "Marketing y Publicidad", icon: "\u{1F4E2}", color: "#8b5cf6" },
    { key: "Insumos", label: "Insumos y Papeler\xEDa", icon: "\u{1F4E6}", color: "#10b981" },
    { key: "Impuestos", label: "Impuestos y Tasas", icon: "\u{1F3DB}\uFE0F", color: "#64748b" },
    { key: "Mantenimiento", label: "Mantenimiento", icon: "\u{1F6E0}\uFE0F", color: "#ec4899" },
    { key: "Otros", label: "Otros Egresos", icon: "\u{1F4D1}", color: "#6b7280" }
  ];
  const activeCategories = categories.filter((cat) => (categoryTotals[cat.key] || 0) > 0);
  const finalFiltered = manualExpenses.filter((exp) => {
    const matchesCat = selectedCategoryFilter === "all" || exp.category === selectedCategoryFilter;
    const matchesSearch = !searchQuery || (exp.concept || "").toLowerCase().includes(searchQuery) || (exp.notes || "").toLowerCase().includes(searchQuery) || (exp.paymentMethod || "").toLowerCase().includes(searchQuery);
    return matchesCat && matchesSearch;
  });
  container.innerHTML = `
    <!-- Categories Breakdown Card -->
    <div style="background: linear-gradient(135deg, #f43f5e, #be123c); border-radius: 24px; padding: 22px; color: white; box-shadow: 0 10px 25px rgba(244,63,94,0.25); position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
      
      <div style="font-weight: 900; font-size: 14.5px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; text-transform:uppercase; letter-spacing:0.04em; text-align:left;">
        ${icon("pieChart", 18)} Desglose de Gastos por Categor\xEDa (${monthLabelText})
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        ${activeCategories.length === 0 ? `
          <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 700;">
            No hay gastos registrados en el per\xEDodo seleccionado.
          </div>
        ` : activeCategories.map((cat) => {
    const amount = categoryTotals[cat.key] || 0;
    const pct = totalExpenses > 0 ? Math.round(amount / totalExpenses * 100) : 0;
    return `
            <div style="background: rgba(255, 255, 255, 0.14); backdrop-filter: blur(8px); border-radius: 16px; padding: 12px 14px; border: 1px solid rgba(255, 255, 255, 0.18); text-align:left;">
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 800; margin-bottom: 6px;">
                <span>${cat.icon} ${cat.label}</span>
                <span style="color: #ffe4e6; font-weight: 900; margin-left: auto;">${pct}%</span>
              </div>
              <div style="font-size: 17px; font-weight: 950; color: white; margin-bottom: 6px; font-family: var(--font-display);">
                ${formatPrice(amount)}
              </div>
              <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.22); border-radius: 10px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: #ffffff; border-radius: 10px;"></div>
              </div>
            </div>
          `;
  }).join("")}
      </div>
    </div>

    <!-- Filters & Controls -->
    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 240px; position: relative;">
        <input type="text" id="expense-search-input" placeholder="Buscar por concepto, nota o comprobante..." value="${searchQuery}" style="width: 100%; height: 46px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); padding: 0 16px 0 40px; font-size: 13.5px; font-weight: 600; outline: none; box-shadow: var(--shadow-sm); color: var(--color-text-primary);" />
        <div style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--color-text-tertiary); pointer-events: none; display: flex;">
          ${icon("search", 18)}
        </div>
      </div>

      <select id="expense-category-filter" style="height: 46px; padding: 0 16px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-surface); font-size: 13.5px; font-weight: 700; outline: none; cursor: pointer; color: var(--color-text-primary); box-shadow: var(--shadow-sm);">
        <option value="all" ${selectedCategoryFilter === "all" ? "selected" : ""}>Todas las Categor\xEDas</option>
        <option value="Sueldos" ${selectedCategoryFilter === "Sueldos" ? "selected" : ""}>Sueldos y Honorarios</option>
        <option value="Combustible" ${selectedCategoryFilter === "Combustible" ? "selected" : ""}>Combustible y Log\xEDstica</option>
        <option value="Servidores" ${selectedCategoryFilter === "Servidores" ? "selected" : ""}>Servidores y Software</option>
        <option value="Marketing" ${selectedCategoryFilter === "Marketing" ? "selected" : ""}>Marketing y Publicidad</option>
        <option value="Insumos" ${selectedCategoryFilter === "Insumos" ? "selected" : ""}>Insumos y Papeler\xEDa</option>
        <option value="Impuestos" ${selectedCategoryFilter === "Impuestos" ? "selected" : ""}>Impuestos y Tasas</option>
        <option value="Mantenimiento" ${selectedCategoryFilter === "Mantenimiento" ? "selected" : ""}>Mantenimiento y Reparaci\xF3n</option>
        <option value="Otros" ${selectedCategoryFilter === "Otros" ? "selected" : ""}>Otros Egresos</option>
      </select>
    </div>

    <!-- Expenses Table Container with scroll/responsive features -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; box-shadow: var(--shadow-sm);">
      <div style="padding: 14px 18px; background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="font-size: 13px; font-weight: 800; color: var(--color-text-primary); text-transform:uppercase; letter-spacing:0.02em;">
          Egresos Detallados (${monthLabelText}) \u2014 <span style="color: var(--color-text-tertiary); font-weight:600;">${finalFiltered.length} registro${finalFiltered.length === 1 ? "" : "s"}</span>
        </div>
        <div style="font-size: 13.5px; font-weight: 900; color: #ef4444; background: rgba(239,68,68,0.08); padding: 5px 14px; border-radius: 10px; border:1px solid rgba(239,68,68,0.15);">
          Total Egresos: ${formatPrice(totalExpenses)}
        </div>
      </div>

      ${finalFiltered.length === 0 ? `
        <div style="padding: 50px 20px; text-align: center; color: var(--color-text-tertiary);">
          <div style="font-size: 40px; margin-bottom: 8px;">\u{1F9FE}</div>
          <div style="font-weight: 800; font-size: 15px; color: var(--color-text-primary);">No hay gastos cargados en el filtro seleccionado</div>
        </div>
      ` : `
        <div style="overflow-x: auto; width:100%;">
          <table class="responsive-table">
            <thead>
              <tr style="background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--color-text-tertiary); letter-spacing: 0.05em;">
                <th style="padding: 14px 18px;">Fecha</th>
                <th style="padding: 14px 18px;">Concepto</th>
                <th style="padding: 14px 18px;">Categor\xEDa</th>
                <th style="padding: 14px 18px;">M\xE9todo de Pago</th>
                <th style="padding: 14px 18px; text-align: right;">Monto</th>
                <th style="padding: 14px 18px; text-align: center;">Comprobante</th>
                <th style="padding: 14px 18px; text-align: center;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${finalFiltered.map((exp) => {
    const dateStr = exp.date ? new Date(exp.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "\u2014";
    return `
                  <tr style="border-bottom: 1px solid var(--color-border-light); transition: background 0.15s;" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">
                    <td data-label="Fecha" style="padding: 14px 18px; font-weight: 600; color: var(--color-text-secondary); white-space: nowrap;">${dateStr}</td>
                    <td data-label="Concepto" style="padding: 14px 18px;">
                      <div style="font-weight: 800; color: var(--color-text-primary); text-align:right; display:inline-block; max-width:100%; word-break:break-word;">${exp.concept || "Sin concepto"}</div>
                      ${exp.notes ? `<div style="font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px;">${exp.notes}</div>` : ""}
                    </td>
                    <td data-label="Categor\xEDa" style="padding: 14px 18px; white-space: nowrap;">
                      <span style="background: rgba(239, 68, 68, 0.12); color: #dc2626; padding: 4px 10px; border-radius: 20px; font-weight: 800; font-size: 11px; display: inline-block; text-transform:uppercase; letter-spacing:0.02em;">
                        ${exp.category || "Otros"}
                      </span>
                    </td>
                    <td data-label="M\xE9todo de Pago" style="padding: 14px 18px; font-weight: 600; text-transform: capitalize; color: var(--color-text-secondary); white-space: nowrap;">
                      ${exp.paymentMethod || "Efectivo"}
                    </td>
                    <td data-label="Monto" style="padding: 14px 18px; text-align: right; font-family: var(--font-display); font-weight: 950; font-size: 15px; color: #ef4444; white-space: nowrap;">
                      -${formatPrice(exp.amount)}
                    </td>
                    <td data-label="Comprobante" style="padding: 14px 18px; text-align: center;">
                      ${exp.receiptUrl ? `
                        <button onclick="window.viewReceiptModal('${exp.id}')" style="background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); padding: 5px 12px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: var(--color-primary);">
                          ${icon("image", 14)} Ver Comprobante
                        </button>
                      ` : `<span style="font-size: 12px; color: var(--color-text-tertiary); font-style: italic;">Sin foto</span>`}
                    </td>
                    <td data-label="Acciones" style="padding: 14px 18px; text-align: center; white-space: nowrap;">
                      <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <button onclick="window.editExpenseModal('${exp.id}')" style="width: 32px; height: 32px; border-radius: 10px; background: var(--color-bg-secondary); border: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: center; color: var(--color-text-primary); cursor: pointer;" title="Editar">
                          ${icon("edit", 14)}
                        </button>
                        <button onclick="window.deleteExpenseConfirm('${exp.id}')" style="width: 32px; height: 32px; border-radius: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); display: flex; align-items: center; justify-content: center; color: #ef4444; cursor: pointer;" title="Eliminar">
                          ${icon("trash", 14)}
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
  }).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
  const inputSearch = document.getElementById("expense-search-input");
  if (inputSearch) {
    inputSearch.oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      updateDashboardView();
    };
  }
  const catSelect = document.getElementById("expense-category-filter");
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
    <div style="background: linear-gradient(135deg, #8b5cf6, #6d28d9); border-radius: 24px; padding: 22px; color: white; box-shadow: 0 10px 25px rgba(139,92,246,0.25); position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(255,255,255,0.1); border-radius: 50%; pointer-events: none;"></div>
      
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
        <div style="text-align:left;">
          <div style="font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9;">
            Ganancia Real GoMarket (${monthLabelText})
          </div>
          <div style="font-family: var(--font-display); font-size: 32px; font-weight: 950; margin-top: 4px; letter-spacing: -1px;">
            +${formatPrice(goMarketProfitTotal)}
          </div>
          <div style="font-size: 12px; font-weight: 700; margin-top: 4px; opacity: 0.95;">
            C\xE1lculo: (Venta - Compra) \xD7 Unidades Liquidadas
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.15); backdrop-filter: blur(8px); padding: 12px 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; opacity: 0.85;">Ventas Brutas</div>
          <div style="font-size: 17px; font-weight: 950; margin-top: 2px;">${formatPrice(goMarketIncomeTotal)}</div>
        </div>
      </div>
    </div>

    <!-- Products Profitability Table -->
    <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden; box-shadow: var(--shadow-sm);">
      <div style="padding: 14px 18px; background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div style="font-size: 13px; font-weight: 800; color: var(--color-text-primary); text-transform:uppercase; letter-spacing:0.02em; text-align:left;">
          Rendimiento y Ganancia Real por Producto (${monthLabelText})
        </div>
      </div>

      ${goMarketProductsList.length === 0 ? `
        <div style="padding: 50px 20px; text-align: center; color: var(--color-text-tertiary);">
          <div style="font-size: 40px; margin-bottom: 8px;">\u{1F6D2}</div>
          <div style="font-weight: 800; font-size: 15px; color: var(--color-text-primary);">No hay ventas de GoMarket liquidadas en este per\xEDodo</div>
        </div>
      ` : `
        <div style="overflow-x: auto; width:100%;">
          <table class="responsive-table">
            <thead>
              <tr style="background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border-light); font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--color-text-tertiary); letter-spacing: 0.05em;">
                <th style="padding: 14px 18px;">Producto</th>
                <th style="padding: 14px 18px; text-align: right;">Precio Venta</th>
                <th style="padding: 14px 18px; text-align: right;">Precio Compra</th>
                <th style="padding: 14px 18px; text-align: right;">Ganancia/U.</th>
                <th style="padding: 14px 18px; text-align: center;">% Margen</th>
                <th style="padding: 14px 18px; text-align: center;">Unidades</th>
                <th style="padding: 14px 18px; text-align: right;">Ganancia Total</th>
              </tr>
            </thead>
            <tbody>
              ${goMarketProductsList.map((prod) => `
                <tr style="border-bottom: 1px solid var(--color-border-light); transition: background 0.15s;" onmouseover="this.style.background='var(--color-bg-secondary)'" onmouseout="this.style.background='transparent'">
                  <td data-label="Producto" style="padding: 14px 18px; font-weight: 800; color: var(--color-text-primary); text-align:left; min-width:140px; word-break:break-word;">${prod.name}</td>
                  <td data-label="Precio Venta" style="padding: 14px 18px; text-align: right; font-weight: 800; color: var(--color-text-primary);">${formatPrice(prod.price)}</td>
                  
                  <td data-label="Precio Compra" style="padding: 14px 18px; text-align: right; font-weight: 700; color: var(--color-text-secondary);">
                    ${prod.hasCostPrice ? formatPrice(prod.purchasePrice) : '<span style="font-size:11px; color:var(--color-text-tertiary); font-style:italic;">Sin costo</span>'}
                  </td>

                  <td data-label="Ganancia/U." style="padding: 14px 18px; text-align: right; font-weight: 800; color: #10b981;">
                    +${formatPrice(prod.unitProfit)}
                  </td>

                  <td data-label="% Margen" style="padding: 14px 18px; text-align: center;">
                    <span style="background: rgba(139,92,246,0.12); color: #7c3aed; padding: 4px 10px; border-radius: 12px; font-weight: 900; font-size: 11px;">
                      ${prod.marginPct}%
                    </span>
                  </td>

                  <td data-label="Unidades" style="padding: 14px 18px; text-align: center; font-weight: 800; color: var(--color-text-primary);">${prod.qty}</td>

                  <td data-label="Ganancia Total" style="padding: 14px 18px; text-align: right; font-family: var(--font-display); font-weight: 950; font-size: 15px; color: #8b5cf6;">
                    +${formatPrice(prod.totalProfit)}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}
function openExpenseModal(existingExpense = null) {
  let uploadedReceiptBase64 = existingExpense?.receiptUrl || "";
  let activeEntryType = existingExpense?.type || "expense";
  const todayStr = existingExpense?.date ? new Date(existingExpense.date).toISOString().split("T")[0] : (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const renderModalContent = () => {
    return `
      <form id="expense-form" style="display: flex; flex-direction: column; gap: 16px; padding: 4px 4px calc(24px + env(safe-area-inset-bottom, 0px)) 4px; max-height: calc(82dvh - env(safe-area-inset-bottom, 0px)); overflow-y: auto; box-sizing: border-box; font-family:var(--font-body);">
        
        <!-- Tab selector for Income vs Expense -->
        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 8px; color: var(--color-text-primary); text-transform:uppercase; letter-spacing:0.02em;">Tipo de Registro</label>
          <div style="display:flex; background:var(--color-bg-secondary); border-radius:14px; padding:4px; gap:4px;">
            <button type="button" id="toggle-type-expense" style="flex:1; height:40px; border-radius:10px; border:none; font-weight:800; font-size:13px; cursor:pointer; transition:all 0.2s; ${activeEntryType === "expense" ? "background:#ef4444; color:white; box-shadow:var(--shadow-sm);" : "background:transparent; color:var(--color-text-secondary);"}">
              \u{1F4B8} Egreso / Gasto
            </button>
            <button type="button" id="toggle-type-income" style="flex:1; height:40px; border-radius:10px; border:none; font-weight:800; font-size:13px; cursor:pointer; transition:all 0.2s; ${activeEntryType === "income" ? "background:#10b981; color:white; box-shadow:var(--shadow-sm);" : "background:transparent; color:var(--color-text-secondary);"}">
              \u{1F4E5} Ingreso Dinero
            </button>
          </div>
        </div>

        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Concepto / T\xEDtulo *</label>
          <input type="text" id="exp-concept" required placeholder="${activeEntryType === "expense" ? "Ej: Alquiler oficina, Nafta moto..." : "Ej: Inyecci\xF3n de capital, Pago extraordinario..."}" value="${existingExpense?.concept || ""}" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box;" />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Monto ($) *</label>
            <input type="number" id="exp-amount" min="1" step="any" required placeholder="0" value="${existingExpense?.amount || ""}" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 15px; font-weight: 800; outline: none; box-sizing: border-box;" />
          </div>

          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Fecha *</label>
            <input type="date" id="exp-date" required value="${todayStr}" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Categor\xEDa *</label>
            <select id="exp-category" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box; cursor: pointer;">
              ${activeEntryType === "expense" ? `
                <option value="Sueldos" ${existingExpense?.category === "Sueldos" ? "selected" : ""}>\u{1F464} Sueldos y Honorarios</option>
                <option value="Combustible" ${existingExpense?.category === "Combustible" ? "selected" : ""}>\u26FD Combustible y Log\xEDstica</option>
                <option value="Servidores" ${existingExpense?.category === "Servidores" ? "selected" : ""}>\u{1F4BB} Servidores y Software</option>
                <option value="Marketing" ${existingExpense?.category === "Marketing" ? "selected" : ""}>\u{1F4E2} Marketing y Publicidad</option>
                <option value="Insumos" ${existingExpense?.category === "Insumos" ? "selected" : ""}>\u{1F4E6} Insumos y Papeler\xEDa</option>
                <option value="Impuestos" ${existingExpense?.category === "Impuestos" ? "selected" : ""}>\u{1F3DB}\uFE0F Impuestos y Tasas</option>
                <option value="Mantenimiento" ${existingExpense?.category === "Mantenimiento" ? "selected" : ""}>\u{1F6E0}\uFE0F Mantenimiento</option>
                <option value="Otros" ${!existingExpense || existingExpense?.category === "Otros" ? "selected" : ""}>\u{1F4D1} Otros Egresos</option>
              ` : `
                <option value="Ventas" ${existingExpense?.category === "Ventas" ? "selected" : ""}>\u{1F4B0} Ventas e Ingresos de Operaci\xF3n</option>
                <option value="Inyeccion" ${existingExpense?.category === "Inyeccion" ? "selected" : ""}>\u{1F3E6} Inyecci\xF3n de Capital / Socio</option>
                <option value="Ajuste" ${existingExpense?.category === "Ajuste" ? "selected" : ""}>\u2699\uFE0F Ajuste de Saldo Contable</option>
                <option value="Otros" ${!existingExpense || existingExpense?.category === "Otros" ? "selected" : ""}>\u{1F4D1} Otros Ingresos</option>
              `}
            </select>
          </div>

          <div>
            <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">M\xE9todo de Transacci\xF3n</label>
            <select id="exp-payment-method" style="width: 100%; height: 48px; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 0 14px; font-size: 14px; font-weight: 600; outline: none; box-sizing: border-box; cursor: pointer;">
              <option value="Efectivo" ${existingExpense?.paymentMethod === "Efectivo" ? "selected" : ""}>\u{1F4B5} Efectivo</option>
              <option value="Transferencia" ${existingExpense?.paymentMethod === "Transferencia" ? "selected" : ""}>\u{1F3E6} Transferencia Bancaria</option>
              <option value="Mercado Pago" ${existingExpense?.paymentMethod === "Mercado Pago" ? "selected" : ""}>\u{1F4F1} Mercado Pago</option>
              <option value="Tarjeta" ${existingExpense?.paymentMethod === "Tarjeta" ? "selected" : ""}>\u{1F4B3} Tarjeta D\xE9bito/Cr\xE9dito</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Notas / Observaciones</label>
          <textarea id="exp-notes" rows="2" placeholder="Detalles adicionales, factura, descripci\xF3n..." style="width: 100%; border-radius: 14px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary); color: var(--color-text-primary); padding: 10px 14px; font-size: 13.5px; font-family: inherit; outline: none; box-sizing: border-box; resize: vertical;">${existingExpense?.notes || ""}</textarea>
        </div>

        <div>
          <label style="font-size: 13px; font-weight: 800; display: block; margin-bottom: 6px; color: var(--color-text-primary);">Foto de Comprobante / Ticket (Opcional)</label>
          <div style="border: 2px dashed var(--color-border-light); border-radius: 16px; padding: 16px; text-align: center; background: var(--color-bg-secondary); cursor: pointer; position: relative;" id="receipt-upload-box">
            <input type="file" id="exp-receipt-file" accept="image/*" style="position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;" />
            <div id="receipt-preview-container">
              ${uploadedReceiptBase64 ? `
                <img src="${uploadedReceiptBase64}" style="max-height: 140px; border-radius: 10px; border: 1px solid var(--color-border-light); display: block; margin: 0 auto 8px auto;" />
                <span style="font-size: 12px; font-weight: 700; color: var(--color-primary);">Cambiar foto de comprobante</span>
              ` : `
                <div style="font-size: 28px; margin-bottom: 4px;">\u{1F4F7}</div>
                <div style="font-size: 13px; font-weight: 700; color: var(--color-text-primary);">Adjuntar foto de ticket o factura</div>
                <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;">Formatos: JPG, PNG, WEBP</div>
              `}
            </div>
          </div>
        </div>

        <button type="submit" id="save-expense-btn" style="margin-top: 8px; height: 48px; border-radius: 14px; background: ${activeEntryType === "expense" ? "#ef4444" : "#10b981"}; color: white; border: none; font-weight: 900; font-size: 15px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.1); transition: all 0.2s;">
          ${existingExpense ? "Guardar Cambios" : activeEntryType === "expense" ? "Registrar Gasto" : "Registrar Ingreso"}
        </button>
      </form>
    `;
  };
  const setupModalListeners = (modalWrapper) => {
    const fileInput = modalWrapper.querySelector("#exp-receipt-file");
    const previewBox = modalWrapper.querySelector("#receipt-preview-container");
    if (fileInput) {
      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const maxDim = 1200;
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round(h * maxDim / w);
                w = maxDim;
              } else {
                w = Math.round(w * maxDim / h);
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            uploadedReceiptBase64 = canvas.toDataURL("image/jpeg", 0.75);
            if (previewBox) {
              previewBox.innerHTML = `
                <img src="${uploadedReceiptBase64}" style="max-height: 140px; border-radius: 10px; border: 1px solid var(--color-border-light); display: block; margin: 0 auto 8px auto;" />
                <span style="font-size: 12px; font-weight: 700; color: var(--color-primary);">\xA1Comprobante adjuntado! Toca para cambiar</span>
              `;
            }
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      };
    }
    const btnExpense = modalWrapper.querySelector("#toggle-type-expense");
    const btnIncome = modalWrapper.querySelector("#toggle-type-income");
    if (btnExpense && btnIncome) {
      btnExpense.onclick = () => {
        if (activeEntryType === "expense") return;
        activeEntryType = "expense";
        updateModalBody();
      };
      btnIncome.onclick = () => {
        if (activeEntryType === "income") return;
        activeEntryType = "income";
        updateModalBody();
      };
    }
    const form = modalWrapper.querySelector("#expense-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const concept = modalWrapper.querySelector("#exp-concept").value.trim();
      const amount = parseFloat(modalWrapper.querySelector("#exp-amount").value);
      const date = modalWrapper.querySelector("#exp-date").value;
      const category = modalWrapper.querySelector("#exp-category").value;
      const paymentMethod = modalWrapper.querySelector("#exp-payment-method").value;
      const notes = modalWrapper.querySelector("#exp-notes").value.trim();
      if (!concept || isNaN(amount) || amount <= 0 || !date) {
        showToast("Por favor completa los campos obligatorios", "warning");
        return;
      }
      const saveBtn = modalWrapper.querySelector("#save-expense-btn");
      saveBtn.disabled = true;
      saveBtn.innerHTML = `${icon("loader", 16, "animate-spin")} Guardando...`;
      try {
        const expenseData = {
          concept,
          amount,
          date: (/* @__PURE__ */ new Date(date + "T12:00:00")).toISOString(),
          category,
          paymentMethod,
          notes,
          type: activeEntryType,
          receiptUrl: uploadedReceiptBase64 || "",
          updatedAt: serverTimestamp()
        };
        if (existingExpense) {
          await updateDoc(doc(db, "company_expenses", existingExpense.id), expenseData);
          showToast("Registro contable actualizado", "success");
        } else {
          expenseData.createdAt = serverTimestamp();
          await addDoc(collection(db, "company_expenses"), expenseData);
          showToast("Registro cargado exitosamente", "success");
        }
        closeModal();
      } catch (err) {
        console.error("Error saving entry:", err);
        showToast("Error al guardar registro", "error");
        saveBtn.disabled = false;
        saveBtn.innerHTML = existingExpense ? "Guardar Cambios" : "Registrar Movimiento";
      }
    };
  };
  const updateModalBody = () => {
    const modalBody = document.querySelector('[id="expense-form"]')?.parentNode;
    if (modalBody) {
      modalBody.innerHTML = renderModalContent();
      setupModalListeners(modalBody);
    }
  };
  showModal({
    title: existingExpense ? "\u270F\uFE0F Editar Registro" : "\u{1F4BC} Registrar Nuevo Movimiento Contable",
    height: "auto",
    content: renderModalContent()
  });
  const activeModalWrapper = document.querySelector('[id="expense-form"]')?.parentNode;
  if (activeModalWrapper) {
    setupModalListeners(activeModalWrapper);
  }
}
window.openPremiumMonthPicker = () => {
  let pickerYear = selectedMonthFilter !== "all" ? parseInt(selectedMonthFilter.split("-")[0]) : (/* @__PURE__ */ new Date()).getFullYear();
  const pickerOverlay = document.createElement("div");
  pickerOverlay.id = "premium-month-picker-overlay";
  pickerOverlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:99999; opacity:0; transition:opacity 0.25s ease;";
  const pickerDialog = document.createElement("div");
  pickerDialog.style.cssText = "background:#ffffff; border-radius:24px; padding:24px; width:90%; max-width:320px; box-shadow:0 20px 60px rgba(0,0,0,0.25); border:1px solid #e4e4e7; transform:scale(0.9); transition:transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); display:flex; flex-direction:column; gap:16px; align-items:center; color:#18181b; font-family:var(--font-body);";
  const renderGridContent = () => {
    return `
      <!-- Header -->
      <div style="display:flex; align-items:center; justify-content:space-between; width:100%; border-bottom:1px solid #f4f4f5; padding-bottom:12px;">
        <span style="font-size:14px; font-weight:900; text-transform:uppercase; letter-spacing:0.05em; color:#71717a;">Elegir Mes</span>
        <button id="close-picker-btn" style="border:none; background:transparent; font-size:18px; font-weight:800; cursor:pointer; color:#71717a;">\u2715</button>
      </div>

      <!-- Year selector -->
      <div style="display:flex; align-items:center; justify-content:space-between; width:100%; max-width:200px;">
        <button id="picker-prev-year-btn" style="width:34px; height:34px; border-radius:50%; border:1px solid #e4e4e7; background:#f4f4f5; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:800; color:#18181b;">${icon("chevronLeft", 16)}</button>
        <span id="picker-year-title" style="font-family:var(--font-display); font-size:20px; font-weight:950; color:#18181b;">${pickerYear}</span>
        <button id="picker-next-year-btn" style="width:34px; height:34px; border-radius:50%; border:1px solid #e4e4e7; background:#f4f4f5; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:800; color:#18181b;">${icon("chevronRight", 16)}</button>
      </div>
      
      <!-- Months Grid -->
      <div id="picker-months-container" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; width:100%;">
        ${MONTH_NAMES.map((name, idx) => {
      const mNum = idx + 1;
      const isSelected = selectedMonthFilter !== "all" && parseInt(selectedMonthFilter.split("-")[0]) === pickerYear && parseInt(selectedMonthFilter.split("-")[1]) === mNum;
      const bg = isSelected ? "var(--color-primary)" : "#f4f4f5";
      const color = isSelected ? "white" : "#18181b";
      const fw = isSelected ? "900" : "700";
      return `
            <button class="picker-month-cell" data-month="${mNum}" style="height:42px; border-radius:10px; border:none; background:${bg}; color:${color}; font-weight:${fw}; font-size:12px; cursor:pointer; transition:all 0.15s; text-transform:uppercase;">
              ${name.slice(0, 3)}
            </button>
          `;
    }).join("")}
      </div>
    `;
  };
  pickerDialog.innerHTML = renderGridContent();
  pickerOverlay.appendChild(pickerDialog);
  document.body.appendChild(pickerOverlay);
  requestAnimationFrame(() => {
    pickerOverlay.style.opacity = "1";
    pickerDialog.style.transform = "scale(1)";
  });
  const closePicker = () => {
    pickerOverlay.style.opacity = "0";
    pickerDialog.style.transform = "scale(0.9)";
    setTimeout(() => pickerOverlay.remove(), 250);
  };
  pickerOverlay.onclick = (e) => {
    if (e.target === pickerOverlay) closePicker();
  };
  const bindEvents = () => {
    pickerDialog.querySelector("#close-picker-btn").onclick = closePicker;
    pickerDialog.querySelector("#picker-prev-year-btn").onclick = () => {
      pickerYear--;
      pickerDialog.querySelector("#picker-year-title").textContent = pickerYear;
      updateGrid();
    };
    pickerDialog.querySelector("#picker-next-year-btn").onclick = () => {
      pickerYear++;
      pickerDialog.querySelector("#picker-year-title").textContent = pickerYear;
      updateGrid();
    };
    pickerDialog.querySelectorAll(".picker-month-cell").forEach((btn) => {
      btn.onclick = () => {
        const m = String(btn.dataset.month).padStart(2, "0");
        selectedMonthFilter = `${pickerYear}-${m}`;
        const labelEl = document.getElementById("current-picker-label");
        if (labelEl) labelEl.textContent = formatMonthFilterLabel(selectedMonthFilter);
        closePicker();
        updateDashboardView();
      };
    });
  };
  const updateGrid = () => {
    const container = pickerDialog.querySelector("#picker-months-container");
    container.innerHTML = MONTH_NAMES.map((name, idx) => {
      const mNum = idx + 1;
      const isSelected = selectedMonthFilter !== "all" && parseInt(selectedMonthFilter.split("-")[0]) === pickerYear && parseInt(selectedMonthFilter.split("-")[1]) === mNum;
      const bg = isSelected ? "var(--color-primary)" : "#f4f4f5";
      const color = isSelected ? "white" : "#18181b";
      const fw = isSelected ? "900" : "700";
      return `
        <button class="picker-month-cell" data-month="${mNum}" style="height:42px; border-radius:10px; border:none; background:${bg}; color:${color}; font-weight:${fw}; font-size:12px; cursor:pointer; transition:all 0.15s; text-transform:uppercase;">
          ${name.slice(0, 3)}
        </button>
      `;
    }).join("");
    bindEvents();
  };
  bindEvents();
};
window.showCategoryDetailsModal = (categoryKey, monthLabelText) => {
  const period = getSelectedMonthPeriod();
  let titleText = "";
  let subTitleText = `Movimientos (${monthLabelText})`;
  let items = [];
  const checkPeriodDate = (dt) => {
    const d = parseFirestoreDate(dt);
    if (!d) return false;
    if (period.isAll) return true;
    return d.getMonth() === period.month && d.getFullYear() === period.year;
  };
  const hasCommerceSettlements = currentSettlements.some((s) => (s.type === "commerce_settlement" || s.comercioId) && checkPeriodDate(s.createdAt));
  const liquidatedDriverIds = /* @__PURE__ */ new Set();
  currentSettlements.forEach((s) => {
    if ((s.type === "driver_debt" || s.driverId) && checkPeriodDate(s.createdAt)) {
      liquidatedDriverIds.add(s.driverId);
    }
  });
  currentTransactions.forEach((t) => {
    const isLiquidation = t.type === "liquidation" || t.type === "settlement" || t.type === "pago" || t.type === "canon_paid";
    if (isLiquidation && t.driverId && checkPeriodDate(t.createdAt)) {
      liquidatedDriverIds.add(t.driverId);
    }
  });
  if (categoryKey === "comercio_commissions") {
    titleText = "\u{1F3EA} Comisiones Comercios";
    currentSettlements.forEach((s) => {
      if ((s.type === "commerce_settlement" || s.comercioId) && checkPeriodDate(s.createdAt)) {
        items.push({
          date: s.createdAt,
          concept: `Liquidaci\xF3n Comercio: ${s.comercioName || "Comercio"}`,
          amount: Math.abs(Number(s.amountCollected || s.amount || 0))
        });
      }
    });
    if (!hasCommerceSettlements) {
      currentOrders.forEach((o) => {
        const isCommissionPaid = o.commissionStatus === "paid" || o.isSettled === true;
        if (isCommissionPaid && !o.isManual && checkPeriodDate(o.createdAt)) {
          items.push({
            date: o.createdAt,
            concept: `Comisi\xF3n Pedido #${o.goId || o.id.slice(0, 6)} (${o.comercioName || "Comercio"})`,
            amount: Number(o.commissionAmount || 0)
          });
        }
      });
    }
  } else if (categoryKey === "driver_liquidations") {
    titleText = "\u{1F6F5} Canon Repartidores";
    currentTransactions.forEach((t) => {
      if (t.type === "canon_charge" && t.driverId && liquidatedDriverIds.has(t.driverId) && checkPeriodDate(t.createdAt)) {
        const driverUser = currentUsers.find((u) => u.id === t.driverId);
        const driverRealName = driverUser ? driverUser.displayName || driverUser.name : "Repartidor";
        const matchedProof = currentProofs.find((p) => p.driverId === t.driverId && p.status === "approved" && p.imageUrl);
        items.push({
          date: t.createdAt,
          driverId: t.driverId,
          concept: `Canon Diario: ${driverRealName}`,
          amount: Math.abs(Number(t.amount || 1800)),
          receiptUrl: matchedProof ? matchedProof.imageUrl : ""
        });
      }
    });
  } else if (categoryKey === "app_fees") {
    titleText = "\u{1F4F2} Tarifas Servicio App";
    currentOrders.forEach((o) => {
      const isOrderDelivered = o.status === "delivered" || o.status === "completed";
      if (isOrderDelivered && o.driverId && liquidatedDriverIds.has(o.driverId) && checkPeriodDate(o.createdAt)) {
        const fee = Number(o.appUsageFee || o.appFee || 0);
        if (fee > 0) {
          const driverUser = currentUsers.find((u) => u.id === o.driverId);
          const driverRealName = driverUser ? driverUser.displayName || driverUser.name : o.driverName || "Repartidor";
          const matchedProof = currentProofs.find((p) => p.driverId === o.driverId && p.status === "approved" && p.imageUrl);
          items.push({
            date: o.createdAt,
            driverId: o.driverId,
            concept: `Tarifa Pedido #${o.goId || o.id.slice(0, 6)} (${driverRealName})`,
            amount: fee,
            receiptUrl: matchedProof ? matchedProof.imageUrl : ""
          });
        }
      }
    });
  } else if (categoryKey === "gomarket_profit") {
    titleText = "\u{1F6D2} Margen GoMarket";
    currentOrders.forEach((o) => {
      const isOrderDelivered = o.status === "delivered" || o.status === "completed";
      const isGoMarketOrder = o.isGoMarket || (o.comercioName || "").toLowerCase().includes("gomarket") || (o.comercioName || "").toLowerCase().includes("go! market");
      if (isGoMarketOrder && isOrderDelivered && checkPeriodDate(o.createdAt)) {
        const isLiquidatedGoMarket = o.paymentMethod !== "efectivo" || o.isSettledDriver === true;
        if (isLiquidatedGoMarket) {
          let orderProfit = 0;
          let prodDetails = [];
          (o.items || []).forEach((item) => {
            const price = Number(item.price || 0);
            const qty = Number(item.qty || 1);
            const key = (item.name || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
            const catalogProd = goMarketCatalogProducts.find((p) => (p.name || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "_") === key);
            const purchasePrice = catalogProd ? Number(catalogProd.costPrice || 0) : Number(item.costPrice || 0);
            const unitProfit = purchasePrice > 0 && price > 0 ? Math.max(0, price - purchasePrice) : 0;
            orderProfit += unitProfit * qty;
            if (unitProfit > 0) {
              prodDetails.push(`${qty}x ${item.name || "Prod"} (+${formatPrice(unitProfit * qty)})`);
            }
          });
          if (orderProfit > 0) {
            items.push({
              date: o.createdAt,
              concept: `Venta Pedido #${o.goId || o.id.slice(0, 6)} <br><span style="font-size:10px; color:rgba(0,0,0,0.45); font-weight:600;">${prodDetails.join(", ")}</span>`,
              amount: orderProfit
            });
          }
        }
      }
    });
  } else if (categoryKey === "manual_incomes") {
    titleText = "\u{1F4B8} Ingresos Manuales";
    const manualIncomes = currentExpenses.filter((e) => e.type === "income" && checkPeriodDate(e.date));
    manualIncomes.forEach((item) => {
      items.push({
        date: item.date,
        concept: `${item.concept} ${item.notes ? `<br><span style="font-size:10px; color:rgba(0,0,0,0.45); font-weight:600;">"${item.notes}"</span>` : ""}`,
        amount: item.amount,
        receiptUrl: item.receiptUrl || ""
      });
    });
  }
  items.sort((a, b) => {
    const dateA = parseFirestoreDate(a.date);
    const dateB = parseFirestoreDate(b.date);
    return dateB - dateA;
  });
  showModal({
    title: titleText,
    headerBackground: "#000000",
    headerTextColor: "#ffffff",
    height: "80dvh",
    content: `
      <div style="background:#ffffff; color:#18181b; padding:16px; font-family:var(--font-body); display:flex; flex-direction:column; gap:12px; flex:1; box-sizing:border-box; min-height:100%;">
        <div style="font-size:10px; font-weight:800; color:#71717a; text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid #e4e4e7; padding-bottom:8px; text-align:left;">
          ${subTitleText}
        </div>
        <div id="modal-movements-list" style="display:flex; flex-direction:column; gap:8px;">
          <!-- Items will be inserted dynamically here -->
        </div>
        <div id="modal-load-more-container" style="margin-top:12px;"></div>
      </div>
    `
  });
  const listContainer = document.getElementById("modal-movements-list");
  const loadMoreContainer = document.getElementById("modal-load-more-container");
  let visibleCount = 50;
  const updateModalList = () => {
    if (!listContainer) return;
    const slice = items.slice(0, visibleCount);
    listContainer.innerHTML = slice.length === 0 ? `<div style="padding:32px 10px; text-align:center; color:#71717a; font-size:12.5px; font-weight:700;">No hay movimientos liquidados registrados para esta categor\xEDa.</div>` : slice.map((it, index) => {
      const dt = parseFirestoreDate(it.date);
      const dateStr = dt ? dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "\u2014";
      const hasReceipt = !!it.receiptUrl;
      const clickAction = hasReceipt ? `onclick="window.showModalReceiptFullscreen('${it.receiptUrl}')"` : "";
      const hoverStyle = hasReceipt ? "cursor:pointer; transform:scale(1.01); transition:all 0.15s;" : "";
      const isDriverRelated = !!it.driverId;
      const driverUser = isDriverRelated ? currentUsers.find((u) => u.id === it.driverId) : null;
      const pfp = driverUser ? driverUser.photo || driverUser.photoUrl || driverUser.photoURL || "" : "";
      const driverRealName = driverUser ? driverUser.displayName || driverUser.name : "Repartidor";
      return `
            <div ${clickAction} style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#f4f4f5; border:1px solid #e4e4e7; border-radius:12px; box-shadow:var(--shadow-sm); ${hoverStyle}" ${hasReceipt ? `onmouseover="this.style.background='#e4e4e7'" onmouseout="this.style.background='#f4f4f5'"` : ""}>
              
              <!-- Pfp on the left -->
              ${isDriverRelated ? pfp ? `<img src="${pfp}" style="width:38px; height:38px; border-radius:50%; object-fit:cover; border:1.5px solid #e4e4e7; margin-right:12px; flex-shrink:0;" />` : `
                <div style="width:38px; height:38px; border-radius:50%; background:#e4e4e7; display:flex; align-items:center; justify-content:center; color:#71717a; font-size:13px; font-weight:850; margin-right:12px; flex-shrink:0; text-transform:uppercase;">
                  ${driverRealName.slice(0, 2)}
                </div>
              ` : `
                <div style="width:38px; height:38px; border-radius:50%; background:#f4f4f5; border:1.5px solid #e4e4e7; display:flex; align-items:center; justify-content:center; color:#71717a; margin-right:12px; flex-shrink:0;">
                  <span style="font-size:16px;">${categoryKey === "comercio_commissions" ? "\u{1F3EA}" : categoryKey === "gomarket_profit" ? "\u{1F6D2}" : "\u{1F4B8}"}</span>
                </div>
              `}

              <div style="text-align:left; min-width:0; flex:1; margin-right:12px;">
                <div style="font-weight:800; font-size:12.5px; color:#18181b; line-height:1.3; word-wrap:break-word;">
                  ${it.concept}
                  ${hasReceipt ? `<span style="font-size:10px; font-weight:900; color:var(--color-primary); background:rgba(var(--color-primary-rgb),0.1); padding:2px 6px; border-radius:6px; margin-left:6px; display:inline-block;">${icon("image", 10)} COMPROBANTE</span>` : ""}
                </div>
                <div style="font-size:10px; color:#71717a; font-weight:700; margin-top:2px;">${dateStr}</div>
              </div>
              <div style="font-size:14px; font-weight:950; color:#10b981; white-space:nowrap; flex-shrink:0;">
                +${formatPrice(it.amount)}
              </div>
            </div>
          `;
    }).join("");
    if (items.length > visibleCount && loadMoreContainer) {
      loadMoreContainer.innerHTML = `
        <button id="btn-load-more-movements" style="width:100%; height:42px; border-radius:12px; border:1px solid #e4e4e7; background:#f4f4f5; color:#18181b; font-weight:800; font-size:12.5px; cursor:pointer;">
          Mostrar m\xE1s (${items.length - visibleCount} restantes)
        </button>
      `;
      document.getElementById("btn-load-more-movements").onclick = () => {
        visibleCount += 50;
        updateModalList();
      };
    } else if (loadMoreContainer) {
      loadMoreContainer.innerHTML = "";
    }
  };
  updateModalList();
};
window.showModalReceiptFullscreen = (url) => {
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
window.viewReceiptModal = (expenseId) => {
  const exp = currentExpenses.find((e) => e.id === expenseId);
  if (!exp || !exp.receiptUrl) return;
  showModal({
    title: "\u{1F4C4} Comprobante Adjuntado",
    height: "auto",
    content: `
      <div style="padding: 16px; text-align: center; font-family:var(--font-body);">
        <div style="font-weight: 900; font-size: 15px; margin-bottom: 4px; color: var(--color-text-primary);">${exp.concept}</div>
        <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 16px;">Monto: <b style="color: ${exp.type === "income" ? "#10b981" : "#ef4444"};">${formatPrice(exp.amount)}</b></div>
        
        <div style="max-height: 70vh; overflow-y: auto; border-radius: 16px; border: 1px solid var(--color-border-light); background: #18181b; padding: 10px; display: flex; align-items: center; justify-content: center;">
          <img src="${exp.receiptUrl}" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" alt="Comprobante" />
        </div>
      </div>
    `
  });
};
window.editExpenseModal = (expenseId) => {
  const exp = currentExpenses.find((e) => e.id === expenseId);
  if (exp) openExpenseModal(exp);
};
window.deleteExpenseConfirm = (expenseId) => {
  const exp = currentExpenses.find((e) => e.id === expenseId);
  if (!exp) return;
  showConfirm({
    title: "\xBFEliminar registro contable?",
    message: `Vas a eliminar el registro <b>"${exp.concept}"</b> por un valor de <b>${formatPrice(exp.amount)}</b>. Esta acci\xF3n no se puede deshacer de los libros.`,
    confirmText: "S\xED, eliminar",
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, "company_expenses", expenseId));
        showToast("Registro contable eliminado", "info");
      } catch (err) {
        console.error("Error deleting entry:", err);
        showToast("Error al eliminar registro", "error");
      } finally {
        closeModal();
      }
    }
  });
};
