// GoDelivery — Admin Users Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot, query, where } from 'firebase/firestore';
import { isSuperAdmin, isAdmin } from '../../auth.js';

let usersUnsubscribe = null;
import { getState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';

let comerciosMap = {};

export async function renderAdminUsers() {
  const content = document.getElementById('app-content');
  const currentUser = getState().user;
  const canChangeRoles = isAdmin();

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;width:100%;position:fixed;top:0;left:0;z-index:1000;overflow:hidden;background:var(--color-bg-secondary);">
      <!-- Fixed Header -->
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:14px;padding:16px 20px;background:var(--color-primary);flex-shrink:0;position:relative;overflow:hidden;box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2);">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <a href="#/admin" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.15);color:white;flex-shrink:0;text-decoration:none;transition:all 0.2s;position:relative;z-index:2;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;min-width:0;position:relative;z-index:2;">
          <h1 style="font-family:var(--font-display);font-weight:900;font-size:20px;color:white;margin:0;line-height:1.2;letter-spacing:-0.02em;display:flex;align-items:center;gap:8px;">
            <span>Gestión de Usuarios</span>
            <span id="users-total-badge" style="display:none; font-size:11px; font-weight:900; color:var(--color-primary); background:white; padding:2px 8px; border-radius:100px; line-height:1.2;">0</span>
          </h1>
          <p id="users-subtitle" style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Panel administrativo de permisos</p>
        </div>
        <button id="users-header-reload-btn" style="background:rgba(255,255,255,0.15); border:none; width:40px; height:40px; border-radius:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; transition:all 0.2s; position:relative; z-index:2;" title="Recargar página">
          ${icon('refresh', 22)}
        </button>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:16px 16px 40px;-webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:20px;">
        <!-- Search Bar -->
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:0 18px; height:56px; display:flex; align-items:center; gap:12px; box-shadow:var(--shadow-sm); flex-shrink:0;">
          <span style="color:var(--color-text-tertiary); display:flex;">${icon('search', 20)}</span>
          <input type="text" id="users-search" placeholder="Buscar usuarios..." style="flex:1; border:none; background:transparent; font-size:15px; font-weight:600; color:var(--color-text); outline:none;" />
        </div>

        <div class="tab-pills" style="display:flex; gap:8px; overflow-x:auto; padding:4px 2px; scrollbar-width:none; flex-shrink:0; min-height:48px; align-items:center;">
          <button class="tab-pill active" data-filter="all">Todos</button>
          <button class="tab-pill" data-filter="cliente">Clientes</button>
          <button class="tab-pill" data-filter="delivery">Repartidores</button>
          <button class="tab-pill" data-filter="chofer">Choferes</button>
          <button class="tab-pill" data-filter="comercio">Comercios</button>
        </div>

        <div id="driver-actions-bar" style="display:none; flex-shrink:0; width:100%; margin-top:-4px;">
          <button id="reset-all-drivers-debt-btn" style="width:100%; height:46px; border-radius:16px; background:linear-gradient(135deg, #ef4444, #dc2626); color:white; border:none; font-weight:800; font-size:13.5px; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; box-shadow:0 6px 16px rgba(239,68,68,0.3); transition:all 0.2s;">
            ${icon('refresh', 16)} Resetear Deuda de Todos los Repartidores ($0)
          </button>
        </div>

        <!-- Advanced Filters & Sorting -->
        <div style="display:flex; gap:10px; flex-shrink:0; width:100%; flex-wrap:wrap; margin-top:-4px;">
          <!-- Sort -->
          <div style="flex:1; min-width:140px; display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; padding-left:4px;">Ordenar por</label>
            <div style="position:relative; display:flex; align-items:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:0 12px; height:44px; box-shadow:var(--shadow-sm);">
              <span style="color:var(--color-text-tertiary); display:flex; margin-right:6px;">${icon('sort', 16)}</span>
              <select id="users-sort" style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none; appearance:none; cursor:pointer; padding-right:20px;">
                <option value="none">Por defecto</option>
                <option value="newest">Más nuevo</option>
                <option value="rating-desc">Mayor puntuación</option>
                <option value="rating-asc">Menor puntuación</option>
              </select>
              <span style="position:absolute; right:12px; color:var(--color-text-tertiary); pointer-events:none; display:flex;">${icon('chevronDown', 14)}</span>
            </div>
          </div>

          <!-- Stars Rating Filter -->
          <div style="flex:1; min-width:140px; display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; padding-left:4px;">Calificación</label>
            <div style="position:relative; display:flex; align-items:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:0 12px; height:44px; box-shadow:var(--shadow-sm);">
              <span style="color:var(--color-text-tertiary); display:flex; margin-right:6px;">${icon('star', 16)}</span>
              <select id="users-stars" style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none; appearance:none; cursor:pointer; padding-right:20px;">
                <option value="all">Todas las estrellas</option>
                <option value="5">5 estrellas</option>
                <option value="4">4+ estrellas</option>
                <option value="3">3+ estrellas</option>
                <option value="under3">Menos de 3 estrellas</option>
                <option value="none">Sin calificación</option>
              </select>
              <span style="position:absolute; right:12px; color:var(--color-text-tertiary); pointer-events:none; display:flex;">${icon('chevronDown', 14)}</span>
            </div>
          </div>

          <!-- OS Filter -->
          <div style="flex:1; min-width:140px; display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; padding-left:4px;">Dispositivo</label>
            <div style="position:relative; display:flex; align-items:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:0 12px; height:44px; box-shadow:var(--shadow-sm);">
              <span style="color:var(--color-text-tertiary); display:flex; margin-right:6px;">${icon('smartphone', 16)}</span>
              <select id="users-os" style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none; appearance:none; cursor:pointer; padding-right:20px;">
                <option value="all">Todos los sistemas</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
                <option value="web">Web / Desktop (o sin registrar)</option>
              </select>
              <span style="position:absolute; right:12px; color:var(--color-text-tertiary); pointer-events:none; display:flex;">${icon('chevronDown', 14)}</span>
            </div>
          </div>

          <!-- Connection Status Filter -->
          <div id="users-connection-filter-container" style="flex:1; min-width:140px; display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; padding-left:4px;">Conexión (Repartidores)</label>
            <div style="position:relative; display:flex; align-items:center; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:12px; padding:0 12px; height:44px; box-shadow:var(--shadow-sm);">
              <span style="color:var(--color-text-tertiary); display:flex; margin-right:6px;">${icon('power', 16)}</span>
              <select id="users-connection" style="flex:1; border:none; background:transparent; font-size:13px; font-weight:700; color:var(--color-text); outline:none; appearance:none; cursor:pointer; padding-right:20px;">
                <option value="all">Todos los estados</option>
                <option value="online">Conectados</option>
                <option value="offline">Desconectados</option>
              </select>
              <span style="position:absolute; right:12px; color:var(--color-text-tertiary); pointer-events:none; display:flex;">${icon('chevronDown', 14)}</span>
            </div>
          </div>
        </div>

        <div id="delivery-requests"></div>
        <div id="trip-requests"></div>

        <div id="users-list" style="display:flex; flex-direction:column; gap:12px;">
          ${Array(3).fill('<div class="stat-card skeleton" style="height:140px; border-radius:20px;"></div>').join('')}
        </div>
      </div>
    </div>

    <style>
      .tab-pill {
        flex: 1; min-width: 100px; white-space: nowrap; padding: 10px 16px; border-radius: 12px; border: 1px solid var(--color-border-light); 
        font-weight: 800; font-size: 13px; cursor: pointer; background: var(--color-surface); color: var(--color-text-tertiary);
        transition: all 0.2s; box-shadow: var(--shadow-sm);
      }
      .tab-pill.active { background: var(--color-primary); color: white; border-color: var(--color-primary); box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3); }
      
      .user-card { background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 24px; padding: 18px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 16px; transition: all 0.2s; }
      .user-card:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.04); border-color: var(--color-border); }
      
      .user-avatar { width: 52px; height: 52px; border-radius: 18px; object-fit: cover; background: var(--color-bg-secondary); border: 2px solid var(--color-bg-secondary); }
      
      .role-toggle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--color-border-light); }
      .role-btn {
        height: 44px; border-radius: 12px; border: 1px solid var(--color-border-light); background: var(--color-bg-secondary);
        color: var(--color-text-tertiary); font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .role-btn:not(:disabled):hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        border-color: var(--color-border);
        background: var(--color-bg-secondary);
      }
      .role-btn.active-admin { background: var(--color-primary); color: white; border-color: var(--color-primary); box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3); }
      .role-btn.active-admin:not(:disabled):hover {
        transform: translateY(-2px);
        background: var(--color-primary);
        box-shadow: 0 6px 16px rgba(var(--color-primary-rgb), 0.4);
      }
      .role-btn.active-comercio { background: var(--color-success); color: white; border-color: var(--color-success); box-shadow: 0 4px 12px rgba(0, 214, 127, 0.3); }
      .role-btn.active-comercio:not(:disabled):hover {
        transform: translateY(-2px);
        background: var(--color-success);
        box-shadow: 0 6px 16px rgba(0, 214, 127, 0.4);
      }
      .role-btn.active-delivery { background: var(--color-warning); color: #000; border-color: var(--color-warning); box-shadow: 0 4px 12px rgba(255, 179, 0, 0.3); }
      .role-btn.active-delivery:not(:disabled):hover {
        transform: translateY(-2px);
        background: var(--color-warning);
        box-shadow: 0 6px 16px rgba(255, 179, 0, 0.4);
      }
      .role-btn.active-chofer { background: #3b82f6; color: white; border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
      .role-btn.active-chofer:not(:disabled):hover {
        transform: translateY(-2px);
        background: #2563eb;
        box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
      }
      .role-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      
      .id-badge { font-size: 10px; font-weight: 900; padding: 3px 10px; border-radius: 8px; font-family: monospace; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .id-go { background: #1e1e2d; color: white; }
      .id-dl { background: #eab308; color: white; }
      .id-ch { background: #3b82f6; color: white; }
      
      .status-badge { font-size: 10px; font-weight: 800; padding: 4px 10px; border-radius: 8px; text-transform: uppercase; display: flex; align-items: center; gap: 5px; }
      .badge-admin { background: var(--color-primary-light); color: var(--color-primary); }
      .badge-comercio { background: var(--color-success-light); color: var(--color-success); }
      .badge-delivery { background: var(--color-warning-light); color: var(--color-warning); }
    </style>
  `;

  let users = [];
  let deliveryLiquidationsMap = {};

  // Wire up the reload button immediately
  const reloadBtn = document.getElementById('users-header-reload-btn');
  if (reloadBtn) {
    reloadBtn.onclick = () => window.location.reload();
  }

  // Unsubscribe previous if any
  if (usersUnsubscribe) {
    usersUnsubscribe();
    usersUnsubscribe = null;
  }

  // Search, Filter & Sort values helper
  let currentFilter = 'all';
  const getSortVal = () => document.getElementById('users-sort')?.value || 'none';
  const getStarsVal = () => document.getElementById('users-stars')?.value || 'all';
  const getOsVal = () => document.getElementById('users-os')?.value || 'all';
  const getConnVal = () => document.getElementById('users-connection')?.value || 'all';

  function updateList() {
    const searchVal = document.getElementById('users-search')?.value || '';
    
    const connFilterContainer = document.getElementById('users-connection-filter-container');
    if (connFilterContainer) {
      if (currentFilter === 'delivery' || currentFilter === 'chofer' || currentFilter === 'all') {
        connFilterContainer.style.display = 'flex';
      } else {
        connFilterContainer.style.display = 'none';
      }
    }

    const driverActionsBar = document.getElementById('driver-actions-bar');
    if (driverActionsBar) {
      if (currentFilter === 'delivery' || currentFilter === 'chofer') {
        driverActionsBar.style.display = 'block';
      } else {
        driverActionsBar.style.display = 'none';
      }
    }

    renderUsersList(users, searchVal, currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal(), getConnVal(), deliveryLiquidationsMap);
  }

  try {
    // Fetch comercios list once
    try {
      const comSnap = await getDocs(collection(db, 'comercios'));
      comerciosMap = {};
      comSnap.docs.forEach(d => {
        comerciosMap[d.id] = d.data();
      });
    } catch (comErr) {
      console.error('Error fetching comercios:', comErr);
    }

    // Set up real-time listener for users
    // Use getDocs for users — avoids costly real-time listener on entire collection
    // Users don't change frequently enough to need real-time in the admin panel
    usersUnsubscribe = onSnapshot(query(collection(db, 'users'), where('role', 'in', ['delivery', 'admin', 'customer', 'comercio'])), async (snap) => {
      users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

      const totalBadge = document.getElementById('users-total-badge');
      if (totalBadge) {
        totalBadge.textContent = `${users.length}`;
        totalBadge.style.display = 'inline-block';
      }

      const androidCount = users.filter(u => u.deviceOS === 'android').length;
      const iosCount = users.filter(u => u.deviceOS === 'ios').length;
      const subtitle = document.getElementById('users-subtitle');
      if (subtitle) {
        subtitle.textContent = `Panel administrativo • ${androidCount} Android • ${iosCount} iOS`;
      }

      // Fetch delivery_transactions to compute liquidations per driver
      try {
        const transSnap = await getDocs(collection(db, 'delivery_transactions'));
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);

        deliveryLiquidationsMap = {};
        transSnap.docs.forEach(dDoc => {
          const tData = dDoc.data();
          const dId = tData.driverId;
          if (!dId) return;

          if (!deliveryLiquidationsMap[dId]) {
            deliveryLiquidationsMap[dId] = { week: 0, month: 0, total: 0 };
          }

          const amt = Number(tData.amount || 0);
          if (tData.type === 'settlement' || tData.type === 'pago') {
            deliveryLiquidationsMap[dId].total += amt;
            const tDate = tData.createdAt ? (tData.createdAt.toDate ? tData.createdAt.toDate() : new Date(tData.createdAt)) : null;
            if (tDate) {
              if (tDate >= startOfWeek) deliveryLiquidationsMap[dId].week += amt;
              if (tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear) deliveryLiquidationsMap[dId].month += amt;
            }
          }
        });

        users.forEach(u => {
          const liq = deliveryLiquidationsMap[u.uid] || { week: 0, month: 0, total: 0 };
          u.weekLiquidated = liq.week;
          u.monthLiquidated = liq.month;
          u.totalLiquidated = liq.total;
        });
      } catch (tErr) {
        console.warn('Error fetching driver liquidations:', tErr);
      }

      // Re-trigger rendering
      updateList();
    });

  } catch (e) { 
    console.error(e); 
  }

  document.getElementById('users-search')?.addEventListener('input', updateList);
  document.getElementById('users-sort')?.addEventListener('change', updateList);
  document.getElementById('users-stars')?.addEventListener('change', updateList);
  document.getElementById('users-os')?.addEventListener('change', updateList);
  document.getElementById('users-connection')?.addEventListener('change', updateList);

  document.getElementById('reset-all-drivers-debt-btn')?.addEventListener('click', () => {
    showConfirm({
      title: '⚠️ RESETEAR DEUDA DE REPARTIDORES',
      message: '¿Estás seguro de que deseas poner en <b>$0</b> la deuda de TODOS los repartidores de la plataforma?',
      danger: true,
      confirmText: 'Sí, resetear todo a $0',
      onConfirm: async () => {
        try {
          const { writeBatch, collection: fCollection, getDocs: fGetDocs } = await import('firebase/firestore');
          const snap = await fGetDocs(fCollection(db, 'users'));
          const batch = writeBatch(db);
          let count = 0;
          snap.docs.forEach(docSnap => {
            const uData = docSnap.data();
            if (uData.isDelivery || uData.tripStatus === 'approved' || uData.role === 'delivery' || uData.role === 'chofer' || uData.role === 'driver') {
              batch.update(docSnap.ref, { deliveryDebt: 0 });
              uData.deliveryDebt = 0;
              count++;
            }
          });
          await batch.commit();
          showToast(`¡Se reseteó a $0 la deuda de ${count} repartidores!`, 'success');
          updateList();
        } catch (err) {
          console.error('Error resetting driver debts:', err);
          showToast('Error al resetear deudas', 'error');
        }
      }
    });
  });

  document.querySelectorAll('.tab-pill').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      updateList();
    };
  });

  // Delegated Clicks with Strict Priority Sequence to prevent ratings modal override
  document.getElementById('users-list')?.addEventListener('click', async (e) => {
    // 1. Delete Action Click
    const deleteBtn = e.target.closest('[data-action="delete"]');
    if (deleteBtn) {
      const { uid } = deleteBtn.dataset;
      if (uid === currentUser.uid) {
        showToast('No podés eliminarte a vos mismo', 'warning');
        return;
      }
      showConfirm({
        title: 'ELIMINAR USUARIO',
        message: '¿Estás seguro de que deseas eliminar permanentemente a este usuario y todos sus datos asociados de la plataforma?',
        danger: true,
        confirmText: 'Sí, eliminar',
        onConfirm: async () => {
          try {
            // Delete user doc from Firestore
            await deleteDoc(doc(db, 'users', uid));
            // Delete commerce doc if exists
            await deleteDoc(doc(db, 'comercios', uid));

            // Remove reactively from local array
            const idx = users.findIndex(x => x.uid === uid);
            if (idx !== -1) {
              users.splice(idx, 1);
            }

            // Re-render list and update total badge
            const searchVal = document.getElementById('users-search')?.value || '';
            renderUsersList(users, searchVal, currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());

            const totalBadge = document.getElementById('users-total-badge');
            if (totalBadge) {
              totalBadge.textContent = `${users.length}`;
            }

            showToast('Usuario eliminado con éxito', 'success');
          } catch (err) {
            console.error('Error deleting user:', err);
            showToast('Error al eliminar el usuario', 'error');
          }
        }
      });
      return;
    }



    // 2.3. Toggle Canon Daily Status Click
    const canonToggleBtn = e.target.closest('[data-toggle-canon]');
    if (canonToggleBtn) {
      const uid = canonToggleBtn.dataset.toggleCanon;
      const targetUser = users.find(u => u.uid === uid);
      if (!targetUser) return;

      const todayStr = new Date().toISOString().split('T')[0];
      const isCurrentlyActive = targetUser.lastCanonDate === todayStr;
      const newStatus = isCurrentlyActive ? null : todayStr;

      showConfirm({
        title: isCurrentlyActive ? 'Bloquear Jornada' : 'Habilitar Jornada',
        message: `¿Querés ${isCurrentlyActive ? 'BLOQUEAR' : 'HABILITAR'} la jornada de hoy (${todayStr}) para ${targetUser.displayName}?`,
        onConfirm: async () => {
          try {
            const canonDocRef = doc(db, 'delivery_canon_payments', `${uid}_${todayStr}`);
            if (newStatus) {
              await setDoc(canonDocRef, {
                driverId: uid,
                dateStr: todayStr,
                status: 'approved',
                amount: 2000,
                updatedAt: serverTimestamp()
              }, { merge: true });
              await updateDoc(doc(db, 'users', uid), { lastCanonDate: todayStr, lastCanonChargeDate: todayStr });
              targetUser.lastCanonDate = todayStr;
              targetUser.lastCanonChargeDate = todayStr;
              showToast(`Jornada habilitada para ${targetUser.displayName}`, 'success');
            } else {
              await setDoc(canonDocRef, { status: 'revoked', updatedAt: serverTimestamp() }, { merge: true });
              await updateDoc(doc(db, 'users', uid), { lastCanonDate: null, lastCanonChargeDate: null });
              targetUser.lastCanonDate = null;
              targetUser.lastCanonChargeDate = null;
              showToast(`Jornada bloqueada / reseteada para ${targetUser.displayName}`, 'info');
            }
            renderUsersList(users, document.getElementById('users-search')?.value || '', currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());
          } catch (err) {
            console.error('Error toggling canon:', err);
            showToast('Error al actualizar el canon diario', 'error');
          }
        }
      });
      return;
    }

    // 2.4. Toggle Canon Exemption Click
    const canonExemptBtn = e.target.closest('[data-toggle-canon-exempt]');
    if (canonExemptBtn) {
      const uid = canonExemptBtn.dataset.toggleCanonExempt;
      const targetUser = users.find(u => u.uid === uid);
      if (!targetUser) return;

      const newExemptState = !targetUser.isCanonExempt;
      showConfirm({
        title: newExemptState ? 'Eximir de Canon' : 'Quitar Exención',
        message: `¿Querés ${newExemptState ? 'EXIMIR permanentemente' : 'REQUERIR canon'} de pago a ${targetUser.displayName}?`,
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'users', uid), { isCanonExempt: newExemptState });
            targetUser.isCanonExempt = newExemptState;
            renderUsersList(users, document.getElementById('users-search')?.value || '', currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());
            showToast(`Exención actualizada para ${targetUser.displayName}`, 'success');
          } catch (err) {
            console.error('Error toggling canon exemption:', err);
            showToast('Error al actualizar exención', 'error');
          }
        }
      });
      return;
    }

    // 2.5. Edit Vehicle Click
    const editVehicleBtn = e.target.closest('[data-edit-vehicle]');
    if (editVehicleBtn) {
      const uid = editVehicleBtn.dataset.editVehicle;
      const targetUser = users.find(u => u.uid === uid);
      if (!targetUser) return;
      
      showEditVehicleModal(targetUser, () => {
        renderUsersList(users, document.getElementById('users-search')?.value || '', currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());
      });
      return;
    }

    // 3. Toggle Role Click
    const toggleBtn = e.target.closest('[data-toggle]');
    if (toggleBtn && canChangeRoles) {
      const { uid, toggle: field } = toggleBtn.dataset;
      const targetUser = users.find(u => u.uid === uid);
      if (!targetUser) return;
      
      if (uid === currentUser.uid && field === 'isAdmin') {
        showToast('No podés quitarte tus propios permisos de Administrador', 'warning');
        return;
      }

      const newValue = field === 'isChofer' ? targetUser.tripStatus !== 'approved' : !targetUser[field];
      showConfirm({
        title: 'Actualizar Acceso',
        message: `¿Querés ${newValue ? 'ACTIVAR' : 'DESACTIVAR'} el permiso de <b>${field === 'isChofer' ? 'Chofer' : field.replace('is', '')}</b> para ${targetUser.displayName}?`,
        onConfirm: async () => {
          try {
            const updateData = {};
            if (field === 'isChofer') {
              if (newValue) {
                updateData.tripStatus = 'approved';
                updateData['tripApplication.status'] = 'approved';
                updateData.isDelivery = true;
                updateData.deliveryMode = 'both';
                updateData.role = 'chofer';
              } else {
                updateData.tripStatus = 'rejected';
                updateData['tripApplication.status'] = 'rejected';
                if (targetUser.role === 'chofer' || targetUser.role === 'delivery' || targetUser.role === 'driver') {
                  updateData.role = 'user';
                }
              }
            } else {
              updateData[field] = newValue;
            }
            
            if (field === 'isDelivery') {
              if (newValue) {
                updateData.deliveryStatus = 'approved';
                updateData.role = 'delivery';
                if (!targetUser.deliveryId) {
                  const { runTransaction, doc: fDoc } = await import('firebase/firestore');
                  await runTransaction(db, async (t) => {
                    const sRef = fDoc(db, 'settings', 'delivery');
                    const sSnap = await t.get(sRef);
                    const nId = (sSnap.exists() ? sSnap.data().lastDeliveryId || 1000 : 1000) + 1;
                    t.set(sRef, { lastDeliveryId: nId }, { merge: true });
                    updateData.deliveryId = `DL-${nId}`;
                  });
                }
              } else {
                const { deleteField } = await import('firebase/firestore');
                updateData.deliveryId = deleteField();
                updateData.deliveryStatus = deleteField();
                if (targetUser.role === 'delivery' || targetUser.role === 'chofer' || targetUser.role === 'driver') {
                  updateData.role = 'user';
                }
              }
            }
            
            if (field === 'isComercio') {
              if (newValue) {
                if (targetUser.isAdmin || targetUser.role === 'admin') {
                  showToast('Los administradores no pueden tener un comercio personal.', 'warning');
                  return;
                }
                const name = prompt('Nombre del Comercio:', targetUser.displayName);
                if (!name) return;
                
                const trimmedName = name.trim();
                
                // Validate unique name in Firestore
                const { query, where, getDocs } = await import('firebase/firestore');
                const comsSnap = await getDocs(query(collection(db, 'comercios'), where('name', '==', trimmedName)));
                if (!comsSnap.empty) {
                  showToast(`El nombre de comercio "${trimmedName}" ya está registrado por otra cuenta.`, 'error');
                  return;
                }
                
                await setDoc(doc(db, 'comercios', uid), { ownerId: uid, name: trimmedName, isActive: true, createdAt: serverTimestamp() });
                updateData.role = 'comercio';
              } else {
                if (targetUser.role === 'comercio') {
                  updateData.role = 'user';
                }
              }
            }

            if (field === 'isAdmin') {
              if (newValue) {
                updateData.role = 'admin';
                updateData.isComercio = false;
              } else {
                updateData.role = 'user';
              }
            }

            await updateDoc(doc(db, 'users', uid), updateData);
            
            // Local update for UI
            if (newValue === false && field === 'isDelivery') {
               delete targetUser.deliveryId;
               delete targetUser.deliveryStatus;
            }
            if (field === 'isChofer') {
              if (newValue) {
                targetUser.tripStatus = 'approved';
                targetUser.isDelivery = true;
                targetUser.deliveryMode = 'both';
              } else {
                targetUser.tripStatus = 'rejected';
              }
            }
            Object.assign(targetUser, updateData);
            renderUsersList(users, document.getElementById('users-search')?.value || '', currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());
            showToast('Actualizado', 'success');
          } catch (err) { 
            console.error(err);
            showToast('Error al actualizar', 'error'); 
          }
        }
      });
      return;
    }

    // 4. View Ratings Modal Click
    const viewRatingsBtn = e.target.closest('[data-view-ratings]');
    if (viewRatingsBtn) {
      const uid = viewRatingsBtn.dataset.viewRatings;
      const targetUser = users.find(u => u.uid === uid);
      if (targetUser) {
        showUserRatingsModal(targetUser);
      }
      return;
    }

    // 5. Award Points Modal Click
    const awardPointsBtn = e.target.closest('[data-award-points]');
    if (awardPointsBtn) {
      const uid = awardPointsBtn.dataset.awardPoints;
      const targetUser = users.find(u => u.uid === uid);
      if (targetUser) {
        showAwardPointsModal(targetUser, users, currentUser);
      }
      return;
    }

    // 5.5 Open Chat Click
    const openChatBtn = e.target.closest('[data-open-chat]');
    if (openChatBtn) {
      const uid = openChatBtn.dataset.openChat;
      const targetUser = users.find(u => u.uid === uid);
      if (targetUser) {
        const { collection, query, where, getDocs, addDoc, serverTimestamp: fServerTimestamp } = await import('firebase/firestore');
        try {
          const q = query(collection(db, 'support_chats'), where('userId', '==', uid));
          const snap = await getDocs(q);
          const activeDoc = snap.docs.find(d => d.data().status !== 'closed' && d.id !== uid);

          let docId;
          if (activeDoc) {
            docId = activeDoc.id;
          } else {
            const isComercio = targetUser.isComercio || targetUser.role === 'comercio';
            const commerceName = isComercio ? (comerciosMap[uid]?.name || 'Tienda sin nombre') : null;
            const ticketNum = Math.floor(100000 + Math.random() * 900000);
            
            const newDocRef = await addDoc(collection(db, 'support_chats'), {
              userName: commerceName || targetUser.displayName || 'Usuario',
              userPhoto: targetUser.photoURL || '/logo.png',
              userId: uid,
              status: 'open',
              ticketId: `#TK-${ticketNum}`,
              createdAt: fServerTimestamp(),
              lastMessageText: 'Conversación iniciada por el administrador',
              lastMessageTime: fServerTimestamp(),
              unreadByAdmin: false,
              unreadByUser: true,
              messages: []
            });
            docId = newDocRef.id;
          }
          // Set in sessionStorage so the support chats page knows which chat to open
          sessionStorage.setItem('admin-support-chat-target', docId);
          // Redirect to support chats
          location.hash = '#/admin/support-chats';
        } catch (err) {
          console.error('Error starting support chat:', err);
          showToast('Error al iniciar chat de soporte', 'error');
        }
      }
      return;
    }
  });

  renderDeliveryRequests(users, canChangeRoles);
  renderTripRequests(users, canChangeRoles);
}

