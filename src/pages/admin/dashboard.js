import { db } from '../../firebase.js';
import { collection, getDocs, getCountFromServer, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { isAdmin } from '../../auth.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';

const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'on_way'];
const DONE_ORDER_STATUSES = ['delivered', 'completed'];

const tile = (href, ic, title, desc) => `
  <a href="${href}" class="go-admin-tile">
    <span class="go-admin-tile-icon">${icon(ic, 20)}</span>
    <strong>${title}</strong>
    <small>${desc}</small>
  </a>`;

const row = (href, ic, title, desc, badge = '') => `
  <a href="${href}" class="go-admin-row">
    <span class="go-admin-row-icon">${icon(ic, 18)}</span>
    <span class="go-admin-row-text"><strong>${title}</strong><small>${desc}</small></span>
    ${badge}
    <span class="go-admin-row-chev">${icon('chevronRight', 16)}</span>
  </a>`;

export async function renderAdminDashboard() {
  const content = document.getElementById('app-content');

  // We use a fixed container to ensure it covers everything and has no scroll leakage
  content.innerHTML = `
    <div class="panel-page go-admin" style="display:flex; flex-direction:column; height:100dvh; width:100%; position:fixed; top:0; left:0; z-index:1000; background:var(--color-bg); overflow:hidden;">

      <div class="go-page-header go-admin-header">
        <a href="#/profile" class="go-admin-back" aria-label="Volver">${icon('chevronLeft', 24)}</a>
        <div style="flex:1; min-width:0;">
          <h1>Administración</h1>
          <p>GO! Magdalena</p>
        </div>
      </div>

      <div class="go-admin-body">
        <div class="go-admin-inner">

          <div class="go-admin-now">
            <span class="go-eyebrow"><i class="go-admin-live"></i>Ahora</span>
            <div class="go-admin-now-grid">
              <a href="#/admin/orders"><strong id="admin-now-orders">–</strong><span>Pedidos en curso</span></a>
              <a href="#/admin/deliveries"><strong id="admin-now-drivers">–</strong><span>Cadetes conectados</span></a>
              <a href="#/admin/metrics"><strong id="admin-now-sales">–</strong><span id="admin-now-sales-label">Ventas de hoy</span></a>
            </div>
          </div>

          <div id="admin-pending" hidden>
            <h3 class="go-admin-heading">Para revisar</h3>
            <div class="go-admin-list" id="admin-pending-list"></div>
          </div>

          <h3 class="go-admin-heading">Operación</h3>
          <div class="go-admin-tiles">
            ${tile('#/admin/orders', 'shoppingBag', 'Ventas', 'Pedidos de la app y de WhatsApp')}
            ${tile('#/admin/deliveries', 'bike', 'Repartidores', 'Deudas, cuota diaria y liquidaciones')}
            ${tile('#/admin/comercios', 'store', 'Comercios', 'Locales, dueños y liquidaciones')}
            ${tile('#/admin/whatsapp-bot', 'whatsapp', 'Bot de WhatsApp', 'Mandados, pedidos y atención')}
          </div>

          <h3 class="go-admin-heading">Números</h3>
          <div class="go-admin-list">
            ${row('#/admin/metrics', 'trendingUp', 'Métricas', 'Rendimiento, ventas y usuarios activos')}
            ${row('#/admin/expenses', 'wallet', 'Gastos y contabilidad', 'Egresos y facturas')}
          </div>

          <h3 class="go-admin-heading">Promos y contenido</h3>
          <div class="go-admin-list">
            ${row('#/admin/ads', 'image', 'Anuncios y slider', 'Banners y destacados del inicio')}
            ${row('#/admin/offers', 'percent', 'Ofertas', 'Promociones y descuentos')}
            ${row('#/admin/coupons', 'tag', 'Cupones', 'Crear y gestionar cupones')}
            ${isAdmin() ? `
              ${row('#/admin/sorteos', 'gift', 'Sorteos', 'Crear y gestionar sorteos de premios')}
              ${row('#/admin/broadcasts', 'bell', 'Campañas push', 'Notificaciones a todos los usuarios')}
            ` : ''}
          </div>

          <h3 class="go-admin-heading">Configuración</h3>
          <div class="go-admin-list">
            ${row('#/admin/users', 'users', 'Usuarios', 'Roles y verificación', '<span class="go-admin-badge" id="admin-users-count-badge" hidden></span>')}
            ${row('#/admin/categories', 'folder', 'Categorías', 'Rubros de la plataforma')}
            ${row('#/admin/lugares', 'mapPin', 'Lugares de mandados', 'Dónde queda cada comercio que piden')}
            ${row('#/admin/reviews', 'star', 'Reseñas', 'Opiniones y puntuaciones')}
            ${row('#/admin/marketplace', 'shield', 'Marketplace', 'Revisar anuncios de compra y venta')}
            ${row('#/admin/errores', 'alertCircle', 'Errores y auditoría', 'Lo que falló en la app, el servidor y los datos', '<span class="go-admin-badge" id="admin-errors-count-badge" hidden></span>')}
            ${row('#/admin/reinicios', 'alertTriangle', 'Reinicios de la app', 'Cuándo y por qué la app se recargó sola')}
            ${isAdmin() ? row('#/admin/settings', 'settings', 'Ajustes del sistema', 'Tarifas y configuración global') : ''}
          </div>

        </div>
      </div>
    </div>
  `;

  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const unsubs = [];

  // Ahora: pedidos en curso y cadetes conectados, en vivo
  unsubs.push(onSnapshot(
    query(collection(db, 'orders'), where('status', 'in', ACTIVE_ORDER_STATUSES)),
    (snap) => setText('admin-now-orders', String(snap.size)),
    (err) => console.error('Error in admin orders listener:', err)
  ));
  unsubs.push(onSnapshot(
    query(collection(db, 'users'), where('role', '==', 'delivery'), where('isOnline', '==', true)),
    (snap) => setText('admin-now-drivers', String(snap.size)),
    (err) => console.error('Error in admin drivers listener:', err)
  ));

  // Ventas de hoy: pedidos entregados desde las 00:00
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  getDocs(query(collection(db, 'orders'), where('createdAt', '>=', Timestamp.fromDate(dayStart))))
    .then((snap) => {
      const done = snap.docs.map(d => d.data()).filter(o => DONE_ORDER_STATUSES.includes(o.status));
      setText('admin-now-sales', formatPrice(done.reduce((sum, o) => sum + (Number(o.total) || 0), 0)));
      setText('admin-now-sales-label', `Ventas de hoy · ${done.length} ${done.length === 1 ? 'entregado' : 'entregados'}`);
    })
    .catch((err) => console.error('Error loading today sales:', err));

  // Instant lightweight parallel load of stats & alerts
  try {
    const [
      usersCountSnap,
      pendingDeliverySnap,
      pendingComerciosSnap,
      pendingJobsSnap,
      openErrorsSnap
    ] = await Promise.all([
      getCountFromServer(collection(db, 'users')).catch(() => ({ data: () => ({ count: 0 }) })),
      getDocs(query(collection(db, 'users'), where('deliveryStatus', '==', 'pending'))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'comercios'), where('approvedByAdmin', '==', false))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'job_applications'), where('status', '==', 'pending'))).catch(() => ({ docs: [] })),
      getCountFromServer(query(collection(db, 'client_errors'), where('status', '==', 'open'), where('network', '==', false))).catch(() => ({ data: () => ({ count: 0 }) }))
    ]);

    const openErrors = openErrorsSnap.data().count;
    const errorsBadge = document.getElementById('admin-errors-count-badge');
    if (errorsBadge && openErrors > 0) {
      errorsBadge.textContent = `${openErrors}`;
      errorsBadge.hidden = false;
    }

    const usersCount = usersCountSnap.data().count;
    const countBadge = document.getElementById('admin-users-count-badge');
    if (countBadge && usersCount > 0) {
      countBadge.textContent = `${usersCount}`;
      countBadge.hidden = false;
    }

    const pending = [
      ['#/admin/users', 'bike', 'Solicitudes de repartidor', 'Usuarios esperando aprobación', (pendingDeliverySnap.docs || []).length],
      ['#/admin/solicitudes-empleo', 'briefcase', 'Postulaciones de empleo', 'Choferes y repartidores que se postularon', (pendingJobsSnap.docs || []).length],
      ['#/admin/solicitudes-comercios', 'store', 'Solicitudes de comercio', 'Comercios esperando aprobación', (pendingComerciosSnap.docs || []).length],
    ].filter(p => p[4] > 0);

    const pendingBox = document.getElementById('admin-pending');
    const pendingList = document.getElementById('admin-pending-list');
    if (pendingBox && pendingList && pending.length > 0) {
      pendingList.innerHTML = pending
        .map(([href, ic, title, desc, count]) => row(href, ic, title, desc, `<span class="go-admin-badge is-alert">${count}</span>`))
        .join('');
      pendingBox.hidden = false;
    }
  } catch (err) {
    console.error('Error loading admin stats:', err);
  }

  return { cleanup: () => unsubs.forEach(u => { try { u(); } catch (e) {} }) };
}
