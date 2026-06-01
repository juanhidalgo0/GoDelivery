// GoDelivery — Comercio Panel Dashboard
import { db } from '../../firebase.js';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';

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

  // Pre-render shell
  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:var(--color-bg);">
      <!-- Premium Fixed Header -->
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:16px;padding:16px 20px;background:var(--header-bg);border-bottom:1px solid var(--header-border);flex-shrink:0;color:var(--color-text);">
        <a href="#/mi-comercio/${comercioId}/orders" style="display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:14px;background:var(--color-bg-secondary);color:var(--color-text);border:1px solid var(--color-border);flex-shrink:0;text-decoration:none;transition:all 0.2s;">${icon('back', 20)}</a>
        <div style="flex:1;min-width:0;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:inherit;margin:0;line-height:1.1;letter-spacing:-0.03em;">Panel de Gestión</h1>
          <p id="panel-commerce-name" style="font-size:12px;color:var(--color-primary);font-weight:800;margin:4px 0 0;text-transform:uppercase;letter-spacing:0.02em;">Cargando...</p>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;">
        <div id="new-order-alert-container"></div>

        <div class="admin-stats-grid" id="panel-stats" style="grid-template-columns:1fr 1fr;margin-bottom:16px;">
          <div class="stat-card skeleton" style="height:90px;"></div>
          <div class="stat-card skeleton" style="height:90px;"></div>
        </div>

        <div id="panel-menu" style="display:flex;flex-direction:column;gap:8px;">
          <a href="#/mi-comercio/${comercioId}/orders" class="admin-menu-item">
            <div class="admin-menu-icon" style="background:var(--color-primary-lighter); color:var(--color-primary);">${icon('shoppingBag', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Gestión de Pedidos</div>
              <div class="admin-menu-desc">Ver y confirmar pedidos de clientes</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>

          <a href="#/mi-comercio/${comercioId}/products" class="admin-menu-item">
            <div class="admin-menu-icon">${icon('package', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Productos</div>
              <div class="admin-menu-desc">Agregar y gestionar productos</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>



          <a href="#/mi-comercio/${comercioId}/finances" class="admin-menu-item">
            <div class="admin-menu-icon" style="background:var(--color-accent-light); color:var(--color-text);">${icon('zap', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Comisiones y Finanzas</div>
              <div class="admin-menu-desc">Historial detallado de comisiones y pagos</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>

          <a href="#/mi-comercio/${comercioId}/settings" class="admin-menu-item">
            <div class="admin-menu-icon accent">${icon('settings', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Configuración</div>
              <div class="admin-menu-desc">Logo, horarios, configuración</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>

          <a href="#/mi-comercio/${comercioId}/offers" class="admin-menu-item">
            <div class="admin-menu-icon" style="background:var(--color-secondary-light); color:var(--color-secondary);">${icon('sparkles', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Mis Ofertas</div>
              <div class="admin-menu-desc">Promociones y descuentos (2x1, %)</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>

          <a href="#/mi-comercio/${comercioId}/metrics" class="admin-menu-item">
            <div class="admin-menu-icon" style="background:rgba(59, 130, 246, 0.1); color:#3b82f6;">${icon('trendingUp', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Métricas y BI</div>
              <div class="admin-menu-desc">Análisis de ventas, productos estrella y horas pico</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>
        </div>
        
        <div id="finances-summary-container" style="margin-top:16px;"></div>
      </div>
    </div>
  `;

  const q = query(collection(db, 'orders'), where('comercioId', '==', comercioId));

  let commerceData = null;
  let isInitialLoad = true;
  ordersUnsub = onSnapshot(q, (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboardData(orders, comercioId, commerceData);
    
    // Play sound for new pending orders ONLY after initial load
    if (!isInitialLoad) {
      snap.docChanges().forEach(change => {
        if (change.type === 'added' && change.doc.data().status === 'pending') {
          playNotificationSound();
        }
      });
    }
    isInitialLoad = false;
  });

  // 3. Audio Context Unlocker (Required by Browsers)
  const unlockAudio = () => {
    notificationSound.play().then(() => {
      notificationSound.pause();
      notificationSound.currentTime = 0;
      document.removeEventListener('click', unlockAudio);
    }).catch(() => {});
  };
  document.addEventListener('click', unlockAudio);

  // 4. Fetch commerce name
  onSnapshot(doc(db, 'comercios', comercioId), (snap) => {
    if (snap.exists()) {
      commerceData = snap.data();
      const nameContainer = document.getElementById('panel-commerce-name');
      if (nameContainer) nameContainer.textContent = commerceData.name;
      
      // Update data again to refresh commission display
      if (!isInitialLoad && document.getElementById('finances-summary-container')) {
        getDocs(q).then(s => updateDashboardData(s.docs.map(d => ({id:d.id, ...d.data()})), comercioId, commerceData));
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
  // Update Stats
  const pendingCommissions = orders.reduce((sum, o) => {
    const isPending = !o.commissionStatus || o.commissionStatus === 'pending';
    return sum + (isPending ? (o.commissionAmount || 0) : 0);
  }, 0);

  const panelStats = document.getElementById('panel-stats');
  if (panelStats) {
    panelStats.innerHTML = `
      <div class="stat-card page-enter stagger-1">
        <div style="position:absolute; top:-20px; right:-20px; width:80px; height:80px; background:var(--color-primary); opacity:0.05; filter:blur(40px); border-radius:50%;"></div>
        <div class="stat-card-icon" style="background:linear-gradient(135deg, var(--color-primary-light), transparent);">${icon('shoppingBag', 24)}</div>
        <div class="stat-card-value">${orders.length}</div>
        <div class="stat-card-label">Pedidos Realizados</div>
      </div>
      <a href="#/mi-comercio/${comercioId}/finances" class="stat-card page-enter stagger-2" style="text-decoration:none; cursor:pointer;">
        <div style="position:absolute; top:-20px; right:-20px; width:80px; height:80px; background:var(--color-primary); opacity:0.1; filter:blur(40px); border-radius:50%;"></div>
        <div class="stat-card-icon accent" style="background:linear-gradient(135deg, var(--color-primary-light), transparent);">${icon('zap', 24)}</div>
        <div class="stat-card-value" style="color:var(--color-primary);">${formatCurrency(pendingCommissions)}</div>
        <div class="stat-card-label">Comisión Pendiente</div>
      </a>
    `;
  }

  // Update Finance Summary
  let cRate = getState().commissionRate || 0.10;
  if (commerceData && commerceData.commissionRate !== undefined && commerceData.commissionRate !== null) {
    cRate = commerceData.commissionRate;
  }
  const commissionRate = cRate * 100;
  const financesContainer = document.getElementById('finances-summary-container');
  if (financesContainer) {
    financesContainer.innerHTML = `
      <div class="profile-section page-enter" style="margin-top: 24px;">
        <h3 class="profile-section-title" style="font-family:var(--font-display); font-weight:800; margin-bottom:16px; opacity:0.9;">Resumen Financiero</h3>
        <div class="admin-card" style="padding: 20px; background:linear-gradient(145deg, var(--color-surface), var(--color-bg-secondary)); border:1px solid var(--color-border-light);">
          <div style="display:flex; gap:16px; align-items:center; margin-bottom:20px;">
            <div style="width:52px; height:52px; border-radius:16px; background:var(--color-primary-lighter); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('info', 28)}</div>
            <div>
              <div style="font-weight:900; font-size:17px; color:var(--color-text); margin-bottom:2px;">Comisión de Plataforma: ${commissionRate}%</div>
              <p style="font-size:13px; color:var(--color-text-secondary); line-height:1.4;">
                Se aplica únicamente sobre el total de productos vendidos.
              </p>
            </div>
          </div>
          
          <div style="background:rgba(255,255,255,0.03); padding:16px; border-radius:16px; border:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:12px; color:var(--color-text-tertiary); text-transform:uppercase; font-weight:700; letter-spacing:0.05em; margin-bottom:2px;">Pendiente de pago</div>
              <div style="font-family:var(--font-display); font-weight:900; font-size:24px; color:var(--color-primary);">${formatCurrency(pendingCommissions)}</div>
            </div>
            <a href="#/mi-comercio/${comercioId}/finances" style="width:44px; height:44px; border-radius:12px; background:var(--color-bg-secondary); color:var(--color-text); display:flex; align-items:center; justify-content:center; text-decoration:none; border:1px solid var(--color-border-light);">${icon('chevronRight', 20)}</a>
          </div>
        </div>
      </div>
    `;
  }
}

function playNotificationSound() {
  try {
    // High-quality notification sound from a reliable CDN
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
