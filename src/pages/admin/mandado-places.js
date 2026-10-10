// GoDelivery — Admin: lugares de los mandados
// Dónde queda cada comercio que los clientes escriben a mano. La app los aprende con la ubicación
// del repartidor al terminar de comprar; acá se revisan, se corrigen y se confirman. El admin también
// puede cargar los que quiera a mano (quedan confirmados desde el principio).
import { db } from '../../firebase.js';
import { collection, getDocs, getDoc, setDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { showToast } from '../../components/toast.js';
import { showModal, closeModal, showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { categoryLabel, placeCategory, placeSlug, inPlaceBounds, placeConfidence } from '../../utils/mandado-places.js';
import { loadMandadoPlaces } from '../../utils/mandado-places-store.js';

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const FIELD = 'height:44px; border-radius:12px; border:1px solid var(--color-border); padding:0 12px; font-size:14px; font-weight:700; background:var(--color-bg-secondary); color:var(--color-text); box-sizing:border-box; width:100%;';
const LABEL = 'font-size:12px; font-weight:800; color:var(--color-text-tertiary);';

/** Formulario de un lugar (alta o corrección). */
function placeFormHtml(p = {}) {
  const coords = Number.isFinite(p.lat) && Number.isFinite(p.lng) ? `${p.lat}, ${p.lng}` : '';
  return `
    <div style="display:flex; flex-direction:column; gap:10px; padding:16px 20px;">
      <label style="${LABEL}">Nombre del comercio</label>
      <input id="place-form-name" value="${escHtml(p.name || '')}" maxlength="80" placeholder="Ej: Farmacia Pasteur" style="${FIELD}" />
      <label style="${LABEL} margin-top:4px;">Dirección (opcional)</label>
      <input id="place-form-address" value="${escHtml(p.address || '')}" maxlength="120" placeholder="Ej: Chacabuco 451" style="${FIELD}" />
      <label style="${LABEL} margin-top:4px;">Ubicación</label>
      <button type="button" id="place-form-map" style="height:44px; border-radius:12px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:14px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
        ${icon('mapPin', 16)} Elegir en el mapa
      </button>
      <input id="place-form-coords" value="${coords}" placeholder="O pegá latitud, longitud (ej: -35.0811, -57.5146)" style="${FIELD}" />
      <div style="font-size:12px; color:var(--color-text-tertiary); line-height:1.5;">En Google Maps, mantené apretado sobre el comercio y copiá los números que aparecen arriba.</div>
    </div>`;
}

/** Lee y valida el formulario. Devuelve null (y avisa) si falta algo. */
function readPlaceForm() {
  const name = document.getElementById('place-form-name').value.replace(/\s+/g, ' ').trim().slice(0, 80);
  const address = document.getElementById('place-form-address').value.replace(/\s+/g, ' ').trim().slice(0, 120);
  const parts = document.getElementById('place-form-coords').value.split(',').map(x => Number(x.trim()));
  const coords = { lat: parts[0], lng: parts[1] };
  if (!name) { showToast('Poné un nombre', 'warning'); return null; }
  if (parts.length !== 2 || !inPlaceBounds(coords)) { showToast('Elegí la ubicación en el mapa o revisá los números: no parece de Magdalena.', 'warning'); return null; }
  return { name, address, lat: coords.lat, lng: coords.lng };
}

/** "Elegir en el mapa": completa coordenadas (y la dirección si estaba vacía). */
function wireMapButton() {
  document.getElementById('place-form-map').onclick = async () => {
    const coordsEl = document.getElementById('place-form-coords');
    const addressEl = document.getElementById('place-form-address');
    const parts = coordsEl.value.split(',').map(x => Number(x.trim()));
    const initialCoords = parts.length === 2 && inPlaceBounds({ lat: parts[0], lng: parts[1] }) ? { lat: parts[0], lng: parts[1] } : null;
    const { showLocationPicker } = await import('../../components/location-modal.js');
    // El mapa se abre encima del formulario; al confirmar vuelve a él con los campos completos.
    showLocationPicker({
      initialCoords,
      initialAddress: addressEl.value,
      onSelect: ({ coords, address }) => {
        if (!coords) return;
        coordsEl.value = `${Number(coords.lat).toFixed(6)}, ${Number(coords.lng).toFixed(6)}`;
        if (!addressEl.value.trim() && address) addressEl.value = String(address).split(',')[0].trim();
      },
    });
  };
}

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
          <p style="font-size:11px; color:rgba(255,255,255,0.8); font-weight:800; margin:2px 0 0; text-transform:uppercase; letter-spacing:0.06em;">Aprendidos y cargados a mano</p>
        </div>
      </div>
      <div style="flex:1; overflow-y:auto; padding:16px 16px 40px; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:13px; color:var(--color-text-secondary); line-height:1.5; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:16px; padding:12px 14px;">
          Cuando un repartidor termina de comprar en un comercio que el cliente escribió a mano, la app guarda dónde estaba.
          Con varias visitas el punto se afina solo. Confirmá los que estén bien; editá (nombre, dirección o ubicación) u ocultá los que no.
          También podés cargar los lugares que quieras con <b>Agregar lugar</b>.
          Los comercios adheridos no aparecen acá: usan su propia dirección.
        </div>
        <button type="button" id="places-add" style="height:48px; border-radius:14px; border:none; background:var(--go-ink); color:#fff; font-size:15px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; flex-shrink:0;">
          ${icon('plus', 18)} Agregar lugar
        </button>
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
      listEl.innerHTML = `<div style="padding:30px; text-align:center; color:var(--color-text-tertiary); font-weight:700;">${places.length ? 'Nada coincide con la búsqueda' : 'Todavía no hay lugares. Agregá uno o esperá a que los repartidores completen mandados.'}</div>`;
      return;
    }
    listEl.innerHTML = shown.map(p => {
      const samples = Array.isArray(p.samples) ? p.samples.length : 0;
      const status = p.hidden ? ['Oculto', '#64748b', 'rgba(100,116,139,0.12)']
        : p.verified ? ['Confirmado', 'var(--go-green)', 'rgba(14,159,110,0.12)']
          : p.conf.conflict ? ['A revisar: las visitas no coinciden', '#e11d48', 'rgba(225,29,72,0.1)']
            : p.conf.trusted ? ['Seguro (visitas coinciden)', 'var(--go-green)', 'rgba(14,159,110,0.08)']
              : ['Aproximado (1 visita)', '#b45309', 'rgba(245,158,11,0.14)'];
      return `
        <div style="background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:18px; padding:14px; display:flex; flex-direction:column; gap:10px; ${p.hidden ? 'opacity:0.6;' : ''}">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
            <div style="min-width:0;">
              <div style="font-weight:800; font-size:15px; color:var(--color-text);">${escHtml(p.name)}</div>
              <div style="font-size:12px; color:var(--color-text-tertiary); font-weight:600; margin-top:2px;">
                ${escHtml(p.category ? categoryLabel(p.category) : 'Sin rubro')} · ${p.visits || samples ? `${p.visits || 0} visita${p.visits === 1 ? '' : 's'} · ${samples} punto${samples === 1 ? '' : 's'} guardado${samples === 1 ? '' : 's'}` : 'Cargado a mano'}
              </div>
              ${p.address ? `<div style="font-size:12px; color:var(--color-text-secondary); font-weight:600; margin-top:2px;">${escHtml(p.address)}</div>` : ''}
            </div>
            <span style="flex-shrink:0; font-size:11px; font-weight:800; color:${status[1]}; background:${status[2]}; padding:4px 8px; border-radius:8px;">${status[0]}</span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener noreferrer" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); color:var(--color-text); font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; text-decoration:none;">${icon('mapPin', 14)} Ver en el mapa</a>
            ${samples > 1 ? `<a href="https://www.google.com/maps/dir/${p.samples.map(s => `${s.lat},${s.lng}`).join('/')}" target="_blank" rel="noopener noreferrer" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); color:var(--color-text); font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; text-decoration:none;">Ver las ${samples} visitas</a>` : ''}
            ${p.verified ? '' : `<button data-act="verify" data-id="${escHtml(p.id)}" style="height:36px; padding:0 12px; border-radius:10px; border:none; background:var(--go-ink); color:white; font-size:13px; font-weight:800; cursor:pointer;">Confirmar</button>`}
            <button data-act="edit" data-id="${escHtml(p.id)}" style="height:36px; padding:0 12px; border-radius:10px; border:1px solid var(--color-border); background:transparent; color:var(--color-text); font-size:13px; font-weight:700; cursor:pointer;">Editar</button>
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

  const BTN = 'width:100%; height:48px; border-radius:14px; font-size:15px; font-weight:800; cursor:pointer;';

  const openEdit = (p) => {
    showModal({
      title: 'Editar lugar',
      height: 'auto',
      content: placeFormHtml(p),
      footer: `<button id="place-form-save" style="${BTN} border:none; background:var(--go-ink); color:white;">Guardar y confirmar</button>`,
      onOpen: () => {
        wireMapButton();
        document.getElementById('place-form-save').onclick = async () => {
          const f = readPlaceForm();
          if (!f) return;
          closeModal();
          await save(p.id, { name: f.name, address: f.address, category: placeCategory(f.name) || p.category || null, lat: f.lat, lng: f.lng, verified: true }, 'Lugar actualizado');
        };
      },
    });
  };

  // Alta a mano: queda confirmado. Cada nombre es un lugar; para dos sucursales, nombres distintos.
  const openAdd = () => {
    showModal({
      title: 'Agregar lugar',
      height: 'auto',
      content: placeFormHtml(),
      footer: `
        <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
          <button id="place-form-save" style="${BTN} border:none; background:var(--go-ink); color:white;">Guardar</button>
          <button id="place-form-save-more" style="${BTN} border:1px solid var(--color-border); background:transparent; color:var(--color-text);">Guardar y agregar otro</button>
        </div>`,
      onOpen: () => {
        wireMapButton();
        const create = async (again) => {
          const f = readPlaceForm();
          if (!f) return;
          const slug = placeSlug(f.name);
          if (!slug) { showToast('Poné un nombre con letras o números', 'warning'); return; }
          const ref = doc(db, 'mandadoPlaces', slug);
          try {
            if ((await getDoc(ref)).exists()) {
              showToast('Ya hay un lugar con ese nombre. Editalo desde la lista o sumale la sucursal al nombre (ej. "Farmacia Pasteur Centro").', 'warning');
              return;
            }
            await setDoc(ref, {
              name: f.name, slug, address: f.address, category: placeCategory(f.name), lat: f.lat, lng: f.lng,
              verified: true, visits: 0, samples: [], createdAt: serverTimestamp(), reviewedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error(e);
            showToast('No se pudo guardar: ' + e.message, 'error');
            return;
          }
          showToast(`"${f.name}" agregado`, 'success');
          loadMandadoPlaces({ force: true });
          load();
          if (again) {
            ['place-form-name', 'place-form-address', 'place-form-coords'].forEach(id => { document.getElementById(id).value = ''; });
            document.getElementById('place-form-name').focus();
          } else {
            closeModal();
          }
        };
        document.getElementById('place-form-save').onclick = () => create(false);
        document.getElementById('place-form-save-more').onclick = () => create(true);
      },
    });
  };
  content.querySelector('#places-add').onclick = openAdd;

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
