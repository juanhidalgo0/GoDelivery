// Local → Datos y fotos: nombre, rubros, descripción, teléfono, dirección, logo y portada.
// (Horarios, PIN y la zona peligrosa viven en sus propias pantallas: ver local.js.)
import { db } from '../../firebase.js';
import { doc, getDoc, setDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getRouteParams } from '../../router.js';
import { showToast } from '../../components/toast.js';
import { icon } from '../../utils/icons.js';
import { escapeHtml as esc } from '../../utils/escape.js';
import { openCropper } from '../../utils/cropper.js';
import { uploadDataUrlImage } from '../../utils/storage-upload.js';
import { createSlug } from '../../utils/slug.js';
import { enterCommercePanel, cpSkeleton, cpEmpty } from './shell.js';

// El Kiosco Paulos sincroniza stock con su sistema de caja
const POS_SYNC_COMERCIO = '6R8ikb9wsjUCQuOANOMHuAZZxss2';

export async function renderComercioSettings() {
  const comercioId = getRouteParams().id;
  if (!comercioId) return;
  const body = await enterCommercePanel({
    comercioId, tab: 'local',
    sub: { title: 'Datos y fotos', back: `#/mi-comercio/${comercioId}/settings` },
  });
  if (!body) return;
  body.innerHTML = `<div class="cp-page">${cpSkeleton(3, 140)}</div>`;

  let comercio;
  let platformCategories = [];
  try {
    const [snap, catsSnap] = await Promise.all([
      getDoc(doc(db, 'comercios', comercioId)),
      getDocs(query(collection(db, 'platformCategories'), orderBy('order'))),
    ]);
    comercio = snap.data() || {};
    platformCategories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);
  } catch (e) {
    console.error('Datos del local:', e);
    body.innerHTML = cpEmpty('alertTriangle', 'No pudimos cargar tus datos', 'Revisá la conexión y volvé a entrar.');
    return;
  }
  if (!platformCategories.some(c => c.name === 'Comida')) platformCategories.unshift({ id: 'comida', name: 'Comida', order: -1 });
  if (!platformCategories.some(c => c.name === 'Pizzería')) platformCategories.push({ id: 'pizzeria', name: 'Pizzería', order: 10 });

  const cats = comercio.categories || (comercio.category ? [comercio.category] : []);
  const showPosSync = comercioId === POS_SYNC_COMERCIO || comercio.bidirectionalSyncEnabled === true;
  let logo = comercio.logo || '';
  let banner = comercio.banner || '';
  let coords = comercio.coords || null;
  let isActive = comercio.isActive !== false;
  let posSync = comercio.bidirectionalSyncEnabled === true;

  const catSelect = (i, required) => `
    <select class="cp-select" id="set-category-${i + 1}">
      <option value="">${required ? 'Elegí un rubro' : 'Ninguno'}</option>
      ${platformCategories.map(c => `<option value="${esc(c.name)}" ${cats[i] === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select>`;

  body.innerHTML = `
    <div class="cp-page" id="cp-datos">
      <div class="cp-card">
        <div class="cp-row" style="gap:14px; align-items:flex-start">
          <label style="position:relative; cursor:pointer; flex-shrink:0" aria-label="Cambiar logo">
            <img id="logo-preview" src="${esc(logo || '/logo.png')}" alt="" style="width:84px; height:84px; border-radius:50%; object-fit:cover; border:1px solid var(--go-line); background:var(--go-paper)" />
            <span class="cp-btn is-sm is-ink" style="position:absolute; right:-6px; bottom:-4px; min-height:30px; padding:0 8px; border-radius:999px">${icon('camera', 14)}</span>
            <input type="file" accept="image/*" id="logo-input" hidden />
          </label>
          <div class="cp-grow">
            <div class="cp-strong">Logo</div>
            <div class="cp-muted">Cuadrado, se ve redondo en la app. Tocalo para cambiarlo.</div>
          </div>
        </div>
        <label style="display:block; position:relative; margin-top:14px; cursor:pointer" aria-label="Cambiar portada">
          <img id="banner-preview" src="${esc(banner || '/logo.png')}" alt="" style="width:100%; aspect-ratio:2/1; object-fit:cover; border-radius:14px; border:1px solid var(--go-line); background:var(--go-paper); ${banner ? '' : 'opacity:.35'}" />
          <span class="cp-btn is-sm is-ink" style="position:absolute; right:10px; bottom:10px">${icon('camera', 14)} Cambiar portada</span>
          <input type="file" accept="image/*" id="banner-input" hidden />
        </label>
      </div>

      <div class="cp-card">
        <div class="cp-field"><label class="cp-label" for="set-name">Nombre del local</label><input class="cp-input" id="set-name" maxlength="60" value="${esc(comercio.name || '')}" placeholder="Pizzería Don Juan" /></div>
        <div class="cp-field"><label class="cp-label" for="set-desc">Descripción</label><textarea class="cp-textarea" id="set-desc" maxlength="300" placeholder="Pizzas a la piedra y empanadas caseras.">${esc(comercio.description || '')}</textarea></div>
        <div class="cp-field"><label class="cp-label" for="set-phone">Teléfono o WhatsApp del local</label><input class="cp-input" id="set-phone" inputmode="tel" maxlength="20" value="${esc(comercio.phone || '')}" placeholder="2221 456789" /><span class="cp-small">Lo usan los cadetes si tienen que avisarte algo.</span></div>
        <div class="cp-field" style="margin-bottom:0">
          <span class="cp-label">Rubros (en qué secciones de la app aparecés)</span>
          <div style="display:grid; gap:8px">${catSelect(0, true)}${catSelect(1)}${catSelect(2)}</div>
        </div>
      </div>

      <div class="cp-card">
        <div class="cp-field" style="margin-bottom:6px">
          <label class="cp-label" for="set-address">Dirección</label>
          <div class="cp-row" style="position:relative">
            <div class="cp-grow" style="position:relative">
              <input class="cp-input" id="set-address" autocomplete="off" value="${esc(comercio.address || '')}" placeholder="San Martín 1240" />
              <div id="set-address-suggestions" class="cp-list" style="display:none; position:absolute; left:0; right:0; top:52px; z-index:20; max-height:240px; overflow:auto"></div>
            </div>
            <button type="button" class="cp-btn" id="open-map-btn" aria-label="Elegir en el mapa">${icon('mapPin', 18)} Mapa</button>
          </div>
        </div>
        <div id="settings-address-badge" class="cp-small" style="color:var(--go-green); ${coords ? '' : 'display:none'}">${icon('checkCircle', 14)} Ubicación marcada en el mapa</div>
      </div>

      <div class="cp-list">
        <div class="cp-item" style="cursor:default">
          <span class="cp-grow"><span class="cp-item-title">Visible en la app</span><span class="cp-item-sub" style="display:block" id="active-sub">${isActive ? 'Los clientes te encuentran en el inicio y el buscador.' : 'Tu local no aparece en la app.'}</span></span>
          <button type="button" class="cp-switch" role="switch" aria-label="Visible en la app" aria-checked="${isActive}" id="set-active"></button>
        </div>
        ${showPosSync ? `
        <div class="cp-item" style="cursor:default">
          <span class="cp-grow"><span class="cp-item-title">Sincronizar stock con la caja</span><span class="cp-item-sub" style="display:block">GoPortal / Kiosco POS: descuenta y actualiza el stock solo.</span></span>
          <button type="button" class="cp-switch" role="switch" aria-label="Sincronizar stock con la caja" aria-checked="${posSync}" id="set-bidirectional-sync"></button>
        </div>` : ''}
      </div>

      <p class="cp-small" id="cp-datos-error" style="color:var(--go-red); margin:0 2px 10px" hidden></p>
      <button type="button" class="cp-btn is-ink is-block" id="save-settings-btn">${icon('check', 18)} Guardar cambios</button>
    </div>`;

  const root = body.querySelector('#cp-datos');
  const $ = (id) => root.querySelector(`#${id}`);

  // --- dirección: sugerencias mientras escribe, o elegir en el mapa
  const addressInput = $('set-address');
  const suggestions = $('set-address-suggestions');
  const badge = $('settings-address-badge');
  const selectLocation = (c, address) => {
    coords = c;
    addressInput.value = address;
    suggestions.style.display = 'none';
    badge.style.display = '';
  };
  let debounce;
  addressInput.addEventListener('input', (e) => {
    clearTimeout(debounce);
    coords = null;
    badge.style.display = 'none';
    const term = e.target.value;
    if (term.trim().length < 3) { suggestions.style.display = 'none'; return; }
    debounce = setTimeout(async () => {
      try {
        const { searchAddressSuggestions } = await import('../../utils/geo.js');
        const list = await searchAddressSuggestions(term);
        if (!list.length) { suggestions.style.display = 'none'; return; }
        suggestions.innerHTML = list.map(s => `<button type="button" class="cp-item" data-lat="${s.lat || ''}" data-lng="${s.lng || ''}" data-placeid="${esc(s.placeId || '')}" data-addr="${esc(s.address)}">${esc(s.address)}</button>`).join('');
        suggestions.style.display = 'block';
      } catch (err) { console.error('Autocomplete:', err); }
    }, 400);
  });
  suggestions.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-addr]');
    if (!item) return;
    const lat = parseFloat(item.dataset.lat), lng = parseFloat(item.dataset.lng);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) { selectLocation({ lat, lng }, item.dataset.addr); return; }
    if (item.dataset.placeid) {
      const { geocodePlaceId } = await import('../../utils/geo.js');
      const c = await geocodePlaceId(item.dataset.placeid);
      if (c) selectLocation({ lat: c.lat, lng: c.lng }, item.dataset.addr);
    }
  });
  $('open-map-btn').addEventListener('click', async () => {
    try {
      const { showLocationPicker } = await import('../../components/location-modal.js');
      showLocationPicker({ initialCoords: coords, initialAddress: addressInput.value, onSelect: ({ coords: c, address }) => selectLocation(c, address) });
    } catch (err) { showToast('No se pudo abrir el mapa', 'error'); }
  });

  // --- imágenes
  $('logo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { logo = await openCropper(file, { aspectRatio: 1, circular: true }); $('logo-preview').src = logo; } catch (err) {}
    e.target.value = '';
  });
  $('banner-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { banner = await openCropper(file, { aspectRatio: 16 / 8 }); $('banner-preview').src = banner; $('banner-preview').style.opacity = '1'; } catch (err) {}
    e.target.value = '';
  });

  // --- interruptores
  $('set-active').addEventListener('click', (e) => {
    isActive = !isActive;
    e.currentTarget.setAttribute('aria-checked', String(isActive));
    $('active-sub').textContent = isActive ? 'Los clientes te encuentran en el inicio y el buscador.' : 'Tu local no aparece en la app.';
  });
  $('set-bidirectional-sync')?.addEventListener('click', (e) => {
    posSync = !posSync;
    e.currentTarget.setAttribute('aria-checked', String(posSync));
  });

  // --- guardar
  $('save-settings-btn').addEventListener('click', async () => {
    const err = $('cp-datos-error');
    const name = $('set-name').value.trim();
    const description = $('set-desc').value.trim();
    const phone = $('set-phone').value.trim();
    const categories = [...new Set([1, 2, 3].map(i => $(`set-category-${i}`).value).filter(Boolean))];
    const address = addressInput.value.trim();

    const missing = [];
    if (!name) missing.push('el nombre');
    if (!description) missing.push('la descripción');
    if (!categories.length) missing.push('un rubro');
    if (!address || !coords) missing.push('la dirección marcada en el mapa (elegí una sugerencia o usá "Mapa")');
    if (!logo) missing.push('el logo');
    if (!banner) missing.push('la portada');
    if (missing.length) {
      err.textContent = `Falta ${missing.join(', ')}.`;
      err.hidden = false;
      return;
    }
    err.hidden = true;

    const btn = $('save-settings-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const all = await getDocs(collection(db, 'comercios'));
      if (all.docs.some(d => d.id !== comercioId && d.data().name?.trim().toLowerCase() === name.toLowerCase())) {
        err.textContent = `Ya hay otro local que se llama "${name}". Probá con otro nombre.`;
        err.hidden = false;
        return;
      }
      const [logoUrl, bannerUrl] = await Promise.all([
        uploadDataUrlImage(logo, `comercios/${comercioId}/logo`),
        uploadDataUrlImage(banner, `comercios/${comercioId}/banner`),
      ]);
      logo = logoUrl;
      banner = bannerUrl;
      const data = {
        name, description, phone, categories, category: categories[0],
        slug: comercio.slug || createSlug(name),
        address, coords, logo: logoUrl, banner: bannerUrl, isActive,
      };
      if (showPosSync) data.bidirectionalSyncEnabled = posSync;
      await setDoc(doc(db, 'comercios', comercioId), data, { merge: true });
      // La tienda y el inicio usan copias guardadas: se borran para que se vea el cambio ya
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('gd_cache_meta_') || k.startsWith('gd_comercio_cache_'))) localStorage.removeItem(k);
      }
      showToast('Datos guardados', 'success');
    } catch (e) {
      console.error('Guardar datos:', e);
      showToast('No se pudo guardar. Probá de nuevo.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check', 18)} Guardar cambios`;
    }
  });
}
