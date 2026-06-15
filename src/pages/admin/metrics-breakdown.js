import { db } from '../../firebase.js';
import { collection, getDocs } from 'firebase/firestore';
import { formatPrice } from '../../utils/format.js';
import { icon } from '../../utils/icons.js';
import { getLocalDateString } from '../../utils/analytics.js';

export async function renderAdminMetricsBreakdown() {
  const content = document.getElementById('app-content');

  content.innerHTML = `
    <div class="metrics-breakdown-page" style="display:flex; flex-direction:column; min-height:100dvh; background:var(--color-bg); color:var(--color-text); overflow-x:hidden; padding-bottom:50px;">
      
      <!-- Premium Header -->
      <div class="breakdown-header-glass">
        <div class="decorative-blob"></div>
        <div class="header-inner">
          <a href="#/admin/metrics" class="back-circle-btn">
            ${icon('chevronLeft', 24)}
          </a>
          <div class="title-container">
            <h1 class="dashboard-title">Desglose Ecosistema</h1>
            <p class="dashboard-subtitle">Métricas y Auditorías Individuales</p>
          </div>
        </div>
      </div>

      <!-- Filters & Date Ranges Row -->
      <div class="controls-panel-row">
        <div class="filters-and-actions" style="width:100%; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
          <div class="metrics-range-tabs">
            <button class="range-tab-btn active" data-range="today">Hoy</button>
            <button class="range-tab-btn" data-range="7days">7 Días</button>
            <button class="range-tab-btn" data-range="30days">30 Días</button>
            <button class="range-tab-btn" data-range="custom">Personalizado</button>
          </div>

          <!-- Custom Range Inputs (Hidden by default) -->
          <div id="custom-date-selectors" style="display:none; align-items:center; gap:8px;">
            <input type="date" id="date-from" class="date-picker-input" />
            <span style="font-size:12px; font-weight:800; color:var(--color-text-tertiary);">al</span>
            <input type="date" id="date-to" class="date-picker-input" />
          </div>

          <div id="selected-range-label" class="range-status-badge">
            Cargando rango...
          </div>
        </div>
      </div>

      <!-- Tab Selection Bar -->
      <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border); padding:12px 20px;">
        <div class="breakdown-tabs">
          <button class="b-tab active" data-tab="users">
            ${icon('user', 15)} Clientes
          </button>
          <button class="b-tab" data-tab="deliveries">
            ${icon('bike', 15)} Repartidores
          </button>
          <button class="b-tab" data-tab="comercios">
            ${icon('store', 15)} Comercios
          </button>
        </div>
      </div>

      <!-- Search Field -->
      <div style="padding:16px 20px; background:var(--color-bg);">
        <div class="search-wrapper">
          <span class="search-icon">${icon('search', 18)}</span>
          <input type="text" id="breakdown-search" placeholder="Buscar por nombre, email o ID..." />
        </div>
      </div>

      <!-- Content Layout -->
      <div style="padding:0 20px;" id="breakdown-main-container">
        
        <!-- Loader -->
        <div id="breakdown-loader" style="text-align:center; padding:100px 20px;">
          <div class="loader-pulse-ring"></div>
          <p class="loader-text">Procesando registros financieros...</p>
        </div>

        <!-- Responsive Flex Grid Container (No Scroll) -->
        <div id="breakdown-cards-grid" class="breakdown-cards-grid" style="display:none;">
          <!-- Card elements injected dynamically -->
        </div>

      </div>

    </div>

    <!-- Styles definitions -->
    <style>
      .metrics-breakdown-page {
        font-family: var(--font-sans, sans-serif);
      }
      
      .breakdown-header-glass {
        position: relative;
        background: linear-gradient(135deg, #10b981, #047857);
        padding: 24px 20px;
        box-shadow: 0 8px 32px rgba(16, 185, 129, 0.15);
        overflow: hidden;
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
        gap: 16px;
        position: relative;
        z-index: 5;
      }

      .back-circle-btn {
        width: 44px;
        height: 44px;
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
      .back-circle-btn:hover {
        background: rgba(255,255,255,0.25);
        transform: scale(1.05);
      }

      .title-container {
        flex: 1;
      }

      .dashboard-title {
        font-family: var(--font-display, inherit);
        font-size: 22px;
        font-weight: 950;
        color: white;
        margin: 0;
        letter-spacing: -0.04em;
      }

      .dashboard-subtitle {
        font-size: 10px;
        font-weight: 800;
        color: rgba(255,255,255,0.75);
        text-transform: uppercase;
        letter-spacing: 0.15em;
        margin: 4px 0 0;
      }

      .controls-panel-row {
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        padding: 14px 20px;
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
        color: #10b981;
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
      }

      .breakdown-tabs {
        display: flex;
        gap: 8px;
        border-bottom: 2px solid var(--color-border-light);
        padding-bottom: 6px;
      }
      .b-tab {
        flex: 1;
        padding: 10px;
        border: none;
        background: transparent;
        font-size: 13px;
        font-weight: 800;
        color: var(--color-text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border-radius: 10px;
        transition: all 0.2s;
      }
      .b-tab.active {
        background: rgba(16, 185, 129, 0.1);
        color: #10b981;
      }

      .search-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 16px;
        padding: 0 14px;
        height: 48px;
        box-shadow: var(--shadow-sm);
      }
      .search-icon {
        color: var(--color-text-tertiary);
        display: flex;
      }
      .search-wrapper input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 14px;
        font-weight: 700;
        color: var(--color-text);
        outline: none;
        padding-left: 10px;
      }

      /* Premium Card Grid - avoids horizontal scrolls completely */
      .breakdown-cards-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        width: 100%;
        box-sizing: border-box;
      }
      @media(min-width: 640px) {
        .breakdown-cards-grid {
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        }
      }

      .breakdown-item-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 14px;
        box-shadow: var(--shadow-sm);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .breakdown-item-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: rgba(16, 185, 129, 0.2);
      }

      .item-profile {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .item-avatar {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        object-fit: cover;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border-light);
      }

      .item-info {
        flex: 1;
        min-width: 0;
      }
      .item-name {
        font-size: 14.5px;
        font-weight: 900;
        color: var(--color-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .item-desc {
        font-size: 11px;
        color: var(--color-text-tertiary);
        font-weight: 750;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      .stats-badge-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid var(--color-border-light);
        padding-top: 12px;
      }

      .orders-badge {
        font-size: 11px;
        font-weight: 900;
        background: var(--bg-badge);
        color: var(--color-badge);
        padding: 4px 10px;
        border-radius: 8px;
      }

      .revenue-metric {
        font-size: 15px;
        font-weight: 950;
        color: #10b981;
      }

      .owner-subpanel {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 8px 12px;
      }
      .owner-lbl {
        font-size: 9px;
        font-weight: 850;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
      }
      .owner-val {
        font-size: 11.5px;
        font-weight: 850;
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .loader-pulse-ring {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 3.5px solid rgba(16,185,129,0.15);
        border-top-color: #10b981;
        animation: spin 1s infinite linear;
        margin: 0 auto;
      }
      .loader-text {
        font-size: 11.5px;
        font-weight: 900;
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  `;

  // Variables for holding data
  let users = [];
  let orders = [];
  let comercios = [];
  let currentTab = 'users';
  let activeRange = 'today';

  // Attach tab events
  const tabs = document.querySelectorAll('.b-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderActiveTab();
    };
  });

  // Date controls
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

  const searchInput = document.getElementById('breakdown-search');
  searchInput.oninput = () => renderActiveTab();

  // Load data
  try {
    const [usersSnap, ordersSnap, comerciosSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'comercios'))
    ]);

    usersSnap.forEach(d => users.push({ uid: d.id, ...d.data() }));
    ordersSnap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    comerciosSnap.forEach(d => comercios.push({ id: d.id, ...d.data() }));

    const sumUsers = document.getElementById('sum-users');
    const sumDeliveries = document.getElementById('sum-deliveries');
    const sumComercios = document.getElementById('sum-comercios');
    const loader = document.getElementById('breakdown-loader');
    const grid = document.getElementById('breakdown-cards-grid');

    if (sumUsers) sumUsers.textContent = users.length;
    if (sumDeliveries) sumDeliveries.textContent = users.filter(u => u.isDelivery).length;
    if (sumComercios) sumComercios.textContent = comercios.length;

    if (loader) loader.style.display = 'none';
    if (grid) grid.style.display = 'grid';

    updateRangeDisplay('today');
  } catch (err) {
    console.error('Error loading metrics breakdown:', err);
    document.getElementById('breakdown-main-container').innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary);">
        ${icon('alertTriangle', 40)}
        <p style="font-weight:900; margin-top:12px; color:var(--color-text);">Error de Sincronización</p>
        <p style="font-size:12px;">No se pudo conectar a los servidores de datos.</p>
      </div>
    `;
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
      const fromVal = dateFrom.value;
      const toVal = dateTo.value;
      text = `Rango: ${fromVal || '...'} al ${toVal || '...'}`;
    }

    label.textContent = text;
    renderActiveTab();
  }

  function getNormalizedStatus(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('cancel')) return 'cancelled';
    if (s.includes('pend')) return 'pending';
    if (s.includes('confir') || s.includes('prepar')) return 'confirmed';
    if (s.includes('camino') || s.includes('delivering')) return 'delivering';
    if (s.includes('entreg') || s.includes('complet') || s.includes('ready')) return 'completed';
    return 'pending';
  }

  function getFilteredOrders() {
    const now = new Date();
    const todayStr = getLocalDateString(now);

    let list = [];
    if (activeRange === 'today') {
      list = orders.filter(o => {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
        return getLocalDateString(d) === todayStr;
      });
    } else if (activeRange === '7days') {
      const limitDate = new Date(now);
      limitDate.setDate(now.getDate() - 6);
      limitDate.setHours(0,0,0,0);
      list = orders.filter(o => {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
        return d >= limitDate;
      });
    } else if (activeRange === '30days') {
      const limitDate = new Date(now);
      limitDate.setDate(now.getDate() - 29);
      limitDate.setHours(0,0,0,0);
      list = orders.filter(o => {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
        return d >= limitDate;
      });
    } else if (activeRange === 'custom') {
      const fromVal = dateFrom.value;
      const toVal = dateTo.value;
      if (fromVal && toVal) {
        const fromDate = new Date(fromVal);
        fromDate.setHours(0,0,0,0);
        const toDate = new Date(toVal);
        toDate.setHours(23,59,59,999);
        list = orders.filter(o => {
          const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
          return d >= fromDate && d <= toDate;
        });
      } else {
        list = [...orders];
      }
    }
    return list.filter(o => getNormalizedStatus(o.status) === 'completed');
  }

  function renderActiveTab() {
    const grid = document.getElementById('breakdown-cards-grid');
    const searchInputEl = document.getElementById('breakdown-search');
    if (!grid || !searchInputEl) return;
    const searchVal = searchInputEl.value.toLowerCase().trim();

    const filteredCompletedOrders = getFilteredOrders();

    if (currentTab === 'users') {
      const userStats = {};
      users.forEach(u => {
        userStats[u.uid] = {
          uid: u.uid,
          name: u.displayName || 'Usuario Desconocido',
          email: u.email || 'Sin correo registrado',
          photo: u.photoURL,
          goId: u.goId || 'S/D',
          ordersCount: 0,
          totalSpent: 0
        };
      });

      filteredCompletedOrders.forEach(o => {
        if (!o.userId) return;
        if (!userStats[o.userId]) {
          userStats[o.userId] = {
            uid: o.userId,
            name: o.userName || 'Usuario Desconocido',
            email: 'Sin correo registrado',
            photo: null,
            goId: o.goId || 'S/D',
            ordersCount: 0,
            totalSpent: 0
          };
        }
        userStats[o.userId].ordersCount++;
        userStats[o.userId].totalSpent += (o.total || 0);
      });

      let list = Object.values(userStats);
      if (searchVal) {
        list = list.filter(item => 
          item.name.toLowerCase().includes(searchVal) || 
          item.email.toLowerCase().includes(searchVal) || 
          item.goId.toLowerCase().includes(searchVal)
        );
      }
      list.sort((a, b) => b.totalSpent - a.totalSpent);

      if (list.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:750;">Sin resultados</div>`;
        return;
      }

      grid.innerHTML = list.map(item => `
        <div class="breakdown-item-card">
          <div class="item-profile">
            <img class="item-avatar" src="${item.photo || '/logo.png'}" referrerpolicy="no-referrer" />
            <div class="item-info">
              <div class="item-name">${item.name}</div>
              <div class="item-desc" title="${item.email}">${item.email}</div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); margin-top:2px;">ID: ${item.goId}</div>
            </div>
          </div>
          
          <div class="stats-badge-row">
            <span class="orders-badge" style="--bg-badge:rgba(168,85,247,0.1); --color-badge:#a855f7;">
              ${item.ordersCount} pedidos
            </span>
            <span class="revenue-metric">
              ${formatPrice(item.totalSpent)}
            </span>
          </div>
        </div>
      `).join('');

    } else if (currentTab === 'deliveries') {
      const driverStats = {};
      users.filter(u => u.isDelivery).forEach(d => {
        driverStats[d.uid] = {
          uid: d.uid,
          name: d.displayName || 'Repartidor Desconocido',
          email: d.email || 'Sin correo registrado',
          photo: d.photoURL,
          deliveryId: d.deliveryId || 'S/D',
          ordersCount: 0,
          totalEarned: 0
        };
      });

      filteredCompletedOrders.forEach(o => {
        if (!o.driverId) return;
        if (!driverStats[o.driverId]) {
          driverStats[o.driverId] = {
            uid: o.driverId,
            name: o.driverName || 'Repartidor Desconocido',
            email: 'Sin correo registrado',
            photo: null,
            deliveryId: o.driverDlId || 'S/D',
            ordersCount: 0,
            totalEarned: 0
          };
        }
        driverStats[o.driverId].ordersCount++;
        driverStats[o.driverId].totalEarned += (o.deliveryCost || 0);
      });

      let list = Object.values(driverStats);
      if (searchVal) {
        list = list.filter(item => 
          item.name.toLowerCase().includes(searchVal) || 
          item.email.toLowerCase().includes(searchVal) || 
          item.deliveryId.toLowerCase().includes(searchVal)
        );
      }
      list.sort((a, b) => b.totalEarned - a.totalEarned);

      if (list.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:750;">Sin resultados</div>`;
        return;
      }

      grid.innerHTML = list.map(item => `
        <div class="breakdown-item-card">
          <div class="item-profile">
            <img class="item-avatar" src="${item.photo || '/logo.png'}" referrerpolicy="no-referrer" />
            <div class="item-info">
              <div class="item-name">${item.name}</div>
              <div class="item-desc" title="${item.email}">${item.email}</div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); margin-top:2px;">ID: ${item.deliveryId}</div>
            </div>
          </div>
          
          <div class="stats-badge-row">
            <span class="orders-badge" style="--bg-badge:rgba(59,130,246,0.1); --color-badge:#3b82f6;">
              ${item.ordersCount} envíos
            </span>
            <span class="revenue-metric" style="color:var(--color-text);">
              ${formatPrice(item.totalEarned)}
            </span>
          </div>
        </div>
      `).join('');

    } else if (currentTab === 'comercios') {
      const storeStats = {};
      comercios.forEach(c => {
        const owner = users.find(u => u.uid === c.ownerId);
        storeStats[c.id] = {
          id: c.id,
          name: c.name || 'Comercio Desconocido',
          logo: c.logo || '/logo.png',
          ownerName: owner ? owner.displayName : 'Sin propietario',
          ownerEmail: owner ? owner.email : 'Sin email',
          ordersCount: 0,
          totalGenerated: 0
        };
      });

      filteredCompletedOrders.forEach(o => {
        if (!o.comercioId) return;
        if (!storeStats[o.comercioId]) {
          storeStats[o.comercioId] = {
            id: o.comercioId,
            name: o.comercioName || 'Comercio Desconocido',
            logo: '/logo.png',
            ownerName: 'Sin propietario',
            ownerEmail: 'Sin email',
            ordersCount: 0,
            totalGenerated: 0
          };
        }
        storeStats[o.comercioId].ordersCount++;
        const prodRevenue = o.subtotal || o.itemsPrice || (o.total - (o.deliveryCost || 0) - (o.appUsageFee || 0));
        storeStats[o.comercioId].totalGenerated += Math.max(0, prodRevenue);
      });

      let list = Object.values(storeStats);
      if (searchVal) {
        list = list.filter(item => 
          item.name.toLowerCase().includes(searchVal) ||
          item.ownerName.toLowerCase().includes(searchVal) ||
          item.ownerEmail.toLowerCase().includes(searchVal)
        );
      }
      list.sort((a, b) => b.totalGenerated - a.totalGenerated);

      if (list.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--color-text-tertiary); font-weight:750;">Sin resultados</div>`;
        return;
      }

      grid.innerHTML = list.map(item => `
        <div class="breakdown-item-card">
          <div class="item-profile">
            <img class="item-avatar" src="${item.logo}" />
            <div class="item-info">
              <div class="item-name">${item.name}</div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); margin-top:2px;">ID: ${item.id.slice(0, 8)}...</div>
            </div>
          </div>

          <!-- Owner Information Details -->
          <div class="owner-subpanel">
            <div class="owner-lbl">Propietario</div>
            <div class="owner-val" style="font-weight:900;">${item.ownerName}</div>
            <div class="owner-val" style="font-size:10.5px; color:var(--color-text-tertiary);" title="${item.ownerEmail}">${item.ownerEmail}</div>
          </div>
          
          <div class="stats-badge-row">
            <span class="orders-badge" style="--bg-badge:rgba(16,185,129,0.1); --color-badge:#10b981;">
              ${item.ordersCount} ventas
            </span>
            <span class="revenue-metric">
              ${formatPrice(item.totalGenerated)}
            </span>
          </div>
        </div>
      `).join('');
    }
  }
}
