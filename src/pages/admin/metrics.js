import { db } from '../../firebase.js';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { formatPrice } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { getLocalDateString } from '../../utils/analytics.js';

let ordersData = [];
let visitsData = [];
let settlementsData = [];
let isDemoMode = false;
let activeRange = 'today';
let activeSection = 'dashboard'; // Default section

// Global parsed data for charts rendering
let currentCompletedOrders = [];
let currentFilteredVisits = [];
let currentFilteredOrders = [];

// Platform economy totals
let econComisiones = 0;
let econFees = 0;
let econCoupons = 0;
let econNet = 0;

// General KPI caches
let grossRevenueCached = 0;
let revenueTrendTextCached = '';
let completedOrdersCached = 0;
let cancelledOrdersCached = 0;
let cancelRateCached = 0;
let totalVisitsCached = 0;
let conversionRateCached = 0;
let ticketAverageCached = 0;

function getNormalizedStatus(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('pend')) return 'pending';
  if (s.includes('confir') || s.includes('prepar')) return 'confirmed';
  if (s.includes('camino') || s.includes('delivering')) return 'delivering';
  if (s.includes('entreg') || s.includes('complet') || s.includes('ready')) return 'completed';
  return 'pending';
}

export async function renderAdminMetrics() {
  const content = document.getElementById('app-content');

  content.innerHTML = `
    <div class="metrics-dashboard-page">
      
      <!-- Premium Header -->
      <div class="metrics-header-glass">
        <div class="decorative-blob"></div>
        <div class="header-inner">
          <button id="sidebar-toggle-btn" class="hamburger-toggle-btn" title="Menú de Reportes">
            ${icon('menu', 22)}
          </button>
          <a href="#/admin" class="back-circle-btn">
            ${icon('chevronLeft', 24)}
          </a>
          <div class="title-container">
            <h1 class="dashboard-title">Panel de Analíticas</h1>
            <p class="dashboard-subtitle" id="metrics-status-subtitle">AUDITORÍA Y TELEMETRÍA EN VIVO</p>
          </div>
          <button id="refresh-metrics-btn" class="refresh-circle-btn" title="Sincronizar ahora">
            ${icon('history', 20)}
          </button>
        </div>
      </div>

      <!-- Simulation Alerts -->
      <div id="demo-inactive-badge" class="alert-banner warning" style="display:none;">
        <span class="alert-content">
          ${icon('info', 16)} 
          <span>Base de datos vacía. Activa la simulación para visualizar gráficos de prueba.</span>
        </span>
        <button id="activate-demo-btn" class="alert-action-btn">
          Activar Simulación
        </button>
      </div>

      <div id="demo-active-badge" class="alert-banner success" style="display:none;">
        <span class="alert-content">
          ${icon('checkCircle', 16)} 
          <span><strong>Modo Simulación Activo:</strong> Analíticas de prueba del último mes en Magdalena.</span>
        </span>
        <button id="deactivate-demo-btn" class="alert-action-btn outlined">
          Desactivar
        </button>
      </div>

      <!-- Date Filters & Navigation Bar -->
      <div class="controls-panel-row">
        <div class="filters-and-actions">
          <div class="metrics-range-tabs">
            <button class="range-tab-btn active" data-range="today">Hoy</button>
            <button class="range-tab-btn" data-range="7days">7 Días</button>
            <button class="range-tab-btn" data-range="30days">30 Días</button>
            <button class="range-tab-btn" data-range="custom">Personalizado</button>
          </div>

          <!-- Custom Date Inputs -->
          <div id="custom-date-selectors" style="display:none; align-items:center; gap:8px;">
            <input type="date" id="date-from" class="date-picker-input" />
            <span style="font-size:12px; font-weight:800; color:var(--color-text-tertiary);">al</span>
            <input type="date" id="date-to" class="date-picker-input" />
          </div>
           <div id="selected-range-label" class="range-status-badge">
          Cargando rango...
        </div>
      </div>

      <!-- Main Layout: Sidebar + Dashboard Content -->
      <div class="dashboard-split-layout">
        
        <!-- Collapsible Sidebar / Navigation Drawer -->
        <div id="dashboard-sidebar" class="dashboard-sidebar">
          <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
          <div class="sidebar-drawer">
            <div class="sidebar-header">
              <h3>Reportes y Gráficos</h3>
              <button id="close-sidebar-btn" class="close-sidebar-btn">${icon('x', 18)}</button>
            </div>
            
            <nav class="sidebar-nav">
              <button class="sidebar-item active" data-section="dashboard">
                <span class="sidebar-icon">${icon('trendingUp', 18)}</span>
                <span class="sidebar-label">Dashboard</span>
              </button>

              <button class="sidebar-item" data-section="economics">
                <span class="sidebar-icon">${icon('bank', 18)}</span>
                <span class="sidebar-label">Estructura Económica</span>
              </button>

              <button class="sidebar-item" data-section="settlement">
                <span class="sidebar-icon">${icon('dollarSign', 18)}</span>
                <span class="sidebar-label">Liquidación de Ganancia</span>
              </button>
              
              <button class="sidebar-item" data-section="revenue">
                <span class="sidebar-icon">${icon('shoppingBag', 18)}</span>
                <span class="sidebar-label">Facturación Diaria</span>
              </button>
              
              <button class="sidebar-item" data-section="conversion">
                <span class="sidebar-icon">${icon('users', 18)}</span>
                <span class="sidebar-label">Conversión y Visitas</span>
              </button>
              
              <button class="sidebar-item" data-section="status">
                <span class="sidebar-icon">${icon('checkCircle', 18)}</span>
                <span class="sidebar-label">Distribución de Estados</span>
              </button>
            </nav>
          </div>
        </div>

        <!-- Main Workspace Area -->
        <div class="dashboard-workspace">
          <!-- Skeletons Loader -->
          <div id="metrics-loader" class="glass-loader-box">
            <div class="loader-pulse-ring"></div>
            <p class="loader-text">Sincronizando Estación de Analíticas...</p>
          </div>

          <div id="metrics-content-grid" style="display:none; flex-direction:column; gap:24px; width:100%;">
            
            <!-- Active Section Display Viewport (No duplicate content below) -->
            <div id="active-section-viewport" class="page-enter" style="width:100%; display:flex; flex-direction:column; gap:20px;">
              <!-- Rendered dynamically -->
            </div>

          </div>
        </div>

      </div>

    </div>

    <!-- Styles definitions -->
    <style>
      .metrics-dashboard-page {
        display: flex;
        flex-direction: column;
        background: var(--color-bg);
        color: var(--color-text);
        min-height: 100vh;
        --color-accent-purple: #a855f7;
        --color-accent-green: #10b981;
        --color-accent-blue: #3b82f6;
        --color-accent-red: #ef4444;
        --color-accent-yellow: #f59e0b;
      }

      .metrics-header-glass {
        position: relative;
        background: var(--color-primary);
        padding: 22px 20px;
        box-shadow: 0 4px 12px rgba(225, 29, 72, 0.15);
        overflow: hidden;
        min-height: 96px;
        display: flex;
        align-items: center;
        box-sizing: border-box;
      }
      
      .decorative-blob {
        position: absolute;
        top: -40px;
        right: -30px;
        width: 140px;
        height: 140px;
        background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 75%);
        pointer-events: none;
      }

      .header-inner {
        display: flex;
        align-items: center;
        gap: 14px;
        position: relative;
        z-index: 5;
        width: 100%;
      }

      .hamburger-toggle-btn {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        cursor: pointer;
        transition: all 0.2s;
      }
      @media(min-width: 992px) {
        .hamburger-toggle-btn {
          display: none !important;
        }
      }

      .back-circle-btn, .refresh-circle-btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        text-decoration: none;
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .back-circle-btn:hover, .refresh-circle-btn:hover {
        background: rgba(255,255,255,0.25);
        transform: scale(1.05);
      }

      .title-container {
        flex: 1;
      }
      .dashboard-title {
        font-family: var(--font-display, inherit);
        font-size: 19px;
        font-weight: 950;
        color: white;
        margin: 0;
        letter-spacing: -0.03em;
      }
      .dashboard-subtitle {
        font-size: 10px;
        font-weight: 800;
        color: rgba(255,255,255,0.75);
        text-transform: uppercase;
        letter-spacing: 0.15em;
        margin: 2px 0 0;
      }

      /* Alert banners */
      .alert-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 20px;
        font-size: 12px;
        font-weight: 750;
        color: white;
        flex-wrap: wrap;
      }
      .alert-banner.warning {
        background: linear-gradient(135deg, #1f2937, #111827);
        border-bottom: 1px solid var(--color-border);
      }
      .alert-banner.success {
        background: linear-gradient(135deg, #a855f7, #6b21a8);
      }
      
      .alert-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .alert-action-btn {
        background: var(--color-accent-purple);
        border: none;
        padding: 6px 14px;
        border-radius: 8px;
        color: white;
        font-size: 11px;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
      }
      .alert-action-btn.outlined {
        background: transparent;
        border: 1.5px solid rgba(255,255,255,0.5);
      }

      /* Filters Panel */
      .controls-panel-row {
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .filters-and-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .metrics-range-tabs {
        display: flex;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 3px;
      }

      .range-tab-btn {
        padding: 8px 14px;
        border: none;
        background: transparent;
        color: var(--color-text-secondary);
        font-size: 12.5px;
        font-weight: 800;
        border-radius: 9px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .range-tab-btn.active {
        background: var(--color-surface);
        color: var(--color-primary);
        box-shadow: var(--shadow-sm);
      }

      .date-picker-input {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 700;
        color: var(--color-text);
        outline: none;
      }

      .range-status-badge {
        font-size: 11px;
        font-weight: 900;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: var(--color-bg-secondary);
        padding: 6px 12px;
        border-radius: 8px;
        width: fit-content;
      }

      /* Symmetrical Upper Action Buttons centered/aligned */
      .symmetrical-action-row {
        display: flex;
        gap: 16px;
        width: 100%;
        margin-top: 4px;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
      }

      .ecosystem-control-btn {
        flex: 1;
        max-width: 280px;
        min-width: 180px;
        height: 44px;
        border: none;
        border-radius: 14px;
        font-size: 13.5px;
        font-weight: 900;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: white;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        text-align: center;
      }
      @media (max-width: 576px) {
        .ecosystem-control-btn {
          font-size: 11px !important;
          height: 40px !important;
          border-radius: 10px !important;
          gap: 4px !important;
          padding: 0 8px !important;
        }
      }
      
      .ecosystem-control-btn.color-green {
        background: linear-gradient(135deg, #10b981, #059669);
        box-shadow: 0 4px 12px rgba(16,185,129,0.2);
      }
      .ecosystem-control-btn.color-green:hover {
        transform: translateY(-1.5px);
        box-shadow: 0 6px 16px rgba(16,185,129,0.3);
      }

      .ecosystem-control-btn.color-blue {
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        box-shadow: 0 4px 12px rgba(59,130,246,0.2);
      }
      .ecosystem-control-btn.color-blue:hover {
        transform: translateY(-1.5px);
        box-shadow: 0 6px 16px rgba(59,130,246,0.3);
      }

      /* Split Workspace Layout */
      .dashboard-split-layout {
        display: flex;
        flex: 1;
        position: relative;
        width: 100%;
        min-height: 0;
      }

      /* Sidebar behaviors */
      .dashboard-sidebar {
        position: relative;
        z-index: 10000;
      }

      .sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.25);
        z-index: 10010;
        opacity: 0;
        transition: opacity 0.3s;
      }

      .sidebar-drawer {
        width: 260px;
        background: var(--color-surface);
        border-right: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        height: 100%;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 10020;
      }

      @media(max-width: 991px) {
        .dashboard-sidebar {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          z-index: 10000;
          pointer-events: none;
        }
        .sidebar-drawer {
          transform: translateX(-100%);
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          box-shadow: 10px 0 30px rgba(0,0,0,0.15);
          z-index: 10020;
        }
        .dashboard-sidebar.active {
          pointer-events: auto;
        }
        .dashboard-sidebar.active .sidebar-backdrop {
          display: block;
          opacity: 1;
        }
        .dashboard-sidebar.active .sidebar-drawer {
          transform: translateX(0);
        }
      }

      @media(min-width: 992px) {
        .dashboard-sidebar {
          display: block;
        }
        .sidebar-drawer {
          transform: none !important;
          position: sticky;
          top: 0;
          height: calc(100vh - 120px);
        }
        .close-sidebar-btn {
          display: none !important;
        }
      }

      .sidebar-header {
        padding: 20px;
        border-bottom: 1px solid var(--color-border-light);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .sidebar-header h3 {
        font-size: 14px;
        font-weight: 900;
        margin: 0;
        color: var(--color-text);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .close-sidebar-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        color: var(--color-text);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .sidebar-nav {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      
      .sidebar-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 14px;
        color: var(--color-text-secondary);
        font-size: 13.5px;
        font-weight: 800;
        cursor: pointer;
        text-align: left;
        width: 100%;
        transition: all 0.2s;
      }
      .sidebar-item:hover {
        background: var(--color-bg-secondary);
        color: var(--color-text);
      }
      .sidebar-item.active {
        background: rgba(225, 29, 72, 0.08);
        border-color: rgba(225, 29, 72, 0.2);
        color: var(--color-primary);
      }

      /* Workspace */
      .dashboard-workspace {
        flex: 1;
        min-width: 0;
        padding: 20px;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }

      /* Loader */
      .glass-loader-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 100px 20px;
        gap: 16px;
        width: 100%;
      }
      .loader-pulse-ring {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 3.5px solid rgba(225, 29, 72, 0.15);
        border-top-color: var(--color-primary);
        animation: spin 1s infinite linear;
      }
      .loader-text {
        font-size: 11.5px;
        font-weight: 900;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      /* KPIs Grid */
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        width: 100%;
      }
      .conversion-card-span {
        grid-column: span 2;
      }
      @media (min-width: 768px) {
        .kpi-grid {
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }
      }
      .premium-kpi-card {
        background: linear-gradient(135deg, var(--color-surface), var(--color-bg-secondary));
        border: 1px solid var(--color-border);
        border-radius: 22px;
        padding: 18px;
        position: relative;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 4px 15px -3px rgba(0, 0, 0, 0.04);
      }
      @media (max-width: 576px) {
        .premium-kpi-card {
          padding: 18px !important;
          border-radius: 18px !important;
          min-height: 124px;
        }
        .premium-kpi-card .kpi-icon-glow {
          width: 34px !important;
          height: 34px !important;
          border-radius: 10px !important;
        }
        .premium-kpi-card .kpi-label {
          font-size: 10.5px !important;
        }
      }
      .premium-kpi-card:hover {
        transform: translateY(-2px);
        border-color: var(--color-primary);
        box-shadow: 0 10px 25px -4px rgba(225, 29, 72, 0.12);
      }

      .kpi-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .kpi-label {
        font-size: 11px;
        font-weight: 950;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .kpi-icon-glow {
        width: 36px;
        height: 36px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
        border: 1px solid rgba(225, 29, 72, 0.15);
        background: rgba(225, 29, 72, 0.07);
        color: var(--color-primary);
      }

      .kpi-value-text {
        font-size: 32px;
        font-weight: 950;
        color: var(--color-text);
        letter-spacing: -0.05em;
        margin: 4px 0 12px 0;
      }
      @media (max-width: 576px) {
        .kpi-value-text {
          font-size: 24px;
          margin: 2px 0 8px 0;
        }
      }

      /* Active Section Panel Card */
      .active-section-viewport {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 24px;
        padding: 20px;
        margin-top: 16px;
        width: 100%;
        box-sizing: border-box;
      }

      .chart-viewport {
        height: 300px;
        position: relative;
        width: 100%;
      }

      /* Finance structure */
      .finance-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 16px;
      }
      .finance-tile {
        background: linear-gradient(135deg, var(--color-surface), var(--color-bg-secondary));
        border: 1px solid var(--color-border);
        border-radius: 22px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 4px 15px -3px rgba(0, 0, 0, 0.04);
      }
      .finance-tile:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 25px -4px rgba(0, 0, 0, 0.08);
        border-color: rgba(225, 29, 72, 0.25);
      }
      .tile-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        font-weight: 900;
        color: var(--color-text-secondary);
      }
      .tile-header strong {
        font-size: 18px;
        font-weight: 950;
        color: var(--color-text);
      }
      .tile-bar-bg {
        width: 100%;
        height: 6px;
        background: var(--color-border-light);
        border-radius: 3px;
        overflow: hidden;
      }
      .tile-bar {
        height: 100%;
        border-radius: 3px;
      }
      .tile-bar.fill-purple { background: var(--color-accent-purple); }
      .tile-bar.fill-blue { background: var(--color-accent-blue); }
      .tile-bar.fill-red { background: var(--color-accent-red); }
      .tile-bar.fill-green { background: var(--color-accent-green); }
      .tile-subtitle {
        font-size: 10.5px;
        font-weight: 800;
        color: var(--color-text-tertiary);
      }

      .ecosystem-control-btn.premium-green-btn {
        background: linear-gradient(135deg, #10b981, #059669);
        box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
        border: 1px solid rgba(16, 185, 129, 0.15);
        color: white;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        cursor: pointer;
      }
      .ecosystem-control-btn.premium-green-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(16, 185, 129, 0.35);
        filter: brightness(1.06);
      }
      .ecosystem-control-btn.premium-green-btn:active {
        transform: translateY(0);
        box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2);
      }

      /* Donut status layout */
      .donut-chart-flex {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
        justify-content: center;
      }
      @media(min-width: 576px) {
        .donut-chart-flex {
          flex-direction: row;
          justify-content: space-around;
        }
      }
      .donut-svg-wrapper {
        width: 180px;
        height: 180px;
        position: relative;
      }
      .donut-legends-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      @keyframes spin { to { transform: rotate(360deg); } }

      /* Panel title sizing */
      .panel-section-title {
        font-size: 16px;
        font-weight: 950;
        margin: 0 0 16px 0;
        color: var(--color-text);
      }
      @media (max-width: 576px) {
        .panel-section-title {
          font-size: 13px !important;
          margin-bottom: 8px !important;
        }
      }

      /* Settlements Layout */
      .settlements-layout-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
      }
      .settlement-card-left {
        padding: 24px;
        justify-content: space-between;
        gap: 20px;
        border-top: 4px solid var(--color-accent-green);
        box-sizing: border-box;
      }
      .settlement-card-right {
        padding: 24px;
        gap: 14px;
        border-top: 4px solid var(--color-accent-blue);
        box-sizing: border-box;
      }
      .settlement-card-subtitle {
        font-size: 11px;
        font-weight: 950;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
        letter-spacing: 0.08em;
        margin: 0 0 12px 0;
      }
      .settlement-balance-box {
        background: rgba(16,185,129,0.06);
        padding: 16px;
        border-radius: 18px;
        border: 1px solid rgba(16,185,129,0.15);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 4px;
        margin-bottom: 16px;
      }
      .settlement-balance-label {
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
        color: var(--color-accent-green);
        letter-spacing: 0.05em;
      }
      .settlement-balance-value {
        font-size: 38px;
        font-weight: 950;
        color: #10b981;
        letter-spacing: -0.05em;
      }
      .settlement-detail-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 12px;
        border-bottom: 1px dashed var(--color-border-light);
        padding-bottom: 10px;
      }
      .settlement-detail-label {
        font-size: 12.5px;
        font-weight: 800;
        color: var(--color-text-secondary);
      }
      .settlement-detail-value {
        font-size: 13.5px;
        font-weight: 950;
        color: var(--color-text);
      }
      .settlement-period-text {
        font-size: 11px;
        font-weight: 750;
        color: var(--color-text-tertiary);
        margin: 8px 0 0 0;
        line-height: 1.4;
      }
      .settlement-completed-count {
        color: #10b981;
        font-weight: 850;
      }
      .settlement-actions-wrapper {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      button.settlement-btn {
        width: 100%;
        max-width: none;
        height: 88px !important;
        border-radius: 22px !important;
        font-size: 17px !important;
        font-weight: 900;
        box-shadow: 0 6px 20px rgba(16,185,129,0.18) !important;
      }
      button.settlement-btn.secondary {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important;
      }

      .partner-split-list {
        display: flex;
        flex-direction: column;
        gap: 14px;
        flex: 1;
        justify-content: space-around;
      }
      .partner-split-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-radius: 16px;
        background: linear-gradient(135deg, var(--color-surface), var(--color-bg-secondary));
        border: 1px solid var(--color-border);
        transition: all 0.2s;
      }
      .partner-avatar {
        width: 36px;
        height: 36px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 950;
        font-size: 12px;
      }
      .partner-avatar.bg-s1 {
        background: rgba(225,29,72,0.08);
        color: var(--color-primary);
        border: 1px solid rgba(225,29,72,0.12);
      }
      .partner-avatar.bg-s2 {
        background: rgba(59,130,246,0.08);
        color: #3b82f6;
        border: 1px solid rgba(59,130,246,0.12);
      }
      .partner-avatar.bg-s3 {
        background: rgba(16,185,129,0.08);
        color: #10b981;
        border: 1px solid rgba(16,185,129,0.12);
      }
      .partner-name {
        font-size: 13px;
        font-weight: 900;
        color: var(--color-text);
      }
      .partner-pct {
        font-size: 10px;
        font-weight: 800;
        color: var(--color-text-tertiary);
      }
      .partner-amount {
        font-size: 15px;
        font-weight: 950;
        color: var(--color-text);
      }

      @media (max-width: 576px) {
        .settlements-layout-grid {
          grid-template-columns: 1fr;
          gap: 16px !important;
        }
        .settlement-card-left, .settlement-card-right {
          padding: 20px !important;
          gap: 16px !important;
          border-radius: 20px !important;
        }
        .settlement-card-subtitle {
          margin-bottom: 12px !important;
          font-size: 12.5px !important;
        }
        .settlement-balance-box {
          padding: 14px !important;
          margin-bottom: 14px !important;
          border-radius: 16px !important;
        }
        .settlement-balance-value {
          font-size: 34px !important;
        }
        .settlement-detail-row {
          margin-bottom: 10px !important;
          padding-bottom: 10px !important;
        }
        .settlement-detail-label, .settlement-detail-value {
          font-size: 13.5px !important;
        }
        .settlement-period-text {
          margin-top: 8px !important;
          font-size: 11.5px !important;
        }
        .settlement-actions-wrapper {
          gap: 10px !important;
        }
        button.settlement-btn {
          height: 72px !important;
          border-radius: 18px !important;
          font-size: 15px !important;
        }
        .partner-split-list {
          gap: 10px !important;
        }
        .partner-split-item {
          padding: 12px 14px !important;
          border-radius: 16px !important;
        }
        .partner-avatar {
          width: 36px !important;
          height: 36px !important;
          border-radius: 12px !important;
          font-size: 12px !important;
        }
        .partner-name {
          font-size: 14px !important;
        }
        .partner-pct {
          font-size: 11px !important;
        }
        .partner-amount {
          font-size: 16px !important;
        }
      }
    </style>
  `;

  // Attach event handlers
  document.getElementById('refresh-metrics-btn')?.addEventListener('click', () => loadData(true));
  
  // Sidebar toggling events for mobile layout
  const sidebar = document.getElementById('dashboard-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const closeBtn = document.getElementById('close-sidebar-btn');
  const backdrop = document.getElementById('sidebar-backdrop');

  const openSidebar = () => sidebar.classList.add('active');
  const closeSidebar = () => sidebar.classList.remove('active');

  if (toggleBtn) toggleBtn.onclick = openSidebar;
  if (closeBtn) closeBtn.onclick = closeSidebar;
  if (backdrop) backdrop.onclick = closeSidebar;

  // Sidebar item section selection handler
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      activeSection = item.dataset.section;
      closeSidebar();
      renderActiveSection();
    });
  });

  // Custom date selection inputs triggers
  const customSelectors = document.getElementById('custom-date-selectors');
  const dateFrom = document.getElementById('date-from');
  const dateTo = document.getElementById('date-to');

  const onDateChange = () => {
    if (dateFrom.value && dateTo.value) {
      updateRangeDisplay('custom');
    }
  };
  dateFrom.onchange = onDateChange;
  dateTo.onchange = onDateChange;

  document.querySelectorAll('.range-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.range-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRange = btn.dataset.range;
      if (activeRange === 'custom') {
        customSelectors.style.display = 'flex';
      } else {
        customSelectors.style.display = 'none';
        updateRangeDisplay(activeRange);
      }
    };
  });

  document.getElementById('activate-demo-btn')?.addEventListener('click', () => {
    generateMockAnalyticsData();
    isDemoMode = true;
    const activeFilter = document.querySelector('.range-tab-btn.active')?.dataset.range || 'today';
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
  } else if (range === 'custom') {
    const fromVal = document.getElementById('date-from').value;
    const toVal = document.getElementById('date-to').value;
    text = `Rango: ${fromVal || '...'} al ${toVal || '...'}`;
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
      const [ordersSnap, visitsSnap, settlementsSnap] = await Promise.all([
        getDocs(collection(db, 'orders')),
        getDocs(collection(db, 'visits')),
        getDocs(collection(db, 'owner_settlements')).catch(err => {
          console.warn("owner_settlements collection doesn't exist yet, returning empty snap:", err);
          return { forEach: () => {} };
        })
      ]);

      ordersData = [];
      visitsData = [];
      settlementsData = [];

      ordersSnap.forEach(doc => {
        try {
          const d = doc.data();
          let createdAt;
          if (d.createdAt) {
            if (typeof d.createdAt.toDate === 'function') {
              createdAt = d.createdAt.toDate();
            } else if (d.createdAt.seconds !== undefined) {
              createdAt = new Date(d.createdAt.seconds * 1000);
            } else {
              createdAt = new Date(d.createdAt);
            }
          } else {
            createdAt = new Date();
          }
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

      // Load local settlements backup/fallback
      let localSettlements = [];
      try {
        localSettlements = JSON.parse(localStorage.getItem('godelivery_local_settlements') || '[]');
        localSettlements.forEach(s => {
          s.timestamp = new Date(s.timestamp);
        });
      } catch (e) {}

      settlementsData = [...localSettlements];

      if (settlementsSnap && typeof settlementsSnap.forEach === 'function') {
        settlementsSnap.forEach(doc => {
          try {
            const d = doc.data();
            const timestamp = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp || Date.now());
            if (!settlementsData.some(s => s.id === doc.id)) {
              settlementsData.push({ id: doc.id, ...d, timestamp });
            }
          } catch (e) {}
        });
      }
      settlementsData.sort((a, b) => b.timestamp - a.timestamp);
    }

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

    const activeFilter = document.querySelector('.range-tab-btn.active')?.dataset.range || 'today';
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
          <button class="range-tab-btn active" onclick="window.location.reload()">Reintentar Conexión</button>
        </div>
      `;
    }
  }
}

function generateMockAnalyticsData() {
  ordersData = [];
  visitsData = [];
  
  const today = new Date();
  const stores = ['Go! Market', 'Burger Magdalena', 'Pizzería Don Corleone', 'Helados Rívoli', 'Empanadas El Fortín'];
  const drivers = ['Carlos Gómez', 'Facundo Díaz', 'Lautaro Rodríguez', 'Mateo Sosa', 'Bautista Pérez'];
  const coupons = ['BIENVENIDA', 'ENVIOGRATIS', 'PROMO15', 'MAGDALENA10'];

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = getLocalDateString(date);

    const baseVisitors = 50 + (29 - i) * 3 + Math.floor(Math.random() * 25);
    for (let v = 0; v < baseVisitors; v++) {
      visitsData.push({
        id: `mock_visit_${dateStr}_${v}`,
        userId: `user_${Math.floor(Math.random() * 120)}`,
        date: dateStr,
        timestamp: new Date(date.getTime() + Math.random() * 86400000)
      });
    }

    const conversionRate = 0.16 + (Math.random() * 0.08);
    const orderCount = Math.floor(baseVisitors * conversionRate);
    
    for (let o = 0; o < orderCount; o++) {
      const isCompleted = Math.random() > 0.08;
      const storeName = stores[Math.floor(Math.random() * stores.length)];
      const driverName = drivers[Math.floor(Math.random() * drivers.length)];
      
      const itemsPrice = 2000 + Math.floor(Math.random() * 4000);
      const deliveryCost = Math.random() > 0.4 ? 1720 : 0;
      const appUsageFee = 350;
      
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

  settlementsData = [
    {
      id: 'mock_settle_1',
      salesTotal: 450000,
      profitTotal: 58000,
      partnerA_amount: 17400,
      partnerB_amount: 20300,
      partnerC_amount: 20300,
      timestamp: new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000)
    },
    {
      id: 'mock_settle_2',
      salesTotal: 380000,
      profitTotal: 49000,
      partnerA_amount: 14700,
      partnerB_amount: 17150,
      partnerC_amount: 17150,
      timestamp: new Date(today.getTime() - 25 * 24 * 60 * 60 * 1000)
    }
  ];
}

function calculateAndRender(range) {
  const now = new Date();
  let filteredOrders = [];
  let filteredVisits = [];
  let previousOrders = [];
  
  const todayStr = getLocalDateString(now);

  if (range === 'today') {
    filteredOrders = ordersData.filter(o => getLocalDateString(o.createdAt) === todayStr);
    filteredVisits = visitsData.filter(v => getLocalDateString(v.timestamp) === todayStr);
    
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

    const prevLimit = new Date(limitDate);
    prevLimit.setDate(limitDate.getDate() - 7);
    previousOrders = ordersData.filter(o => o.createdAt >= prevLimit && o.createdAt < limitDate);

  } else if (range === '30days') {
    const limitDate = new Date(now);
    limitDate.setDate(now.getDate() - 29);
    limitDate.setHours(0,0,0,0);

    filteredOrders = ordersData.filter(o => o.createdAt >= limitDate);
    filteredVisits = visitsData.filter(v => v.timestamp >= limitDate);

    const prevLimit = new Date(limitDate);
    prevLimit.setDate(limitDate.getDate() - 30);
    previousOrders = ordersData.filter(o => o.createdAt >= prevLimit && o.createdAt < limitDate);

  } else if (range === 'custom') {
    const fromVal = document.getElementById('date-from').value;
    const toVal = document.getElementById('date-to').value;
    if (fromVal && toVal) {
      const fromDate = new Date(fromVal);
      fromDate.setHours(0,0,0,0);
      const toDate = new Date(toVal);
      toDate.setHours(23,59,59,999);

      filteredOrders = ordersData.filter(o => o.createdAt >= fromDate && o.createdAt <= toDate);
      filteredVisits = visitsData.filter(v => v.timestamp >= fromDate && v.timestamp <= toDate);
    }
  }

  const completedOrders = filteredOrders.filter(o => getNormalizedStatus(o.status) === 'completed');
  const cancelledOrders = filteredOrders.filter(o => getNormalizedStatus(o.status) === 'cancelled');

  currentCompletedOrders = completedOrders;
  currentFilteredVisits = filteredVisits;
  currentFilteredOrders = filteredOrders;

  const grossRevenue = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalVisits = filteredVisits.length;
  
  const conversionRate = totalVisits > 0 ? ((completedOrders.length / totalVisits) * 100) : 0;
  const ticketAverage = completedOrders.length > 0 ? (grossRevenue / completedOrders.length) : 0;

  let revenueTrendText = 'Sin datos comparativos';
  if (previousOrders.length > 0) {
    const prevCompleted = previousOrders.filter(o => getNormalizedStatus(o.status) === 'completed');
    const prevGross = prevCompleted.reduce((sum, o) => sum + (o.total || 0), 0);
    if (prevGross > 0) {
      const diff = ((grossRevenue - prevGross) / prevGross) * 100;
      revenueTrendText = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% vs rango ant.`;
    }
  } else if (range !== 'all' && range !== 'custom') {
    revenueTrendText = '+0% vs rango ant.';
  }

  grossRevenueCached = grossRevenue;
  revenueTrendTextCached = revenueTrendText;
  completedOrdersCached = completedOrders.length;
  cancelledOrdersCached = cancelledOrders.length;
  cancelRateCached = filteredOrders.length > 0 ? ((cancelledOrders.length / filteredOrders.length) * 100) : 0;
  totalVisitsCached = totalVisits;
  conversionRateCached = conversionRate;
  ticketAverageCached = ticketAverage;

  // Update economics section variables
  econComisiones = completedOrders.reduce((sum, o) => sum + (o.commissionAmount || 0), 0);
  econFees = completedOrders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
  econCoupons = completedOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
  econNet = econComisiones + econFees - econCoupons;

  // Render active section layout inside main workspace area
  renderActiveSection();
}

