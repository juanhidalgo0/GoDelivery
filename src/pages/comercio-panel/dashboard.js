// GoDelivery — Comercio Panel Dashboard
import { db } from '../../firebase.js';
import { doc, onSnapshot, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { isAdmin } from '../../auth.js';
import { renderPendingCommissionStickyFooter } from '../../components/pending-commission-footer.js';

let notificationSound = new Audio('/assets/sounds/notification.mp3');
let ordersUnsub = null;
let lastOrderCount = null;

export async function renderComercioDashboard() {
  const content = document.getElementById('app-content');
  const user = getState().user;
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  // Calculate padding dynamically
  const isNative = !!window.Capacitor;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const topPadding = isNative 
    ? 'var(--status-bar-height, 24px)' 
    : ((isIosDevice && isStandalone) ? 'calc(34px + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 0px)');

  // Pre-render shell
  content.innerHTML = `
    <div class="panel-page" style="position:fixed; inset:0; width:100%; height:100dvh; display:flex; flex-direction:column; overflow:hidden; background:var(--color-bg); z-index:1000;">
      <!-- Premium Fixed Header -->
      <div style="width:100%; padding-top: ${topPadding}; background: var(--color-primary); position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1); flex-shrink: 0;">
        <div style="display:flex;align-items:center;gap:12px;padding: 12px 16px 16px 16px; position:relative;overflow:hidden;color:white;">
          <!-- Decorative Circles -->
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          
          <a href="#/mi-comercio/${comercioId}/orders" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.2);width:38px;height:38px;border-radius:12px;cursor:pointer;text-decoration:none;position:relative;z-index:2;flex-shrink:0;">${icon('chevronLeft', 24)}</a>
          <div style="flex:1;min-width:0;">
            <h1 style="font-family:var(--font-display);font-weight:800;font-size:18px;color:inherit;margin:0;line-height:1.2;letter-spacing:-0.02em;">${isAdmin() ? 'Adm: Dashboard' : 'Dashboard de Gestión'}</h1>
            <p id="panel-commerce-name" style="font-size:10.5px;color:rgba(255,255,255,0.85);font-weight:700;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Cargando...</p>
          </div>
          <button id="open-dashboard-sidebar-btn" title="Menú del Comercio" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.25);color:white;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;position:relative;z-index:2;">
            ${icon('menu', 22)}
          </button>
        </div>
      </div>

      <!-- Scrollable Executive Dashboard Content -->
      <div style="flex:1;overflow-y:auto;padding:12px 14px 16px 14px;-webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:10px;">
        <div id="new-order-alert-container"></div>

        <!-- 4 Key Executive Stat Cards -->
        <div class="admin-stats-grid" id="panel-stats" style="grid-template-columns:1fr 1fr; gap:8px;">
          <div class="stat-card skeleton" style="height:80px; border-radius:16px;"></div>
          <div class="stat-card skeleton" style="height:80px; border-radius:16px;"></div>
          <div class="stat-card skeleton" style="height:80px; border-radius:16px;"></div>
          <div class="stat-card skeleton" style="height:80px; border-radius:16px;"></div>
        </div>

        <!-- Sales Trend SVG Chart -->
        <div id="dashboard-sales-chart-container">
          <div class="skeleton" style="height:180px; border-radius:20px;"></div>
        </div>

        <!-- Orders Breakdown & Distribution Chart -->
        <div id="dashboard-orders-chart-container">
          <div class="skeleton" style="height:150px; border-radius:20px;"></div>
        </div>

        <!-- Top Selling Products Chart -->
        <div id="dashboard-top-products-container">
          <div class="skeleton" style="height:160px; border-radius:20px;"></div>
        </div>
      </div>

      <!-- Right Sidebar Drawer Navigation -->
      <div id="dashboard-right-drawer-overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2000; opacity:0; pointer-events:none; transition:opacity 0.28s ease; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);"></div>

      <div id="dashboard-right-drawer" style="position:fixed; top:0; right:0; bottom:0; width:85%; max-width:320px; background:var(--color-surface); z-index:2001; transform:translateX(100%); transition:transform 0.28s cubic-bezier(0.25, 0.8, 0.25, 1); display:flex; flex-direction:column; box-shadow:-10px 0 30px rgba(0,0,0,0.25);">
        <div style="padding:20px 18px 16px 18px; background:var(--color-primary); color:white; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.1);">
          <div style="display:flex; align-items:center; gap:10px;">
            <img id="dashboard-sidebar-commerce-img" src="" style="width:38px; height:38px; border-radius:11px; object-fit:cover; border:1.5px solid rgba(255,255,255,0.4); display:none; background:white;" />
            <div id="dashboard-sidebar-commerce-placeholder" style="width:38px; height:38px; border-radius:11px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.3);">
              ${icon('store', 20)}
            </div>
            <div>
              <h3 style="font-family:var(--font-display); font-size:15px; font-weight:900; margin:0; color:white;">Menú del Comercio</h3>
              <span style="font-size:10px; opacity:0.85; font-weight:700;">Navegación General</span>
            </div>
          </div>
          <button id="close-dashboard-sidebar-btn" style="background:rgba(255,255,255,0.2); border:none; color:white; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer;">
            ${icon('close', 16)}
          </button>
        </div>

        <div style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:8px;">
          <a href="#/mi-comercio/${comercioId}/products" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(225,29,72,0.1); color:var(--color-primary);">${icon('package', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Productos</span>
              <span class="drawer-nav-desc">Gestión de catálogo y precios</span>
            </div>
          </a>

          <a href="#/mi-comercio/${comercioId}/sabores" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(236, 72, 153, 0.1); color:#ec4899;">${icon('sparkles', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Sabores y Variedades</span>
              <span class="drawer-nav-desc">Gustos de helado / empanadas</span>
            </div>
          </a>

          <a href="#/mi-comercio/${comercioId}/offers" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(245, 158, 11, 0.1); color:#f59e0b;">${icon('tag', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Ofertas y Promociones</span>
              <span class="drawer-nav-desc">Descuentos y 2x1</span>
            </div>
          </a>

          <a href="#/mi-comercio/${comercioId}/coupons" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(16, 185, 129, 0.1); color:#10b981;">${icon('gift', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Cupones de Descuento</span>
              <span class="drawer-nav-desc">Códigos promocionales</span>
            </div>
          </a>

          <a href="#/mi-comercio/${comercioId}/metrics" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(59, 130, 246, 0.1); color:#3b82f6;">${icon('trendingUp', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Métricas e Historial</span>
              <span class="drawer-nav-desc">Ventas, stock y clientes</span>
            </div>
          </a>

          <a href="#/mi-comercio/${comercioId}/finances" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(14, 165, 233, 0.1); color:#0ea5e9;">${icon('creditCard', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Finanzas y Comisiones</span>
              <span class="drawer-nav-desc">Resumen de liquidaciones</span>
            </div>
          </a>

          <div style="display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:16px; opacity:0.55; cursor:not-allowed; position:relative; box-sizing:border-box;">
            <div class="drawer-nav-icon" style="background:rgba(217, 70, 239, 0.1); color:#d946ef;">${icon('megaphone', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title" style="color:var(--color-text-tertiary);">Publicidad y Banners</span>
              <span class="drawer-nav-desc">Campañas y destacar tu local</span>
            </div>
            <span style="margin-left:auto; font-size:8px; font-weight:900; padding:2px 7px; border-radius:6px; background:rgba(217,70,239,0.12); color:#d946ef; text-transform:uppercase; white-space:nowrap; flex-shrink:0;">Próximamente</span>
          </div>

          <a href="#/mi-comercio/${comercioId}/settings" class="drawer-nav-item">
            <div class="drawer-nav-icon" style="background:rgba(100, 116, 139, 0.1); color:#64748b;">${icon('settings', 18)}</div>
            <div class="drawer-nav-text">
              <span class="drawer-nav-title">Configuración</span>
              <span class="drawer-nav-desc">Horarios, envíos y datos</span>
            </div>
          </a>
        </div>
      </div>

      <style>
        .dash-grid-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: 16px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-decoration: none;
          color: var(--color-text-primary);
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.02);
        }
        .dash-grid-card:hover {
          transform: translateY(-2px);
          border-color: var(--color-primary);
          box-shadow: 0 6px 16px rgba(0,0,0,0.06);
        }
        .dash-card-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 2px;
        }
        .dash-card-title {
          font-size: 13px;
          font-weight: 850;
          line-height: 1.2;
        }
        .dash-card-desc {
          font-size: 10px;
          color: var(--color-text-tertiary);
          font-weight: 600;
        }
        .drawer-nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: 14px;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border-light);
          text-decoration: none;
          color: var(--color-text-primary);
          transition: all 0.2s ease;
        }
        .drawer-nav-item:hover {
          background: var(--color-surface);
          border-color: var(--color-primary);
          transform: translateX(3px);
        }
        .drawer-nav-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .drawer-nav-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .drawer-nav-title {
          font-size: 13px;
          font-weight: 850;
        }
        .drawer-nav-desc {
          font-size: 10px;
          color: var(--color-text-secondary);
        }
      </style>
    </div>
  `;

  // Sidebar Drawer Controls
  const drawerOverlay = document.getElementById('dashboard-right-drawer-overlay');
  const drawer = document.getElementById('dashboard-right-drawer');

  const openDrawer = () => {
    if (drawerOverlay && drawer) {
      drawerOverlay.style.opacity = '1';
      drawerOverlay.style.pointerEvents = 'auto';
      drawer.style.transform = 'translateX(0)';
    }
  };

  const closeDrawer = () => {
    if (drawerOverlay && drawer) {
      drawerOverlay.style.opacity = '0';
      drawerOverlay.style.pointerEvents = 'none';
      drawer.style.transform = 'translateX(100%)';
    }
  };

  document.getElementById('open-dashboard-sidebar-btn')?.addEventListener('click', openDrawer);
  document.getElementById('close-dashboard-sidebar-btn')?.addEventListener('click', closeDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);

  renderPendingCommissionStickyFooter(comercioId, document.querySelector('.panel-page'));

  let commerceData = null;
  let isInitialLoad = true;
  let q;

  const handleSnapshot = (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboardData(orders, comercioId, commerceData);
    
    if (!isInitialLoad) {
      snap.docChanges().forEach(change => {
        if (change.type === 'added' && change.doc.data().status === 'pending') {
          playNotificationSound();
        }
      });
    }
    isInitialLoad = false;
  };

  const attemptOptimizedQuery = () => {
    q = query(collection(db, 'orders'), where('comercioId', '==', comercioId), orderBy('createdAt', 'desc'), limit(150));
    ordersUnsub = onSnapshot(q, handleSnapshot, (err) => {
      if (err.message && err.message.includes('index')) {
        console.warn('Falta índice compuesto. Intentando fallback sin límite en dashboard...', err.message);
        if (ordersUnsub) ordersUnsub();
        q = query(collection(db, 'orders'), where('comercioId', '==', comercioId));
        ordersUnsub = onSnapshot(q, handleSnapshot);
      } else {
        console.error('Error listening to dashboard orders:', err);
      }
    });
  };

  attemptOptimizedQuery();

  const unlockAudio = () => {
    notificationSound.play().then(() => {
      notificationSound.pause();
      notificationSound.currentTime = 0;
      document.removeEventListener('click', unlockAudio);
    }).catch(() => {});
  };
  document.addEventListener('click', unlockAudio);

  onSnapshot(doc(db, 'comercios', comercioId), (snap) => {
    if (snap.exists()) {
      commerceData = snap.data();
      const nameContainer = document.getElementById('panel-commerce-name');
      if (nameContainer) nameContainer.textContent = isAdmin() ? `Adm: ${commerceData.name}` : commerceData.name;

      const logo = commerceData.logo || commerceData.imageUrl || commerceData.image;
      const sidebarImg = document.getElementById('dashboard-sidebar-commerce-img');
      const sidebarPlaceholder = document.getElementById('dashboard-sidebar-commerce-placeholder');
      if (logo && sidebarImg && sidebarPlaceholder) {
        sidebarImg.src = logo;
        sidebarImg.style.display = 'block';
        sidebarPlaceholder.style.display = 'none';
      }
    }
  });

  return {
    cleanup: () => {
      if (ordersUnsub) ordersUnsub();
      document.removeEventListener('click', unlockAudio);
    }
  };
}

function updateDashboardData(orders, comercioId, commerceData) {
  const completedOrders = orders.filter(o => o.status === 'completed');
  
  const totalBilled = completedOrders.reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
  const pendingCommissions = completedOrders.reduce((sum, o) => {
    const isPending = !o.commissionStatus || o.commissionStatus === 'pending';
    return sum + (isPending ? (o.commissionAmount || 0) : 0);
  }, 0);

  const rating = commerceData?.rating ? parseFloat(commerceData.rating).toFixed(1) : '5.0';

  const panelStats = document.getElementById('panel-stats');
  if (panelStats) {
    panelStats.innerHTML = `
      <div class="stat-card page-enter stagger-1" style="background:linear-gradient(135deg, rgba(34,197,94,0.08), #ffffff); border:1.5px solid rgba(34,197,94,0.2); border-radius:18px; padding:12px 14px; display:flex; flex-direction:column; justify-content:space-between; gap:6px; box-shadow:0 4px 12px rgba(34,197,94,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:9.5px; font-weight:850; color:#15803d; text-transform:uppercase; letter-spacing:0.5px;">Ventas Totales</span>
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(34,197,94,0.18); color:#16a34a; display:flex; align-items:center; justify-content:center;">${icon('trendingUp', 15)}</div>
        </div>
        <div style="font-size:19px; font-weight:900; color:#14532d; font-family:var(--font-display);">$${totalBilled.toLocaleString('es-AR')}</div>
      </div>

      <div class="stat-card page-enter stagger-2" style="background:linear-gradient(135deg, rgba(59,130,246,0.08), #ffffff); border:1.5px solid rgba(59,130,246,0.2); border-radius:18px; padding:12px 14px; display:flex; flex-direction:column; justify-content:space-between; gap:6px; box-shadow:0 4px 12px rgba(59,130,246,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:9.5px; font-weight:850; color:#1d4ed8; text-transform:uppercase; letter-spacing:0.5px;">Entregados</span>
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(59,130,246,0.18); color:#2563eb; display:flex; align-items:center; justify-content:center;">${icon('shoppingBag', 15)}</div>
        </div>
        <div style="font-size:19px; font-weight:900; color:#1e3a8a; font-family:var(--font-display);">${completedOrders.length}</div>
      </div>

      <a href="#/mi-comercio/${comercioId}/finances" class="stat-card page-enter stagger-3" style="text-decoration:none; background:linear-gradient(135deg, rgba(225,29,72,0.08), #ffffff); border:1.5px solid rgba(225,29,72,0.2); border-radius:18px; padding:12px 14px; display:flex; flex-direction:column; justify-content:space-between; gap:6px; box-shadow:0 4px 12px rgba(225,29,72,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:9.5px; font-weight:850; color:#be123c; text-transform:uppercase; letter-spacing:0.5px;">Comisión Pend.</span>
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(225,29,72,0.18); color:var(--color-primary); display:flex; align-items:center; justify-content:center;">${icon('zap', 15)}</div>
        </div>
        <div style="font-size:19px; font-weight:900; color:#881337; font-family:var(--font-display);">$${pendingCommissions.toLocaleString('es-AR')}</div>
      </a>

      <div class="stat-card page-enter stagger-4" style="background:linear-gradient(135deg, rgba(245,158,11,0.08), #ffffff); border:1.5px solid rgba(245,158,11,0.2); border-radius:18px; padding:12px 14px; display:flex; flex-direction:column; justify-content:space-between; gap:6px; box-shadow:0 4px 12px rgba(245,158,11,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:9.5px; font-weight:850; color:#b45309; text-transform:uppercase; letter-spacing:0.5px;">Calificación</span>
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(245,158,11,0.18); color:#d97706; display:flex; align-items:center; justify-content:center;">${icon('star', 15)}</div>
        </div>
        <div style="font-size:19px; font-weight:900; color:#78350f; font-family:var(--font-display);">${rating} <span style="font-size:12px; color:#d97706;">★</span></div>
      </div>
    `;
  }

  // Render SVG Trend Chart
  const chartContainer = document.getElementById('dashboard-sales-chart-container');
  if (chartContainer) {
    chartContainer.innerHTML = generateSVGSalesTrendChart(completedOrders);
  }

  // Render Orders Breakdown Chart
  const ordersBreakdownContainer = document.getElementById('dashboard-orders-chart-container');
  if (ordersBreakdownContainer) {
    ordersBreakdownContainer.innerHTML = generateOrderStatusBreakdownChart(orders);
  }

  // Render Top Products Ranking Chart
  const topProductsContainer = document.getElementById('dashboard-top-products-container');
  if (topProductsContainer) {
    topProductsContainer.innerHTML = generateTopProductsRankingChart(completedOrders);
  }
}

function generateSVGSalesTrendChart(completedOrders) {
  const grouped = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    grouped[key] = { label: d.toLocaleDateString('es-AR', { weekday: 'short' }), total: 0 };
  }

  completedOrders.forEach(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date();
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (grouped[key]) grouped[key].total += (o.subtotal || o.total || 0);
  });

  const dataPoints = Object.values(grouped);
  const maxVal = Math.max(...dataPoints.map(p => p.total), 1000);

  const width = 450;
  const height = 120;
  const paddingX = 35;
  const paddingY = 15;

  const points = dataPoints.map((p, idx) => {
    const x = paddingX + (idx / (dataPoints.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (p.total / maxVal) * (height - paddingY * 2);
    return { x, y, label: p.label, val: p.total };
  });

  let pathD = '';
  let areaD = '';

  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    areaD = `M ${points[0].x} ${height - paddingY} L ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const cpX = (points[i - 1].x + points[i].x) / 2;
      pathD += ` C ${cpX} ${points[i - 1].y}, ${cpX} ${points[i].y}, ${points[i].x} ${points[i].y}`;
      areaD += ` C ${cpX} ${points[i - 1].y}, ${cpX} ${points[i].y}, ${points[i].x} ${points[i].y}`;
    }
    areaD += ` L ${points[points.length - 1].x} ${height - paddingY} Z`;
  }

  return `
    <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px 18px; box-shadow:0 4px 15px rgba(0,0,0,0.02); display:flex; flex-direction:column; gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(225,29,72,0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center;">
            ${icon('trendingUp', 16)}
          </div>
          <span style="font-family:var(--font-display); font-size:13.5px; font-weight:900; color:var(--color-text-primary);">Tendencia de Ventas (7 días)</span>
        </div>
        <span style="font-size:10.5px; font-weight:850; color:var(--color-primary); background:rgba(225,29,72,0.06); padding:3px 8px; border-radius:6px;">Máx: $${maxVal.toLocaleString('es-AR')}</span>
      </div>
      <div style="position:relative; width:100%; overflow:hidden;">
        <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; display:block;">
          <defs>
            <linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="var(--color-border-light)" stroke-width="1.5" />
          ${areaD ? `<path d="${areaD}" fill="url(#dashGrad)" />` : ''}
          ${pathD ? `<path d="${pathD}" fill="none" stroke="var(--color-primary)" stroke-width="3" stroke-linecap="round" />` : ''}
          ${points.map(pt => `
            <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="var(--color-surface)" stroke="var(--color-primary)" stroke-width="2.5" />
            <text x="${pt.x}" y="${height - 2}" font-size="9" font-weight="700" fill="var(--color-text-tertiary)" text-anchor="middle">${pt.label}</text>
          `).join('')}
        </svg>
      </div>
    </div>
  `;
}

function generateOrderStatusBreakdownChart(orders) {
  const total = orders.length || 1;
  const completed = orders.filter(o => o.status === 'completed').length;
  const pending = orders.filter(o => o.status === 'pending' || o.status === 'preparing' || o.status === 'delivering' || o.status === 'accepted').length;
  const cancelled = orders.filter(o => o.status === 'cancelled' || o.status === 'rejected').length;

  const pctCompleted = Math.round((completed / total) * 100);
  const pctPending = Math.round((pending / total) * 100);
  const pctCancelled = Math.round((cancelled / total) * 100);

  return `
    <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px 18px; box-shadow:0 4px 15px rgba(0,0,0,0.02); display:flex; flex-direction:column; gap:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(59,130,246,0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center;">
            ${icon('pieChart', 16)}
          </div>
          <span style="font-family:var(--font-display); font-size:13.5px; font-weight:900; color:var(--color-text-primary);">Distribución por Estado</span>
        </div>
        <span style="font-size:11px; font-weight:800; color:var(--color-text-secondary);">${orders.length} totales</span>
      </div>

      <div style="height:12px; border-radius:6px; background:#e2e8f0; overflow:hidden; display:flex; gap:2px;">
        <div style="width:${pctCompleted}%; background:#22c55e; border-radius:4px 0 0 4px; transition:width 0.4s ease;"></div>
        <div style="width:${pctPending}%; background:#f59e0b; transition:width 0.4s ease;"></div>
        <div style="width:${pctCancelled}%; background:#ef4444; border-radius:0 4px 4px 0; transition:width 0.4s ease;"></div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; display:flex; align-items:center; gap:4px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#22c55e;"></span> Entregados
          </span>
          <span style="font-size:14px; font-weight:900; color:var(--color-text-primary); font-family:var(--font-display);">${completed} <small style="font-size:10px; font-weight:700; opacity:0.7;">(${pctCompleted}%)</small></span>
        </div>

        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; display:flex; align-items:center; gap:4px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#f59e0b;"></span> En Curso
          </span>
          <span style="font-size:14px; font-weight:900; color:var(--color-text-primary); font-family:var(--font-display);">${pending} <small style="font-size:10px; font-weight:700; opacity:0.7;">(${pctPending}%)</small></span>
        </div>

        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-size:10px; color:var(--color-text-tertiary); font-weight:700; display:flex; align-items:center; gap:4px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#ef4444;"></span> Cancelados
          </span>
          <span style="font-size:14px; font-weight:900; color:var(--color-text-primary); font-family:var(--font-display);">${cancelled} <small style="font-size:10px; font-weight:700; opacity:0.7;">(${pctCancelled}%)</small></span>
        </div>
      </div>
    </div>
  `;
}

function generateTopProductsRankingChart(completedOrders) {
  const productCounts = {};
  
  completedOrders.forEach(order => {
    const items = order.items || [];
    items.forEach(item => {
      const name = item.name || 'Producto';
      const qty = item.quantity || item.cant || 1;
      const price = item.price || 0;
      if (!productCounts[name]) {
        productCounts[name] = { count: 0, revenue: 0 };
      }
      productCounts[name].count += qty;
      productCounts[name].revenue += (price * qty);
    });
  });

  const sortedProducts = Object.entries(productCounts)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  if (sortedProducts.length === 0) {
    return `
      <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px 18px; text-align:center;">
        <span style="font-size:12px; color:var(--color-text-tertiary); font-weight:700;">No hay datos suficientes de productos vendidos aún.</span>
      </div>
    `;
  }

  const maxCount = sortedProducts[0].count || 1;

  // Window global function to show top 20 modal
  window._showRankingModal = () => {
    import('../../components/modal.js').then(({ showModal }) => {
      showModal({
        title: '🏆 Ranking Top 20 Productos Estrella',
        content: `
          <div style="padding:16px; display:flex; flex-direction:column; gap:12px; max-height:75vh; overflow-y:auto;">
            ${sortedProducts.map((p, idx) => {
              const pct = Math.round((p.count / maxCount) * 100);
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`;
              const badgeBg = idx === 0 ? '#fef3c7' : idx === 1 ? '#f1f5f9' : idx === 2 ? '#ffedd5' : 'var(--color-bg-secondary)';
              const badgeColor = idx === 0 ? '#d97706' : idx === 1 ? '#64748b' : idx === 2 ? '#c2410c' : 'var(--color-text-tertiary)';
              return `
                <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                      <span style="width:28px; height:28px; border-radius:8px; background:${badgeBg}; color:${badgeColor}; font-weight:900; font-size:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        ${medal}
                      </span>
                      <span style="font-weight:850; font-size:13px; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${p.name}
                      </span>
                    </div>
                    <div style="text-align:right; flex-shrink:0; margin-left:8px;">
                      <span style="font-size:12px; font-weight:900; color:var(--color-primary); display:block;">$${p.revenue.toLocaleString('es-AR')}</span>
                      <span style="font-size:10px; font-weight:700; color:var(--color-text-tertiary);">${p.count} unidades</span>
                    </div>
                  </div>
                  <div style="height:6px; border-radius:3px; background:rgba(0,0,0,0.05); overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--color-primary), #a855f7); border-radius:3px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `
      });
    });
  };

  return `
    <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:16px 18px; box-shadow:0 4px 15px rgba(0,0,0,0.02); display:flex; flex-direction:column; gap:12px; margin-bottom: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:8px; background:rgba(168,85,247,0.1); color:#a855f7; display:flex; align-items:center; justify-content:center;">
            ${icon('award', 16)}
          </div>
          <span style="font-family:var(--font-display); font-size:13.5px; font-weight:900; color:var(--color-text-primary);">Ranking de Productos Estrella</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:10.5px; font-weight:850; color:#a855f7; background:rgba(168,85,247,0.1); padding:2px 8px; border-radius:10px;">Top ${sortedProducts.length}</span>
          <button onclick="window._showRankingModal()" style="border:none; background:var(--color-bg-secondary); color:var(--color-text-secondary); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s;" title="Expandir Ranking">
            ${icon('maximize', 14)}
          </button>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; max-height:280px; overflow-y:auto; padding-right:4px;" class="custom-scroll">
        ${sortedProducts.map((p, idx) => {
          const pct = Math.round((p.count / maxCount) * 100);
          const rankColor = idx === 0 ? '#d97706' : idx === 1 ? '#64748b' : idx === 2 ? '#c2410c' : 'var(--color-primary)';
          return `
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="font-weight:800; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:68%;">
                  <span style="color:${rankColor}; font-weight:900; margin-right:4px;">#${idx+1}</span> ${p.name}
                </span>
                <span style="font-weight:850; color:var(--color-text-secondary); font-size:11px;">
                  ${p.count} un. • <span style="color:var(--color-primary);">$${p.revenue.toLocaleString('es-AR')}</span>
                </span>
              </div>
              <div style="height:6px; border-radius:3px; background:var(--color-bg-secondary); overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--color-primary), #ec4899); border-radius:3px; transition:width 0.4s ease;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function playNotificationSound() {
  try {
    const sound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    sound.volume = 0.9;
    sound.play().catch(e => console.log('Audio playback waiting for interaction...'));
  } catch (err) {
    console.warn('Sound error:', err);
  }
}

function formatCurrency(val) {
  return '$' + val.toLocaleString('es-AR');
}
