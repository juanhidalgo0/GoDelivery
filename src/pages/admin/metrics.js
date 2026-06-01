import { db } from '../../firebase.js';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { formatPrice } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { getLocalDateString } from '../../utils/analytics.js';

let ordersData = [];
let visitsData = [];
let isDemoMode = false;

export async function renderAdminMetrics() {
  const content = document.getElementById('app-content');

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; min-height:100dvh; background:var(--color-bg); overflow-x:hidden; padding-bottom:40px;">
      
      <!-- Premium Header (Integrated) -->
      <div style="background:var(--color-primary); padding:16px 20px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(168, 85, 247,0.25); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Métricas y Analíticas</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;" id="metrics-status-subtitle">AUDITORÍA Y TELEMETRÍA EN VIVO</p>
        </div>
        <button id="refresh-metrics-btn" style="background:rgba(255,255,255,0.15); border:none; width:40px; height:40px; border-radius:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; transition:all 0.2s; position:relative; z-index:2;">
          ${icon('history', 22)}
        </button>
      </div>

      <!-- Demo Notification Bar (Panel A: Inactive but Empty Database) -->
      <div id="demo-inactive-badge" style="display:none; background:linear-gradient(135deg, #1f2937, #111827); border-bottom:1px solid var(--color-border); color:white; padding:12px 20px; font-size:12px; font-weight:800; align-items:center; justify-content:space-between; gap:12px; z-index: 10; flex-wrap:wrap;">
        <span style="display:inline-flex; align-items:center; gap:8px;">
          ${icon('info', 18)} 
          <span>Base de datos vacía. Activa la simulación para visualizar gráficos y KPIs de prueba.</span>
        </span>
        <button id="activate-demo-btn" style="background:#a855f7; border:none; padding:6px 14px; border-radius:10px; color:white; font-size:11px; font-weight:900; cursor:pointer; box-shadow:0 2px 8px rgba(168,85,247,0.4); display:flex; align-items:center; gap:4px; transition:all 0.2s;">
          ${icon('trendingUp', 12)} Activar Simulación
        </button>
      </div>

      <!-- Demo Notification Bar (Panel B: Active Simulation) -->
      <div id="demo-active-badge" style="display:none; background:linear-gradient(135deg, #a855f7, #7e22ce); color:white; padding:12px 20px; font-size:12px; font-weight:800; align-items:center; justify-content:space-between; gap:12px; box-shadow: 0 4px 10px rgba(168,85,247,0.15); z-index: 10; flex-wrap:wrap;">
        <span style="display:inline-flex; align-items:center; gap:8px;">
          ${icon('checkCircle', 18)} 
          <span><strong>Modo Simulación Activo:</strong> Mostrando analíticas simuladas del último mes en Magdalena.</span>
        </span>
        <button id="deactivate-demo-btn" style="background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4); padding:6px 14px; border-radius:10px; color:white; font-size:11px; font-weight:900; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;">
          ${icon('xCircle', 12)} Desactivar
        </button>
      </div>

      <!-- Filters Row -->
      <div style="padding:16px 20px; display:flex; justify-content:space-between; align-items:center; gap:12px; overflow-x:auto; flex-wrap:wrap; background:var(--color-surface); border-bottom:1px solid var(--color-border); flex-shrink:0;">
        <div style="display:flex; gap:8px;" id="metrics-time-filters">
          <button class="m-filter-btn active" data-range="today">Hoy</button>
          <button class="m-filter-btn" data-range="7days">7 Días</button>
          <button class="m-filter-btn" data-range="30days">30 Días</button>
          <button class="m-filter-btn" data-range="all">Histórico</button>
        </div>
        <div id="selected-range-label" style="font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">
          Cargando rango...
        </div>
      </div>

      <!-- Dashboard Grid -->
      <div style="flex:1; display:flex; flex-direction:column; padding:20px; gap:20px;" id="metrics-main-container">
        
        <!-- Skeletons Loader -->
        <div id="metrics-loader" style="text-align:center; padding:100px 20px;">
          <div class="loader-dots"><span></span><span></span><span></span></div>
          <p style="font-size:12px; color:var(--color-text-tertiary); margin-top:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">Sincronizando Estación de Analíticas...</p>
        </div>

        <div id="metrics-content-grid" style="display:none; flex-direction:column; gap:24px;">
          
          <!-- KPI Stats Grid -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:16px;">
            
            <div class="kpi-card page-enter stagger-1">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="kpi-title">Ventas Brutas</span>
                <div class="kpi-icon-wrapper purple">${icon('shoppingBag', 18)}</div>
              </div>
              <div class="kpi-value" id="kpi-gross-revenue">$0</div>
              <div class="kpi-footer text-purple" id="kpi-revenue-trend">+0% vs ant.</div>
            </div>

            <div class="kpi-card page-enter stagger-2">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="kpi-title">Órdenes Éxito</span>
                <div class="kpi-icon-wrapper green">${icon('checkCircle', 18)}</div>
              </div>
              <div class="kpi-value" id="kpi-confirmed-orders">0</div>
              <div class="kpi-footer text-green" id="kpi-orders-trend">0 entregadas</div>
            </div>

            <div class="kpi-card page-enter stagger-3">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="kpi-title">Órdenes Bajas</span>
                <div class="kpi-icon-wrapper red">${icon('xCircle', 18)}</div>
              </div>
              <div class="kpi-value" id="kpi-cancelled-orders">0</div>
              <div class="kpi-footer text-red" id="kpi-cancelled-ratio">0% tasa de cancelación</div>
            </div>

            <div class="kpi-card page-enter stagger-4">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="kpi-title">Visitas Únicas (DAU)</span>
                <div class="kpi-icon-wrapper blue">${icon('users', 18)}</div>
              </div>
              <div class="kpi-value" id="kpi-dau">0</div>
              <div class="kpi-footer text-blue" id="kpi-dau-trend">Deduplicado en vivo</div>
            </div>

            <div class="kpi-card page-enter stagger-5">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="kpi-title">Conversión</span>
                <div class="kpi-icon-wrapper yellow">${icon('trendingUp', 18)}</div>
              </div>
              <div class="kpi-value" id="kpi-conversion">0%</div>
              <div class="kpi-footer text-yellow" id="kpi-ticket-avg">Tique Prom: $0</div>
            </div>

          </div>

          <!-- Platform Economy Breakdown -->
          <div class="metrics-section-card page-enter stagger-6">
            <h3 class="section-card-title">Desglose Financiero & Absorciones (GoDelivery)</h3>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-top:16px;">
              
              <div class="fin-subcard">
                <div class="fin-subcard-header">
                  <span>Comisión Comercios</span>
                  <strong id="fin-total-comisiones">$0</strong>
                </div>
                <div class="progress-bar-container"><div class="progress-bar purple" style="width: 100%"></div></div>
                <span class="fin-subcard-desc">Ingreso bruto facturado a tiendas</span>
              </div>

              <div class="fin-subcard">
                <div class="fin-subcard-header">
                  <span>Tarifas de Servicio</span>
                  <strong id="fin-total-fees">$0</strong>
                </div>
                <div class="progress-bar-container"><div class="progress-bar blue" style="width: 100%"></div></div>
                <span class="fin-subcard-desc">Cargos por uso de aplicación</span>
              </div>

              <div class="fin-subcard red-border">
                <div class="fin-subcard-header text-red">
                  <span>Absorción de Cupones</span>
                  <strong id="fin-total-coupons">$0</strong>
                </div>
                <div class="progress-bar-container"><div class="progress-bar red" id="fin-coupons-progress" style="width: 0%"></div></div>
                <span class="fin-subcard-desc">Monto total descontado al delivery</span>
              </div>

              <div class="fin-subcard green-border">
                <div class="fin-subcard-header text-green">
                  <span>Ganancia Neta</span>
                  <strong id="fin-net-profit" style="font-size: 20px;">$0</strong>
                </div>
                <div class="progress-bar-container"><div class="progress-bar green" style="width: 100%"></div></div>
                <span class="fin-subcard-desc">Comisiones + Tarifas - Cupones</span>
              </div>

            </div>
          </div>

          <!-- Charts Section -->
          <div style="display:grid; grid-template-columns: 1fr; gap:20px; min-height:450px;">
            
            <!-- Revenue Trend Chart -->
            <div class="metrics-section-card page-enter stagger-7" style="display:flex; flex-direction:column; flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
                <h3 class="section-card-title" style="margin:0;">Tendencia de Facturación Diaria</h3>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:11px; font-weight:800; color:#a855f7; background:rgba(168,85,247,0.1); padding:4px 10px; border-radius:10px;">HISTORIAL DE RECAUDACIÓN</span>
                  <button class="zoom-chart-btn" data-chart="revenue" style="background:var(--color-bg-secondary); border:1px solid var(--color-border); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text-secondary); transition:all 0.2s; padding:0;" title="Ampliar Gráfico">
                    ${icon('maximize', 14)}
                  </button>
                </div>
              </div>
              <div style="flex:1; position:relative; min-height:350px;" id="revenue-chart-container">
                <!-- SVG Line Chart will be injected here -->
              </div>
            </div>

            <!-- Conversion and DAU Chart -->
            <div class="metrics-section-card page-enter stagger-8" style="display:flex; flex-direction:column; flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
                <h3 class="section-card-title" style="margin:0;">Visitas Únicas vs Pedidos Completados</h3>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:11px; font-weight:800; color:#3b82f6; background:rgba(59,130,246,0.1); padding:4px 10px; border-radius:10px;">CONVERSIÓN DIARIA</span>
                  <button class="zoom-chart-btn" data-chart="dau" style="background:var(--color-bg-secondary); border:1px solid var(--color-border); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text-secondary); transition:all 0.2s; padding:0;" title="Ampliar Gráfico">
                    ${icon('maximize', 14)}
                  </button>
                </div>
              </div>
              <div style="flex:1; position:relative; min-height:350px;" id="dau-chart-container">
                <!-- SVG Grouped Bar Chart will be injected here -->
              </div>
            </div>

            <!-- Order Status Distribution -->
            <div class="metrics-section-card page-enter stagger-9" style="display:flex; flex-direction:column; flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
                <h3 class="section-card-title" style="margin:0;">Distribución del Estado de Órdenes</h3>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:11px; font-weight:800; color:#10b981; background:rgba(16,185,129,0.1); padding:4px 10px; border-radius:10px;">DESGLOSE PORCENTUAL</span>
                  <button class="zoom-chart-btn" data-chart="status" style="background:var(--color-bg-secondary); border:1px solid var(--color-border); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text-secondary); transition:all 0.2s; padding:0;" title="Ampliar Gráfico">
                    ${icon('maximize', 14)}
                  </button>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; md-flex-direction:row; align-items:center; justify-content:center; gap:32px; flex:1; min-height:280px;">
                <div style="width:240px; height:240px; position:relative;" id="donut-chart-container">
                  <!-- SVG Donut Chart will be injected here -->
                </div>
                <div style="display:flex; flex-direction:column; gap:12px;" id="donut-legends-container">
                  <!-- Donut Legends will be injected here -->
                </div>
              </div>
            </div>

          </div>

          <!-- Top Performers & Coupons rankings -->
          <div style="display:flex; flex-direction:column; gap:20px;">
            
            <!-- Top Comercios -->
            <div class="metrics-section-card page-enter stagger-10">
              <h3 class="section-card-title">Ranking de Comercios (Top Facturación)</h3>
              <div style="overflow-x:auto; margin-top:12px;">
                <table class="metrics-table">
                  <thead>
                    <tr>
                      <th>Comercio</th>
                      <th style="text-align:center;">Pedidos</th>
                      <th style="text-align:right;">Facturado</th>
                      <th style="text-align:right;">Comisiones</th>
                    </tr>
                  </thead>
                  <tbody id="table-top-comercios">
                    <tr><td colspan="4" style="text-align:center; color:var(--color-text-tertiary);">Sin registros</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Top Drivers -->
            <div class="metrics-section-card page-enter stagger-11">
              <h3 class="section-card-title">Ranking de Repartidores (Entregas Completadas)</h3>
              <div style="overflow-x:auto; margin-top:12px;">
                <table class="metrics-table">
                  <thead>
                    <tr>
                      <th>Repartidor</th>
                      <th style="text-align:center;">Envíos Éxito</th>
                      <th style="text-align:right;">Deuda Compensada</th>
                      <th style="text-align:right;">Envío Ganado</th>
                    </tr>
                  </thead>
                  <tbody id="table-top-repartidores">
                    <tr><td colspan="4" style="text-align:center; color:var(--color-text-tertiary);">Sin registros</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Top Coupons usage -->
            <div class="metrics-section-card page-enter stagger-12">
              <h3 class="section-card-title">Uso de Cupones y Absorción Platform</h3>
              <div style="overflow-x:auto; margin-top:12px;">
                <table class="metrics-table">
                  <thead>
                    <tr>
                      <th>Cupón</th>
                      <th style="text-align:center;">Canjes</th>
                      <th style="text-align:right;">Total Descontado</th>
                      <th style="text-align:center;">Tasa Éxito</th>
                    </tr>
                  </thead>
                  <tbody id="table-top-coupons">
                    <tr><td colspan="4" style="text-align:center; color:var(--color-text-tertiary);">Sin registros</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>

    <!-- Styles -->
    <style>
      .m-filter-btn {
        padding: 8px 16px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        font-size: 13px;
        font-weight: 800;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .m-filter-btn.active {
        background: #a855f7;
        color: white;
        border-color: transparent;
        box-shadow: 0 4px 10px rgba(168, 85, 247, 0.25);
      }
      
      .kpi-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        padding: 16px;
        box-shadow: var(--shadow-sm);
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .kpi-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: rgba(168, 85, 247, 0.2);
      }
      .kpi-title {
        font-size: 11px;
        font-weight: 800;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .kpi-value {
        font-size: 24px;
        font-weight: 900;
        color: var(--color-text);
        letter-spacing: -0.03em;
        margin: 2px 0;
      }
      .kpi-footer {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      
      .kpi-icon-wrapper {
        width: 32px;
        height: 32px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .kpi-icon-wrapper.purple { background: rgba(168, 85, 247, 0.1); color: #a855f7; }
      .kpi-icon-wrapper.green { background: rgba(16, 185, 129, 0.1); color: #10b981; }
      .kpi-icon-wrapper.red { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
      .kpi-icon-wrapper.blue { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
      .kpi-icon-wrapper.yellow { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
      
      .text-purple { color: #a855f7; }
      .text-green { color: #10b981; }
      .text-red { color: #ef4444; }
      .text-blue { color: #3b82f6; }
      .text-yellow { color: #f59e0b; }
      
      .metrics-section-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 24px;
        padding: 20px;
        box-shadow: var(--shadow-sm);
      }
      
      .section-card-title {
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 900;
        color: var(--color-text);
        margin: 0 0 16px;
        letter-spacing: -0.02em;
      }
      
      .fin-subcard {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 16px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .fin-subcard.red-border { border-color: rgba(239, 68, 68, 0.2); }
      .fin-subcard.green-border { border-color: rgba(16, 185, 129, 0.2); }
      
      .fin-subcard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        font-weight: 800;
        color: var(--color-text-secondary);
      }
      .fin-subcard-header strong {
        font-size: 16px;
        font-weight: 900;
        color: var(--color-text);
      }
      .fin-subcard-desc {
        font-size: 10px;
        font-weight: 700;
        color: var(--color-text-tertiary);
      }
      
      .progress-bar-container {
        width: 100%;
        height: 6px;
        background: var(--color-border-light);
        border-radius: 3px;
        overflow: hidden;
        margin: 2px 0;
      }
      .progress-bar {
        height: 100%;
        border-radius: 3px;
      }
      .progress-bar.purple { background: #a855f7; }
      .progress-bar.blue { background: #3b82f6; }
      .progress-bar.red { background: #ef4444; }
      .progress-bar.green { background: #10b981; }
      
      .metrics-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .metrics-table th {
        text-align: left;
        padding: 10px 12px;
        font-size: 10px;
        font-weight: 900;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 2px solid var(--color-border);
      }
      .metrics-table td {
        padding: 12px;
        font-weight: 700;
        color: var(--color-text);
        border-bottom: 1px solid var(--color-border-light);
      }
      .metrics-table tr:last-child td {
        border-bottom: none;
      }
      
      /* Chart Tooltips */
      .chart-tooltip {
        position: absolute;
        background: rgba(17, 24, 39, 0.95);
        color: white;
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 800;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
        z-index: 100;
      }
    </style>
  `;

  // Register event listeners
  document.getElementById('refresh-metrics-btn')?.addEventListener('click', () => loadData(true));
  
  document.querySelectorAll('.m-filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.m-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const range = btn.dataset.range;
      updateRangeDisplay(range);
    };
  });

  document.getElementById('activate-demo-btn')?.addEventListener('click', () => {
    generateMockAnalyticsData();
    isDemoMode = true;
    const activeFilter = document.querySelector('.m-filter-btn.active')?.dataset.range || 'today';
    const inactiveBadge = document.getElementById('demo-inactive-badge');
    const activeBadge = document.getElementById('demo-active-badge');
    const subtitle = document.getElementById('metrics-status-subtitle');
    if (inactiveBadge) inactiveBadge.style.display = 'none';
    if (activeBadge) activeBadge.style.display = 'flex';
    if (subtitle) subtitle.innerHTML = `MODO SIMULACIÓN DE TELEMETRÍA`;
    updateRangeDisplay(activeFilter);
  });

  document.getElementById('deactivate-demo-btn')?.addEventListener('click', async () => {
    isDemoMode = false;
    await loadData(true);
  });

  document.querySelectorAll('.zoom-chart-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const chartType = btn.dataset.chart;
      zoomChart(chartType);
    };
  });

  // Load initial data
  await loadData();
}

function updateRangeDisplay(range) {
  const label = document.getElementById('selected-range-label');
  if (!label) return;

  let text = '';
  const todayStr = getLocalDateString();

  if (range === 'today') {
    text = `Hoy: ${todayStr}`;
  } else if (range === '7days') {
    const past7 = new Date();
    past7.setDate(past7.getDate() - 6);
    text = `Rango: ${getLocalDateString(past7)} al ${todayStr}`;
  } else if (range === '30days') {
    const past30 = new Date();
    past30.setDate(past30.getDate() - 29);
    text = `Rango: ${getLocalDateString(past30)} al ${todayStr}`;
  } else {
    text = 'Histórico completo de la app';
  }

  label.textContent = text;
  calculateAndRender(range);
}

async function loadData(forceRefresh = false) {
  const loader = document.getElementById('metrics-loader');
  const contentGrid = document.getElementById('metrics-content-grid');
  
  if (loader) loader.style.display = 'block';
  if (contentGrid) contentGrid.style.display = 'none';

  try {
    if (!isDemoMode && (ordersData.length === 0 || forceRefresh)) {
      // Fetch real documents from Firestore
      const [ordersSnap, visitsSnap] = await Promise.all([
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'visits'))
      ]);

      ordersData = [];
      visitsData = [];

      ordersSnap.forEach(doc => {
        try {
          const d = doc.data();
          const createdAt = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt || Date.now());
          ordersData.push({ id: doc.id, ...d, createdAt });
        } catch (e) {}
      });

      visitsSnap.forEach(doc => {
        try {
          const d = doc.data();
          const timestamp = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp || Date.now());
          visitsData.push({ id: doc.id, ...d, timestamp });
        } catch (e) {}
      });
    }

    // Toggle banners based on simulation status and presence of data
    const inactiveBadge = document.getElementById('demo-inactive-badge');
    const activeBadge = document.getElementById('demo-active-badge');
    const subtitle = document.getElementById('metrics-status-subtitle');

    if (isDemoMode) {
      if (inactiveBadge) inactiveBadge.style.display = 'none';
      if (activeBadge) activeBadge.style.display = 'flex';
      if (subtitle) subtitle.innerHTML = `MODO SIMULACIÓN DE TELEMETRÍA`;
    } else {
      if (ordersData.length === 0) {
        if (inactiveBadge) inactiveBadge.style.display = 'flex';
        if (activeBadge) activeBadge.style.display = 'none';
        if (subtitle) subtitle.innerHTML = `BASE DE DATOS EN BLANCO`;
      } else {
        if (inactiveBadge) inactiveBadge.style.display = 'none';
        if (activeBadge) activeBadge.style.display = 'none';
        if (subtitle) subtitle.innerHTML = `AUDITORÍA Y TELEMETRÍA EN VIVO`;
      }
    }

    if (loader) loader.style.display = 'none';
    if (contentGrid) contentGrid.style.display = 'flex';

    // Trigger initial calculation
    const activeFilter = document.querySelector('.m-filter-btn.active')?.dataset.range || 'today';
    updateRangeDisplay(activeFilter);

  } catch (err) {
    console.error('Failed to load metrics data:', err);
    const container = document.getElementById('metrics-main-container');
    if (container) {
      container.innerHTML = `
        <div style="text-align:center; padding:50px 20px; color:var(--color-text-tertiary);">
          ${icon('alertTriangle', 48)}
          <p style="font-weight:900; font-size:16px; margin-top:16px; color:var(--color-text);">Error de Sincronización</p>
          <p style="font-size:12px; margin-bottom:16px;">No se pudo conectar a la base de datos de auditoría de Magdalena.</p>
          <button class="m-filter-btn active" onclick="window.location.reload()">Reintentar Conexión</button>
        </div>
      `;
    }
  }
}

/**
 * Robust mock data generator mimicking beautiful historical trends in Magdalena
 */
function generateMockAnalyticsData() {
  ordersData = [];
  visitsData = [];
  
  const today = new Date();
  
  const stores = ['Go! Market', 'Burger Magdalena', 'Pizzería Don Corleone', 'Helados Rívoli', 'Empanadas El Fortín'];
  const drivers = ['Carlos Gómez', 'Facundo Díaz', 'Lautaro Rodríguez', 'Mateo Sosa', 'Bautista Pérez'];
  const coupons = ['BIENVENIDA', 'ENVIOGRATIS', 'PROMO15', 'MAGDALENA10'];

  // Generate 30 days of data
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = getLocalDateString(date);

    // Number of daily unique visitors (DAU): ranges between 40 and 150, trending upwards
    const baseVisitors = 50 + (29 - i) * 3 + Math.floor(Math.random() * 25);
    for (let v = 0; v < baseVisitors; v++) {
      visitsData.push({
        id: `mock_visit_${dateStr}_${v}`,
        userId: `user_${Math.floor(Math.random() * 120)}`,
        date: dateStr,
        timestamp: new Date(date.getTime() + Math.random() * 86400000)
      });
    }

    // Number of daily completed/cancelled orders: conversion rate is around 15-25%
    const conversionRate = 0.16 + (Math.random() * 0.08);
    const orderCount = Math.floor(baseVisitors * conversionRate);
    
    for (let o = 0; o < orderCount; o++) {
      const isCompleted = Math.random() > 0.08; // 8% cancellation rate
      const storeName = stores[Math.floor(Math.random() * stores.length)];
      const driverName = drivers[Math.floor(Math.random() * drivers.length)];
      
      const itemsPrice = 2000 + Math.floor(Math.random() * 4000);
      const deliveryCost = Math.random() > 0.4 ? 1720 : 0; // standard delivery fee or 0
      const appUsageFee = 350;
      
      // Coupon applied? 30% probability
      const hasCoupon = Math.random() < 0.3;
      const couponCode = hasCoupon ? coupons[Math.floor(Math.random() * coupons.length)] : null;
      let couponDiscount = 0;
      if (couponCode) {
        if (couponCode === 'ENVIOGRATIS') couponDiscount = 1720;
        else if (couponCode === 'BIENVENIDA') couponDiscount = 1000;
        else if (couponCode === 'PROMO15') couponDiscount = Math.floor(itemsPrice * 0.15);
        else couponDiscount = 500;
      }

      const total = itemsPrice + deliveryCost + appUsageFee - couponDiscount;
      const status = isCompleted ? 'completed' : 'cancelled';
      
      // Calculate financial commission (e.g. 10%)
      const commissionAmount = Math.floor(itemsPrice * 0.10);

      ordersData.push({
        id: `mock_order_${dateStr}_${o}`,
        orderId: 1000 + ordersData.length,
        comercioName: storeName,
        driverName: status === 'completed' ? driverName : null,
        driverId: status === 'completed' ? `driver_${Math.floor(Math.random()*5)}` : null,
        userName: `Cliente ${Math.floor(Math.random() * 80)}`,
        userId: `user_${Math.floor(Math.random() * 120)}`,
        status,
        itemsPrice,
        deliveryCost,
        appUsageFee,
        couponCode,
        couponDiscount,
        total,
        commissionAmount,
        createdAt: new Date(date.getTime() + Math.random() * 86400000)
      });
    }
  }
}

/**
 * Core mathematical engine for aggregating telemetry data by date ranges
 */
function calculateAndRender(range) {
  const now = new Date();
  let filteredOrders = [];
  let filteredVisits = [];
  
  let previousOrders = []; // To calculate trend differentials
  
  const todayStr = getLocalDateString(now);

  if (range === 'today') {
    filteredOrders = ordersData.filter(o => getLocalDateString(o.createdAt) === todayStr);
    filteredVisits = visitsData.filter(v => getLocalDateString(v.timestamp) === todayStr);
    
    // Previous is yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);
    previousOrders = ordersData.filter(o => getLocalDateString(o.createdAt) === yesterdayStr);
    
  } else if (range === '7days') {
    const limitDate = new Date(now);
    limitDate.setDate(now.getDate() - 6);
    limitDate.setHours(0,0,0,0);
    
    filteredOrders = ordersData.filter(o => o.createdAt >= limitDate);
    filteredVisits = visitsData.filter(v => v.timestamp >= limitDate);

    // Previous 7 days
    const prevLimit = new Date(limitDate);
    prevLimit.setDate(limitDate.getDate() - 7);
    previousOrders = ordersData.filter(o => o.createdAt >= prevLimit && o.createdAt < limitDate);

  } else if (range === '30days') {
    const limitDate = new Date(now);
    limitDate.setDate(now.getDate() - 29);
    limitDate.setHours(0,0,0,0);

    filteredOrders = ordersData.filter(o => o.createdAt >= limitDate);
    filteredVisits = visitsData.filter(v => v.timestamp >= limitDate);

    // Previous 30 days
    const prevLimit = new Date(limitDate);
    prevLimit.setDate(limitDate.getDate() - 30);
    previousOrders = ordersData.filter(o => o.createdAt >= prevLimit && o.createdAt < limitDate);

  } else {
    // All time
    filteredOrders = [...ordersData];
    filteredVisits = [...visitsData];
    previousOrders = [];
  }

  // 1. Compute basic KPIs (Completed orders only for gross revenue, commissions, etc.)
  const completedOrders = filteredOrders.filter(o => o.status === 'completed');
  const cancelledOrders = filteredOrders.filter(o => o.status === 'cancelled');

  const grossRevenue = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalVisits = filteredVisits.length;
  
  // Conversion = completed / visits
  const conversionRate = totalVisits > 0 ? ((completedOrders.length / totalVisits) * 100) : 0;
  const ticketAverage = completedOrders.length > 0 ? (grossRevenue / completedOrders.length) : 0;

  // Trend differentials
  let revenueTrendText = 'Sin datos comparativos';
  if (previousOrders.length > 0) {
    const prevCompleted = previousOrders.filter(o => o.status === 'completed');
    const prevGross = prevCompleted.reduce((sum, o) => sum + (o.total || 0), 0);
    if (prevGross > 0) {
      const diff = ((grossRevenue - prevGross) / prevGross) * 100;
      revenueTrendText = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% vs rango ant.`;
    }
  } else if (range !== 'all') {
    revenueTrendText = '+0% vs rango ant.';
  }

  // Set values to DOM
  document.getElementById('kpi-gross-revenue').textContent = formatPrice(grossRevenue);
  document.getElementById('kpi-revenue-trend').textContent = revenueTrendText;
  document.getElementById('kpi-revenue-trend').className = `kpi-footer ${revenueTrendText.includes('-') ? 'text-red' : 'text-purple'}`;
  
  document.getElementById('kpi-confirmed-orders').textContent = completedOrders.length;
  document.getElementById('kpi-orders-trend').textContent = `${completedOrders.length} entregas exitosas`;
  
  document.getElementById('kpi-cancelled-orders').textContent = cancelledOrders.length;
  const cancelRate = filteredOrders.length > 0 ? ((cancelledOrders.length / filteredOrders.length) * 100) : 0;
  document.getElementById('kpi-cancelled-ratio').textContent = `${cancelRate.toFixed(1)}% tasa de bajas`;
  document.getElementById('kpi-cancelled-ratio').className = `kpi-footer ${cancelRate > 15 ? 'text-red' : 'text-green'}`;

  document.getElementById('kpi-dau').textContent = totalVisits;
  document.getElementById('kpi-conversion').textContent = `${conversionRate.toFixed(1)}%`;
  document.getElementById('kpi-ticket-avg').textContent = `Tique Prom: ${formatPrice(ticketAverage)}`;

  // 2. Compute Financial Ecosystem (Platform Revenue & Absorptions)
  const totalComisiones = completedOrders.reduce((sum, o) => sum + (o.commissionAmount || 0), 0);
  const totalServiceFees = completedOrders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
  const totalCouponsAbsorbed = completedOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
  const netProfit = totalComisiones + totalServiceFees - totalCouponsAbsorbed;

  document.getElementById('fin-total-comisiones').textContent = formatPrice(totalComisiones);
  document.getElementById('fin-total-fees').textContent = formatPrice(totalServiceFees);
  document.getElementById('fin-total-coupons').textContent = formatPrice(totalCouponsAbsorbed);
  document.getElementById('fin-net-profit').textContent = formatPrice(netProfit);
  document.getElementById('fin-net-profit').className = netProfit >= 0 ? 'text-green' : 'text-red';

  const totalInflows = totalComisiones + totalServiceFees;
  const couponAbsorbPercentage = totalInflows > 0 ? Math.min(100, (totalCouponsAbsorbed / totalInflows) * 100) : 0;
  const couponsBar = document.getElementById('fin-coupons-progress');
  if (couponsBar) {
    couponsBar.style.width = `${couponAbsorbPercentage}%`;
  }

  // 3. Render Rankings Tables
  renderRankings(completedOrders, totalCouponsAbsorbed);

  // 4. Draw Custom Interactive SVG Charts
  drawRevenueTrendChart(completedOrders, range);
  drawDAUvsOrdersChart(completedOrders, filteredVisits, range);
  drawDonutStatusChart(filteredOrders);
}

/**
 * Renders the ranking lists for Stores, Drivers, and Coupons usage
 */
function renderRankings(completedOrders, totalCoupons) {
  // A. Top Comercios
  const storeAgg = {};
  completedOrders.forEach(o => {
    const name = o.comercioName || 'Desconocido';
    if (!storeAgg[name]) storeAgg[name] = { name, orders: 0, revenue: 0, commission: 0 };
    storeAgg[name].orders++;
    storeAgg[name].revenue += (o.total || 0);
    storeAgg[name].commission += (o.commissionAmount || 0);
  });

  const topComerciosList = Object.values(storeAgg).sort((a,b) => b.revenue - a.revenue).slice(0, 5);
  const comerciosTbody = document.getElementById('table-top-comercios');
  if (topComerciosList.length > 0) {
    comerciosTbody.innerHTML = topComerciosList.map((c, i) => `
      <tr>
        <td>
          <span style="display:inline-flex; align-items:center; gap:8px;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; background:${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? '#cd7f32' : 'var(--color-bg-secondary)'}; color:${i < 3 ? 'black' : 'var(--color-text-secondary)'}; font-size:10px; font-weight:900;">${i+1}</span>
            <span>${c.name}</span>
          </span>
        </td>
        <td style="text-align:center;">${c.orders}</td>
        <td style="text-align:right; color:var(--color-primary);">${formatPrice(c.revenue)}</td>
        <td style="text-align:right; color:var(--color-text-secondary);">${formatPrice(c.commission)}</td>
      </tr>
    `).join('');
  } else {
    comerciosTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-text-tertiary); padding:20px;">Sin facturación registrada en este período</td></tr>';
  }

  // B. Top Drivers
  const driverAgg = {};
  completedOrders.forEach(o => {
    if (!o.driverName) return;
    const name = o.driverName;
    if (!driverAgg[name]) driverAgg[name] = { name, orders: 0, couponCompensation: 0, shippingEarned: 0 };
    driverAgg[name].orders++;
    driverAgg[name].couponCompensation += (o.couponDiscount || 0);
    driverAgg[name].shippingEarned += (o.deliveryCost || 0);
  });

  const topDriversList = Object.values(driverAgg).sort((a,b) => b.orders - a.orders).slice(0, 5);
  const driversTbody = document.getElementById('table-top-repartidores');
  if (topDriversList.length > 0) {
    driversTbody.innerHTML = topDriversList.map((d, i) => `
      <tr>
        <td>
          <span style="display:inline-flex; align-items:center; gap:8px;">
            <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; background:var(--color-bg-secondary); color:var(--color-text-secondary); font-size:10px; font-weight:900;">${i+1}</span>
            <span>${d.name}</span>
          </span>
        </td>
        <td style="text-align:center;">${d.orders}</td>
        <td style="text-align:right; color:#10b981;">-${formatPrice(d.couponCompensation)}</td>
        <td style="text-align:right; color:var(--color-primary);">${formatPrice(d.shippingEarned)}</td>
      </tr>
    `).join('');
  } else {
    driversTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-text-tertiary); padding:20px;">Sin entregas completadas en este período</td></tr>';
  }

  // C. Top Coupons
  const couponAgg = {};
  completedOrders.forEach(o => {
    if (!o.couponCode) return;
    const code = o.couponCode;
    if (!couponAgg[code]) couponAgg[code] = { code, count: 0, amount: 0 };
    couponAgg[code].count++;
    couponAgg[code].amount += (o.couponDiscount || 0);
  });

  const topCouponsList = Object.values(couponAgg).sort((a,b) => b.amount - a.amount).slice(0, 5);
  const couponsTbody = document.getElementById('table-top-coupons');
  if (topCouponsList.length > 0) {
    couponsTbody.innerHTML = topCouponsList.map(c => {
      const effectPercentage = totalCoupons > 0 ? ((c.amount / totalCoupons) * 100) : 0;
      return `
        <tr>
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px; background:rgba(168,85,247,0.06); border:1px dashed rgba(168,85,247,0.25); padding:2px 8px; border-radius:8px; color:#a855f7; font-size:12px;">
              ${icon('tag', 12)} ${c.code}
            </span>
          </td>
          <td style="text-align:center;">${c.count} canjes</td>
          <td style="text-align:right; color:#ef4444;">${formatPrice(c.amount)}</td>
          <td style="text-align:center;">
            <div style="font-size:11px; font-weight:800; color:var(--color-text-secondary);">${effectPercentage.toFixed(0)}% del total</div>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    couponsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-text-tertiary); padding:20px;">No se registraron cupones absorbidos en este período</td></tr>';
  }
}

/**
 * Draw interactive SVG Line Chart for revenue trends
 */
function drawRevenueTrendChart(completedOrders, range) {
  const container = document.getElementById('revenue-chart-container');
  if (!container) return;

  // Aggregate daily revenue
  const dailyData = {};
  const today = new Date();
  const limitDays = range === 'today' ? 1 : range === '7days' ? 7 : range === '30days' ? 30 : 15; // default scale
  
  if (range === 'today') {
    // Break down by hourly intervals
    for (let h = 0; h < 24; h += 3) {
      dailyData[`${h.toString().padStart(2,'0')}:00`] = 0;
    }
    completedOrders.forEach(o => {
      const hour = o.createdAt.getHours();
      const interval = Math.floor(hour / 3) * 3;
      const label = `${interval.toString().padStart(2,'0')}:00`;
      if (dailyData[label] !== undefined) dailyData[label] += (o.total || 0);
    });
  } else {
    // Break down by daily dates
    for (let i = limitDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dailyData[getLocalDateString(date).slice(5)] = 0; // Use MM-DD
    }
    completedOrders.forEach(o => {
      const label = getLocalDateString(o.createdAt).slice(5);
      if (dailyData[label] !== undefined) dailyData[label] += (o.total || 0);
    });
  }

  const keys = Object.keys(dailyData);
  const values = Object.values(dailyData);
  const maxVal = Math.max(...values, 5000); // at least $5000 scale
  // SVG parameters
  const width = 600;
  const height = 350;
  const paddingLeft = 75;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const barWidth = Math.max(4, (chartW / keys.length) * 0.6);
  const barSpacing = chartW / keys.length;

  const bars = [];
  const gridLines = [];

  // Draw grid helper lines
  const yTicks = 4;
  for (let g = 0; g <= yTicks; g++) {
    const val = (g / yTicks) * maxVal;
    const y = height - paddingBottom - (g / yTicks) * chartH;
    gridLines.push(`
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--color-border)" stroke-width="1.5" stroke-dasharray="4,4" />
      <text x="${paddingLeft - 10}" y="${y + 4}" fill="var(--color-text)" font-family="var(--font-sans, sans-serif)" font-size="11" font-weight="900" text-anchor="end">${formatPrice(val).split(',')[0]}</text>
    `);
  }

  // Draw X axis label ticks and bars
  keys.forEach((key, idx) => {
    const x = paddingLeft + (idx * barSpacing) + (barSpacing - barWidth) / 2;
    const normY = maxVal > 0 ? (values[idx] / maxVal) : 0;
    const barH = normY * chartH;
    const y = height - paddingBottom - barH;

    bars.push(`
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="#a855f7" rx="${Math.min(4, barWidth/2)}" style="cursor:pointer;" onmouseenter="showChartTooltip(event, '${key}', 'Facturado: ${formatPrice(values[idx])}')" onmouseleave="hideChartTooltip()" />
    `);
  });

  const xLabels = keys.map((key, idx) => {
    if (keys.length > 8 && idx % 2 !== 0) return ''; // hide alternate labels if overcrowded
    const x = paddingLeft + (idx * barSpacing) + barSpacing / 2;
    return `<text x="${x}" y="${height - 8}" fill="var(--color-text-secondary)" font-family="var(--font-sans, sans-serif)" font-size="11" font-weight="900" text-anchor="middle">${key}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="overflow:visible;">
      <!-- Grid Helper Lines -->
      ${gridLines.join('')}

      <!-- Bars -->
      ${bars.join('')}

      <!-- X Axis Ticks -->
      ${xLabels.join('')}
    </svg>
    <div id="revenue-chart-tooltip" class="chart-tooltip"></div>
  `;
}

/**
 * Draw interactive SVG Grouped Bar Chart for unique visits versus successful orders
 */
function drawDAUvsOrdersChart(completedOrders, filteredVisits, range) {
  const container = document.getElementById('dau-chart-container');
  if (!container) return;

  const dailyData = {};
  const today = new Date();
  const limitDays = range === 'today' ? 1 : range === '7days' ? 7 : range === '30days' ? 30 : 15;

  if (range === 'today') {
    // Breakdown by hourly segments
    for (let h = 0; h < 24; h += 3) {
      dailyData[`${h.toString().padStart(2,'0')}:00`] = { visits: 0, orders: 0 };
    }
    filteredVisits.forEach(v => {
      const hour = v.timestamp.getHours();
      const interval = Math.floor(hour / 3) * 3;
      const label = `${interval.toString().padStart(2,'0')}:00`;
      if (dailyData[label]) dailyData[label].visits++;
    });
    completedOrders.forEach(o => {
      const hour = o.createdAt.getHours();
      const interval = Math.floor(hour / 3) * 3;
      const label = `${interval.toString().padStart(2,'0')}:00`;
      if (dailyData[label]) dailyData[label].orders++;
    });
  } else {
    // Breakdown by dates
    for (let i = limitDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dailyData[getLocalDateString(date).slice(5)] = { visits: 0, orders: 0 };
    }
    filteredVisits.forEach(v => {
      const label = getLocalDateString(v.timestamp).slice(5);
      if (dailyData[label]) dailyData[label].visits++;
    });
    completedOrders.forEach(o => {
      const label = getLocalDateString(o.createdAt).slice(5);
      if (dailyData[label]) dailyData[label].orders++;
    });
  }

  const keys = Object.keys(dailyData);
  const visitsVals = keys.map(k => dailyData[k].visits);
  const ordersVals = keys.map(k => dailyData[k].orders);
  
  const maxVal = Math.max(...visitsVals, ...ordersVals, 10); // scale at least up to 10
  const width = 600;
  const height = 350;
  const paddingLeft = 55;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const barGroupWidth = chartW / keys.length;
  const barWidth = Math.max(2, barGroupWidth * 0.35);

  const bars = [];
  const gridLines = [];

  // Y tick grids
  const ticks = 4;
  for (let g = 0; g <= ticks; g++) {
    const val = Math.round((g / ticks) * maxVal);
    const y = height - paddingBottom - (g / ticks) * chartH;
    gridLines.push(`
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--color-border)" stroke-width="1.5" stroke-dasharray="4,4" />
      <text x="${paddingLeft - 10}" y="${y + 4}" fill="var(--color-text)" font-family="var(--font-sans, sans-serif)" font-size="11" font-weight="900" text-anchor="end">${val}</text>
    `);
  }

  // Draw grouped bars
  keys.forEach((key, idx) => {
    const xGroup = paddingLeft + idx * barGroupWidth;
    const xVisits = xGroup + barGroupWidth * 0.12;
    const xOrders = xGroup + barGroupWidth * 0.52;

    const hVisits = (dailyData[key].visits / maxVal) * chartH;
    const hOrders = (dailyData[key].orders / maxVal) * chartH;

    const yVisits = height - paddingBottom - hVisits;
    const yOrders = height - paddingBottom - hOrders;

    bars.push(`
      <!-- Visitas Bar (Blue) -->
      <rect x="${xVisits}" y="${yVisits}" width="${barWidth}" height="${hVisits}" fill="#3b82f6" rx="${Math.min(3, barWidth/2)}" style="cursor:pointer;" onmouseenter="showChartTooltip(event, '${key}', 'Visitas: ${dailyData[key].visits}')" onmouseleave="hideChartTooltip()" />
      
      <!-- Ventas Bar (Green) -->
      <rect x="${xOrders}" y="${yOrders}" width="${barWidth}" height="${hOrders}" fill="#10b981" rx="${Math.min(3, barWidth/2)}" style="cursor:pointer;" onmouseenter="showChartTooltip(event, '${key}', 'Órdenes: ${dailyData[key].orders}')" onmouseleave="hideChartTooltip()" />
    `);
  });

  // Label ticks
  const xLabels = keys.map((key, idx) => {
    if (keys.length > 8 && idx % 2 !== 0) return '';
    const x = paddingLeft + idx * barGroupWidth + barGroupWidth / 2;
    return `<text x="${x}" y="${height - 8}" fill="var(--color-text-secondary)" font-family="var(--font-sans, sans-serif)" font-size="11" font-weight="900" text-anchor="middle">${key}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      ${gridLines.join('')}
      ${bars.join('')}
      ${xLabels.join('')}
    </svg>
    <div id="dau-chart-tooltip" class="chart-tooltip"></div>
  `;
}

/**
 * Draw interactive SVG Donut Chart representing order status breakdown
 */
function drawDonutStatusChart(filteredOrders) {
  const container = document.getElementById('donut-chart-container');
  const legendContainer = document.getElementById('donut-legends-container');
  if (!container || !legendContainer) return;

  const total = filteredOrders.length;
  const statusCounts = { completed: 0, cancelled: 0, pending: 0 };
  
  filteredOrders.forEach(o => {
    const s = (o.status || '').toLowerCase();
    if (s.includes('cancel')) statusCounts.cancelled++;
    else if (s.includes('pend')) statusCounts.pending++;
    else statusCounts.completed++;
  });

  const legends = [
    { label: 'Entregado', count: statusCounts.completed, color: '#10b981' },
    { label: 'Cancelado', count: statusCounts.cancelled, color: '#ef4444' },
    { label: 'Pendientes', count: statusCounts.pending, color: '#f59e0b' }
  ];

  legendContainer.innerHTML = legends.map(leg => {
    const pct = total > 0 ? ((leg.count / total) * 100) : 0;
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; min-width:180px;">
        <span style="display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:800; color:var(--color-text-secondary);">
          <span style="width:10px; height:10px; border-radius:3px; background:${leg.color};"></span>
          <span>${leg.label}</span>
        </span>
        <strong style="font-size:13px; font-weight:900; color:var(--color-text);">${leg.count} (${pct.toFixed(0)}%)</strong>
      </div>
    `;
  }).join('');

  if (total === 0) {
    container.innerHTML = `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; color:var(--color-text-secondary); font-family:var(--font-sans, sans-serif);">Sin pedidos registrados</div>`;
    return;
  }

  // Draw custom SVG bar chart for status
  const maxCount = Math.max(statusCounts.completed, statusCounts.cancelled, statusCounts.pending, 5);
    const width = 240;
  const height = 240;
  const paddingLeft = 32;
  const paddingRight = 10;
  const paddingTop = 20;
  const paddingBottom = 25;  
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  
  const barWidth = 18;
  const barSpacing = chartW / 3;

  const bars = [];
  const gridLines = [];

  // 3 ticks for scale
  for (let g = 0; g <= 2; g++) {
    const val = Math.round((g / 2) * maxCount);
    const y = height - paddingBottom - (g / 2) * chartH;
    gridLines.push(`
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--color-border)" stroke-width="1.5" stroke-dasharray="2,2" />
      <text x="${paddingLeft - 6}" y="${y + 3}" fill="var(--color-text)" font-family="var(--font-sans, sans-serif)" font-size="10" font-weight="900" text-anchor="end">${val}</text>
    `);
  }

  legends.forEach((leg, idx) => {
    const x = paddingLeft + (idx * barSpacing) + (barSpacing - barWidth) / 2;
    const h = (leg.count / maxCount) * chartH;
    const y = height - paddingBottom - h;

    bars.push(`
      <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="${leg.color}" rx="4" style="cursor:pointer;" onmouseenter="showChartTooltip(event, '${leg.label}', '${leg.count} pedidos')" onmouseleave="hideChartTooltip()" />
    `);
  });

  const xLabels = legends.map((leg, idx) => {
    const x = paddingLeft + (idx * barSpacing) + barSpacing / 2;
    const abbrev = leg.label.slice(0, 3);
    return `<text x="${x}" y="${height - 5}" fill="var(--color-text-secondary)" font-family="var(--font-sans, sans-serif)" font-size="10" font-weight="900" text-anchor="middle">${abbrev}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="overflow:visible;">
      ${gridLines.join('')}
      ${bars.join('')}
      ${xLabels.join('')}
    </svg>
    <div id="donut-chart-tooltip" class="chart-tooltip"></div>
  `;
}



// Global functions attached to window for interactive tooltips
window.showChartTooltip = (event, date, text) => {
  const tooltip = event.target.ownerDocument.getElementById('revenue-chart-tooltip') || 
                  event.target.ownerDocument.getElementById('dau-chart-tooltip') || 
                  event.target.ownerDocument.getElementById('donut-chart-tooltip');
  
  if (!tooltip) return;

  tooltip.innerHTML = `
    <div style="font-weight:900; font-size:12px; color:#c084fc; margin-bottom:2px;">${date}</div>
    <div>${text}</div>
  `;

  // Get SVG boundary
  const containerRect = tooltip.parentElement.getBoundingClientRect();
  const mouseX = event.clientX - containerRect.left;
  const mouseY = event.clientY - containerRect.top;

  tooltip.style.left = `${mouseX + 15}px`;
  tooltip.style.top = `${mouseY - 30}px`;
  tooltip.style.opacity = '1';
};

window.hideChartTooltip = () => {
  const tooltips = document.querySelectorAll('.chart-tooltip');
  tooltips.forEach(t => t.style.opacity = '0');
};

window.zoomChart = (chartType) => {
  let modal = document.getElementById('chart-zoom-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chart-zoom-modal';
    modal.style = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(10px);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    document.body.appendChild(modal);
  }

  let title = 'Gráfico Ampliado';
  let desc = 'Analíticas y Auditoría en vivo';
  let chartHtml = '';

  if (chartType === 'revenue') {
    title = 'Facturación Diaria (Detallado)';
    desc = 'Historial completo de recaudación facturada en Magdalena.';
    const originalSvg = document.getElementById('revenue-chart-container')?.querySelector('svg');
    if (originalSvg) {
      const cloned = originalSvg.cloneNode(true);
      cloned.setAttribute('viewBox', '0 0 600 350');
      cloned.style.width = '100%';
      cloned.style.height = '100%';
      chartHtml = cloned.outerHTML;
    }
  } else if (chartType === 'dau') {
    title = 'Conversión y Tráfico Único (Detallado)';
    desc = 'Visitas Únicas (DAU) comparadas con Órdenes Completadas.';
    const originalSvg = document.getElementById('dau-chart-container')?.querySelector('svg');
    if (originalSvg) {
      const cloned = originalSvg.cloneNode(true);
      cloned.setAttribute('viewBox', '0 0 600 350');
      cloned.style.width = '100%';
      cloned.style.height = '100%';
      chartHtml = cloned.outerHTML;
    }
  } else if (chartType === 'status') {
    title = 'Distribución de Órdenes (Detallado)';
    desc = 'Desglose proporcional por estado (Entregado, Cancelado, Pendientes).';
    const originalSvg = document.getElementById('donut-chart-container')?.querySelector('svg');
    if (originalSvg) {
      const cloned = originalSvg.cloneNode(true);
      cloned.setAttribute('viewBox', '0 0 240 240');
      cloned.style.width = '100%';
      cloned.style.height = '100%';
      chartHtml = cloned.outerHTML;
    }
  }

  modal.innerHTML = `
    <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:28px; width:100%; max-width:850px; padding:24px; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; gap:20px; position:relative; transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);" class="zoom-modal-content">
      <button onclick="closeChartZoom()" style="position:absolute; top:20px; right:20px; background:var(--color-bg-secondary); border:1px solid var(--color-border); width:36px; height:36px; border-radius:12px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text); transition:all 0.2s; padding:0;">
        ${icon('x', 20)}
      </button>
      
      <div>
        <h3 style="font-family:var(--font-display); font-size:18px; font-weight:900; color:var(--color-text); margin:0;">${title}</h3>
        <p style="font-size:12px; color:var(--color-text-secondary); margin:4px 0 0;">${desc}</p>
      </div>

      <div style="width:100%; height:450px; position:relative; overflow:visible; display:flex; align-items:center; justify-content:center;">
        ${chartHtml || '<p style="color:var(--color-text-secondary); font-size:13px;">Sin datos para ampliar</p>'}
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  setTimeout(() => {
    modal.style.opacity = '1';
    modal.querySelector('.zoom-modal-content').style.transform = 'scale(1)';
  }, 50);
};

window.closeChartZoom = () => {
  const modal = document.getElementById('chart-zoom-modal');
  if (!modal) return;
  modal.querySelector('.zoom-modal-content').style.transform = 'scale(0.95)';
  modal.style.opacity = '0';
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300);
};