function renderActiveSection() {
  const container = document.getElementById('active-section-viewport');
  if (!container) return;

  if (activeSection === 'dashboard') {
    container.innerHTML = `
      <!-- Upper Action Buttons Symmetrical & Centered -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 14px; width: 100%; margin-bottom: 16px;">
        <button onclick="location.hash='#/admin/metrics/breakdown'" class="ecosystem-control-btn" style="width:100%; max-width:none; min-width:0; margin:0; height:46px; border-radius:14px; display:flex; align-items:center; justify-content:center; gap:6px; background:linear-gradient(135deg, var(--color-primary), #be123c); box-shadow:0 4px 12px rgba(225,29,72,0.18); color:white;">
          <span style="display:flex; align-items:center; justify-content:center;">${icon('users', 16)}</span>
          <span>Desglose Ecosistema</span>
        </button>
        <button onclick="location.hash='#/admin/metrics/services'" class="ecosystem-control-btn" style="width:100%; max-width:none; min-width:0; margin:0; height:46px; border-radius:14px; display:flex; align-items:center; justify-content:center; gap:6px; background:linear-gradient(135deg, #4b5563, #1f2937); box-shadow:0 4px 12px rgba(0,0,0,0.1); color:white;">
          <span style="display:flex; align-items:center; justify-content:center;">${icon('trendingUp', 16)}</span>
          <span>Métricas Go! Servicios</span>
        </button>
      </div>

      <!-- KPI Stats Cards -->
      <div class="kpi-grid">
        <div class="premium-kpi-card page-enter" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div class="kpi-header">
              <span class="kpi-label">Ventas Brutas</span>
              <div class="kpi-icon-glow">${icon('shoppingBag', 18)}</div>
            </div>
            <div class="kpi-value-text">${formatPrice(grossRevenueCached)}</div>
          </div>
          <div style="align-self:flex-start; font-size:11px; font-weight:850; padding:4px 8px; border-radius:8px; display:inline-flex; align-items:center; gap:4px; background:var(--color-bg-secondary); color:var(--color-text-secondary);">
            ${revenueTrendTextCached}
          </div>
        </div>

        <div class="premium-kpi-card page-enter" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div class="kpi-header">
              <span class="kpi-label">Pedidos Completados</span>
              <div class="kpi-icon-glow">${icon('checkCircle', 18)}</div>
            </div>
            <div class="kpi-value-text">${completedOrdersCached}</div>
          </div>
          <div style="align-self:flex-start; font-size:11px; font-weight:850; padding:4px 8px; border-radius:8px; display:inline-flex; align-items:center; gap:4px; background:var(--color-bg-secondary); color:var(--color-text-secondary);">
            ${completedOrdersCached} entregados
          </div>
        </div>

        <div class="premium-kpi-card page-enter" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div class="kpi-header">
              <span class="kpi-label">Pedidos Cancelados</span>
              <div class="kpi-icon-glow">${icon('xCircle', 18)}</div>
            </div>
            <div class="kpi-value-text">${cancelledOrdersCached}</div>
          </div>
          <div style="align-self:flex-start; font-size:11px; font-weight:850; padding:4px 8px; border-radius:8px; display:inline-flex; align-items:center; gap:4px; background:var(--color-bg-secondary); color:${cancelRateCached > 15 ? '#ef4444' : 'var(--color-text-secondary)'};">
            ${cancelRateCached.toFixed(1)}% tasa de bajas
          </div>
        </div>

        <div class="premium-kpi-card page-enter" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div class="kpi-header">
              <span class="kpi-label">Visitas Únicas</span>
              <div class="kpi-icon-glow">${icon('users', 18)}</div>
            </div>
            <div class="kpi-value-text">${totalVisitsCached}</div>
          </div>
          <div style="align-self:flex-start; font-size:11px; font-weight:850; padding:4px 8px; border-radius:8px; display:inline-flex; align-items:center; gap:4px; background:var(--color-bg-secondary); color:var(--color-text-secondary);">
            Deduplicación activa
          </div>
        </div>

        <!-- Conversion Card Spanned (Double Width, less height) -->
        <div class="premium-kpi-card conversion-card-span page-enter" style="display:flex; flex-direction:row; justify-content:space-between; align-items:center; padding:14px 20px;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div class="kpi-icon-glow" style="width:40px; height:40px; border-radius:12px;">${icon('trendingUp', 20)}</div>
            <div>
              <span class="kpi-label">Conversión</span>
              <div class="kpi-value-text" style="margin:0;">${conversionRateCached.toFixed(1)}%</div>
            </div>
          </div>
          <div style="font-size:11px; font-weight:850; padding:6px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:4px; background:var(--color-bg-secondary); color:var(--color-text-secondary);">
            Tique Prom: ${formatPrice(ticketAverageCached)}
          </div>
        </div>
      </div>
    `;

  } else if (activeSection === 'economics') {
    const totalInflows = econComisiones + econFees;
    const couponPct = totalInflows > 0 ? Math.min(100, (econCoupons / totalInflows) * 100) : 0;

    container.innerHTML = `
      <h3 class="panel-section-title" style="margin-bottom:20px;">Estructura Económica de Plataforma</h3>
      
      <div class="finance-grid">
        <div class="finance-tile">
          <div class="tile-header">
            <span>Comisión Comercios</span>
            <strong>${formatPrice(econComisiones)}</strong>
          </div>
          <div class="tile-bar-bg"><div class="tile-bar fill-purple" style="width: 100%"></div></div>
          <span class="tile-subtitle">10% Retenido por venta de locales</span>
        </div>

        <div class="finance-tile">
          <div class="tile-header">
            <span>Tarifas de Uso (Fees)</span>
            <strong>${formatPrice(econFees)}</strong>
          </div>
          <div class="tile-bar-bg"><div class="tile-bar fill-blue" style="width: 100%"></div></div>
          <span class="tile-subtitle">Cargo fijo operativo por orden</span>
        </div>

        <div class="finance-tile critical">
          <div class="tile-header text-red">
            <span>Absorción de Cupones</span>
            <strong>-${formatPrice(econCoupons)}</strong>
          </div>
          <div class="tile-bar-bg"><div class="tile-bar fill-red" style="width: ${couponPct}%"></div></div>
          <span class="tile-subtitle text-red">Monto subsidiado (${couponPct.toFixed(0)}%)</span>
        </div>

        <div class="finance-tile profit">
          <div class="tile-header text-green">
            <span>Ganancia Neta</span>
            <strong style="font-size: 19px;">${formatPrice(econNet)}</strong>
          </div>
          <div class="tile-bar-bg"><div class="tile-bar fill-green" style="width: 100%"></div></div>
          <span class="tile-subtitle text-green">Comisiones + Tarifas - Cupones</span>
        </div>
      </div>
    `;

  } else if (activeSection === 'settlement') {
    // 3 owners: Partner A (30%), Partner B (35%), Partner C (35%)
    const latestSettlement = settlementsData[0];
    const cutoffDate = latestSettlement ? new Date(latestSettlement.timestamp) : new Date(0);
    const cutoffStr = latestSettlement ? getLocalDateString(cutoffDate) : 'Inicio del Historial';

    // Filter completed orders since cutoff date
    const pendingOrders = ordersData.filter(o => getNormalizedStatus(o.status) === 'completed' && o.createdAt > cutoffDate);

    const pendingSales = pendingOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const econComisionesPending = pendingOrders.reduce((sum, o) => sum + (o.commissionAmount || 0), 0);
    const econFeesPending = pendingOrders.reduce((sum, o) => sum + (o.appUsageFee || 0), 0);
    const econCouponsPending = pendingOrders.reduce((sum, o) => sum + (o.couponDiscount || 0), 0);
    const pendingProfit = econComisionesPending + econFeesPending - econCouponsPending;

    const partnerA_amount = pendingProfit * 0.30;
    const partnerB_amount = pendingProfit * 0.35;
    const partnerC_amount = pendingProfit * 0.35;

    container.innerHTML = `
      <h3 class="panel-section-title">Liquidación de Ganancias</h3>

      <div class="settlements-layout-grid">
        
        <!-- Current Period Box -->
        <div class="finance-tile settlement-card-left">
          <div>
            <h4 class="settlement-card-subtitle">Saldo Pendiente Actual</h4>
            
            <div class="settlement-balance-box">
              <span class="settlement-balance-label">Ganancia Neta a Repartir</span>
              <span class="settlement-balance-value">${formatPrice(pendingProfit)}</span>
            </div>

            <div class="settlement-detail-row">
              <span class="settlement-detail-label">Total Vendido (Bruto)</span>
              <span class="settlement-detail-value">${formatPrice(pendingSales)}</span>
            </div>
            
            <p class="settlement-period-text">
              Desde: <strong>${cutoffStr}</strong><br>
              Estado: <span class="settlement-completed-count">${pendingOrders.length} pedidos completados</span>
            </p>
          </div>

          <div class="settlement-actions-wrapper">
            <button id="liquidar-periodo-btn" class="ecosystem-control-btn premium-green-btn settlement-btn">
              ${icon('checkCircle', 16)} Liquidar y Reiniciar Saldo
            </button>
            <button id="ver-historial-btn" class="ecosystem-control-btn settlement-btn secondary">
              ${icon('history', 16)} Historial de Liquidaciones
            </button>
          </div>
        </div>

        <!-- Owners Distribution Split Box -->
        <div class="finance-tile settlement-card-right">
          <h4 class="settlement-card-subtitle">Reparto de Utilidades</h4>
          
          <div class="partner-split-list">
            <div class="partner-split-item">
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="partner-avatar bg-s1">S1</div>
                <div>
                  <div class="partner-name">Socio 1</div>
                  <div class="partner-pct">Participación: 30%</div>
                </div>
              </div>
              <strong class="partner-amount">${formatPrice(partnerA_amount)}</strong>
            </div>

            <div class="partner-split-item">
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="partner-avatar bg-s2">S2</div>
                <div>
                  <div class="partner-name">Socio 2</div>
                  <div class="partner-pct">Participación: 35%</div>
                </div>
              </div>
              <strong class="partner-amount">${formatPrice(partnerB_amount)}</strong>
            </div>

            <div class="partner-split-item">
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="partner-avatar bg-s3">S3</div>
                <div>
                  <div class="partner-name">Socio 3</div>
                  <div class="partner-pct">Participación: 35%</div>
                </div>
              </div>
              <strong class="partner-amount">${formatPrice(partnerC_amount)}</strong>
            </div>
          </div>
        </div>

      </div>
    `;

    // Attach click handler to liquidar button
    const liquidarBtn = document.getElementById('liquidar-periodo-btn');
    if (liquidarBtn) {
      liquidarBtn.onclick = () => {
        if (pendingProfit <= 0) {
          alert('No hay ganancias pendientes para liquidar en este período.');
          return;
        }

        window.showConfirmLiquidationModal(async () => {
          liquidarBtn.disabled = true;
          liquidarBtn.textContent = 'Procesando...';

          try {
            if (isDemoMode) {
              settlementsData.unshift({
                id: `mock_settle_${Date.now()}`,
                salesTotal: pendingSales,
                profitTotal: pendingProfit,
                partnerA_amount,
                partnerB_amount,
                partnerC_amount,
                timestamp: new Date()
              });
              alert('Liquidación registrada con éxito (Simulación)');
              renderActiveSection();
            } else {
              try {
                await addDoc(collection(db, 'owner_settlements'), {
                  salesTotal: pendingSales,
                  profitTotal: pendingProfit,
                  partnerA_amount,
                  partnerB_amount,
                  partnerC_amount,
                  timestamp: serverTimestamp()
                });
                alert('Liquidación registrada con éxito en Firestore.');
              } catch (fsErr) {
                console.warn('Firestore write failed, falling back to local storage:', fsErr);
                const localSettlements = JSON.parse(localStorage.getItem('godelivery_local_settlements') || '[]');
                localSettlements.unshift({
                  id: `local_settle_${Date.now()}`,
                  salesTotal: pendingSales,
                  profitTotal: pendingProfit,
                  partnerA_amount,
                  partnerB_amount,
                  partnerC_amount,
                  timestamp: new Date()
                });
                localStorage.setItem('godelivery_local_settlements', JSON.stringify(localSettlements));
                alert('Liquidación registrada exitosamente de forma local (Firebase rechazó la escritura remota debido a permisos).');
              }
              await loadData(true); // reload to refresh UI
            }
          } catch (e) {
            console.error(e);
            alert('Error al procesar la liquidación: ' + e.message);
            liquidarBtn.disabled = false;
            liquidarBtn.textContent = 'Liquidar y Reiniciar Saldo';
          }
        });
      };
    }

    // Attach click handler to ver historial button
    const verHistorialBtn = document.getElementById('ver-historial-btn');
    if (verHistorialBtn) {
      verHistorialBtn.onclick = () => {
        window.showSettlementsHistoryModal();
      };
    }


  } else if (activeSection === 'revenue') {
    // Premium Daily Performance Breakdown (No generic charts)
    const dailyData = {};
    const ordersRange = currentCompletedOrders;

    ordersRange.forEach(o => {
      const dayStr = getLocalDateString(o.createdAt);
      if (!dailyData[dayStr]) {
        dailyData[dayStr] = { sales: 0, count: 0 };
      }
      dailyData[dayStr].sales += (o.total || 0);
      dailyData[dayStr].count++;
    });

    const datesSorted = Object.keys(dailyData).sort((a,b) => b.localeCompare(a));
    const salesValues = Object.values(dailyData).map(v => v.sales);
    
    const maxSales = salesValues.length > 0 ? Math.max(...salesValues) : 0;
    const minSales = salesValues.length > 0 ? Math.min(...salesValues) : 0;
    const avgSales = salesValues.length > 0 ? (salesValues.reduce((a,b)=>a+b, 0) / salesValues.length) : 0;

    let dailyRowsHTML = '';
    if (datesSorted.length === 0) {
      dailyRowsHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--color-text-tertiary); font-weight:750;">Sin registros de ventas en este rango.</td></tr>`;
    } else {
      dailyRowsHTML = datesSorted.map(date => {
        const item = dailyData[date];
        const performancePercent = maxSales > 0 ? Math.round((item.sales / maxSales) * 100) : 0;
        let pillColor = 'rgba(120,120,120,0.1)';
        let textColor = 'var(--color-text-secondary)';
        if (performancePercent > 80) {
          pillColor = 'rgba(16,185,129,0.12)';
          textColor = '#10b981';
        } else if (performancePercent < 35) {
          pillColor = 'rgba(239,68,68,0.12)';
          textColor = '#ef4444';
        }
        return `
          <tr style="border-bottom:1px solid var(--color-border-light);">
            <td style="padding:12px; font-size:12.5px; font-weight:800; color:var(--color-text-secondary);">${date}</td>
            <td style="padding:12px; font-size:13px; font-weight:950; color:var(--color-text);">${formatPrice(item.sales)}</td>
            <td style="padding:12px; font-size:12px; font-weight:800; color:var(--color-text-secondary);">${item.count} órdenes</td>
            <td style="padding:12px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; max-width:80px; height:6px; background:var(--color-border-light); border-radius:3px; overflow:hidden;">
                  <div style="height:100%; width:${performancePercent}%; background:${textColor}; border-radius:3px;"></div>
                </div>
                <span style="background:${pillColor}; color:${textColor}; padding:2px 6px; border-radius:5px; font-size:9.5px; font-weight:900;">${performancePercent}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    container.innerHTML = `
      <h3 class="panel-section-title" style="margin-bottom:20px;">Facturación Diaria (Auditoría de Ventas)</h3>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:14px; margin-bottom:24px;">
        <div class="finance-tile" style="border-left:4px solid #10b981;">
          <div class="tile-header">Venta Máxima Diaria</div>
          <strong style="font-size:18px; color:var(--color-text); margin-top:4px;">${formatPrice(maxSales)}</strong>
          <span class="tile-subtitle">Mejor rendimiento del rango</span>
        </div>

        <div class="finance-tile" style="border-left:4px solid #ef4444;">
          <div class="tile-header">Venta Mínima Diaria</div>
          <strong style="font-size:18px; color:var(--color-text); margin-top:4px;">${formatPrice(minSales)}</strong>
          <span class="tile-subtitle">Piso mínimo del rango</span>
        </div>

        <div class="finance-tile" style="border-left:4px solid var(--color-primary);">
          <div class="tile-header">Promedio Diario</div>
          <strong style="font-size:18px; color:var(--color-text); margin-top:4px;">${formatPrice(avgSales)}</strong>
          <span class="tile-subtitle">Media ponderada de facturación</span>
        </div>
      </div>

      <div class="card-glass-bg" style="padding:20px; border-radius:24px; border:1px solid var(--color-border);">
        <h4 style="font-size:12.5px; font-weight:900; text-transform:uppercase; color:var(--color-text-secondary); letter-spacing:0.05em; margin-bottom:16px;">Desglose y Rendimiento de Fechas</h4>
        <div style="overflow-x:auto; max-height:calc(100vh - 390px); overflow-y:auto;">
          <table style="width:100%; border-collapse:collapse; text-align:left;">
            <thead>
              <tr style="border-bottom:2px solid var(--color-border); color:var(--color-text-tertiary); font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.05em;">
                <th style="padding:12px;">Fecha</th>
                <th style="padding:12px;">Total Facturado</th>
                <th style="padding:12px;">Volumen</th>
                <th style="padding:12px;">Rendimiento Relativo</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRowsHTML}
            </tbody>
          </table>
        </div>
      </div>
    `;

  } else if (activeSection === 'conversion') {
    // Clean, professional conversion funnel metric UI
    const visits = totalVisitsCached;
    const checkoutStarted = currentFilteredOrders.length; // Everyone who completed, cancelled or pending order initiated checkout
    const completed = completedOrdersCached;

    const intentRate = visits > 0 ? ((checkoutStarted / visits) * 100) : 0;
    const completionRate = checkoutStarted > 0 ? ((completed / checkoutStarted) * 100) : 0;
    const overallRate = conversionRateCached;

    container.innerHTML = `
      <h3 class="panel-section-title" style="margin-bottom:20px;">Embudo de Conversión de Ecosistema</h3>

      <div class="card-glass-bg" style="padding:24px; border-radius:24px; border:1px solid var(--color-border); display:flex; flex-direction:column; gap:24px; margin-bottom:24px;">
        
        <!-- Step 1: Traffic -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:900; color:var(--color-text); display:flex; align-items:center; gap:8px;">
              <span style="width:20px; height:20px; border-radius:50%; background:rgba(59,130,246,0.1); color:#3b82f6; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900;">1</span>
              Visitas del Tráfico Único (DAU)
            </span>
            <strong style="font-size:14.5px; font-weight:900; color:var(--color-text);">${visits} visitas</strong>
          </div>
          <div style="width:100%; height:12px; background:var(--color-border-light); border-radius:6px; overflow:hidden;">
            <div style="width:100%; height:100%; background:linear-gradient(90deg, #3b82f6, #60a5fa); border-radius:6px;"></div>
          </div>
          <div style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:750; margin-top:4px;">100% de la audiencia de plataforma</div>
        </div>

        <!-- Step 2: Intention -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:900; color:var(--color-text); display:flex; align-items:center; gap:8px;">
              <span style="width:20px; height:20px; border-radius:50%; background:rgba(245,158,11,0.1); color:#f59e0b; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900;">2</span>
              Intención de Compra (Checkout Iniciado)
            </span>
            <strong style="font-size:14.5px; font-weight:900; color:var(--color-text);">${checkoutStarted} carritos (${intentRate.toFixed(1)}%)</strong>
          </div>
          <div style="width:100%; height:12px; background:var(--color-border-light); border-radius:6px; overflow:hidden;">
            <div style="width:${intentRate}%; height:100%; background:linear-gradient(90deg, #f59e0b, #fbbf24); border-radius:6px;"></div>
          </div>
          <div style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:750; margin-top:4px;">Tasa de rebote / Abandono de compra: ${(100 - intentRate).toFixed(1)}%</div>
        </div>

        <!-- Step 3: Payouts -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:900; color:var(--color-text); display:flex; align-items:center; gap:8px;">
              <span style="width:20px; height:20px; border-radius:50%; background:rgba(16,185,129,0.1); color:#10b981; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900;">3</span>
              Pedidos Completados (Ventas)
            </span>
            <strong style="font-size:14.5px; font-weight:900; color:var(--color-text);">${completed} entregas (${overallRate.toFixed(1)}%)</strong>
          </div>
          <div style="width:100%; height:12px; background:var(--color-border-light); border-radius:6px; overflow:hidden;">
            <div style="width:${overallRate}%; height:100%; background:linear-gradient(90deg, #10b981, #34d399); border-radius:6px;"></div>
          </div>
          <div style="font-size:10.5px; color:var(--color-text-tertiary); font-weight:750; margin-top:4px;">Efectividad de cierre en checkout: ${completionRate.toFixed(1)}%</div>
        </div>

      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:14px;">
        <div class="finance-tile">
          <div class="tile-header">Conversión de Tráfico</div>
          <strong style="font-size:20px; color:var(--color-text); margin-top:4px;">${overallRate.toFixed(2)}%</strong>
          <span class="tile-subtitle">Efectividad global de visitas</span>
        </div>
        <div class="finance-tile">
          <div class="tile-header">Ticket Promedio</div>
          <strong style="font-size:20px; color:var(--color-text); margin-top:4px;">${formatPrice(ticketAverageCached)}</strong>
          <span class="tile-subtitle">Consumo medio por pedido</span>
        </div>
      </div>
    `;

  } else if (activeSection === 'status') {
    // Custom status breakdown & balance layout
    const total = currentFilteredOrders.length;
    const completed = currentFilteredOrders.filter(o => getNormalizedStatus(o.status) === 'completed').length;
    const cancelled = currentFilteredOrders.filter(o => getNormalizedStatus(o.status) === 'cancelled').length;
    const pending = total - completed - cancelled;

    const completedPct = total > 0 ? ((completed / total) * 100) : 0;
    const cancelledPct = total > 0 ? ((cancelled / total) * 100) : 0;
    const pendingPct = total > 0 ? ((pending / total) * 100) : 0;

    container.innerHTML = `
      <h3 class="panel-section-title" style="margin-bottom:20px;">Distribución y Estado de Órdenes</h3>

      <!-- Horizontal Proportion Balance Bar -->
      <div class="card-glass-bg" style="padding:22px; border-radius:24px; border:1px solid var(--color-border); margin-bottom:24px;">
        <h4 style="font-size:12.5px; font-weight:900; text-transform:uppercase; color:var(--color-text-secondary); letter-spacing:0.05em; margin-bottom:14px;">Balance de Procesamiento</h4>
        
        <div style="width:100%; height:20px; background:var(--color-border-light); border-radius:10px; overflow:hidden; display:flex;">
          <div style="width:${completedPct}%; background:#10b981; height:100%;" title="Completado: ${completedPct.toFixed(0)}%"></div>
          <div style="width:${pendingPct}%; background:#f59e0b; height:100%;" title="Pendiente: ${pendingPct.toFixed(0)}%"></div>
          <div style="width:${cancelledPct}%; background:#ef4444; height:100%;" title="Cancelado: ${cancelledPct.toFixed(0)}%"></div>
        </div>
        
        <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:14px; font-size:11.5px; font-weight:800;">
          <span style="color:#10b981; display:flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#10b981;"></span>
            Completados (${completedPct.toFixed(0)}%)
          </span>
          <span style="color:#f59e0b; display:flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#f59e0b;"></span>
            Pendientes (${pendingPct.toFixed(0)}%)
          </span>
          <span style="color:#ef4444; display:flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background:#ef4444;"></span>
            Cancelados (${cancelledPct.toFixed(0)}%)
          </span>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px;">
        <div class="finance-tile" style="border-left:4px solid #10b981;">
          <div class="tile-header" style="color:#10b981;">Pedidos Entregados</div>
          <strong style="font-size:22px; color:var(--color-text); margin-top:4px;">${completed}</strong>
          <span class="tile-subtitle">Transacciones finalizadas con éxito</span>
        </div>

        <div class="finance-tile" style="border-left:4px solid #f59e0b;">
          <div class="tile-header" style="color:#f59e0b;">Pedidos Pendientes</div>
          <strong style="font-size:22px; color:var(--color-text); margin-top:4px;">${pending}</strong>
          <span class="tile-subtitle">Órdenes en preparación o tránsito</span>
        </div>

        <div class="finance-tile" style="border-left:4px solid #ef4444;">
          <div class="tile-header" style="color:#ef4444;">Pedidos Cancelados</div>
          <strong style="font-size:22px; color:var(--color-text); margin-top:4px;">${cancelled}</strong>
          <span class="tile-subtitle">Tasa de rebote o rechazo de orden</span>
        </div>
      </div>
    `;
  }
}

// Global functions attached to window for tooltips
window.showChartTooltip = (event, date, text) => {
  const tooltip = event.target.ownerDocument.getElementById('revenue-chart-tooltip') || 
                  event.target.ownerDocument.getElementById('dau-chart-tooltip') || 
                  event.target.ownerDocument.getElementById('donut-chart-tooltip');
  if (!tooltip) return;

  tooltip.innerHTML = `
    <div style="font-weight:900; font-size:12px; color:#c084fc; margin-bottom:2px;">${date}</div>
    <div>${text}</div>
  `;

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

window.showSettlementsHistoryModal = () => {
  let modal = document.getElementById('settlements-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'settlements-history-modal';
    modal.style = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(6px);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    document.body.appendChild(modal);
  }

  let historyRowsHTML = '';
  if (settlementsData.length === 0) {
    historyRowsHTML = `
      <div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:800;">
        <div style="font-size:32px; margin-bottom:12px;">${icon('info', 32)}</div>
        <div style="font-size:13.5px;">No hay liquidaciones anteriores registradas.</div>
      </div>
    `;
  } else {
    historyRowsHTML = `
      <div style="overflow-y:auto; max-height:420px; display:flex; flex-direction:column; gap:12px; padding-right:6px; margin-top:8px;">
        ${settlementsData.map((s, idx) => {
          const d = new Date(s.timestamp || Date.now());
          const nextItem = settlementsData[idx + 1];
          const startOfPeriodStr = nextItem ? getLocalDateString(new Date(nextItem.timestamp)) : 'Inicio';
          const periodStr = `${startOfPeriodStr} a ${getLocalDateString(d)}`;
          return `
            <div style="background:var(--color-bg-secondary); border:1px solid var(--color-border); border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                  <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--color-text-tertiary); letter-spacing:0.05em;">Período Liquidado</div>
                  <div style="font-size:13px; font-weight:900; color:var(--color-text);">${periodStr}</div>
                </div>
                <span style="background:rgba(16,185,129,0.12); color:#10b981; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:900; text-transform:uppercase;">${getLocalDateString(d)}</span>
              </div>
              
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; border-top:1px dashed var(--color-border); padding-top:12px;">
                <div>
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary);">Total Vendido (Bruto)</div>
                  <div style="font-size:13px; font-weight:900; color:var(--color-text);">${formatPrice(s.salesTotal)}</div>
                </div>
                <div>
                  <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary);">Ganancia Neta</div>
                  <div style="font-size:13.5px; font-weight:950; color:var(--color-accent-green);">${formatPrice(s.profitTotal)}</div>
                </div>
              </div>

              <div style="background:var(--color-surface); padding:10px 12px; border-radius:12px; border:1px solid var(--color-border-light); font-size:11px; font-weight:800; color:var(--color-text-secondary); display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; justify-content:space-between;"><span>Socio 1 (30%):</span><strong>${formatPrice(s.partnerA_amount)}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>Socio 2 (35%):</span><strong>${formatPrice(s.partnerB_amount)}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>Socio 3 (35%):</span><strong>${formatPrice(s.partnerC_amount)}</strong></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  modal.innerHTML = `
    <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; width:100%; max-width:520px; padding:24px; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; gap:20px; position:relative; transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);" class="zoom-modal-content">
      <button onclick="closeSettlementsHistoryModal()" style="position:absolute; top:20px; right:20px; background:var(--color-bg-secondary); border:1px solid var(--color-border); width:36px; height:36px; border-radius:12px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text); transition:all 0.2s; padding:0;">
        ${icon('close', 18)}
      </button>
      
      <div>
        <h3 style="font-family:var(--font-display); font-size:16px; font-weight:950; color:var(--color-text); margin:0;">Historial de Liquidaciones</h3>
        <p style="font-size:11.5px; color:var(--color-text-tertiary); margin:4px 0 0;">Cierres y repartos históricos de ganancias.</p>
      </div>

      ${historyRowsHTML}
    </div>
  `;

  modal.style.display = 'flex';
  setTimeout(() => {
    modal.style.opacity = '1';
    modal.querySelector('.zoom-modal-content').style.transform = 'scale(1)';
  }, 50);
};

window.closeSettlementsHistoryModal = () => {
  const modal = document.getElementById('settlements-history-modal');
  if (!modal) return;
  modal.querySelector('.zoom-modal-content').style.transform = 'scale(0.95)';
  modal.style.opacity = '0';
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300);
};

window.showConfirmLiquidationModal = (onConfirm) => {
  let modal = document.getElementById('confirm-liquidation-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'confirm-liquidation-modal';
    modal.style = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(6px);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; width:100%; max-width:400px; padding:28px; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; align-items:center; text-align:center; gap:20px; position:relative; transform: scale(0.95); transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);" class="zoom-modal-content">
      <div style="width:56px; height:56px; border-radius:50%; background:rgba(225,29,72,0.1); color:var(--color-primary); display:flex; align-items:center; justify-content:center; font-size:26px;">
        ${icon('alertTriangle', 26)}
      </div>
      
      <div>
        <h3 style="font-family:var(--font-display); font-size:17px; font-weight:950; color:var(--color-text); margin:0;">¿Confirmar Liquidación?</h3>
        <p style="font-size:12.5px; color:var(--color-text-secondary); margin:8px 0 0; line-height:1.5;">
          Estás por registrar la liquidación de este período. Esto guardará el reparto en el historial y reiniciará el saldo pendiente a $0.
        </p>
      </div>

      <div style="display:flex; gap:12px; width:100%; margin-top:8px;">
        <button id="cancel-liq-modal-btn" class="ecosystem-control-btn" style="flex:1; min-width:0 !important; height:44px; border-radius:14px; font-size:13px; font-weight:900; background:var(--color-bg-secondary); border:1px solid var(--color-border); color:var(--color-text); cursor:pointer; padding:0;">
          Cancelar
        </button>
        <button id="confirm-liq-modal-btn" class="ecosystem-control-btn premium-green-btn" style="flex:1; min-width:0 !important; height:44px; border-radius:14px; font-size:13px; font-weight:900; cursor:pointer; padding:0;">
          Sí, Liquidar
        </button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  setTimeout(() => {
    modal.style.opacity = '1';
    modal.querySelector('.zoom-modal-content').style.transform = 'scale(1)';
  }, 50);

  const closeModal = () => {
    modal.querySelector('.zoom-modal-content').style.transform = 'scale(0.95)';
    modal.style.opacity = '0';
    setTimeout(() => {
      modal.style.display = 'none';
    }, 200);
  };

  document.getElementById('cancel-liq-modal-btn').onclick = closeModal;
  document.getElementById('confirm-liq-modal-btn').onclick = () => {
    closeModal();
    onConfirm();
  };
};
