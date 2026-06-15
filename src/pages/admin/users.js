// GoDelivery — Admin Users Management
import { db } from '../../firebase.js';
import { collection, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { isSuperAdmin, isAdmin } from '../../auth.js';
import { getState } from '../../state.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { formatPrice } from '../../utils/format.js';

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
          <p style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:800;margin:2px 0 0;text-transform:uppercase;letter-spacing:0.05em;">Panel administrativo de permisos</p>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div style="flex:1;overflow-y:auto;padding:16px 16px 40px;-webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:20px;">
        <!-- Search Bar -->
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; padding:0 18px; height:56px; display:flex; align-items:center; gap:12px; box-shadow:var(--shadow-sm); flex-shrink:0;">
          <span style="color:var(--color-text-tertiary); display:flex;">${icon('search', 20)}</span>
          <input type="text" id="users-search" placeholder="Buscar usuarios..." style="flex:1; border:none; background:transparent; font-size:15px; font-weight:600; color:var(--color-text); outline:none;" />
        </div>

        <!-- Filter Tabs -->
        <div class="tab-pills" style="display:flex; gap:8px; overflow-x:auto; padding:4px 2px; scrollbar-width:none; flex-shrink:0; min-height:48px; align-items:center;">
          <button class="tab-pill active" data-filter="all">Todos</button>
          <button class="tab-pill" data-filter="cliente">Clientes</button>
          <button class="tab-pill" data-filter="delivery">Repartidores</button>
          <button class="tab-pill" data-filter="comercio">Comercios</button>
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
      
      .role-toggle-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--color-border-light); }
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
      .role-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      
      .id-badge { font-size: 10px; font-weight: 900; padding: 3px 10px; border-radius: 8px; font-family: monospace; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .id-go { background: #1e1e2d; color: white; }
      .id-dl { background: #eab308; color: white; }
      
      .status-badge { font-size: 10px; font-weight: 800; padding: 4px 10px; border-radius: 8px; text-transform: uppercase; display: flex; align-items: center; gap: 5px; }
      .badge-admin { background: var(--color-primary-light); color: var(--color-primary); }
      .badge-comercio { background: var(--color-success-light); color: var(--color-success); }
      .badge-delivery { background: var(--color-warning-light); color: var(--color-warning); }
    </style>
  `;

  let users = [];

  try {
    const snap = await getDocs(collection(db, 'users'));
    users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    
    const totalBadge = document.getElementById('users-total-badge');
    if (totalBadge) {
      totalBadge.textContent = `${users.length}`;
      totalBadge.style.display = 'inline-block';
    }
    
    // Auto-assign GO-IDs if missing
    const usersWithoutId = users.filter(u => !u.goId);
    if (usersWithoutId.length > 0) {
      const { runTransaction, doc: fDoc } = await import('firebase/firestore');
      await runTransaction(db, async (t) => {
        const sRef = fDoc(db, 'settings', 'users');
        const sSnap = await t.get(sRef);
        let last = sSnap.exists() ? sSnap.data().lastGoId || 1000 : 1000;
        for (const u of usersWithoutId) {
          last++;
          const goId = `GO-${last}`;
          t.update(fDoc(db, 'users', u.uid), { goId });
          u.goId = goId;
        }
        t.set(sRef, { lastGoId: last }, { merge: true });
      });
    }

    renderUsersList(users, '', currentUser, canChangeRoles, 'all', 'none', 'all', 'all');
  } catch (e) { console.error(e); }

  // Search, Filter & Sort listeners
  let currentFilter = 'all';
  const getSortVal = () => document.getElementById('users-sort')?.value || 'none';
  const getStarsVal = () => document.getElementById('users-stars')?.value || 'all';
  const getOsVal = () => document.getElementById('users-os')?.value || 'all';

  const updateList = () => {
    const searchVal = document.getElementById('users-search')?.value || '';
    renderUsersList(users, searchVal, currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());
  };

  document.getElementById('users-search')?.addEventListener('input', updateList);
  document.getElementById('users-sort')?.addEventListener('change', updateList);
  document.getElementById('users-stars')?.addEventListener('change', updateList);
  document.getElementById('users-os')?.addEventListener('change', updateList);

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

    // 2. Settle Debt Click (Evaluated first to bypass viewRatingsBtn container bubble)
    const settleBtn = e.target.closest('[data-settle-debt]');
    if (settleBtn) {
      const uid = settleBtn.dataset.settleDebt || settleBtn.dataset.uid;
      const u = users.find(x => x.uid === uid);
      if (!u) return;
      showConfirm({
        title: 'Liquidar Saldo',
        message: `¿Confirmás el cobro de ${formatPrice(u.deliveryDebt)}?`,
        onConfirm: async () => {
          await updateDoc(doc(db, 'users', uid), { deliveryDebt: 0 });
          u.deliveryDebt = 0;
          renderUsersList(users, document.getElementById('users-search')?.value || '', currentUser, canChangeRoles, currentFilter, getSortVal(), getStarsVal(), getOsVal());
          showToast('Saldo liquidado', 'success');
        }
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

      const newValue = !targetUser[field];
      showConfirm({
        title: 'Actualizar Acceso',
        message: `¿Querés ${newValue ? 'ACTIVAR' : 'DESACTIVAR'} el permiso de <b>${field.replace('is', '')}</b> para ${targetUser.displayName}?`,
        onConfirm: async () => {
          try {
            const updateData = { [field]: newValue };
            
            if (field === 'isDelivery') {
              if (newValue) {
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

            if (field === 'isAdmin' && newValue) {
              updateData.isComercio = false;
            }

            await updateDoc(doc(db, 'users', uid), updateData);
            
            // Local update for UI
            if (newValue === false && field === 'isDelivery') {
               delete targetUser.deliveryId;
               delete targetUser.deliveryStatus;
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
  });

  renderDeliveryRequests(users, canChangeRoles);
  renderTripRequests(users, canChangeRoles);
}

function renderUsersList(users, search, currentUser, canChangeRoles, filter = 'all', sortVal = 'none', starsVal = 'all', osVal = 'all') {
  const container = document.getElementById('users-list');
  if (!container) return;

  // 1. Role Filter
  let filtered = users;
  if (filter === 'cliente') {
    filtered = filtered.filter(u => !u.isDelivery && !u.isComercio && !u.isAdmin && u.role !== 'admin');
  } else if (filter === 'comercio') {
    filtered = filtered.filter(u => u.isComercio || u.role === 'comercio');
  } else if (filter === 'delivery') {
    filtered = filtered.filter(u => u.isDelivery);
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
              ${u.displayName || 'Sin nombre'}
              ${isMe ? '<span style="font-size:10px; font-weight:800; color:var(--color-primary); background:rgba(var(--color-primary-rgb),0.1); padding:1px 6px; border-radius:4px;">VOS</span>' : ''}
            </div>
            ${u.email ? `<div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:4px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.email}</div>` : ''}
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
              <span class="id-badge id-go">${u.goId || '...'}</span>
              ${u.deliveryId ? `<span class="id-badge id-dl">${u.deliveryId}</span>` : ''}
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
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top: 4px;">
          <button data-view-ratings="${u.uid}" style="height:42px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text); font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='var(--color-border-light)';" onmouseout="this.style.background='var(--color-bg-secondary)';">
            ${icon('star', 14)} Reseñas (${count})
          </button>
          <button data-award-points="${u.uid}" style="height:42px; border-radius:12px; border:1px solid rgba(245, 158, 11, 0.25); background:rgba(245, 158, 11, 0.05); color:#d97706; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(245, 158, 11, 0.12)';" onmouseout="this.style.background='rgba(245, 158, 11, 0.05)';">
            ${icon('sparkles', 14)} Cargar Puntos
          </button>
        </div>

        ${(u.deliveryDebt || 0) > 0 ? `
          <!-- Beautiful Settle Debt Section -->
          <div style="background: rgba(239, 68, 68, 0.05); border: 1px dashed rgba(239, 68, 68, 0.25); border-radius: 18px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; margin-top: 4px; animation: fadeIn 0.2s ease-out;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(239, 68, 68, 0.1); display: flex; align-items: center; justify-content: center; color: #ef4444; flex-shrink: 0;">
                ${icon('bank', 18)}
              </div>
              <div>
                <div style="font-size: 10px; font-weight: 800; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">Saldo de Repartidor</div>
                <div style="font-size: 16px; font-weight: 900; color: #ef4444; margin-top: 1px;">${formatPrice(u.deliveryDebt)}</div>
              </div>
            </div>
            <button data-settle-debt="${u.uid}" data-uid="${u.uid}" style="height: 38px; padding: 0 16px; border-radius: 10px; border: none; background: #ef4444; color: white; font-size: 12px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2); transition: all 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
              ${icon('check', 14)} Liquidar Saldo
            </button>
          </div>
        ` : ''}

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
    closeModal();
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
        });
        showToast('¡Repartidor aprobado correctamente!', 'success');
        location.reload();
      }
    });
  };

  // Reject action
  modalEl.querySelector('#reject-app-btn').onclick = () => {
    closeModal();
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
    closeModal();
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
        });
        showToast('¡Chofer aprobado correctamente!', 'success');
        location.reload();
      }
    });
  };

  // Reject action
  modalEl.querySelector('#reject-trip-btn').onclick = () => {
    closeModal();
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
