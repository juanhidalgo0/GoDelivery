// GoDelivery — Comercio Panel Dashboard
import { db } from '../../firebase.js';
import { doc, onSnapshot, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { icon } from '../../utils/icons.js';
import { isAdmin } from '../../auth.js';

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
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;background:var(--color-bg);">
      <!-- Premium Fixed Header -->
      <div style="width:100%; padding-top: ${topPadding}; background: var(--color-primary); position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <div style="display:flex;align-items:center;gap:12px;padding: 12px 16px 20px 16px; position:relative;overflow:hidden;color:white;">
          <!-- Decorative Circles -->
          <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
          
          <a href="#/mi-comercio/${comercioId}/orders" style="display:flex;align-items:center;justify-content:center;background:none;color:white;border:none;cursor:pointer;padding:0;text-decoration:none;position:relative;z-index:2;">${icon('chevronLeft', 28)}</a>
        <div style="flex:1;min-width:0;">
          <h1 style="font-family:var(--font-display);font-weight:800;font-size:20px;color:inherit;margin:0;line-height:1.2;letter-spacing:-0.02em;">${isAdmin() ? 'Adm: Panel de Gestión' : 'Panel de Gestión'}</h1>
          <p id="panel-commerce-name" style="font-size:10px;color:rgba(255,255,255,0.85);font-weight:700;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Cargando...</p>
        </div>
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

          <a href="#/mi-comercio/${comercioId}/products" class="admin-menu-item">
            <div class="admin-menu-icon">${icon('package', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Productos</div>
              <div class="admin-menu-desc">Agregar y gestionar productos</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>

          <a href="#/mi-comercio/${comercioId}/sabores" class="admin-menu-item">
            <div class="admin-menu-icon" style="background:rgba(236, 72, 153, 0.1); color:#ec4899;">${icon('sparkles', 24)}</div>
            <div class="admin-menu-text">
              <div class="admin-menu-title">Gestor de Sabores</div>
              <div class="admin-menu-desc">Activar/desactivar sabores de helado</div>
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
              <div class="admin-menu-title">Ventas y Dashboard</div>
              <div class="admin-menu-desc">Ventas (Hoy/Semana/Mes), stock, productos y clientes fieles</div>
            </div>
            <span style="color:var(--color-text-tertiary);">${icon('chevronRight', 18)}</span>
          </a>
        </div>
        
        <div id="finances-summary-container" style="margin-top:16px;"></div>
      </div>
    </div>
  `;

  let commerceData = null;
  let isInitialLoad = true;
  let q;

  const handleSnapshot = (snap) => {
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
      if (nameContainer) nameContainer.textContent = isAdmin() ? `Adm: ${commerceData.name}` : commerceData.name;
      
      // Update Gestor de Sabores link text based on commerce category
      const flavorsLink = document.querySelector(`a[href="#/mi-comercio/${comercioId}/sabores"]`);
      if (flavorsLink) {
        const isHeladeria = (commerceData.category || '').toLowerCase().includes('helad');
        if (isHeladeria) {
          flavorsLink.querySelector('.admin-menu-icon').innerHTML = icon('sparkles', 24);
          flavorsLink.querySelector('.admin-menu-title').textContent = 'Gestor de Sabores';
          flavorsLink.querySelector('.admin-menu-desc').textContent = 'Activar/desactivar sabores de helado';
        } else {
          const iconContainer = flavorsLink.querySelector('.admin-menu-icon');
          if (iconContainer) {
            iconContainer.style.background = 'rgba(249, 115, 22, 0.1)';
            iconContainer.style.color = '#f97316';
            iconContainer.innerHTML = icon('list', 24);
          }
          flavorsLink.querySelector('.admin-menu-title').textContent = 'Gustos y Variedades';
          flavorsLink.querySelector('.admin-menu-desc').textContent = 'Activar/desactivar gustos de empanadas, pizzas y comida';
        }
      }

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
      <div class="profile-section page-enter" style="margin-top: 16px;">
        <div class="admin-card" style="padding: 16px 18px; background:linear-gradient(145deg, var(--color-surface), var(--color-bg-secondary)); border:1px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; gap:14px; min-width:0;">
            <div style="width:44px; height:44px; border-radius:12px; background:var(--color-primary-lighter); color:var(--color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${icon('info', 22)}</div>
            <div style="min-width:0; text-align:left;">
              <div style="font-size:10px; color:var(--color-text-tertiary); text-transform:uppercase; font-weight:700; letter-spacing:0.05em; margin-bottom:1px;">Comisión (${commissionRate}%) • Pendiente</div>
              <div style="font-family:var(--font-display); font-weight:900; font-size:21px; color:var(--color-primary); line-height:1.1;">${formatCurrency(pendingCommissions)}</div>
            </div>
          </div>
          <a href="#/mi-comercio/${comercioId}/finances" style="width:42px; height:42px; border-radius:12px; background:var(--color-bg-secondary); color:var(--color-text); display:flex; align-items:center; justify-content:center; text-decoration:none; border:1px solid var(--color-border-light); flex-shrink:0;">${icon('chevronRight', 20)}</a>
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
