/* GoDelivery — Address Modal Component with MapLibre GL & PedidosYa Style */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { showModal, closeModal, closeMultipleModals } from './modal.js';
import { icon } from '../utils/icons.js';
import { setDeliveryAddress, getState, setState } from '../state.js';
import { showToast } from './toast.js';

export function showAddressPrompt(onSuccess, config = {}) {
  const isGeneric = config.mode === 'pick' || config.skipDetails === true;
  const modalContent = document.createElement('div');
  modalContent.className = 'delivery-map-modal-v4';
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden;';

  // State
  let googleMap;
  let geocoder;
  let selectedCoords = config.editAddress ? config.editAddress.coords : (getState().deliveryCoords || { lat: -35.0811, lng: -57.6508 });
  let searchTimeout = null;
  let lastGeocodedAddress = '';
  let lastKnownUserPos = null;
  let geocodingDisabled = false;
  let geocodingDisabledTimeout = null;
  let isManualAddress = false;
  let isPreciseLocation = false;
  let selectedTag = 'Casa';

  const updateSelectedAddress = (newAddress) => {
    if (!newAddress) return;
    const addrText = document.getElementById('current-selected-address-text');
    if (addrText) {
      const oldAddr = addrText.textContent.trim();
      if (oldAddr && oldAddr !== 'Cargando dirección...' && oldAddr !== 'Cargando...' && oldAddr !== newAddress) {
        const refInput = document.getElementById('address-reference-input');
        if (refInput) {
          refInput.value = '';
          refInput.style.borderColor = 'var(--color-border)';
        }
      }
      addrText.textContent = newAddress;
    }
  };

  const disableGeocodingTemporarily = (ms = 1200) => {
    geocodingDisabled = true;
    if (geocodingDisabledTimeout) clearTimeout(geocodingDisabledTimeout);
    geocodingDisabledTimeout = setTimeout(() => {
      geocodingDisabled = false;
    }, ms);
  };

  const showMapView = () => {
    const titleEl = document.getElementById('address-modal-title');
    const backBtn = document.getElementById('address-modal-back-btn');
    const closeBtn = document.getElementById('address-modal-close-btn');
    const slidesContainer = document.getElementById('address-slides-container');

    if (titleEl) titleEl.textContent = 'Ajustar Ubicación';
    if (backBtn) backBtn.style.visibility = 'visible';
    if (closeBtn) closeBtn.style.visibility = 'hidden';

    if (slidesContainer) {
      slidesContainer.style.transform = 'translateX(-50%)';
    }

    if (!googleMap) {
      setTimeout(() => {
        initMap();
      }, 50);
    } else {
      setTimeout(() => {
        try {
          googleMap.resize();
          if (selectedCoords) {
            disableGeocodingTemporarily(2000);
            googleMap.easeTo({ center: [selectedCoords.lng, selectedCoords.lat], zoom: 17, duration: 400 });
          }
        } catch(e) {}
      }, 100);
    }
  };

  const showSearchView = () => {
    const titleEl = document.getElementById('address-modal-title');
    const backBtn = document.getElementById('address-modal-back-btn');
    const closeBtn = document.getElementById('address-modal-close-btn');
    const slidesContainer = document.getElementById('address-slides-container');

    if (titleEl) titleEl.textContent = '¿Dónde entregamos?';
    if (backBtn) backBtn.style.visibility = 'hidden';
    if (closeBtn) closeBtn.style.visibility = 'visible';

    if (slidesContainer) {
      slidesContainer.style.transform = 'translateX(0)';
    }
  };

  const renderMainView = () => {
    modalContent.innerHTML = `
      <div id="address-modal-header" style="display:flex; align-items:center; justify-content:space-between; padding:20px 20px 14px; background:#E11D48; flex-shrink:0; color:white; border-bottom:none; box-shadow:0 2px 10px rgba(0,0,0,0.1); position:relative; z-index:100;">
        <!-- Left Slot -->
        <div style="width:75px; display:flex; justify-content:flex-start; flex-shrink:0;">
          <button id="address-modal-back-btn" style="background:none; border:none; color:white; cursor:pointer; visibility:hidden; align-items:center; justify-content:center; border-radius:50%; transition:all 0.2s; padding:4px 8px; font-weight:800; font-size:13.5px; outline:none; display:flex; gap:4px; margin:0;">
            ${icon('chevronLeft', 16)} Buscar
          </button>
        </div>
        
        <!-- Center Title -->
        <h3 id="address-modal-title" style="font-family:var(--font-display); font-size:1.2rem; font-weight:950; margin:0; color:white; text-align:center; letter-spacing:-0.01em; flex:1;">¿Dónde entregamos?</h3>
        
        <!-- Right Slot -->
        <div style="width:75px; display:flex; justify-content:flex-end; flex-shrink:0;">
          <button id="address-modal-close-btn" style="width:36px; height:36px; border:none; background:rgba(255,255,255,0.15); cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:all 0.2s; color:white; outline:none; margin:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <!-- Slides Wrapper -->
      <div class="address-slides-wrapper" style="flex:1; width: 100%; overflow: hidden; position: relative;">
        <div id="address-slides-container" style="display: flex; width: 200%; height: 100%; transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1); will-change: transform;">
           
           <!-- Slide 1: Búsqueda y selección rápida -->
           <div id="address-search-step" style="width: 50%; height: 100%; flex-shrink: 0; display: flex; flex-direction: column; overflow-y: auto; -webkit-overflow-scrolling: touch; box-sizing: border-box; position: relative;">
             <!-- Buscador de Calle y Número -->
             <div id="search-section" style="padding: 16px 20px 8px; position: relative; background: var(--color-bg); flex-shrink: 0; z-index: 50;">
               <div style="position: relative; width: 100%;">
                 <input type="text" id="address-search-input" placeholder="Calle y Número (Ejemplo: Miguens 1340)" style="width: 100%; height: 50px; padding: 0 48px 0 16px; border-radius: 16px; border: 1.5px solid var(--color-border-light); background: var(--color-bg-secondary); font-size: 14.5px; font-weight: 700; outline: none; color: var(--color-text-primary); transition: all 0.2s; box-shadow: var(--shadow-sm);" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border-light)'">
                 <div id="search-icon-wrapper" style="position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--color-primary); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; cursor: pointer;">
                   ${icon('search', 20)}
                 </div>

                 <!-- Lista de Sugerencias (DIRECTAMENTE DEBAJO DEL INPUT) -->
                 <div id="address-suggestions" class="address-suggestions-list" style="display:none; position:absolute; top:calc(100% + 6px); left:0; right:0; width:100%; max-height:280px; overflow-y:auto; -webkit-overflow-scrolling:touch; background:var(--color-surface); border-radius:16px; border:1.5px solid var(--color-border-light); z-index:9999; box-shadow:0 12px 30px rgba(0,0,0,0.16); padding:4px 0; box-sizing:border-box;"></div>
               </div>
             </div>

             <!-- Botón para Elegir en el Mapa -->
             <div id="btn-open-map-direct" style="margin: 8px 20px 16px; padding: 14px 18px; border-radius: 18px; background: linear-gradient(135deg, var(--color-primary, #E11D48) 0%, #F43F5E 100%); border: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; color: white; font-weight: 900; font-size: 14px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 8px 22px rgba(225, 29, 72, 0.3); flex-shrink: 0;">
               <div style="display:flex; align-items:center; gap:12px;">
                 <div style="width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,0.25); display:flex; align-items:center; justify-content:center; color:white; flex-shrink:0;">
                   ${icon('mapPin', 16)}
                 </div>
                 <span>Seleccionar ubicación en el mapa</span>
               </div>
               <div style="color:rgba(255,255,255,0.85); display:flex; align-items:center;">
                 ${icon('chevronRight', 16)}
               </div>
             </div>

             <!-- Saved Addresses — populated dynamically to avoid async race -->
             <div id="saved-addresses-wrapper" style="padding: 4px 20px 20px; flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; display:flex; flex-direction:column; gap:10px;">
               <!-- filled by populateSavedAddresses() -->
             </div>
           </div>

           <!-- Slide 2: Mapa y confirmación de detalles -->
           <div id="address-map-step" style="width: 50%; height: 100%; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;">
             <!-- Map Area (Center Pin + Floating GPS Button 🎯) -->
             <div id="address-map-container" style="flex: 1; min-height: 220px; position: relative; background: var(--color-bg-secondary);">
               <div id="address-map-picker" style="width: 100%; height: 100%;"></div>
               
               <!-- Center Marker Teardrop -->
               <div id="address-center-marker" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -100%); pointer-events: none; z-index: 10;">
                  <div style="filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));">
                    <svg width="36" height="48" viewBox="0 0 40 52" fill="none">
                      <path d="M20 52C20 52 40 33.7258 40 20C40 8.9543 31.0457 0 20 0C8.9543 0 0 8.9543 0 20C0 33.7258 20 52 20 52Z" fill="#E11D48"/>
                      <circle cx="20" cy="20" r="6" fill="white"/>
                    </svg>
                  </div>
               </div>

               <button id="my-location-btn" style="position: absolute; bottom: 12px; right: 12px; width: 44px; height: 44px; border-radius: 12px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-md); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 15; color: var(--color-primary); transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">
                 <div id="loc-btn-icon" style="display:flex; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
                   ${icon('target', 20)}
                 </div>
               </button>

               <!-- Professional Loading Overlay -->
               <div id="map-loading-overlay" style="position:absolute; inset:0; background:rgba(255,255,255,0.7); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; z-index:100; transition:opacity 0.4s; pointer-events:none; opacity:0;">
                 <div class="map-spinner"></div>
                 <p style="font-weight:700; color:var(--color-text-primary); font-size:14px; margin:0;">Detectando ubicación...</p>
               </div>
             </div>

             <!-- Bottom Details Panel -->
             <div id="address-bottom-panel" style="flex-shrink: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 8px)); background: var(--color-bg); z-index: 20; border-top: 1px solid var(--color-border-light); box-shadow: 0 -4px 16px rgba(0,0,0,0.04); width:100%; box-sizing:border-box;">
               <!-- Dirección seleccionada -->
               <div id="current-selected-address-container" style="margin-bottom: 8px; display: flex; align-items: flex-start; gap: 8px; background: var(--color-bg-secondary); padding: 8px 12px; border-radius: 12px; border: 1.5px solid var(--color-border-light);">
                 <div style="color: var(--color-primary); margin-top: 2px; flex-shrink: 0;">${icon('mapPin', 16)}</div>
                 <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
                   <span style="font-size: 9.5px; font-weight: 850; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">Dirección Seleccionada</span>
                   <span id="current-selected-address-text" style="font-size: 13px; font-weight: 700; color: var(--color-text-primary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                     Cargando dirección...
                   </span>
                 </div>
               </div>

               <!-- Stacked Inputs: Piso/Dpto + Referencia (Perfect Alignment & Full Width) -->
               <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; width: 100%;">
                 <input type="text" id="address-apt-input" placeholder="Piso / Departamento / Oficina (Opcional)" style="width: 100%; height: 46px; padding: 0 14px; border-radius: 12px; border: 1.5px solid var(--color-border); background: var(--color-surface); font-size: 13px; font-weight: 600; outline: none; color: var(--color-text-primary); transition: all 0.2s; box-sizing: border-box;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'" />
                 <input type="text" id="address-reference-input" placeholder="${config.optionalReference ? 'Referencia / Indicaciones (Opcional)' : 'Referencia / Instrucciones de entrega (Obligatorio)'}" style="width: 100%; height: 46px; padding: 0 14px; border-radius: 12px; border: 1.5px solid var(--color-border); background: var(--color-surface); font-size: 13px; font-weight: 600; outline: none; color: var(--color-text-primary); transition: all 0.2s; box-sizing: border-box;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'" value="${getState().addressNotes || ''}" />
               </div>

               <!-- Address Tag Selection (Clean Equal Flex Layout) -->
               <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; width: 100%;">
                 <span style="font-size: 10px; font-weight: 850; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Guardar dirección como:</span>
                 <div style="display: flex; gap: 8px; width: 100%;">
                   <button type="button" class="addr-tag-btn active" data-tag="Casa" style="flex: 1; height: 38px; border-radius: 10px; border: 1.5px solid var(--color-primary); background: rgba(225, 29, 72, 0.05); font-weight: 750; font-size: 12px; color: var(--color-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; box-sizing: border-box;">
                     ${icon('home', 12)} Casa
                   </button>
                   <button type="button" class="addr-tag-btn" data-tag="Trabajo" style="flex: 1; height: 38px; border-radius: 10px; border: 1.5px solid var(--color-border); background: var(--color-surface); font-weight: 750; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; box-sizing: border-box;">
                     ${icon('store', 12)} Trabajo
                   </button>
                   <button type="button" class="addr-tag-btn" data-tag="Otro" style="flex: 1; height: 38px; border-radius: 10px; border: 1.5px solid var(--color-border); background: var(--color-surface); font-weight: 750; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s; box-sizing: border-box;">
                     ${icon('mapPin', 12)} Otro
                   </button>
                 </div>
               </div>

               <button id="confirm-location-btn" class="btn btn-primary btn-block" style="height: 48px; border-radius: 14px; font-weight: 900; font-size: 15px; background: #E11D48; border: none; color: white; box-shadow: 0 6px 16px rgba(225, 29, 72, 0.22); cursor: pointer; width: 100%;">
                 Confirmar Dirección
               </button>
             </div>
           </div>
        </div>
      </div>

      <style>
        @media (max-height: 680px) {
          #address-map-container {
            height: 150px !important;
            min-height: 150px !important;
            flex: none !important;
          }
          #address-bottom-panel {
            padding-top: 8px !important;
            padding-bottom: 8px !important;
          }
          #address-apt-input, #address-reference-input {
            height: 38px !important;
          }
        }

        @keyframes refShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .shake-anim {
          animation: refShake 0.35s ease-in-out;
        }

        .saved-addr-chip:active { transform: scale(0.95); background: var(--color-primary-light); border-color: var(--color-primary); }
        .saved-addr-chip::-webkit-scrollbar { display: none; }
        
        @keyframes loc-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        .loc-pulse-anim { animation: loc-pulse 0.4s ease-out; }
        
        @keyframes map-spin { to { transform: rotate(360deg); } }
        .map-spinner {
          width: 32px; height: 32px; border: 3px solid var(--color-border);
          border-top-color: var(--color-primary); border-radius: 50%;
          animation: map-spin 0.8s linear infinite;
        }
        
        @keyframes mini-spin { to { transform: rotate(360deg); } }
        .mini-spinner {
          width: 18px; height: 18px; border: 2px solid rgba(0,0,0,0.1);
          border-top-color: var(--color-primary); border-radius: 50%;
          animation: mini-spin 0.6s linear infinite;
          display: inline-block;
        }
        
        #confirm-location-btn .mini-spinner {
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
        }

        [data-theme="dark"] #address-map-header, 
        [data-theme="dark"] #address-bottom-panel,
        [data-theme="dark"] #adjustment-header { background: #0F172A; }

        .suggestion-item:hover, .suggestion-item:active {
          background: var(--color-bg-secondary) !important;
        }
        .address-suggestions-list::-webkit-scrollbar {
          width: 4px;
        }
        .address-suggestions-list::-webkit-scrollbar-thumb {
          background: var(--color-border);
          border-radius: 4px;
        }
        @keyframes addr-modal-in {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .delivery-map-modal-v4 {
          animation: addr-modal-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      </style>
    `;
  };

  // Populate the saved-addresses section dynamically (avoids async race with Firestore load)
  const populateSavedAddresses = () => {
    const wrapper = document.getElementById('saved-addresses-wrapper');
    if (!wrapper) return;
    const addresses = getState().savedAddresses || [];
    if (addresses.length === 0) {
      wrapper.innerHTML = '';
      return;
    }
    wrapper.innerHTML = `
      <div style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px;">
        Tus direcciones guardadas
      </div>
      <div id="saved-addresses-list" style="display:flex; flex-direction:column; gap:10px; width:100%;">
        ${addresses.map(addr => `
          <div class="saved-addr-chip" data-id="${addr.id}" style="width: 100%; padding:14px 16px; background:var(--color-surface); border-radius:16px; border:1.5px solid var(--color-border-light); display:flex; align-items:center; justify-content:space-between; cursor:pointer; transition:all 0.2s; box-sizing:border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
            <div style="display:flex; align-items:center; gap:12px; min-width:0;">
              <div style="color:var(--color-primary); width:32px; height:32px; border-radius:50%; background:rgba(225,29,72,0.08); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${icon(addr.name.toLowerCase().includes('casa') ? 'home' : (addr.name.toLowerCase().includes('trabajo') || addr.name.toLowerCase().includes('oficina') ? 'store' : 'mapPin'), 16)}
              </div>
              <div style="display:flex; flex-direction:column; gap:2px; text-align:left; min-width:0;">
                <div style="font-size:14px; font-weight:900; color:var(--color-text-primary);">${addr.name}</div>
                <div style="font-size:12px; color:var(--color-text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px;">${addr.address}</div>
              </div>
            </div>
            <div style="color:var(--color-text-tertiary); flex-shrink:0; display:flex; align-items:center;">
              ${icon('chevronRight', 16)}
            </div>
          </div>
        `).join('')}
      </div>`;
    // re-attach click listeners
    attachSavedAddressListeners(onSuccess);
  };

  const initMap = async () => {
    const mapContainer = document.getElementById('address-map-picker');
    if (!mapContainer) return;

    const magCenterLngLat = [-57.5147, -35.0815];
    const initialCenter = selectedCoords ? [selectedCoords.lng, selectedCoords.lat] : magCenterLngLat;

    googleMap = new maplibregl.Map({
      container: mapContainer,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: initialCenter,
      zoom: 16.5,
      attributionControl: false
    });

    googleMap.on('load', () => {
      googleMap.resize();
      if (selectedCoords) {
        disableGeocodingTemporarily(2000);
        googleMap.easeTo({ center: [selectedCoords.lng, selectedCoords.lat], zoom: 17, duration: 0 });
      }
    });

    googleMap.on('moveend', () => {
      const center = googleMap.getCenter();
      selectedCoords = { lat: center.lat, lng: center.lng };

      if (geocodingDisabled) return;
      if (isManualAddress) return;
      reverseGeocode(selectedCoords.lat, selectedCoords.lng);
    });

    // Ensure listeners are attached correctly
    const locBtn = document.getElementById('my-location-btn');
    if (locBtn) {
      locBtn.onclick = (e) => {
        e.preventDefault();
        centerOnMe();
      };
    }

    document.getElementById('confirm-location-btn').onclick = () => {
      const address = lastGeocodedAddress || document.getElementById('address-search-input')?.value;
      if (!address || address.includes('Cargando')) {
        showToast('Elegí una ubicación válida en el mapa o escribila en el buscador', 'warning');
        return;
      }

      // Validation of reference note (Obligatorio unless optionalReference is passed)
      const reference = document.getElementById('address-reference-input')?.value.trim() || '';
      const apt = document.getElementById('address-apt-input')?.value.trim() || '';
      if (!config.optionalReference && !reference) {
        const refInput = document.getElementById('address-reference-input');
        if (refInput) {
          refInput.style.borderColor = '#E11D48';
          refInput.style.boxShadow = '0 0 0 3px rgba(225, 29, 72, 0.2)';
          refInput.classList.remove('shake-anim');
          void refInput.offsetWidth;
          refInput.classList.add('shake-anim');
          refInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          refInput.focus();
        }
        showToast('Por favor, ingresá una referencia (Ej: Frente a la plaza, timbre blanco)', 'warning');
        return;
      }

      const finalNotes = [apt, reference].filter(Boolean).join(' - ');

      const finalizeSave = () => {
        if (isGeneric || !config.editAddress) {
          if (config.justReturnAddress) {
            closeModal();
            if (onSuccess) onSuccess(address, finalNotes, selectedCoords);
            return;
          }
          if (!config.editAddress) {
            import('../state.js').then(({ saveUserAddress }) => {
              saveUserAddress(selectedTag, address, finalNotes, selectedCoords);
            }).catch(e => console.warn('Could not save user address to list:', e));
          }
          setDeliveryAddress(address, finalNotes, selectedCoords, '');
          closeModal();
          showToast('¡Dirección confirmada!', 'success');
          if (onSuccess) onSuccess(address, finalNotes, selectedCoords);
        } else {
          showAddressDetails(address, selectedCoords, onSuccess, { ...config, initialReference: finalNotes });
        }
      };

      // Confirmation Prompt Dialog
      askAddressConfirmation(address, finalNotes, () => {
        finalizeSave();
      }, () => {
        showSearchView();
        const input = document.getElementById('address-search-input');
        if (input) {
          input.focus();
          input.select();
        }
      });
    };

    const gotoAdj = document.getElementById('goto-adjust-btn');
    if (gotoAdj) gotoAdj.onclick = () => toggleAdjustmentMode(true);

    const adjBack = document.getElementById('adj-back-btn');
    if (adjBack) adjBack.onclick = () => toggleAdjustmentMode(false);

    const adjCancel = document.getElementById('adj-cancel-btn');
    if (adjCancel) adjCancel.onclick = () => toggleAdjustmentMode(false);

    const adjContinue = document.getElementById('adj-continue-btn');
    if (adjContinue) adjContinue.onclick = () => {
      toggleAdjustmentMode(false);
      document.getElementById('confirm-location-btn').click();
    };

    // Auto-center on startup if editing existing address
    if (config.editAddress) {
      lastGeocodedAddress = config.editAddress.address;
      const addrText = document.getElementById('current-selected-address-text');
      if (addrText) addrText.textContent = config.editAddress.address;
      const input = document.getElementById('address-search-input');
      if (input) input.value = '';
      disableGeocodingTemporarily(1500);
      googleMap.easeTo({ center: [config.editAddress.coords.lng, config.editAddress.coords.lat], zoom: 17 });
    }
  };

  const toggleAdjustmentMode = (isAdj) => {
    const mainHeader = document.getElementById('address-main-header');
    const searchSection = document.getElementById('search-section');
    const confirmBtn = document.getElementById('confirm-location-btn');
    const adjHeader = document.getElementById('adjustment-header');
    const adjButtons = document.getElementById('adj-buttons');
    const myLocBtn = document.getElementById('my-location-btn');
    if (mainHeader) mainHeader.style.display = isAdj ? 'none' : 'block';
    if (searchSection) searchSection.style.display = isAdj ? 'none' : 'block';
    if (confirmBtn) confirmBtn.style.display = isAdj ? 'none' : 'block';
    if (adjHeader) adjHeader.style.display = isAdj ? 'block' : 'none';
    if (adjButtons) adjButtons.style.display = isAdj ? 'flex' : 'none';
    if (myLocBtn) myLocBtn.style.bottom = isAdj ? '14px' : '20px';
  };

  let isGeocoding = false;
  let pendingConfirm = false;

  const centerOnMe = (showFeedback = true) => {
    if (!navigator.geolocation) {
      if (showFeedback) showToast('Geolocalización no soportada', 'error');
      return;
    }

    const iconWrap = document.getElementById('loc-btn-icon');

    const overlay = document.getElementById('map-loading-overlay');
    if (showFeedback && overlay) {
      overlay.style.opacity = '1';
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (overlay) overlay.style.opacity = '0';
        const myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastKnownUserPos = myPos;
        isPreciseLocation = true;
        if (googleMap) {
          disableGeocodingTemporarily(1500);
          googleMap.easeTo({ center: [myPos.lng, myPos.lat], zoom: 17 });
          if (iconWrap) {
            iconWrap.classList.add('loc-pulse-anim');
            setTimeout(() => iconWrap.classList.remove('loc-pulse-anim'), 400);
          }
          if (showFeedback) showToast('Ubicación actualizada', 'success');
        }
      },
      (err) => {
        if (overlay) overlay.style.opacity = '0';
        if (showFeedback) {
          if (err.code === 1) showToast('Permiso de ubicación denegado', 'warning');
          else showToast('No se pudo obtener tu ubicación. Por favor, buscala en el mapa.', 'error');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const reverseGeocode = async (lat, lng) => {
    isGeocoding = true;
    const searchIconEl = document.getElementById('search-icon-wrapper');
    if (searchIconEl) searchIconEl.innerHTML = `<div class="mini-spinner"></div>`;

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=es`);
      const data = await response.json();
      isGeocoding = false;
      if (searchIconEl) searchIconEl.innerHTML = icon('search', 20);

      if (data && data.display_name) {
        const a = data.address || {};
        const street = a.road || a.pedestrian || a.suburb || '';
        const number = a.house_number || '';
        let display = `${street} ${number}`.trim();
        const neighborhood = a.neighbourhood || a.residential || '';
        if (neighborhood && !display.includes(neighborhood)) display += ` (${neighborhood})`;

        lastGeocodedAddress = display || data.display_name.split(',')[0];
        updateSelectedAddress(lastGeocodedAddress);

        if (pendingConfirm) {
          pendingConfirm = false;
          const confirmBtn = document.getElementById('confirm-location-btn');
          if (confirmBtn) {
            confirmBtn.innerHTML = 'Confirmar Dirección';
            confirmBtn.disabled = false;
            confirmBtn.click();
          }
        }
      }
    } catch (err) {
      console.warn('Nominatim reverse geocode note:', err);
      isGeocoding = false;
      if (searchIconEl) searchIconEl.innerHTML = icon('search', 20);
      if (pendingConfirm) {
        pendingConfirm = false;
        const confirmBtn = document.getElementById('confirm-location-btn');
        if (confirmBtn) {
          confirmBtn.innerHTML = 'Confirmar Dirección';
          confirmBtn.disabled = false;
        }
      }
    }
  };

  function askAddressConfirmation(detectedAddress, referenceNotes, onConfirm, onEdit) {
    const overlay = document.createElement('div');
    overlay.className = 'address-confirm-dialog-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.65); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; animation:fadeIn 0.2s ease-out;';
    
    overlay.innerHTML = `
      <div style="background:var(--color-bg, #ffffff); border-radius:24px; padding:24px 20px; max-width:380px; width:100%; box-shadow:0 20px 45px rgba(0,0,0,0.3); border:1.5px solid var(--color-border-light, #e2e8f0); text-align:center; display:flex; flex-direction:column; gap:16px;">
        <div style="width:52px; height:52px; border-radius:50%; background:rgba(225, 29, 72, 0.1); color:#E11D48; display:flex; align-items:center; justify-content:center; margin:0 auto;">
          ${icon('mapPin', 26)}
        </div>
        
        <div>
          <h3 style="margin:0 0 6px; font-size:18px; font-weight:900; color:var(--color-text-primary, #0f172a); font-family:var(--font-display, sans-serif);">¿Tu dirección es correcta?</h3>
          <p style="margin:0; font-size:13px; color:var(--color-text-secondary, #64748b); font-weight:500;">Verificá que la calle y la altura coincidan con tu domicilio</p>
        </div>

        <div style="background:var(--color-bg-secondary, #f8fafc); border:1.5px solid var(--color-border-light, #e2e8f0); border-radius:16px; padding:12px 14px; text-align:left;">
          <div style="font-size:10px; font-weight:850; color:var(--color-primary, #E11D48); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Dirección de entrega</div>
          <div style="font-size:14.5px; font-weight:800; color:var(--color-text-primary, #0f172a); line-height:1.35;">${detectedAddress}</div>
          ${referenceNotes ? `<div style="font-size:12px; color:var(--color-text-secondary, #64748b); margin-top:5px; font-weight:600;">Nota: ${referenceNotes}</div>` : ''}
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
          <button id="btn-confirm-address-yes" style="width:100%; height:48px; border-radius:14px; background:#E11D48; color:white; border:none; font-weight:850; font-size:14.5px; cursor:pointer; box-shadow:0 6px 18px rgba(225,29,72,0.3); transition:all 0.2s;">
            Sí, es correcta
          </button>
          <button id="btn-confirm-address-change" style="width:100%; height:44px; border-radius:14px; background:var(--color-bg-secondary, #f1f5f9); color:var(--color-text-primary, #0f172a); border:1px solid var(--color-border, #cbd5e1); font-weight:750; font-size:13.5px; cursor:pointer; transition:all 0.2s;">
            Cambiar / Escribir otra
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#btn-confirm-address-yes').onclick = () => {
      overlay.remove();
      if (onConfirm) onConfirm();
    };

    overlay.querySelector('#btn-confirm-address-change').onclick = () => {
      overlay.remove();
      if (onEdit) onEdit();
    };
  }

  const initSearch = () => {
    const searchInput = document.getElementById('address-search-input');
    const suggestionsBox = document.getElementById('address-suggestions');
    const searchIconEl = document.getElementById('search-icon-wrapper');

    const triggerSearch = async () => {
      const query = searchInput.value.trim();
      if (query.length < 2) return;
      
      try {
        const { searchAddressSuggestions } = await import('../utils/geo.js');
        const suggestions = await searchAddressSuggestions(query);
        if (suggestions && suggestions.length > 0) {
          renderSuggestions(suggestions, query);
        } else {
          showToast('No se encontraron sugerencias para esa dirección', 'warning');
        }
      } catch (err) {
        console.error('Search trigger error:', err);
      }
    };

    if (searchInput) {
      searchInput.oninput = (e) => {
        const query = e.target.value;
        const openMapBtn = document.getElementById('btn-open-map-direct');
        const savedWrapper = document.getElementById('saved-addresses-wrapper');
        if (!query || query.trim().length < 2) {
          if (suggestionsBox) {
            suggestionsBox.style.display = 'none';
            suggestionsBox.innerHTML = '';
          }
          if (openMapBtn) openMapBtn.style.display = 'flex';
          if (savedWrapper) savedWrapper.style.display = 'flex';
          return;
        }
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
          try {
            const { searchAddressSuggestions } = await import('../utils/geo.js');
            const suggestions = await searchAddressSuggestions(query);
            renderSuggestions(suggestions, query);
          } catch (err) {
            console.error('Error fetching search suggestions:', err);
          }
        }, 50);
      };

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerSearch();
        }
      });
    }

    if (searchIconEl) {
      searchIconEl.onclick = (e) => {
        e.preventDefault();
        triggerSearch();
      };
    }

    // Close suggestions dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (searchInput && suggestionsBox) {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
          suggestionsBox.style.display = 'none';
          const openMapBtn = document.getElementById('btn-open-map-direct');
          const savedWrapper = document.getElementById('saved-addresses-wrapper');
          if (openMapBtn) openMapBtn.style.display = 'flex';
          if (savedWrapper) savedWrapper.style.display = 'flex';
        }
      }
    });
  };

  const renderSuggestions = (suggestions, currentQuery = '') => {
    const suggestionsBox = document.getElementById('address-suggestions');
    const openMapBtn = document.getElementById('btn-open-map-direct');
    const savedWrapper = document.getElementById('saved-addresses-wrapper');
    if (!suggestionsBox) return;

    suggestions = suggestions || [];

    if (suggestions.length === 0) {
      suggestionsBox.style.display = 'none';
      suggestionsBox.innerHTML = '';
      if (openMapBtn) openMapBtn.style.display = 'flex';
      if (savedWrapper) savedWrapper.style.display = 'flex';
      return;
    }

    if (openMapBtn) openMapBtn.style.display = 'none';
    if (savedWrapper) savedWrapper.style.display = 'none';
    suggestionsBox.style.display = 'flex';
    
    let html = suggestions.map((s, idx) => `
      <div class="suggestion-item" data-lat="${s.lat || ''}" data-lng="${s.lng || ''}" data-addr="${s.address}" style="padding:12px 14px; display:flex; align-items:center; gap:12px; cursor:pointer; ${idx < suggestions.length - 1 ? 'border-bottom:1px solid var(--color-border-light);' : ''} background:transparent; transition:background 0.15s ease;">
        <div style="width:34px; height:34px; border-radius:50%; background:rgba(225, 29, 72, 0.09); color:#E11D48; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${icon('mapPin', 16)}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; font-size:14px; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.address}</div>
          <div style="font-size:11.5px; color:var(--color-text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px;">${s.displayName || ''}</div>
        </div>
        <div style="color:var(--color-text-tertiary); display:flex; align-items:center; flex-shrink:0;">
          ${icon('chevronRight', 14)}
        </div>
      </div>
    `).join('');

    suggestionsBox.innerHTML = html;

    suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const addr = item.dataset.addr;
        const lat = parseFloat(item.dataset.lat) || -35.0815;
        const lng = parseFloat(item.dataset.lng) || -57.5147;
        
        selectedCoords = { lat, lng };
        lastGeocodedAddress = addr;
        updateSelectedAddress(addr);
        
        const searchInput = document.getElementById('address-search-input');
        if (searchInput) searchInput.value = addr;
        suggestionsBox.style.display = 'none';
        if (openMapBtn) openMapBtn.style.display = 'flex';
        if (savedWrapper) savedWrapper.style.display = 'flex';

        // Transition to Map view (Slide 2)
        disableGeocodingTemporarily(2000);
        showMapView();
        if (googleMap) {
          googleMap.easeTo({ center: [lng, lat], zoom: 17, duration: 400 });
        }
      };
    });
  };

  showModal({
    title: '',
    hideHeader: true,
    height: '80vh',
    content: modalContent,
    onOpen: () => {
      // Bind Step Navigation Buttons
      const openMapBtn = document.getElementById('btn-open-map-direct');
      if (openMapBtn) {
        openMapBtn.onclick = (e) => {
          e.preventDefault();
          showMapView();
        };
      }

      const backToSearchBtn = document.getElementById('address-modal-back-btn');
      if (backToSearchBtn) {
        backToSearchBtn.onclick = (e) => {
          e.preventDefault();
          showSearchView();
        };
      }

      const closeAddressModalBtn = document.getElementById('address-modal-close-btn');
      if (closeAddressModalBtn) {
        closeAddressModalBtn.onclick = (e) => {
          e.preventDefault();
          closeModal();
        };
      }

      // Bind Tag Selection Logic
      const tagBtns = modalContent.querySelectorAll('.addr-tag-btn');
      tagBtns.forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          tagBtns.forEach(b => {
            b.style.borderColor = 'var(--color-border)';
            b.style.color = 'var(--color-text-secondary)';
            b.style.background = 'var(--color-surface)';
            b.classList.remove('active');
          });
          btn.style.borderColor = 'var(--color-primary)';
          btn.style.color = 'var(--color-primary)';
          btn.style.background = 'rgba(var(--color-primary-rgb, 225, 29, 72), 0.05)';
          btn.classList.add('active');
          selectedTag = btn.dataset.tag;
        };
      });

      // Bind drag to close event for unified header!
      const unifiedHeader = document.getElementById('address-modal-header');
      if (unifiedHeader) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        let startTime = 0;
        const dialog = modalContent.closest('.modal');
        const overlay = modalContent.closest('.modal-overlay');

        unifiedHeader.addEventListener('touchstart', (e) => {
          startY = e.touches[0].clientY;
          startTime = Date.now();
          isDragging = true;
          if (dialog) dialog.style.transition = 'none';
          if (overlay) overlay.style.transition = 'none';
        }, { passive: true });

        unifiedHeader.addEventListener('touchmove', (e) => {
          if (!isDragging) return;
          currentY = e.touches[0].clientY;
          const diff = currentY - startY;
          if (diff > 0 && dialog) {
            dialog.style.transform = `translateY(${diff}px)`;
            if (overlay) overlay.style.opacity = Math.max(0, 1 - (diff / 350));
          }
        }, { passive: true });

        unifiedHeader.addEventListener('touchend', () => {
          if (!isDragging) return;
          isDragging = false;
          const diff = currentY - startY;
          const velocity = diff / Math.max(1, (Date.now() - startTime));

          if (diff > 80 || (velocity > 0.35 && diff > 35)) {
            closeModal();
          } else if (dialog) {
            dialog.style.transition = 'transform 0.25s ease-out';
            dialog.style.transform = 'translateY(0)';
            if (overlay) {
              overlay.style.transition = 'opacity 0.25s ease-out';
              overlay.style.opacity = '1';
            }
          }
        });
      }

      // Initialize search listeners immediately on modal open
      initSearch();

      // Bind saved addresses clicks immediately on modal open
      attachSavedAddressListeners(onSuccess);

      setTimeout(() => {
        const input = document.getElementById('address-search-input');
        if (input) {
          input.focus();
          input.click();
        }
      }, 250);
    }
  });
  renderMainView();
  // Populate saved addresses AFTER innerHTML is set (avoids async Firestore race condition)
  populateSavedAddresses();
}

