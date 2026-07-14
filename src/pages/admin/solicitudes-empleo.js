// GoDelivery — Admin Job Applications Management
import { db } from '../../firebase.js';
import { collection, onSnapshot, doc, updateDoc, getDoc } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';
import { showToast } from '../../components/toast.js';
import { showConfirm, showModal, closeModal } from '../../components/modal.js';

export async function renderAdminJobApplications() {
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
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Postulaciones de Empleo</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin-top:2px;">Repartidores y Choferes</p>
        </div>
      </div>

      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; background:var(--color-bg);">
        <!-- Counter Bar -->
        <div style="background:var(--color-surface); padding:16px 20px; border-bottom:1px solid var(--color-border); flex-shrink:0;">
          <div style="font-size:13px; font-weight:800; color:var(--color-text-secondary); display:flex; align-items:center; gap:8px;">
            <span>Postulaciones pendientes:</span>
            <span id="job-requests-count-badge" style="font-size:11px; font-weight:900; color:white; background:var(--color-primary); padding:2px 10px; border-radius:100px; line-height:1.2;">0</span>
          </div>
        </div>

        <!-- Scrollable List -->
        <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling:touch;">
          <div id="job-requests-list">
            <div class="loader-dots" style="margin:40px auto;"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  let unsub = null;

  try {
    unsub = onSnapshot(collection(db, 'job_applications'), (snap) => {
      const allApps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const pending = allApps.filter(a => a.status === 'pending');

      const countBadge = document.getElementById('job-requests-count-badge');
      if (countBadge) countBadge.textContent = `${pending.length}`;

      renderList(pending);
    });
  } catch (err) {
    console.error('Error listening to job applications:', err);
  }

  function renderList(pendingList) {
    const container = document.getElementById('job-requests-list');
    if (!container) return;

    if (pendingList.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:var(--color-text-tertiary); display:flex; flex-direction:column; align-items:center; gap:16px;">
          <div style="font-size:48px;">💼</div>
          <div style="font-weight:850; font-size:16px; color:var(--color-text-primary);">¡Todo al día!</div>
          <div style="font-size:13px; font-weight:600; max-width:280px; line-height:1.5;">No hay postulaciones de repartidores o choferes pendientes en este momento.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        ${pendingList.map(a => {
          let roleLabel = 'Postulante';
          let roleIcon = 'user';
          let roleColor = 'var(--color-text-secondary)';
          if (a.role === 'delivery') {
            roleLabel = 'Repartidor';
            roleIcon = 'bike';
            roleColor = 'var(--color-warning)';
          } else if (a.role === 'driver') {
            roleLabel = 'Chofer';
            roleIcon = 'car';
            roleColor = '#3b82f6';
          } else if (a.role === 'both') {
            roleLabel = 'Repartidor / Chofer';
            roleIcon = 'truck';
            roleColor = '#10b981';
          }

          return `
            <div class="job-card" data-id="${a.id}" style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:24px; padding:18px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-sm); transition:all 0.2s;">
              <!-- Header Row -->
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:44px; height:44px; border-radius:12px; background:var(--color-bg-secondary); color:${roleColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:20px;">
                  ${icon(roleIcon, 20)}
                </div>
                <div style="flex:1; min-width:0;">
                  <h3 style="font-size:15.5px; font-weight:900; color:var(--color-text-primary); margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${a.name}</h3>
                  <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:700; margin-top:2px;">${roleLabel}</div>
                </div>
                <span style="font-size:10px; font-weight:900; background:#f59e0b; color:white; padding:3px 8px; border-radius:8px; text-transform:uppercase; letter-spacing:0.02em;">Pendiente</span>
              </div>

              <!-- Quick Details -->
              <div style="background:var(--color-bg-secondary); border-radius:16px; padding:12px 14px; display:flex; flex-direction:column; gap:6px; font-size:12.5px;">
                <div style="display:flex; gap:6px; color:var(--color-text-secondary); font-weight:600;">
                  <span style="color:var(--color-text-tertiary);">${icon('phone', 14)}</span>
                  <span><b>Teléfono:</b> ${a.phone}</span>
                </div>
                <div style="display:flex; gap:6px; color:var(--color-text-secondary); font-weight:600;">
                  <span style="color:var(--color-text-tertiary);">${icon('mail', 14)}</span>
                  <span><b>Email:</b> ${a.email}</span>
                </div>
                ${a.vehicleType ? `
                  <div style="display:flex; gap:6px; color:var(--color-text-secondary); font-weight:600;">
                    <span style="color:var(--color-text-tertiary);">${icon('truck', 14)}</span>
                    <span><b>Vehículo:</b> ${a.vehicleType.toUpperCase()} (${a.vehicleModel || 'S/D'})</span>
                  </div>
                ` : ''}
              </div>

              <!-- Action Buttons -->
              <div style="display:flex; gap:10px; margin-top:4px;">
                <button class="btn-job-details" data-id="${a.id}" style="flex:1.2; height:44px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text-primary); font-weight:800; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                  ${icon('eye', 16)} Ver Postulación
                </button>
                <button class="btn-job-approve" data-id="${a.id}" data-name="${a.name}" style="flex:1.5; height:44px; border-radius:12px; border:none; background:#10b981; color:white; font-weight:900; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 10px rgba(16,185,129,0.2);">
                  ${icon('check', 16)} Aprobar
                </button>
                <button class="btn-job-reject" data-id="${a.id}" data-name="${a.name}" style="width:44px; height:44px; border-radius:12px; border:none; background:rgba(239,68,68,0.1); color:#ef4444; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                  ${icon('trash', 18)}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Bind event handlers
    container.querySelectorAll('.btn-job-details').forEach(btn => {
      btn.onclick = () => {
        const app = pendingList.find(x => x.id === btn.dataset.id);
        if (app) openJobDetailModal(app);
      };
    });

    container.querySelectorAll('.btn-job-approve').forEach(btn => {
      btn.onclick = () => {
        approveJobApplication(btn.dataset.id, btn.dataset.name);
      };
    });

    container.querySelectorAll('.btn-job-reject').forEach(btn => {
      btn.onclick = () => {
        rejectJobApplication(btn.dataset.id, btn.dataset.name);
      };
    });
  }

  function approveJobApplication(appId, name) {
    const app = pendingListStore.find(x => x.id === appId);
    if (!app) return;

    showConfirm({
      title: '¿Aprobar postulación?',
      message: `¿Confirmás la aprobación de <b>${name}</b> como repartidor/chofer de la plataforma?<br><br>Esto actualizará su rol de usuario y le dará acceso a su respectivo panel.`,
      confirmText: 'Aprobar Postulación',
      onConfirm: async () => {
        try {
          const userRef = doc(db, 'users', app.userId);
          const userSnap = await getDoc(userRef);

          const updateData = {};
          
          if (app.role === 'delivery') {
            updateData.isDelivery = true;
            updateData.deliveryStatus = 'approved';
            updateData.role = 'delivery';
          } else if (app.role === 'driver') {
            updateData.tripStatus = 'approved';
            updateData['tripApplication.status'] = 'approved';
            updateData.isDelivery = true;
            updateData.deliveryMode = 'both';
            updateData.role = 'chofer';
          } else if (app.role === 'both') {
            updateData.isDelivery = true;
            updateData.deliveryStatus = 'approved';
            updateData.tripStatus = 'approved';
            updateData['tripApplication.status'] = 'approved';
            updateData.deliveryMode = 'both';
            updateData.role = 'chofer'; // Primary role
          }

          // Generate Delivery ID if missing
          if (userSnap.exists() && !userSnap.data().deliveryId) {
            const { runTransaction, doc: fDoc } = await import('firebase/firestore');
            await runTransaction(db, async (t) => {
              const sRef = fDoc(db, 'settings', 'delivery');
              const sSnap = await t.get(sRef);
              const nId = (sSnap.exists() ? sSnap.data().lastDeliveryId || 1000 : 1000) + 1;
              t.set(sRef, { lastDeliveryId: nId }, { merge: true });
              updateData.deliveryId = `DL-${nId}`;
            });
          }

          await updateDoc(userRef, updateData);
          await updateDoc(doc(db, 'job_applications', appId), { status: 'approved' });

          // Send push notification
          try {
            const { collection, addDoc } = await import('firebase/firestore');
            let notifBody = '¡Felicitaciones! Tu postulación ha sido aprobada.';
            if (app.role === 'delivery') {
              notifBody = '¡Felicitaciones! Tu postulación como repartidor de la plataforma ha sido aprobada.';
            } else if (app.role === 'driver') {
              notifBody = '¡Felicitaciones! Tu postulación como chofer de viajes ha sido aprobada.';
            } else if (app.role === 'both') {
              notifBody = '¡Felicitaciones! Tu postulación como repartidor y chofer de la plataforma ha sido aprobada.';
            }

            await addDoc(collection(db, 'users', app.userId, 'notifications'), {
              type: 'job_approved',
              title: '✅ ¡Postulación Aprobada!',
              body: notifBody,
              status: 'unread',
              url: '#/home',
              createdAt: new Date()
            });
          } catch (notifErr) {
            console.error('Error writing job approval notification:', notifErr);
          }

          showToast('¡Postulación aprobada con éxito!', 'success');
        } catch (e) {
          console.error(e);
          showToast('Error al aprobar la postulación', 'error');
        }
      }
    });
  }

  let pendingListStore = [];
  try {
    onSnapshot(collection(db, 'job_applications'), (snap) => {
      pendingListStore = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    });
  } catch (e) {}

  function rejectJobApplication(appId, name) {
    const app = pendingListStore.find(x => x.id === appId);
    if (!app) return;

    showConfirm({
      title: '¿Rechazar postulación?',
      message: `¿Estás seguro de que deseas rechazar la postulación de <b>${name}</b>?`,
      confirmText: 'Rechazar',
      danger: true,
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'job_applications', appId), { status: 'rejected' });
          const userRef = doc(db, 'users', app.userId);
          const uSnap = await getDoc(userRef);
          if (uSnap.exists()) {
            await updateDoc(userRef, { deliveryStatus: 'rejected' });
          }

          showToast('Postulación rechazada.', 'info');
        } catch (e) {
          console.error(e);
          showToast('Error al rechazar la postulación', 'error');
        }
      }
    });
  }

  function openJobDetailModal(app) {
    const detailEl = document.createElement('div');
    detailEl.style.cssText = 'padding:20px; font-family:var(--font-body); display:flex; flex-direction:column; gap:16px; overflow-y:auto; max-height:80dvh;';

    let roleLabel = 'Postulante';
    if (app.role === 'delivery') roleLabel = 'Repartidor (Delivery)';
    else if (app.role === 'driver') roleLabel = 'Chofer (Moto/Auto)';
    else if (app.role === 'both') roleLabel = 'Repartidor y Chofer';

    detailEl.innerHTML = `
      <div>
        <h2 style="font-family:var(--font-display); font-size:22px; font-weight:900; color:var(--color-text-primary); margin:0;">${app.name}</h2>
        <div style="font-size:11.5px; color:var(--color-primary); font-weight:800; text-transform:uppercase; margin-top:4px;">${roleLabel}</div>
      </div>

      <!-- Details List -->
      <div style="display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--color-border-light); padding-top:14px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Teléfono de Contacto</div>
            <a href="tel:${app.phone}" style="font-size:13.5px; font-weight:750; color:var(--color-primary); text-decoration:none; display:flex; align-items:center; gap:4px;">
              ${icon('phone', 14)} ${app.phone}
            </a>
          </div>
          <div>
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Email</div>
            <div style="font-size:13px; font-weight:700; color:var(--color-text-secondary);">${app.email}</div>
          </div>
        </div>

        <div>
          <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Comentarios / Experiencia</div>
          <div style="font-size:13px; font-weight:650; color:var(--color-text-primary); line-height:1.45; background:var(--color-bg-secondary); padding:10px 14px; border-radius:12px;">
            ${app.notes || 'El postulante no proporcionó comentarios adicionales.'}
          </div>
        </div>

        ${app.vehicleType && app.vehicleType !== 'bici' ? `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; border-top:1px solid var(--color-border-light); padding-top:12px;">
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Vehículo y Modelo</div>
              <div style="font-size:13px; font-weight:750; color:var(--color-text-primary);">${app.vehicleType.toUpperCase()} - ${app.vehicleModel || 'S/D'}</div>
            </div>
            <div>
              <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Patente / Chasis</div>
              <div style="font-size:13px; font-weight:850; color:var(--color-text-primary); font-family:monospace;">${app.vehiclePlate || 'S/D'}</div>
            </div>
          </div>

          <!-- Document Uploads -->
          <div style="display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--color-border-light); padding-top:12px;">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Documentos Adjuntos (Toca para ver en grande)</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <span style="font-size:11px; font-weight:700; color:var(--color-text-secondary);">Licencia de Conducir</span>
                <div class="doc-img-preview" data-src="${app.licensePhoto}" style="width:100%; height:90px; border-radius:10px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary) url(${app.licensePhoto}) center/cover no-repeat; cursor:pointer;">
                </div>
              </div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                <span style="font-size:11px; font-weight:700; color:var(--color-text-secondary);">Seguro del Vehículo</span>
                <div class="doc-img-preview" data-src="${app.insurancePhoto}" style="width:100%; height:90px; border-radius:10px; overflow:hidden; border:1px solid var(--color-border-light); background:var(--color-bg-secondary) url(${app.insurancePhoto}) center/cover no-repeat; cursor:pointer;">
                </div>
              </div>
            </div>
          </div>
        ` : app.vehicleType === 'bici' ? `
          <div style="border-top:1px solid var(--color-border-light); padding-top:12px;">
            <div style="font-size:10px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Vehículo</div>
            <div style="font-size:13px; font-weight:750; color:var(--color-text-primary);">🚲 Bicicleta (No requiere patente ni licencia)</div>
          </div>
        ` : ''}
      </div>

      <!-- Action Panel -->
      <div style="display:flex; gap:10px; margin-top:10px; border-top:1px solid var(--color-border-light); padding-top:16px;">
        <button id="detail-job-reject-btn" style="flex:1; height:48px; border-radius:14px; border:1px solid #ef4444; background:transparent; color:#ef4444; font-weight:800; font-size:13.5px; cursor:pointer;">
          Rechazar
        </button>
        <button id="detail-job-approve-btn" style="flex:1.5; height:48px; border-radius:14px; border:none; background:#10b981; color:white; font-weight:900; font-size:13.5px; cursor:pointer; box-shadow:0 4px 12px rgba(16,185,129,0.25);">
          Aprobar Postulación
        </button>
      </div>
    `;

    showModal({
      title: 'Detalles de Postulación',
      height: 'auto',
      content: detailEl,
      onOpen: () => {
        detailEl.querySelectorAll('.doc-img-preview').forEach(div => {
          div.onclick = () => {
            const src = div.dataset.src;
            if (src) {
              const imgModal = document.createElement('div');
              imgModal.style.cssText = 'padding:10px; display:flex; align-items:center; justify-content:center; background:#000; height:80dvh; overflow:hidden; border-radius:16px;';
              imgModal.innerHTML = `<img src="${src}" style="max-width:100%; max-height:100%; object-fit:contain;" />`;
              showModal({ title: 'Vista de Documento', content: imgModal, height: 'auto' });
            }
          };
        });

        detailEl.querySelector('#detail-job-reject-btn').onclick = () => {
          closeModal();
          rejectJobApplication(app.id, app.name);
        };

        detailEl.querySelector('#detail-job-approve-btn').onclick = () => {
          closeModal();
          approveJobApplication(app.id, app.name);
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
