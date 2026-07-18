// GoDelivery — Admin Commerce Applications / Requests Management
import { db } from '../../firebase.js';
import { collection, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal, closeModal } from '../../components/modal.js';
import { formatPrice } from '../../utils/format.js';

export async function renderAdminCommerceRequests() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <!-- Premium Red Header -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <button onclick="location.hash='#/admin'" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer; position:relative; z-index:2;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1; position:relative; z-index:2;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Solicitudes de Comercio</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Aprobación de nuevos locales</p>
        </div>
      </div>

      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; background:var(--color-bg);">
        <!-- Counter Bar -->
        <div style="background:var(--color-surface); padding:16px 20px; border-bottom:1px solid var(--color-border); flex-shrink:0; display:flex; align-items:center; justify-content:between;">
          <div style="font-size:13px; font-weight:800; color:var(--color-text-secondary); display:flex; align-items:center; gap:8px;">
            <span>Solicitudes pendientes:</span>
            <span id="requests-count-badge" style="font-size:11px; font-weight:900; color:white; background:var(--color-primary); padding:2px 10px; border-radius:100px; line-height:1.2;">0</span>
          </div>
        </div>

        <!-- Scrollable List -->
        <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch;">
          <div id="requests-list">
            <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  let unsub = null;

  try {
    unsub = onSnapshot(collection(db, 'comercios'), (snap) => {
      const allComercios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const pending = allComercios.filter(c => c.approvedByAdmin === false);

      const countBadge = document.getElementById('requests-count-badge');
      if (countBadge) countBadge.textContent = `${pending.length}`;

      renderList(pending);
    });
  } catch (err) {
    console.error('Error listening to pending comercios:', err);
  }

  function renderList(pendingList) {
    const container = document.getElementById('requests-list');
    if (!container) return;

    if (pendingList.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:var(--color-text-tertiary); display:flex; flex-direction:column; align-items:center; gap:16px;">
          <div style="font-size:48px;">🎉</div>
          <div style="font-weight:850; font-size:16px; color:var(--color-text-primary);">¡Todo al día!</div>
          <div style="font-size:13px; font-weight:600; max-width:280px; line-height:1.5;">No hay solicitudes de comercios pendientes de aprobación en este momento.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        ${pendingList.map(c => `
          <div class="request-card" data-id="${c.id}" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:18px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-sm); transition:all 0.2s;">
            <!-- Header Row -->
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:48px; height:48px; border-radius:12px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); flex-shrink:0;">
                <img src="${c.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
              </div>
              <div style="flex:1; min-width:0;">
                <h3 style="font-size:15.5px; font-weight:900; color:var(--color-text-primary); margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.name}</h3>
                <div style="font-size:11px; color:#f59e0b; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; display:flex; align-items:center; gap:4px;">
                  <span>${c.category}</span>
                </div>
              </div>
              <span style="font-size:10px; font-weight:900; background:#f59e0b; color:white; padding:3px 8px; border-radius:8px; text-transform:uppercase; letter-spacing:0.02em;">Pendiente</span>
            </div>

            <!-- Details Preview -->
            <div style="background:var(--color-bg-secondary); border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
              <div style="display:flex; gap:6px; color:var(--color-text-secondary); font-weight:600; line-height:1.4;">
                <span style="flex-shrink:0; color:var(--color-text-tertiary);">${icon('tag', 14)}</span>
                <span><b>Descripción:</b> ${c.description || 'Sin descripción'}</span>
              </div>
              <div style="display:flex; gap:6px; color:var(--color-text-secondary); font-weight:600;">
                <span style="flex-shrink:0; color:var(--color-text-tertiary);">${icon('phone', 14)}</span>
                <span><b>Teléfono:</b> ${c.phone || 'Sin teléfono'}</span>
              </div>
              <div style="display:flex; gap:6px; color:var(--color-text-secondary); font-weight:600; line-height:1.4;">
                <span style="flex-shrink:0; color:var(--color-text-tertiary);">${icon('mapPin', 14)}</span>
                <span><b>Dirección:</b> ${c.address || 'Sin dirección'}</span>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="display:flex; gap:10px; margin-top:4px;">
              <button class="btn-view-details" data-id="${c.id}" style="flex:1.2; height:44px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text-primary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                ${icon('eye', 16)} Ver Todo
              </button>
              <button class="btn-approve" data-id="${c.id}" data-name="${c.name}" style="flex:1.5; height:44px; border-radius:12px; border:none; background:#10b981; color:white; font-weight:900; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 10px rgba(16,185,129,0.2);">
                ${icon('check', 16)} Aprobar
              </button>
              <button class="btn-reject" data-id="${c.id}" data-name="${c.name}" style="width:44px; height:44px; border-radius:12px; border:none; background:rgba(239,68,68,0.1); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon('trash', 18)}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Bind event handlers
    container.querySelectorAll('.btn-view-details').forEach(btn => {
      btn.onclick = () => {
        const com = pendingList.find(x => x.id === btn.dataset.id);
        if (com) openApplicationDetailModal(com);
      };
    });

    container.querySelectorAll('.btn-approve').forEach(btn => {
      btn.onclick = () => {
        approveApplication(btn.dataset.id, btn.dataset.name);
      };
    });

    container.querySelectorAll('.btn-reject').forEach(btn => {
      btn.onclick = () => {
        rejectApplication(btn.dataset.id, btn.dataset.name);
      };
    });
  }

  function approveApplication(comId, name) {
    showConfirm({
      title: '¿Aprobar solicitud?',
      message: `Confirmás la aprobación de <b>${name}</b>?<br><br>Esto le dará acceso inmediato al panel de comercio al dueño y creará el local.`,
      confirmText: 'Aprobar Comercio',
      onConfirm: async () => {
        try {
          const snap = doc(db, 'comercios', comId);
          await updateDoc(snap, {
            approvedByAdmin: true,
            isActive: true // Active immediately so it appears in the app automatically
          });

          const docSnap = pendingListStore.find(x => x.id === comId);
          if (docSnap && docSnap.ownerId) {
            await updateDoc(doc(db, 'users', docSnap.ownerId), {
              role: 'comercio',
              isComercio: true,
              commerceStatus: 'approved'
            });

            // Log notification for the user
            const { collection, addDoc } = await import('firebase/firestore');
            await addDoc(collection(db, 'users', docSnap.ownerId, 'notifications'), {
              type: 'commerce_approved',
              title: '🎉 ¡Comercio Aprobado!',
              body: `Tu comercio "${name}" fue aprobado y ya está disponible en la app para todos.`,
              status: 'unread',
              url: '/#/mi-comercio',
              createdAt: new Date()
            });
          }

          showToast('¡Comercio aprobado con éxito!', 'success');
        } catch (e) {
          console.error(e);
          showToast('Error al aprobar el comercio', 'error');
        }
      }
    });
  }

  let pendingListStore = [];
  // Keep local store for approval helper
  try {
    onSnapshot(collection(db, 'comercios'), (snap) => {
      pendingListStore = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    });
  } catch (e) {}

  function rejectApplication(comId, name) {
    showConfirm({
      title: '¿Rechazar solicitud?',
      message: `¿Estás seguro de que deseas rechazar y eliminar la postulación de <b>${name}</b>? Esta acción es irreversible.`,
      confirmText: 'Eliminar solicitud',
      danger: true,
      onConfirm: async () => {
        try {
          const docSnap = pendingListStore.find(x => x.id === comId);
          if (docSnap && docSnap.ownerId) {
            await updateDoc(doc(db, 'users', docSnap.ownerId), {
              commerceStatus: 'rejected'
            });

            // Notify owner via push that their application was rejected
            const { collection: col2, addDoc: addDoc2 } = await import('firebase/firestore');
            await addDoc2(col2(db, 'users', docSnap.ownerId, 'notifications'), {
              type: 'commerce_rejected',
              title: '❌ Solicitud de Comercio Rechazada',
              body: `Tu solicitud para "${name}" fue revisada y no pudo ser aprobada en este momento. Podés volver a postular más adelante.`,
              status: 'unread',
              url: '/#/',
              createdAt: new Date()
            });
          }
          await deleteDoc(doc(db, 'comercios', comId));
          showToast('Solicitud rechazada y eliminada.', 'info');
        } catch (e) {
          console.error(e);
          showToast('Error al rechazar la solicitud', 'error');
        }
      }
    });
  }

  function openApplicationDetailModal(com) {
    const detailEl = document.createElement('div');
    detailEl.style.cssText = 'padding:20px; font-family:var(--font-body); display:flex; flex-direction:column; gap:16px; overflow-y:auto; max-height:80dvh;';

    detailEl.innerHTML = `
      <!-- Banner -->
      <div style="position:relative; width:100%; height:140px; border-radius:18px; overflow:hidden; background:var(--color-bg-secondary); border:1px solid var(--color-border-light);">
        <img src="${com.banner || '/logo-brand.jpg'}" style="width:100%; height:100%; object-fit:cover;" />
        <!-- Logo Overlay -->
        <div style="position:absolute; bottom:12px; left:16px; width:64px; height:64px; border-radius:50%; overflow:hidden; border:3px solid var(--color-surface); background:white; box-shadow:var(--shadow-md);">
          <img src="${com.logo || '/logo.png'}" style="width:100%; height:100%; object-fit:cover;" />
        </div>
      </div>

      <!-- Merchant Info -->
      <div>
        <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; color:var(--color-text-primary); margin:0;">${com.name}</h2>
        <div style="font-size:11.5px; color:#f59e0b; font-weight:800; text-transform:uppercase; margin-top:4px;">${com.category}</div>
      </div>

      <!-- Details List -->
      <div style="display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--color-border-light); padding-top:14px;">
        <div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Descripción / Especialidad</div>
          <div style="font-size:13.5px; font-weight:650; color:var(--color-text-primary); line-height:1.45;">${com.description || 'Sin descripción'}</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Teléfono de Contacto</div>
            <a href="tel:${com.phone}" style="font-size:13.5px; font-weight:750; color:var(--color-primary); text-decoration:none; display:flex; align-items:center; gap:4px;">
              ${icon('phone', 14)} ${com.phone || 'Sin teléfono'}
            </a>
          </div>
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">ID del Propietario</div>
            <div style="font-size:12px; font-weight:700; color:var(--color-text-secondary); font-family:monospace; word-break:break-all;">${com.ownerId || 'N/A'}</div>
          </div>
        </div>

        <div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Dirección Física</div>
          <div style="font-size:13.5px; font-weight:700; color:var(--color-text-primary); line-height:1.4;">${com.address || 'Sin dirección'}</div>
        </div>

        ${com.coords ? `
          <button id="view-on-map-btn" style="height:44px; border-radius:12px; border:1px solid var(--color-border-light); background:var(--color-bg-secondary); color:var(--color-text-primary); font-weight:800; font-size:12.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; margin-top:4px;">
            ${icon('mapPin', 16)} Ver Ubicación en el Mapa
          </button>
        ` : ''}
      </div>

      <!-- Action Panel -->
      <div style="display:flex; gap:10px; margin-top:10px; border-top:1px solid var(--color-border-light); padding-top:16px;">
        <button id="detail-reject-btn" style="flex:1; height:48px; border-radius:14px; border:1px solid #ef4444; background:transparent; color:#ef4444; font-weight:800; font-size:13.5px; cursor:pointer;">
          Rechazar Solicitud
        </button>
        <button id="detail-approve-btn" style="flex:1.5; height:48px; border-radius:14px; border:none; background:#10b981; color:white; font-weight:900; font-size:13.5px; cursor:pointer; box-shadow:0 4px 12px rgba(16,185,129,0.25);">
          Aprobar Comercio
        </button>
      </div>
    `;

    showModal({
      title: 'Detalles de Solicitud',
      height: 'auto',
      content: detailEl,
      onOpen: () => {
        detailEl.querySelector('#view-on-map-btn')?.addEventListener('click', async () => {
          try {
            const { showLocationPicker } = await import('../../components/location-modal.js');
            showLocationPicker({
              initialCoords: com.coords,
              initialAddress: com.address,
              readonly: true
            });
          } catch (e) { console.error(e); }
        });

        detailEl.querySelector('#detail-reject-btn').onclick = () => {
          closeModal();
          rejectApplication(com.id, com.name);
        };

        detailEl.querySelector('#detail-approve-btn').onclick = () => {
          closeModal();
          approveApplication(com.id, com.name);
        };
      }
    });
  }

  return {
    cleanup: () => {
      if (unsub) unsub();
    }
  };
}
