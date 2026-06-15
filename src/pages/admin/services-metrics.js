// GoDelivery — Admin Platform Services Metrics Page
import { db } from '../../firebase.js';
import { collection, query, getDocs } from 'firebase/firestore';
import { formatPrice } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';

export async function renderServicesMetrics() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; min-height:100dvh; background:var(--color-bg); padding-bottom:40px;">
      <!-- Red Premium Header -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.25); z-index:100;">
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        <button onclick="location.hash='#/admin/metrics'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Métricas de Go! Servicios</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Telemetría de Favores y Viajes</p>
        </div>
      </div>

      <div style="padding:20px; display:flex; flex-direction:column; gap:20px;" id="services-metrics-container">
        <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;

  try {
    const ordersSnap = await getDocs(collection(db, 'orders'));
    const orders = ordersSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAtDate: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date()
      };
    });

    const getServiceStats = (servOrders) => {
      const completed = servOrders.filter(o => o.status === 'completed');
      const cancelled = servOrders.filter(o => o.status === 'cancelled');
      const active = servOrders.filter(o => ['pending', 'confirmed', 'preparing', 'ready', 'delivering'].includes(o.status));
      const totalRevenue = completed.reduce((sum, o) => sum + (o.total || 0), 0);
      const avgTicket = completed.length > 0 ? (totalRevenue / completed.length) : 0;
      return {
        count: servOrders.length,
        completedCount: completed.length,
        cancelledCount: cancelled.length,
        activeCount: active.length,
        revenue: totalRevenue,
        avg: avgTicket
      };
    };

    const encomiendaStats = getServiceStats(orders.filter(o => o.isFavor === true && o.favorType === 'mandado'));
    const compraStats = getServiceStats(orders.filter(o => o.isFavor === true && o.favorType === 'compra'));
    const cashStats = getServiceStats(orders.filter(o => o.isFavor === true && o.favorType === 'gocash'));
    const viajeStats = getServiceStats(orders.filter(o => o.isTrip === true));

    const container = document.getElementById('services-metrics-container');
    container.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr; gap:20px; max-width:600px; margin:0 auto; width:100%;">
        
        <!-- Encomienda Panel -->
        <div style="background:linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02)); border:1.5px solid rgba(34,197,94,0.2); border-radius:24px; padding:20px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:900; color:#16a34a; text-transform:uppercase; letter-spacing:0.03em; display:flex; align-items:center; gap:6px;">
              🛵 Go Favor: Encomienda
            </span>
            <span style="font-size:11px; font-weight:800; background:rgba(34,197,94,0.15); color:#16a34a; padding:4px 10px; border-radius:8px;">${encomiendaStats.completedCount} completados</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ingresos Totales</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(encomiendaStats.revenue)}</div>
            </div>
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ticket Promedio</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(encomiendaStats.avg)}</div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px solid rgba(34,197,94,0.1); font-size:12px; font-weight:700; color:var(--color-text-secondary);">
            <span>Activos: <strong style="color:var(--color-primary);">${encomiendaStats.activeCount}</strong></span>
            <span>Cancelados: <strong style="color:#ef4444">${encomiendaStats.cancelledCount}</strong></span>
          </div>
        </div>

        <!-- Compra Panel -->
        <div style="background:linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02)); border:1.5px solid rgba(239,68,68,0.2); border-radius:24px; padding:20px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:900; color:#dc2626; text-transform:uppercase; letter-spacing:0.03em; display:flex; align-items:center; gap:6px;">
              🛒 Go Favor: Compra
            </span>
            <span style="font-size:11px; font-weight:800; background:rgba(239,68,68,0.15); color:#dc2626; padding:4px 10px; border-radius:8px;">${compraStats.completedCount} completados</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ingresos Totales</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(compraStats.revenue)}</div>
            </div>
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ticket Promedio</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(compraStats.avg)}</div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px solid rgba(239,68,68,0.1); font-size:12px; font-weight:700; color:var(--color-text-secondary);">
            <span>Activos: <strong style="color:var(--color-primary);">${compraStats.activeCount}</strong></span>
            <span>Cancelados: <strong style="color:#ef4444">${compraStats.cancelledCount}</strong></span>
          </div>
        </div>

        <!-- Cash Panel -->
        <div style="background:linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02)); border:1.5px solid rgba(99,102,241,0.2); border-radius:24px; padding:20px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:900; color:#4f46e5; text-transform:uppercase; letter-spacing:0.03em; display:flex; align-items:center; gap:6px;">
              💵 Go Favor: Cash
            </span>
            <span style="font-size:11px; font-weight:800; background:rgba(99,102,241,0.15); color:#4f46e5; padding:4px 10px; border-radius:8px;">${cashStats.completedCount} completados</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ingresos Totales</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(cashStats.revenue)}</div>
            </div>
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ticket Promedio</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(cashStats.avg)}</div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px solid rgba(99,102,241,0.1); font-size:12px; font-weight:700; color:var(--color-text-secondary);">
            <span>Activos: <strong style="color:var(--color-primary);">${cashStats.activeCount}</strong></span>
            <span>Cancelados: <strong style="color:#ef4444">${cashStats.cancelledCount}</strong></span>
          </div>
        </div>

        <!-- Viajes Panel -->
        <div style="background:linear-gradient(135deg, rgba(234,179,8,0.08), rgba(234,179,8,0.02)); border:1.5px solid rgba(234,179,8,0.2); border-radius:24px; padding:20px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:900; color:#ca8a04; text-transform:uppercase; letter-spacing:0.03em; display:flex; align-items:center; gap:6px;">
              🚕 Go Viajes
            </span>
            <span style="font-size:11px; font-weight:800; background:rgba(234,179,8,0.15); color:#ca8a04; padding:4px 10px; border-radius:8px;">${viajeStats.completedCount} completados</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ingresos Totales</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(viajeStats.revenue)}</div>
            </div>
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.02em;">Ticket Promedio</div>
              <div style="font-family:var(--font-display); font-size:24px; font-weight:950; color:var(--color-text-primary); margin-top:2px;">${formatPrice(viajeStats.avg)}</div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px solid rgba(234,179,8,0.1); font-size:12px; font-weight:700; color:var(--color-text-secondary);">
            <span>Activos: <strong style="color:var(--color-primary);">${viajeStats.activeCount}</strong></span>
            <span>Cancelados: <strong style="color:#ef4444">${viajeStats.cancelledCount}</strong></span>
          </div>
        </div>

      </div>
    `;
  } catch (err) {
    console.error('Error compiled services metrics:', err);
  }
}
