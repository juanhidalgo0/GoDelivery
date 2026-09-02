// GoDelivery — Location Picker Modal (Refined with MapLibre GL)
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_MAP_STYLE, OSM_MAP_STYLE } from '../utils/map-styles.js';
import { icon } from '../utils/icons.js';
import { showModal, closeModal } from './modal.js';

export async function showLocationPicker({ onSelect, initialCoords = null, initialAddress = '' }) {
  const modalContent = document.createElement('div');
  modalContent.className = 'delivery-map-modal-v3'; // Reuse professional map styles
  modalContent.style.display = 'flex';
  modalContent.style.flexDirection = 'column';
  modalContent.style.height = '80dvh';
  modalContent.style.minHeight = '500px';

  modalContent.innerHTML = `
    <!-- Header -->
    <div style="padding:16px 20px; background:var(--color-bg); border-bottom:1px solid var(--color-border-light); display:flex; justify-content:space-between; align-items:center;">
      <h2 style="margin:0; font-family:var(--font-display); font-size:18px; font-weight:800;">Seleccionar Ubicación</h2>
    </div>

    <!-- Autocomplete Search Bar -->
    <div style="padding:10px 16px; background:var(--color-bg); border-bottom:1px solid var(--color-border-light); position:relative; z-index:2000;">
      <div style="display:flex; align-items:center; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:12px; padding:0 12px; height:44px; gap:8px;">
        <span style="color:var(--color-text-tertiary); display:flex;">${icon('search', 16)}</span>
        <input type="text" id="map-picker-search-input" placeholder="Buscar dirección (ej: brenan 1280)..." autocomplete="off" style="flex:1; border:none; background:transparent; outline:none; font-size:13.5px; font-weight:600; color:var(--color-text);" />
        <button id="map-picker-clear-search" style="display:none; background:none; border:none; color:var(--color-text-tertiary); font-size:16px; cursor:pointer; padding:4px;">×</button>
      </div>
      <!-- Suggestions Dropdown wrapper -->
      <div id="map-picker-suggestions-box" class="address-suggestions-list" style="position:absolute; top:100%; left:16px; right:16px; max-height:220px; overflow-y:auto; background:var(--color-surface); border-radius:0 0 12px 12px; box-shadow:var(--shadow-lg); border:1px solid var(--color-border); border-top:none; z-index:9999; display:none;"></div>
    </div>
    
    <!-- Map Container -->
    <div id="map-picker-container" style="flex:1; background:var(--color-bg-secondary); position:relative; overflow:hidden;">
      <div id="map-picker" style="height:100%; width:100%;"></div>
      <!-- Center Pin -->
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -100%); pointer-events:none; z-index:1000; color:var(--color-primary);">
        <div class="dest-marker-v3">
           <div class="dest-pin" style="width:40px; height:40px;">${icon('mapPin', 24)}</div>
        </div>
      </div>
      <!-- Floating Map Controls (Zoom In, Zoom Out, Center) -->
      <div style="position:absolute; bottom:16px; right:16px; z-index:1000; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; flex-direction:column; background:rgba(255,255,255,0.92); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border-radius:14px; border:1.5px solid rgba(255,255,255,0.8); box-shadow:0 8px 25px rgba(0,0,0,0.12); overflow:hidden;">
          <button type="button" id="picker-zoom-in" style="width:44px; height:40px; background:transparent; border:none; border-bottom:1px solid rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text-primary, #0f172a); transition:background 0.15s ease;" title="Acercar">
            ${icon('plus', 18)}
          </button>
          <button type="button" id="picker-zoom-out" style="width:44px; height:40px; background:transparent; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--color-text-primary, #0f172a); transition:background 0.15s ease;" title="Alejar">
            ${icon('minus', 18)}
          </button>
        </div>
        <button id="picker-center-on-me" style="width:44px; height:44px; border-radius:14px; border:1.5px solid rgba(255,255,255,0.8); background:rgba(255,255,255,0.92); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); color:var(--color-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 8px 25px rgba(0,0,0,0.12);" title="Mi ubicación">
          ${icon('navigationArrow', 20)}
        </button>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:20px; background:var(--color-bg); border-top:1px solid var(--color-border-light);">
      <div class="input-group" style="margin-bottom:16px;">
        <label style="font-size:11px; font-weight:850; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; display:block;">Dirección Detectada</label>
        <div id="detected-address" style="font-size:14px; font-weight:700; color:var(--color-text); padding:14px; background:var(--color-bg-secondary); border:1px solid var(--color-border-light); border-radius:14px; min-height:48px; display:flex; align-items:center;">
          ${initialAddress || 'Mové el mapa para elegir...'}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 2fr; gap:12px;">
        <button class="btn btn-outline" id="use-loc-btn" style="height:52px; border-radius:16px; font-size:13px;">
          ${icon('navigation', 18)} Mi ubicación
        </button>
        <button class="btn btn-primary" id="confirm-loc-btn" style="height:52px; border-radius:16px; font-weight:800; font-size:15px; box-shadow:var(--shadow-primary);">
          CONFIRMAR UBICACIÓN
        </button>
      </div>
    </div>
  `;

    showModal({
      title: '',
      content: modalContent,
      onOpen: () => {
        setTimeout(initMap, 50);
      }
    });

    function initMap() {
      const magCenter = { lat: -35.0815, lng: -57.5147 };
      const mapCenter = initialCoords ? { lat: Number(initialCoords.lat), lng: Number(initialCoords.lng) } : magCenter;

      const mapContainer = document.getElementById('map-picker');
      if (!mapContainer) return;

      let selectedCoords = initialCoords || { lat: -35.0815, lng: -57.5147 };
      let selectedAddress = initialAddress;

      const reverseGeocode = async (lat, lng) => {
        const addrDisplay = document.getElementById('detected-address');
        if (!addrDisplay) return;
        addrDisplay.innerHTML = `<span style="opacity:0.5;">Buscando...</span>`;

        if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.Geocoder) {
          try {
            const geocoder = new window.google.maps.Geocoder();
            const gResult = await new Promise((resolve, reject) => {
              geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === 'OK' && results && results[0]) resolve(results[0]);
                else reject(new Error('Status: ' + status));
              });
            });
            if (gResult) {
              let street = '';
              let number = '';
              let city = '';
              (gResult.address_components || []).forEach(comp => {
                if (comp.types.includes('route')) street = comp.long_name;
                if (comp.types.includes('street_number')) number = comp.long_name;
                if (comp.types.includes('locality')) city = comp.long_name;
              });
              let display = `${street} ${number}`.trim();
              if (city && !display.includes(city)) display += `, ${city}`;
              selectedAddress = display || gResult.formatted_address.split(',')[0];
              addrDisplay.textContent = selectedAddress;
              return;
            }
          } catch(e) {}
        }

        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=es&addressdetails=1`);
          const data = await resp.json();
          const a = data.address;

          const street = a.road || a.pedestrian || a.suburb || '';
          const number = a.house_number || '';
          const city = a.city || a.town || a.village || '';
          const neighborhood = a.neighbourhood || a.residential || '';

          let display = `${street} ${number}`.trim();
          if (neighborhood && !display.includes(neighborhood)) display += ` (${neighborhood})`;
          if (city && !display.includes(city)) display += `, ${city}`;

          selectedAddress = display || data.display_name.split(',')[0];
          addrDisplay.textContent = selectedAddress;
        } catch (err) {
          addrDisplay.textContent = "Ubicación seleccionada";
        }
      };

      // A. Google Maps Native
      let map = null;
      let isGoogleMap = false;

      if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.Map) {
        try {
          map = new window.google.maps.Map(mapContainer, {
            center: mapCenter,
            zoom: initialCoords ? 17 : 15.5,
            disableDefaultUI: true,
            gestureHandling: 'greedy',
            clickableIcons: false
          });

          map.addListener('idle', () => {
            const c = map.getCenter();
            if (c) {
              selectedCoords = { lat: c.lat(), lng: c.lng() };
              reverseGeocode(c.lat(), c.lng());
            }
          });

          isGoogleMap = true;
        } catch(e) {
          console.warn('[LocationModal] Google Maps init failed, falling back to MapLibre:', e);
        }
      }

      // B. MapLibre Fallback
      if (!isGoogleMap) {
        const MapConstructor = maplibregl.Map || maplibregl.default?.Map || (typeof window !== 'undefined' && window.maplibregl?.Map);

        map = new MapConstructor({
          container: mapContainer,
          style: OSM_MAP_STYLE,
          center: [mapCenter.lng, mapCenter.lat],
          zoom: initialCoords ? 17 : 15,
          attributionControl: false
        });

        map.on('moveend', () => {
          const c = map.getCenter();
          selectedCoords = { lat: c.lat, lng: c.lng };
          reverseGeocode(c.lat, c.lng);
        });
      }

      // Autocomplete Suggestions logic
      const searchInput = document.getElementById('map-picker-search-input');
      const suggestionsBox = document.getElementById('map-picker-suggestions-box');
      const clearSearchBtn = document.getElementById('map-picker-clear-search');
      
      let searchTimeout = null;

      if (searchInput && suggestionsBox) {
        searchInput.oninput = async (e) => {
          const val = e.target.value;
          if (clearSearchBtn) {
            clearSearchBtn.style.display = val ? 'block' : 'none';
          }
          
          clearTimeout(searchTimeout);
          if (!val || val.trim().length < 3) {
            suggestionsBox.style.display = 'none';
            suggestionsBox.innerHTML = '';
            return;
          }

          searchTimeout = setTimeout(async () => {
            try {
              const { searchAddressSuggestions } = await import('../utils/geo.js');
              const results = await searchAddressSuggestions(val);
              if (results && results.length > 0) {
                suggestionsBox.innerHTML = results.map(r => `
                  <div class="suggestion-item" data-lat="${r.lat || ''}" data-lng="${r.lng || ''}" data-placeid="${r.placeId || ''}" data-address="${r.address}" style="padding:12px 16px; border-bottom:1px solid var(--color-border-light); cursor:pointer; font-size:13px; font-weight:600; color:var(--color-text);">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="color:var(--color-primary); display:flex;">${icon('mapPin', 14)}</span>
                      <div>
                        <div style="color:var(--color-text);">${r.address}</div>
                        <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:normal; margin-top:2px;">Magdalena, Buenos Aires</div>
                      </div>
                    </div>
                  </div>
                `).join('');
                suggestionsBox.style.display = 'block';

                suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
                  item.onclick = async () => {
                    let lat = parseFloat(item.dataset.lat);
                    let lng = parseFloat(item.dataset.lng);
                    const placeId = item.dataset.placeid;
                    const addr = item.dataset.address;

                    const applyCoords = (finalLat, finalLng) => {
                      selectedCoords = { lat: finalLat, lng: finalLng };
                      selectedAddress = addr;

                      if (map) {
                        if (typeof map.panTo === 'function') {
                          map.panTo({ lat: finalLat, lng: finalLng });
                          map.setZoom(17);
                        } else if (typeof map.easeTo === 'function') {
                          map.easeTo({ center: [finalLng, finalLat], zoom: 17 });
                        }
                      }

                      const addrDisplay = document.getElementById('detected-address');
                      if (addrDisplay) addrDisplay.textContent = selectedAddress;

                      suggestionsBox.style.display = 'none';
                      suggestionsBox.innerHTML = '';
                      searchInput.value = addr;
                    };

                    if (isNaN(lat) || isNaN(lng)) {
                      if (placeId) {
                        try {
                          const { geocodePlaceId } = await import('../utils/geo.js');
                          const coords = await geocodePlaceId(placeId);
                          if (coords) {
                            applyCoords(coords.lat, coords.lng);
                          } else {
                            const { showToast } = await import('./toast.js');
                            showToast('No se pudo geocodificar la sugerencia', 'error');
                          }
                        } catch (err) {
                          console.error(err);
                        }
                      }
                    } else {
                      applyCoords(lat, lng);
                    }
                  };
                });
              } else {
                suggestionsBox.style.display = 'none';
                suggestionsBox.innerHTML = '';
              }
            } catch (err) {
              console.error('[LocationPicker] Autocomplete failed:', err);
            }
          }, 350);
        };

        if (clearSearchBtn) {
          clearSearchBtn.onclick = () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            suggestionsBox.style.display = 'none';
            suggestionsBox.innerHTML = '';
          };
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
          if (!e.target.closest('#map-picker-search-input') && !e.target.closest('#map-picker-suggestions-box')) {
            suggestionsBox.style.display = 'none';
          }
        });
      }

      const centerMe = (zoom = 17) => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((pos) => {
            const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            selectedCoords = p;
            if (map) {
              if (typeof map.panTo === 'function') {
                map.panTo({ lat: p.lat, lng: p.lng });
                map.setZoom(zoom);
              } else if (typeof map.easeTo === 'function') {
                map.easeTo({ center: [p.lng, p.lat], zoom });
              }
            }
            reverseGeocode(p.lat, p.lng);
          });
        }
      };

      if (!initialCoords) {
        centerMe(17);
      }

      const zoomInEl = document.getElementById('picker-zoom-in');
      if (zoomInEl) {
        zoomInEl.onclick = (e) => {
          e.preventDefault();
          try {
            if (map) {
              if (typeof map.setZoom === 'function') {
                map.setZoom(map.getZoom() + 1);
              } else if (typeof map.zoomIn === 'function') {
                map.zoomIn({ duration: 300 });
              }
            }
          } catch(err) {}
        };
      }

      const zoomOutEl = document.getElementById('picker-zoom-out');
      if (zoomOutEl) {
        zoomOutEl.onclick = (e) => {
          e.preventDefault();
          try {
            if (map) {
              if (typeof map.setZoom === 'function') {
                map.setZoom(map.getZoom() - 1);
              } else if (typeof map.zoomOut === 'function') {
                map.zoomOut({ duration: 300 });
              }
            }
          } catch(err) {}
        };
      }

      const useLocBtn = document.getElementById('use-loc-btn');
      if (useLocBtn) useLocBtn.onclick = () => centerMe(17);

      const centerOnMeBtn = document.getElementById('picker-center-on-me');
      if (centerOnMeBtn) centerOnMeBtn.onclick = () => centerMe(17);

      const confirmLocBtn = document.getElementById('confirm-loc-btn');
      if (confirmLocBtn) {
        confirmLocBtn.onclick = () => {
          onSelect({ coords: selectedCoords, address: selectedAddress });
          closeModal();
        };
      }
    }
  }
