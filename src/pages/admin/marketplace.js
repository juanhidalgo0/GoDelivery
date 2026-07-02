import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import { icon } from '../../utils/icons.js';

export async function renderAdminMarketplace(content) {
  if (!content) content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="admin-marketplace-container" style="display:flex; flex-direction:column; height:100%; background:var(--color-bg); position:relative; box-sizing:border-box;">
      <!-- Header (Red Premium style) -->
      <div style="background:var(--color-primary); padding:calc(16px + env(safe-area-inset-top, 0px)) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; position:relative; overflow:hidden; box-shadow:0 4px 12px rgba(var(--color-primary-rgb),0.2); z-index:100;">
        <a href="#/admin" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.15); border:none; display:flex; align-items:center; justify-content:center; color:white; text-decoration:none; transition:all 0.2s;">
          ${icon('chevronLeft', 24)}
        </a>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-size:20px; font-weight:900; color:white; margin:0; letter-spacing:-0.03em;">Moderación Marketplace</h1>
          <p style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.7); text-transform:uppercase; letter-spacing:0.1em; margin:2px 0 0;">Publicaciones Pendientes</p>
        </div>
      </div>

      <!-- Scrollable List -->
      <div id="pending-list" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; box-sizing:border-box;">
        <div style="text-align:center; padding:40px; color:var(--color-text-secondary);">
          Cargando pendientes...
        </div>
      </div>
    </div>
  `;

  const pendingList = content.querySelector('#pending-list');

  const loadPending = async () => {
    try {
      const q = query(collection(db, 'marketplace_products'), where('status', '==', 'pending'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (items.length === 0) {
        pendingList.innerHTML = `
          <div style="text-align:center; padding:60px 20px; color:var(--color-text-secondary);">
            <div style="font-size:48px; margin-bottom:12px;">✅</div>
            <p style="margin:0; font-weight:800; color:var(--color-text);">No hay publicaciones pendientes</p>
            <p style="margin:4px 0 0; font-size:12px; color:var(--color-text-tertiary);">¡Buen trabajo! Todo está al día.</p>
          </div>
        `;
        return;
      }

      pendingList.innerHTML = items.map(item => `
        <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; gap:12px; align-items:start;">
            <img src="${item.images?.[0] || '/logo.png'}" style="width:70px; height:70px; border-radius:12px; object-fit:cover; border:1px solid var(--color-border);" />
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:10px; font-weight:800; text-transform:uppercase; padding:2px 6px; border-radius:4px; background:var(--color-bg-secondary); color:var(--color-text-secondary); border:1px solid var(--color-border);">
                  ${item.condition === 'new' ? 'Nuevo' : 'Usado'}
                </span>
                <span style="font-size:11px; color:var(--color-text-tertiary);">Por: ${item.sellerName}</span>
              </div>
              <h4 style="font-family:var(--font-display); font-size:15px; font-weight:800; margin:4px 0 2px; color:var(--color-text);">${item.title}</h4>
              <span style="font-size:16px; font-weight:900; color:var(--color-primary);">$${item.price}</span>
            </div>
          </div>
          <div style="background:var(--color-bg-secondary); padding:10px 14px; border-radius:12px; font-size:13px; line-height:1.4; color:var(--color-text-secondary);">
            ${item.description}
          </div>
          <div style="display:flex; gap:10px; margin-top:4px;">
            <button class="approve-btn" data-id="${item.id}" style="flex:1; height:40px; background:#10B981; color:white; border:none; border-radius:10px; font-weight:800; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px;">
              Aprobar
            </button>
            <button class="reject-btn" data-id="${item.id}" style="flex:1; height:40px; background:rgba(239, 68, 68, 0.1); color:#EF4444; border:none; border-radius:10px; font-weight:800; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px;">
              Rechazar
            </button>
          </div>
        </div>
      `).join('');

      pendingList.querySelectorAll('.approve-btn').forEach(btn => {
        btn.onclick = async () => {
          try {
            await updateDoc(doc(db, 'marketplace_products', btn.dataset.id), { status: 'active' });
            alert('Publicación aprobada.');
            loadPending();
          } catch (err) {
            console.error(err);
          }
        };
      });

      pendingList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.onclick = async () => {
          try {
            await updateDoc(doc(db, 'marketplace_products', btn.dataset.id), { status: 'rejected' });
            alert('Publicación rechazada.');
            loadPending();
          } catch (err) {
            console.error(err);
          }
        };
      });

    } catch (err) {
      console.error(err);
      pendingList.innerHTML = `<div style="text-align:center; color:var(--color-primary);">Error al moderar.</div>`;
    }
  };

  loadPending();

  return {
    cleanup: () => {}
  };
}