// Helper: attach click handlers to all .saved-addr-chip elements
function attachSavedAddressListeners(onSuccess) {
  document.querySelectorAll('.saved-addr-chip').forEach(chip => {
    chip.onclick = (e) => {
      e.preventDefault();
      const addrId = chip.dataset.id;
      const saved = (getState().savedAddresses || []).find(a => a.id === addrId);
      if (saved) {
        setDeliveryAddress(saved.address, saved.notes || '', saved.coords, '');
        closeModal();
        showToast(`Ubicación: ${saved.name}`, 'success');
        if (onSuccess) onSuccess(saved.address, saved.notes || '', saved.coords);
      }
    };
  });
}

export function showAddressDetails(address, coords, onSuccess, config = {}) {
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg); overflow:hidden;';

  let aptVal = '';
  let notesVal = '';
  if (config.editAddress && config.editAddress.notes) {
    const savedNotes = config.editAddress.notes;
    if (savedNotes.includes(' - ')) {
      const parts = savedNotes.split(' - ');
      aptVal = parts[0] || '';
      notesVal = parts.slice(1).join(' - ') || '';
    } else {
      const isShort = savedNotes.length <= 6;
      if (isShort) {
        aptVal = savedNotes;
      } else {
        notesVal = savedNotes;
      }
    }
  }

  modalContent.innerHTML = `
    <!-- Header -->
    <div style="padding:20px; display:flex; align-items:center; gap:16px; border-bottom:1px solid var(--color-border-light); flex-shrink:0;">
      <button id="details-back" style="background:none; border:none; padding:8px; cursor:pointer; color: var(--color-text-primary);">${icon('arrowLeft', 20)}</button>
      <div style="flex:1;">
        <h2 style="font-family:var(--font-display); font-size:17px; font-weight:900; color:var(--color-text-primary); margin:0;">${config.editAddress ? 'Editar dirección' : 'Detalles de entrega'}</h2>
      </div>
    </div>

    <!-- Scrollable Body -->
    <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:20px;">
      <div style="background:var(--color-bg-secondary); border:1.5px solid var(--color-border-light); border-radius:14px; padding:12px; display:flex; gap:10px;">
        <div style="color:var(--color-primary); flex-shrink:0; margin-top:2px;">${icon('mapPin', 16)}</div>
        <div style="font-weight:700; font-size:13px; color:var(--color-text-primary); line-height:1.4;">${address}</div>
      </div>

      <!-- Tag Buttons horizontal select -->
      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:11px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Guardar dirección como (opcional)</label>
        <div id="address-tags-container" style="display:flex; gap:10px;">
          <button class="addr-tag-btn ${config.editAddress && config.editAddress.name === 'Casa' ? 'active' : ''}" data-tag="Casa" style="flex:1; height:42px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-bg); font-weight:750; font-size:12.5px; color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">${icon('home', 14)} Casa</button>
          <button class="addr-tag-btn ${config.editAddress && config.editAddress.name === 'Trabajo' ? 'active' : ''}" data-tag="Trabajo" style="flex:1; height:42px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-bg); font-weight:750; font-size:12.5px; color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">${icon('store', 14)} Trabajo</button>
          <button class="addr-tag-btn ${config.editAddress && !['Casa','Trabajo'].includes(config.editAddress.name) ? 'active' : ''}" id="tag-custom-trigger" style="flex:1; height:42px; border-radius:10px; border:1.5px solid var(--color-border); background:var(--color-bg); font-weight:750; font-size:12.5px; color:var(--color-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">${icon('mapPin', 14)} Otro</button>
        </div>
        <div id="custom-tag-input-container" style="display:${config.editAddress && !['Casa','Trabajo'].includes(config.editAddress.name) ? 'block' : 'none'}; margin-top:8px;">
          <input type="text" id="custom-tag-name" placeholder="Ej: Novia, Padres, Club..." value="${config.editAddress && !['Casa','Trabajo'].includes(config.editAddress.name) ? config.editAddress.name : ''}" style="width:100%; height:44px; padding:0 14px; border:1.5px solid var(--color-border); border-radius:10px; font-size:13.5px; outline:none; background:var(--color-bg); color:var(--color-text-primary);" />
        </div>
      </div>

      <div class="field">
        <label style="display:block; font-size:12px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">Piso / Departamento (Opcional)</label>
        <input type="text" id="details-apt" placeholder="Ej: 4B" value="${aptVal}" style="width:100%; height:52px; padding:0 16px; border:1.5px solid var(--color-border); border-radius:12px; font-size:14px; outline:none; background: var(--color-bg); color: var(--color-text-primary);" />
      </div>

      <div class="field">
        <label style="display:block; font-size:12px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">Instrucciones / Referencia de ubicación (Obligatorio)</label>
        <textarea id="details-notes" placeholder="Ej: Portón blanco, entre calles X e Y, timbre roto... (Obligatorio)" style="width:100%; height:100px; padding:16px; border:1.5px solid var(--color-border); border-radius:12px; font-size:14px; outline:none; resize:none; background: var(--color-bg); color: var(--color-text-primary);">${notesVal}</textarea>
      </div>
    </div>

    <!-- Sticky Footer -->
    <div style="padding:20px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0)); display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--color-border-light); background:var(--color-bg); flex-shrink:0; z-index:10;">
       <button id="save-address-final" class="btn btn-primary" style="width:100%; height:56px; border-radius:18px; font-weight:900; font-size:16px; background:#E11D48; border:none; box-shadow: 0 8px 20px rgba(225, 29, 72, 0.2);">Guardar y continuar</button>
       ${config.editAddress ? `
         <button id="delete-address-btn" style="width:100%; height:48px; border:1.5px solid var(--color-border); border-radius:18px; font-weight:800; font-size:14px; background:transparent; color:#EF4444; border-color:#EF4444; cursor:pointer; transition:all 0.2s;">
           Eliminar dirección
         </button>
       ` : ''}
    </div>
  `;

  showModal({ title: '', hideHeader: true, content: modalContent });

  document.getElementById('details-back').onclick = () => {
    closeModal();
  };

  // Tag Selection Logic
  const tagButtons = modalContent.querySelectorAll('.addr-tag-btn');
  const customTagContainer = modalContent.querySelector('#custom-tag-input-container');
  const customTagInput = modalContent.querySelector('#custom-tag-name');
  
  let selectedTag = 'Casa';
  if (config.editAddress) {
    selectedTag = ['Casa', 'Trabajo'].includes(config.editAddress.name) ? config.editAddress.name : 'Otro';
  } else {
    // Set default active styling to Casa
    const defaultActive = Array.from(tagButtons).find(b => b.dataset.tag === 'Casa');
    if (defaultActive) {
      defaultActive.style.borderColor = 'var(--color-primary)';
      defaultActive.style.color = 'var(--color-primary)';
      defaultActive.style.background = 'rgba(var(--color-primary-rgb, 225, 29, 72), 0.05)';
    }
  }

  tagButtons.forEach(btn => {
    // If editAddress, apply active styling to current active tag
    const isEditActive = config.editAddress && (
      (btn.dataset.tag === 'Casa' && config.editAddress.name === 'Casa') ||
      (btn.dataset.tag === 'Trabajo' && config.editAddress.name === 'Trabajo') ||
      (!btn.dataset.tag && !['Casa', 'Trabajo'].includes(config.editAddress.name))
    );
    if (isEditActive) {
      btn.style.borderColor = 'var(--color-primary)';
      btn.style.color = 'var(--color-primary)';
      btn.style.background = 'rgba(var(--color-primary-rgb, 225, 29, 72), 0.05)';
    }

    btn.onclick = (e) => {
      e.preventDefault();
      tagButtons.forEach(b => {
        b.style.borderColor = 'var(--color-border)';
        b.style.color = 'var(--color-text-secondary)';
        b.style.background = 'var(--color-bg)';
      });
      btn.style.borderColor = 'var(--color-primary)';
      btn.style.color = 'var(--color-primary)';
      btn.style.background = 'rgba(var(--color-primary-rgb, 225, 29, 72), 0.05)';
      
      const tag = btn.dataset.tag || 'Otro';
      selectedTag = tag;
      
      if (tag === 'Otro') {
        customTagContainer.style.display = 'block';
        customTagInput.focus();
      } else {
        customTagContainer.style.display = 'none';
      }
    };
  });

  if (config.editAddress) {
    const deleteBtn = document.getElementById('delete-address-btn');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        const { removeSavedAddress } = await import('../state.js');
        removeSavedAddress(config.editAddress.id);
        closeMultipleModals(2);
        showToast('Dirección eliminada', 'success');
      };
    }
  }

  document.getElementById('save-address-final').onclick = async () => {
    let finalTagName = selectedTag;
    if (selectedTag === 'Otro') {
      finalTagName = customTagInput.value.trim() || 'Otro';
    }
    const apt = document.getElementById('details-apt').value.trim();
    const notes = document.getElementById('details-notes').value.trim();

    // Reset styles
    const notesInput = document.getElementById('details-notes');
    notesInput.style.borderColor = 'var(--color-border)';

    let hasError = false;

    if (!notes) {
      notesInput.style.borderColor = '#EF4444';
      showToast('Por favor, ingresá una referencia de ubicación (Instrucciones para el repartidor)', 'warning');
      hasError = true;
    }

    if (hasError) return;

    const finalNotes = [apt, notes].filter(Boolean).join(' - ');

    if (config.justReturnAddress) {
      closeMultipleModals(2);
      if (onSuccess) onSuccess(address, finalNotes, coords);
      return;
    }
    
    // Save/Update user addresses list
    const finalName = finalTagName || 'Dirección';
    const { saveUserAddress, updateUserAddress } = await import('../state.js');
    if (config.editAddress) {
      if (config.editAddress.id !== 'active') {
        updateUserAddress(config.editAddress.id, finalName, address, finalNotes, coords);
      }
    } else {
      saveUserAddress(finalName, address, finalNotes, coords);
    }

    setDeliveryAddress(address, finalNotes, coords, '');
    closeMultipleModals(2);
    showToast(config.editAddress ? '¡Dirección actualizada!' : '¡Dirección configurada!', 'success');
    if (onSuccess) onSuccess(address, finalNotes, coords);
  };
}

export function ensureAddress(onSuccess) {
  const address = getState().deliveryAddress;
  const hasSaved = (getState().savedAddresses || []).length > 0;
  if (!address && !hasSaved) {
    showAddressPrompt(onSuccess);
    return false;
  }
  if (onSuccess) onSuccess(address || (getState().savedAddresses && getState().savedAddresses[0]?.address) || '');
  return true;
}
