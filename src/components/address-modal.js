/* GoDelivery — Address Modal Component with Google Maps & PedidosYa Style */
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
  let userLocationMarker = null;
  let lastKnownUserPos = null;
  let geocodingDisabled = false;
  let geocodingDisabledTimeout = null;
  let isManualAddress = false;
  let isPreciseLocation = false;

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

  const renderMainView = () => {
    modalContent.innerHTML = `
      <!-- Header Red (#E11D48) -->
      <div id="address-main-header" style="padding: 16px 20px 12px; text-align: center; background: #E11D48; z-index: 10; border-radius: 28px 28px 0 0; flex-shrink:0;">
        <div style="width: 40px; height: 5px; background: rgba(255, 255, 255, 0.4); border-radius: 10px; margin: 0 auto 10px;"></div>
        <h1 id="address-modal-title" style="font-family: var(--font-display); font-size: 1.2rem; font-weight: 900; color: white; margin: 0;">Confirma tu dirección</h1>
      </div>

      <!-- Buscador de Calle y Número -->
      <div id="search-section" style="padding: 12px 20px 8px; position: relative; background: var(--color-bg); flex-shrink: 0; z-index: 30;">
        <div style="position: relative;">
          <input type="text" id="address-search-input" placeholder="Calle y Número (Ejemplo: Brenan 1340)" style="width: 100%; height: 50px; padding: 0 48px 0 16px; border-radius: 16px; border: 1.5px solid var(--color-border-light); background: var(--color-bg-secondary); font-size: 14.5px; font-weight: 700; outline: none; color: var(--color-text-primary); transition: all 0.2s; box-shadow: var(--shadow-sm);">
          <div id="search-icon-wrapper" style="position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--color-primary); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; cursor: pointer;">
            ${icon('search', 20)}
          </div>
        </div>
        <div id="address-suggestions" class="address-suggestions-list" style="display:none; position:relative; width:100%; max-height:calc(100dvh - 140px); overflow-y:auto; -webkit-overflow-scrolling:touch; background:var(--color-bg); margin-top:8px; z-index:2000;"></div>
      </div>

      <!-- Saved Addresses Horizontal Quick Chips (si existen) -->
      ${(getState().savedAddresses || []).length > 0 ? `
        <div id="saved-addresses-wrapper" style="padding: 0 20px 8px; background: var(--color-bg); flex-shrink: 0;">
          <div style="font-size: 10.5px; font-weight: 900; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px;">
            Tus direcciones
          </div>
          <div id="saved-addresses-list" style="display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; scrollbar-width: none; -ms-overflow-style: none;">
            ${(getState().savedAddresses || []).map(addr => `
              <div class="saved-addr-chip" data-id="${addr.id}" style="flex-shrink:0; padding:8px 14px; background:var(--color-bg-secondary); border-radius:12px; border:1.5px solid var(--color-border-light); display:flex; align-items:center; gap:8px; cursor:pointer; transition:all 0.2s;">
                <div style="color:var(--color-primary);">${icon(addr.name.toLowerCase().includes('casa') ? 'home' : (addr.name.toLowerCase().includes('trabajo') || addr.name.toLowerCase().includes('oficina') ? 'store' : 'mapPin'), 15)}</div>
                <div style="font-size:12.5px; font-weight:800; color:var(--color-text-primary); white-space:nowrap;">${addr.name}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

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

        <!-- Adjustment Header -->
        <div id="adjustment-header" style="display:none; position:absolute; top:0; left:0; right:0; background:var(--color-bg); padding:20px; z-index:100; border-radius: 28px 28px 0 0;">
          <button id="adj-back-btn" style="background:none; border:none; padding:8px; margin-bottom:8px; cursor:pointer; color: var(--color-text-primary);">${icon('arrowLeft', 24)}</button>
          <h2 style="font-family:var(--font-display); font-size:1.5rem; font-weight:900; color:var(--color-text-primary); margin:0 0 4px;">Ajusta el pin en el mapa</h2>
          <p style="margin:0; color:var(--color-text-tertiary); font-size:14px; font-weight:500;">Ubícalo en el lugar exacto de tu dirección.</p>
        </div>
      </div>

      <!-- Bottom Details Panel -->
      <div id="address-bottom-panel" style="flex-shrink: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 8px)); background: var(--color-bg); z-index: 20; border-top: 1px solid var(--color-border-light); box-shadow: 0 -4px 16px rgba(0,0,0,0.04);">
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

        <!-- Reference/Notes input -->
        <div style="margin-bottom: 8px;">
          <textarea id="address-reference-input" placeholder="${config.optionalReference ? 'Referencia / Indicaciones (Opcional)' : 'Referencia / Indicaciones de entrega (Ej: Portón negro, depto 2) - Obligatorio'}" style="width:100%; height:42px; padding:6px 10px; border-radius:12px; border:1.5px solid var(--color-border); background:var(--color-surface); font-size:12.5px; font-weight:600; outline:none; color:var(--color-text-primary); resize:none; line-height:1.3; transition:all 0.2s; box-sizing:border-box;" onfocus="this.style.borderColor='var(--color-primary)'" onblur="this.style.borderColor='var(--color-border)'">${getState().addressNotes || ''}</textarea>
        </div>

        <div id="adj-buttons" style="display:none; flex-direction:column; gap:8px;">
           <button id="adj-continue-btn" class="btn btn-primary" style="height:48px; border-radius:18px; font-weight:900; background:#E11D48;">Continuar</button>
           <button id="adj-cancel-btn" style="height:38px; background:none; border:none; color:var(--color-text-primary); font-weight:700; font-size:13px; cursor:pointer;">Cancelar</button>
        </div>

        <button id="confirm-location-btn" class="btn btn-primary btn-block" style="height: 48px; border-radius: 14px; font-weight: 900; font-size: 15px; background: #E11D48; border: none; color: white; box-shadow: 0 6px 16px rgba(225, 29, 72, 0.22); cursor: pointer;">
          Confirmar Dirección
        </button>
      </div>

      <style>
        @keyframes refShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .shake-anim {
          animation: refShake 0.35s ease-in-out;
        }

        @keyframes pulse-blue {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 12px rgba(37, 99, 235, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
        }
        .user-loc-dot {
          width: 14px; height: 14px; background: #2563EB; border: 2.5px solid white; border-radius: 50%;
          animation: pulse-blue 2s infinite;
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

        [data-theme="dark"] #map-loading-overlay { background: rgba(15, 23, 42, 0.7); }
        [data-theme="dark"] .delivery-map-modal-v4 { background: #020617; }
        [data-theme="dark"] #address-main-header, 
        [data-theme="dark"] #address-bottom-panel,
        [data-theme="dark"] #adjustment-header { background: #0F172A; }
      </style>
    `;

    initMap();
  };

  const initMap = async () => {
    if (typeof google === 'undefined') {
      showToast('Error cargando Google Maps', 'error');
      return;
    }

    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    geocoder = new google.maps.Geocoder();

    googleMap = new google.maps.Map(document.getElementById('address-map-picker'), {
      center: selectedCoords,
      zoom: 16,
      disableDefaultUI: true,
      styles: theme === 'dark' ? getDarkStyles() : [],
      gestureHandling: 'greedy'
    });

    googleMap.addListener('idle', () => {
      const center = googleMap.getCenter();
      selectedCoords = { lat: center.lat(), lng: center.lng() };

      if (geocodingDisabled) {
        return;
      }
      if (isManualAddress) {
        console.log('[Map] Skipping reverse-geocoding to preserve custom manual address text');
        return;
      }
      reverseGeocode(selectedCoords.lat, selectedCoords.lng);
    });

    updateRealTimeLocation();
    setTimeout(() => {
      centerOnMe(false);
    }, 500);

    // FIXED: Ensure listeners are attached correctly
    const locBtn = document.getElementById('my-location-btn');
    if (locBtn) {
      locBtn.onclick = (e) => {
        e.preventDefault();
        centerOnMe();
      };
    }

    document.getElementById('confirm-location-btn').onclick = () => {
      const isDefaultCoords = Math.abs(selectedCoords.lat - (-35.0811)) < 0.0001 && Math.abs(selectedCoords.lng - (-57.6508)) < 0.0001;
      if (isDefaultCoords && !isPreciseLocation) {
        showToast('No pudimos detectar tu ubicación GPS precisa. Por favor, escribe tu dirección en el buscador o mueve el mapa.', 'warning');
        return;
      }

      if (isGeocoding) {
        pendingConfirm = true;
        const confirmBtn = document.getElementById('confirm-location-btn');
        confirmBtn.innerHTML = `<div class="mini-spinner"></div>`;
        confirmBtn.disabled = true;
        return;
      }

      const address = lastGeocodedAddress || document.getElementById('address-search-input').value;
      if (address) {
        // Validation of reference note (Obligatorio unless optionalReference is passed)
        const reference = document.getElementById('address-reference-input')?.value.trim() || '';
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
            
            const bottomPanel = document.getElementById('address-bottom-panel');
            if (bottomPanel) {
              setTimeout(() => {
                bottomPanel.scrollTop = bottomPanel.scrollHeight;
              }, 150);
            }
          }
          showToast('Por favor, ingresá una referencia (Ej: Frente a la plaza, depto 2)', 'warning');
          return;
        }

        if (isGeneric || !config.editAddress) {
           if (config.justReturnAddress) {
             closeModal();
             if (onSuccess) onSuccess(address, reference, selectedCoords);
             return;
           }
           // Save to saved addresses list if we are not editing
           if (!config.editAddress) {
             import('../state.js').then(({ saveUserAddress }) => {
               saveUserAddress('Dirección', address, reference, selectedCoords);
             }).catch(e => console.warn('Could not save user address to list:', e));
           }
           setDeliveryAddress(address, reference, selectedCoords, '');
           closeModal();
           if (onSuccess) onSuccess(address, reference, selectedCoords);
        } else {
           showAddressDetails(address, selectedCoords, onSuccess, { ...config, initialReference: reference });
        }
      } else {
        showToast('Elegí una ubicación', 'warning');
      }
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

    // Auto-center on startup if no address
    const prefetched = getState().deliveryCoords;
    if (config.editAddress) {
      lastGeocodedAddress = config.editAddress.address;
      const addrText = document.getElementById('current-selected-address-text');
      if (addrText) addrText.textContent = config.editAddress.address;
      const input = document.getElementById('address-search-input');
      if (input) input.value = ''; // Always empty
      disableGeocodingTemporarily(1500);
      googleMap.setCenter(config.editAddress.coords);
      googleMap.setZoom(17);
    } else if (prefetched && !getState().deliveryAddress) {
      googleMap.setCenter(prefetched);
      googleMap.setZoom(17);
      reverseGeocode(prefetched.lat, prefetched.lng);
    } else if (!getState().deliveryAddress) {
      centerOnMe(false); // Silent center
    }

    // Handle saved addresses clicks
    document.querySelectorAll('.saved-addr-chip').forEach(chip => {
      chip.onclick = () => {
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

    const refInput = document.getElementById('address-reference-input');
    if (refInput) {
      refInput.addEventListener('focus', () => {
        const mapBox = document.getElementById('address-map-container');
        const savedWrapper = document.getElementById('saved-addresses-wrapper');
        if (mapBox) mapBox.style.display = 'none';
        if (savedWrapper) savedWrapper.style.display = 'none';
        refInput.style.borderColor = 'var(--color-primary)';
      });

      refInput.addEventListener('blur', () => {
        const mapBox = document.getElementById('address-map-container');
        const savedWrapper = document.getElementById('saved-addresses-wrapper');
        if (mapBox) mapBox.style.display = 'block';
        if (savedWrapper) savedWrapper.style.display = 'block';
        refInput.style.borderColor = 'var(--color-border)';
      });

      refInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          refInput.blur();
        }
      });
    }

    initSearch();
  };

  const toggleAdjustmentMode = (isAdj) => {
    document.getElementById('address-main-header').style.display = isAdj ? 'none' : 'block';
    document.getElementById('search-section').style.display = isAdj ? 'none' : 'block';
    document.getElementById('confirm-location-btn').style.display = isAdj ? 'none' : 'block';
    document.getElementById('adjustment-header').style.display = isAdj ? 'block' : 'none';
    document.getElementById('adj-buttons').style.display = isAdj ? 'flex' : 'none';
    document.getElementById('my-location-btn').style.bottom = '14px';
  };

  const updateRealTimeLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition((pos) => {
        const accuracy = pos.coords.accuracy || 9999;
        if (accuracy > 150) {
          isPreciseLocation = false;
          if (userLocationMarker) userLocationMarker.setMap(null);
          userLocationMarker = null;
          return;
        }
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastKnownUserPos = coords;
        isPreciseLocation = true;
        if (!userLocationMarker) {
          userLocationMarker = new google.maps.OverlayView();
          userLocationMarker.onAdd = function () {
            const div = document.createElement('div');
            div.className = 'user-loc-dot';
            div.style.position = 'absolute';
            this.getPanes().overlayMouseTarget.appendChild(div);
            this.div = div;
          };
          userLocationMarker.draw = function () {
            const projection = this.getProjection();
            if (!projection) return;
            const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(coords.lat, coords.lng));
            if (point && this.div) {
              this.div.style.left = (point.x - 7) + 'px';
              this.div.style.top = (point.y - 7) + 'px';
            }
          };
          userLocationMarker.setMap(googleMap);
        } else {
          userLocationMarker.draw();
        }
      }, null, { enableHighAccuracy: false, maximumAge: 300000 });
    }
  };

  let isGeocoding = false;
  let pendingConfirm = false;

  const centerOnMe = (showFeedback = true) => {
    if (!navigator.geolocation) {
      if (showFeedback) showToast('Geolocalización no soportada', 'error');
      return;
    }

    const iconWrap = document.getElementById('loc-btn-icon');

    // Instant center if we already have a cached position
    if (lastKnownUserPos && googleMap) {
      googleMap.setCenter(lastKnownUserPos);
      googleMap.setZoom(17);
      isPreciseLocation = true;
      
      if (iconWrap) {
        iconWrap.classList.add('loc-pulse-anim');
        setTimeout(() => iconWrap.classList.remove('loc-pulse-anim'), 400);
      }
      
      if (showFeedback) showToast('Ubicación actualizada', 'success');
      return;
    }

    const overlay = document.getElementById('map-loading-overlay');
    if (showFeedback && overlay) {
      overlay.style.opacity = '1';
    }

    const onSuccessCoords = (pos) => {
      if (overlay) overlay.style.opacity = '0';
      
      const accuracy = pos.coords.accuracy || 9999;
      if (accuracy > 150) {
        isPreciseLocation = false;
        if (showFeedback) {
          showToast('Ubicación poco precisa. Por favor, escribe tu dirección manualmente o mueve el mapa.', 'warning');
        }
        return;
      }
      
      const myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      lastKnownUserPos = myPos;
      isPreciseLocation = true;
      if (googleMap) {
        if (showFeedback) {
          googleMap.setCenter(myPos);
        } else {
          // Smooth pan for automatic startup centering
          googleMap.panTo(myPos);
        }
        googleMap.setZoom(17);
        if (iconWrap) {
          iconWrap.classList.add('loc-pulse-anim');
          setTimeout(() => iconWrap.classList.remove('loc-pulse-anim'), 400);
        }
        if (showFeedback) showToast('Ubicación actualizada', 'success');
      }
    };

    const onErrorCoords = (err) => {
      if (overlay) overlay.style.opacity = '0';
      if (showFeedback) {
        if (err.code === 1) showToast('Permiso de ubicación denegado', 'warning');
        else showToast('No se pudo obtener tu ubicación. Por favor, buscala en el mapa.', 'error');
      }
    };

    navigator.geolocation.getCurrentPosition(
      onSuccessCoords,
      onErrorCoords,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const reverseGeocode = (lat, lng) => {
    isGeocoding = true;
    const searchIconEl = document.getElementById('search-icon-wrapper');
    if (searchIconEl) {
      searchIconEl.innerHTML = `<div class="mini-spinner"></div>`;
    }

    geocoder.geocode({ location: { lat, lng } }, async (results, status) => {
      if (status === 'OK' && results[0]) {
        isGeocoding = false;
        if (searchIconEl) {
          searchIconEl.innerHTML = icon('search', 20);
        }
        lastGeocodedAddress = results[0].formatted_address.split(',').slice(0, 2).join(', ');
        updateSelectedAddress(lastGeocodedAddress);

        if (pendingConfirm) {
          pendingConfirm = false;
          const confirmBtn = document.getElementById('confirm-location-btn');
          if (confirmBtn) {
            confirmBtn.innerHTML = 'Confirmar';
            confirmBtn.disabled = false;
            confirmBtn.click();
          }
        }
      } else {
        // Fallback to Nominatim Reverse Geocoding
        try {
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=es`);
          const data = await response.json();
          if (data && data.display_name) {
            const a = data.address;
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
                confirmBtn.innerHTML = 'Confirmar';
                confirmBtn.disabled = false;
                confirmBtn.click();
              }
            }
          } else {
            throw new Error('No results from Nominatim');
          }
        } catch (nomErr) {
          console.warn('Nominatim reverse geocode failed:', nomErr);
          if (pendingConfirm) {
            pendingConfirm = false;
            const confirmBtn = document.getElementById('confirm-location-btn');
            if (confirmBtn) {
              confirmBtn.innerHTML = 'Confirmar';
              confirmBtn.disabled = false;
            }
            showToast('No se pudo determinar la dirección. Escríbela manualmente.', 'warning');
          }
        } finally {
          isGeocoding = false;
          if (searchIconEl) {
            searchIconEl.innerHTML = icon('search', 20);
          }
        }
      }
    });
  };

  const setSearchFocusMode = (active) => {
    const mapBox = document.getElementById('address-map-container');
    const mainHeader = document.getElementById('address-main-header');
    const selAddrBox = document.getElementById('current-selected-address-container');
    const refBox = document.getElementById('address-reference-input');
    const refContainer = refBox ? refBox.parentElement : null;
    const savedBox = document.getElementById('saved-addresses-list');
    const savedLabel = savedBox ? savedBox.previousElementSibling : null;
    const confirmBtn = document.getElementById('confirm-location-btn');
    const suggestionsBox = document.getElementById('address-suggestions');
    const bottomPanel = document.getElementById('address-bottom-panel');
    const searchSection = document.getElementById('search-section');

    if (active) {
      if (mapBox) mapBox.style.display = 'none';
      if (selAddrBox) selAddrBox.style.display = 'none';
      if (refContainer) refContainer.style.display = 'none';
      if (savedBox) savedBox.style.display = 'none';
      if (savedLabel && savedLabel.textContent.toLowerCase().includes('tus direcciones')) savedLabel.style.display = 'none';
      if (confirmBtn) confirmBtn.style.display = 'none';

      if (mainHeader) {
        mainHeader.style.display = 'flex';
        mainHeader.style.alignItems = 'center';
        mainHeader.style.justifyContent = 'center';
        mainHeader.style.padding = '16px 20px 8px';
        const titleEl = mainHeader.querySelector('h1');
        if (titleEl) titleEl.textContent = 'Buscar Dirección';
      }

      if (bottomPanel) {
        bottomPanel.scrollTop = 0;
        bottomPanel.style.display = 'flex';
        bottomPanel.style.flexDirection = 'column';
        bottomPanel.style.height = '100%';
        bottomPanel.style.padding = '0 16px 16px';
        bottomPanel.style.boxShadow = 'none';
      }

      if (searchSection) {
        searchSection.style.position = 'sticky';
        searchSection.style.top = '0';
        searchSection.style.zIndex = '100';
        searchSection.style.flexShrink = '0';
        searchSection.style.marginBottom = '8px';
        searchSection.style.background = 'var(--color-bg)';
        searchSection.style.paddingTop = '4px';
      }

      if (suggestionsBox) {
        suggestionsBox.style.display = 'block';
        suggestionsBox.style.position = 'static';
        suggestionsBox.style.flex = '1';
        suggestionsBox.style.minHeight = '0';
        suggestionsBox.style.overflowY = 'auto';
        suggestionsBox.style.webkitOverflowScrolling = 'touch';
        suggestionsBox.style.border = 'none';
        suggestionsBox.style.boxShadow = 'none';
        suggestionsBox.style.marginTop = '8px';
        suggestionsBox.style.background = 'transparent';
      }
    } else {
      if (mapBox) mapBox.style.display = 'block';
      if (mainHeader) {
        mainHeader.style.display = 'block';
        mainHeader.style.padding = '20px 0 12px';
        const titleEl = mainHeader.querySelector('h1');
        if (titleEl) titleEl.textContent = 'Confirma tu dirección';
      }
      if (selAddrBox) selAddrBox.style.display = 'flex';
      if (refContainer) refContainer.style.display = 'block';
      if (savedBox) savedBox.style.display = 'flex';
      if (savedLabel && savedLabel.textContent.toLowerCase().includes('tus direcciones')) savedLabel.style.display = 'block';
      if (confirmBtn) confirmBtn.style.display = 'block';

      if (bottomPanel) {
        bottomPanel.style.height = 'auto';
        bottomPanel.style.padding = '20px 20px calc(20px + env(safe-area-inset-bottom, 16px))';
        bottomPanel.style.boxShadow = '0 -10px 30px rgba(0,0,0,0.06)';
      }

      if (searchSection) {
        searchSection.style.position = 'relative';
        searchSection.style.marginBottom = '16px';
        searchSection.style.paddingTop = '0';
      }

      if (suggestionsBox) {
        suggestionsBox.style.display = 'none';
      }
    }
  };

  const initSearch = () => {
    const searchInput = document.getElementById('address-search-input');
    const suggestionsBox = document.getElementById('address-suggestions');
    const searchIconEl = document.getElementById('search-icon-wrapper');

    const triggerSearch = async () => {
      const query = searchInput.value;
      if (query.length < 2) return;
      setSearchFocusMode(false);
      
      try {
        const { searchAddressSuggestions } = await import('../utils/geo.js');
        const suggestions = await searchAddressSuggestions(query);
        if (suggestions && suggestions.length > 0) {
          const first = suggestions[0];
          const lat = parseFloat(first.lat);
          const lng = parseFloat(first.lng);
          
          if (googleMap) {
            disableGeocodingTemporarily(1500);
            googleMap.setCenter(new google.maps.LatLng(lat, lng));
            googleMap.setZoom(17);
          }
          if (suggestionsBox) suggestionsBox.style.display = 'none';
          lastGeocodedAddress = first.address;
          selectedCoords = { lat, lng };
          searchInput.value = first.address;
          updateSelectedAddress(first.address);
          showToast('Ubicación encontrada y centrada en el mapa', 'success');
        } else {
          showToast('No se encontraron resultados para esa dirección', 'warning');
        }
      } catch (err) {
        console.error('Search trigger error:', err);
      }
    };

     if (searchInput) {
      searchInput.oninput = (e) => {
        const query = e.target.value;
        if (query.length < 2) {
          setSearchFocusMode(false);
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
        }, 80);
      };

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerSearch();
        }
      });
    }

    if (searchIconEl) {
      searchIconEl.style.cursor = 'pointer';
      searchIconEl.onclick = (e) => {
        e.preventDefault();
        triggerSearch();
      };
    }

    // Auto-close suggestions when clicking outside search area
    document.addEventListener('click', (e) => {
      if (searchInput && suggestionsBox) {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
          setSearchFocusMode(false);
        }
      }
    });
  };

  const renderSuggestions = (suggestions, currentQuery = '') => {
    const suggestionsBox = document.getElementById('address-suggestions');
    if (!suggestionsBox) return;

    suggestions = suggestions || [];

    if (suggestions.length === 0 && currentQuery.trim().length < 2) {
      setSearchFocusMode(false);
      return;
    }

    setSearchFocusMode(true);
    
    let html = suggestions.map(s => `
      <div class="suggestion-item" data-lat="${s.lat || ''}" data-lng="${s.lng || ''}" data-placeid="${s.placeId || ''}" data-addr="${s.address}" style="padding:16px 20px; border-bottom:1px solid var(--color-border-light); cursor:pointer; background:var(--color-surface); border-radius:14px; margin-bottom:8px;">
        <div style="font-weight:800; font-size:14.5px; color:var(--color-text-primary);">${s.address}</div>
        <div style="font-size:12px; color:var(--color-text-tertiary); margin-top:2px;">${s.displayName || ''}</div>
      </div>
    `).join('');

    suggestionsBox.innerHTML = html;

    suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
      item.onclick = async () => {
        setSearchFocusMode(false);
        const addr = item.dataset.addr;
        isManualAddress = false;
        let lat = parseFloat(item.dataset.lat);
        let lng = parseFloat(item.dataset.lng);
        const placeId = item.dataset.placeid;

        const applyLocation = (finalLat, finalLng) => {
          if (googleMap) {
            disableGeocodingTemporarily(1500);
            googleMap.setCenter(new google.maps.LatLng(finalLat, finalLng));
            googleMap.setZoom(17);
          }
          suggestionsBox.style.display = 'none';

          lastGeocodedAddress = addr;
          selectedCoords = { lat: finalLat, lng: finalLng };
          const searchInput = document.getElementById('address-search-input');
          if (searchInput) searchInput.value = addr;
          updateSelectedAddress(addr);
        };

        if (isNaN(lat) || isNaN(lng)) {
          if (placeId) {
            showToast('Obteniendo ubicación...', 'info');
            try {
              const { geocodePlaceId } = await import('../utils/geo.js');
              const coords = await geocodePlaceId(placeId);
              if (coords) {
                applyLocation(coords.lat, coords.lng);
              } else {
                showToast('No se pudieron obtener las coordenadas exactas de la sugerencia', 'error');
              }
            } catch (err) {
              console.error('Error resolving placeId coordinates:', err);
              showToast('Error de conexión', 'error');
            }
          } else {
            showToast('Ubicación inválida', 'error');
          }
        } else {
          applyLocation(lat, lng);
        }
      };
    });

    setTimeout(() => {
      const header = document.getElementById('address-main-header');
      if (header) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        let startTime = 0;
        const dialog = modalContent.closest('.modal');
        const overlay = modalContent.closest('.modal-overlay');

        header.addEventListener('touchstart', (e) => {
          startY = e.touches[0].clientY;
          startTime = Date.now();
          isDragging = true;
          if (dialog) dialog.style.transition = 'none';
          if (overlay) overlay.style.transition = 'none';
        }, { passive: true });

        header.addEventListener('touchmove', (e) => {
          if (!isDragging) return;
          currentY = e.touches[0].clientY;
          const diff = currentY - startY;
          if (diff > 0 && dialog) {
            dialog.style.transform = `translateY(${diff}px)`;
            if (overlay) overlay.style.opacity = Math.max(0, 1 - (diff / 350));
          }
        }, { passive: true });

        header.addEventListener('touchend', () => {
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
    }, 100);
  };

  showModal({
    title: '',
    hideHeader: true,
    content: modalContent,
    onOpen: () => {
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

function getDarkStyles() {
  return [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  ];
}
