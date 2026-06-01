/* GoDelivery — Address Modal Component with Google Maps & PedidosYa Style */
import { showModal, closeModal, closeMultipleModals } from './modal.js';
import { icon } from '../utils/icons.js';
import { setDeliveryAddress, getState } from '../state.js';
import { showToast } from './toast.js';

export function showAddressPrompt(onSuccess, config = {}) {
  const isGeneric = config.mode === 'pick';
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

  const renderMainView = () => {
    modalContent.innerHTML = `
      <!-- Header -->
      <div id="address-main-header" style="padding: 20px 0 12px; text-align: center; background: var(--color-bg); z-index: 10; border-radius: 28px 28px 0 0; flex-shrink:0;">
        <div style="width: 40px; height: 5px; background: var(--color-border-light); border-radius: 10px; margin: 0 auto 16px;"></div>
        <h1 style="font-family: var(--font-display); font-size: 1.25rem; font-weight: 900; color: var(--color-text-primary); margin: 0;">Confirma tu dirección</h1>
      </div>

      <!-- Map Area -->
      <div id="address-map-container" style="flex: 1; position: relative; background: var(--color-bg-secondary);">
        <div id="address-map-picker" style="width: 100%; height: 100%;"></div>
        
        <!-- Center Marker (Perfect PedidosYa Teardrop) -->
        <div id="address-center-marker" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -100%); pointer-events: none; z-index: 10;">
           <div style="filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));">
             <svg width="40" height="52" viewBox="0 0 40 52" fill="none">
               <path d="M20 52C20 52 40 33.7258 40 20C40 8.9543 31.0457 0 20 0C8.9543 0 0 8.9543 0 20C0 33.7258 20 52 20 52Z" fill="#1A1A1A"/>
               <circle cx="20" cy="20" r="6" fill="white"/>
             </svg>
           </div>
        </div>

        <button id="my-location-btn" style="position: absolute; bottom: 210px; right: 16px; width: 52px; height: 52px; border-radius: 16px; background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 11; color: var(--color-primary); transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">
          <div id="loc-btn-icon" style="display:flex; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
            ${icon('target', 24)}
          </div>
        </button>

        <!-- Professional Loading Overlay -->
        <div id="map-loading-overlay" style="position:absolute; inset:0; background:rgba(255,255,255,0.7); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; z-index:100; transition:opacity 0.4s; pointer-events:none; opacity:0;">
          <div class="map-spinner"></div>
          <p style="font-weight:700; color:var(--color-text-primary); font-size:14px; margin:0;">Detectando ubicación...</p>
        </div>

        <!-- My Location Button (Refined PedidosYa Style) -->

        <!-- Adjustment Header -->
        <div id="adjustment-header" style="display:none; position:absolute; top:0; left:0; right:0; background:var(--color-bg); padding:20px; z-index:100; border-radius: 28px 28px 0 0;">
          <button id="adj-back-btn" style="background:none; border:none; padding:8px; margin-bottom:8px; cursor:pointer; color: var(--color-text-primary);">${icon('arrowLeft', 24)}</button>
          <h2 style="font-family:var(--font-display); font-size:1.5rem; font-weight:900; color:var(--color-text-primary); margin:0 0 4px;">Ajusta el pin en el mapa</h2>
          <p style="margin:0; color:var(--color-text-tertiary); font-size:14px; font-weight:500;">Ubícalo en el lugar exacto de tu dirección.</p>
        </div>
      </div>

      <!-- Bottom Panel -->
      <div id="address-bottom-panel" style="padding: 24px 20px 40px; background: var(--color-bg); box-shadow: 0 -10px 30px rgba(0,0,0,0.1); z-index: 20; flex-shrink:0;">
        <!-- Dirección seleccionada aparte -->
        <div id="current-selected-address-container" style="margin-bottom: 16px; display: flex; align-items: flex-start; gap: 10px; background: var(--color-bg-secondary); padding: 14px 16px; border-radius: 16px; border: 1.5px solid var(--color-border-light);">
          <div style="color: var(--color-primary); margin-top: 2px; flex-shrink: 0;">${icon('mapPin', 18)}</div>
          <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
            <span style="font-size: 10px; font-weight: 850; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">Dirección Seleccionada</span>
            <span id="current-selected-address-text" style="font-size: 14px; font-weight: 700; color: var(--color-text-primary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              Cargando dirección...
            </span>
          </div>
        </div>

        <div id="search-section" style="margin-bottom: 16px; position: relative;">
          <div style="position: relative;">
            <input type="text" id="address-search-input" placeholder="¿A dónde lo enviamos?" style="width: 100%; height: 56px; padding: 0 52px 0 20px; border-radius: 18px; border: 1.5px solid var(--color-bg-secondary); background: var(--color-bg-secondary); font-size: 15px; font-weight: 700; outline: none; color: var(--color-text-primary); transition: all 0.2s;">
            <div id="search-icon-wrapper" style="position: absolute; right: 18px; top: 50%; transform: translateY(-50%); color: var(--color-primary); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
              ${icon('search', 20)}
            </div>
          </div>
          <div id="address-suggestions" class="address-suggestions-list" style="display:none; position:absolute; bottom:100%; left:0; right:0; margin-bottom:8px; max-height:220px; overflow-y:auto; background:var(--color-bg); border-radius:16px; border:1px solid var(--color-border); box-shadow:0 -10px 25px rgba(0,0,0,0.15); z-index:100;"></div>
        </div>

        <!-- Saved Addresses Horizontal List -->
        <div id="saved-addresses-list" style="margin-bottom: 20px; display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; scrollbar-width: none; -ms-overflow-style: none;">
          ${(getState().savedAddresses || []).map(addr => `
            <div class="saved-addr-chip" data-id="${addr.id}" style="flex-shrink:0; padding:10px 16px; background:var(--color-bg-secondary); border-radius:14px; border:1.5px solid var(--color-border-light); display:flex; align-items:center; gap:10px; cursor:pointer; transition:all 0.2s;">
              <div style="color:var(--color-primary);">${icon(addr.name.toLowerCase().includes('casa') ? 'home' : (addr.name.toLowerCase().includes('trabajo') || addr.name.toLowerCase().includes('oficina') ? 'store' : 'mapPin'), 16)}</div>
              <div style="font-size:13px; font-weight:800; color:var(--color-text-primary); white-space:nowrap;">${addr.name}</div>
            </div>
          `).join('')}
        </div>

        
        <div id="adj-buttons" style="display:none; flex-direction:column; gap:12px;">
           <button id="adj-continue-btn" class="btn btn-primary" style="height:56px; border-radius:24px; font-weight:900; background:#E11D48;">Continuar</button>
           <button id="adj-cancel-btn" style="height:44px; background:none; border:none; color:var(--color-text-primary); font-weight:700; font-size:14px; cursor:pointer;">Cancelar</button>
        </div>

        <button id="confirm-location-btn" class="btn btn-primary btn-block" style="height: 60px; border-radius: 20px; font-weight: 900; font-size: 17px; background: #E11D48; border: none; color: white; box-shadow: 0 8px 20px rgba(225, 29, 72, 0.2);">
          Confirmar
        </button>
      </div>

      <style>
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
      reverseGeocode(selectedCoords.lat, selectedCoords.lng);
    });

    updateRealTimeLocation();

    // FIXED: Ensure listeners are attached correctly
    const locBtn = document.getElementById('my-location-btn');
    if (locBtn) {
      locBtn.onclick = (e) => {
        e.preventDefault();
        centerOnMe();
      };
    }

    document.getElementById('confirm-location-btn').onclick = () => {
      if (isGeocoding) {
        pendingConfirm = true;
        const confirmBtn = document.getElementById('confirm-location-btn');
        confirmBtn.innerHTML = `<div class="mini-spinner"></div>`;
        confirmBtn.disabled = true;
        return;
      }

      const address = lastGeocodedAddress || document.getElementById('address-search-input').value;
      if (address) {
        if (isGeneric) {
           if (onSuccess) onSuccess(address, '', selectedCoords);
           closeModal();
        } else {
           showAddressDetails(address, selectedCoords, onSuccess, config);
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
          googleMap.setCenter(saved.coords);
          googleMap.setZoom(17);
          lastGeocodedAddress = saved.address;
          selectedCoords = saved.coords;
          const addrText = document.getElementById('current-selected-address-text');
          if (addrText) addrText.textContent = saved.address;
          const input = document.getElementById('address-search-input');
          if (input) input.value = ''; // Keep empty on selection
          showToast(`Ubicación: ${saved.name}`, 'info');
        }
      };
    });

    initSearch();
  };

  const toggleAdjustmentMode = (isAdj) => {
    document.getElementById('address-main-header').style.display = isAdj ? 'none' : 'block';
    document.getElementById('search-section').style.display = isAdj ? 'none' : 'block';
    document.getElementById('confirm-location-btn').style.display = isAdj ? 'none' : 'block';
    document.getElementById('adjustment-header').style.display = isAdj ? 'block' : 'none';
    document.getElementById('adj-buttons').style.display = isAdj ? 'flex' : 'none';
    document.getElementById('my-location-btn').style.bottom = isAdj ? '240px' : '210px';
  };

  const updateRealTimeLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition((pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastKnownUserPos = coords;
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
            const point = this.getProjection().fromLatLngToDivPixel(new google.maps.LatLng(coords.lat, coords.lng));
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
      const myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      lastKnownUserPos = myPos;
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

    // Doble pasada robusta e infalible para iOS Safari
    navigator.geolocation.getCurrentPosition(
      onSuccessCoords,
      (err) => {
        console.warn('Alta precisión falló en address-modal. Intentando precisión celular/Wi-Fi...');
        navigator.geolocation.getCurrentPosition(
          onSuccessCoords,
          onErrorCoords,
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
        );
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  const reverseGeocode = (lat, lng) => {
    isGeocoding = true;
    const searchIconEl = document.getElementById('search-icon-wrapper');
    if (searchIconEl) {
      searchIconEl.innerHTML = `<div class="mini-spinner"></div>`;
    }

    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      isGeocoding = false;
      if (searchIconEl) {
        searchIconEl.innerHTML = icon('search', 20);
      }

      if (status === 'OK' && results[0]) {
        lastGeocodedAddress = results[0].formatted_address.split(',').slice(0, 2).join(', ');
        const addrText = document.getElementById('current-selected-address-text');
        if (addrText) addrText.textContent = lastGeocodedAddress;

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
        if (pendingConfirm) {
          pendingConfirm = false;
          const confirmBtn = document.getElementById('confirm-location-btn');
          if (confirmBtn) {
            confirmBtn.innerHTML = 'Confirmar';
            confirmBtn.disabled = false;
          }
          showToast('No se pudo determinar la dirección. Escríbela manualmente.', 'warning');
        }
      }
    });
  };

  const initSearch = () => {
    const searchInput = document.getElementById('address-search-input');
    const suggestionsBox = document.getElementById('address-suggestions');
    const searchIconEl = document.getElementById('search-icon-wrapper');

    const triggerSearch = async () => {
      const query = searchInput.value;
      if (query.length < 3) return;
      
      try {
        const { searchAddressSuggestions } = await import('../utils/geo.js');
        const suggestions = await searchAddressSuggestions(query);
        if (suggestions && suggestions.length > 0) {
          const first = suggestions[0];
          const lat = parseFloat(first.lat);
          const lng = parseFloat(first.lng);
          
          if (googleMap) {
            googleMap.setCenter(new google.maps.LatLng(lat, lng));
            googleMap.setZoom(17);
          }
          if (suggestionsBox) suggestionsBox.style.display = 'none';
          lastGeocodedAddress = first.address;
          selectedCoords = { lat, lng };
          searchInput.value = first.address;
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
        if (query.length < 3) {
          if (suggestionsBox) suggestionsBox.style.display = 'none';
          return;
        }
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
          try {
            const { searchAddressSuggestions } = await import('../utils/geo.js');
            const suggestions = await searchAddressSuggestions(query);
            renderSuggestions(suggestions);
          } catch (err) {
            console.error('Error fetching search suggestions:', err);
          }
        }, 400);
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
          suggestionsBox.style.display = 'none';
        }
      }
    });
  };

  const renderSuggestions = (suggestions) => {
    const suggestionsBox = document.getElementById('address-suggestions');
    if (!suggestionsBox) return;

    if (!suggestions || suggestions.length === 0) {
      suggestionsBox.style.display = 'none';
      return;
    }

    suggestionsBox.style.display = 'block';
    suggestionsBox.innerHTML = suggestions.map(s => `
      <div class="suggestion-item" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${s.address}" style="padding:14px 20px; border-bottom:1px solid var(--color-border-light); cursor:pointer;">
        <div style="font-weight:700; font-size:14px; color:var(--color-text-primary);">${s.address}</div>
        <div style="font-size:12px; color:var(--color-text-tertiary);">${s.displayName || ''}</div>
      </div>
    `).join('');

    suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
      item.onclick = () => {
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        const addr = item.dataset.addr;

        if (googleMap) {
          googleMap.setCenter(new google.maps.LatLng(lat, lng));
          googleMap.setZoom(17);
        }
        suggestionsBox.style.display = 'none';

        lastGeocodedAddress = addr;
        selectedCoords = { lat, lng };
        const searchInput = document.getElementById('address-search-input');
        if (searchInput) searchInput.value = addr;
      };
    });
  };

  showModal({ title: '', hideHeader: true, content: modalContent });
  renderMainView();
}

export function showAddressDetails(address, coords, onSuccess, config = {}) {
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; background:var(--color-bg);';

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
    <div style="padding:20px; display:flex; align-items:center; gap:16px; border-bottom:1px solid var(--color-border-light);">
      <button id="details-back" style="background:none; border:none; padding:8px; cursor:pointer; color: var(--color-text-primary);">${icon('arrowLeft', 20)}</button>
      <h3 style="font-family:var(--font-display); font-weight:800; margin:0; font-size:1.1rem; color: var(--color-text-primary);">Detalles de entrega</h3>
    </div>

    <div style="flex:1; overflow-y:auto; padding:24px 20px; display:flex; flex-direction:column; gap:20px;">
      <div>
        <label style="display:block; font-size:12px; font-weight:800; color:var(--color-text-secondary); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.02em;">Nombre de la dirección</label>
        <input type="text" id="details-name" placeholder="Ej: Casa, Trabajo, Gimnasio..." value="${config.editAddress ? config.editAddress.name : ''}" style="width:100%; height:52px; padding:0 16px; border:1.5px solid var(--color-border); border-radius:14px; font-size:15px; font-weight:700; outline:none; background: var(--color-bg); color: var(--color-text-primary);" />
      </div>

      <div>
        <div style="font-size:12px; font-weight:800; color:var(--color-text-tertiary); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.02em;">Ubicación seleccionada</div>
        <div style="display:flex; align-items:center; gap:12px; padding:16px; background:var(--color-bg-secondary); border-radius:14px; border:1px solid var(--color-border-light);">
          <div style="color:var(--color-primary);">${icon('mapPin', 20)}</div>
          <div style="font-size:14px; font-weight:700; color:var(--color-text-primary); line-height:1.4;">${address}</div>
        </div>
      </div>

      <div class="field">
        <label style="display:block; font-size:12px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">Piso / Departamento (Opcional)</label>
        <input type="text" id="details-apt" placeholder="Ej: 4B" value="${aptVal}" style="width:100%; height:52px; padding:0 16px; border:1.5px solid var(--color-border); border-radius:12px; font-size:14px; outline:none; background: var(--color-bg); color: var(--color-text-primary);" />
      </div>

      <div class="field">
        <label style="display:block; font-size:12px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">Instrucciones para el repartidor</label>
        <textarea id="details-notes" placeholder="Ej: Portón blanco, timbre roto..." style="width:100%; height:100px; padding:16px; border:1.5px solid var(--color-border); border-radius:12px; font-size:14px; outline:none; resize:none; background: var(--color-bg); color: var(--color-text-primary);">${notesVal}</textarea>
      </div>

      <div class="field">
        <label style="display:block; font-size:12px; font-weight:700; color:var(--color-text-secondary); margin-bottom:8px;">Celular de contacto</label>
        <div style="display:flex; gap:8px;">
          <div style="height:52px; padding:0 12px; border:1.5px solid var(--color-border); border-radius:12px; display:flex; align-items:center; background:var(--color-bg-secondary); color: var(--color-text-primary);">
             <span style="font-size:14px; font-weight:700;">🇦🇷 +54</span>
          </div>
          <input type="tel" id="details-phone" placeholder="Celular sin el 0" value="${getState().user?.phone || ''}" style="flex:1; height:52px; padding:0 16px; border:1.5px solid var(--color-border); border-radius:12px; font-size:14px; outline:none; background: var(--color-bg); color: var(--color-text-primary);" />
        </div>
      </div>
    </div>

    <div style="padding:20px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0)); display:flex; flex-direction:column; gap:12px;">
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
    const name = document.getElementById('details-name').value.trim();
    const apt = document.getElementById('details-apt').value.trim();
    const notes = document.getElementById('details-notes').value.trim();
    const finalNotes = [apt, notes].filter(Boolean).join(' - ');
    
    // Save/Update user addresses list if a name is provided
    if (name) {
      const { saveUserAddress, updateUserAddress } = await import('../state.js');
      if (config.editAddress) {
        updateUserAddress(config.editAddress.id, name, address, finalNotes, coords);
      } else {
        saveUserAddress(name, address, finalNotes, coords);
      }
    }

    setDeliveryAddress(address, finalNotes, coords, '');
    closeMultipleModals(2);
    showToast(config.editAddress ? '¡Dirección actualizada!' : '¡Dirección configurada!', 'success');
    if (onSuccess) onSuccess(address, finalNotes, coords);
  };
}

export function ensureAddress(onSuccess) {
  const address = getState().deliveryAddress;
  if (!address) {
    showAddressPrompt(onSuccess);
    return false;
  }
  if (onSuccess) onSuccess(address);
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
