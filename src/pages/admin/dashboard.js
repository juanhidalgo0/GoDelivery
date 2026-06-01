import { db } from '../../firebase.js';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { isAdmin, isSuperAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';
import { getState, setState } from '../../state.js';
import { showToast } from '../../components/toast.js';

export async function renderAdminDashboard() {
  const content = document.getElementById('app-content');

  // We use a fixed container to ensure it covers everything and has no scroll leakage
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; width:100%; position:fixed; top:0; left:0; z-index:1000; background:var(--color-bg); overflow:hidden;">
      
      <!-- Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/profile" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Administración</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Panel de Control Global</p>
        </div>
        <div style="width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,0.15); display:flex; align-items:center; justify-content:center; color:white; position:relative; z-index:2;">
          ${icon('shieldCheck', 20)}
        </div>
      </div>

      <!-- Main Body — Fills space symmetrically -->
      <div style="flex:1; display:flex; flex-direction:column; padding:20px; gap:20px; overflow-y:auto; -webkit-overflow-scrolling:touch;">
        
        <div id="pending-requests-alert"></div>

        <!-- Navigation Section -->
        <div style="flex:1; display:flex; flex-direction:column; gap:12px; justify-content:center; padding-bottom:20px;">
          <h3 style="font-size:11px; font-weight:900; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px; padding-left:4px;">Gestión del Ecosistema</h3>
          
          <div id="admin-menu" style="display:flex; flex-direction:column; gap:10px;">
            <a href="#/admin/metrics" class="admin-nav-card" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(126, 34, 206, 0.08)); border:1px solid rgba(168, 85, 247, 0.3); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s; box-shadow: 0 4px 15px rgba(168, 85, 247, 0.05); position: relative; overflow: hidden;">
              <div style="position: absolute; right: 0; bottom: 0; width: 60px; height: 60px; background: radial-gradient(circle, rgba(168, 85, 247, 0.15) 0%, transparent 70%); pointer-events: none;"></div>
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#c084fc,#a855f7); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px; box-shadow: 0 4px 10px rgba(168, 85, 247, 0.3); animation: pulse-purple 2s infinite;">${icon('trendingUp', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:900; font-size:16px; color:var(--color-primary);">Métricas y Analíticas</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:700;">Rendimiento, Ventas y DAU en vivo</div>
              </div>
              <div style="color:var(--color-primary-light);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/orders" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#ede9fe,#ddd6fe); color:#7c3aed; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('shoppingBag', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Pedidos</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Monitoreo en tiempo real</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/commissions" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#d1fae5,#a7f3d0); color:#059669; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('bank', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Economía</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Comisiones y liquidaciones</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/users" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#dbeafe,#bfdbfe); color:#2563eb; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('users', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text); display:flex; align-items:center; gap:8px;">
                  <span>Usuarios</span>
                  <span id="admin-users-count-badge" style="display:none; font-size:10px; font-weight:900; color:#2563eb; background:rgba(37,99,235,0.1); padding:2px 8px; border-radius:100px;">0</span>
                </div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;" id="admin-users-card-desc">Roles y verificación</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/comercios" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#fef3c7,#fde68a); color:#d97706; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('store', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Comercios</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Gestión de perfiles y catálogos</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/reviews" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#fef3c7,#f59e0b); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('star', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Reseñas y Puntuaciones</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Monitorear opiniones y valoraciones de usuarios</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/categories" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#f3f4f6,#d1d5db); color:#4b5563; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('folder', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Categorías</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Rubros de la plataforma</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/ads" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#fff1f2,#fecdd3); color:#e11d48; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('megaphone', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Anuncios</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Publicidad y destaques</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/offers" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#fce7f3,#fbcfe8); color:#db2777; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('percent', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Ofertas</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Promociones y descuentos</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            <a href="#/admin/coupons" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
              <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#ede9fe,#c084fc); color:#a855f7; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('tag', 24)}</div>
              <div style="flex:1;">
                <div style="font-weight:800; font-size:16px; color:var(--color-text);">Cupones</div>
                <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Generar y gestionar cupones</div>
              </div>
              <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
            </a>

            ${isAdmin() ? `
              <a href="#/admin/broadcasts" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
                <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#c084fc,#a855f7); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('bell', 24)}</div>
                <div style="flex:1;">
                  <div style="font-weight:800; font-size:16px; color:var(--color-text);">Campañas Push</div>
                  <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Notificaciones globales y analíticas</div>
                </div>
                <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
              </a>

              <a href="#/admin/settings" class="admin-nav-card" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:22px; padding:18px; display:flex; align-items:center; gap:16px; text-decoration:none; transition:all 0.2s;">
                <div style="width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#f3f4f6,#d1d5db); color:#4b5563; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:24px;">${icon('settings', 24)}</div>
                <div style="flex:1;">
                  <div style="font-weight:800; font-size:16px; color:var(--color-text);">Ajustes del Sistema</div>
                  <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600;">Tarifas y configuración global</div>
                </div>
                <div style="color:var(--color-border);">${icon('chevronRight', 20)}</div>
              </a>
            ` : ''}
          </div>
        </div>

        <!-- Professional Footer -->
        <div style="margin-top:auto; padding-top:20px; border-top:1px solid var(--color-border); text-align:center;">
          <p style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.1em; opacity:0.6;">GoDelivery Enterprise v2.4</p>
        </div>
      </div>
    </div>

    <style>
      .admin-nav-card:active { transform: scale(0.97); background: var(--color-bg-secondary); }
      .stat-card-premium { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 24px; padding: 16px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-xs); transition: all 0.2s; }
      .stat-card-premium:hover { border-color: var(--color-primary-light); box-shadow: var(--shadow-sm); }
    </style>
  `;

  // Load stats
  try {
    const usersSnap = await getDocs(collection(db, 'users'));

    const usersCount = usersSnap.size;
    const countBadge = document.getElementById('admin-users-count-badge');
    const usersDesc = document.getElementById('admin-users-card-desc');
    
    if (countBadge) {
      countBadge.textContent = `${usersCount}`;
      countBadge.style.display = 'inline-block';
    }
    if (usersDesc) {
      usersDesc.textContent = `Roles, verificación y ${usersCount} registrados`;
    }

    const pendingRequests = usersSnap.docs.filter(d => d.data().deliveryStatus === 'pending');
    const alertArea = document.getElementById('pending-requests-alert');
    if (pendingRequests.length > 0 && alertArea) {
      alertArea.innerHTML = `
        <a href="#/admin/users" style="display:flex; align-items:center; gap:14px; background:linear-gradient(135deg,var(--color-warning), #d97706); padding:16px; border-radius:20px; text-decoration:none; color:white; box-shadow:0 10px 20px rgba(245,158,11,0.25); margin-bottom:4px;">
          <div style="width:42px; height:42px; border-radius:14px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${icon('bike', 24)}
          </div>
          <div style="flex:1;">
            <div style="font-weight:900; font-size:15px; letter-spacing:-0.01em;">Solicitudes de Repartidor</div>
            <div style="font-size:12px; opacity:0.9; font-weight:600;">Hay ${pendingRequests.length} usuarios esperando aprobación</div>
          </div>
          ${icon('chevronRight', 20)}
        </a>
      `;
    }
  } catch (err) {
    console.error('Error loading admin stats:', err);
  }
}