function renderUsersList(users, search, currentUser, canChangeRoles, filter = 'all', sortVal = 'none', starsVal = 'all', osVal = 'all', connVal = 'all') {
  const container = document.getElementById('users-list');
  if (!container) return;

  // 1. Role Filter
  let filtered = users;
  if (filter === 'cliente') {
    filtered = filtered.filter(u => !u.isDelivery && !u.isComercio && !u.isAdmin && u.role !== 'admin');
  } else if (filter === 'comercio') {
    filtered = filtered.filter(u => u.isComercio || u.role === 'comercio');
  } else if (filter === 'delivery') {
    filtered = filtered.filter(u => u.isDelivery && u.tripStatus !== 'approved');
  } else if (filter === 'chofer') {
    filtered = filtered.filter(u => u.tripStatus === 'approved');
  }

  // 1.5 Connection Status Filter — isOnline:true is the sole truth
  if (connVal && connVal !== 'all') {
    filtered = filtered.filter(u => {
      const isOnline = u.isOnline === true;
      return connVal === 'online' ? isOnline : !isOnline;
    });
  }

  // Helper to calculate rating stats
  const calculateStats = (u) => {
    const ratings = u.ratings || [];
    const count = ratings.length;
    const avg = count ? ratings.reduce((sum, r) => sum + r.rating, 0) / count : 0;
    return { count, avg };
  };

  // 2. Stars Filter
  if (starsVal !== 'all') {
    filtered = filtered.filter(u => {
      const { count, avg } = calculateStats(u);
      if (starsVal === 'none') return count === 0;
      if (count === 0) return false;
      if (starsVal === '5') return avg === 5;
      if (starsVal === '4') return avg >= 4;
      if (starsVal === '3') return avg >= 3;
      if (starsVal === 'under3') return avg < 3;
      return true;
    });
  }

  // 3. Search Filter
  if (search) {
    const s = search.toLowerCase().trim();
    filtered = filtered.filter(u => 
      (u.displayName || '').toLowerCase().includes(s) || 
      (u.email || '').toLowerCase().includes(s) ||
      (u.goId || '').toLowerCase().includes(s) ||
      (u.deliveryId || '').toLowerCase().includes(s)
    );
  }

  // 3.5 OS Filter
  if (osVal && osVal !== 'all') {
    filtered = filtered.filter(u => (u.deviceOS || 'web') === osVal);
  }

  // 4. Sorting
  if (sortVal !== 'none') {
    filtered.sort((a, b) => {
      const aStats = calculateStats(a);
      const bStats = calculateStats(b);
      
      if (sortVal === 'newest') {
        const aTime = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt).getTime()) : 0;
        const bTime = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime()) : 0;
        return bTime - aTime;
      }
      if (sortVal === 'rating-desc') {
        if (aStats.count === 0 && bStats.count === 0) return 0;
        if (aStats.count === 0) return 1;
        if (bStats.count === 0) return -1;
        return bStats.avg - aStats.avg;
      }
      if (sortVal === 'rating-asc') {
        if (aStats.count === 0 && bStats.count === 0) return 0;
        if (aStats.count === 0) return 1;
        if (bStats.count === 0) return -1;
        return aStats.avg - bStats.avg;
      }
      return 0;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary); font-weight:700;">
        No se encontraron usuarios con los filtros aplicados.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(u => {
    const isMe = u.uid === currentUser.uid;
    const { count, avg } = calculateStats(u);
    const avgText = count > 0 ? avg.toFixed(1) : null;

    let connectionBadgeHTML = '';
    if (u.isDelivery || u.tripStatus === 'approved') {
      const isOnline = u.isOnline === true;
      let lastAct = null;
      if (u.lastActivityAt) {
        lastAct = u.lastActivityAt.toDate ? u.lastActivityAt.toDate() : new Date(u.lastActivityAt);
      }

      let lastActText = '';
      if (lastAct) {
        const diffMins = Math.floor((Date.now() - lastAct.getTime()) / 60000);
        if (diffMins < 1) lastActText = 'Ahora';
        else if (diffMins < 60) lastActText = `${diffMins}m`;
        else if (diffMins < 1440) lastActText = `${Math.floor(diffMins / 60)}h`;
        else lastActText = `${Math.floor(diffMins / 1440)}d`;
      }

      if (isOnline) {
        connectionBadgeHTML = `
          <span class="id-badge" style="background:rgba(34,197,94,0.1); color:#22c55e; border:1px solid rgba(34,197,94,0.2); font-weight:850; display:inline-flex; align-items:center; gap:4.5px;">
            <span style="width:6px; height:6px; background:#22c55e; border-radius:50%; box-shadow:0 0 6px #22c55e;"></span>
            Online${lastActText ? ` · ${lastActText}` : ''}
          </span>
        `;
      } else {
        connectionBadgeHTML = `
          <span class="id-badge" style="background:rgba(148,163,184,0.1); color:#64748b; border:1px solid rgba(148,163,184,0.2); font-weight:850; display:inline-flex; align-items:center; gap:4.5px;">
            <span style="width:6px; height:6px; background:#64748b; border-radius:50%;"></span>
            Offline${lastActText ? ` · ${lastActText}` : ''}
          </span>
        `;
      }
    }

    const isComercio = u.isComercio || u.role === 'comercio';
    const commerceData = isComercio ? comerciosMap[u.uid] : null;
    const phone = commerceData?.phone || commerceData?.whatsapp || u.phone || u.phoneNumber;
    const phoneHTML = phone ? `
      <div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:4px; font-weight:600; display:flex; align-items:center; gap:4px;">
        ${icon('phone', 12)} +54 ${phone}
      </div>
    ` : '';

    const ratingBadgeHTML = avgText !== null ? `
      <span class="status-badge" data-view-ratings="${u.uid}" style="background:rgba(251,191,36,0.1); color:#d97706; border:1px solid rgba(251,191,36,0.2); cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px; font-weight:800; transition:all 0.2s;" onmouseover="this.style.background='rgba(251,191,36,0.18)'" onmouseout="this.style.background='rgba(251,191,36,0.1)'">
        ${icon('star', 12)} ${avgText} (${count} ${count === 1 ? 'reseña' : 'reseñas'})
      </span>
    ` : `
      <span class="status-badge" data-view-ratings="${u.uid}" style="background:var(--color-bg-secondary); color:var(--color-text-tertiary); border:1px solid var(--color-border-light); cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px; font-weight:700; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)'" onmouseout="this.style.background='var(--color-bg-secondary)'">
        ${icon('star', 12)} Sin calificaciones
      </span>
    `;
    
    return `
      <div class="user-card" style="position:relative; ${isMe ? 'border: 1px solid var(--color-primary);' : ''}">
        ${!isMe ? `
          <button style="position:absolute; top:12px; right:12px; width:36px; height:36px; border-radius:10px; border:none; background:rgba(239,68,68,0.08); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;" data-action="delete" data-uid="${u.uid}">
            ${icon('trash', 16)}
          </button>
        ` : ''}

        <div class="user-info-row" data-view-ratings="${u.uid}" style="display:flex; gap:16px; align-items:flex-start; cursor:pointer;" title="Click para ver reseñas">
          <img src="${u.photoURL || '/logo.png'}" class="user-avatar" style="flex-shrink:0;" referrerpolicy="no-referrer" />
          <div style="flex:1; min-width:0; padding-right: 40px;">
            <div style="font-weight:800; font-size:16px; color:var(--color-text); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              ${commerceData ? `🏪 ${commerceData.name || 'Tienda sin nombre'}` : (u.displayName || 'Sin nombre')}
              ${isMe ? '<span style="font-size:10px; font-weight:800; color:var(--color-primary); background:rgba(var(--color-primary-rgb),0.1); padding:1px 6px; border-radius:4px;">VOS</span>' : ''}
            </div>
            ${commerceData ? `<div style="font-size:12px; color:var(--color-text-tertiary); margin-bottom:2px; font-weight:600;">Dueño/a: ${u.displayName || 'Sin nombre'}</div>` : ''}
            ${u.email ? `<div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:4px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.email}</div>` : ''}
            ${phoneHTML}
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
              <span class="id-badge id-go">${u.goId || '...'}</span>
              ${u.deliveryId ? `<span class="id-badge id-dl">${u.deliveryId}</span>` : ''}
              ${u.tripStatus === 'approved' ? `<span class="id-badge id-ch" style="cursor:pointer;" data-toggle="isChofer" data-uid="${u.uid}">Chofer</span>` : ''}
              ${connectionBadgeHTML}
              <span class="id-badge" style="background:#fbbf24; color:white; display:inline-flex; align-items:center; gap:3.5px;">
                ${icon('goPointsLogo', 10)} ${u.points || 0} pts
              </span>
              ${u.deviceOS === 'android' ? `<span class="id-badge" style="background:#3ddc84; color:black; display:inline-flex; align-items:center; gap:3.5px;">${icon('smartphone', 10)} Android</span>` : ''}
              ${u.deviceOS === 'ios' ? `<span class="id-badge" style="background:#000000; color:white; display:inline-flex; align-items:center; gap:3.5px;">${icon('smartphone', 10)} iOS</span>` : ''}
              ${ratingBadgeHTML}
            </div>
          </div>
        </div>



        <!-- Dedicated Reviews and Award Points Action Buttons -->
        <div style="display:grid; grid-template-columns: ${isMe ? '1fr 1fr' : '1fr 1fr 1fr'}; gap:10px; margin-top: 8px;">
          <button data-view-ratings="${u.uid}" style="height:42px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text); font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)';" onmouseout="this.style.background='var(--color-bg-secondary)';">
            ${icon('star', 12)} Reseñas (${count})
          </button>
          <button data-award-points="${u.uid}" style="height:42px; border-radius:12px; border:1px solid rgba(245, 158, 11, 0.25); background:rgba(245, 158, 11, 0.05); color:#d97706; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(245, 158, 11, 0.12)';" onmouseout="this.style.background='rgba(245, 158, 11, 0.05)';">
            ${icon('sparkles', 12)} Puntos
          </button>
          ${!isMe ? `
            <button data-open-chat="${u.uid}" style="height:42px; border-radius:12px; border:1px solid rgba(var(--color-primary-rgb), 0.25); background:rgba(var(--color-primary-rgb), 0.05); color:var(--color-primary); font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(var(--color-primary-rgb), 0.12)';" onmouseout="this.style.background='rgba(var(--color-primary-rgb), 0.05)';">
              ${icon('chat', 12)} Chat
            </button>
          ` : ''}
        </div>

        ${(!isMe && phone) ? (() => {
          let formattedPhone = phone.toString().replace(/\D/g, '');
          if (!formattedPhone.startsWith('54')) {
            if (formattedPhone.length === 10) {
              formattedPhone = '549' + formattedPhone;
            } else {
              formattedPhone = '54' + formattedPhone;
            }
          } else if (formattedPhone.startsWith('54') && !formattedPhone.startsWith('549') && formattedPhone.length === 12) {
            formattedPhone = '549' + formattedPhone.slice(2);
          }
          return `
            <div style="margin-top: 10px;">
              <a href="https://wa.me/${formattedPhone}" target="_blank" style="height:42px; border-radius:12px; border:1px solid rgba(34, 197, 94, 0.3); background:rgba(34, 197, 94, 0.05); color:#22c55e; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; text-decoration:none; transition:all 0.2s;" onmouseover="this.style.background='rgba(34, 197, 94, 0.12)';" onmouseout="this.style.background='rgba(34, 197, 94, 0.05)';">
                ${icon('whatsapp', 14)} Contactar por WhatsApp
              </a>
            </div>
          `;
        })() : ''}



        ${canChangeRoles ? `
          <div style="margin-top: 4px; padding-top: 14px; border-top: 1px solid var(--color-border-light);">
            <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Roles y Permisos</div>
            <div class="role-toggle-grid" style="margin-top: 0; padding-top: 0; border-top: none;">
              <button class="role-btn ${u.isAdmin || u.role === 'admin' ? 'active-admin' : ''}" data-toggle="isAdmin" data-uid="${u.uid}">
                ${icon('shield', 14)} Admin
              </button>
              <button class="role-btn ${u.isComercio || u.role === 'comercio' ? 'active-comercio' : ''}" data-toggle="isComercio" data-uid="${u.uid}">
                ${icon('store', 14)} Tienda
              </button>
              <button class="role-btn ${u.isDelivery ? 'active-delivery' : ''}" data-toggle="isDelivery" data-uid="${u.uid}">
                ${icon('bike', 14)} Delivery
              </button>
              <button class="role-btn ${u.tripStatus === 'approved' ? 'active-chofer' : ''}" data-toggle="isChofer" data-uid="${u.uid}">
                ${icon('car', 14)} Chofer
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function showUserRatingsModal(u) {
  const ratings = (u.ratings || []).filter(Boolean);
  const count = ratings.length;
  const avg = count ? (ratings.reduce((sum, r) => sum + r.rating, 0) / count).toFixed(1) : 'Sin calificación';

  // Sort ratings by date desc safely supporting Firestore Timestamps and strings
  const sortedRatings = [...ratings].sort((a, b) => {
    let dateA = 0;
    let dateB = 0;
    
    if (a.createdAt) {
      if (a.createdAt.toDate && typeof a.createdAt.toDate === 'function') {
        dateA = a.createdAt.toDate().getTime();
      } else {
        const d = new Date(a.createdAt);
        dateA = isNaN(d.getTime()) ? 0 : d.getTime();
      }
    }
    
    if (b.createdAt) {
      if (b.createdAt.toDate && typeof b.createdAt.toDate === 'function') {
        dateB = b.createdAt.toDate().getTime();
      } else {
        const d = new Date(b.createdAt);
        dateB = isNaN(d.getTime()) ? 0 : d.getTime();
      }
    }
    
    return dateB - dateA;
  });

  // Render list of reviews
  let reviewsListHTML = '';
  if (count === 0) {
    reviewsListHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; text-align:center; color:var(--color-text-tertiary); flex:1;">
        <div style="background:var(--color-bg-secondary); border-radius:50%; width:80px; height:80px; display:flex; align-items:center; justify-content:center; margin-bottom:16px;">
          ${icon('star', 36)}
        </div>
        <h4 style="font-size:16px; font-weight:800; color:var(--color-text); margin:0 0 6px;">Sin reseñas aún</h4>
        <p style="font-size:12px; max-width:240px; margin:0; line-height:1.4;">Este usuario todavía no ha recibido ninguna calificación en la plataforma.</p>
      </div>
    `;
  } else {
    reviewsListHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; padding:20px 16px; overflow-y:auto; flex:1;">
        ${sortedRatings.map((r, idx) => {
          const starsHTML = Array(5).fill(0).map((_, i) => `
            <span style="color:${i < r.rating ? '#fbbf24' : 'var(--color-border-light)'}; font-size:16px;">★</span>
          `).join('');
          
          let date = 'Fecha no registrada';
          if (r.createdAt) {
            try {
              let parsedDate = null;
              if (r.createdAt.toDate && typeof r.createdAt.toDate === 'function') {
                parsedDate = r.createdAt.toDate();
              } else {
                parsedDate = new Date(r.createdAt);
              }
              
              if (parsedDate && !isNaN(parsedDate.getTime())) {
                date = parsedDate.toLocaleDateString('es-AR', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
              }
            } catch (err) {
              console.error('Error parsing date:', err);
            }
          }

          let authorHTML = '';
          if (r.userName) {
            authorHTML = `Escrita por: <b>${r.userName}</b>`;
            if (r.comercioName) {
              authorHTML += ` • Tienda: <b>${r.comercioName}</b>`;
            }
          } else if (r.orderId) {
            authorHTML = `<span id="review-author-${r.orderId}-${idx}" style="opacity: 0.7;">Cargando autor...</span>`;
          } else {
            authorHTML = `Reseña Anónima`;
          }

          return `
            <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:8px; box-shadow:var(--shadow-sm); animation: fadeIn 0.3s ease-out;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; gap:2px;">
                  ${starsHTML}
                </div>
                <span style="font-size:11px; color:var(--color-text-tertiary); font-weight:700;">${date}</span>
              </div>
              <p style="margin:0; font-size:13px; font-weight:600; color:var(--color-text-secondary); line-height:1.4; white-space:pre-wrap; font-style:italic;">
                "${r.comment || 'Sin comentarios'}"
              </p>
              <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--color-success);"></span>
                <span style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); letter-spacing:0.02em;">
                  ${authorHTML}
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  const modalBodyContent = `
    <div style="display:flex; flex-direction:column; height:100%; overflow:hidden; background:var(--color-bg-secondary);">
      <!-- Summary Bar -->
      <div style="background:var(--color-surface); border-bottom:1px solid var(--color-border-light); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
        <div style="display:flex; flex-direction:column;">
          <span style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Promedio General</span>
          <span style="font-size:24px; font-weight:900; color:var(--color-text); display:flex; align-items:center; gap:6px; line-height:1;">
            ⭐ ${avg}
          </span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">Total Reseñas</span>
          <span style="font-size:16px; font-weight:800; color:var(--color-text); display:block; line-height:1.2; margin-top:2px;">${count}</span>
        </div>
      </div>
      
      <!-- List of reviews -->
      <div style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
        ${reviewsListHTML}
      </div>
    </div>
  `;

  showModal({
    title: `Reseñas de ${u.displayName || 'Usuario'}`,
    content: modalBodyContent,
    height: '80dvh'
  });

  // Asynchronously enrich ratings that don't have author info but have orderId
  if (count > 0) {
    setTimeout(async () => {
      const fetchPromises = sortedRatings.map(async (r, idx) => {
        if (!r.orderId || r.userName) return; // Skip if no orderId or already has userName
        try {
          const orderRef = doc(db, 'orders', r.orderId);
          const orderSnap = await getDoc(orderRef);
          if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            const el = document.getElementById(`review-author-${r.orderId}-${idx}`);
            if (el) {
              let authorText = '';
              // If viewed user is delivery, reviewer is client
              if (u.isDelivery) {
                authorText = `Escrita por: <b>${orderData.userName || 'Cliente'}</b>`;
                if (orderData.comercioName) {
                  authorText += ` • Tienda: <b>${orderData.comercioName}</b>`;
                }
              } else {
                // If viewed user is client, reviewer is delivery driver or commerce
                if (orderData.driverName) {
                  authorText = `Escrita por: <b>${orderData.driverName}</b> (Repartidor)`;
                } else if (orderData.comercioName) {
                  authorText = `Escrita por: <b>${orderData.comercioName}</b> (Tienda)`;
                } else {
                  authorText = `Reseña de Pedido #${r.orderId.slice(-4).toUpperCase()}`;
                }
              }
              el.innerHTML = authorText;
            }
          } else {
            const el = document.getElementById(`review-author-${r.orderId}-${idx}`);
            if (el) el.innerHTML = 'Reseña Anónima';
          }
        } catch (err) {
            console.error('Error enriching review:', err);
          const el = document.getElementById(`review-author-${r.orderId}-${idx}`);
          if (el) el.innerHTML = 'Reseña Anónima';
        }
      });
      await Promise.all(fetchPromises);
    }, 100);
  }
}

