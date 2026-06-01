// GoDelivery — Location Picker Modal (Refined)
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
    
    <!-- Map Container -->
    <div id="map-picker-container" style="flex:1; background:var(--color-bg-secondary); position:relative; overflow:hidden;">
      <div id="map-picker" style="height:100%; width:100%;"></div>
      <!-- Center Pin -->
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -100%); pointer-events:none; z-index:1000; color:var(--color-primary);">
        <div class="dest-marker-v3">
           <div class="dest-pin" style="width:40px; height:40px;">${icon('mapPin', 24)}</div>
        </div>
      </div>
      <!-- Center Button -->
      <button id="picker-center-on-me" style="position:absolute; bottom:16px; right:16px; z-index:1000; width:44px; height:44px; border-radius:14px; border:none; background:var(--color-surface); color:var(--color-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:var(--shadow-lg);">
        ${icon('navigationArrow', 20)}
      </button>
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
        initMap();
      }
    });

    function initMap() {
      if (typeof google === 'undefined') {
        setTimeout(initMap, 200);
        return;
      }

      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      const magdalenaCenter = { lat: -35.0811, lng: -57.6508 };
      const mapCenter = initialCoords ? { lat: initialCoords.lat, lng: initialCoords.lng } : magdalenaCenter;

      const mapContainer = document.getElementById('map-picker');
      const map = new google.maps.Map(mapContainer, {
        center: mapCenter,
        zoom: initialCoords ? 17 : 15,
        disableDefaultUI: true,
        styles: theme === 'dark' ? getDarkStyles() : [],
        gestureHandling: 'greedy'
      });

      let selectedCoords = initialCoords || mapCenter;
      let selectedAddress = initialAddress;

      const reverseGeocode = async (lat, lng) => {
        const addrDisplay = document.getElementById('detected-address');
        if (!addrDisplay) return;
        addrDisplay.innerHTML = `<span style="opacity:0.5;">Buscando...</span>`;
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

      map.addListener('idle', () => {
        const center = map.getCenter();
        selectedCoords = { lat: center.lat(), lng: center.lng() };
        reverseGeocode(selectedCoords.lat, selectedCoords.lng);
      });

      const centerMe = (zoom = 17) => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((pos) => {
            const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            map.setCenter(p);
            map.setZoom(zoom);
          });
        }
      };

      if (!initialCoords) {
        centerMe(17);
        reverseGeocode(magdalenaCenter.lat, magdalenaCenter.lng);
      }

      document.getElementById('use-loc-btn').onclick = () => centerMe(17);
      document.getElementById('picker-center-on-me').onclick = () => centerMe(17);

      document.getElementById('confirm-loc-btn').onclick = () => {
        onSelect({ coords: selectedCoords, address: selectedAddress });
        closeModal();
      };
    }
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
