// GoDelivery — Comercio Settings
import { db } from '../../firebase.js';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getState } from '../../state.js';
import { getRouteParams } from '../../router.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/modal.js';
import { icon } from '../../utils/icons.js';
import { openCropper } from '../../utils/cropper.js';
import { isAdmin } from '../../auth.js';

export async function renderComercioSettings() {
  const content = document.getElementById('app-content');
  const user = getState().user;
  const params = getRouteParams();
  const comercioId = params.id;

  if (!comercioId) {
    location.hash = '#/profile';
    return;
  }

  content.innerHTML = `
    <div class="panel-page" style="display:flex;flex-direction:column;height:100dvh;overflow:hidden;">
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;height:64px;padding:0 16px;background:var(--color-primary);box-shadow:0 4px 12px rgba(0,0,0,0.1);flex-shrink:0;overflow:hidden;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:12px;position:relative;z-index:2;flex:1;min-width:0;">
          <a href="#/mi-comercio/${comercioId}/orders" style="display:flex;align-items:center;justify-content:center;background:none;border:none;color:white;cursor:pointer;padding:0;text-decoration:none;">
            ${icon('chevronLeft', 28)}
          </a>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;">
            <span style="font-weight:800;font-size:20px;color:white;letter-spacing:-0.02em;">Configuración</span>
            <p id="panel-commerce-name" style="font-size:11px;color:rgba(255,255,255,0.85);margin:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></p>
          </div>
        </div>
      </div>

      <div style="flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;background:var(--color-bg-page);">
        <div id="settings-form-container">
          <div class="skeleton" style="height:400px;border-radius:var(--radius-lg);"></div>
        </div>
      </div>
    </div>
  `;

  try {
    const comercioSnap = await getDoc(doc(db, 'comercios', comercioId));
    if (!comercioSnap.exists()) {
      location.hash = '#/profile';
      return;
    }
    const comercioData = comercioSnap.data();
    if (comercioData.ownerId !== user.uid && !isAdmin()) {
      location.hash = '#/profile';
      return;
    }
    const nameContainer = document.getElementById('panel-commerce-name');
    if (nameContainer) nameContainer.textContent = comercioData.name;

    const comercio = comercioData;
    let croppedLogo = comercio.logo || '';
    let croppedBanner = comercio.banner || '';
    let comercioCoords = comercio.coords || null;

    // Load platform categories for the dropdown
    const platCatsSnap = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
    const platformCategories = platCatsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);

    if (!platformCategories.some(c => c.name === 'Comida')) {
      platformCategories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
    }

    let isActive = comercio.isActive || false;
    const formContainer = document.getElementById('settings-form-container');
    formContainer.innerHTML = `
      <style>
        .set-address-wrapper {
          position: relative;
          width: 100%;
        }
        .suggestions-list {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--color-surface);
          border: 1.5px solid var(--color-border-light);
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          z-index: 9999;
          max-height: 200px;
          overflow-y: auto;
          margin-top: 4px;
          display: none;
        }
        .suggestion-item {
          padding: 12px 16px;
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
          cursor: pointer;
          border-bottom: 1px solid var(--color-border-light);
          transition: background 0.2s;
        }
        .suggestion-item:last-child {
          border-bottom: none;
        }
        .suggestion-item:hover {
          background: var(--color-bg-secondary);
          color: var(--color-primary);
        }
      </style>
      <div class="panel-form" id="settings-form" style="display:flex; flex-direction:column; gap:20px; padding-bottom:40px;">
        
        <!-- Quick Management Hub Card -->
        <div class="admin-card" style="padding: 20px; background: linear-gradient(135deg, var(--color-primary-light) 0%, rgba(225,29,72,0.02) 100%); border: 1.5px solid rgba(225,29,72,0.12); border-radius: 20px; box-shadow: 0 4px 15px rgba(225, 29, 72, 0.04);">
          <h3 style="font-family: var(--font-display); font-size: 15px; font-weight: 800; color: var(--color-primary); margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px;">
            ${icon('store', 18)} Panel de Catálogo
          </h3>
          <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 16px 0; line-height: 1.45; opacity: 0.9;">
            Administrá el catálogo de tu comercio, sus productos, precios, variaciones y categorías de forma rápida y cómoda.
          </p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <a href="#/mi-comercio/${comercioId}/products" class="btn btn-primary" style="height: 48px; border-radius: 12px; font-size: 12px; font-weight: 800; text-transform: uppercase; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: var(--shadow-sm); text-decoration: none; border: none; width: 100%;">
              ${icon('package', 16)} Productos
            </a>
            <a href="#/mi-comercio/${comercioId}/offers" class="btn btn-primary" style="height: 48px; border-radius: 12px; font-size: 12px; font-weight: 800; text-transform: uppercase; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: var(--shadow-sm); text-decoration: none; border: none; width: 100%; background: linear-gradient(135deg, #a855f7 0%, #7e22ce 100%);">
              🏷️ Ofertas
            </a>
          </div>
        </div>

        <!-- Información General -->
        <div class="admin-card" style="padding:24px; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; box-shadow: var(--shadow-sm);">
          <h3 style="font-family: var(--font-display); font-size:16px; font-weight:800; color:var(--color-text-primary); margin:0 0 20px 0; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--color-border-light); padding-bottom:12px;">
            ${icon('info', 18)} Información General
          </h3>
          
          <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="panel-form-row" style="display:grid; grid-template-columns:1fr; gap:16px;">
              <div class="input-group" style="display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Nombre del comercio *</label>
                <input type="text" class="input" id="set-name" value="${comercio.name || ''}" placeholder="Mi Comercio" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%;" />
              </div>
              <div class="input-group" style="display:flex; flex-direction:column; gap:6px; margin-top: 10px;">
                <label style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Categoría *</label>
                <select class="input" id="set-category" style="height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); width:100%; background:var(--color-surface);">
                  <option value="">Seleccionar...</option>
                  ${platformCategories.map(c => `<option value="${c.name}" ${comercio.category === c.name ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="input-group" style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Descripción *</label>
              <textarea class="input" id="set-desc" placeholder="Describí tu comercio..." style="height:100px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:12px 16px; font-size:14px; font-weight:600; color:var(--color-text-primary); resize:none; line-height:1.5; width:100%;">${comercio.description || ''}</textarea>
            </div>

            <div class="input-group" style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Dirección (Ubicación) *</label>
              <div style="display:flex; gap:10px; width:100%; position:relative;">
                <div class="set-address-wrapper" style="flex:1; position:relative;">
                  <input type="text" class="input" id="set-address" value="${comercio.address || ''}" placeholder="Escribí calle y altura (ej: Goenaga 120)" autocomplete="off" style="width:100%; height:48px; border-radius:12px; border:1.5px solid var(--color-border-light); padding:0 16px; font-size:13px; font-weight:600; color:var(--color-text-primary); outline:none;" />
                  <div id="set-address-suggestions" class="suggestions-list"></div>
                </div>
                <button type="button" class="btn btn-primary" id="open-map-btn" style="width:48px; height:48px; border-radius:12px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border:none; box-shadow:var(--shadow-sm);">
                  ${icon('mapPin', 20)}
                </button>
              </div>
              <div id="settings-address-badge" style="display:none; font-size:12px; font-weight:700; color:#0d9488; background:rgba(13,148,136,0.08); border:1px solid rgba(13,148,136,0.2); border-radius:8px; padding:8px 12px; align-items:center; gap:6px; word-break:break-all; line-height:1.4; margin-top:8px;">
                ${icon('checkCircle', 14)} Dirección seleccionada y verificada
              </div>
            </div>
          </div>
        </div>

        <!-- Horarios -->
        <div class="admin-card" style="padding:24px; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; box-shadow: var(--shadow-sm);">
          <h3 style="font-family: var(--font-display); font-size:16px; font-weight:800; color:var(--color-text-primary); margin:0 0 16px 0; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--color-border-light); padding-bottom:12px;">
            ${icon('clock', 18)} Horarios de Atención *
          </h3>
          <div id="schedule-slots-container" style="display:flex; flex-direction:column; gap:10px;">
            <!-- Dynamic slots -->
          </div>
          <button type="button" class="btn btn-outline" id="add-schedule-slot-btn" style="margin-top:12px; height:40px; border-radius:12px; font-size:12px; font-weight:800; display:inline-flex; align-items:center; gap:6px; border:1.5px solid var(--color-border); background:var(--color-surface); color:var(--color-text-primary); padding:0 16px; cursor:pointer;">
            ${icon('plus', 14)} Agregar otro horario
          </button>
        </div>

        <!-- Imágenes -->
        <div class="admin-card" style="padding:24px; background:var(--color-surface); border:1px solid var(--color-border-light); border-radius:20px; box-shadow: var(--shadow-sm);">
          <h3 style="font-family: var(--font-display); font-size:16px; font-weight:800; color:var(--color-text-primary); margin:0 0 20px 0; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--color-border-light); padding-bottom:12px;">
            ${icon('upload', 18)} Imágenes
          </h3>
          
          <div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
            <div class="input-group" style="width:130px; display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
              <label style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Logo (Circular 1:1)</label>
              <div class="image-upload logo-upload" id="logo-upload-container" style="width:130px; height:130px; border-radius:50%; border:2px dashed var(--color-border); background:var(--color-bg-secondary); display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; cursor:pointer;">
                <img src="${comercio.logo || '/logo.png'}" alt="Logo" id="logo-preview" style="width:100%; height:100%; object-fit:cover; transition:all 0.3s; ${comercio.logo ? '' : 'opacity:0.35;'}" />
                <span class="image-upload-icon" style="font-size:24px; color:var(--color-text-tertiary); position:absolute; z-index:2; pointer-events:none; ${comercio.logo ? 'display:none;' : ''}">${icon('upload', 24)}</span>
                <input type="file" accept="image/*" id="logo-input" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
              </div>
              <small style="color:var(--color-text-tertiary); font-size:10px; line-height:1.3; display:block; margin-top:2px;">Recomendado: 512x512px (Formato Circular)</small>
            </div>
            
            <div class="input-group" style="flex:1; min-width:220px; display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:12px; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Banner (Horizontal 2:1)</label>
              <div class="image-upload" id="banner-upload-container" style="height:130px; border-radius:16px; border:2px dashed var(--color-border); background:var(--color-bg-secondary); display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden; position:relative; cursor:pointer; gap:6px;">
                <img src="${comercio.banner || '/logo.png'}" alt="Banner" id="banner-preview" style="width:100%; height:100%; object-fit:cover; position:absolute; inset:0; transition:all 0.3s; ${comercio.banner ? '' : 'opacity:0.12;'}" />
                <span class="image-upload-icon" style="color:var(--color-text-tertiary); position:absolute; z-index:2; pointer-events:none; ${comercio.banner ? 'display:none;' : ''}">${icon('upload', 28)}</span>
                <span class="image-upload-text" style="font-size:11px; font-weight:700; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; position:absolute; bottom:20px; z-index:2; pointer-events:none; ${comercio.banner ? 'display:none;' : ''}">Subir banner</span>
                <input type="file" accept="image/*" id="banner-input" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
              </div>
              <small style="color:var(--color-text-tertiary); font-size:10px; line-height:1.3; display:block; margin-top:2px;">Recomendado: 1200x600px (Aspecto 2:1 / Sin Espacios)</small>
            </div>
          </div>
        </div>

        <!-- Visibilidad -->
        <div class="admin-card" style="padding:20px; border: 1.5px solid ${isActive ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}; background: ${isActive ? 'rgba(34,197,94,0.02)' : 'rgba(239,68,68,0.02)'}; border-radius:20px; transition: all 0.3s;">
          <h3 style="font-family: var(--font-display); font-size:15px; font-weight:800; margin:0 0 12px 0; color:var(--color-text-primary); display:flex; align-items:center; gap:8px;">
            ${icon('eye', 18)} Visibilidad del Comercio
          </h3>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
            <div style="flex:1;">
              <div style="font-weight:800; font-size:13px; display:flex; align-items:center; gap:8px; color:var(--color-text-primary);">
                Estado: 
                <span id="status-label" style="background:${isActive ? '#22C55E' : 'var(--color-danger)'}; color:white; padding:3px 10px; border-radius:6px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; box-shadow:0 2px 6px ${isActive ? 'rgba(34,197,94,0.25)' : 'rgba(225,29,72,0.25)'}">
                  ${isActive ? 'Visible en Inicio' : 'Oculto (Inactivo)'}
                </span>
              </div>
              <div style="font-size:12px; color:var(--color-text-secondary); margin-top:6px; line-height:1.4; opacity:0.9;">
                ${isActive ? 'Los clientes pueden ver y realizar compras en tu tienda normalmente.' : 'Tu tienda no aparecerá en el inicio de la app ni en las búsquedas.'}
              </div>
            </div>
            <div class="switch ${isActive ? 'active' : ''}" id="set-active" style="flex-shrink:0;"></div>
          </div>
        </div>

        <!-- Panic Mode -->
        <div class="admin-card" id="pause-card" style="padding:20px; border:1.5px solid ${comercio.isPaused ? 'rgba(245,158,11,0.35)' : 'var(--color-border-light)'}; background:${comercio.isPaused ? 'rgba(245,158,11,0.03)' : 'var(--color-surface)'}; border-radius:20px; transition:all 0.3s; box-shadow: var(--shadow-sm);">
          <h3 style="font-family: var(--font-display); font-size:15px; font-weight:800; margin:0 0 12px 0; color:var(--color-text-primary); display:flex; align-items:center; gap:8px;">
            ${icon('xCircle', 18)} Modo Pánico — Pausar Ventas
          </h3>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
              <div id="pause-status-label" style="font-weight:800; font-size:13px; display:flex; align-items:center; gap:8px; color:var(--color-text-primary);">
                <span id="pause-dot" style="width:8px; height:8px; border-radius:50%; background:${comercio.isPaused ? '#f59e0b' : '#10b981'}; display:inline-block; box-shadow:0 0 0 2px ${comercio.isPaused ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}"></span>
                ${comercio.isPaused ? 'Ventas pausadas temporalmente' : 'Ventas activas'}
              </div>
              <div style="font-size:12px; color:var(--color-text-secondary); margin-top:6px; line-height:1.4; opacity:0.9;">
                Tu comercio ${comercio.isPaused ? 'no recibe nuevos pedidos.' : 'recibe pedidos normalmente.'}
              </div>
            </div>
            <button id="pause-toggle-settings" class="btn ${comercio.isPaused ? 'btn-primary' : 'btn-danger btn-outline'}" style="flex-shrink:0; height:42px; padding:0 20px; font-size:12px; font-weight:800; text-transform:uppercase; border-radius:12px; display:flex; align-items:center; gap:8px; cursor:pointer; border:1.5px solid ${comercio.isPaused ? 'var(--color-primary)' : 'var(--color-danger)'};">
              ${comercio.isPaused ? icon('play', 15) + ' Reanudar' : icon('xCircle', 15) + ' Pausar'}
            </button>
          </div>
        </div>

        <button class="btn btn-primary" id="save-settings-btn" style="height:52px; border-radius:16px; font-size:14px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow: 0 10px 25px rgba(var(--color-primary-rgb), 0.25); cursor:pointer; border:none; width:100%; margin-top:10px;">
          ${icon('check', 16)} Guardar Cambios
        </button>
      </div>
    `;



    // Location picker, autocomplete & geocoding setup
    const addressInput = document.getElementById('set-address');
    const suggestionsDropdown = document.getElementById('set-address-suggestions');
    const badgeEl = document.getElementById('settings-address-badge');

    const selectLocation = (coords, address) => {
      comercioCoords = coords;
      if (addressInput) addressInput.value = address;
      if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';

      if (badgeEl) {
        badgeEl.style.display = 'flex';
        badgeEl.innerHTML = `${icon('checkCircle', 14)} Dirección seleccionada y verificada: <span style="font-weight:800; margin-left:4px; color:var(--color-text-primary);">${address}</span>`;
      }
    };

    // Show verified badge initially if commerce coords already exist
    if (comercioCoords && comercio.address && badgeEl) {
      selectLocation(comercioCoords, comercio.address);
    }

    // Input-triggered Nominatim autocomplete search suggestions
    let debounceTimeout;
    addressInput?.addEventListener('input', (e) => {
      clearTimeout(debounceTimeout);
      const term = e.target.value;
      if (term.trim().length < 3) {
        if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
        return;
      }

      debounceTimeout = setTimeout(async () => {
        try {
          const { searchAddressSuggestions } = await import('../../utils/geo.js');
          const suggestions = await searchAddressSuggestions(term);
          if (suggestions.length === 0) {
            if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
            return;
          }

          if (suggestionsDropdown) {
            suggestionsDropdown.innerHTML = suggestions.map(s => `
              <div class="suggestion-item" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${s.address}">
                ${s.address}
              </div>
            `).join('');
            suggestionsDropdown.style.display = 'block';

            suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(item => {
              item.onclick = () => {
                const lat = parseFloat(item.dataset.lat);
                const lng = parseFloat(item.dataset.lng);
                const addr = item.dataset.addr;
                selectLocation({ lat, lng }, addr);
              };
            });
          }
        } catch (err) {
          console.error('Autocomplete error:', err);
        }
      }, 400);
    });

    // Close suggestions dropdown on outside click
    document.addEventListener('click', (e) => {
      if (addressInput && suggestionsDropdown) {
        if (!addressInput.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
          suggestionsDropdown.style.display = 'none';
        }
      }
    });

    // Fallback Map pinpointing button listener
    document.getElementById('open-map-btn')?.addEventListener('click', async () => {
      try {
        const { showLocationPicker } = await import('../../components/location-modal.js');
        showLocationPicker({
          initialCoords: comercioCoords,
          initialAddress: addressInput ? addressInput.value : '',
          onSelect: ({ coords, address }) => {
            selectLocation(coords, address);
          }
        });
      } catch (err) {
        console.error('Error loading location picker modal:', err);
        showToast('Error al abrir el mapa', 'error');
      }
    });

    // Cropper for Logo
    document.getElementById('logo-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const cropped = await openCropper(file, { aspectRatio: 1 });
          croppedLogo = cropped;
          const preview = document.getElementById('logo-preview');
          preview.src = cropped;
          preview.style.opacity = '1';
          document.querySelector('#logo-upload-container .image-upload-icon').style.display = 'none';
        } catch (err) {}
      }
    });

    // Cropper for Banner
    document.getElementById('banner-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const cropped = await openCropper(file, { aspectRatio: 16/8 });
          croppedBanner = cropped;
          const preview = document.getElementById('banner-preview');
          preview.src = cropped;
          preview.style.opacity = '1';
          document.querySelector('#banner-upload-container .image-upload-icon').style.display = 'none';
          document.querySelector('#banner-upload-container .image-upload-text').style.display = 'none';
        } catch (err) {}
      }
    });

    // Pause toggle listener
    let currentIsPaused = comercio.isPaused || false;
    document.getElementById('pause-toggle-settings')?.addEventListener('click', () => {
      const newState = !currentIsPaused;
      showConfirm({
        title: newState ? '¿Pausar ventas?' : '¿Reanudar ventas?',
        message: newState
          ? 'Tu comercio aparecerá como cerrado temporalmente. No recibirás nuevos pedidos.'
          : 'Tu comercio volverá a recibir pedidos normalmente.',
        confirmText: newState ? 'Sí, pausar' : 'Sí, reanudar',
        danger: newState,
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'comercios', comercioId), { isPaused: newState });
            currentIsPaused = newState;
            // Update UI reactively
            const btn = document.getElementById('pause-toggle-settings');
            const dot = document.getElementById('pause-dot');
            const label = document.getElementById('pause-status-label');
            const card = document.getElementById('pause-card');
            if (btn) {
              btn.className = `btn ${newState ? 'btn-primary' : 'btn-danger btn-outline'}`;
              btn.style.cssText = 'flex-shrink:0;height:40px;padding:0 18px;font-size:13px;font-weight:700;border-radius:10px;';
              btn.innerHTML = newState ? icon('play', 15) + ' Reanudar' : icon('xCircle', 15) + ' Pausar';
            }
            if (dot) dot.style.background = newState ? '#f59e0b' : '#10b981';
            if (label) label.innerHTML = `<span id="pause-dot" style="width:8px;height:8px;border-radius:50%;background:${newState ? '#f59e0b' : '#10b981'};display:inline-block;"></span> ${newState ? 'Ventas pausadas temporalmente' : 'Ventas activas'}`;
            if (card) {
              card.style.borderColor = newState ? 'rgba(245,158,11,0.3)' : 'rgba(0,0,0,0.12)';
              card.style.background = newState ? 'rgba(245,158,11,0.04)' : 'transparent';
            }
            showToast(newState ? '⏸ Ventas pausadas' : '▶ Ventas reanudadas', newState ? 'warning' : 'success');
          } catch (err) {
            console.error(err);
            showToast('Error al cambiar estado', 'error');
          }
        }
      });
    });

    const container = document.getElementById('schedule-slots-container');
    let schedules = Array.isArray(comercio.schedules) ? comercio.schedules : (comercio.schedule ? [comercio.schedule] : [{ open: '08:00', close: '20:00' }]);

    function renderSlots() {
      container.innerHTML = schedules.map((s, i) => `
        <div class="schedule-slot" data-index="${i}" style="display:flex; align-items:center; gap:10px; background:var(--color-bg-secondary); padding:8px 12px; border-radius:12px; border:1px solid var(--color-border-light);">
          <div style="flex:1;">
            <input type="time" class="slot-open" value="${s.open}" style="width:100%; height:38px; border-radius:8px; border:1px solid var(--color-border-light); padding:0 10px; font-size:13px; font-weight:700; color:var(--color-text-primary); text-align:center; background:var(--color-surface);" />
          </div>
          <span style="color:var(--color-text-tertiary); font-size:12px; font-weight:700; text-transform:uppercase;">a</span>
          <div style="flex:1;">
            <input type="time" class="slot-close" value="${s.close}" style="width:100%; height:38px; border-radius:8px; border:1px solid var(--color-border-light); padding:0 10px; font-size:13px; font-weight:700; color:var(--color-text-primary); text-align:center; background:var(--color-surface);" />
          </div>
          <button class="remove-slot-btn" data-index="${i}" style="background:none; border:none; padding:8px; color:var(--color-danger); cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:8px; transition:all 0.2s;">
            ${icon('trash', 16)}
          </button>
        </div>
      `).join('');
    }

    renderSlots();

    document.getElementById('add-schedule-slot-btn')?.addEventListener('click', () => {
      schedules.push({ open: '08:00', close: '20:00' });
      renderSlots();
    });

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.remove-slot-btn');
      if (btn) {
        const index = parseInt(btn.dataset.index);
        schedules.splice(index, 1);
        renderSlots();
      }
    });

    // Active toggle
    document.getElementById('set-active')?.addEventListener('click', () => {
      isActive = !isActive;
      const sw = document.getElementById('set-active');
      const label = document.getElementById('status-label');
      const card = sw.closest('.admin-card');
      
      sw.classList.toggle('active', isActive);
      if (label) {
        label.textContent = isActive ? 'Visible en Inicio' : 'Oculto (Inactivo)';
        label.style.background = isActive ? 'rgba(34,197,94,1)' : 'var(--color-danger)';
      }
      if (card) {
        card.style.borderColor = isActive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
        card.style.background = isActive ? 'rgba(34,197,94,0.02)' : 'rgba(239,68,68,0.02)';
      }
    });

    // Save
    document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('set-name')?.value.trim();
      const desc = document.getElementById('set-desc')?.value.trim();
      const cat = document.getElementById('set-category')?.value;
      const addr = document.getElementById('set-address')?.value.trim();


      // Collect schedules
      const finalSchedules = [];
      document.querySelectorAll('.schedule-slot').forEach(slot => {
        finalSchedules.push({
          open: slot.querySelector('.slot-open').value,
          close: slot.querySelector('.slot-close').value
        });
      });

      if (!name || !desc || !cat || !addr || finalSchedules.length === 0) {
        showToast('Por favor completá todos los campos obligatorios (*) e incluí al menos un horario', 'error');
        return;
      }

      const btn = document.getElementById('save-settings-btn');
      btn.disabled = true;
      btn.textContent = 'Guardando...';

      try {
        // Validate unique name in Firestore (excluding current commerce ID)
        const comsSnap = await getDocs(collection(db, 'comercios'));
        const duplicate = comsSnap.docs.some(d => {
          return d.id !== comercioId && d.data().name?.trim().toLowerCase() === name.toLowerCase();
        });
        
        if (duplicate) {
          showToast(`El nombre de comercio "${name}" ya está registrado por otra cuenta.`, 'error');
          btn.disabled = false;
          btn.innerHTML = `${icon('check', 16)} Guardar Cambios`;
          return;
        }

        const docRef = doc(db, 'comercios', comercioId);
        await setDoc(docRef, {
          name,
          description: desc,
          category: cat,
          address: addr,
          coords: comercioCoords,
          schedules: finalSchedules,
          logo: croppedLogo,
          banner: croppedBanner,
          isActive: isActive
        }, { merge: true });

        showToast('¡Cambios guardados!', 'success');
      } catch (e) {
        console.error('Error saving settings:', e);
        showToast('Error al guardar', 'error');
      }

      btn.disabled = false;
      btn.innerHTML = `${icon('check', 16)} Guardar Cambios`;
    });

    // Danger Zone
    const dangerZone = document.createElement('div');
    dangerZone.className = 'admin-card danger-zone';
    dangerZone.style.cssText = 'margin-top: 32px; padding: 20px; border: 1.5px dashed rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.03); border-radius: 20px;';
    dangerZone.innerHTML = `
      <h3 style="color:var(--color-danger); font-family: var(--font-display); font-size:15px; font-weight:800; margin: 0 0 8px 0; display:flex; align-items:center; gap:8px;">
        ${icon('warning', 18)} Zona de Peligro
      </h3>
      <p style="font-size:12px; color:var(--color-text-secondary); margin: 0 0 16px 0; line-height:1.45; opacity: 0.9;">
        Eliminar el comercio borrará permanentemente todos los productos, categorías e historial asociados. Esta acción es definitiva y no se puede deshacer.
      </p>
      <button class="btn btn-danger btn-outline" id="delete-comercio-btn" style="height:44px; width:100%; border-radius:12px; font-size:12px; font-weight:800; text-transform:uppercase; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; border: 1.5px solid var(--color-danger); background: transparent; color: var(--color-danger);">
        ${icon('trash', 16)} Eliminar definitivamente este comercio
      </button>
    `;
    document.getElementById('settings-form')?.appendChild(dangerZone);

    document.getElementById('delete-comercio-btn')?.addEventListener('click', async () => {
      const { showConfirm } = await import('../../components/modal.js');
      const { deleteDoc, doc } = await import('firebase/firestore');
      
      showConfirm({
        title: '¿Eliminar comercio permanentemente?',
        message: 'Escribe "ELIMINAR" para confirmar que deseas borrar toda la información de esta tienda.',
        confirmText: 'Sí, eliminar comercio',
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'comercios', comercioId));
            showToast('Comercio eliminado con éxito', 'success');
            location.hash = '#/profile';
          } catch (err) {
            console.error('Error deleting commerce:', err);
            showToast('Error al eliminar el comercio', 'error');
          }
        }
      });
    });

    // Save initial state to track modifications
    const getFormState = () => {
      return JSON.stringify({
        name: document.getElementById('set-name')?.value.trim(),
        category: document.getElementById('set-category')?.value,
        desc: document.getElementById('set-desc')?.value.trim(),
        address: document.getElementById('set-address')?.value.trim(),
        logo: croppedLogo,
        banner: croppedBanner,
        isActive: isActive,
        isPaused: currentIsPaused,
        schedules: (() => {
          const finalSchedules = [];
          document.querySelectorAll('.schedule-slot').forEach(slot => {
            finalSchedules.push({
              open: slot.querySelector('.slot-open').value,
              close: slot.querySelector('.slot-close').value
            });
          });
          return finalSchedules;
        })()
      });
    };

    let initialFormState = getFormState();
    let savedSuccessfully = false;

    // Save success update
    const originalSaveHandler = document.getElementById('save-settings-btn').onclick;
    document.getElementById('save-settings-btn').addEventListener('click', () => {
      savedSuccessfully = true;
      setTimeout(() => {
        initialFormState = getFormState();
        savedSuccessfully = false;
      }, 800);
    });

    const beforeUnloadGuard = (e) => {
      if (getFormState() !== initialFormState && !savedSuccessfully) {
        e.preventDefault();
        e.returnValue = 'Tenés cambios sin guardar. ¿Seguro que querés salir?';
        return e.returnValue;
      }
    };

    // Browser unload guard
    window.addEventListener('beforeunload', beforeUnloadGuard);

    // Hash navigation guard
    let bypassHashChange = false;
    const hashChangeGuard = async (e) => {
      if (bypassHashChange) return;
      if (getFormState() !== initialFormState && !savedSuccessfully) {
        // Stop routing momentarily by restoring original hash
        const oldURL = e.oldURL;
        const newURL = e.newURL;
        const oldHash = oldURL.substring(oldURL.indexOf('#'));
        
        e.preventDefault();
        bypassHashChange = true;
        window.location.hash = oldHash;
        bypassHashChange = false;

        const { showConfirm } = await import('../../components/modal.js');
        showConfirm({
          title: 'Cambios sin guardar',
          message: 'Tenés modificaciones en la configuración que no guardaste. ¿Seguro que querés salir y perder los cambios?',
          confirmText: 'Salir sin guardar',
          cancelText: 'Seguir editando',
          danger: true,
          onConfirm: () => {
            // Manually navigate forward since user approved
            bypassHashChange = true;
            window.location.hash = newURL.substring(newURL.indexOf('#'));
            setTimeout(() => {
              bypassHashChange = false;
            }, 100);
          }
        });
      }
    };

    window.addEventListener('hashchange', hashChangeGuard);

    return {
      cleanup: () => {
        window.removeEventListener('beforeunload', beforeUnloadGuard);
        window.removeEventListener('hashchange', hashChangeGuard);
      }
    };

  } catch (e) {
    console.error('Error loading settings:', e);
    showToast('Error al cargar configuración', 'error');
  }
}