function renderDeliveryRequests(users, canChangeRoles) {
  const container = document.getElementById('delivery-requests');
  if (!container || !canChangeRoles) return;
  const pending = users.filter(u => u.deliveryStatus === 'pending');
  if (pending.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div style="background:rgba(var(--color-primary-rgb), 0.05); border:1px dashed var(--color-primary); padding:16px; border-radius:24px; margin-bottom:4px;">
      <h3 style="font-size:11px; font-weight:800; color:var(--color-primary); text-transform:uppercase; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
        ${icon('bike', 14)} Solicitudes de Repartidor (${pending.length})
      </h3>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${pending.map(u => `
          <div class="pending-request-item" data-uid="${u.uid}" style="background:var(--color-surface); border:1px solid var(--color-border-light); padding:10px 14px; border-radius:16px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.borderColor='var(--color-primary-light)'" onmouseout="this.style.borderColor='var(--color-border-light)'">
            <img src="${u.photoURL || '/logo.png'}" style="width:36px; height:36px; border-radius:10px;" referrerpolicy="no-referrer" />
            <div style="flex:1; min-width:0;">
              <div style="font-weight:800; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--color-text-primary);">${u.displayName || u.email}</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px;">Ver detalles profesionales</div>
            </div>
            <div style="color:var(--color-primary); display:flex;">${icon('chevronRight', 16)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.pending-request-item').forEach(item => {
    item.onclick = () => {
      const uid = item.dataset.uid;
      const u = users.find(x => x.uid === uid);
      if (u) {
        showApplicationDetailsModal(u, users);
      }
    };
  });
}

async function showApplicationDetailsModal(u, users) {
  const { showModal, closeModal, showConfirm } = await import('../../components/modal.js');
  const { doc, updateDoc } = await import('firebase/firestore');

  const app = u.deliveryApplication || {};

  const rawPhone = app.phone || u.phone || '';
  let cleanedPhone = rawPhone.replace(/\D/g, ''); // Keep only digits
  if (cleanedPhone.startsWith('54')) {
    if (!cleanedPhone.startsWith('549')) {
      cleanedPhone = '549' + cleanedPhone.substring(2);
    }
  } else {
    if (cleanedPhone.startsWith('15')) {
      cleanedPhone = '549' + cleanedPhone.substring(2);
    } else {
      cleanedPhone = '549' + cleanedPhone;
    }
  }
  const waUrl = `https://wa.me/${cleanedPhone}`;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;';

  modalEl.innerHTML = `
    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
      <img src="${u.photoURL || '/logo.png'}" style="width: 58px; height: 58px; border-radius: 18px; object-fit: cover; border: 2.5px solid var(--color-bg-secondary); box-shadow: var(--shadow-sm);" referrerpolicy="no-referrer" />
      <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; color: var(--color-text-primary); margin: 0;">Detalle de Postulación</h3>
      <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0;">
        Revisá los datos y archivos adjuntos del postulante.
      </p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px;">
      <!-- Personal Info -->
      <div>
        <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Nombre Completo</div>
        <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.fullName || u.displayName || 'Sin nombre'}</div>
      </div>
      
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Teléfono</div>
          <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.phone || u.phone || 'Sin teléfono'}</div>
        </div>
        ${(app.phone || u.phone) ? `
          <a href="${waUrl}" target="_blank" style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 10px; background: #25D366; color: white; font-size: 12px; font-weight: 800; text-decoration: none; box-shadow: 0 2px 8px rgba(37,211,102,0.3); transition: all 0.2s;" onmouseover="this.style.opacity='0.9'; this.style.transform='translateY(-1px)'" onmouseout="this.style.opacity='1'; this.style.transform='none'">
            ${icon('whatsapp', 14, '', '#FFF')} WhatsApp
          </a>
        ` : ''}
      </div>

      <!-- Vehicle details -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Vehículo</div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleType || '---'}</div>
        </div>
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Modelo</div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleModel || '---'}</div>
        </div>
      </div>

      <div>
        <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Patente</div>
        <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleDetails || '---'}</div>
      </div>

      <!-- CV Link / File -->
      ${app.cvLink ? `
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Enlace de CV</div>
          <a href="${app.cvLink}" target="_blank" style="font-size: 13px; font-weight: 700; color: var(--color-primary); display: flex; align-items: center; gap: 4px; margin-top: 2px; text-decoration: none;">
            ${icon('externalLink', 12)} Ver CV en la web
          </a>
        </div>
      ` : ''}

      ${app.cvFileUrl ? `
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Archivo de CV</div>
          <a href="${app.cvFileUrl}" target="_blank" style="font-size: 13px; font-weight: 700; color: var(--color-primary); display: flex; align-items: center; gap: 4px; margin-top: 2px; text-decoration: none;">
            ${icon('file', 12)} Abrir archivo adjunto de CV
          </a>
        </div>
      ` : ''}
    </div>

    <!-- Required uploaded files -->
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <!-- Licencia -->
      ${app.licenciaUrl ? `
        <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 10px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Licencia de Conducir</div>
          <a href="${app.licenciaUrl}" target="_blank" style="border-radius: 10px; overflow: hidden; display: block; border: 1px solid var(--color-border-light);">
            <img src="${app.licenciaUrl}" style="width: 100%; max-height: 180px; object-fit: cover;" />
          </a>
        </div>
      ` : ''}

      <!-- Seguro -->
      ${app.seguroUrl ? `
        <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 10px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Seguro del Vehículo</div>
          <a href="${app.seguroUrl}" target="_blank" style="border-radius: 10px; overflow: hidden; display: block; border: 1px solid var(--color-border-light);">
            <img src="${app.seguroUrl}" style="width: 100%; max-height: 180px; object-fit: cover;" />
          </a>
        </div>
      ` : ''}
    </div>

    <!-- Actions -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: auto; padding-top: 10px;">
      <button id="reject-app-btn" class="btn btn-ghost" style="height: 48px; border-radius: 14px; color: var(--color-danger); font-weight: 800; background: rgba(var(--color-danger-rgb), 0.05); font-size: 13.5px; border: none; cursor: pointer;">
        Rechazar
      </button>
      <button id="approve-app-btn" class="btn btn-primary" style="height: 48px; border-radius: 14px; background: #16a34a; color: white; border: none; font-weight: 900; font-size: 13.5px; cursor: pointer; box-shadow: 0 4px 12px rgba(22,163,74,0.25);">
        Aprobar Solicitud
      </button>
    </div>
  `;

  showModal({ title: '', content: modalEl, height: '80dvh', hideHeader: true });

  // Approve action
  modalEl.querySelector('#approve-app-btn').onclick = () => {
    showConfirm({
      title: 'Aprobar Repartidor',
      message: `¿Confirmás la aprobación de <b>${app.fullName || u.displayName}</b> como repartidor oficial?`,
      onConfirm: async () => {
        const { runTransaction, doc: fDoc } = await import('firebase/firestore');
        await runTransaction(db, async (t) => {
          const sRef = fDoc(db, 'settings', 'delivery');
          const sSnap = await t.get(sRef);
          const nId = (sSnap.exists() ? sSnap.data().lastDeliveryId || 1000 : 1000) + 1;
          t.set(sRef, { lastDeliveryId: nId }, { merge: true });
          t.update(fDoc(db, 'users', u.uid), {
            isDelivery: true,
            deliveryId: `DL-${nId}`,
            deliveryStatus: 'approved'
          });

          // Log notification for user so the Cloud Function sends a push
          const notificationRef = fDoc(collection(db, 'users', u.uid, 'notifications'));
          t.set(notificationRef, {
            type: 'delivery_approved',
            title: '✅ ¡Postulación Aprobada!',
            body: '¡Felicitaciones! Tu postulación como repartidor ha sido aprobada.',
            status: 'unread',
            url: '#/profile',
            createdAt: new Date()
          });
        });
        showToast('¡Repartidor aprobado correctamente!', 'success');
        location.reload();
      }
    });
  };

  // Reject action
  modalEl.querySelector('#reject-app-btn').onclick = () => {
    showConfirm({
      title: 'Rechazar Postulación',
      message: `¿Confirmás el rechazo de la solicitud de <b>${app.fullName || u.displayName}</b>?`,
      danger: true,
      onConfirm: async () => {
        await updateDoc(doc(db, 'users', u.uid), {
          deliveryStatus: 'rejected',
          'deliveryApplication.status': 'rejected'
        });
        showToast('Solicitud rechazada.', 'info');
        location.reload();
      }
    });
  };
}

function renderTripRequests(users, canChangeRoles) {
  const container = document.getElementById('trip-requests');
  if (!container || !canChangeRoles) return;
  const pending = users.filter(u => u.tripStatus === 'pending');
  if (pending.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div style="background:rgba(59, 130, 246, 0.05); border:1px dashed #3b82f6; padding:16px; border-radius:24px; margin-bottom:12px;">
      <h3 style="font-size:11px; font-weight:800; color:#3b82f6; text-transform:uppercase; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
        ${icon('car', 14)} Solicitudes de Chofer (Pasajeros) (${pending.length})
      </h3>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${pending.map(u => `
          <div class="pending-trip-request-item" data-uid="${u.uid}" style="background:var(--color-surface); border:1px solid var(--color-border-light); padding:10px 14px; border-radius:16px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.borderColor='rgba(59,130,246,0.3)'" onmouseout="this.style.borderColor='var(--color-border-light)'">
            <img src="${u.photoURL || '/logo.png'}" style="width:36px; height:36px; border-radius:10px;" referrerpolicy="no-referrer" />
            <div style="flex:1; min-width:0;">
              <div style="font-weight:800; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--color-text-primary);">${u.displayName || u.email}</div>
              <div style="font-size:11px; color:var(--color-text-tertiary); margin-top:2px;">Ver detalles del vehículo y documentos</div>
            </div>
            <div style="color:#3b82f6; display:flex;">${icon('chevronRight', 16)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.pending-trip-request-item').forEach(item => {
    item.onclick = () => {
      const uid = item.dataset.uid;
      const u = users.find(x => x.uid === uid);
      if (u) {
        showTripApplicationDetailsModal(u, users);
      }
    };
  });
}

async function showTripApplicationDetailsModal(u, users) {
  const { showModal, closeModal, showConfirm } = await import('../../components/modal.js');
  const { doc, updateDoc } = await import('firebase/firestore');

  const app = u.tripApplication || {};

  const rawPhone = app.phone || u.phone || '';
  let cleanedPhone = rawPhone.replace(/\D/g, ''); // Keep only digits
  if (cleanedPhone.startsWith('54')) {
    if (!cleanedPhone.startsWith('549')) {
      cleanedPhone = '549' + cleanedPhone.substring(2);
    }
  } else {
    if (cleanedPhone.startsWith('15')) {
      cleanedPhone = '549' + cleanedPhone.substring(2);
    } else {
      cleanedPhone = '549' + cleanedPhone;
    }
  }
  const waUrl = `https://wa.me/${cleanedPhone}`;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 24px; background: var(--color-bg); height: 100%; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;';

  modalEl.innerHTML = `
    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
      <img src="${u.photoURL || '/logo.png'}" style="width: 58px; height: 58px; border-radius: 18px; object-fit: cover; border: 2.5px solid var(--color-bg-secondary); box-shadow: var(--shadow-sm);" referrerpolicy="no-referrer" />
      <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; color: var(--color-text-primary); margin: 0;">Detalle de Postulación (Chofer)</h3>
      <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0;">
        Revisá los datos del vehículo y archivos adjuntos del postulante a chofer.
      </p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px;">
      <!-- Personal Info -->
      <div>
        <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Nombre Completo</div>
        <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.fullName || u.displayName || 'Sin nombre'}</div>
      </div>
      
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Teléfono</div>
          <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.phone || u.phone || 'Sin teléfono'}</div>
        </div>
        ${(app.phone || u.phone) ? `
          <a href="${waUrl}" target="_blank" style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 10px; background: #25D366; color: white; font-size: 12px; font-weight: 800; text-decoration: none; box-shadow: 0 2px 8px rgba(37,211,102,0.3); transition: all 0.2s;" onmouseover="this.style.opacity='0.9'; this.style.transform='translateY(-1px)'" onmouseout="this.style.opacity='1'; this.style.transform='none'">
            ${icon('whatsapp', 14, '', '#FFF')} WhatsApp
          </a>
        ` : ''}
      </div>

      <!-- Vehicle details -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Vehículo</div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleType || '---'}</div>
        </div>
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Modelo</div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleModel || '---'}</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Color</div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleColor || '---'}</div>
        </div>
        <div>
          <div style="font-size: 9px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px;">Patente</div>
          <div style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); margin-top: 2px;">${app.vehicleDetails || '---'}</div>
        </div>
      </div>
    </div>

    <!-- Required uploaded files -->
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <!-- Licencia -->
      ${app.licenciaUrl ? `
        <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 10px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Licencia de Conducir (Registro)</div>
          <a href="${app.licenciaUrl}" target="_blank" style="border-radius: 10px; overflow: hidden; display: block; border: 1px solid var(--color-border-light);">
            <img src="${app.licenciaUrl}" style="width: 100%; max-height: 180px; object-fit: cover;" />
          </a>
        </div>
      ` : ''}

      <!-- Seguro -->
      ${app.seguroUrl ? `
        <div style="background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 10px; font-weight: 900; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Seguro del Vehículo</div>
          <a href="${app.seguroUrl}" target="_blank" style="border-radius: 10px; overflow: hidden; display: block; border: 1px solid var(--color-border-light);">
            <img src="${app.seguroUrl}" style="width: 100%; max-height: 180px; object-fit: cover;" />
          </a>
        </div>
      ` : ''}
    </div>

    <!-- Actions -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: auto; padding-top: 10px;">
      <button id="reject-trip-btn" class="btn btn-ghost" style="height: 48px; border-radius: 14px; color: var(--color-danger); font-weight: 800; background: rgba(var(--color-danger-rgb), 0.05); font-size: 13.5px; border: none; cursor: pointer;">
        Rechazar
      </button>
      <button id="approve-trip-btn" class="btn btn-primary" style="height: 48px; border-radius: 14px; background: #3b82f6; color: white; border: none; font-weight: 900; font-size: 13.5px; cursor: pointer; box-shadow: 0 4px 12px rgba(59,130,246,0.25);">
        Aprobar Chofer
      </button>
    </div>
  `;

  showModal({ title: '', content: modalEl, height: '80dvh', hideHeader: true });

  // Approve action
  modalEl.querySelector('#approve-trip-btn').onclick = () => {
    showConfirm({
      title: 'Aprobar Chofer',
      message: `¿Confirmás la aprobación de <b>${app.fullName || u.displayName}</b> como chofer oficial para viajes de pasajeros?`,
      onConfirm: async () => {
        const { runTransaction, doc: fDoc } = await import('firebase/firestore');
        await runTransaction(db, async (t) => {
          const sRef = fDoc(db, 'settings', 'delivery');
          const sSnap = await t.get(sRef);
          let nId = u.deliveryId;
          let newDeliveryAssigned = false;
          if (!nId) {
            const nextId = (sSnap.exists() ? sSnap.data().lastDeliveryId || 1000 : 1000) + 1;
            t.set(sRef, { lastDeliveryId: nextId }, { merge: true });
            nId = `DL-${nextId}`;
            newDeliveryAssigned = true;
          }
          
          const updateData = {
            tripStatus: 'approved',
            isDelivery: true,
            deliveryMode: 'both',
            tripVehicleType: (app.vehicleType || 'Auto').toLowerCase(),
            vehicleType: (app.vehicleType || 'Auto').toLowerCase(),
            vehicleModel: app.vehicleModel,
            vehicleColor: app.vehicleColor,
            vehicleDetails: app.vehicleDetails,
            patente: app.vehicleDetails,
            'tripApplication.status': 'approved'
          };
          if (newDeliveryAssigned) {
            updateData.deliveryId = nId;
            updateData.deliveryStatus = 'approved';
          }
          t.update(fDoc(db, 'users', u.uid), updateData);
          t.update(fDoc(db, 'trip_applications', u.uid), { status: 'approved' });

          // Log notification for user so the Cloud Function sends a push
          const notificationRef = fDoc(collection(db, 'users', u.uid, 'notifications'));
          t.set(notificationRef, {
            type: 'driver_approved',
            title: '✅ ¡Postulación Aprobada!',
            body: '¡Felicitaciones! Tu postulación como chofer de viajes ha sido aprobada.',
            status: 'unread',
            url: '#/home',
            createdAt: new Date()
          });
        });
        showToast('¡Chofer aprobado correctamente!', 'success');
        location.reload();
      }
    });
  };

  // Reject action
  modalEl.querySelector('#reject-trip-btn').onclick = () => {
    showConfirm({
      title: 'Rechazar Postulación de Chofer',
      message: `¿Confirmás el rechazo de la solicitud de chofer de <b>${app.fullName || u.displayName}</b>?`,
      danger: true,
      onConfirm: async () => {
        await updateDoc(doc(db, 'users', u.uid), {
          tripStatus: 'rejected',
          'tripApplication.status': 'rejected'
        });
        await updateDoc(doc(db, 'trip_applications', u.uid), { status: 'rejected' });
        showToast('Solicitud de chofer rechazada.', 'info');
        location.reload();
      }
    });
  };
}

async function showAwardPointsModal(targetUser, allUsers, adminUser) {
  const { showModal, closeModal } = await import('../../components/modal.js');
  const { showToast } = await import('../../components/toast.js');
  const { doc, collection, runTransaction } = await import('firebase/firestore');

  const modalUid = Math.random().toString(36).substr(2, 5);

  const modalContent = `
    <div style="padding: 24px 20px; color: var(--color-text-primary); font-family: var(--font-body); display: flex; flex-direction: column; gap: 16px;">
      <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 8px;">
        <div style="width: 52px; height: 52px; border-radius: 16px; background: rgba(245, 158, 11, 0.1); color: #f59e0b; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.15);">
          ${icon('sparkles', 28)}
        </div>
        <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 900; margin: 0; letter-spacing: -0.5px;">Cargar GO Points</h3>
        <p style="font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.4; max-width: 260px;">
          Otorgá puntos administrativos directamente a la cuenta de <strong>${targetUser.displayName || 'este usuario'}</strong> sin límites.
        </p>
      </div>

      <div style="background: var(--color-bg-secondary); border-radius: 16px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--color-border-light);">
        <div>
          <span style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Saldo Actual</span>
          <div style="font-size: 16px; font-weight: 900; color: #f59e0b; display: flex; align-items: center; gap: 4px; margin-top: 1px;">
            ${icon('goPointsLogo', 14)} <span>${targetUser.points || 0}</span> pts
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">ID de Usuario</span>
          <div style="font-size: 15px; font-weight: 900; color: var(--color-text-primary); margin-top: 1px; font-family: monospace; letter-spacing: 0.5px;">
            ${targetUser.goId || '---'}
          </div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 4px;">
        <div>
          <label style="font-size: 10.5px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; display: block; margin-bottom: 6px; letter-spacing: 0.3px;">Puntos a Otorgar</label>
          <input type="number" id="award-points-amount-${modalUid}" placeholder="Ej: 1000" min="1" step="1" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border); padding: 0 14px; font-weight: 700; font-size: 14px; background: var(--color-surface); color: var(--color-text); outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'" />
        </div>
        <div>
          <label style="font-size: 10.5px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; display: block; margin-bottom: 6px; letter-spacing: 0.3px;">Motivo / Comentario</label>
          <input type="text" id="award-points-reason-${modalUid}" placeholder="Ej: Compensación, Promo Especial" style="width: 100%; height: 48px; border-radius: 12px; border: 1.5px solid var(--color-border); padding: 0 14px; font-weight: 700; font-size: 13px; background: var(--color-surface); color: var(--color-text); outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'" />
        </div>
      </div>

      <button id="btn-execute-award-${modalUid}" class="btn btn-primary btn-block" style="height: 48px; border-radius: 14px; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; border: none; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--color-primary); color: white;">
        ${icon('check', 16)} Cargar Puntos
      </button>
    </div>
  `;

  showModal({
    title: 'Otorgar GO Points',
    height: 'auto',
    content: modalContent,
    onOpen: () => {
      const execBtn = document.getElementById(`btn-execute-award-${modalUid}`);
      execBtn?.addEventListener('click', async () => {
        const amountInput = document.getElementById(`award-points-amount-${modalUid}`);
        const reasonInput = document.getElementById(`award-points-reason-${modalUid}`);

        const amount = parseInt(amountInput.value);
        const reason = reasonInput.value.trim() || 'Crédito administrativo de cortesía';

        if (isNaN(amount) || amount <= 0) {
          showToast('Ingresá una cantidad válida mayor a cero', 'warning');
          return;
        }

        execBtn.disabled = true;
        execBtn.innerHTML = `<div class="spinner-mini" style="width:14px; height:14px; border-width:2px; border-top-color:white; margin:0;"></div> Procesando...`;

        try {
          await runTransaction(db, async (transaction) => {
            const userRef = doc(db, 'users', targetUser.uid);
            const freshSnap = await transaction.get(userRef);
            if (!freshSnap.exists()) throw new Error('El usuario no existe');

            const currentPoints = freshSnap.data().points || 0;
            transaction.update(userRef, {
              points: currentPoints + amount
            });

            // Log point transaction
            const transRef = doc(collection(db, 'points_transactions'));
            transaction.set(transRef, {
              userId: targetUser.uid,
              type: 'admin_credit',
              points: amount,
              description: reason,
              adminUid: adminUser.uid,
              adminName: adminUser.displayName || 'Admin',
              createdAt: new Date()
            });

            // Log notification for user
            const notificationRef = doc(collection(db, 'users', targetUser.uid, 'notifications'));
            transaction.set(notificationRef, {
              type: 'points_received',
              title: '🎁 ¡Recibiste GO Points de cortesía!',
              body: `El equipo de GoDelivery te otorgó ${amount} GO Points de regalo. Motivo: ${reason}`,
              status: 'unread',
              url: '#/profile',
              createdAt: new Date()
            });
          });

          // Local update & UI refresh
          targetUser.points = (targetUser.points || 0) + amount;
          
          const searchVal = document.getElementById('users-search')?.value || '';
          const activePill = document.querySelector('.tab-pill.active');
          const currentFilter = activePill ? activePill.dataset.filter : 'all';
          const sortVal = document.getElementById('users-sort')?.value || 'none';
          const starsVal = document.getElementById('users-stars')?.value || 'all';

          renderUsersList(allUsers, searchVal, adminUser, true, currentFilter, sortVal, starsVal);

          showToast(`¡Cargaste ${amount} GO Points con éxito!`, 'success');
          closeModal();
        } catch (error) {
          console.error('Award points failed:', error);
          showToast(error.message || 'Error al otorgar los puntos', 'error');
          execBtn.disabled = false;
          execBtn.innerHTML = `${icon('check', 16)} Cargar Puntos`;
        }
      });
    }
  });
}

function showEditVehicleModal(u, onSuccess) {
  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'padding: 20px; font-family: inherit; color: var(--color-text-primary); display: flex; flex-direction: column; gap: 14px;';
  
  modalEl.innerHTML = `
    <h3 style="margin: 0; font-family: var(--font-display); font-size: 18px; font-weight: 900; color: var(--color-text-primary);">Editar Vehículo de ${u.displayName || 'Chofer'}</h3>
    
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <label style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Tipo de Vehículo</label>
      <select id="edit-veh-type" style="width: 100%; height: 42px; border-radius: 10px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; font-weight: 700; padding: 0 12px; outline: none; font-family: inherit;">
        <option value="" ${!u.vehicleType ? 'selected' : ''}>Ninguno (No configurado)</option>
        <option value="Moto" ${(u.vehicleType || '').toLowerCase() === 'moto' ? 'selected' : ''}>🏍️ Moto</option>
        <option value="Auto" ${(u.vehicleType || '').toLowerCase() === 'auto' ? 'selected' : ''}>🚗 Auto</option>
      </select>
    </div>

    <div style="display: flex; flex-direction: column; gap: 4px;">
      <label style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Modelo / Marca</label>
      <input type="text" id="edit-veh-model" value="${u.vehicleModel || ''}" placeholder="Ej: Fiat Cronos" style="width: 100%; box-sizing: border-box; height: 42px; border-radius: 10px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; font-weight: 700; padding: 0 12px; outline: none;" />
    </div>

    <div style="display: flex; flex-direction: column; gap: 4px;">
      <label style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Color</label>
      <input type="text" id="edit-veh-color" value="${u.vehicleColor || ''}" placeholder="Ej: Blanco" style="width: 100%; box-sizing: border-box; height: 42px; border-radius: 10px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; font-weight: 700; padding: 0 12px; outline: none;" />
    </div>

    <div style="display: flex; flex-direction: column; gap: 4px;">
      <label style="font-size: 11px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase;">Número de Patente</label>
      <input type="text" id="edit-veh-patent" value="${u.patente || u.vehicleDetails || ''}" placeholder="Ej: AB123CD" style="width: 100%; box-sizing: border-box; height: 42px; border-radius: 10px; border: 1.5px solid var(--color-border-light); background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; font-weight: 700; padding: 0 12px; outline: none;" />
    </div>

    <button id="edit-veh-save-btn" class="btn btn-primary btn-block" style="height: 48px; border-radius: 14px; font-weight: 900; font-size: 13.5px; background: #3b82f6; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2); margin-top: 8px;">
      Guardar Cambios
    </button>
  `;

  showModal({
    title: '',
    content: modalEl,
    height: 'auto',
    hideHeader: true
  });

  const saveBtn = modalEl.querySelector('#edit-veh-save-btn');
  saveBtn.onclick = async () => {
    const typeVal = modalEl.querySelector('#edit-veh-type').value;
    const modelVal = modalEl.querySelector('#edit-veh-model').value.trim();
    const colorVal = modalEl.querySelector('#edit-veh-color').value.trim();
    const patentVal = modalEl.querySelector('#edit-veh-patent').value.trim();

    saveBtn.disabled = true;
    saveBtn.innerHTML = 'Guardando...';

    try {
      const { doc: fDoc, updateDoc: fUpdateDoc } = await import('firebase/firestore');
      const { db } = await import('../../firebase.js');
      const userRef = fDoc(db, 'users', u.uid);
      
      const vTypeLower = typeVal.toLowerCase();
      
      const updateFields = {
        tripVehicleType: vTypeLower,
        tripVehicleModel: modelVal,
        tripVehicleColor: colorVal,
        tripVehiclePatent: patentVal,
        
        deliveryVehicleType: typeVal,
        deliveryVehicleModel: modelVal,
        deliveryVehicleColor: colorVal,
        deliveryVehiclePatent: patentVal,

        vehicleType: vTypeLower,
        vehicleModel: modelVal,
        vehicleColor: colorVal,
        vehicleDetails: patentVal,
        patente: patentVal
      };

      await fUpdateDoc(userRef, updateFields);

      // Update local array object reactively
      Object.assign(u, updateFields);

      // Trigger list update via callback
      if (onSuccess) onSuccess();
      
      import('../../components/toast.js').then(m => m.showToast('Vehículo actualizado con éxito', 'success'));
      
      const { closeModal } = await import('../../components/modal.js');
      closeModal();
    } catch (err) {
      console.error('Error saving user vehicle details:', err);
      import('../../components/toast.js').then(m => m.showToast('Error al guardar vehículo', 'error'));
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Guardar Cambios';
    }
  };
}


