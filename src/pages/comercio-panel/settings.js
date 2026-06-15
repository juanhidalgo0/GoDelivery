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
      <div style="position:sticky;top:0;z-index:100;display:flex;align-items:center;height:calc(64px + env(safe-area-inset-top, 0px));padding:env(safe-area-inset-top, 0px) 16px 0 16px;background:var(--color-primary);box-shadow:0 4px 12px rgba(0,0,0,0.1);flex-shrink:0;overflow:hidden;">
        <!-- Decorative Circles -->
        <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(255,255,255,0.08); border-radius: 50%; pointer-events: none;"></div>
        
        <div style="display:flex;align-items:center;gap:12px;position:relative;z-index:2;flex:1;min-width:0;">
          <a href="#/mi-comercio/${comercioId}" style="display:flex;align-items:center;justify-content:center;background:none;border:none;color:white;cursor:pointer;padding:0;text-decoration:none;">
            ${icon('chevronLeft', 28)}
          </a>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;">
            <span style="font-weight:800;font-size:20px;color:white;letter-spacing:-0.02em;">${isAdmin() ? 'Adm: Configuración' : 'Configuración'}</span>
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
    if (nameContainer) nameContainer.textContent = isAdmin() ? `Adm: ${comercioData.name}` : comercioData.name;

    const comercio = comercioData;
    const isSyncAllowed = (comercioId === '6R8ikb9wsjUCQuOANOMHuAZZxss2' || comercio.ownerId === user.uid);
    let croppedLogo = comercio.logo || '';
    let croppedBanner = comercio.banner || '';
    let comercioCoords = comercio.coords || null;

    // Load platform categories for the dropdown
    const platCatsSnap = await getDocs(query(collection(db, 'platformCategories'), orderBy('order')));
    const platformCategories = platCatsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.isActive !== false);

    if (!platformCategories.some(c => c.name === 'Comida')) {
      platformCategories.unshift({ id: 'comida', name: 'Comida', icon: '🍕', order: -1 });
    }
    if (!platformCategories.some(c => c.name === 'Pizzería')) {
      platformCategories.push({ id: 'pizzeria', name: 'Pizzería', icon: '🍕', order: 10 });
    }

    const categories = comercio.categories || (comercio.category ? [comercio.category] : []);
    let isActive = comercio.isActive || false;
    let bidirectionalSyncEnabled = comercio.bidirectionalSyncEnabled || false;
    const formContainer = document.getElementById('settings-form-container');
    formContainer.innerHTML = `
      <style>
        .settings-layout {
          max-width: 680px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 8px 0 60px;
        }
        .settings-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.02), 0 2px 6px -1px rgba(0, 0, 0, 0.02);
          transition: all 0.25s ease;
        }
        .settings-card:hover {
          box-shadow: 0 8px 24px -2px rgba(0, 0, 0, 0.04), 0 4px 10px -1px rgba(0, 0, 0, 0.03);
        }
        .settings-title {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 850;
          color: var(--color-text-primary);
          margin: 0 0 18px 0;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--color-border-light);
          padding-bottom: 12px;
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .input-group label {
          font-size: 11px;
          font-weight: 800;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .input-styled {
          height: 46px;
          border-radius: 10px;
          border: 1.5px solid var(--color-border-light);
          background: var(--color-bg-page);
          padding: 0 14px;
          font-size: 13.5px;
          font-weight: 650;
          color: var(--color-text-primary);
          width: 100%;
          outline: none;
          transition: all 0.2s ease;
        }
        .input-styled:focus {
          border-color: var(--color-primary);
          background: var(--color-surface);
          box-shadow: 0 0 0 3px rgba(225, 29, 72, 0.06);
        }
        textarea.input-styled {
          height: 90px;
          padding: 10px 14px;
          resize: none;
          line-height: 1.5;
        }
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
        .image-upload-box {
          border: 2.5px dashed var(--color-border-light);
          background: var(--color-bg-page);
          transition: all 0.25s ease;
          position: relative;
          overflow: hidden;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .image-upload-box:hover {
          border-color: var(--color-primary);
          background: rgba(225, 29, 72, 0.02);
        }
      </style>
      <div class="settings-layout" id="settings-form">

        <!-- Información General -->
        <div class="settings-card">
          <h3 class="settings-title">
            ${icon('info', 18)} Información General
          </h3>
          
          <div style="display:flex; flex-direction:column; gap:16px;">
            <div style="display:grid; grid-template-columns:1fr; gap:16px;">
              <div class="input-group">
                <label>Nombre del comercio *</label>
                <input type="text" class="input-styled" id="set-name" value="${comercio.name || ''}" placeholder="Mi Comercio" />
              </div>
              <div class="input-group" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                <div class="input-group">
                  <label>Categoría 1 *</label>
                  <select class="input-styled" id="set-category-1" style="background:var(--color-bg-page) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none;">
                    <option value="">Seleccionar...</option>
                    ${platformCategories.map(c => `<option value="${c.name}" ${categories[0] === c.name ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')}
                  </select>
                </div>
                <div class="input-group">
                  <label>Categoría 2</label>
                  <select class="input-styled" id="set-category-2" style="background:var(--color-bg-page) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none;">
                    <option value="">Ninguna</option>
                    ${platformCategories.map(c => `<option value="${c.name}" ${categories[1] === c.name ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')}
                  </select>
                </div>
                <div class="input-group">
                  <label>Categoría 3</label>
                  <select class="input-styled" id="set-category-3" style="background:var(--color-bg-page) url('data:image/svg+xml;charset=utf-8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 12px center; background-size: 16px; appearance: none;">
                    <option value="">Ninguna</option>
                    ${platformCategories.map(c => `<option value="${c.name}" ${categories[2] === c.name ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>

            <div class="input-group">
              <label>Descripción *</label>
              <textarea class="input-styled" id="set-desc" placeholder="Describí tu comercio...">${comercio.description || ''}</textarea>
            </div>

            <div class="input-group">
              <label>Dirección (Ubicación) *</label>
              <div style="display:flex; gap:10px; width:100%; position:relative;">
                <div class="set-address-wrapper">
                  <input type="text" class="input-styled" id="set-address" value="${comercio.address || ''}" placeholder="Escribí calle y altura (ej: Goenaga 120)" autocomplete="off" />
                  <div id="set-address-suggestions" class="suggestions-list"></div>
                </div>
                <button type="button" class="btn btn-primary" id="open-map-btn" style="width:46px; height:46px; border-radius:10px; padding:0; flex-shrink:0; display:flex; align-items:center; justify-content:center; border:none; box-shadow:var(--shadow-sm);">
                  ${icon('mapPin', 20)}
                </button>
              </div>
              <div id="settings-address-badge" style="display:none; font-size:12px; font-weight:700; color:#0d9488; background:rgba(13,148,136,0.06); border:1px solid rgba(13,148,136,0.18); border-radius:8px; padding:8px 12px; align-items:center; gap:6px; word-break:break-all; line-height:1.4; margin-top:8px;">
                ${icon('checkCircle', 14)} Dirección seleccionada y verificada
              </div>
            </div>
          </div>
        </div>

        <!-- Horarios -->
        <div class="settings-card">
          <h3 class="settings-title">
            ${icon('clock', 18)} Horarios de Atención *
          </h3>
          <div id="schedule-slots-container" style="display:flex; flex-direction:column; gap:10px;">
            <!-- Dynamic slots -->
          </div>
          <button type="button" class="btn btn-outline" id="add-schedule-slot-btn" style="margin-top:12px; height:38px; border-radius:10px; font-size:12px; font-weight:800; display:inline-flex; align-items:center; gap:6px; border:1.5px solid var(--color-border-light); background:var(--color-surface); color:var(--color-text-primary); padding:0 16px; cursor:pointer;">
            ${icon('plus', 14)} Agregar otro horario
          </button>
        </div>

        <!-- Días de Atención -->
        <div class="settings-card">
          <h3 class="settings-title">
            ${icon('calendar', 18)} Días de Atención *
          </h3>
          <p style="font-size:12px; color:var(--color-text-secondary); margin-bottom:12px; font-weight:600;">Seleccioná los días que tu comercio está abierto:</p>
          <div id="days-open-container" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
            <!-- Rendered dynamically -->
          </div>
        </div>

        <!-- Imágenes -->
        <div class="settings-card">
          <h3 class="settings-title">
            ${icon('image', 18)} Logo & Banner de Portada
          </h3>
          
          <div style="display:flex; gap:20px; flex-wrap:wrap; align-item            <div class="input-group" style="width:120px; flex-shrink:0;">
              <label>Logo (1:1) *</label>
              <div class="image-upload-box" id="logo-upload-container" style="width:120px; height:120px; border-radius:50%;">
                <img src="${comercio.logo || '/logo.png'}" alt="Logo" id="logo-preview" style="width:100%; height:100%; object-fit:cover; transition:all 0.3s; ${comercio.logo ? '' : 'opacity:0.35;'}" />
                <span class="image-upload-icon" style="font-size:20px; color:var(--color-text-tertiary); position:absolute; z-index:2; pointer-events:none; ${comercio.logo ? 'display:none;' : ''}">${icon('upload', 20)}</span>
                <input type="file" accept="image/*" id="logo-input" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
              </div>
              <small style="color:var(--color-text-tertiary); font-size:9.5px; line-height:1.3; display:block; margin-top:6px; font-weight:600; text-align:center;">512x512px circular</small>
            </div>
            
            <div class="input-group" style="flex:1; min-width:220px;">
              <label>Banner de portada (2:1) *</label>
              <div class="image-upload-box" id="banner-upload-container" style="height:120px; border-radius:12px;">
                <img src="${comercio.banner || '/logo.png'}" alt="Banner" id="banner-preview" style="width:100%; height:100%; object-fit:cover; position:absolute; inset:0; transition:all 0.3s; ${comercio.banner ? '' : 'opacity:0.12;'}" />
                <span class="image-upload-icon" style="color:var(--color-text-tertiary); position:absolute; z-index:2; pointer-events:none; ${comercio.banner ? 'display:none;' : ''}">${icon('upload', 24)}</span>
                <span class="image-upload-text" style="font-size:10.5px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px; position:absolute; bottom:18px; z-index:2; pointer-events:none; ${comercio.banner ? 'display:none;' : ''}">Subir banner</span>
                <input type="file" accept="image/*" id="banner-input" style="position:absolute; inset:0; opacity:0; cursor:pointer; z-index:3;" />
              </div>
              <small style="color:var(--color-text-tertiary); font-size:9.5px; line-height:1.3; display:block; margin-top:6px; font-weight:600;">Recomendado: 1200x600px en aspecto horizontal</small>
            </div>
          </div>
        </div>

        <!-- Visibilidad -->
        <div class="settings-card" style="border: 1px solid ${isActive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}; background: ${isActive ? 'rgba(34,197,94,0.01)' : 'rgba(239,68,68,0.01)'}; transition: all 0.3s;">
          <h3 style="font-family: var(--font-display); font-size:14px; font-weight:850; margin:0 0 10px 0; color:var(--color-text-primary); display:flex; align-items:center; gap:8px;">
            ${icon('eye', 18)} Visibilidad del Comercio
          </h3>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
            <div style="flex:1;">
              <div style="font-weight:800; font-size:13px; display:flex; align-items:center; gap:8px; color:var(--color-text-primary);">
                Estado: 
                <span id="status-label" style="background:${isActive ? '#22C55E' : 'var(--color-danger)'}; color:white; padding:3px 10px; border-radius:6px; font-size:9.5px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; box-shadow:0 2px 6px ${isActive ? 'rgba(34,197,94,0.18)' : 'rgba(225,29,72,0.18)'}">
                  ${isActive ? 'Visible en Inicio' : 'Oculto (Inactivo)'}
                </span>
              </div>
              <div style="font-size:12px; color:var(--color-text-secondary); margin-top:6px; line-height:1.45; font-weight:550; opacity:0.95;">
                ${isActive ? 'Los clientes pueden ver y realizar compras en tu tienda normalmente.' : 'Tu tienda no aparecerá en el inicio de la app ni en las búsquedas.'}
              </div>
            </div>
            <div class="switch ${isActive ? 'active' : ''}" id="set-active" style="flex-shrink:0;"></div>
          </div>
        </div>

        <!-- Panic Mode -->
        <div class="settings-card" id="pause-card" style="border:1px solid ${comercio.isPaused ? 'rgba(245,158,11,0.3)' : 'var(--color-border-light)'}; background:${comercio.isPaused ? 'rgba(245,158,11,0.02)' : 'var(--color-surface)'}; transition:all 0.3s;">
          <h3 style="font-family: var(--font-display); font-size:14px; font-weight:850; margin:0 0 10px 0; color:var(--color-text-primary); display:flex; align-items:center; gap:8px;">
            ${icon('xCircle', 18)} Modo Pánico — Pausar Ventas
          </h3>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
              <div id="pause-status-label" style="font-weight:800; font-size:13px; display:flex; align-items:center; gap:8px; color:var(--color-text-primary);">
                <span id="pause-dot" style="width:8px; height:8px; border-radius:50%; background:${comercio.isPaused ? '#f59e0b' : '#10b981'}; display:inline-block; box-shadow:0 0 0 2px ${comercio.isPaused ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}"></span>
                ${comercio.isPaused ? 'Ventas pausadas temporalmente' : 'Ventas activas'}
              </div>
              <div style="font-size:12px; color:var(--color-text-secondary); margin-top:6px; line-height:1.45; font-weight:550; opacity:0.95;">
                Tu comercio ${comercio.isPaused ? 'no recibe nuevos pedidos.' : 'recibe pedidos normalmente.'}
              </div>
            </div>
            <button id="pause-toggle-settings" class="btn ${comercio.isPaused ? 'btn-primary' : 'btn-danger btn-outline'}" style="flex-shrink:0; height:38px; padding:0 18px; font-size:11.5px; font-weight:800; text-transform:uppercase; border-radius:10px; display:flex; align-items:center; gap:8px; cursor:pointer; border:1.5px solid ${comercio.isPaused ? 'var(--color-primary)' : 'var(--color-danger)'};">
              ${comercio.isPaused ? icon('play', 14) + ' Reanudar' : icon('xCircle', 14) + ' Pausar'}
            </button>
          </div>
        </div>

        <!-- Sincronización GoPortal / Kiosco POS -->
        ${isSyncAllowed ? `
        <div class="settings-card">
          <h3 class="settings-title">
            ${icon('refresh', 18)} Sincronización GoPortal / Kiosco POS
          </h3>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
            <div style="flex:1;">
              <div style="font-weight:800; font-size:13px; color:var(--color-text-primary); margin-bottom:4px;">
                Sincronización Bidireccional de Stock
              </div>
              <div style="font-size:12px; color:var(--color-text-secondary); line-height:1.45; font-weight:550; opacity:0.95;">
                Descuenta automáticamente el stock de la app de GoPortal al retirar un pedido, y actualiza los cambios manuales de stock en tiempo real.
              </div>
            </div>
            <div class="switch ${comercio.bidirectionalSyncEnabled ? 'active' : ''}" id="set-bidirectional-sync" style="flex-shrink:0;"></div>
          </div>
        </div>
        ` : ''}

        <!-- Pin de Acceso Panel -->
        <div class="settings-card">
          <h3 class="settings-title">
            ${icon('lock', 18)} Pin de Acceso al Panel
          </h3>
          <p style="font-size:12px; color:var(--color-text-secondary); margin-bottom:12px; font-weight:600;">
            Configurá una clave numérica de 4 dígitos para proteger el ingreso a este panel de administración. Dejalo vacío para desactivar.
          </p>
          <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="input-group">
              <label>PIN de seguridad (4 números)</label>
              <input type="password" maxlength="4" pattern="[0-9]*" inputmode="numeric" class="input-styled" id="set-pin" value="${comercio.pin || ''}" placeholder="Ej: 1234" style="-webkit-text-security: disc; font-size:18px; letter-spacing:8px; text-align:center;" oninput="this.value = this.value.replace(/[^0-9]/g, '')" />
            </div>
          </div>
        </div>

        <button class="btn btn-primary" id="save-settings-btn" style="height:50px; border-radius:14px; font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow: 0 8px 24px rgba(225, 29, 72, 0.2); cursor:pointer; border:none; width:100%; margin-top:10px;">
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
          const cropped = await openCropper(file, { aspectRatio: 1, circular: true });
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
          : 'Tu tienda volverá a recibir pedidos normalmente.',
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

    // Días de Atención Selector
    let daysOpen = Array.isArray(comercio.daysOpen) ? comercio.daysOpen : [0, 1, 2, 3, 4, 5, 6];
    const daysContainer = document.getElementById('days-open-container');
    const dayNames = [
      { id: 1, label: 'L' },
      { id: 2, label: 'M' },
      { id: 3, label: 'M' },
      { id: 4, label: 'J' },
      { id: 5, label: 'V' },
      { id: 6, label: 'S' },
      { id: 0, label: 'D' }
    ];

    function renderDaysOpen() {
      if (!daysContainer) return;
      daysContainer.innerHTML = dayNames.map(d => {
        const active = daysOpen.includes(d.id);
        return `
          <button type="button" class="day-chip ${active ? 'active' : ''}" data-day="${d.id}" style="width:42px; height:42px; border-radius:50%; border:1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border-light)'}; background:${active ? 'var(--color-primary)' : 'var(--color-surface)'}; color:${active ? 'white' : 'var(--color-text)'}; font-weight:800; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
            ${d.label}
          </button>
        `;
      }).join('');
    }

    renderDaysOpen();

    daysContainer?.addEventListener('click', (e) => {
      const chip = e.target.closest('.day-chip');
      if (chip) {
        const day = parseInt(chip.dataset.day);
        if (daysOpen.includes(day)) {
          if (daysOpen.length > 1) {
            daysOpen = daysOpen.filter(d => d !== day);
          } else {
            showToast('El comercio debe estar abierto al menos un día.', 'warning');
          }
        } else {
          daysOpen.push(day);
        }
        daysOpen.sort();
        renderDaysOpen();
      }
    });

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

    // Bidirectional Sync toggle
    document.getElementById('set-bidirectional-sync')?.addEventListener('click', () => {
      bidirectionalSyncEnabled = !bidirectionalSyncEnabled;
      document.getElementById('set-bidirectional-sync').classList.toggle('active', bidirectionalSyncEnabled);
    });

    // Save
    document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('set-name')?.value.trim();
      const desc = document.getElementById('set-desc')?.value.trim();
      
      const cat1 = document.getElementById('set-category-1')?.value || '';
      const cat2 = document.getElementById('set-category-2')?.value || '';
      const cat3 = document.getElementById('set-category-3')?.value || '';

      const finalCategories = [cat1, cat2, cat3].filter(c => c !== '');
      const uniqueCategories = [...new Set(finalCategories)];
      const cat = uniqueCategories[0] || '';

      const addr = document.getElementById('set-address')?.value.trim();
      const pin = document.getElementById('set-pin')?.value.trim();

      if (pin && !/^\d{4}$/.test(pin)) {
        showToast('El PIN debe tener exactamente 4 números.', 'warning');
        return;
      }

      // Collect schedules
      const finalSchedules = [];
      document.querySelectorAll('.schedule-slot').forEach(slot => {
        finalSchedules.push({
          open: slot.querySelector('.slot-open').value,
          close: slot.querySelector('.slot-close').value
        });
      });

      const showCenterAlert = (title, message) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100000;
          opacity: 0;
          transition: opacity 0.2s ease-out;
        `;
        
        const card = document.createElement('div');
        card.style.cssText = `
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 24px;
          padding: 24px;
          width: 90%;
          max-width: 400px;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          transform: scale(0.9);
          transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;
        
        card.innerHTML = `
          <div style="
            width: 56px;
            height: 56px;
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
          ">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h3 style="margin: 0 0 10px 0; font-family: var(--font-display); font-size: 18px; font-weight: 900; color: var(--color-text-primary);">${title}</h3>
          <p style="margin: 0 0 24px 0; font-size: 13.5px; color: var(--color-text-secondary); line-height: 1.5; font-weight: 600;">${message}</p>
          <button id="alert-close-btn" style="
            width: 100%;
            height: 50px;
            border: none;
            background: var(--color-primary);
            color: white;
            font-weight: 850;
            font-size: 14px;
            border-radius: 14px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.2);
          ">Entendido</button>
        `;
        
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        
        requestAnimationFrame(() => {
          overlay.style.opacity = '1';
          card.style.transform = 'scale(1)';
        });
        
        const closeAlert = () => {
          overlay.style.opacity = '0';
          card.style.transform = 'scale(0.9)';
          setTimeout(() => {
            overlay.remove();
          }, 200);
        };
        
        card.querySelector('#alert-close-btn').onclick = closeAlert;
        overlay.onclick = (e) => {
          if (e.target === overlay) closeAlert();
        };
      };

      if (!name || !desc || !cat || !addr || !comercioCoords || !croppedLogo || !croppedBanner || finalSchedules.length === 0 || daysOpen.length === 0) {
        showCenterAlert('Datos Incompletos', 'Todos los datos del comercio, incluyendo ubicación en mapa, días de atención, logo y banner son obligatorios para poder guardar los cambios.');
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
          categories: uniqueCategories,
          address: addr,
          coords: comercioCoords,
          schedules: finalSchedules,
          daysOpen: daysOpen,
          logo: croppedLogo,
          banner: croppedBanner,
          isActive: isActive,
          pin: pin || '',
          bidirectionalSyncEnabled: bidirectionalSyncEnabled
        }, { merge: true });

        showToast('¡Cambios guardados!', 'success');
        sessionStorage.removeItem('gd-comercio-auth-' + comercioId);

        // Clear local caches to reflect changes immediately
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('gd_cache_meta_') || key.startsWith('gd_comercio_cache_'))) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.error('Error saving settings:', e);
        showToast('Error al guardar', 'error');
      }

      btn.disabled = false;
      btn.innerHTML = `${icon('check', 16)} Guardar Cambios`;
    });

    // Danger Zone (Collapsible Accordion with 3 operations)
    const dangerZone = document.createElement('div');
    dangerZone.className = 'admin-card danger-zone';
    dangerZone.style.cssText = 'margin-top: 32px; padding: 0; border: 1.5px dashed rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.01); border-radius: 20px; overflow:hidden;';
    dangerZone.innerHTML = `
      <div id="danger-zone-header" style="padding: 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(239, 68, 68, 0.04);">
        <h3 style="color:var(--color-danger); font-family: var(--font-display); font-size:15px; font-weight:800; margin:0; display:flex; align-items:center; gap:8px;">
          ${icon('warning', 18)} Zona de Peligro
        </h3>
        <span id="danger-zone-arrow" style="color: var(--color-danger); display: flex; transform: rotate(0deg); transition: transform 0.2s;">
          ${icon('chevronDown', 16)}
        </span>
      </div>
      <div id="danger-zone-content" style="display: none; padding: 20px; flex-direction: column; gap: 20px; border-top: 1px dashed rgba(239, 68, 68, 0.2);">
        
        <!-- Action 1: Delete Commerce -->
        <div style="padding-bottom: 16px; border-bottom: 1px solid var(--color-border-light);">
          <h4 style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 6px 0;">Eliminar Comercio</h4>
          <p style="font-size:12px; color:var(--color-text-secondary); margin: 0 0 12px 0; line-height:1.4;">
            Borra definitivamente este comercio del sistema de forma permanente.
          </p>
          <button class="btn btn-danger btn-outline" id="delete-comercio-btn" style="height:40px; width:100%; border-radius:10px; font-size:11.5px; font-weight:800; text-transform:uppercase; border:1.5px solid var(--color-danger); background:transparent; color:var(--color-danger);">
            ${icon('trash', 14)} Eliminar definitivamente este comercio
          </button>
        </div>

        <!-- Action 2: Delete All Products -->
        <div style="padding-bottom: 16px; border-bottom: 1px solid var(--color-border-light);">
          <h4 style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 6px 0;">Vaciar Catálogo / Productos</h4>
          <p style="font-size:12px; color:var(--color-text-secondary); margin: 0 0 12px 0; line-height:1.4;">
            Elimina todos los productos registrados bajo este comercio.
          </p>
          <button class="btn btn-danger btn-outline" id="delete-products-btn" style="height:40px; width:100%; border-radius:10px; font-size:11.5px; font-weight:800; text-transform:uppercase; border:1.5px solid var(--color-danger); background:transparent; color:var(--color-danger);">
            ${icon('package', 14)} Eliminar todos los productos
          </button>
        </div>

        <!-- Action 3: Delete Order History & Stats -->
        <div>
          <h4 style="font-size: 13.5px; font-weight: 800; color: var(--color-text-primary); margin: 0 0 6px 0;">Borrar Historial de Ventas</h4>
          <p style="font-size:12px; color:var(--color-text-secondary); margin: 0 0 12px 0; line-height:1.4;">
            Borra todas las órdenes registradas de este comercio para reiniciar estadísticas.
          </p>
          <button class="btn btn-danger btn-outline" id="delete-history-btn" style="height:40px; width:100%; border-radius:10px; font-size:11.5px; font-weight:800; text-transform:uppercase; border:1.5px solid var(--color-danger); background:transparent; color:var(--color-danger);">
            ${icon('history', 14)} Eliminar historial y estadísticas
          </button>
        </div>

      </div>
    `;
    document.getElementById('settings-form')?.appendChild(dangerZone);

    // Accordion toggle
    const dzHeader = dangerZone.querySelector('#danger-zone-header');
    const dzContent = dangerZone.querySelector('#danger-zone-content');
    const dzArrow = dangerZone.querySelector('#danger-zone-arrow');
    dzHeader.onclick = () => {
      const isHidden = dzContent.style.display === 'none';
      dzContent.style.display = isHidden ? 'flex' : 'none';
      dzArrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    };

    // Button 1: Delete Commerce
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

    // Button 2: Delete All Products
    document.getElementById('delete-products-btn')?.addEventListener('click', async () => {
      const { showConfirm } = await import('../../components/modal.js');
      const { collection, getDocs, deleteDoc, doc } = await import('firebase/firestore');
      
      showConfirm({
        title: '¿Vaciar catálogo de productos?',
        message: 'Esta acción eliminará todos tus productos permanentemente. Escribe "ELIMINAR" para proceder.',
        confirmText: 'Sí, eliminar productos',
        onConfirm: async () => {
          try {
            const pSnap = await getDocs(collection(db, 'comercios', comercioId, 'products'));
            const deletePromises = pSnap.docs.map(d => deleteDoc(doc(db, 'comercios', comercioId, 'products', d.id)));
            await Promise.all(deletePromises);
            showToast('Catálogo vaciado correctamente', 'success');
          } catch (err) {
            console.error('Error deleting products:', err);
            showToast('Error al eliminar productos', 'error');
          }
        }
      });
    });

    // Button 3: Delete Order History
    document.getElementById('delete-history-btn')?.addEventListener('click', async () => {
      const { showConfirm } = await import('../../components/modal.js');
      const { collection, query, where, getDocs, deleteDoc, doc } = await import('firebase/firestore');
      
      showConfirm({
        title: '¿Borrar historial de ventas?',
        message: 'Esta acción eliminará de forma irreversible el historial de pedidos y estadísticas. Escribe "ELIMINAR" para confirmar.',
        confirmText: 'Sí, borrar historial',
        onConfirm: async () => {
          try {
            const q = query(collection(db, 'orders'), where('comercioId', '==', comercioId));
            const oSnap = await getDocs(q);
            const deletePromises = oSnap.docs.map(d => deleteDoc(doc(db, 'orders', d.id)));
            await Promise.all(deletePromises);
            showToast('Historial borrado correctamente', 'success');
          } catch (err) {
            console.error('Error deleting history:', err);
            showToast('Error al borrar historial', 'error');
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
        daysOpen: JSON.stringify(daysOpen),
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
