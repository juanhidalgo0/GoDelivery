// GoDelivery — Admin: lugares de los mandados
// Dónde queda cada comercio que los clientes escriben a mano. La app los aprende con la ubicación
// del repartidor al terminar de comprar; acá se revisan, se corrigen y se confirman.
import { db } from '../../firebase.js';
import { collection, getDocs, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { categoryLabel, placeCategory, inPlaceBounds, placeConfidence } from '../../utils/mandado-places.js';
import { loadMandadoPlaces } from '../../utils/mandado-places-store.js';

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export async function renderAdminMandadoPlaces() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div class="panel-page" style="display:flex; flex-direction:column; height:100dvh; background:var(--color-bg); overflow:hidden;">
      <div   class="go-page-header" style="background: var(--go-ink); padding:calc(16px + max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px))) 20px 16px; display:flex; align-items:center; gap:16px; flex-shrink:0; box-shadow:none; z-index:100;">
        <button onclick="location.hash='#/admin'" aria-label="Volver" style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.18); border:none; display:flex; align-items:center; justify-content:center; color:white; cursor:pointer;">
          ${icon('chevronLeft', 24)}
        </button>
        <div style="flex:1;">
          <h1 style="font-family:var(--font-display); font-weight:900; font-size:20px; color:white; margin:0; line-height:1.2;">Lugares de mandados</h1>
          <p style="font-size:11px; color:rgba(255,255,255,0.8); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Aprendidos por los repartidores</p>
        </div>
      </div>
      <div style="flex:1; overflow-y:auto; padding:16px 16px 40px; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:13px; color:var(--color-text-secondary); line-height:1.5; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:12px 14px;">
          Cuando un repartidor termina de comprar en un comercio que el cliente escribió a mano, la app guarda dónde estaba.
          Con varias visitas el punto se afina solo. Confirmá los que estén bien; corregí o ocultá los que no.
          Los comercios adheridos no aparecen acá: usan su propia dirección.
        </div>
        <input type="search" id="places-search" placeholder="Buscar por nombre..." style="width:100%; height:44px; border-radius:14px; border:1px solid var(--color-border); background:var(--color-surface); padding:0 14px; font-weight:700; font-size:14px; color:var(--color-text); outline:none; box-sizing:border-box;" />
        <div id="places-list" style="display:flex; flex-direction:column; gap:10px;">
          <div style="padding:30px; text-align:center; color:var(--color-text-tertiary); font-weight:700;">Cargando...</div>
        </div>
      </div>
    </div>`;

  let places = [];
  const listEl = content.querySelector('#places-list');
  const searchEl = content.querySelector('#places-search');

  const render = () => {
    const q = searchEl.value.trim().toLowerCase();
    const shown = places.filter(p => !q || String(p.name).toLowerCase().includes(q));
    if (!shown.length) {
      listEl.innerHTML = `<div style="padding:30px; text-align:center; color:var(--color-text-tertiary); font-weight:700;">${places.length ? 'Nada coincide con la búsqueda' : 'Todavía no hay lugares aprendidos. Aparecen cuando los repartidores completan mandados.'}</div>`;
      return;
    }
    listEl.innerHTML = shown.map(p => {
      const samples = Array.isArray(p.samples) ? p.samples.length : 0;
      const status = p.hidden ? ['Oculto', '#64748b', 'rgba(100,116,139,0.12)']
        : p.verified ? ['Confirmado', '#0d9488', 'rgba(13,148,136,0.12)']
          : p.conf.conflict ? ['A revisar: las visitas no coinciden', '#e11d48', 'rgba(225,29,72,0.1)']
            : p.conf.trusted ? ['Seguro (visitas coinciden)', '#0d9488', 'rgba(13,148,136,0.08)']
              : ['Aproximado (1 visita)', '#b45309', 'rgba(245,158,11,0.14)'];
      return `
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:18px; padding:14px; display:flex; flex-direction:column; gap:10px; ${p.hidden ? 'opacity:0.6;' : ''}">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
            <div style="min-width:0;">
              <div style="font-weight:800; font-size:15px; color:var(--color-text);">${escHtml(p.name)}</div>
              <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">
                ${escHtml(p.category ? categoryLabel(p.category) : 'Sin rubro')} · ${p.visits || 0} visita${p.visits === 1 ? '' : 's'} · ${samples} punto${samples === 1 ? '' : 's'} guardado${samples === 1 ? '' : 's'}
              </div>
            </div>
            <span style="flex-shrink:0; font-size:11px; font-weight:800; color:${status[1]}; background:${status[2]}; padding:4px 8px; border-radius:8px;">${status[0]}</span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener noreferrer" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); color:var(--color-text); font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; text-decoration:none;">${icon('mapPin', 14)} Ver en el mapa</a>
            ${samples > 1 ? `<a href="https://www.google.com/maps/dir/${p.samples.map(s => `${s.lat},${s.lng}`).join('/')}" target="_blank" rel="noopener noreferrer" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); color:var(--color-text); font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; text-decoration:none;">Ver las ${samples} visitas</a>` : ''}
            ${p.verified ? '' : `<button data-act="verify" data-id="${escHtml(p.id)}" style="height:36px; padding:0 12px; border-radius:10px; border:none; background:#0d9488; color:white; font-size:13px; font-weight:800; cursor:pointer;">Confirmar</button>`}
            <button data-act="edit" data-id="${escHtml(p.id)}" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); background:transparent; color:var(--color-text); font-size:13px; font-weight:700; cursor:pointer;">Corregir</button>
            <button data-act="hide" data-id="${escHtml(p.id)}" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); background:transparent; color:var(--color-text-secondary); font-size:13px; font-weight:700; cursor:pointer;">${p.hidden ? 'Mostrar' : 'Ocultar'}</button>
            <button data-act="delete" data-id="${escHtml(p.id)}" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid rgba(225,29,72,0.3); background:transparent; color:#e11d48; font-size:13px; font-weight:700; cursor:pointer;">Borrar</button>
          </div>
        </div>`;
    }).join('');
  };

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'mandadoPlaces'));
      // Primero lo que necesita al admin: visitas que no coinciden, después lo aproximado
      const weight = (p) => (p.verified ? 3 : p.conf.conflict ? 0 : p.conf.trusted ? 2 : 1);
      places = snap.docs.map(d => { const x = { id: d.id, ...d.data() }; x.conf = placeConfidence(x.samples, x.verified === true); return x; })
        .sort((a, b) => weight(a) - weight(b) || (b.visits || 0) - (a.visits || 0));
      render();
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<div style="padding:30px; text-align:center; color:var(--color-danger); font-weight:700;">No se pudieron cargar los lugares.</div>`;
    }
  };

  const save = async (id, data, okMsg) => {
    try {
      await updateDoc(doc(db, 'mandadoPlaces', id), { ...data, reviewedAt: serverTimestamp() });
      showToast(okMsg, 'success');
      loadMandadoPlaces({ force: true });
      await load();
    } catch (e) {
      console.error(e);
      showToast('No se pudo guardar: ' + e.message, 'error');
    }
  };

  const openEdit = (p) => {
    showModal({
      title: 'Corregir lugar',
      height: 'auto',
      content: `
        <div style="display:flex; flex-direction:column; gap:12px; padding:16px 20px;">
          <label style="font-size:12px; font-weight:800; color:var(--color-text-tertiary);">Nombre</label>
          <input id="place-edit-name" value="${escHtml(p.name)}" maxlength="80" style="height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 12px; font-size:14px; font-weight:700; background:var(--color-bg-secondary); color:var(--color-text);" />
          <label style="font-size:12px; font-weight:800; color:var(--color-text-tertiary);">Ubicación (latitud, longitud)</label>
          <input id="place-edit-coords" value="${p.lat}, ${p.lng}" style="height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 12px; font-size:14px; font-weight:700; background:var(--color-bg-secondary); color:var(--color-text);" />
          <div style="font-size:12px; color:var(--color-text-tertiary); line-height:1.5;">En Google Maps, mantené apretado sobre el comercio y copiá los números que aparecen arriba (por ejemplo -35.0811, -57.5146).</div>
        </div>`,
      footer: `<button id="place-edit-save" style="width:100%; height:48px; border-radius:14px; border:none; background:#0d9488; color:white; font-size:15px; font-weight:800; cursor:pointer;">Guardar y confirmar</button>`,
      onOpen: () => {
        document.getElementById('place-edit-save').onclick = async () => {
          const name = document.getElementById('place-edit-name').value.replace(/\s+/g, ' ').trim();
          const parts = document.getElementById('place-edit-coords').value.split(',').map(x => Number(x.trim()));
          const coords = { lat: parts[0], lng: parts[1] };
          if (!name) { showToast('Poné un nombre', 'warning'); return; }
          if (parts.length !== 2 || !inPlaceBounds(coords)) { showToast('La ubicación no parece de Magdalena. Revisá los números.', 'warning'); return; }
          closeModal();
          await save(p.id, { name: name.slice(0, 80), category: placeCategory(name) || p.category || null, lat: coords.lat, lng: coords.lng, verified: true }, 'Lugar corregido');
        };
      },
    });
  };

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const p = places.find(x => x.id === btn.dataset.id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === 'verify') save(p.id, { verified: true }, 'Lugar confirmado');
    else if (act === 'hide') save(p.id, { hidden: !p.hidden }, p.hidden ? 'Lugar visible otra vez' : 'Lugar oculto: la app ya no lo usa');
    else if (act === 'edit') openEdit(p);
    else if (act === 'delete') {
      showConfirm({
        title: '¿Borrar este lugar?',
        message: `Se borra "${escHtml(p.name)}". Si los repartidores vuelven a comprar ahí, la app lo aprende de nuevo.`,
        confirmText: 'Borrar',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'mandadoPlaces', p.id));
            showToast('Lugar borrado', 'success');
            loadMandadoPlaces({ force: true });
            await load();
          } catch (err) {
            showToast('No se pudo borrar: ' + err.message, 'error');
          }
        },
      });
    }
  });
  searchEl.addEventListener('input', render);
  load();
}
